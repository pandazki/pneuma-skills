/**
 * stage.ts (C2) — pose resolution, the Van Wijk & Nuij camera path, and the
 * `stageStateAt` fold.
 *
 * The two properties this file exists to pin:
 *
 *  1. FOLD PURITY — `stageStateAt` is a pure function of `(schedule, t)`:
 *     same inputs → byte-identical output, and a lookup at `t` must not
 *     depend on which `t` values were queried before (shuffled query
 *     orders, cross-checked against a fresh instance). This is what makes
 *     scrub correct.
 *
 *  2. THE REGISTER SAYS "FOLLOW" — a board with no camera verbs folds to
 *     "follow" at every t, and a `@focus` decays back to "follow" when
 *     writing resumes. The naive "pose of the last camera step" fold would
 *     freeze the camera at the initial pose (killing C1's pen follow) and
 *     pin it after one @focus forever (the camera-latch bug, semantically
 *     resurrected) — both regressions are pinned here.
 */

import { describe, expect, test } from "bun:test";

import { DEFAULT_DURATIONS } from "../engine/duration.js";
import {
  homePose,
  OVERVIEW_MARGIN,
  buildStageSchedule,
  cameraArcLength,
  cameraMoveDuration,
  cameraPoseAt,
  easeCamera,
  focusPose,
  overviewPose,
  panelOrigin,
  resolveCameraOps,
  stageExtent,
  stageStateAt,
  type CameraPose,
  type StageEntry,
  type StageSchedule,
  type StageStepInput,
  type StageView,
} from "../engine/stage.js";
import type { StageRect } from "../engine/types.js";

const D = DEFAULT_DURATIONS;
const VIEW: StageView = { viewW: 1400, viewH: 900, panelW: 1400, panelH: 6000 };

const rect = (top: number, bottom: number, left = 0, right = 1400): StageRect => ({
  left,
  top,
  right,
  bottom,
});

const write = (top: number, bottom: number): StageStepInput => ({
  kind: "write",
  rect: rect(top, bottom),
});
const focus = (anchor: StageRect | null): StageStepInput => ({
  kind: "camera",
  op: "focus",
  anchor,
});
const overview = (): StageStepInput => ({
  kind: "camera",
  op: "overview",
  anchor: null,
});

// ────────────────────────────────────────────────────────────────────────────
// Pose arithmetic
// ────────────────────────────────────────────────────────────────────────────

