/**
 * board-walk.test.ts — **EVERY change of the board walks, not just `@turn`.**
 *
 * The defect this pins (measured 2026-08-11 over the product owner's own
 * lecture, `harness/screenshots/turn-walk/README.md`): of thirteen board
 * changes, two glided and eleven were cuts. The two were `@turn`s. The
 * other eleven were the LIVE FOLLOW chasing the pen onto another board —
 * an instant `applyCamera` write, because C1's follow deliberately holds
 * no animation state (which is exactly what makes scrub trivially
 * correct, and must stay true).
 *
 * The ratified route (2026-08-12): **the fold emits the move.** A write —
 * or an eraser sweep — that migrates the camera to another board resolves
 * like every other camera motion, so it inherits the Van Wijk path, the
 * arc-length duration and the transition depth with no new mechanism, and
 * it is `seek(p)`-pure by construction. The follow stays stateless.
 *
 * Where the move LIVES is the one thing that differs from `@turn`. A turn
 * IS the walk — its own window is the journey. A write's window is the
 * pen writing and an erase's window is the sweep, and G1 says one thing
 * happens at a time: so their walk occupies the step's LEAD-IN, the dead
 * air the timeline already puts before every step, widened to the walk's
 * own arc-length seconds when the natural breath is shorter (`max`, never
 * `+` — the same shape `@turn` uses).
 *
 * The guards, each a test below:
 *   - a write that stays on its own board emits NOTHING (the ordinary
 *     vertical follow is not a walk, and inventing travel for it would
 *     put a glide on every paragraph);
 *   - a follow that returns an UNCHANGED pose emits nothing;
 *   - a latched `@focus` still rides straight through an erase;
 *   - the walk never overlaps the step it leads (G1).
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
import { wallSlot, type WallGeometry } from "../engine/wall.js";

/** A four-board wall: each panel one viewport wide, a modest gap. */
const VIEW: StageView = {
  viewW: 800,
  viewH: 600,
  panelW: 800,
  panelH: 2400,
  panelCount: 4,
  panelGap: 48,
};
/** The wall's column pitch — one board plus the gap showing beside it. */
const PITCH = VIEW.panelW + (VIEW.panelGap ?? 0);
const G: WallGeometry = {
  panelW: VIEW.panelW,
  panelH: VIEW.panelH,
  gap: VIEW.panelGap ?? 0,
};
/** Where board `panel` stands. Four boards is a 2x2 ROOM (engine/wall.ts),
 *  so board 3 is below board 1 — every fixture below asks the wall rather
 *  than assuming a row, which is the whole point of the module. */
const at = (panel: number) => wallSlot(panel, VIEW.panelCount ?? 1, G);

/** A written line on board `panel`, `top` down its face. */
const writeRect = (panel: number, top: number) => {
  const s = at(panel);
  return {
    left: s.x,
    top: s.y + top,
    right: s.x + 600,
    bottom: s.y + top + 40,
  };
};

/** The head of board `panel` — the rect an eraser sweep walks to. */
const headRect = (panel: number) => {
  const s = at(panel);
  return { left: s.x, top: s.y, right: s.x + VIEW.panelW, bottom: s.y };
};

describe("a write that migrates to another board is a walk", () => {
  test("the fold emits a move when the pen moves to the next board", () => {
    const inputs: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "write", rect: writeRect(0, 1400) },
      // The pen has moved to board 1 — the live follow used to jump here.
      { kind: "write", rect: writeRect(1, 0) },
    ];
    const ops = resolveCameraOps(inputs, VIEW, D);
    expect(ops.length).toBe(1);
    const op = ops[0]!;
    expect(op.index).toBe(2);
    expect(op.move).not.toBeNull();
    // It departs from where the live follow actually rested on board 0…
    expect(op.move!.from.x).toBe(0);
    // …and arrives at board 1's origin.
    expect(op.move!.to.x).toBe(at(1).x);
    // A real journey takes real time.
    expect(op.duration).toBeGreaterThan(0.3);
  });

  test("a write that stays on its own board emits NOTHING — the vertical follow is not a walk", () => {
    const inputs: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      // Far enough down to pull the follow, but the same board.
      { kind: "write", rect: writeRect(0, 1400) },
      { kind: "write", rect: writeRect(0, 2000) },
    ];
    expect(resolveCameraOps(inputs, VIEW, D)).toEqual([]);
  });

  test("a follow that returns an unchanged pose emits nothing (no invented travel)", () => {
    // Two lines at the top of board 0: the target is comfortably in view,
    // so `followShift` either declines or answers with the same pose.
    const inputs: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 100) },
      { kind: "write", rect: writeRect(0, 160) },
    ];
    expect(resolveCameraOps(inputs, VIEW, D)).toEqual([]);
  });

  test("an unmeasurable write emits nothing", () => {
    const inputs: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "write", rect: null },
    ];
    expect(resolveCameraOps(inputs, VIEW, D)).toEqual([]);
  });

  test("an unmeasurable step still walks when its BOARD is known (the hidden chart layer)", () => {
    // A chart LAYER draws onto a frame standing on another board and
    // reports an all-zero client box, so the stage anchor cannot measure
    // it — but the fold assigned it a panel, and the host's own camera
    // hand-back walks there. Measured on the owner's lecture: this is the
    // last pair of cuts, and it is a real journey (the teacher crosses the
    // room to add a curve to a chart already standing).
    const inputs: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "write", rect: null, penX: at(3).x, penY: at(3).y },
      { kind: "write", rect: writeRect(0, 200), penX: 0, penY: 0 },
    ];
    const ops = resolveCameraOps(inputs, VIEW, D);
    expect(ops.map((o) => o.index)).toEqual([1, 2]);
    expect(ops[0]!.move!.to.x).toBe(at(3).x);
    // …and the way back is a journey too.
    expect(ops[1]!.move!.from.x).toBe(at(3).x);
    expect(ops[1]!.move!.to.x).toBe(0);
  });

  test("an unmeasurable step on the board the camera already holds emits nothing", () => {
    const inputs: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "write", rect: null, penX: 0 },
    ];
    expect(resolveCameraOps(inputs, VIEW, D)).toEqual([]);
  });

  test("a single-board strip never walks — panelCount 1 is C1, bit for bit", () => {
    const flat: StageView = { viewW: 800, viewH: 600, panelW: 800, panelH: 4000 };
    const inputs: StageStepInput[] = [
      { kind: "write", rect: { left: 0, top: 0, right: 600, bottom: 40 } },
      { kind: "write", rect: { left: 0, top: 2400, right: 600, bottom: 2440 } },
    ];
    expect(resolveCameraOps(inputs, flat, D)).toEqual([]);
  });
});

