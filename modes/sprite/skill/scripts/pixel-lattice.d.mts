/**
 * Types for `pixel-lattice.mjs` — the script stays plain ESM, the declaration
 * keeps `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface XY {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rgb = [number, number, number];

export declare const MAX_PITCH: number;
export declare const PITCH_FAMILY_RATIO: number;
export declare const COLLAPSE_FLOOR: number;
export declare const DEFAULT_PALETTE_SIZE: number;
export declare const DEFAULT_OUTLINE_STRENGTH: number;
export declare const PIXEL_RECORD: string;
export declare const PALETTE_KIND: string;

export declare function pyRound(x: number): number;
export declare function blankImage(width: number, height: number): RgbaImage;
export declare function cropImage(image: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage;
export declare function alphaBbox(image: RgbaImage, min: number): Box | null;
export declare function solidBbox(image: RgbaImage): Box | null;

export declare function edgeHistograms(image: RgbaImage): { col: number[]; row: number[] };
export declare function axisIntScore(edges: number[], p: number, w?: number): number;
export declare function detectPixelPitch(
  image: RgbaImage, maxPitch?: number, histograms?: { col: number[]; row: number[] },
): number;
export declare function axisIntSeed(edges: number[], maxPitch?: number): number;
export declare function axisRefine(edges: number[], pitch: number, w?: number, binStep?: number): { score: number; phase: number };
export declare function detectPixelGrid(image: RgbaImage, maxPitch?: number): { pitch: XY; phase: XY };

export declare function estimatePixelGridRunlen(image: RgbaImage, maxPitch?: number): XY;
export declare function crosscheckPitchRunlen(grid: XY, runlen: XY, axisTolerance?: number, ratioTolerance?: number): string[];

export declare function consensusPitch(values: number[]): { value: number; dropped: number; floor: number | null; harmonics: number };
export declare function resolveFramePitch(own: XY, consensus: XY): { pitch: XY; outlier: boolean };
export declare function gridEdges(length: number, pitch: number, offset: number): number[];
export declare function gridScore(image: RgbaImage, mask: Uint8Array, xs: number[], ys: number[]): number;
export declare function bestPhase(image: RgbaImage, pitch: XY, mask?: Uint8Array): XY;
export declare function boundaryMass(image: RgbaImage): { col: number[]; row: number[] };
export declare function refineEdgesToBoundaries(
  image: RgbaImage, xs: number[], ys: number[], pitch: XY, mass?: { col: number[]; row: number[] },
): { xs: number[]; ys: number[] };
export declare function dominantBlockColor(pixels: number[], detailBias?: boolean): Rgb;
export declare function snapByEdges(image: RgbaImage, xs: number[], ys: number[], detailBias?: boolean): RgbaImage;
export declare function snapGrid(
  image: RgbaImage, pitch: XY, phase: XY, options?: { refine?: boolean; detailBias?: boolean },
): { logical: RgbaImage; xs: number[]; ys: number[] };

export interface LatticeFrame {
  index: number;
  logical: RgbaImage | null;
  box: Box | null;
  own: XY | null;
  pitch: XY | null;
  source: "own" | "consensus" | "outlier" | "empty" | "none";
  phase?: XY;
  xs?: number[];
  ys?: number[];
}

export declare function latticeFrames(
  images: RgbaImage[],
  options?: { detailBias?: boolean; pitchHint?: number | null; maxPitch?: number; hintLabel?: string | null },
): {
  frames: LatticeFrame[];
  /** The pitch frames are held to: the hint when given, else `measured`. */
  consensus: XY;
  measured: XY;
  runlen: XY;
  warnings: string[];
  /** Frames that read a grid on their own, of `nonEmpty`. */
  confident: number;
  nonEmpty: number;
  /** Only when fewer than half the non-empty frames were confident. */
  pooled: { pitch: number; score: number } | null;
};

export declare function pooledPitch(images: RgbaImage[], maxPitch?: number): { pitch: number; score: number };

export declare const HEIGHT_SLACK: number;
export declare const HEIGHT_EVIDENCE_RATIO: number;
export declare function heightPitch(
  lattice: { frames: Array<{ box: Box | null }>; pooled: { pitch: number; score: number } | null; runlen: XY },
  logicalHeight: number,
): { pitch: number; source: number; readings: Array<{ what: "pooled" | "runs"; pitch: number }>; backed: boolean } | null;
export declare function heightCheck(
  frames: Array<{ logical: RgbaImage | null }>,
  logicalHeight: number,
): { declared: number; measured: number; range: [number, number]; honoured: boolean } | null;

export declare function buildSharedPalette(frames: RgbaImage[], size?: number): Rgb[];
export declare function applyPalette(image: RgbaImage, palette: Rgb[]): RgbaImage;
export declare function enforceOutline(image: RgbaImage, strength?: number): RgbaImage;
export declare function hexColor(color: Rgb | number[]): string;
export declare function loadPalette(path: string): { file: string; colors: Rgb[]; source: string | null } | null;
export declare function writePalette(path: string, colors: Rgb[], source: string): string;

export declare function upscale(image: RgbaImage, n: number): RgbaImage;
export declare function paste(canvas: RgbaImage, sprite: RgbaImage, x: number, y: number): RgbaImage;
export declare function latticeCheck(
  image: RgbaImage, n?: number, palette?: Rgb[] | null,
): { softAlpha: number; offGrid: number; offPalette: number; colors: number };
