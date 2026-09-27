/**
 * Types for `still.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export declare const DEFAULT_FIT_MAX: number;
export declare const DEFAULT_FIT_PAD: number;
export declare class StillError extends Error {}

export declare function cropRgba(image: RgbaImage, box: PixelBox): RgbaImage;
export declare function padRgba(image: RgbaImage, pad: number): RgbaImage;
export declare function downscaleArea(image: RgbaImage, width: number, height: number): RgbaImage;
export declare function fitStill(
  image: RgbaImage,
  options: { box: PixelBox; max?: number; pad?: number; resample?: boolean },
): {
  image: RgbaImage;
  scale: number;
  needed: number;
  character: { width: number; height: number };
};
