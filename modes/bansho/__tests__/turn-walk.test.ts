/**
 * turn-walk.test.ts — **the walk to the next board is a MOVE, not a cut.**
 *
 * The defect this pins (product owner, 2026-08-11): 「切换白板没有任何动画,
 * 完全看不出来换了」. V1.5 shipped transition perspective, but the whole
 * stage schedule was gated on a board declaring `@focus` / `@overview` —
 * so a lecture written with nothing but `@turn` (which is every lecture a
 * cold agent writes) built NO schedule at all, and the walk to the next
 * board was one instant `applyCamera` write. Four boards read as four
 * slides.
 *
 * The fix is the phase the css3d brief §5.1 reserved: the walk becomes a
 * camera MOVE on the canonical schedule, so it inherits — for free, with
 * no new mechanism — the Van Wijk glide, the transition depth, and scrub
 * purity. What it must NOT inherit is the register: a turn stays 走位不是写
 * (P1-3), so a latched `@focus` still rides straight through it, and the
 * walk is only ever emitted when the director is SILENT (that is, exactly
 * where the instant cut used to be).
 *
 * The last test is the byte gate's half of the argument: a turn with
 * nothing to walk to emits nothing, so a board that places nothing keeps
 * an empty schedule and a flat depth surface.
 *
 * THE LANDING HAS AIR (2026-08-17). The walk existed, but every walk
 * landed the same way: flush against the destination board's content
 * edge, identical framing every time. The product owner, watching `@turn`
 * walks: 「turn 的时候最好也看到黑板的边缘外部一点,甚至有点随机感。每次都
 * 整整齐齐地贴在黑板的内容边缘,就感觉不到环境变化了,有点晃神。」 So a
 * turn's landing now stands BACK — far enough that the board's own edges,
 * the gap to its neighbour and the wall read in the frame — and the amount
 * of air plus a small positional drift are seeded from the turn step's own
 * identity (`key`), mulberry32 over fnv1a, quantised draws — the same
 * determinism discipline as the ink's jitter and the flaw layer. The
 * second describe below owns that behaviour.
 */

import { describe, expect, test } from "bun:test";

import {
  buildStageSchedule,
  resolveCameraOps,
  restZoom,
  stageStateAt,
  turnLanding,
  TURN_AIR,
  type CameraPose,
  type StageEntry,
  type StageStepInput,
  type StageView,
  type Viewbox,
} from "../engine/stage.js";
import { DEFAULT_DURATIONS as D } from "../engine/duration.js";
import { transitionDepthAt, isFlat } from "../viewer/depth.js";

/** A four-board wall: each panel one viewport wide, a modest gap. */
const VIEW: StageView = {
  viewW: 800,
  viewH: 600,
  panelW: 800,
  panelH: 2400,
  panelCount: 4,
  panelGap: 48,
};
const PITCH = VIEW.panelW + (VIEW.panelGap ?? 0);

/** A written line on board `panel`, `top` down its face. */
const writeRect = (panel: number, top: number) => ({
  left: panel * PITCH,
  top,
  right: panel * PITCH + 600,
  bottom: top + 40,
});

/** The head of board `panel` — the rect a turn walks to (bottom == top). */
const headRect = (panel: number) => ({
  left: panel * PITCH,
  top: 0,
  right: panel * PITCH + VIEW.panelW,
  bottom: 0,
});

