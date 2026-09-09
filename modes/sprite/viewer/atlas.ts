/**
 * What the packed sheet's layout actually is — and whether we know it.
 *
 * The panel draws a grid over `sheet.png` and prints a cell size, which are
 * the two questions a sprite sheet gets asked ("where is frame 5", "how big is
 * a cell"). Both are DERIVED here rather than read back out of `atlas.json`,
 * so the panel needs no second fetch and works in the hosted player.
 *
 * The derivation has one soft spot, and this module exists to make it hard:
 * `motion.grid.cols` is the grid the SHEET WAS GENERATED on, while `pack`
 * called without `--cols` lays the frames out on `ceil(sqrt(n))` columns of
 * its own. When those two disagree the overlay is drawn on lines that are not
 * there and the printed cell size is wrong — a picture that looks exactly like
 * a correct one. So the layout is only reported as trusted when the packed
 * image really does divide into `cols × rows` whole cells, and when the cells
 * relate to the frames' own recorded size by ONE factor on both axes — that
 * factor is `pack --scale`, and reporting it is how the panel can say "128
 * became 125" instead of refusing a perfectly regular pack. Anything else
 * (no recorded size, a sheet the grid does not divide, a ratio that differs
 * between the axes) gets the bare sheet and a note; `atlas.json` on disk is
 * the truth in that case.
 */

import type { CharacterProject, Motion } from "../domain.js";
import { measuredAnchor } from "../domain.js";

/**
 * Why a layout could not be believed — as DATA, not a sentence.
 *
 * The panel is the only thing that turns this into words, and it does so
 * through the locale table: a note built here as English prose would be the
 * one string in the viewer that no translation could reach.
 */
export type AtlasNote =
  | { kind: "unmeasured" }
  | { kind: "not-whole-cells"; width: number; height: number; cols: number; rows: number }
  | {
      kind: "cell-mismatch";
      cols: number;
      rows: number;
      cellWidth: number;
      cellHeight: number;
      frameWidth: number;
      frameHeight: number;
    };

export interface AtlasGeometry {
  /** Packed image size as recorded when the asset was registered; 0 = unknown. */
  width: number;
  height: number;
  /** The motion's declared layout — what the overlay WOULD be drawn on. */
  cols: number;
  rows: number;
  /** Cell size implied by that layout; 0 when it cannot be trusted. */
  cellWidth: number;
  cellHeight: number;
  /**
   * How much `pack` scaled the frames on their way into the sheet — the
   * packed cell divided by the frame that went into it. `1` is a pack at
   * source size, `0.5` a `pack --scale 0.5`, and `null` means the frames
   * carry no recorded size so the question cannot be answered.
   */
  scale: number | null;
  /** True when the packed image really is `cols × rows` cells of that size. */
  trusted: boolean;
  /** Why not; null when it is trusted. */
  note: AtlasNote | null;
}

const dimension = (value: unknown): number => {
  const num = Number(value ?? 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
};

/** The packed layout of one motion, and the verdict on believing it. */
export function atlasGeometry(
  project: CharacterProject,
  motion: Motion,
): AtlasGeometry {
  const sheet = motion.sheet ? project.assetsById.get(motion.sheet) : undefined;
  const width = dimension(sheet?.metadata.width);
  const height = dimension(sheet?.metadata.height);
  const cols = Math.max(1, Math.floor(motion.grid.cols));
  const rows = Math.max(1, Math.ceil(motion.frames.length / cols));
  const blank = {
    width,
    height,
    cols,
    rows,
    cellWidth: 0,
    cellHeight: 0,
    scale: null,
  };

  if (width === 0 || height === 0) {
    return { ...blank, trusted: false, note: { kind: "unmeasured" } };
  }

  if (width % cols !== 0 || height % rows !== 0) {
    return {
      ...blank,
      trusted: false,
      note: { kind: "not-whole-cells", width, height, cols, rows },
    };
  }

  const cellWidth = width / cols;
  const cellHeight = height / rows;

  // The frames are the cells the pack step was given, so when their size is
  // on record it is the cheapest possible check on the division above.
  const first = motion.frames[0]
    ? project.assetsById.get(motion.frames[0])
    : undefined;
  const frameWidth = dimension(first?.metadata.width);
  const frameHeight = dimension(first?.metadata.height);
  const known = frameWidth > 0 && frameHeight > 0;

  if (known && (frameWidth !== cellWidth || frameHeight !== cellHeight)) {
    // A cell that is not the frame is not automatically a wrong grid: `pack
    // --scale` resamples every frame by the SAME factor on its way in, which
    // is how a 250px sheet is delivered as 125px cells. That pack is regular
    // — the overlay lines fall exactly where they should — and refusing it
    // hid a fact the user had asked for ("128 became 125"). What must still
    // be refused is a RATIO THAT DIFFERS BETWEEN THE AXES: no pack produces
    // that, so the declared grid is simply not the one this sheet was made
    // on, and lines drawn from it would be lines on nothing.
    const scaleX = cellWidth / frameWidth;
    const scaleY = cellHeight / frameHeight;
    const uniform = Math.abs(scaleX - scaleY) <= 0.005 * Math.max(scaleX, scaleY);
    if (!uniform) {
      return {
        ...blank,
        trusted: false,
        note: {
          kind: "cell-mismatch",
          cols,
          rows,
          cellWidth,
          cellHeight,
          frameWidth,
          frameHeight,
        },
      };
    }
    return {
      width,
      height,
      cols,
      rows,
      cellWidth,
      cellHeight,
      scale: round4(scaleX),
      trusted: true,
      note: null,
    };
  }

  return {
    width,
    height,
    cols,
    rows,
    cellWidth,
    cellHeight,
    scale: known ? 1 : null,
    trusted: true,
    note: null,
  };
}

/** The normalized pivot `atlas.json` declares for one motion. */
export interface AtlasPivot {
  x: number;
  y: number;
  /** True when it came from the pipeline's measurement rather than the
   *  anchor's assumed position — the same distinction `pack` makes when it
   *  omits `meta.anchorPoint`. */
  measured: boolean;
}

/**
 * The pivot the packed atlas declares, derived — like the grid above — from
 * `project.json` alone rather than a second fetch of `atlas.json`.
 *
 * `pack` normalizes the measured anchor point by the cell and rounds to four
 * decimals, so this does the same arithmetic on the same input and prints the
 * same number the file carries. With `--pad 8` on a 256px cell that is
 * `0.5, 0.9688` — printing a flat `0.5, 1.0` there would contradict both the
 * atlas on disk and the guide the stage draws.
 */
export function atlasPivot(motion: Motion): AtlasPivot {
  const measured = measuredAnchor(motion);
  if (measured) {
    return {
      x: round4(measured.point.x / measured.cell.width),
      y: round4(measured.point.y / measured.cell.height),
      measured: true,
    };
  }
  return { x: 0.5, y: motion.anchor === "center" ? 0.5 : 1, measured: false };
}

const round4 = (value: number): number => Math.round(value * 1e4) / 1e4;
