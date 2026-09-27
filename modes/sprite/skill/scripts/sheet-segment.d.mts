/**
 * Types for `sheet-segment.mjs` — the script stays plain ESM; the declaration
 * keeps `tsc --noEmit` honest for the tests that import it.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Span {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export declare const MERGED_SPAN_FACTOR: number;
export declare const SHARED_FRACTION: number;
export declare const DEBRIS_FRACTION: number;
export declare const CELL_MARGIN: number;

export interface AlphaComponent {
  id: number;
  area: number;
  sumX: number;
  sumY: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export declare function alphaComponents(image: RgbaImage, threshold: number): {
  labels: Int32Array;
  components: AlphaComponent[];
};

export declare function projectAlpha(
  image: RgbaImage,
  axis: "x" | "y",
  rect?: Partial<Span>,
  threshold?: number,
): Float64Array;
export declare function smoothProfile(profile: ArrayLike<number>, window: number): Float64Array;
export declare function contentRuns(profile: ArrayLike<number>, eps: number, peakMin: number, minWidth: number): Array<[number, number]>;
export declare function runMass(profile: ArrayLike<number>, run: [number, number]): number;
export declare function dropMinorRuns(profile: ArrayLike<number>, runs: Array<[number, number]>, fraction: number): Array<[number, number]>;
export declare function medianRunWidth(runs: Array<[number, number]>): number;
export declare function posePeaks(profile: ArrayLike<number>, start: number, end: number): number[];
export declare function dpNCut(profile: ArrayLike<number>, x0: number, x1: number, count: number): number[] | null;
export declare function splitRange(profile: ArrayLike<number>, start: number, end: number, count: number): Array<[number, number]>;
export declare function segmentProfile(raw: ArrayLike<number>, expected: number): {
  segments: Array<[number, number]>;
  natural: number;
  forced: boolean;
  profile?: Float64Array;
};
export declare function segmentBoundaries(raw: ArrayLike<number>, expected: number): {
  cuts: number[] | null;
  natural: number;
  forced: boolean;
  segments: Array<[number, number]>;
};

export interface LocatedPose {
  index: number;
  row: number;
  col: number;
  /** Everything the pose owns (soft edge included), sheet px, end exclusive. */
  box: Span | null;
  /** Its ink at or above the threshold. */
  ink: Span | null;
  /** Solid ink on the sheet's own edge: drawn off the image. */
  edge: boolean;
  /** Cut apart from a pose it was drawn touching. */
  cut: boolean;
  region: Span;
}

export interface LocatedPoses {
  rows: { natural: number; forced: boolean; cuts: number[] | null };
  cols: Array<{ natural: number; forced: boolean; cuts: number[] | null }>;
  failed: string | null;
  owner?: Int32Array;
  poses?: LocatedPose[];
}

export declare function locatePoses(image: RgbaImage, options: {
  rows: number;
  cols: number;
  threshold: number;
  cell: { width: number; height: number };
}): LocatedPoses;

export interface PoseLayout {
  cell: { width: number; height: number };
  grew: { left: number; top: number; right: number; bottom: number };
  placements: Array<{ index: number; dx: number; dy: number }>;
}

export declare function layoutPoses(poses: LocatedPose[], options: {
  cell: { width: number; height: number };
  origin: (row: number, col: number) => { x: number; y: number };
  margin?: number;
}): PoseLayout;

export declare function cutPoses(image: RgbaImage, located: LocatedPoses, layout: PoseLayout): Array<{
  index: number;
  width: number;
  height: number;
  data: Buffer;
}>;
