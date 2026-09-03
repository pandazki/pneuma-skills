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
    input: { prompt: string; output: string; duration: number; image?: string; refImages?: string[]; seed?: number },
    signal?: AbortSignal,
  ): Promise<{ duration?: number; url?: string; [key: string]: unknown }>;
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
  log?: (line: string) => void;
  pollMs?: number;
}

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