describe("an eraser sweep on another board walks there too", () => {
  test("the fold emits a move to the board being wiped, and another back to the pen", () => {
    const inputs: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "write", rect: writeRect(1, 0) },
      // The room wipes board 2 while the pen stands at board 1. Board 2
      // is the far side of the room in a 2x2 wall (bottom left); board 3
      // would sit directly under the pen, which is a different journey.
      { kind: "erase", rect: headRect(2) },
      // …and the next line brings the camera back to the pen.
      { kind: "write", rect: writeRect(1, 200) },
    ];
    const ops = resolveCameraOps(inputs, VIEW, D);
    expect(ops.map((o) => o.index)).toEqual([1, 2, 3]);
    expect(ops.map((o) => o.move!.to.x)).toEqual([
      at(1).x,
      at(2).x,
      at(1).x,
    ]);
  });

  test("a latched @focus rides straight through the sweep — the erase emits no walk", () => {
    const inputs: StageStepInput[] = [
      { kind: "write", rect: writeRect(0, 0) },
      { kind: "write", rect: writeRect(1, 0) },
      { kind: "camera", op: "focus", anchor: writeRect(1, 0) },
      { kind: "erase", rect: headRect(2) },
    ];
    const ops = resolveCameraOps(inputs, VIEW, D);
    // The pen's own walk to board 1, then the @focus — and the sweep after
    // it stayed neutral: the director still holds the camera.
    expect(ops.map((o) => o.index)).toEqual([1, 2]);
  });
});

describe("the walk occupies the step's lead-in, exclusively (G1)", () => {
  const move = { from: { x: 0, y: 0, z: 1 }, to: { x: PITCH, y: 0, z: 1 } };

  test("a lead move plays in [start - lead, start) and decays at the pen's own start", () => {
    const entries: StageEntry[] = [
      { kind: "write", start: 0, end: 2 },
      { kind: "write", start: 3, end: 5, move, lead: 0.9 },
    ];
    const schedule = buildStageSchedule(entries, VIEW, D.cameraRho);
    expect(schedule.moves.length).toBe(1);
    const m = schedule.moves[0]!;
    expect(m.start).toBeCloseTo(2.1, 6);
    expect(m.end).toBe(3);
    // The pen lands and the register hands straight back to the follow —
    // the walk holds nothing.
    expect(m.holdUntil).toBe(3);
    // …and it never overlaps the step before it (G1).
    expect(m.start).toBeGreaterThanOrEqual(entries[0]!.end);
  });

  test("mid-walk is a director pose; the instant the pen writes it is follow again", () => {
    const schedule = buildStageSchedule(
      [
        { kind: "write", start: 0, end: 2 },
        { kind: "write", start: 3, end: 5, move, lead: 0.9 },
      ],
      VIEW,
      D.cameraRho,
    );
    expect(stageStateAt(schedule, 2.0).camera.kind).toBe("follow");
    const mid = stageStateAt(schedule, 2.55).camera;
    expect(mid.kind).toBe("pose");
    // Genuinely between the two boards, not parked at either end.
    if (mid.kind === "pose") {
      expect(mid.x).toBeGreaterThan(0);
      expect(mid.x).toBeLessThan(PITCH);
    }
    expect(stageStateAt(schedule, 3.0).camera.kind).toBe("follow");
  });

  test("an erase's walk HOLDS through the sweep and decays at the next write", () => {
    const schedule = buildStageSchedule(
      [
        { kind: "write", start: 0, end: 2 },
        { kind: "erase", start: 3, end: 4.6, move, lead: 0.9 },
        { kind: "write", start: 5, end: 7 },
      ],
      VIEW,
      D.cameraRho,
    );
    const m = schedule.moves[0]!;
    expect(m.end).toBe(3);
    expect(m.holdUntil).toBe(5);
    // 擦不是写: the camera stands still and watches the sweep.
    const held = stageStateAt(schedule, 4).camera;
    expect(held.kind).toBe("pose");
    if (held.kind === "pose") expect(held.x).toBe(PITCH);
  });

  test("a move without a lead-in window is not scheduled — a zero-length glide is a cut", () => {
    const schedule = buildStageSchedule(
      [{ kind: "write", start: 0, end: 2, move, lead: 0 }],
      VIEW,
      D.cameraRho,
    );
    expect(schedule.moves).toEqual([]);
  });

  test("a write with no move keeps the schedule empty — the byte gate's half", () => {
    const schedule = buildStageSchedule(
      [
        { kind: "write", start: 0, end: 2 },
        { kind: "write", start: 3, end: 5 },
      ],
      VIEW,
      D.cameraRho,
    );
    expect(schedule.moves).toEqual([]);
  });
});
