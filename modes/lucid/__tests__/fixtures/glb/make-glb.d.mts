/**
 * Types for `make-glb.mjs` — same convention as
 * `modes/sprite/__tests__/fixtures/pipeline/make-sheet.d.mts`: the fixture
 * builder stays plain ESM, the declaration keeps `tsc --noEmit` honest for the
 * TypeScript suites.
 */

export type ImageKind =
  | "png"
  | "gray-png"
  | "jpeg"
  | "webp-vp8"
  | "webp-vp8l"
  | "webp-vp8x";

export interface ImageSpec {
  kind: ImageKind;
  width: number;
  height: number;
}

export interface NodeTransform {
  translation?: [number, number, number];
  /** Quaternion, glTF order (x, y, z, w). */
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  /** Column-major 4x4; mutually exclusive with the TRS triple. */
  matrix?: number[];
}

export interface BuildGlbOptions {
  /** World-space vertex positions before the node transform. */
  positions?: number[][];
  /** Write an index buffer (default true). */
  indexed?: boolean;
  /** Explicit index buffer — the way to build welded, decimatable geometry.
   *  Without it the default index buffer is sequential. */
  indices?: number[] | null;
  /** Write TEXCOORD_0 (default true). */
  uv?: boolean;
  /** Write one material (default true). */
  material?: boolean;
  /** `doubleSided` on every material written. */
  doubleSided?: boolean;
  /** "int16n" writes a normalized SHORT POSITION accessor; positions must be
   *  inside [-1, 1]. */
  positionEncoding?: "float" | "int16n";
  /** Write the POSITION accessor without min/max — invalid glTF, and what
   *  parts of the AI-asset chain actually emit. */
  omitBounds?: boolean;
  /** Embedded images, in order. An empty array writes no textures. */
  images?: ImageSpec[];
  /** Transform of the node that carries the mesh. */
  node?: NodeTransform;
  /** glTF primitive mode; omitted means TRIANGLES (4). */
  mode?: number;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  /** Add a one-second translation animation. */
  animation?: boolean;
  /** Add a one-joint skin to the mesh node. */
  skin?: boolean;
  generator?: string;
}

export interface GridMeshOptions {
  segments?: number;
  amplitude?: number;
}

export declare function gridMesh(options?: GridMeshOptions): {
  positions: number[][];
  indices: number[];
};

export interface ThinPoleOptions {
  bodyCount?: number;
  bodyHeight?: number;
  poleCount?: number;
  poleHeight?: number;
}

export declare const UNIT_TRIANGLE: number[][];
export declare function thinPolePositions(options?: ThinPoleOptions): number[][];
export declare function buildGlb(outPath: string, options?: BuildGlbOptions): string;
export declare function writeGlbFile(outPath: string, gltf: unknown, bin: Uint8Array): string;
export declare function rgbaPng(width: number, height: number, pixels?: Uint8Array): Buffer;
export declare function grayPng(width: number, height: number): Buffer;
export declare function jpegHeaderOnly(width: number, height: number): Buffer;
export declare function webpHeaderOnly(
  width: number,
  height: number,
  variant?: "vp8" | "vp8l" | "vp8x",
): Buffer;
