/**
 * `@at` in the fold (canvas pivot V2, design §2/§3/§4/§7 — 2026-08-11).
 *
 * `at-dialect.test.ts` pins the PARSER's half (the closed vocabulary, the
 * two refusals, the anchor form). This file pins what the fold does with
 * the verb once it is a step:
 *
 *  - the pen walks, and every later content step lands in the region it
 *    walked to (pen-scoped, §3.4-A);
 *  - a named region is a FRAME: x/w from the word, a private cursor, and
 *    it NEVER migrates — it bursts where it stands (§4);
 *  - `full` keeps the ROOM's flow physics no matter how it was entered
 *    (§7.2's dividing line is the WORD, not the entry);
 *  - the board-wide front counts every standing box, so the flow never
 *    writes over a corner's ink (§2.2);
 *  - erase narrowed to the region (§3.5), and the front falls back only
 *    past what the erase actually took;
 *  - the strip's placements are EPISODIC, and only the anchored form
 *    resumes one (§3.6);
 *  - and the property the whole re-basing rests on: a document that never
 *    says `@at` runs the pre-region arithmetic, statement for statement.
 */

import { describe, expect, test } from "bun:test";

import {
  foldBoardLayout,
  scanRegionWords,
  standingBoxes,
  type LayoutStepInput,
} from "../engine/layout.js";
import {
  REGION_GUTTER,
  detectCollisions,
  type RegionName,
} from "../engine/regions.js";

const content = (key: string, height: number): LayoutStepInput => ({
  kind: "content",
  key,
  height,
});
const boxed = (
  key: string,
  h: number,
  marginTop = 0,
  marginBottom = 0,
): LayoutStepInput => ({
  kind: "content",
  key,
  height: h + marginTop + marginBottom,
  box: { h, marginTop, marginBottom },
});
const at = (
  key: string,
  region: RegionName,
  anchorKey?: string,
): LayoutStepInput => ({
  kind: "at",
  key,
  region,
  ...(anchorKey !== undefined ? { anchorKey } : {}),
});
const erase = (key: string, anchorKey?: string): LayoutStepInput => ({
  kind: "erase",
  key,
  ...(anchorKey !== undefined ? { anchorKey } : {}),
});

/** A bounded wall: 2 boards, face 1000 × 600. */
const W = 1000;
const H = 600;
/** The §3.2 table's derived numbers, restated here so a silent change to
 *  the gutter cannot slip through this file unnoticed. */
const HALF = (W - REGION_GUTTER) / 2; // 488
const RIGHT_X = W - HALF; // 512
const HALF_H = (H - REGION_GUTTER) / 2; // 288
const BOTTOM_Y = H - HALF_H; // 312

// ────────────────────────────────────────────────────────────────────────────
// The walk
// ────────────────────────────────────────────────────────────────────────────

