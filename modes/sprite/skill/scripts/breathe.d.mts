/**
 * Types for `breathe.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export declare class BreatheError extends Error {}

export type BreatheMode = "smooth" | "pixel";
export declare const BREATHE_MODES: BreatheMode[];
export declare const ALPHA_SOLID: number;
export declare const APPENDAGE_RATIO: number;
export declare const BOTTLENECK_PROMINENCE: number;
export declare const TAPER: number;
export declare const FOOT: number;
export declare const MAX_ROW_STRAIN: number;
export declare const DEFAULT_LAG: number;
export declare const SMOOTH_CYCLE_FRAMES: number;
export declare const DEFAULT_BREATHE_DEPTH: number;
export declare const FRAMES_PER_BREATH: number;
export declare const DEPTH_MIN: number;
export declare const DEPTH_MAX: number;
export declare const LAG_MAX: number;
export declare const ANTIALIASED_SHARE: number;

/** End-exclusive box in image coordinates. */
export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Rows and columns are relative to `box` (the solid alpha bounding box). */
export interface Anatomy {
  box: Box;
  width: number;
  height: number;
  axisX: number;
  neckRow: number;
  neckSource: "bottleneck" | "shoulder-gradient";
  rigidRow: number;
  rigidSource: "neck" | "face" | "manual";
  basisRow: number;
  torsoHalf: number;
  maxHalf: number;
  torsoSource: "auto" | "manual";
  face: { top: number; bottom: number } | null;
  /** Rows/columns relative to `box`; in the still's coordinates via `bakeBreathe`'s warnings. */
  warnings: string[];
  /** What detection said before any override. */
  auto: { axisX: number; rigidRow: number; torsoHalf: number };
}

export declare function wave(t: number): number;
export declare function smoothstep(a: number, b: number, x: number): number;
export declare function solidBox(image: RgbaImage, threshold?: number): Box | null;
export declare function analyzeAnatomy(
  image: RgbaImage,
  overrides?: { rigidRow?: number | null; axisX?: number | null; torsoHalf?: number | null },
): Anatomy;
export declare function hasAppendage(anat: Anatomy): boolean;
export declare function rigidU(anat: Anatomy): number;
export declare function envelope(anat: Anatomy): { env: (u: number) => number; norm: number; ru: number };
export declare function protect(anat: Anatomy): (x: number) => number;
export declare function rowStrain(anat: Anatomy, depth: number): number;
export declare function breathePhases(count: number, breaths: number): number[];
export declare function rigidRows(anat: Anatomy): number;

export interface WarpOptions { depth: number; lag: number; phase: number }
export interface WarpResult { image: RgbaImage; clipped: number; deformed: boolean; headOffset: number }
export declare function warpPixel(image: RgbaImage, anat: Anatomy, options: WarpOptions): WarpResult;
export declare function warpSmooth(image: RgbaImage, anat: Anatomy, options: WarpOptions): WarpResult;
export declare function thinOutline(image: RgbaImage): void;
export declare function straddlingProp(
  image: RgbaImage,
  anat: Anatomy,
): { x0: number; x1: number; y: number; bottom: number } | null;
export declare function partialAlphaShare(image: RgbaImage): number;

export interface BreatheFrameFacts {
  index: number;
  phase: number;
  height: number;
  top: number | null;
  bottom: number | null;
  headOffset: number;
  headDiffPx: number | null;
}

export interface BreatheBake {
  frames: RgbaImage[];
  canvas: { width: number; height: number; grew: { left: number; top: number; right: number; bottom: number } };
  anatomy: Anatomy;
  rigidRows: number;
  phases: number[];
  strain: number;
  perFrame: BreatheFrameFacts[];
  partialAlphaShare: number;
  fringeDropped: number;
  straddle: { x0: number; x1: number; y: number; bottom: number } | null;
  warnings: string[];
}

export declare function bakeBreathe(image: RgbaImage, options: {
  frames: number;
  breaths?: number;
  depth: number;
  lag?: number;
  mode: BreatheMode;
  rigidY?: number | null;
  axisX?: number | null;
  torsoHalf?: number | null;
}): BreatheBake;
