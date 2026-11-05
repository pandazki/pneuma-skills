export interface AlphaImage { width: number; height: number; data: Uint8Array }
export interface AlphaCleanOptions { maxAlpha: number; keepEdge: number }
export interface AlphaCleanReport extends AlphaCleanOptions {
  distance: string; pixels: number; strongerSupportPixels: number; protectedPixels: number; faintPixels: number;
  removedPixels: number; changedStrongerSupportPixels: number; changedProtectedPixels: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  skipped: string | null; applicability: string; artisticQuality: string;
}
export declare function alphaProtectionMask(image: AlphaImage, options: AlphaCleanOptions): { mask: Uint8Array; strongerSupportPixels: number };
export declare function cleanAlphaHaze(image: AlphaImage, options: AlphaCleanOptions): { image: AlphaImage; report: AlphaCleanReport };
