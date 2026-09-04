/**
 * Type surface of h3-prompt.mjs — the one place plotwise's H3 prompt
 * practice lives. Exists so `modes/plotwise/__tests__/` can pin the prompt
 * under `tsc --noEmit` (the skill directory itself is shipped, not compiled).
 */

export const H3_PRACTICES_VERSION: string;
export const DEFAULT_CAMERA: string;

export interface ShotBeat {
  /** Seconds into the shot where this beat starts. */
  from: number;
  /** Seconds into the shot where this beat ends. */
  to: number;
  /** What happens on screen during the beat. */
  action: string;
  /** The camera move, written as motion + amplitude + speed. */
  camera: string;
}

export interface PromptShot {
  script: string;
  visual?: string;
  duration?: number;
  figures?: string[];
  beats?: Array<Partial<ShotBeat> & { action?: string; what?: string; visual?: string; start?: number; end?: number }>;
  sound?: string;
}

export function hasCameraDirection(text: string | null | undefined): boolean;
export function styleHasPeople(input?: { narration?: string; styleRecipe?: string }): boolean;
export function normalizeBeats(
  rawBeats: unknown,
  duration: number,
  options?: { where?: string },
): { beats: ShotBeat[]; problems: string[] };
export function negativesFor(input?: { narration?: string; styleRecipe?: string; figures?: string[] }): string;
export function buildShotPrompt(input: {
  styleRecipe?: string;
  narration?: "voiceover" | "on-camera";
  language?: string;
  shot: PromptShot;
  sceneGoal?: string;
  hasParentFrame?: boolean;
  isSceneOpening?: boolean;
}): string;
