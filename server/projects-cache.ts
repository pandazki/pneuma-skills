/**
 * Server-side stale-while-revalidate (SWR) cache for project info.
 *
 * The project panel and launcher both fetch per-project session lists, which
 * boil down to `scanProjectSessions` from `core/project-loader.ts`. That scan
 * does N filesystem reads per project (session.json + history.json + stats),
 * costing ~1–2s for projects with several sessions. Re-running it on every
 * panel open is wasteful — the underlying disk state only changes when an
 * agent edits files or a new session is spawned.
 *
 * This module owns an in-memory cache keyed by absolute project root, kept
 * fresh via chokidar watchers on `<root>/.pneuma/sessions/`. Routes hand
 * off to the cache via:
 *   - `getProjectCache(root)` — synchronous Map lookup, returns the cached
 *     entry or null on miss.
 *   - `getProjectCacheSWR(root)` — returns the cached entry immediately if
 *     present (and triggers a background revalidation), otherwise does a
 *     synchronous scan and primes the cache.
 *   - `revalidateProjectCache(root)` — manual kick (e.g. after spawning a
 *     new session, before chokidar's `add` fires).
 *   - `primeProjectCache(root)` — initial scan + start watcher; idempotent.
 *
 * Failure handling:
 *   - If `scanProjectSessions` throws during a revalidation, the previous
 *     entry stays in place — better stale than blank.
 *   - Concurrent SWR reads collapse to a single in-flight scan via a
 *     `Map<root, Promise<void>>` dedupe.
 *
 * Watcher:
 *   - One chokidar watcher per project root, watching the `.pneuma/sessions/`
 *     directory at depth 2 so we catch session adds/removes AND
 *     `session.json` / `history.json` writes inside each session subdir.
 *   - `awaitWriteFinish` debounces rapid writes; the in-flight Promise
 *     dedupe re-runs once if events accumulate while a scan is running.
 *
 * NOTE: this cache is per-process. The launcher and each per-session server
 * are separate processes, so they each maintain their own cache; the disk
 * is the source of truth and chokidar keeps each cache in sync.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import {
  loadProjectManifest,
  scanProjectSessions,
  type ProjectSessionRef,
} from "../core/project-loader.js";
import type { ProjectManifest } from "../core/types/project-manifest.js";

export interface ProjectCacheEntry {
  /** Absolute project root (= cache key). */
  projectRoot: string;
  /** Manifest from `<root>/.pneuma/project.json`. Null if missing/malformed. */
  manifest: ProjectManifest | null;
  /** scanProjectSessions result — same shape as the route returns today. */
  sessions: ProjectSessionRef[];
  /** Whether `<root>/.pneuma/cover.png` exists, computed at scan time. */
  hasCover: boolean;
  /** When this entry was last refreshed (ms epoch). For debug / observability. */
  lastScanned: number;
  /** True while a revalidation is in flight; readers can ignore but useful for tests. */
  revalidating: boolean;
}

const cache = new Map<string, ProjectCacheEntry>();
const watchers = new Map<string, FSWatcher>();
const inFlight = new Map<string, Promise<void>>();
/**
 * Tracks projects where another revalidation event arrived while a scan was
 * running. The current scan re-runs once on completion — this collapses
 * watcher event bursts to at most one extra scan, no matter how many events
 * fire during the in-flight window.
 */
const pendingFollowUp = new Set<string>();

/**
 * Build a fresh cache entry by re-reading manifest + scanning sessions.
 * On scan failure, returns null so callers can decide whether to keep the
 * previous good entry.
 */
async function scanFresh(projectRoot: string): Promise<ProjectCacheEntry | null> {
  let manifest: ProjectManifest | null = null;
  try {
    manifest = await loadProjectManifest(projectRoot);
  } catch {
    manifest = null;
  }

  let sessions: ProjectSessionRef[] = [];
  try {
    sessions = await scanProjectSessions(projectRoot);
  } catch (err) {
    console.warn(`[projects-cache] scan failed for ${projectRoot}: ${err}`);
    return null;
  }

  const hasCover = existsSync(join(projectRoot, ".pneuma", "cover.png"));

  return {
    projectRoot,
    manifest,
    sessions,
    hasCover,
    lastScanned: Date.now(),
    revalidating: false,
  };
}

/**
 * Run a scan and update the cached entry. On scan failure, leave the
 * previous entry untouched (better stale than blank). Concurrent calls
 * dedupe via the `inFlight` map; if more events arrive while a scan is
 * running, exactly one follow-up scan runs after completion.
 */
function runScan(projectRoot: string): Promise<void> {
  const existing = inFlight.get(projectRoot);
  if (existing) {
    pendingFollowUp.add(projectRoot);
    return existing;
  }

  const work = (async () => {
    const start = Date.now();
    const prev = cache.get(projectRoot);
    if (prev) prev.revalidating = true;
    try {
      const fresh = await scanFresh(projectRoot);
      if (fresh) {
        cache.set(projectRoot, fresh);
        const ms = Date.now() - start;
        console.log(`[projects-cache] revalidated ${projectRoot} in ${ms}ms`);
      } else if (prev) {
        // Keep the previous entry intact — a transient scan failure
        // shouldn't blank the panel.
        prev.revalidating = false;
      }
    } finally {
      inFlight.delete(projectRoot);
      if (pendingFollowUp.delete(projectRoot)) {
        // Don't await — the caller of runScan only cares about the first
        // scan completing.
        runScan(projectRoot).catch(() => {});
      }
    }
  })();

  inFlight.set(projectRoot, work);
  return work;
}

