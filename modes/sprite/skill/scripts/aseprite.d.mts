/**
 * Types for `aseprite.mjs` — the script stays plain ESM; the declaration keeps
 * `tsc --noEmit` honest for the tests that import it.
 */

export interface AsepriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AsepriteFrame {
  frame: AsepriteRect;
  rotated: false;
  trimmed: false;
  spriteSourceSize: AsepriteRect;
  sourceSize: { w: number; h: number };
  duration: number;
  anchor: { x: number; y: number };
  pivot: { x: number; y: number };
}

export interface AsepriteTag {
  name: string;
  from: number;
  to: number;
  direction: "forward";
}

export interface AsepriteDocument {
  frames: Record<string, AsepriteFrame>;
  meta: {
    app: "pneuma-sprite";
    version: string;
    image: string;
    format: "RGBA8888";
    size: { w: number; h: number };
    scale: "1";
    frameTags: AsepriteTag[];
  };
}

export declare function asepriteDocument(input: {
  image: string;
  size: { w: number; h: number };
  tags: Array<{
    name: string;
    frames: Array<{ rect: AsepriteRect; duration: number; anchor: { x: number; y: number } }>;
  }>;
}): AsepriteDocument;

export declare function stackLayout(
  sizes: Array<{ width: number; height: number }>,
): { width: number; height: number; offsets: Array<{ x: number; y: number }> };

export declare function gridLayout(
  count: number,
  cell: { width: number; height: number },
): { width: number; height: number; rects: AsepriteRect[] };
