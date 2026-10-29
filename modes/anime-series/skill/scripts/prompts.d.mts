/**
 * Types for `prompts.mjs` — pure prompt assembly, importable by the viewer.
 */
import type { Bible, EntityKind, Episode, PatchPlan, TimelineEntry } from "./series-state.mjs";

export declare const SEEDANCE_MAX_REFS: number;
export declare const JIMENG_MAX_REFS: number;
export declare const REF_TOKENS: Readonly<{ seedance: (n: number) => string; jimeng: (n: number) => string }>;
export declare const COPY_LINE: string;
export declare const DEFAULT_EXPRESSIONS: readonly string[];
export declare const DEFAULT_POSES: readonly string[];
export declare const DEFAULT_GROUP_POSES: readonly string[];

export declare class PromptError extends Error {}

/** The language the scaffolding is written in: `bible.lang`, else the language of the bible's own text. */
export declare function bibleLang(bible: Partial<Bible> | null | undefined): "en" | "zh";
/** The method's two continuity lines in the bible's language (`add-episode`'s default). */
export declare function defaultContinuity(bible: Partial<Bible> | null | undefined): string[];

export interface SheetPrompt {
  kind: EntityKind;
  id: string;
  name: string;
  /** The scaffolding language. */
  lang: "en" | "zh";
  prompt: string;
  aspectRatio: string;
  /** Character sheets attached as style-only references (scenes only, else 0). */
  styleReferences: number;
}
export declare function sheetPrompt(bible: Partial<Bible>, kind: EntityKind, id: string, options?: { styleReferences?: number }): SheetPrompt;
/** The video prompt's closing line; entity-owned text (`markings`) is the named exception. */
export declare function noTextLine(markings: string[], lang?: "en" | "zh"): string;
export declare function jimengSheet(sheet: SheetPrompt): string;
/** A lineup probe prompt for two or more characters, in reference order. */
export declare function lineupPrompt(bible: Partial<Bible>, characters: Array<{ name: string; look: string }>): string;
export declare function localeOf(bible: Partial<Bible> | null | undefined): import("./prompt-locales.mjs").PromptLocale;

export type SheetOf = (kind: EntityKind, id: string) => string | null;

export interface Ref {
  n: number;
  kind: EntityKind | "storyboard";
  id: string | null;
  name: string;
  asset: string | null;
}

export interface RefContext {
  refs: Array<Ref & { look: string }>;
  textOnly: Array<{ kind: EntityKind; id: string; name: string; look: string }>;
  scene: { id: string; name: string; look: string; time?: string; rules?: string } | null;
  /** `markings` of the cast and groups, in order. */
  markings: string[];
}
export declare function refsFor(
  bible: Partial<Bible>,
  episode: Partial<Episode>,
  options?: { sheetOf?: SheetOf; board?: string | null; limit?: number },
): RefContext;

export interface AssembledPart {
  episode: string;
  part: string;
  lang: "en" | "zh";
  seconds: number;
  shots: number;
  grid: { rows: number; cols: number; tidy: boolean };
  timeline: TimelineEntry[];
  refs: Ref[];
  textOnly: Array<{ kind: EntityKind; id: string; name: string }>;
  storyboard: { prompt: string; refs: Array<string | null> };
  video: { prompt: string };
  jimeng: { storyboard: string; video: string };
  warnings: string[];
}
export declare function assemblePart(
  bible: Partial<Bible>,
  episode: Episode,
  partId: string,
  options?: { sheetOf?: SheetOf; board?: string | null; boardFile?: string | null; limit?: number },
): AssembledPart;

export interface AssembledPanel {
  episode: string;
  part: string;
  shot: number;
  lang: "en" | "zh";
  grid: { rows: number; cols: number; tidy: boolean };
  /** One grid cell at the series ratio: what the panel is drawn at. */
  aspectRatio: string;
  prompt: string;
  refs: Array<string | null>;
  /** The copy-paste form: a canvas line naming the nodes in order (board first), the cut line, the prompt. */
  jimeng: { panel: string };
}
/**
 * `board`: the board the panel goes back into — attached first, as the style reference.
 * `boardFile`: that board's file, named in the Jimeng canvas line.
 */
export declare function assemblePanel(bible: Partial<Bible>, episode: Episode, partId: string, shot: number, options?: { sheetOf?: SheetOf; board?: string | null; boardFile?: string | null }): AssembledPanel;

export interface AssembledPatch {
  episode: string;
  part: string;
  lang: "en" | "zh";
  plan: PatchPlan;
  refs: Ref[];
  video: { prompt: string };
  jimeng: { video: string };
  warnings: string[];
}
export declare function assemblePatch(
  bible: Partial<Bible>,
  episode: Episode,
  partId: string,
  a: number,
  b: number,
  options?: { sheetOf?: SheetOf; board?: string | null; limit?: number },
): AssembledPatch;