/**
 * Synchronous read. Returns null on cache miss; the caller is responsible
 * for priming. This is the hot path for `/api/projects` (one lookup per
 * project in the registry — a Map.get() each).
 */
export function getProjectCache(projectRoot: string): ProjectCacheEntry | null {
  return cache.get(projectRoot) ?? null;
}

/**
 * Stale-while-revalidate read. If cached, returns the entry immediately and
 * triggers a background refresh. If not cached, performs a synchronous scan
 * (paying the cold-start cost), primes the cache, and returns. Either way,
 * a watcher is registered so future changes kick revalidations on their own.
 */
export async function getProjectCacheSWR(
  projectRoot: string,
): Promise<ProjectCacheEntry> {
  const hit = cache.get(projectRoot);
  if (hit) {
    // Trigger a background refresh, but don't await — the caller gets the
    // current entry instantly. This is the SWR pattern.
    runScan(projectRoot).catch(() => {});
    return hit;
  }

  // Cold path: prime the cache (which scans once + starts the watcher).
  await primeProjectCache(projectRoot);
  // After priming, the entry exists unless the scan errored — in which
  // case we synthesize an empty entry so callers don't crash on null.
  return (
    cache.get(projectRoot) ?? {
      projectRoot,
      manifest: null,
      sessions: [],
      hasCover: false,
      lastScanned: Date.now(),
      revalidating: false,
    }
  );
}

/**
 * Force an immediate revalidation. Used by `/api/launch` after spawning a
 * new session, and by handoff confirm — both write a new session subdir
 * before chokidar's `add` event has a chance to fire, so the next panel
 * fetch needs to see the new state without waiting on the watcher.
 */
export async function revalidateProjectCache(projectRoot: string): Promise<void> {
  if (!watchers.has(projectRoot)) {
    // The cache might be primed without a watcher in tests; in production
    // the watcher comes up as part of priming. Either way, run a scan.
    await primeProjectCache(projectRoot);
    return;
  }
  await runScan(projectRoot);
}

/**
 * Initial scan + watcher start. Idempotent — calling twice with the same
 * root is a no-op for the watcher and just re-runs the scan.
 */
export async function primeProjectCache(projectRoot: string): Promise<void> {
  // Always run a scan (so the cache is populated by the time we return),
  // but only register one watcher per project root.
  if (!watchers.has(projectRoot)) {
    const sessionsDir = join(projectRoot, ".pneuma", "sessions");
    // chokidar tolerates a missing directory by waiting for it to appear,
    // but we still want to bound the watch depth so we don't spin up
    // recursive watchers for every nested file. Depth 2 covers:
    //   - sessions/<id>/                (add/remove session dirs)
    //   - sessions/<id>/{session.json,history.json,thumbnail.png}
    // which is exactly what `scanProjectSessions` reads.
    const watcher = watch(sessionsDir, {
      depth: 2,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
      // Common noise we definitely don't want to revalidate on.
      ignored: [/\.DS_Store$/, /\.tmp$/, /\.swp$/],
    });

    const trigger = () => {
      runScan(projectRoot).catch((err) => {
        console.warn(`[projects-cache] watcher trigger failed: ${err}`);
      });
    };
    watcher.on("add", trigger);
    watcher.on("addDir", trigger);
    watcher.on("change", trigger);
    watcher.on("unlink", trigger);
    watcher.on("unlinkDir", trigger);
    watcher.on("error", (err) => {
      console.warn(`[projects-cache] watcher error for ${projectRoot}: ${err}`);
    });

    watchers.set(projectRoot, watcher);
  }

  await runScan(projectRoot);
}

/**
 * Drop a cached entry and tear down its watcher. For tests; also called
 * when a project is deleted from disk.
 */
export async function evictProjectCache(projectRoot: string): Promise<void> {
  const watcher = watchers.get(projectRoot);
  if (watcher) {
    try {
      await watcher.close();
    } catch (err) {
      console.warn(`[projects-cache] failed to close watcher for ${projectRoot}: ${err}`);
    }
    watchers.delete(projectRoot);
  }
  cache.delete(projectRoot);
  inFlight.delete(projectRoot);
  pendingFollowUp.delete(projectRoot);
}

/**
 * Tear down all watchers + clear the cache. For server shutdown so chokidar
 * watchers don't leak across `bun run dev` restarts.
 */
export async function shutdownProjectCache(): Promise<void> {
  const closes: Promise<void>[] = [];
  for (const watcher of watchers.values()) {
    closes.push(
      watcher.close().catch((err) => {
        console.warn(`[projects-cache] shutdown close failed: ${err}`);
      }),
    );
  }
  await Promise.all(closes);
  watchers.clear();
  cache.clear();
  inFlight.clear();
  pendingFollowUp.clear();
}
