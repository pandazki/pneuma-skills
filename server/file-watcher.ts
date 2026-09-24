/**
 * File watcher — turns workspace changes into `content_update` batches.
 * Debounces text changes and notifies the callback with updated contents.
 *
 * Parameterized by ViewerConfig from ModeManifest — no hardcoded file type
 * knowledge. Change detection comes from the workspace watcher layer
 * (`server/watch/`): one watch per root, write stability, and the same event
 * stream on every backend. This module keeps what is specific to content
 * updates: ignore rules, the extension filter, the text debounce, image
 * signals, self-echo tagging, containment, and which deletes a browser needs.
 */

import { readFileSync, existsSync } from "node:fs";
import { relative, join, resolve } from "node:path";
import type { ViewerConfig } from "../core/types/mode-manifest.js";
import type { WatcherBackendKind } from "../core/types/workspace-watcher.js";
import { isContained } from "./utils.js";
import { readWorkspaceText } from "./workspace-text.js";
import { createWorkspaceWatcher, type WatchBackend, type WorkspaceWatcher } from "./watch/index.js";

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
  // Pneuma / agent internal — every backend's native skills tree + the
  // project-level instructions file the corresponding CLI reads.
  "**/.pneuma/**",
  "**/.claude/**",
  "**/.agents/**",
  "**/.kimi-code/**",
  "**/CLAUDE.md",
  "**/AGENTS.md",
  "**/agents.md",
  // Environment & secrets
  "**/.env",
  "**/.env.*",
  // Log files
  "**/*.log",
  // Dependencies
  "**/node_modules/**",
  "**/bower_components/**",
  // Python environments & caches — mirrors shadow-git's BASE_EXCLUDE_RULES.
  // A grounding agent once built a virtualenv INSIDE a course directory
  // (12,704 files); the watcher swallowed the flood, then went silent for
  // good — every later course.json change reached the server and never
  // the browser — and the next server start spent minutes stat-ing the
  // tree under Bun's allocator lock before it answered a single request.
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/site-packages/**",
  "**/*.pyc",
  "**/.mypy_cache/**",
  "**/.pytest_cache/**",
  "**/.ruff_cache/**",
  "**/.tox/**",
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

/**
 * Session-state plumbing that sits at the workspace ROOT in the
 * project-session topology (`stateDir === workspace` — see the shadow-git
 * `PROJECT_ROOT_EXCLUDE_RULES` for the same derivation). Every entry is
 * root-anchored (no `**` prefix), so a same-named file inside a user content
 * subdir (e.g. `deck/history.json`) is still watched.
 */
const PROJECT_ROOT_STATE_IGNORE = [
  "session.json",
  "history.json",
  "config.json",
  "skill-version.json",
  "skill-dismissed.json",
  "deploy.json",
  "viewer-state.json",
  "thumbnail.png",
  "checkpoints.jsonl",
  "inbound-handoff.json",
  "borrow-result.json",
  "shadow.git/**",
  "captures/**",
  "evolution/**",
  "onboard/**",
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
   * should check this flag. Sent for a path the watcher layer knew (indexed
   * at start or reported since) or a browser may hold (a snapshot listed it
   * or an update carried it); a scratch file seen by neither is not sent.
   */
  deleted?: boolean;
}

/**
 * pendingSelfWrites is the ONLY place in the system where viewer-origin
 * writes are identified. When the /api/files POST handler receives a
 * write, it calls `registerSelfWrite(path, content)` here. When the watcher
 * subsequently reports that path, we look up the entry and tag the
 * outgoing FileUpdate with origin: "self" if the content matches. Entries
 * auto-expire after PENDING_SELF_WRITE_TTL_MS to guarantee an unmatched
 * registration doesn't poison a later legitimate external edit.
 *
 * pendingSelfDeletes works the same way for DELETE /api/files, but since
 * a delete has no content to match on, the map stores only the expiry
 * timestamp. The next watcher delete for that path consumes the entry
 * regardless of timing (within the TTL).
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

/**
 * Paths a browser may hold, per workspace: every path a cold-start snapshot
 * served (`readFileSnapshot`, GET /api/files) and every path a non-delete
 * update carried, until a delete for it is sent.
 *
 * A delete is sent when the layer knew the path (`deleted.known`: indexed at
 * creation or reported since — an unchanged image a page displays, which no
 * pattern lists) OR a browser may hold it (a file a snapshot listed before
 * the layer reported it). Anything else was never visible: scratch files
 * created and removed faster than write stability once sent one delete frame
 * each (300 for a 50 ms burst) and filled the replay buffer.
 */
