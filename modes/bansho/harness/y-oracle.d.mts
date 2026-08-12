/**
 * Types for the harness's §7.5 y-oracle. The oracle itself stays plain
 * `.mjs` — it is a standalone judge run against captures from a shell, not
 * app code — but `__tests__/box-oracle.test.ts` imports it to keep the fold
 * and the oracle pinned to each other under `bun test`.
 */

/** One step as the layout probe records it. */
export interface CaptureStep {
  ref: string;
  cls: string;
  hidden?: boolean;
  rect?: [number, number, number, number];
  margins?: [number, number];
  paths?: string[];
  svgs?: string[];
}

export interface Capture {
  scale: number;
  boardLayoutWidth: number;
  boardLayoutHeight: number;
  boardPadding: [number, number, number, number];
  stepCount: number;
  steps: CaptureStep[];
}

/**
 * Chain the §7.5 model over `capture`'s flow boxes, taking `h` and the
 * margins from `heightsFrom` (the same capture for 3b; the OLD capture for
 * 3a). Returns step ref → predicted board-relative `rect.top`.
 */
export function oracleTops(
  capture: Capture,
  heightsFrom?: Capture,
): Map<string, number>;
