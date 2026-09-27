/**
 * Types for `shadow.mjs` — the script stays plain ESM; the declaration keeps
 * `tsc --noEmit` honest for the tests that import it.
 */

export interface ShadowImage {
  width: number;
  height: number;
  /** RGBA, straight alpha, row-major. */
  data: Uint8Array;
}

export interface ShadowPoint {
  x: number;
  y: number;
}

export interface ShadowOptions {
  squash: number;
  shear: number;
  opacity: number;
  blur: number;
  color: [number, number, number];
}

export declare const SHADOW_DEFAULTS: Readonly<{
  squash: number;
  shear: number;
  opacity: number;
  blur: number;
  color: readonly [number, number, number];
}>;

export declare const SHADOW_RANGES: Readonly<Record<"squash" | "shear" | "opacity" | "blur", readonly [number, number]>>;

export declare function shadowOptions(given?: Partial<ShadowOptions>): ShadowOptions;

export declare function shadowGeometry(
  width: number,
  height: number,
  anchor: ShadowPoint,
  options: ShadowOptions,
): { left: number; top: number; width: number; height: number; anchor: ShadowPoint };

export declare function projectShadow(
  image: ShadowImage,
  anchor: ShadowPoint,
  options?: Partial<ShadowOptions>,
): ShadowImage & { anchor: ShadowPoint };

export declare function drawOver(dst: ShadowImage, src: ShadowImage, dx: number, dy: number): ShadowImage;

export declare function shadowCanvas(
  width: number,
  height: number,
  anchor: ShadowPoint,
  options?: Partial<ShadowOptions>,
): { width: number; height: number; frame: ShadowPoint; shadow: ShadowPoint; anchor: ShadowPoint };

export declare function withShadow(
  image: ShadowImage,
  anchor: ShadowPoint,
  options?: Partial<ShadowOptions>,
): ShadowImage & { anchor: ShadowPoint; frame: ShadowPoint };
