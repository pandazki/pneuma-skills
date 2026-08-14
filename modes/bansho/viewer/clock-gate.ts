/**
 * The clock gate (T10-4) — who owns the canonical clock, frame by frame.
 *
 * There is ONE canonical timeline and ONE playhead `t`; audio adds no
 * second one (the T10 hard rule). What it adds is a second CANDIDATE
 * MASTER for the existing clock:
 *
 *  1. **rAF is the default master** — `tick(s, dt)` accumulates wall-clock
 *     dt × rate, exactly as the silent board always has. Every degradation
 *     lands here: no narration, no clip for this step, file missing or
 *     failed to load, autoplay blocked, clip already finished. Silence is
 *     structural, never an error path.
 *  2. **The sounding clip is master inside its window** — while playback
 *     is on, the playhead sits inside a clip's audible window
 *     (`activeClipAt`), and that clip's element is actually advancing, the
 *     canonical playhead is a PROJECTION of the element's own clock:
 *     `t = window.start + audio.time`. The rAF dt never leaks in. This is
 *     what kills drift: rAF accumulation and the audio hardware clock are
 *     different oscillators, and following one with the other diverges;
 *     projecting one FROM the other cannot.
 *  3. **Handovers are smooth by construction.** At engagement the AUDIO is
 *     aligned to the picture (the conductor seeks the element to
 *     `t − window.start` before playing) — the picture never jumps to the
 *     audio. At release (clip ended) rAF resumes from the exact t the
 *     projection last produced. Between the two, `t` is monotonic: an
 *     element that lags the picture (play() latency, a buffering stall)
 *     FREEZES the picture until the sound catches up — audio master means
 *     the picture waits for the voice, and a short freeze is a wait, while
 *     a rewind would be a visible glitch.
 *  4. **One pin rule, two places**: the canonical clock never passes a
 *     pen-down (`window.holdAt`) or the board's end (`duration`) while the
 *     clip is still sounding. The hold is how a voice longer than its
 *     writing finishes over a stationary pen (types.ts clamp rationale);
 *     the end pin is the same rule for the final clip's tail — playback
 *     does not report end-of-media until the last word lands.
 *  5. **Rate lives on the element** (`audio.playbackRate = rate`), so both
 *     masters scale identically and the gate compares canonical seconds
 *     only — it never multiplies by rate itself (that would double-apply).
 *  6. **Outside `NARRATION_RATE_BAND` the voice steps aside** — rule 5
 *     stops being available. Rate lives on the element, and a recorded
 *     voice only survives being stretched over a narrow neighbourhood of
 *     1×: browsers do not agree on what `playbackRate = 16` means
 *     (clamped, silently ignored, or honoured but muted), and even where
 *     the time-stretcher nominally works, a lecture read at 2× is not a
 *     lecture being listened to. An element that quietly kept ITS speed
 *     while the board asked for more would drag the picture back to
 *     walking pace through the projection — with a long clip's hold (rule
 *     4) that is a board waiting on a voice that cannot finish. So outside
 *     the band the gate refuses engagement outright: rAF is master, no pin
 *     binds, and 2× means two. This is rule 1 again ("silence is
 *     structural"), reached by the transport rather than by a failure.
 *     The band is closed at BOTH ends on purpose — 0.75× is studying a
 *     single stroke land, not listening to a sentence, and a voice
 *     dragged below 1× is the same unreliable stretch in the other
 *     direction. The element-side half is the conductors': outside the
 *     band they do not merely go quiet, they let the element GO (see
 *     `audio-conductor.ts` / `track-conductor.ts`) — a voice that will
 *     not be heard is not worth a download or a decoder.
 *
 * Pure and host-free: the DOM element lives behind `NarrationClock`
 * (implemented by `audio-conductor.ts`); this module only projects its
 * per-frame snapshot. Same hot-path discipline as `tick`: a frame that
 * changes nothing returns the IDENTICAL state object so the hook skips
 * `apply` entirely.
 */

import type { ClipWindow } from "../narration/timing.js";
import { tick, type PlayerState } from "./player-core.js";

/**
 * The rates at which a recorded voice still accompanies the board (rule
 * 6), inclusive at both ends.
 *
 * Narrow, and deliberately so. `playbackRate` is the only mechanism that
 * can keep sound and picture on one clock (rule 5), and it buys less than
 * it appears to: Chromium's time-stretcher nominally covers [0.5, 4] but
 * degrades audibly well before either edge, and other engines clamp or
 * ignore the assignment entirely. Past a small neighbourhood of 1× the
 * honest answer is not a worse voice — it is no voice, and a picture
 * running at exactly the speed that was asked for.
 *
 * Both edges are closed for the same reason read in two directions: above
 * the band the lecture is being SKIMMED, below it a single stroke is being
 * STUDIED (`player-core.ts` argues the ladder's two jobs). Neither is
 * listening, and neither is a speed a stretched voice survives.
 */
