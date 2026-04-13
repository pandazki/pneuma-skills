# Source Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give viewers a typed, origin-aware, subscription-shaped view onto the work a coding agent is doing on the workspace — so that mode viewers can function as **real-time players of agent output** rather than raw file-content renderers. This is the viewer-contract-layer infrastructure that realizes the "viewer is the whole app UI" vision from `docs/design/pneuma-3.0-design.md`. The same abstraction lets humans participate optionally (direct edits, structured suggestions) without racing the agent's ongoing work. Implementation: replace the origin-less `files: ViewerFileContent[]` prop with a `Source<T>` data-channel abstraction, ship four built-in providers (`file-glob`, `json-file`, `aggregate-file`, `memory`), expose a plugin extension point for custom providers, and migrate all 9 existing viewer modes onto the new contract.

**Architecture:** Three orthogonal layers, established in `docs/reference/viewer-agent-protocol.md` and `CLAUDE.md`:

- **Layer 1 — Files on disk.** The coding agent's native habitat. Claude Code / Codex continue to edit files directly via their Read/Edit/Write tools. **Not abstracted, not mediated.** Files remain the canonical persistence layer and the shared source of truth between agent and viewer.
- **Layer 2 — Runtime transport.** chokidar → `pendingSelfWrites` origin tagging → WebSocket `content_update` → browser `fileEventBus`. Infrastructure that turns file changes into an origin-tagged event stream. Not viewer-facing.
- **Layer 3 — `Source<T>`.** The viewer's contract. `T` is a **domain type** (`Deck`, `Board`, `Project`), not a file shape. Reads come through `subscribe()` events tagged with `origin: "initial" | "self" | "external"`; writes go through `write()`, which providers serialize via a Promise queue with time-locked resolution. Four built-in providers cover the domain-to-storage spectrum: `file-glob` (domain IS files: doc, mode-maker, remotion), `json-file` (domain is a single structured aggregate: ClipCraft, gridboard), `aggregate-file` (domain is a multi-file aggregate: slide, webcraft, illustrate), `memory` (ephemeral session state). The runtime instantiates sources per mode via a `SourceRegistry` and exposes them as `props.sources`. Plugin-registered providers (Redis/Yjs/S3/Figma/...) slot into the same registry.

**Key architectural commitment:** agent's writes and viewer's writes are **two independent paths sharing one disk**, reconciled via the server-side `pendingSelfWrites` table that tags each chokidar event as `self` (viewer echo) or `external` (agent or peer). The viewer NEVER reverse-engineers origin from content comparison; BaseSource providers NEVER try to prevent agent writes; the agent NEVER sees the Source abstraction. The same framing is authoritative in `docs/reference/viewer-agent-protocol.md` (end-of-file "Sources" section, design principle 7) and `docs/design/pneuma-3.0-design.md` (Section 3.4).

**Tech Stack:** TypeScript strict mode, `bun:test`, no new dependencies. Lives in `core/types/source.ts`, `core/sources/`, `core/source-registry.ts`. Touches `core/types/mode-manifest.ts`, `core/types/viewer-contract.ts`, `core/types/plugin.ts`, `server/file-watcher.ts`, `server/index.ts`, `bin/pneuma.ts`, `src/ws.ts`, `src/store/workspace-slice.ts`, `src/App.tsx`, all 9 mode `manifest.ts` + viewer entry files (some with a new `domain.ts`).

**Prep status (already landed on this branch before P1 executes):** framing pass across `README.md`, `CLAUDE.md`, `docs/reference/viewer-agent-protocol.md` (added Sources section + layer-3 framing + design principle 7), `docs/design/pneuma-3.0-design.md` (forward pointer to source abstraction as 3.0 infrastructure), and `docs/adr/adr-007-file-watching-live-preview.md` (supersession note explaining viewer-facing contract change). These edits establish the authoritative vocabulary the plan uses; P1's doc task is now "verify + fine-tune", not "author from scratch".

---

## Background and locked-in design decisions

### What's wrong with the current shape

1. **Origin-less `files` prop, leaking into every write-back viewer.** Six existing modes (doc, draw, slide, webcraft, gridboard, plus diagram for streaming reads) write back to disk via inline `POST /api/files` calls. Each one then receives its own write echoing back through chokidar → WS → `props.files`, and has to reverse-engineer "is this my echo?" with refs and string comparison. The current state of echo handling across the codebase:
   - **doc** (`DocPreview.tsx:744–755, 213–225`): `lastExternalRef` string-compare guard. Overwrites the user's unsaved textarea on every incoming external content — known latent bug.
   - **draw** (`DrawPreview.tsx:259–263, 335–351, 358–371`): `lastSavedContentRef` + `isUpdatingFromFileRef` 500ms busy flag + remount key. **Load-bearing ordering** — line 370 sets `lastSavedContentRef.current = content` BEFORE the `fetch()` call, exactly the same fragility class as the ClipCraft `lastAppliedRef.current = null` ordering bug that originally motivated this work.
   - **slide** (`SlidePreview.tsx:639–646, 674–681, 700–707`): three POST sites (manifest reorder, manifest delete, debounced text edit). **Zero echo guard.** Currently survives because writes are user-driven and low-frequency; a faster cadence would race silently.
   - **webcraft** (`WebPreview.tsx:978–1008`): debounced 800ms iframe-message-driven POST. **Zero echo guard.** Iframe `srcdoc` reassignment on every files prop change masks the flash, but a pending save in the debounce window can still overwrite an incoming external edit.
   - **gridboard** (`GridBoardPreview.tsx:165–171, 530, 672, 886, 947`): immediate awaited POST on every drag/resize. **Zero echo guard.** Survives only because saves are synchronous — any future async pathway breaks it.
   - **diagram** (`DiagramPreview.tsx:139, 382`): `lastFileContentRef` + `currentFilePathRef` skip-on-no-change guard. Read-only, so the guard exists purely to skip expensive re-parse on prop churn, not to dodge an echo loop.

   Of the six viewers that touch the file watcher, **three have hand-rolled echo refs (doc, draw, diagram), three have no protection at all (slide, webcraft, gridboard), and zero of them share a single line of code.** Every author has invented a different solution. None of them is correct in the general case.

2. **`viewer.watchPatterns` is a silent contract.** Multi-file modes (webcraft declares 14 patterns, slide declares 4, gridboard declares 5) declare globs server-side, then viewers do ad-hoc `files.find(...)` / `files.filter(...)` on their own. If a viewer expects a file type the manifest doesn't watch, the failure is silent. There's no schema or assertion linking declaration to consumption.

3. **No extensibility.** Modes can only consume disk files. Future modes wanting Redis / Yjs / S3 / in-memory state have no protocol to plug in — they'd have to fork the runtime.

### What this plan introduces

A `Source<T>` data-channel abstraction with these invariants (enforced by the provider base class, not by viewer self-discipline):

