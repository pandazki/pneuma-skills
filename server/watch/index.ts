/**
 * Workspace watcher layer: one watch per root, one event model for every
 * backend.
 *
 * Backends (`native.ts`, `chokidar.ts`) only report "something happened at
 * rel". This layer owns everything that must not differ between them:
 *
 * - **Ignore**, applied to every notice on every backend and to every
 *   ancestor directory of it (cached), so a native watch — which cannot prune —
 *   drops exactly what chokidar never traverses.
 * - **Classification by `lstat`**, not by event type: gone → `deleted` at once
 *   (deletes are never debounced); a directory → reconcile its subtree; a file
 *   → stability tracking. On case-insensitive volumes (macOS, Windows) a path
 *   exists only under its on-disk spelling: after `page.md` → `Page.md`,
 *   `lstat("page.md")` still succeeds, and the old spelling must be reported
 *   deleted rather than kept as a second live file.
 * - **Write stability** (was chokidar's `awaitWriteFinish`): a file is `stable`
 *   once two stats `STABLE_MS` apart agree on inode, size and mtime, polled
 *   every `STABLE_POLL_MS`. Rename-over passes on the first check; a chunked
 *   write keeps re-arming.
 * - **An index of known files**, taken synchronously when the watcher is
 *   created (one pruned walk) and reconciled once the backend is ready. No
 *   reader in this process can see the tree between the two, so a change made
 *   after `createWorkspaceWatcher()` returns is reported even when the backend
 *   missed it while registering (chokidar's `ignoreInitial`). A recursive
 *   native watch reports a directory renamed into or out of the tree as ONE
 *   event and never lists its children; the index turns that into per-file
 *   `stable` / `deleted`, and makes every rescan exact (only new, changed or
 *   vanished files are reported).
 * - **Overflow → rescan** (Linux IN_Q_OVERFLOW, Windows buffer overflow).
 * - **One FSEventStream per process (macOS)**: Bun rebuilds it from "now" on
 *   every `fs.watch` add or close, dropping events in the gap. Every backend
 *   registration or close in this layer (the process's only `fs.watch` user)
 *   makes every other live watcher reconcile once the rebuild has settled.
 * - **Fallback**: a backend that cannot register the root, or that reports a
 *   watch-resource limit (ENOSPC/EMFILE/ENFILE: partial coverage), is replaced
 *   by chokidar, with one warning naming the cause.
 *
 * Consumers subscribe with a path filter; each keeps its own semantics
 * (`server/file-watcher.ts` debounce/self-echo/containment,
 * `server/projects-cache.ts` rescans).
 */

import { lstatSync, readdirSync, realpathSync, statSync, type Dirent, type Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  parseWatcherBackendKind,
  type WatcherBackendKind,
  type WatcherHealth,
} from "../../core/types/workspace-watcher.js";
import { chokidarBackend } from "./chokidar.js";
import { nativeBackend } from "./native.js";
import type { WatchBackend, WatchBackendHandle, WatchIgnore, WatchSink } from "./types.js";

export type { WatchBackend, WatchIgnore } from "./types.js";

/** A file is stable once unchanged for this long (chokidar's former stabilityThreshold). */
export const STABLE_MS = 200;
/** Stability poll interval (chokidar's former pollInterval). */
export const STABLE_POLL_MS = 50;

const BACKENDS: Record<WatcherBackendKind, WatchBackend> = {
  native: nativeBackend,
  chokidar: chokidarBackend,
};

/** Errors that mean "this backend cannot cover the whole root": fall back. */
const RESOURCE_LIMIT_CODES = new Set(["ENOSPC", "EMFILE", "ENFILE"]);
const DIR_IGNORE_CACHE_MAX = 20_000;
const RECENTLY_DELETED_MAX = 10_000;
/**
 * Bun on macOS serves every `fs.watch` in the process from one FSEventStream
 * and rebuilds it (from "now") on each add or close.
 */
const SHARED_EVENT_STREAM = process.platform === "darwin";
/** Wait after the last registration change before reconciling (the rebuild's gap measured 20-40 ms at 1,200 paths). */
const REGISTRATION_SETTLE_MS = 100;
const MAX_REPORTED_PATHS = 100;

