/**
 * Types for `pack.mjs` — facing sheets and pack clips (0.6.0).
 */
import type { SheetCharacter, SheetDirection } from "./sheet-prompt.mjs";

export declare const PACK_PROMPT_BUILDER: "pack-prompt/1";

export interface FacingLayout {
  rows: number;
  cols: number;
  cells: Array<SheetDirection | null>;
}

export declare const FACING_LAYOUTS: Record<"8" | "4", FacingLayout>;
export declare function facingLayout(value: string | number | FacingLayout): FacingLayout;

export interface CellRect { row: number; col: number; x: number; y: number; w: number; h: number }
export declare function cellRects(width: number, height: number, rows: number, cols: number): CellRect[];

export declare function facingSheetPrompt(input: {
  character: SheetCharacter;
  layout?: string | number | FacingLayout;
}): { prompt: string; layout: FacingLayout; builder: string };

export interface PackCell { motion: string; direction?: SheetDirection; item?: string }
export interface PackRecord { state: string; rows: number; cols: number; cells: Array<PackCell | null> }

export declare const PACK_STATES: string[];
export declare const PINNED_PACK_STATES: string[];
export declare function packClipPrompt(input: {
  character: SheetCharacter;
  pack: PackRecord;
  action?: string | null;
}): { prompt: string; builder: string; pinned: boolean };
export declare function packCellMotionId(state: string, cell: { direction?: SheetDirection; item?: string }): string;

export declare function itemGrid(count: number, maxCols?: number): { rows: number; cols: number };
export declare function itemId(name: string): string;
export declare function itemSheetPrompt(input: {
  character: SheetCharacter;
  items: Array<string | { label: string }>;
  cols: number;
  rows: number;
}): { prompt: string; builder: string };
