/**
 * stage.ts (C2 舞台指令) — the stage-state fold and the camera-path
 * arithmetic behind `@focus` / `@overview`.
 *
 * Layering (G2): engine core — zero DOM, zero React, zero external imports,
 * no clock. Geometry arrives as plain rects the host measured (layout
 * values, `offset*` — the G8-J-safe column); times arrive as the canonical
 * schedule the timeline laid out. Everything here is a pure function.
 *
 * THE REGISTER MODEL (rev 2 §3): the camera is a SHARED REGISTER — many
 * steps write one value, last-wins, order-dependent — so it is folded,
 * never dispatched to (`makeSeek`'s window walk + last-write-wins would
 * park the pose at the wrong step on a scrub). Its codomain is wider than
 * a pose ON PURPOSE:
 *
 *     CameraRegister = { kind: "pose"; x; y; z } | { kind: "follow" }
 *
 * `"follow"` is what makes a board with NO camera verbs behave exactly as
 * before (C1's pen-following camera keeps running), and what brings the
 * camera back to the pen after a `@focus` — the two regressions the naive
 * "pose of the last camera step" fold would reintroduce (C2 spec, 镜头
 * 寄存器必须能取值「跟随」).
 *
 * DECAY RULE (pinned in the C2 spec): a camera step's pose holds through
 * its own window and any immediately following non-writing time (`@wait`,
 * the gap before another camera step); the register decays back to
 * `"follow"` the moment the NEXT WRITING UNIT starts. Reads as the
 * teacher's motion: 「我带你看这儿(停住讲)……好,回来继续写」.
 *
 * FROM-POSE RULE (revised by the 2026-08-10 review, P1-4; the C2 spec's
 * §「衰减规则」补 is updated to match): while the register is still
 * latched (no writing step since the previous camera step), a move
 * departs from the previous camera TARGET; once decayed, it departs from
 * where the live follow actually RESTS — resolveCameraOps SIMULATES the
 * host's follow with the very same arithmetic (`followShift`, dead band
 * included, plus the decay hand-back's kept y), folded over the write and
 * erase steps in document order. The old absolute proxy ignored the dead
 * band, so a decayed move opened with a visible jump off the camera the
 * user was watching. Still document order + measured rects only — no
 * durations — so the whole pose chain is solvable before any window is
 * laid out (no duration ↔ timeline circularity), and an uninterrupted
 * play-through's live camera lands exactly on the simulated rest.
 *
 * INTERPOLATION: Van Wijk & Nuij (2003) smooth zoom-pan — arc-length
 * parameterized motion in (pan, log-zoom) space. Linear interpolation of a
 * simultaneous pan+zoom is perceptually wrong (the picture shoots out and
 * snaps back); the V&N path zooms out just enough to keep both endpoints
 * cognitively connected. The SAME ρ-metric arc length is the move's
 * perceptual size, so `duration = S / cameraSpeed` makes near nudges quick
 * and cross-board jumps slow with one constant. A strictly monotone
 * ease-in-out shapes t → s (G8-H discipline; d3's celebrated zoom feel is
 * exactly interpolateZoom × easeCubicInOut, not linear-in-s).
 */

import { PANEL_WIDTH } from "./layout.js";
import type { DurationConstants, StageRect } from "./types.js";
import {
  wallExtent,
  wallSlot,
  wallSlotAt,
  type WallGeometry,
  type WallSlot,
} from "./wall.js";

// ────────────────────────────────────────────────────────────────────────────
// Poses & the register
// ────────────────────────────────────────────────────────────────────────────

/** The camera model shared with `viewer/camera.ts`: `(x, y)` is the board
 *  point at the viewport's top-left corner, `z` the zoom. */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
}

/** The stage register's value at a time t — a held/interpolated pose, or
 *  "the director is silent, follow the pen" (resolved by the host to C1's
 *  live-follow path). */
export type CameraRegister =
  | { kind: "pose"; x: number; y: number; z: number }
  | { kind: "follow" };

/** One panel displaced from its home slot (C3b `@bring` writes these;
 *  nothing does in C2 — the field exists so the fold's return shape never
 *  needs a breaking reshape). */
export interface PanelOffset {
  panel: number;
  dx: number;
  dy: number;
}

/** The fold's result: the full stage state at a time t. */
export interface StageState {
  camera: CameraRegister;
  panelOffsets: readonly PanelOffset[];
}

/**
 * The board's own corner at the performance's own zoom — where the camera
 * stands before anything has told it otherwise, and where an overview with
 * nothing to fit falls back to.
 *
 * A FUNCTION of the viewport since W7: the zoom that shows one board is
 * `restZoom(viewW)` (see below), which is 1 exactly when the viewport is a
 * board wide — the pre-W7 constant, which is what this replaces.
 */
export function homePose(viewW: number, boardW: number): CameraPose {
  return { x: 0, y: 0, z: restZoom(viewW, boardW) };
}

const FOLLOW_REGISTER: CameraRegister = Object.freeze({ kind: "follow" });
const NO_OFFSETS: readonly PanelOffset[] = Object.freeze([]);
/** Shared identical object for every "follow" answer — the fold is on the
 *  per-frame hot path and a silent board must allocate nothing. */
const FOLLOW_STATE: StageState = Object.freeze({
  camera: FOLLOW_REGISTER,
  panelOffsets: NO_OFFSETS,
});

// ────────────────────────────────────────────────────────────────────────────
// Geometry the resolver needs
// ────────────────────────────────────────────────────────────────────────────

/** The viewport/panel geometry the pose arithmetic runs against — all four
 *  are LAYOUT values (a transform never changes them, G8-J). `panelW` /
 *  `panelH` describe ONE panel; the C3 multi-board fields widen the stage
 *  (defaults preserve C2's single-panel arithmetic bit for bit). */
export interface StageView {
  viewW: number;
  viewH: number;
  panelW: number;
  panelH: number;
  /** C3: how many boards stand side by side (default 1). */
  panelCount?: number;
  /** C3: the gap between adjacent boards, board px (default 0). */
  panelGap?: number;
}

/** The wall geometry this view describes — the shape `engine/wall.ts`
 *  does every slot calculation against. */
const wallGeomOf = (view: StageView): WallGeometry => ({
  panelW: view.panelW,
  panelH: view.panelH,
  gap: view.panelGap ?? 0,
});

