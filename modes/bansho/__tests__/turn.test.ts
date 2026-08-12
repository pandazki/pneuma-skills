/**
 * `@turn` (S1, board-snapshot design §7.6) — the dialect family's third
 * member: "new topic, leave that board standing."
 *
 * What is pinned here, per the design's acceptance list (§13):
 *  - parser: multi-board `@turn` parses; strip `@turn` is a BadStep with
 *    the exact taught message; malformed forms degrade;
 *  - fold: tier-1/2 target selection via `cleanBoardTarget` (ONE policy —
 *    the property test replays every real overflow AND every non-inert
 *    turn against the exported function); the three inert scenarios
 *    (first line / double turn / erase-then-turn); and — since
 *    2026-08-11, design §3.5 — the FULL WALL, where the turn goes lazy
 *    and loud and synthesizes NO erase (the negative that replaces the
 *    old tier-3 positive);
 *  - plan: exactly one 走位 unit at `DurationConstants.turn`; the notes
 *    projection plans zero (a room action, §7.6-Q4);
 *  - stage: a latched `@focus` pose RIDES THROUGH a turn (P1-3 family
 *    negative test) and a turn never ends a hold window;
 *  - prefix stability with turns in the generator.
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { planLecture, planStepUnits } from "../engine/inference.js";
import {
  cleanBoardTarget,
  foldBoardLayout,
  type LayoutStepInput,
} from "../engine/layout.js";
import { mulberry32 } from "../engine/sketch/index.js";
import {
  buildStageSchedule,
  resolveCameraOps,
  stageStateAt,
  type StageStepInput,
  type StageView,
} from "../engine/stage.js";
import type { Step } from "../engine/types.js";

const D = DEFAULT_DURATIONS;

const content = (key: string, height: number): LayoutStepInput => ({
  kind: "content",
  key,
  height,
});
const erase = (key: string, anchorKey?: string): LayoutStepInput => ({
  kind: "erase",
  key,
  ...(anchorKey !== undefined ? { anchorKey } : {}),
});
const turn = (key: string): LayoutStepInput => ({ kind: "turn", key });

// ────────────────────────────────────────────────────────────────────────────
// Parser
// ────────────────────────────────────────────────────────────────────────────

describe("@turn — the parser", () => {
  test("parses on a multi-board lecture, one line of its own", () => {
    const lecture = parseLecture("@board 3\n\n# 题\n\n甲。\n\n@turn\n\n乙。\n");
    expect(lecture.errors).toEqual([]);
    const kinds = lecture.sections[0]!.steps.map((s) => s.kind);
    expect(kinds).toContain("turn");
  });

  test("on the single strip it is a category error — BadStep, message teaches the way out (§7.6-Q3)", () => {
    for (const src of ["# 题\n\n甲。\n\n@turn\n", "@board 1\n\n甲。\n\n@turn\n"]) {
      const lecture = parseLecture(src);
      expect(lecture.errors).toHaveLength(1);
      expect(lecture.errors[0]!.message).toBe(
        "the single strip has no next board — stand boards with @board 2–4 first, or just keep writing; the strip never runs out.",
      );
      const bad = lecture.sections
        .flatMap((s) => s.steps)
        .find((s) => s.kind === "bad");
      expect(bad).toBeDefined();
    }
  });

  test("never takes arguments — the room picks the board, not the author (§7.6-Q1)", () => {
    for (const src of ["@board 2\n\n甲。\n\n@turn 3\n", '@board 2\n\n甲。\n\n@turn "锚"\n']) {
      const lecture = parseLecture(src);
      expect(lecture.errors).toHaveLength(1);
      expect(lecture.errors[0]!.message).toContain("malformed @turn");
    }
  });

  test("breaks a paragraph even without a blank line before it", () => {
    // `@turn` is a KNOWN_DIRECTIVE, so it opens a block the way `@erase`
    // and `@at` do: a turn written straight under a sentence is a turn,
    // never a literal line of that sentence. It was the ONE stage verb
    // missing from that set — `@wait` / `@erase` / `@board` / `@focus` /
    // `@overview` / `@at` were all in it — so a turn glued under prose was
    // swallowed into the paragraph and HANDWRITTEN on the board, in front
    // of the user, with no warning anywhere. The room never turned.
    const steps = parseLecture("@board 2\n\n第一句。\n@turn\n\n第二句。\n")
      .sections.flatMap((s) => s.steps);
    expect(steps.filter((s) => s.kind === "turn").length).toBe(1);
    const prose = steps.filter((s) => s.kind === "prose");
    expect(prose.length).toBe(2);
    for (const step of prose) {
      expect(JSON.stringify(step)).not.toContain("@turn");
    }
  });

  test("a malformed turn glued under a sentence is a bad step, not handwriting", () => {
    // The other half of the same seam: adjacency must not decide whether
    // the author gets told. `@turn 3` is wrong wherever it stands.
    const lecture = parseLecture("@board 2\n\n第一句。\n@turn 3\n\n第二句。\n");
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]!.message).toContain("malformed @turn");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Fold — target selection and the inert scenarios
// ────────────────────────────────────────────────────────────────────────────

describe("@turn — the fold (§7.6-Q1/Q3/Q6)", () => {
  test("tier-1: walks to the first never-used board; nothing is erased", () => {
    const layout = foldBoardLayout(
      [content("a", 60), turn("t1"), content("b", 30)],
      3,
      100,
    );
    expect(layout.turns).toEqual([
      { key: "t1", panel: 1, inert: false, fullWall: false, fill: expect.any(Number) },
    ]);
    expect(layout.eraseOps).toEqual([]);
    expect(layout.assignments.get("a")).toEqual({ panel: 0, region: "full", run: "0.0" });
    // The previous board's content is left STANDING (the postcondition).
    expect(layout.assignments.get("b")).toEqual({ panel: 1, region: "full", run: "1.0" });
    expect(layout.cur).toBe(1);
  });

  test("tier-2: with no fresh board it reuses an erased-empty one", () => {
    const layout = foldBoardLayout(
      [
        content("a", 60),
        content("b", 90), // board 1 (overflow: 60+90 > 100)
        erase("e1", "a"), // board 0 wiped
        turn("t1"), // pen is on board 1 (non-empty) → walk to wiped board 0
        content("c", 30),
      ],
      2,
      100,
    );
    expect(layout.turns).toEqual([
      { key: "t1", panel: 0, inert: false, fullWall: false, fill: expect.any(Number) },
    ]);
    // The turn itself erases nothing — board 0 was already empty.
    expect(layout.eraseOps).toEqual([
      { key: "e1", panel: 0, region: "full", run: "0.0", targets: ["a"] },
    ]);
    expect(layout.assignments.get("c")).toEqual({ panel: 0, region: "full", run: "0.1" });
  });

  test("the FULL WALL: the turn stays put, says so, and erases NOTHING (§3.5, overturning §7.6-Q1 on 2026-08-11)", () => {
    // Until 2026-08-11 this test read "tier-3: on a full wall the turn
    // erases the earliest-filled board — deliberately". The argument then
    // was that expression must not fare worse than drift; drift stopped
    // erasing on the same day, so the argument inverts consistently and
    // the room lost its last power to choose a victim.
    const layout = foldBoardLayout(
      [content("a", 90), content("b", 90), turn("t1"), content("c", 30)],
      2,
      100,
    );
    // Lazy — the pen never left board 1 — and LOUD: `fullWall` is what the
    // host raises `turnOnFullWall` from.
    expect(layout.turns).toEqual([
      { key: "t1", panel: 1, inert: true, fullWall: true, fill: expect.any(Number) },
    ]);
    // The negative that carries the whole deletion.
    expect(layout.eraseOps).toEqual([]);
    // Writing carries on where it stood, in the run that was already open.
    expect(layout.assignments.get("c")).toEqual({
      panel: 1,
      region: "full",
      run: "1.0",
    });
    expect(layout.cur).toBe(1);
  });

  test("`fullWall` and plain inert are different verdicts — a clean pen board is a beat, a full wall is a refusal", () => {
    // Same shape, one board still free: the turn WALKS. The distinction
    // matters because only one of the two is worth telling the author
    // about, and a single `inert` flag could not carry that.
    const roomLeft = foldBoardLayout(
      [content("a", 90), content("b", 90), turn("t1")],
      3,
      100,
    );
    expect(roomLeft.turns).toEqual([
      { key: "t1", panel: 2, inert: false, fullWall: false, fill: expect.any(Number) },
    ]);
    const noRoom = foldBoardLayout(
      [content("a", 90), content("b", 90), content("c", 90), turn("t1")],
      3,
      100,
    );
    expect(noRoom.turns[0]!.fullWall).toBe(true);
    expect(noRoom.turns[0]!.inert).toBe(true);
    expect(noRoom.eraseOps).toEqual([]);
  });

  test("inert three ways: first line, double turn, erase-then-turn — a beat, never a bad step, never a walk", () => {
    // First content of the document (all boards empty).
    const first = foldBoardLayout([turn("t1"), content("a", 10)], 3, 100);
    expect(first.turns).toEqual([
      { key: "t1", panel: 0, inert: true, fullWall: false, fill: expect.any(Number) },
    ]);
    expect(first.assignments.get("a")).toEqual({ panel: 0, region: "full", run: "0.0" });

    // A second consecutive turn is inert on the board the first reached.
    const twice = foldBoardLayout(
      [content("a", 60), turn("t1"), turn("t2"), content("b", 10)],
      3,
      100,
    );
    expect(twice.turns).toEqual([
      { key: "t1", panel: 1, inert: false, fullWall: false, fill: expect.any(Number) },
      { key: "t2", panel: 1, inert: true, fullWall: false, fill: expect.any(Number) },
    ]);

    // @erase then @turn: the board is already clean — the turn must NOT
    // walk off and leave a "reserved" blank board behind (§7.6-Q3).
    const cleaned = foldBoardLayout(
      [content("a", 60), erase("e1"), turn("t1"), content("b", 10)],
      3,
      100,
    );
    expect(cleaned.turns).toEqual([
      { key: "t1", panel: 0, inert: true, fullWall: false, fill: expect.any(Number) },
    ]);
    expect(cleaned.assignments.get("b")).toEqual({ panel: 0, region: "full", run: "0.1" });
  });

  test("an inert turn short-circuits — it does NOT consult the overflow policy (§13's conditional assertion)", () => {
    // Pen on board 0, wiped clean; board 1 is fresh. The policy's answer
    // for this state is the FRESH board (tier-1) — an inert turn must stay
    // where it is instead.
    const inputs = [content("a", 60), erase("e1"), turn("t1"), content("b", 10)];
    const before = foldBoardLayout(inputs.slice(0, 2), 2, 100);
    expect(cleanBoardTarget(before.panels)).toEqual({
      panel: 1,
      kind: "fresh",
    });
    const after = foldBoardLayout(inputs, 2, 100);
    expect(after.turns).toEqual([
      { key: "t1", panel: 0, inert: true, fullWall: false, fill: expect.any(Number) },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ONE policy, three consumers — the anti-drift property (§13)
// ────────────────────────────────────────────────────────────────────────────

describe("cleanBoardTarget — one implementation behind fold overflow, snapshot and @turn", () => {
  /** Seeded random boards with content, erases AND turns. */
  function randomSteps(seed: number, n: number): LayoutStepInput[] {
    const rnd = mulberry32(seed);
    const steps: LayoutStepInput[] = [];
    const contentKeys: string[] = [];
    for (let i = 0; i < n; i++) {
      const roll = rnd();
      if (roll < 0.22 && contentKeys.length > 0) {
        steps.push(
          rnd() < 0.5
            ? erase(`e${i}`, contentKeys[Math.floor(rnd() * contentKeys.length)]!)
            : erase(`e${i}`),
        );
        continue;
      }
      if (roll < 0.34) {
        steps.push(turn(`t${i}`));
        continue;
      }
      const key = `c${i}`;
      contentKeys.push(key);
      steps.push(content(key, 10 + Math.floor(rnd() * 120)));
    }
    return steps;
  }

  const SEEDS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  test("every real overflow's board choice, and every non-inert turn's, equals the exported policy's answer on the pre-state", () => {
    let overflows = 0;
    let walks = 0;
    let bursts = 0;
    let fullWalls = 0;
    for (const seed of SEEDS) {
      const steps = randomSteps(seed, 80);
      for (let i = 0; i < steps.length; i++) {
        const input = steps[i]!;
        // Prefix stability makes fold(prefix) the full fold's mid-state,
        // so the pre-state is simply the fold stopped before this input.
        const before = foldBoardLayout(steps, 3, 100, i);
        const after = foldBoardLayout(steps, 3, 100, i + 1);
        if (input.kind === "content") {
          const assigned = after.assignments.get(input.key);
          if (!assigned) continue;
          const policy = cleanBoardTarget(before.panels);
          if (assigned.panel === before.cur) {
            // Either it fitted, or the wall was full and it burst in
            // place. The second case is only legal when the policy had
            // nothing to give — that is the "null ⇒ do not walk" half of
            // the one-implementation invariant.
            const fitted =
              before.panels[before.cur]!.cursor === 0 ||
              before.panels[before.cur]!.cursor + (input.height ?? 0) <= 100;
            if (!fitted) {
              bursts++;
              expect(policy).toBeNull();
            }
            continue;
          }
          overflows++;
          expect(policy).not.toBeNull();
          expect(assigned.panel).toBe(policy!.panel);
        } else if (input.kind === "turn") {
          const record = after.turns[after.turns.length - 1]!;
          expect(record.key).toBe(input.key);
          const policy = cleanBoardTarget(before.panels);
          if (record.fullWall) {
            // Lazy AND silent about erasing: the wall really was full…
            expect(policy).toBeNull();
            // …and nothing was retired to make room.
            expect(after.eraseOps.length).toBe(before.eraseOps.length);
            fullWalls++;
            continue;
          }
          if (record.inert) continue; // the short-circuit never consults the policy
          walks++;
          expect(record.panel).toBe(policy!.panel);
        }
      }
    }
    // The property is vacuous if the generator never exercised a
    // consumer — guard the guard, on all FOUR branches. (The erase/turn
    // ratios were raised on 2026-08-11: with the room no longer making
    // room, a wall of three boards fills and STAYS full, and the old
    // ratios starved the walk branch down to a handful of samples.)
    expect(overflows).toBeGreaterThan(5);
    expect(walks).toBeGreaterThan(5);
    // The two new branches must also have been exercised, or the deletion
    // is being asserted over an empty set.
    expect(bursts).toBeGreaterThan(0);
    expect(fullWalls).toBeGreaterThan(0);
    // And across every seed the room synthesized nothing: for these
    // inputs every erase carries an `e…` key, which only the generator's
    // explicit `@erase` mints. A synthesized one would be keyed to a
    // content step or a turn, and would show up here.
    for (const seed of SEEDS) {
      const layout = foldBoardLayout(randomSteps(seed, 80), 3, 100);
      for (const op of layout.eraseOps) expect(op.key.startsWith("e")).toBe(true);
    }
  });

  test("PREFIX STABILITY holds with turns in the generator — a turn only moves the pen, placed steps never move", () => {
    for (const seed of [21, 22, 23]) {
      const steps = randomSteps(seed, 80);
      const full = foldBoardLayout(steps, 4, 100);
      for (const cut of [1, 9, 27, 50, 79]) {
        const prefix = foldBoardLayout(steps.slice(0, cut), 4, 100);
        for (const [key, assignment] of prefix.assignments) {
          expect(full.assignments.get(key)).toEqual(assignment);
        }
        expect(full.eraseOps.slice(0, prefix.eraseOps.length)).toEqual([
          ...prefix.eraseOps,
        ]);
        expect(full.turns.slice(0, prefix.turns.length)).toEqual([
          ...prefix.turns,
        ]);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Plan — one 走位 unit; the notes projection ignores it
// ────────────────────────────────────────────────────────────────────────────

describe("@turn — the plan (§7.6-Q2/Q4)", () => {
  const turnStep: Step = { kind: "turn", srcSpan: { start: 10, end: 15 } };

  test("plans exactly ONE unit at DurationConstants.turn, srcSpan = its own line (G6)", () => {
    const units = planStepUnits(turnStep, D);
    expect(units).toEqual([
      {
        kind: "turn",
        srcSpan: { start: 10, end: 15 },
        duration: D.turn,
        gapBefore: 0,
        gapAfter: 0,
      },
    ]);
  });

  test("the plan is tier-blind: the same single unit regardless of any fold verdict", () => {
    // planStepUnits has no fold input at all — the signature is the proof;
    // this pins the count so a future "helpful" tier branch fails loudly.
    expect(planStepUnits(turnStep, D)).toHaveLength(1);
  });

  test("the notes projection plans zero units for a turn — a room action, like the eraser", () => {
    const lecture = parseLecture("@board 2\n\n# 题\n\n甲。\n\n@turn\n\n乙。\n");
    const board = planLecture(lecture, D);
    const notes = planLecture(lecture, D, { omitStageSteps: true });
    expect(board.some((p) => p.step.kind === "turn")).toBe(true);
    expect(notes.some((p) => p.step.kind === "turn")).toBe(false);
    // StepRefs of surviving steps are untouched (address interop, Q4).
    const refsOf = (plans: typeof notes) =>
      plans
        .filter((p) => p.step.kind === "prose")
        .map((p) => `${p.ref.section}:${p.ref.step}`);
    expect(refsOf(notes)).toEqual(refsOf(board));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Stage — a turn is not writing (P1-3 family)
// ────────────────────────────────────────────────────────────────────────────

describe("@turn — camera neutrality (P1-3 applied, §7.6-Q2)", () => {
  // A tall strip: the clamp box must not pin every walk to y = 0.
  const view: StageView = { viewW: 800, viewH: 600, panelW: 800, panelH: 4000 };
  const rect = (top: number): { left: number; top: number; right: number; bottom: number } => ({
    left: 0,
    top,
    right: 400,
    bottom: top + 40,
  });

  test("a latched @focus pose rides through a turn: the next move departs from the LATCHED pose, not a decayed follow", () => {
    const inputs: StageStepInput[] = [
      { kind: "write", rect: rect(0) },
      { kind: "camera", op: "focus", anchor: rect(2000) },
      { kind: "turn", rect: { left: 0, top: 0, right: 800, bottom: 0 } },
      { kind: "camera", op: "focus", anchor: rect(100) },
    ];
    const ops = resolveCameraOps(inputs, view, D);
    expect(ops).toHaveLength(2);
    // Second move's from-pose IS the first move's target — the register
    // stayed latched across the turn (a write there would have decayed it).
    expect(ops[1]!.move!.from).toEqual(ops[0]!.move!.to);
  });

  test("with the register silent, the simulation walks to the turn's target board head — same arithmetic as the live follow", () => {
    const headAt = (top: number) => ({ left: 0, top, right: 800, bottom: top });
    const silent: StageStepInput[] = [
      { kind: "write", rect: rect(0) },
      { kind: "turn", rect: headAt(3000) },
      { kind: "camera", op: "overview", anchor: null },
    ];
    const walked = resolveCameraOps(silent, view, D);
    const without = resolveCameraOps(
      [silent[0]!, silent[2]!],
      view,
      D,
    );
    // Since 2026-08-11 a silent-register walk RESOLVES A MOVE of its own
    // (turn-walk.test.ts owns that behaviour), so the overview is the
    // SECOND op here and the first is the walk itself. The property this
    // test has always pinned is unchanged: the walk moved the simulated
    // rest, and the overview departs from there rather than from the
    // pre-turn camera.
    expect(walked).toHaveLength(2);
    expect(walked[0]!.index).toBe(1);
    expect(walked[1]!.move!.from).not.toEqual(without[0]!.move!.from);
    // …and "there" is exactly where the walk landed.
    expect(walked[1]!.move!.from).toEqual(walked[0]!.move!.to);
  });

  test("a turn schedule entry never ends a hold: the pose decays only at the next WRITE entry", () => {
    const entries = [
      { kind: "write" as const, start: 0, end: 1 },
      {
        kind: "camera" as const,
        start: 1,
        end: 2,
        move: {
          from: { x: 0, y: 0, z: 1 },
          to: { x: 0, y: 500, z: 1 },
        },
      },
      { kind: "turn" as const, start: 2, end: 3 },
      { kind: "write" as const, start: 4, end: 5 },
    ];
    const schedule = buildStageSchedule(entries, view, D.cameraRho);
    expect(schedule.moves).toHaveLength(1);
    // Held straight through the turn's window…
    expect(schedule.moves[0]!.holdUntil).toBe(4);
    expect(stageStateAt(schedule, 2.5).camera).toEqual({
      kind: "pose",
      x: 0,
      y: 500,
      z: 1,
    });
    // …and back to follow once writing resumes.
    expect(stageStateAt(schedule, 4.5).camera).toEqual({ kind: "follow" });
  });
});
