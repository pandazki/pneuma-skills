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

export interface AlphaColorAudit {
  width: number;
  height: number;
  /** Pixels below the alpha threshold. */
  hidden: number;
  /** Pixels at or above it. */
  opaque: number;
  /** Of those, how many are pure black — a fix that erased too much. */
  opaqueBlack: number;
  /** Distinct `"r,g,b"` carried by the hidden pixels, sorted. */
  hiddenColors: string[];
}

export declare function alphaColorAudit(path: string, threshold?: number): AlphaColorAudit;

/** One box overlaid per frame of a clip, at a y that rides a sine over t. */
export interface ClipBox {
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
}

export interface BuildClipOptions {
  width?: number;
  height?: number;
  seconds?: number;
  fps?: number;
  /** Any ffmpeg colour expression; the chroma plate `from-video` keys away. */
  background?: string;
  box?: ClipBox;
  /** Half-travel of the box's vertical sine in px (default 2; 0 never moves). */
  amplitude?: number;
  /** Seconds the opening pose is held before the sine starts (default 0). */
  holdSeconds?: number;
}

export declare function buildClip(outPath: string, options?: BuildClipOptions): string;

export declare const CLIP_ENCODERS: Record<"h264" | "prores4444", string[]>;

/** The overlaid box of an expression clip: its position is the expression, so
 *  only its size and colour are fixed. */
export interface ExprBox {
  w: number;
  h: number;
  /** Any ffmpeg colour expression. */
  color: string;
}

export interface BuildExprClipOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** Frames to emit; the duration is frames / fps. */
  frames?: number;
  background?: string;
  box?: ExprBox;
  /** ffmpeg expressions in `t`; commas are escaped for you. */
  x?: string;
  y?: string;
  encode?: "h264" | "prores4444";
}

export declare function buildExprClip(outPath: string, options?: BuildExprClipOptions): string;
export declare function clipFrameDeltas(path: string, width?: number): number[];

export interface EdgeLumaReport {
  /** Pixels whose alpha is inside [min, max). */
  count: number;
  /** Lowest / mean luminance among them, or null when there are none. */
  min: number | null;
  mean: number | null;
}

export declare function edgeLuma(
  path: string,
  bounds?: { min?: number; max?: number },
): EdgeLumaReport;

/** `loop`'s own seam/step scale: changed alpha over combined alpha, 0..1. */
export declare function silhouetteDiff(pathA: string, pathB: string): number;

export interface WebpFrame {
  /** Rectangle this frame paints, in canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  durationMs: number;
  /** 0 = alpha-blend onto the canvas, 1 = overwrite it. */
  blend: 0 | 1;
  /** 0 = leave the canvas, 1 = clear this rect to the background after. */
  dispose: 0 | 1;
}

export interface WebpAnimation {
  /** VP8X canvas size; null when the file has no VP8X chunk. */
  canvas: { width: number; height: number } | null;
  /** VP8X alpha flag: does the file declare it carries transparency. */
  declaresAlpha: boolean;
  /** ANIM loop count, 0 = forever; null when the file is not animated. */
  loops: number | null;
  frames: WebpFrame[];
}

export declare function webpAnimation(path: string): WebpAnimation;

/** Indices of the frames written as a full-canvas alpha blend over a canvas
 *  nothing cleared — the still encoder's shape, the one that ghosts. */
export declare function webpStackedFrames(path: string): number[];
