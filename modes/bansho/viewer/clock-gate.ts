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
 *  6. **Above `NARRATION_MAX_RATE` the voice steps aside** — the reader is
 *     skimming, not listening, and rule 5 stops being available: browsers
 *     do not agree on what `playbackRate = 16` means (clamped, silently
 *     ignored, or honoured but muted), and an element that quietly kept
 *     ITS speed while the board asked for sixteen would drag the picture
 *     back to walking pace through the projection — with a long clip's
 *     hold (rule 4) that is a board waiting on a voice that cannot finish.
 *     So past the threshold the gate refuses engagement outright: rAF is
 *     master, no pin binds, and 16× means sixteen. This is rule 1 again
 *     ("silence is structural"), reached by the transport rather than by a
 *     failure. The element-side half — actually stopping the sound, and
 *     never handing it a rate no browser promises — is the conductor's.
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
 * The fastest playback rate a recorded voice still accompanies the board
 * (rule 6). Four is where `HTMLMediaElement` stops being dependable:
 * Chromium's time-stretcher covers roughly [0.5, 4] and outputs silence
 * outside it, other engines clamp or ignore the assignment entirely. Past
 * it the board is being skimmed rather than listened to, so the honest
 * answer is a silent picture at exactly the rate that was asked for.
 */
export const NARRATION_MAX_RATE = 4;

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
    // Rule 6 — a skimming reader has no voice. Checked here and not only
    // in the conductor so the RULE holds whatever an element claims: a
    // snapshot still reporting `sounding` at 16× (a browser that ignored
    // the rate, a frame in flight across the change) can never take the
    // clock.
    s.rate <= NARRATION_MAX_RATE &&
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
