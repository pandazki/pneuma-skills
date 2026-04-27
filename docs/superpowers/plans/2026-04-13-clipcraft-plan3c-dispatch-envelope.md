# ClipCraft Plan 3c: dispatchEnvelope API + createdAt Round-Trip

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a new `dispatchEnvelope(envelope)` method on `CraftCore`, `TimelineCore`, and the Zustand `PneumaCraftStore` so callers can supply a pre-built `CommandEnvelope` with their own `id` and `timestamp`. Use this from ClipCraft's persistence loader to preserve `asset.createdAt` across the on-disk → in-memory → on-disk round trip, eliminating the "one POST /api/files per fresh mount" footprint documented in Plan 3b.

**Architecture:** The fix is a tightly scoped refactor at each craft layer. Current `dispatch(actor, command)` builds an envelope internally with `id = generateId(); timestamp = Date.now()` and calls the handler. The new `dispatchEnvelope(envelope)` method becomes the primitive; `dispatch` is re-implemented as a thin wrapper that builds the envelope and forwards. No behavior change for any existing caller — they keep using `dispatch` and see identical semantics. Callers that need to preserve timestamps (clipcraft's persistence loader) use the new `dispatchEnvelope` path.

On the ClipCraft side: `projectFileToCommands` already returns `CommandEnvelope[]` with per-command timestamps, but the current `useProjectSync` hook throws the envelope away and calls `dispatch(env.actor, env.command)`, which rebuilds a fresh envelope with `Date.now()`. Plan 3c's one-line change is to have the hook call `dispatchEnvelope(env)` instead. The `projectFileToCommands` function is updated so asset-related commands use the on-disk `asset.createdAt` as the envelope timestamp (which craft then uses verbatim for the new asset's `createdAt` field).

**Tech Stack:**
- Cross-repo: craft repo (`feat/clipcraft-aigc-status`) + pneuma-skills worktree
- Plan 3a is a prerequisite (landed); Plan 3b is a prerequisite (landed)

