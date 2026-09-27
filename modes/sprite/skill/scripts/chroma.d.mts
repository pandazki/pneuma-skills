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
  /** Pixels cut: within the radius, already transparent, or plate shade. */
  keyed: number;
  /** Of `keyed`, the plate-shade pixels (a shadow painted on the plate). */
  shaded: number;
  unmixed: number;
  /** Of `unmixed`, the ones read against the local subject colour. */
  localUnmixed: number;
  erased: number;
  despilled: number;
  spillClusters: number;
}

export interface ResidueCounts {
  visible: number;
  /** Visible pixels with the plate's hue (excess past 40). */
  tinted: number;
  /** Opaque (α ≥ 250), untinted pixels within 2 px of transparency that are
   *  the local subject moved at least a fifth of the way to the plate. */
  fringe: number;
  /** Visible pixels within 2 px of transparency — what `fringe` is out of. */
  edge: number;
  partial: number;
  /** Tinted pixels among the partially transparent ones. */
  partialTinted: number;
}

export interface PooledResidue {
  /** (tinted + fringe) / visible. */
  visible: number;
  /** partialTinted / partial. */
  edge: number;
  /** fringe / edge: the share of the edge band that is a fringe. */
  fringe: number;
}

export declare const UNMIX_REACH: number;
export declare const RESIDUE_TINT: number;
export declare const RGB_DIAGONAL: number;

export declare const MAX_UNMIX_STAGE_BYTES: number;
export declare const UNMIX_STAGE_MARGIN: number;
export declare function unmixStageRefusal(
  options: { frames: number; width: number; height: number; freeBytes?: number | null },
): string | null;
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
  options: { radius: number; unmixReach?: number; spill?: boolean; shade?: boolean },
): KeyStats;
export declare function keyResidue(image: RgbaImage, plate: Plate, threshold: number): ResidueCounts | null;
export declare function poolResidue(counts: Array<ResidueCounts | null>): PooledResidue | null;
export declare function plateProximity(
  image: RgbaImage,
  color: Rgb,
  options: { radius: number; threshold: number },
): { subject: number; within: number; fraction: number; minDistance: number | null; nearest: string | null };
