# ClipCraft Source Migration Guide

> **Audience:** the author of the ClipCraft mode, whose branch lives in `feat/clipcraft-by-pneuma-craft`. This document explains how to replace the `useProjectSync` + `externalEdit.ts` + three-ref dance with a single `json-file` source declaration against the source abstraction that landed on `main` via `feat/source-abstraction` (commits `90429bc`..`ba4928b`).
>
> **Prerequisite:** rebase your ClipCraft branch onto the new `main` first. The source abstraction is already in place for every other mode; your branch will fail to compile because `ViewerPreviewProps.files` no longer exists — every mode now receives `props.sources` + `props.fileChannel` instead.
>
> **Companion reading:** `docs/superpowers/plans/2026-04-13-source-abstraction.md` (the full plan, still on the branch as historical context), `docs/reference/viewer-agent-protocol.md` (the "Sources — Viewer 的数据通道" section), and the original `docs/superpowers/plans/2026-04-13-mode-sync-transport.md` (superseded, but its analysis of the ClipCraft three-ref dance is still the clearest description of the failure mode).

## What you delete

Every piece of state the original three-ref dance needed is replaced by infrastructure that already exists on `main`:

| Old | Why it existed | New owner |
|---|---|---|
| `ClipCraftPreview.lastAppliedRef: string \| null` | Parent-component ref that survived provider remount so the next hydration could tell "did I already apply this exact content?" — reverse-engineered echo detection | **Server-side `pendingSelfWrites` map** (`server/file-watcher.ts`). The runtime tags every chokidar echo of a viewer-originated write with `origin: "self"` at the source, before the event ever reaches the browser. |
| `useProjectSync.hydratedDiskRef: string \| null` | Hook-instance ref to handle React 19 StrictMode double-invocation of effects | **`useSyncExternalStore` inside `useSource`**. StrictMode re-subscribes cleanly without re-emitting initial; `current()` is the stable source of truth for first render. |
| `ClipCraftPreview.onExternalEdit` null-reset of `lastAppliedRef.current` before `setProviderKey` | Load-bearing ordering — the original bug in Plan 3b — that had to run in exactly the right sequence to avoid infinite remount | **Gone entirely.** The ordering that had to be correct doesn't exist anymore. |
| `modes/clipcraft/viewer/externalEdit.ts` (the file) | `isExternalEdit()` pure helper + supporting machinery | **Delete the whole file.** Replaced by `status.lastOrigin === "external"` from `useSource`. |
| `useProjectSync` hook (the file) | Coordinated the 3-ref dance + autosave debounce + dispatchEnvelope loop | Replaced by inline subscribe + write effects in `ClipCraftPreview`. See Step 2 below. |
| Module-scoped `writeProjectFile` helper (if you have one) that calls `POST /api/files` | The ClipCraft side of the echo loop | Replaced by `source.write(value)` — the `json-file` provider handles serialization + persistence + self-event emission atomically. |

## What stays

Not everything from the three-ref dance was about echo detection. These stay because they're semantic decisions, not plumbing:

| Kept | Reason |
|---|---|
| `providerKey: number` state in the parent | You still need to remount the Zustand craft store on external edits — the craft state machine can't safely receive duplicate commands against a live store, so "nuke and rehydrate from the new project" remains the right strategy. What changes is the **trigger**: a clean `status.lastOrigin === "external"` check, not a string-compare against a ref. |
| `currentTitleRef: string` | The craft store has no project-level title concept; the title lives as a side-channel in the viewer until craft gains one. Not related to the echo problem — leave it alone. |
| 500ms autosave debounce | Still needed so rapid local edits don't thrash the disk. Just move the debounce to wrap `source.write(...)` instead of wrapping the old fetch. |

## What you add

### Step 1: Declare a `json-file` source in `manifest.ts`

ClipCraft's domain is a single structured aggregate (`ProjectFile`) persisted at `project.json`. That's exactly what `json-file` is for:

```ts
// modes/clipcraft/manifest.ts
import { parseProjectFile, formatProjectJson } from "./serialization.js";
import type { ProjectFile } from "./types.js";

const clipcraftManifest: ModeManifest = {
  // ... existing fields (name, version, displayName, description, skill, viewer, agent, ...) ...

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
        serialize: (value: ProjectFile): string => formatProjectJson(value),
      },
    },
    // If ClipCraft's viewer also needs to render a list of exported .mp4 files
    // or any other workspace-adjacent content (timeline thumbnails, asset
    // library, etc.), declare a second file-glob source alongside `project`.
    // Otherwise leave sources to just the single `project` entry.
  },
};

export default clipcraftManifest;
```

