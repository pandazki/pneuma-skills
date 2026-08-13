/**
 * depth.ts (V1.5) — the board as a surface in three dimensions.
 *
 * Two producers, one pose type, one CSS surface:
 *
 *   1. THE DIRECTOR'S TRANSITION DEPTH — a pure function of `(schedule, t)`,
 *      exactly like every other stage animation in this mode. It is zero at
 *      both ends of a camera move and peaks in the middle, because of the
 *      ratified boundary (css3d brief §2): **depth appears only during a
 *      transition; at rest a board faces the reader square-on with unskewed
 *      text.** At rest a board's job is to be READ, and perspective taxes
 *      reading. So a rotation here is a mid-transition value of an easing
 *      function — never a resting state, never a pose anything can latch.
 *
 *   2. THE VIEWER'S PARALLAX POSE — where the mouse is. This is a VIEWING
 *      POSE, the same family as the wheel and the grab, and it must never
 *      reach canonical (brief §5.2-1): letting it in would mean where the
 *      mouse happens to be rewrites the timeline, and R8 breaks on the spot.
 *      Structurally that is enforced by what this module does NOT export —
 *      there is no path from a parallax pose into `stageStateAt`, and
 *      `transitionDepthAt` cannot see one: its signature is `(schedule, t)`.
 *
 * Both fold into ONE `DepthPose` written to ONE surface (`.bansho-depth`,
 * the stage's parent). Two invariants make that safe:
 *
 *   - **Absent at rest.** `depthTransformCss(FLAT)` is the empty string, and
 *     the host writes it as an empty inline `transform` — so with no move in
 *     flight and parallax off there is no `perspective`, no 3D surface, and
 *     no compositing decision to make. The V1 layout baseline is byte-
 *     identical BY CONSTRUCTION, not by tolerance.
 *   - **Outside the camera.** `.bansho-stage` keeps wearing exactly
 *     `cameraCss(camera)` and nothing else. Every G8-J argument about the
 *     stage's one transform survives untouched, and the funnel's
 *     same-frame scale still means what it meant.
 *
 * Measurement (brief §5.2-2) is the third invariant and it lives next door:
 * `getBoundingClientRect` is affected by transforms and a 3D rotation is
 * projective, so no single scalar can undo it. Rect reads therefore run with
 * this surface suspended — `stage-measure.ts::withDepthSuspended`.
 */

import type { StageSchedule } from "../engine/stage.js";

/**
 * A board surface's orientation. Degrees for the rotations (CSS's unit, so
 * the string builder is a straight interpolation), px for the dolly.
 *
 * Sign conventions, spelled out because CSS's are not symmetric:
 *   - `rotateY(+θ)` sends the RIGHT edge away from the reader.
 *   - `rotateX(+θ)` brings the BOTTOM edge toward the reader.
 *   - `translateZ(-d)` pushes the whole plane away (it shrinks under
 *     perspective — a dolly, not a zoom: the camera's `z` is untouched).
 */
export interface DepthPose {
  /** Degrees about the horizontal axis. */
  rx: number;
  /** Degrees about the vertical axis. */
  ry: number;
  /** Px along the view axis; negative = away from the reader. */
  tz: number;
}

/** Square-on and at the projection plane — the resting board. */
export const FLAT: DepthPose = Object.freeze({ rx: 0, ry: 0, tz: 0 });

/**
 * The one perspective source, on the plane's own transform rather than as a
 * `perspective` PROPERTY on an ancestor. Two reasons, both load-bearing:
 * the property would have to be present at rest (a permanent stacking
 * context over a 4300px board — the compositing question C1 deliberately
 * left closed), and every board then shares ONE vanishing point instead of
 * minting one per board, which is the difference between real depth and a
 * fan of postcards.
 *
 * 1600px against a ~1200px board reads as a mild wide-angle: enough
 * foreshortening to be unmistakable when the plane turns, not so much that
 * a few degrees throw the far edge across the room.
 */
export const DEPTH_PERSPECTIVE_PX = 1600;

/** Below this a pose is the resting board — no surface, no transform. */
const FLAT_EPS = 1e-4;