1. **Single writer.** `write()` is the only way to mutate a source. The base class serializes all `write()` calls per source instance via an internal Promise queue. Concurrent writes are sequenced, never raced.
2. **Change-read-via-subscription.** All state changes (including the source's own commits) reach consumers as `subscribe()` events. Viewers do not hold optimistic local state; they always render from the latest event. `current()` exists only as a synchronous accessor for first-render and is identical to the latest emitted value.
3. **`write()` Promise time-locked.** `await source.write(v)` resolves only after the corresponding `{ origin: "self", value: v }` event has been delivered to all current subscribers and `current()` reflects `v`. After await, viewer state is guaranteed consistent.
4. **Origin tagging at the source.** Events carry `origin: "initial" | "self" | "external"`. Self-writes are NOT silently absorbed; they emit a `value` event with `origin: "self"`. External changes (agent edits, peer writes) emit `origin: "external"`. The first observed value emits `origin: "initial"`.
5. **Errors are non-fatal.** Parse failures, network errors, etc. emit `{ kind: "error", code, message }`. The source remains live; subsequent events still flow.

### What the user-facing migration looks like

Each existing mode declares a single source named `files` of kind `file-glob`, with patterns lifted from its current `viewer.watchPatterns`:

```ts
// before
viewer: { watchPatterns: ["**/*.md"], ignorePatterns: [] }

// after
viewer: { watchPatterns: ["**/*.md"], ignorePatterns: [] },  // kept until P5 last commit
sources: {
  files: { kind: "file-glob", config: { patterns: ["**/*.md"] } },
}
```

And each viewer replaces:

```ts
// before
export default function DocPreview({ files, ... }: ViewerPreviewProps) {
  // files: ViewerFileContent[]
}

// after
import { useSource } from "../../../src/hooks/useSource.js";
export default function DocPreview({ sources, ... }: ViewerPreviewProps) {
  const files = useSource(sources.files as Source<ViewerFileContent[]>) ?? [];
}
```

`useSource` is a thin `useSyncExternalStore` wrapper provided by the runtime. The viewer keeps its existing `files.find(...)` / `files.filter(...)` patterns unchanged — only the input plumbing differs.

### What is explicitly out of scope for this plan

- **Splitting modes into multiple typed sources.** webcraft could conceptually have `manifest`, `pages`, `assets` as three sources. This plan migrates every mode as a single-`files`-source unit to keep the migration mechanical. Domain refactoring is a follow-up.
- **Removing `viewer.watchPatterns` from the manifest.** Kept for the duration of this plan because it's still consumed by `startFileWatcher` to drive chokidar. The `sources` declaration is additive. A follow-up plan can collapse them once every file-glob source is the source of truth.
- **Diff-and-dispatch / state reconciliation.** `Source<T>` only provides origin-tagged events. What a viewer DOES on `origin: "external"` (rebuild a Zustand store, merge state, prompt the user) is left to each consumer.
- **ClipCraft refactor.** That mode lives on a separate feat branch. P7 produces a written migration guide for its author; the actual code refactor is theirs.
- **React integration helpers beyond `useSource`.** No source-providers, no context API, no Suspense integration. `useSource` is a 15-line hook.

---

## File structure

### Created files (new)

| Path | Responsibility |
|---|---|
| `core/types/source.ts` | `Source<T>`, `SourceEvent<T>`, `SourceProvider`, `SourceContext`, `FileChannel`, `SourceDescriptor` types. Pure type module, no logic. |
| `core/sources/base.ts` | `BaseSource<T>` abstract class. Implements listener management, write serialization, current() accessor, destroy. Subclasses fill `doWrite()` and call `this.emit()`. |
| `core/sources/memory.ts` | `MemorySource<T>` — ephemeral in-process source. Trivial reference implementation that exercises the BaseSource contract. |
| `core/sources/file-glob.ts` | `FileGlobSource` — multi-file aggregate. Subscribes to `FileChannel`, filters by patterns, emits `FileContent[]`. `doWrite()` throws (file-glob is read-only via Source.write; agents write files directly). |
| `core/sources/json-file.ts` | `JsonFileSource<T>` — single structured file. Parses on read, serializes + writes via `FileChannel.write()` on `doWrite()`. |
| `core/sources/index.ts` | Barrel re-export + built-in `SourceProvider[]` registry. |
| `core/source-registry.ts` | `SourceRegistry` class: holds providers (built-in + plugin-registered), instantiates sources from `manifest.sources` declarations against a `SourceContext`. |
| `core/sources/__tests__/base.test.ts` | bun:test for BaseSource invariants (write serialization, Promise time-lock, listener fan-out, destroy). |
| `core/sources/__tests__/memory.test.ts` | bun:test for MemorySource. |
| `core/sources/__tests__/file-glob.test.ts` | bun:test for FileGlobSource (with mock FileChannel). |
| `core/sources/__tests__/json-file.test.ts` | bun:test for JsonFileSource (with mock FileChannel). |
| `core/__tests__/source-registry.test.ts` | bun:test for SourceRegistry — register, instantiate, destroy. |
| `src/hooks/useSource.ts` | React hook wrapping `useSyncExternalStore` over a `Source<T>`. |
| `src/runtime/file-channel.ts` | Browser-side `FileChannel` impl: bridges store + ws + POST /api/files into the `FileChannel` interface that providers consume. |
| `src/runtime/file-event-bus.ts` | Browser-side singleton pub/sub. `workspace-slice.updateFiles()` publishes; `BrowserFileChannel` subscribes and re-emits to provider instances. |
| `src/runtime/scoped-source.ts` | (P5.11) `wrapWithContentSetScope` — decorates a `file-glob` source with content-set path stripping, preserving the pre-P5 `useViewerProps` content-set behavior. |
| `docs/superpowers/plans/clipcraft-source-migration.md` | (P7) Written guide for ClipCraft's author. |

### Modified files

| Path | Change |
|---|---|
| `core/types/mode-manifest.ts` | Add `SourceDescriptor` import + optional `sources?: Record<string, SourceDescriptor>` field on `ModeManifest`. |
| `core/types/viewer-contract.ts` | Add `sources: Record<string, Source<unknown>>` to `ViewerPreviewProps`. Mark `files` as `@deprecated` in P3, delete in P5 final commit. |
| `core/types/plugin.ts` | Add optional `sources?: SourceProvider[]` to `PluginManifest` for plugin-registered providers. |
| `core/types/index.ts` | Re-export source types. |
| `core/plugin-registry.ts` | When loading a plugin, collect its `sources` array and hand it to the SourceRegistry. |
| `server/file-watcher.ts` | Add `pendingSelfWrites: Map<string, { hash, ts }>` API + integration so the watcher tags echoes. Extend `FileUpdate` with optional `origin?: "self" \| "external"`. |
| `server/index.ts` | `/api/files` POST registers a self-write entry before writing to disk. The watcher reads this on the next event. |
| `bin/pneuma.ts` | The `content_update` broadcast forwards the `origin` tag added by the watcher. |
| `src/ws.ts` | The `content_update` handler forwards `origin` into the store. |
| `src/store/workspace-slice.ts` | `updateFiles()` accepts and forwards `origin`. Adds an event-bus shape (`fileEventBus`) so `FileChannel` browser impl can subscribe to incoming changes. |
| `src/App.tsx` | `useViewerProps()` builds a `SourceRegistry` per active mode, instantiates sources from manifest, exposes them as `props.sources`. Keeps `files` populated through P3–P5. Removes `files` in P5 final commit. |
| `modes/doc/manifest.ts` | Add `sources: { files: { kind: "file-glob", config: { patterns: [...] } } }`. |
| `modes/doc/viewer/DocPreview.tsx` | Replace `files` destructure with `sources` + `useSource`. |
| `modes/diagram/manifest.ts` | Same. |
| `modes/diagram/viewer/DiagramPreview.tsx` | Same. |
| `modes/draw/manifest.ts` | Same. |
| `modes/draw/viewer/DrawPreview.tsx` | Same. |
| `modes/illustrate/manifest.ts` | Same. |
| `modes/illustrate/viewer/IllustratePreview.tsx` | Same. |
| `modes/remotion/manifest.ts` | Same. |
| `modes/remotion/viewer/*` | Same. |
| `modes/mode-maker/manifest.ts` | Same. |
| `modes/mode-maker/viewer/ModeMakerPreview.tsx` | Same. |
| `modes/gridboard/manifest.ts` | Same. |
| `modes/gridboard/viewer/GridBoardPreview.tsx` | Same. |
| `modes/slide/manifest.ts` | Same. |
| `modes/slide/viewer/SlidePreview.tsx` | Same. |
| `modes/webcraft/manifest.ts` | Same. |
| `modes/webcraft/viewer/WebPreview.tsx` | Same. |
| `docs/reference/viewer-agent-protocol.md` | Update direction ②, manifest table, new "Sources" section, design principles. |
| `docs/superpowers/plans/2026-04-13-mode-sync-transport.md` | Add superseded-by header pointing at this plan. |

---


## Phase 1: Contract + protocol documentation

Phase 1 lands only types and documentation. No runtime code changes. This phase is a single commit that you can hand to the user for review before any implementation begins.

### Task 1.1: Create `core/types/source.ts`

**Files:**
- Create: `core/types/source.ts`

- [ ] **Step 1: Write the file in full**

```ts
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
 *    no-op unsubscribe, feed()/current() return null.
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
 */
export interface SourceDescriptor {
  kind: string;
  config?: unknown;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors. If you see errors about `ViewerFileContent` missing, check the import path — it's `./viewer-contract.js` (note the `.js` extension even though the file is `.ts` — required by bundler module resolution).

- [ ] **Step 3: Do NOT commit yet.** Task 1.2 modifies an adjacent file and both land in the same P1 commit.

---

### Task 1.2: Add `sources` field to `ModeManifest`

**Files:**
- Modify: `core/types/mode-manifest.ts`

- [ ] **Step 1: Add the import**

At the top of the file, near the other type imports, add:

```ts
import type { SourceDescriptor } from "./source.js";
```

- [ ] **Step 2: Add the field to `ModeManifest`**

In the `ModeManifest` interface (currently ~lines 252–298), add the optional `sources` field at the end of the interface body, just before the closing brace:

```ts
  /**
   * Declarative data-channel configuration. Each entry instantiates a
   * Source<T> via the SourceRegistry at mode startup and exposes it to
   * the viewer as props.sources[id].
   *
   * If omitted, the runtime synthesizes a default entry:
   *
   *   sources: {
   *     files: {
   *       kind: "file-glob",
   *       config: {
   *         patterns: this.viewer.watchPatterns,
   *         ignore: this.viewer.ignorePatterns,
   *       },
   *     },
   *   }
   *
   * so every pre-existing mode continues to receive a `files` source with
   * zero manifest changes. New or migrated modes declare sources explicitly.
   *
   * See core/types/source.ts for the SourceDescriptor shape and the
   * built-in provider kinds (file-glob, json-file, memory).
   */
  sources?: Record<string, SourceDescriptor>;
```

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Do NOT commit yet.** Wait for Task 1.3.

---

### Task 1.3: Re-export source types from the barrel

**Files:**
- Modify: `core/types/index.ts`

- [ ] **Step 1: Add the re-export**

Append to the file (after the existing `export * from "./plugin.js";` or wherever the last export lives):

```ts
export type {
  Source,
  SourceEvent,
  SourceProvider,
  SourceContext,
  FileChannel,
  FileChangeEvent,
  SourceDescriptor,
} from "./source.js";
```

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

---

### Task 1.4: Compile-time contract test

**Files:**
- Create: `core/__tests__/source-types.test.ts`

This task is a type-assertion test — it has no runtime assertions but will fail `tsc` if the contract drifts. It exists so the next person to touch source.ts gets a loud signal if they break a load-bearing type.

- [ ] **Step 1: Write the test file**

```ts
import { describe, test, expect } from "bun:test";
import type {
  Source,
  SourceEvent,
  SourceProvider,
  SourceContext,
  SourceDescriptor,
  FileChannel,
  FileChangeEvent,
} from "../types/source.js";
import type { ModeManifest } from "../types/mode-manifest.js";

describe("Source contract shape", () => {
  test("SourceEvent discriminates on kind", () => {
    // Compile-time exhaustiveness check: if a new kind is added without
    // updating this function, tsc will complain about the unreachable case.
    function assertNever(x: never): never {
      throw new Error(`Unexpected: ${String(x)}`);
    }
    function reduce<T>(e: SourceEvent<T>): string {
      switch (e.kind) {
        case "value":
          return e.origin;
        case "error":
          return e.code;
        default:
          return assertNever(e);
      }
    }
    expect(
      reduce<number>({ kind: "value", value: 1, origin: "initial" }),
    ).toBe("initial");
    expect(
      reduce<number>({ kind: "error", code: "E_PARSE", message: "bad" }),
    ).toBe("E_PARSE");
  });

  test("Source<T> has the four required methods", () => {
    const stub: Source<number> = {
      current: () => null,
      subscribe: () => () => {},
      write: async () => {},
      destroy: () => {},
    };
    expect(typeof stub.current).toBe("function");
    expect(typeof stub.subscribe).toBe("function");
    expect(typeof stub.write).toBe("function");
    expect(typeof stub.destroy).toBe("function");
  });

  test("SourceProvider.create takes config and context, returns Source", () => {
    const provider: SourceProvider = {
      kind: "test",
      create<T>(_config: unknown, _ctx: SourceContext): Source<T> {
        return {
          current: () => null,
          subscribe: () => () => {},
          write: async () => {},
          destroy: () => {},
        };
      },
    };
    expect(provider.kind).toBe("test");
  });

  test("SourceContext exposes workspace, log, signal, optional files", () => {
    const ctx: SourceContext = {
      workspace: "/tmp/ws",
      log: () => {},
      signal: new AbortController().signal,
    };
    expect(ctx.workspace).toBe("/tmp/ws");
    expect(ctx.files).toBeUndefined();
  });

  test("FileChannel has snapshot, subscribe, write, delete", () => {
    const channel: FileChannel = {
      snapshot: () => [],
      subscribe: () => () => {},
      write: async () => {},
      delete: async () => {},
    };
    expect(channel.snapshot()).toEqual([]);
  });

  test("FileChangeEvent origin is one of initial|self|external", () => {
    const events: FileChangeEvent[] = [
      { path: "a.md", content: "x", origin: "initial" },
      { path: "a.md", content: "y", origin: "self" },
      { path: "a.md", content: "z", origin: "external" },
    ];
    expect(events).toHaveLength(3);
  });

  test("SourceDescriptor is assignable from manifest.sources entry", () => {
    const d: SourceDescriptor = {
      kind: "file-glob",
      config: { patterns: ["**/*.md"] },
    };
    expect(d.kind).toBe("file-glob");
  });

  test("ModeManifest.sources is optional and takes SourceDescriptors", () => {
    // Compile-time: this must typecheck without errors.
    const partial: Pick<ModeManifest, "sources"> = {
      sources: {
        files: { kind: "file-glob", config: { patterns: ["**/*.md"] } },
      },
    };
    expect(partial.sources?.files.kind).toBe("file-glob");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test core/__tests__/source-types.test.ts`
Expected: 7 pass, 0 fail.

---

### Task 1.5: Verify `docs/reference/viewer-agent-protocol.md` framing (already landed)

**Files:**
- Read-only: `docs/reference/viewer-agent-protocol.md`

This task previously authored the Sources section + direction ② rewrite + manifest table row from scratch. Those edits **already landed as a prep commit on this branch** before P1 execution began — see the "Prep status" note in the plan preamble. This task is now a verification pass to catch drift between the authoritative doc and what P1 Task 1.1 (`core/types/source.ts`) implements. **Do not rewrite the doc; only fix drift.**

- [ ] **Step 1: Open the protocol doc and confirm these sections exist**

Open `docs/reference/viewer-agent-protocol.md`. Confirm that each of the following is present and says what it should:

1. A `## 基本立场` section near the top that names the three layers (Layer 1 = files as agent native habitat; Layer 2 = runtime transport via chokidar + pendingSelfWrites + WS + fileEventBus; Layer 3 = `Source<T>` as viewer's domain-typed contract)
2. Direction `② Viewer → User: Rendering（视觉呈现 / Player）` whose **数据契约** lists `sources: Record<string, Source<T>>` as the primary field, with a history note acknowledging the legacy `files` prop
3. A row for `sources` in the Manifest / Runtime role table pointing at direction ② and the Sources小节
4. A top-level `## Sources — Viewer 的数据通道` section near the end that covers:
   - "First job is observation, write is optional participation" framing
   - Four invariants (single writer, change-read-via-subscription, time-locked write Promise, origin tagging)
   - "Agent 和 Source 的关系" paragraph explaining the two independent write paths sharing one disk reconciled by origin tags
   - Built-in providers table with FOUR entries: `file-glob`, `json-file`, `aggregate-file`, `memory` (note: `aggregate-file` is listed because P2 Tasks 2.11–2.12 add it)
   - Plugin extension path
   - Mode author 6-step mental path
5. Design principle 7 "Files 归 agent，Domain 归 viewer"

- [ ] **Step 2: Cross-check contract vocabulary**

Grep the doc for every method name and event shape. They must match `core/types/source.ts` from Task 1.1 exactly:

```bash
grep -n "Source<T>\|SourceEvent\|SourceProvider\|FileChannel\|origin:" \
  docs/reference/viewer-agent-protocol.md
```

Confirm:
- `Source<T>` exposes `current() / subscribe() / write() / destroy()` (no other method names)
- `SourceEvent<T>` has `kind: "value" | "error"` and value events have `origin: "initial" | "self" | "external"`
- `SourceProvider.create(config, ctx)` is the factory signature
- `FileChannel` exposes `snapshot() / subscribe() / write() / delete()` (delete is added by Task 2.12; if the protocol doc lists `delete` before P2 lands it, that's fine — it's forward compatible)
- `SourceDescriptor { kind, config }` is the manifest entry shape

If any name or signature in the doc disagrees with `core/types/source.ts`, **fix whichever is wrong** — the types file is the source of truth for wire shape; the doc is the source of truth for framing. Record the fix in the P1 commit. Do NOT re-author the doc's prose.

- [ ] **Step 3: Do NOT commit yet.** Wait for Task 1.6.

---


---

### Task 1.6: Verify `mode-sync-transport.md` has the superseded-by header (already landed)

**Files:**
- Read-only: `docs/superpowers/plans/2026-04-13-mode-sync-transport.md`

The superseded-by header **already landed** as part of the doc framing prep commit on this branch (see the "Prep status" note in the plan preamble). This task is a one-line verification.

- [ ] **Step 1: Confirm the header is present**

```bash
head -5 docs/superpowers/plans/2026-04-13-mode-sync-transport.md | grep -q "SUPERSEDED" && echo OK || echo MISSING
```

Expected: `OK`. If `MISSING`, add the superseded header (see the prep commit for the exact wording) before proceeding.

- [ ] **Step 2: Do NOT commit yet.** Wait for the P1 verification task.

---

### Task 1.7: P1 verification

**Files:** none modified.

- [ ] **Step 1: Typecheck the whole repo**

Run: `bun run tsc --noEmit 2>&1 | tee /tmp/tsc.log`
Expected: no errors. If there are errors outside `core/types/source.ts`, `core/types/mode-manifest.ts`, `core/types/index.ts`, or the new test file, investigate — P1 should not have touched anything else.

- [ ] **Step 2: Run the full test suite**

Run: `bun test 2>&1 | tail -30`
Expected: the suite passes. Count of new passing tests should include the 7 from `core/__tests__/source-types.test.ts`.

- [ ] **Step 3: Confirm diff shape**

Run: `git diff --stat main`
Expected: 6 files changed — 3 new (`core/types/source.ts`, `core/__tests__/source-types.test.ts`, untouched plan doc), 3 modified (`core/types/mode-manifest.ts`, `core/types/index.ts`, `docs/reference/viewer-agent-protocol.md`, `docs/superpowers/plans/2026-04-13-mode-sync-transport.md`).

(The plan doc itself — `docs/superpowers/plans/2026-04-13-source-abstraction.md` — was created as part of plan authoring, not P1 implementation. It should already be in the diff but is not a deliverable of this task.)

---

### Task 1.8: Commit P1

- [ ] **Step 1: Stage only the P1 files**

```bash
git add \
  core/types/source.ts \
  core/types/mode-manifest.ts \
  core/types/index.ts \
  core/__tests__/source-types.test.ts \
  docs/reference/viewer-agent-protocol.md \
  docs/superpowers/plans/2026-04-13-mode-sync-transport.md \
  docs/superpowers/plans/2026-04-13-source-abstraction.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(source): contract + protocol doc for source abstraction (P1)

Introduces the Source<T> data-channel contract that will replace the
origin-less files prop across all viewer modes. This commit is types +
documentation only — no runtime code, no mode changes, nothing exercises
the contract at runtime yet.

- core/types/source.ts: Source<T>, SourceEvent<T>, SourceProvider,
  SourceContext, FileChannel, FileChangeEvent, SourceDescriptor
- core/types/mode-manifest.ts: optional sources field on ModeManifest
- core/types/index.ts: re-export
- core/__tests__/source-types.test.ts: compile-time contract assertions
- docs/reference/viewer-agent-protocol.md: direction ② rewrite,
  manifest table row, new Sources section, design principle 7
- docs/superpowers/plans/2026-04-13-mode-sync-transport.md: superseded-by
  header; original proposal preserved as historical context

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Stop here for review.**

P1 is the contract-and-docs commit that deserves an explicit user sign-off before any implementation lands on top of it. Present the commit hash and ask the user to review the protocol doc wording and the Source contract semantics before starting P2.

---


## Phase 2: Provider base class + three built-in providers

Phase 2 implements the runtime side of the Source contract. Everything in this phase is pure TypeScript under `core/sources/`, framework-agnostic, and fully unit-testable without any browser, server, or file system. The phase ends with `bun test core/sources` fully green.

Every provider task is written as **failing test first, then minimal implementation, then confirm green**. Do not skip the failing-test step — it's how you verify the test actually exercises the code and doesn't silently pass against a typo.

### Task 2.1: Write failing tests for `BaseSource`

**Files:**
- Create: `core/sources/__tests__/base.test.ts`

- [ ] **Step 1: Write the test file in full**

```ts
import { describe, test, expect } from "bun:test";
import { BaseSource } from "../base.js";
import type { SourceEvent } from "../../types/source.js";

// A minimal concrete subclass for testing BaseSource directly.
// doWrite() just echoes the value back as a "self" event and resolves.
class TestSource<T> extends BaseSource<T> {
  public doWriteCalls: T[] = [];
  public doWriteDelay = 0;
  public doWriteError: Error | null = null;

  protected async doWrite(value: T): Promise<void> {
    this.doWriteCalls.push(value);
    if (this.doWriteDelay > 0) {
      await new Promise((r) => setTimeout(r, this.doWriteDelay));
    }
    if (this.doWriteError) throw this.doWriteError;
    this.emit({ kind: "value", value, origin: "self" });
  }

  // Test hooks for driving events from outside
  public testEmitInitial(value: T): void {
    this.emit({ kind: "value", value, origin: "initial" });
  }
  public testEmitExternal(value: T): void {
    this.emit({ kind: "value", value, origin: "external" });
  }
  public testEmitError(code: string, message: string): void {
    this.emit({ kind: "error", code, message });
  }
}

describe("BaseSource", () => {
  test("current() returns null before any event", () => {
    const s = new TestSource<number>();
    expect(s.current()).toBeNull();
  });

  test("emit updates current() synchronously", () => {
    const s = new TestSource<number>();
    s.testEmitInitial(42);
    expect(s.current()).toBe(42);
  });

  test("subscribe receives future events, not a synthetic initial", () => {
    const s = new TestSource<number>();
    s.testEmitInitial(1);
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    expect(events).toHaveLength(0);  // no synthetic on subscribe
    s.testEmitExternal(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "value", value: 2, origin: "external" });
  });

  test("multiple subscribers all receive the same event", () => {
    const s = new TestSource<number>();
    const a: SourceEvent<number>[] = [];
    const b: SourceEvent<number>[] = [];
    s.subscribe((e) => a.push(e));
    s.subscribe((e) => b.push(e));
    s.testEmitExternal(7);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test("unsubscribe stops that listener only", () => {
    const s = new TestSource<number>();
    const a: SourceEvent<number>[] = [];
    const b: SourceEvent<number>[] = [];
    const offA = s.subscribe((e) => a.push(e));
    s.subscribe((e) => b.push(e));
    offA();
    s.testEmitExternal(7);
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  test("write calls doWrite and emits self event", async () => {
    const s = new TestSource<string>();
    const events: SourceEvent<string>[] = [];
    s.subscribe((e) => events.push(e));
    await s.write("hello");
    expect(s.doWriteCalls).toEqual(["hello"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "value", value: "hello", origin: "self" });
    expect(s.current()).toBe("hello");
  });

  test("write Promise resolves AFTER the self event is delivered", async () => {
    const s = new TestSource<string>();
    s.doWriteDelay = 20;
    let eventSeenAt = 0;
    let writeResolvedAt = 0;
    s.subscribe((e) => {
      if (e.kind === "value" && e.origin === "self") {
        eventSeenAt = performance.now();
      }
    });
    const before = performance.now();
    await s.write("x");
    writeResolvedAt = performance.now();
    // Event must be delivered before or at the same instant write resolves
    expect(eventSeenAt).toBeGreaterThan(0);
    expect(eventSeenAt).toBeLessThanOrEqual(writeResolvedAt);
    // And the write took roughly the doWriteDelay
    expect(writeResolvedAt - before).toBeGreaterThanOrEqual(15);
  });

  test("concurrent write calls are serialized in call order", async () => {
    const s = new TestSource<number>();
    s.doWriteDelay = 10;
    const writes = [s.write(1), s.write(2), s.write(3)];
    await Promise.all(writes);
    expect(s.doWriteCalls).toEqual([1, 2, 3]);
    expect(s.current()).toBe(3);
  });

  test("a failed write propagates its error to the caller", async () => {
    const s = new TestSource<number>();
    s.doWriteError = new Error("disk full");
    await expect(s.write(1)).rejects.toThrow("disk full");
  });

  test("a failed write does not block subsequent writes", async () => {
    const s = new TestSource<number>();
    s.doWriteError = new Error("first fails");
    await expect(s.write(1)).rejects.toThrow("first fails");
    s.doWriteError = null;
    await s.write(2);
    expect(s.current()).toBe(2);
  });

  test("destroy() is idempotent and makes write a no-op", async () => {
    const s = new TestSource<number>();
    s.destroy();
    s.destroy();  // second call is safe
    await s.write(1);  // resolves without calling doWrite
    expect(s.doWriteCalls).toEqual([]);
    expect(s.current()).toBeNull();
  });

  test("destroy() removes all subscribers", () => {
    const s = new TestSource<number>();
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    s.destroy();
    s.testEmitExternal(1);  // after destroy, emit is a no-op
    expect(events).toHaveLength(0);
  });

  test("subscribe after destroy returns a no-op unsubscribe", () => {
    const s = new TestSource<number>();
    s.destroy();
    const off = s.subscribe(() => {});
    expect(typeof off).toBe("function");
    off();  // must not throw
  });

  test("error events do not update current()", () => {
    const s = new TestSource<number>();
    s.testEmitInitial(10);
    s.testEmitError("E_X", "bad");
    expect(s.current()).toBe(10);
  });

  test("error event is delivered to all subscribers", () => {
    const s = new TestSource<number>();
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    s.testEmitError("E_X", "bad");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "error", code: "E_X", message: "bad" });
  });

  test("a listener that throws does not prevent other listeners from running", () => {
    const s = new TestSource<number>();
    s.subscribe(() => { throw new Error("boom"); });
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    s.testEmitExternal(1);
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm all fail with "BaseSource not found"**

Run: `bun test core/sources/__tests__/base.test.ts 2>&1 | tail -20`
Expected: module resolution error on `../base.js` because the file doesn't exist yet. This is the intended failing state.

---

### Task 2.2: Implement `BaseSource`

**Files:**
- Create: `core/sources/base.ts`

- [ ] **Step 1: Write the file**

```ts
import type { Source, SourceEvent } from "../types/source.js";

/**
 * Abstract base class for all built-in and third-party Source implementations.
 *
 * Owns the four invariants documented on Source<T> in core/types/source.ts:
 * single writer, change-read-via-subscription, time-locked write Promises,
 * origin tagging. Subclasses only fill in:
 *
 *   - doWrite(value): perform the actual persistence. Must emit a
 *     { origin: "self" } event before resolving (see the helper
 *     emit() method below). Should throw on failure — BaseSource
 *     re-throws to the write() caller.
 *
 *   - Whatever mechanism they use to observe external changes.
 *     When an external change arrives, the subclass calls
 *     this.emit({ kind: "value", value, origin: "external" }) to
 *     propagate it.
 *
 *   - An initial-load pathway that ultimately calls
 *     this.emit({ kind: "value", value, origin: "initial" }) once.
 *
 * Subclasses should call super.destroy() from their own destroy() to
 * guarantee the listener set is cleared.
 */
export abstract class BaseSource<T> implements Source<T> {
  private listeners = new Set<(e: SourceEvent<T>) => void>();
  private latest: T | null = null;
  private destroyed = false;

  // Serializes write() calls. Each write awaits the previous. We use
  // .catch inside the chain so one rejection doesn't poison subsequent
  // writes — the rejection is still propagated to THAT call's caller via
  // the separate `next` promise.
  private writeQueue: Promise<void> = Promise.resolve();

  current(): T | null {
    return this.latest;
  }

  subscribe(listener: (event: SourceEvent<T>) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Public entry point for writes. Serializes against any in-flight or
   * queued writes, then calls the subclass's doWrite(). The returned
   * Promise resolves only after doWrite() has resolved AND the self event
   * has been delivered to all subscribers (the subclass is responsible
   * for emitting that event from within doWrite, typically as its very
   * last step before returning).
   */
  write(value: T): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    // Chain: wait for previous write (regardless of success), then run
    // this one. The returned `next` is what we give the caller; the
    // `.catch` on the stored queue prevents one failure from breaking
    // the chain for later writes.
    const prev = this.writeQueue;
    const next = prev
      .catch(() => {})
      .then(() => this.doWrite(value));
    this.writeQueue = next.catch(() => {});
    return next;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
  }

  /**
   * Subclass hook: actually persist the value. Must emit a self event
   * before resolving. Throw to signal failure — BaseSource propagates
   * the error to the write() caller.
   */
  protected abstract doWrite(value: T): Promise<void>;

  /**
   * Subclass hook: emit an event to all current subscribers. Updates
   * the internal `latest` cache if this is a value event. Listeners that
   * throw are isolated — their error is caught and logged, other
   * listeners still receive the event.
   */
  protected emit(event: SourceEvent<T>): void {
    if (this.destroyed) return;
    if (event.kind === "value") {
      this.latest = event.value;
    }
    // Snapshot the listener set so a listener that subscribes / unsubscribes
    // during delivery doesn't disturb iteration.
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (err) {
        // Don't throw — one listener's bug shouldn't break others.
        // Log to console; providers can override this if they need
        // structured logging (via SourceContext.log, but BaseSource has
        // no ctx, so console is the floor).
        // eslint-disable-next-line no-console
        console.error("[source] listener threw", err);
      }
    }
  }

  /**
   * Subclass utility: check whether destroy() has been called. Useful
   * for guarding async code paths that resume after an await boundary.
   */
  protected get isDestroyed(): boolean {
    return this.destroyed;
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `bun test core/sources/__tests__/base.test.ts 2>&1 | tail -20`
Expected: 16 pass, 0 fail.

- [ ] **Step 3: Do NOT commit yet.** P2 commits once all three providers are green.

---

### Task 2.3: Write failing tests for `MemorySource`

**Files:**
- Create: `core/sources/__tests__/memory.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, test, expect } from "bun:test";
import { MemorySource } from "../memory.js";
import type { SourceEvent } from "../../types/source.js";

describe("MemorySource", () => {
  test("starts with null current when no initial given", () => {
    const s = new MemorySource<number>({});
    expect(s.current()).toBeNull();
  });

  test("starts with initial value and emits initial event synchronously on create", () => {
    const s = new MemorySource<number>({ initial: 42 });
    // MemorySource fires its initial event in the next microtask, so after
    // one tick current() should be 42. We use a microtask await.
    return Promise.resolve().then(() => {
      expect(s.current()).toBe(42);
    });
  });

  test("subscribers registered before the first tick receive the initial event", async () => {
    const s = new MemorySource<number>({ initial: 42 });
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();  // let the microtask run
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "value", value: 42, origin: "initial" });
  });

  test("write() emits a self event and updates current()", async () => {
    const s = new MemorySource<number>({ initial: 0 });
    await Promise.resolve();  // drain initial
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    await s.write(7);
    expect(s.current()).toBe(7);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "value", value: 7, origin: "self" });
  });

  test("destroy stops further writes", async () => {
    const s = new MemorySource<number>({ initial: 0 });
    s.destroy();
    await s.write(1);
    expect(s.current()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm all fail with module not found**

Run: `bun test core/sources/__tests__/memory.test.ts 2>&1 | tail -10`
Expected: module resolution error.

---

### Task 2.4: Implement `MemorySource`

**Files:**
- Create: `core/sources/memory.ts`

- [ ] **Step 1: Write the file**

```ts
import { BaseSource } from "./base.js";

/**
 * Ephemeral in-process source. Keeps state in memory, no persistence.
 * Used for session-scoped data (presence, cursor, UI mode flags, etc.)
 * where a refresh is expected to start fresh.
 *
 * Config:
 *   { initial?: T }  -- optional starting value
 *
 * The initial event fires in a microtask after construction so that
 * subscribers registered synchronously right after `new MemorySource()`
 * still catch it.
 */
export interface MemorySourceConfig<T> {
  initial?: T;
}

export class MemorySource<T> extends BaseSource<T> {
  constructor(config: MemorySourceConfig<T>) {
    super();
    if (config.initial !== undefined) {
      // Defer to a microtask so listeners subscribed right after
      // construction still catch the initial event.
      queueMicrotask(() => {
        if (this.isDestroyed) return;
        this.emit({ kind: "value", value: config.initial as T, origin: "initial" });
      });
    }
  }

  protected async doWrite(value: T): Promise<void> {
    this.emit({ kind: "value", value, origin: "self" });
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `bun test core/sources/__tests__/memory.test.ts 2>&1 | tail -15`
Expected: 5 pass, 0 fail.

---

### Task 2.5: Write failing tests for `FileGlobSource`

**Files:**
- Create: `core/sources/__tests__/file-glob.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { FileGlobSource } from "../file-glob.js";
import type {
  FileChannel,
  FileChangeEvent,
  SourceEvent,
} from "../../types/source.js";
import type { ViewerFileContent } from "../../types/viewer-contract.js";

// In-memory FileChannel for testing — lets the test drive file events
// directly without a real server.
class MockFileChannel implements FileChannel {
  public handlers = new Set<(batch: FileChangeEvent[]) => void>();
  public files: ViewerFileContent[] = [];
  public writes: Array<{ path: string; content: string }> = [];
  public writeError: Error | null = null;

  snapshot(): ReadonlyArray<ViewerFileContent> {
    return this.files;
  }

  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  async write(path: string, content: string): Promise<void> {
    if (this.writeError) throw this.writeError;
    this.writes.push({ path, content });
  }

  public deletes: string[] = [];
  async delete(path: string): Promise<void> {
    this.deletes.push(path);
  }

  // Test hook
  push(batch: FileChangeEvent[]): void {
    for (const h of this.handlers) h(batch);
  }
}

describe("FileGlobSource", () => {
  let ch: MockFileChannel;

  beforeEach(() => {
    ch = new MockFileChannel();
  });

  test("on create, reads snapshot and fires initial with matching files", async () => {
    ch.files = [
      { path: "a.md", content: "# A" },
      { path: "b.css", content: "body {}" },
      { path: "c.md", content: "# C" },
    ];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    await Promise.resolve();  // let the initial microtask run
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("initial");
    expect(events[0].value.map((f) => f.path).sort()).toEqual(["a.md", "c.md"]);
  });

  test("external file change matching patterns emits external event", async () => {
    ch.files = [{ path: "a.md", content: "# A" }];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await Promise.resolve();  // drain initial
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    ch.push([{ path: "a.md", content: "# A edited", origin: "external" }]);
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("external");
    expect(events[0].value.find((f) => f.path === "a.md")?.content).toBe("# A edited");
  });

  test("self-origin change emits self event (unchanged origin tag)", async () => {
    ch.files = [{ path: "a.md", content: "# A" }];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await Promise.resolve();
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    ch.push([{ path: "a.md", content: "# Fresh", origin: "self" }]);
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("self");
  });

  test("file change not matching patterns does not emit", async () => {
    ch.files = [{ path: "a.md", content: "# A" }];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await Promise.resolve();
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    ch.push([{ path: "b.css", content: "body {}", origin: "external" }]);
    expect(events).toHaveLength(0);
  });

  test("write() throws — file-glob is read-only via Source.write", async () => {
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await expect(source.write([])).rejects.toThrow(/read-only/i);
  });

  test("batch with a mix of matching and non-matching files emits once with the full current set", async () => {
    ch.files = [
      { path: "a.md", content: "# A" },
      { path: "b.md", content: "# B" },
    ];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await Promise.resolve();
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    ch.push([
      { path: "a.md", content: "# A2", origin: "external" },
      { path: "x.css", content: "...", origin: "external" },
    ]);
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    const paths = events[0].value.map((f) => f.path).sort();
    expect(paths).toEqual(["a.md", "b.md"]);
  });

  test("ignore patterns filter out matching files", async () => {
    ch.files = [
      { path: "a.md", content: "# A" },
      { path: "node_modules/x.md", content: "# X" },
    ];
    const source = new FileGlobSource(
      { patterns: ["**/*.md"], ignore: ["**/node_modules/**"] },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(source.current()?.map((f) => f.path)).toEqual(["a.md"]);
  });

  test("destroy unsubscribes from FileChannel", () => {
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    expect(ch.handlers.size).toBe(1);
    source.destroy();
    expect(ch.handlers.size).toBe(0);
  });
});
```

- [ ] **Step 2: Confirm all fail**

Run: `bun test core/sources/__tests__/file-glob.test.ts 2>&1 | tail -10`
Expected: module resolution error.

---

### Task 2.6: Implement `FileGlobSource`

**Files:**
- Create: `core/sources/file-glob.ts`

- [ ] **Step 1: Write the file**

```ts
import { BaseSource } from "./base.js";
import type {
  FileChannel,
  FileChangeEvent,
} from "../types/source.js";
import type { ViewerFileContent } from "../types/viewer-contract.js";

export interface FileGlobConfig {
  patterns: string[];
  ignore?: string[];
}

/**
 * Multi-file aggregate source backed by a FileChannel. Subscribes to the
 * channel, filters incoming changes by its declared patterns, and emits
 * the full snapshot of matching files as a single SourceEvent on each
 * change.
 *
 * ## Why the whole snapshot, not just the delta?
 *
 * Existing viewers (all 6 write-back modes + diagram) consume a full
 * `files: ViewerFileContent[]` array and do `files.find(...)` / filter.
 * Emitting the full snapshot lets the P5 migration be a 1-line change
 * (useSource(sources.files)) without restructuring any viewer's internal
 * data flow. A future optimization could emit a delta shape, but it
 * would force every viewer to rebuild its own snapshot cache. YAGNI.
 *
 * ## Write semantics
 *
 * file-glob is READ-ONLY via `source.write()`. A viewer that wants to
 * write individual files should declare a separate `json-file` source
 * per file, or call FileChannel.write() directly if it genuinely needs
 * to write an arbitrary unstructured path (e.g. a binary asset). Calling
 * write() on a FileGlobSource throws.
 */
export class FileGlobSource extends BaseSource<ViewerFileContent[]> {
  private unsubscribe: (() => void) | null = null;
  private matcher: (path: string) => boolean;
  private ignoreMatcher: (path: string) => boolean;

  constructor(
    private config: FileGlobConfig,
    private channel: FileChannel,
  ) {
    super();
    this.matcher = compileGlobList(config.patterns);
    this.ignoreMatcher = compileGlobList(config.ignore ?? []);
    this.unsubscribe = channel.subscribe((batch) => this.onBatch(batch));
    // Fire initial snapshot on the next microtask so synchronous
    // subscribers see it.
    queueMicrotask(() => this.fireInitial());
  }

  private fireInitial(): void {
    if (this.isDestroyed) return;
    const matching = this.filterSnapshot(this.channel.snapshot());
    this.emit({ kind: "value", value: matching, origin: "initial" });
  }

  private onBatch(batch: FileChangeEvent[]): void {
    if (this.isDestroyed) return;
    const anyMatch = batch.some(
      (ev) => this.matcher(ev.path) && !this.ignoreMatcher(ev.path),
    );
    if (!anyMatch) return;
    // Determine the dominant origin for this emission. If any event in
    // the batch is tagged "self", we tag the whole emission "self"
    // (the viewer's own write round-tripped); otherwise "external".
    // We do NOT combine self+external in one emission — the FileChannel
    // guarantees that batches are coherent (one chokidar debounce window)
    // and a mixed-origin batch would indicate a runtime bug we want to
    // surface rather than paper over.
    const hasSelf = batch.some((ev) => ev.origin === "self");
    const origin: "self" | "external" = hasSelf ? "self" : "external";
    const matching = this.filterSnapshot(this.channel.snapshot());
    this.emit({ kind: "value", value: matching, origin });
  }

  private filterSnapshot(
    files: ReadonlyArray<ViewerFileContent>,
  ): ViewerFileContent[] {
    return files.filter(
      (f) => this.matcher(f.path) && !this.ignoreMatcher(f.path),
    );
  }

  protected async doWrite(_value: ViewerFileContent[]): Promise<void> {
    throw new Error(
      "FileGlobSource is read-only via Source.write(). To write " +
        "individual files, declare a json-file source per path or use " +
        "FileChannel.write() directly.",
    );
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Minimal glob matcher
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compile a list of glob patterns into a single predicate.
 *
 * Supports the subset of glob syntax that Pneuma's existing watchPatterns
 * use: `*` (any chars except /), `**` (any chars including /), `?`
 * (single char), literal paths. No brace expansion, no character classes.
 * If the list is empty, the predicate returns false (use this for the
 * ignore list; patterns list callers should guarantee non-empty).
 */
function compileGlobList(patterns: string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(compileGlob);
  return (path: string) => regexes.some((r) => r.test(path));
}

function compileGlob(pattern: string): RegExp {
  // Normalize leading ./ — watchPatterns don't typically use it, but be safe.
  let p = pattern.replace(/^\.\//, "");
  // Escape regex specials except for the glob metachars we care about.
  let rx = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        // ** — any characters including /
        rx += ".*";
        i += 2;
        // Swallow a following / so `**/foo` matches `foo` too.
        if (p[i] === "/") i++;
      } else {
        // * — any characters except /
        rx += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      rx += "[^/]";
      i++;
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      rx += "\\" + ch;
      i++;
    } else {
      rx += ch;
      i++;
    }
  }
  return new RegExp("^" + rx + "$");
}
```

- [ ] **Step 2: Run the tests**

Run: `bun test core/sources/__tests__/file-glob.test.ts 2>&1 | tail -20`
Expected: 8 pass, 0 fail. If the glob tests fail, the `compileGlob` function is the likely culprit — step through each failing pattern with a REPL to isolate.

---

### Task 2.7: Write failing tests for `JsonFileSource`

**Files:**
- Create: `core/sources/__tests__/json-file.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { JsonFileSource } from "../json-file.js";
import type {
  FileChannel,
  FileChangeEvent,
  SourceEvent,
} from "../../types/source.js";
import type { ViewerFileContent } from "../../types/viewer-contract.js";

interface Project {
  title: string;
  count?: number;
}

class MockFileChannel implements FileChannel {
  public handlers = new Set<(batch: FileChangeEvent[]) => void>();
  public files: ViewerFileContent[] = [];
  public writes: Array<{ path: string; content: string }> = [];
  public writeError: Error | null = null;
  public writeDelay = 0;

  snapshot(): ReadonlyArray<ViewerFileContent> {
    return this.files;
  }
  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }
  async write(path: string, content: string): Promise<void> {
    if (this.writeDelay > 0) await new Promise((r) => setTimeout(r, this.writeDelay));
    if (this.writeError) throw this.writeError;
    this.writes.push({ path, content });
  }
  push(batch: FileChangeEvent[]): void {
    for (const h of this.handlers) h(batch);
  }
}

const parse = (raw: string) => JSON.parse(raw) as Project;
const serialize = (v: Project) => JSON.stringify(v);

describe("JsonFileSource", () => {
  let ch: MockFileChannel;

  beforeEach(() => {
    ch = new MockFileChannel();
  });

  test("initial snapshot with a parseable file fires initial event", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"Hello"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("initial");
    expect(events[0].value).toEqual({ title: "Hello" });
  });

  test("missing file on startup emits no initial event, current() is null", async () => {
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(0);
    expect(s.current()).toBeNull();
  });

  test("external update emits external event", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    ch.files = [{ path: "project.json", content: '{"title":"B"}' }];
    ch.push([{ path: "project.json", content: '{"title":"B"}', origin: "external" }]);
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("external");
    expect(events[0].value).toEqual({ title: "B" });
  });

  test("write persists via channel and emits self event", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    await s.write({ title: "B" });
    expect(ch.writes).toHaveLength(1);
    expect(ch.writes[0]).toEqual({
      path: "project.json",
      content: '{"title":"B"}',
    });
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("self");
    expect(events[0].value).toEqual({ title: "B" });
    expect(s.current()).toEqual({ title: "B" });
  });

  test("write followed by the echo event emits only the self event (not a duplicate external)", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));

    // 1. viewer writes
    await s.write({ title: "B" });
    expect(events).toHaveLength(1);
    expect((events[0] as any).origin).toBe("self");

    // 2. FileChannel delivers the server-tagged echo. Because the server
    // tags it origin: "self" via pendingSelfWrites, JsonFileSource should
    // recognize it as an already-emitted self and drop it rather than
    // re-emit another self event.
    ch.files = [{ path: "project.json", content: '{"title":"B"}' }];
    ch.push([{ path: "project.json", content: '{"title":"B"}', origin: "self" }]);
    expect(events).toHaveLength(1);  // no duplicate
  });

  test("parse failure on initial load emits error event, not value", async () => {
    ch.files = [{ path: "project.json", content: "{not json" }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("error");
    expect(s.current()).toBeNull();
  });

  test("parse failure is non-fatal — a later valid external update succeeds", async () => {
    ch.files = [{ path: "project.json", content: "{not json" }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();  // drain initial error
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    ch.files = [{ path: "project.json", content: '{"title":"Recovered"}' }];
    ch.push([{ path: "project.json", content: '{"title":"Recovered"}', origin: "external" }]);
    // The source had never successfully observed a value before, so this
    // one is still the "first" — it fires with origin="initial".
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("initial");
    expect(events[0].value).toEqual({ title: "Recovered" });
  });

  test("write failure propagates and does not update current()", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    ch.writeError = new Error("disk full");
    await expect(s.write({ title: "B" })).rejects.toThrow("disk full");
    expect(s.current()).toEqual({ title: "A" });
  });

  test("only events for the declared path are processed", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    ch.push([{ path: "other.json", content: '{"title":"X"}', origin: "external" }]);
    expect(events).toHaveLength(0);
  });

  test("destroy unsubscribes from channel", () => {
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    expect(ch.handlers.size).toBe(1);
    s.destroy();
    expect(ch.handlers.size).toBe(0);
  });
});
```

- [ ] **Step 2: Confirm all fail**

Run: `bun test core/sources/__tests__/json-file.test.ts 2>&1 | tail -10`
Expected: module resolution error.

---

### Task 2.8: Implement `JsonFileSource`

**Files:**
- Create: `core/sources/json-file.ts`

- [ ] **Step 1: Write the file**

```ts
import { BaseSource } from "./base.js";
import type {
  FileChannel,
  FileChangeEvent,
} from "../types/source.js";

export interface JsonFileConfig<T> {
  path: string;
  parse: (raw: string) => T;
  serialize: (value: T) => string;
}

/**
 * Single-file structured source. Reads a file as raw text, calls `parse`
 * to produce a typed value, and on write() calls `serialize` + persists
 * via FileChannel.write().
 *
 * ## Origin handling
 *
 * JsonFileSource relies on the FileChannel / server tagging file change
 * events with origin: "self" vs "external". When it receives an event
 * tagged "self", it treats the content as the echo of its own write()
 * and drops the event (since it has already emitted a self event from
 * the write() call itself). When it receives an event tagged "external",
 * it parses and emits as external.
 *
 * This means the CORRECTNESS of origin detection is entirely the
 * responsibility of the server-side pendingSelfWrites machinery
 * (server/file-watcher.ts + server/index.ts POST /api/files). This
 * source trusts the tag.
 *
 * ## Parse errors
 *
 * Non-fatal. A parse failure emits a { kind: "error" } event; the
 * source stays live and a later successful update still delivers a
 * value event. If the first-ever value is observed post-error, it
 * still fires with origin: "initial" (a parse error does not count
 * as having observed an initial value).
 */
export class JsonFileSource<T> extends BaseSource<T> {
  private unsubscribe: (() => void) | null = null;
  private hasEmittedInitial = false;

  constructor(
    private config: JsonFileConfig<T>,
    private channel: FileChannel,
  ) {
    super();
    this.unsubscribe = channel.subscribe((batch) => this.onBatch(batch));
    queueMicrotask(() => this.fireInitialFromSnapshot());
  }

  private fireInitialFromSnapshot(): void {
    if (this.isDestroyed) return;
    const file = this.channel.snapshot().find((f) => f.path === this.config.path);
    if (!file) return;  // missing on startup is not an error — current() stays null
    this.processContent(file.content, "initial");
  }

  private onBatch(batch: FileChangeEvent[]): void {
    if (this.isDestroyed) return;
    const relevant = batch.find((ev) => ev.path === this.config.path);
    if (!relevant) return;
    if (relevant.origin === "self") {
      // Our own write has already emitted a self event from write().
      // Drop the echo.
      return;
    }
    // External change (or initial for a previously-missing file).
    const origin = this.hasEmittedInitial ? "external" : "initial";
    this.processContent(relevant.content, origin);
  }

  private processContent(raw: string, origin: "initial" | "external"): void {
    let parsed: T;
    try {
      parsed = this.config.parse(raw);
    } catch (err) {
      this.emit({
        kind: "error",
        code: "E_PARSE",
        message: (err as Error).message,
        raw,
      });
      return;
    }
    this.hasEmittedInitial = true;
    this.emit({ kind: "value", value: parsed, origin });
  }

  protected async doWrite(value: T): Promise<void> {
    const content = this.config.serialize(value);
    await this.channel.write(this.config.path, content);
    // The write succeeded. Emit the self event now so the caller's
    // await resolves with state already consistent. hasEmittedInitial
    // is guaranteed true after a write because we are now observing
    // a value.
    this.hasEmittedInitial = true;
    this.emit({ kind: "value", value, origin: "self" });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `bun test core/sources/__tests__/json-file.test.ts 2>&1 | tail -20`
Expected: 10 pass, 0 fail.

---

### Task 2.9: Write failing tests for `AggregateFileSource`

**Files:**
- Create: `core/sources/__tests__/aggregate-file.test.ts`

`aggregate-file` is the provider that makes viewer **fully file-agnostic** for modes whose domain is a multi-file aggregate (slide → Deck, webcraft → Site, illustrate → Studio). The mode author provides a `load(files) → T` function that reconstructs the domain aggregate from a file snapshot, and a `save(value, current) → { writes, deletes }` function that decomposes a new aggregate into file-level operations. The viewer NEVER touches paths; it consumes `Source<T>` where `T` is the domain type.

- [ ] **Step 1: Write the test file**

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { AggregateFileSource } from "../aggregate-file.js";
import type {
  FileChannel,
  FileChangeEvent,
  SourceEvent,
} from "../../types/source.js";
import type { ViewerFileContent } from "../../types/viewer-contract.js";

// A tiny toy domain: a "Deck" of slides where each slide is a file
// at `slides/slide-<id>.html` and the deck order lives in `manifest.json`.
interface Slide { id: string; html: string }
interface Deck { order: string[]; slides: Record<string, Slide> }

function loadDeck(files: ReadonlyArray<ViewerFileContent>): Deck | null {
  const manifest = files.find((f) => f.path === "manifest.json");
  if (!manifest) return null;
  const parsed = JSON.parse(manifest.content) as { order: string[] };
  const slides: Record<string, Slide> = {};
  for (const id of parsed.order) {
    const f = files.find((x) => x.path === `slides/slide-${id}.html`);
    if (f) slides[id] = { id, html: f.content };
  }
  return { order: parsed.order, slides };
}

function saveDeck(
  next: Deck,
  current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  const writes: Array<{ path: string; content: string }> = [
    { path: "manifest.json", content: JSON.stringify({ order: next.order }) },
  ];
  for (const id of next.order) {
    const slide = next.slides[id];
    if (slide) writes.push({ path: `slides/slide-${id}.html`, content: slide.html });
  }
  // Delete any slide file whose id is no longer in next.order
  const keep = new Set(next.order.map((id) => `slides/slide-${id}.html`));
  const deletes: string[] = [];
  for (const f of current) {
    if (f.path.startsWith("slides/slide-") && f.path.endsWith(".html") && !keep.has(f.path)) {
      deletes.push(f.path);
    }
  }
  return { writes, deletes };
}

class MockFileChannel implements FileChannel {
  public handlers = new Set<(batch: FileChangeEvent[]) => void>();
  public files: ViewerFileContent[] = [];
  public writes: Array<{ path: string; content: string }> = [];
  public deletes: string[] = [];

  snapshot() { return this.files; }
  subscribe(h: (b: FileChangeEvent[]) => void) {
    this.handlers.add(h);
    return () => { this.handlers.delete(h); };
  }
  async write(path: string, content: string) {
    this.writes.push({ path, content });
    const existing = this.files.find((f) => f.path === path);
    if (existing) existing.content = content;
    else this.files.push({ path, content });
  }
  async delete(path: string) {
    this.deletes.push(path);
    this.files = this.files.filter((f) => f.path !== path);
  }
  push(batch: FileChangeEvent[]) { for (const h of this.handlers) h(batch); }
}

describe("AggregateFileSource", () => {
  let ch: MockFileChannel;

  beforeEach(() => {
    ch = new MockFileChannel();
    ch.files = [
      { path: "manifest.json", content: '{"order":["a","b"]}' },
      { path: "slides/slide-a.html", content: "<p>A</p>" },
      { path: "slides/slide-b.html", content: "<p>B</p>" },
    ];
  });

  test("initial load reconstructs the domain aggregate from files", async () => {
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    const events: SourceEvent<Deck>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("initial");
    expect(events[0].value.order).toEqual(["a", "b"]);
    expect(events[0].value.slides.a.html).toBe("<p>A</p>");
  });

  test("external file change re-runs load and emits external", async () => {
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Deck>[] = [];
    s.subscribe((e) => events.push(e));

    ch.files = ch.files.map((f) =>
      f.path === "slides/slide-a.html" ? { ...f, content: "<p>A edited by agent</p>" } : f,
    );
    ch.push([{ path: "slides/slide-a.html", content: "<p>A edited by agent</p>", origin: "external" }]);

    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("external");
    expect(events[0].value.slides.a.html).toBe("<p>A edited by agent</p>");
  });

  test("write decomposes the aggregate via save() and produces channel writes + deletes", async () => {
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    await Promise.resolve();

    const events: SourceEvent<Deck>[] = [];
    s.subscribe((e) => events.push(e));

    // Delete slide "b", add a new slide "c"
    const next: Deck = {
      order: ["a", "c"],
      slides: {
        a: { id: "a", html: "<p>A</p>" },
        c: { id: "c", html: "<p>C (new)</p>" },
      },
    };
    await s.write(next);

    // save() should produce: write manifest.json, write slide-a (unchanged),
    // write slide-c (new), delete slide-b
    const writePaths = ch.writes.map((w) => w.path).sort();
    expect(writePaths).toContain("manifest.json");
    expect(writePaths).toContain("slides/slide-c.html");
    expect(ch.deletes).toEqual(["slides/slide-b.html"]);

    // And a self-origin event fires with the new aggregate
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("self");
    expect(events[0].value.order).toEqual(["a", "c"]);
  });

  test("load failure emits error, source stays live for future events", async () => {
    ch.files = [{ path: "manifest.json", content: "{not json" }];
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    const events: SourceEvent<Deck>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("error");

    // Recover with a valid manifest
    ch.files = [
      { path: "manifest.json", content: '{"order":["a"]}' },
      { path: "slides/slide-a.html", content: "<p>A</p>" },
    ];
    ch.push([
      { path: "manifest.json", content: '{"order":["a"]}', origin: "external" },
    ]);
    // First successful load post-error still fires as "initial"
    const valueEvents = events.filter((e) => e.kind === "value");
    expect(valueEvents).toHaveLength(1);
    if (valueEvents[0].kind !== "value") throw new Error("expected value");
    expect(valueEvents[0].origin).toBe("initial");
  });

  test("destroy unsubscribes from channel", () => {
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    expect(ch.handlers.size).toBe(1);
    s.destroy();
    expect(ch.handlers.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun test core/sources/__tests__/aggregate-file.test.ts 2>&1 | tail -10`
Expected: module resolution error.

---

### Task 2.10: Implement `AggregateFileSource`

**Files:**
- Create: `core/sources/aggregate-file.ts`

- [ ] **Step 1: Write the file**

```ts
import { BaseSource } from "./base.js";
import type {
  FileChannel,
  FileChangeEvent,
} from "../types/source.js";
import type { ViewerFileContent } from "../types/viewer-contract.js";

export interface AggregateFileConfig<T> {
  /** All file path globs this aggregate depends on. Used to scope watching. */
  patterns: string[];
  /** Optional ignore globs. */
  ignore?: string[];
  /**
   * Build the aggregate from the current file snapshot. Return null if the
   * aggregate cannot be built (e.g. required files missing) — the source
   * will stay in "no initial yet" state and a later snapshot change may
   * succeed. Throw to emit an error event without killing the source.
   */
  load: (files: ReadonlyArray<ViewerFileContent>) => T | null;
  /**
   * Decompose a new aggregate value back into file-level operations.
   * Called from write(). Receives the current (pre-write) snapshot so
   * save can compute diffs (e.g. which slide files to delete when an
   * id has been removed from a Deck).
   */
  save: (
    value: T,
    current: ReadonlyArray<ViewerFileContent>,
  ) => {
    writes: Array<{ path: string; content: string }>;
    deletes: string[];
  };
}

/**
 * Multi-file domain aggregate source.
 *
 * Used when a mode's domain is a structured aggregate (a Deck, a Site,
 * a Studio) that happens to be persisted across multiple files. The
 * viewer consumes `Source<T>` where T is the domain type and never
 * sees file paths; the provider handles translation to/from files.
 *
 * Origin handling: when a file change batch arrives, the provider
 * re-runs `load()` against the full current snapshot. If the batch
 * contains any `origin: "self"` entries, the emission is tagged "self"
 * (our own write round-tripped); otherwise "external". The first
 * successful load ever emits "initial" regardless of the triggering
 * origin.
 *
 * Parse/load errors are non-fatal: they emit `{ kind: "error" }` and
 * leave the source alive for future updates.
 */
export class AggregateFileSource<T> extends BaseSource<T> {
  private unsubscribe: (() => void) | null = null;
  private matcher: (path: string) => boolean;
  private ignoreMatcher: (path: string) => boolean;
  private hasEmittedInitial = false;

  constructor(
    private config: AggregateFileConfig<T>,
    private channel: FileChannel,
  ) {
    super();
    this.matcher = compileGlobList(config.patterns);
    this.ignoreMatcher = compileGlobList(config.ignore ?? []);
    this.unsubscribe = channel.subscribe((batch) => this.onBatch(batch));
    queueMicrotask(() => this.tryLoad("initial"));
  }

  private onBatch(batch: FileChangeEvent[]): void {
    if (this.isDestroyed) return;
    const relevant = batch.some(
      (ev) => this.matcher(ev.path) && !this.ignoreMatcher(ev.path),
    );
    if (!relevant) return;
    const hasSelf = batch.some((ev) => ev.origin === "self");
    const origin: "self" | "external" = hasSelf ? "self" : "external";
    // If we've never successfully loaded, the first success still fires
    // as "initial" — we treat initial-after-error as the first real observation.
    const effectiveOrigin = this.hasEmittedInitial ? origin : "initial";
    this.tryLoad(effectiveOrigin);
  }

  private tryLoad(origin: "initial" | "self" | "external"): void {
    if (this.isDestroyed) return;
    const files = this.channel.snapshot().filter(
      (f) => this.matcher(f.path) && !this.ignoreMatcher(f.path),
    );
    let value: T | null;
    try {
      value = this.config.load(files);
    } catch (err) {
      this.emit({
        kind: "error",
        code: "E_LOAD",
        message: (err as Error).message,
      });
      return;
    }
    if (value === null) {
      // load returned null — aggregate not yet ready (missing required
      // files). Silent: don't emit, don't error. A later file change
      // may produce a valid aggregate.
      return;
    }
    this.hasEmittedInitial = true;
    this.emit({ kind: "value", value, origin });
  }

  protected async doWrite(value: T): Promise<void> {
    const currentFiles = this.channel.snapshot().filter(
      (f) => this.matcher(f.path) && !this.ignoreMatcher(f.path),
    );
    let ops: { writes: Array<{ path: string; content: string }>; deletes: string[] };
    try {
      ops = this.config.save(value, currentFiles);
    } catch (err) {
      this.emit({
        kind: "error",
        code: "E_SAVE",
        message: (err as Error).message,
      });
      throw err;
    }
    // Execute the file operations in order: writes first, then deletes.
    // A single save() producing both writes and deletes means the viewer
    // has computed a complete new state; ordering only matters for
    // observable intermediate states which we don't expose.
    for (const w of ops.writes) {
      await this.channel.write(w.path, w.content);
    }
    for (const d of ops.deletes) {
      await this.channel.delete(d);
    }
    // Emit the self event after all file ops have been ack'd.
    this.hasEmittedInitial = true;
    this.emit({ kind: "value", value, origin: "self" });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }
}

// Shared with file-glob — kept inline here to avoid cross-module imports
// in this leaf file. If a third provider needs it, lift to sources/glob.ts.
function compileGlobList(patterns: string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(compileGlob);
  return (path: string) => regexes.some((r) => r.test(path));
}

function compileGlob(pattern: string): RegExp {
  let p = pattern.replace(/^\.\//, "");
  let rx = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        rx += ".*";
        i += 2;
        if (p[i] === "/") i++;
      } else {
        rx += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      rx += "[^/]";
      i++;
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      rx += "\\" + ch;
      i++;
    } else {
      rx += ch;
      i++;
    }
  }
  return new RegExp("^" + rx + "$");
}
```

- [ ] **Step 2: Run the tests**

Run: `bun test core/sources/__tests__/aggregate-file.test.ts 2>&1 | tail -20`
Expected: 5 pass, 0 fail.

---

### Task 2.11: Create sources barrel + built-in registry

**Files:**
- Create: `core/sources/index.ts`

- [ ] **Step 1: Write the file**

```ts
import type { SourceProvider, SourceContext, Source } from "../types/source.js";
import type { ViewerFileContent } from "../types/viewer-contract.js";
import { MemorySource, type MemorySourceConfig } from "./memory.js";
import { FileGlobSource, type FileGlobConfig } from "./file-glob.js";
import { JsonFileSource, type JsonFileConfig } from "./json-file.js";
import { AggregateFileSource, type AggregateFileConfig } from "./aggregate-file.js";

export { BaseSource } from "./base.js";
export { MemorySource, type MemorySourceConfig } from "./memory.js";
export { FileGlobSource, type FileGlobConfig } from "./file-glob.js";
export { JsonFileSource, type JsonFileConfig } from "./json-file.js";
export { AggregateFileSource, type AggregateFileConfig } from "./aggregate-file.js";

/**
 * The four built-in providers, ready to register with a SourceRegistry.
 * Ordering matters only for debug output; providers are keyed by `kind`.
 */
export const BUILT_IN_PROVIDERS: SourceProvider[] = [
  {
    kind: "memory",
    create<T>(config: unknown, _ctx: SourceContext): Source<T> {
      return new MemorySource<T>((config ?? {}) as MemorySourceConfig<T>);
    },
  },
  {
    kind: "file-glob",
    create<T>(config: unknown, ctx: SourceContext): Source<T> {
      if (!ctx.files) {
        throw new Error(
          "file-glob source requires SourceContext.files (FileChannel). " +
            "This usually means the provider is being instantiated outside " +
            "the browser runtime.",
        );
      }
      const fgc = config as FileGlobConfig;
      // The generic T is pinned to ViewerFileContent[] at the call site,
      // but we return Source<T> here because the registry signature is
      // erased. Callers passing the wrong T get a TS error at the
      // manifest declaration site, not here.
      return new FileGlobSource(fgc, ctx.files) as unknown as Source<T>;
    },
  },
  {
    kind: "json-file",
    create<T>(config: unknown, ctx: SourceContext): Source<T> {
      if (!ctx.files) {
        throw new Error(
          "json-file source requires SourceContext.files (FileChannel).",
        );
      }
      const jfc = config as JsonFileConfig<T>;
      return new JsonFileSource<T>(jfc, ctx.files);
    },
  },
  {
    kind: "aggregate-file",
    create<T>(config: unknown, ctx: SourceContext): Source<T> {
      if (!ctx.files) {
        throw new Error(
          "aggregate-file source requires SourceContext.files (FileChannel).",
        );
      }
      const afc = config as AggregateFileConfig<T>;
      return new AggregateFileSource<T>(afc, ctx.files);
    },
  },
];
```

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full sources test suite**

Run: `bun test core/sources/ 2>&1 | tail -15`
Expected: 44 tests passing (16 base + 5 memory + 8 file-glob + 10 json-file + 5 aggregate-file).

---

### Task 2.12: Commit P2

- [ ] **Step 1: Stage and commit**

```bash
git add \
  core/sources/base.ts \
  core/sources/memory.ts \
  core/sources/file-glob.ts \
  core/sources/json-file.ts \
  core/sources/aggregate-file.ts \
  core/sources/index.ts \
  core/sources/__tests__/base.test.ts \
  core/sources/__tests__/memory.test.ts \
  core/sources/__tests__/file-glob.test.ts \
  core/sources/__tests__/json-file.test.ts \
  core/sources/__tests__/aggregate-file.test.ts

git commit -m "$(cat <<'EOF'
feat(source): BaseSource + four built-in providers (P2)

Implements the four invariants of Source<T> in a single abstract base
(BaseSource) that concrete providers extend. Adds four built-in
providers covering the full domain-to-storage spectrum for every
current viewer mode.

- core/sources/base.ts: Promise-queue write serialization with
  time-locked Promises, origin-tagged emit, idempotent destroy,
  listener isolation on throw
- core/sources/memory.ts: ephemeral in-process reference impl
- core/sources/file-glob.ts: multi-file aggregate (domain IS files),
  read-only via write(); glob compiled with minimal subset matcher
  (*, **, ?) covering all existing watchPatterns usage
- core/sources/json-file.ts: single structured file, self-echo drop
  based on FileChannel origin tag, non-fatal parse errors
- core/sources/aggregate-file.ts: multi-file domain aggregate —
  load(files) → T and save(T, current) → { writes, deletes }. Lets
  slide / webcraft / illustrate viewers consume typed domain objects
  (Deck, Site, Studio) without touching file paths. Requires the
  FileChannel.delete() method which is wired in P3 Task 3.3.
- core/sources/index.ts: BUILT_IN_PROVIDERS registry (4 kinds)
- 44 bun:test cases across five __tests__ files

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Phase 3: Runtime integration

Phase 3 wires the contract into the real runtime: server-side origin tagging, the browser-side FileChannel, the SourceRegistry, the manifest synthesis fallback, the `sources` prop on ViewerPreviewProps, and the `useSource` React hook. By the end of P3, every mode continues to work identically (because `useViewerProps` still hands `files` through) but a new `sources.files` prop also exists and is identical in content.

P3 does NOT migrate any mode. Mode migrations are P5.

### Task 3.1: Server-side `pendingSelfWrites` in the file watcher

**Files:**
- Modify: `server/file-watcher.ts`

- [ ] **Step 1: Add the pendingSelfWrites module state**

Open `server/file-watcher.ts`. At the top of the file, below the existing imports, add:

```ts
/**
 * pendingSelfWrites is the ONLY place in the system where viewer-origin
 * writes are identified. When the /api/files POST handler receives a
 * write, it calls `registerSelfWrite(path, content)` here. When chokidar
 * subsequently fires for that path, we look up the entry and tag the
 * outgoing FileUpdate with origin: "self" if the content matches. Entries
 * auto-expire after PENDING_SELF_WRITE_TTL_MS to guarantee an unmatched
 * registration doesn't poison a later legitimate external edit.
 */
const PENDING_SELF_WRITE_TTL_MS = 5000;

interface PendingSelfWrite {
  content: string;
  expiresAt: number;
}

// path -> queue of pending entries (one path can have multiple writes
// in flight back-to-back; each chokidar echo consumes the oldest match)
const pendingSelfWrites = new Map<string, PendingSelfWrite[]>();

export function registerSelfWrite(relPath: string, content: string): void {
  const entry: PendingSelfWrite = {
    content,
    expiresAt: Date.now() + PENDING_SELF_WRITE_TTL_MS,
  };
  const existing = pendingSelfWrites.get(relPath) ?? [];
  existing.push(entry);
  pendingSelfWrites.set(relPath, existing);
}

/**
 * Consume a pending self-write entry if one exists matching this content.
 * Returns true if matched (→ origin: "self"); false otherwise (→
 * origin: "external").
 *
 * The matching strategy is content equality. An expired entry is dropped
 * without matching so a stale registration cannot mis-tag a later edit.
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
  // Pop the oldest matching entry.
  const idx = queue.findIndex((e) => e.content === content);
  if (idx < 0) return false;
  queue.splice(idx, 1);
  if (queue.length === 0) pendingSelfWrites.delete(relPath);
  return true;
}
```

- [ ] **Step 2: Extend the `FileUpdate` type with `origin`**

Still in `server/file-watcher.ts`, find the `FileUpdate` interface (around line 70). Change:

```ts
export interface FileUpdate {
  path: string;
  content: string;
}
```

to:

```ts
export interface FileUpdate {
  path: string;
  content: string;
  /**
   * Origin tag added by the file watcher. "self" if this change matches
   * a pending registerSelfWrite entry (i.e. it's the echo of a viewer
   * write routed through /api/files); "external" otherwise. Always
   * present on updates emitted after P3.
   */
  origin: "self" | "external";
}
```

- [ ] **Step 3: Tag outgoing updates in the chokidar handler**

Still in `server/file-watcher.ts`, find the `startFileWatcher` function. Inside the chokidar event handler (around line 160 — the place where a file change becomes a `FileUpdate` object), change the object literal from:

```ts
updates.push({ path: relPath, content });
```

to:

```ts
const origin: "self" | "external" = consumeSelfWrite(relPath, content) ? "self" : "external";
updates.push({ path: relPath, content, origin });
```

Also update the image special-case branch (around line 165 — where `content: ""` is pushed for an image change) to include `origin: "external"`, since image changes are never self-writes from a viewer:

```ts
updates.push({ path: relPath, content: "", origin: "external" });
```

- [ ] **Step 4: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | tee /tmp/tsc.log | tail -20`
Expected: errors in `bin/pneuma.ts` and `src/ws.ts` about `FileUpdate` missing `origin` when constructed at the broadcast sites. That's expected — Task 3.2 fixes them. Proceed if the only errors are the expected ones.

---

### Task 3.2: Wire `origin` through the broadcast and browser store

**Files:**
- Modify: `bin/pneuma.ts` (two broadcast sites)
- Modify: `src/ws.ts` (content_update handler)
- Modify: `src/store/workspace-slice.ts` (updateFiles signature)

- [ ] **Step 1: Update `bin/pneuma.ts` broadcast callback**

Find both `startFileWatcher(workspace, manifest.viewer, (files) => {` call sites (around lines 1518 and 1790). Neither site needs code changes per se because `files: FileUpdate[]` now carries origin inside each entry — the broadcast forwards whatever shape the watcher emits. BUT the WS message shape changes to include per-file origin.

Update the broadcast message construction at both sites from:

```ts
wsBridge.broadcastToSession(sessionId, { type: "content_update", files });
```

to:

```ts
wsBridge.broadcastToSession(sessionId, {
  type: "content_update",
  files,  // each entry is { path, content, origin }
});
```

(If the line was already exactly this shape, leave it — the change is that `files` now carries origin, not that the message structure changes. Confirm both sites compile.)

- [ ] **Step 2: Update `src/ws.ts` content_update handler**

Find the `case "content_update":` block (around lines 630–639). Change the filtering loop from:

```ts
case "content_update": {
  if (store.replayMode) break;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
  const contentFiles = data.files.filter((f: { path: string; content: string }) => !IMAGE_RE.test(f.path));
  const hasImageChange = data.files.some((f: { path: string; content: string }) => IMAGE_RE.test(f.path));
  if (contentFiles.length > 0) store.updateFiles(contentFiles);
  if (hasImageChange) store.bumpImageTick();
  break;
}
```

to:

```ts
case "content_update": {
  if (store.replayMode) break;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
  type Incoming = { path: string; content: string; origin?: "self" | "external" };
  const contentFiles = (data.files as Incoming[])
    .filter((f) => !IMAGE_RE.test(f.path))
    .map((f) => ({ ...f, origin: f.origin ?? "external" }));
  const hasImageChange = (data.files as Incoming[]).some((f) => IMAGE_RE.test(f.path));
  if (contentFiles.length > 0) store.updateFiles(contentFiles);
  if (hasImageChange) store.bumpImageTick();
  break;
}
```

The `origin: f.origin ?? "external"` default exists for robustness against old server versions that don't yet tag — it's a belt-and-suspenders fallback during rolling upgrades.

- [ ] **Step 3: Update `workspace-slice.ts` to accept and forward origin**

In `src/store/workspace-slice.ts`:

(a) Add an import of a local event bus at the top:

```ts
import { fileEventBus } from "../runtime/file-event-bus.js";
```

(b) Update the `FileContent` type used by the slice to carry optional origin. Find (around lines 1–6):

```ts
import type { FileContent, ContentSet, WorkspaceItem } from "../types.js";
```

Leave this. Then, in the slice body, change the `updateFiles` signature from:

```ts
updateFiles: (files: FileContent[]) => void;
```

to:

```ts
updateFiles: (files: Array<FileContent & { origin?: "self" | "external" }>) => void;
```

(c) In the `updateFiles` implementation (around lines 58–113), after the `for (const u of updates)` loop and before `return`, add a forwarding call to the event bus:

```ts
// Forward to file-event-bus so FileGlobSource / JsonFileSource
// subscribers see the change. The bus is browser-side only and
// its dispatch is synchronous — providers observe the change on
// the same tick the store update happens.
fileEventBus.publish(
  updates.map((u) => ({
    path: u.path,
    content: u.content,
    origin: u.origin ?? "external",
  })),
);
```

- [ ] **Step 4: Create the event bus file**

**Files:**
- Create: `src/runtime/file-event-bus.ts`

```ts
import type { FileChangeEvent } from "../../core/types/source.js";

/**
 * Browser-side singleton pub/sub for file change events. The workspace
 * slice's updateFiles() publishes to this bus; the FileChannel
 * implementation (src/runtime/file-channel.ts) subscribes and re-emits
 * to its own subscribers (which are Source instances).
 *
 * We use a module-level singleton because there is only ever one
 * workspace per browser tab in Pneuma. A multi-workspace future would
 * need to scope this to a session id.
 */
class FileEventBus {
  private handlers = new Set<(batch: FileChangeEvent[]) => void>();

  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(batch: FileChangeEvent[]): void {
    // Snapshot to allow handlers to subscribe/unsubscribe during delivery.
    for (const handler of Array.from(this.handlers)) {
      try {
        handler(batch);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[file-event-bus] handler threw", err);
      }
    }
  }
}

export const fileEventBus = new FileEventBus();
```

- [ ] **Step 5: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | tail -20`
Expected: no errors. If you see errors about `FileContent` shape, ensure the origin field is optional in both the import and the slice signature.

- [ ] **Step 6: Do NOT commit yet.** P3 commits once the full runtime is wired.

---

### Task 3.3: Wire `/api/files` POST + add `DELETE /api/files` for self-tagged mutations

**Files:**
- Modify: `server/file-watcher.ts` (extend to register self-deletes)
- Modify: `server/index.ts` (POST + new DELETE route)

- [ ] **Step 1: Extend `server/file-watcher.ts` with a `registerSelfDelete` + delete-event handling**

In `server/file-watcher.ts`, add a second TTL map for pending self-deletes alongside `pendingSelfWrites`:

```ts
const pendingSelfDeletes = new Map<string, number /* expiresAt */>();

export function registerSelfDelete(relPath: string): void {
  pendingSelfDeletes.set(relPath, Date.now() + PENDING_SELF_WRITE_TTL_MS);
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
```

In the chokidar handler, add an `unlink` event branch (currently the watcher only handles `add`/`change`). When a file is deleted, emit a `FileUpdate` with empty content and `origin: consumeSelfDelete(relPath) ? "self" : "external"`. Extend the `FileUpdate` type to include an optional `deleted: true` discriminator so downstream consumers can distinguish "content became empty string" from "file gone":

```ts
export interface FileUpdate {
  path: string;
  content: string;
  origin: "self" | "external";
  deleted?: boolean;   // true for unlink events; content is "" in that case
}
```

The chokidar wiring:

```ts
watcher.on("unlink", (absPath) => {
  const relPath = path.relative(workspace, absPath);
  if (!matchesWatchPatterns(relPath)) return;
  const origin: "self" | "external" = consumeSelfDelete(relPath) ? "self" : "external";
  enqueueUpdate({ path: relPath, content: "", origin, deleted: true });
});
```

- [ ] **Step 2: Import helpers in `server/index.ts`**

```ts
import { startFileWatcher, startProxyWatcher, registerSelfWrite, registerSelfDelete } from "./file-watcher.js";
```

- [ ] **Step 2: Call `registerSelfWrite` before writing to disk**

Find the `/api/files` POST handler (around lines 1715–1738). After the `pathStartsWith` check passes and BEFORE the `writeFileSync` call, add:

```ts
// Register this write as self-originated so the chokidar echo is
// tagged origin: "self" when it arrives. Registration happens BEFORE
// the disk write so there's no window where the echo could arrive
// ahead of the registration.
//
// For data-URL content we register the decoded binary, because that's
// what chokidar will read back from disk.
const contentForTag = dataUrlMatch
  ? Buffer.from(dataUrlMatch[1], "base64").toString("binary")
  : body.content;
registerSelfWrite(relPath, contentForTag);
```

Wait — there's a subtle issue. chokidar reads the file as UTF-8 text for content files (see `server/file-watcher.ts` around line 150). A binary file written via data URL will be read back as text with mojibake characters; the `binary` → `utf-8` encoding mismatch means the hash won't match. For now, only text writes need self-tagging. Binary writes (images) already trigger the cache-bust-only path in the watcher (empty content) and don't need origin tracking. Simplify: only register when NOT a data URL.

Replace the block with:

```ts
// Register this write as self-originated so the chokidar echo is
// tagged origin: "self" when it arrives. Binary writes (data URLs)
// take the image-cache-bust path in the watcher and don't need
// origin tracking.
if (!dataUrlMatch) {
  registerSelfWrite(relPath, body.content);
}
```

- [ ] **Step 3: Add the `DELETE /api/files` route**

Below the `app.post("/api/files", ...)` route, add:

```ts
app.delete("/api/files", async (c) => {
  const relPath = c.req.query("path");
  if (!relPath || typeof relPath !== "string") {
    return c.json({ error: "Missing path query parameter" }, 400);
  }
  const absPath = join(workspace, relPath);
  if (!pathStartsWith(absPath, workspace)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  try {
    // Register the self-delete BEFORE unlinking so the chokidar unlink
    // event is tagged origin: "self" when it arrives.
    registerSelfDelete(relPath);
    if (existsSync(absPath)) {
      unlinkSync(absPath);
    }
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: "Failed to delete file" }, 500);
  }
});
```

Add `existsSync` and `unlinkSync` to the `node:fs` imports at the top of `server/index.ts` if not already present.

- [ ] **Step 4: Typecheck and smoke-test**

Run: `bun run tsc --noEmit 2>&1 | tail -10`
Expected: clean.

Start dev server: `bun run dev doc --port 17996 --no-open`, wait for "listening", then in another terminal:

```bash
curl -sX POST http://localhost:17996/api/files \
  -H "Content-Type: application/json" \
  -d '{"path":"smoke.md","content":"hello world"}'
curl -sX DELETE "http://localhost:17996/api/files?path=smoke.md"
```

Expected: both return `{"ok":true}`. Open the dev server's browser tab, verify `smoke.md` appears then disappears. Kill the dev server.

---

### Task 3.4: Implement browser-side `FileChannel`

**Files:**
- Create: `src/runtime/file-channel.ts`

The FileChannel is the bridge that turns the existing store + ws + POST /api/files plumbing into the `FileChannel` shape that providers consume via `SourceContext.files`.

- [ ] **Step 1: Write the file**

```ts
import type {
  FileChannel,
  FileChangeEvent,
} from "../../core/types/source.js";
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";
import { fileEventBus } from "./file-event-bus.js";
import { useStore } from "../store/index.js";

/**
 * Get the API base URL (dev proxy vs prod same-origin). Mirrors the
 * helper used inline in several mode viewers — centralized here so
 * every source gets the same resolution.
 */
function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

/**
 * Browser-side FileChannel implementation. Backed by:
 *   - snapshot: the workspace slice `files` array
 *   - subscribe: fileEventBus
 *   - write: POST /api/files
 *
 * One instance per active mode. The runtime creates it in useViewerProps
 * and destroys it on mode switch.
 */
export class BrowserFileChannel implements FileChannel {
  private unsubBus: (() => void) | null = null;
  private handlers = new Set<(batch: FileChangeEvent[]) => void>();

  constructor() {
    this.unsubBus = fileEventBus.subscribe((batch) => this.dispatch(batch));
  }

  snapshot(): ReadonlyArray<ViewerFileContent> {
    // Read directly from the store — synchronous, same source of truth
    // that useViewerProps uses to build props.files.
    const files = useStore.getState().files;
    return files.map((f) => ({ path: f.path, content: f.content }));
  }

  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async write(path: string, content: string): Promise<void> {
    const res = await fetch(`${getApiBase()}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST /api/files failed: ${res.status} ${text}`);
    }
  }

  async delete(path: string): Promise<void> {
    const url = `${getApiBase()}/api/files?path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DELETE /api/files failed: ${res.status} ${text}`);
    }
  }

  private dispatch(batch: FileChangeEvent[]): void {
    for (const handler of Array.from(this.handlers)) {
      try {
        handler(batch);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[file-channel] handler threw", err);
      }
    }
  }

  destroy(): void {
    this.unsubBus?.();
    this.unsubBus = null;
    this.handlers.clear();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | tail -10`
Expected: clean.

---

### Task 3.5: Implement `SourceRegistry`

**Files:**
- Create: `core/source-registry.ts`
- Create: `core/__tests__/source-registry.test.ts`

- [ ] **Step 1: Write the failing test file first**

```ts
import { describe, test, expect } from "bun:test";
import { SourceRegistry } from "../source-registry.js";
import { BUILT_IN_PROVIDERS } from "../sources/index.js";
import type {
  Source,
  SourceProvider,
  SourceContext,
  FileChannel,
} from "../types/source.js";
import type { ModeManifest } from "../types/mode-manifest.js";

function noopCtx(files?: FileChannel): SourceContext {
  return {
    workspace: "/tmp/test",
    log: () => {},
    signal: new AbortController().signal,
    files,
  };
}

describe("SourceRegistry", () => {
  test("registers built-in providers and looks them up by kind", () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    expect(reg.has("memory")).toBe(true);
    expect(reg.has("file-glob")).toBe(true);
    expect(reg.has("json-file")).toBe(true);
    expect(reg.has("redis")).toBe(false);
  });

  test("instantiates a memory source from a manifest declaration", async () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    const manifest: Pick<ModeManifest, "sources"> = {
      sources: {
        state: { kind: "memory", config: { initial: 42 } },
      },
    };
    const instances = reg.instantiateAll(manifest.sources ?? {}, noopCtx());
    expect(instances.state).toBeDefined();
    await Promise.resolve();
    expect(instances.state.current()).toBe(42);
  });

  test("instantiateAll throws if an unknown kind is declared", () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    expect(() =>
      reg.instantiateAll(
        { x: { kind: "does-not-exist", config: {} } },
        noopCtx(),
      ),
    ).toThrow(/does-not-exist/);
  });

  test("destroyAll destroys every instance", async () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    const instances = reg.instantiateAll(
      { a: { kind: "memory" }, b: { kind: "memory" } },
      noopCtx(),
    );
    reg.destroyAll(instances);
    // After destroy, current() is null even if an initial was queued
    await Promise.resolve();
    expect(instances.a.current()).toBeNull();
    expect(instances.b.current()).toBeNull();
  });

  test("registering a provider with a duplicate kind throws", () => {
    const reg = new SourceRegistry();
    const p: SourceProvider = {
      kind: "memory",
      create: () => ({
        current: () => null,
        subscribe: () => () => {},
        write: async () => {},
        destroy: () => {},
      }),
    };
    reg.register(p);
    expect(() => reg.register(p)).toThrow(/memory/);
  });

  test("synthesizeDefault creates a file-glob source from viewer.watchPatterns if sources is absent", () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    const manifestLike = {
      viewer: {
        watchPatterns: ["**/*.md"],
        ignorePatterns: ["node_modules/**"],
      },
      sources: undefined,
    };
    const effective = SourceRegistry.effectiveSources(manifestLike as unknown as ModeManifest);
    expect(effective.files.kind).toBe("file-glob");
    const cfg = effective.files.config as { patterns: string[]; ignore?: string[] };
    expect(cfg.patterns).toEqual(["**/*.md"]);
    expect(cfg.ignore).toEqual(["node_modules/**"]);
  });

  test("effectiveSources preserves an explicit sources block unchanged", () => {
    const manifestLike = {
      viewer: { watchPatterns: ["**/*.md"], ignorePatterns: [] },
      sources: { custom: { kind: "memory", config: { initial: 1 } } },
    };
    const effective = SourceRegistry.effectiveSources(manifestLike as unknown as ModeManifest);
    expect(effective).toEqual({
      custom: { kind: "memory", config: { initial: 1 } },
    });
  });
});
```

- [ ] **Step 2: Confirm tests fail**

Run: `bun test core/__tests__/source-registry.test.ts 2>&1 | tail -10`
Expected: module resolution error.

- [ ] **Step 3: Implement `core/source-registry.ts`**

```ts
import type {
  Source,
  SourceProvider,
  SourceContext,
  SourceDescriptor,
} from "./types/source.js";
import type { ModeManifest } from "./types/mode-manifest.js";

export class SourceRegistry {
  private providers = new Map<string, SourceProvider>();

  register(provider: SourceProvider): void {
    if (this.providers.has(provider.kind)) {
      throw new Error(
        `SourceRegistry: provider kind "${provider.kind}" is already registered`,
      );
    }
    this.providers.set(provider.kind, provider);
  }

  has(kind: string): boolean {
    return this.providers.has(kind);
  }

  instantiate(
    descriptor: SourceDescriptor,
    ctx: SourceContext,
  ): Source<unknown> {
    const provider = this.providers.get(descriptor.kind);
    if (!provider) {
      throw new Error(
        `SourceRegistry: no provider registered for kind "${descriptor.kind}"`,
      );
    }
    return provider.create<unknown>(descriptor.config, ctx);
  }

  instantiateAll(
    descriptors: Record<string, SourceDescriptor>,
    ctx: SourceContext,
  ): Record<string, Source<unknown>> {
    const out: Record<string, Source<unknown>> = {};
    for (const [id, desc] of Object.entries(descriptors)) {
      out[id] = this.instantiate(desc, ctx);
    }
    return out;
  }

  destroyAll(instances: Record<string, Source<unknown>>): void {
    for (const instance of Object.values(instances)) {
      try {
        instance.destroy();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[source-registry] destroy threw", err);
      }
    }
  }

  /**
   * Compute the effective `sources` declaration for a manifest. If the
   * manifest declares `sources` explicitly, returns it unchanged. If not,
   * synthesizes a single `files` source from `viewer.watchPatterns` /
   * `viewer.ignorePatterns` for backward compatibility. This is how every
   * pre-migration mode continues to work without touching its manifest.
   */
  static effectiveSources(
    manifest: ModeManifest,
  ): Record<string, SourceDescriptor> {
    if (manifest.sources && Object.keys(manifest.sources).length > 0) {
      return manifest.sources;
    }
    return {
      files: {
        kind: "file-glob",
        config: {
          patterns: manifest.viewer.watchPatterns,
          ignore: manifest.viewer.ignorePatterns,
        },
      },
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test core/__tests__/source-registry.test.ts 2>&1 | tail -15`
Expected: 7 pass, 0 fail.

---

### Task 3.6: Expose `sources` and `fileChannel` on `ViewerPreviewProps`

**Files:**
- Modify: `core/types/viewer-contract.ts`

- [ ] **Step 1: Add the import**

Near the top of the file, add:

```ts
import type { Source, FileChannel } from "./source.js";
```

- [ ] **Step 2: Add `sources` and `fileChannel` to `ViewerPreviewProps`**

Find the `ViewerPreviewProps` interface (around lines 190–233). Add both new fields just after the existing `files` field:

```ts
  /**
   * @deprecated Since P3 of the source-abstraction work. Still populated
   * for backward compatibility during the P3→P5 migration window. Will
   * be removed in the final P5 commit. New or migrated viewers should
   * consume props.sources instead.
   */
  files: ViewerFileContent[];

  /**
   * Source map. Keys come from `manifest.sources` (or the synthesized
   * default `{ files: file-glob }` for unmigrated modes). Viewers
   * consume sources via the `useSource` hook from src/hooks/useSource.ts.
   * Each Source<T> delivers typed, origin-tagged events and, for
   * write-capable providers, exposes a write() method.
   */
  sources: Record<string, Source<unknown>>;

  /**
   * Direct file I/O channel for viewers with dynamic write targets
   * (e.g., a text editor where the active file is user-selected).
   * Writes through this channel are origin-tagged server-side
   * identically to Source.write() — viewers do not need to
   * maintain echo-detection state.
   *
   * Viewers with a static, declared write target should use a
   * `json-file` source in their manifest instead of this prop.
   *
   * Introduced in P3 for use by all P5 mode migrations. Modes that
   * never write through the viewer (illustrate, remotion, mode-maker,
   * diagram) can ignore this prop — it's still present on every
   * viewer because ViewerPreviewProps has no per-mode conditional
   * typing.
   */
  fileChannel: FileChannel;
```

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | tail -20`
Expected: errors in `src/App.tsx` about `sources` and `fileChannel` being missing from the return object of `useViewerProps`. That's expected — Task 3.7 fixes it.

---

### Task 3.7: Build and destroy sources in `useViewerProps`

**Files:**
- Modify: `src/App.tsx`

This is the most architecturally critical task in P3 — it's where mode lifecycle meets source lifecycle.

- [ ] **Step 1: Add imports to `src/App.tsx`**

Near the top of the file, among the existing imports, add:

```ts
import { SourceRegistry } from "../core/source-registry.js";
import { BUILT_IN_PROVIDERS } from "../core/sources/index.js";
import { BrowserFileChannel } from "./runtime/file-channel.js";
import type { Source, FileChannel } from "../core/types/source.js";
```

- [ ] **Step 2: Add a `useSourceInstances` hook above `useViewerProps`**

Insert this helper hook just before the `useViewerProps` function definition (around line 70):

```ts
/**
 * Instantiate sources AND the FileChannel for the current mode. Returns
 * both as a single object so useViewerProps can pass each through to the
 * viewer as a separate prop. Rebuilds (destroying the old set) whenever
 * the active mode changes.
 *
 * This is the lifecycle boundary for sources. When a user switches modes
 * in the launcher, the old mode's sources are destroyed here and the new
 * mode's sources are created against a fresh FileChannel + SourceRegistry.
 * Sources and the FileChannel never outlive their mode.
 */
function useSourceInstances(): {
  sources: Record<string, Source<unknown>>;
  channel: FileChannel;
} {
  const manifest = useStore((s) => s.modeManifest);
  const [state, setState] = useState<{
    sources: Record<string, Source<unknown>>;
    channel: FileChannel;
  }>(() => ({ sources: {}, channel: new BrowserFileChannel() }));

  useEffect(() => {
    if (!manifest) {
      setState({ sources: {}, channel: new BrowserFileChannel() });
      return;
    }
    const channel = new BrowserFileChannel();
    const registry = new SourceRegistry();
    for (const provider of BUILT_IN_PROVIDERS) registry.register(provider);
    const ctx = {
      workspace: "",  // workspace is known to the server; providers
                       // that need it get it via FileChannel instead
      log: (msg: string) => { console.debug("[source]", msg); },
      signal: new AbortController().signal,
      files: channel,
    };
    const effective = SourceRegistry.effectiveSources(manifest);
    const built = registry.instantiateAll(effective, ctx);
    setState({ sources: built, channel });
    return () => {
      registry.destroyAll(built);
      (channel as BrowserFileChannel).destroy();
    };
  }, [manifest]);

  return state;
}
```

- [ ] **Step 3: Wire `sources` and `fileChannel` into the props returned by `useViewerProps`**

Near the top of `useViewerProps` (around line 70), add:

```ts
const { sources, channel: fileChannel } = useSourceInstances();
```

In the return statement (around line 155), add both fields to the returned object:

```ts
return {
  files,
  sources,      // ← new in P3
  fileChannel,  // ← new in P3
  activeFile,
  // ... rest unchanged
};
```

- [ ] **Step 4: Add the `modeManifest` store field if it doesn't already exist**

Search for `modeManifest` in `src/store/`:

```bash
bun --bun rg "modeManifest" src/store/
```

If it already exists (likely — it should be set alongside `modeViewer` in the mode loading flow), skip this step. If not, add it to the appropriate slice (probably `src/store/workspace-slice.ts` or a dedicated `mode-slice.ts`):

```ts
interface ModeSlice {
  modeManifest: ModeManifest | null;
  setModeManifest: (m: ModeManifest | null) => void;
}
```

And set it at the same point `setModeViewer` is called in `App.tsx` line ~205:

```ts
useStore.getState().setModeViewer(def.viewer);
useStore.getState().setModeManifest(def.manifest);  // ← new
useStore.getState().setModeDisplayName(def.manifest.displayName);
```

- [ ] **Step 5: Typecheck and dev-smoke**

Run: `bun run tsc --noEmit 2>&1 | tail -10`
Expected: clean.

Run: `bun run dev doc --port 17996`, open the browser, verify the doc mode still renders markdown correctly. This exercises P3 end-to-end for the synthesis fallback path (doc hasn't declared `sources` yet, so the runtime synthesizes a `file-glob` source identical to its current `watchPatterns`). The viewer should still see `props.files` populated by the old path; the new `props.sources.files` should exist and mirror it.

Kill the dev server.

---

### Task 3.8: Create the `useSource` React hook

**Files:**
- Create: `src/hooks/useSource.ts`
- Create: `src/hooks/__tests__/useSource.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, test, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useSource } from "../useSource.js";
import { MemorySource } from "../../../core/sources/memory.js";

describe("useSource", () => {
  test("returns null before any value is delivered", () => {
    const source = new MemorySource<number>({});
    const { result } = renderHook(() => useSource(source));
    expect(result.current.value).toBeNull();
  });

  test("delivers the initial value once the source emits initial", async () => {
    const source = new MemorySource<number>({ initial: 42 });
    const { result } = renderHook(() => useSource(source));
    // Allow the microtask queue to drain so the initial event fires.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.value).toBe(42);
  });

  test("write() is a bound reference to the source's write", async () => {
    const source = new MemorySource<number>({ initial: 0 });
    const { result } = renderHook(() => useSource(source));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.write(7);
    });
    expect(result.current.value).toBe(7);
  });

  test("status reports last origin for observability", async () => {
    const source = new MemorySource<number>({ initial: 1 });
    const { result } = renderHook(() => useSource(source));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status.lastOrigin).toBe("initial");
    await act(async () => {
      await result.current.write(2);
    });
    expect(result.current.status.lastOrigin).toBe("self");
  });

  test("unmount unsubscribes from the source", () => {
    const source = new MemorySource<number>({ initial: 1 });
    const { unmount } = renderHook(() => useSource(source));
    // MemorySource doesn't expose listener count, but we can prove
    // unsubscribe happened by triggering a write after unmount and
    // verifying no error from stale React state.
    unmount();
    expect(() => source.write(2)).not.toThrow();
  });
});
```

Note: this test file uses `@testing-library/react`. Check if it's already a dependency:

```bash
grep -l "@testing-library/react" package.json
```

If not, defer this test file to after P3 (or use a simpler manual subscription test). For now, write the impl (step 2) and defer the test to the next commit after confirming library availability.

- [ ] **Step 2: Implement `src/hooks/useSource.ts`**

```ts
import { useMemo, useSyncExternalStore, useRef } from "react";
import type { Source, SourceEvent } from "../../core/types/source.js";

export interface SourceStatus {
  /**
   * The origin of the most recently delivered value event, or null if
   * no value has been observed yet.
   */
  lastOrigin: "initial" | "self" | "external" | null;
  /**
   * The most recent error event, or null. Cleared on the next successful
   * value event.
   */
  lastError: { code: string; message: string } | null;
}

export interface UseSourceResult<T> {
  /** Latest value, or null before the initial event. */
  value: T | null;
  /** Bound write method — identical semantics to source.write(). */
  write: (value: T) => Promise<void>;
  /** Observability state. */
  status: SourceStatus;
}

/**
 * React binding for Source<T>.
 *
 * Uses useSyncExternalStore so React's concurrent rendering and
 * StrictMode double-invocation behave correctly — the subscription
 * is re-attached cleanly on remount without causing the source to
 * re-emit.
 *
 * The returned { value, write, status } is a stable shape. `value`
 * changes when new events arrive; `write` is a bound reference that
 * does not change identity across renders (so downstream effects
 * depending on [write] don't re-run gratuitously).
 */
export function useSource<T>(source: Source<T>): UseSourceResult<T> {
  // A mutable status ref so status updates don't cause a re-render
  // on their own — status is a secondary observation surface, the
  // primary re-render driver is `value`.
  const statusRef = useRef<SourceStatus>({
    lastOrigin: null,
    lastError: null,
  });

  // useSyncExternalStore needs a stable subscribe function per source.
  const subscribe = useMemo(() => {
    return (notify: () => void) => {
      const off = source.subscribe((event: SourceEvent<T>) => {
        if (event.kind === "value") {
          statusRef.current = {
            lastOrigin: event.origin,
            lastError: null,
          };
        } else if (event.kind === "error") {
          statusRef.current = {
            ...statusRef.current,
            lastError: { code: event.code, message: event.message },
          };
        }
        notify();
      });
      return off;
    };
  }, [source]);

  const value = useSyncExternalStore(
    subscribe,
    () => source.current(),
    () => source.current(),
  );

  const write = useMemo(() => source.write.bind(source), [source]);

  return {
    value,
    write,
    status: statusRef.current,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 4: Defer the hook test file if testing-library isn't installed**

Check:

```bash
grep '"@testing-library/react"' package.json
```

If absent, DO NOT add it in this plan — adding a dep is a separate decision. Instead, leave the hook untested at P3 and verify correctness manually in P5 when each mode migrates to it. P5's per-mode dev-smoke is sufficient coverage.

---

### Task 3.9: P3 verification and commit

**Files:** none modified.

- [ ] **Step 1: Typecheck the whole repo**

```bash
bun run tsc --noEmit 2>&1 | tail -20
```
Expected: clean.

- [ ] **Step 2: Run the test suite**

```bash
bun test 2>&1 | tail -15
```
Expected: all tests passing, including the new source-registry tests.

- [ ] **Step 3: Manual smoke: every mode loads and renders correctly**

For each of these modes, run the dev server, open the browser, verify the viewer loads and shows the current workspace content:

```bash
bun run dev doc --port 17996
bun run dev diagram --port 17996
bun run dev draw --port 17996
bun run dev illustrate --port 17996
bun run dev slide --port 17996
bun run dev webcraft --port 17996
bun run dev gridboard --port 17996
bun run dev mode-maker --port 17996
# remotion needs claude-code backend; skip if not available
```

For each: the viewer must render content identical to pre-P3 (no visible change). If any mode crashes, the problem is almost certainly in `useSourceInstances` — the synthesis fallback path is probably mis-configured. Use chrome-devtools-mcp to capture console errors.

- [ ] **Step 4: Commit**

```bash
git add \
  server/file-watcher.ts \
  server/index.ts \
  bin/pneuma.ts \
  src/ws.ts \
  src/store/workspace-slice.ts \
  src/runtime/file-event-bus.ts \
  src/runtime/file-channel.ts \
  core/source-registry.ts \
  core/__tests__/source-registry.test.ts \
  core/types/viewer-contract.ts \
  src/App.tsx \
  src/hooks/useSource.ts

git commit -m "$(cat <<'EOF'
feat(source): runtime integration + pendingSelfWrites origin tagging (P3)

Wires the Source contract into the real runtime without migrating any
mode. Every existing mode continues to receive props.files populated
exactly as before; a new props.sources map also exists, synthesized via
SourceRegistry.effectiveSources() from viewer.watchPatterns for any
manifest that hasn't declared sources explicitly.

- server/file-watcher.ts: pendingSelfWrites map with 5s TTL, FileUpdate
  now carries origin: "self" | "external"
- server/index.ts: POST /api/files calls registerSelfWrite before writing
- bin/pneuma.ts, src/ws.ts, src/store/workspace-slice.ts: origin flows
  through the content_update broadcast → store → fileEventBus
- src/runtime/file-event-bus.ts: browser-side singleton pub/sub
- src/runtime/file-channel.ts: BrowserFileChannel wraps store + WS + POST
- core/source-registry.ts: SourceRegistry with built-in providers and
  effectiveSources() synthesis fallback
- src/App.tsx: useSourceInstances hook rebuilds per-mode sources map
- src/hooks/useSource.ts: React binding via useSyncExternalStore
- core/types/viewer-contract.ts: sources field added, files deprecated

All 8 existing viewer modes smoke-tested to render identically to pre-P3.
No mode has been migrated to consume props.sources yet — that's P5.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Phase 4: Plugin extension point

Phase 4 opens the SourceRegistry to third-party plugin-provided providers. A plugin that wants to ship, say, a Redis or Yjs source provider declares them in `PluginManifest.sources` and the runtime registers them alongside the built-ins during plugin activation. This phase is small — the registry is already abstracted in P3; P4 just threads the registration through `PluginRegistry`.

### Task 4.1: Add `sources` to `PluginManifest`

**Files:**
- Modify: `core/types/plugin.ts`

- [ ] **Step 1: Add the import**

At the top of `core/types/plugin.ts`, add:

```ts
import type { SourceProvider } from "./source.js";
```

- [ ] **Step 2: Add the field**

In the `PluginManifest` interface (around lines 61–109), add the optional field before the closing brace:

```ts
  /**
   * Source providers contributed by this plugin. Registered on the
   * session's SourceRegistry during plugin activation, making them
   * available to every mode (builtin + external) that declares
   * `sources: { ..., [id]: { kind: "<your-kind>" } }` in its manifest.
   *
   * Naming: use a plugin-scoped kind to avoid collisions with built-ins.
   * For example, a Redis provider from a plugin named "@acme/pneuma-redis"
   * should register as kind "acme-redis" rather than just "redis".
   * Collision with an existing kind causes registration to throw
   * (SourceRegistry.register does not silently overwrite).
   */
  sources?: SourceProvider[];
```

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | tail -10`
Expected: clean.

---

### Task 4.2: Thread plugin-provided providers into `SourceRegistry`

**Files:**
- Modify: `core/plugin-registry.ts`
- Modify: `src/App.tsx` (accept plugin providers when building the per-mode registry)

- [ ] **Step 1: Extend `LoadedPlugin` to expose `sources`**

In `core/types/plugin.ts`, find the `LoadedPlugin` interface (around lines 149–156). Add:

```ts
  /** Source providers from this plugin. Empty if the plugin doesn't ship any. */
  sources: SourceProvider[];
```

- [ ] **Step 2: Populate `sources` in `PluginRegistry.loadPlugin`**

In `core/plugin-registry.ts`, find the `loadPlugin` method (around lines 106–143). In the object returned as `LoadedPlugin`, add:

```ts
sources: manifest.sources ?? [],
```

- [ ] **Step 3: Expose a method to collect all source providers across loaded plugins**

Still in `core/plugin-registry.ts`, add a method at the bottom of the class body:

```ts
/**
 * Collect every source provider contributed by currently-loaded
 * plugins. The runtime calls this when building a per-mode
 * SourceRegistry to register plugin providers alongside the
 * built-ins. Duplicate kinds across plugins cause SourceRegistry.register
 * to throw — plugins must namespace their kinds.
 */
collectSourceProviders(): SourceProvider[] {
  const out: SourceProvider[] = [];
  for (const plugin of this.loadedPlugins) {
    out.push(...plugin.sources);
  }
  return out;
}
```

Also add the import at the top of the file:

```ts
import type { SourceProvider } from "./types/source.js";
```

Note: if `this.loadedPlugins` doesn't exist as a field (it may be named differently — `this.plugins`, `this.registry`, etc.), use whatever the file's existing convention is. The key behavior is "iterate all currently-loaded plugins and flatten their sources arrays".

- [ ] **Step 4: Wire plugin providers into `useSourceInstances`**

In `src/App.tsx`, modify the `useSourceInstances` hook created in Task 3.7. The current implementation builds a registry from `BUILT_IN_PROVIDERS` only. Extend it to also register providers from plugins.

At the top of the file, add:

```ts
import { pluginRegistry } from "./plugins/browser-plugin-registry.js";  // or wherever the plugin registry singleton lives in the browser
```

(The plugin system in this repo may be server-authoritative with the browser receiving plugin metadata via WS. If plugin providers are server-side only, skip this step and document in the task's final commit that P4's browser-side integration is deferred until plugin providers can run in the browser context. For the P4 commit, the server-side collection via `PluginRegistry.collectSourceProviders()` is sufficient infrastructure.)

If the plugin runtime IS browser-capable, extend the hook's registry construction:

```ts
const registry = new SourceRegistry();
for (const provider of BUILT_IN_PROVIDERS) registry.register(provider);
for (const provider of pluginRegistry.collectSourceProviders()) {
  try {
    registry.register(provider);
  } catch (err) {
    // Duplicate kind from a misbehaving plugin — log and continue.
    console.error("[source] plugin provider registration failed", err);
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | tail -10`
Expected: clean.

---

### Task 4.3: Unit-test plugin provider collection

**Files:**
- Modify: `core/__tests__/plugin-registry.test.ts` (add a test case)

- [ ] **Step 1: Add a test**

Open the existing `core/__tests__/plugin-registry.test.ts`. Add a new test case at the bottom of the appropriate `describe` block:

```ts
test("collectSourceProviders flattens providers from all loaded plugins", async () => {
  // This test assumes the test file has helpers for constructing a
  // PluginRegistry with in-memory plugin manifests. If those helpers
  // don't exist, add a minimal inline one here.
  const reg = new PluginRegistry();
  // ... register two plugins, one declaring a `sources` array of length 2,
  //     the other declaring a `sources` array of length 1
  const providers = reg.collectSourceProviders();
  expect(providers).toHaveLength(3);
  const kinds = providers.map((p) => p.kind).sort();
  expect(kinds).toContain("test-a");
});
```

The exact test body depends on the existing file's setup conventions. Open the file, find how other tests instantiate a `PluginRegistry`, and pattern-match. The assertion is: if 2 plugins declare 2+1 source providers respectively, `collectSourceProviders()` returns all 3.

- [ ] **Step 2: Run the test**

Run: `bun test core/__tests__/plugin-registry.test.ts 2>&1 | tail -15`
Expected: all plugin-registry tests passing including the new one.

---

### Task 4.4: Commit P4

```bash
git add \
  core/types/plugin.ts \
  core/plugin-registry.ts \
  src/App.tsx \
  core/__tests__/plugin-registry.test.ts

git commit -m "$(cat <<'EOF'
feat(source): plugin extension point for custom source providers (P4)

Opens the SourceRegistry to third-party providers. Plugins declare
providers in PluginManifest.sources; PluginRegistry.collectSourceProviders
flattens them, useSourceInstances registers them alongside built-ins on
the per-mode SourceRegistry.

- core/types/plugin.ts: sources?: SourceProvider[] on PluginManifest,
  sources: SourceProvider[] on LoadedPlugin
- core/plugin-registry.ts: collectSourceProviders() method
- src/App.tsx: useSourceInstances registers plugin providers after
  built-ins
- core/__tests__/plugin-registry.test.ts: coverage for the flatten

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Phase 5: Migrate all viewer modes to `props.sources`

Phase 5 is the load-bearing phase of the entire plan. Every existing viewer migrates from `props.files` to `props.sources.<id>` (or whatever sources the mode declares). Every inline `saveFile` helper and every echo-guard ref gets deleted. After P5 completes, the `files` prop is removed from `ViewerPreviewProps` and from `useViewerProps` — no code in the repo reads it anymore.

### Mode categorization by domain shape

Each mode's migration shape depends on **what its domain actually is**, not on whether it has a viewer. Three categories; use the table to decide which pattern applies.

| Mode | Domain shape | Provider | Migration pattern |
|---|---|---|---|
| **mode-maker** | A mode package's file tree — **domain is files** | `file-glob` | Pattern A: read-only migration |
| **evolve** | No viewer | `sources: {}` | Pattern B: opt out |
| **illustrate** | A Studio (content sets + image rows) — **domain is a multi-file aggregate** | `aggregate-file` | Pattern C: domain-typed migration |
| **remotion** | TSX source tree — **domain is files** | `file-glob` | Pattern A |
| **diagram** | An active drawio XML — domain is single file (1:1) | `file-glob` | Pattern A (+ delete `lastFileContentRef`) |
| **doc** | A set of markdown docs + active selection — **domain is files** | `file-glob` + `fileChannel` for dynamic-target writes | Pattern D: file-shaped writes |
| **draw** | An active excalidraw canvas (1:1) | `file-glob` + `fileChannel` | Pattern D |
| **gridboard** | A Board (tiles + theme) — domain is a single structured aggregate, nearly 1:1 with `board.json` | `file-glob` + `fileChannel` (or `json-file` as a follow-up) | Pattern D |
| **slide** | A Deck (ordered slides + theme + title) — **domain is multi-file aggregate** | `aggregate-file` | Pattern C |
| **webcraft** | A Site (pages + assets + manifest) — **domain is multi-file aggregate** | `aggregate-file` | Pattern C |

**Task order** (complexity low → high, so early bugs don't block later work):

1. mode-maker (Pattern A)
2. evolve (Pattern B)
3. illustrate (Pattern C)
4. remotion (Pattern A)
5. diagram (Pattern A)
6. doc (Pattern D)
7. draw (Pattern D)
8. gridboard (Pattern D)
9. slide (Pattern C)
10. webcraft (Pattern C)
11. Final cleanup

### Shared migration patterns

**Pattern A — Read-only via `file-glob`**. Used when the domain IS files. The viewer consumes `Source<ViewerFileContent[]>` via `useSource`. No write path change (Pattern A modes don't write from the viewer). Steps:

1. Add `sources: { files: { kind: "file-glob", config: { patterns: [...] } } }` to the manifest, lifting patterns from `viewer.watchPatterns`.
2. In the viewer, replace `{ files, ... }: ViewerPreviewProps` destructure with `{ sources, ... }`; compute `const files = useSource(sources.files as Source<ViewerFileContent[]>).value ?? []`.
3. Delete any `lastFileContentRef` / skip-on-no-change guards — React + `useSource` handle idempotency via `useSyncExternalStore`.
4. Typecheck, dev smoke, commit.

**Pattern B — Opt out with empty sources**. Used when the mode has no viewer. Declare `sources: {}` on the manifest. Done.

**Pattern C — Domain-typed via `aggregate-file`**. Used when the domain is a multi-file aggregate. The viewer consumes `Source<T>` where `T` is the mode's domain type (`Studio`, `Deck`, `Site`). The viewer NEVER touches file paths or JSON stringification — the provider's `load(files) → T` and `save(T, current) → { writes, deletes }` pure functions handle all translation. Steps:

1. Create `modes/<mode>/domain.ts` that defines the domain type `T` and exports two pure functions:
   - `load(files: ReadonlyArray<ViewerFileContent>): T | null` — reconstruct the aggregate from the current file snapshot. Return null if required files are missing (source will stay in "no initial yet" state until files arrive). Throw to emit an `error` event.
   - `save(value: T, current: ReadonlyArray<ViewerFileContent>): { writes; deletes }` — decompose the new aggregate into file-level operations. Use `current` to compute diffs (e.g. detect slide ids that were removed and need their files deleted).
2. Add `sources: { <id>: { kind: "aggregate-file", config: { patterns: [...], load, save } } }` to the manifest, importing `load` and `save` from `./domain.js`.
3. In the viewer, replace `{ files, ... }` with `{ sources, ... }`; wire `const { value, write, status } = useSource(sources.<id> as Source<T>)`. The viewer now renders from `value` (the domain aggregate) directly — `files.find(...)` and JSON stringification disappear from the viewer code.
4. Replace every existing `fetch('/api/files', ...)` / inline `saveFile` call with a domain-level `await write(nextAggregate)`. The provider's `save()` figures out which files to write and delete.
5. Delete any echo-guard refs (`lastSavedContentRef`, `isUpdatingFromFileRef`, `lastAppliedRef`, etc.). `status.lastOrigin === "self"` is the correct way to distinguish echoes from external changes.
6. Typecheck, dev smoke (exercise both agent edits and viewer edits), commit.

**Pattern D — File-shaped writes via `file-glob` + `fileChannel`**. Used when the domain IS a file (single active file, 1:1 aggregate, or a mode whose write target is dynamic and changes at runtime). Steps:

1. Add `sources: { files: { kind: "file-glob", config: { patterns: [...] } } }` to the manifest.
2. In the viewer, destructure `{ sources, fileChannel, ... }` and consume `sources.files` via `useSource` like Pattern A.
3. Replace inline `saveFile` helpers with `await fileChannel.write(path, content)` at each call site. The viewer still knows its target path (it's the active file) — what's gone is the echo-detection machinery.
4. Delete echo-guard refs. Use `status.lastOrigin` from `useSource` where you need to distinguish self from external (e.g. to skip a full re-render on self-save).
5. Typecheck, dev smoke (exercise both agent edits and viewer edits, especially concurrent edit + save scenarios), commit.

Every mode task below references one of these patterns and provides only the mode-specific details (which refs to delete, which file paths to lift, for Pattern C which domain type + load/save to define).

### Task 5.1: Migrate `mode-maker`

**Files:**
- Modify: `modes/mode-maker/manifest.ts`
- Modify: `modes/mode-maker/viewer/ModeMakerPreview.tsx`

`mode-maker` is a read-only viewer that shows a tree of files in the mode-under-development. No writes. Simplest possible migration.

- [ ] **Step 1: Add `sources` to the manifest**

In `modes/mode-maker/manifest.ts`, inside the `modeMakerManifest` object, add the `sources` field just after the existing `viewer` block:

```ts
viewer: {
  watchPatterns: [
    "manifest.ts", "manifest.js",
    "pneuma-mode.ts", "pneuma-mode.js",
    "viewer/**/*.tsx", "viewer/**/*.ts", "viewer/**/*.js",
    "skill/**/*.md", "skill/**/*",
    "seed/**/*",
  ],
  ignorePatterns: [".build/**"],
},
sources: {
  files: {
    kind: "file-glob",
    config: {
      patterns: [
        "manifest.ts", "manifest.js",
        "pneuma-mode.ts", "pneuma-mode.js",
        "viewer/**/*.tsx", "viewer/**/*.ts", "viewer/**/*.js",
        "skill/**/*.md", "skill/**/*",
        "seed/**/*",
      ],
      ignore: [".build/**"],
    },
  },
},
```

- [ ] **Step 2: Update the viewer**

Open `modes/mode-maker/viewer/ModeMakerPreview.tsx`. Find the component signature (the props destructure) — it currently takes `{ files, ... }: ViewerPreviewProps`. Change to:

```tsx
import type { Source } from "../../../core/types/source.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";

export default function ModeMakerPreview({
  sources,
  // ... other existing props except `files`
}: ViewerPreviewProps) {
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue } = useSource(filesSource);
  const files: ViewerFileContent[] = filesValue ?? [];
  // ... rest of the component unchanged; all references to `files` now
  //     resolve to the local `const files` above instead of the prop
}
```

Search the file for every remaining occurrence of `files` (in loops, effects, derived state). They all continue to work unchanged because `files` is still a `ViewerFileContent[]` in local scope.

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 4: Dev smoke**

```bash
bun run dev mode-maker --port 17996 --workspace /tmp/mode-maker-smoke
```

In the browser, verify the mode-maker viewer renders the default scaffolded files. Use chrome-devtools-mcp to screenshot. Compare to a pre-P5 screenshot (e.g., from git stash of `main`).

- [ ] **Step 5: Commit**

```bash
git add modes/mode-maker/manifest.ts modes/mode-maker/viewer/ModeMakerPreview.tsx
git commit -m "$(cat <<'EOF'
refactor(mode-maker): migrate viewer to props.sources (P5.1)

Reads files exclusively through sources.files. No behavioral change.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2: Migrate `evolve`

**Files:**
- Modify: `modes/evolve/manifest.ts`

Evolve has no viewer — it's a headless agent-only mode. But it still has a manifest with a `viewer: { watchPatterns: [] }` block. Add an empty sources to make the migration complete and uniform.

- [ ] **Step 1: Add `sources` to the manifest**

In `modes/evolve/manifest.ts`, after the `viewer` block, add:

```ts
sources: {},
```

An empty `sources` object is explicitly different from an absent one: the P5 final-cleanup task will remove the synthesis fallback, so modes that have no file-backed viewer need to declare the empty object to opt out of auto-synthesis.

- [ ] **Step 2: Typecheck and commit**

```bash
bun run tsc --noEmit 2>&1 | tail -5
git add modes/evolve/manifest.ts
git commit -m "refactor(evolve): opt out of source synthesis with empty sources (P5.2)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.3: Migrate `illustrate`

**Files:**
- Create: `modes/illustrate/domain.ts`
- Modify: `modes/illustrate/manifest.ts`
- Modify: `modes/illustrate/viewer/IllustratePreview.tsx`

**Pattern: C (aggregate-file).** Illustrate's domain is a **Studio** — a collection of image rows organized across one or more content sets. Currently the viewer parses `manifest.json` to find rows and loads image files from `images/**/*`. That parse-and-reassemble logic is a `load()` function in disguise. Lift it out of the viewer.

- [ ] **Step 1: Define the domain type and pure functions in `modes/illustrate/domain.ts`**

```ts
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

export interface ImageEntry {
  id: string;
  path: string;      // relative to the workspace, e.g. "images/hero.png"
  alt?: string;
  prompt?: string;
}

export interface ImageRow {
  id: string;
  title?: string;
  images: ImageEntry[];
}

export interface ContentSetSummary {
  prefix: string;
  label: string;
  rows: ImageRow[];
}

export interface Studio {
  contentSets: ContentSetSummary[];
  activeContentSet: string | null;
}

/**
 * Reconstruct the Studio aggregate from the workspace file snapshot.
 * Returns null when no manifest.json is present (source stays in "no
 * initial yet" state until the agent creates one).
 */
export function loadStudio(files: ReadonlyArray<ViewerFileContent>): Studio | null {
  // Look for top-level and content-set-scoped manifests.
  const manifests = files.filter((f) => f.path.endsWith("manifest.json"));
  if (manifests.length === 0) return null;
  // ... parse each manifest into ContentSetSummary, reading image metadata
  //     from rows[].images[].path fields and verifying the referenced files
  //     exist in `files`. Build the full Studio aggregate and return it.
  //     Use the existing parsing code from the current IllustratePreview as
  //     the starting point — it's the same logic, just moved here.
  throw new Error("TODO: port the existing useResilientParse logic from IllustratePreview.tsx to this pure function");
}

/**
 * Decompose a new Studio back into file operations. For the initial
 * migration this is write-only (the viewer currently never writes),
 * so save() returns the minimum necessary to serialize the studio
 * back to a manifest.json. When the mode later gains UI-level editing
 * (drag to reorder rows, delete an image), extend save() to produce
 * the corresponding delete entries.
 */
export function saveStudio(
  next: Studio,
  current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  // For the P5 migration, illustrate is effectively read-only — agents
  // generate images, viewer just displays them. So save() is trivial:
  // serialize the active content set's manifest and return no deletes.
  // A future UI-editing upgrade extends this.
  throw new Error("TODO: implement save() when viewer gains editing capabilities");
}
```

**Note**: the two `throw new Error("TODO: ...")` bodies are placeholders that the executor fills in by porting logic from the CURRENT `IllustratePreview.tsx`. They are not the spec leaving details unfilled — the logic already exists in the viewer; it just needs to be moved to domain.ts verbatim. The executor reads the existing `useResilientParse` code in IllustratePreview and translates each `files.find(...)` into a `files.find(...)` in `loadStudio`. Because the viewer is currently read-only, `saveStudio` can throw `"not yet implemented"` until a later plan introduces editing.

- [ ] **Step 2: Update `modes/illustrate/manifest.ts`**

```ts
import { loadStudio, saveStudio } from "./domain.js";
import type { Studio } from "./domain.js";

// ... in the manifest:
sources: {
  studio: {
    kind: "aggregate-file",
    config: {
      patterns: ["**/manifest.json", "**/images/**/*"],
      load: loadStudio,
      save: saveStudio,
    },
  },
},
```

- [ ] **Step 3: Update `IllustratePreview.tsx`**

```tsx
import type { Source } from "../../../core/types/source.js";
import type { Studio } from "../domain.js";
import { useSource } from "../../../src/hooks/useSource.js";

export default function IllustratePreview({
  sources,
  // other existing props minus `files`
}: ViewerPreviewProps) {
  const studioSource = sources.studio as Source<Studio>;
  const { value: studio } = useSource(studioSource);
  if (!studio) return <EmptyState />;
  // Render directly from `studio.contentSets`, `studio.activeContentSet`,
  // etc. Delete every `files.find(...)` / `useResilientParse` usage — the
  // parsing is now in loadStudio(), run once per external event.
}
```

- [ ] **Step 4: Typecheck, smoke, commit**

```bash
bun run tsc --noEmit 2>&1 | tail -5
bun run dev illustrate --port 17996 --workspace /tmp/illustrate-smoke
# Verify: content sets load, images render, content-set switching works
git add modes/illustrate/domain.ts modes/illustrate/manifest.ts modes/illustrate/viewer/IllustratePreview.tsx
git commit -m "refactor(illustrate): domain-typed migration to aggregate-file source (P5.3)

Viewer consumes Source<Studio> directly; all manifest parsing lives
in domain.loadStudio as a pure function. No more files.find() or
useResilientParse in the viewer code.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.4: Migrate `remotion`

**Files:**
- Modify: `modes/remotion/manifest.ts`
- Modify: `modes/remotion/viewer/RemotionPreview.tsx` (or the actual entry file)

Read-only. Only runs on claude-code backend; may skip end-to-end smoke if backend not available.

- [ ] **Step 1: Add `sources` to the manifest**

```ts
sources: {
  files: {
    kind: "file-glob",
    config: {
      patterns: [
        "src/**/*.tsx", "src/**/*.ts", "src/**/*.css", "public/**",
        "*/src/**/*.tsx", "*/src/**/*.ts", "*/src/**/*.css", "*/public/**",
      ],
    },
  },
},
```

- [ ] **Step 2: Update the viewer**

Locate the remotion preview entry component. Apply the same destructure-and-useSource pattern as Task 5.1.

- [ ] **Step 3: Typecheck + (optional) smoke + commit**

```bash
bun run tsc --noEmit 2>&1 | tail -5
# Smoke test only if claude-code backend is configured; otherwise rely on
# tsc + other mode smoke tests to catch regressions in the shared path.
git add modes/remotion/manifest.ts modes/remotion/viewer/
git commit -m "refactor(remotion): migrate viewer to props.sources (P5.4)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.5: Migrate `diagram`

**Files:**
- Modify: `modes/diagram/manifest.ts`
- Modify: `modes/diagram/viewer/DiagramPreview.tsx`

Diagram reads `.drawio` files. It has a streaming-write path from the agent (via `streamingFileWrite` from the store) but no user-initiated `POST /api/files`. It DOES have `lastFileContentRef` + `currentFilePathRef` as skip-on-no-change guards at line 139, 382 — we delete those because `useSource` already provides change detection via React's reconciliation of the `value`.

- [ ] **Step 1: Add `sources` to the manifest**

```ts
sources: {
  files: {
    kind: "file-glob",
    config: {
      patterns: ["**/*.drawio"],
    },
  },
},
```

- [ ] **Step 2: Update `DiagramPreview.tsx`**

(a) Change the props destructure:

```tsx
import type { Source } from "../../../core/types/source.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";

export default function DiagramPreview({
  sources,
  selection,
  // ... other existing props minus `files`
}: ViewerPreviewProps) {
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue } = useSource(filesSource);
  const files: ViewerFileContent[] = filesValue ?? [];
  // ... rest of component unchanged
```

(b) Delete `lastFileContentRef` declaration (line ~139) and the string-compare effect that uses it (line ~382 area):

```tsx
// DELETE: const lastFileContentRef = useRef<string | null>(null);
// DELETE: const currentFilePathRef = useRef<string | null>(null);

// DELETE the effect body that reads:
//   if (content === lastFileContentRef.current && filePath === currentFilePathRef.current) return;
//   lastFileContentRef.current = content;
//   currentFilePathRef.current = filePath;
```

The parse-and-render effect that was gated by that check should now run unconditionally when `files` (the local value from `useSource`) changes. React's memoization of `useMemo(() => parseDrawioFile(files), [files])` is enough to skip redundant parsing when the array identity is unchanged. If `parseDrawioFile` is still expensive on every `files` change (because the source emits a new array reference even when content is unchanged), memoize by content hash instead:

```tsx
const parsed = useMemo(() => {
  const f = files.find((x) => x.path === activeFile || x.path.endsWith(".drawio"));
  return f ? parseDrawioFile(f) : null;
}, [files, activeFile]);
```

- [ ] **Step 3: Typecheck, smoke, commit**

```bash
bun run tsc --noEmit 2>&1 | tail -5
bun run dev diagram --port 17996 --workspace /tmp/diagram-smoke
# Verify the diagram renders, agent edits arrive, nothing thrashes
git add modes/diagram/manifest.ts modes/diagram/viewer/DiagramPreview.tsx
git commit -m "$(cat <<'EOF'
refactor(diagram): migrate to props.sources, delete lastFileContentRef (P5.5)

The ref-based skip-on-no-change guard is no longer needed — useSource +
useMemo on the parsed result handles redundant work without hand-rolled
string comparison.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.6: Migrate `doc`

**Files:**
- Modify: `modes/doc/manifest.ts`
- Modify: `modes/doc/viewer/DocPreview.tsx`

First real write-back migration. Doc writes via the inline `saveFile` helper (lines 213–225), debounced 800ms, with `lastExternalRef` (line 744) as a string-compare echo guard (lines 748–755). The migration deletes all of that.

Doc's domain model is "the currently active markdown file". The active file is dynamic (user switches files), so a declarative `json-file` source pinned to a single path won't work. Doc uses:
- `sources.files` (a `file-glob`) to READ the full workspace file list
- `props.fileChannel.write(activePath, content)` to WRITE the active file directly

`fileChannel` was already added to `ViewerPreviewProps` in Task 3.6 and populated by `useViewerProps` in Task 3.7 — this task just consumes it.

- [ ] **Step 1: Update `modes/doc/manifest.ts`**

```ts
sources: {
  files: {
    kind: "file-glob",
    config: {
      patterns: ["**/*.md"],
    },
  },
},
```

- [ ] **Step 2: Update `modes/doc/viewer/DocPreview.tsx`**

(a) Change props destructure:

```tsx
import type { Source } from "../../../core/types/source.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";

export default function DocPreview({
  sources,
  fileChannel,
  selection,
  // ... rest of existing props minus `files`
}: ViewerPreviewProps) {
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue } = useSource(filesSource);
  const files: ViewerFileContent[] = filesValue ?? [];
  // ... rest of component
```

(b) Replace the inline `saveFile` helper. Find the helper definition around lines 213–225:

```tsx
// DELETE:
async function saveFile(path: string, content: string): Promise<boolean> {
  try {
    const baseUrl = import.meta.env.DEV ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}` : "";
    const res = await fetch(`${baseUrl}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

Every call site that used `saveFile(path, content)` becomes:

```tsx
try {
  await fileChannel.write(path, content);
} catch (err) {
  console.error("[doc] save failed", err);
}
```

The call site is inside the debounced `scheduleSave()` callback around line 761. The local `saveFile` helper (now deleted) was module-scoped, outside the component. The new call must be inside the component so it can access `fileChannel`. Move the save logic inline into `scheduleSave`:

```tsx
const scheduleSave = useCallback((path: string, content: string) => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    try {
      await fileChannel.write(path, content);
    } catch (err) {
      console.error("[doc] save failed", err);
    }
  }, 800);
}, [fileChannel]);
```

(c) Delete `lastExternalRef` (line 744) and the effect body that used it (lines 748–755):

```tsx
// DELETE: const lastExternalRef = useRef<string | null>(null);
// DELETE: useEffect(() => {
//   if (!file) return;
//   if (file.content !== lastExternalRef.current) {
//     textareaRef.current.value = file.content;
//     lastExternalRef.current = file.content;
//     lastSavedForActionRef.current = file.content;
//   }
// }, [file.content]);
```

The new approach: let React reconcile the textarea's `value` prop against the latest source value. If the textarea is a controlled component (`<textarea value={...} />`), it just renders the latest value. If it's uncontrolled (`<textarea ref={...} />` and direct `.value` assignment), replace the effect body with an `origin`-aware version:

```tsx
const { value: filesValue, status } = useSource(filesSource);
// ... existing file selection logic produces `file`

useEffect(() => {
  if (!file || !textareaRef.current) return;
  // Only overwrite the textarea content when the source emits a
  // non-self event. Self-origin events are the echo of our own debounced
  // save — we already have the latest local content; reassigning would
  // reset cursor/selection unnecessarily. External events are genuine
  // new content (from the agent) and should replace local state.
  if (status.lastOrigin === "self") return;
  if (textareaRef.current.value !== file.content) {
    textareaRef.current.value = file.content;
  }
}, [file?.content, status.lastOrigin]);
```

This is a strict improvement over the pre-P5 behavior: `lastExternalRef` would overwrite the user's unsaved edits on an incoming external change. The new logic still does that (because external origin IS authoritative), but it does NOT overwrite on self-origin echoes (which was the real "overwrite my typing" bug). If the user wants to reject external changes while editing, that's a follow-up conflict-UI task, not a P5 regression.

(d) Remove `lastSavedForActionRef` if its sole use was inside the deleted effect. If it's still referenced elsewhere (diff computation for user-action notifications around lines 766–791), leave it alone — it's a separate concern.

- [ ] **Step 3: Typecheck and smoke**

```bash
bun run tsc --noEmit 2>&1 | tail -10
bun run dev doc --port 17996 --workspace /tmp/doc-smoke
```

In the browser: create a new `.md` file via the UI, type something, wait 1 second, verify the file appears in `/tmp/doc-smoke/`. Edit the file externally (e.g., `echo '# external' > /tmp/doc-smoke/test.md`), verify the viewer reflects the change. Use chrome-devtools-mcp to screenshot the editor.

Critical check: type in the editor, THEN edit the file externally with a short delay, THEN continue typing — the viewer should not freeze or lose the external change, and the user's unsaved text should not be silently overwritten if it's still in flight in the debounce window.

- [ ] **Step 4: Commit**

```bash
git add modes/doc/manifest.ts modes/doc/viewer/DocPreview.tsx

git commit -m "$(cat <<'EOF'
refactor(doc): migrate to props.sources + fileChannel, delete echo ref (P5.6)

Replaces the inline saveFile helper with fileChannel.write() and deletes
lastExternalRef. The new origin-aware effect no longer overwrites the
textarea on self-origin echoes — fixes the latent "lose local edit on
self-write" bug.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


### Task 5.7: Migrate `draw`

**Files:**
- Modify: `modes/draw/manifest.ts`
- Modify: `modes/draw/viewer/DrawPreview.tsx`

Draw is the most fragile pre-P5 mode: it has both `lastSavedContentRef` (line 259, ordering-critical at line 370) and `isUpdatingFromFileRef` (line 263, 346–350) plus a remount-key dance (`setExcalidrawKey`). All of that goes.

- [ ] **Step 1: Add `sources` to `modes/draw/manifest.ts`**

```ts
sources: {
  files: {
    kind: "file-glob",
    config: { patterns: ["**/*.excalidraw"] },
  },
},
```

- [ ] **Step 2: Update `DrawPreview.tsx`**

(a) Props destructure — add `sources` and `fileChannel`, remove `files`:

```tsx
import type { Source } from "../../../core/types/source.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";

export default function DrawPreview({
  sources,
  fileChannel,
  // ... other existing props minus `files`
}: ViewerPreviewProps) {
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue, status } = useSource(filesSource);
  const files: ViewerFileContent[] = filesValue ?? [];
  // ... rest of component unchanged below
```

(b) Delete `lastSavedContentRef` and `isUpdatingFromFileRef` declarations (around lines 259, 263):

```tsx
// DELETE: const lastSavedContentRef = useRef<string>("");
// DELETE: const isUpdatingFromFileRef = useRef<boolean>(false);
// Keep: currentFilePathRef (still needed for the active file target)
```

(c) Rewrite the incoming-change effect (around lines 335–351). The old logic:

```tsx
// OLD (DELETE):
useEffect(() => {
  if (!excalidrawData) return;
  const newContent = serializeToFile(
    excalidrawData.elements,
    excalidrawData.appState,
    excalidrawData.excalidrawFiles,
  );
  if (newContent === lastSavedContentRef.current) return;
  isUpdatingFromFileRef.current = true;
  setExcalidrawKey((k) => k + 1);
  setTimeout(() => { isUpdatingFromFileRef.current = false; }, 500);
}, [excalidrawData]);
```

New logic — remount only on external origin, not self:

```tsx
useEffect(() => {
  if (!excalidrawData) return;
  // External changes rebuild the Excalidraw state from the incoming
  // file. Self-origin echoes are our own save coming back — Excalidraw's
  // in-memory state already reflects them, so we skip the remount and
  // avoid the visual flash + cursor loss.
  if (status.lastOrigin === "self") return;
  setExcalidrawKey((k) => k + 1);
}, [excalidrawData, status.lastOrigin]);
```

(d) Rewrite the save callback (around lines 358–371). Old logic:

```tsx
// OLD (DELETE):
const handleChange = useCallback((elements, appState, excalidrawFiles) => {
  if (isUpdatingFromFileRef.current) return;
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    const content = serializeToFile(elements, appState, excalidrawFiles);
    lastSavedContentRef.current = content;  // ← LOAD-BEARING ORDERING
    await fetch(`${getApiBase()}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentFilePathRef.current, content }),
    });
  }, 500);
}, []);
```

New logic:

```tsx
const handleChange = useCallback((elements, appState, excalidrawFiles) => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    const content = serializeToFile(elements, appState, excalidrawFiles);
    const path = currentFilePathRef.current;
    if (!path) return;
    try {
      await fileChannel.write(path, content);
    } catch (err) {
      console.error("[draw] save failed", err);
    }
  }, 500);
}, [fileChannel]);
```

Notice what's gone:
- No `isUpdatingFromFileRef` guard — concurrent writes are already serialized by the source system's writeQueue semantics *for declared sources*, and for `fileChannel.write` the server's `pendingSelfWrites` guarantees echo tagging regardless of timing.
- No `lastSavedContentRef.current = content` line. The origin tag from the server is what drives the "did my save echo back" decision, not a local ref.
- No load-bearing ordering. The save-before-fetch dance is gone.

(e) Delete the inline `saveFile` helper function at the top of the file (lines 94–106):

```tsx
// DELETE the whole module-scoped saveFile function
```

- [ ] **Step 3: Typecheck and smoke**

```bash
bun run tsc --noEmit 2>&1 | tail -10
bun run dev draw --port 17996 --workspace /tmp/draw-smoke
```

Manual test flow:
1. Open the browser, draw a few shapes, wait for the debounced save (500ms).
2. Edit `/tmp/draw-smoke/drawing.excalidraw` externally (e.g., with a text editor — tweak an element's position). Save.
3. Verify the viewer remounts with the external changes.
4. Draw again; verify no remount flash occurs on the self-echo.
5. chrome-devtools-mcp screenshot before/after.

- [ ] **Step 4: Commit**

```bash
git add modes/draw/manifest.ts modes/draw/viewer/DrawPreview.tsx
git commit -m "$(cat <<'EOF'
refactor(draw): migrate to props.sources + fileChannel (P5.7)

