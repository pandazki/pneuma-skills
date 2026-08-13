/**
 * The narration action responses (T10) — pure builders for what `narrate`
 * and `subtitles` answer, kept out of the component so the agent-facing
 * shapes are pinned by tests instead of read off a runner nobody exercises
 * (the same split as `board-check.ts` for `check-board`).
 *
 * The one path rule both builders enforce: a manifest's `file` field is
 * relative to the CONTENT SET (`NarrationClip.file` contract), while
 * anything the agent passes to a CLI or writes with a tool is relative to
 * the WORKSPACE. The two must never be conflated — handing the agent a
 * set-prefixed string for a manifest field is how `tech-zh/tech-zh/…`
 * compounds one prefix per call — so every step answer carries BOTH,
 * under names that say which is which: `file` (manifest value, echoed
 * verbatim) and `output` (workspace path for synthesis).
 */

import type { ViewerActionResult } from "../../../core/types/viewer-contract.js";
import type { Lecture, StepSchedule } from "../engine/types.js";
import { buildNarrationPlan } from "../narration/plan.js";
import { narrationCues, toSrt, toVtt } from "../narration/subtitles.js";
import type { ClipWindow } from "../narration/timing.js";
import {
  TRACK_SAMPLE_RATE,
  layOutTrack,
  type TrackClip,
} from "../narration/track.js";
import type {
  NarrationClip,
  NarrationManifestRead,
} from "../narration/types.js";
import { toAddress } from "./address.js";

/** Workspace-relative path for a set-relative one (`""` = the root set). */
function inSet(setKey: string, rel: string): string {
  return setKey === "" ? rel : `${setKey}/${rel}`;
}

/**
 * The file-existence channel (R2-F4 / T10-4): manifest "ready" used to be
 * pure hash membership, so an entry whose .wav was deleted or never
 * written still re-paced the writing and — once the conductor landed —
 * "played" silence. The runner probes each recorded clip's WORKSPACE path
 * before answering `narrate`; a hash lands in the returned set only on a
 * CONFIRMED miss (`missing` resolves true — in production, an `/api/file`
 * 404). A probe that cannot answer (network error, server down) accuses
 * nothing: unknown existence must not re-bill a clip that may be fine.
 */
export async function probeMissingClips(
  clips: Readonly<Record<string, NarrationClip>>,
  setKey: string,
  missing: (workspacePath: string) => Promise<boolean>,
): Promise<Set<string>> {
  const verdicts = await Promise.all(
    Object.entries(clips).map(async ([hash, clip]) => {
      try {
        return { hash, missing: await missing(inSet(setKey, clip.file)) };
      } catch {
        return { hash, missing: false }; // cannot answer ≠ missing
      }
    }),
  );
  return new Set(verdicts.filter((v) => v.missing).map((v) => v.hash));
}

/**
 * What the board knows about its PRE-MIXED track when `narrate` is asked
 * (T10-5). The host owns all of it — the compiled windows, the board's
 * duration, and the verdict it already reached on any recorded sidecar —
 * because only the live compile has the measured schedule the mix must be
 * laid against.
 */
export interface NarrationTrackState {
  /** The compile's clip windows, in start order. */
  windows: readonly ClipWindow[];
  /** The compiled board's duration in canonical seconds. */
  duration: number;
  /**
   * `absent` — no sidecar. `verified` — the recorded track still matches
   * this board and is what the user is hearing. `refused` — a sidecar
   * exists but the board would not play it, with `reason` saying why
   * (stale layout, or a malformed file).
   */
  state: "absent" | "verified" | "refused";
  reason?: string | null;
}

/**
 * The mixer's whole input: where every clip's audio is, and where it
 * belongs in the finished track. Paths are WORKSPACE-relative (`source`,
 * `track`, `manifest`) except `file`, which is the set-relative value the
 * sidecar records — the same two-name discipline the per-clip answer uses.
 */
