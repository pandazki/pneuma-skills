/**
 * wall.ts — WHERE EACH BOARD STANDS. The one piece of wall arithmetic.
 *
 * A lecture hall's boards are not a filmstrip. They are sliding panels
 * stacked in columns AND rows — the wall behind the lectern in 26-100 is
 * two high and three across, and a reader looking at it sees a ROOM, not a
 * row of postcards receding to the right. Laying four boards out in one
 * line makes the wall 5.7 viewports wide and 0.9 tall: fitting it means
 * zooming to a quarter, and everything under the strip is void.
 *
 * So the wall is a GRID, and this module is the only place that knows its
 * shape. Every `panel * (panelW + PANEL_GAP)` in the host used to be its
 * own copy of that knowledge — five of them, all assuming one row. A
 * second copy of wall arithmetic is drift (the standing ban `regions.ts`
 * documents for `resolveRegionRect`), and a 2D wall is what turns the
 * assumption from "a scalar that happens to work" into a bug. One helper,
 * every call site through it.
 *
 * ── The slotting rule ──────────────────────────────────────────────────
 *
 *   cols = ceil(sqrt(n)),  rows = ceil(n / cols),  panels fill row-major.
 *
 *     1 → 1x1     2 → 2 across     3 → 2 over 1     4 → 2x2
 *
 * One rule, four rooms, and it lands on the arrangement a teacher would
 * choose in each case: a pair reads side by side, four reads as a proper
 * wall, and three is a wall with the bottom-right still bare — which is
 * what a three-board hall actually looks like. The empty slot is WALL, not
 * a phantom board: nothing is drawn there.
 *
 * Row-major is load-bearing beyond arithmetic: it is the reading order the
 * fold already assigns boards in (board 1 is written before board 2), and
 * CSS grid auto-placement follows the same order, so the DOM needs no
 * per-panel placement — the grid IS `wallSlot`, expressed once in CSS.
 *
 * Pure and dependency-free on purpose: the host, the camera simulation and
 * the wall map all need it, and none of them may reach into another's
 * layer to get it.
 */

/** How many boards stand across, and how many rows deep. */
export interface WallGrid {
  cols: number;
  rows: number;
}

/** One board's fixed size plus the wall showing between boards (board px). */
export interface WallGeometry {
  panelW: number;
  panelH: number;
  /** Gap between adjacent boards, both axes. */
  gap: number;
}

/** A board's origin on the wall — the stage point its top-left corner sits at. */
export interface WallSlot {
  x: number;
  y: number;
}

/**
 * The room's shape for `n` boards. Clamped to at least 1x1 so a degenerate
 * count (0, NaN, negative) reads as the single strip rather than dividing
 * by zero downstream.
 */
export function wallGrid(panelCount: number): WallGrid {
  const n = Number.isFinite(panelCount) ? Math.max(1, Math.floor(panelCount)) : 1;
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/**
 * Where board `panel` stands. Out-of-range indices clamp into the room
 * rather than returning a point off the wall — every caller here is asking
 * "walk the camera to this board", and walking into the void is never the
 * answer to that question.
 */
export function wallSlot(
  panel: number,
  panelCount: number,
  geom: WallGeometry,
): WallSlot {
  const { cols, rows } = wallGrid(panelCount);
  const idx = Number.isFinite(panel)
    ? Math.min(Math.max(0, Math.floor(panel)), cols * rows - 1)
    : 0;
  return {
    x: (idx % cols) * (geom.panelW + geom.gap),
    y: Math.floor(idx / cols) * (geom.panelH + geom.gap),
  };
}

/**
 * The whole wall's extent — the camera's clamp box and `@overview`'s
 * subject. Exactly one panel at count 1, so the single strip's arithmetic
 * is bit-identical to what it was before the wall had rows.
 */
export function wallExtent(
  panelCount: number,
  geom: WallGeometry,
): { w: number; h: number } {
  const { cols, rows } = wallGrid(panelCount);
  return {
    w: cols * geom.panelW + (cols - 1) * geom.gap,
    h: rows * geom.panelH + (rows - 1) * geom.gap,
  };
}

/*
 * `boardStandsWhole(geom, viewH)` used to live here: "does a whole board
 * fit the view at z = 1", the gate that decided whether the camera's rest
 * on a board was its CORNER or C1's vertical chase down a strip. It was
 * deleted on 2026-08-12 (defect W4a-3a) because a gate is the wrong shape
 * for the question. Answering "no" handed the camera to arithmetic that
 * does not know rows exist, and a row change on a short window then left
 * the view straddling the gap with the previous row still filling it.
 *
 * `engine/stage.ts::boardBandY` replaces it: the board's own HEIGHT
 * travels with its origin (`FollowBoard`), and one clamp says "stand at
 * the corner" where the board fits and "chase the pen, but never leave
 * this board" where it does not. Same predicate, no branch, and no way
 * for the live host and the canonical simulation to disagree about it.
 */

/**
 * The inverse: which board a stage point stands on. The point is quoted in
 * the same frame `wallSlot` returns, and the answer is clamped into the
 * occupied range — a point in the gap, in the bare slot of a three-board
 * room, or beyond the wall belongs to the nearest board that exists.
 */
export function wallSlotAt(
  point: { x: number; y: number },
  panelCount: number,
  geom: WallGeometry,
): number {
  const { cols, rows } = wallGrid(panelCount);
  const n = Number.isFinite(panelCount)
    ? Math.max(1, Math.floor(panelCount))
    : 1;
  const pitchX = geom.panelW + geom.gap;
  const pitchY = geom.panelH + geom.gap;
  const col =
    pitchX > 0
      ? Math.min(cols - 1, Math.max(0, Math.floor(point.x / pitchX)))
      : 0;
  const row =
    pitchY > 0
      ? Math.min(rows - 1, Math.max(0, Math.floor(point.y / pitchY)))
      : 0;
  return Math.min(n - 1, row * cols + col);
}
