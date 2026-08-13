/**
 * The pre-mixed narration track (T10-5) — one continuous audio file for
 * the whole lecture, and the arithmetic that places every clip in it.
 *
 * WHY a track at all. Per-clip playback swapped `src` on ONE reused
 * element at every clip change, so `play()` was measured at `readyState 0`
 * on 4 of 4 starts: the element had nothing buffered and the browser ate
 * the opening syllable. `preload="auto"` could never help — the src it
 * applied to was the one being replaced. A single src set once, long
 * before the first sound, is not a managed seam; it is no seam.
 *
 * WHAT COORDINATE THE TRACK IS IN. Not canonical seconds. The canonical
 * clock PINS at a pen-down (or at the board's end) while a clip's tail
 * finishes — `clock-gate.ts` rule 4 — so wall-clock playback time runs
 * ahead of canonical time by every hold that has already happened. A
 * single element plays wall time, so the track is laid in wall time:
 *
 *     trackStart(clip) = clip.start + Σ (audioEnd − holdAt) of earlier holds
 *
 * That makes the map canonical ↔ track piecewise-linear and MONOTONE:
 * identity in the gaps, identity inside a clip, with a constant step at
 * each hold. It is also why clips provably cannot overlap in the track —
 * a held clip's successor starts at or after the pen-down it held, and the
 * offset it inherits is exactly that clip's overrun.
 *
 * WHY IT IS VERIFIED AND NEVER TRUSTED. Per-clip playback is
 * self-correcting: a clip sounds when its window opens, so a schedule
 * error costs one step. A track is globally aligned — after t = 0 there is
 * no per-step resync at all — so a schedule that has moved since mix time
 * divorces the voice from the pen progressively, and it looks like an
 * engine bug. The board's schedule is a function of MEASURED text (a theme
 * flip changes the font, and the same words wrap differently), so it
 * genuinely does move. Therefore: the track ships its layout, the viewer
 * recomputes the layout from the live compile, and a hash-sequence or
 * position disagreement makes the track stale — it is not played, the
 * per-clip path takes over, and the board says so. Staleness detection
 * (an appended sentence shifts every later position) falls out of the same
 * mechanism for free.
 *
 * Pure and host-free, like the rest of `narration/`: no DOM, no fetch, no
 * engine imports. The three consumers — `narrate`'s mix plan, the mixer
 * script, `track-conductor.ts` — all reach the arithmetic through here, so
 * there is exactly one definition of where a clip belongs.
 */

import type { ClipWindow } from "./timing.js";

/** One clip's place in the mixed track. */
export interface TrackClip {
  /** The step content hash the clip was synthesized for. */
  hash: string;
  /** First sample of the clip inside the track. */
  offset: number;
  /** The clip's own length in samples. */
  samples: number;
  /** Canonical second the voice starts (the window's `start`). */
  start: number;
  /** The window's `holdAt` — carried so the map can be rebuilt from disk. */
  holdAt: number | null;
}

/** Where every clip sits in one track, in track order. */
export interface TrackLayout {
  sampleRate: number;
  /** The whole track's length in samples (board duration + every hold). */
  samples: number;
  clips: readonly TrackClip[];
}

/** The on-disk sidecar the mixer writes beside the track audio. */
export interface TrackManifest extends TrackLayout {
  /** Track audio, relative to the content set (like `NarrationClip.file`). */
  file: string;
}

export interface TrackManifestRead {
  manifest: TrackManifest | null;
  /**
   * null when the sidecar is absent OR fully valid. A MISSING sidecar is
   * the documented "no track" state and falls back silently to per-clip
   * playback; a MALFORMED one must not hide behind that silence.
   */
  issue: string | null;
}