interface TrackMixPlan {
  sampleRate: number;
  samples: number;
  file: string;
  track: string;
  manifest: string;
  clips: (TrackClip & { source: string })[];
}

function buildMixPlan(
  clips: Readonly<Record<string, NarrationClip>>,
  setKey: string,
  track: NarrationTrackState,
): TrackMixPlan | null {
  const layout = layOutTrack(track.windows, track.duration, TRACK_SAMPLE_RATE);
  if (layout.clips.length === 0) return null;
  const placed: (TrackClip & { source: string })[] = [];
  for (const clip of layout.clips) {
    const recorded = clips[clip.hash];
    if (!recorded) return null; // a window with no file cannot be mixed
    placed.push({ ...clip, source: inSet(setKey, recorded.file) });
  }
  return {
    sampleRate: layout.sampleRate,
    samples: layout.samples,
    file: "narration/track.mp3",
    track: inSet(setKey, "narration/track.mp3"),
    manifest: inSet(setKey, "narration/track.json"),
    clips: placed,
  };
}

/**
 * `narrate` — the voice-over plan. The agent cannot compute step cache
 * keys itself (an installed skill cannot import the engine), so the board
 * answers with everything: per step the address, the key, the suggested
 * spoken line, the manifest `file` value with its workspace `output` twin,
 * and freshness; plus orphaned clips and — crucially — a malformed
 * manifest's parse reason, which must never hide behind the "no manifest,
 * no voice" silence.
 */
export function narrateResponse(
  lecture: Lecture,
  read: NarrationManifestRead | null,
  setKey: string,
  /** Confirmed-absent clip hashes (`probeMissingClips`) — never guesses. */
  missing: ReadonlySet<string> = new Set(),
  /** The board's pre-mixed track situation (T10-5); omitted = no track path. */
  track?: NarrationTrackState,
): ViewerActionResult {
  const plan = buildNarrationPlan(lecture, read?.manifest ?? null, missing);
  const needsAudio = plan.entries.filter((e) => e.status === "needs-audio");
  // Silent formulas are listed (their cache keys must be obtainable here
  // — M5) but never owed a clip, so the speakable counts exclude them.
  const silent = plan.entries.filter((e) => e.status === "silent");
  const speakable = plan.entries.length - silent.length;
  const parts = [
    `${speakable - needsAudio.length} of ${speakable} speakable steps have a fresh clip; ${needsAudio.length} need audio.`,
  ];
  if (silent.length > 0) {
    parts.push(
      `${silent.length} formula step(s) are silent by default — to voice one, write the spoken line yourself, synthesize it to that step's "output", and record it under the step's key (status "silent" in steps[]).`,
    );
  }
  const missingLive = plan.entries.filter((e) => missing.has(e.hash));
  if (missingLive.length > 0) {
    parts.push(
      `${missingLive.length} recorded clip(s) are missing on disk (the manifest entry exists but the audio file does not) — re-synthesize each to its "output" path; the manifest entry is already correct.`,
    );
  }
  if (plan.orphans.length > 0) {
    parts.push(
      `${plan.orphans.length} recorded clip(s) no longer match any step — safe to delete.`,
    );
  }
  if (read?.issue) parts.push(`Manifest problem: ${read.issue}`);
  // The track (T10-5). Mixing is worth doing only once every clip is
  // fresh — a remix after one more sentence is the whole file again — so
  // the plan is offered, and pressed for, at exactly that moment.
  const mixPlan =
    track && needsAudio.length === 0 && missingLive.length === 0
      ? buildMixPlan(read?.manifest?.clips ?? {}, setKey, track)
      : null;
  if (track?.state === "refused") {
    parts.push(
      `The mixed narration track was NOT played: ${track.reason ?? "it no longer matches this board"}. The clips played one at a time instead (which swallows the first syllable of each) — re-mix from data.track.plan.`,
    );
  } else if (track?.state === "verified") {
    parts.push("The mixed narration track matches this board and is what plays.");
  }
  if (mixPlan) {
    parts.push(
      `Every clip is fresh, so fuse them: save data.track.plan verbatim to a file and run scripts/mix-narration.mjs --plan <that file> --json. It writes ${mixPlan.track} plus the layout sidecar ${mixPlan.manifest}, and the board then plays ONE continuous element instead of starting each clip cold. Re-mix whenever the board changes — the board verifies the layout and refuses a track that has moved.`,
    );
  }
  parts.push(
    // Every field `readNarrationManifest` REQUIRES is named here. An
    // entry missing any one of them is dropped by the reader and reported
    // back as an unusable clip — so an agent that follows this sentence
    // literally must end up with a valid entry, or the instruction is the
    // bug (it named only "file", and a text-less entry silently lost its
    // voice).
    `Synthesize each needs-audio step with scripts/generate-tts.mjs --json --output <the step's "output">, then record it under "clips" in ${inSet(setKey, "narration/manifest.json")} keyed by the step's "key", with all three fields: "file" (the step's "file" verbatim — manifest paths stay relative to the content set), "seconds" (copied from the --json output), and "text" (what you actually had spoken). See references/narration.md.`,
  );
  return {
    success: true,
    message: parts.join(" "),
    data: {
      manifest: inSet(setKey, "narration/manifest.json"),
      ...(read?.manifest?.voice ? { voice: read.manifest.voice } : {}),
      ...(read?.manifest?.style ? { style: read.manifest.style } : {}),
      ...(read?.manifest?.language
        ? { language: read.manifest.language }
        : {}),
      ...(read?.issue ? { manifestIssue: read.issue } : {}),
      steps: plan.entries.map((e) => ({
        address: toAddress(e.ref),
        key: e.hash,
        text: e.text,
        /** The manifest `file` value — set-relative, use verbatim. */
        file: e.file,
        /** Where to write the audio — workspace-relative, for the CLI. */
        output: inSet(setKey, e.file),
        status: e.status,
      })),
      /** Confirmed-absent clip hashes — their steps read needs-audio above. */
      missing: missingLive.map((e) => e.hash),
      orphans: plan.orphans,
      ...(track
        ? {
            track: {
              state: track.state,
              ...(track.reason ? { reason: track.reason } : {}),
              ...(mixPlan ? { plan: mixPlan } : {}),
            },
          }
        : {}),
    },
  };
}

