/**
 * Type surface of texture.mjs — the PNG codec and the map derivations.
 * Exists so `modes/lucid/__tests__/` can pin it under `tsc --noEmit` (the
 * skill directory itself is shipped, not compiled).
 */

/** A refusal the script knows how to phrase, as opposed to a crash. */
export declare class TextureError extends Error {}

/** Straight 8-bit RGBA plus what the source file actually held. */
export interface DecodedPng {
  width: number;
  height: number;
  /** width * height * 4 bytes, RGBA, no premultiplication. */
  data: Uint8Array;
  bitDepth: 8 | 16;
  colorType: 0 | 2 | 4 | 6;
  colorTypeName: "greyscale" | "greyscale-alpha" | "rgb" | "rgba";
  hasAlpha: boolean;
}

/** What the derivations pass around: RGBA pixels and a size. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
  hasAlpha?: boolean;
}

export declare function decodePng(buffer: Uint8Array, label?: string): DecodedPng;

/** 8-bit, filter 0, colour type 2 (RGB) or 6 (RGBA) when `alpha` is set. */
export declare function encodePng(image: RgbaImage & { alpha?: boolean }): Buffer;

/** Rec. 709 luminance in 0..1, one value per pixel. */
export declare function luminanceField(image: RgbaImage): Float64Array;

export interface NormalOptions {
  /** Slope multiplier before normalizing (default 2). */
  strength?: number;
  /** Box-blur radius on the height field in pixels (default 1; 0 disables). */
  blur?: number;
  /** DirectX -Y instead of the OpenGL/glTF +Y default. */
  invertY?: boolean;
}

export declare function normalMap(
  image: RgbaImage,
  options?: NormalOptions,
): { image: RgbaImage; relief: number };

export interface RoughnessOptions {
  min?: number;
  max?: number;
  invert?: boolean;
}

export declare function roughnessMap(
  image: RgbaImage,
  options?: RoughnessOptions,
): { image: RgbaImage; stats: { min: number; max: number; mean: number } };

export interface SeamAxisReport {
  edgeDiff: number;
  /** Mean step between neighbouring interior lines. */
  interiorGradient: number;
  /** The largest such step — the strongest boundary already in the texture. */
  interiorMax: number;
  score: number;
  /** The seam is no larger than a boundary this texture already contains. */
  withinStructure: boolean;
}

export interface SeamReport {
  seamScore: number;
  tileable: boolean;
  threshold: number;
  worstEdge: "left-right" | "top-bottom" | "none";
  /** Set only on a failure: `withinStructure` of the deciding axis, i.e. a
   *  brick/plank/grout pattern can fail the strict threshold with a perfectly
   *  correct wrap, and `make-tileable` would be the wrong repair. */
  structured: boolean;
  horizontal: SeamAxisReport;
  vertical: SeamAxisReport;
}

export declare function seamReport(image: RgbaImage): SeamReport;

export declare function makeTileable(
  image: RgbaImage,
  blend?: number,
): {
  image: RgbaImage;
  offset: { x: number; y: number };
  seam: { x: number; y: number };
  band: { x: number; y: number };
};

/** Area-average box filter. Downscale only; the CLI enforces that. */
export declare function boxResize(image: RgbaImage, outWidth: number, outHeight: number): RgbaImage;

/** R = AO (255 when absent), G = roughness, B = metallic (0 when absent). */
export declare function packOrm(maps: {
  ao: RgbaImage | null;
  roughness: RgbaImage;
  metallic: RgbaImage | null;
  aoDefault?: number;
  metallicDefault?: number;
}): RgbaImage;

/** seamScore at or below this reads as a tiling texture. */
export declare const TILEABLE_MAX_SCORE: number;
