/**
 * Types for `drift.mjs` — the script stays plain ESM; the declaration keeps
 * `tsc --noEmit` honest for the tests that import it.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export declare const BODY_REGISTER_BAND: number;
export declare const BODY_REGISTER_SEARCH: number;
export declare const HEAD_STRIPS: number;
export declare const HEAD_SEARCH_FRACTION: number;

export declare function roundHalfEven(value: number): number;
export declare function massCenterX(image: RgbaImage, bbox: Box, threshold: number): number;
export declare function swayAboutTrend(values: Array<number | null>): number;
export declare function trendReference(
  feetX: Array<number | null>,
  massX: Array<number | null>,
): { ref: Array<number | null>; slope: number; driftPx: number; footSwayPx: number };
export declare function bodyWrapOffset(
  first: RgbaImage,
  last: RgbaImage,
  options: { threshold: number; band?: number; search?: number },
): number;
export declare function rampShifts(count: number, dx: number): number[];
export declare function headProfile(
  image: RgbaImage,
  bbox: Box | null,
  options: { threshold: number; band?: number; strips?: number },
): Float64Array;
export declare function profileOffset(
  reference: Float64Array,
  profile: Float64Array,
  width: number,
  options: { search: number; strips?: number },
): number | null;
export declare function headOffsets(
  profiles: Array<Float64Array | null>,
  width: number,
  options?: { search?: number; strips?: number },
): Array<number | null>;