export const NARRATION_RATE_BAND = { min: 1, max: 1.5 } as const;

/**
 * Whether a recorded voice accompanies the board at `rate` — the ONE
 * definition of rule 6's threshold.
 *
 * Both conductors and the gate ask this same question, and they must
 * never be able to disagree: the conductors decide whether an element
 * exists at all, the gate decides whether a snapshot may take the clock,
 * and a gate that trusted a rate the conductors had written off would let
 * a stale in-flight frame drive the picture. One predicate, three callers.
 */
export function narrationAudibleAtRate(rate: number): boolean {
  return rate >= NARRATION_RATE_BAND.min && rate <= NARRATION_RATE_BAND.max;
}

/** What the host read off the sounding element, one snapshot per frame. */
export interface AudioClockSnapshot {
  /** Content hash of the clip the element has loaded. */
  hash: string;
  /** The element's own clock — seconds into the clip. */
  time: number;
  /** Actually advancing: playing, not paused/blocked/failed. */
  sounding: boolean;
  /** The clip ran to its end (spent until an explicit seek re-arms it). */
  ended: boolean;
}

/**
 * The seam `useBoardPlayer` drives. `null` narration keeps the hook
 * byte-identical to the silent player; `audio-conductor.ts` is the one
 * production implementor.
 */
export interface NarrationClock {
  /**
   * Once per rAF frame while playing: keep the right clip loaded/sounding
   * for playhead `t`, and report the active window plus the element facts
   * the gate projects from. `dt` is wall-clock seconds since the previous
   * frame — the stall detector's measure (an element that claims to play
   * while its clock stands still must not freeze the projection forever);
   * omitted it defaults to 0, "no wall time passed" (probes, not
   * playback).
   */
  frame(
    t: number,
    rate: number,
    dt?: number,
  ): { window: ClipWindow | null; audio: AudioClockSnapshot | null };
  /**
   * Explicit navigation (scrub / play-from / Live / replay jump): align
   * the AUDIO to the new playhead — never the picture to the audio — and
   * re-arm clips the seek moved back across. `playing: false` must stay
   * silent (a drag must not spray clip fragments).
   */
  seek(t: number, playing: boolean): void;
  /**
   * Resume after a plain pause (no playhead change): continue the element
   * from ITS OWN position. Deliberately not `seek(t, true)` — paused
   * mid-hold the element sits AHEAD of the pinned canonical clock, and
   * re-deriving its offset from t would replay voice already heard.
   */
  resume(t: number): void;
  pause(): void;
  setRate(rate: number): void;
}

/**
 * One frame of the gated clock. Replaces `tick` in the hook's rAF loop
 * when a narration clock is installed; with no sounding clip it IS
 * `tick(s, dt)`, so a silent board's playback is untouched.
 */
export function gatedTick(
  s: PlayerState,
  dt: number,
  window: ClipWindow | null,
  audio: AudioClockSnapshot | null,
): PlayerState {
  if (!s.playing || !Number.isFinite(dt) || dt <= 0) return s;

  const engaged =
    window !== null &&
    audio !== null &&
    // Rule 6 — outside the band there is no voice. Checked here and not
    // only in the conductor so the RULE holds whatever an element claims:
    // a snapshot still reporting `sounding` at 16× (a browser that ignored
    // the rate, a frame in flight across the change) can never take the
    // clock.
    narrationAudibleAtRate(s.rate) &&
    audio.hash === window.hash &&
    audio.sounding &&
    !audio.ended &&
    // G1 at runtime: past its own hold point a clip owns no canonical
    // time — the board there is the next step's writing, and this voice
    // does not belong over it. A snapshot claiming to sound there is
    // stale (the user scrubbed past the hold); rAF is master.
    (window.holdAt === null || s.t <= window.holdAt);
  if (!engaged) return tick(s, dt); // rule 1 — every degradation is the silent board

  // Rule 2 — project the element's clock onto the canonical timeline.
  const mapped = window.start + audio.time;

  // Rule 4 — the pin: never pass a pen-down or the board's end while
  // sounding (engagement above already guarantees s.t ≤ holdAt).
  let ceiling = s.duration;
  if (window.holdAt !== null && window.holdAt < ceiling) {
    ceiling = window.holdAt;
  }

  // Rule 3 — monotonic: a lagging element freezes t, never rewinds it.
  const t = Math.max(s.t, Math.min(mapped, ceiling));
  return t === s.t ? s : { ...s, t };
}
