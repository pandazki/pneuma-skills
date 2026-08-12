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
 */

import { describe, expect, test } from "bun:test";

import {
  buildStageSchedule,
  resolveCameraOps,
  stageStateAt,
  type StageEntry,
  type StageStepInput,
  type StageView,
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
      { kind: "turn", rect: headRect(1) },
    ];
    const ops = resolveCameraOps(inputs, VIEW, D);
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.index).toBe(2);
    expect(op.move).not.toBeNull();
    // It departs from where the live follow actually rests (deep in board
    // 0) and arrives at the next board's head — the walk, in full.
    expect(op.move!.from.y).toBeGreaterThan(0);
    expect(op.move!.to.x).toBeCloseTo(PITCH, 6);
    expect(op.move!.to.y).toBe(0);
    // A whole board's width of travel is not free.
    expect(op.duration).toBeGreaterThan(0.2);
  });

  test("the walk does NOT latch the register — a turn is still 走位不是写", () => {
    const withTurn: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "camera", op: "focus", anchor: writeRect(0, 1400) },
      // Latched: the director is holding a pose, so the walk yields to it.
      { kind: "turn", rect: headRect(1) },
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
      { kind: "turn", rect: null },
    ];
    expect(resolveCameraOps(noRect, VIEW, D)).toHaveLength(0);

    // A destination already in view: the follow would not move, so neither
    // does the walk — no zero-length move, no spurious tilt.
    const inView: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "turn", rect: headRect(0) },
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