describe("@at — the pen walks, and the writing follows it (§3.4-A)", () => {
  test("every content step after the walk lands in that region, until the next @at", () => {
    const layout = foldBoardLayout(
      [
        boxed("flow", 100),
        at("a1", "right"),
        boxed("r1", 60),
        boxed("r2", 60),
        at("a2", "full"),
        boxed("flow2", 40),
      ],
      2,
      H,
      undefined,
      W,
    );
    expect(layout.assignments.get("flow")!.region).toBe("full");
    expect(layout.assignments.get("r1")!.region).toBe("right");
    expect(layout.assignments.get("r2")!.region).toBe("right");
    expect(layout.assignments.get("flow2")!.region).toBe("full");
    // The pen's final position is reported, not re-derived by consumers.
    expect(layout.pen).toEqual({ panel: 0, region: "full" });
  });

  test("the region word gives x and w; the frame's top gives the first y (§3.2 table)", () => {
    const layout = foldBoardLayout(
      [at("a1", "bottom-right"), boxed("br", 50, 8)],
      2,
      H,
      undefined,
      W,
    );
    expect(layout.boxes.get("br")).toEqual({
      x: RIGHT_X,
      y: BOTTOM_Y + 8, // frame top + its own margin-top
      w: HALF,
    });
    const record = layout.regions.get("0:bottom-right")!;
    expect(record.name).toBe("bottom-right");
    expect(record.frame).toEqual({ x: RIGHT_X, y: BOTTOM_Y, w: HALF, h: HALF_H });
  });

  test("a named region has a PRIVATE cursor: it chains on its own front, not the board's", () => {
    const layout = foldBoardLayout(
      [
        boxed("tall", 400), // the flow reaches 400 down the face
        at("a1", "right"),
        boxed("r1", 30),
        boxed("r2", 30, 10),
      ],
      2,
      H,
      undefined,
      W,
    );
    // The corner starts at ITS frame's top (0), not below the tall flow
    // box — the author's frame, the author's cursor.
    expect(layout.boxes.get("r1")!.y).toBe(0);
    expect(layout.boxes.get("r2")!.y).toBe(40); // 0 + 30 + max(0, 10)
  });

  test("a walk to a region that resolves to nothing on this face is refused, never silently defaulted", () => {
    // The parser makes a strip-illegal word a BadStep, so this input is
    // already degenerate; the fold refusing to guess is the same rule
    // stated twice on purpose (no silent fallback that puts content
    // somewhere the author never said).
    const layout = foldBoardLayout(
      [at("a1", "top-left"), boxed("x", 40)],
      1,
      Infinity,
      undefined,
      W,
    );
    expect(layout.assignments.get("x")!.region).toBe("full");
    expect(layout.regions.has("0:top-left")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §2.2 — the room's flow never writes over standing ink
// ────────────────────────────────────────────────────────────────────────────

describe("the board-wide front (§2.2)", () => {
  test("the flow carries on below EVERYTHING standing — a corner's ink included", () => {
    const layout = foldBoardLayout(
      [
        boxed("flow1", 100),
        at("a1", "right"),
        boxed("corner", 250), // reaches 250 — deeper than the flow's 100
        at("a2", "full"),
        boxed("flow2", 40, 6),
      ],
      2,
      H,
      undefined,
      W,
    );
    // Not 100 + 6 (the flow's own last box) — 250 + 6, below the corner.
    expect(layout.boxes.get("flow2")!.y).toBe(256);
    expect(layout.boxes.get("flow2")!.x).toBe(0);
    expect(layout.boxes.get("flow2")!.w).toBe(W);
  });

  test("the front takes the margin-bottom of the box that DEFINES it, ties to the later-placed", () => {
    // The corner is deepest and carries a 30px margin-bottom; the flow box
    // that follows collapses against THAT, not against the shallower
    // flow box above it (which carried 4).
    const layout = foldBoardLayout(
      [
        boxed("flow1", 100, 0, 4),
        at("a1", "right"),
        boxed("corner", 250, 0, 30),
        at("a2", "full"),
        boxed("flow2", 40, 10),
      ],
      2,
      H,
      undefined,
      W,
    );
    expect(layout.boxes.get("flow2")!.y).toBe(280); // 250 + max(30, 10)
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §4 — hard size, soft consequence
// ────────────────────────────────────────────────────────────────────────────

describe("burst (§4): a full frame overflows where it stands", () => {
  test("a named region NEVER migrates — and the overflow is reported in px", () => {
    const layout = foldBoardLayout(
      [at("a1", "top-left"), boxed("big", 400)],
      3,
      H,
      undefined,
      W,
    );
    // Board 0, not "walked to board 1 because it did not fit".
    expect(layout.assignments.get("big")).toEqual({
      panel: 0,
      region: "top-left",
      run: "0.0",
    });
    expect(layout.bursts).toEqual([
      {
        panel: 0,
        region: "top-left",
        name: "top-left",
        key: "big",
        overflow: 400 - HALF_H, // 112
        frameHeight: HALF_H,
        frame: { x: 0, y: 0, w: HALF, h: HALF_H },
        // W8 — the burst is a quarter's worth: it spills into the lower
        // half of the SAME board, where the reader still has every word.
        // Nothing is past the board's own floor, so nothing is cut.
        cut: 0,
      },
    ]);
    // Nothing was retired to make room, and no other board was touched.
    expect(layout.eraseOps).toEqual([]);
    expect(layout.panels[1]!.opened).toBe(false);
  });

  test("a frame that fits does not burst — and the strip's frames cannot", () => {
    const fits = foldBoardLayout(
      [at("a1", "top-left"), boxed("ok", 200)],
      2,
      H,
      undefined,
      W,
    );
    expect(fits.bursts).toEqual([]);
    // The strip: h = Infinity, so the predicate is false by arithmetic.
    const strip = foldBoardLayout(
      [at("a1", "right"), boxed("huge", 99999)],
      1,
      Infinity,
      undefined,
      W,
    );
    expect(strip.bursts).toEqual([]);
    expect(strip.regions.get("0:right#1")!.frame.h).toBe(Infinity);
  });

  test("W8 — `cut` separates writing the reader still has from writing the board ate", () => {
    // A full-height column bursting by 100px puts that 100px past the
    // BOARD's own floor, where the panel clips it: the reader loses the
    // end of the sentence and the picture shows a clean edge. That is a
    // different fact from the `top-left` burst above (same predicate, same
    // px, every word still on the board), and before W8 nothing in the
    // fold's output could tell an author which one they had.
    const layout = foldBoardLayout(
      [at("a1", "left"), boxed("tall", H + 100)],
      2,
      H,
      undefined,
      W,
    );
    expect(layout.bursts).toEqual([
      {
        panel: 0,
        region: "left",
        name: "left",
        key: "tall",
        overflow: 100,
        frameHeight: H,
        frame: { x: 0, y: 0, w: HALF, h: H },
        cut: 100,
      },
    ]);
    // The strip has no floor, so it can cut nothing — the same arithmetic
    // that makes its frames unburstable.
    const strip = foldBoardLayout(
      [at("a1", "right"), boxed("huge", 99999)],
      1,
      Infinity,
      undefined,
      W,
    );
    expect(strip.bursts).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §7.2 — the dividing line is the WORD, not the entry
// ────────────────────────────────────────────────────────────────────────────

describe("`@at full` keeps the room's flow physics (§7.2)", () => {
  test("entered EXPLICITLY, `full` still walks to a clean board when it overflows", () => {
    const layout = foldBoardLayout(
      [at("a1", "full"), content("a", 90), content("b", 90)],
      2,
      100,
    );
    // The mechanical evidence for the dividing line: saying the word out
    // loud does not cost this board its walk.
    expect(layout.assignments.get("b")!.panel).toBe(1);
    expect(layout.cur).toBe(1);
  });

  test("a NAMED region entered the same way does not walk — it bursts (the other side of the line)", () => {
    const layout = foldBoardLayout(
      [at("a1", "left"), boxed("a", 500), boxed("b", 500)],
      2,
      H,
      undefined,
      W,
    );
    expect(layout.assignments.get("b")!.panel).toBe(0);
    expect(layout.panels[1]!.opened).toBe(false);
    expect(layout.bursts).toHaveLength(1);
  });

  test("a `@turn` puts the pen back in `full` — a walk to a new board is a walk to its flow", () => {
    const layout = foldBoardLayout(
      [at("a1", "right"), content("r", 30), { kind: "turn", key: "t1" }, content("n", 30)],
      2,
      100,
    );
    expect(layout.assignments.get("n")!.region).toBe("full");
    expect(layout.pen).toEqual({ panel: 1, region: "full" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §3.5 — erase narrowed to the region
// ────────────────────────────────────────────────────────────────────────────

describe("region-scoped erase (§3.5)", () => {
  test("bare @erase wipes the PEN's region and leaves the rest of the board standing", () => {
    const layout = foldBoardLayout(
      [
        boxed("flow", 100),
        at("a1", "right"),
        boxed("r1", 60),
        erase("e1"),
        boxed("r2", 40),
      ],
      2,
      H,
      undefined,
      W,
    );
    expect(layout.eraseOps).toEqual([
      { key: "e1", panel: 0, region: "right", run: "0.1", targets: ["r1"] },
    ]);
    // `flow` was never a target — the eraser's unit is the region.
    expect(layout.assignments.get("flow")!.run).toBe("0.0");
    // The wiped region restarts at its own frame top.
    expect(layout.boxes.get("r2")!.y).toBe(0);
  });

  test("an erase in the corner does NOT invite the flow to write over ink still standing", () => {
    // The front must fall back only past what the erase actually took.
    // Snapping it to zero would put the next flow box on top of `flow`.
    const layout = foldBoardLayout(
      [
        boxed("flow", 100),
        at("a1", "right"),
        boxed("corner", 250),
        erase("e1"), // wipes `right` only
        at("a2", "full"),
        boxed("flow2", 40),
      ],
      2,
      H,
      undefined,
      W,
    );
    expect(layout.eraseOps[0]!.targets).toEqual(["corner"]);
    expect(layout.boxes.get("flow2")!.y).toBe(100); // below `flow`, not 0
  });

  test("the anchored form wipes the region the ANCHOR stands in, wherever the pen is", () => {
    const layout = foldBoardLayout(
      [
        at("a1", "top-left"),
        boxed("corner", 50),
        at("a2", "full"),
        boxed("flow", 60),
        erase("e1", "corner"),
        boxed("after", 40),
      ],
      2,
      H,
      undefined,
      W,
    );
    expect(layout.eraseOps).toEqual([
      { key: "e1", panel: 0, region: "top-left", run: "0.0", targets: ["corner"] },
    ]);
    // The pen never moved: `after` is still in the flow.
    expect(layout.assignments.get("after")!.region).toBe("full");
  });

  test("erasing every region empties the board — and only then is it clean again", () => {
    const inputs: LayoutStepInput[] = [
      at("a1", "left"),
      boxed("l", 50),
      at("a2", "right"),
      boxed("r", 50),
    ];
    const held = foldBoardLayout(inputs, 2, H, undefined, W);
    expect(held.panels[0]!.empty).toBe(false);
    const halfWiped = foldBoardLayout(
      [...inputs, erase("e1", "l")],
      2,
      H,
      undefined,
      W,
    );
    // A corner definition still stands: the board is NOT clean.
    expect(halfWiped.panels[0]!.empty).toBe(false);
    const wiped = foldBoardLayout(
      [...inputs, erase("e1", "l"), erase("e2", "r")],
      2,
      H,
      undefined,
      W,
    );
    expect(wiped.panels[0]!.empty).toBe(true);
  });

  test("a @turn away from a board holding ONLY a corner definition is a real walk", () => {
    // The inherited judgement call, stated as a test: inertness asks
    // "does anything stand on this board, in ANY region?", not "is the
    // pen's own region empty?". A turn that walked away from standing
    // ink and called itself a beat would leave the corner unrecoverable
    // to `cleanBoardTarget` and to the eye.
    const layout = foldBoardLayout(
      [at("a1", "top-left"), content("def", 30), { kind: "turn", key: "t1" }],
      2,
      100,
    );
    expect(layout.turns).toEqual([
      { key: "t1", panel: 1, inert: false, fullWall: false, fill: expect.any(Number) },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §3.6 — the strip's placements
// ────────────────────────────────────────────────────────────────────────────

describe("the strip: placements are episodic (§3.6)", () => {
  test("every bare @at opens a NEW placement at the write front", () => {
    const layout = foldBoardLayout(
      [
        boxed("p1", 200),
        at("a1", "right"),
        boxed("fig1", 80),
        at("a2", "full"),
        boxed("p2", 300),
        at("a3", "right"), // NOT a return to the column 500px above
        boxed("fig2", 80),
      ],
      1,
      Infinity,
      undefined,
      W,
    );
    expect(layout.assignments.get("fig1")!.region).toBe("right#1");
    expect(layout.assignments.get("fig2")!.region).toBe("right#2");
    // Each opened at the front of the moment it was declared.
    expect(layout.boxes.get("fig1")!.y).toBe(200);
    expect(layout.boxes.get("fig1")!.x).toBe(RIGHT_X);
    // And note where `p2` went: BELOW the figure (280), not beside it.
    // `@at full` is the room's flow, and the room's flow never writes
    // over standing ink (§2.2) — "figure right, prose left" is said with
    // `@at left`, in three declarations, exactly as §3.4-A's table says.
    // The strip's next placement therefore opens at 580.
    expect(layout.boxes.get("p2")!.y).toBe(280);
    expect(layout.boxes.get("fig2")!.y).toBe(580);
  });

  test("only the ANCHORED form resumes an earlier placement (the back-fill leg)", () => {
    const layout = foldBoardLayout(
      [
        at("a1", "right"),
        boxed("fig", 80),
        at("a2", "full"),
        boxed("prose", 300),
        at("a3", "right", "fig"), // back to the placement holding `fig`
        boxed("caption", 40),
      ],
      1,
      Infinity,
      undefined,
      W,
    );
    expect(layout.assignments.get("caption")!.region).toBe("right#1");
    // Resumed at the placement's own cursor, not at the document front.
    expect(layout.boxes.get("caption")!.y).toBe(80);
  });

  test("an anchor in a DIFFERENT word opens a top-ALIGNED sibling — two columns set against each other", () => {
    const layout = foldBoardLayout(
      [
        boxed("head", 120),
        at("a1", "left"),
        boxed("colA", 200),
        at("a2", "right", "colA"), // B, aligned with A's top
        boxed("colB", 150),
      ],
      1,
      Infinity,
      undefined,
      W,
    );
    const a = layout.boxes.get("colA")!;
    const b = layout.boxes.get("colB")!;
    expect(a.y).toBe(120);
    expect(b.y).toBe(120); // the whole point: their tops agree
    expect(a.x).toBe(0);
    expect(b.x).toBe(RIGHT_X);
    // Placement ids carry the BOARD's placement ordinal, not a per-word
    // one: `left` took #1, so its sibling is `right#2`. The number names
    // an episode on this face, which is the thing that has to be unique.
    expect(layout.assignments.get("colB")!.region).toBe("right#2");
  });

  test("an anchor that folded to nothing moves the pen NOWHERE (§3.1's degradation)", () => {
    const layout = foldBoardLayout(
      [
        at("a1", "right"),
        boxed("fig", 80),
        at("a2", "full"),
        boxed("prose", 100),
        at("a3", "right", "ghost"), // resolves to no assignment
        boxed("after", 40),
      ],
      1,
      Infinity,
      undefined,
      W,
    );
    // Still in the flow — NOT dropped into a fresh placement the author
    // never asked for.
    expect(layout.assignments.get("after")!.region).toBe("full");
    expect(layout.regions.has("0:right#2")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The property the re-basing rests on
// ────────────────────────────────────────────────────────────────────────────

describe("zero `@at` ⇒ the pre-region arithmetic, untouched", () => {
  test("a document that never says @at allocates no region state and reports only `full`", () => {
    const layout = foldBoardLayout(
      [boxed("a", 100, 12, 8), boxed("b", 80, 6, 10), boxed("c", 40, 14, 4)],
      1,
      Infinity,
      undefined,
      W,
    );
    // One record per opened board, and it is the panel's own flow.
    expect([...layout.regions.keys()]).toEqual(["0:full"]);
    expect(layout.regions.get("0:full")!.frame).toEqual({
      x: 0,
      y: 0,
      w: W,
      h: Infinity,
    });
    // The §7.5 chain, unchanged: y(first) = its own margin-top, then
    // y(next) = prev bottom + max(prev marginBottom, own marginTop).
    expect(layout.boxes.get("a")!.y).toBe(12);
    expect(layout.boxes.get("b")!.y).toBe(12 + 100 + 8);
    expect(layout.boxes.get("c")!.y).toBe(120 + 80 + 14);
    for (const box of layout.boxes.values()) {
      expect(box.x).toBe(0);
      expect(box.w).toBe(W);
    }
    expect(layout.bursts).toEqual([]);
  });

  test("inserting an @at is an R4-class shift — downstream moves, the prefix never does", () => {
    const head: LayoutStepInput[] = [boxed("a", 100), boxed("b", 80)];
    const before = foldBoardLayout([...head, boxed("c", 40)], 1, Infinity, undefined, W);
    const after = foldBoardLayout(
      [...head, at("a1", "right"), boxed("c", 40)],
      1,
      Infinity,
      undefined,
      W,
    );
    for (const key of ["a", "b"]) {
      expect(after.boxes.get(key)).toEqual(before.boxes.get(key)!);
    }
    // `c` changed region AND width — that is the R4 family, said out loud.
    expect(before.boxes.get("c")!.w).toBe(W);
    expect(after.boxes.get("c")!.w).toBe(HALF);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The measure pass's pre-scan (§7.2's build-order pin)
// ────────────────────────────────────────────────────────────────────────────

describe("scanRegionWords — a step's width, knowable before any height is read", () => {
  test("the pen's word is a pure function of the sequence: @at says it, @turn returns it to `full`", () => {
    const words = scanRegionWords([
      boxed("flow", 10),
      at("a1", "right"),
      boxed("r1", 10),
      boxed("r2", 10),
      { kind: "turn", key: "t1" },
      boxed("after", 10),
      at("a2", "bottom-left", "r1"),
      boxed("bl", 10),
    ]);
    expect([...words]).toEqual([
      ["flow", "full"],
      ["r1", "right"],
      ["r2", "right"],
      ["after", "full"],
      ["bl", "bottom-left"],
    ]);
  });

  test("a document that never says @at comes out ALL `full` — the zero-override path", () => {
    const steps = [boxed("a", 10), erase("e1"), boxed("b", 10), boxed("c", 10)];
    const words = scanRegionWords(steps);
    expect([...words.values()].every((w) => w === "full")).toBe(true);
    // …and the fold agrees, step for step. The two are asserted against
    // each other rather than against a literal, because the corrective
    // pass in the host compares exactly these two answers.
    const layout = foldBoardLayout(steps, 1, Infinity, undefined, W);
    for (const [key, assignment] of layout.assignments) {
      expect(assignment.region.split("#")[0]).toBe(words.get(key)!);
    }
  });

  test("it agrees with the fold on a document full of walks — including the strip's placements", () => {
    const steps: LayoutStepInput[] = [
      boxed("p1", 100),
      at("a1", "right"),
      boxed("fig1", 40),
      at("a2", "full"),
      boxed("p2", 100),
      at("a3", "left"),
      boxed("colA", 60),
      at("a4", "right", "colA"),
      boxed("colB", 60),
    ];
    const words = scanRegionWords(steps);
    const layout = foldBoardLayout(steps, 1, Infinity, undefined, W);
    for (const [key, assignment] of layout.assignments) {
      // The placement id carries an episode number; the WORD is its stem,
      // and the word is all a measure pass needs.
      expect(assignment.region.split("#")[0]).toBe(words.get(key)!);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §3.2's recorded expressive gap, and the shape that says the same lecture
// without it. `place-test` / `place-test-fixed` are these two documents.
// ────────────────────────────────────────────────────────────────────────────

describe("the banner-plus-columns gap (§3.2) and its authoring way out", () => {
  /** The lecture both shapes tell: a title, a lead-in, two columns, a close. */
  const banner = (region: RegionName | null, keys: [string, string]) => [
    ...(region ? [at(`at-${keys[0]}`, region)] : []),
    boxed(keys[0], 59, 0, 26),
    boxed(keys[1], 45, 26, 26),
  ];

  test("the naive shape collides: a named region starts at its WORD's y, over the flow", () => {
    const steps: LayoutStepInput[] = [
      ...banner(null, ["title", "lead"]),
      at("a1", "left"),
      boxed("leftHead", 48, 26, 20),
      at("a2", "right"),
      boxed("rightHead", 48, 26, 20),
    ];
    const layout = foldBoardLayout(steps, 2, H, undefined, W);
    // The columns open at the table's y = 0 — NOT below the standing flow.
    expect(layout.boxes.get("leftHead")!.y).toBe(26);
    expect(layout.boxes.get("rightHead")!.y).toBe(26);
    // The flow's title stands from 0 to 59, so both columns land on it.
    expect(layout.boxes.get("title")!.y).toBe(0);
    const hits = detectCollisions(standingBoxes(layout, steps));
    expect(hits.length).toBeGreaterThan(0);
    // Both parties are named, and the flow is one of them — this is the
    // claim-vs-ink case the finding has to qualify.
    expect(hits.some((h) => h.a.region === "full" || h.b.region === "full")).toBe(true);
  });

  test("§3.2's way out — `top` banner + the two bottom corners — stands clear", () => {
    const steps: LayoutStepInput[] = [
      ...banner("top", ["title", "lead"]),
      at("a1", "bottom-left"),
      boxed("leftHead", 48, 26, 20),
      boxed("leftBody", 45, 20, 20),
      at("a2", "bottom-right"),
      boxed("rightHead", 48, 26, 20),
      boxed("rightBody", 45, 20, 20),
    ];
    const layout = foldBoardLayout(steps, 2, H, undefined, W);
    // The banner stands in the upper band, the columns in the lower one.
    expect(layout.boxes.get("title")!.y).toBe(0);
    expect(layout.boxes.get("leftHead")!.y).toBe(BOTTOM_Y + 26);
    expect(layout.boxes.get("rightHead")!.y).toBe(BOTTOM_Y + 26);
    // The two columns are top-ALIGNED — the reason both frames keep the
    // word's own y instead of chasing the write front.
    expect(layout.boxes.get("rightHead")!.y).toBe(layout.boxes.get("leftHead")!.y);
    expect(layout.boxes.get("leftHead")!.x).toBe(0);
    expect(layout.boxes.get("rightHead")!.x).toBe(RIGHT_X);
    // And nothing stands on anything: the board the author meant.
    expect(detectCollisions(standingBoxes(layout, steps))).toEqual([]);
    expect(layout.bursts).toEqual([]);
  });
});
