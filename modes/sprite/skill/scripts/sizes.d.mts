/**
 * Types for `sizes.mjs` — the script stays plain ESM; the declaration keeps
 * `tsc --noEmit` honest for the tests that import it.
 */

export declare const SIZE_SPREAD_WARN: number;

export declare function medianOf(values: number[]): number;

export interface MotionSize {
  /** The height the motion stands at: the median for a loop, the first frame for a one-shot. */
  standing: number;
  from: "median" | "first";
  median: number;
  min: number;
  max: number;
  first: number | null;
  scale: number;
  /** standing × the atlas scale. */
  shipped: number;
}

export declare function motionSize(
  heights: Array<number | null>,
  options?: { scale?: number; loop?: boolean },
): MotionSize | null;

export interface SizeComparison {
  spread: number;
  tallest: string;
  shortest: string;
  reference: number;
  scaleToMatch: Record<string, number>;
}

export declare function sizeSpread(sizes: Array<{ id: string; size: MotionSize | null }>): SizeComparison | null;

export declare function sizeWarning(
  sizes: Array<{ id: string; size: MotionSize | null }>,
  comparison: SizeComparison | null,
  options?: { bar?: number; block?: number; picture?: string },
): string | null;