export type WatchEvent =
  /** Exists and has been unchanged for `STABLE_MS`. */
  | { kind: "stable"; rel: string; size: number; mtimeMs: number }
  /**
   * `rel` does not exist now (deleted, or moved out of the root). Sent for
   * every vanished non-ignored path — including one the layer never saw
   * stable, since a consumer may know it from its own disk read — once until
   * the path exists again. Consumers treat it idempotently. A directory
   * the layer knew is reported as one `deleted` per file it held.
   *
   * `known`: the layer knew the path — it was in the index taken at creation
   * or was reported `stable` since. False for a file that vanished before it
   * was stable (a scratch file); a consumer that only acts on what it could
   * have been told can skip those, one that reads the disk itself cannot.
   */
  | { kind: "deleted"; rel: string; known: boolean };

export interface WorkspaceWatcher {
  /** The watched root (absolute). */
  readonly root: string;
  /** Backend currently delivering events (changes on fallback). */
  readonly kind: WatcherBackendKind;
  /**
   * Resolves once the backend is registered and the index (taken when the
   * watcher was created) has been reconciled after it. Changes made after
   * creation are reported whether they happen before or after `ready`.
   */
  readonly ready: Promise<void>;
  /**
   * Receive events whose root-relative path passes `filter`. Returns the
   * unsubscribe function. A throwing handler is logged and isolated.
   */
  subscribe(filter: (rel: string) => boolean, handler: (event: WatchEvent) => void): () => void;
  health(): WatcherHealth;
  close(): Promise<void>;
}

export interface CreateWorkspaceWatcherOptions {
  /** Absolute path of an existing directory. */
  root: string;
  ignore: WatchIgnore;
  /**
   * Backend kind, or a backend implementation (the contract suite injects
   * lossy or failing ones). Default: `resolveWatcherBackend()`.
   */
  backend?: WatcherBackendKind | WatchBackend;
}

export interface WatcherSelection {
  kind: WatcherBackendKind;
  source: "env" | "default";
  /** An unrecognized `PNEUMA_WATCHER` value that was ignored. */
  invalid?: string;
}

/**
 * The backend this process uses: `PNEUMA_WATCHER` when it names one, else the
 * platform default — native on macOS (chokidar's per-path watches lose events
 * there under Bun), chokidar on Linux (prunes before traversal) and Windows
 * (per-directory buffers; native would funnel the whole tree through one).
 */
export function resolveWatcherBackend(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): WatcherSelection {
  const platformDefault: WatcherBackendKind = platform === "darwin" ? "native" : "chokidar";
  const raw = env.PNEUMA_WATCHER;
  if (raw === undefined || raw.trim() === "") return { kind: platformDefault, source: "default" };
  const parsed = parseWatcherBackendKind(raw);
  if (parsed) return { kind: parsed, source: "env" };
  return { kind: platformDefault, source: "default", invalid: raw };
}

export function createWorkspaceWatcher(opts: CreateWorkspaceWatcherOptions): WorkspaceWatcher {
  let stats: Stats;
  try {
    stats = statSync(opts.root);
  } catch (err) {
    throw new Error(`[watcher] cannot watch ${opts.root}: ${describeError(err)}`);
  }
  if (!stats.isDirectory()) throw new Error(`[watcher] cannot watch ${opts.root}: not a directory`);
  return new LayerWatcher(opts);
}

// ── Implementation ──────────────────────────────────────────────────────────

interface Signature {
  ino: number;
  size: number;
  mtimeMs: number;
}

interface Subscriber {
  filter: (rel: string) => boolean;
  handler: (event: WatchEvent) => void;
}

const signatureOf = (s: Stats): Signature => ({ ino: s.ino, size: s.size, mtimeMs: s.mtimeMs });
const sameSignature = (a: Signature, b: Signature) =>
  a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