/**
 * How far a recorded clip position may sit from the position the live
 * board computes before the track counts as stale.
 *
 * Both numbers come from the SAME function over the same windows, so a
 * fresh track agrees to float noise (nanoseconds); the budget exists only
 * so a recompile that reorders a float summation cannot condemn a good
 * file. It is deliberately far below anything an ear pairs with a moving
 * pen — 50 ms is under a single frame of handwriting — so nothing audible
 * can pass as agreement.
 */
export const TRACK_ALIGN_TOLERANCE = 0.05;

/**
 * Lay every clip window into one wall-clock track.
 *
 * `boardDuration` is the compiled timeline's duration: the track has to be
 * at least that long (the silence after the last word is part of the
 * lecture), and at least long enough to hold every clip's tail — a final
 * clip has no `holdAt` yet still plays out over the board's end pin.
 */
export function layOutTrack(
  windows: readonly ClipWindow[],
  boardDuration: number,
  sampleRate: number,
): TrackLayout {
  const ordered = [...windows].sort((a, b) => a.start - b.start);
  const clips: TrackClip[] = [];
  /** Wall seconds already spent at pins — the running canonical → track gap. */
  let gap = 0;
  let end = 0;
  for (const w of ordered) {
    const trackStart = w.start + gap;
    const offset = Math.round(trackStart * sampleRate);
    const samples = Math.round(w.audioSeconds * sampleRate);
    clips.push({
      hash: w.hash,
      offset,
      samples,
      start: w.start,
      holdAt: w.holdAt,
    });
    end = Math.max(end, offset + samples);
    if (w.holdAt !== null) gap += Math.max(0, w.audioEnd - w.holdAt);
  }
  const floor = Math.round(Math.max(0, boardDuration + gap) * sampleRate);
  return { sampleRate, samples: Math.max(floor, end), clips };
}

/** The clip whose voice occupies track second `tt`, or null in silence. */
export function clipAtTrackTime(
  layout: TrackLayout,
  tt: number,
): TrackClip | null {
  if (!Number.isFinite(tt)) return null;
  const sample = tt * layout.sampleRate;
  // Clips are laid in ascending, non-overlapping order — binary search
  // keeps the per-frame lookup off the hot path's conscience.
  let lo = 0;
  let hi = layout.clips.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const clip = layout.clips[mid]!;
    if (sample < clip.offset) hi = mid - 1;
    else if (sample >= clip.offset + clip.samples) lo = mid + 1;
    else return clip;
  }
  return null;
}

/**
 * Where canonical second `t` sits in the track.
 *
 * Inside a clip's canonical domain the answer is that clip's own placement
 * (so a scrub into the middle of a held clip lands mid-word, exactly where
 * per-clip playback would have seeked to); everywhere else it is `t` plus
 * the holds that have already completed. The two branches meet exactly at
 * the end of a hold — pinned canonical `holdAt` plus the tail IS the
 * clip's last sample — which is what keeps the handover silent.
 */
export function canonicalToTrack(layout: TrackLayout, t: number): number {
  if (!Number.isFinite(t)) return 0;
  let gap = 0;
  let owner: TrackClip | null = null;
  for (let i = 0; i < layout.clips.length; i++) {
    const clip = layout.clips[i]!;
    const audioEnd = clip.start + clip.samples / layout.sampleRate;
    const domainEnd = clip.holdAt !== null ? clip.holdAt : audioEnd;
    // Later clips win a shared boundary instant, matching `activeClipAt`:
    // the last clip whose domain contains `t` is the one that owns it.
    if (t >= clip.start && t <= domainEnd) owner = clip;
    if (clip.holdAt !== null && clip.holdAt < t) {
      gap += Math.max(0, audioEnd - clip.holdAt);
    }
  }
  if (owner) return owner.offset / layout.sampleRate + (t - owner.start);
  return t + gap;
}

// ── The on-disk sidecar ─────────────────────────────────────────────────────

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Tolerant reader for `narration/track.json`, with ONE deliberate
 * difference from `readNarrationManifest`: a bad clip entry rejects the
 * whole manifest instead of being dropped. Per-clip entries are
 * independent — one typo mutes one step — but a track's positions are only
 * meaningful as a complete sequence, and a layout missing an entry would
 * verify as stale anyway. Rejecting says why.
 */
