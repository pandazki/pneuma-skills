/**
 * File watcher — monitors workspace for markdown file changes using chokidar.
 * Debounces changes and notifies callback with updated file contents.
 */

import { watch } from "chokidar";
import { readFileSync, existsSync } from "node:fs";
import { relative } from "node:path";

const DEBOUNCE_MS = 300;
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.claude/**",
];

export interface FileUpdate {
  path: string;
  content: string;
}

export function startFileWatcher(
  workspace: string,
  onUpdate: (files: FileUpdate[]) => void,
): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingChanges = new Set<string>();

  // Watch the workspace directory (not glob) — chokidar globs + cwd don't work reliably
  const watcher = watch(workspace, {
    ignored: IGNORE_PATTERNS,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  const flush = () => {
    const files: FileUpdate[] = [];
    for (const relPath of pendingChanges) {
      const absPath = `${workspace}/${relPath}`;
      if (existsSync(absPath)) {
        try {
          const content = readFileSync(absPath, "utf-8");
          files.push({ path: relPath, content });
        } catch {
          // skip unreadable files
        }
      }
    }
    pendingChanges.clear();

    if (files.length > 0) {
      onUpdate(files);
    }
  };

  const scheduleFlush = (absPath: string) => {
    // Only watch .md content files — skip config files
    if (!absPath.endsWith(".md")) return;
    const relPath = relative(workspace, absPath);
    if (relPath === "CLAUDE.md") return;
    pendingChanges.add(relPath);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  };

  watcher.on("change", scheduleFlush);
  watcher.on("add", scheduleFlush);

  console.log(`[file-watcher] Watching ${workspace} for markdown changes`);
}
