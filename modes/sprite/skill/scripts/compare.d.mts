export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}
export interface InputDigest {
  path: string;
  realPath: string;
  sha256: string;
}
export interface CompareCodecs {
  readRgba(path: string): RgbaImage;
  writeRgbaPng(path: string, image: RgbaImage, label: string): unknown;
  decodeGifFrames(
    path: string,
    out: string,
    label: string,
  ): { delaysMs: number[]; warnings?: string[] };
  cleanAlphaHaze?(
    image: RgbaImage,
    options: AlphaClean,
  ): { image: RgbaImage; report: unknown };
}
export interface AlphaClean {
  maxAlpha: number;
  keepEdge: number;
}
export interface FinalArtifact {
  path: string;
  format: string;
  frames: RgbaImage[];
  durationsMs: number[] | null;
  loop: { plays: number | "infinite" } | null;
  pivots: { x: number; y: number }[] | null;
  order: string[] | null;
  sheet?: RgbaImage;
  rectangles: { x: number; y: number; w: number; h: number }[] | null;
  files: InputDigest[];
  pixelSha256: string;
  sheetPixelSha256?: string;
}
export interface Comparison {
  schemaVersion: number;
  status: "identical" | "comparable" | "unknown";
  artisticQuality: "unknown";
  changedProtectedProperties: string[];
  changedPixels: number | null;
  alphaLostPixels: number | null;
  alphaClean: { status: string; parameters?: AlphaClean };
  improvement: "unknown";
  note: string;
  artifacts?: {
    baseline: ArtifactDescriptor;
    candidate: ArtifactDescriptor;
  };
  previews?: {
    sampling: string;
    baseline: PreviewTile[];
    candidate: PreviewTile[];
    difference: string;
  };
  inputs?: {
    baseline: {
      files: InputDigest[];
      pixelSha256: string;
      sheetPixelSha256?: string;
    };
    candidate: {
      files: InputDigest[];
      pixelSha256: string;
      sheetPixelSha256?: string;
    };
  };
}
export declare function loadFinalArtifact(
  path: string,
  codecs: CompareCodecs,
  records?: InputDigest[],
): FinalArtifact;
export declare function compareFinalArtifacts(
  baseline: FinalArtifact,
  candidate: FinalArtifact,
  options?: {
    alphaClean?: AlphaClean;
    cleanAlphaHaze?: CompareCodecs["cleanAlphaHaze"];
  },
): Comparison;
export declare function runCompare(
  options: {
    baseline: string;
    candidate: string;
    out: string;
    alphaClean?: AlphaClean;
  },
  codecs: CompareCodecs,
): Comparison & { out: string };

export interface ArtifactDescriptor {
  format: string;
  frameCount: number;
  canvases: { width: number; height: number }[];
  durationsMs: number[] | null;
  loop: FinalArtifact["loop"];
  pivots: FinalArtifact["pivots"];
  frameOrder: FinalArtifact["order"];
  rectangles: FinalArtifact["rectangles"];
}
export interface PreviewTile {
  frame: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}
