/**
 * regions.test.ts (canvas pivot V2) — the region vocabulary's rectangle
 * table, its two facets, and the collision predicate, pinned as pure
 * arithmetic (design §14: "`engine/regions.ts` 纯测试").
 *
 * These are the tests that make the preview's honesty MECHANICAL: the fold,
 * `frame-board` and `check-board` all read this module, so a rectangle
 * pinned here is a rectangle all three agree on.
 */

import { describe, expect, it } from "bun:test";
import {
  BOUNDED_REGION_WORDS,
  COLLISION_EPS,
  MAX_COLUMNS,
  MIN_COLUMN_W,
  REGION_GUTTER,
  STRIP_REGION_WORDS,
  STRIP_VERTICAL_WORD_MESSAGE,
  classifyRegionWord,
  collide,
  columnCountFor,
  columnRect,
  columnSpan,
  columnWidth,
  detectCollisions,
  intersection,
  overlapH,
  overlapW,
  regionSpan,
  regionWordsFor,
  resolveRegionRect,
  spanUnionArea,
  writtenSpan,
  type Rect,
  type StandingBox,
} from "../engine/regions.js";

const W = 1000;
const H = 700;
const g = REGION_GUTTER;
const w2 = (W - g) / 2; // 488
const h2 = (H - g) / 2; // 338

const rectOf = (word: string, width = W, height = H): Rect => {
  const verdict = resolveRegionRect(word, width, height);
  if (!verdict.ok) throw new Error(`expected a rect for ${word}`);
  return verdict.rect;
};

