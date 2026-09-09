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
 * image really does divide into `cols × rows` whole cells, and when those
 * cells match the frames' own recorded size. Otherwise the caller shows the
 * sheet bare and says why; `atlas.json` on disk is the truth in that case.
 */

import type { CharacterProject, Motion } from "../domain.js";

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
  /** True when the packed image really is `cols × rows` cells of that size. */
  trusted: boolean;
  /** Why not, in one sentence for the panel; null when it is trusted. */
  note: string | null;
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
  const blank = { width, height, cols, rows, cellWidth: 0, cellHeight: 0 };

  if (width === 0 || height === 0) {
    return {
      ...blank,
      trusted: false,
      note: "sheet.png has no recorded size, so its grid cannot be checked — atlas.json has the real cells.",
    };
  }

  if (width % cols !== 0 || height % rows !== 0) {
    return {
      ...blank,
      trusted: false,
      note: `The packed sheet is ${width}×${height}, which is not ${cols}×${rows} whole cells — \`pack\` without \`--cols\` chooses its own columns. Read atlas.json for the layout.`,
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
  if (
    frameWidth > 0 &&
    frameHeight > 0 &&
    (frameWidth !== cellWidth || frameHeight !== cellHeight)
  ) {
    return {
      ...blank,
      trusted: false,
      note: `A ${cols}×${rows} grid would make ${cellWidth}×${cellHeight} cells, but the frames are ${frameWidth}×${frameHeight} — read atlas.json for the layout.`,
    };
  }

  return { width, height, cols, rows, cellWidth, cellHeight, trusted: true, note: null };
}
