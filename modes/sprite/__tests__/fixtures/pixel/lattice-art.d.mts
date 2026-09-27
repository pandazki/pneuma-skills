/** Types for `lattice-art.mjs`. */

import type { RgbaImage } from "../../../skill/scripts/pixel-lattice.mjs";

export declare class PyRandom {
  constructor(seed: number);
  random(): number;
  getrandbits(k: number): number;
  randbelow(n: number): number;
  choice<T>(seq: T[]): T;
  randrange(start: number, stop: number): number;
}

export declare const PALETTE: [number, number, number][];
export declare function blank(width: number, height: number, rgba?: number[]): RgbaImage;
export declare function getPixel(image: RgbaImage, x: number, y: number): [number, number, number, number];
export declare function setPixel(image: RgbaImage, x: number, y: number, rgba: number[]): void;
export declare function logicalArt(width?: number, height?: number, seed?: number, palette?: number[][]): RgbaImage;
export declare function nearestResize(image: RgbaImage, outW: number, outH: number): RgbaImage;
export declare function pyRound(x: number): number;
export declare function upscaleBy(image: RgbaImage, kx: number, ky?: number): RgbaImage;
export declare function upscaledFractional(art: RgbaImage, scale: number): RgbaImage;
export declare function upscaledAxes(art: RgbaImage, sx: number, sy: number): RgbaImage;
export declare function crop(image: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage;
export declare function paste(canvas: RgbaImage, sprite: RgbaImage, x: number, y: number): RgbaImage;
export declare function mismatch(a: RgbaImage, b: RgbaImage): number;
export declare function noiseImage(width: number, height: number, seed: number): RgbaImage;
