/**
 * The board snapshot (S1) — the third projection, pinned per the design's
 * acceptance list (§13):
 *
 *  - the cut & growth consistency blocker (§3): a cutIndex fold IS the
 *    full fold's mid-state, byte for byte — and a sliced-input fold is
 *    demonstrably NOT (P1-2's mechanism, kept out of the projection);
 *  - the render's exact wording (§4.3): the normal shape, the full-room
 *    warning shape, the "by the room" ledger, the catching-up tail;
 *  - scenarios: pure strip / staged multi-board midway / all erased / a
 *    section cut in half by an erase (§5's granularity floor) / cut
 *    midway (the S2 human-view op) / the empty board;
 *  - `pen.nextOverflow` reads the SAME exported policy the fold runs —
 *    including its `null`, which since 2026-08-11 renders as the FULL
 *    WALL (design §7.3: the room has nothing clean to give and will not
 *    name a victim).
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import {
  cleanBoardTarget,
  foldBoardLayout,
  type LayoutStepInput,
} from "../engine/layout.js";
import {
  deriveBoardSnapshot,
  emptyBoardSnapshot,
  renderSnapshot,
} from "../viewer/board-snapshot.js";

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

// ────────────────────────────────────────────────────────────────────────────
// §3 — the cut & growth blocker
// ────────────────────────────────────────────────────────────────────────────

describe("cutIndex — the fold stopped at a document position (§3)", () => {
  // A graph frame in the prefix whose measured height is the ACCUMULATED
  // union (340), regrown by a layer that sits AFTER the cut (growth 160).
  const inputs: LayoutStepInput[] = [
    content("0:0", 100),
    { kind: "content", key: "0:1", height: 340, container: "graph:流程" },
    content("0:2", 260),
    content("0:3", 110),
    { kind: "content", key: "0:4", height: 0, container: "graph:流程", growth: 160 },
  ];

  test("the cut fold IS the full fold's mid-state — the growthOf pre-pass runs over ALL inputs", () => {
    const full = foldBoardLayout(inputs, 2, 600);
    const cut = foldBoardLayout(inputs, 2, 600, 4);
    // Assignments byte-equal on every prefix key.
    for (const key of ["0:0", "0:1", "0:2", "0:3"]) {
      expect(cut.assignments.get(key)).toEqual(full.assignments.get(key));
    }
    // The frame is charged at height − FULL Σgrowth = 340 − 160 = 180:
    // board 0 stands at 100 + 180 + 260 = 540, the tail overflowed.
    expect(cut.panels[0]!.cursor).toBe(540);
    expect(cut.assignments.get("0:3")).toEqual({ panel: 1, region: "full", run: "1.0" });
    expect(cut.cur).toBe(1);
  });

  test("slicing the input array instead reproduces P1-2's mechanism — the trap the cut parameter exists to avoid", () => {
    const sliced = foldBoardLayout(inputs.slice(0, 4), 2, 600);
    // The sliced fold cannot see the post-cut layer's growth declaration:
    // the frame is over-charged at 340, the cursor inflates to 700, and a
    // step the audience has already seen changes boards.
    expect(sliced.panels[0]!.cursor).not.toBe(540);
    expect(sliced.assignments.get("0:2")).toEqual({ panel: 1, region: "full", run: "1.0" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The staged multi-board mid-lecture snapshot — the design's core scenario
// ────────────────────────────────────────────────────────────────────────────

/**
 * A 2-board lecture deep enough that a board has already been retired and
 * the wall has since filled again. Until 2026-08-11 the retirement here
 * was the ROOM's (a synthesized auto-erase of the earliest-filled board);
 * the canvas pivot deleted that physics, so the AUTHOR says it — with an
 * `@erase "锚"`, which is now the only way a board is ever cleared.
 */