Key points:
- **`parse` throws on invalid content.** The `json-file` provider catches the throw and emits a `{ kind: "error", code: "E_PARSE" }` event, leaving the source live for future updates. Your viewer's error UI (if any) reads from `useSource`'s `status.lastError`.
- **`serialize` must be deterministic.** Same `ProjectFile` input → byte-identical string output every time. If `formatProjectJson` has any nondeterminism (timestamps, Map iteration order, floating-point format), fix that first — otherwise the server-side `pendingSelfWrites` content-equality match will miss echoes and you'll see phantom "external" events for your own writes.

### Step 2: Replace `useProjectSync` with a thin inline binding in `ClipCraftPreview`

The old hook returned a bag of state and effects. The new shape uses `useSource` directly. Here's the complete replacement shape — port the inner details to match your existing craft store calls:

```tsx
// modes/clipcraft/viewer/ClipCraftPreview.tsx
import { useEffect, useRef, useState } from "react";
import { useSource } from "../../../src/hooks/useSource.js";
import type { Source } from "../../../core/types/source.js";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import type { ProjectFile } from "./types.js";
import {
  usePneumaCraftStore,
  useEventLog,
  serializeProject,
  projectFileToCommands,
} from "./craft-integration.js"; // your existing craft store glue

export function ClipCraftPreview({ sources }: ViewerPreviewProps) {
  const projectSource = sources.project as Source<ProjectFile>;
  const { value: project, write: writeProject, status } = useSource(projectSource);

  const dispatchEnvelope = usePneumaCraftStore((s) => s.dispatchEnvelope);
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const composition = usePneumaCraftStore((s) => s.composition);
  const eventCount = useEventLog().length;

  const currentTitleRef = useRef<string>("Untitled");
  const [providerKey, setProviderKey] = useState(0);

  // ── 1. Hydration: initial or external → rebuild craft store ─────────
  //
  // Self-origin events are our own autosave coming back through the
  // FileChannel. The craft store already reflects them (we dispatched
  // envelopes BEFORE calling writeProject below), so skip them here —
  // rebuilding on self would replay the same envelopes against a store
  // that already has them.
  useEffect(() => {
    if (!project) return;
    if (status.lastOrigin === "self") return;

    if (status.lastOrigin === "initial") {
      // First hydration on mount. The provider remount machinery above
      // (providerKey) is at its initial value, so the craft store is
      // fresh and ready.
      currentTitleRef.current = project.title;
      for (const env of projectFileToCommands(project)) {
        try {
          dispatchEnvelope(env);
        } catch (e) {
          console.warn("[clipcraft] initial dispatch failed", e);
        }
      }
      return;
    }

    if (status.lastOrigin === "external") {
      // Agent (or another writer) edited project.json while we were
      // watching. The craft store has live in-flight state that can't
      // safely accept duplicate commands — bump providerKey to rebuild
      // a fresh store, and the NEXT render will fall into the "initial"
      // branch above (against the new store) to re-play the new project.
      //
      // Note: this still loses undo history and PlaybackEngine position.
      // That's a known limitation — diff-and-dispatch is a separate
      // future plan, not part of the source abstraction.
      setProviderKey((k) => k + 1);
    }
  }, [project, status.lastOrigin, dispatchEnvelope]);

  // ── 2. Autosave: debounced serialize + source.write ─────────────────
  //
  // No more ref-before-fetch dance. source.write() is atomic and the
  // self event comes back through subscribe with origin === "self", at
  // which point the hydration effect above sees it and skips — no loop.
  useEffect(() => {
    const timer = setTimeout(async () => {
      const file = serializeProject(
        coreState,
        composition,
        currentTitleRef.current,
      );
      try {
        await writeProject(file);
        // After await resolves, the provider guarantees:
        //   - content is on disk
        //   - status.lastOrigin === "self"
        //   - all current subscribers have seen the self event
        //   - `useSource`'s `value` reflects the new file
        // You don't need any post-write bookkeeping.
      } catch (err) {
        console.error("[clipcraft] autosave failed", err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [eventCount, coreState, composition, writeProject]);

  // ── 3. Render with remount key ──────────────────────────────────────
  return (
    <PneumaCraftProvider key={providerKey}>
      <ClipCraftCanvas />
    </PneumaCraftProvider>
  );
}
```

