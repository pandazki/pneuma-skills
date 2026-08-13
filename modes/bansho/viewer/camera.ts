/**
 * camera.ts (C1) — the stage camera as a pure module. Zero DOM: input is
 * the panel/viewport geometry plus the current camera and one action,
 * output is the next camera. Clamping, anchored zoom and the follow-target
 * arithmetic all live here because happy-dom has no layout engine — grown
 * into BoardCanvas none of it would be testable; as pure functions all of
 * it is.
 *
 * Model: `(x, y)` is the BOARD coordinate sitting at the viewport's top-left
 * corner, `z` the zoom. The stage wears exactly one transform,
 * `translate(-x*z, -y*z) scale(z)` with `transform-origin: 0 0`, so a board
 * point `(bx, by)` renders at screen `((bx-x)*z, (by-y)*z)` — the camera at
 * `(x, y)` puts board point `(x, y)` on the viewport origin.
 *
 * This module also carries the detach POLICY that survived the deletion of
 * camera-latch.ts. The old latch suppressed scroll-event echoes; a
 * transform write fires no scroll events, so that whole channel is gone —
 * but the policy it defended remains load-bearing: a bare click is T6's
 * "point at the board and ask" and must never kill the follow (the
 * original bug: one click during a live broadcast and the pen kept writing
 * below the fold).
 *
 * C1′ (2026-08-10) added the grab: a press that TRAVELS is the user taking
 * the camera in hand, and detaches exactly like a wheel. A press that does
 * not travel is still the click, still inert — the slop threshold below is
 * the whole difference between the two, which is why it lives here as a
 * pure predicate rather than as an `if` inside a pointermove handler.
 */

import {
  clampCamera,
  cameraMinZ,
  CAMERA_MAX_Z,
  restZoom as restZoomOf,
  stageStateAt,
  type StageSchedule,
  type Viewbox,
} from "../engine/stage.js";
import { PANEL_WIDTH } from "../engine/layout.js";

// The follow/clamp arithmetic lives in engine/stage.ts since review P1-4
// (the canonical from-pose SIMULATES the live follow, so both callers
// must share one arithmetic); re-exported here so the host's import
// surface never moved.
export {
  CAMERA_MIN_Z,
  CAMERA_MAX_Z,
  cameraMinZ,
  clampCamera,
  FOLLOW_MARGIN,
  followShift,
  handBackCamera,
  homePose,
  reattachCamera,
  restZoom,
  type FollowBoard,
  type Viewbox,
} from "../engine/stage.js";

export interface Camera {
  /** Board x at the viewport's left edge (board px). */
  x: number;
  /** Board y at the viewport's top edge (board px). */
  y: number;
  /** Zoom factor (1 = board px are screen px). */
  z: number;
}

/** Wheel-to-zoom response. exp keeps steps multiplicative (a notch is a
 *  ratio, not an offset), so zoom in/out round-trips exactly.
 *
 *  The three numbers are d3-zoom's own `wheelDelta` factors, per
 *  `WheelEvent.deltaMode`: pixels (0), LINES (1) and pages (2). A wheel
 *  reporting in lines sends ~3 per notch where a trackpad sends ~100, so
 *  reading every delta as pixels leaves a line-mode mouse — Firefox on
 *  Windows and Linux — zooming by half a percent per notch. That was
 *  survivable while the wheel merely panned and ctrl+wheel zoomed; since
 *  W4a the wheel IS the zoom, so the platform's units have to be read. */
const ZOOM_INTENSITY = 0.002;
const ZOOM_INTENSITY_LINE = 0.05;
const ZOOM_INTENSITY_PAGE = 1;

/**
 * The camera before anything has told it otherwise. A FUNCTION of the
 * viewport since W7 — `z` is the zoom that shows exactly one canonical
 * board (`restZoom`), which is 1 when the viewport happens to be a board
 * wide, i.e. the frozen constant this replaces.
 */
export function homeCamera(viewW: number): Camera {
  return { x: 0, y: 0, z: restZoomOf(viewW, PANEL_WIDTH) };
}

const clampNum = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/** Pan by SCREEN pixel deltas (wheel deltas arrive in screen px). */
export function panBy(
  camera: Camera,
  box: Viewbox,
  dxPx: number,
  dyPx: number,
): Camera {
  return clampCamera(
    { x: camera.x + dxPx / camera.z, y: camera.y + dyPx / camera.z, z: camera.z },
    box,
  );
}

/**
 * Pan by POINTER movement — the grab (C1′). `dxPx/dyPx` is how far the
 * hand moved on screen; the board follows it, so the camera moves the
 * other way. Separate from `panBy` on purpose: the wheel reports how far
 * the CONTENT should travel, a drag reports how far the HAND did, and the
 * sign flip between them is exactly the kind of thing that is silently
 * wrong for a week. Here it is one named function with one test.
 */
export function grabPan(
  camera: Camera,
  box: Viewbox,
  dxPx: number,
  dyPx: number,
): Camera {
  return panBy(camera, box, -dxPx, -dyPx);
}

/**
 * How far a pointer must travel before a press becomes a grab.
 *
 * 4 px for mouse/pen: the platform drag thresholds sit at 3–5 px (macOS
 * and every toolkit that ever shipped a drag), and a click that pans the
 * board by a few pixels reads as a broken click, not as a small pan. Below
 * it the press stays T6's click — this threshold IS the resolution of the
 * "drag-pan conflicts with pointing" objection C1 filed.
 *
 * 10 px for touch: a finger contact wanders several px during an ordinary
 * tap (Android's touch slop is 8dp, iOS is around 10 px), so the mouse
 * threshold would turn a large share of taps into pans and make pointing
 * unusable on a touchscreen — the same bug, discovered by a different
 * hand.
 */
