# Mode Sync Transport Abstraction

> **⚠️ SUPERSEDED (2026-04-13).** This ClipCraft-only proposal has been generalized into a full-stack Source abstraction that covers all modes. See `docs/superpowers/plans/2026-04-13-source-abstraction.md`. The original proposal is preserved here as historical context for the ClipCraft echo-loop problem that motivated the work — its analysis of the three-ref dance is still the clearest description of the failure mode, and the new plan's P7 (ClipCraft migration guide) refers back to this document for the original rationale.

> **Context:** motivated by ClipCraft (Plan 3d of the clipcraft × pneuma-craft series), but the abstraction itself is cross-mode infrastructure and lives in `modes/_shared/`. Any future mode with a structured domain model and bidirectional disk sync can consume the same transport.
>
> **Split:** this plan has two phases. **Phase 1** builds the transport library with unit tests — no consumers, no refactors, no cross-repo work. **Phase 2** integrates it into ClipCraft, replacing the current three-ref loop-protection dance. Phase 1 lands on `main`. Phase 2 lands on `feat/clipcraft-by-pneuma-craft` after rebasing onto the new main, and is my job (not covered in detail here — just an API-validation sketch).

**Goal (Phase 1):** Define a `SyncTransport<T>` abstraction for bidirectional disk-or-storage sync with first-class **origin tagging** (`initial` / `external` / `parse-error`, with `local-echo` absorbed internally). Ship one concrete implementation, `createJsonFileTransport`, that wraps Pneuma's existing `files` prop + `POST /api/files` pipe into a typed, origin-aware transport. Land it with strong unit test coverage. No runtime or manifest changes.

**Architecture:** Pure TypeScript, no React dependency. The transport is a plain factory function that returns an object with `feed()`, `subscribe()`, `write()`, `destroy()`. Callers push raw snapshots in via `feed(rawContent)`, get typed events back, and call `write(value)` to serialize + persist. The transport internally tracks "what did I just write" to tag its own echoes and drop them before they reach listeners.

The cross-mode sync problem is: when a mode's viewer can both **read from** and **write to** a watched file, the file watcher echoes the viewer's own writes back as change events. Every mode that writes has to invent its own "is this my echo?" logic. ClipCraft's Plan 3b+3c did this with three refs + a state counter + a load-bearing null-reset in `onExternalEdit`, and Plan 3b Task 6 proved that getting it right is subtle (a silent React effect-ordering race shipped before an E2E test caught it). This abstraction consolidates the loop-protection logic into one testable module so future modes don't reinvent it.

**Tech Stack:**
- TypeScript, `bun:test`, no React (the library is framework-agnostic)
- Lives in `modes/_shared/sync/` — sibling to the existing `modes/_shared/skills/` directory
- No cross-repo work, no `@pneuma-craft/*` changes

**Out of scope for Plan 3d (explicit):**
- Diff-and-dispatch. This abstraction is about **origin identification**, not about how to reconcile two states when they disagree. The current "remount the provider on external edit" strategy stays in ClipCraft's Phase 2; diff-and-dispatch is a separate future plan.
- Multiple transport implementations beyond `createJsonFileTransport`. No in-memory, no BroadcastChannel, no IndexedDB. YAGNI until a second consumer needs them.
- Manifest-level declarative persistence (e.g. `manifest.persistence: { path: "project.json", schema: "v1" }`). That's a runtime-level upgrade for when a second mode adopts the transport.
- Removing the `providerKey` remount strategy from ClipCraft. The transport gives cleaner origin tagging but the craft store still needs a hard reset on external edit. Diff-and-dispatch will address this later.
- React integration helpers. Phase 2 (ClipCraft integration) will write a tiny `useJsonFileTransport` hook inside `modes/clipcraft/viewer/hooks/` — **not** in `modes/_shared/sync/`, because the React wiring is mode-specific until there's a second consumer.