const browserPaths = new Map<string, Set<string>>();

function browserPathsFor(workspace: string): Set<string> {
  const key = resolve(workspace);
  let paths = browserPaths.get(key);
  if (!paths) {
    paths = new Set();
    browserPaths.set(key, paths);
  }
  return paths;
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
 * Compile the ignore globs into a predicate over absolute paths.
 *
 * chokidar v4+ removed glob support: a string entry in `ignored` is compared
 * with STRICT EQUALITY (chokidar's `createPattern`), so passing the glob
 * strings above straight through silently matched nothing — every "ignored"
 * path was watched and broadcast. This is what let a session's own
 * `.pneuma/thumbnail.png` writes loop back as image `content_update`s and
 * reload every slide iframe (the intermittent viewer flicker). We compile the
 * globs ourselves (Bun.Glob) and hand the watcher layer a function matcher,
 * which it applies on every backend (and chokidar uses to prune).
 *
 * Matching is against workspace-RELATIVE paths. This matters for the
 * project-session topology, where the workspace path itself contains
 * `.pneuma/` (`<project>/.pneuma/sessions/<id>/`) — matching absolute paths
 * against `**\/.pneuma/**` would ignore the entire workspace. Relative
 * matching also makes bare patterns (no `**` prefix) root-anchored for free.
 *
 * Topology-derived state exclusion, mirroring shadow-git's exclude rules:
 * - stateDir nested in workspace (quick session `<ws>/.pneuma/`) → ignore
 *   that subtree.
 * - stateDir === workspace (project session) → ignore the root-anchored
 *   plumbing files (PROJECT_ROOT_STATE_IGNORE); content subdirs stay watched.
 */
export function buildIgnoreMatcher(
  workspace: string,
  viewerConfig: ViewerConfig,
  stateDir?: string,
): (absPath: string) => boolean {
  const ignoredRel = compileIgnore(workspace, viewerConfig, stateDir);
  return (absPath: string) => ignoredRel(relative(workspace, absPath).replaceAll("\\", "/"));
}

/** The same rules over workspace-relative, '/'-separated paths (the watcher layer's form). */
function compileIgnore(
  workspace: string,
  viewerConfig: ViewerConfig,
  stateDir?: string,
): (rel: string) => boolean {
  const patterns = [
    ...DEFAULT_IGNORE,
    ...(viewerConfig.ignorePatterns || []).map((p) =>
      p.includes("/") && !p.startsWith("**/") && !p.startsWith("/") ? `**/${p}` : p,
    ),
  ];

  if (stateDir) {
    const relState = relative(resolve(workspace), resolve(stateDir)).replaceAll("\\", "/");
    if (relState === "") {
      patterns.push(...PROJECT_ROOT_STATE_IGNORE);
    } else if (!relState.startsWith("..")) {
      patterns.push(relState, `${relState}/**`);
    }
  }

  // For every `x/**` pattern also match the bare dir `x`, so a pruning backend
  // never descends into it (shadow.git object stores and node_modules are
  // large) and the native backend drops everything below it.
  const globs = patterns
    .flatMap((p) => (p.endsWith("/**") ? [p, p.slice(0, -3)] : [p]))
    .map((p) => new Bun.Glob(p));

  return (rel: string) => {
    if (rel === "" || rel.startsWith("..")) return false;
    return globs.some((g) => g.match(rel));
  };
}

/**
 * Extract file extensions from simple glob patterns (e.g., "**\/*.md" → ".md").
 * Returns null if patterns are too complex to extract extensions from.
 */
export function extractWatchExtensions(patterns: string[]): Set<string> | null {
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
export function matchesWatchPatterns(relPath: string, watchExtensions: Set<string> | null): boolean {
  if (!watchExtensions) return true; // No extension filter → watch everything
  const lastDot = relPath.lastIndexOf(".");
  if (lastDot === -1) return false;
  return watchExtensions.has(relPath.slice(lastDot).toLowerCase());
}

/**
 * The cold-start snapshot (`GET /api/files`): every file the mode's
 * `watchPatterns` match, with its text (a binary match is listed by path with
 * empty content — see `server/workspace-text.ts`). The paths it returns are
 * recorded as held by a browser, so their deletes are sent.
 */
export function readFileSnapshot(
  workspace: string,
  watchPatterns: string[] | undefined,
): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const seen = new Set<string>();
  const patterns = watchPatterns || ["**/*.md"];
  try {
    for (const pattern of patterns) {
      // Bun.Glob hides dot-directories by default. Enable `dot` ONLY for a
      // pattern the manifest author made dot-intentional (a segment starting
      // with "."), so an explicitly-declared state file like
      // `.pneuma/cross-family.json` is served on cold start (without it the
      // json-file source reading it never hydrates), while ordinary patterns
      // keep excluding dotfiles — no cross-mode regression.
      const dot = pattern.split("/").some((seg) => seg.startsWith("."));
      const entries = new Bun.Glob(pattern).scanSync({ cwd: workspace, absolute: false, dot });
      for (const rawPath of entries) {
        // Normalize to forward slashes (Bun.Glob returns backslashes on Windows)
        const relPath = rawPath.replaceAll("\\", "/");
        // Skip config files
        if (relPath === "CLAUDE.md" || relPath.startsWith(".claude/")) continue;
        // Skip duplicates (patterns may overlap)
        if (seen.has(relPath)) continue;
        seen.add(relPath);
        const absPath = join(workspace, relPath);
        // Bun.Glob does not follow symlinks today; the snapshot must not
        // depend on that to keep outside files out of the browser.
        if (!isContained(absPath, workspace)) continue;
        try {
          // A binary match is listed by path with empty content — its
          // bytes are served by /content/* (see server/workspace-text.ts).
          const content = readWorkspaceText(absPath) ?? "";
          files.push({ path: relPath, content });
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // glob failed
  }
  const served = browserPathsFor(workspace);
  for (const file of files) served.add(file.path);
  return files;
}

/** The workspace-root file whose changes hot-reload the proxy config. */
export const PROXY_CONFIG_FILE = "proxy.json";

/**
 * The one workspace watcher a session shares: content updates
 * (`startFileWatcher`) and proxy hot-reload (`startProxyWatcher`) both
 * subscribe to it, so the process holds one watch for the workspace root.
 * `bin/pneuma.ts` creates it before `startServer` and closes it on shutdown.
 *
 * Its ignore is the content ignore (see `buildIgnoreMatcher`) except that
 * `proxy.json` at the root is always watched; `startFileWatcher` re-applies
 * the full ignore to what it reports, so a mode that ignores `*.json` still
 * never sees proxy.json as content.
 */
export function createSessionWatcher(
  workspace: string,
  viewerConfig: ViewerConfig,
  options: { stateDir?: string; backend?: WatcherBackendKind | WatchBackend } = {},
): WorkspaceWatcher {
  const ignored = compileIgnore(workspace, viewerConfig, options.stateDir);
  return createWorkspaceWatcher({
    root: resolve(workspace),
    ignore: (rel) => rel !== PROXY_CONFIG_FILE && ignored(rel),
    backend: options.backend,
  });
}

export interface FileWatcherHandle {
  /** Resolves once the underlying workspace watcher is ready. */
  readonly ready: Promise<void>;
  /** Stop reporting. Closes the workspace watcher only if this call created it. */
  close(): Promise<void>;
}

export function startFileWatcher(
  workspace: string,
  viewerConfig: ViewerConfig,
  onUpdate: (files: FileUpdate[]) => void,
  options?: {
    stateDir?: string;
    /** A shared session watcher (`createSessionWatcher`); one is created and owned when absent. */
    watcher?: WorkspaceWatcher;
    backend?: WatcherBackendKind;
  },
): FileWatcherHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingChanges = new Set<string>();

  // Derive watch extensions from ViewerConfig patterns
  const watchExtensions = extractWatchExtensions(viewerConfig.watchPatterns);

  // Default + mode-specific + topology-derived ignore globs, compiled to a
  // function matcher (see buildIgnoreMatcher). The watcher applies the same
  // rules minus the proxy.json exemption; they are re-applied here.
  const ignoredRel = compileIgnore(workspace, viewerConfig, options?.stateDir);

  const watcher = options?.watcher
    ?? createSessionWatcher(workspace, viewerConfig, { stateDir: options?.stateDir, backend: options?.backend });
  const ownsWatcher = !options?.watcher;

  const held = browserPathsFor(workspace);
  const send = (files: FileUpdate[]) => {
    for (const file of files) {
      if (file.deleted) held.delete(file.path);
      else held.add(file.path);
    }
    onUpdate(files);
  };

  const flush = () => {
    const files: FileUpdate[] = [];
    for (const relPath of pendingChanges) {
      const absPath = join(workspace, relPath);
      // Backends do not follow symlinks, but a link entry itself is reported
      // and check-then-use is not atomic. A file resolving outside the
      // workspace is never read, and nothing about it is sent (see
      // `scheduleFlush`).
      if (!isContained(absPath, workspace)) continue;
      if (existsSync(absPath)) {
        try {
          const text = readWorkspaceText(absPath);
          if (text === null) {
            // A watched binary (a `**/*.woff2` font, a video under a
            // directory glob) is a change signal only, like the image branch
            // below: the browser refetches the bytes from /content/*. Viewer
            // self-writes are text, so a binary is never a "self" echo.
            files.push({ path: relPath, content: "", origin: "external" });
            continue;
          }
          const origin: "self" | "external" = consumeSelfWrite(relPath, text)
            ? "self"
            : "external";
          files.push({ path: relPath, content: text, origin });
        } catch {
          // skip unreadable files
        }
      }
    }
    pendingChanges.clear();

    if (files.length > 0) {
      send(files);
    }
  };

  const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

  // Called once a file is stable (the layer's 200 ms write-stability check).
  const scheduleFlush = (relPath: string) => {
    const absPath = join(workspace, relPath);

    // A path reached through a symlink to outside the workspace is ignored
    // outright: no content, and no path-only image notification either.
    if (!isContained(absPath, workspace)) return;

    // Image changes: notify browser to bust cache (don't read content)
    const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      // Images are never self-writes from a viewer (data URLs bypass the
      // registerSelfWrite path per the plan), so hard-code "external".
      send([{ path: relPath, content: "", origin: "external" }]);
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

  const handleUnlink = (relPath: string, known: boolean) => {
    const absPath = join(workspace, relPath);
    // The file is gone, so this judges its parent chain: a delete beneath a
    // link to outside is not reported.
    if (!isContained(absPath, workspace)) return;

    // Apply the same watch-pattern + image filter as add/change, so deletes
    // of ignored file types don't leak out. Images fall through the pattern
    // filter (their extensions aren't in watchExtensions) but we still want
    // to emit delete events for them, so check IMAGE_EXTS first.
    const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
    const isImage = IMAGE_EXTS.has(ext);
    if (!isImage && !matchesWatchPatterns(relPath, watchExtensions)) return;

    const origin: "self" | "external" = consumeSelfDelete(relPath) ? "self" : "external";
    // Only a path the layer knew or a browser may hold (see `browserPaths`).
    if (!known && !held.has(relPath)) return;
    // Emit immediately — the file is gone, so we can't route through the
    // readFileSync-backed debounce flush. This mirrors the image branch.
    send([{ path: relPath, content: "", origin, deleted: true }]);
  };

  // Backend errors (EACCES during traversal, …) are logged by the layer and
  // surface as `degraded` in GET /api/session; the watcher continues.
  const unsubscribe = watcher.subscribe(
    (rel) => !ignoredRel(rel),
    (event) => (event.kind === "deleted" ? handleUnlink(event.rel, event.known) : scheduleFlush(event.rel)),
  );

  const patternDesc = viewerConfig.watchPatterns.join(", ");
  console.log(`[file-watcher] Watching ${workspace} for ${patternDesc} changes`);
  return {
    ready: watcher.ready,
    close: async () => {
      unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      pendingChanges.clear();
      if (ownsWatcher) await watcher.close();
    },
  };
}

/**
 * Hot-reload `proxy.json` at the workspace root from the session watcher,
 * including a file created after start: a change parses and reloads, a
 * delete clears the workspace proxy config. Returns the unsubscribe function.
 */
export function startProxyWatcher(
  watcher: WorkspaceWatcher,
  onUpdate: (config: Record<string, unknown> | null) => void,
): () => void {
  const proxyPath = join(watcher.root, PROXY_CONFIG_FILE);

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

  return watcher.subscribe((rel) => rel === PROXY_CONFIG_FILE, reload);
}