describe("@turn is a camera move — the walk you can see", () => {
  test("a silent-register turn to another board resolves a move with a real duration", () => {
    const inputs: StageStepInput[] = [
      // Write far enough down board 0 that the pen camera has travelled.
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "write", rect: writeRect(0, 1400) },
      { kind: "turn", rect: headRect(1), key: "0:2" },
    ];
    const ops = resolveCameraOps(inputs, VIEW, D);
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.index).toBe(2);
    expect(op.move).not.toBeNull();
    // It departs from where the live follow actually rests (deep in board
    // 0) and arrives before the next board — standing BACK from its head
    // (the landing's air; the describe below owns the exact framing), so
    // the viewport's left edge sits in the gap before the board.
    expect(op.move!.from.y).toBeGreaterThan(0);
    expect(op.move!.to.x).toBeLessThan(PITCH);
    expect(op.move!.to.x).toBeGreaterThan(0);
    // A whole board's width of travel is not free.
    expect(op.duration).toBeGreaterThan(0.2);
  });

  test("the walk does NOT latch the register — a turn is still 走位不是写", () => {
    const withTurn: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "camera", op: "focus", anchor: writeRect(0, 1400) },
      // Latched: the director is holding a pose, so the walk yields to it.
      { kind: "turn", rect: headRect(1), key: "0:2" },
      { kind: "camera", op: "focus", anchor: writeRect(0, 100) },
    ];
    const ops = resolveCameraOps(withTurn, VIEW, D);
    // Two ops only: the latched turn emits NOTHING (the pose rides through).
    expect(ops).toHaveLength(2);
    expect(ops[1]!.move!.from).toEqual(ops[0]!.move!.to);
  });

  test("the schedule carries a turn's move, and it decays at the next write", () => {
    const entries: StageEntry[] = [
      { kind: "write", start: 0, end: 1 },
      {
        kind: "turn",
        start: 1,
        end: 2,
        move: { from: { x: 0, y: 900, z: 1 }, to: { x: PITCH, y: 0, z: 1 } },
      },
      { kind: "write", start: 2, end: 3 },
    ];
    const schedule = buildStageSchedule(entries, VIEW, D.cameraRho);
    expect(schedule.moves).toHaveLength(1);
    expect(schedule.moves[0]!.holdUntil).toBe(2);
    // Mid-walk the camera is BETWEEN the two boards — neither endpoint.
    const mid = stageStateAt(schedule, 1.5).camera;
    expect(mid.kind).toBe("pose");
    if (mid.kind !== "pose") throw new Error("unreachable");
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(PITCH);
    // …and it is back on the pen once writing resumes.
    expect(stageStateAt(schedule, 2.5).camera).toEqual({ kind: "follow" });
  });

  test("the walk carries depth: flat at both ends, tilted in the middle", () => {
    const entries: StageEntry[] = [
      { kind: "write", start: 0, end: 1 },
      {
        kind: "turn",
        start: 1,
        end: 2,
        move: { from: { x: 0, y: 900, z: 1 }, to: { x: PITCH, y: 0, z: 1 } },
      },
      { kind: "write", start: 2, end: 3 },
    ];
    const schedule = buildStageSchedule(entries, VIEW, D.cameraRho);
    expect(isFlat(transitionDepthAt(schedule, 1))).toBe(true);
    expect(isFlat(transitionDepthAt(schedule, 2))).toBe(true);
    const peak = transitionDepthAt(schedule, 1.5);
    expect(isFlat(peak)).toBe(false);
    // Travelling RIGHT: the leading (right) edge comes toward the reader,
    // which in CSS's sign convention is a negative rotateY.
    expect(peak.ry).toBeLessThan(0);
    // And the plane steps back to travel.
    expect(peak.tz).toBeLessThan(0);
  });

  test("a turn with nowhere to walk moves nothing — the board renders as before", () => {
    // Unresolvable destination (a strip's degraded turn).
    const noRect: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "turn", rect: null, key: "0:1" },
    ];
    expect(resolveCameraOps(noRect, VIEW, D)).toHaveLength(0);

    // A destination already in view: the follow would not move, so neither
    // does the walk — no zero-length move, no spurious tilt.
    const inView: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "turn", rect: headRect(0), key: "0:1" },
    ];
    expect(resolveCameraOps(inView, VIEW, D)).toHaveLength(0);

    // And an entry with no move keeps the schedule empty (V1.5's
    // absent-at-rest surface: no moves ⇒ no depth ⇒ byte-identical).
    const schedule = buildStageSchedule(
      [
        { kind: "write", start: 0, end: 1 },
        { kind: "turn", start: 1, end: 2 },
      ],
      VIEW,
      D.cameraRho,
    );
    expect(schedule.moves).toHaveLength(0);
    expect(isFlat(transitionDepthAt(schedule, 1.5))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The landing's air (2026-08-17)
// ────────────────────────────────────────────────────────────────────────────

/** The stage clamp box the resolver builds for VIEW — 2x2 wall extent. */
const BOX: Viewbox = {
  panelW: 2 * VIEW.panelW + (VIEW.panelGap ?? 0),
  panelH: 2 * VIEW.panelH + (VIEW.panelGap ?? 0),
  viewW: VIEW.viewW,
  viewH: VIEW.viewH,
};
const REST_Z = restZoom(VIEW.viewW, VIEW.panelW);

/** The turn op resolved for a walk from deep in board 0 to board `dest`'s
 *  head, keyed `key` — the standard walk of the describe below. */
const walkOp = (key: string, dest = 1) => {
  const ops = resolveCameraOps(
    [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "write", rect: writeRect(0, 1400) },
      { kind: "turn", rect: headRect(dest), key },
    ],
    VIEW,
    D,
  );
  expect(ops).toHaveLength(1);
  return ops[0]!;
};

/** How much stand-back a landing carries: restZ / z − 1 (0 = flush). */
const airOf = (to: CameraPose): number => REST_Z / to.z - 1;