/** The whole stage's extent — one panel at count 1 (C2 verbatim), and the
 *  full ROOM (columns and rows) on a wall. */
export function stageExtent(view: StageView): { w: number; h: number } {
  return wallExtent(Math.max(1, view.panelCount ?? 1), wallGeomOf(view));
}

/**
 * The stage origin of the board a rect lives on — the follow camera's
 * rest pose (a panel is exactly one viewport wide at z = 1, so the
 * board's own corner IS the right place to stand). Exactly `{0, 0}` at
 * count 1: single-panel boards keep C2's `x: 0` bit for bit — deriving it
 * from the rect's center instead would move the camera on every
 * ink-anchored follow.
 */
export function panelOrigin(rect: StageRect, view: StageView): WallSlot {
  const n = Math.max(1, view.panelCount ?? 1);
  if (n === 1) return HOME_SLOT;
  const geom = wallGeomOf(view);
  const point = {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
  return wallSlot(wallSlotAt(point, n, geom), n, geom);
}

const HOME_SLOT: WallSlot = Object.freeze({ x: 0, y: 0 });

/** Air kept around an `@overview` fit (board px). */
export const OVERVIEW_MARGIN = 48;

const clampNum = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

// ────────────────────────────────────────────────────────────────────────────
// The live-follow arithmetic — ONE convention, shared with the host
// ────────────────────────────────────────────────────────────────────────────
// Moved here from viewer/camera.ts (which re-exports every name below, so
// the host's import surface never moved) for review P1-4: the canonical
// from-pose must SIMULATE the live follow, not approximate it. The old
// `followProxyPose` pinned the pen line `margin` above the fold
// unconditionally, while the live follow has a dead band (a visible
// target moves nothing) and the decay hand-back keeps the director's y —
// so every decayed camera move opened with a visible jump off the camera
// the user was actually watching. One arithmetic, two callers, no jump.

export const CAMERA_MIN_Z = 0.4;
export const CAMERA_MAX_Z = 2.5;

/**
 * THE AT-REST ZOOM (W7, 2026-08-12) — what `z = 1` used to mean, restated
 * for a board that has its own size.
 *
 * Before W7 the board WAS the viewport (`panelW = viewport.clientWidth`),
 * so "board px are screen px" and "one board fills the view" were the same
 * sentence and both were spelled `z = 1`. The canonical board splits them,
 * and only the second one is a POSE a person would stand in: at a literal
 * z = 1 a 1242px board is cropped on a 1000px laptop and floats in a lake
 * of wall on a 1990px monitor. So the performance's own zoom — the pose
 * `HOME`, the decay hand-back, the re-attach, `@focus` and the overview cap
 * all mean — is now **fit exactly one board's width**:
 *
 *     restZoom(viewW, boardW) = viewW / boardW
 *
 * It is a strict GENERALISATION, not a new rule: on the old geometry
 * `viewW === panelW`, so it evaluates to exactly 1 and every pre-W7
 * argument about `z = 1` survives word for word. `z` keeps meaning
 * "screen px per board px"; what changed is that 1 stopped being the
 * number that shows you a board.
 *
 * Clamped to the gesture ceiling (a 4000px window must not magnify past
 * what a user could zoom to) but NOT to `CAMERA_MIN_Z`: on a window
 * narrower than a board, fitting the board IS the correct rest pose and the
 * floor exists to stop a user zooming out into the void, not to crop the
 * lecture. `cameraMinZ` already tracks it — on a single board its own
 * `viewW / panelW` term is this same number.
 *
 * `boardW` is REQUIRED and is always ONE BOARD's width. Every `StageView`
 * already carries it as `panelW` (that field is the panel, not the wall —
 * unlike `Viewbox.panelW`, which is the clamp box), so those callers quote
 * what they already hold instead of minting a second copy of the constant;
 * the rest pass `PANEL_WIDTH`. There is exactly one width in production
 * either way, and no call site may guess at it.
 */
export function restZoom(viewW: number, boardW: number): number {
  return viewW > 0 && boardW > 0
    ? Math.min(viewW / boardW, CAMERA_MAX_Z)
    : 1;
}

/** The geometry a camera decision needs — all four are LAYOUT values
 *  (offsetWidth/offsetHeight/clientWidth/clientHeight), which a CSS
 *  transform never changes (G8-J's layout column). `panelW` / `panelH`
 *  are the CLAMP BOX: the whole stage extent on a staged board (the
 *  host's `liveViewbox`), the single panel otherwise. */
export interface Viewbox {
  panelW: number;
  panelH: number;
  viewW: number;
  viewH: number;
}

/**
 * The user-gesture zoom floor for a given stage (C3): the constant floor,
 * or low enough to fit the whole stage's width — whichever is lower. On a
 * single panel `viewW === panelW` at rest, so the floor stays exactly
 * `CAMERA_MIN_Z` (C1 verbatim); with 2–4 boards side by side the constant
 * would clamp a zoom-out before all boards fit, which is precisely the
 * overview a wide stage exists for.
 */
export function cameraMinZ(box: Viewbox): number {
  return box.panelW > 0
    ? Math.min(CAMERA_MIN_Z, box.viewW / box.panelW)
    : CAMERA_MIN_Z;
}

/**
 * One axis of the clamp. While the stage is LARGER than the viewport the
 * camera roams `[0, panel - view]` — the viewport never leaves the stage.
 * Once it is SMALLER there is no roaming left to do, and the only question
 * is where the stage sits in the space it has: `span / 2` (a negative
 * number, the camera standing left of / above the stage origin) puts it in
 * the MIDDLE. Pinning to 0 instead — which is what this did until
 * 2026-08-12 — hung the whole room off the top-left corner with dead room
 * to the right, which is not how anything hangs on a wall.
 */
const clampAxis = (v: number, panel: number, view: number): number => {
  const span = panel - view;
  return span >= 0 ? clampNum(v, 0, span) : span / 2;
};

/**
 * Keep the viewport inside the panel: each axis spans `[0, panel - view/z]`
 * — at z=1 with panelW == viewW that pins x to 0 (the C1 single-panel rest
 * state), and zoomed out past the panel the stage CENTRES on that axis
 * (see `clampAxis`).
 *
 * This is the USER-gesture clamp only. A director pose is applied verbatim
 * (`viewer/camera.ts::gateCamera`) precisely so an `@overview` may sit
 * outside the stage to fit and centre everything revealed so far; that
 * exception is untouched, and `overviewPose` does its own centring.
 */
export function clampCamera(camera: CameraPose, box: Viewbox): CameraPose {
  const z = clampNum(camera.z, cameraMinZ(box), CAMERA_MAX_Z);
  const x = clampAxis(camera.x, box.panelW, box.viewW / z);
  const y = clampAxis(camera.y, box.panelH, box.viewH / z);
  return x === camera.x && y === camera.y && z === camera.z
    ? camera
    : { x, y, z };
}

/** Follow margin: air kept around the pen's line (board px; prototype 96). */
export const FOLLOW_MARGIN = 96;
/** Dead band inside the view edges before follow bothers to move (board px). */
const FOLLOW_SLACK = 40;

/**
 * THE BOARD THE PEN STANDS ON — the wall's 2D rest, supplied by every
 * WALL caller and by no strip caller.
 *
 * `h` is what turned the old `panelY` into an honest 2D statement
 * (2026-08-12, defect W4a-3a). Before it, the follow knew a board's
 * ORIGIN but not its EXTENT, so the "stand at the corner" rule had to be
 * gated on a whole board fitting the view (`boardStandsWhole`) — and on
 * any window too short for that the gate fell back to C1's chase down one
 * long strip, which has no idea rows exist. Measured on the owner's own
 * 2x2 wall in a 1600x720 window: crossing to the next ROW left the camera
 * straddling the gap with the PREVIOUS row filling five sixths of the
 * view while the pen wrote below it. With the height in hand the gate
 * dissolves into `boardBandY` — one clamp that says "stand at the corner"
 * when the board fits and "chase the pen, but never leave this board"
 * when it does not.
 */
export interface FollowBoard {
  /** The board's origin on the wall (stage px). */
  x: number;
  y: number;
  /** The board's own height (board px) — the vertical span the camera may
   *  roam while it is following the pen on this board. */
  h: number;
}

/**
 * The camera's y, kept inside the board the pen stands on. A board taller
 * than the view leaves a band to roam ( `[y, y + h - viewH]` ); a board
 * that fits leaves none, and the band collapses to the board's own corner
 * — which is the whole of the old `boardStandsWhole` rule, expressed as
 * arithmetic instead of as a branch.
 */
const boardBandY = (
  y: number,
  board: FollowBoard,
  viewH: number,
): number => clampNum(y, board.y, board.y + Math.max(0, board.h - viewH));

/** Do two follow targets stand on the same board? Two absent boards are
 *  the same board — a strip is one face and the pen never migrates on it. */
const sameBoard = (a: FollowBoard | null, b: FollowBoard | null): boolean =>
  a === null || b === null ? a === b : a.x === b.x && a.y === b.y;

/**
 * The viewport follow, re-derived on the camera (the pre-C1 showStep
 * arithmetic verbatim, with scrollTop -> y and clientHeight -> viewH/z):
 * pull down when the target's bottom crosses the lower slack line, pull up
 * when its top crosses the upper one, keep FOLLOW_MARGIN of air. Returns
 * `null` when the target is comfortably in view — no camera write at all.
 * Margins are board px on purpose: they describe air around the writing,
 * and the writing lives on the board.
 */
export function followShift(
  camera: CameraPose,
  box: Viewbox,
  target: {
    top: number;
    bottom: number;
    /**
     * C3 multi-board: the board this target stands on. When given and the
     * target is horizontally out of view, the follow walks to that board
     * — the teacher moving along the wall — and whatever the vertical
     * rules decide is then kept inside the board (`boardBandY`).
     * Single-board callers omit it (C1 behaviour, x untouched, bit for
     * bit).
     */
    board?: FollowBoard;
    left?: number;
    right?: number;
  },
): CameraPose | null {
  const viewH = box.viewH / camera.z;
  const viewTop = camera.y;
  const viewBottom = viewTop + viewH;
  let y: number | null = null;
  if (target.bottom > viewBottom - FOLLOW_SLACK) {
    y = target.bottom - viewH + FOLLOW_MARGIN;
  } else if (target.top < viewTop + FOLLOW_SLACK) {
    y = Math.max(0, target.top - FOLLOW_MARGIN);
  }
  let x: number | null = null;
  if (
    target.board !== undefined &&
    target.left !== undefined &&
    target.right !== undefined
  ) {
    const viewW = box.viewW / camera.z;
    if (target.left < camera.x || target.right > camera.x + viewW) {
      x = target.board.x;
    }
  }
  // The wall's second axis. A board is a frame, not a strip: the moment
  // this follow has decided to move at all (either the pen left the board
  // sideways, or its own vertical rule fired), the camera stands in front
  // of the target BOARD — at its corner where the board fits the view, and
  // otherwise at the chased height clamped into that board's own span, so
  // a row change can never leave the camera in the gap between rows.
  // Gated on a board being supplied — a single strip never supplies one,
  // and keeps the slack arithmetic above exactly as C1 wrote it.
  if (target.board !== undefined && (x !== null || y !== null)) {
    y = boardBandY(y ?? camera.y, target.board, viewH);
  }
  if (y === null && x === null) return null;
  return clampCamera(
    { x: x ?? camera.x, y: y ?? camera.y, z: camera.z },
    box,
  );
}

/**
 * The hand-back (C2, measured on the first G7 trace): when the register
 * decays to "follow" on a board WITH camera moves, the live camera may
 * still wear the director's residue — an @overview's z (< 1) in
 * particular. C1's followShift deliberately never touches z or x, so
 * without this step the whole rest of the lecture would keep playing at
 * overview zoom. In the "following" latch a non-1 z / non-0 x can ONLY be
 * director-written — every user camera gesture detaches first — so
 * restoring the pen camera here can never fight the user.
 *
 * Returns the re-baselined camera, or `null` when the camera already IS
 * the pen camera (no write — follow stays no-op cheap).
 *
 * `board` is the wall's second axis and is OPTIONAL for a reason: on a
 * single strip (and on C2's one-row arithmetic) the director's `y` is the
 * one thing the hand-back deliberately keeps — the reader is standing
 * where the last move left them, at the pen's height. On a wall the pen's
 * rest is a board, so the caller supplies one and the kept y is clamped
 * into it.
 *
 * `restZ` is REQUIRED, and second, on purpose (W7): the pen camera's zoom
 * used to be the literal 1 and is now `restZoom(viewW)`, so a caller that
 * forgot to supply it would silently hand the reader a cropped or floating
 * board on every window that is not exactly one board wide. Same discipline
 * as `boardRects`' required depth surface — forgetting is a compile error,
 * not a rare visual bug.
 */
export function handBackCamera(
  camera: CameraPose,
  restZ: number,
  board?: FollowBoard,
  viewH = 0,
): CameraPose | null {
  const x = board?.x ?? 0;
  const y = board ? boardBandY(camera.y, board, viewH) : camera.y;
  return camera.z !== restZ || camera.x !== x || camera.y !== y
    ? { x, y, z: restZ }
    : null;
}

/**
 * THE RE-ATTACH POSE (2026-08-12, defect W4a-3b) — where a reader who took
 * the camera and then pressed play is put back.
 *
 * The bug it replaces: re-attaching ran the ordinary `followShift`, whose
 * whole job is the SMALLEST shift that brings the pen back into view. That
 * is right for a pen advancing line by line and wrong for a reader coming
 * back, and the two failures are mirror images — come back from below the
 * pen and its newest line is pinned to the very TOP of the view with
 * nothing but blank board beneath it (the owner's 「纵向只移到能显示最新一
 * 句话的最上面」), come back from above and it sits near the bottom. Same
 * gesture, two poses, neither of them a place a person would choose to
 * stand.
 *
 * So the re-attach is CANONICAL: it does not care where the reader
 * wandered. It is the pose the performance itself would be in had they
 * never left — standing in front of the pen's board at the performance's
 * own zoom (`restZoom` — W7's generalisation of the old literal 1), with
 * the live line one FOLLOW_MARGIN above the bottom edge and its context
 * filling the view above it, exactly like the pose the follow hands a
 * reader who has been watching all along. On a board that fits the view,
 * that same sentence resolves to the whole board.
 */
export function reattachCamera(
  camera: CameraPose,
  box: Viewbox,
  target: { top: number; bottom: number; board?: FollowBoard },
): CameraPose {
  // z is restored to the REST zoom here, so the visible height is the
  // viewport's own — expressed in board px at that zoom (`viewH / z`, which
  // is `box.viewH` verbatim whenever the viewport is one board wide).
  // `box.panelW` is the CLAMP box (the whole wall on a staged board), so a
  // board's own width comes from the constant here.
  const z = restZoom(box.viewW, PANEL_WIDTH);
  const viewH = box.viewH / z;
  const y = target.bottom - viewH + FOLLOW_MARGIN;
  return clampCamera(
    {
      x: target.board?.x ?? camera.x,
      y: target.board ? boardBandY(y, target.board, viewH) : Math.max(0, y),
      z,
    },
    box,
  );
}

/** `@focus`: the performance's own zoom (`restZoom` — W7; the literal 1
 *  until the board had a size of its own), centered on the anchor step,
 *  clamped into the stage (a focus near an edge shows board, not void). Not
 *  a magnifier — 放大会让「带你去看」变成「凑近看」,另一个动作 (C2 spec).
 *  The visible extent is quoted in BOARD px (`viewW / z`), which is the one
 *  change W7 forces: at rest that is one board's width, whatever the window. */
export function focusPose(anchor: StageRect, view: StageView): CameraPose {
  const cx = (anchor.left + anchor.right) / 2;
  const cy = (anchor.top + anchor.bottom) / 2;
  const stage = stageExtent(view);
  const z = restZoom(view.viewW, view.panelW);
  const seeW = view.viewW / z;
  const seeH = view.viewH / z;
  return {
    x: clampNum(cx - seeW / 2, 0, Math.max(0, stage.w - seeW)),
    y: clampNum(cy - seeH / 2, 0, Math.max(0, stage.h - seeH)),
    z,
  };
}

/**
 * `@overview`: fit the union of everything revealed SO FAR (scrub purity —
 * no peeking at unwritten content; teaching correctness — 还没讲到的东西
 * 不该出现在总览里), centered, never magnifying past the performance's own
 * zoom (`restZoom` — W7; the literal 1 before the board had a size). The
 * cap has to move with the rest pose or an overview of a single board would
 * ZOOM OUT from where the reader was standing on any window wider than a
 * board — a "step back and look" that steps back from nothing. The fit may
 * go below the user-gesture zoom floor — an overview must show everything,
 * so the director is not clamped by `CAMERA_MIN_Z` (cf. C3's stage-extent
 * floor rule).
 */
export function overviewPose(
  union: StageRect | null,
  view: StageView,
): CameraPose {
  if (!union) return homePose(view.viewW, view.panelW);
  const w = union.right - union.left + 2 * OVERVIEW_MARGIN;
  const h = union.bottom - union.top + 2 * OVERVIEW_MARGIN;
  if (w <= 0 || h <= 0) return homePose(view.viewW, view.panelW);
  const z = Math.min(
    restZoom(view.viewW, view.panelW),
    view.viewW / w,
    view.viewH / h,
  );
  const cx = (union.left + union.right) / 2;
  const cy = (union.top + union.bottom) / 2;
  return { x: cx - view.viewW / (2 * z), y: cy - view.viewH / (2 * z), z };
}

// ────────────────────────────────────────────────────────────────────────────
// Van Wijk & Nuij (2003) — smooth zoom-pan in (pan, log-zoom) space
// ────────────────────────────────────────────────────────────────────────────

/** Below this pan distance (board px) the move is zoom-only. */
const PAN_EPS = 1e-6;

interface VwPoint {
  cx: number;
  cy: number;
  /** Viewport extent in board px (`viewW / z`) — V&N's w. */
  w: number;
}

const toVw = (p: CameraPose, view: StageView): VwPoint => ({
  cx: p.x + view.viewW / (2 * p.z),
  cy: p.y + view.viewH / (2 * p.z),
  w: view.viewW / p.z,
});

const fromVw = (q: VwPoint, view: StageView): CameraPose => {
  const z = view.viewW / q.w;
  return { x: q.cx - view.viewW / (2 * z), y: q.cy - view.viewH / (2 * z), z };
};

const cosh = Math.cosh;
const sinh = Math.sinh;
const tanh = Math.tanh;

/**
 * The ρ-metric arc length of the move `from → to` — V&N's cost function,
 * which IS the move's perceptual size. Pure of any duration.
 */
export function cameraArcLength(
  from: CameraPose,
  to: CameraPose,
  view: StageView,
  rho: number,
): number {
  const a = toVw(from, view);
  const b = toVw(to, view);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  if (d < PAN_EPS) return Math.abs(Math.log(b.w / a.w)) / rho;
  const rho2 = rho * rho;
  const b0 = (b.w * b.w - a.w * a.w + rho2 * rho2 * d * d) / (2 * a.w * rho2 * d);
  const b1 = (b.w * b.w - a.w * a.w - rho2 * rho2 * d * d) / (2 * b.w * rho2 * d);
  const r0 = Math.log(Math.hypot(b0, 1) - b0);
  const r1 = Math.log(Math.hypot(b1, 1) - b1);
  return (r1 - r0) / rho;
}

/** Seconds for one move: perceptual distance over speed (G10 family —
 *  `cameraRho` / `cameraSpeed` live in `DurationConstants`, T5-tunable). */
export function cameraMoveDuration(
  from: CameraPose,
  to: CameraPose,
  view: StageView,
  d: DurationConstants,
): number {
  return Math.abs(cameraArcLength(from, to, view, d.cameraRho)) / d.cameraSpeed;
}

/**
 * The pose at normalized progress `u ∈ [0, 1]` along the V&N path — arc
 * length grows linearly in `u` (constant perceptual velocity; the t → u
 * easing is applied by the caller). Endpoint-exact by construction at
 * u = 0 / u = 1 (returned verbatim, no float drift).
 */
export function cameraPoseAt(
  from: CameraPose,
  to: CameraPose,
  view: StageView,
  rho: number,
  u: number,
): CameraPose {
  if (u <= 0) return from;
  if (u >= 1) return to;
  const a = toVw(from, view);
  const b = toVw(to, view);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  if (d < PAN_EPS) {
    // Zoom-only: exponential in w (uniform in log-zoom), linear glide in c.
    return fromVw(
      {
        cx: a.cx + dx * u,
        cy: a.cy + dy * u,
        w: a.w * Math.exp(Math.log(b.w / a.w) * u),
      },
      view,
    );
  }
  const rho2 = rho * rho;
  const b0 = (b.w * b.w - a.w * a.w + rho2 * rho2 * d * d) / (2 * a.w * rho2 * d);
  const r0 = Math.log(Math.hypot(b0, 1) - b0);
  const b1 = (b.w * b.w - a.w * a.w - rho2 * rho2 * d * d) / (2 * b.w * rho2 * d);
  const r1 = Math.log(Math.hypot(b1, 1) - b1);
  const S = (r1 - r0) / rho;
  const s = u * S;
  const coshr0 = cosh(r0);
  const uu = (a.w / (rho2 * d)) * (coshr0 * tanh(rho * s + r0) - sinh(r0));
  return fromVw(
    {
      cx: a.cx + dx * uu,
      cy: a.cy + dy * uu,
      w: (a.w * coshr0) / cosh(rho * s + r0),
    },
    view,
  );
}

/**
 * The camera's time profile: strictly monotone cubic ease-in-out on
 * t → arc-length (G8-H — a non-monotone profile would run the camera
 * backwards under scrub). Local to the stage on purpose: the G9 table is
 * the PEN's personality; the camera is not a pen.
 */
export function easeCamera(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

// ────────────────────────────────────────────────────────────────────────────
// Resolving camera ops (document order — no times involved)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Document-order input to the resolver: every step that performs at least
 * one scheduled unit. Gap-transparent steps (`@wait`, bad, image/html,
 * fold orphans) are OMITTED by the caller — they neither decay the
 * register nor add content (the decay rule names WRITING steps).
 */
export type StageStepInput =
  | {
      kind: "write";
      /** The step's measured board rect (stage-anchor seam); `null` when
       *  unmeasured — it then feeds neither the overview union nor the
       *  follow simulation, but still DECAYS the register (it is writing). */
      rect: StageRect | null;
      /**
       * The origin of the board this step performs ON — the fold's
       * assignment, not a measurement, so it survives what `rect` cannot:
       * a hidden chart LAYER draws onto a frame standing on another board
       * and reports an all-zero client box, and the host's own camera
       * hand-back walks to this x for it (`handBackCamera`). Without it
       * the simulation would rest on the wrong board and the walk that
       * actually happens on screen would be an unscheduled cut.
       *
       * Optional and additive: when `rect` is measured its panel already
       * IS this x, so callers may omit it and C2's arithmetic is untouched.
       */
      penX?: number;
      /** The same origin's y — the wall's second axis (see `penX`).
       *  Omitted on a single strip, where the pen's rest y is the
       *  director's own and the hand-back keeps it. */
      penY?: number;
    }
  | {
      kind: "erase";
      /**
       * 擦不是写 (G1's five verbs are distinct — review P1-3): an explicit
       * erase NEVER decays the register — a latched pose holds straight
       * through the sweep, so no unscheduled camera motion opens the erase
       * window — and its sweep adds no content to the overview union.
       * `rect` is the erased BOARD's head (bottom == top — where the
       * eraser starts), the same rect the live follow walks to when the
       * register is silent; `null` when the board cannot be resolved.
       */
      rect: StageRect | null;
    }
  | {
      /**
       * `@turn` (S1) — 走位不是写, verbatim the erase classification
       * (P1-3 applied): it never decays the register (a latched `@focus`
       * pose rides through the walk), adds nothing to the overview union,
       * and with the register SILENT the live camera walks to the TARGET
       * board's head — `rect` is that head (bottom == top, the erase
       * convention); `null` when unresolvable.
       */
      kind: "turn";
      rect: StageRect | null;
    }
  | {
      /**
       * `@at` (canvas pivot V2) — a walk WITHIN one board, and the P1-3
       * family verbatim: never a decay boundary, never content, a latched
       * `@focus` pose rides straight through it.
       *
       * It carries no rect, deliberately. A turn changes which BOARD the
       * pen stands before, so the live camera must walk there or the next
       * move would depart from a stale rest; a placement moves the pen
       * across a face the camera is already looking at, and the writing
       * that follows brings the view to itself through the ordinary follow
       * (the camera returns to the pen when writing resumes). Giving the
       * walk its own destination would make the view lurch at a moment
       * nothing is written.
       */
      kind: "at";
    }
  | {
      kind: "camera";
      op: "overview" | "focus";
      /** focus: the anchor step's rect; `null` (unmeasurable) degrades the
       *  op to a no-move. Ignored for overview. */
      anchor: StageRect | null;
    };

/** One resolved camera op: the move's endpoints and its measured seconds.
 *  `index` points into the resolver's input array. A degraded op (focus
 *  with no anchor) resolves to `null` — no move, zero seconds, register
 *  untouched. */
export interface ResolvedCameraOp {
  index: number;
  move: { from: CameraPose; to: CameraPose } | null;
  duration: number;
}

/**
 * Solve every camera op's endpoints and duration in one document-order
 * walk. Pure of any timeline: poses depend on document order + rects only
 * (the C2 spec's no-circularity argument), durations on poses only.
 *
 * The decayed from-pose is a SIMULATION of the live camera (P1-4): the
 * same `followShift` the host runs, folded over the write/erase steps —
 * dead band, clamped walks, the hand-back's kept y — so an uninterrupted
 * play-through's live camera rests exactly where the next move departs.
 */
export function resolveCameraOps(
  inputs: readonly StageStepInput[],
  view: StageView,
  d: DurationConstants,
): ResolvedCameraOp[] {
  const ops: ResolvedCameraOp[] = [];
  const stage = stageExtent(view);
  /** The simulation's clamp box IS the host's `liveViewbox`: the whole
   *  stage on a staged board, the strip's own extent otherwise. */
  const box: Viewbox = {
    panelW: stage.w,
    panelH: stage.h,
    viewW: view.viewW,
    viewH: view.viewH,
  };
  const multi = Math.max(1, view.panelCount ?? 1) > 1;
  /** The board a wall rect stands on — origin AND height, so the follow
   *  can keep the camera inside it (see `FollowBoard`). `null` on a strip,
   *  which supplies no board at all and keeps C1's arithmetic. */
  const boardOf = (rect: StageRect): FollowBoard | null =>
    multi ? { ...panelOrigin(rect, view), h: view.panelH } : null;
  /** The follow target the host hands `followShift` for a rect — the
   *  horizontal walk exists only on a staged multi-board (`showStep`). */
  const target = (rect: StageRect) => {
    const board = boardOf(rect);
    if (!board) return { top: rect.top, bottom: rect.bottom };
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      board,
    };
  };
  /** Union of every measured write rect so far (the @overview subject). */
  let union: StageRect | null = null;
  /** The at-rest zoom for THIS viewport (W7) — the whole simulation runs
   *  at it, exactly as the live camera does. */
  const restZ = restZoom(view.viewW, view.panelW);
  /** The SIMULATED live camera: where the host's follow rests after each
   *  step of an uninterrupted play-through. Always at the rest zoom (HOME,
   *  follow and hand-back all keep it there). */
  let sim: CameraPose = homePose(view.viewW, view.panelW);
  /** The register's latched pose; null = decayed to follow. */
  let latched: CameraPose | null = null;
  /** The board the pen stood on at the previous step that named one — the
   *  migration test's other half (a walk is emitted when the camera
   *  travelled AND the pen changed board, never for a chase down one
   *  board's face). Seeded with the board the simulated camera starts in
   *  front of, so the first write of a lecture is not a migration; `null`
   *  on a strip, which has no boards to migrate between. */
  let penBoard: FollowBoard | null = multi
    ? { x: 0, y: 0, h: view.panelH }
    : null;

  /** The decay hand-back the host performs (`handBackCamera` + clamp):
   *  z back to the rest zoom, x to the writing board's origin, y KEPT from the
   *  director's pose on a strip and clamped into the board's own span on a
   *  wall — the live camera stands exactly there when the first write
   *  after a hold begins. `fallbackX` covers the one case with no board
   *  at all (an unmeasurable rect on a wall that named no assignment):
   *  the simulated x is kept rather than snapped to the wall's origin. */
  const decay = (board: FollowBoard | null, fallbackX: number): void => {
    if (!latched) return;
    const handed = handBackCamera(
      latched,
      restZ,
      board ?? undefined,
      view.viewH,
    );
    const next = handed ?? latched;
    sim = clampCamera(
      { x: board ? next.x : fallbackX, y: next.y, z: restZ },
      box,
    );
    latched = null;
  };

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (input.kind === "write") {
      // A board is supplied ONLY on a wall. On a strip `panelOrigin` reads
      // {0, 0} for every rect, and handing that to the hand-back would
      // destroy the director's kept y — the exact C2 behaviour the P1-4
      // dead-band trace pinned.
      const board = input.rect
        ? boardOf(input.rect)
        : multi && input.penX !== undefined
          ? { x: input.penX, y: input.penY ?? 0, h: view.panelH }
          : null;
      decay(board, input.penX ?? sim.x);
      if (!input.rect) {
        // Unmeasurable, but its BOARD is known (a hidden chart layer):
        // the host walks the camera to that board through its hand-back,
        // so the simulation walks with it — and the walk is a move like
        // any other, never a cut. On a strip `y` is kept exactly as
        // `handBackCamera` keeps it; on a wall the camera stands in front
        // of the board (its corner, or the nearest height inside it),
        // because a row change is a walk, not a scroll.
        const rest = board
          ? handBackCamera({ ...sim, z: restZ }, restZ, board, view.viewH)
          : null;
        if (rest) {
          const walked = clampCamera(rest, box);
          if (walked.x !== sim.x || walked.y !== sim.y) {
            ops.push({
              index: i,
              move: { from: sim, to: walked },
              duration: cameraMoveDuration(sim, walked, view, d),
            });
            sim = walked;
          }
        }
        if (board) penBoard = board;
        continue;
      }
      {
        const walked = followShift(sim, box, target(input.rect));
        const migrated = sameBoard(board, penBoard) === false;
        if (board) penBoard = board;
        if (walked) {
          // THE PEN MOVING TO ANOTHER BOARD IS A MOVE (2026-08-12).
          // Measured over the owner's own lecture, eleven of thirteen
          // board changes were this: the live follow chasing the pen onto
          // a different board and applying the pose instantly, because
          // C1's follow holds no animation state — which is exactly what
          // makes scrub trivially correct and must stay true. So the FOLD
          // emits the move instead, and the follow is left alone.
          //
          // Only a change of BOARD qualifies, and since 2026-08-12 the
          // test asks that question directly (`migrated`) instead of
          // reading it off the camera. It used to be "x moved, or — where
          // a whole board stood in the view — y moved", which was true
          // only because the follow's y could then be nothing but a
          // board's own corner. On a window too short for that, the y is
          // a chase INSIDE the board, so the old test read every ordinary
          // paragraph as a migration or (as it was gated) a row change as
          // none. The pen's board is known here; ask it.
          //
          // The ordinary vertical chase down one board's face stays the
          // instant C1 follow, because a glide on every paragraph would
          // be motion sickness, not teaching. And a board change that
          // needs no travel (the destination already in view) stays no
          // move at all — a zero-length glide is a tilt with no journey.
          const travelled = walked.x !== sim.x || walked.y !== sim.y;
          if (migrated && travelled) {
            ops.push({
              index: i,
              move: { from: sim, to: walked },
              duration: cameraMoveDuration(sim, walked, view, d),
            });
          }
          sim = walked;
        }
        union = union
          ? {
              left: Math.min(union.left, input.rect.left),
              top: Math.min(union.top, input.rect.top),
              right: Math.max(union.right, input.rect.right),
              bottom: Math.max(union.bottom, input.rect.bottom),
            }
          : input.rect;
      }
      continue;
    }
    if (input.kind === "at") {
      // A placement is neutral and moves nothing (see the input type).
      continue;
    }
    if (input.kind === "erase" || input.kind === "turn") {
      // 擦不是写, and neither is a turn (P1-3): never a decay boundary,
      // never content. But with the register SILENT the live camera does
      // walk to the board being wiped / turned to (showStep's board-head
      // branch) — the simulation folds the same walk, or the next move
      // would depart from a stale rest.
      if (!latched && input.rect) {
        const board = boardOf(input.rect);
        const migrated = sameBoard(board, penBoard) === false;
        if (board) penBoard = board;
        const walked = followShift(sim, box, target(input.rect));
        if (walked) {
          // `followShift` answers with a CLAMPED camera, which can equal
          // the one it was handed (a target already comfortably in view
          // still trips the upper-slack branch and resolves to the same
          // y). "It returned something" is therefore not "it travelled" —
          // and a zero-length move would be a tilt with no journey.
          const travelled =
            walked.x !== sim.x || walked.y !== sim.y || walked.z !== sim.z;
          // A sweep on ANOTHER board is a walk too (2026-08-12). Same
          // measurement, same reason as the write branch above: the hand
          // crosses the room to wipe a board, and the room crossing was
          // an instant cut — and, like the write branch, the room crossing
          // is asked of the BOARD rather than read off the camera's x.
          if (input.kind === "erase" && migrated && travelled) {
            ops.push({
              index: i,
              move: { from: sim, to: walked },
              duration: cameraMoveDuration(sim, walked, view, d),
            });
          }
          if (input.kind === "turn" && travelled) {
            // THE WALK TO THE NEXT BOARD IS A MOVE (2026-08-11). It used
            // to be one instant `applyCamera` write, and four boards
            // therefore read as four slides — the single most obvious
            // moment to show motion was the only one that had none. So a
            // turn that actually travels now resolves like any other
            // move: the same Van Wijk path, the same arc-length duration,
            // and — because `transitionDepthAt` reads the very same
            // schedule — the same transition depth, with no new mechanism
            // anywhere (css3d brief §5.1: V1.5 shipped the capability,
            // this is the teaching move that consumes it).
            //
            // Two things it deliberately does NOT do:
            //   - it does not LATCH. A turn stays 走位不是写, so a held
            //     `@focus` still rides straight through it — which is why
            //     the walk is emitted only inside this `!latched` branch:
            //     exactly, and only, where the instant cut used to be.
            //   - it does not invent travel. `followShift` returning null
            //     (the destination already in view, or unresolvable)
            //     leaves the op list untouched, so a board with nothing to
            //     walk to keeps an empty schedule — and an empty schedule
            //     is what keeps the depth surface absent at rest.
            ops.push({
              index: i,
              move: { from: sim, to: walked },
              duration: cameraMoveDuration(sim, walked, view, d),
            });
          }
          sim = walked;
        }
      }
      continue;
    }
    if (input.op === "focus" && !input.anchor) {
      // Unmeasurable anchor: schedule parity is kept (the step's window
      // still exists, zero-length), the register is untouched, nothing
      // jumps — the same degrade posture as an unpaired reveal unit.
      ops.push({ index: i, move: null, duration: 0 });
      continue;
    }
    const from = latched ?? sim;
    const to =
      input.op === "focus" ? focusPose(input.anchor!, view) : overviewPose(union, view);
    ops.push({
      index: i,
      move: { from, to },
      duration: cameraMoveDuration(from, to, view, d),
    });
    latched = to;
  }
  return ops;
}

