/**
 * V1.5 — the board as a 3D surface.
 *
 * The two things this file exists to pin are the two the css3d brief
 * ratified, and neither is a style preference:
 *
 *   - **Depth only during a transition.** At every resting time — before
 *     the first move, between moves, on a held pose, after the decay — the
 *     pose is FLAT, because at rest a board's job is to be read and
 *     perspective taxes reading. It is enforced by the bump's VALUE at the
 *     endpoints, so the tests here hammer the endpoints.
 *   - **Parallax is a viewing pose.** It cannot reach canonical, and the
 *     type system is the first line: `transitionDepthAt` takes
 *     `(schedule, t)` and there is no parameter a mouse could enter by.
 */

import { describe, expect, test } from "bun:test";

import {
  addDepth,
  depthBump,
  depthTransformCss,
  DEPTH_PERSPECTIVE_PX,
  FLAT,
  isFlat,
  parallaxAxes,
  parallaxPose,
  PARALLAX_MAX_DEG,
  transitionDepthAt,
  TRANSITION_DOLLY_PX,
  TRANSITION_SWING_DEG,
  type DepthPose,
} from "../viewer/depth.js";
import type { CameraPose, StageSchedule, StageView } from "../engine/stage.js";

const VIEW: StageView = { viewW: 1200, viewH: 800, panelW: 1200, panelH: 900 };

const pose = (x: number, y: number, z = 1): CameraPose => ({ x, y, z });

function schedule(
  moves: {
    start: number;
    end: number;
    from: CameraPose;
    to: CameraPose;
    holdUntil?: number;
  }[],
): StageSchedule {
  return {
    view: VIEW,
    rho: Math.SQRT2,
    moves: moves.map((m) => ({
      start: m.start,
      end: m.end,
      holdUntil: m.holdUntil ?? Infinity,
      from: m.from,
      to: m.to,
    })),
  };
}

/** A long rightward pan: 3 viewport widths, so `size` saturates at 1. */
const PAN_RIGHT = schedule([
  { start: 10, end: 12, from: pose(0, 0), to: pose(3600, 0), holdUntil: 20 },
]);

describe("depthBump — the transition's envelope", () => {
  test("is exactly zero at both ends and one in the middle", () => {
    expect(depthBump(0)).toBe(0);
    expect(depthBump(1)).toBe(0);
    expect(depthBump(0.5)).toBeCloseTo(1, 12);
  });

  test("is zero outside [0, 1] — a clock past the window cannot tilt", () => {
    expect(depthBump(-0.5)).toBe(0);
    expect(depthBump(1.5)).toBe(0);
    expect(depthBump(Number.NaN)).toBe(0);
  });

  test("eases in and out: the derivative vanishes at both ends", () => {
    // sin(pi p) would leave |b'(0)| = pi — a visible click at every
    // transition boundary. Squared, both ends start and stop at rest.
    const h = 1e-4;
    expect(Math.abs((depthBump(h) - depthBump(0)) / h)).toBeLessThan(1e-3);
    expect(Math.abs((depthBump(1 - h) - depthBump(1)) / h)).toBeLessThan(1e-3);
  });

  test("is symmetric about the midpoint", () => {
    for (const p of [0.1, 0.25, 0.4]) {
      expect(depthBump(p)).toBeCloseTo(depthBump(1 - p), 12);
    }
  });
});