---

## The problem in one paragraph

ClipCraft's `useProjectSync` (Plan 3b + 3c) maintains four pieces of state to avoid the write → chokidar-echo → rehydrate-and-duplicate loop:

| Ref / State | Lives in | Survives | Solves |
|---|---|---|---|
| `lastAppliedRef: string \| null` | parent component (`ClipCraftPreview`) | provider remount | echo-skip ("did I just write this?") |
| `hydratedDiskRef: string \| null` | hook instance (`useProjectSync`) | — (dies on remount) | React 19 StrictMode effect double-invoke |
| `providerKey: number` | parent state | provider remount | forces Zustand store rebuild on real external edit |
| `currentTitleRef: string` | hook instance | — | title side-channel (craft has no title concept) |

Plus a load-bearing coupling: `ClipCraftPreview.onExternalEdit` must reset `lastAppliedRef.current = null` BEFORE calling `setProviderKey`, or the fresh hook instance sees a stale ref and treats the new disk content as "yet another external edit" → infinite remount. Plan 3b's initial implementation violated this ordering and shipped a silent regression that only an E2E test caught. The pattern is fragile.

The root of the fragility is that the `files` prop delivered by Pneuma's runtime is **origin-less**: the viewer receives a content string and has no idea whether the change was caused by itself (its own `POST /api/files` echoing through chokidar) or by an external actor (the agent's Edit tool). Every piece of the loop-protection dance is hand-rolled "reverse-engineer the origin by comparing strings" logic.

**The fix:** move origin identification into a pure-data-logic module. Content comparison happens in one place. Event origins are first-class (`initial` / `external` / `parse-error`, with `local-echo` absorbed internally). Consumers stop asking "is this my echo?" and start asking "what kind of event is this?".

---

## The abstraction

### `SyncEvent<T>` — discriminated union

```ts
// modes/_shared/sync/types.ts

/**
 * A single event emitted by a SyncTransport.
 *
 * Consumers handle events via the discriminant `kind`.
 *
 * Note: there is no `local-echo` variant. When the transport writes value V
 * and the storage fires a change for V back at it, the transport DROPS the
 * event internally and never emits it. Consumers only see changes that are
 * NOT their own.
 */
export type SyncEvent<T> =
  /**
   * The first non-null content observed by this transport instance. Fires
   * exactly once per transport instance, on the first feed() that yields a
   * parseable value. Use this to drive initial hydration.
   */
  | { kind: "initial"; value: T }
  /**
   * A change caused by someone other than this transport. Use this to
   * reconcile against the current in-memory state — for ClipCraft, this
   * means remounting the provider and rehydrating on a fresh store.
   */
  | { kind: "external"; value: T }
  /**
   * The raw content couldn't be parsed. `raw` is the offending string,
   * `error` is the parser's message. The transport continues running;
   * future feeds with valid content will still emit initial/external.
   */
  | { kind: "parse-error"; error: string; raw: string };
```

### `SyncTransport<T>` — interface

```ts
// modes/_shared/sync/types.ts (continued)

export interface SyncTransport<T> {
  /**
   * Push a raw snapshot in. The transport classifies the content
   * against its internal state (last-fed, last-written) and either:
   *   - drops it (duplicate of last-fed, or equal to last-written = echo)
   *   - classifies it as initial (first non-null content)
   *   - classifies it as external (differs from last-fed and last-written)
   *   - classifies it as parse-error (parse fails)
   *
   * The returned value is the event that was emitted to listeners, or
   * null if the feed was deduplicated or echo-skipped. Consumers can
   * either subscribe to events or inspect the return value synchronously.
   */
  feed(rawContent: string | null): SyncEvent<T> | null;

  /**
   * Subscribe to events. The listener is called on every non-dropped
   * feed(). Returns an unsubscribe function.
   *
   * Does NOT fire a synthetic initial event on subscribe — subscribe
   * before the first feed() and you'll see the initial event when it
   * arrives; subscribe after and you'll miss it. Consumers that want
   * sync access to the current value should rely on feed()'s return.
   */
  subscribe(listener: (event: SyncEvent<T>) => void): () => void;

  /**
   * Serialize and persist the value. Resolves on storage acknowledgement,
   * rejects on failure. On success, the transport updates its "last
   * written" marker so the subsequent echo from the storage layer is
   * recognized and dropped.
   *
   * Implementations are free to debounce internally or delegate debouncing
   * to the caller — the default json-file-transport writes through and
   * lets the caller debounce.
   */
  write(value: T): Promise<void>;

  /**
   * Release any resources held by this transport. After destroy(),
   * feed() and write() become no-ops and existing subscribers are
   * removed.
   */
  destroy(): void;
}
```

