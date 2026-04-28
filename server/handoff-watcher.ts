/**
 * Handoff watcher — monitors <projectRoot>/.pneuma/handoffs/ for handoff file
 * changes using chokidar. Emits structured created/deleted events to listeners.
 *
 * Used by: Task 11 (UI consumers), Task 16 (route handlers).
 */

import chokidar, { type FSWatcher } from "chokidar";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseHandoffMarkdown } from "./handoff-parser.js";

// Re-exported so existing consumers (Task 11/16) continue to import these
// types from `./handoff-watcher` even though the parser moved.
export type { HandoffFrontmatter, ParsedHandoff } from "./handoff-parser.js";
import type { ParsedHandoff } from "./handoff-parser.js";

export type HandoffEvent =
  | { type: "created"; handoff: ParsedHandoff }
  | { type: "deleted"; handoff: ParsedHandoff };

export interface HandoffWatcherOptions {
  projectRoot: string;
  onEvent: (e: HandoffEvent) => void;
}

export async function startHandoffWatcher(
  options: HandoffWatcherOptions
): Promise<() => Promise<void>> {
  const dir = join(options.projectRoot, ".pneuma", "handoffs");
  const watcher: FSWatcher = chokidar.watch(dir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    depth: 0,
  });

  const cache = new Map<string, ParsedHandoff>();

  watcher.on("add", async (path) => {
    if (!path.endsWith(".md")) return;
    const parsed = await safeParse(path);
    if (!parsed) return;
    cache.set(path, parsed);
    options.onEvent({ type: "created", handoff: parsed });
  });

  watcher.on("change", async (path) => {
    if (!path.endsWith(".md")) return;
    const parsed = await safeParse(path);
    if (!parsed) return;
    cache.set(path, parsed);
    options.onEvent({ type: "created", handoff: parsed });
  });

  watcher.on("unlink", (path) => {
    if (!path.endsWith(".md")) return;
    const cached = cache.get(path);
    if (!cached) return;
    cache.delete(path);
    options.onEvent({ type: "deleted", handoff: cached });
  });

  return async () => {
    await watcher.close();
  };
}

async function safeParse(path: string): Promise<ParsedHandoff | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return parseHandoffMarkdown(path, raw);
  } catch {
    return null;
  }
}