export function isFlat(pose: DepthPose): boolean {
  return (
    Math.abs(pose.rx) < FLAT_EPS &&
    Math.abs(pose.ry) < FLAT_EPS &&
    Math.abs(pose.tz) < FLAT_EPS
  );
}

/** Sum two poses. Small angles compose additively to within a fraction of a
 *  degree, and both terms here are single digits — the director's swing and
 *  the reader's parallax add the way two small nudges do. */
export function addDepth(a: DepthPose, b: DepthPose): DepthPose {
  return { rx: a.rx + b.rx, ry: a.ry + b.ry, tz: a.tz + b.tz };
}

/** Round to 1/1000 deg / px so the written string is stable frame to frame
 *  (a transform that churns in the 15th decimal defeats every diff). */
const q = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * The transform string for a pose — EMPTY for the resting board, which is
 * what keeps the 3D surface absent at rest rather than "identity at rest".
 */
export function depthTransformCss(
  pose: DepthPose,
  perspectivePx: number = DEPTH_PERSPECTIVE_PX,
): string {
  if (isFlat(pose)) return "";
  return (
    `perspective(${perspectivePx}px)` +
    ` rotateX(${q(pose.rx)}deg)` +
    ` rotateY(${q(pose.ry)}deg)` +
    ` translateZ(${q(pose.tz)}px)`
  );
}

// ── 1. The director's transition depth ──────────────────────────────────────

/**
 * Peak swing of a full-viewport-or-longer camera move, degrees. Small on
 * purpose: this is 过渡感, not a carousel. At 1600px perspective a 6° turn
 * displaces the far edge of a 1242px board by ~65px — plainly visible as
 * depth, nowhere near a flip.
 */
export const TRANSITION_SWING_DEG = 6;

/** Peak dolly of a camera move, px away from the reader. The plane steps
 *  back to travel and comes forward to be read — it is what gives a
 *  ZOOM-ONLY move (`@focus` ⇄ `@overview`, no pan) any depth at all, since
 *  a zoom has no direction of travel to turn toward. */
export const TRANSITION_DOLLY_PX = 90;

/**
 * The bump: 0 → 1 → 0 across a transition, with ZERO derivative at both
 * ends. `sin²(πp)` and not `sin(πp)`, because the latter leaves the board
 * turning at full rate the instant a move starts and stopping dead when it
 * ends — two visible clicks per transition. Squared, the board eases into
 * the tilt and eases out of it, and the endpoints are exactly flat: the
 * ratified boundary is enforced by the function's VALUE at p ∈ {0, 1}, not
 * by a conditional anyone can forget.
 */
export function depthBump(p: number): number {
  if (!(p > 0) || p >= 1) return 0;
  const s = Math.sin(Math.PI * p);
  return s * s;
}

/**
 * The stage's depth at canonical time `t` — FLAT everywhere except inside a
 * camera move's window. Pure in `(schedule, t)` exactly like `stageStateAt`,
 * so scrub is trivially correct: dragging the playhead through a transition
 * shows the tilt exactly as playback does, and dropping it anywhere else
 * shows a square-on board.
 *
 * Deliberately NOT folded into `StageState`. `stageStateAt` is a canonical
 * contract (`engine/stage.ts`), and V1.5's whole boundary is that it moves
 * no canonical: the depth is a rendering consequence of a move that is
 * already in canonical, derived beside it, never stored in it.
 *
 * The turn direction is the direction of TRAVEL, and the leading edge comes
 * toward the reader: heading right, the right edge leans in; heading down,
 * the bottom leans in. The amplitude scales with how far the move travels
 * relative to a viewport — a nudge tilts a little, a leap across the wall
 * tilts fully — so the depth reports the SIZE of the move, which is the one
 * thing a reader needs from a transition they did not ask for.
 */
