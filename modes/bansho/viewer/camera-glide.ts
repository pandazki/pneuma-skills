/**
 * camera-glide.ts — the host-side camera tween, as a pure module.
 *
 * WHY IT EXISTS (2026-08-17, measured on a real reader): only `@turn` had a
 * transition. The canonical schedule already glides every cross-board walk
 * (Van Wijk paths, arc-length durations, lead windows — `engine/stage.ts::
 * resolveCameraOps`), but the HOST'S OWN camera writes — the same-board
 * paragraph chase, the decay hand-back, the Live re-attach, a locator jump
 * — were instant cuts, and 「无论是移动镜头还是移动白板，都不应该闪烁。我注
 * 意力瞬间就丢失了，无法跟着讲述者」. Those writes stay HOST presentation
 * (the canonical schedule is untouched — R8's byte-identity holds); this
 * module is how the host plays them as motion.
 *
 * ONE MOTION VOCABULARY, literally: the tween is `cameraPoseAt(from, to,
 * view, rho, easeCamera(p))` and the duration is `cameraMoveDuration(...)`
 * — the director's own arithmetic under the same `DurationConstants`, not a
 * second easing curve beside it. A near nudge is quick and a long walk is
 * slow for free, because the V&N cost function IS the move's perceptual
 * size.
 *
 * ZERO DOM, ZERO CLOCK (happy-dom has no rAF timing): the module is a state
 * shape plus pure functions of (glide, nowMs). The HOST owns the animation
 * frames, commits every interpolated pose to its camera model BEFORE
 * painting it (model == painted on every tween frame — `zoomAt`'s
 * screen→board divide by the model z stays exact, which a CSS transition on
 * the stage transform would break, G8-J), and holds exactly one glide.
 *
 * A MID-FLIGHT CONFLICT IS DECIDED BY WHO ASKED (2026-08-18, measured,
 * ruled): the original law here was "retarget, never queue — a new target
 * mid-flight restarts from the currently painted pose", and the restart is
 * exactly what a real trace convicted. Replacing a tween resets its clock:
 * the replacement's first frame paints its own departure — the very pose
 * already on screen — so the camera stops dead for one frame at FULL
 * SPEED, then eases back in from zero. During a decay hand-back longer
 * than the reveal-unit gap the passive follow recommitted every unit, and
 * the tween lived its whole life inside that ease-in: five restarts in
 * 800ms, motion killed at max step each time (the owner's 「动画没结束就进
 * 入下一个动画」). The split (see `CameraMotion`):
 *
 *  - the AUTOMATIC follow (`"chase"`) ABSORBS — the newest target waits
 *    (one deep, latest wins) and takes over the moment the current leg
 *    arrives. Every leg completes, velocity reaches zero only at rest,
 *    and the journey still converges on the newest target. An automatic
 *    recommit is not allowed to interrupt a leg — that permission is
 *    exactly what produced the storm;
 *  - an EXPLICIT navigation (`"glide"`) SUPERSEDES — a fresh leg departs
 *    the currently painted pose at once, because the one thing "take me
 *    there" must not do is visibly go somewhere else first. One restart's
 *    single-frame plateau is 8–16ms; five in a row was the defect;
 *  - deliberate cuts (user gestures, seek tracking, director poses, the
 *    rebuild's re-clamp) still supersede instantly — they cancel the leg
 *    AND the waiting target.
 *
 * A PAUSE DROPS THE WAITING TARGET and only that: the leg in flight
 * settles (finishing a walk is a settle, and it is right), but the
 * absorbed target firing afterwards would be new motion beginning while
 * the lecture is stopped, which nobody asked for.
 *
 * THE HOST NEVER STARTS A GLIDE IT CANNOT FINISH: before starting one, the
 * caller clips its duration to the room left before the director's next
 * canonical window opens (`glideRoomSeconds` + `startGlide`'s `maxMs`). No
 * room is not a fast glide — it is a cut, exactly mirroring the fold's own
 * `lead <= 0` rule (engine/stage.ts::buildStageSchedule).
 *
 * WHAT THE CLIP DOES AND DOES NOT GUARANTEE (corrected 2026-08-19 — the
 * old sentence here claimed the driver handoff "without teleporting"
 * unconditionally, and an e2e pass falsified it with an 82px one-frame
 * cut at a window open): the clip guarantees the leg has LANDED before
 * the director's first write — no leg is ever killed at speed. Whether
 * the landed pose EQUALS the canonical from-pose is a separate,
 * CONDITIONAL fact: the composed chase target (hand-back + `followShift`)
 * is departure-independent whenever the shift fires (its y and board x
 * are absolute), so an uninterrupted stretch converges on the simulated
 * rest — measured bit-exact on a full tech-zh replay. But the DEAD BAND
 * decides whether it fires at all: a live camera whose history departs
 * from the simulation's (a seek entry, a re-attach, a leg settled by a
 * cut) can be left holding a residue that no later chase settles, and the
 * window open then pays that residue as a one-frame cut. Both entry
 * classes measured on the current build (uninterrupted replay; seek-entry
 * then play) open their windows seam-exact; if the residue cut ever
 * reappears, its structural fingerprint is "settle, hold, then one frame
 * of exactly the residue at a move's start".
 *
 * REDUCED MOTION: the 2D Van Wijk glide deliberately STAYS under
 * `prefers-reduced-motion` — the precedent set for the canonical camera
 * (BoardCanvas `depthMotion`): degrade to today's flat transition, never to
 * an instant cut. Only the depth surface is gated.
 */

