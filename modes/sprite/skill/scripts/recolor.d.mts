/**
 * Types for `recolor.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript files that import it (the viewer's
 * loader, the tests).
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Rgb = [number, number, number];

/** One colourway: `{ name, map: { "#src": "#dst" }, tolerance? }`. */
export interface Colourway {
  name: string;
  map: Record<string, string>;
  /** Absent = exact. */
  tolerance?: number;
}

export interface Tally {
  variant: Colourway;
  pairs: Array<{ from: string; to: string; src: Rgb; tgt: Rgb }>;
  hits: number[];
  uncovered: Map<number, number>;
}

export interface RecolorReport {
  name: string;
  tolerance?: number;
  substituted: number;
  substitutions: Array<{ from: string; to: string; pixels: number }>;
  unmatched: Array<{ from: string; to: string }>;
  uncovered: { pixels: number; colors: number; top: Array<{ hex: string; pixels: number }>; truncated?: number };
}

export declare const RECOLOR_KIND: string;
export declare const RECOLOR_VERSION: number;
export declare const ALPHA_THRESHOLD: number;
export declare const UNCOVERED_CAP: number;
export declare const MAX_TOLERANCE: number;
export declare const MAX_VARIANT_NAME: number;
export declare const VARIANT_NAME_RE: RegExp;
export declare const VARIANTS_DIRNAME: string;
export declare const RECOLOR_FILENAME: string;

export declare class RecolorError extends Error {}

export declare function parseHexColor(value: unknown): Rgb | null;
export declare function formatHex(rgb: Rgb | number[]): string;
export declare function variantNameProblem(name: unknown): string | null;
export declare function checkVariant(raw: unknown, where?: string): Colourway;
export declare function parseRecolorMap(doc: unknown, where?: string): Colourway[];
export declare function sameVariant(a: Colourway, b: Colourway): boolean;
export declare function newTally(variant: Colourway): Tally;
export declare function recolorImage(image: RgbaImage, tally: Tally, alphaThreshold?: number): RgbaImage;
export declare function mergeTallies(tallies: Tally[]): Tally;
export declare function tallyReport(tally: Tally): RecolorReport;
export declare function countColors(images: RgbaImage[], into?: Map<number, number>, alphaThreshold?: number): Map<number, number>;
export declare function offPalette(counts: Map<number, number>, palette: Rgb[]): { colors: number; pixels: number };
export declare function draftRecolorMap(args: {
  palette: string;
  paletteColors: Rgb[];
  counts: Map<number, number>;
  character: string;
  swatches?: string | null;
}): {
  kind: string;
  version: number;
  character: string;
  palette: string;
  swatches?: string;
  help: string;
  colors: Array<{ hex: string; pixels: number; share?: number; inPalette?: false; swatch?: number }>;
  variants: Colourway[];
};
export declare function swatchSheet(
  entries: Array<{ rgb: Rgb; image: RgbaImage }>,
  options?: { cellHeight?: number; cols?: number; alphaThreshold?: number },
): { image: RgbaImage; mark: string; cell: { width: number; height: number }; scale: number };
