/**
 * Types for `frame-steps.mjs` — the script stays plain ESM; the declaration
 * keeps `tsc --noEmit` honest for the tests that import it.
 */

import type { RgbaImage } from "./drift.mjs";

export declare const STEP_THUMB: number;
export declare const DUPLICATE_STEP: number;
export declare const BOUNDARY_STEP_RATIO: number;
export declare const MIN_ROW_FRAMES: number;

export interface StepPair {
  from: number;
  to: number;
  step: number;
}

export declare function stepThumb(image: RgbaImage, size?: number): Float64Array;
export declare function thumbDiff(a: Float64Array, b: Float64Array): number;
export declare function judgeSteps(
  steps: Array<number | null>,
  options: {
    count: number;
    wrap?: number | null;
    cols?: number | null;
    duplicateStep?: number;
    ratio?: number;
  },
): { nearDuplicates: StepPair[]; rowJumps: StepPair[]; inRowMedian: number | null };
