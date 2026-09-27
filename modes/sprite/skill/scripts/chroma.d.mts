/**
 * Types for `chroma.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export type Rgb = [number, number, number];

/** A decoded frame: `data` is width × height × 4 bytes of straight RGBA. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PlateSplit {
  /** Channel indices (0 = R, 1 = G, 2 = B) the plate saturates. */
  keyed: number[];
  /** The channels it leaves dark. */
  unkeyed: number[];
}

export interface Plate {
  painted: Rgb;
  hex: string;
  /** False for a plate with no hue (white, cream, grey): nothing to un-mix. */
  chroma: boolean;
  /** Border samples within the key radius of the plate (measurePlate only). */
  plateShare?: number;
  samples?: number;
  split?: PlateSplit;
  weights?: Rgb;
  /** The plate's own tint, mean(keyed) − mean(unkeyed). */
  keyTint?: number;
}

export interface KeyStats {
  keyed: number;
  unmixed: number;
  erased: number;
  despilled: number;
  spillClusters: number;
}

export interface ResidueCounts {
  visible: number;
  tinted: number;
  partial: number;
  partialTinted: number;
}

export declare const UNMIX_REACH: number;
export declare const RESIDUE_TINT: number;
export declare const RGB_DIAGONAL: number;

export declare function keyRadius(similarity: number): number;
export declare function parseHex(hex: string): Rgb;
export declare function toHex(color: Rgb): string;
export declare function plateSplit(color: Rgb | number[]): PlateSplit | null;
export declare function borderSamples(image: RgbaImage, into?: number[]): number[];
export declare function measurePlate(
  frames: RgbaImage[],
  options: { key?: "auto" | Rgb; radius: number },
): Plate | null;
export declare function plateOf(color: string | Rgb): Plate;
export declare function keyFrame(
  image: RgbaImage,
  plate: Plate,
  options: { radius: number; unmixReach?: number; spill?: boolean },
): KeyStats;
export declare function keyResidue(image: RgbaImage, plate: Plate, threshold: number): ResidueCounts | null;
export declare function poolResidue(counts: Array<ResidueCounts | null>): { visible: number; edge: number } | null;
export declare function plateProximity(
  image: RgbaImage,
  color: Rgb,
  options: { radius: number; threshold: number },
): { subject: number; within: number; fraction: number; minDistance: number | null; nearest: string | null };