describe("transitionDepthAt — depth lives ONLY inside a move", () => {
  test("a board with no camera verbs is square-on at every time", () => {
    const empty = schedule([]);
    for (const t of [0, 1, 5, 1e6]) expect(transitionDepthAt(empty, t)).toBe(FLAT);
    expect(transitionDepthAt(null, 3)).toBe(FLAT);
    expect(transitionDepthAt(undefined, 3)).toBe(FLAT);
  });

  test("flat before the move, flat at its exact start", () => {
    expect(isFlat(transitionDepthAt(PAN_RIGHT, 0))).toBe(true);
    expect(isFlat(transitionDepthAt(PAN_RIGHT, 9.999))).toBe(true);
    expect(isFlat(transitionDepthAt(PAN_RIGHT, 10))).toBe(true);
  });

  test("flat at its exact end, through the held pose, and after the decay", () => {
    // THE ratified boundary: the pose the director HOLDS is square-on. A
    // held tilt would be a resting rotation, which is precisely what §2
    // forbids.
    expect(isFlat(transitionDepthAt(PAN_RIGHT, 12))).toBe(true);
    expect(isFlat(transitionDepthAt(PAN_RIGHT, 15))).toBe(true);
    expect(isFlat(transitionDepthAt(PAN_RIGHT, 19.99))).toBe(true);
    expect(isFlat(transitionDepthAt(PAN_RIGHT, 100))).toBe(true);
  });

  test("mid-transition it is NOT flat — this is the whole feature", () => {
    const mid = transitionDepthAt(PAN_RIGHT, 11);
    expect(isFlat(mid)).toBe(false);
    expect(Math.abs(mid.ry)).toBeCloseTo(TRANSITION_SWING_DEG, 6);
    expect(mid.tz).toBeCloseTo(-TRANSITION_DOLLY_PX, 6);
  });

  test("the turn follows the direction of travel; the leading edge leans in", () => {
    // Heading RIGHT: the right edge comes toward the reader, so rotateY is
    // negative (CSS positive rotateY sends the right edge AWAY).
    expect(transitionDepthAt(PAN_RIGHT, 11).ry).toBeLessThan(0);
    const left = schedule([
      { start: 0, end: 2, from: pose(3600, 0), to: pose(0, 0) },
    ]);
    expect(transitionDepthAt(left, 1).ry).toBeGreaterThan(0);
    // Heading DOWN: the bottom edge comes toward the reader (rotateX +).
    const down = schedule([
      { start: 0, end: 2, from: pose(0, 0), to: pose(0, 2400) },
    ]);
    const d = transitionDepthAt(down, 1);
    expect(d.rx).toBeGreaterThan(0);
    expect(Math.abs(d.ry)).toBeLessThan(1e-9);
  });

  test("a pure pan turns without a residual on the other axis", () => {
    const p = transitionDepthAt(PAN_RIGHT, 11);
    expect(Math.abs(p.rx)).toBeLessThan(1e-9);
  });

  test("amplitude reports the SIZE of the move", () => {
    // A tenth of a viewport of travel earns a tenth of the swing.
    const nudge = schedule([
      { start: 0, end: 2, from: pose(0, 0), to: pose(120, 0) },
    ]);
    expect(Math.abs(transitionDepthAt(nudge, 1).ry)).toBeCloseTo(
      TRANSITION_SWING_DEG * 0.1,
      6,
    );
    // And it saturates: three viewports is not three times a viewport.
    const far = schedule([
      { start: 0, end: 2, from: pose(0, 0), to: pose(36000, 0) },
    ]);
    expect(Math.abs(transitionDepthAt(far, 1).ry)).toBeCloseTo(
      TRANSITION_SWING_DEG,
      6,
    );
  });

  test("a ZOOM-ONLY move still has depth — the dolly is what gives it any", () => {
    // @focus <-> @overview never pans: same centre, different z. With no
    // direction of travel there is nothing to turn toward, so the plane
    // steps back and comes forward instead of staying dead flat.
    const cx = VIEW.viewW / 2;
    const cy = VIEW.viewH / 2;
    const zoom = schedule([
      {
        start: 0,
        end: 2,
        from: pose(cx - VIEW.viewW / 2, cy - VIEW.viewH / 2, 1),
        to: pose(cx - VIEW.viewW / (2 * 0.5), cy - VIEW.viewH / (2 * 0.5), 0.5),
      },
    ]);
    const mid = transitionDepthAt(zoom, 1);
    expect(Math.abs(mid.rx)).toBeLessThan(1e-9);
    expect(Math.abs(mid.ry)).toBeLessThan(1e-9);
    expect(mid.tz).toBeCloseTo(-TRANSITION_DOLLY_PX, 6);
    expect(isFlat(mid)).toBe(false);
  });

  test("is a pure function of (schedule, t): same t, same pose, any order", () => {
    const ts = [10.2, 11.7, 10.9, 11.1, 10.2];
    const first = ts.map((t) => transitionDepthAt(PAN_RIGHT, t));
    const again = [...ts].reverse().map((t) => transitionDepthAt(PAN_RIGHT, t));
    expect(again.reverse()).toEqual(first);
  });

  test("picks the right move out of several, and rests between them", () => {
    const two = schedule([
      { start: 0, end: 2, from: pose(0, 0), to: pose(3600, 0), holdUntil: 3 },
      { start: 6, end: 8, from: pose(3600, 0), to: pose(0, 0), holdUntil: 9 },
    ]);
    expect(transitionDepthAt(two, 1).ry).toBeLessThan(0);
    expect(isFlat(transitionDepthAt(two, 4))).toBe(true);
    expect(transitionDepthAt(two, 7).ry).toBeGreaterThan(0);
  });

  test("a zero-length window and a non-finite clock read flat, never NaN", () => {
    const degenerate = schedule([
      { start: 5, end: 5, from: pose(0, 0), to: pose(900, 0) },
    ]);
    expect(transitionDepthAt(degenerate, 5)).toBe(FLAT);
    expect(transitionDepthAt(PAN_RIGHT, Number.NaN)).toBe(FLAT);
    expect(transitionDepthAt(PAN_RIGHT, Infinity)).toBe(FLAT);
  });
});