export function readTrackManifest(
  raw: string | null | undefined,
): TrackManifestRead {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { manifest: null, issue: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      manifest: null,
      issue: `narration/track.json is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { manifest: null, issue: "narration/track.json must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.file !== "string" || obj.file.length === 0) {
    return {
      manifest: null,
      issue: 'narration/track.json needs a "file" naming the mixed audio',
    };
  }
  if (!isPositive(obj.sampleRate) || !isPositive(obj.samples)) {
    return {
      manifest: null,
      issue:
        'narration/track.json needs positive "sampleRate" and "samples" numbers',
    };
  }
  if (!Array.isArray(obj.clips)) {
    return {
      manifest: null,
      issue:
        'narration/track.json needs a "clips" array (hash, offset, samples, start, holdAt)',
    };
  }
  const clips: TrackClip[] = [];
  for (const [i, value] of obj.clips.entries()) {
    const clip = value as Partial<TrackClip> | null;
    if (
      typeof clip !== "object" ||
      clip === null ||
      typeof clip.hash !== "string" ||
      clip.hash.length === 0 ||
      typeof clip.offset !== "number" ||
      !Number.isFinite(clip.offset) ||
      clip.offset < 0 ||
      !isPositive(clip.samples) ||
      typeof clip.start !== "number" ||
      !Number.isFinite(clip.start) ||
      clip.start < 0 ||
      !(clip.holdAt === null || isPositive(clip.holdAt))
    ) {
      return {
        manifest: null,
        issue: `narration/track.json clip #${i + 1} is unusable (needs hash, offset ≥ 0, positive samples, start ≥ 0, holdAt null-or-positive) — re-run the mixer`,
      };
    }
    clips.push({
      hash: clip.hash,
      offset: clip.offset,
      samples: clip.samples,
      start: clip.start,
      holdAt: clip.holdAt,
    });
  }
  return {
    manifest: {
      file: obj.file,
      sampleRate: obj.sampleRate,
      samples: obj.samples,
      clips,
    },
    issue: null,
  };
}

/** Whether a recorded track still describes the board that is on screen. */
export interface TrackVerdict {
  ok: boolean;
  /** Why not — one sentence naming the first disagreement. `null` when ok. */
  reason: string | null;
}

/**
 * Verify a recorded layout against the one the LIVE compile produces.
 * This is the whole safety story for a globally aligned track: the file is
 * evidence, the board is truth, and they must still agree.
 */
export function verifyTrack(
  manifest: TrackLayout,
  live: TrackLayout,
  tolerance = TRACK_ALIGN_TOLERANCE,
): TrackVerdict {
  if (manifest.sampleRate !== live.sampleRate) {
    return {
      ok: false,
      reason: `the track was mixed at ${manifest.sampleRate} Hz and the board now lays out at ${live.sampleRate} Hz`,
    };
  }
  if (manifest.clips.length !== live.clips.length) {
    return {
      ok: false,
      reason: `the track holds ${manifest.clips.length} clip(s) and the board now has ${live.clips.length}`,
    };
  }
  const slack = tolerance * live.sampleRate;
  for (const [i, recorded] of manifest.clips.entries()) {
    const current = live.clips[i]!;
    if (recorded.hash !== current.hash) {
      return {
        ok: false,
        reason: `clip #${i + 1} in the track is ${recorded.hash} and the board now wants ${current.hash} there`,
      };
    }
    if (Math.abs(recorded.offset - current.offset) > slack) {
      const drift = (current.offset - recorded.offset) / live.sampleRate;
      return {
        ok: false,
        reason: `clip ${recorded.hash} sits ${drift.toFixed(2)}s away from where the board now performs it`,
      };
    }
  }
  return { ok: true, reason: null };
}