describe("the region vocabulary", () => {
  it("is nine words on a bounded board and three on the strip", () => {
    expect(BOUNDED_REGION_WORDS.length).toBe(9);
    expect([...BOUNDED_REGION_WORDS]).toEqual([
      "full",
      "left",
      "right",
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
    expect([...STRIP_REGION_WORDS]).toEqual(["full", "left", "right"]);
    expect(regionWordsFor("strip")).toEqual(STRIP_REGION_WORDS);
    expect(regionWordsFor("bounded")).toEqual(BOUNDED_REGION_WORDS);
  });

  it("names no number — the words carry no pixels or percentages", () => {
    for (const word of BOUNDED_REGION_WORDS) {
      expect(word).not.toMatch(/[0-9]/);
      expect(word).not.toMatch(/%/);
    }
  });
});

describe("resolveRegionRect — the design §3.2 table, word for word", () => {
  it("places every bounded word exactly where the table says", () => {
    expect(rectOf("full")).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(rectOf("left")).toEqual({ x: 0, y: 0, w: w2, h: H });
    expect(rectOf("right")).toEqual({ x: W - w2, y: 0, w: w2, h: H });
    expect(rectOf("top")).toEqual({ x: 0, y: 0, w: W, h: h2 });
    expect(rectOf("bottom")).toEqual({ x: 0, y: H - h2, w: W, h: h2 });
    expect(rectOf("top-left")).toEqual({ x: 0, y: 0, w: w2, h: h2 });
    expect(rectOf("top-right")).toEqual({ x: W - w2, y: 0, w: w2, h: h2 });
    expect(rectOf("bottom-left")).toEqual({ x: 0, y: H - h2, w: w2, h: h2 });
    expect(rectOf("bottom-right")).toEqual({
      x: W - w2,
      y: H - h2,
      w: w2,
      h: h2,
    });
  });

  it("leaves exactly one gutter between the two columns and the two bands", () => {
    const left = rectOf("left");
    const right = rectOf("right");
    expect(right.x - (left.x + left.w)).toBe(g);
    const top = rectOf("top");
    const bottom = rectOf("bottom");
    expect(bottom.y - (top.y + top.h)).toBe(g);
  });

  it("gives a half-width word half the face, so a chart in it renders narrow", () => {
    // The design's stated repair path for "the figure is too big": pick a
    // narrower word. That only works if the word actually narrows the box.
    expect(rectOf("right").w).toBeLessThan(rectOf("full").w / 2 + 1);
  });
});

describe("the strip facet — an unbounded face admits no vertical fraction", () => {
  it("keeps full / left / right, each with no bottom", () => {
    for (const word of ["full", "left", "right"] as const) {
      const rect = rectOf(word, W, Infinity);
      expect(rect.h).toBe(Infinity);
      expect(rect.y).toBe(0);
    }
    expect(rectOf("left", W, Infinity).w).toBe(w2);
    expect(rectOf("right", W, Infinity).x).toBe(W - w2);
  });

  it("refuses top / bottom / the four corners with the pinned teaching message", () => {
    for (const word of [
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as const) {
      const verdict = resolveRegionRect(word, W, Infinity);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) throw new Error("unreachable");
      expect(verdict.reason).toBe("unbounded-axis");
      expect(verdict.message).toBe(STRIP_VERTICAL_WORD_MESSAGE);
    }
  });

  it("states the way out verbatim — columns, an anchor, or real boards", () => {
    expect(STRIP_VERTICAL_WORD_MESSAGE).toBe(
      "the strip has no bottom — its face grows with the talk; use left / right, anchor with a quote, or stand boards with @board 2–4.",
    );
  });
});

describe("a word that is in no vocabulary", () => {
  it("is refused on both faces, and the message lists that face's whole set", () => {
    const bounded = classifyRegionWord("middle", "bounded");
    expect(bounded.ok).toBe(false);
    if (bounded.ok) throw new Error("unreachable");
    expect(bounded.reason).toBe("unknown");
    for (const word of BOUNDED_REGION_WORDS) {
      expect(bounded.message).toContain(word);
    }

    const strip = classifyRegionWord("middle", "strip");
    expect(strip.ok).toBe(false);
    if (strip.ok) throw new Error("unreachable");
    expect(strip.message).toContain("full");
    expect(strip.message).not.toContain("bottom-right");
  });

  it("refuses a pixel or a percentage as loudly as any other non-word", () => {
    for (const attempt of ["120px", "50%", "x=40", "2/3"]) {
      expect(classifyRegionWord(attempt, "bounded").ok).toBe(false);
    }
  });
});

describe("the collision predicate", () => {
  const at = (x: number, y: number, w: number, h: number): Rect => ({
    x,
    y,
    w,
    h,
  });

  it("is symmetric", () => {
    const a = at(0, 0, 100, 100);
    const b = at(50, 50, 100, 100);
    expect(collide(a, b)).toBe(true);
    expect(collide(b, a)).toBe(true);
  });

  it("needs more than EPS on BOTH axes", () => {
    const a = at(0, 0, 100, 100);
    // Deep overlap horizontally, a hair vertically ⇒ not a collision.
    expect(collide(a, at(10, 100 - COLLISION_EPS, 100, 100))).toBe(false);
    expect(collide(a, at(10, 100 - COLLISION_EPS - 0.5, 100, 100))).toBe(true);
    // …and the mirror case.
    expect(collide(a, at(100 - COLLISION_EPS, 10, 100, 100))).toBe(false);
    expect(collide(a, at(100 - COLLISION_EPS - 0.5, 10, 100, 100))).toBe(true);
  });

  it("never fires between the two columns — the gutter is the first guard", () => {
    const left = rectOf("left");
    const right = rectOf("right");
    expect(collide(left, right)).toBe(false);
    expect(overlapW(left, right)).toBe(0);
    // Corners of the same column DO share their column, top and bottom do not.
    expect(collide(rectOf("top-left"), rectOf("bottom-left"))).toBe(false);
    expect(collide(rectOf("top-left"), rectOf("top-right"))).toBe(false);
  });

  it("fires between a full-width word and any column word", () => {
    expect(collide(rectOf("full"), rectOf("right"))).toBe(true);
    expect(collide(rectOf("top"), rectOf("top-left"))).toBe(true);
  });

  it("reports the intersection rectangle", () => {
    expect(intersection(at(0, 0, 100, 100), at(60, 70, 100, 100))).toEqual({
      x: 60,
      y: 70,
      w: 40,
      h: 30,
    });
    expect(overlapH(at(0, 0, 10, 10), at(0, 40, 10, 10))).toBe(0);
  });
});

describe("detectCollisions over standing boxes", () => {
  const box = (
    key: string,
    region: string,
    rect: Rect,
    panel = 0,
  ): StandingBox => ({ key, region, rect, panel });

  it("finds nothing when two columns are set against each other", () => {
    const left = rectOf("left");
    const right = rectOf("right");
    const boxes = [
      box("1:0", "0:left", { ...left, h: 200 }),
      box("1:1", "0:left", { ...left, y: 220, h: 200 }),
      box("1:2", "0:right", { ...right, h: 400 }),
    ];
    expect(detectCollisions(boxes)).toEqual([]);
  });

  it("finds the flow sitting on a parked column", () => {
    const full = rectOf("full");
    const right = rectOf("right");
    const boxes = [
      box("1:0", "0:right", { ...right, y: 0, h: 180 }),
      box("1:1", "0:full", { ...full, y: 60, h: 120 }),
    ];
    const hits = detectCollisions(boxes);
    expect(hits.length).toBe(1);
    expect(hits[0]!.a.key).toBe("1:0");
    expect(hits[0]!.b.key).toBe("1:1");
    expect(hits[0]!.overlap.w).toBe(right.w);
    expect(hits[0]!.fraction).toBeGreaterThan(0.5);
  });

  it("never fires across boards", () => {
    const full = rectOf("full");
    const boxes = [
      box("1:0", "0:full", { ...full, h: 100 }, 0),
      box("1:1", "1:full", { ...full, h: 100 }, 1),
    ];
    expect(detectCollisions(boxes)).toEqual([]);
  });

  it("never fires inside one region — a run stacks, it does not collide", () => {
    const full = rectOf("full");
    const boxes = [
      box("1:0", "0:full", { ...full, y: 0, h: 100 }),
      // Deliberately overlapping coordinates: same region ⇒ still not a
      // collision. Stacking inside a run is the fold's business, not the
      // collision pass's.
      box("1:1", "0:full", { ...full, y: 50, h: 100 }),
    ];
    expect(detectCollisions(boxes)).toEqual([]);
  });

  it("does NOT invent a collision when the flow interleaves a placement (rev 2's box-vs-box proof)", () => {
    // The flow writes above the parked definition, the definition stands in
    // the top-right corner, and the flow resumes BELOW it. A region-span
    // predicate would swallow the corner whole and report a permanent
    // phantom; box against box sees the truth.
    const full = rectOf("full");
    const corner = rectOf("top-right");
    const boxes = [
      box("1:0", "0:full", { ...full, y: 0, h: 40 }),
      box("1:1", "0:top-right", { ...corner, y: 60, h: 100 }),
      box("1:2", "0:full", { ...full, y: 200, h: 60 }),
    ];
    // 1:0 ends at 40, the corner starts at 60, the flow resumes at 200.
    expect(detectCollisions(boxes)).toEqual([]);
  });

  it("reports the collision a burst creates, and only after the burst", () => {
    const full = rectOf("full");
    const corner = rectOf("top-right");
    const parked = box("1:1", "0:top-right", { ...corner, y: 40, h: 80 });
    const short = box("1:0", "0:full", { ...full, y: 0, h: 30 });
    expect(detectCollisions([short, parked])).toEqual([]);
    const burst = box("1:0", "0:full", { ...full, y: 0, h: 400 });
    expect(detectCollisions([burst, parked]).length).toBe(1);
  });

  it("is deterministic in the order it is handed", () => {
    const full = rectOf("full");
    const right = rectOf("right");
    const boxes = [
      box("1:0", "0:right", { ...right, h: 300 }),
      box("1:1", "0:full", { ...full, h: 300 }),
      box("1:2", "0:full", { ...full, y: 400, h: 50 }),
    ];
    const first = detectCollisions(boxes);
    const second = detectCollisions(boxes);
    expect(second).toEqual(first);
    expect(first.map((hit) => `${hit.a.key}|${hit.b.key}`)).toEqual([
      "1:0|1:1",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The column grid (W2, 2026-08-12) — how the room's own flow fills a face
// ────────────────────────────────────────────────────────────────────────────

describe("the column grid", () => {
  it("is one column on a face with no bottom — the strip never breaks", () => {
    expect(columnCountFor(1154, Infinity)).toBe(1);
    expect(columnCountFor(4000, Infinity)).toBe(1);
  });

  it("is one column on a face too narrow to divide, and never zero", () => {
    expect(columnCountFor(500, 700)).toBe(1);
    expect(columnCountFor(0, 700)).toBe(1);
    expect(columnCountFor(Number.NaN, 700)).toBe(1);
  });

  it("adds columns rather than widening them, and stops at MAX_COLUMNS", () => {
    // A column is a MEASURE: no column narrower than MIN_COLUMN_W, and as
    // many as that allows.
    expect(columnCountFor(MIN_COLUMN_W * 2 + REGION_GUTTER, 700)).toBe(2);
    expect(columnCountFor(MIN_COLUMN_W * 2 + REGION_GUTTER - 1, 700)).toBe(1);
    expect(columnCountFor(100000, 700)).toBe(MAX_COLUMNS);
  });

  it("the measured faces of the two live universes both land on 2", () => {
    // 937 = the product owner's window (appendix, 2026-08-12); 1154 = the
    // harness window this phase was tuned in. The column rule must not make
    // those two readers see structurally different boards.
    expect(columnCountFor(937, 638)).toBe(2);
    expect(columnCountFor(1154, 794)).toBe(2);
  });

  it("TWO COLUMNS ARE `left` AND `right`, to the number", () => {
    // The one equality that keeps `collide()` honest across the two
    // vocabularies. The column grid is the region table's own division of
    // the face, not a second, nearly-aligned one — §4.1's standing ban on a
    // second copy of any geometry, discharged by arithmetic.
    const W = 1154;
    const H = 794;
    for (const [i, word] of (["left", "right"] as const).entries()) {
      const region = resolveRegionRect(word, W, H);
      expect(region.ok).toBe(true);
      if (!region.ok) return;
      const col = columnRect(W, H, i, 2);
      expect(col.x).toBeCloseTo(region.rect.x, 10);
      expect(col.w).toBeCloseTo(region.rect.w, 10);
    }
  });

  it("columns are gutter-separated and exactly fill the face", () => {
    const W = 1400;
    const n = 3;
    const rects = [0, 1, 2].map((i) => columnRect(W, 700, i, n));
    expect(rects[0]!.x).toBe(0);
    expect(rects[2]!.x + rects[2]!.w).toBeCloseTo(W, 10);
    for (let i = 1; i < n; i++) {
      expect(rects[i]!.x - (rects[i - 1]!.x + rects[i - 1]!.w)).toBeCloseTo(
        REGION_GUTTER,
        10,
      );
      // Non-adjacent by the gutter ⇒ two columns can never collide on
      // rounding alone, the same guarantee `left`/`right` have.
      expect(collide(rects[i - 1]!, rects[i]!)).toBe(false);
    }
    expect(columnWidth(W, n)).toBeCloseTo(rects[0]!.w, 10);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The face as CAPACITY (W9) — the §3.2 table said in the unit square, and
// the union that keeps occupancy honest in both directions at once.
// ────────────────────────────────────────────────────────────────────────────

describe("the unit face", () => {
  it("is the region table with its gutter divided out", () => {
    // The parity that keeps this from being a SECOND geometry: on a face
    // big enough for the gutter's share to vanish, the normalized span IS
    // the resolved rectangle over the face. Both are exhaustive switches
    // over `RegionName`, so a tenth word cannot land in one and miss the
    // other — this pins that they also AGREE.
    const big = 1_000_000;
    for (const word of BOUNDED_REGION_WORDS) {
      const rect = resolveRegionRect(word, big, big);
      expect(rect.ok).toBe(true);
      if (!rect.ok) return;
      const span = regionSpan(word);
      expect(span.x0).toBeCloseTo(rect.rect.x / big, 4);
      expect(span.x1).toBeCloseTo((rect.rect.x + rect.rect.w) / big, 4);
      expect(span.y0).toBeCloseTo(rect.rect.y / big, 4);
      expect(span.y1).toBeCloseTo((rect.rect.y + rect.rect.h) / big, 4);
    }
  });

  it("holds the flow's columns as equal slabs, `full` at count 1", () => {
    expect(columnSpan(0, 1)).toEqual({ x0: 0, x1: 1, y0: 0, y1: 1 });
    expect(columnSpan(0, 1)).toEqual(regionSpan("full"));
    expect(columnSpan(1, 3)).toEqual({ x0: 1 / 3, x1: 2 / 3, y0: 0, y1: 1 });
    // Out-of-range asks clamp into the face rather than off it.
    expect(columnSpan(9, 2)).toEqual(columnSpan(1, 2));
  });

  it("writes a claim from its own top, and never past its own bottom", () => {
    const H = 700;
    expect(writtenSpan(regionSpan("full"), 350, H)).toEqual({
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 0.5,
    });
    // A `bottom` band starts halfway down and can only be half deep — a
    // burst covers no more face than the frame has.
    expect(writtenSpan(regionSpan("bottom"), H * 4, H)).toEqual({
      x0: 0,
      x1: 1,
      y0: 0.5,
      y1: 1,
    });
    // Nothing standing is no rectangle at all, not a flat one.
    expect(writtenSpan(regionSpan("left"), 0, H)).toBeNull();
    expect(writtenSpan(regionSpan("left"), 100, Infinity)).toBeNull();
  });
});

describe("spanUnionArea", () => {
  const face = { x0: 0, x1: 1, y0: 0, y1: 1 };

  it("counts overlapping claims once", () => {
    expect(spanUnionArea([face, face, face])).toBe(1);
    expect(
      spanUnionArea([regionSpan("left"), { x0: 0, x1: 0.25, y0: 0, y1: 1 }]),
    ).toBeCloseTo(0.5, 10);
  });

  it("adds disjoint claims", () => {
    expect(
      spanUnionArea([regionSpan("top-left"), regionSpan("bottom-right")]),
    ).toBeCloseTo(0.5, 10);
  });

  it("unions claims that share only a band", () => {
    // `top` over the left column: the shared quarter is counted once.
    expect(
      spanUnionArea([regionSpan("top"), regionSpan("left")]),
    ).toBeCloseTo(0.75, 10);
  });

  it("never exceeds the face, whatever it is handed", () => {
    expect(spanUnionArea(BOUNDED_REGION_WORDS.map(regionSpan))).toBe(1);
    expect(
      spanUnionArea([
        ...BOUNDED_REGION_WORDS.map(regionSpan),
        columnSpan(0, 3),
        columnSpan(1, 3),
        columnSpan(2, 3),
      ]),
    ).toBe(1);
  });

  it("is zero for nothing, and for claims with no extent", () => {
    expect(spanUnionArea([])).toBe(0);
    expect(spanUnionArea([{ x0: 0.5, x1: 0.5, y0: 0, y1: 1 }])).toBe(0);
    expect(spanUnionArea([{ x0: 0, x1: 1, y0: 0.5, y1: 0.5 }])).toBe(0);
  });

  it("resolves claims whose edges do not line up", () => {
    // Thirds against halves: no fixed grid refines both, which is why the
    // union is a sweep. `left` covers column 0 and half of column 1.
    const left = regionSpan("left");
    expect(
      spanUnionArea([left, columnSpan(0, 3)]),
    ).toBeCloseTo(0.5, 10);
    expect(
      spanUnionArea([left, columnSpan(2, 3)]),
    ).toBeCloseTo(0.5 + 1 / 3, 10);
    expect(
      spanUnionArea([
        { ...left, y1: 0.5 },
        { ...columnSpan(1, 3), y1: 0.5 },
      ]),
    ).toBeCloseTo(2 / 3 / 2, 10);
  });
});