import {
  cameraMoveDuration,
  cameraPoseAt,
  easeCamera,
  type CameraPose,
  type StageSchedule,
  type StageView,
} from "../engine/stage.js";
import type { DurationConstants } from "../engine/types.js";

/**
 * How the host commits a camera it decided on — and, for the two tween
 * words, WHO ASKED, because that is what decides a mid-flight conflict
 * (2026-08-18 ruling):
 *
 *  - `"cut"`   — the deliberate instant write the cancel set names (a seek
 *    tracking the dragged playhead, a user gesture, a rebuild's re-clamp);
 *  - `"chase"` — the AUTOMATIC follow's walk (the paragraph chase, the
 *    decay hand-back). An automatic recommit may NOT interrupt a leg in
 *    flight: it is absorbed (one deep, latest wins) and takes over at
 *    arrival — the measured retarget storm was five automatic restarts in
 *    800ms, and absorb is what killed it;
 *  - `"glide"` — an EXPLICIT navigation's walk (a locator card, the
 *    agent's navigate-to, the Live re-attach). A user's explicit intent is
 *    allowed to interrupt itself: mid-flight it SUPERSEDES — a fresh leg
 *    departs the currently painted pose. The one-frame zero-velocity
 *    plateau of that restart is 8–16ms, which is not what made the storm
 *    bad; five in a row was. The rule that separates the two words is not
 *    "how it looks" but "who asked".
 */
export type CameraMotion = "glide" | "chase" | "cut";

/** One camera tween in flight. Immutable except for the host swapping the
 *  whole object (retarget) or `stampGlide` answering a stamped copy. */
export interface CameraGlide {
  readonly from: CameraPose;
  readonly to: CameraPose;
  /** The viewport geometry the V&N path runs against (only `viewW` /
   *  `viewH` enter the arithmetic — layout values, transform-immune). */
  readonly view: StageView;
  readonly rho: number;
  /** Wall-clock ms the tween takes — the director's arc-length seconds,
   *  already divided by the playback rate so camera tempo tracks lecture
   *  tempo at 1.5×/2×. */
  readonly durationMs: number;
  /**
   * The tween's own zero, stamped by the FIRST animation frame that steps
   * it (`stampGlide`) — `null` until then. The frame's timestamp is the
   * one clock the stepper reads, so start and steps share a time source
   * and a test can drive every frame deterministically.
   */
  readonly startMs: number | null;
}

/** Exact pose equality — the engine's own bit-for-bit discipline. */
export function samePose(a: CameraPose, b: CameraPose): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * THE DURATION FLOOR (2026-08-19, measured): a nonzero duration is not yet
 * continuity. On tech-zh at 1× the same-board paragraph chase ran 75–200ms
 * for 80–190px and the `@turn` step-in ran 65–84ms while moving ~205–223px
 * of screen at up to ~10,000 px/s — the fastest motion in the lecture,
 * spent exiting the walk's own 1.2s set-piece. Below roughly 100–150ms an
 * easing curve is not perceived as motion at all, so those short walks
 * were still cuts wearing a curve. The arc-length tempo says how long a
 * move WANTS to take; this floor says how long a visible move MUST take to
 * read as a move. 220ms sits inside the measured 180–250ms band: above
 * the two-to-three-frame blur where easing is invisible, below the point
 * where a per-paragraph chase starts to feel like syrup. Divided by the
 * playback rate exactly like the natural tempo (camera tempo tracks
 * lecture tempo), and always outranked by the room clip — a floor must
 * never make the host overrun a canonical window.
 */
export const GLIDE_FLOOR_MS = 220;

/**
 * Below this much SCREEN displacement a move is a nudge, not a walk, and
 * keeps its natural (short) tempo — flooring a 5px settle to 220ms would
 * turn an imperceptible correction into a visible drift. 32px is under a
 * board line's height on every real window (34px hand at rest zoom ≥ 1):
 * anything smaller than one line of writing reads as settling, not as
 * displacement; everything the trace convicted (80px and up) is well
 * above it.
 */
export const GLIDE_NUDGE_PX = 32;

/** The five probes: viewport center + corners, as fractions of the view. */
const SHIFT_PROBES: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

/**
 * The largest on-screen displacement a CUT `from → to` would inflict on
 * the content the reader is looking at: board points under the viewport
 * center and corners of `from`, re-projected under `to`, max distance
 * moved (screen px). The corners are what catch a pure zoom — its center
 * is still while its edges fly — and the center catches a pure pan. This
 * is the same per-frame displacement the e2e trace measures, which is the
 * point: the floor gates on the metric the defect was convicted with.
 */