/**
 * `subtitles` — the lecture as finished SRT / VTT text, so the agent saves
 * it verbatim and never computes a cue time itself. `narration` is the
 * compile's applied clip windows (`CompiledBoard.narration`): a voiced
 * cue spans its clip's audio window, an unvoiced cue its schedule window
 * (see `narrationCues`). Needs no narration manifest: cue text falls back
 * to each step's written words, and every cue is then a pen window.
 */
export function subtitlesResponse(
  lecture: Lecture,
  schedule: readonly StepSchedule[],
  read: NarrationManifestRead | null,
  setKey: string,
  narration: readonly ClipWindow[] = [],
): ViewerActionResult {
  const cues = narrationCues(
    lecture,
    schedule,
    read?.manifest ?? null,
    narration,
  );
  if (cues.length === 0) {
    return {
      success: true,
      message:
        "The board has no steps with anything to say yet — nothing to caption.",
      data: { cues: 0 },
    };
  }
  const save = {
    srt: inSet(setKey, "subtitles.srt"),
    vtt: inSet(setKey, "subtitles.vtt"),
  };
  return {
    success: true,
    message: `${cues.length} cue(s) — voiced steps are timed off their clip's audio window, unvoiced steps off the board's writing. Save data.srt to ${save.srt} (or data.vtt to ${save.vtt}) verbatim — never retime a cue yourself.`,
    data: {
      cues: cues.length,
      srt: toSrt(cues),
      vtt: toVtt(cues),
      save,
    },
  };
}