Things to notice:

- **The `write()` Promise is time-locked.** `await writeProject(file)` resolves only after the provider has (a) persisted via `FileChannel.write`, (b) updated `current()`, (c) delivered the `{ origin: "self" }` event to all subscribers. The P2 `BaseSource` contract guarantees this — tests at `core/sources/__tests__/base.test.ts` pin it.
- **No optimistic state.** `useSource` gives you `value` straight from the latest subscription event. After `await writeProject(v)`, the next render reads `value === v` automatically. You never have to hold a local copy.
- **No ref bookkeeping for echo detection.** The `status.lastOrigin === "self"` guard in the hydration effect is enough. There's no `lastAppliedRef`, no `hydratedDiskRef`, no `dirtyRef`, no load-bearing ordering.
- **`providerKey` remount still exists** but its trigger is a clean origin check. The old null-reset-then-setProviderKey ordering is gone.

### Step 3: Delete the dead files

Once `ClipCraftPreview` consumes `useSource` directly, these files have no callers and no purpose:

```bash
rm modes/clipcraft/viewer/hooks/useProjectSync.ts
rm modes/clipcraft/viewer/externalEdit.ts
```

If you have additional helpers under `modes/clipcraft/viewer/hooks/` that were only used by `useProjectSync`, delete those too. Grep to be sure:

```bash
grep -rn "useProjectSync\|lastAppliedRef\|hydratedDiskRef\|isExternalEdit" modes/clipcraft/
```

Expected: empty after the refactor.

## Why this is correct

Your four pieces of state, mapped to their new owners:

| Piece | Old location | New location |
|---|---|---|
| `lastAppliedRef` | Parent component state, survived remount | Server-side `pendingSelfWrites: Map<path, { content, expiresAt }>` with a 5s TTL — tags chokidar echoes at the source, before they become WS events |
| `hydratedDiskRef` | Hook instance, died on remount | React's `useSyncExternalStore` via `useSource` — StrictMode-safe by construction |
| `providerKey: number` | **STAY** | **STAY** — this is ClipCraft's state-machine rebuild strategy, not an echo-detection artifact |
| `currentTitleRef` | Hook instance | **STAY** — title side-channel until craft gains a title concept |

The load-bearing ordering that was load-bearing — `lastAppliedRef.current = null; setProviderKey(k => k + 1)` — is gone because `lastAppliedRef` is gone. There's no longer a pair of mutations whose order can be wrong. The E2E regression Plan 3b shipped (silently wrong ordering → infinite remount under specific timing) is **structurally impossible** on the new shape.

## What the source abstraction does NOT fix for you

These are real limitations of the new shape that you'll want to know about before you rely on them:

1. **Undo history and PlaybackEngine position are still lost on external edit.** Remount-on-external stays. Preserving in-memory craft state across agent edits requires diff-and-dispatch, which is a separate future plan — probably driven by Plan 4's playback needs. If an agent edit drops the user in the middle of a long timeline, they'll still see the playhead reset. This is not a regression from your current shape — your current shape already remounts on external edit; it just does so fragile-ly.

2. **`currentTitleRef` as a side-channel.** The title lives outside `project.title` because there's no clean place for it in the craft store's command graph. Nothing in this migration changes that. The cleanest long-term fix is to make "title" a first-class craft concept, dispatched as a command like everything else, so `serializeProject` reads it from the store directly and `currentTitleRef` goes away. Out of scope for P7.

3. **Serialize determinism.** If `formatProjectJson` emits different bytes for equivalent inputs (e.g., because it JSON.stringify's a `Map` which iterates in insertion order but the store mutates that order), the `pendingSelfWrites` content-equality check will miss the echo and `status.lastOrigin` will come back `"external"` for your own write. Symptom: writing anything immediately triggers a spurious remount. Fix: make serialization canonical (sort keys, sort arrays where order doesn't matter, etc.). Check this before you ship.

4. **`Source.write()` rejects on disk failure.** If the server-side `/api/files` POST fails (disk full, permission denied, path outside workspace), `await writeProject(file)` rejects. The autosave effect above catches the rejection and logs. You may want a UI affordance for "save failed, retry?" — that's UX polish on top of the contract, not a gap in the contract.