### `createJsonFileTransport<T>` — concrete implementation

```ts
// modes/_shared/sync/json-file-transport.ts

export interface JsonFileTransportOptions<T> {
  /** Parse raw text to a typed value. ok=true on success. */
  parse: (raw: string) => { ok: true; value: T } | { ok: false; error: string };
  /** Serialize a typed value to raw text. Must be deterministic — same
   *  input produces byte-identical output. */
  serialize: (value: T) => string;
  /** Write serialized content to the underlying storage. Must resolve on
   *  success and reject on failure. For the json-file-transport, this is
   *  typically a thin wrapper around `POST /api/files`. */
  writer: (content: string) => Promise<void>;
}

export function createJsonFileTransport<T>(
  options: JsonFileTransportOptions<T>,
): SyncTransport<T> {
  // ... (see Phase 1 Task 2 for the full implementation)
}
```

Three injected behaviors:
1. **How to parse** — mode supplies the schema validator. For ClipCraft: `parseProjectFile`.
2. **How to serialize** — mode supplies the formatter. For ClipCraft: `(f) => formatProjectJson(f)` wrapping `serializeProject`.
3. **How to write** — mode supplies the IO. For ClipCraft: `writeProjectFile` (which POSTs to `/api/files`).

The transport owns everything else: last-fed dedup, last-written echo detection, listener management, lifecycle.

---

## File Structure (Phase 1)

**Created:**
- `modes/_shared/sync/types.ts` — `SyncEvent<T>`, `SyncTransport<T>`, `JsonFileTransportOptions<T>`
- `modes/_shared/sync/json-file-transport.ts` — `createJsonFileTransport<T>` implementation
- `modes/_shared/sync/index.ts` — barrel re-export (`export * from "./types.js"; export * from "./json-file-transport.js";`)
- `modes/_shared/sync/__tests__/json-file-transport.test.ts` — unit tests

**Not touched in Phase 1:**
- Any file under `modes/clipcraft/` (lives on feat branch, Phase 2)
- Any file under `core/` (no runtime changes)
- Any file under `server/` (the transport uses the existing `POST /api/files` endpoint)
- `package.json`, tsconfig, build scripts

---

## Phase 1 Tasks (main branch)

### Task 1: Define types

**Files:**
- Create: `modes/_shared/sync/types.ts`

Write the `SyncEvent<T>` discriminated union and the `SyncTransport<T>` interface exactly as shown in "The abstraction" section above. Include the JSDoc comments verbatim — they document the subtle semantics (echoes absorbed internally, initial fires exactly once, parse-error is non-fatal).

Also include `JsonFileTransportOptions<T>`.

No logic, no tests for this file — it's a pure type declaration module.

Commit: `feat(sync): SyncTransport + JsonFileTransportOptions type definitions`

---

### Task 2: Implement `createJsonFileTransport` (TDD)

**Files:**
- Create: `modes/_shared/sync/__tests__/json-file-transport.test.ts`
- Create: `modes/_shared/sync/json-file-transport.ts`

