/**
 * Type surface of play-manager.mjs — the play loop as one process.
 * Exists so `modes/plotwise/__tests__/` can pin the scheduling under
 * `tsc --noEmit` (the skill directory itself is excluded from the
 * typecheck because it is shipped, not compiled).
 */

import type { QueueSnapshot } from "./async-job-queue.d.mts";

/** Every paid or platform-bound step, injectable so scheduling can be
 * tested without a clip being made. */
export interface ManagerDeps {
  model?: string;
  chat: ((request: { system: string; user: string }) => Promise<Record<string, unknown>>) | null;
  renderShot(
    input: { prompt: string; output: string; duration: number; image?: string; refImages?: string[]; refAudios?: string[]; seed?: number },
    signal?: AbortSignal,
  ): Promise<{ duration?: number; url?: string; [key: string]: unknown }>;
  /** The continuity kit's steps — optional; a manager without them shoots without a voice reference or character sheet. */
  extractAudio?(video: string, output: string, maxSeconds?: number, signal?: AbortSignal): Promise<void>;
  firstFrame?(video: string, output: string, signal?: AbortSignal): Promise<void>;
  characterSheet?(input: { frame: string; outputs: string[]; styleRecipe: string }, signal?: AbortSignal): Promise<void>;
  transcribe(input: { input: string; language: string }, signal?: AbortSignal): Promise<string>;
  judge:
    | ((args: { script: string; transcript: string; language: string; similarity: number; coverage: number }) => Promise<{ verdict: "pass" | "fail"; reason: string }>)
    | null;
  lastFrame(video: string, out: string): boolean;
  probe(video: string): number | null | undefined;
  concat(inputs: string[], output: string, signal?: AbortSignal): Promise<void>;
}

export interface ManagerShot {
  id: string;
  script: string;
  status: string;
  video?: { file: string; duration: number };
  [key: string]: unknown;
}

export interface ManagerNode {
  parent?: string;
  beat?: string;
  kind: string;
  choiceLabel?: string;
  brief?: string;
  status: string;
  phase?: string | null;
  error?: string | null;
  shots: ManagerShot[];
  children: Array<{ nodeId: string; label: string }>;
  video?: { file: string; duration: number };
  [key: string]: unknown;
}

export interface ManagerCourse {
  rootNode: string;
  path: string[];
  nodes: Record<string, ManagerNode>;
  style: {
    id?: string;
    narration?: string;
    refImages?: string[];
    userRefs?: string[];
    sample?: { image?: string; video?: string; hook?: string };
    /** Set by the continuity kit. */
    voiceRef?: string;
    characterSheet?: string[];
    [key: string]: unknown;
  };
  play: {
    state: string;
    currentNode?: string;
    queued: string[];
    active: string[];
    pruned: number;
    updatedAt?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ManagerOptions {
  setDir: string;
  deps: ManagerDeps;
  slots?: number;
  videoAhead?: number;
  planAhead?: number;
  /** "locked" (default): every shot reference-to-video with the voice reference, and a character sheet for a speaker on screen — one narrator, one face; "chain": image-to-video frame chain inside a scene for voiceover shots with nothing else (seamless, no voice on those). The voice reference is made in both. */
  continuity?: "chain" | "locked";
  log?: (line: string) => void;
  pollMs?: number;
}

/** Where the continuity kit lives, set-relative. */
export const VOICE_REF: string;
export const CHARACTER_SHEET: string[];

export interface PlayManager {
  readonly course: ManagerCourse;
  start(): PlayManager;
  choose(nodeId: string): void;
  retry(nodeId: string): void;
  request(request: { parent: string; label: string; brief: string }): void;
  reconcile(): void;
  queues(): { planning: QueueSnapshot; video: QueueSnapshot };
  stop(): Promise<void>;
  whenIdle(): Promise<void>;
}

export function createManager(options: ManagerOptions): PlayManager;
export function defaultDeps(options?: { setDir?: string; resolution?: string; model?: string }): ManagerDeps;
export function descendantWindow(
  nodes: Record<string, { children?: Array<{ nodeId: string }> }>,
  rootId: string,
  depth: number,
): Array<{ id: string; distance: number }>;
export function subtreeIds(nodes: Record<string, { children?: Array<{ nodeId: string }> }>, rootId: string): string[];
