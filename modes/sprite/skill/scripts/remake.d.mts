/**
 * Types for `remake.mjs` — variants, restyles, storyboards and the motion
 * library (0.6.0).
 */
import type { SheetCharacter } from "./sheet-prompt.mjs";

interface Named extends SheetCharacter { name?: string }

export declare const REMAKE_PROMPT_BUILDER: "remake-prompt/1";
export declare function variantEditPrompt(input: { character: Named; note: string; what?: string }): { prompt: string; builder: string };
export declare function restylePrompt(input: {
  character: Named;
  note?: string;
  grid?: { rows: number; cols: number } | null;
}): { prompt: string; builder: string };
export declare function storyboardPrompt(input: {
  character: Named;
  beats: Array<{ at: number; text: string; keyframe?: string }>;
  duration?: number | null;
}): { prompt: string; builder: string; attach: string[] };
export declare function transferPrompt(input: { character: Named }): { prompt: string; builder: string };

export interface LibraryEntry { id: string; label: string; category: string; action: string }
export declare const MOTION_LIBRARY: LibraryEntry[];
export declare function libraryEntry(id: string): LibraryEntry | null;
export declare function libraryClipPrompt(entry: LibraryEntry): string;