Test cases (all should be in the failing-test file BEFORE any implementation exists):

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { createJsonFileTransport } from "../json-file-transport.js";
import type { SyncEvent } from "../types.js";

// Test parser: accepts any JSON object with a `title` string; rejects the rest
interface Payload { title: string; count?: number }
const parse = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ok: false as const, error: "not an object" };
    if (typeof parsed.title !== "string") return { ok: false as const, error: "title not a string" };
    return { ok: true as const, value: parsed as Payload };
  } catch (e) {
    return { ok: false as const, error: `parse: ${(e as Error).message}` };
  }
};
const serialize = (v: Payload) => JSON.stringify(v);

describe("createJsonFileTransport", () => {
  let writes: string[];
  let writeResolve: (() => void) | null;
  let writeReject: ((err: Error) => void) | null;
  let writer: (content: string) => Promise<void>;

  beforeEach(() => {
    writes = [];
    writeResolve = null;
    writeReject = null;
    writer = (content: string) => {
      writes.push(content);
      return new Promise<void>((res, rej) => {
        writeResolve = res;
        writeReject = rej;
      });
    };
  });

  function makeTransport() {
    return createJsonFileTransport<Payload>({ parse, serialize, writer });
  }

  it("feed with null content emits nothing and returns null", () => {
    const t = makeTransport();
    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    const r = t.feed(null);
    expect(r).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("first valid feed emits kind='initial'", () => {
    const t = makeTransport();
    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    const r = t.feed('{"title":"Hello"}');
    expect(r?.kind).toBe("initial");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "initial", value: { title: "Hello" } });
  });

  it("second valid feed with different content emits kind='external'", () => {
    const t = makeTransport();
    t.feed('{"title":"Hello"}');  // initial
    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    const r = t.feed('{"title":"World"}');
    expect(r?.kind).toBe("external");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "external", value: { title: "World" } });
  });

  it("duplicate feed with identical content emits nothing (dedup)", () => {
    const t = makeTransport();
    t.feed('{"title":"Hello"}');  // initial
    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    const r = t.feed('{"title":"Hello"}');
    expect(r).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("parse error emits kind='parse-error' with the offending raw text", () => {
    const t = makeTransport();
    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    const r = t.feed("{not json");
    expect(r?.kind).toBe("parse-error");
    expect(events).toHaveLength(1);
    if (events[0].kind === "parse-error") {
      expect(events[0].raw).toBe("{not json");
      expect(events[0].error).toMatch(/parse/i);
    }
  });

  it("parse error does not advance to initial — a later valid feed still fires initial", () => {
    const t = makeTransport();
    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    t.feed("{not json");  // parse-error
    t.feed('{"title":"Hello"}');  // initial (still first valid)
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("parse-error");
    expect(events[1].kind).toBe("initial");
  });

  it("write calls the writer with serialized content", async () => {
    const t = makeTransport();
    t.feed('{"title":"Hello"}');
    const writePromise = t.write({ title: "World" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('{"title":"World"}');
    writeResolve!();
    await writePromise;
  });

  it("subsequent feed with the just-written content is absorbed as echo", async () => {
    const t = makeTransport();
    t.feed('{"title":"Hello"}');  // initial
    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));

    const writePromise = t.write({ title: "World" });
    writeResolve!();
    await writePromise;

    const r = t.feed('{"title":"World"}');  // echo
    expect(r).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("external change AFTER a local write emits kind='external'", async () => {
    const t = makeTransport();
    t.feed('{"title":"Hello"}');  // initial
    const writePromise = t.write({ title: "World" });
    writeResolve!();
    await writePromise;
    t.feed('{"title":"World"}');  // echo (absorbed)

    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    const r = t.feed('{"title":"Modified by agent"}');
    expect(r?.kind).toBe("external");
    expect(events).toHaveLength(1);
  });

  it("failed write does not update the echo marker — the next feed of the attempted content is treated as external", async () => {
    const t = makeTransport();
    t.feed('{"title":"Hello"}');
    const writePromise = t.write({ title: "World" });
    writeReject!(new Error("disk full"));
    await expect(writePromise).rejects.toThrow("disk full");

    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    const r = t.feed('{"title":"World"}');
    expect(r?.kind).toBe("external");
    expect(events).toHaveLength(1);
  });

  it("destroy stops emitting events", () => {
    const t = makeTransport();
    const events: SyncEvent<Payload>[] = [];
    t.subscribe((e) => events.push(e));
    t.destroy();
    t.feed('{"title":"Hello"}');
    expect(events).toHaveLength(0);
  });

  it("multiple subscribers all receive events", () => {
    const t = makeTransport();
    const a: SyncEvent<Payload>[] = [];
    const b: SyncEvent<Payload>[] = [];
    t.subscribe((e) => a.push(e));
    t.subscribe((e) => b.push(e));
    t.feed('{"title":"Hello"}');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("unsubscribe stops that listener without affecting others", () => {
    const t = makeTransport();
    const a: SyncEvent<Payload>[] = [];
    const b: SyncEvent<Payload>[] = [];
    const unsubA = t.subscribe((e) => a.push(e));
    t.subscribe((e) => b.push(e));
    unsubA();
    t.feed('{"title":"Hello"}');
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });
});
```

Run the tests to confirm they all fail (module not found).

Then implement `modes/_shared/sync/json-file-transport.ts`:

```ts
import type { SyncEvent, SyncTransport, JsonFileTransportOptions } from "./types.js";

export function createJsonFileTransport<T>(
  options: JsonFileTransportOptions<T>,
): SyncTransport<T> {
  const { parse, serialize, writer } = options;

  let lastFedContent: string | null = null;    // dedup + parse-error state
  let lastWrittenContent: string | null = null; // echo detection
  let hasEmittedInitial = false;                // initial-vs-external discriminator
  let destroyed = false;
  const listeners = new Set<(e: SyncEvent<T>) => void>();

  function emit(event: SyncEvent<T>): void {
    for (const listener of listeners) {
      listener(event);
    }
  }

  return {
    feed(rawContent: string | null): SyncEvent<T> | null {
      if (destroyed) return null;
      if (rawContent === null) return null;

      // Dedup — same raw text as last feed, drop.
      if (rawContent === lastFedContent) return null;
      lastFedContent = rawContent;

      // Echo skip — this is the content we just wrote ourselves.
      if (rawContent === lastWrittenContent) return null;

      // Parse and classify.
      const result = parse(rawContent);
      if (!result.ok) {
        const event: SyncEvent<T> = {
          kind: "parse-error",
          error: result.error,
          raw: rawContent,
        };
        emit(event);
        return event;
      }

      const kind = hasEmittedInitial ? "external" : "initial";
      hasEmittedInitial = true;
      const event: SyncEvent<T> = { kind, value: result.value };
      emit(event);
      return event;
    },

    subscribe(listener: (event: SyncEvent<T>) => void): () => void {
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async write(value: T): Promise<void> {
      if (destroyed) return;
      const content = serialize(value);
      await writer(content);
      // Only update the echo marker AFTER the writer resolves — on
      // failure, the caller's next retry should be treated as a fresh
      // external intent, not as an echo of a write that never happened.
      lastWrittenContent = content;
      // Also update lastFedContent so a dedup-check picks up the echo
      // that arrives via the file watcher after this write succeeds.
      // (The lastWrittenContent check above would also catch it, but
      // updating both is belt-and-suspenders.)
      lastFedContent = content;
    },

    destroy(): void {
      destroyed = true;
      listeners.clear();
    },
  };
}
```

Run the tests and confirm they all pass (13 tests in the test file).

**One subtle thing to verify with an extra test or comment:** the dedup check happens BEFORE the echo check. Under React StrictMode, feed(X) can be called twice in rapid succession with the same X; the dedup drops the second call cheaply. If we reversed the order (echo check first), we'd still need the dedup after a successful external classification to avoid double-emitting to subscribers. Either order works for correctness, but "dedup first" minimizes work.

Commit: `feat(sync): createJsonFileTransport with origin-aware feed/write`

---

### Task 3: Barrel re-export

**Files:**
- Create: `modes/_shared/sync/index.ts`

```ts
export * from "./types.js";
export * from "./json-file-transport.js";
```

Run the test suite one more time to make sure nothing regressed from the barrel-file addition.

Commit: `feat(sync): barrel export for modes/_shared/sync`

---

### Task 4: Typecheck + final verification

**Files:** none modified.

- `bun run tsc --noEmit 2>&1 | grep "modes/_shared/sync"` — expected empty
- `bun test modes/_shared/sync/__tests__/` — expected: all green
- `bun test 2>&1 | tail -5` — expected: full suite unchanged except for the new test file

No commit for Task 4.

---

## Phase 1 self-review checklist

- [ ] All types documented with JSDoc including the subtle semantics (echoes absorbed internally, initial fires exactly once, parse-error is non-fatal)
- [ ] All 13 test cases in `json-file-transport.test.ts` are present and pass
- [ ] The implementation is <100 lines (the whole transport is a state machine with three pieces of state)
- [ ] No React imports in any file under `modes/_shared/sync/`
- [ ] No imports from `modes/clipcraft/` in any file under `modes/_shared/sync/` (the transport must NOT know about its consumers)
- [ ] No network code, no filesystem code — the `writer` is injected, not implemented here
- [ ] `destroy()` is idempotent and leaves all methods as no-ops
- [ ] `feed()` and `write()` are both safe to call on a destroyed transport (no crashes)
- [ ] Commit history on main: three Phase 1 commits (types → impl → barrel)

---

## Phase 2 sketch (feat branch, my job after rebase)

**Not covered in detail here** — I'll write a fresh plan or fold it into Plan 4 setup after I rebase my feat branch onto the new main. This section exists only so you can validate the API design while implementing Phase 1.

### How ClipCraft will use the transport

```tsx
// modes/clipcraft/viewer/hooks/useProjectSync.ts (Phase 2 shape)

import { createJsonFileTransport } from "../../../_shared/sync/index.js";

export function useProjectSync(files, options) {
  const { onExternalEdit } = options;
  const dispatchEnvelope = usePneumaCraftStore((s) => s.dispatchEnvelope);
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const composition = usePneumaCraftStore((s) => s.composition);
  const eventCount = useEventLog().length;

  const currentTitleRef = useRef<string>("Untitled");

  // Transport is stable across renders, bound to the current writer/parser
  const transport = useMemo(() => createJsonFileTransport<ProjectFile>({
    parse: parseProjectFile,
    serialize: (f) => formatProjectJson(f),
    writer: writeProjectFile,
  }), []);

  // Cleanup on unmount
  useEffect(() => () => transport.destroy(), [transport]);

  // Find project.json content from props and feed the transport
  const projectFile = files.find((f) => f.path === "project.json" || f.path.endsWith("/project.json"));
  const diskContent = projectFile?.content ?? null;

  useEffect(() => {
    const event = transport.feed(diskContent);
    if (!event) return;
    switch (event.kind) {
      case "initial":
        currentTitleRef.current = event.value.title;
        for (const env of projectFileToCommands(event.value)) {
          try { dispatchEnvelope(env); } catch (e) { console.warn(...); }
        }
        return;
      case "external":
        // Store is live with stale content. Defer to parent for remount.
        // Transport already tagged this so we KNOW it's external.
        onExternalEdit();
        return;
      case "parse-error":
        // Future: expose via return value
        return;
    }
  }, [diskContent, transport, dispatchEnvelope, onExternalEdit]);

  // Persistence: debounced serialize + transport.write
  useEffect(() => {
    const timer = setTimeout(async () => {
      const file = serializeProject(coreState, composition, currentTitleRef.current);
      try {
        await transport.write(file);
      } catch (e) {
        console.error("[clipcraft] autosave failed", e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [eventCount, coreState, composition, transport]);

  // Return error state for StateDump rendering
  if (diskContent === null) return { error: "project.json not found in workspace" };
  // parseProjectFile is called again here for sync return — or the hook
  // could expose the last event via state. TBD in Phase 2.
  return { error: null };
}
```

### What disappears from ClipCraft in Phase 2

| Removed | Replaced by |
|---|---|
| `lastAppliedRef` in `ClipCraftPreview` | Transport's internal `lastWrittenContent` |
| `hydratedDiskRef` in `useProjectSync` | Transport's internal `lastFedContent` (dedup) |
| String comparison + manual echo detection | Transport's `feed()` classifier |
| `isExternalEdit` pure helper | Transport emits `kind: "external"` directly |
| `lastAppliedRef.current = null` in `onExternalEdit` (the load-bearing coupling) | Gone — transport is self-contained, parent just handles the `external` event by remounting |
| `modes/clipcraft/viewer/externalEdit.ts` (the file itself) | Deleted — no longer needed |

### What stays in ClipCraft after Phase 2

| Kept | Reason |
|---|---|
| `providerKey` counter in parent state | Craft store still needs hard reset on external edit. Diff-and-dispatch is a separate future plan; this plan only fixes origin identification. |
| `onExternalEdit` callback + `providerKey` bump | Same reason — remount-on-external-edit is ClipCraft's strategy for state-machine rebuild, not something the transport can replace. |
| `currentTitleRef` | Still needed until craft gets a project-level title concept. |
| `useProjectSync` hook | Still the viewer's sync entry point, just thinner. |

### ClipCraft's architecture doc update

`modes/clipcraft/ARCHITECTURE.md`'s "Loop protection: three refs, three different races" section collapses down to one ref (`providerKey` counter) + a reference to the transport library:

> **Loop protection** is delegated to `modes/_shared/sync`, which owns the `lastWritten` / `lastFed` state machine and tags every change event with an `origin: "initial" | "external" | "parse-error"` discriminant. ClipCraft only handles the semantic decision: `"external"` events trigger a provider remount via `providerKey` bump, because the craft store is live and can't safely receive duplicate commands.

The "Unofficial seventh direction" framing also gets an upgrade: it's no longer "ClipCraft's innovation", it's "the first adopter of `modes/_shared/sync`, which any mode can pick up when it needs bidirectional sync with origin tagging". The extension point is in-tree and reusable.

---

## Known non-goals (worth restating)

- **No diff-and-dispatch.** The craft store still gets rebuilt from scratch on external edit. Preserving in-memory state (undo history, PlaybackEngine position) across agent edits is a separate future plan, probably driven by Plan 4's playback needs.
- **No manifest-level persistence declaration.** Each mode still creates its transport imperatively. When a second mode needs the same thing, we'll consider a `core/sync/` promotion with a `manifest.persistence` field.
- **No React integration helper in `modes/_shared/sync/`.** If/when a second consumer arrives, the appropriate shared hook would land in `modes/_shared/sync/react.ts`. Until then, ClipCraft's `useProjectSync` is the only React consumer and it lives in the mode, not the shared library.
- **No debounce in the transport.** Callers debounce `write()` themselves. ClipCraft's 500ms autosave debounce is a mode-level decision; a text editor mode might want a different value. Keeping debounce out of the transport keeps the library concerns clean.
- **No provider-layer API (React Context).** The transport is a plain object that doesn't integrate with React's Context API. This is deliberate — the transport should work in any reactive framework, and the React integration is a thin wrapper owned by each consumer.