function isGone(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Every open watcher in this process (for the shared-stream reconcile). */
const liveWatchers = new Set<LayerWatcher>();

/**
 * `source` registered or closed a backend. On macOS that rebuilt the shared
 * FSEventStream, so every other live watcher reconciles after it settles.
 */
function registrationChanged(source: LayerWatcher): void {
  if (!SHARED_EVENT_STREAM) return;
  for (const watcher of liveWatchers) if (watcher !== source) watcher.afterForeignRegistration();
}

/** Platforms whose default volumes (APFS, NTFS) are case-insensitive. */
const CASE_INSENSITIVE_PLATFORM = process.platform === "darwin" || process.platform === "win32";

function sameName(a: string, b: string): boolean {
  return a.normalize("NFC") === b.normalize("NFC");
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as NodeJS.ErrnoException).code;
  return code && !err.message.includes(code) ? `${code}: ${err.message}` : err.message;
}

/** Root-relative, '/'-separated; "" is the root; null for anything outside it. */
function normalizeRel(raw: string): string | null {
  let rel = raw.replaceAll("\\", "/");
  while (rel.startsWith("./")) rel = rel.slice(2);
  while (rel.endsWith("/")) rel = rel.slice(0, -1);
  if (rel === ".") return "";
  if (rel.startsWith("/") || rel.split("/").includes("..")) return null;
  return rel;
}

class LayerWatcher implements WorkspaceWatcher {
  readonly root: string;
  readonly ready: Promise<void>;

  private readonly ignore: WatchIgnore;
  private backend: WatchBackendHandle;
  /** Bumped when the backend is replaced, so a retired backend's late events are dropped. */
  private generation = 0;
  private fellBack = false;
  private errored = false;
  private isReady = false;
  private closed = false;
  private lastEventAt: number | null = null;

  /** Every non-ignored file (or symlink) under the root, as last seen. */
  private readonly index = new Map<string, Signature>();
  /** Directories seen by a walk or above a reported file — a vanished one has files to report. */
  private readonly dirs = new Set<string>();
  /** Files waiting to be stable. */
  private readonly pending = new Map<string, { sig: Signature; since: number }>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** A reconcile after another watch's registration or close (macOS), pending the rebuild. */
  private registrationTimer: ReturnType<typeof setTimeout> | null = null;
  private rescanning: Promise<void> | null = null;
  private rescanAgain = false;
  /** Paths reported deleted and not seen since (dedupes repeated notices). */
  private readonly recentlyDeleted = new Set<string>();
  private readonly dirIgnore = new Map<string, boolean>();
  private readonly reported = new Set<string>();
  private readonly subscribers = new Set<Subscriber>();
  /** The root's on-disk path, for exact-case checks (resolved on first use). */
  private rootReal: string | null = null;

  constructor(opts: CreateWorkspaceWatcherOptions) {
    this.root = opts.root;
    this.ignore = opts.ignore;
    const selected = opts.backend ?? resolveWatcherBackend().kind;
    this.backend = this.start(selected);
    // The index, synchronously: nothing in this process reads the tree
    // before it exists, and `boot()` reconciles it once the backend is up.
    try {
      this.walkSync("", (rel, sig) => this.index.set(rel, sig));
    } catch (err) {
      this.closed = true;
      void this.backend.close().catch(() => {});
      throw err;
    }
    liveWatchers.add(this);
    registrationChanged(this);
    this.ready = this.boot();
  }

  get kind(): WatcherBackendKind {
    return this.backend.kind;
  }