export const GRAB_SLOP_PX = 4;
export const GRAB_SLOP_TOUCH_PX = 10;

/** The slop for the device doing the pressing (unknown → mouse-grade). */
export function grabSlopFor(pointerType?: string): number {
  return pointerType === "touch" ? GRAB_SLOP_TOUCH_PX : GRAB_SLOP_PX;
}

/**
 * Has this press travelled far enough to BE a grab? Radial, not per-axis:
 * a diagonal drag must not have to clear the threshold twice.
 */
export function exceedsGrabSlop(
  dxPx: number,
  dyPx: number,
  pointerType?: string,
): boolean {
  return Math.hypot(dxPx, dyPx) > grabSlopFor(pointerType);
}

/** deltaY -> multiplicative zoom step (pinch-out / wheel-up zooms in).
 *  `deltaMode` is the event's own unit (0 px, 1 lines, 2 pages); omitting
 *  it reads the delta as pixels, which is what every trackpad and every
 *  Chromium wheel reports. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const intensity =
    deltaMode === 1
      ? ZOOM_INTENSITY_LINE
      : deltaMode === 2
        ? ZOOM_INTENSITY_PAGE
        : ZOOM_INTENSITY;
  return Math.exp(-deltaY * intensity);
}

/**
 * Zoom about a viewport-relative screen point: the board point under the
 * cursor stays under the cursor. The screen->board conversion divides by
 * the MODEL z — exact, because the stage transform is written from this
 * same value with no CSS transition in between (were one ever added, the
 * conversion would have to move to the same-frame measured scale, G8-J).
 */
export function zoomAt(
  camera: Camera,
  box: Viewbox,
  point: { x: number; y: number },
  factor: number,
): Camera {
  const z = clampNum(camera.z * factor, cameraMinZ(box), CAMERA_MAX_Z);
  if (z === camera.z) return camera;
  const bx = camera.x + point.x / camera.z;
  const by = camera.y + point.y / camera.z;
  return clampCamera(
    { x: bx - point.x / z, y: by - point.y / z, z },
    box,
  );
}

/** The ONE transform string the stage wears. */
export function cameraCss(camera: Camera): string {
  return `translate(${-camera.x * camera.z}px, ${-camera.y * camera.z}px) scale(${camera.z})`;
}

// ── The detach policy (camera-latch, survived) ──────────────────────────────

export type FollowLatch = "following" | "detached";

/**
 * Every user input the stage surface receives, including the ones that
 * must do NOTHING — "click" and "pointer" exist to pin the negative space
 * (see the module header: a click must never detach).
 *
 * `reset` is the ONE re-engage token: the Live button, every explicit
 * seek, and resuming playback all hand the camera back through it. There
 * is deliberately no second "resume" signal — one policy, one door.
 */
export type LatchSignal = "wheel" | "grab" | "click" | "pointer" | "reset";

export function latchInput(latch: FollowLatch, signal: LatchSignal): FollowLatch {
  switch (signal) {
    // Both camera gestures: the wheel and the hand. A grab is the most
    // unambiguous statement of "I am driving" the surface has.
    case "wheel":
    case "grab":
      return "detached";
    case "reset":
      return "following";
    // A bare click (T6 pointing) and a pointer press that has not yet
    // travelled `GRAB_SLOP_PX` are not camera gestures — the latch does
    // not move. Every press starts here and only becomes a "grab" by
    // clearing the slop, so this negative space is what keeps pointing
    // alive now that dragging pans.
    case "click":
    case "pointer":
      return latch;
  }
}

// ── The host gate (C2) — director vs follow vs user ─────────────────────────

/** What the host should do with the camera at a moment `t`. */
export type StageGateVerdict =
  | { kind: "director"; camera: Camera }
  | { kind: "follow" }
  | { kind: "user" };

const FOLLOW_VERDICT: StageGateVerdict = Object.freeze({ kind: "follow" });
const USER_VERDICT: StageGateVerdict = Object.freeze({ kind: "user" });

/**
 * The ONE priority rule between the director's camera and the user's
 * (C2 spec: this IS the C1 detach semantics, not a second mechanism):
 *
 *  - the user detached (wheel) → the user owns the camera; the host writes
 *    NOTHING, director pose or not;
 *  - the register holds a pose → the director's camera, applied verbatim
 *    (deliberately NOT `clampCamera`d: an overview may legitimately sit
 *    below the user-gesture zoom floor / left of x = 0 to fit and center
 *    the whole board);
 *  - otherwise → C1's live pen follow.
 *
 * `follow === "live"` and every explicit seek reset the latch upstream
 * (`latchInput(_, "reset")`), which is what hands the camera back to the
 * director — same reset, same semantics as C1.
 */
export function gateCamera(
  schedule: StageSchedule | null,
  t: number,
  latch: FollowLatch,
): StageGateVerdict {
  if (latch === "detached") return USER_VERDICT;
  if (!schedule || schedule.moves.length === 0) return FOLLOW_VERDICT;
  const register = stageStateAt(schedule, t).camera;
  return register.kind === "pose"
    ? {
        kind: "director",
        camera: { x: register.x, y: register.y, z: register.z },
      }
    : FOLLOW_VERDICT;
}

