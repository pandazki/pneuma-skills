/**
 * Type surface of h3-prompt.mjs — the H3 montage prompt, assembled.
 * Exists so `modes/plotwise/__tests__/` can pin the practice under
 * `tsc --noEmit` (the skill directory itself is shipped, not compiled).
 */

/** One cut inside a montage clip: a composed picture with its own camera. */
export interface Cut {
  from: number;
  to: number;
  /** Subject + action + setting, in the course's language. */
  shot: string;
  /** The camera move, in the course's language, without brackets. */
  camera: string;
  /** Set-relative paths of rendered figures this cut puts on screen. */
  figures?: string[];
}

/** One narration line and the span of the clip it is spoken over. */
export interface NarrationLine {
  from: number;
  to: number;
  text: string;
}

/** A montage clip as the writer hands it over. */
export interface ClipDraft {
  duration: number;
  /** One line on what this clip is about, in the course's language. */
  theme?: string;
  cuts: Cut[];
  narration: NarrationLine[];
  /** Ambience and action effects with the moments they land. */
  audio?: string;
  /** What this style must not show, in the course's language. */
  negatives?: string;
  language?: string;
}

/** A reference file as the manager binds it for one clip. */
export interface RefBinding {
  file: string;
  job: "style-anchor" | "continuity" | "character" | "figure" | "voice";
  kind?: "image" | "audio";
  note?: string;
  /** 1-based index of the cut a figure belongs to. */
  cut?: number;
}

export const H3_PRACTICES_VERSION: string;
export const DEFAULT_CAMERA: string;

export function langName(language: string | null | undefined): string;
export function defaultCamera(language: string | null | undefined): string;
export function styleHasPeople(input?: { narration?: string; styleRecipe?: string }): boolean;

export function normalizeCuts(
  rawCuts: unknown,
  duration: number,
  options?: { where?: string; language?: string },
): { cuts: Cut[]; problems: string[] };

export function normalizeNarration(
  rawLines: unknown,
  duration: number,
  options?: { where?: string },
): { narration: NarrationLine[]; problems: string[] };

export function clipScript(
  clip: { narration?: unknown; language?: string } | null | undefined,
  language?: string,
): string;

export function negativesFor(input?: {
  narration?: string;
  styleRecipe?: string;
  figures?: string[];
  extra?: string;
  language?: string;
}): string;

export function buildClipPrompt(input?: {
  styleRecipe?: string;
  narration?: "voiceover" | "on-camera" | string;
  language?: string;
  clip?: Partial<ClipDraft>;
  part?: { index: number; total: number; sceneGoal?: string };
}): string;

export function bindingLines(input?: {
  refs?: RefBinding[];
  narration?: "voiceover" | "on-camera" | string;
}): string[];

export function insertReferenceBlock(prompt: string, lines: string[]): string;