// ────────────────────────────────────────────────────────────────────────────
// The stage schedule and the fold
// ────────────────────────────────────────────────────────────────────────────

/** One canonical-schedule entry, stage-annotated: a camera entry carries
 *  its resolved move (`null` move = degraded camera step — neutral: not a
 *  decay boundary, holds nothing); a write entry is a decay boundary; an
 *  ERASE entry is neutral too — 擦不是写 (review P1-3), a held pose rides
 *  straight through the sweep and decays only at the next write. */
export type StageEntry =
  // A write and an erase can each carry a LEAD MOVE (2026-08-12): the walk
  // to the board the pen (or the hand) has moved to. Their own window is
  // occupied — by the writing, by the sweep — so unlike a turn the walk
  // cannot ride it: it plays over `[start - lead, start)`, the dead air
  // the timeline already puts before every step, widened upstream to the
  // walk's own arc-length seconds. G1 holds by construction — the walk
  // ends exactly where the performance begins, and nothing else can be in
  // flight in a gap. `lead <= 0` means "no room", which is not a fast
  // glide but a cut, so it schedules nothing.
  | {
      kind: "write";
      start: number;
      end: number;
      move?: { from: CameraPose; to: CameraPose } | null;
      lead?: number;
    }
  | {
      kind: "erase";
      start: number;
      end: number;
      move?: { from: CameraPose; to: CameraPose } | null;
      lead?: number;
    }
  // A turn entry is neutral exactly like an erase (P1-3 family): a held
  // pose rides straight through the walk and decays only at the next
  // write — buildStageSchedule's holdUntil scan only ever breaks on
  // `"write"`, so the neutrality is structural.
  //
  // It carries a `move` since 2026-08-11: the walk to the next board IS a
  // camera move (see `resolveCameraOps`'s turn branch). The field is
  // optional and its absence is the resting case — a turn with nowhere to
  // walk contributes nothing, so a schedule without travel is unchanged.
  | {
      kind: "turn";
      start: number;
      end: number;
      move?: { from: CameraPose; to: CameraPose } | null;
    }
  // A placement entry is neutral for exactly the same reason (V2): the
  // holdUntil scan only ever breaks on `"write"`, so a held pose surviving
  // an `@at` window is structural, not a special case.
  | { kind: "at"; start: number; end: number }
  | {
      kind: "camera";
      start: number;
      end: number;
      move: { from: CameraPose; to: CameraPose } | null;
    };

