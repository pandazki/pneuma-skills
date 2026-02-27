/**
 * File watcher — monitors workspace for content file changes using chokidar.
 * Debounces changes and notifies callback with updated file contents.
 *
 * Parameterized by ViewerConfig from ModeManifest — no hardcoded file type knowledge.
 */

import { watch } from "chokidar";
import { readFileSync, existsSync } from "node:fs";
import { relative } from "node:path";
import type { ViewerConfig } from "../core/types/mode-manifest.js";

const DEBOUNCE_MS = 300;

export interface FileUpdate {
  path: string;
  content: string;
}

/**
 * Extract file extensions from simple glob patterns (e.g., "**\/*.md" → ".md").
 * Returns null if patterns are too complex to extract extensions from.
 */
function extractWatchExtensions(patterns: string[]): Set<string> | null {
  const exts = new Set<string>();
  for (const pattern of patterns) {
    const match = pattern.match(/\*\.(\w+)$/);
    if (match) {
      exts.add(`.${match[1]}`);
    }
  }
  return exts.size > 0 ? exts : null;
}

/**
 * Check if a file path matches the watch patterns.
 */
function matchesWatchPatterns(relPath: string, watchExtensions: Set<string> | null): boolean {
  if (!watchExtensions) return true; // No extension filter → watch everything
  const lastDot = relPath.lastIndexOf(".");
  if (lastDot === -1) return false;
  return watchExtensions.has(relPath.slice(lastDot).toLowerCase());
}

export function startFileWatcher(
  workspace: string,
  viewerConfig: ViewerConfig,
  onUpdate: (files: FileUpdate[]) => void,
): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingChanges = new Set<string>();

  // Derive watch extensions from ViewerConfig patterns
  const watchExtensions = extractWatchExtensions(viewerConfig.watchPatterns);

  // Combine ignore patterns — normalize for chokidar
  const ignorePatterns = [
    ...(viewerConfig.ignorePatterns || []).map((p) =>
      // chokidar works best with **/ prefix for directory patterns
      p.includes("/") && !p.startsWith("**/") && !p.startsWith("/") ? `**/${p}` : p,
    ),
  ];

  // Watch the workspace directory (not glob) — chokidar globs + cwd don't work reliably
  const watcher = watch(workspace, {
    ignored: ignorePatterns,
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

  const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

  const scheduleFlush = (absPath: string) => {
    const relPath = relative(workspace, absPath);

    // Image changes: notify browser to bust cache (don't read content)
    const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      onUpdate([{ path: relPath, content: "" }]);
      return;
    }

    // Filter by watch patterns
    if (!matchesWatchPatterns(relPath, watchExtensions)) return;

    pendingChanges.add(relPath);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  };

  watcher.on("change", scheduleFlush);
  watcher.on("add", scheduleFlush);

  const patternDesc = viewerConfig.watchPatterns.join(", ");
  console.log(`[file-watcher] Watching ${workspace} for ${patternDesc} changes`);
}
