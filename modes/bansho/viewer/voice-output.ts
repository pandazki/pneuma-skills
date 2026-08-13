/**
 * The voice OUTPUT seam — the listener's mute, kept deliberately apart
 * from `NarrationClock`.
 *
 * The board has two narration paths (`track-conductor.ts` over one
 * pre-mixed file, `audio-conductor.ts` clip at a time) and both are
 * clocks: `clock-gate.ts` projects the canonical playhead from whichever
 * one is sounding, so a long clip HOLDS the pen until its voice finishes
 * (gate rule 4). Muting must not touch any of that. A muted lecture and an
 * unmuted one are the same lecture: same schedule, same pacing, same pen
 * position at every instant — only the speaker is off.
 *
 * That is why mute is its own interface rather than a sixth method on
 * `NarrationClock`, and why the mechanism underneath is the element's
 * `muted` flag and never `pause()`:
 *
 *  - `muted` is an OUTPUT-STAGE property. `currentTime` keeps advancing,
 *    `paused` stays false, so the per-frame snapshot still reports
 *    `sounding` and the gate stays engaged with its pins intact.
 *  - `pause()` would stop the element's clock. The gate would fall back to
 *    rAF, the hold would stop binding, and a step whose voice runs 40
 *    seconds over a one-line sentence would suddenly race past — muting
 *    would silently become a different lecture. (`mute-seam.test.ts` pins
 *    the trajectory equality that forbids exactly this.)
 *
 * Both conductors implement `VoiceOutput`; the host drives them through it
 * and never has to know which path currently owns the voice.
 */

/**
 * The listener's silence, applied to whatever element a voice path owns.
 *
 * Implementors must be idempotent (setting the same value twice is free),
 * must survive a lazily created element (an element born after the choice
 * is born muted), and must never change the element's playback state — the
 * clock is not theirs to stop.
 */
export interface VoiceOutput {
  setMuted(muted: boolean): void;
}

/**
 * Where the choice is remembered. Part of the persistence contract — keep
 * stable (renaming it silently un-mutes every reader who had chosen
 * silence).
 *
 * localStorage, browser-global, is the RIGHT level and the level the
 * script drawer's open posture already uses (`bansho:script-open`):
 * whether the voice plays is a fact about the listening environment — the
 * headphones are off, the room is shared, someone is asleep next door —
 * not about the lecture, the session, or what the author meant. It
 * therefore belongs to the browser and follows the person to the next
 * board, and it deliberately stays OUT of `session.json` and
 * `.pneuma/preferences/`, which are content the agent reads and rewrites.
 * The agent has no business learning that you like your lectures silent.
 */
export const VOICE_MUTED_LS_KEY = "bansho:voice-muted";

/**
 * The remembered choice. Sound is the default: a board that opens silent
 * without having been asked to is the degradation this whole layer exists
 * to avoid, so anything other than an explicit "1" means unmuted —
 * including storage that throws (private mode, storage disabled).
 */
export function readVoiceMuted(): boolean {
  try {
    return window.localStorage.getItem(VOICE_MUTED_LS_KEY) === "1";
  } catch {
    // A remembered preference is a nicety; losing it must never cost the
    // transport the control itself.
    return false;
  }
}

export function writeVoiceMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(VOICE_MUTED_LS_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable — the session keeps the choice in memory */
  }
}