describe("parallaxPose — the reader's viewing pose", () => {
  test("the centre of the viewport is square-on", () => {
    expect(isFlat(parallaxPose(0, 0))).toBe(true);
  });

  test("looking from the right sends the right edge away, and vice versa", () => {
    expect(parallaxPose(1, 0).ry).toBeCloseTo(PARALLAX_MAX_DEG, 9);
    expect(parallaxPose(-1, 0).ry).toBeCloseTo(-PARALLAX_MAX_DEG, 9);
    // Looking from below sends the bottom away (CSS rotateX negative).
    expect(parallaxPose(0, 1).rx).toBeCloseTo(-PARALLAX_MAX_DEG, 9);
    expect(parallaxPose(0, -1).rx).toBeCloseTo(PARALLAX_MAX_DEG, 9);
  });

  test("never dollies: parallax must not change the board's apparent size", () => {
    for (const [nx, ny] of [
      [1, 1],
      [-1, 0.3],
      [0.5, -0.9],
    ] as const) {
      expect(parallaxPose(nx, ny).tz).toBe(0);
    }
  });

  test("clamps rather than extrapolates — a pointer leaving at speed cannot fling the board", () => {
    expect(parallaxPose(50, 0).ry).toBeCloseTo(PARALLAX_MAX_DEG, 9);
    expect(parallaxPose(0, -50).rx).toBeCloseTo(PARALLAX_MAX_DEG, 9);
  });

  test("amplitude zero IS off — the knob turns all the way down", () => {
    expect(parallaxPose(1, 1, 0)).toBe(FLAT);
    expect(isFlat(parallaxPose(-1, 1, 0))).toBe(true);
  });

  test("non-finite input reads flat, never NaN", () => {
    expect(parallaxPose(Number.NaN, 0)).toBe(FLAT);
    expect(parallaxPose(0, Infinity)).toBe(FLAT);
  });
});

describe("parallaxAxes — pointer to normalised viewport coordinates", () => {
  const box = { left: 100, top: 50, width: 800, height: 400 };

  test("the centre reads (0, 0), the corners read (±1, ±1)", () => {
    expect(parallaxAxes(box, 500, 250)).toEqual({ nx: 0, ny: 0 });
    expect(parallaxAxes(box, 100, 50)).toEqual({ nx: -1, ny: -1 });
    expect(parallaxAxes(box, 900, 450)).toEqual({ nx: 1, ny: 1 });
  });

  test("outside the box clamps to the edge", () => {
    expect(parallaxAxes(box, -1000, 250).nx).toBe(-1);
    expect(parallaxAxes(box, 5000, 250).nx).toBe(1);
  });

  test("a degenerate box reads centre, never NaN", () => {
    const zero = { left: 0, top: 0, width: 0, height: 0 };
    expect(parallaxAxes(zero, 10, 10)).toEqual({ nx: 0, ny: 0 });
  });
});

describe("depthTransformCss — absent at rest, one perspective when not", () => {
  test("the resting board produces NO transform at all", () => {
    // Not "identity" — EMPTY. An identity 3D transform would still mint a
    // 3D rendering context over a 4300px board at rest, which is the
    // compositing question C1 deliberately left closed (brief §6-3).
    expect(depthTransformCss(FLAT)).toBe("");
    expect(depthTransformCss({ rx: 0, ry: 0, tz: 0 })).toBe("");
  });

  test("a tilted pose carries exactly one perspective(), first", () => {
    const css = depthTransformCss({ rx: 1, ry: -2, tz: -30 });
    expect(css.startsWith(`perspective(${DEPTH_PERSPECTIVE_PX}px)`)).toBe(true);
    expect(css.match(/perspective\(/g)!.length).toBe(1);
    expect(css).toBe(
      `perspective(${DEPTH_PERSPECTIVE_PX}px) rotateX(1deg) rotateY(-2deg) translateZ(-30px)`,
    );
  });

  test("quantised so a still board writes a stable string", () => {
    const css = depthTransformCss({ rx: 1 / 3, ry: 0, tz: 0 });
    expect(css).toContain("rotateX(0.333deg)");
  });
});

describe("addDepth — the director and the reader compose", () => {
  test("adds componentwise and leaves FLAT as the identity", () => {
    const a: DepthPose = { rx: 1, ry: 2, tz: -30 };
    expect(addDepth(a, FLAT)).toEqual(a);
    expect(addDepth(FLAT, a)).toEqual(a);
    expect(addDepth(a, { rx: -1, ry: 1, tz: -10 })).toEqual({
      rx: 0,
      ry: 3,
      tz: -40,
    });
  });

  test("a parallax pose cannot change the director's transition depth", () => {
    // The type system says it first — `transitionDepthAt(schedule, t)` has
    // no parameter a pointer could enter by — and this is the behavioural
    // half: whatever the reader's pose, the director's is the same.
    const director = transitionDepthAt(PAN_RIGHT, 11);
    for (const [nx, ny] of [
      [0, 0],
      [1, -1],
      [-0.7, 0.4],
    ] as const) {
      void parallaxPose(nx, ny);
      expect(transitionDepthAt(PAN_RIGHT, 11)).toEqual(director);
    }
  });
});