**Out of scope (defer to future plans when actually needed):**
- Diff-and-dispatch replacement for the Plan 3b remount strategy (becomes its own plan when Plan 4's playback makes state loss painful)
- Preserving undo history across external edits
- Preserving PlaybackEngine state across external edits
- New craft commands for structural updates (composition settings, track volume without toggling mute)
- Removing the Plan 3b `lastAppliedRef` / `providerKey` band-aids (they still serve a purpose — StrictMode protection + external edit detection — until diff-and-dispatch lands)

---

## The problem being solved

**Problem (from Plan 3b's Task 6 findings):**

Every time the ClipCraft viewer mounts fresh, it writes `project.json` exactly once with a re-stamped `asset.createdAt`. The loop-protection invariant is intact (the echo of that write matches `lastAppliedRef.current` and is skipped), so there's no infinite cycle — just one no-op-semantics write on startup.

Root cause (from craft-core `packages/core/src/core.ts` line 42-54):

```ts
dispatch(actor: Actor, command: CoreCommand): Event[] {
  const envelope: CommandEnvelope = {
    id: generateId(),
    actor,
    timestamp: Date.now(),  // ← caller cannot override
    command,
  };
  // ...
}
```

And (from craft-core `packages/core/src/command-handler.ts`):

```ts
case 'asset:register': {
  const id = command.asset.id ?? generateId();
  // ...
  const asset: Asset = {
    ...command.asset,
    id,
    createdAt: envelope.timestamp,  // ← derived from the envelope the dispatcher built
  };
  // ...
}
```

The caller has no way to tell craft "use this specific timestamp when you construct the event". So `asset.createdAt` ends up being the time of hydration, not the time of creation-on-disk.

**Fix:** add `dispatchEnvelope(envelope)` that accepts a fully-formed envelope. Caller owns the id and timestamp. Existing `dispatch(actor, command)` becomes a one-liner wrapper that builds the envelope with fresh `generateId()` and `Date.now()` — backward compatible.

---

## File Structure

### In `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core/`

**Modified:**
- `src/core.ts` — add `dispatchEnvelope` method to `CraftCore` interface + implementation. Refactor `dispatch` to be a thin wrapper.
- `__tests__/core.test.ts` — add tests: explicit-timestamp round-trip, explicit-id round-trip, dispatchEnvelope participates in undo stack correctly.

### In `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/timeline/`

**Modified:**
- `src/timeline-core.ts` — add `dispatchEnvelope` method. Refactor `dispatch` to be a thin wrapper. Preserve the existing `isCompositionCommand` branching (composition vs core commands go to different handlers).
- `__tests__/timeline-core.test.ts` — add tests: explicit-timestamp for core command, explicit-timestamp for composition command, undo participation.

### In `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/react/`

**Modified:**
- `src/store.ts` — add `dispatchEnvelope` to the `PneumaCraftStore` interface. Implement by calling `timelineCore.dispatchEnvelope(envelope)` and syncing domain state.
- Existing tests — if any test covers `dispatch` on the store, mirror it for `dispatchEnvelope`.

### In `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/`

**Modified:**
- `modes/clipcraft/persistence.ts` — update `projectFileToCommands` so asset-related envelopes (`asset:register`) use `asset.createdAt` as the envelope timestamp. Other commands (composition:create, add-track, add-clip, provenance:*) keep using `Date.now()` or the operation's on-disk timestamp where applicable.
- `modes/clipcraft/viewer/hooks/useProjectSync.ts` — change the hydration dispatch loop from `dispatch(env.actor, env.command)` to `dispatchEnvelope(env)`. One-line change.
- `modes/clipcraft/__tests__/persistence.test.ts` — update existing tests if they depend on `Date.now()`-based timestamps. Add a new test: asset envelope timestamp equals the on-disk `createdAt`.
- `modes/clipcraft/__tests__/hydration-integration.test.ts` — update the round-trip test to also assert `createdAt` byte-equality after the second round trip.
- `modes/clipcraft/__tests__/craft-imports.test.ts` — add one test exercising `dispatchEnvelope` at the consumer boundary.

---

## Task Ordering

Tasks 1–4 in the craft repo (branch `feat/clipcraft-aigc-status`).
Tasks 5–7 in the pneuma-skills worktree (branch `feat/clipcraft-by-pneuma-craft`).

Craft dev watch (`cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run dev`) should be running throughout Tasks 1–4 so `dist/` rebuilds on every save.

---

## Task 1: craft-core — `CraftCore.dispatchEnvelope`

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core`

**Files:**
- Modify: `src/core.ts`
- Modify: `__tests__/core.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Open `packages/core/__tests__/core.test.ts`. Find where existing dispatch tests live (look for `describe('CraftCore', ...)` or similar). Append a new describe block:

```ts
describe('dispatchEnvelope', () => {
  it('uses the envelope timestamp for asset.createdAt', () => {
    const core = createCore();
    const envelope: CommandEnvelope = {
      id: 'my-cmd-1',
      actor: 'human',
      timestamp: 1712934000000,
      command: {
        type: 'asset:register',
        asset: {
          id: 'a1',
          type: 'image',
          uri: '/x.png',
          name: 'x',
          metadata: {},
        },
      },
    };
    const events = core.dispatchEnvelope(envelope);
    expect(events).toHaveLength(1);
    expect(events[0].commandId).toBe('my-cmd-1');
    const asset = events[0].payload.asset as Asset;
    expect(asset.createdAt).toBe(1712934000000);
    expect(asset.id).toBe('a1');
  });

  it('records into the undo stack the same as dispatch', () => {
    const core = createCore();
    core.dispatchEnvelope({
      id: 'cmd-a',
      actor: 'human',
      timestamp: 1000,
      command: {
        type: 'asset:register',
        asset: { id: 'a1', type: 'image', uri: '/x.png', name: 'x', metadata: {} },
      },
    });
    expect(core.canUndo()).toBe(true);
    const compensating = core.undo();
    expect(compensating).not.toBeNull();
    expect(compensating![0].type).toBe('asset:removed');
    expect(core.getState().registry.has('a1')).toBe(false);
  });

  it('emits events whose ids are fresh but whose commandId matches the envelope', () => {
    const core = createCore();
    const events = core.dispatchEnvelope({
      id: 'my-specific-cmd-id',
      actor: 'agent',
      timestamp: 2000,
      command: {
        type: 'asset:register',
        asset: { type: 'video', uri: '/v.mp4', name: 'v', metadata: {} },
      },
    });
    expect(events[0].commandId).toBe('my-specific-cmd-id');
    expect(events[0].id).not.toBe('my-specific-cmd-id');
    expect(events[0].id.length).toBeGreaterThan(0);
    expect(events[0].actor).toBe('agent');
    expect(events[0].timestamp).toBe(2000);
  });
});
```

The `CommandEnvelope` and `Asset` types should already be imported at the top of the test file from existing tests. If not, add them.

- [ ] **Step 1.2: Run tests to confirm failure**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- core 2>&1 | tail -30
```

Expected: 3 new tests fail with `core.dispatchEnvelope is not a function`.

- [ ] **Step 1.3: Implement `dispatchEnvelope`**

Open `packages/core/src/core.ts`. Find the `CraftCore` interface (around line 14). Add `dispatchEnvelope` between `dispatch` and `subscribe`:

```ts
export interface CraftCore {
  getState(): PneumaCraftCoreState;
  dispatch(actor: Actor, command: CoreCommand): Event[];
  dispatchEnvelope(envelope: CommandEnvelope<CoreCommand>): Event[];
  subscribe(listener: (event: Event) => void): () => void;
  undo(): Event[] | null;
  redo(): Event[] | null;
  canUndo(): boolean;
  canRedo(): boolean;
  getEvents(): Event[];
}
```

Then in `createCore`, refactor `dispatch` to share code with `dispatchEnvelope`. Replace the current `dispatch` implementation (lines ~42-54) with:

```ts
    dispatch(actor: Actor, command: CoreCommand): Event[] {
      const envelope: CommandEnvelope = {
        id: generateId(),
        actor,
        timestamp: Date.now(),
        command,
      };
      return dispatchEnvelope(envelope);
    },

    dispatchEnvelope(envelope: CommandEnvelope<CoreCommand>): Event[] {
      return dispatchEnvelope(envelope);
    },
```

Actually that's wrong — we can't call `dispatchEnvelope` from `dispatch` inside an object literal because the method references `this`-less closures that don't see each other. Use a local function hoisted outside the returned object:

Insert this helper above the `return { ... }` block:

```ts
  function dispatchEnvelopeImpl(envelope: CommandEnvelope<CoreCommand>): Event[] {
    const events = handleCommand(state, envelope);
    undoManager.record(envelope.id, events);
    appendEvents(events);
    return events;
  }
```

Then change the returned object:

```ts
  return {
    getState(): PneumaCraftCoreState {
      return state;
    },

    dispatch(actor: Actor, command: CoreCommand): Event[] {
      return dispatchEnvelopeImpl({
        id: generateId(),
        actor,
        timestamp: Date.now(),
        command,
      });
    },

    dispatchEnvelope(envelope: CommandEnvelope<CoreCommand>): Event[] {
      return dispatchEnvelopeImpl(envelope);
    },

    // ... rest unchanged (subscribe, undo, redo, canUndo, canRedo, getEvents)
  };
```

The existing `appendEvents` helper stays. No change to state projection or undo-manager integration.

- [ ] **Step 1.4: Run tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core 2>&1 | tail -20
```

Expected: all core tests pass. The 3 new `dispatchEnvelope` tests pass; the existing `dispatch` tests still pass (unchanged behavior).

- [ ] **Step 1.5: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/core/src/core.ts packages/core/__tests__/core.test.ts && git commit -m "feat(core): expose dispatchEnvelope for caller-owned timestamps"
```

---

## Task 2: craft-timeline — `TimelineCore.dispatchEnvelope`

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/timeline`

**Files:**
- Modify: `src/timeline-core.ts`
- Modify: `__tests__/timeline-core.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Open `packages/timeline/__tests__/timeline-core.test.ts`. Append a new describe block:

```ts
describe('dispatchEnvelope', () => {
  it('routes a core command to handleCommand with the envelope timestamp', () => {
    const tl = createTimelineCore();
    tl.dispatchEnvelope({
      id: 'cmd-1',
      actor: 'human',
      timestamp: 1712934000000,
      command: {
        type: 'asset:register',
        asset: { id: 'a1', type: 'image', uri: '/x.png', name: 'x', metadata: {} },
      },
    });
    const asset = tl.getCoreState().registry.get('a1');
    expect(asset?.createdAt).toBe(1712934000000);
  });

  it('routes a composition command to handleCompositionCommand', () => {
    const tl = createTimelineCore();
    // Need a composition first
    tl.dispatchEnvelope({
      id: 'create-cmd',
      actor: 'human',
      timestamp: 1000,
      command: {
        type: 'composition:create',
        settings: { width: 1920, height: 1080, fps: 30, aspectRatio: '16:9' },
      },
    });
    // Now add a track with explicit id
    const events = tl.dispatchEnvelope({
      id: 'add-track-cmd',
      actor: 'human',
      timestamp: 2000,
      command: {
        type: 'composition:add-track',
        track: {
          id: 'my-track',
          type: 'video',
          name: 'V1',
          clips: [],
          muted: false, volume: 1, locked: false, visible: true,
        },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('composition:track-added');
    expect(events[0].commandId).toBe('add-track-cmd');
    expect(tl.getComposition()?.tracks[0].id).toBe('my-track');
  });

  it('participates in the undo stack correctly', () => {
    const tl = createTimelineCore();
    tl.dispatchEnvelope({
      id: 'cmd-1',
      actor: 'human',
      timestamp: 1000,
      command: {
        type: 'asset:register',
        asset: { type: 'image', uri: '/x.png', name: 'x', metadata: {} },
      },
    });
    expect(tl.canUndo()).toBe(true);
    tl.undo();
    expect(tl.getCoreState().registry.size).toBe(0);
  });
});
```

- [ ] **Step 2.2: Run tests to confirm failure**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/timeline -- timeline-core 2>&1 | tail -30
```

Expected: 3 failures on `tl.dispatchEnvelope is not a function`.

- [ ] **Step 2.3: Implement `dispatchEnvelope`**

Open `packages/timeline/src/timeline-core.ts`. Find the `TimelineCore` interface (around line 24). Add `dispatchEnvelope` between `dispatch` and `subscribe`:

```ts
export interface TimelineCore {
  getCoreState(): PneumaCraftCoreState;
  getComposition(): Composition | null;
  dispatch(actor: Actor, command: CoreCommand | CompositionCommand): Event[];
  dispatchEnvelope(envelope: CommandEnvelope<CoreCommand | CompositionCommand>): Event[];
  subscribe(listener: (event: Event) => void): () => void;
  undo(): Event[] | null;
  redo(): Event[] | null;
  canUndo(): boolean;
  canRedo(): boolean;
  getEvents(): Event[];
}
```

Then refactor the implementation. Insert a local helper above the `return { ... }` block:

```ts
  function dispatchEnvelopeImpl(
    envelope: CommandEnvelope<CoreCommand | CompositionCommand>,
  ): Event[] {
    let events: Event[];
    if (isCompositionCommand(envelope.command)) {
      events = handleCompositionCommand(
        coreState,
        compState,
        envelope as unknown as CommandEnvelope<CompositionCommand>,
      );
    } else {
      events = handleCommand(
        coreState,
        envelope as unknown as CommandEnvelope<CoreCommand>,
      );
    }
    undoManager.record(envelope.id, events);
    appendEvents(events);
    return events;
  }
```

Then update the returned object. Replace the existing `dispatch` method (lines ~69-90) with:

```ts
    dispatch(actor: Actor, command: CoreCommand | CompositionCommand): Event[] {
      return dispatchEnvelopeImpl({
        id: generateId(),
        actor,
        timestamp: Date.now(),
        command: command as CoreCommand,
      });
    },

    dispatchEnvelope(
      envelope: CommandEnvelope<CoreCommand | CompositionCommand>,
    ): Event[] {
      return dispatchEnvelopeImpl(envelope);
    },
```

The rest of the returned object (subscribe, undo, redo, etc.) stays unchanged.

- [ ] **Step 2.4: Run tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/timeline 2>&1 | tail -20
```

Expected: all timeline tests pass. The 3 new tests pass; regression check confirms the rest stay green.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/timeline/src/timeline-core.ts packages/timeline/__tests__/timeline-core.test.ts && git commit -m "feat(timeline): expose dispatchEnvelope on TimelineCore"
```

---

## Task 3: craft-react — Zustand store `dispatchEnvelope`

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/react`

**Files:**
- Modify: `src/store.ts`
- Modify: `__tests__/store.test.ts` (if it exists — check first)

- [ ] **Step 3.1: Check whether an existing store test file exists**

```bash
ls /Users/pandazki/Codes/pneuma-craft-headless-stable/packages/react/__tests__/
```

If there's a `store.test.ts` or similar, open it and use its patterns. If not, a brand-new test file is acceptable for Task 3 but skip writing one if the existing suite already has store-level coverage — the contract test on the pneuma-skills side (Task 7) will catch regressions at the consumer boundary.

- [ ] **Step 3.2: Add `dispatchEnvelope` to the store interface**

Open `packages/react/src/store.ts`. Find the `PneumaCraftStore` interface (around line 22). In the Actions section, add `dispatchEnvelope` right after `dispatch`:

```ts
  // Actions
  dispatch: (actor: Actor, command: CoreCommand | CompositionCommand) => Event[];
  dispatchEnvelope: (envelope: CommandEnvelope<CoreCommand | CompositionCommand>) => Event[];
  undo: () => Event[] | null;
  // ... rest unchanged
```

Also add `CommandEnvelope` to the import from `@pneuma-craft/core` at the top:

```ts
import type {
  Actor,
  CoreCommand,
  CommandEnvelope,
  Event,
  PneumaCraftCoreState,
} from '@pneuma-craft/core';
```

- [ ] **Step 3.3: Implement `dispatchEnvelope` in the store**

Find the existing `dispatch` implementation (around line 206):

```ts
    dispatch(actor: Actor, command: CoreCommand | CompositionCommand): Event[] {
      const events = timelineCore.dispatch(actor, command);
      set(syncDomainState());
      return events;
    },
```

Add the new method immediately after it:

```ts
    dispatch(actor: Actor, command: CoreCommand | CompositionCommand): Event[] {
      const events = timelineCore.dispatch(actor, command);
      set(syncDomainState());
      return events;
    },

    dispatchEnvelope(
      envelope: CommandEnvelope<CoreCommand | CompositionCommand>,
    ): Event[] {
      const events = timelineCore.dispatchEnvelope(envelope);
      set(syncDomainState());
      return events;
    },
```

- [ ] **Step 3.4: Typecheck + test the whole craft repo**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run typecheck 2>&1 | tail -20
```

Expected: no errors.

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test 2>&1 | tail -20
```

Expected: all craft tests pass across all 5 packages (core, timeline, video, react, react-ui).

- [ ] **Step 3.5: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/react/src/store.ts && git commit -m "feat(react): expose dispatchEnvelope on Zustand store"
```

---

## Task 4: Rebuild craft + consumer verification

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable`

**Files:** none modified.

- [ ] **Step 4.1: Rebuild**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run build 2>&1 | tail -6
```

Expected: all 5 packages build. The Turborepo watch should already have rebuilt them, so this is mostly a cache hit.

- [ ] **Step 4.2: Verify the new method surfaces in the consumer d.ts files**

```bash
grep -c "dispatchEnvelope" /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/node_modules/@pneuma-craft/core/dist/index.d.ts
grep -c "dispatchEnvelope" /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/node_modules/@pneuma-craft/timeline/dist/index.d.ts
grep -c "dispatchEnvelope" /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/node_modules/@pneuma-craft/react/dist/index.d.ts
```

Expected: each returns ≥ 1.

- [ ] **Step 4.3: Consumer smoke test**

From the pneuma-skills worktree, run a one-off script that exercises the new API at each layer:

```bash
cat > /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/.p3c-smoke.ts <<'EOF'
import { createCore } from "@pneuma-craft/core";
import { createTimelineCore } from "@pneuma-craft/timeline";

// 1. core dispatchEnvelope preserves timestamp
const core = createCore();
core.dispatchEnvelope({
  id: "test-cmd",
  actor: "human",
  timestamp: 1712934000000,
  command: {
    type: "asset:register",
    asset: { id: "a1", type: "image", uri: "", name: "x", metadata: {} },
  },
});
const a1 = core.getState().registry.get("a1");
console.log("1. core createdAt preserved:", a1?.createdAt === 1712934000000);

// 2. timeline dispatchEnvelope preserves timestamp
const tl = createTimelineCore();
tl.dispatchEnvelope({
  id: "test-cmd",
  actor: "human",
  timestamp: 1712934000001,
  command: {
    type: "asset:register",
    asset: { id: "a2", type: "video", uri: "", name: "y", metadata: {} },
  },
});
const a2 = tl.getCoreState().registry.get("a2");
console.log("2. timeline createdAt preserved:", a2?.createdAt === 1712934000001);

// 3. Existing dispatch still works (backward compat)
core.dispatch("human", {
  type: "asset:register",
  asset: { id: "a3", type: "audio", uri: "", name: "z", metadata: {} },
});
const a3 = core.getState().registry.get("a3");
console.log("3. dispatch fallback works:", a3 !== undefined && a3.createdAt > 0);
EOF
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun .p3c-smoke.ts && rm .p3c-smoke.ts
```

Expected output:
```
1. core createdAt preserved: true
2. timeline createdAt preserved: true
3. dispatch fallback works: true
```

- [ ] **Step 4.4: Verify the existing Plan 2/3a/3b test suite still passes**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test 2>&1 | tail -15
```

Expected: full suite passes (same count as before Plan 3c started). Any regression means the backward-compat of `dispatch` → `dispatchEnvelope` wrapping is subtly wrong — investigate and fix before proceeding.

No commit for Task 4 itself.

---

## Task 5: clipcraft persistence + useProjectSync use `dispatchEnvelope`

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Modify: `modes/clipcraft/persistence.ts`
- Modify: `modes/clipcraft/viewer/hooks/useProjectSync.ts`
- Modify: `modes/clipcraft/__tests__/persistence.test.ts`

- [ ] **Step 5.1: Update `projectFileToCommands` to use asset-derived timestamps**

Open `modes/clipcraft/persistence.ts`. Find the `projectFileToCommands` function. Currently it creates all envelopes with `ts = Date.now()` at the top of the function.

The target behavior:
- For `asset:register` envelopes: timestamp = `asset.createdAt` (from the on-disk file)
- For `provenance:set-root` / `provenance:link` envelopes: timestamp = `edge.operation.timestamp`
- For `composition:create` / `composition:add-track` / `composition:add-clip`: timestamp = `Date.now()` (these don't have a meaningful on-disk time)

Find the asset loop and change `ts` to `asset.createdAt`:

```ts
  // 2. Register every asset. ID is preserved (Plan 3a). Timestamp derived
  //    from the on-disk createdAt so round-tripping through dispatchEnvelope
  //    preserves it (Plan 3c).
  for (const asset of file.assets) {
    cmds.push(makeEnvelope("human", {
      type: "asset:register",
      asset: {
        id: asset.id,
        type: asset.type,
        uri: asset.uri,
        name: asset.name,
        metadata: asset.metadata as never,
        ...(asset.tags ? { tags: asset.tags } : {}),
        ...(asset.status ? { status: asset.status } : {}),
      },
    }, asset.createdAt));  // ← was `ts`, now `asset.createdAt`
  }
```

Find the provenance loop and change `ts` to `edge.operation.timestamp`:

```ts
  // 3. Provenance edges. Timestamp derived from operation.timestamp so
  //    round-tripping preserves it.
  for (const edge of file.provenance) {
    if (edge.fromAssetId === null) {
      cmds.push(makeEnvelope("human", {
        type: "provenance:set-root",
        assetId: edge.toAssetId,
        operation: edge.operation,
      }, edge.operation.timestamp));
    } else {
      cmds.push(makeEnvelope("human", {
        type: "provenance:link",
        fromAssetId: edge.fromAssetId,
        toAssetId: edge.toAssetId,
        operation: edge.operation,
      }, edge.operation.timestamp));
    }
  }
```

Leave composition:create, add-track, add-clip using `ts` (the `Date.now()` captured at function start).

- [ ] **Step 5.2: Update `useProjectSync` to call `dispatchEnvelope`**

Open `modes/clipcraft/viewer/hooks/useProjectSync.ts`. Find the hydration effect's dispatch loop:

```ts
    for (const env of projectFileToCommands(parsed.value)) {
      try {
        dispatch(env.actor, env.command);
      } catch (e) {
        // ...
      }
    }
```

Change the `dispatch` call to `dispatchEnvelope` and update the hook to select it from the store:

```ts
  const dispatchEnvelope = usePneumaCraftStore((s) => s.dispatchEnvelope);
```

(next to the existing `dispatch` selector — you can keep both or remove the `dispatch` selector if it's no longer used)

Then:

```ts
    for (const env of projectFileToCommands(parsed.value)) {
      try {
        dispatchEnvelope(env);
      } catch (e) {
        // Expected for re-dispatch scenarios.
        // eslint-disable-next-line no-console
        console.warn(
          "[clipcraft] hydration envelope rejected",
          env.command.type,
          (e as Error).message,
        );
      }
    }
```

Remove the old `dispatch` selector if it's no longer referenced elsewhere in the hook. Update the effect dep array from `[diskContent, dispatch, lastAppliedRef]` to `[diskContent, dispatchEnvelope, lastAppliedRef]`.

- [ ] **Step 5.3: Update the existing persistence tests**

Some existing `projectFileToCommands` tests may assert envelope.timestamp values. Run the tests first to see what breaks:

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/persistence.test.ts 2>&1 | tail -30
```

If any test fails, the likely cause is that the envelopes in the test assertions used `Date.now()` implicit assumptions. Update those assertions to either:
- Assert the envelope timestamp equals the on-disk `asset.createdAt` for asset commands
- Not assert on the timestamp at all if it's not the test's subject

Add a new explicit test that locks down the timestamp-preservation contract:

```ts
it("asset:register envelope timestamp equals on-disk createdAt", () => {
  const file: ProjectFile = {
    $schema: "pneuma-craft/project/v1",
    title: "Test",
    composition: {
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
      tracks: [], transitions: [],
    },
    assets: [
      {
        id: "a1",
        type: "image",
        uri: "",
        name: "test",
        metadata: {},
        createdAt: 1712934000000,
      },
    ],
    provenance: [],
  };
  const cmds = projectFileToCommands(file);
  const registerCmd = cmds.find((c) => c.command.type === "asset:register");
  expect(registerCmd).toBeDefined();
  expect(registerCmd!.timestamp).toBe(1712934000000);
});
```

- [ ] **Step 5.4: Run the persistence tests to confirm they pass**

```bash
bun test modes/clipcraft/__tests__/persistence.test.ts 2>&1 | tail -30
```

Expected: all persistence tests pass, plus the new one.

- [ ] **Step 5.5: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: no errors.

- [ ] **Step 5.6: Commit**

```bash
git add modes/clipcraft/persistence.ts modes/clipcraft/viewer/hooks/useProjectSync.ts modes/clipcraft/__tests__/persistence.test.ts && git commit -m "feat(clipcraft): use dispatchEnvelope to preserve asset.createdAt round-trip"
```

---

## Task 6: Update round-trip integration test to assert createdAt

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Modify: `modes/clipcraft/__tests__/hydration-integration.test.ts`

- [ ] **Step 6.1: Strengthen the existing round-trip test**

Open `modes/clipcraft/__tests__/hydration-integration.test.ts`. Find the first round-trip test (the one that hydrates → serializes → hydrates → asserts state equality). In the asset-comparison loop, add a `createdAt` assertion:

```ts
  for (const [id, asset] of s1.registry.entries()) {
    const a2 = s2.registry.get(id);
    expect(a2).toBeDefined();
    expect(a2!.type).toBe(asset.type);
    expect(a2!.uri).toBe(asset.uri);
    expect(a2!.name).toBe(asset.name);
    expect(a2!.status).toBe(asset.status);
    expect(a2!.tags).toEqual(asset.tags);
    expect(a2!.metadata).toEqual(asset.metadata);
    expect(a2!.createdAt).toBe(asset.createdAt);  // ← new assertion
  }
```

This was intentionally omitted in Plan 3b because `createdAt` couldn't round-trip. Plan 3c makes it round-trip, so we lock it down here.

Also, in the "round-trip is stable after a second pass" test, the invariant was already tested (the two serializations must be byte-identical). That test should still pass without changes, because now BOTH serializations carry the same on-disk `createdAt` through dispatchEnvelope, so the second pass's asset also has the same `createdAt` as the first.

- [ ] **Step 6.2: Run the tests**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/hydration-integration.test.ts 2>&1 | tail -20
```

Expected: all tests pass. If the `createdAt` assertion fails, the hydration path isn't actually using `dispatchEnvelope` with the right timestamp — go back to Task 5 and check the persistence.ts or hook changes.

- [ ] **Step 6.3: Full test suite regression**

```bash
bun test 2>&1 | tail -15
```

Expected: full suite passes. Count should be same or +1 from Task 5's new test.

- [ ] **Step 6.4: Commit**

```bash
git add modes/clipcraft/__tests__/hydration-integration.test.ts && git commit -m "test(clipcraft): lock down createdAt round-trip fidelity"
```

---

## Task 7: Extend craft-imports contract test + E2E zero-POST verification

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Modify: `modes/clipcraft/__tests__/craft-imports.test.ts`
- (Verification only — no file changes for the E2E portion unless a fixup is needed)

- [ ] **Step 7.1: Add a dispatchEnvelope contract test**

Open `modes/clipcraft/__tests__/craft-imports.test.ts`. Append a new test inside the existing describe block:

```ts
it("exposes dispatchEnvelope that preserves caller-supplied timestamps", () => {
  const core = createCore();
  const envelope = {
    id: "test-envelope-1",
    actor: "human" as const,
    timestamp: 1712934000000,
    command: {
      type: "asset:register" as const,
      asset: {
        id: "a1",
        type: "image" as const,
        uri: "",
        name: "x",
        metadata: {},
      },
    },
  };
  const events = core.dispatchEnvelope(envelope);
  expect(events[0].commandId).toBe("test-envelope-1");
  expect(events[0].timestamp).toBe(1712934000000);
  const asset = core.getState().registry.get("a1");
  expect(asset?.createdAt).toBe(1712934000000);
});
```

This locks down the contract at the consumer boundary. Future craft releases that change the `dispatchEnvelope` shape will fail this test.

- [ ] **Step 7.2: Run the contract test**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/craft-imports.test.ts 2>&1 | tail -20
```

Expected: all tests pass including the new one.

- [ ] **Step 7.3: Commit the contract test**

```bash
git add modes/clipcraft/__tests__/craft-imports.test.ts && git commit -m "test(clipcraft): contract test for dispatchEnvelope API"
```

- [ ] **Step 7.4: E2E zero-POST verification**

Launch clipcraft in a fresh workspace:

```bash
rm -rf /tmp/clipcraft-plan3c-smoke
bun run dev clipcraft --workspace /tmp/clipcraft-plan3c-smoke --no-open --no-prompt --port 18104
```

Use `run_in_background: true`. Wait ~3 seconds, read the background log for the Vite URL.

Use chrome-devtools-mcp tools (via ToolSearch if deferred). `new_page` to the URL, wait for the page to settle (at least 1 second past the 500ms autosave debounce), then `list_network_requests` and `take_screenshot`.

**The critical invariant — verify it holds now:**

**Expected: ZERO `POST /api/files` requests on the network log.**

Plan 3b saw exactly one POST per mount because `createdAt` was re-stamped by craft's default `dispatch`. Plan 3c uses `dispatchEnvelope` with the on-disk `createdAt`, so serialize(state) now matches the seed file byte-for-byte, and the debounced persistence effect finds `content === lastAppliedRef.current` and skips.

If you see ONE or more `POST /api/files`, investigate:
1. Does `projectFileToCommands` actually pass `asset.createdAt` as the envelope timestamp? (Check Task 5 Step 5.1)
2. Does `useProjectSync` call `dispatchEnvelope` (not `dispatch`)? (Check Task 5 Step 5.2)
3. Does `dispatchEnvelope` actually reach `asset:register`'s handler with the supplied timestamp? (Unlikely — covered by Task 1/2 unit tests, but check)
4. Is there a remaining format drift in something OTHER than `createdAt`? Diff the in-memory serialized content against the on-disk seed file.

If the fix works, the seed's `createdAt: 1712934000000` round-trips cleanly, the serialized content matches the seed byte-for-byte, and the viewer skips the autosave write.

Screenshot should show the same StateDump content as Plan 3b's E2E:
- Composition: 1920×1080 @ 30fps
- Assets (1): yellow PENDING badge
- Event Log (last 10 of 3): composition:created, asset:registered, provenance:root-set
- No `[clipcraft] hydration envelope rejected` warnings in the console

- [ ] **Step 7.5: Kill the dev server**

- [ ] **Step 7.6: Report the result**

No commit for the E2E verification itself unless a fixup was required. If the zero-POST invariant now holds, state it explicitly in the report — that's the clean closer for Plan 3 (a/b/c).

---

## Self-Review Checklist

**Spec coverage:**
- [x] `dispatchEnvelope` added to `CraftCore` → Task 1
- [x] `dispatchEnvelope` added to `TimelineCore` → Task 2
- [x] `dispatchEnvelope` added to Zustand store → Task 3
- [x] Consumer verifies new API → Task 4 smoke test
- [x] `projectFileToCommands` passes on-disk timestamps → Task 5
- [x] `useProjectSync` uses `dispatchEnvelope` → Task 5
- [x] `createdAt` round-trip locked down by integration test → Task 6
- [x] Contract test at consumer boundary → Task 7
- [x] Zero-POST invariant verified E2E → Task 7

**Placeholder scan:** no TODO markers or placeholders in the plan.

**Type consistency:**
- `CommandEnvelope<CoreCommand>` in craft-core's signature, `CommandEnvelope<CoreCommand | CompositionCommand>` in craft-timeline and the Zustand store. Callers on the mode side already receive envelopes with the union type from `projectFileToCommands`, so no cast needed at the consumption site.
- The refactor pattern for each layer is the same: extract a local `dispatchEnvelopeImpl` helper, make `dispatch` a thin wrapper that builds the envelope, expose `dispatchEnvelope` as a direct pass-through.

**Known risks:**

1. **Backward compatibility risk** — `dispatch` gets refactored. If any existing craft consumer depends on the EXACT ordering of events the current `dispatch` produces (extremely unlikely, but possible in tests that compare event ids), the refactor could theoretically regress. Tasks 1, 2, 3 all include full-suite regression runs to catch this.

2. **The new envelope approach doesn't validate timestamp ordering.** A caller could supply a timestamp in the past or future. That's acceptable — the craft domain doesn't have "events must be time-ordered" as an invariant. Hydration might emit events with timestamps from years ago (when the project was created), which is semantically correct.

3. **The zero-POST invariant assumes `formatProjectJson(serializeProject(...))` is byte-identical to the seed.** Plan 3b already verified all fields except `createdAt` match. Plan 3c fixes `createdAt`. If a future change introduces a new field or reorders existing ones, the invariant breaks and we'd see chatter again. Task 7's E2E verification is the guard against this.

**Cross-repo hygiene:** Tasks 1-3 commit in the craft repo (branch `feat/clipcraft-aigc-status`); Tasks 5-7 commit in the pneuma-skills worktree. Both repos have clean histories after Plan 3c.