describe("the turn's landing has air — the room reads at every arrival", () => {
  test("the landing stands back: both board edges and the wall gap are in frame", () => {
    const to = walkOp("0:2").move!.to;
    // Zoomed out past the rest zoom, within the declared band.
    expect(airOf(to)).toBeGreaterThanOrEqual(TURN_AIR.min - 1e-9);
    expect(airOf(to)).toBeLessThanOrEqual(TURN_AIR.max + 1e-9);
    // Air on BOTH sides of the destination board: the viewport's left edge
    // sits before the board's left edge, its right edge past the board's
    // right edge — the frame, the gap, the wall, not a tighter crop.
    expect(to.x).toBeLessThan(PITCH);
    expect(to.x + VIEW.viewW / to.z).toBeGreaterThan(PITCH + VIEW.panelW);
    // And air above the head, not a flush top edge.
    expect(to.y).toBeLessThan(0);
  });

  test("the framing is seeded from the step's identity — deterministic, and distinct across keys", () => {
    // Same key: byte-identical landing, every resolve (scrub correctness).
    expect(walkOp("0:2")).toEqual(walkOp("0:2"));
    // Different identities land in different framings.
    const a = walkOp("0:2").move!.to;
    const b = walkOp("1:5").move!.to;
    expect(a.z === b.z && a.x === b.x && a.y === b.y).toBe(false);
  });

  test("consecutive turns land in different framings and never compound the stand-back", () => {
    const ops = resolveCameraOps(
      [
        { kind: "write", rect: writeRect(0, 0) },
        { kind: "turn", rect: headRect(1), key: "0:1" },
        // No write between: the second walk departs the first landing.
        { kind: "turn", rect: headRect(2), key: "0:2" },
      ],
      VIEW,
      D,
    );
    expect(ops).toHaveLength(2);
    const first = ops[1]!.move!;
    expect(first.from).toEqual(ops[0]!.move!.to);
    // Each landing's air is drawn ABSOLUTELY from the rest zoom — a chain
    // of turns must not zoom out further and further.
    for (const op of ops) {
      expect(airOf(op.move!.to)).toBeGreaterThanOrEqual(TURN_AIR.min - 1e-9);
      expect(airOf(op.move!.to)).toBeLessThanOrEqual(TURN_AIR.max + 1e-9);
    }
    // And the two framings differ — the reader sees a fresh arrival, not
    // the same photograph twice. Compare board-relative offsets so the
    // different destinations cannot mask identical framing.
    const slot1 = { x: PITCH, y: 0 };
    const slot2 = { x: 0, y: VIEW.panelH + (VIEW.panelGap ?? 0) };
    const toA = ops[0]!.move!.to;
    const toB = ops[1]!.move!.to;
    expect(
      toA.z === toB.z &&
        toA.x - slot1.x === toB.x - slot2.x &&
        toA.y - slot1.y === toB.y - slot2.y,
    ).toBe(false);
  });

  test("the write after a turn departs from the settled rest — the fold simulates the host's hand-back", () => {
    const ops = resolveCameraOps(
      [
        { kind: "write", rect: writeRect(0, 0) },
        { kind: "turn", rect: headRect(1), key: "0:1" },
        // The write on the landed board: the hand-back is HOST presentation
        // (no canonical move — not a migration), but the fold must settle
        // its simulated camera exactly where the live one will rest…
        { kind: "write", rect: writeRect(1, 0) },
        // …so this migration back to board 0 departs from the pen camera
        // at the performance zoom, not from a stale airy pose.
        { kind: "write", rect: writeRect(0, 1400) },
      ],
      VIEW,
      D,
    );
    expect(ops).toHaveLength(2);
    const back = ops[1]!.move!;
    expect(back.from.z).toBe(REST_Z);
    expect(back.from.x).toBe(PITCH);
  });

  test("turnLanding: quantised draws, bounded drift — the board never sits flush and never drowns in void", () => {
    const walked: CameraPose = { x: PITCH, y: 0, z: REST_Z };
    for (const key of ["0:1", "0:7", "2:3", "5:0", "9:9"]) {
      const to = turnLanding(walked, BOX, REST_Z, key);
      const air = airOf(to);
      expect(air).toBeGreaterThanOrEqual(TURN_AIR.min - 1e-9);
      expect(air).toBeLessThanOrEqual(TURN_AIR.max + 1e-9);
      // The extra room splits across the two sides; drift may lean it but
      // never past the declared share — each side keeps real air.
      const extraW = (VIEW.viewW / REST_Z) * air;
      const leftAir = walked.x - to.x;
      expect(leftAir).toBeGreaterThanOrEqual(extraW * (0.5 - TURN_AIR.drift) - 1e-6);
      expect(leftAir).toBeLessThanOrEqual(extraW * (0.5 + TURN_AIR.drift) + 1e-6);
      // Determinism: the same identity draws the same landing, bit for bit.
      expect(turnLanding(walked, BOX, REST_Z, key)).toEqual(to);
    }
  });
});
