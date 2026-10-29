/**
 * Types for `grid.mjs` — pure grid and frame geometry.
 */
export declare const IMAGE_ASPECTS: readonly string[];
export declare function ratioValue(ratio: string): number;
export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
}
export declare function cellRect(width: number, height: number, rows: number, cols: number, index: number): CellRect;
export declare function gridCells(width: number, height: number, panels: number): CellRect[];
/** The width-to-height range a reference image must stay in (the Jimeng canvas limit). */
export declare const REFERENCE_ASPECT: Readonly<{ min: number; max: number }>;
/** Width ÷ height when outside `REFERENCE_ASPECT`, else null (also null for an unknown size). */
export declare function referenceAspectOutside(width: number, height: number): number | null;
export declare function nearestAspect(width: number, height: number, choices?: readonly string[]): string;
export declare function panelAspect(ratio: string, panels: number): string;
export declare const TIER_AREA: Readonly<Record<string, number>>;
export declare function assumedVideoSize(resolution: string, ratio: string): { width: number; height: number };
