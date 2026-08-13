/**
 * Narration timing (T10) — the G3 hook the viewer hands to `buildTimeline`,
 * and the audio windows / hold points the conductor plays against.
 *
 * The hook RECORDS what it applied while the scheduler runs (hash, audio
 * length, applied footprint, per step). That record is how the audio
 * window is recovered EXACTLY afterwards: timeline.ts lays a narrated
 * step's footprint so that `lastEntry.end = footprintStart + footprint`,
 * so `footprintStart = lastEnd − footprint` — the voice starts there,
 * scaled leading pen-lift included, precisely as the G3 contract words it
 * ("the pen's travel is part of the performance it covers"). No timeline
 * arithmetic is duplicated; the record is the applier's own math read
 * back. A record is per-compile state: build a fresh hook for every
 * `buildTimeline` call, then read `applied` — never reuse across compiles.
 *
 * Determinism (R8) is untouched: recording does not alter what the hook
 * returns, and the returned footprint is a pure function of the manifest
 * number and the natural footprint.
 */

import { stepContentHash } from "../engine/text.js";
import type {
  ScheduleContext,
  StepRef,
  StepSchedule,
} from "../engine/types.js";
import { stepKey } from "../viewer/address.js";
import { narratedFootprint, type NarrationManifest } from "./types.js";

/** What the hook applied for one narrated step, keyed by `stepKey(ref)`. */
export interface AppliedNarration {
  hash: string;
  audioSeconds: number;
  /** The override handed to the scheduler (already clamped). */
  footprint: number;
}

export interface NarrationHook {
  durationOverride: NonNullable<ScheduleContext["durationOverride"]>;
  /** Populated by the `buildTimeline` run this hook was handed to. */
  applied: Map<string, AppliedNarration>;
}

/**
 * Build the per-compile override hook, or null when there is nothing to
 * narrate — the caller then omits `durationOverride` entirely and the
 * schedule is byte-identical to the silent board (the degradation
 * guarantee: no key, no manifest, no clips → natural playback).
 */
export function createNarrationHook(
  source: string,
  manifest: NarrationManifest | null,
): NarrationHook | null {
  if (!manifest || Object.keys(manifest.clips).length === 0) return null;
  const applied = new Map<string, AppliedNarration>();
  return {
    applied,
    durationOverride: (step, ref, naturalFootprint) => {
      const hash = stepContentHash(step, source);
      const clip = manifest.clips[hash];
      if (!clip) return undefined;
      // Zero-footprint steps cannot be scaled — the scheduler ignores the
      // override there (timeline.ts guard); do not record what was not
      // applied, or the window math below would invent an audio cue for a
      // step that keeps its zero-length layout.
      if (naturalFootprint <= 0) return undefined;
      const footprint = narratedFootprint(clip.seconds, naturalFootprint);
      applied.set(stepKey(ref), {
        hash,
        audioSeconds: clip.seconds,
        footprint,
      });
      return footprint;
    },
  };
}

// ── Audio windows ───────────────────────────────────────────────────────────

/** One clip's place on the canonical timeline. */
export interface ClipWindow {
  ref: StepRef;
  hash: string;
  /** Canonical second the voice starts (the step's footprint start). */
  start: number;
  /** `start + audioSeconds` — where the voice actually ends. */
  audioEnd: number;
  audioSeconds: number;
  /**
   * Canonical second the clock must not pass while this clip is still
   * sounding: the next pen-down after the step (start of the first
   * schedule entry past the step's last). `null` when the voice fits
   * before it, or when nothing follows — a final clip's tail simply plays
   * out past the board's duration.
   */
  holdAt: number | null;
}

/**
 * Resolve every applied narration to its exact audio window on a compiled
 * schedule. Windows are returned in start order; on a serial timeline with
 * per-step clips they never overlap except through a hold, which is
 * exactly the case `holdAt` names.
 */
/**
 * A window boundary and the schedule value it names are the SAME number
 * reached by different float summations; below this they are one value.
 * (Far below any perceptual or scheduling scale, far above f64 noise.)
 */
const BOUNDARY_NOISE = 1e-6;

export function clipWindows(
  schedule: readonly StepSchedule[],
  applied: ReadonlyMap<string, AppliedNarration>,
): ClipWindow[] {
  // One pass: first/last entry index per step key.
  const lastEnd = new Map<string, number>();
  const firstIndex = new Map<string, number>();
  const lastIndex = new Map<string, number>();
  schedule.forEach((entry, i) => {
    const key = stepKey(entry.step);
    const end = lastEnd.get(key);
    if (end === undefined || entry.end > end) lastEnd.set(key, entry.end);
    if (!firstIndex.has(key)) firstIndex.set(key, i);
    lastIndex.set(key, i);
  });

  const windows: ClipWindow[] = [];
  for (const [key, record] of applied) {
    const end = lastEnd.get(key);
    const last = lastIndex.get(key);
    if (end === undefined || last === undefined) continue; // not scheduled
    let start = end - record.footprint;
    // The scheduler stretches a narrated step's entries to fill the
    // footprint, so `end − footprint` and the step's first pen-down are
    // the same instant reached by different summations. Snap them EXACTLY
    // equal: ownership at a shared boundary (this window's start IS the
    // previous window's holdAt when the steps are adjacent) must not be
    // decided by which side of the pen-down float noise happens to land
    // on. A genuine leading pen-lift (footprint laid wider than the
    // entries) is far above the noise bound and is preserved.
    const first = schedule[firstIndex.get(key)!]!;
    if (Math.abs(start - first.start) <= BOUNDARY_NOISE) start = first.start;
    const audioEnd = start + record.audioSeconds;
    const next = schedule[last + 1];
    const holdAt =
      next !== undefined && audioEnd > next.start ? next.start : null;
    const entry = schedule[last]!;
    windows.push({
      ref: entry.step,
      hash: record.hash,
      start,
      audioEnd,
      audioSeconds: record.audioSeconds,
      holdAt,
    });
  }
  windows.sort((a, b) => a.start - b.start);
  return windows;
}

/**
 * The window whose voice should be sounding at canonical time `t`.
 *
 * A held window's audible domain is `[start, holdAt]` — inclusive at the
 * hold, because the pinned frame IS the hold (the voice finishing over a
 * stationary pen). The tail beyond `holdAt` plays over the PIN — wall
 * clock spent at one canonical instant — so it occupies no canonical
 * seconds: any `t` past the pen-down is the NEXT step's writing, where
 * this voice must never sound (G1 at runtime — one step's voice may not
 * accompany another step's moving pen; scrubbing past the hold skips the
 * tail, it does not relocate it). An unheld window's domain is
 * `[start, audioEnd)` as laid.
 *
 * Later windows win the one instant two domains can share (a hold's
 * pen-down that is also the next voiced window's start): positioned there
 * cold, the NEW step's voice takes the board. The conductor's sticky hold
 * (audio-conductor.ts) is the runtime half that lets a clip already
 * sounding at that instant finish first.
 */
export function activeClipAt(
  windows: readonly ClipWindow[],
  t: number,
): ClipWindow | null {
  if (!Number.isFinite(t)) return null;
  for (let i = windows.length - 1; i >= 0; i--) {
    const w = windows[i]!;
    if (t < w.start) continue;
    if (w.holdAt !== null ? t <= w.holdAt : t < w.audioEnd) return w;
  }
  return null;
}
