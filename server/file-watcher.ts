/**
 * File watcher — monitors workspace for content file changes using chokidar.
 * Debounces changes and notifies callback with updated file contents.
 *
 * Parameterized by ViewerConfig from ModeManifest — no hardcoded file type knowledge.
 */

import { watch } from "chokidar";
import { readFileSync, existsSync } from "node:fs";
import { relative, join } from "node:path";
import type { ViewerConfig } from "../core/types/mode-manifest.js";

const DEBOUNCE_MS = 300;

/** OS junk, editor swap/backup, VCS, build artifacts, and other files that should never trigger updates. */
const DEFAULT_IGNORE = [
  // OS junk
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/desktop.ini",
  // VCS
  "**/.git/**",
  "**/.svn/**",
  "**/.hg/**",
  // Editor swap / backup files
  "**/*~",
  "**/*.swp",
  "**/*.swo",
  "**/*.swn",
  "**/.*.swp",
  "**/#*#",
  "**/.#*",
  // IDE metadata
  "**/.idea/**",
  "**/.vscode/**",
  // Pneuma / agent internal
  "**/.pneuma/**",
  "**/.claude/**",
  "**/.agents/**",
  "**/CLAUDE.md",
  "**/AGENTS.md",
  // Environment & secrets
  "**/.env",
  "**/.env.*",
  // Log files
  "**/*.log",
  // Dependencies
  "**/node_modules/**",
  "**/bower_components/**",
  // Build artifacts & caches
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.vite/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/.parcel-cache/**",
  // Framework-specific build output
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/.output/**",
  // Test / coverage output
  "**/coverage/**",
  // TypeScript build info
  "**/.tsbuildinfo",
  "**/*.tsbuildinfo",
];

export interface FileUpdate {
  path: string;
  content: string;
  /**
   * Origin tag added by the file watcher. "self" if this change matches
   * a pending registerSelfWrite/Delete entry (i.e. it's the echo of a
   * viewer write routed through /api/files); "external" otherwise.
   * Always present on updates emitted after P3.
   */
  origin: "self" | "external";
  /**
   * True for unlink events (file deleted on disk). `content` is empty
   * string in that case. Consumers that care about delete vs empty-write
   * should check this flag.
   */
  deleted?: boolean;
}

/**
 * pendingSelfWrites is the ONLY place in the system where viewer-origin
 * writes are identified. When the /api/files POST handler receives a
 * write, it calls `registerSelfWrite(path, content)` here. When chokidar
 * subsequently fires for that path, we look up the entry and tag the
 * outgoing FileUpdate with origin: "self" if the content matches. Entries
 * auto-expire after PENDING_SELF_WRITE_TTL_MS to guarantee an unmatched
 * registration doesn't poison a later legitimate external edit.
 *
 * pendingSelfDeletes works the same way for DELETE /api/files, but since
 * a delete has no content to match on, the map stores only the expiry
 * timestamp. The next chokidar `unlink` event for that path consumes the
 * entry regardless of timing (within the TTL).
 */
const PENDING_SELF_WRITE_TTL_MS = 5000;

interface PendingSelfWrite {
  content: string;
  expiresAt: number;
}

const pendingSelfWrites = new Map<string, PendingSelfWrite[]>();
const pendingSelfDeletes = new Map<string, number /* expiresAt */>();

export function registerSelfWrite(relPath: string, content: string): void {
  const entry: PendingSelfWrite = {
    content,
    expiresAt: Date.now() + PENDING_SELF_WRITE_TTL_MS,
  };
  const existing = pendingSelfWrites.get(relPath) ?? [];
  existing.push(entry);
  pendingSelfWrites.set(relPath, existing);
}

export function registerSelfDelete(relPath: string): void {
  pendingSelfDeletes.set(relPath, Date.now() + PENDING_SELF_WRITE_TTL_MS);
}

/**
 * Consume a pending self-write entry matching this content.
 * Content equality is the matching strategy. Expired entries are dropped
 * silently without matching so a stale registration cannot mis-tag a
 * later legitimate external edit.
 */
function consumeSelfWrite(relPath: string, content: string): boolean {
  const queue = pendingSelfWrites.get(relPath);
  if (!queue || queue.length === 0) return false;
  const now = Date.now();
  // Drop expired entries from the head.
  while (queue.length > 0 && queue[0].expiresAt < now) {
    queue.shift();
  }
  if (queue.length === 0) {
    pendingSelfWrites.delete(relPath);
    return false;
  }
  const idx = queue.findIndex((e) => e.content === content);
  if (idx < 0) return false;
  queue.splice(idx, 1);
  if (queue.length === 0) pendingSelfWrites.delete(relPath);
  return true;
}

