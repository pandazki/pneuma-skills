/**
 * Source<T> — the typed data channel between the runtime and a mode viewer.
 *
 * Reads flow through subscribe() events tagged with origin. Writes flow
 * through write(), which providers serialize internally. The provider base
 * class (core/sources/base.ts) enforces the invariants documented on the
 * interfaces below; individual providers only fill in how to load and how
 * to persist.
 *
 * This file is pure types — no runtime code, no imports except type-only.
 */

import type { ViewerFileContent } from "./viewer-contract.js";

// ────────────────────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single event emitted by a Source.
 *
 * Subscribers handle events via the discriminant `kind`. All non-error events
 * carry an `origin` tag that identifies what caused the event:
 *
 *   - "initial"  — the first value this source instance observes from its
 *                  underlying medium. Fires exactly once per source instance,
 *                  only after the provider has finished its initial load.
 *                  Late subscribers miss this event; they should read
 *                  `current()` for the starting value.
 *
 *   - "self"     — the value was committed by a call to `write()` on this
 *                  same source instance. The write()'s returned Promise
 *                  resolves only after this event has been delivered to all
 *                  current subscribers and `current()` reflects the new
 *                  value. A viewer that `await`s its own write() is
 *                  guaranteed to see its own committed state on the next
 *                  render without holding optimistic local state.
 *
 *   - "external" — the value was committed by someone other than this source
 *                  instance. For file-backed sources this means the agent's
 *                  Edit tool, another viewer tab, or any non-self writer.
 *                  Viewers that want conflict handling inspect this origin.
 *
 * Errors (parse failure, write failure, network drop, etc.) emit a separate
 * `error` event. Errors are non-fatal: the source remains live and subsequent
 * events still flow.
 */
export type SourceEvent<T> =
  | { kind: "value"; value: T; origin: "initial" | "self" | "external" }
  | { kind: "error"; code: string; message: string; raw?: unknown };

// ────────────────────────────────────────────────────────────────────────────
// Source
// ────────────────────────────────────────────────────────────────────────────

/**
 * A typed data channel. Instances are created by a SourceProvider and handed
 * to a viewer via ViewerPreviewProps.sources.
 *
 * ## Invariants (enforced by core/sources/base.ts)
 *
 * 1. **Single writer.** `write()` is the only way to mutate the source's
 *    committed state. Concurrent calls to write() are serialized internally
 *    via a Promise queue — they run in call order, never in parallel.
 *
 * 2. **Change-read-via-subscription.** All state changes — including those
 *    caused by this source's own write() — reach consumers as subscribe()
 *    events. Viewers do not maintain optimistic local state; they render
 *    from the latest delivered value event. `current()` is a synchronous
 *    accessor that always returns the most recently delivered value.
 *
 * 3. **Time-locked write Promises.** `await source.write(v)` resolves only
 *    after the corresponding `{ kind: "value", value: v, origin: "self" }`
 *    event has been delivered to all current subscribers and `current()`
 *    reflects v. After the await, the viewer's state is guaranteed
 *    consistent with the committed value.
 *
 * 4. **Origin-tagged events.** Every value event carries origin. Self-writes
 *    are NOT silently absorbed; they emit a `value` event with origin="self".
 *    This lets viewers distinguish "my commit landed" from "someone else
 *    changed the world" without maintaining shadow refs.
 *
 * 5. **Non-fatal errors.** Parse failures, write failures, and transport
 *    errors emit `{ kind: "error" }` events. The source stays live; a later
 *    successful read or write still delivers a value event.
 *
 * 6. **Idempotent destroy.** `destroy()` is safe to call multiple times.
 *    After destroy, write() resolves without effect, subscribe() returns a
 *    no-op unsubscribe, current() returns null.
 */
export interface Source<T> {
  /**
   * The most recently delivered value, or null if the source has not yet
   * emitted its initial event. Synchronous — safe to call during render.
   */
  current(): T | null;

  /**
   * Register a listener for future events. Does NOT fire a synthetic initial
   * event on subscribe — use current() for first-render state, then rely on
   * subscribe() for subsequent updates. Returns an unsubscribe function.
   */
  subscribe(listener: (event: SourceEvent<T>) => void): () => void;

  /**
   * Commit a new value. Writes are serialized: a later write() call waits
   * for all earlier writes to settle before running. Resolves after the
   * provider has persisted the value AND delivered the corresponding
   * { origin: "self" } event to all current subscribers. Rejects if the
   * provider cannot persist.
   */
  write(value: T): Promise<void>;

  /**
   * Release resources held by this source. Idempotent. After destroy,
   * write() is a silent no-op that resolves immediately, subscribe()
   * returns a no-op unsubscribe, current() returns null.
   */
  destroy(): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Providers
// ────────────────────────────────────────────────────────────────────────────

/**
 * A SourceProvider is a factory that creates Source instances of a specific
 * kind. Built-in providers live in core/sources/ and are registered with the
 * runtime's SourceRegistry at startup. Third-party providers are exported
 * from plugins via PluginManifest.sources.
 *
 * The provider owns the schema of its `config` — the runtime passes config
 * through unchanged. Providers are free to define config as a TypeScript
 * object with function fields (e.g., parse/serialize callbacks) because
 * manifest.ts is loaded as a real TS module, not parsed as JSON.
 */
export interface SourceProvider {
  /** The discriminant that manifest.sources entries use to select this provider. */
  kind: string;

