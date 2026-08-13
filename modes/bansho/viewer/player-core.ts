/**
 * Player state machine (§7.2/§7.3) — the pure half of `useBoardPlayer`.
 *
 * The canonical timeline is the single temporal truth; this module owns
 * only the OBSERVER's state: playhead `t` (canonical seconds), play/pause,
 * follow mode, and playback rate. Rate scales the clock's `dt` and nothing
 * else — the canonical schedule and total duration are never touched
 * ("倍速不改总时长" is a transition-level invariant here, pinned by tests).
 *
 * Follow model (R2/R3/R7):
 *  - `live` (default): the playhead chases the content tip. Reaching the
 *    end is a HOLD, not an end-of-media — `playing` stays true, and when
 *    an append extends the canonical duration the same ticking resumes
 *    from the held position (自动续播, zero replay). The live playhead is
 *    never rewound by a timeline swap (R3: clamp, never回拨).
 *  - `detached`: the user owns the playhead (scrub / pause / play-from).
 *    Appends extend the duration but do not move the user's position.
 *
 * Pure transitions over immutable state — no rAF, no clocks (the hook
 * supplies `dt`), directly Bun-testable.
 */

export type FollowMode = "live" | "detached";

/**
 * The rate ladder, ascending. Two jobs on one scale: the slow end is for
 * STUDYING (0.75 — watch a single stroke land), the fast end is for
 * JUDGING (8, 16 — take in the shape of a five-minute wall in twenty
 * seconds). Nothing in between was removed; 1.25 and 1.5 are still the
 * rates you read a lecture at.
 *
 * The transport CHOOSES from this list rather than walking it (see
 * `Timeline.tsx`): eight rungs on a forward-only cycle is a chore, not a
 * control. Ordering and membership live here, once — every consumer reads
 * `RATES` instead of restating it.
 */
export const RATES = [0.75, 1, 1.25, 1.5, 2, 4, 8, 16] as const;
export type Rate = (typeof RATES)[number];

export interface PlayerState {
  /** Canonical playhead, seconds. Always within [0, duration]. */
  t: number;
  playing: boolean;
  rate: Rate;
  follow: FollowMode;
  /** Canonical total duration (BoardTimeline.duration) — never rate-scaled. */
  duration: number;
}

const clamp = (t: number, duration: number): number =>
  t < 0 ? 0 : t > duration ? duration : t;

/**
 * Initial state — LIVE JOIN: opening a board lands at the content tip
 * (like joining a live stream at "now"), not at 0, so history is never
 * replayed at the viewer's expense.
 *
 * `joinAtTip: false` covers the OTHER join: the workspace had no board
 * when the viewer hydrated, so the first compiled timeline is not history
 * — it is the broadcast itself, arriving live (R2). Playback starts from
 * its first character. The host latches this decision once, at workspace
 * hydration (see BanshoPreview).
 */
export function createPlayer(duration: number, joinAtTip = true): PlayerState {
  return {
    t: joinAtTip ? duration : 0,
    playing: true,
    rate: 1,
    follow: "live",
    duration,
  };
}

/**
 * One clock tick. `dt` is wall-clock seconds since the previous tick;
 * rate scales it here and ONLY here. In detached mode reaching the end
 * stops playback (end-of-media); in live mode it holds (R2).
 */
export function tick(s: PlayerState, dt: number): PlayerState {
  if (!s.playing || !Number.isFinite(dt) || dt <= 0) return s;
  const t = clamp(s.t + dt * s.rate, s.duration);
  if (s.follow === "detached" && t >= s.duration) {
    return { ...s, t: s.duration, playing: false };
  }
  return t === s.t ? s : { ...s, t };
}

/** User scrub — the user owns the playhead now (R7): detached + paused. */
export function scrub(s: PlayerState, t: number): PlayerState {
  return { ...s, t: clamp(t, s.duration), follow: "detached", playing: false };
}

/**
 * Idempotent pause — the gesture-safe half of `togglePlay` (C1′).
 *
 * A grab on the board must stop playback, and a gesture may NEVER be
 * given a toggle: the caller's notion of `playing` can be one render
 * stale, and a stale toggle would START the board moving under the hand —
 * the exact opposite of what grabbing it means. Already paused returns
 * the IDENTICAL object, so the host can skip its voice work on identity.
 */
export function pause(s: PlayerState): PlayerState {
  return s.playing ? { ...s, playing: false, follow: "detached" } : s;
}

/**
 * Play/pause toggle. Any manual transport act detaches (R7 — live is the
 * "following the broadcast" state; the Live button is the only way back).
 * Toggling play at the end restarts from 0 (replay affordance).
 */
export function togglePlay(s: PlayerState): PlayerState {
  if (s.playing) return pause(s);
  const atEnd = s.t >= s.duration && s.duration > 0;
  return {
    ...s,
    t: atEnd ? 0 : s.t,
    playing: true,
    follow: "detached",
  };
}

/**
 * `play-from` (T6, §9) — the agent's demonstration verb: "let me walk you
 * through this part again". Start playing at `t`, detached, so an append while the
 * user is watching the replay cannot yank them back to the live tip (R7).
 *
 * Unlike `togglePlay` this never restarts from 0 on its own: the caller
 * already said where to start. A non-finite `t` is refused (identical
 * object back) rather than silently read as 0 — an unresolvable address
 * must not look like "play from the beginning".
 */
export function playFrom(s: PlayerState, t: number): PlayerState {
  if (!Number.isFinite(t)) return s;
  return { ...s, t: clamp(t, s.duration), playing: true, follow: "detached" };
}

/** The Live button (R7): seek to the content tip and re-enter live. */
export function goLive(s: PlayerState): PlayerState {
  return { ...s, t: s.duration, follow: "live", playing: true };
}

/** Rate change — clock speed only; canonical time is untouched. */
export function setRate(s: PlayerState, rate: Rate): PlayerState {
  return { ...s, rate };
}

/**
 * The canonical timeline was recompiled (append R2, edit R4, realign R4′).
 *
 *  - live: the held playhead stays put — a longer timeline resumes ticking
 *    from exactly where the hold left off (zero replay); a shorter one
 *    clamps forward-only (R3: clamp, never rewind below the new end).
 *  - detached: the user's position is preserved, clamped into range; an
 *    ended player stays ended (appends do not yank a detached user).
 */
export function timelineReplaced(
  s: PlayerState,
  duration: number,
): PlayerState {
  return { ...s, duration, t: clamp(s.t, duration) };
}
