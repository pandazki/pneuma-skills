/**
 * Types for `rive-plan.mjs` — the script stays plain ESM; the declaration
 * keeps `tsc --noEmit` honest for the viewer and the tests that import it.
 */

export declare const RIVE_DEFAULT_IMAGES: "webp";
export declare const RIVE_PIXEL_ART_STYLE: RegExp;
/** The sidecar's character as the pixel reading needs it. */
export interface RivePixelCharacter {
  style?: string | null;
  pixel?: { logicalHeight?: number | null } | null;
}
/** `character.pixel` first; `style` for a character without one. A bare
 *  string is read as the style. */
export declare function riveIsPixelArt(character: RivePixelCharacter | string | null | undefined): boolean;
export declare function riveDefaultImages(character: RivePixelCharacter | string | null | undefined): "webp" | "webp-lossless";
export declare const RIVE_LOOP_FPS: number;
export declare const RIVE_LOOP_MAX_SIZE: number;
export declare const RIVE_DECODE_WARN_BYTES: number;
export declare const RIVE_DECODE_LIMIT_BYTES: number;

/** Whole MB of memory, 1 MB = 1024 × 1024 bytes. */
export declare function riveMB(bytes: number): number;

export declare function riveDecodeWarning(bytes: number): string | null;

export declare function riveSampleFrames(
  count: number,
  sourceFps: number,
  fps: number | null,
  loop: boolean,
): { fps: number; indices: number[] };

export declare function riveScaleFactor(
  sizes: Array<{ width: number; height: number; clipScale?: number | null }>,
  maxSize: number | null,
): number;

export type RivePlanKind = "sprite" | "loop" | "transition";

export interface RivePlanInput {
  id: string;
  kind: RivePlanKind;
  loop: boolean;
  /** The motion's own rate. */
  fps: number;
  /** Registered frame count. */
  frames: number;
  width: number;
  height: number;
  /** Frame px per clip px, when known — a loop's or transition's `inspect.scale`. */
  clipScale?: number | null;
  /** A transition: the transition whose frames it plays backwards. */
  reverseOf?: string;
  /** A sprite motion: the sprite motion whose frames it shows flipped. */
  mirrorOf?: string;
}

export interface RivePlanMotion {
  id: string;
  kind: RivePlanKind;
  loop: boolean;
  source: { frames: number; fps: number; width: number; height: number };
  /** Effective rate in the file. */
  fps: number;
  /** Frames embedded. */
  frames: number;
  /** Which source frames, by index. */
  indices: number[];
  width: number;
  height: number;
  /** What the motion's own frames are multiplied by. */
  scale: number;
  /** The clipScale it was planned with, or null. */
  clipScale: number | null;
  /** A reverse or a mirror that embeds nothing: the motion whose images it shows. */
  shares?: string;
  /** A sharing mirror: the images are shown flipped left to right. */
  mirrored?: boolean;
  /** A sharing motion: frame r shows the source's kept frame sharedFrames[r]. */
  sharedFrames?: number[];
  decodeBytes: number;
}

export interface RivePlanSettings {
  fps: number | null;
  maxSize: number | null;
}

export interface RivePlan {
  settings: { loop: RivePlanSettings; sprite: RivePlanSettings };
  motions: RivePlanMotion[];
  decodeBytes: number;
}

export declare function rivePlan(
  motions: RivePlanInput[],
  options?: { fps?: number | null; maxSize?: number | null },
): RivePlan;

/** Whether a registered reverse still shows its source backwards: every
 *  frame's `reverse` edge is newer than the source frame it names. */
export declare function riveReverseIsCurrent(
  reverse: { frames: string[] },
  source: { frames: string[] },
  lookup: {
    edgeOf: (assetId: string) => {
      fromAssetId: string | null;
      operation?: { timestamp?: number; params?: Record<string, unknown> };
    } | undefined;
    createdAt: (assetId: string) => number | undefined;
  },
): boolean;

/** Whether a registered mirror still shows its source flipped: every frame's
 *  `mirror` edge is newer than the source frame it names. */
export declare function riveMirrorIsCurrent(
  mirror: { frames: string[] },
  source: { frames: string[] },
  lookup: {
    edgeOf: (assetId: string) => {
      fromAssetId: string | null;
      operation?: { timestamp?: number; params?: Record<string, unknown> };
    } | undefined;
    createdAt: (assetId: string) => number | undefined;
  },
): boolean;
