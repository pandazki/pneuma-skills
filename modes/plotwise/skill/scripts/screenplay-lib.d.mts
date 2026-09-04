/**
 * Type surface of screenplay-lib.mjs — the whole main line of a course,
 * written once. Exists so `modes/plotwise/__tests__/` can pin the library
 * under `tsc --noEmit` (the skill directory itself is excluded from the
 * typecheck because it is shipped, not compiled).
 */

import type { CourseLike, OutlineBeatLike } from "./segment-lib.d.mts";
import type { Cut, NarrationLine } from "./h3-prompt.d.mts";

/** The prompt builder lives in h3-prompt.mjs; re-exported for callers. */
export { buildClipPrompt, clipScript } from "./h3-prompt.d.mts";

/** One montage clip as the writer hands it over. */
export interface ScreenplayClip {
  id: string;
  /** 8-15 seconds; 15 is the norm. */
  duration: number;
  /** One line on what this clip shows, in the course's language. */
  theme?: string;
  /** 3-9 time-coded cuts, each with its own camera move. */
  cuts: Cut[];
  /** The narration, placed on the clip's timeline. */
  narration: NarrationLine[];
  /** Ambience and action effects with their moments (optional). */
  audio?: string;
  /** What this style must never show (optional). */
  negatives?: string;
  /** Set-relative figure paths this clip binds: the union of its cuts'. */
  figures: string[];
}

/** The side trip offered at the end of every main scene. */
export interface DetourBrief {
  label: string;
  brief: string;
}

/** One beat's scene: a teaching unit of 1-3 montage clips plus its detour. */
export interface ScreenplayScene {
  beat: string;
  label: string;
  /** The concrete objects, metaphor or character that carry this beat. */
  device: string;
  clips: ScreenplayClip[];
  detour: DetourBrief | null;
}

export interface Screenplay {
  scenes: ScreenplayScene[];
  problems: string[];
  mode: "single" | "fallback";
}

/** A clip as it lives in course.json, ready for the shoot queue. */
export interface LandedClip extends ScreenplayClip {
  videoPrompt: string;
  status: string;
  [key: string]: unknown;
}

export interface ChoiceLink {
  nodeId: string;
  label: string;
}

export interface LandedNode {
  parent?: string;
  beat?: string;
  kind: string;
  choiceLabel: string;
  /** The scene's visual device, for the writer of its detours. */
  device?: string;
  /** Detour stubs only: what the scene will teach when it is written. */
  brief?: string;
  status: string;
  clips: LandedClip[];
  children: ChoiceLink[];
  video?: { file: string; duration: number };
  [key: string]: unknown;
}

export interface LandedCourse extends CourseLike {
  rootNode: string;
  path: string[];
  nodes: Record<string, LandedNode>;
}

/** One structured LLM call: a JSON object in, a JSON object out. */
export type ScreenplayChat = (request: {
  system: string;
  user: string;
}) => Promise<Record<string, unknown>>;

/** A stub the manager asks for clips: a detour or a learner's question. */
export interface DetourNodeLike {
  id?: string;
  parent?: string;
  beat?: string;
  kind?: string;
  choiceLabel?: string;
  brief?: string;
  [key: string]: unknown;
}

export const MIN_CLIP_SECONDS: number;
export const MAX_CLIP_SECONDS: number;
export const DEFAULT_CLIP_SECONDS: number;
export const MIN_CUTS_PER_CLIP: number;
export const MAX_CUTS_PER_CLIP: number;
export const MAX_CLIPS_PER_SCENE: number;
export const MAX_DETOUR_CLIPS: number;
export const MAX_FIGURES_PER_CLIP: number;
/** Narration under this fraction of the speech budget is too sparse to shoot safely. */
export const SPARSE_FLOOR: number;
/** Narration over this multiple of the speech budget garbles; below the hard cap. */
export const DENSE_CEILING: number;
/** The problems certain to waste a render: narration outside the density band. */
export function densityProblems(problems: string[] | null | undefined): string[];
/** MAX_FIGURES_PER_CLIP less one per recurring character (`style.refImages[1..]`). */
export function figureBudget(course: { style?: { refImages?: string[] } } | null | undefined): number;

export const SCREENPLAY_SYSTEM: string;
export const SCENE_SYSTEM: string;
export const DETOUR_SYSTEM: string;
export const SAMPLE_SYSTEM: string;

export function sampleUser(input: {
  topic?: string;
  goal?: string;
  hook: string;
  action?: string;
  styleRecipe?: string;
  styleDevices?: string;
  styleName?: string;
  narration?: "voiceover" | "on-camera" | string;
  language?: string;
  duration?: number;
}): string;

export function validateSampleClip(
  raw: unknown,
  options?: { language?: string; duration?: number },
): { clip: ScreenplayClip | null; problems: string[] };

export interface WriterContext {
  course: CourseLike;
  styleRecipe?: string;
  /** The look's graphic devices (styles.md), for the writer to reach for. */
  styleDevices?: string;
  narration?: "on-camera" | "voiceover" | string;
  language?: string;
}

export function screenplayUser(input: WriterContext): string;
export function sceneUser(
  input: WriterContext & {
    beat: OutlineBeatLike;
    index: number;
    total: number;
    previousScene?: ScreenplayScene | null;
    /** Problems with the previous draft, for a re-ask. */
    revision?: string[];
  },
): string;
export function detourUser(
  input: WriterContext & {
    node: DetourNodeLike;
    parentScene?: unknown;
    revision?: string[];
  },
): string;

export function validateScreenplay(
  raw: unknown,
  context: { course: CourseLike; language?: string; setDir?: string },
): { scenes: ScreenplayScene[]; problems: string[] };

export function landScreenplay(
  course: CourseLike,
  scenes: ScreenplayScene[],
  options?: { language?: string; styleRecipe?: string; narration?: string },
): LandedCourse;

export function writeMainSceneFallback(
  input: WriterContext & { chat: ScreenplayChat; setDir?: string; problems?: string[] },
): Promise<{ scenes: ScreenplayScene[]; problems: string[] }>;

export function writeScreenplay(
  input: WriterContext & { chat: ScreenplayChat; setDir?: string },
): Promise<Screenplay>;

export function writeDetourScene(
  input: WriterContext & { node: DetourNodeLike; chat: ScreenplayChat; setDir?: string },
): Promise<{ device: string; clips: LandedClip[]; problems: string[] }>;
