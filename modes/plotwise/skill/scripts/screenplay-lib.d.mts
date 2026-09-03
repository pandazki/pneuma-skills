/**
 * Type surface of screenplay-lib.mjs — the whole main line of a course,
 * written once. Exists so `modes/plotwise/__tests__/` can pin the library
 * under `tsc --noEmit` (the skill directory itself is excluded from the
 * typecheck because it is shipped, not compiled).
 */

import type { CourseLike, OutlineBeatLike } from "./segment-lib.d.mts";

/** One shot as the writer hands it over: narration, picture, length. */
export interface ScreenplayShot {
  script: string;
  visual: string;
  duration: number;
  /** Set-relative paths of rendered figures this shot puts on screen. */
  figures: string[];
}

/** The side trip offered at the end of every main scene. */
export interface DetourBrief {
  label: string;
  brief: string;
}

/** One beat's scene: a teaching unit of 1-6 shots plus its detour. */
export interface ScreenplayScene {
  beat: string;
  label: string;
  shots: ScreenplayShot[];
  detour: DetourBrief | null;
}

export interface Screenplay {
  scenes: ScreenplayScene[];
  problems: string[];
  mode: "single" | "fallback";
}

/** A shot as it lives in course.json, ready for the shoot queue. */
export interface LandedShot extends ScreenplayShot {
  id: string;
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
  /** Detour stubs only: what the scene will teach when it is written. */
  brief?: string;
  status: string;
  shots: LandedShot[];
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

/** A stub the manager asks for shots: a detour or a learner's question. */
export interface DetourNodeLike {
  id?: string;
  parent?: string;
  beat?: string;
  kind?: string;
  choiceLabel?: string;
  brief?: string;
  [key: string]: unknown;
}

export const MIN_SHOT_SECONDS: number;
export const MAX_SHOT_SECONDS: number;
export const DEFAULT_SHOT_SECONDS: number;
export const MAX_SHOTS_PER_SCENE: number;
export const MAX_DETOUR_SHOTS: number;
export const MAX_FIGURES_PER_SHOT: number;
/** MAX_FIGURES_PER_SHOT less one per recurring character (`style.refImages[1..]`). */
export function figureBudget(course: { style?: { refImages?: string[] } } | null | undefined): number;

export const SCREENPLAY_SYSTEM: string;
export const SCENE_SYSTEM: string;
export const DETOUR_SYSTEM: string;

export interface WriterContext {
  course: CourseLike;
  styleRecipe?: string;
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
  },
): string;
export function detourUser(
  input: WriterContext & {
    node: DetourNodeLike;
    parentScene?: unknown;
  },
): string;

export function validateScreenplay(
  raw: unknown,
  context: { course: CourseLike; language?: string; setDir?: string },
): { scenes: ScreenplayScene[]; problems: string[] };

export function buildShotPrompt(input: {
  styleRecipe?: string;
  narration?: "on-camera" | "voiceover" | string;
  language?: string;
  shot: Partial<ScreenplayShot>;
  sceneGoal?: string;
  hasParentFrame?: boolean;
  isSceneOpening?: boolean;
}): string;

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
): Promise<{ shots: LandedShot[]; problems: string[] }>;