describe("pose arithmetic", () => {
  test("focusPose — z = 1, centered on the anchor, clamped into the panel", () => {
    const pose = focusPose(rect(2000, 2200), VIEW);
    expect(pose.z).toBe(1);
    expect(pose.y).toBe(2100 - 450); // vertical center of the anchor step
    expect(pose.x).toBe(0); // panelW == viewW at z=1 → pinned
    // An anchor at the very top cannot center without showing void.
    expect(focusPose(rect(0, 100), VIEW).y).toBe(0);
  });

  test("overviewPose — fits content-so-far, centered, never magnifying", () => {
    // Tall content: must zoom out to fit the height.
    const tall = overviewPose(rect(0, 3600), VIEW);
    expect(tall.z).toBeCloseTo(900 / (3600 + 2 * OVERVIEW_MARGIN), 10);
    expect(tall.z).toBeLessThan(1);
    // Content already fitting: capped at 1 (an overview never zooms in).
    const short = overviewPose(rect(0, 400, 0, 600), VIEW);
    expect(short.z).toBe(1);
    // Empty board: home.
    expect(overviewPose(null, VIEW)).toEqual(homePose(VIEW.viewW, VIEW.panelW));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// C3 — the multi-board stage
// ────────────────────────────────────────────────────────────────────────────

describe("multi-board stage geometry (C3)", () => {
  // Three boards, panel = viewport width, 32px gaps. Since the wall became
  // a ROOM (engine/wall.ts) three boards stand two over one, so board 2 is
  // BELOW board 0 rather than two pitches to its right — the arrangement
  // is `wall.test.ts`'s subject; here it is only the input.
  const WIDE: StageView = {
    viewW: 1400,
    viewH: 900,
    panelW: 1400,
    // Shorter than the viewport, which is what a wall board is: its height
    // is a fixed fraction of its width, and its width is the viewport's.
    // A board that fits collapses `stage.ts::boardBandY`'s roaming band to
    // the board's own corner, which is what "standing in front of one"
    // means here.
    panelH: 720,
    panelCount: 3,
    panelGap: 32,
  };
  const pitchX = 1400 + 32;
  const pitchY = 720 + 32;

  test("stageExtent — one panel at count 1 (C2 verbatim), the whole ROOM above it", () => {
    expect(stageExtent(VIEW)).toEqual({ w: VIEW.panelW, h: VIEW.panelH });
    expect(stageExtent(WIDE)).toEqual({
      w: 2 * 1400 + 32,
      h: 2 * 720 + 32,
    });
  });

  test("panelOrigin — EXACTLY the origin at count 1 (single-panel poses keep C2 bit for bit)", () => {
    // An ink-anchored narrow rect off to one side must not move the camera.
    expect(panelOrigin(rect(100, 200, 900, 1100), VIEW)).toEqual({ x: 0, y: 0 });
    expect(panelOrigin(rect(0, 100), VIEW)).toEqual({ x: 0, y: 0 });
  });

  test("panelOrigin — the board a rect lives on, by its center, in both axes", () => {
    expect(panelOrigin(rect(0, 100, 100, 500), WIDE)).toEqual({ x: 0, y: 0 });
    expect(panelOrigin(rect(0, 100, pitchX + 100, pitchX + 500), WIDE)).toEqual({
      x: pitchX,
      y: 0,
    });
    // The third board is on the second ROW, at the left of the wall.
    expect(
      panelOrigin(rect(pitchY + 100, pitchY + 500, 100, 500), WIDE),
    ).toEqual({ x: 0, y: pitchY });
  });

  test("the decayed from-pose rests on the writing board's origin, not on board 1 (follow walk simulated)", () => {
    const ops = resolveCameraOps(
      [
        {
          kind: "write",
          rect: rect(pitchY + 500, pitchY + 700, 44, 900),
        },
        focus(rect(0, 200)),
      ],
      WIDE,
      D,
    );
    // The pen wrote on board 2 while the simulated camera stood at HOME:
    // the follow walks to that board (the teacher moving along the wall —
    // and, now that the wall has rows, DOWN it), and the next move departs
    // from exactly there.
    //
    // Since 2026-08-12 that walk is itself a resolved move (a write that
    // migrates to another board is a journey, not a cut), so the ops list
    // opens with it and the FOCUS — the departure this test is about — is
    // the second entry. The claim is unchanged: index 1 departs from the
    // pen's rest, board 2's origin.
    expect(ops.map((o) => o.index)).toEqual([0, 1]);
    const op = ops[1];
    expect(op!.move!.from.x).toBe(0);
    // Board 2's corner, as far down the wall as the clamp allows: this
    // room is only 1472 tall and the viewport 900, so standing in front
    // of the second row bottoms out against the wall's own extent.
    expect(op!.move!.from.y).toBe(stageExtent(WIDE).h - WIDE.viewH);
    expect(op!.move!.from.z).toBe(1);
  });

  test("focusPose clamps into the whole STAGE, not one panel", () => {
    // An anchor on the last board: y may exceed panelH but not the stage.
    const pose = focusPose(
      rect(pitchY + 100, pitchY + 300, 100, 600),
      WIDE,
    );
    expect(pose.y).toBeGreaterThan(0);
    expect(pose.y).toBeLessThanOrEqual(stageExtent(WIDE).h - WIDE.viewH);
    // Single-panel clamps are unchanged (C2's tests above pin the rest).
    expect(focusPose(rect(2000, 2200), VIEW).x).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Van Wijk & Nuij path + metric
// ────────────────────────────────────────────────────────────────────────────

describe("Van Wijk & Nuij camera path", () => {
  const a: CameraPose = { x: 0, y: 0, z: 1 };
  const near: CameraPose = { x: 0, y: 400, z: 1 };
  const far: CameraPose = { x: 0, y: 4200, z: 1 };

  test("the metric is perceptual: near nudges are short, cross-board jumps long", () => {
    const sNear = cameraArcLength(a, near, VIEW, D.cameraRho);
    const sFar = cameraArcLength(a, far, VIEW, D.cameraRho);
    expect(sNear).toBeGreaterThan(0);
    expect(sFar).toBeGreaterThan(sNear * 2);
    // Symmetric: the way back costs the same.
    expect(cameraArcLength(near, a, VIEW, D.cameraRho)).toBeCloseTo(sNear, 10);
    // No move, no cost.
    expect(cameraArcLength(a, a, VIEW, D.cameraRho)).toBe(0);
    expect(cameraMoveDuration(a, a, VIEW, D)).toBe(0);
  });

  test("zoom-only moves cost log-zoom distance", () => {
    // Same CENTER (700, 450), half the zoom: x/y shift so the view widens
    // about the point being looked at — that is what "zoom-only" means in
    // the top-left-anchored camera model.
    const out: CameraPose = { x: -700, y: -450, z: 0.5 };
    expect(cameraArcLength(a, out, VIEW, D.cameraRho)).toBeCloseTo(
      Math.log(2) / D.cameraRho,
      10,
    );
  });

  test("endpoints are exact; the long-pan path zooms OUT mid-flight (the anti-lurch signature)", () => {
    expect(cameraPoseAt(a, far, VIEW, D.cameraRho, 0)).toEqual(a);
    expect(cameraPoseAt(a, far, VIEW, D.cameraRho, 1)).toEqual(far);
    const mid = cameraPoseAt(a, far, VIEW, D.cameraRho, 0.5);
    // Both endpoints sit at z = 1; a linear interpolation would keep z = 1
    // the whole way (the queasy version). The V&N path pulls back.
    expect(mid.z).toBeLessThan(1);
    expect(mid.y).toBeGreaterThan(a.y);
    expect(mid.y).toBeLessThan(far.y);
  });

  test("pan progress is strictly monotone along the path", () => {
    let prev = -Infinity;
    for (let k = 0; k <= 100; k++) {
      const p = cameraPoseAt(a, far, VIEW, D.cameraRho, k / 100);
      const cy = p.y + VIEW.viewH / (2 * p.z); // center, the V&N coordinate
      expect(cy).toBeGreaterThan(prev);
      prev = cy;
    }
  });

  test("easeCamera is strictly monotone on [0,1] with exact endpoints (G8-H)", () => {
    expect(easeCamera(0)).toBe(0);
    expect(easeCamera(1)).toBe(1);
    let prev = easeCamera(0);
    for (let k = 1; k <= 150; k++) {
      const v = easeCamera(k / 150);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveCameraOps — the pose chain (from-pose + decay, document order)
// ────────────────────────────────────────────────────────────────────────────

describe("resolveCameraOps — pose chain", () => {
  test("first camera op departs from the follow proxy of the last write", () => {
    const [op] = resolveCameraOps(
      [write(0, 300), write(1800, 2100), focus(rect(0, 200))],
      VIEW,
      D,
    );
    // The simulated follow rests where the LIVE follow rests: the second
    // write crossed the fold, so followShift pulled the camera to
    // bottom − viewH + margin = 2100 − 900 + 96.
    expect(op!.move!.from).toEqual({ x: 0, y: 1296, z: 1 });
    expect(op!.move!.to).toEqual(focusPose(rect(0, 200), VIEW));
    expect(op!.duration).toBeGreaterThan(0);
  });

  test("camera before any content departs from HOME", () => {
    const [op] = resolveCameraOps([overview()], VIEW, D);
    expect(op!.move!.from).toEqual(homePose(VIEW.viewW, VIEW.panelW));
    expect(op!.move!.to).toEqual(homePose(VIEW.viewW, VIEW.panelW)); // empty union → home
    expect(op!.duration).toBe(0);
  });

  test("latched chain: camera→camera with no writing between departs from the previous TARGET", () => {
    const ops = resolveCameraOps(
      [write(0, 3600), focus(rect(0, 200)), overview()],
      VIEW,
      D,
    );
    expect(ops[1]!.move!.from).toEqual(ops[0]!.move!.to);
  });

  test("decayed chain: writing between two camera ops re-anchors the from-pose on the pen", () => {
    const ops = resolveCameraOps(
      [write(0, 3600), focus(rect(0, 200)), write(3600, 3900), overview()],
      VIEW,
      D,
    );
    // NOT the stale focus target — the pen moved on. The hand-back kept
    // the focus target's y (0) and z back to 1; the write at 3600..3900
    // then crossed the fold, so the follow pulled to 3900 − 900 + 96.
    expect(ops[1]!.move!.from).not.toEqual(ops[0]!.move!.to);
    expect(ops[1]!.move!.from).toEqual({ x: 0, y: 3096, z: 1 });
  });

  test("the dead band is respected: a decayed write already in view moves NOTHING — the next move departs from the real camera rest (review P1-4)", () => {
    // The review's reproduction. The director parks the camera, writing
    // resumes with a rect fully inside the view: the LIVE follow's dead
    // band keeps the camera still, so the canonical from-pose must be the
    // held position — the old absolute proxy would have opened the next
    // move with a visible jump to bottom − viewH + margin.
    const ops = resolveCameraOps(
      [
        write(0, 3600),
        focus(rect(1200, 1400)), // parks at y = 1300 − 450 = 850
        write(1100, 1150), // decays; visible from y=850 → follow no-op
        overview(),
      ],
      VIEW,
      D,
    );
    expect(ops[0]!.move!.to).toEqual({ x: 0, y: 850, z: 1 });
    // The old proxy said 1150 − 900 + 96 = 346 — a 504px opening jump.
    expect(ops[1]!.move!.from).toEqual({ x: 0, y: 850, z: 1 });
  });

  test("@overview fits content-so-far only — later writes never leak in (scrub purity)", () => {
    const ops = resolveCameraOps(
      [write(0, 1000), overview(), write(1000, 9000), overview()],
      VIEW,
      D,
    );
    expect(ops[0]!.move!.to).toEqual(overviewPose(rect(0, 1000), VIEW));
    expect(ops[1]!.move!.to).toEqual(overviewPose(rect(0, 9000), VIEW));
    expect(ops[0]!.move!.to.z).toBeGreaterThan(ops[1]!.move!.to.z);
  });

  test("an unmeasurable focus anchor degrades to a no-move with zero seconds, register untouched", () => {
    const ops = resolveCameraOps(
      [write(0, 3600), focus(rect(100, 300)), focus(null), overview()],
      VIEW,
      D,
    );
    expect(ops[1]).toEqual({ index: 2, move: null, duration: 0 });
    // The broken op did not decay the latch: overview still chains from
    // the first focus target.
    expect(ops[2]!.move!.from).toEqual(ops[0]!.move!.to);
  });

  test("擦不是写 — an erase never decays the latch: the next camera op still chains from the held pose (review P1-3)", () => {
    const ops = resolveCameraOps(
      [
        write(0, 3600),
        focus(rect(0, 200)),
        { kind: "erase", rect: rect(0, 0) },
        overview(),
      ],
      VIEW,
      D,
    );
    // The sweep between the two camera ops changed NOTHING the register
    // sees: the overview departs from the focus target, exactly as if the
    // erase were not there (a latched pose holds straight through a
    // sweep — G1's five verbs are distinct).
    expect(ops[1]!.move!.from).toEqual(ops[0]!.move!.to);
  });

  test("an erase adds nothing to the overview union — a wiped board is not content (review P1-3)", () => {
    const withErase = resolveCameraOps(
      [
        write(1000, 1400),
        { kind: "erase", rect: rect(0, 0, 0, 1400) },
        write(1400, 1800),
        overview(),
      ],
      VIEW,
      D,
    );
    const without = resolveCameraOps(
      [write(1000, 1400), write(1400, 1800), overview()],
      VIEW,
      D,
    );
    expect(withErase[0]!.move!.to).toEqual(without[0]!.move!.to);
  });

  test("an unmeasured write rect still decays the register", () => {
    const ops = resolveCameraOps(
      [
        write(0, 3600),
        focus(rect(0, 200)),
        { kind: "write", rect: null },
        overview(),
      ],
      VIEW,
      D,
    );
    // Decayed — the hand-back keeps the DIRECTOR's y (the live camera
    // stood on the focus target when writing resumed), and with no rect
    // the follow cannot move: the next move departs from exactly there.
    expect(ops[1]!.move!.from).toEqual({ x: 0, y: 0, z: 1 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildStageSchedule — decay boundaries on the canonical timeline
// ────────────────────────────────────────────────────────────────────────────

const move = (from: CameraPose, to: CameraPose) => ({ from, to });
const P1: CameraPose = { x: 0, y: 1000, z: 1 };
const P2: CameraPose = { x: 0, y: 0, z: 0.5 };

describe("buildStageSchedule", () => {
  test("holdUntil = the first WRITE entry after the window; Infinity when none", () => {
    const entries: StageEntry[] = [
      { kind: "write", start: 0, end: 4 },
      { kind: "camera", start: 5, end: 6, move: move(homePose(VIEW.viewW, VIEW.panelW), P1) },
      { kind: "camera", start: 6.5, end: 7.5, move: move(P1, P2) },
      { kind: "write", start: 9, end: 11 },
      { kind: "camera", start: 12, end: 13, move: move(homePose(VIEW.viewW, VIEW.panelW), P1) },
    ];
    const sched = buildStageSchedule(entries, VIEW, D.cameraRho);
    expect(sched.moves.length).toBe(3);
    expect(sched.moves[0]!.holdUntil).toBe(9);
    expect(sched.moves[1]!.holdUntil).toBe(9);
    expect(sched.moves[2]!.holdUntil).toBe(Infinity);
  });

  test("a degraded camera entry (no move) is neutral — not a decay boundary, no move minted", () => {
    const entries: StageEntry[] = [
      { kind: "camera", start: 0, end: 1, move: move(homePose(VIEW.viewW, VIEW.panelW), P1) },
      { kind: "camera", start: 2, end: 2, move: null },
      { kind: "write", start: 4, end: 5 },
    ];
    const sched = buildStageSchedule(entries, VIEW, D.cameraRho);
    expect(sched.moves.length).toBe(1);
    expect(sched.moves[0]!.holdUntil).toBe(4);
  });

  test("擦不是写 — an erase entry is neutral: the pose holds THROUGH the sweep and decays only at the next write (review P1-3)", () => {
    // The review's reproduction: @focus → @erase → @wait. The register
    // used to decay at the sweep's start, handing the camera to the
    // follow WHILE the eraser held the stage — an unscheduled camera
    // motion, G1 broken. Now the hold runs through the erase (and the
    // wait, which holds no entry) to the next writing step.
    const entries: StageEntry[] = [
      { kind: "camera", start: 0, end: 1, move: move(homePose(VIEW.viewW, VIEW.panelW), P1) },
      { kind: "erase", start: 2, end: 3.5 },
      { kind: "write", start: 6, end: 8 },
    ];
    const sched = buildStageSchedule(entries, VIEW, D.cameraRho);
    expect(sched.moves[0]!.holdUntil).toBe(6);
    // Mid-sweep the register still reads the held pose — the camera does
    // not move while the eraser works (one axis at a time).
    expect(stageStateAt(sched, 2.7).camera).toEqual({ kind: "pose", ...P1 });
    expect(stageStateAt(sched, 6).camera.kind).toBe("follow");
    // With NO write after the sweep the pose holds forever.
    const tail = buildStageSchedule(
      [
        { kind: "camera", start: 0, end: 1, move: move(homePose(VIEW.viewW, VIEW.panelW), P1) },
        { kind: "erase", start: 2, end: 3.5 },
      ],
      VIEW,
      D.cameraRho,
    );
    expect(tail.moves[0]!.holdUntil).toBe(Infinity);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// stageStateAt — the fold
// ────────────────────────────────────────────────────────────────────────────

function demoSchedule(): StageSchedule {
  const entries: StageEntry[] = [
    { kind: "write", start: 0, end: 4 },
    { kind: "camera", start: 5, end: 6.2, move: move({ x: 0, y: 900, z: 1 }, P1) },
    { kind: "write", start: 8, end: 10 },
    { kind: "camera", start: 11, end: 12, move: move({ x: 0, y: 2000, z: 1 }, P2) },
  ];
  return buildStageSchedule(entries, VIEW, D.cameraRho);
}

describe("stageStateAt — the fold", () => {
  test("no camera verbs → follow at every t (the C1-preserving default)", () => {
    const sched = buildStageSchedule(
      [{ kind: "write", start: 0, end: 10 }],
      VIEW,
      D.cameraRho,
    );
    for (const t of [-1, 0, 3, 10, 1e6]) {
      expect(stageStateAt(sched, t)).toEqual({
        camera: { kind: "follow" },
        panelOffsets: [],
      });
    }
  });

  test("window boundaries are half-open and exact", () => {
    const sched = demoSchedule();
    // Before the first move: follow.
    expect(stageStateAt(sched, 4.999).camera.kind).toBe("follow");
    // At the window start: the from-pose, verbatim (p = 0).
    expect(stageStateAt(sched, 5).camera).toEqual({
      kind: "pose",
      x: 0,
      y: 900,
      z: 1,
    });
    // At the window end: the target, held.
    expect(stageStateAt(sched, 6.2).camera).toEqual({ kind: "pose", ...P1 });
    // Held through the pen-up gap…
    expect(stageStateAt(sched, 7.999).camera).toEqual({ kind: "pose", ...P1 });
    // …and decayed to follow the instant writing starts.
    expect(stageStateAt(sched, 8).camera.kind).toBe("follow");
    // The second move holds forever (nothing writes after it).
    expect(stageStateAt(sched, 1e9).camera).toEqual({ kind: "pose", ...P2 });
  });

  test("a non-finite clock reads follow, never NaN poses (total contract)", () => {
    const sched = demoSchedule();
    // Non-finite clocks are inert (mirrors makeSeek's totality): follow,
    // never a NaN pose written to a transform. Finite "forever after" is
    // covered by the 1e9 case in the boundaries test.
    expect(stageStateAt(sched, NaN).camera.kind).toBe("follow");
    expect(stageStateAt(sched, Infinity).camera.kind).toBe("follow");
    expect(stageStateAt(sched, -Infinity).camera.kind).toBe("follow");
  });

  test("PURITY — the answer at t is independent of query history (shuffled orders, fresh instances)", () => {
    const sched = demoSchedule();
    const ts: number[] = [];
    for (let k = 0; k <= 400; k++) ts.push((13 * k) / 400 - 0.5);
    const reference = ts.map((t) => JSON.stringify(stageStateAt(sched, t)));

    // Deterministic shuffle (mulberry32).
    let seed = 42 >>> 0;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    for (let round = 0; round < 3; round++) {
      const order = ts.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      const fresh = demoSchedule(); // cross-check a fresh instance too
      for (const i of order) {
        expect(JSON.stringify(stageStateAt(sched, ts[i]!))).toBe(reference[i]!);
        expect(JSON.stringify(stageStateAt(fresh, ts[i]!))).toBe(reference[i]!);
      }
    }
  });

  test("mid-window the pose is the eased Van Wijk pose — byte-identical on repeat queries", () => {
    const sched = demoSchedule();
    const m = sched.moves[0]!;
    const t = 5.7;
    const p = (t - m.start) / (m.end - m.start);
    const expected = cameraPoseAt(m.from, m.to, VIEW, D.cameraRho, easeCamera(p));
    const got = stageStateAt(sched, t).camera;
    expect(got).toEqual({ kind: "pose", ...expected });
    expect(stageStateAt(sched, t)).toEqual(stageStateAt(sched, t));
  });

  test("a zero-length window (degenerate move) still latches its target", () => {
    const sched = buildStageSchedule(
      [
        { kind: "camera", start: 2, end: 2, move: move(P1, P1) },
        { kind: "write", start: 5, end: 6 },
      ],
      VIEW,
      D.cameraRho,
    );
    expect(stageStateAt(sched, 1.9).camera.kind).toBe("follow");
    expect(stageStateAt(sched, 2).camera).toEqual({ kind: "pose", ...P1 });
    expect(stageStateAt(sched, 4.9).camera).toEqual({ kind: "pose", ...P1 });
    expect(stageStateAt(sched, 5).camera.kind).toBe("follow");
  });
});