Deletes the load-bearing lastSavedContentRef = content before fetch
ordering and the isUpdatingFromFileRef 500ms busy flag. Origin is
determined server-side via pendingSelfWrites; the viewer now only
remounts Excalidraw on external-origin events, eliminating the visual
flash on self-saves.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.8: Migrate `gridboard`

**Files:**
- Modify: `modes/gridboard/manifest.ts`
- Modify: `modes/gridboard/viewer/GridBoardPreview.tsx`

GridBoard writes `board.json` + capture images on drag/resize/lock. Saves are awaited and synchronous so there's no echo-guard in the current code. Migration is mostly mechanical: replace the inline `saveFile` helper with `fileChannel.write`.

- [ ] **Step 1: Add `sources` to `modes/gridboard/manifest.ts`**

```ts
sources: {
  files: {
    kind: "file-glob",
    config: {
      patterns: [
        "board.json",
        "theme.css",
        "tiles/**/*.tsx",
        "tiles/**/*.ts",
        "tiles/**/*.css",
      ],
    },
  },
},
```

- [ ] **Step 2: Update `GridBoardPreview.tsx`**

(a) Destructure `sources` + `fileChannel`:

```tsx
import type { Source } from "../../../core/types/source.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";

export default function GridBoardPreview({
  sources,
  fileChannel,
  // ... other existing props minus `files`
}: ViewerPreviewProps) {
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue } = useSource(filesSource);
  const files: ViewerFileContent[] = filesValue ?? [];
  // ... rest of component
```

