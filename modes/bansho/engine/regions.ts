/**
 * regions.ts (canvas pivot V2, design §3.2/§5.2/§7.4 — 2026-08-11) — the
 * region vocabulary, its rectangles, and the collision predicate.
 *
 * Layering (G2): engine core — zero DOM, zero React, no clock, no upward
 * imports. Everything here is rectangle arithmetic over numbers the fold
 * measured.
 *
 * THREE CONSUMERS, ONE IMPLEMENTATION. The fold (`engine/layout.ts`), the
 * preview (`frame-board`) and the diagnostic (`check-board`) all resolve a
 * region word through `resolveRegionRect` and all judge overlap through
 * `collide`. A second copy of either is drift — §4.1's standing ban —
 * because the preview's whole claim is that it draws the same rectangle the
 * fold will place. Extend HERE or nowhere.
 *
 * THE VOCABULARY IS CLOSED (design §3.2, ruled §17.1): nine words on a
 * bounded board, three on the strip. It grows by ADDING WORDS, never by
 * adding numbers — no pixels, no percentages, no coordinates. A word says
 * "how wide, which edge"; the FACE says "from where". That is why the strip
 * (whose face has no bottom) admits only the words that name no vertical
 * fraction: on an unbounded axis `top`/`bottom`/the corners have no
 * referent, and inventing one would either read the viewport (R8: resizing
 * a window would rewrite the canonical layout) or smuggle a page height
 * back in (pagination through the back door — the very thing the pivot
 * kills). The accepted expressive gap — a banner across the top with two
 * columns beneath it — is recorded in design §3.2 and ruled ACCEPTED in
 * §17.1; it is the evidence slot for a future `center`/thirds word, not a
 * defect.
 */

// ────────────────────────────────────────────────────────────────────────────
// Geometry constants (board px)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Gutter between neighbouring regions on one board face (board px). Sibling
 * of `PANEL_GAP` (the gap BETWEEN boards, layout.ts): the same idea one
 * grain finer. It is what makes `left` and `right` non-adjacent, so two
 * columns can never collide on rounding alone.
 */
export const REGION_GUTTER = 24;

/**
 * Collision tolerance (board px). Two boxes count as overlapping only past
 * this much on BOTH axes — a second guard beyond the gutter, so a hairline
 * of measurement noise is never reported to the author as a collision.
 */
export const COLLISION_EPS = 2;

// ────────────────────────────────────────────────────────────────────────────
// The vocabulary
// ────────────────────────────────────────────────────────────────────────────

