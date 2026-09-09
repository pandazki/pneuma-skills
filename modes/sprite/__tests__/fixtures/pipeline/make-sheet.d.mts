/**
 * Types for `make-sheet.mjs` — same convention as
 * `modes/_shared/scripts/storyboard.d.mts`: the script stays plain ESM, the
 * declaration keeps `tsc --noEmit` honest for the TypeScript suites.
 */

export interface SquareSpec {
  /** Cell-local offset of the drawn square. */
  x: number;
  y: number;
  /** Any ffmpeg colour expression. */
  color: string;
}

export interface ExtraBox {
  /** Grid cell the box belongs to, row-major. */
  index: number;
  /** Cell-local position and size. */
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
}

export interface BuildSheetOptions {
  /** Square cell size in px (default 64). */
  cell?: number;
  rows?: number;
  cols?: number;
  /** ffmpeg colour: `black@0` for a transparent sheet, `0xrrggbb` for opaque. */
  background?: string;
  /** Row-major indices of the cells that get a square (default: all). */
  cells?: number[] | null;
  /** Extra boxes drawn on top, e.g. a stray limb that widens one bbox. */
  extras?: ExtraBox[];
  /** Per-cell square placement, cycled by cell index. */
  squares?: SquareSpec[];
}

export interface BboxReport {
  width: number;
  height: number;
  /** Fraction of pixels at or above the alpha threshold. */
  coverage: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

export declare const SQUARE: { w: number; h: number };
export declare const CELL_OFFSETS: SquareSpec[];
export declare function buildSheet(outPath: string, options?: BuildSheetOptions): string;
export declare function readBbox(path: string, threshold?: number): BboxReport;
export declare function readColorBbox(path: string, hex: string, threshold?: number): BboxReport;
