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
 * the stage transform would break, G8-J), and holds exactly one glide:
 * retarget, never queue — a new target mid-flight restarts from the
 * currently painted pose (`startGlide(painted, next, …)`).
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
  type StageView,
} from "../engine/stage.js";
import type { DurationConstants } from "../engine/types.js";

/** How the host commits a camera it decided on: as a tween, or as the
 *  deliberate cut the cancel set names (a seek tracking the dragged
 *  playhead, a user gesture, a rebuild's re-clamp). */
export type CameraMotion = "glide" | "cut";

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
 * Begin a tween `from → to`, or answer `null` when the move is a CUT by
 * definition: no travel (a zero-length glide is a tilt with no journey),
 * an unmeasured viewport (no geometry to run the path against), or a
 * degenerate duration. The caller applies the target instantly on `null`.
 *
 * `rate` is the playback rate; anything that is not a positive finite
 * number falls back to 1 — a frozen or backwards tween is never an answer.
 */
export function startGlide(
  from: CameraPose,
  to: CameraPose,
  view: StageView,
  d: DurationConstants,
  rate: number,
): CameraGlide | null {
  if (samePose(from, to)) return null;
  if (!(view.viewW > 0) || !(view.viewH > 0)) return null;
  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const seconds = cameraMoveDuration(from, to, view, d);
  if (!Number.isFinite(seconds) || !(seconds > 0)) return null;
  return {
    from,
    to,
    view,
    rho: d.cameraRho,
    durationMs: (seconds * 1000) / speed,
    startMs: null,
  };
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