  subscribe(filter: (rel: string) => boolean, handler: (event: WatchEvent) => void): () => void {
    const subscriber: Subscriber = { filter, handler };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  health(): WatcherHealth {
    return {
      backend: this.backend.kind,
      ready: this.isReady,
      degraded: this.fellBack || this.errored,
      lastEventAt: this.lastEventAt,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    liveWatchers.delete(this);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.registrationTimer) clearTimeout(this.registrationTimer);
    this.registrationTimer = null;
    this.pending.clear();
    this.subscribers.clear();
    try {
      await this.backend.close();
    } finally {
      registrationChanged(this);
    }
  }

  /**
   * Another watch in this process was registered or closed: on macOS the
   * shared FSEventStream was rebuilt and may have dropped this watcher's
   * events. Reconcile once the rebuild has settled (bursts coalesce).
   */
  afterForeignRegistration(): void {
    if (this.closed) return;
    if (this.registrationTimer) clearTimeout(this.registrationTimer);
    this.registrationTimer = setTimeout(() => {
      this.registrationTimer = null;
      void this.rescan();
    }, REGISTRATION_SETTLE_MS);
  }

  // ── Backend lifecycle ─────────────────────────────────────────────────────

  private sinkFor(generation: number): WatchSink {
    return {
      notice: (rel) => {
        if (generation === this.generation) this.onNotice(rel);
      },
      overflow: () => {
        if (generation === this.generation) this.onOverflow();
      },
      error: (err) => {
        if (generation === this.generation) this.onError(err);
      },
    };
  }

  private start(selected: WatcherBackendKind | WatchBackend): WatchBackendHandle {
    const primary = typeof selected === "function" ? selected : BACKENDS[selected];
    try {
      return primary({ root: this.root, ignore: this.ignore }, this.sinkFor(this.generation));
    } catch (err) {
      if (primary === chokidarBackend) throw err;
      const label = typeof selected === "string" ? selected : "selected";
      console.warn(
        `[watcher] ${label} backend could not watch ${this.root} (${describeError(err)}); falling back to chokidar`,
      );
      this.fellBack = true;
      this.generation++;
      return chokidarBackend({ root: this.root, ignore: this.ignore }, this.sinkFor(this.generation));
    }
  }

  /**
   * Ready = the current backend is listening and the index has been
   * reconciled after that. Until a backend is ready it may miss changes
   * (chokidar reports nothing it finds while registering; a fallback swaps
   * backends mid-way), and the index taken at creation is what makes those
   * changes visible to the reconcile.
   */
  private async boot(): Promise<void> {
    for (;;) {
      const current = await this.settledBackend();
      if (this.closed) return;
      // chokidar registers path by path until ready, each an `fs.watch` add.
      if (current.kind === "chokidar") registrationChanged(this);
      await this.rescan();
      if (this.closed) return;
      if (current === this.backend) break;
    }
    this.isReady = true;
  }

  /** Wait for the current backend's `ready`, following fallbacks that replace it meanwhile. */
  private async settledBackend(): Promise<WatchBackendHandle> {
    for (;;) {
      const current = this.backend;
      try {
        await current.ready;
      } catch (err) {
        this.onError(err as NodeJS.ErrnoException);
      }
      if (this.closed || current === this.backend) return current;
    }
  }

  private onError(err: NodeJS.ErrnoException): void {
    if (this.closed) return;
    if (this.backend.kind !== "chokidar" && !this.fellBack && RESOURCE_LIMIT_CODES.has(err?.code ?? "")) {
      void this.fallBack(err);
      return;
    }
    this.errored = true;
    console.warn(`[watcher] ${this.backend.kind} backend error under ${this.root}: ${describeError(err)}`);
  }

  private async fallBack(err: NodeJS.ErrnoException): Promise<void> {
    this.fellBack = true;
    console.warn(
      `[watcher] ${this.backend.kind} backend lost coverage of ${this.root} (${describeError(err)}); falling back to chokidar`,
    );
    const previous = this.backend;
    this.generation++;
    try {
      this.backend = chokidarBackend({ root: this.root, ignore: this.ignore }, this.sinkFor(this.generation));
    } catch (fallbackErr) {
      this.errored = true;
      console.warn(`[watcher] chokidar fallback failed for ${this.root}: ${describeError(fallbackErr)}`);
    }
    await previous.close().catch((closeErr) => {
      console.warn(`[watcher] closing the ${previous.kind} backend failed: ${describeError(closeErr)}`);
    });
    registrationChanged(this);
    // Before ready, boot() waits for the new backend and reconciles after it.
    // After ready, whatever changed during the switch is recovered by a
    // rescan once the replacement is listening.
    if (this.isReady) {
      await this.backend.ready;
      if (this.closed) return;
      registrationChanged(this);
      this.requestRescan("the backend was replaced");
    }
  }

  // ── Notices ───────────────────────────────────────────────────────────────

  private onNotice(raw: string): void {
    if (this.closed) return;
    const rel = normalizeRel(raw);
    if (rel === null) return;
    if (rel !== "" && this.isIgnored(rel, undefined)) return;
    this.lastEventAt = Date.now();
    this.classify(rel);
  }

  private onOverflow(): void {
    if (this.closed) return;
    this.lastEventAt = Date.now();
    this.requestRescan(`the ${this.backend.kind} backend reported lost events`);
  }

  /** Ignored itself, or below an ignored directory. */
  private isIgnored(rel: string, isDir: boolean | undefined): boolean {
    const slash = rel.lastIndexOf("/");
    if (slash > 0 && this.isIgnoredDir(rel.slice(0, slash))) return true;
    return this.ignore(rel, isDir);
  }

  private isIgnoredDir(rel: string): boolean {
    let ignored = this.dirIgnore.get(rel);
    if (ignored === undefined) {
      ignored = this.isIgnored(rel, true);
      if (this.dirIgnore.size >= DIR_IGNORE_CACHE_MAX) this.dirIgnore.clear();
      this.dirIgnore.set(rel, ignored);
    }
    return ignored;
  }

  private classify(rel: string): void {
    if (rel === "") {
      this.requestRescan();
      return;
    }
    let stats: Stats;
    try {
      stats = lstatSync(this.abs(rel));
    } catch (err) {
      if (isGone(err)) this.gone(rel);
      else this.reportUnreadable(rel, err);
      return;
    }
    if (!this.existsAsSpelled(rel, stats)) {
      this.gone(rel);
      return;
    }
    const isDir = stats.isDirectory();
    if (this.ignore(rel, isDir)) return;
    if (isDir) {
      // A file replaced by a directory.
      const wasIndexed = this.index.delete(rel);
      const wasPending = this.pending.delete(rel);
      if (wasIndexed || wasPending) this.emitDeleted(rel, wasIndexed);
      void this.reconcile(rel);
      return;
    }
    // A directory replaced by a file.
    if (this.dirs.has(rel)) this.goneBelow(rel);
    this.track(rel, signatureOf(stats));
  }

  // ── Stability ─────────────────────────────────────────────────────────────

  private track(rel: string, sig: Signature): void {
    this.recentlyDeleted.delete(rel);
    const now = performance.now();
    const entry = this.pending.get(rel);
    if (!entry) {
      this.pending.set(rel, { sig, since: now });
    } else if (!sameSignature(entry.sig, sig)) {
      entry.sig = sig;
      entry.since = now;
    }
    if (!this.pollTimer) this.pollTimer = setInterval(() => this.poll(), STABLE_POLL_MS);
  }

  private poll(): void {
    const now = performance.now();
    for (const [rel, entry] of this.pending) {
      let stats: Stats;
      try {
        stats = lstatSync(this.abs(rel));
      } catch (err) {
        if (isGone(err)) {
          this.gone(rel);
        } else {
          this.pending.delete(rel);
          this.reportUnreadable(rel, err);
        }
        continue;
      }
      if (!this.existsAsSpelled(rel, stats)) {
        this.gone(rel);
        continue;
      }
      if (stats.isDirectory()) {
        this.pending.delete(rel);
        void this.reconcile(rel);
        continue;
      }
      const sig = signatureOf(stats);
      if (!sameSignature(sig, entry.sig)) {
        entry.sig = sig;
        entry.since = now;
        continue;
      }
      if (now - entry.since < STABLE_MS) continue;
      this.pending.delete(rel);
      this.index.set(rel, sig);
      this.noteAncestors(rel);
      this.emit({ kind: "stable", rel, size: sig.size, mtimeMs: sig.mtimeMs });
    }
    if (this.pending.size === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── Deletion ──────────────────────────────────────────────────────────────

  /**
   * `rel` no longer exists. It is reported even when the layer never saw it
   * stable (or at all: created and removed inside one FSEvents batch): a
   * consumer may know it from its own disk read — the browser's
   * `GET /api/files`, a project scan — and a delete of an unknown path is a
   * no-op for it. A directory the layer knew is reported through its files.
   */
  private gone(rel: string): void {
    this.pending.delete(rel);
    const known = this.index.delete(rel);
    if (this.dirs.has(rel)) this.goneBelow(rel);
    else this.emitDeleted(rel, known);
  }

  /** `known`: `rel` was in the index (see `WatchEvent`). */
  private emitDeleted(rel: string, known: boolean): void {
    if (this.recentlyDeleted.has(rel)) return;
    if (this.recentlyDeleted.size >= RECENTLY_DELETED_MAX) this.recentlyDeleted.clear();
    this.recentlyDeleted.add(rel);
    this.emit({ kind: "deleted", rel, known });
  }

  /** `rel` was a directory and is gone (or is no longer one): report its files. */
  private goneBelow(rel: string): void {
    const prefix = `${rel}/`;
    this.dirs.delete(rel);
    for (const dir of [...this.dirs]) if (dir.startsWith(prefix)) this.dirs.delete(dir);
    const vanished = new Set<string>();
    for (const path of this.pending.keys()) if (path.startsWith(prefix)) vanished.add(path);
    for (const path of this.index.keys()) if (path.startsWith(prefix)) vanished.add(path);
    for (const path of vanished) {
      this.pending.delete(path);
      this.emitDeleted(path, this.index.delete(path));
    }
  }

  // ── Directory reconciliation (moved-in / moved-out trees, overflow) ───────

  /** A logged full rescan (overflow, backend replaced). */
  private requestRescan(reason?: string): void {
    if (reason && !this.closed) console.warn(`[watcher] rescanning ${this.root}: ${reason}`);
    void this.rescan();
  }

  /**
   * Reconcile the whole root. Rescans never overlap: a request made while
   * one runs queues exactly one more, and the returned promise settles after
   * the pass that covers the request.
   */
  private rescan(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.rescanning) {
      this.rescanAgain = true;
      return this.rescanning;
    }
    this.rescanning = (async () => {
      do {
        this.rescanAgain = false;
        await this.reconcile("");
      } while (this.rescanAgain && !this.closed);
    })().finally(() => {
      this.rescanning = null;
    });
    return this.rescanning;
  }

  /**
   * Walk `dirRel` (pruned by the ignore) and report what differs from the
   * index: new or changed files go through stability, indexed files that are
   * no longer there are reported deleted (after a fresh `lstat`, so a file
   * created after the listing is never mistaken for a vanished one). "No
   * longer there" includes an indexed file that is now a directory, and one
   * that exists only under another spelling.
   */
  private async reconcile(dirRel: string): Promise<void> {
    const found = new Map<string, Signature>();
    await this.walk(dirRel, (rel, sig) => found.set(rel, sig));
    if (this.closed) return;
    for (const [rel, sig] of found) {
      const known = this.index.get(rel);
      if (!known || !sameSignature(known, sig)) this.track(rel, sig);
    }
    const prefix = dirRel === "" ? "" : `${dirRel}/`;
    for (const rel of [...this.index.keys()]) {
      if (!rel.startsWith(prefix) || found.has(rel)) continue;
      let stats: Stats;
      try {
        stats = lstatSync(this.abs(rel));
      } catch (err) {
        if (isGone(err)) this.gone(rel);
        else this.reportUnreadable(rel, err);
        continue;
      }
      if (!stats.isDirectory() && this.existsAsSpelled(rel, stats)) continue;
      // Replaced by a directory, or renamed to another case. Not `gone()`:
      // a directory at `rel` is already in `dirs` with its new files pending.
      this.pending.delete(rel);
      this.emitDeleted(rel, this.index.delete(rel));
    }
  }

  /** The walk for the index at creation: synchronous, so no reader in this process runs before it is complete. */
  private walkSync(start: string, visit: (rel: string, sig: Signature) => void): void {
    const stack = [start];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: Dirent[];
      try {
        entries = readdirSync(this.abs(dir), { withFileTypes: true });
      } catch (err) {
        if (!isGone(err)) this.reportUnreadable(dir, err);
        continue;
      }
      for (const rel of this.admit(dir, entries, stack)) {
        let stats: Stats;
        try {
          stats = lstatSync(this.abs(rel));
        } catch (err) {
          // Vanished since the listing is expected; anything else (EACCES,
          // EIO) means the index is incomplete, and says so.
          if (!isGone(err)) this.reportUnreadable(rel, err);
          continue;
        }
        if (!stats.isDirectory()) visit(rel, signatureOf(stats));
      }
    }
  }

  /** Record `dir`, push its admitted subdirectories onto `stack`, and return its admitted files. */
  private admit(dir: string, entries: Dirent[], stack: string[]): string[] {
    if (dir !== "") this.dirs.add(dir);
    const files: string[] = [];
    for (const entry of entries) {
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
      // Symlinks are entries, never followed (`isDirectory()` is false for them).
      if (entry.isDirectory()) {
        if (!this.ignore(rel, true)) stack.push(rel);
      } else if (!this.ignore(rel, false)) {
        files.push(rel);
      }
    }
    return files;
  }

  private async walk(start: string, visit: (rel: string, sig: Signature) => void): Promise<void> {
    const stack = [start];
    while (stack.length > 0 && !this.closed) {
      const dir = stack.pop()!;
      let entries: Dirent[];
      try {
        entries = await readdir(this.abs(dir), { withFileTypes: true });
      } catch (err) {
        if (!isGone(err)) this.reportUnreadable(dir, err);
        continue;
      }
      const files = this.admit(dir, entries, stack);
      const stats = await Promise.all(
        files.map((rel) =>
          lstat(this.abs(rel)).catch((err) => {
            // Vanished since the listing is expected; anything else (EACCES,
            // EIO) means the index is incomplete, and says so.
            if (!isGone(err)) this.reportUnreadable(rel, err);
            return null;
          }),
        ),
      );
      stats.forEach((st, i) => {
        if (st && !st.isDirectory()) visit(files[i], signatureOf(st));
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private noteAncestors(rel: string): void {
    for (let slash = rel.indexOf("/"); slash > 0; slash = rel.indexOf("/", slash + 1)) {
      this.dirs.add(rel.slice(0, slash));
    }
  }

  private emit(event: WatchEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        if (subscriber.filter(event.rel)) subscriber.handler(event);
      } catch (err) {
        console.error(`[watcher] subscriber failed on ${event.rel}: ${err instanceof Error ? err.stack : err}`);
      }
    }
  }

  /**
   * Does `rel` exist under exactly this spelling? `lstat` answers "some
   * spelling of it" on a case-insensitive volume. The on-disk spelling comes
   * from `realpath` (of the parent for a symlink, which `realpath` would
   * follow, plus an exact directory listing). Compared after NFC
   * normalization: APFS and NTFS are normalization-insensitive, and a
   * normalization-only difference is not a rename this layer reports.
   */
  private existsAsSpelled(rel: string, stats: Stats): boolean {
    if (!CASE_INSENSITIVE_PLATFORM) return true;
    try {
      this.rootReal ??= realpathSync.native(this.root);
      if (!stats.isSymbolicLink()) {
        return sameName(realpathSync.native(this.abs(rel)), join(this.rootReal, rel));
      }
      const parent = dirname(rel);
      const parentAbs = parent === "." ? this.root : this.abs(parent);
      if (!sameName(realpathSync.native(parentAbs), parent === "." ? this.rootReal : join(this.rootReal, parent))) {
        return false;
      }
      const name = basename(rel).normalize("NFC");
      return readdirSync(parentAbs).some((entry) => entry.normalize("NFC") === name);
    } catch (err) {
      // Vanished between the lstat and this check: not there. Anything else
      // leaves the spelling unproven; keep the path rather than invent a delete.
      return !isGone(err);
    }
  }

  /** Permission errors during traversal: logged once per path, watcher continues. */
  private reportUnreadable(rel: string, err: unknown): void {
    this.errored = true;
    if (this.reported.has(rel) || this.reported.size >= MAX_REPORTED_PATHS) return;
    this.reported.add(rel);
    console.warn(`[watcher] cannot read ${rel || "."} under ${this.root}: ${describeError(err)}`);
  }

  private abs(rel: string): string {
    return rel === "" ? this.root : join(this.root, rel);
  }
}
