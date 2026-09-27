/**
 * Types for `sheet-prompt.mjs` — the script stays plain ESM; the declaration
 * keeps `tsc --noEmit` honest for the tests that import it.
 */

export declare const SHEET_PROMPT_BUILDER: "sheet-prompt/2";
export declare const DEFAULT_SAFE_MARGIN_RATIO: number;
export declare const GENERATION_CELL_MAX: number;
export declare const SHEET_FRAME_COUNTS: number[];
export declare const SHEET_STATES: Array<"idle" | "walk" | "run" | "jump" | "attack" | "wave">;
export declare const RECOMMENDED_FRAMES: Partial<Record<SheetState, number>>;
export declare const GUIDE_DEFAULT: boolean;

export type SheetState = "idle" | "walk" | "run" | "jump" | "attack" | "wave" | "generic";
export type SheetDirection = "front" | "back" | "left" | "right";

export interface Size { width: number; height: number }
export interface Inset { x: number; y: number }

export interface GuideGeometry {
  rows: number;
  cols: number;
  cell: Size;
  safeMargin: Inset;
  width: number;
  height: number;
}

export interface SheetGeometry extends GuideGeometry {
  /** `--image-size` for the image call, `${width}x${height}`. */
  imageSize: string;
}

export interface SheetCharacter {
  style?: string;
  description?: string;
  cell?: Size;
  facing?: "left" | "right";
  asymmetric?: string;
  pixel?: { logicalHeight?: number; palette?: string; colors?: number };
}

export interface SheetMotion {
  id?: string;
  label?: string;
  grid: { rows: number; cols: number };
  loop: boolean;
  direction?: SheetDirection;
}

export interface SheetRef {
  id: string;
  role: string;
  direction?: SheetDirection;
}

export interface SheetPromptParts {
  builder: string;
  action: string;
  guards: string[];
  guide?: { rows: number; cols: number; cell: Size; safeMargin: Inset };
}

/** Where the character's own right and left fall in a picture facing each way. */
export declare const SIDE_GEOMETRY: Record<SheetDirection, string>;
/** `SIDE_GEOMETRY[direction]` plus what it asks of every side-specific detail; null for no such direction. */
export declare function sideClause(direction: string | undefined | null): string | null;

export declare function sheetGrid(frames: number): { rows: number; cols: number };
export declare function generationCell(cell: Size): Size;
export declare function safeMarginFor(cell: Size, ratio?: number): Inset;
export declare function guideGeometry(input: {
  rows: number;
  cols: number;
  cell: Size;
  safeMargin?: Inset;
  margin?: number;
}): GuideGeometry;
export declare function sheetGeometry(grid: { rows: number; cols: number }, characterCell: Size | undefined): SheetGeometry;
export declare function guideRaster(geometry: GuideGeometry): { width: number; height: number; data: Uint8Array };
export declare function stateOf(motion: { id?: string; label?: string }): SheetState;
export declare function sheetGuards(input: {
  character: SheetCharacter;
  motion: SheetMotion;
  state: SheetState;
  anchor?: boolean;
  guide?: boolean;
  /** The facing of a finished other-side sheet attached for rhythm only. */
  rhythm?: "left" | "right" | null;
}): string[];
export declare function renderSheetPrompt(
  input: { character: SheetCharacter; motion: SheetMotion },
  parts: SheetPromptParts,
): string;
export declare function buildSheetPrompt(input: {
  character: SheetCharacter;
  motion: SheetMotion;
  refs?: SheetRef[];
  action: string;
  state?: SheetState;
  guide?: boolean;
  /** The facing of the finished other-side sheet the caller attaches after the references. */
  rhythm?: "left" | "right" | null;
}): {
  prompt: string;
  parts: SheetPromptParts;
  state: SheetState;
  geometry: SheetGeometry;
  /** Ref ids the text assumes are attached, in order; the caller appends the rhythm sheet, then the guide. */
  attach: string[];
};