5. **There is no `aggregate-file` equivalent for ClipCraft.** Your domain IS one file (`project.json`), so `json-file` is the right provider. If you later add multi-file structure (e.g., separate timeline clips per file, or external asset manifests), consider switching to `aggregate-file` — the plan's slide / webcraft / illustrate migrations are working examples of that pattern. See `modes/slide/domain.ts` for a complete `loadDeck` / `saveDeck` reference implementation.

## Verification

After the refactor lands on your branch:

```bash
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft"
```
Expected: empty (or only pre-existing errors unrelated to the migration — pre-existing seed template errors like `modes/clipcraft/seed/**` are fine).

```bash
bun test
```
Expected: existing test suite still passes. If you have E2E tests for ClipCraft (Plan 3b added at least one), they should keep passing — in fact, the one covering the load-bearing ordering bug should pass MORE robustly because the ordering no longer exists to get wrong.

Manual smoke tests:

1. **Fresh session.** Launch clipcraft against an empty workspace. Verify the scaffolded `project.json` loads and the canvas renders — this exercises `origin: "initial"`.
2. **Local edit round-trip.** Make several rapid edits in the canvas. Verify:
   - `project.json` on disk updates (tail -f the file to confirm)
   - The craft store does NOT remount on your own saves (no flash, no cursor jumps)
   - After each `await writeProject(...)` settles, `status.lastOrigin === "self"` at the next render
3. **Agent edit while watching.** Start the agent on the same workspace. Ask it to modify the project. Verify:
   - The viewer detects the change (`status.lastOrigin === "external"` at the next render)
   - The craft store rebuilds via `providerKey++`
   - The new project state renders correctly
4. **Concurrent edit.** Type rapidly in the canvas AND have the agent issue edits in the same second. Verify no crash, no stuck remount loop, and that the user's in-flight local edits are either (a) preserved if the agent's external edit arrived after the local save's disk ack, or (b) replaced by the agent's version if the external edit arrived first. Either resolution is acceptable — what's NOT acceptable is a phantom infinite remount, which is the regression Plan 3b once shipped. If you see infinite remount, the most likely cause is `formatProjectJson` non-determinism (see limitation #3 above).

## Commit boundaries

The refactor breaks down into three clean commits on your branch:

```bash
# Commit 1 — declare the source
git add modes/clipcraft/manifest.ts
git commit -m "feat(clipcraft): declare sources.project as json-file

Replaces the imperative useProjectSync scaffolding with a declarative
source at the manifest layer. Viewer still reads from the legacy plumbing
until commit 2."

# Commit 2 — migrate the viewer
git add modes/clipcraft/viewer/ClipCraftPreview.tsx
git commit -m "refactor(clipcraft): migrate ClipCraftPreview to useSource(project)

Deletes the three-ref dance (lastAppliedRef / hydratedDiskRef /
ordering-dependent null-reset) and replaces it with a single
useSource(sources.project). origin === \"external\" triggers the
same providerKey remount the old onExternalEdit did, but without
any of the state bookkeeping.

autosave debounce is preserved; scheduleSave now calls source.write()
directly and relies on the provider's time-locked write Promise.

Load-bearing ordering that shipped broken in Plan 3b is structurally
impossible on the new shape."

# Commit 3 — delete the dead files
git add modes/clipcraft/viewer/hooks/useProjectSync.ts \
        modes/clipcraft/viewer/externalEdit.ts
git commit -m "refactor(clipcraft): delete useProjectSync + externalEdit (dead code)

Replaced by useSource(sources.project) + origin-tagged events in
ClipCraftPreview. Both files have zero callers after the migration."
```

## Questions or pushback

If something in this guide doesn't fit your branch's actual state — maybe your serialization layer is different, maybe `currentTitleRef` is actually deletable in your version, maybe you have a different parent-component shape than `ClipCraftPreview` — **adapt rather than fight the pattern**. The important thing is:

1. Declare a `json-file` source with your `parse` and `serialize`
2. Consume it via `useSource` in the viewer
3. Replace autosave fetch with `source.write`
4. Gate remount on `status.lastOrigin === "external"`
5. Delete everything that was reverse-engineering origin from content

Everything else is detail you own.

If the abstraction can't express something you need — e.g., you want to observe `"self"` events for some reason, or you need per-path write serialization across multiple sources — flag it back to the `feat/source-abstraction` authors. The contract in `core/types/source.ts` is still fresh and can evolve.