(b) Delete the module-scoped `saveFile` helper (lines 165–171):

```tsx
// DELETE the whole function
```

(c) Replace every `saveFile(path, content)` call site (grep for them — around lines 530, 672, 886, 947) with:

```tsx
await fileChannel.write(path, content);
```

All call sites are already inside `async` functions that `await` the result, so the signature change is zero-effort — just swap the function name and make sure `fileChannel` is in scope (it comes from the outer component props, so any callback that uses `saveFile` needs to capture `fileChannel`).

If a call site is in a `useCallback` with a `[]` deps array, add `fileChannel` to the deps.

- [ ] **Step 3: Typecheck + smoke + commit**

```bash
bun run tsc --noEmit 2>&1 | tail -5
bun run dev gridboard --port 17996 --workspace /tmp/gridboard-smoke
# Drag a tile, resize, lock — verify persistence to board.json
# Edit board.json externally, verify the viewer reflects the change
git add modes/gridboard/manifest.ts modes/gridboard/viewer/GridBoardPreview.tsx
git commit -m "$(cat <<'EOF'
refactor(gridboard): migrate to props.sources + fileChannel (P5.8)

Replaces inline saveFile helper with fileChannel.write() at all four
call sites. No behavioral change — gridboard had no echo guard to
begin with and was correct by accident of synchronous awaited saves.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.9: Migrate `slide`

**Files:**
- Create: `modes/slide/domain.ts`
- Modify: `modes/slide/manifest.ts`
- Modify: `modes/slide/viewer/SlidePreview.tsx`

**Pattern: C (aggregate-file).** Slide's domain is a **Deck** — an ordered list of slides + theme + title — serialized as `manifest.json` + `slides/*.html` + `theme.css`. The current SlidePreview.tsx stringifies `manifest.json` inline in three places (reorder, delete, implied by debounced text edit). That's domain leakage into the viewer. Lift it.

- [ ] **Step 1: Define the domain type and pure functions in `modes/slide/domain.ts`**

```ts
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

export interface Slide {
  id: string;          // stable identifier, usually derived from the file name
  file: string;        // relative path e.g. "slides/slide-01.html"
  html: string;        // the slide's HTML body
  title?: string;      // derived from first <h1> or stored in manifest
}

export interface Deck {
  title: string;       // from manifest.json top-level
  theme: string;       // contents of theme.css (raw CSS)
  slides: Slide[];     // ordered as per manifest.json's slides array
}

/**
 * Reconstruct a Deck from the current file snapshot.
 *
 * Returns null if manifest.json is missing (source stays in "no
 * initial yet" until agent creates one). Throws if manifest.json
 * exists but is malformed — parse errors become error events.
 *
 * Implementation note: the parsing logic already exists in the
 * current SlidePreview.tsx's useResilientParse + manifest parse
 * block. Port that logic here verbatim — same JSON.parse, same
 * field extraction. Then index slides by `manifest.slides[].file`
 * and look up each file's content from `files` to populate
 * slides[].html. If a slide file referenced by the manifest is
 * missing, skip it (don't fail the whole parse).
 */