const STAGED_SRC = `@board 2

# 为什么加机器不一定更快

甲零段落。

乙零段落。

丙零段落。

## 先把那句口头禅立在这里

甲一段落。

乙一段落。

@erase "甲零段落"

丙一段落。

## 换一个问法

把乘出来的东西求平均。
`;

/** Fold inputs keyed the way the host keys them (layoutKey = section:step,
 *  heading = -1), heights synthetic, board-config skipped. */
const STAGED_INPUTS: LayoutStepInput[] = [
  content("0:-1", 10),
  content("0:1", 30),
  content("0:2", 30),
  content("0:3", 30), // board 0 full (100)
  content("1:-1", 10), // → board 1 (fresh)
  content("1:0", 30),
  content("1:1", 30),
  erase("1:2", "0:-1"), // the author retires board 0 — the room never would
  content("1:3", 40), // → the freshly wiped board 0 (tier 2, "wiped")
  content("2:-1", 10),
  content("2:0", 20),
];

describe("the staged snapshot — three questions, one glance (§4)", () => {
  const lecture = parseLecture(STAGED_SRC);
  const layout = foldBoardLayout(STAGED_INPUTS, 2, 100);
  const snapshot = deriveBoardSnapshot(lecture, layout, STAGED_INPUTS, 100);

  test("fixture sanity: exactly one erase, and it is the AUTHOR's", () => {
    expect(layout.eraseOps).toEqual([
      {
        key: "1:2",
        panel: 0,
        region: "full",
        run: "0.0",
        targets: ["0:-1", "0:1", "0:2", "0:3"],
      },
    ]);
    // …and the wall it left behind is full again, with nothing synthesized
    // to relieve it: both boards stand, so the policy has no answer.
    expect(cleanBoardTarget(layout.panels)).toBeNull();
  });

  test("① room: occupancy + the blank list; ② erasable: finished/dormant; ③ still standing: step ranges + the erased ledger", () => {
    expect(snapshot.pen.panel).toBe(0);
    expect(snapshot.boards[0]!.occupancy).toEqual({
      usedPx: 70,
      budgetPx: 100,
      fraction: 0.7,
    });
    // Board 0's standing run: §1 step 4 (the erase itself is step 3),
    // then §2 (title + step 1).
    expect(snapshot.boards[0]!.standing).toEqual([
      {
        section: 1,
        label: "先把那句口头禅立在这里",
        steps: [4, 4],
        finished: true,
      },
      { section: 2, label: "换一个问法", steps: [1, 1], finished: false },
    ]);
    // Board 1 holds §1's first half, finished AND dormant — "the board
    // you may erase" is a mechanical fact plus the agent's judgment.
    expect(snapshot.boards[1]!.standing).toEqual([
      {
        section: 1,
        label: "先把那句口头禅立在这里",
        steps: [1, 2],
        finished: true,
      },
    ]);
    expect(snapshot.boards[1]!.dormant).toBe(true);
    expect(snapshot.boards[0]!.dormant).toBe(false);
    // The negative list for question ③: §0 is gone, said with a count.
    expect(snapshot.boards[0]!.erased).toEqual({
      runs: 1,
      byAuto: 0, // the room synthesizes none — this one is the author's
      sections: ['§0 "为什么加机器不一定更快"'],
      steps: 4,
    });
    expect(snapshot.tip).toEqual({
      address: { section: 2, step: 1 },
      excerpt: "把乘出来的东西求平均。",
      panel: 0,
    });
    expect(snapshot.basis).toEqual({ steps: 11, measured: "complete" });
  });

  test("pen.nextOverflow IS the exported policy's answer — the third consumer (§4.1)", () => {
    // The policy's `null` is a real answer, and the projection must NOT
    // invent one on top of it: the snapshot names no victim board and
    // quotes no "would erase" ledger, because there is nothing the room
    // would erase (design §7.3).
    expect(cleanBoardTarget(layout.panels)).toBeNull();
    expect(snapshot.pen.nextOverflow).toEqual({ kind: "full-wall" });
    expect(JSON.stringify(snapshot)).not.toContain("wouldErase");
  });

  test("the render, pinned to the exact wording (§4.3 — full-room warning shape)", () => {
    expect(renderSnapshot(snapshot)).toBe(
      [
        "The pen is on board 1 — 70% used, room for ~1 more step like the ones standing.",
        "The wall is full — nothing clean to give; retiring is yours to say.",
        'board 1 — 70% · §1 "先把那句口头禅立在这里" step 4 standing · §2 "换一个问法" step 1 standing · current',
        'board 2 — 70% · §1 "先把那句口头禅立在这里" steps 1–2 standing · finished',
        'Erased so far: board 1, once (§0 "为什么加机器不一定更快", 4 steps).',
        'Tip: §2 step 1 "把乘出来的东西求平均。" — the last thing written.',
        "This answers all 11 steps of board.md, measured.",
      ].join("\n"),
    );
  });

  test("the catching-up tail replaces the honesty line and never lies (§6)", () => {
    const stale = deriveBoardSnapshot(
      lecture,
      layout,
      STAGED_INPUTS,
      100,
      "catching-up",
    );
    const lines = renderSnapshot(stale).split("\n");
    expect(lines[lines.length - 1]).toBe(
      "The board is still catching up to board.md — this answers what is standing now; ask again in a moment for the tail.",
    );
    expect(renderSnapshot(stale)).not.toContain("measured.");
  });

  test("blank boards render their two vocabularies — fresh and wiped (§4.3 second-line shape)", () => {
    // Fresh: a young lecture on 3 boards.
    const young = foldBoardLayout(
      [content("0:-1", 10), content("0:1", 40)],
      3,
      100,
    );
    const early = deriveBoardSnapshot(
      lecture,
      young,
      [content("0:-1", 10), content("0:1", 40)],
      100,
    );
    // NB: `@board 2` occupies engine step 0:0, so the first paragraph is
    // user-facing step 2 — the established ViewerAddress mapping.
    expect(renderSnapshot(early)).toBe(
      [
        "The pen is on board 1 — 50% used, room for ~2 more steps like the ones standing.",
        "If board 1 fills, writing continues on board 2 (blank, fresh).",
        'board 1 — 50% · §0 "为什么加机器不一定更快" step 2 standing · current',
        "board 2 — blank (fresh)",
        "board 3 — blank (fresh)",
        'Tip: §0 step 2 "甲零段落。" — the last thing written.',
        "This answers all 2 steps of board.md, measured.",
      ].join("\n"),
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §5 — the granularity floor: a section cut in half by an erase
// ────────────────────────────────────────────────────────────────────────────

describe("a section cut in half by an erase — why the floor is (board × section) + step ranges (§5)", () => {
  test("the standing half answers question ③ by range; the erased half is on the negative list", () => {
    const lecture = parseLecture(STAGED_SRC);
    // §1's steps 1–2 stand on board 0, get erased, steps 3 re-open it.
    const inputs: LayoutStepInput[] = [
      content("1:0", 30),
      content("1:1", 30),
      erase("e", "1:0"),
      content("1:2", 30),
    ];
    const layout = foldBoardLayout(inputs, 2, 100);
    const snapshot = deriveBoardSnapshot(lecture, layout, inputs, 100);
    // An anchor quoted from §1 step 2 maps OUTSIDE [3, 3] — gone; a quote
    // from step 3 maps inside — standing. Without the range the answer
    // would be "§1 is on board 1", which cannot answer either.
    expect(snapshot.boards[0]!.standing).toEqual([
      {
        section: 1,
        label: "先把那句口头禅立在这里",
        steps: [3, 3],
        finished: false,
      },
    ]);
    expect(snapshot.boards[0]!.erased.sections).toEqual([
      '§1 "先把那句口头禅立在这里"',
    ]);
    expect(snapshot.boards[0]!.erased.byAuto).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The strip, the all-erased board, the midway cut, the empty board
// ────────────────────────────────────────────────────────────────────────────

describe("the remaining §13 scenarios", () => {
  const lecture = parseLecture(STAGED_SRC);

  test("the pure strip: no budget, no overflow line, honest 'never runs out'", () => {
    const inputs = [content("0:-1", 10), content("0:1", 40), content("0:2", 40)];
    const layout = foldBoardLayout(inputs, 1, Infinity);
    const snapshot = deriveBoardSnapshot(lecture, layout, inputs, Infinity);
    expect(snapshot.pen).toEqual({
      panel: 0,
      roomSteps: null,
      nextOverflow: null,
    });
    expect(snapshot.boards[0]!.occupancy.budgetPx).toBeNull();
    expect(renderSnapshot(snapshot)).toBe(
      [
        "The pen is on the long strip — it never runs out.",
        'board 1 — §0 "为什么加机器不一定更快" steps 2–3 standing · current',
        'Tip: §0 step 3 "乙零段落。" — the last thing written.',
        "This answers all 3 steps of board.md, measured.",
      ].join("\n"),
    );
  });

  test("everything erased: wiped boards, a full ledger, and the tip still answers 'what was last written'", () => {
    const inputs: LayoutStepInput[] = [
      content("0:1", 60),
      content("0:2", 60), // → board 1
      erase("e1", "0:1"),
      erase("e2", "0:2"),
    ];
    const layout = foldBoardLayout(inputs, 2, 100);
    const snapshot = deriveBoardSnapshot(lecture, layout, inputs, 100);
    expect(snapshot.boards.map((b) => b.blank)).toEqual(["wiped", "wiped"]);
    expect(snapshot.boards.map((b) => b.erased.runs)).toEqual([1, 1]);
    // The last content step keeps its address even though it was erased —
    // "the last thing written", not "the last thing standing".
    expect(snapshot.tip).toEqual({
      address: { section: 0, step: 3 },
      excerpt: "乙零段落。",
      panel: 1,
    });
  });

  test("cut midway — the S2 human-view call: same derive, earlier cut, honest basis", () => {
    const layout = foldBoardLayout(STAGED_INPUTS, 2, 100, 4);
    const snapshot = deriveBoardSnapshot(
      lecture,
      layout,
      STAGED_INPUTS,
      100,
      "complete",
      4,
    );
    expect(snapshot.basis.steps).toBe(4);
    // At cut 4 nothing has been erased yet and the pen is still on board 0.
    expect(snapshot.boards[0]!.erased.runs).toBe(0);
    expect(snapshot.tip!.address).toEqual({ section: 0, step: 4 });
  });

  test("the empty board — an honestly empty answer, never an invented one", () => {
    expect(emptyBoardSnapshot()).toEqual({
      boards: [],
      pen: { panel: 0, roomSteps: null, nextOverflow: null },
      tip: null,
      basis: { steps: 0, measured: "complete" },
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// W9 (2026-08-12) — THE GLANCE SEES WHAT STANDS ON THE FACE
//
// The instrument that lied, on its loudest surface. `occupancy` read the
// room's flow charge and `standing` read the flow's run, so a board composed
// entirely of `@at` placements was answered for as "blank (wiped)" at 0% —
// and `renderSnapshot` short-circuits on `blank`, so the percentage never
// even printed. Three authors met this in the field; the third photographed
// every board by hand because the number they were handed was false.
// ────────────────────────────────────────────────────────────────────────────

describe("a board composed with `@at` (W9)", () => {
  const lecture = parseLecture(STAGED_SRC);
  const W = 1154;
  const H = 700;
  const at = (key: string, region: string): LayoutStepInput =>
    ({ kind: "at", key, region }) as LayoutStepInput;

  const inputs: LayoutStepInput[] = [
    at("a1", "left"),
    content("0:1", H * 0.8),
    at("a2", "right"),
    content("0:2", H * 0.8),
  ];
  const layout = foldBoardLayout(inputs, 2, H, undefined, W, 2);
  const snapshot = deriveBoardSnapshot(lecture, layout, inputs, H);

  test("it is not a blank board, and its occupancy is the fold's own number", () => {
    expect(snapshot.boards[0]!.blank).toBeNull();
    expect(snapshot.boards[0]!.occupancy).toEqual({
      usedPx: 1120,
      budgetPx: 1400,
      fraction: 0.8,
    });
    // The one number, twice: the finding's percentage and the glance's.
    expect(snapshot.boards[0]!.occupancy.fraction).toBe(layout.panels[0]!.fill);
  });

  test("its standing content is listed — every open run on the face", () => {
    expect(snapshot.boards[0]!.standing).toEqual([
      {
        section: 0,
        label: "为什么加机器不一定更快",
        steps: [2, 3],
        finished: false,
      },
    ]);
  });

  test("the render says the percentage the author acts on", () => {
    expect(renderSnapshot(snapshot)).toBe(
      [
        "The pen is on board 1 — 80% used, no room for another step like the ones standing.",
        "If board 1 fills, writing continues on board 2 (blank, fresh).",
        'board 1 — 80% · §0 "为什么加机器不一定更快" steps 2–3 standing · current',
        "board 2 — blank (fresh)",
        'Tip: §0 step 3 "乙零段落。" — the last thing written.',
        "This answers all 4 steps of board.md, measured.",
      ].join("\n"),
    );
  });

  test("the room left is the room the PEN has — its own frame, not the face", () => {
    // The pen stands in `right`, which is half written. The face has a
    // whole blank half beside it, and promising the pen that room would be
    // the same over-promise from the other side: the frame does not
    // migrate.
    const half: LayoutStepInput[] = [
      at("a1", "right"),
      content("0:1", H * 0.5),
      content("0:2", H * 0.25),
    ];
    const fold = foldBoardLayout(half, 2, H, undefined, W, 2);
    const shot = deriveBoardSnapshot(lecture, fold, half, H);
    // unit = median(350, 175) = 262.5; the frame has 175 left → 0 steps.
    expect(shot.pen.roomSteps).toBe(0);
    // …and the same charges standing in the room's own flow leave the
    // second column open, so the pen there is told it has room.
    const flow: LayoutStepInput[] = [content("0:1", H * 0.5), content("0:2", H * 0.25)];
    const flowShot = deriveBoardSnapshot(
      lecture,
      foldBoardLayout(flow, 2, H, undefined, W, 2),
      flow,
      H,
    );
    expect(flowShot.pen.roomSteps).toBe(3);
  });

  test("ink in a region shortens the FLOW's room, instead of being invisible to it", () => {
    // The pen is back in the room's own flow (a `@turn` puts it there), on
    // a board whose left half an `@at` already filled. Before W9 the flow
    // was promised the whole face.
    const inputs2: LayoutStepInput[] = [
      at("a1", "left"),
      content("0:1", H),
      { kind: "at", key: "a2", region: "full" } as LayoutStepInput,
      content("0:2", H * 0.25),
    ];
    const fold = foldBoardLayout(inputs2, 1, H, undefined, W, 2);
    const shot = deriveBoardSnapshot(lecture, fold, inputs2, H);
    expect(fold.pen.region).toBe("full");
    // At two columns `left` IS column 1 (`regions.test.ts` pins that
    // equality), so the flow's 175 stands under ink that already covers
    // that half to the bottom: the face is half covered, not 62.5%.
    expect(fold.panels[0]!.fill).toBeCloseTo(0.5, 10);
    // unit = median(700, 175) = 437.5; the bare half is 700 → one step.
    // Before W9 the flow was promised 1400 − 175 = 1225, i.e. two.
    expect(shot.pen.roomSteps).toBe(1);
  });
});