/** One camera move placed on the canonical timeline. */
export interface CameraMove {
  start: number;
  end: number;
  /** When the register decays back to "follow": the start of the first
   *  WRITE entry after this move's window; +Infinity when none follows
   *  (`@wait` never appears here — it holds no schedule entry — so a wait
   *  after a camera step extends the hold for free, per the decay rule;
   *  an ERASE entry is neutral the same way — 擦不是写, P1-3 — so a pose
   *  holds straight through a sweep). */
  holdUntil: number;
  from: CameraPose;
  to: CameraPose;
}

/** Everything `stageStateAt` folds over — built once per compile, poses
 *  and times baked in, so the fold is a pure function of `(schedule, t)`. */
export interface StageSchedule {
  view: StageView;
  rho: number;
  moves: readonly CameraMove[];
}

/**
 * Zip resolved moves (already inside `entries`) with the canonical windows
 * the timeline laid out, computing each move's decay boundary.
 */
export function buildStageSchedule(
  entries: readonly StageEntry[],
  view: StageView,
  rho: number,
): StageSchedule {
  const moves: CameraMove[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    // Every move-bearing kind: a director's `@focus` / `@overview`, a
    // `@turn`'s walk to the next board, and (2026-08-12) the lead walk a
    // write or an eraser sweep takes when it has migrated to another
    // board. They differ in what WRITES the register (only the director
    // latches — `resolveCameraOps`) and in WHERE the journey fits, never
    // in how a move is played, so the fold below sees one uniform list.
    if (entry.kind === "at") continue;
    if (!entry.move) continue;
    // A turn IS its walk, so it plays over its own window. A write's
    // window is the writing and an erase's is the sweep, so their walk
    // plays over the lead-in that runs UP TO the step — one thing at a
    // time (G1). No lead, no window: a zero-length glide is a cut, and
    // scheduling one would park a held pose over the performance.
    const lead =
      entry.kind === "write" || entry.kind === "erase" ? (entry.lead ?? 0) : 0;
    const isLead = entry.kind === "write" || entry.kind === "erase";
    if (isLead && !(lead > 0)) continue;
    const start = isLead ? entry.start - lead : entry.start;
    const end = isLead ? entry.start : entry.end;
    let holdUntil = Infinity;
    // The scan opens at `i`, not `i + 1`: a WRITE carrying a lead walk is
    // its own decay boundary — the pen lands the instant the walk ends and
    // the register hands straight back to the live follow. For every other
    // kind `entries[i]` is not a write, so opening at `i` is a no-op and
    // the rule stays one rule. (An ERASE's walk therefore still HOLDS
    // through the sweep — 擦不是写, P1-3 — and decays at the next write.)
    for (let j = i; j < entries.length; j++) {
      const later = entries[j]!;
      if (later.kind === "write") {
        holdUntil = later.start;
        break;
      }
    }
    moves.push({
      start,
      end,
      holdUntil,
      from: entry.move.from,
      to: entry.move.to,
    });
  }
  return { view, rho, moves };
}