  /**
   * Instantiate a new source. The runtime calls this once per declared
   * manifest.sources entry when activating a mode. The returned Source
   * should be ready to receive subscribe() calls immediately, even if its
   * initial value has not yet loaded (in which case current() returns null
   * until the initial event fires).
   */
  create<T>(config: unknown, ctx: SourceContext): Source<T>;
}

/**
 * Per-mode runtime services exposed to providers during create(). Providers
 * use these instead of reaching for globals, so that multiple modes can
 * coexist in the launcher without cross-contamination.
 */
export interface SourceContext {
  /** Absolute path to the workspace this mode is operating on. */
  workspace: string;

  /** Logger. Providers should log via this instead of console.* so output
   *  can be captured and routed per-mode. */
  log(message: string, level?: "debug" | "info" | "warn" | "error"): void;

  /** Aborted when the mode is destroyed. Providers should listen on this
   *  signal to clean up long-running work. */
  signal: AbortSignal;

  /**
   * Optional file channel for file-backed providers. Only present in the
   * browser runtime; the server-side runtime does not need it. memory/redis/
   * yjs providers ignore this.
   */
  files?: FileChannel;
}

// ────────────────────────────────────────────────────────────────────────────
// FileChannel
// ────────────────────────────────────────────────────────────────────────────

/**
 * Bridge between file-backed providers and the server's chokidar → WS
 * pipeline. The runtime instantiates exactly one FileChannel per mode
 * session and hands it to every file-backed provider via SourceContext.
 *
 * ## Origin tagging
 *
 * When a provider calls `write(path, content)`, the runtime (specifically the
 * server-side /api/files handler) records a `pendingSelfWrite` entry for that
 * path + content hash. When chokidar subsequently fires for that path, the
 * server consults the entry and tags the outgoing FileUpdate with
 * origin: "self"; otherwise origin: "external". Providers observe the tag via
 * the `origin` field on FileChangeEvent and propagate it to their own
 * SourceEvent output.
 *
 * This is the ONLY place in the system where self/external origin is
 * determined for file-backed data. Providers do not reverse-engineer it.
 */
export interface FileChannel {
  /**
   * Synchronous snapshot of all currently-known files in the workspace.
   * Used by providers for their initial load (providers then filter this
   * snapshot by their declared patterns).
   */
  snapshot(): ReadonlyArray<ViewerFileContent>;

  /**
   * Subscribe to file change events. The handler is called for each batch
   * of file changes arriving from the server. The batch may include files
   * outside any given provider's declared patterns — providers filter.
   * Returns an unsubscribe function.
   */
  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void;

  /**
   * Persist file content to the workspace. Wraps the existing
   * `POST /api/files` endpoint. Returns when the server has acknowledged
   * the write (which also means the pendingSelfWrite entry has been recorded
   * on the server side, so the resulting chokidar echo will be tagged
   * origin: "self" when it arrives).
   *
   * Providers call this from their doWrite() implementation. The runtime
   * guarantees write ordering within a single source via the BaseSource
   * queue; cross-source ordering is not guaranteed.
   */
  write(path: string, content: string): Promise<void>;

  /**
   * Delete a file from the workspace. Wraps `DELETE /api/files?path=...`.
   * Like write(), the server records a pendingSelfDelete entry so the
   * resulting chokidar `unlink` event is tagged origin: "self" and the
   * provider can absorb its own echo.
   *
   * Used primarily by `aggregate-file` providers whose `save()` produces
   * a { writes, deletes } diff — e.g. when a slide is removed from a
   * Deck, the provider deletes the corresponding `slides/slide-N.html`
   * via this method.
   */
  delete(path: string): Promise<void>;
}

/**
 * One file change observed by the runtime's FileChannel. Emitted to all
 * subscribed providers, which then filter to their declared patterns.
 */
export interface FileChangeEvent {
  path: string;
  content: string;
  /**
   * "self" if this change is the echo of a write() call made through any
   * FileChannel on this session. "external" otherwise (agent's Edit tool,
   * manual file-system edit, concurrent writer, etc.). "initial" for
   * entries delivered via the very first snapshot() payload.
   */
  origin: "initial" | "self" | "external";
}

// ────────────────────────────────────────────────────────────────────────────
// Manifest descriptor
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single source declaration in ModeManifest.sources. The runtime reads
 * kind, looks up the matching SourceProvider in the SourceRegistry, and
 * calls provider.create(config, ctx) to instantiate.
 *
 * config is typed as `unknown` here because its shape is provider-specific.
 * Providers document their own config schema. The built-in providers use:
 *
 *   - file-glob: { patterns: string[]; ignore?: string[] }
 *   - json-file: { path: string; parse: (raw: string) => T;
 *                  serialize: (v: T) => string }
 *   - memory:    { initial?: T }
 *   - aggregate-file: { patterns: string[]; ignore?: string[];
 *                       load: (files) => T | null;
 *                       save: (value, current) => { writes; deletes } }
 */
export interface SourceDescriptor {
  kind: string;
  config?: unknown;
}
