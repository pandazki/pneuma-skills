# ClipCraft Plan 2: Domain + Store Hydration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `@pneuma-craft/timeline`'s `TimelineCore` into the new `clipcraft` mode. Define a canonical `project.json` schema that covers AIGC asset lifecycle. Load the file from disk via hydration-via-events so craft's event log stays intact. Render the current state as a readable text dump so we can see the wiring works end-to-end. Also push `Asset.status` as a first-class field into `@pneuma-craft/core` so every future craft consumer gets the AIGC lifecycle for free.

**Architecture:** Plan 2 is **read-only**. The agent edits `project.json` via its normal file-editing tools; pneuma's chokidar watcher fans out the change to the viewer; the viewer rehydrates craft state by dispatching a sequence of commands (hydration-via-events). No writes from the viewer back to disk in this plan — that comes in Plan 3 when user-initiated actions need to persist, at which point we'll need self-write suppression + content-hash guards. The read-only framing naturally cuts the write→watch→read cycle so we don't have to build that protection yet.

**Tech Stack:**
- Cross-repo work: changes land in both `/Users/pandazki/Codes/pneuma-craft-headless-stable` (craft-core) and `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft` (pneuma-skills worktree).
- Craft side: TypeScript, vitest, tsup (watch mode already running from Plan 1's Task 0 — if not, restart `bun run dev` in the craft repo root).
- Mode side: React 19, bun:test, existing `PneumaCraftProvider`.

**Out of scope for this plan:**
- Write path back to `project.json` (Plan 3)
- Self-write suppression and content-hash guards (Plan 3)
- Real Timeline UI / 3D overview / DiveCanvas (Plans 4-6)
- Playback (Plan 3)
- Export (Plan 7)
- MCP tool integration for agent-dispatched commands (Plan 8)
- Skill rewrite (Plan 9)
- Cross-session event log persistence (deferred; in-memory undo is enough until we have user-initiated writes)

---

## File Structure

### In `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core/`

**Modified:**
- `src/types.ts` — add `AssetStatus` type, extend `Asset` with optional `status?: AssetStatus`, add `asset:set-status` variant to `AssetCommand`
- `src/events.ts` — add `AssetStatusChangedEvent` to the `CoreEvent` union
- `src/command-handler.ts` — add `asset:set-status` case (validates asset exists, emits `asset:status-changed`)
- `src/state.ts` — add `asset:status-changed` case in `applyEvent` that immutably updates the asset's `status`
- `src/undo-manager.ts` — add `asset:status-changed` case in `invertCoreEvent` (swap `status` ↔ `previousStatus`)
- `__tests__/command-handler.test.ts` — add coverage for `asset:set-status` (happy path + missing-asset error)
- `__tests__/state.test.ts` — add coverage for `asset:status-changed` projection
- `__tests__/undo-manager.test.ts` — add coverage for `asset:status-changed` inversion

**No change needed to `src/index.ts`** — the new types are already re-exported via the existing `Asset`, `AssetCommand`, and `CoreEvent` re-exports.

### In `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/modes/clipcraft/`

**Created:**
- `persistence.ts` — single-file module exporting the `ProjectFile` TypeScript schema, a hand-written runtime validator, and a `projectFileToCommands()` function that turns a validated `ProjectFile` into an array of craft `CommandEnvelope` objects ready to dispatch
- `viewer/hooks/useProjectHydration.ts` — React hook that watches the `files` prop, parses `project.json`, validates, and dispatches the hydration command sequence into the craft store on mount and whenever the file content changes
- `viewer/StateDump.tsx` — component that reads craft state via `usePneumaCraftStore` hooks and renders a text-mode dump showing composition tracks, asset registry (with status badges), provenance edge count, and a tail of the last N events from the event log
- `__tests__/persistence.test.ts` — unit tests for `projectFileToCommands()` covering empty project, single-clip project, AIGC asset with provenance, invalid schema cases
- `seed/project.json` — **replace** the current placeholder with a minimal but non-empty `ProjectFile` so first launch shows real content

**Modified:**
- `viewer/ClipCraftPreview.tsx` — call `useProjectHydration`, render `<StateDump />` instead of the static placeholder. Keeps `PneumaCraftProvider` wrapping.
- `__tests__/craft-imports.test.ts` — add one `asset:set-status` roundtrip assertion so the consumer test locks down the new API

---

## Task Ordering

Tasks land in this order. Each task is one atomic commit.

**Cross-repo:**
- Tasks 1–5 live in the craft repo (`pneuma-craft-headless-stable`)
- Tasks 6–11 live in the pneuma-skills worktree

The craft dev-watch process (Turborepo `bun run dev` at the craft repo root) should be running throughout so every save rebuilds `dist/` and the symlinks in `node_modules/@pneuma-craft/` pick up changes instantly. If the watch isn't running, start it before Task 1 and leave it alive until Task 11.

---

## Task 1: Add AssetStatus type and extend Asset + AssetCommand

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1.1: Write the failing compile target**

Open `src/types.ts`. Above the `AssetMetadata` interface (around line 5), add:

```ts
/**
 * Lifecycle status for async AIGC assets.
 *
 * - `ready`  — default; asset is fully realized (uri points to a valid file).
 * - `pending` — queued for generation, not yet running.
 * - `generating` — provider job in flight; uri may be empty or a placeholder.
 * - `failed` — generation attempted and errored; uri is typically empty.
 *
 * Absence of the field is equivalent to `ready` (backward-compat for existing consumers).
 */
export type AssetStatus = 'pending' | 'generating' | 'ready' | 'failed';
```

Then in the `Asset` interface (around line 16–24), add the optional field immediately after `tags`:

```ts
export interface Asset {
  readonly id: string;
  readonly type: AssetType;
  readonly uri: string;
  readonly name: string;
  readonly metadata: AssetMetadata;
  readonly createdAt: number;
  readonly tags?: string[];
  readonly status?: AssetStatus;
}
```

Then in the `AssetCommand` union (around line 82), add the new variant as the last entry:

```ts
export type AssetCommand =
  | { type: 'asset:register'; asset: Omit<Asset, 'id' | 'createdAt'> }
  | { type: 'asset:remove'; assetId: string }
  | { type: 'asset:update-metadata'; assetId: string; metadata: Partial<AssetMetadata> }
  | { type: 'asset:tag'; assetId: string; tags: string[] }
  | { type: 'asset:set-status'; assetId: string; status: AssetStatus };
```

- [ ] **Step 1.2: Verify compile (partial failure expected)**

Run from the craft repo root:

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run typecheck 2>&1 | tail -20
```

Expected: a handful of new errors in `command-handler.ts` about the non-exhaustive `switch` statement (the compiler notices the new `asset:set-status` variant has no case). These are exactly the errors Task 2 will fix. Note them and proceed.

Do NOT silence these errors. Leave the `switch` incomplete — it's Task 2's job.

- [ ] **Step 1.3: Export check**

Run:

```bash
grep -n "AssetStatus" packages/core/src/index.ts
```

Expected: no match (yet — we haven't added it to the barrel). Then add it to `src/index.ts`:

```ts
// ── Types ───────────────────────────────────────────────────────────────
export type {
  Asset,
  AssetType,
  AssetStatus,
  AssetMetadata,
  // ... rest unchanged
```

Re-run the grep to confirm `AssetStatus` now appears in the types export list. No other edit to `index.ts` is needed.

- [ ] **Step 1.4: Commit** (in the craft repo)

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/core/src/types.ts packages/core/src/index.ts && git commit -m "feat(core): add AssetStatus type and asset:set-status command variant"
```

This commit intentionally leaves `command-handler.ts` unexhaustive — the next task closes the hole.

---

## Task 2: Handle asset:set-status in command-handler

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core`

**Files:**
- Modify: `src/command-handler.ts`
- Modify: `__tests__/command-handler.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Open `__tests__/command-handler.test.ts`. Append a new `describe` block inside the existing `describe('handleCommand — asset commands', ...)` group (look for where `asset:tag` tests end and insert after):

```ts
describe('asset:set-status', () => {
  it('produces asset:status-changed event with previous status', () => {
    const assetWithStatus: Asset = { ...sampleAsset, status: 'generating' };
    const state = stateWithAsset(assetWithStatus);
    const events = handleCommand(state, makeEnvelope({
      type: 'asset:set-status',
      assetId: 'asset-1',
      status: 'ready',
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('asset:status-changed');
    expect(events[0].payload.assetId).toBe('asset-1');
    expect(events[0].payload.status).toBe('ready');
    expect(events[0].payload.previousStatus).toBe('generating');
  });

  it('reports previousStatus as undefined when the asset had no explicit status', () => {
    const state = stateWithAsset(sampleAsset); // sampleAsset has no status field
    const events = handleCommand(state, makeEnvelope({
      type: 'asset:set-status',
      assetId: 'asset-1',
      status: 'failed',
    }));
    expect(events).toHaveLength(1);
    expect(events[0].payload.previousStatus).toBeUndefined();
  });

  it('throws when asset does not exist', () => {
    const state = createInitialState();
    expect(() => handleCommand(state, makeEnvelope({
      type: 'asset:set-status',
      assetId: 'missing',
      status: 'ready',
    }))).toThrow(CommandValidationError);
  });
});
```

- [ ] **Step 2.2: Run the tests to confirm they fail**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- command-handler 2>&1 | tail -30
```

Expected failure: the three new tests throw `CommandValidationError: Unknown command type: asset:set-status` (because the `switch`'s default branch catches the unhandled case). The other existing tests still pass.

- [ ] **Step 2.3: Implement the handler**

Open `src/command-handler.ts`. Inside the `switch (command.type) {` block, immediately after the `case 'asset:tag':` block (around line 77), add:

```ts
    case 'asset:set-status': {
      const asset = requireAsset(state, command.assetId);
      return [makeEvent(envelope, 'asset:status-changed', {
        assetId: command.assetId,
        status: command.status,
        previousStatus: asset.status,
      })];
    }
```

- [ ] **Step 2.4: Run the tests to confirm they pass**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- command-handler 2>&1 | tail -20
```

Expected: all tests in `command-handler.test.ts` pass. The `previousStatus` for the bare asset (no explicit status field) correctly comes through as `undefined`.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/core/src/command-handler.ts packages/core/__tests__/command-handler.test.ts && git commit -m "feat(core): handle asset:set-status command"
```

---

## Task 3: Project asset:status-changed in applyEvent

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core`

**Files:**
- Modify: `src/events.ts`
- Modify: `src/state.ts`
- Modify: `__tests__/state.test.ts`

- [ ] **Step 3.1: Add the event variant to the typed union**

Open `src/events.ts`. After the `AssetTaggedEvent` interface (around line 24–32), add:

```ts
interface AssetStatusChangedEvent {
  readonly type: 'asset:status-changed';
  readonly payload: {
    readonly assetId: string;
    readonly status: import('./types.js').AssetStatus;
    readonly previousStatus: import('./types.js').AssetStatus | undefined;
  };
}
```

Then in the `CoreEvent` union at the bottom of the file (around line 81), add `AssetStatusChangedEvent` between `AssetTaggedEvent` and `ProvenanceRootSetEvent`:

```ts
export type CoreEvent =
  | AssetRegisteredEvent
  | AssetRemovedEvent
  | AssetMetadataUpdatedEvent
  | AssetTaggedEvent
  | AssetStatusChangedEvent
  | ProvenanceRootSetEvent
  | ProvenanceLinkedEvent
  | ProvenanceUnlinkedEvent
  | SelectionSetEvent
  | SelectionClearedEvent;
```

- [ ] **Step 3.2: Write the failing projection tests**

Open `__tests__/state.test.ts`. Inside the existing describe for asset event projection, append:

```ts
describe('asset:status-changed projection', () => {
  it('updates the status field on the existing asset', () => {
    const state = stateWithAsset({ ...sampleAsset, status: 'generating' });
    const nextState = applyEvent(state, {
      id: 'evt-1', commandId: 'cmd-1', actor: 'human', timestamp: 2000,
      type: 'asset:status-changed',
      payload: { assetId: 'asset-1', status: 'ready', previousStatus: 'generating' },
    });
    const updated = nextState.registry.get('asset-1');
    expect(updated?.status).toBe('ready');
    // Other fields are untouched
    expect(updated?.uri).toBe(sampleAsset.uri);
    expect(updated?.metadata).toEqual(sampleAsset.metadata);
  });

  it('sets status on an asset that had none', () => {
    const state = stateWithAsset(sampleAsset); // no status
    const nextState = applyEvent(state, {
      id: 'evt-1', commandId: 'cmd-1', actor: 'human', timestamp: 2000,
      type: 'asset:status-changed',
      payload: { assetId: 'asset-1', status: 'failed', previousStatus: undefined },
    });
    expect(nextState.registry.get('asset-1')?.status).toBe('failed');
  });

  it('is a no-op if the asset does not exist', () => {
    const state = createInitialState();
    const nextState = applyEvent(state, {
      id: 'evt-1', commandId: 'cmd-1', actor: 'human', timestamp: 2000,
      type: 'asset:status-changed',
      payload: { assetId: 'ghost', status: 'ready', previousStatus: undefined },
    });
    expect(nextState).toBe(state); // identity-preserving
  });
});
```

The `stateWithAsset` + `sampleAsset` helpers should already exist at the top of the file from the existing tests — if not, copy them from `__tests__/command-handler.test.ts`.

- [ ] **Step 3.3: Run tests to confirm failure**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- state 2>&1 | tail -20
```

Expected: the three new tests fail because `applyEvent`'s switch falls through to `default: return state`, leaving the status unchanged.

- [ ] **Step 3.4: Implement the projection**

Open `src/state.ts`. Inside the `applyEvent` switch, immediately after the `case 'asset:tagged':` block (around line 64), add:

```ts
    case 'asset:status-changed': {
      const existing = state.registry.get(e.payload.assetId);
      if (!existing) return state;
      const updated = { ...existing, status: e.payload.status };
      const registry = new Map(state.registry);
      registry.set(e.payload.assetId, updated);
      return { ...state, registry };
    }
```

- [ ] **Step 3.5: Run tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- state 2>&1 | tail -20
```

Expected: all state projection tests pass.

- [ ] **Step 3.6: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/core/src/events.ts packages/core/src/state.ts packages/core/__tests__/state.test.ts && git commit -m "feat(core): project asset:status-changed into registry"
```

---

## Task 4: Invert asset:status-changed for undo

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core`

**Files:**
- Modify: `src/undo-manager.ts`
- Modify: `__tests__/undo-manager.test.ts`

- [ ] **Step 4.1: Write the failing inversion test**

Open `__tests__/undo-manager.test.ts`. In the existing test group for `invertCoreEvent`, append:

```ts
describe('invertCoreEvent — asset:status-changed', () => {
  it('swaps status and previousStatus', () => {
    const original: Event = {
      id: 'evt-1', commandId: 'cmd-1', actor: 'human', timestamp: 1000,
      type: 'asset:status-changed',
      payload: { assetId: 'asset-1', status: 'ready', previousStatus: 'generating' },
    };
    const inverted = invertCoreEvent(original);
    expect(inverted.type).toBe('asset:status-changed');
    expect(inverted.payload).toMatchObject({
      assetId: 'asset-1',
      status: 'generating',
      previousStatus: 'ready',
    });
    expect(inverted.commandId).toBe('cmd-1'); // preserved
    expect(inverted.id).not.toBe('evt-1'); // fresh id
  });

  it('inverts cleanly when previousStatus was undefined', () => {
    const original: Event = {
      id: 'evt-1', commandId: 'cmd-1', actor: 'agent', timestamp: 1000,
      type: 'asset:status-changed',
      payload: { assetId: 'asset-1', status: 'failed', previousStatus: undefined },
    };
    const inverted = invertCoreEvent(original);
    // Inverting "undefined → failed" produces "failed → undefined"
    expect(inverted.payload).toMatchObject({
      assetId: 'asset-1',
      status: undefined,
      previousStatus: 'failed',
    });
  });
});
```

- [ ] **Step 4.2: Run tests to confirm failure**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- undo-manager 2>&1 | tail -20
```

Expected failure: `invertCoreEvent` throws `Cannot invert unknown event type: asset:status-changed` because the switch doesn't handle it.

- [ ] **Step 4.3: Implement the inversion**

Open `src/undo-manager.ts`. Inside the `invertCoreEvent` switch, immediately after the `case 'asset:tagged':` block (around line 44), add:

```ts
    case 'asset:status-changed': {
      return { ...base, type: 'asset:status-changed', payload: {
        assetId: e.payload.assetId,
        status: e.payload.previousStatus,
        previousStatus: e.payload.status,
      }};
    }
```

- [ ] **Step 4.4: Run tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- undo-manager 2>&1 | tail -20
```

Expected: all undo-manager tests pass. Also confirm the earlier tests for `asset:tagged` etc. still pass (regression check).

- [ ] **Step 4.5: Run the full core suite to catch anything downstream**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core 2>&1 | tail -30
```

Expected: all 17 core test files pass. If the `core.test.ts` integration test fails because it dispatches a full lifecycle, the issue is likely a missed case in `applyEvent`, `invertCoreEvent`, or the command handler — go back to the relevant task to fix.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/core/src/undo-manager.ts packages/core/__tests__/undo-manager.test.ts && git commit -m "feat(core): invert asset:status-changed for undo/redo"
```

---

## Task 5: Rebuild craft dist and verify consumer sees new API

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable`

**Files:** none modified — verification only.

- [ ] **Step 5.1: Build craft repo**

If the Turborepo dev watch is still running, it should have rebuilt already. To be safe, force a fresh build:

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run build 2>&1 | tail -15
```

Expected: 5 packages build successfully, `packages/core/dist/index.js` and `dist/index.d.ts` regenerated with today's mtime.

- [ ] **Step 5.2: Verify the new type surfaces in the built d.ts**

```bash
grep -c "AssetStatus\|asset:set-status\|asset:status-changed" /Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core/dist/index.d.ts
```

Expected: count ≥ 6 (`AssetStatus` type declaration, `status?` on `Asset`, `asset:set-status` in `AssetCommand`, `asset:status-changed` event interface, `AssetStatusChangedEvent` in the `CoreEvent` union, and the export from `index.ts`).

- [ ] **Step 5.3: Verify consumer side picks it up immediately**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun -e "import('@pneuma-craft/core').then(m => { const c = m.createCore(); const events = m.handleCommand(m.createInitialState(), { id: 'x', actor: 'human', timestamp: 0, command: { type: 'asset:register', asset: { type: 'image', uri: '/t.png', name: 't', metadata: {}, status: 'generating' }}}); console.log('status surfaced:', (events[0].payload.asset as any).status); });"
```

Expected output: `status surfaced: generating`

If this fails with "Unknown command" or a TS-level error, the symlinked `dist/` didn't update — try rerunning Step 5.1 or check the Turborepo watch log.

- [ ] **Step 5.4: Push craft repo commits**

Tasks 1-4 produced 4 commits in the craft repo. This task has no new craft changes, so just confirm the log:

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git log --oneline -6
```

Expected to see (latest first):
```
<sha> feat(core): invert asset:status-changed for undo/redo
<sha> feat(core): project asset:status-changed into registry
<sha> feat(core): handle asset:set-status command
<sha> feat(core): add AssetStatus type and asset:set-status command variant
<sha> ... (prior commits)
```

No commit needed for Task 5 itself. Do NOT push to a remote — the user hasn't requested that.

---

## Task 6: Define the ProjectFile schema and validator

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Create: `modes/clipcraft/persistence.ts`
- Create: `modes/clipcraft/__tests__/persistence.test.ts`

- [ ] **Step 6.1: Write the failing tests first**

Create `modes/clipcraft/__tests__/persistence.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { parseProjectFile, projectFileToCommands } from "../persistence.js";
import type { ProjectFile } from "../persistence.js";

const minimalValid: ProjectFile = {
  $schema: "pneuma-craft/project/v1",
  title: "Untitled",
  composition: {
    settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    tracks: [],
    transitions: [],
  },
  assets: [],
  provenance: [],
};

describe("parseProjectFile", () => {
  it("accepts a minimal valid file", () => {
    const result = parseProjectFile(JSON.stringify(minimalValid));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe("Untitled");
  });

  it("rejects non-JSON input", () => {
    const result = parseProjectFile("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/parse/i);
  });

  it("rejects files missing composition", () => {
    const bad = { ...minimalValid } as Partial<ProjectFile>;
    delete (bad as { composition?: unknown }).composition;
    const result = parseProjectFile(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it("rejects files with wrong $schema", () => {
    const bad = { ...minimalValid, $schema: "something-else" };
    const result = parseProjectFile(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it("accepts AIGC asset with status=generating and empty uri", () => {
    const withPending: ProjectFile = {
      ...minimalValid,
      assets: [
        {
          id: "a1",
          type: "image",
          uri: "",
          name: "forest-dawn (generating)",
          metadata: {},
          createdAt: 1000,
          status: "generating",
        },
      ],
    };
    const result = parseProjectFile(JSON.stringify(withPending));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assets[0].status).toBe("generating");
  });
});

describe("projectFileToCommands", () => {
  it("returns an empty command list for an empty project", () => {
    const cmds = projectFileToCommands(minimalValid);
    // Empty composition still emits composition:create, so at least 1 command.
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    expect(cmds[0].command.type).toBe("composition:create");
  });

  it("emits asset:register + provenance:set-root for an AIGC asset with null parent", () => {
    const file: ProjectFile = {
      ...minimalValid,
      assets: [
        {
          id: "a1",
          type: "video",
          uri: "assets/clips/shot01.mp4",
          name: "shot01",
          metadata: { width: 1920, height: 1080, duration: 5 },
          createdAt: 1000,
          status: "ready",
        },
      ],
      provenance: [
        {
          toAssetId: "a1",
          fromAssetId: null,
          operation: {
            type: "generate",
            actor: "agent",
            timestamp: 1000,
            label: "runway gen3",
            params: { model: "gen3-alpha-turbo", prompt: "a forest" },
          },
        },
      ],
    };
    const cmds = projectFileToCommands(file);
    const types = cmds.map((c) => c.command.type);
    expect(types).toContain("composition:create");
    expect(types).toContain("asset:register");
    expect(types).toContain("provenance:set-root");
  });

  it("emits composition:add-track and composition:add-clip for a populated composition", () => {
    const file: ProjectFile = {
      ...minimalValid,
      assets: [
        {
          id: "a1",
          type: "video",
          uri: "assets/clips/shot01.mp4",
          name: "shot01",
          metadata: { duration: 5 },
          createdAt: 1000,
        },
      ],
      composition: {
        settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
        tracks: [
          {
            id: "v1",
            type: "video",
            name: "Video 1",
            muted: false,
            volume: 1,
            locked: false,
            visible: true,
            clips: [
              { id: "c1", assetId: "a1", startTime: 0, duration: 5, inPoint: 0, outPoint: 5 },
            ],
          },
        ],
        transitions: [],
      },
    };
    const cmds = projectFileToCommands(file);
    const types = cmds.map((c) => c.command.type);
    expect(types).toContain("composition:add-track");
    expect(types).toContain("composition:add-clip");
  });
});
```

- [ ] **Step 6.2: Run the failing test (module doesn't exist yet)**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/persistence.test.ts 2>&1 | tail -20
```

Expected: module-not-found error because `../persistence.js` doesn't exist yet.

- [ ] **Step 6.3: Write `persistence.ts`**

Create `modes/clipcraft/persistence.ts`:

```ts
/**
 * ClipCraft on-disk project schema + loader.
 *
 * Plan 2 scope: read-only. Converts a parsed ProjectFile into a sequence of
 * craft CommandEnvelopes (hydration-via-events) so the craft store rebuilds
 * itself from disk without bypassing the event log. Writes come in Plan 3.
 */

import type {
  Actor,
  AssetStatus,
  AssetType,
  CommandEnvelope,
  CoreCommand,
  Operation,
} from "@pneuma-craft/core";
import type { CompositionCommand } from "@pneuma-craft/timeline";

// ── On-disk types ────────────────────────────────────────────────────────

export interface ProjectAsset {
  id: string;
  type: AssetType;
  uri: string;
  name: string;
  metadata: Record<string, number | string | undefined>;
  createdAt: number;
  tags?: string[];
  status?: AssetStatus;
}

export interface ProjectClip {
  id: string;
  assetId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  text?: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export type ProjectTrackType = "video" | "audio" | "subtitle";

export interface ProjectTrack {
  id: string;
  type: ProjectTrackType;
  name: string;
  muted: boolean;
  volume: number;
  locked: boolean;
  visible: boolean;
  clips: ProjectClip[];
}

export interface ProjectTransition {
  id: string;
  type: "cut" | "crossfade" | "fade-to-black";
  duration: number;
  fromClipId: string;
  toClipId: string;
}

export interface ProjectComposition {
  settings: {
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
    sampleRate?: number;
  };
  tracks: ProjectTrack[];
  transitions: ProjectTransition[];
}

export interface ProjectProvenanceEdge {
  toAssetId: string;
  fromAssetId: string | null;
  operation: Operation;
}

export interface ProjectFile {
  $schema: "pneuma-craft/project/v1";
  title: string;
  composition: ProjectComposition;
  assets: ProjectAsset[];
  provenance: ProjectProvenanceEdge[];
}

// ── Parse + validate ─────────────────────────────────────────────────────

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseProjectFile(raw: string): ParseResult<ProjectFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
  }
  return validateProjectFile(parsed);
}

function validateProjectFile(value: unknown): ParseResult<ProjectFile> {
  if (!isObject(value)) return { ok: false, error: "Root must be an object" };
  if (value.$schema !== "pneuma-craft/project/v1") {
    return { ok: false, error: `Unsupported $schema: ${String(value.$schema)}` };
  }
  if (typeof value.title !== "string") return { ok: false, error: "title must be a string" };
  if (!isObject(value.composition)) return { ok: false, error: "composition is required" };
  if (!Array.isArray(value.assets)) return { ok: false, error: "assets must be an array" };
  if (!Array.isArray(value.provenance)) return { ok: false, error: "provenance must be an array" };

  // Structural checks only — individual shape errors would just crash hydration
  // with a clearer message, which is acceptable for Plan 2's read-only scope.
  return { ok: true, value: value as ProjectFile };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Hydration: ProjectFile → CommandEnvelope[] ───────────────────────────

let envelopeSeq = 0;
function makeEnvelope(
  actor: Actor,
  command: CoreCommand | CompositionCommand,
  timestamp: number,
): CommandEnvelope<CoreCommand | CompositionCommand> {
  envelopeSeq += 1;
  return {
    id: `hydrate-${envelopeSeq}`,
    actor,
    timestamp,
    command,
  };
}

export function projectFileToCommands(
  file: ProjectFile,
): CommandEnvelope<CoreCommand | CompositionCommand>[] {
  const ts = Date.now();
  const cmds: CommandEnvelope<CoreCommand | CompositionCommand>[] = [];

  // 1. Create the composition shell
  cmds.push(makeEnvelope("human", {
    type: "composition:create",
    settings: file.composition.settings,
  }, ts));

  // 2. Register every asset (craft will assign fresh ids; we intentionally
  //    DO NOT preserve the on-disk id in the registry — Plan 3 will introduce
  //    id stability when it needs the write path).
  for (const asset of file.assets) {
    cmds.push(makeEnvelope("human", {
      type: "asset:register",
      asset: {
        type: asset.type,
        uri: asset.uri,
        name: asset.name,
        metadata: asset.metadata as never,
        ...(asset.tags ? { tags: asset.tags } : {}),
        ...(asset.status ? { status: asset.status } : {}),
      },
    }, ts));
  }

  // 3. Provenance edges. `fromAssetId === null` means "generated from nothing"
  //    → emit provenance:set-root. Others emit provenance:link.
  for (const edge of file.provenance) {
    if (edge.fromAssetId === null) {
      cmds.push(makeEnvelope("human", {
        type: "provenance:set-root",
        assetId: edge.toAssetId,
        operation: edge.operation,
      }, ts));
    } else {
      cmds.push(makeEnvelope("human", {
        type: "provenance:link",
        fromAssetId: edge.fromAssetId,
        toAssetId: edge.toAssetId,
        operation: edge.operation,
      }, ts));
    }
  }

  // 4. Tracks and clips
  for (const track of file.composition.tracks) {
    cmds.push(makeEnvelope("human", {
      type: "composition:add-track",
      track: {
        type: track.type,
        name: track.name,
        clips: [],
        muted: track.muted,
        volume: track.volume,
        locked: track.locked,
        visible: track.visible,
      },
    }, ts));

    for (const clip of track.clips) {
      cmds.push(makeEnvelope("human", {
        type: "composition:add-clip",
        trackId: track.id,
        clip: {
          assetId: clip.assetId,
          startTime: clip.startTime,
          duration: clip.duration,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          ...(clip.text !== undefined ? { text: clip.text } : {}),
          ...(clip.volume !== undefined ? { volume: clip.volume } : {}),
          ...(clip.fadeIn !== undefined ? { fadeIn: clip.fadeIn } : {}),
          ...(clip.fadeOut !== undefined ? { fadeOut: clip.fadeOut } : {}),
        },
      }, ts));
    }
  }

  return cmds;
}
```

**Two important notes:**

- **ID stability.** Craft's `asset:register` command assigns a fresh id; the on-disk `asset.id` is ignored during hydration. Same for clips and tracks (via `composition:add-clip`/`composition:add-track`). This means disk id `a1` and in-memory id `<nanoid>` can diverge, which is fine for read-only Plan 2 but will need fixing in Plan 3 when the write path has to round-trip ids stably. A `// TODO(plan-3): id stability` comment is appropriate above the asset loop.
- **Track ids in clip hydration.** `composition:add-clip` takes a `trackId` that must match an already-added track. We use the on-disk `track.id` directly — craft's `composition:add-track` command takes `Omit<Track, 'id'>` and generates a new id, which means the clips we add reference a STALE id. This is broken; Plan 3 needs to fix it. For Plan 2 (read-only), we acknowledge that if the on-disk file has clips, hydration will fail at the clip step because the craft-assigned track id differs from `track.id`.

**Plan 2 workaround:** The seed `project.json` (Task 10) will have ZERO tracks and ZERO clips. Hydration only exercises `composition:create`, `asset:register`, and `provenance:*` paths. The track/clip hydration code exists for schema completeness and its tests use a fabricated file, but it is not exercised end-to-end until Plan 3 adds id stability.

Put a prominent `// TODO(plan-3): id stability for tracks/clips` comment above the `composition:add-track` block and in the `projectFileToCommands` JSDoc.

- [ ] **Step 6.4: Run the tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/persistence.test.ts 2>&1 | tail -30
```

Expected: 9 passing assertions across 2 describe blocks. If a test about tracks/clips fails, that's acceptable per the id-stability note above — but double-check the failure is about ids (not a more serious bug).

If the track/clip test fails because craft rejects the clip's `trackId`, adjust the test to use a fresh track id returned via a prior `composition:add-track` event OR mark the test `.skip` with an inline comment pointing at the Plan 3 TODO. Prefer `.skip` — it keeps the expected shape documented.

- [ ] **Step 6.5: Commit**

```bash
git add modes/clipcraft/persistence.ts modes/clipcraft/__tests__/persistence.test.ts && git commit -m "feat(clipcraft): project.json schema + hydration command builder"
```

---

## Task 7: Wire hydration into the viewer via a React hook

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Create: `modes/clipcraft/viewer/hooks/useProjectHydration.ts`

- [ ] **Step 7.1: Create the hook**

```ts
import { useEffect } from "react";
import type { ViewerFileContent } from "../../../../core/types/viewer-contract.js";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import { parseProjectFile, projectFileToCommands } from "../../persistence.js";

/**
 * Hydrate the craft store from the current project.json file content.
 *
 * Re-runs whenever the content of project.json changes. This wipes the
 * in-memory undo stack (by dispatching a fresh sequence of commands on top
 * of a potentially non-empty core) — acceptable in Plan 2 because there are
 * no user-initiated dispatches yet, so the undo stack is always just prior
 * hydration events.
 *
 * Plan 3 will replace this with a diff-and-dispatch strategy that appends
 * only the changes, preserving undo history across external edits.
 */
export function useProjectHydration(files: ViewerFileContent[]): {
  error: string | null;
} {
  const dispatch = usePneumaCraftStore((s) => s.dispatch);

  // Find project.json by suffix match so subdirectory layouts still work.
  const projectFile = files.find(
    (f) => f.path === "project.json" || f.path.endsWith("/project.json"),
  );
  const projectContent = projectFile?.content ?? null;

  // useEffect dep: the raw JSON string. If the agent edits a field, the
  // content string changes and the effect re-runs.
  useEffect(() => {
    if (projectContent === null) return;

    const parsed = parseProjectFile(projectContent);
    if (!parsed.ok) {
      // Error surfaced via return value, not thrown — viewer renders a
      // readable error state instead of crashing the React tree.
      return;
    }

    const envelopes = projectFileToCommands(parsed.value);
    for (const env of envelopes) {
      try {
        dispatch(env.actor, env.command);
      } catch (e) {
        // Commands may reject (e.g. missing parent in provenance:link).
        // Plan 2: log and continue — downstream state will be partial but
        // the viewer still shows "what worked" as a text dump.
        // eslint-disable-next-line no-console
        console.warn("[clipcraft] hydration command rejected", env.command.type, (e as Error).message);
      }
    }
  }, [projectContent, dispatch]);

  if (projectContent === null) {
    return { error: "project.json not found in workspace" };
  }
  const parsed = parseProjectFile(projectContent);
  return { error: parsed.ok ? null : parsed.error };
}
```

Two notes on the hook:

- It returns `{ error }` for the viewer to render. The parse is deliberately run twice (once in the effect, once for the return value) rather than lifting the result into state — this keeps the hook pure-ish and avoids a second `useState` that would need its own effect. Parsing a small JSON string twice per render is fine; if it ever becomes a perf issue, promote to `useMemo`.
- Plan 3 must revisit `useEffect`'s dep array. Right now `[projectContent, dispatch]` re-dispatches on every content change, growing the event log indefinitely. Plan 3 needs a diff-based approach.

- [ ] **Step 7.2: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: no new errors.

- [ ] **Step 7.3: Commit**

```bash
git add modes/clipcraft/viewer/hooks/ && git commit -m "feat(clipcraft): hydration hook from project.json"
```

---

## Task 8: Build the StateDump text renderer

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Create: `modes/clipcraft/viewer/StateDump.tsx`

- [ ] **Step 8.1: Create the component**

```tsx
import { useAssets, useComposition, useEventLog } from "@pneuma-craft/react";

interface StateDumpProps {
  hydrationError: string | null;
}

/**
 * Plan 2 debug renderer. Shows the live craft state so we can confirm
 * hydration is wired correctly. Replaced by real UI in Plans 4+.
 */
export function StateDump({ hydrationError }: StateDumpProps) {
  const assets = useAssets();
  const composition = useComposition();
  const events = useEventLog();

  if (hydrationError) {
    return (
      <section style={panelStyle}>
        <h2 style={headingStyle}>ClipCraft · Hydration Error</h2>
        <pre style={errorStyle}>{hydrationError}</pre>
      </section>
    );
  }

  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>ClipCraft · State Dump (Plan 2)</h2>

      <h3 style={subheadingStyle}>Composition</h3>
      {composition === null ? (
        <p style={mutedStyle}>No composition yet — hydration hasn't run.</p>
      ) : (
        <pre style={dumpStyle}>
{`settings: ${composition.settings.width}×${composition.settings.height} @ ${composition.settings.fps}fps (${composition.settings.aspectRatio})
tracks: ${composition.tracks.length}
transitions: ${composition.transitions.length}
duration: ${composition.duration.toFixed(2)}s`}
        </pre>
      )}

      <h3 style={subheadingStyle}>Assets ({assets.length})</h3>
      {assets.length === 0 ? (
        <p style={mutedStyle}>No assets registered.</p>
      ) : (
        <ul style={listStyle}>
          {assets.map((a) => (
            <li key={a.id} style={itemStyle}>
              <StatusBadge status={a.status ?? "ready"} />
              <span style={monoStyle}>
                {a.type} · {a.name} {a.uri && `(${a.uri})`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 style={subheadingStyle}>Event Log (last 10 of {events.length})</h3>
      <pre style={dumpStyle}>
        {events.slice(-10).map((e) => `${e.type} · ${e.actor}`).join("\n") || "— empty —"}
      </pre>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "ready" ? "#22c55e"
    : status === "generating" ? "#f97316"
    : status === "pending" ? "#eab308"
    : status === "failed" ? "#ef4444"
    : "#a1a1aa";
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 6px",
      marginRight: 8,
      fontSize: 10,
      borderRadius: 3,
      background: color,
      color: "#09090b",
      fontWeight: 600,
      textTransform: "uppercase",
    }}>
      {status}
    </span>
  );
}

const panelStyle: React.CSSProperties = {
  padding: 24,
  background: "#09090b",
  color: "#e4e4e7",
  fontFamily: "system-ui",
  fontSize: 13,
  height: "100%",
  overflow: "auto",
};
const headingStyle: React.CSSProperties = { color: "#f97316", fontSize: 20, marginBottom: 16 };
const subheadingStyle: React.CSSProperties = { color: "#a1a1aa", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 8 };
const dumpStyle: React.CSSProperties = { margin: 0, padding: 12, background: "#18181b", borderRadius: 4, fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap" };
const errorStyle: React.CSSProperties = { ...dumpStyle, background: "#450a0a", color: "#fca5a5" };
const mutedStyle: React.CSSProperties = { color: "#71717a", fontStyle: "italic" };
const listStyle: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0 };
const itemStyle: React.CSSProperties = { padding: "4px 0", display: "flex", alignItems: "center" };
const monoStyle: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
```

- [ ] **Step 8.2: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: no errors. If `useAssets`/`useComposition`/`useEventLog` type signatures don't match (unlikely — they're straight from the surveyed d.ts), open `node_modules/@pneuma-craft/react/dist/index.d.ts` and match the actual types.

- [ ] **Step 8.3: Commit**

```bash
git add modes/clipcraft/viewer/StateDump.tsx && git commit -m "feat(clipcraft): StateDump text renderer for plan 2"
```

---

## Task 9: Wire hydration + StateDump into ClipCraftPreview

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Modify: `modes/clipcraft/viewer/ClipCraftPreview.tsx`

- [ ] **Step 9.1: Rewrite the viewer**

Replace the entire contents of `modes/clipcraft/viewer/ClipCraftPreview.tsx` with:

```tsx
import { useMemo } from "react";
import type { ComponentType } from "react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";
import { useProjectHydration } from "./hooks/useProjectHydration.js";
import { StateDump } from "./StateDump.js";

const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ files }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);

  return (
    <PneumaCraftProvider assetResolver={assetResolver}>
      <HydratedBody files={files} />
    </PneumaCraftProvider>
  );
};

/**
 * Hydration must happen inside the provider so `usePneumaCraftStore` works.
 * Splitting it into a child component keeps the provider's children stable.
 */
function HydratedBody({ files }: { files: ViewerPreviewProps["files"] }) {
  const { error } = useProjectHydration(files);
  return <StateDump hydrationError={error} />;
}

export default ClipCraftPreview;
```

Note the structural change: `useProjectHydration` calls `usePneumaCraftStore` which requires the provider context. The hook cannot run in the same component that mounts the provider — hence the `HydratedBody` split.

- [ ] **Step 9.2: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: no errors.

- [ ] **Step 9.3: Full test suite regression check**

```bash
bun test 2>&1 | tail -15
```

Expected: same pass count as Plan 1's final state, plus the new `persistence.test.ts` assertions. No existing tests regress.

- [ ] **Step 9.4: Commit**

```bash
git add modes/clipcraft/viewer/ClipCraftPreview.tsx && git commit -m "feat(clipcraft): hydrate craft store from project.json in viewer"
```

---

## Task 10: Replace the placeholder seed with a real ProjectFile

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Modify: `modes/clipcraft/seed/project.json`

- [ ] **Step 10.1: Rewrite the seed**

Replace the entire contents of `modes/clipcraft/seed/project.json` with:

```json
{
  "$schema": "pneuma-craft/project/v1",
  "title": "Untitled",
  "composition": {
    "settings": {
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "aspectRatio": "16:9"
    },
    "tracks": [],
    "transitions": []
  },
  "assets": [
    {
      "id": "seed-asset-1",
      "type": "image",
      "uri": "",
      "name": "opening-shot (pending generation)",
      "metadata": {},
      "createdAt": 1712934000000,
      "status": "pending",
      "tags": ["seed-example"]
    }
  ],
  "provenance": [
    {
      "toAssetId": "seed-asset-1",
      "fromAssetId": null,
      "operation": {
        "type": "generate",
        "actor": "agent",
        "agentId": "clipcraft-imagegen",
        "timestamp": 1712934000000,
        "label": "placeholder seed asset — replace with real prompt",
        "params": {
          "model": "flux-pro-1.1",
          "prompt": "wide shot of a foggy forest at dawn",
          "seed": 42
        }
      }
    }
  ]
}
```

The seed is deliberately a pending AIGC asset with no tracks/clips, so hydration exercises `composition:create` + `asset:register` + `provenance:set-root` without hitting the track/clip id-stability TODO.

- [ ] **Step 10.2: Commit**

```bash
git add modes/clipcraft/seed/project.json && git commit -m "feat(clipcraft): seed project.json with pending AIGC asset example"
```

---

## Task 11: End-to-end launch verification

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:** none modified — verification only.

- [ ] **Step 11.1: Launch clipcraft in a fresh workspace**

In a terminal (or background):

```bash
bun run dev clipcraft --workspace /tmp/clipcraft-plan2-smoke --no-open --no-prompt --port 18100
```

Expected: server starts on 18100, Vite on 17996, `project.json` seeded, skill installed, no module errors in the log.

- [ ] **Step 11.2: Screenshot via chrome-devtools-mcp**

Use `new_page` with the Vite URL (e.g. `http://localhost:17996?session=...&mode=clipcraft&...`, the exact URL is in the server log with `[pneuma] ready`). Then `take_screenshot`.

Expected visible content in the main panel:
- "ClipCraft · State Dump (Plan 2)" heading in orange
- **Composition** section: `1920×1080 @ 30fps (16:9)`, `tracks: 0`, `transitions: 0`, `duration: 0.00s`
- **Assets (1)**: one entry showing a yellow "PENDING" badge next to `image · opening-shot (pending generation)`
- **Event Log (last 10 of N)**: a list of the dispatched hydration events — at minimum `composition:created`, `asset:registered`, `provenance:root-set`

If the "PENDING" badge is yellow and the asset entry is visible, both the new craft `Asset.status` field AND the hydration hook are working end-to-end.

- [ ] **Step 11.3: Capture console messages**

`list_console_messages` — record all errors and warnings. Expected:
- HMR / Vite handshake: fine
- React DevTools info: fine
- Any `[clipcraft] hydration command rejected` warnings: **should not appear** for the Task 10 seed. If they do, inspect and fix the persistence loader.

- [ ] **Step 11.4: Agent-edit simulation**

With the dev server still running, open a second terminal and edit the workspace's `project.json`:

```bash
cat > /tmp/clipcraft-plan2-smoke/project.json <<'EOF'
{
  "$schema": "pneuma-craft/project/v1",
  "title": "Forest Opening",
  "composition": {
    "settings": { "width": 1920, "height": 1080, "fps": 30, "aspectRatio": "16:9" },
    "tracks": [],
    "transitions": []
  },
  "assets": [
    {
      "id": "seed-asset-1",
      "type": "image",
      "uri": "assets/images/forest-dawn.jpg",
      "name": "opening-shot",
      "metadata": { "width": 1920, "height": 1080 },
      "createdAt": 1712934000000,
      "status": "ready",
      "tags": ["seed-example"]
    }
  ],
  "provenance": [
    {
      "toAssetId": "seed-asset-1",
      "fromAssetId": null,
      "operation": {
        "type": "generate",
        "actor": "agent",
        "agentId": "clipcraft-imagegen",
        "timestamp": 1712934000000,
        "label": "flux-pro-1.1 (generated)",
        "params": { "model": "flux-pro-1.1", "prompt": "wide shot of a foggy forest at dawn", "seed": 42 }
      }
    }
  ]
}
EOF
```

Re-screenshot the browser tab (the chokidar watcher should push the change via WS, triggering a viewer re-render and a fresh `useProjectHydration` run).

Expected: the asset badge flips from yellow "PENDING" to green "READY", the uri shows `assets/images/forest-dawn.jpg`, and the event log grows by another `composition:created` + `asset:registered` + `provenance:root-set` batch (because the hook re-dispatches the entire thing — TODO for Plan 3).

If the badge doesn't flip, the file watcher → viewer → hook chain is broken. Debug before moving on.

- [ ] **Step 11.5: Kill the dev server**

Stop the background job.

- [ ] **Step 11.6: No commit needed unless fixups**

If verification found issues and required code edits, commit them as `fix(clipcraft): plan 2 smoke-test fixups`.

---

## Task 12: Extend the craft-imports contract test with set-status roundtrip

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Modify: `modes/clipcraft/__tests__/craft-imports.test.ts`

- [ ] **Step 12.1: Add the roundtrip assertion**

Inside the existing `describe("craft package imports", ...)` block, append a new test after the `createPneumaCraftStore` case:

```ts
it("asset:set-status roundtrips through dispatch + event + projection", () => {
  const core = createCore();
  // Register an asset with an explicit generating status
  core.dispatch("human", {
    type: "asset:register",
    asset: {
      type: "image",
      uri: "",
      name: "pending",
      metadata: {},
      status: "generating",
    },
  });
  const [registered] = core.getEvents();
  const assetId = (registered.payload.asset as { id: string }).id;

  // Now flip it to ready
  core.dispatch("human", {
    type: "asset:set-status",
    assetId,
    status: "ready",
  });

  const state = core.getState();
  const asset = state.registry.get(assetId);
  expect(asset?.status).toBe("ready");

  // Undo should put it back to generating
  core.undo();
  const afterUndo = core.getState().registry.get(assetId);
  expect(afterUndo?.status).toBe("generating");
});
```

- [ ] **Step 12.2: Run the test**

```bash
bun test modes/clipcraft/__tests__/craft-imports.test.ts 2>&1 | tail -20
```

Expected: all 5 tests pass (the 4 original plus the new roundtrip).

- [ ] **Step 12.3: Run the full suite**

```bash
bun test 2>&1 | tail -15
```

Expected: full suite passes, with an additional test pass from this task plus the 9 from Task 6.

- [ ] **Step 12.4: Commit**

```bash
git add modes/clipcraft/__tests__/craft-imports.test.ts && git commit -m "test(clipcraft): contract test for Asset.status roundtrip"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `Asset.status` field added to craft core → Task 1
- [x] `asset:set-status` command + event + handler + projection + inversion → Tasks 2, 3, 4
- [x] Consumer side verifies new API → Task 5 + Task 12
- [x] `project.json` schema defined in mode → Task 6
- [x] Hydration-via-events loader → Task 6 (`projectFileToCommands`)
- [x] Viewer hook that reruns on file change → Task 7
- [x] Text-mode state dump with status badges → Task 8
- [x] Wired into `ClipCraftPreview` → Task 9
- [x] Seed replaced with real pending-AIGC example → Task 10
- [x] E2E smoke test with agent-edit simulation → Task 11
- [x] Contract test extended → Task 12

**Placeholder scan:** every code step has a concrete code block. Two places reference "TODO(plan-3)" comments in source — those are intentional markers for future plans, not placeholders for the current plan.

**Type consistency:** `AssetStatus` is used consistently across all tasks. `projectFileToCommands` returns `CommandEnvelope<CoreCommand | CompositionCommand>[]`. `useProjectHydration` takes `ViewerFileContent[]`. The cross-reference between the craft repo and the pneuma-skills worktree is only through `node_modules/@pneuma-craft/*` (Bun symlinks), so rebuilding craft `dist/` is the only hand-off — verified in Task 5.

**Known risk — ID stability for tracks/clips:**
The track/clip hydration emits `composition:add-track` / `composition:add-clip` commands that create fresh ids via `generateId()` inside craft. The on-disk `track.id` and `clip.id` are ignored during hydration. For Plan 2 this is acceptable because the seed `project.json` has zero tracks and zero clips, so the broken path is never exercised end-to-end. Plan 3 must fix this when it introduces the write path — either by extending craft commands to accept explicit ids or by maintaining a disk-to-memory id map in the mode's persistence layer. A `// TODO(plan-3): id stability` comment in `persistence.ts` flags this clearly.

**Known risk — hydration re-dispatches on every content change:**
`useProjectHydration` runs the entire command sequence every time `project.json`'s content string changes, growing the event log unboundedly. Plan 2 smoke test acknowledges this in Step 11.4. Plan 3 must replace the effect body with a diff-and-dispatch strategy.

**Cross-repo hygiene:** Tasks 1-5 commit in the craft repo; tasks 6-12 commit in the pneuma-skills worktree. Neither repo is pushed anywhere as part of this plan. Both repos' commit histories end with feat/test commits that pass their respective test suites.