export function transitionDepthAt(
  schedule: StageSchedule | null | undefined,
  t: number,
  swingDeg: number = TRANSITION_SWING_DEG,
  dollyPx: number = TRANSITION_DOLLY_PX,
): DepthPose {
  if (!schedule || schedule.moves.length === 0 || !Number.isFinite(t)) {
    return FLAT;
  }
  const moves = schedule.moves;
  // Same binary search as the fold: last move with start <= t.
  let lo = 0;
  let hi = moves.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (moves[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return FLAT;
  const m = moves[lo - 1]!;
  if (t >= m.end) return FLAT; // held pose, or decayed to follow — square-on.
  const span = m.end - m.start;
  if (!(span > 0)) return FLAT;
  const bump = depthBump((t - m.start) / span);
  if (bump === 0) return FLAT;

  const { view } = schedule;
  // Viewport CENTRES, board px — the same (cx, cy) the Van Wijk path is
  // parameterised in, so "how far did the camera travel" means the same
  // thing here as it does to the arc length.
  const fromCx = m.from.x + view.viewW / (2 * m.from.z);
  const fromCy = m.from.y + view.viewH / (2 * m.from.z);
  const toCx = m.to.x + view.viewW / (2 * m.to.z);
  const toCy = m.to.y + view.viewH / (2 * m.to.z);
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;
  const travel = Math.hypot(dx, dy);

  // One viewport-width of travel earns the full swing; the reference width
  // is quoted at the move's mean zoom, so the same gesture on a zoomed-out
  // board is not read as a bigger journey than it looks.
  const meanZ = (m.from.z + m.to.z) / 2;
  const reference = meanZ > 0 ? view.viewW / meanZ : view.viewW;
  const size =
    travel > 0 && reference > 0 ? Math.min(1, travel / reference) : 0;

  const amp = swingDeg * size * bump;
  return {
    rx: travel > 0 ? (amp * dy) / travel : 0,
    ry: travel > 0 ? (-amp * dx) / travel : 0,
    tz: -dollyPx * bump,
  };
}

// ── 2. The reader's parallax pose ───────────────────────────────────────────

/**
 * Peak parallax tilt, degrees. Deliberately smaller than the transition
 * swing: the transition is an event a reader watches, the parallax is a
 * condition they live in, and a picture that follows the mouse is genuinely
 * unpleasant to a vestibular-sensitive reader (brief §5.2-3). Reduced
 * motion turns the whole surface off upstream; this constant is the "小幅度"
 * knob for everyone else, and setting it to 0 is exactly "off".
 */
export const PARALLAX_MAX_DEG = 4;

const clamp1 = (n: number): number => (n < -1 ? -1 : n > 1 ? 1 : n);

/**
 * The pose for a pointer at `(nx, ny)`, each normalised to [-1, 1] across
 * the viewport (0, 0 = centre). Off-viewport input is clamped rather than
 * extrapolated: a pointer that leaves at speed must not fling the board.
 *
 * The mapping is "your head moved", not "the board is a joystick": pointer
 * to the RIGHT means looking from the right, so the right edge recedes
 * (`ry = +`); pointer DOWN means looking from below, so the bottom recedes
 * (`rx = -`). Get this backwards and the depth reads as a rubber sheet.
 *
 * No dolly: a parallax that also moved the plane toward the reader would
 * change its apparent SIZE with the mouse, and size is how this board says
 * "this is what you are reading".
 */
export function parallaxPose(
  nx: number,
  ny: number,
  maxDeg: number = PARALLAX_MAX_DEG,
): DepthPose {
  if (!(maxDeg > 0) || !Number.isFinite(nx) || !Number.isFinite(ny)) {
    return FLAT;
  }
  return { rx: -maxDeg * clamp1(ny), ry: maxDeg * clamp1(nx), tz: 0 };
}

/**
 * Pointer client coordinates → normalised viewport coordinates. The
 * viewport is the depth surface's PARENT and is never transformed, so this
 * is a plain origin shift — the same reason `viewportPoint` can live where
 * it does (G8-J). Degenerate boxes read centre, never NaN.
 */
export function parallaxAxes(
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { nx: number; ny: number } {
  const nx =
    box.width > 0 ? clamp1((2 * (clientX - box.left)) / box.width - 1) : 0;
  const ny =
    box.height > 0 ? clamp1((2 * (clientY - box.top)) / box.height - 1) : 0;
  return { nx, ny };
}