/**
 * THE FOLD — the stage state at canonical time `t`, pure in `(schedule, t)`:
 * same inputs, byte-identical output; no internal state, so any query
 * order yields the same answers (scrub correctness). Total over `t` — a
 * non-finite clock reads "follow", never NaN poses.
 *
 *  - before the first move (or with no moves at all): `"follow"` — a board
 *    with no camera verbs never leaves the C1 pen-following path;
 *  - inside a move's window `[start, end)`: the Van Wijk pose at the eased
 *    progress (the interpolation lives HERE, not in the host — the host
 *    holds no animation state, so scrub is trivially correct);
 *  - `[end, holdUntil)`: the target pose, held;
 *  - `t ≥ holdUntil`: `"follow"` (the decay rule — writing resumed).
 */
export function stageStateAt(schedule: StageSchedule, t: number): StageState {
  const moves = schedule.moves;
  if (moves.length === 0 || !Number.isFinite(t)) return FOLLOW_STATE;
  // Binary search: last move with start <= t.
  let lo = 0;
  let hi = moves.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (moves[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return FOLLOW_STATE;
  const m = moves[lo - 1]!;
  if (t < m.end) {
    // Mid-glide. A zero-length window cannot reach here (t < end fails),
    // so the progress divide is safe.
    const p = (t - m.start) / (m.end - m.start);
    const pose = cameraPoseAt(m.from, m.to, schedule.view, schedule.rho, easeCamera(p));
    return {
      camera: { kind: "pose", x: pose.x, y: pose.y, z: pose.z },
      panelOffsets: NO_OFFSETS,
    };
  }
  if (t < m.holdUntil) {
    return {
      camera: { kind: "pose", x: m.to.x, y: m.to.y, z: m.to.z },
      panelOffsets: NO_OFFSETS,
    };
  }
  return FOLLOW_STATE;
}
