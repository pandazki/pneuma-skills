/**
 * Types for `canvas.mjs` — the script stays plain ESM; the declaration keeps
 * `tsc --noEmit` honest for the tests that import it.
 */

export type RoomShape = "square" | "tall" | "wide";

export declare const ROOM_SHAPES: RoomShape[];
export declare const ROOM_DEFAULTS: Record<RoomShape, { ratio: number; headroom: number; lead: number; trail: number }>;

export declare function roomCanvas(
  still: { width: number; height: number },
  options: {
    room: RoomShape;
    headroom?: number;
    lead?: number;
    trail?: number;
    facing?: "left" | "right";
  },
): {
  room: RoomShape;
  canvas: { width: number; height: number };
  offset: { x: number; y: number };
  headroom: number;
  lead: number;
  trail: number;
  facing: "left" | "right";
};
