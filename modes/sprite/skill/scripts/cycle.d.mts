/**
 * Types for `cycle.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export declare const CYCLE_THUMB: number;
export declare const SEAM_STEP_LIMIT: number;
export declare const SEAM_FLOOR: number;
export declare const PERIOD_TOLERANCE: number;
export declare const PERIODICITY_MIN: number;
export declare const DOUBLE_TOLERANCE: number;
export declare const DOUBLE_SEARCH: number;
export declare const NEAR_EXACT_STEP_FRACTION: number;
export declare const GAIT_FLOORS: { walk: number; run: number };
/** The gait floor in frames, halves rounded to even as upstream's Python does. */
export declare function gaitFloor(gait: "walk" | "run" | null | undefined, fps: number | null | undefined): number | null;
export declare const MAX_CYCLE_WINDOWS: number;
export declare const HOLD_STEP_FRACTION: number;
export declare const ONE_SHOT_MIN_CONTRAST: number;
export declare const ONE_SHOT_MIN_MOVED: number;
export declare const ONE_SHOT_MIN_COHERENCE: number;
export declare const ONE_SHOT_MIN_ACTIVE: number;
export declare const ONE_SHOT_PAD: number;
export declare const ONE_SHOT_MIN_LEN: number;
export declare const MAX_ONE_SHOTS: number;

/** A frame's analysis features: premultiplied RGBA scaled to 0..1. */
export type Features = Float32Array;

export declare function thumbSize(width: number, height: number): { width: number; height: number };
export declare function premultiplied(rgba: Uint8Array): Features;
export declare function frameDistance(a: ArrayLike<number>, b: ArrayLike<number>): number;
export declare function frameMass(a: ArrayLike<number>): number;
/** Flat n×n: row i, column j at `i * n + j`. */
export declare function distanceMatrix(features: ArrayLike<number>[]): Float32Array;
export declare function adjacentSteps(features: ArrayLike<number>[]): number[];

export declare function seamLimit(step: number): number;
export declare function seamCloses(seam: number, step: number): boolean;

export declare function median(values: ArrayLike<number>): number;
export declare function periodicityFloor(n: number, period: number): number;

/** One candidate cut, lengths in frames. */
export interface CycleWindow {
  start: number;
  length: number;
  /** D from the last displayed frame back to the first. */
  wrap: number;
  /** Mean adjacent D inside the window. */
  step: number;
  ratio: number;
  /** D from the first frame to the one a period later. */
  repeat: number;
  score: number;
  context: { error: number; overStep: number } | null;
}

export declare function rankWindows(D: Float32Array, n: number, options: {
  lengths: number[];
  adjacent: number[];
  context?: boolean;
  minStep?: number;
}): CycleWindow[];

export type CycleReason = "window" | "no-dip" | "flat" | "half-stride" | "held";

export interface CycleResult {
  verdict: "periodic" | "none";
  reason: CycleReason | null;
  period: number | null;
  periodicity: number | null;
  periodicityMin: number | null;
  profileMean: number | null;
  /** The deepest dips, `[lag in frames, P]`. */
  minima: [number, number][];
  ambiguous: { short: number; long: number; depthRatio: number | null; repeatOverStep: number } | null;
  guard:
    | { applied: true; from: number; to: number; gaitFloor: number; depthRatio: number | null }
    | { applied: false; below: number; gaitFloor: number; double: number | null; depthRatio: number | null }
    | null;
  windows: CycleWindow[];
}

export declare function detectCycle(D: Float32Array, n: number, options: {
  minLen: number;
  maxLen: number;
  gait?: "walk" | "run" | null;
  fps?: number | null;
}): CycleResult;

export interface OneShot {
  start: number;
  end: number;
  length: number;
  seam: number;
  step: number;
  ratio: number;
  peak: number;
  /** The active run, `[first, last]` frame. */
  excursion: [number, number];
  departure: number;
  excursionOverStep: number;
  rule: "contrast" | "moved";
  contrast: number;
  moved: number | null;
}

export declare function detectOneShots(
  D: Float32Array,
  n: number,
  masses: ArrayLike<number> | null,
  options?: { maxLen?: number },
): OneShot[];