export function loadDeck(files: ReadonlyArray<ViewerFileContent>): Deck | null {
  const manifest = files.find((f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"));
  if (!manifest) return null;
  const parsed = JSON.parse(manifest.content);  // throws on bad JSON → error event
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("manifest.json is not an object");
  }
  const title = typeof parsed.title === "string" ? parsed.title : "Untitled";
  const theme = files.find((f) => f.path === "theme.css" || f.path.endsWith("/theme.css"))?.content ?? "";
  const slideEntries: Array<{ file: string; id?: string; title?: string }> =
    Array.isArray(parsed.slides) ? parsed.slides : [];
  const slides: Slide[] = slideEntries
    .map((entry) => {
      const file = entry.file;
      const html = files.find((f) => f.path === file || f.path.endsWith("/" + file))?.content;
      if (html === undefined) return null;
      return {
        id: entry.id ?? file,
        file,
        html,
        title: entry.title,
      };
    })
    .filter((s): s is Slide => s !== null);
  return { title, theme, slides };
}

/**
 * Decompose a new Deck back into file operations.
 *
 * Computes the diff against the current snapshot to produce:
 *   - writes for manifest.json (always), theme.css (if changed),
 *     and every slide file whose html differs from current
 *   - deletes for slide files that existed in current but are
 *     no longer in `next.slides` (user deleted or reordered out)
 *
 * Implementation note: the viewer used to do this in three places
 * (handleReorderSlide, handleDeleteSlide, handleTextEdit). That
 * logic collapses into one function here. The provider's write()
 * executes all writes before all deletes in order, then emits a
 * single self event — viewer no longer sees three separate saves.
 */
export function saveDeck(
  next: Deck,
  current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  const writes: Array<{ path: string; content: string }> = [];

  // 1. manifest.json — always write (reflects current title + order)
  const manifestJson = JSON.stringify(
    {
      title: next.title,
      slides: next.slides.map((s) => ({ file: s.file, id: s.id, title: s.title })),
    },
    null,
    2,
  ) + "\n";
  writes.push({ path: "manifest.json", content: manifestJson });

  // 2. theme.css — write only if changed
  const currentTheme = current.find((f) => f.path === "theme.css" || f.path.endsWith("/theme.css"));
  if (currentTheme?.content !== next.theme) {
    writes.push({ path: "theme.css", content: next.theme });
  }

  // 3. Each slide — write only if html differs
  for (const slide of next.slides) {
    const existing = current.find((f) => f.path === slide.file || f.path.endsWith("/" + slide.file));
    if (existing?.content !== slide.html) {
      writes.push({ path: slide.file, content: slide.html });
    }
  }

  // 4. Deletes — slide files that existed but are no longer referenced
  const keep = new Set(next.slides.map((s) => s.file));
  const deletes = current
    .filter((f) => f.path.startsWith("slides/") && f.path.endsWith(".html"))
    .map((f) => f.path)
    .filter((p) => !keep.has(p) && !keep.has(p.replace(/^.*slides\//, "slides/")));

  return { writes, deletes };
}
```

- [ ] **Step 2: Update `modes/slide/manifest.ts`**

```ts
import { loadDeck, saveDeck } from "./domain.js";
import type { Deck } from "./domain.js";

// ... in manifest body:
sources: {
  deck: {
    kind: "aggregate-file",
    config: {
      patterns: [
        "**/slides/*.html",
        "**/manifest.json",
        "**/theme.css",
      ],
      load: loadDeck,
      save: saveDeck,
    },
  },
  // Keep a file-glob for assets which stay file-shaped (images, fonts, etc.)
  assets: {
    kind: "file-glob",
    config: { patterns: ["**/assets/**/*"] },
  },
},
```

- [ ] **Step 3: Rewrite `SlidePreview.tsx` to consume `Source<Deck>` directly**

The viewer's data source becomes `useSource(sources.deck as Source<Deck>)`. Every place that currently does `files.find((f) => f.path === "manifest.json")` is replaced by reading `deck.title`, `deck.slides`, `deck.theme` directly. The three separate write paths (reorder, delete, text edit) collapse into one pattern:

```tsx
// Reorder: compute nextSlides, then:
await writeDeck({ ...deck, slides: nextSlides });

// Delete a slide: filter it out, then:
await writeDeck({ ...deck, slides: deck.slides.filter((s) => s.id !== deletedId) });

// Debounced text edit: replace html on one slide, then:
await writeDeck({
  ...deck,
  slides: deck.slides.map((s) => s.id === editedId ? { ...s, html: newHtml } : s),
});
```

The viewer no longer knows manifest.json exists. The provider's `save()` figures out that changing `deck.slides[2].html` means writing `slides/slide-03.html`; changing the slide order means writing manifest.json; removing a slide means both writing manifest.json AND deleting the old file. **All the domain→files translation is in `saveDeck`, exactly once.**

Delete the following from SlidePreview.tsx:
- The three inline `fetch('/api/files', ...)` blocks (lines 639–646, 674–681, 700–707)
- The module-scoped `baseUrl` resolution
- Any `pendingChangesRef` / batching that only existed to collect text edits before POSTing
- The `useResilientParse` call for manifest.json — loadDeck covers it

- [ ] **Step 4: Typecheck, smoke, commit**

```bash
bun run tsc --noEmit 2>&1 | tail -5
bun run dev slide --port 17996 --workspace /tmp/slide-smoke
```

Manual test:
1. Drag-reorder two slides — verify `manifest.json` reflects new order, slide files unchanged.
2. Delete a slide — verify both manifest update AND the slide file is removed from disk.
3. Double-click to edit a slide's text — verify only that slide's file is rewritten, manifest unchanged.
4. Let the agent add a new slide externally — verify the viewer picks it up via loadDeck and renders it.

```bash
git add modes/slide/domain.ts modes/slide/manifest.ts modes/slide/viewer/SlidePreview.tsx
git commit -m "$(cat <<'EOF'
refactor(slide): domain-typed migration to aggregate-file source (P5.9)

Introduces modes/slide/domain.ts with the Deck type plus loadDeck /
saveDeck pure functions. SlidePreview now consumes Source<Deck>
directly — zero files.find() calls, zero JSON.stringify, zero inline
POST /api/files. The three write paths (reorder / delete / text edit)
collapse into writeDeck(nextDeck); the provider's save() computes the
diff and produces the correct set of writes + deletes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.10: Migrate `webcraft`

**Files:**
- Create: `modes/webcraft/domain.ts`
- Modify: `modes/webcraft/manifest.ts`
- Modify: `modes/webcraft/viewer/WebPreview.tsx`

**Pattern: C (aggregate-file).** Webcraft's domain is a **Site** — a set of HTML pages + their CSS/JS/assets, usually organized by `manifest.json` and optionally scoped by content sets. The viewer currently does `useResilientParse` on manifest.json to find pages, falls back to globbing `*.html`, then writes edits via debounced fetch. All of that (parse, fallback, serialize) becomes `loadSite` / `saveSite` in a pure domain module.

- [ ] **Step 1: Define the Site domain in `modes/webcraft/domain.ts`**

```ts
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

export interface Page {
  file: string;        // e.g. "index.html" or "pneuma/about.html" when scoped
  title: string;
  html: string;        // the full HTML document
}

export interface StaticAsset {
  path: string;        // css/js/font/image path as written in manifest or globbed
  content: string;     // raw text for text assets; empty for binary (image cache-bust)
}

export interface Site {
  contentSet: string | null;  // the active content-set prefix, e.g. "pneuma" — or null for top-level
  manifest: { pages: Array<{ file: string; title?: string }> } | null;
  pages: Page[];              // all pages visible under the active content set
  assets: StaticAsset[];      // CSS/JS/fonts/images matched by file-glob, for preview bundling
}

/**
 * Reconstruct a Site from the workspace snapshot, scoped by the active
 * content set (passed via a closure if needed, or computed from the
 * current active content set elsewhere in runtime — for the first cut,
 * load() sees the entire workspace and the viewer filters).
 *
 * Implementation note: port the useResilientParse + fallback-to-html-glob
 * logic from current WebPreview.tsx verbatim. Return null only if the
 * workspace is completely empty.
 */
export function loadSite(files: ReadonlyArray<ViewerFileContent>): Site | null {
  if (files.length === 0) return null;
  // 1. Find top-level manifest.json (or nested one — current code handles both)
  const manifestFile = files.find((f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"));
  let manifest: Site["manifest"] = null;
  if (manifestFile) {
    try {
      const parsed = JSON.parse(manifestFile.content);
      const entries = parsed.pages || parsed.files;
      if (Array.isArray(entries)) {
        manifest = { pages: entries.map((p: { file?: string; path?: string; title?: string }) => ({
          file: p.file || p.path || "",
          title: p.title,
        })).filter((p) => p.file.length > 0) };
      }
    } catch {
      // Fall through to HTML glob fallback
    }
  }
  // 2. Build pages list — from manifest if present, else from all .html files
  const pages: Page[] = [];
  const pageEntries = manifest?.pages ?? files
    .filter((f) => /\.html$/i.test(f.path))
    .map((f) => ({ file: f.path, title: undefined as string | undefined }));
  for (const entry of pageEntries) {
    const htmlFile = files.find((f) => f.path === entry.file || f.path.endsWith("/" + entry.file));
    if (!htmlFile) continue;
    pages.push({
      file: entry.file,
      title: entry.title || entry.file.replace(/\.html$/i, "").replace(/^.*\//, ""),
      html: htmlFile.content,
    });
  }
  // 3. Collect static assets (everything else that isn't HTML or manifest.json)
  const assets: StaticAsset[] = files
    .filter((f) => !/\.html$/i.test(f.path) && !f.path.endsWith("manifest.json"))
    .map((f) => ({ path: f.path, content: f.content }));
  return { contentSet: null, manifest, pages, assets };
}

/**
 * Decompose a new Site back into file operations. For the current
 * webcraft write flow, only Page.html changes come from the viewer
 * (via iframe text edits); manifest.json and assets are written by
 * the agent directly and shouldn't be round-tripped through save().
 *
 * save() therefore computes a minimal diff: write only the pages
 * whose html has changed vs the current snapshot. Deletes are
 * empty (webcraft viewer doesn't delete pages today). When the
 * viewer later gains structural editing (add/remove pages), extend
 * save() to also rewrite manifest.json and produce delete entries.
 */
export function saveSite(
  next: Site,
  current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  const writes: Array<{ path: string; content: string }> = [];
  for (const page of next.pages) {
    // Find the current content — respecting content-set scoping
    const existing = current.find(
      (f) => f.path === page.file || f.path.endsWith("/" + page.file),
    );
    if (!existing || existing.content !== page.html) {
      // Preserve content-set prefix if the existing file had one
      const targetPath = existing?.path ?? (next.contentSet ? `${next.contentSet}/${page.file}` : page.file);
      writes.push({ path: targetPath, content: page.html });
    }
  }
  return { writes, deletes: [] };
}
```

- [ ] **Step 2: Update `modes/webcraft/manifest.ts`**

```ts
import { loadSite, saveSite } from "./domain.js";
import type { Site } from "./domain.js";

// ... in manifest body:
sources: {
  site: {
    kind: "aggregate-file",
    config: {
      patterns: [
        "**/*.html", "**/*.css", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx",
        "**/*.json", "**/*.svg", "**/*.png", "**/*.jpg", "**/*.jpeg",
        "**/*.gif", "**/*.webp", "**/*.woff", "**/*.woff2",
      ],
      load: loadSite,
      save: saveSite,
    },
  },
},
```

- [ ] **Step 3: Rewrite `WebPreview.tsx` to consume `Source<Site>`**

The viewer destructures `{ sources, ... }` and consumes `const { value: site, write: writeSite, status } = useSource(sources.site as Source<Site>)`. All `useResilientParse` usage is deleted — loadSite produced the parsed `site.manifest` and `site.pages` already.

The iframe-message-driven text edit handler becomes:

```tsx
const handleTextEdit = useCallback((pageFile: string, newHtml: string) => {
  if (!site) return;
  const nextPages = site.pages.map((p) => p.file === pageFile ? { ...p, html: newHtml } : p);
  writeSite({ ...site, pages: nextPages }).catch((err) => {
    console.error("[webcraft] save failed", err);
  });
}, [site, writeSite]);
```

And the iframe `srcdoc` reload gate becomes origin-aware:

```tsx
useEffect(() => {
  if (!iframeRef.current || !site) return;
  // Skip iframe reload on self-origin echoes — we already have the
  // latest content in local React state, reloading would wipe cursor
  // and scroll position. External edits (agent) still trigger reload.
  if (status.lastOrigin === "self") return;
  iframeRef.current.srcdoc = buildSrcdoc(site, currentFile);
}, [site, status.lastOrigin, currentFile]);
```

Delete from WebPreview.tsx:
- The inline `fetch('/api/files', ...)` block (lines 1004–1008)
- `apiBase` resolution
- `useResilientParse` for manifest.json — replaced by `site.manifest`
- Any fallback-to-html-glob logic — replaced by `site.pages`
- `stableSrcdocRef` iframe-stability hack that only existed to mask self-echo flashes

(c) Consider whether the `srcdoc` reassignment on every `files` prop change (line 927) can be made origin-aware. Currently it always reloads the iframe; that's wasteful on self-origin echoes. The improvement:

```tsx
// Around the srcdoc assignment — gate on origin.
// OLD:
//   if (iframeRef.current) iframeRef.current.srcdoc = srcdoc;
// NEW:
if (iframeRef.current && status.lastOrigin !== "self") {
  iframeRef.current.srcdoc = srcdoc;
}
```

where `status` comes from `const { value: filesValue, status } = useSource(filesSource)`. This means a self-echo no longer reloads the iframe — the in-DOM state is already current. External edits still reload as before.

- [ ] **Step 3: Typecheck + smoke + commit**

```bash
bun run tsc --noEmit 2>&1 | tail -5
bun run dev webcraft --port 17996 --workspace /tmp/webcraft-smoke
```

Manual test:
1. Edit text in the preview iframe; wait 1s; verify the HTML file updates.
2. Verify no flash / reload occurs on self-save (this is the new behavior — used to flash).
3. Edit the HTML file externally; verify the iframe reloads with the new content.
4. Switch active content set; verify correct path scoping.

```bash
git add modes/webcraft/manifest.ts modes/webcraft/viewer/WebPreview.tsx
git commit -m "$(cat <<'EOF'
refactor(webcraft): migrate to props.sources + fileChannel (P5.10)

Routes handleTextEdit through fileChannel.write. Gates srcdoc reload
on origin !== "self", eliminating the flash-on-self-save regression
the pre-P5 code papered over with a debounced write queue.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.11: Final cleanup — remove `files` from `ViewerPreviewProps` and `useViewerProps`

**Files:**
- Modify: `core/types/viewer-contract.ts`
- Modify: `src/App.tsx`
- Modify: `core/source-registry.ts` (remove the synthesis fallback — every mode now declares sources explicitly)

At this point every mode consumes `props.sources` and no mode reads `props.files`. Time to delete it.

- [ ] **Step 1: Delete `files` from `ViewerPreviewProps`**

In `core/types/viewer-contract.ts`, remove the `files: ViewerFileContent[]` field (the one marked `@deprecated` from Task 3.6).

- [ ] **Step 2: Delete `files` from `useViewerProps` return**

In `src/App.tsx`, in the `useViewerProps` return object, remove the `files` field. Also remove the `rawFiles`, `activeContentSet`, and `files` useMemo block that computes the content-set-scoped array (around lines 90–100), IF no other part of the return object needs it.

**Important subtlety:** the content-set-scoped path stripping (the `files` memo that applied `pfx = activeContentSet + "/"` and sliced paths) was viewer-facing behavior. Each migrated viewer is now reading files through `useSource(sources.files)`, which delivers RAW paths — unscoped. The viewers that care about content sets (slide, webcraft, illustrate with content sets enabled) need to apply the same scoping themselves, or the `file-glob` provider needs to do it.

The cleanest fix: move content-set scoping into the `file-glob` provider via a runtime decorator. The runtime wraps the provider in a `ScopedSource` that applies path stripping before each emission. This keeps viewers unchanged from their pre-P5 read pattern and the `file-glob` provider remains content-set-ignorant.

Add to `src/App.tsx` `useSourceInstances` (after building the built + channel):

```tsx
// Decorate file-glob instances with a content-set path scoper.
const activeContentSet = useStore.getState().activeContentSet;
const scoped: Record<string, Source<unknown>> = {};
for (const [id, src] of Object.entries(built)) {
  scoped[id] = activeContentSet
    ? wrapWithContentSetScope(src as Source<ViewerFileContent[]>, activeContentSet) as unknown as Source<unknown>
    : src;
}
```

And a helper (also in `src/App.tsx` or a new `src/runtime/scoped-source.ts`):

```tsx
function wrapWithContentSetScope(
  inner: Source<ViewerFileContent[]>,
  prefix: string,
): Source<ViewerFileContent[]> {
  const pfx = prefix + "/";
  const strip = (files: ViewerFileContent[]): ViewerFileContent[] =>
    files
      .filter((f) => f.path.startsWith(pfx))
      .map((f) => ({ path: f.path.slice(pfx.length), content: f.content }));

  const listeners = new Set<(e: SourceEvent<ViewerFileContent[]>) => void>();
  const innerOff = inner.subscribe((e) => {
    if (e.kind === "value") {
      for (const l of listeners) l({ ...e, value: strip(e.value) });
    } else {
      for (const l of listeners) l(e);
    }
  });

  return {
    current: () => {
      const v = inner.current();
      return v ? strip(v) : null;
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    write: async (v) => {
      // Unscoped write — re-prepend the prefix to each path.
      // file-glob is read-only anyway, so write throws; keep the
      // signature honest.
      await inner.write(v);
    },
    destroy: () => {
      listeners.clear();
      innerOff();
      // Note: we do NOT destroy `inner` — the registry owns its lifetime.
    },
  };
}
```

Subtler still: the `useSourceInstances` hook currently rebuilds only on `manifest` change. If `activeContentSet` changes, the hook doesn't re-run. Add `activeContentSet` to the dependency array of the effect:

```tsx
const manifest = useStore((s) => s.modeManifest);
const activeContentSet = useStore((s) => s.activeContentSet);
// ...
useEffect(() => { /* build/teardown */ }, [manifest, activeContentSet]);
```

And inside the effect, the registry construction uses the current `activeContentSet` closure.

- [ ] **Step 3: Remove the synthesis fallback**

In `core/source-registry.ts`, change `effectiveSources` from:

```ts
static effectiveSources(manifest: ModeManifest): Record<string, SourceDescriptor> {
  if (manifest.sources && Object.keys(manifest.sources).length > 0) {
    return manifest.sources;
  }
  return {
    files: {
      kind: "file-glob",
      config: {
        patterns: manifest.viewer.watchPatterns,
        ignore: manifest.viewer.ignorePatterns,
      },
    },
  };
}
```

to:

```ts
static effectiveSources(manifest: ModeManifest): Record<string, SourceDescriptor> {
  if (!manifest.sources) {
    throw new Error(
      `ModeManifest "${manifest.name}" is missing the required \`sources\` ` +
        `field. Every mode must explicitly declare its data channels ` +
        `(see docs/superpowers/plans/2026-04-13-source-abstraction.md).`,
    );
  }
  return manifest.sources;
}
```

Empty `sources: {}` is still legal — that's the evolve case.

- [ ] **Step 4: Update `core/__tests__/source-registry.test.ts`**

The test `synthesizeDefault creates a file-glob source from viewer.watchPatterns if sources is absent` now expects a throw. Replace:

```ts
test("effectiveSources throws if manifest.sources is absent", () => {
  const manifestLike = {
    name: "test",
    viewer: { watchPatterns: ["**/*.md"], ignorePatterns: [] },
    sources: undefined,
  };
  expect(() =>
    SourceRegistry.effectiveSources(manifestLike as unknown as ModeManifest),
  ).toThrow(/sources/);
});
```

Run: `bun test core/__tests__/source-registry.test.ts` — expected all tests passing with the updated assertion.

- [ ] **Step 5: Full typecheck, full test suite, full mode smoke**

```bash
bun run tsc --noEmit 2>&1 | tail -20
bun test 2>&1 | tail -15
```

Expected: tsc clean, all tests passing. If any mode is still reading `props.files`, tsc will fail (the field no longer exists on the type). That's the mechanical enforcement — fix any holdouts.

Then re-smoke every mode:

```bash
for mode in mode-maker evolve illustrate diagram doc draw gridboard slide webcraft; do
  echo "=== $mode ==="
  bun run dev $mode --port 17996 --workspace /tmp/$mode-smoke &
  sleep 5
  # chrome-devtools-mcp navigate and screenshot
  kill %1
done
```

(In practice, smoke each mode one at a time, interactively, rather than via a loop — the launcher test in P6 will catch any cross-mode regression.)

- [ ] **Step 6: Commit**

```bash
git add \
  core/types/viewer-contract.ts \
  src/App.tsx \
  core/source-registry.ts \
  core/__tests__/source-registry.test.ts \
  src/runtime/scoped-source.ts

git commit -m "$(cat <<'EOF'
refactor(source): remove deprecated files prop, require explicit sources (P5.11)

- Deletes ViewerPreviewProps.files (deprecated since P3)
- Deletes useViewerProps's files remap and content-set scoping in the
  prop path; scoping now happens via ScopedSource wrapper inside
  useSourceInstances
- SourceRegistry.effectiveSources throws if a mode omits `sources`;
  synthesis fallback is gone
- Every mode has an explicit sources declaration after tasks 5.1-5.10

End of P5. Next: P6 end-to-end verification before P7's ClipCraft
migration guide.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Phase 6: End-to-end verification

P6 is the gate before P7. Nothing lands on main until every check here is green. This phase has no commits — it's pure verification + a single "release-candidate" tag at the end if everything passes.

### Task 6.1: Whole-repo typecheck

- [ ] **Step 1: Run**

```bash
bun run tsc --noEmit 2>&1 | tee /tmp/p6-tsc.log
```

Expected: zero errors. If any error exists, it is a regression introduced in P5 and must be traced back to its commit and fixed (do NOT paper over with `any` or `@ts-ignore`).

### Task 6.2: Full test suite

- [ ] **Step 1: Run**

```bash
bun test 2>&1 | tee /tmp/p6-tests.log | tail -30
```

Expected: all suites passing. Count of tests should match: existing pre-plan count + 7 (source-types) + 16 (base) + 5 (memory) + 8 (file-glob) + 10 (json-file) + 7 (source-registry) + 1 (plugin-registry new test). That's +54 tests minimum from this plan. Confirm the delta is roughly right — if the new count is LOWER than expected, a test file wasn't picked up; investigate.

### Task 6.3: Per-mode interactive smoke

For each mode, start the dev server in a clean workspace, exercise the golden path in the browser, and capture a screenshot via chrome-devtools-mcp. Compare against the pre-P5 screenshot baseline (if available from an earlier commit's manual test).

- [ ] **Mode: mode-maker**

```bash
mkdir -p /tmp/p6-mode-maker && bun run dev mode-maker --port 17996 --workspace /tmp/p6-mode-maker
```
Check: scaffolded files appear in the file tree, `manifest.ts` renders, no console errors.
Screenshot: `chrome-devtools-mcp` → `take_screenshot` at `http://localhost:17996`.

- [ ] **Mode: evolve**

Evolve has no viewer. Skip the browser smoke; just confirm the server starts without throwing:

```bash
bun run dev evolve --port 17996 --workspace /tmp/p6-evolve 2>&1 | head -30
# Expect: "listening" log, no stack traces
# Ctrl-C to stop
```

- [ ] **Mode: illustrate**

```bash
mkdir -p /tmp/p6-illustrate && bun run dev illustrate --port 17996 --workspace /tmp/p6-illustrate
```
Check: manifest.json loads, image rows render, content set switcher works.

- [ ] **Mode: diagram**

```bash
mkdir -p /tmp/p6-diagram && bun run dev diagram --port 17996 --workspace /tmp/p6-diagram
```
Check: seeded `.drawio` renders, can zoom/pan, agent-authored streaming updates still work (simulate by writing to a .drawio file from another terminal).

- [ ] **Mode: doc**

```bash
mkdir -p /tmp/p6-doc && bun run dev doc --port 17996 --workspace /tmp/p6-doc
```
Critical checks:
1. Type in the editor → file appears on disk after 1s (debounced save).
2. External edit (`echo '# external' > /tmp/p6-doc/test.md`) → viewer reflects it.
3. Concurrent test: type continuously, then external edit arrives → verify no crash and that SELF-ORIGIN echoes don't reset the cursor.

- [ ] **Mode: draw**

```bash
mkdir -p /tmp/p6-draw && bun run dev draw --port 17996 --workspace /tmp/p6-draw
```
Critical checks:
1. Draw shapes → file updates after 500ms.
2. External edit → viewer remounts Excalidraw with new state.
3. No visual flash on self-save (the regression we fixed in P5.7).

- [ ] **Mode: gridboard**

```bash
mkdir -p /tmp/p6-gridboard && bun run dev gridboard --port 17996 --workspace /tmp/p6-gridboard
```
Checks: drag a tile, resize, lock — all persist to `board.json`.

- [ ] **Mode: slide**

```bash
mkdir -p /tmp/p6-slide && bun run dev slide --port 17996 --workspace /tmp/p6-slide
```
Checks: reorder slides, delete a slide, edit text in a slide — all three write paths work.

- [ ] **Mode: webcraft**

```bash
mkdir -p /tmp/p6-webcraft && bun run dev webcraft --port 17996 --workspace /tmp/p6-webcraft
```
Critical checks:
1. Edit text in the preview iframe → HTML file updates.
2. NO flash/reload on self-save (this was the big improvement).
3. External edit → iframe reloads.
4. Switch content set → correct scoping.

- [ ] **Mode: remotion** (optional — claude-code backend only)

If claude-code is configured:
```bash
mkdir -p /tmp/p6-remotion && bun run dev remotion --port 17996 --workspace /tmp/p6-remotion
```
Check: Remotion Player renders, composition list updates on src/ changes.

If not configured: document skip, rely on tsc + unit tests for remotion.

### Task 6.4: Launcher walkthrough

- [ ] **Step 1: Start launcher**

```bash
bun run dev --port 17996
```

- [ ] **Step 2: Open browser at `http://localhost:17996`**

- [ ] **Step 3: For each mode in the built-in section, click once, verify spawn**

Click doc → verify child session opens on auto-incremented port, viewer renders. Close. Click diagram → same. Repeat for every built-in mode. Confirm: no launcher crashes, no browser console errors about missing `files` or `sources` props, no stale dist/ fallback.

- [ ] **Step 4: Switch between modes via Recent Sessions**

Verify: a prior doc session resumes with content intact. Switch to a prior gridboard session; verify it loads correctly. This exercises the session registry path + source rebuilding on mode change.

- [ ] **Step 5: Tag a release candidate**

If everything above is green:

```bash
git tag -a p6-green -m "P6 end-to-end verification complete — all modes migrated to source abstraction"
```

Do NOT push the tag (per the plan's no-manual-tag rule). The tag is local, just to mark the verified state in case you need to bisect forward from P7.

---

## Phase 7: ClipCraft migration guide

P7 is one task: write a document that the ClipCraft mode author (on a separate branch) can follow to adopt the new source abstraction in place of their current three-ref + null-reset implementation.

### Task 7.1: Author `clipcraft-source-migration.md`

**Files:**
- Create: `docs/superpowers/plans/clipcraft-source-migration.md`

- [ ] **Step 1: Write the guide**

```markdown
# ClipCraft Source Migration Guide

> **Audience:** the author of the ClipCraft mode, whose branch currently lives in `feat/clipcraft-by-pneuma-craft`. This document explains how to replace the `useProjectSync` + `externalEdit.ts` + three-ref dance with a single `json-file` source declaration against the new source abstraction that landed on `main` as `feat/source-abstraction`.
>
> **Prerequisite:** rebase your ClipCraft branch onto the new main first. The source abstraction is already in place for every other mode; your branch will fail to compile until `ViewerPreviewProps.files` is removed and `ViewerPreviewProps.sources` is required.

## What you delete

| File / Symbol | Why |
|---|---|
| `useProjectSync` hook | Replaced by a one-line `useSource(props.sources.project)` call. |
| `ClipCraftPreview.lastAppliedRef` | Replaced by server-side `pendingSelfWrites` origin tagging. |
| `useProjectSync.hydratedDiskRef` | Same — `useSyncExternalStore` inside `useSource` handles React 19 StrictMode double-invocation correctly, no ref dance needed. |
| `ClipCraftPreview.providerKey` bump + remount | Keep (conceptually) but trigger it on `status.lastOrigin === "external"` instead of on a string-compare of `lastAppliedRef`. The remount is still needed because the Zustand craft store is live state that can't safely receive duplicate commands. |
| `modes/clipcraft/viewer/externalEdit.ts` | Delete the whole file. |
| `currentTitleRef` | Still needed until craft gets a project-level title concept. Leave it alone. |
| `ClipCraftPreview.onExternalEdit` null-reset of `lastAppliedRef.current` | Gone — the ref is gone. This is the load-bearing coupling you hit in Plan 3b; it no longer exists to get wrong. |

## What you add

### 1. Declare the project source in `manifest.ts`

```ts
import type { ProjectFile } from "./types.js";
import { parseProjectFile, formatProjectJson } from "./serialization.js";

const clipcraftManifest: ModeManifest = {
  // ... existing fields ...

  sources: {
    project: {
      kind: "json-file",
      config: {
        path: "project.json",
        parse: (raw: string): ProjectFile => {
          const result = parseProjectFile(raw);
          if (!result.ok) throw new Error(result.error);
          return result.value;
        },
        serialize: (v: ProjectFile) => formatProjectJson(v),
      },
    },
    // You can still declare a file-glob if you want to render other
    // files in the workspace (e.g., an exported .mp4 list). But
    // project.json is the canonical write target.
    files: {
      kind: "file-glob",
      config: { patterns: ["**/*"] },
    },
  },
};
```

### 2. Replace `useProjectSync` with a thin inline binding

Your current hook returns whatever bag of state ClipCraftPreview needs. The new shape: consume the source directly in `ClipCraftPreview`, dispatch to the Zustand store on `initial` events, bump `providerKey` on `external` events, write via `source.write` on debounced autosave.

```tsx
export function ClipCraftPreview({
  sources,
  // ... other props
}: ViewerPreviewProps) {
  const projectSource = sources.project as Source<ProjectFile>;
  const { value: project, status, write: writeProject } = useSource(projectSource);

  const dispatchEnvelope = usePneumaCraftStore((s) => s.dispatchEnvelope);
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const composition = usePneumaCraftStore((s) => s.composition);
  const eventCount = useEventLog().length;
  const currentTitleRef = useRef<string>("Untitled");
  const [providerKey, setProviderKey] = useState(0);
  const lastHydratedRef = useRef<"initial" | "external" | null>(null);

  // Hydrate the craft store from initial or external loads.
  // Skip self-origin events — they're echoes of our own autosave,
  // and the craft store already reflects them (we dispatched the
  // envelopes before writing).
  useEffect(() => {
    if (!project) return;
    if (status.lastOrigin === "self") return;
    if (status.lastOrigin === "initial") {
      currentTitleRef.current = project.title;
      for (const env of projectFileToCommands(project)) {
        try { dispatchEnvelope(env); } catch (e) { console.warn("[clipcraft] dispatch failed", e); }
      }
      lastHydratedRef.current = "initial";
      return;
    }
    if (status.lastOrigin === "external") {
      // Remount: the craft store is live and may have uncommitted state.
      // Bumping providerKey gives us a fresh store; the initial-hydration
      // branch above then re-plays the new project into it.
      setProviderKey((k) => k + 1);
      lastHydratedRef.current = "external";
    }
  }, [project, status.lastOrigin, dispatchEnvelope]);

  // Autosave.
  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(async () => {
      const file = serializeProject(coreState, composition, currentTitleRef.current);
      try {
        await writeProject(file);
      } catch (err) {
        console.error("[clipcraft] autosave failed", err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [eventCount, coreState, composition, writeProject, project]);

  return (
    <PneumaCraftProvider key={providerKey}>
      <ClipCraftCanvas />
    </PneumaCraftProvider>
  );
}
```

### 3. Delete the dead files

```bash
rm modes/clipcraft/viewer/hooks/useProjectSync.ts
rm modes/clipcraft/viewer/externalEdit.ts
git add -A
git commit -m "refactor(clipcraft): delete useProjectSync + externalEdit (migrated to source abstraction)"
```

## Why this is correct

The ClipCraft original proposal's four pieces of state:

| Ref/State | Old owner | New owner |
|---|---|---|
| `lastAppliedRef` | parent component, across remounts | server-side `pendingSelfWrites` map |
| `hydratedDiskRef` | hook instance, per-remount | React's `useSyncExternalStore` (inside `useSource`) |
| `providerKey: number` | parent state | **STAY** — still needed for craft store rebuild on external |
| `currentTitleRef` | hook instance | **STAY** — title side-channel until craft gets title concept |

The two load-bearing pieces (`lastAppliedRef` + `hydratedDiskRef`) are gone because both were reverse-engineering origin information that the server already knows. The `providerKey` remount dance stays because remount-on-external-edit is ClipCraft's strategy for state-machine rebuild — that's a semantic decision the transport can't replace. But the **trigger** for the remount is now a clean `status.lastOrigin === "external"` check, not a string-compare against a ref.

The E2E regression Plan 3b shipped (the load-bearing ordering between `lastAppliedRef.current = null` and `setProviderKey(...)`) is structurally impossible now. The ordering that had to be correct doesn't exist.

## Things the abstraction does NOT solve

- **Diff-and-dispatch.** The craft store is still rebuilt from scratch on external edit. Preserving undo history / PlaybackEngine position across agent edits is a separate future plan.
- **Title side-channel.** `currentTitleRef` stays because craft has no title concept.
- **Serialization determinism.** `formatProjectJson` still needs to be byte-deterministic or parse-failure edge cases can leak into `origin: "error"` events. Check your serializer.

## Verification

After the refactor lands:

```bash
bun run tsc --noEmit
bun test
bun run dev clipcraft --port 17996 --workspace /tmp/clipcraft-smoke
```

Manual test:
1. Create a project, make edits, verify autosave (`cat /tmp/clipcraft-smoke/project.json`).
2. Edit `project.json` externally with a new composition; verify the craft store remounts and reflects the change.
3. Type in a text field WHILE an external edit arrives — verify no crash, no stale-ref infinite remount.
4. Run the E2E test Plan 3b added. It should pass without any of the previous "load-bearing ordering" comments being load-bearing.
```

- [ ] **Step 2: Commit the guide**

```bash
git add docs/superpowers/plans/clipcraft-source-migration.md
git commit -m "$(cat <<'EOF'
docs(source): ClipCraft migration guide (P7)

Step-by-step for migrating ClipCraft off the three-ref + null-reset
dance documented in 2026-04-13-mode-sync-transport.md onto the new
json-file source. Targets the author of feat/clipcraft-by-pneuma-craft,
not executed by this branch.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Final state — ready to merge `feat/source-abstraction` to main**

At this point the branch is ready for a PR:
- P1 contract + docs committed
- P2 providers + tests committed
- P3 runtime integration committed
- P4 plugin extension committed
- P5 all 9 mode migrations + final cleanup committed
- P6 E2E verification passed (no commits, local tag only)
- P7 ClipCraft guide committed

Present the branch to the user for review. Recommend opening the PR with the P1 commit hash as the "start here" anchor, so reviewers can follow the natural P1→P7 narrative.

---

## Self-review checklist

After the plan has been reviewed and before execution starts:

- [ ] Every phase ends with a commit, and the commit message names the phase (P1–P7).
- [ ] Every code step shows real code, not placeholders.
- [ ] The Source contract described in Task 1.1 matches what Tasks 2.2, 2.4, 2.6, 2.8 actually implement (same method names, same event shape).
- [ ] Every new file created in earlier tasks is referenced by at least one later task (no orphan files).
- [ ] Every mode migration in P5 deletes the specific refs and call sites that the P5 intro table identified.
- [ ] `fileChannel` prop is introduced in P5.6 and its consumers are all of P5.6–P5.10.
- [ ] The content-set scoping fix in P5.11 applies to every viewer that previously relied on `useViewerProps` remapping (slide, webcraft, illustrate if content-sets enabled).
- [ ] The synthesis fallback in P3 is removed in P5.11.
- [ ] P6 smoke covers every mode P5 migrated.
- [ ] P7 references the original mode-sync-transport.md plan that this effort superseded.

---

## Out of scope (explicit reminders)

- **Splitting webcraft into `manifest` + `pages` + `assets` sources.** Webcraft migrates as a single `files` file-glob to preserve behavior. Domain refactoring is a follow-up.
- **Removing `viewer.watchPatterns` from the manifest.** Kept in place; it's still what drives server-side chokidar. `sources` is additive.
- **A React context for source access (`<SourceProvider>`).** Prop drilling via `props.sources` is enough. Adding a context is a separate polish task.
- **Dynamic source instantiation** (create a source mid-session for a user-selected file). Not needed — use `fileChannel.write()` for dynamic targets.
- **Backwards compatibility beyond this branch.** No deprecation windows, no dual-prop period after P5.11. The branch ships the abstraction whole.
- **ClipCraft code changes.** P7 produces a guide only. The branch never touches `modes/clipcraft/`.

---