export function glideScreenShift(
  from: CameraPose,
  to: CameraPose,
  view: StageView,
): number {
  let max = 0;
  for (const [fx, fy] of SHIFT_PROBES) {
    const sx = fx * view.viewW;
    const sy = fy * view.viewH;
    // Screen (sx, sy) under `from` is board (from.x + sx/z, from.y + sy/z);
    // the same board point under `to` paints at ((p − to.xy) · to.z).
    const dx = (from.x + sx / from.z - to.x) * to.z - sx;
    const dy = (from.y + sy / from.z - to.y) * to.z - sy;
    const d = Math.hypot(dx, dy);
    if (d > max) max = d;
  }
  return max;
}

/**
 * Begin a tween `from → to`, or answer `null` when the move is a CUT by
 * definition: no travel (a zero-length glide is a tilt with no journey),
 * an unmeasured viewport (no geometry to run the path against), a
 * degenerate duration, or NO ROOM (`maxMs`, see below). The caller applies
 * the target instantly on `null`.
 *
 * `rate` is the playback rate; anything that is not a positive finite
 * number falls back to 1 — a frozen or backwards tween is never an answer.
 *
 * `maxMs` is the room the caller has before the next canonical window
 * opens (wall-clock ms — the caller already divided by the rate, exactly
 * as the duration below is). The tween is CLIPPED to it: the host must
 * never start a glide it cannot finish, so a walk with less room than its
 * natural tempo plays faster rather than being killed mid-stride. Room
 * that is zero, negative, or NaN is a cut (`null`) — the fold's own
 * `lead <= 0` rule, mirrored. Omitted or Infinity: the natural duration.
 */
export function startGlide(
  from: CameraPose,
  to: CameraPose,
  view: StageView,
  d: DurationConstants,
  rate: number,
  maxMs?: number,
): CameraGlide | null {
  if (samePose(from, to)) return null;
  if (!(view.viewW > 0) || !(view.viewH > 0)) return null;
  if (maxMs !== undefined && !(maxMs > 0)) return null;
  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const seconds = cameraMoveDuration(from, to, view, d);
  if (!Number.isFinite(seconds) || !(seconds > 0)) return null;
  const naturalMs = (seconds * 1000) / speed;
  // The floor (see GLIDE_FLOOR_MS): a move the reader can SEE must last
  // long enough to read as motion. Gated on real screen displacement so a
  // sub-line settle keeps its natural snap, and always inside the room
  // clip — the window boundary is a harder law than legibility.
  const floored =
    glideScreenShift(from, to, view) >= GLIDE_NUDGE_PX
      ? Math.max(naturalMs, GLIDE_FLOOR_MS / speed)
      : naturalMs;
  return {
    from,
    to,
    view,
    rho: d.cameraRho,
    durationMs: maxMs !== undefined ? Math.min(floored, maxMs) : floored,
    startMs: null,
  };
}

/**
 * Canonical seconds of room before the director's next move window opens
 * at `t` — the budget a host glide may occupy (`startGlide`'s `maxMs`,
 * after the caller's rate divide). Infinity when no window lies ahead (or
 * there is no schedule at all): open country, natural tempo. Pure; the
 * moves are sorted by start (`buildStageSchedule` emits them in canonical
 * order), so the first start beyond `t` is the answer.
 */
export function glideRoomSeconds(
  schedule: StageSchedule | null,
  t: number,
): number {
  if (!schedule || !Number.isFinite(t)) return Infinity;
  for (const move of schedule.moves) {
    if (move.start > t) return move.start - t;
  }
  return Infinity;
}

/** Stamp the tween's zero with the first frame's timestamp. Already
 *  stamped: the same object verbatim — restamping would silently restart
 *  the clock mid-flight. */
export function stampGlide(glide: CameraGlide, nowMs: number): CameraGlide {
  return glide.startMs === null ? { ...glide, startMs: nowMs } : glide;
}

/**
 * The pose to paint at `nowMs`, and whether the tween has arrived. Pure in
 * `(glide, nowMs)`. Endpoint-exact by inheritance: at p ≤ 0 the departure
 * and at p ≥ 1 the arrival are returned VERBATIM (`cameraPoseAt`'s own
 * contract), so a finished glide lands bit-for-bit on the pose its
 * producer computed — no float drift for the clamp to disagree with.
 */
export function glidePoseAt(
  glide: CameraGlide,
  nowMs: number,
): { pose: CameraPose; done: boolean } {
  if (glide.startMs === null) return { pose: glide.from, done: false };
  const elapsed = nowMs - glide.startMs;
  const p = elapsed <= 0 ? 0 : Math.min(elapsed / glide.durationMs, 1);
  return {
    pose: cameraPoseAt(glide.from, glide.to, glide.view, glide.rho, easeCamera(p)),
    done: elapsed >= glide.durationMs,
  };
}