/** Every region word, in the design §3.2 table's order. */
export const BOUNDED_REGION_WORDS = [
  "full",
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

/** The strip's facet: the words that name no vertical fraction. */
export const STRIP_REGION_WORDS = ["full", "left", "right"] as const;

export type RegionName = (typeof BOUNDED_REGION_WORDS)[number];

/** Which face the word is being said on. */
export type RegionFacet = "bounded" | "strip";

/** The default region — the room's own flow, and what every board that
 *  never says `@at` stands in (design §2.1: today's board IS the
 *  "one `full` region per board" special case). */
export const DEFAULT_REGION: RegionName = "full";

/** The words legal on a face. */
export function regionWordsFor(facet: RegionFacet): readonly RegionName[] {
  return facet === "strip" ? STRIP_REGION_WORDS : BOUNDED_REGION_WORDS;
}

/**
 * The strip's refusal, verbatim (design §3.6). Pinned as a constant because
 * it is the one place the dialect TEACHES its way out of a category error,
 * and the wording is under test.
 */
export const STRIP_VERTICAL_WORD_MESSAGE =
  "the strip has no bottom — its face grows with the talk; use left / right, anchor with a quote, or stand boards with @board 2–4.";

/** The message for a word that is in no vocabulary at all. */
export function unknownRegionMessage(facet: RegionFacet): string {
  return `unknown region — say one of ${regionWordsFor(facet).join(" / ")}`;
}

export type RegionWordVerdict =
  | { ok: true; name: RegionName }
  | { ok: false; reason: "unknown" | "unbounded-axis"; message: string };

/**
 * Judge one region word against a face. Both refusals are BadStep material
 * (design §3.2/§3.6) and carry their own teaching message: an unknown word
 * gets the face's whole vocabulary, a vertical word on the strip gets the
 * way out (columns, an anchor, or standing real boards).
 */
export function classifyRegionWord(
  word: string,
  facet: RegionFacet,
): RegionWordVerdict {
  const legal = regionWordsFor(facet);
  if ((legal as readonly string[]).includes(word)) {
    return { ok: true, name: word as RegionName };
  }
  if (
    facet === "strip" &&
    (BOUNDED_REGION_WORDS as readonly string[]).includes(word)
  ) {
    return {
      ok: false,
      reason: "unbounded-axis",
      message: STRIP_VERTICAL_WORD_MESSAGE,
    };
  }
  return { ok: false, reason: "unknown", message: unknownRegionMessage(facet) };
}

// ────────────────────────────────────────────────────────────────────────────
// Rectangles
// ────────────────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RegionRectVerdict =
  | { ok: true; rect: Rect }
  | { ok: false; reason: "unknown" | "unbounded-axis"; message: string };

/**
 * The design §3.2 table, and the ONLY implementation of it. `W`/`H` are the
 * board's CONTENT face; the strip passes `H = Infinity`, on which the
 * vertical-fraction words are a category error rather than a big number.
 *
 * The rect is face-relative and says only "how wide, which edge, which
 * vertical fraction". Where a strip PLACEMENT starts (its `frameTop`) is
 * the fold's verdict, not the word's — a strip region's `y` is 0 here and
 * the fold translates it to the write front (design §3.6).
 */
export function resolveRegionRect(
  word: string,
  W: number,
  H: number,
): RegionRectVerdict {
  const facet: RegionFacet = Number.isFinite(H) ? "bounded" : "strip";
  const verdict = classifyRegionWord(word, facet);
  if (!verdict.ok) return verdict;
  const g = REGION_GUTTER;
  const w2 = (W - g) / 2;
  const h2 = (H - g) / 2;
  const rightX = W - w2;
  const bottomY = H - h2;
  switch (verdict.name) {
    case "full":
      return { ok: true, rect: { x: 0, y: 0, w: W, h: H } };
    case "left":
      return { ok: true, rect: { x: 0, y: 0, w: w2, h: H } };
    case "right":
      return { ok: true, rect: { x: rightX, y: 0, w: w2, h: H } };
    case "top":
      return { ok: true, rect: { x: 0, y: 0, w: W, h: h2 } };
    case "bottom":
      return { ok: true, rect: { x: 0, y: bottomY, w: W, h: h2 } };
    case "top-left":
      return { ok: true, rect: { x: 0, y: 0, w: w2, h: h2 } };
    case "top-right":
      return { ok: true, rect: { x: rightX, y: 0, w: w2, h: h2 } };
    case "bottom-left":
      return { ok: true, rect: { x: 0, y: bottomY, w: w2, h: h2 } };
    case "bottom-right":
      return { ok: true, rect: { x: rightX, y: bottomY, w: w2, h: h2 } };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// The COLUMN GRID — how the room's own flow fills a face (W2, 2026-08-12)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A blackboard is wide, and a teacher does not write a page across it: they
 * fill the left of it top to bottom, then start again at the top of the
 * right. That is a TEXT-COLUMN property of a face, not a new region word —
 * `full` still means the whole face (design §3.2's table is untouched), and
 * `@at left` still explicitly names the left half. What changes is only
 * where the room's own flow puts its next box when the one before it
 * reached the bottom.
 *
 * The construction is deliberately the region table's own: N equal parts
 * separated by `REGION_GUTTER`. At N = 2 the columns are therefore
 * ARITHMETICALLY IDENTICAL to `left` and `right` — `w = (W − g) / 2`,
 * `x₁ = (W + g) / 2 = W − w`, the same two numbers `resolveRegionRect`
 * returns — which is what keeps `collide()` honest across the two
 * vocabularies instead of merely approximately aligned (`regions.test.ts`
 * pins the equality).
 */

/**
 * The narrowest column the room will open (board px). A column is a
 * MEASURE: a teacher writes lines of roughly ten to fifteen glyphs, so at
 * the board's body size this is about a dozen of them plus the slack a
 * display formula needs. Columns are as many as fit at no less than this,
 * which is why a wider board gets MORE columns rather than wider ones.
 */
export const MIN_COLUMN_W = 420;

/** Ceiling on the count. Past three the measure stops being a measure and
 *  starts being a newspaper. */
export const MAX_COLUMNS = 3;

/**
 * How many columns the room's flow fills a face in.
 *
 * A face with NO BOTTOM (the strip, `H = Infinity`) has exactly one: a
 * column break is "the flow reached the bottom and resumed at the top of
 * the next one", and an unbounded axis has no bottom to reach. Same
 * reasoning that keeps the vertical-fraction region words off the strip,
 * reached by the same arithmetic rather than by a special case.
 *
 * A pure function of the MEASURED FACE WIDTH — the number every wrap
 * decision already keys on — so this adds no new viewport dependency
 * (R8's envelope is unchanged: a resize already re-wraps).
 */
export function columnCountFor(faceW: number, faceH: number): number {
  if (!Number.isFinite(faceH)) return 1;
  if (!Number.isFinite(faceW) || faceW <= 0) return 1;
  const n = Math.floor((faceW + REGION_GUTTER) / (MIN_COLUMN_W + REGION_GUTTER));
  return Math.max(1, Math.min(MAX_COLUMNS, n));
}

/** One column's width on a face divided into `count` of them. */
export function columnWidth(faceW: number, count: number): number {
  const n = Math.max(1, count);
  return (faceW - REGION_GUTTER * (n - 1)) / n;
}

/** Column `index` of `count`, as a rectangle on the face. */
export function columnRect(
  faceW: number,
  faceH: number,
  index: number,
  count: number,
): Rect {
  const w = columnWidth(faceW, count);
  return { x: index * (w + REGION_GUTTER), y: 0, w, h: faceH };
}

// ────────────────────────────────────────────────────────────────────────────
// THE FACE AS CAPACITY — occupancy on the UNIT face (W9, 2026-08-12)
//
// "How full is this board" is a different question from "where does this box
// go", and it has to be answered in a different currency. A face's ink lives
// in several claims at once — the room's own flow columns AND every named
// region an `@at` opened — and the honest reading is the AREA THEY COVER
// BETWEEN THEM: two half-width pools written to 80% is a board 80% written
// on, not 0% (which is what summing the flow's cursors said, because `@at`
// charges no column) and not 160% (which is what summing the claims would
// say once `full` and `left` both hold ink — an overlap design §5.2
// deliberately ratifies).
//
// WHY THE UNIT FACE AND NOT PIXELS. The number has exactly two consumers and
// they must not disagree: `glance-board`'s per-board percentage and
// `turnUnderfilled`'s. The glance folds with NO FACE WIDTH at all
// (`viewer/glance.ts` passes `frameWidth = 0` — membership needs no
// geometry), so any occupancy computed from `resolveRegionRect`'s pixels
// would be garbage on the very surface an author reads. So occupancy is
// measured on the unit face: halves are halves, quarters are quarters, and
// the width never enters. What that drops is the GUTTER — 24px of
// separation between two claims. Separation is not room: a teacher cannot
// write in it, and no author reading "98%" would understand that the
// missing 2% is a margin. The gutter is geometry; occupancy is capacity.
//
// It is the §3.2 table said a second way, so it is written as an exhaustive
// switch over `RegionName` like `resolveRegionRect` is: a tenth word cannot
// be added to one and missed by the other without breaking the build, and
// `regions.test.ts` pins the two against each other in the large-face limit
// (where the gutter's share goes to zero). That is the standing ban's answer
// here — not a second geometry, one geometry with its gutter divided out.
// ────────────────────────────────────────────────────────────────────────────

/**
 * A claim on the UNIT face: `x` and `y` both run 0..1, left-to-right and
 * top-to-bottom. `full` is the whole square; `left` is its left half;
 * `top-right` its top-right quarter.
 */
export interface FaceSpan {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * What a region word CLAIMS of the face — the §3.2 table with its gutter
 * divided out (see the section header). `y1 - y0` is the word's own depth
 * budget: `full` / `left` / `right` may be written from the top of the face
 * to its bottom, the bands and corners only half that far before they burst.
 */
export function regionSpan(name: RegionName): FaceSpan {
  switch (name) {
    case "full":
      return { x0: 0, x1: 1, y0: 0, y1: 1 };
    case "left":
      return { x0: 0, x1: 0.5, y0: 0, y1: 1 };
    case "right":
      return { x0: 0.5, x1: 1, y0: 0, y1: 1 };
    case "top":
      return { x0: 0, x1: 1, y0: 0, y1: 0.5 };
    case "bottom":
      return { x0: 0, x1: 1, y0: 0.5, y1: 1 };
    case "top-left":
      return { x0: 0, x1: 0.5, y0: 0, y1: 0.5 };
    case "top-right":
      return { x0: 0.5, x1: 1, y0: 0, y1: 0.5 };
    case "bottom-left":
      return { x0: 0, x1: 0.5, y0: 0.5, y1: 1 };
    case "bottom-right":
      return { x0: 0.5, x1: 1, y0: 0.5, y1: 1 };
  }
}

/** What one flow column claims of the face — `count` equal slabs, full
 *  depth. At `count = 1` this is `full`, which is the pre-W2 face exactly. */
export function columnSpan(index: number, count: number): FaceSpan {
  const n = Math.max(1, Math.floor(count));
  const i = Math.min(Math.max(0, Math.floor(index)), n - 1);
  return { x0: i / n, x1: (i + 1) / n, y0: 0, y1: 1 };
}

/**
 * The part of a claim that is WRITTEN ON: its own top, down by the charge
 * standing in it, and never past its own bottom — writing that bursts a
 * frame covers no more of the face than the frame has (the burst itself is
 * `RegionBurst`'s to report, and it is reported in pixels, where it
 * happened). `null` when nothing stands in the claim at all, so an empty
 * region contributes no rectangle rather than a zero-height one.
 */
export function writtenSpan(
  claim: FaceSpan,
  charge: number,
  faceH: number,
): FaceSpan | null {
  if (!Number.isFinite(faceH) || faceH <= 0) return null;
  const depth = Math.min(
    Math.max(0, charge) / faceH,
    Math.max(0, claim.y1 - claim.y0),
  );
  if (depth <= 0) return null;
  return { x0: claim.x0, x1: claim.x1, y0: claim.y0, y1: claim.y0 + depth };
}

/**
 * The area of the UNION of unit-face spans, 0..1 — the one arithmetic that
 * makes occupancy honest in both directions at once. Overlapping claims are
 * counted once (a `full` box standing over a `left` corner does not make the
 * board 150% written on), and a face covered edge to edge reads exactly 1
 * BY CONSTRUCTION rather than by a clamp — there is no input for which this
 * returns more than the area of the square its spans lie in.
 *
 * A sweep, because the spans do not tile: the flow's three columns split the
 * face in thirds while `left`/`right` split it in halves, so no fixed grid
 * refines both. Distinct x edges cut the face into slabs; within a slab the
 * covering set is constant, so its y intervals merge in one pass. Bounded by
 * the vocabulary (nine words plus at most three columns), so this is a dozen
 * rectangles at worst and runs per board, per `@turn`.
 */
export function spanUnionArea(spans: readonly FaceSpan[]): number {
  const live = spans.filter((s) => s.x1 > s.x0 && s.y1 > s.y0);
  if (live.length === 0) return 0;
  const edges = [...new Set(live.flatMap((s) => [s.x0, s.x1]))].sort(
    (a, b) => a - b,
  );
  let area = 0;
  for (let i = 0; i + 1 < edges.length; i++) {
    const x0 = edges[i]!;
    const x1 = edges[i + 1]!;
    const width = x1 - x0;
    if (width <= 0) continue;
    const bands = live
      .filter((s) => s.x0 <= x0 && s.x1 >= x1)
      .map((s): [number, number] => [s.y0, s.y1])
      .sort((a, b) => a[0] - b[0]);
    let depth = 0;
    let open: [number, number] | null = null;
    for (const band of bands) {
      if (!open) {
        open = [band[0], band[1]];
        continue;
      }
      if (band[0] > open[1]) {
        depth += open[1] - open[0];
        open = [band[0], band[1]];
        continue;
      }
      open[1] = Math.max(open[1], band[1]);
    }
    if (open) depth += open[1] - open[0];
    area += width * depth;
  }
  return area;
}

// ────────────────────────────────────────────────────────────────────────────
// The collision predicate (design §5.2)
// ────────────────────────────────────────────────────────────────────────────

/** Overlap along one axis; 0 when the spans are disjoint. */
const overlap1d = (
  aStart: number,
  aSize: number,
  bStart: number,
  bSize: number,
): number => Math.max(0, Math.min(aStart + aSize, bStart + bSize) - Math.max(aStart, bStart));

export function overlapW(a: Rect, b: Rect): number {
  return overlap1d(a.x, a.w, b.x, b.w);
}

export function overlapH(a: Rect, b: Rect): number {
  return overlap1d(a.y, a.h, b.y, b.h);
}

/**
 * Do two rectangles collide? Overlap on BOTH axes by more than
 * `COLLISION_EPS`. Symmetric, total, and pure — the same predicate answers
 * "does this standing box sit on that one" (check-board) and "would this
 * candidate frame land on standing ink" (frame-board).
 */
export function collide(a: Rect, b: Rect): boolean {
  return overlapW(a, b) > COLLISION_EPS && overlapH(a, b) > COLLISION_EPS;
}

/** The intersection rectangle; zero-sized when they do not meet. */
export function intersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: overlapW(a, b), h: overlapH(a, b) };
}

/**
 * One standing box, as the collision pass sees it: whose it is, which board
 * it stands on, and which region/placement claims it.
 *
 * NAMING IS PART OF THE HONESTY (design §5.1): this rect is the box's
 * CLAIM, not its ink. A `full` prose box claims the whole board width even
 * where its last line stops short. V1 uses the claim on purpose — cheap,
 * deterministic, and conservative in the direction that gets LOOKED at
 * rather than the direction that hides a real overlap. Ink-level extent is
 * a V2 refinement with an explicit evidence bar (a false positive that
 * actually cost someone something, once).
 */
export interface StandingBox {
  /** Step key (`section:step`). */
  key: string;
  panel: number;
  /** Region key — the word on a bounded board, the placement id on a strip. */
  region: string;
  rect: Rect;
}

export interface BoxCollision {
  panel: number;
  a: StandingBox;
  b: StandingBox;
  overlap: Rect;
  /** Overlap area as a fraction (0..1) of the SMALLER box's area. */
  fraction: number;
}

const areaOf = (r: Rect): number => Math.max(0, r.w) * Math.max(0, r.h);

/**
 * Every collision among standing boxes — same board, DIFFERENT region, and
 * overlapping past the tolerance.
 *
 * The predicate lands on BOXES, never on a region's span rectangle (design
 * §5.2, rev 2). Under the front rule a `full` box may sit above AND below a
 * named placement; the region's span would then swallow the placement whole
 * and manufacture a permanent phantom collision. Box against box has no
 * such disease.
 *
 * Boxes are compared in the order given (document order at the call site),
 * so the output is deterministic and its dedupe keys are stable.
 */
export function detectCollisions(
  boxes: readonly StandingBox[],
): BoxCollision[] {
  const found: BoxCollision[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      if (a.panel !== b.panel) continue;
      if (a.region === b.region) continue;
      if (!collide(a.rect, b.rect)) continue;
      const overlap = intersection(a.rect, b.rect);
      const smaller = Math.min(areaOf(a.rect), areaOf(b.rect));
      found.push({
        panel: a.panel,
        a,
        b,
        overlap,
        fraction: smaller > 0 ? areaOf(overlap) / smaller : 0,
      });
    }
  }
  return found;
}