function consumeSelfDelete(relPath: string): boolean {
  const exp = pendingSelfDeletes.get(relPath);
  if (!exp) return false;
  if (exp < Date.now()) {
    pendingSelfDeletes.delete(relPath);
    return false;
  }
  pendingSelfDeletes.delete(relPath);
  return true;
}

/**
 * Extract file extensions from simple glob patterns (e.g., "**\/*.md" → ".md").
 * Returns null if patterns are too complex to extract extensions from.
 */
function extractWatchExtensions(patterns: string[]): Set<string> | null {
  const exts = new Set<string>();
  for (const pattern of patterns) {
    // Glob pattern: "slides/*.html", "**/*.md"
    const globMatch = pattern.match(/\*\.(\w+)$/);
    if (globMatch) {
      exts.add(`.${globMatch[1]}`);
      continue;
    }
    // Named file pattern: "manifest.json", "**/theme.css"
    // Check the basename (last segment) for a literal extension
    const basename = pattern.split("/").pop() || "";
    const namedMatch = basename.match(/\.(\w+)$/);
    if (namedMatch && !basename.includes("*")) {
      exts.add(`.${namedMatch[1]}`);
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

  // Combine default + mode-specific ignore patterns
  const ignorePatterns = [
    ...DEFAULT_IGNORE,
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
      const absPath = join(workspace, relPath);
      if (existsSync(absPath)) {
        try {
          const content = readFileSync(absPath, "utf-8");
          const origin: "self" | "external" = consumeSelfWrite(relPath, content)
            ? "self"
            : "external";
          files.push({ path: relPath, content, origin });
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
    // Normalize to forward slashes for cross-platform consistency (Windows path.relative returns backslashes)
    const relPath = relative(workspace, absPath).replaceAll("\\", "/");

    // Image changes: notify browser to bust cache (don't read content)
    const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      // Images are never self-writes from a viewer (data URLs bypass the
      // registerSelfWrite path per the plan), so hard-code "external".
      onUpdate([{ path: relPath, content: "", origin: "external" }]);
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

  const handleUnlink = (absPath: string) => {
    // Normalize to forward slashes for cross-platform consistency.
    const relPath = relative(workspace, absPath).replaceAll("\\", "/");

    // Apply the same watch-pattern + image filter as add/change, so deletes
    // of ignored file types don't leak out. Images fall through the pattern
    // filter (their extensions aren't in watchExtensions) but we still want
    // to emit delete events for them, so check IMAGE_EXTS first.
    const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
    const isImage = IMAGE_EXTS.has(ext);
    if (!isImage && !matchesWatchPatterns(relPath, watchExtensions)) return;

    const origin: "self" | "external" = consumeSelfDelete(relPath) ? "self" : "external";
    // Emit immediately — the file is gone, so we can't route through the
    // readFileSync-backed debounce flush. This mirrors the image branch.
    onUpdate([{ path: relPath, content: "", origin, deleted: true }]);
  };

  watcher.on("change", scheduleFlush);
  watcher.on("add", scheduleFlush);
  watcher.on("unlink", handleUnlink);
  watcher.on("error", (err) => {
    // Permission errors (EACCES/EPERM) during directory traversal — log and continue
    console.warn(`[file-watcher] ${err}`);
  });

  const patternDesc = viewerConfig.watchPatterns.join(", ");
  console.log(`[file-watcher] Watching ${workspace} for ${patternDesc} changes`);
}

/**
 * Watch proxy.json for changes and call the update callback with parsed config.
 * Separate from the content file watcher — proxy config has its own lifecycle.
 */
export function startProxyWatcher(
  workspace: string,
  onUpdate: (config: Record<string, unknown> | null) => void,
): void {
  const proxyPath = join(workspace, "proxy.json");

  const watcher = watch(proxyPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  const reload = () => {
    if (existsSync(proxyPath)) {
      try {
        const content = readFileSync(proxyPath, "utf-8");
        const parsed = JSON.parse(content);
        console.log(`[proxy] proxy.json updated, reloading config`);
        onUpdate(parsed);
      } catch (err) {
        console.error(`[proxy] Failed to parse proxy.json: ${err}`);
      }
    } else {
      console.log(`[proxy] proxy.json removed, clearing workspace proxy config`);
      onUpdate(null);
    }
  };

  watcher.on("change", reload);
  watcher.on("add", reload);
  watcher.on("unlink", reload);
}
