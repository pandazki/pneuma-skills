# ClipCraft Plan 3a: ID Stability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make craft's `asset:register`, `composition:add-track`, and `composition:add-clip` commands accept an optional explicit `id` field. When present, craft uses the provided id after verifying it's unique; when absent, craft generates one as before. This lets ClipCraft's `persistence.ts` pass on-disk ids through hydration so round-trips preserve identity — which is the foundation Plan 3b (write path) and Plan 3c (diff-and-dispatch) build on.

**Architecture:** Four upstream commits in craft (core + timeline) add the optional-id surface. Two mode-side commits in clipcraft propagate disk ids through hydration and add a full-stack integration test that feeds a complete `ProjectFile` into a real `TimelineCore` and verifies every expected entity lands in state. The existing "provider remount on content change" band-aid from Plan 2 keeps working; the `hydratedContentRef` strict-mode guard stays. Both stop being load-bearing once Plan 3c's diff-and-dispatch lands.

**Tech Stack:**
- Cross-repo: `pneuma-craft-headless-stable` (branch `feat/clipcraft-aigc-status`) and pneuma-skills worktree (branch `feat/clipcraft-by-pneuma-craft`)
- Craft side: TypeScript, vitest, tsup watch
- Mode side: bun:test, React 19, existing `@pneuma-craft/*` symlinks

**Out of scope for this plan (explicit):**
- Write path back to `project.json` (Plan 3b)
- Self-write suppression and content-hash guards (Plan 3b)
- Diff-and-dispatch / partial hydration (Plan 3c)
- Removing the `hydratedContentRef` band-aid (Plan 3c)
- Real Timeline UI, playback, export (Plans 4+)

---

## The problem being fixed

In Plan 2, the persistence loader passes on-disk ids into the hydration command sequence:

```ts
// modes/clipcraft/persistence.ts (current)
cmds.push(makeEnvelope("human", {
  type: "asset:register",
  asset: { type, uri, name, metadata, ...maybeTags, ...maybeStatus },
}, ts));
// Note: asset.id from disk is intentionally NOT passed — craft ignores it.
```

Craft's command handler unconditionally overrides any incoming id:

```ts
// packages/core/src/command-handler.ts
case 'asset:register': {
  const asset: Asset = {
    ...command.asset,
    id: generateId(),   // always generates, disk id is lost
    createdAt: envelope.timestamp,
  };
  return [makeEvent(envelope, 'asset:registered', { asset })];
}
```

Consequence: the `provenance:set-root` / `provenance:link` commands that come later in the hydration sequence reference on-disk asset ids (`seed-asset-1`) that don't exist in craft's registry (which only knows about fresh nanoids). They fail `requireAsset` and the hook logs a warning per rejected edge. Plan 2's seed workaround is to have zero tracks/zero clips and accept the provenance warning. Plan 3a removes the workaround at the source.

The same issue exists for `composition:add-track` and `composition:add-clip` in the timeline package — they override ids too, which is why Plan 2's seed also had to have zero tracks.

---

## File Structure

### In `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core/`

**Modified:**
- `src/types.ts` — widen `asset:register`'s `asset` field to include optional `id?: string`
- `src/command-handler.ts` — `asset:register` case uses explicit id if provided; checks uniqueness against `state.registry`; throws `CommandValidationError` on duplicate
- `__tests__/command-handler.test.ts` — 2 new tests: "uses provided id", "rejects duplicate id"

### In `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/timeline/`

**Modified:**
- `src/types.ts` — widen `composition:add-track`'s `track` field and `composition:add-clip`'s `clip` field to include optional `id?: string`
- `src/command-handler.ts` — `add-track` and `add-clip` cases use explicit id if provided; each checks uniqueness against the current composition
- `__tests__/command-handler.test.ts` — 4 new tests (2 per command: explicit id + duplicate rejection)

### In `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/`

**Modified:**
- `modes/clipcraft/persistence.ts` — `projectFileToCommands` passes `asset.id` / `track.id` / `clip.id` through to the respective commands
- `modes/clipcraft/__tests__/persistence.test.ts` — assertions updated to verify emitted commands carry the on-disk ids

**Created:**
- `modes/clipcraft/__tests__/hydration-integration.test.ts` — full-stack test: takes a complete `ProjectFile` (settings + assets + provenance + track + clip), instantiates a real `TimelineCore`, dispatches all hydration commands, asserts end state (registry size, provenance nodes, composition tracks/clips, all with correct on-disk ids)

**No change needed to:**
- Any state projection file (the existing `applyEvent` in core and the add-track/add-clip projections in timeline use whatever id is in the event payload, which is exactly what the handler will now pass through)
- Undo manager (same reason — inversion produces events with the same ids)
- The `useProjectHydration` hook or `StateDump` component (they read projected state and don't care where ids come from)
- `seed/project.json` (already valid under the new rules — its explicit `seed-asset-1` / future track/clip ids simply start working)

---

## Task Ordering

**Cross-repo:**
- Tasks 1–4 live in the craft repo (`pneuma-craft-headless-stable`, branch `feat/clipcraft-aigc-status`)
- Tasks 5–7 live in the pneuma-skills worktree

Run the Turborepo watch (`cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run dev`) in the background for the duration of tasks 1-4 so `dist/` rebuilds on every save and the consumer-side symlinks stay fresh.

---

## Task 1: craft-core — `asset:register` accepts explicit id

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/command-handler.ts`
- Modify: `__tests__/command-handler.test.ts`

- [ ] **Step 1.1: Widen the command type**

Open `src/types.ts`. Find the `asset:register` variant in the `AssetCommand` union (around line 83-85):

```ts
export type AssetCommand =
  | { type: 'asset:register'; asset: Omit<Asset, 'id' | 'createdAt'> }
  ...
```

Change to:

```ts
export type AssetCommand =
  | { type: 'asset:register'; asset: Omit<Asset, 'id' | 'createdAt'> & { id?: string } }
  ...
```

The intersection adds an optional `id` while keeping all other asset fields required.

- [ ] **Step 1.2: Write the failing tests**

Open `__tests__/command-handler.test.ts`. Find the existing `describe('asset:register', ...)` block (around line 23). Append two new tests inside it:

```ts
it('uses the provided id when supplied', () => {
  const state = createInitialState();
  const events = handleCommand(state, makeEnvelope({
    type: 'asset:register',
    asset: {
      id: 'my-explicit-id',
      type: 'image',
      uri: '/test.png',
      name: 'Test',
      metadata: { width: 256 },
    },
  }));
  expect(events).toHaveLength(1);
  const asset = events[0].payload.asset as Asset;
  expect(asset.id).toBe('my-explicit-id');
  expect(asset.createdAt).toBe(1000); // from envelope timestamp
});

it('throws when registering with a duplicate explicit id', () => {
  const existing: Asset = { ...sampleAsset, id: 'dup-id' };
  const state = stateWithAsset(existing);
  expect(() => handleCommand(state, makeEnvelope({
    type: 'asset:register',
    asset: {
      id: 'dup-id',
      type: 'video',
      uri: '/other.mp4',
      name: 'Other',
      metadata: {},
    },
  }))).toThrow(CommandValidationError);
});
```

These rely on the existing `sampleAsset` / `stateWithAsset` / `makeEnvelope` / `createInitialState` / `CommandValidationError` helpers already in the test file.

- [ ] **Step 1.3: Run the tests to confirm failure**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- command-handler 2>&1 | tail -30
```

Expected:
- "uses the provided id when supplied" fails — current handler overrides the id with `generateId()`, so the assertion `asset.id === 'my-explicit-id'` fails.
- "throws when registering with a duplicate explicit id" fails — current handler has no uniqueness check, so no throw.

- [ ] **Step 1.4: Implement the handler change**

Open `src/command-handler.ts`. Find the `asset:register` case (around line 48-55). Replace it with:

```ts
    case 'asset:register': {
      const id = command.asset.id ?? generateId();
      if (state.registry.has(id)) {
        throw new CommandValidationError(`Asset already registered: ${id}`);
      }
      const asset: Asset = {
        ...command.asset,
        id,
        createdAt: envelope.timestamp,
      };
      return [makeEvent(envelope, 'asset:registered', { asset })];
    }
```

Key details:
- `??` gracefully falls back to `generateId()` when the caller didn't provide an id
- The uniqueness check happens BEFORE the event is emitted, so a duplicate never reaches the registry
- The error message includes the id so hydration failures are debuggable

- [ ] **Step 1.5: Run tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core -- command-handler 2>&1 | tail -20
```

Expected: all command-handler tests pass (the 2 new + all existing). Count should be 2 more than before.

- [ ] **Step 1.6: Run the full core suite as regression check**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/core 2>&1 | tail -20
```

Expected: all files pass. If an existing test accidentally registered two different assets with the same explicit id (unlikely but possible), it'll now fail — adjust the test to use different ids.

- [ ] **Step 1.7: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/core/src/types.ts packages/core/src/command-handler.ts packages/core/__tests__/command-handler.test.ts && git commit -m "feat(core): asset:register accepts optional explicit id"
```

---

## Task 2: craft-timeline — `composition:add-track` accepts explicit id

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/timeline`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/command-handler.ts`
- Modify: `__tests__/command-handler.test.ts`

- [ ] **Step 2.1: Widen the command type**

Open `src/types.ts`. Find line 85:

```ts
  | { type: 'composition:add-track'; track: Omit<Track, 'id'> }
```

Change to:

```ts
  | { type: 'composition:add-track'; track: Omit<Track, 'id'> & { id?: string } }
```

- [ ] **Step 2.2: Write the failing tests**

Open `__tests__/command-handler.test.ts`. Find where existing `composition:add-track` tests live (search for `describe('composition:add-track'` or similar). Append two new tests inside the appropriate describe block:

```ts
it('uses the provided track id when supplied', () => {
  const coreState = createInitialState();
  const compState = stateWithComposition();
  const events = handleCompositionCommand(coreState, compState, makeEnvelope({
    type: 'composition:add-track',
    track: {
      id: 'my-track-1',
      type: 'video',
      name: 'Video 1',
      clips: [],
      muted: false, volume: 1, locked: false, visible: true,
    },
  }));
  expect(events).toHaveLength(1);
  const track = events[0].payload.track as Track;
  expect(track.id).toBe('my-track-1');
});

it('throws when adding a track with a duplicate id', () => {
  const coreState = createInitialState();
  const compState = stateWithCompositionAndTrack({
    id: 'existing-track', type: 'video', name: 'Existing',
    clips: [], muted: false, volume: 1, locked: false, visible: true,
  });
  expect(() => handleCompositionCommand(coreState, compState, makeEnvelope({
    type: 'composition:add-track',
    track: {
      id: 'existing-track',
      type: 'audio',
      name: 'Audio 1',
      clips: [],
      muted: false, volume: 1, locked: false, visible: true,
    },
  }))).toThrow(CommandValidationError);
});
```

Helper notes: `stateWithComposition()` and `stateWithCompositionAndTrack(track)` should already exist in the test file (the composition:add-track test block needs them to set up state). If they don't, define them locally at the top of the new test block or steal them from another describe that does create compositions.

If they exist but under slightly different names (e.g. `makeComposition()` / `makeStateWithTrack()`), use those.

- [ ] **Step 2.3: Run tests to confirm failure**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/timeline -- command-handler 2>&1 | tail -30
```

Expected: 2 new failures, matching the same pattern as Task 1.

- [ ] **Step 2.4: Implement the handler change**

Open `src/command-handler.ts`. Find the `composition:add-track` case (around line 124-128):

```ts
    case 'composition:add-track': {
      requireComposition(compState);
      const track: Track = { ...command.track, id: generateId() };
      return [makeEvent(envelope, 'composition:track-added', { track })];
    }
```

Replace with:

```ts
    case 'composition:add-track': {
      const composition = requireComposition(compState);
      const id = command.track.id ?? generateId();
      if (composition.tracks.some(t => t.id === id)) {
        throw new CommandValidationError(`Track already exists: ${id}`);
      }
      const track: Track = { ...command.track, id };
      return [makeEvent(envelope, 'composition:track-added', { track })];
    }
```

- [ ] **Step 2.5: Run tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/timeline -- command-handler 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/timeline/src/types.ts packages/timeline/src/command-handler.ts packages/timeline/__tests__/command-handler.test.ts && git commit -m "feat(timeline): composition:add-track accepts optional explicit id"
```

---

## Task 3: craft-timeline — `composition:add-clip` accepts explicit id

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/timeline`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/command-handler.ts`
- Modify: `__tests__/command-handler.test.ts`

- [ ] **Step 3.1: Widen the command type**

Open `src/types.ts`. Find line 87 (the add-clip variant):

```ts
  | { type: 'composition:add-clip'; trackId: string; clip: Omit<Clip, 'id' | 'trackId'> }
```

Change to:

```ts
  | { type: 'composition:add-clip'; trackId: string; clip: Omit<Clip, 'id' | 'trackId'> & { id?: string } }
```

- [ ] **Step 3.2: Write the failing tests**

Open `__tests__/command-handler.test.ts`. Append inside the existing `composition:add-clip` describe block:

```ts
it('uses the provided clip id when supplied', () => {
  // Setup: composition with one track, registry with one asset
  const asset: Asset = {
    id: 'a1', type: 'video', uri: '/a.mp4', name: 'A',
    metadata: { duration: 10 }, createdAt: 1000,
  };
  const coreState = stateWithAsset(asset);
  const compState = stateWithCompositionAndTrack({
    id: 'track-1', type: 'video', name: 'Video',
    clips: [], muted: false, volume: 1, locked: false, visible: true,
  });
  const events = handleCompositionCommand(coreState, compState, makeEnvelope({
    type: 'composition:add-clip',
    trackId: 'track-1',
    clip: {
      id: 'clip-xyz',
      assetId: 'a1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
    },
  }));
  const addEvent = events.find(e => e.type === 'composition:clip-added');
  expect(addEvent).toBeDefined();
  expect((addEvent!.payload.clip as Clip).id).toBe('clip-xyz');
});

it('throws when adding a clip with a duplicate id', () => {
  const asset: Asset = {
    id: 'a1', type: 'video', uri: '/a.mp4', name: 'A',
    metadata: { duration: 10 }, createdAt: 1000,
  };
  const coreState = stateWithAsset(asset);
  const existingClip: Clip = {
    id: 'dup-clip',
    assetId: 'a1',
    trackId: 'track-1',
    startTime: 0,
    duration: 3,
    inPoint: 0,
    outPoint: 3,
  };
  const compState = stateWithCompositionAndTrack({
    id: 'track-1', type: 'video', name: 'Video',
    clips: [existingClip], muted: false, volume: 1, locked: false, visible: true,
  });
  expect(() => handleCompositionCommand(coreState, compState, makeEnvelope({
    type: 'composition:add-clip',
    trackId: 'track-1',
    clip: {
      id: 'dup-clip', // same as existingClip
      assetId: 'a1',
      startTime: 5,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
    },
  }))).toThrow(CommandValidationError);
});
```

If `stateWithAsset` isn't in the timeline test file, import it or recreate it locally. It needs to produce a `PneumaCraftCoreState` whose `registry` Map contains the one asset — follow the pattern used by existing clip-related tests in the same file.

- [ ] **Step 3.3: Run tests to confirm failure**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/timeline -- command-handler 2>&1 | tail -30
```

Expected: 2 new failures.

- [ ] **Step 3.4: Implement the handler change**

Open `src/command-handler.ts`. Find the `composition:add-clip` case (around line 139-150):

```ts
    case 'composition:add-clip': {
      const composition = requireComposition(compState);
      const track = requireTrack(composition, command.trackId);
      requireTrackNotLocked(track);
      if (!coreState.registry.has(command.clip.assetId)) {
        throw new CommandValidationError(`Asset not found in registry: ${command.clip.assetId}`);
      }
      const clip: Clip = { ...command.clip, id: generateId(), trackId: command.trackId };
      const addEvent = makeEvent(envelope, 'composition:clip-added', { trackId: command.trackId, clip });
      const rippleEvents = generateRippleEvents(envelope, track, clip.startTime, clip.duration);
      return [addEvent, ...rippleEvents];
    }
```

Replace the id generation + the optional uniqueness check. The full case becomes:

```ts
    case 'composition:add-clip': {
      const composition = requireComposition(compState);
      const track = requireTrack(composition, command.trackId);
      requireTrackNotLocked(track);
      if (!coreState.registry.has(command.clip.assetId)) {
        throw new CommandValidationError(`Asset not found in registry: ${command.clip.assetId}`);
      }
      const id = command.clip.id ?? generateId();
      // Clip ids are globally unique across all tracks in the composition.
      for (const t of composition.tracks) {
        if (t.clips.some(c => c.id === id)) {
          throw new CommandValidationError(`Clip already exists: ${id}`);
        }
      }
      const clip: Clip = { ...command.clip, id, trackId: command.trackId };
      const addEvent = makeEvent(envelope, 'composition:clip-added', { trackId: command.trackId, clip });
      const rippleEvents = generateRippleEvents(envelope, track, clip.startTime, clip.duration);
      return [addEvent, ...rippleEvents];
    }
```

Note: the `findClipById` helper already exists in `composition-helpers.ts` — you could use it instead of the inline loop if you prefer, but the inline loop is clearer for a uniqueness check and avoids a helper call inside a validation path.

- [ ] **Step 3.5: Run tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run test --filter @pneuma-craft/timeline 2>&1 | tail -30
```

Expected: all timeline tests pass, including ripple-move and split-clip regressions. Split-clip internally calls `generateId()` for the new right-half clip — that path is untouched and should still work.

- [ ] **Step 3.6: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && git add packages/timeline/src/types.ts packages/timeline/src/command-handler.ts packages/timeline/__tests__/command-handler.test.ts && git commit -m "feat(timeline): composition:add-clip accepts optional explicit id"
```

---

## Task 4: Rebuild craft + verify consumer-side

**Working directory:** `/Users/pandazki/Codes/pneuma-craft-headless-stable`

**Files:** none modified.

- [ ] **Step 4.1: Rebuild**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run build 2>&1 | tail -10
```

Expected: all packages build cleanly. If the Turbo watch is already running, this should be a near-instant cache hit.

- [ ] **Step 4.2: Verify the new type surface reaches the consumer d.ts**

```bash
grep -A 1 "asset:register" /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/node_modules/@pneuma-craft/core/dist/index.d.ts | head -8
```

Expected: the `asset:register` command type shows the `id?: string` optional field.

```bash
grep -A 1 "composition:add-track\|composition:add-clip" /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/node_modules/@pneuma-craft/timeline/dist/index.d.ts | head -8
```

Expected: both commands show the `id?: string` optional field on their `track`/`clip` payloads.

- [ ] **Step 4.3: Consumer smoke test**

From the pneuma-skills worktree:

```bash
cat > /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/.p3a-smoke.ts <<'EOF'
import { createCore, CommandValidationError } from "@pneuma-craft/core";
const core = createCore();

// 1. Register with explicit id
core.dispatch("human", {
  type: "asset:register",
  asset: { id: "my-explicit-id", type: "image", uri: "/x.png", name: "x", metadata: {} },
});
console.log("1. registry has my-explicit-id:", core.getState().registry.has("my-explicit-id"));

// 2. Duplicate register should throw
try {
  core.dispatch("human", {
    type: "asset:register",
    asset: { id: "my-explicit-id", type: "video", uri: "/y.mp4", name: "y", metadata: {} },
  });
  console.log("2. FAIL: duplicate did NOT throw");
} catch (e) {
  console.log("2. duplicate threw:", (e as Error).constructor.name, "-", (e as Error).message);
}

// 3. Register without id still works (falls back to generate)
const evts = core.dispatch("human", {
  type: "asset:register",
  asset: { type: "audio", uri: "/z.mp3", name: "z", metadata: {} },
});
const gen = (evts[0].payload.asset as { id: string }).id;
console.log("3. generated id:", gen.length > 0 ? "ok" : "empty");
EOF
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun .p3a-smoke.ts && rm .p3a-smoke.ts
```

Expected output:
```
1. registry has my-explicit-id: true
2. duplicate threw: Error - Asset already registered: my-explicit-id
3. generated id: ok
```

Note: the error class name reported via `constructor.name` may be `Error` rather than `CommandValidationError` depending on how it propagates through the dispatch wrapper. What matters is that it threw — adjust the assertion if the class name differs.

- [ ] **Step 4.4: Verify the existing Plan 2 test suite still passes**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test 2>&1 | tail -15
```

Expected: the full suite (including the existing `craft-imports.test.ts` roundtrip test from Plan 2) still passes. Any regression means Plan 3a broke backward compat for callers that rely on `generateId()`-fallback — investigate and fix before proceeding.

No commit for Task 4 itself.

---

## Task 5: clipcraft persistence — pass explicit ids through hydration

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Modify: `modes/clipcraft/persistence.ts`
- Modify: `modes/clipcraft/__tests__/persistence.test.ts`

- [ ] **Step 5.1: Add the new test assertions**

Open `modes/clipcraft/__tests__/persistence.test.ts`. Update the three existing `projectFileToCommands` tests to also verify explicit ids are in the payloads. Keep the existing order assertions.

For "emits exactly composition:create for an empty project" — leave as-is (no assets/tracks/clips to check ids for).

For "emits composition:create → asset:register → provenance:set-root in order for an AIGC asset with null parent" — after the existing `types` assertion, append:

```ts
  // ID stability: the on-disk asset.id must flow through to the command payload
  const registerCmd = cmds.find((c) => c.command.type === "asset:register");
  expect(registerCmd).toBeDefined();
  const assetPayload = (registerCmd!.command as { asset: { id?: string } }).asset;
  expect(assetPayload.id).toBe("a1");
```

For "emits composition:create → asset:register → composition:add-track → composition:add-clip in order when composition has tracks" — append:

```ts
  // ID stability: asset, track, and clip ids all flow through
  const registerCmd = cmds.find((c) => c.command.type === "asset:register");
  const addTrackCmd = cmds.find((c) => c.command.type === "composition:add-track");
  const addClipCmd = cmds.find((c) => c.command.type === "composition:add-clip");
  expect((registerCmd!.command as { asset: { id?: string } }).asset.id).toBe("a1");
  expect((addTrackCmd!.command as { track: { id?: string } }).track.id).toBe("v1");
  expect((addClipCmd!.command as { clip: { id?: string } }).clip.id).toBe("c1");
  expect((addClipCmd!.command as { trackId: string }).trackId).toBe("v1");
```

- [ ] **Step 5.2: Run the tests to confirm they fail**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/persistence.test.ts 2>&1 | tail -20
```

Expected: the two updated tests fail on the `id` assertions because `persistence.ts` currently strips them.

- [ ] **Step 5.3: Update `persistence.ts` to pass ids through**

Open `modes/clipcraft/persistence.ts`. Find the `projectFileToCommands` function.

In the asset registration loop (search for `type: "asset:register"`), add `id: asset.id` to the asset payload:

```ts
  for (const asset of file.assets) {
    cmds.push(makeEnvelope("human", {
      type: "asset:register",
      asset: {
        id: asset.id,                              // ← new
        type: asset.type,
        uri: asset.uri,
        name: asset.name,
        metadata: asset.metadata as never,
        ...(asset.tags ? { tags: asset.tags } : {}),
        ...(asset.status ? { status: asset.status } : {}),
      },
    }, ts));
  }
```

In the track loop (search for `type: "composition:add-track"`), add `id: track.id`:

```ts
  for (const track of file.composition.tracks) {
    cmds.push(makeEnvelope("human", {
      type: "composition:add-track",
      track: {
        id: track.id,                              // ← new
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
          id: clip.id,                             // ← new
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
```

Also update the JSDoc above `projectFileToCommands` to remove the "TODO(plan-3): id stability" warning — that TODO is now being satisfied. Replace the old paragraph about id instability with a short note that ids are now preserved via Plan 3a.

Specifically, find the block that reads:

```ts
 * Order: composition:create → asset:register* → provenance:* → composition:add-track*
 *        → composition:add-clip* (per track).
 *
 * TODO(plan-3): track/clip ids are NOT preserved through dispatch (craft
 * assigns fresh ids). Plan 2 seed has zero tracks/clips so this doesn't bite.
 */
```

Replace with:

```ts
 * Order: composition:create → asset:register* → provenance:* → composition:add-track*
 *        → composition:add-clip* (per track).
 *
 * Ids are preserved: asset.id, track.id, clip.id from the on-disk file are
 * passed through to craft's commands unchanged (Plan 3a). Craft rejects
 * duplicate ids at dispatch time, so the hook's try/catch will log and
 * continue if the same content is accidentally hydrated twice.
 */
```

Also remove the inline `// TODO(plan-3):` comments that refer to id stability inside the asset loop, the provenance section's explanation of why the warnings appear, and the track/clip loop. The provenance warnings should NO LONGER appear during normal operation after Plan 3a.

Specifically delete or rewrite:
- the `// 2.` asset loop comment block's paragraph about "craft assigns a fresh id" and "TODO(plan-3)"
- the `// 3.` provenance section's multi-paragraph comment about "will be rejected by craft's requireAsset check" — replace with a one-line note that provenance edges are now linked correctly
- the `// 4.` tracks/clips comment's "TODO(plan-3): id stability" marker

Keep the try/catch around `dispatch` in the hook itself — the warnings are still useful if hydration runs into a genuinely malformed file, and Plan 3c will revisit the error handling.

- [ ] **Step 5.4: Run the tests to confirm pass**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/persistence.test.ts 2>&1 | tail -20
```

Expected: all persistence tests pass, including the updated id assertions.

- [ ] **Step 5.5: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: no errors.

- [ ] **Step 5.6: Commit**

```bash
git add modes/clipcraft/persistence.ts modes/clipcraft/__tests__/persistence.test.ts && git commit -m "feat(clipcraft): pass explicit ids through hydration commands"
```

---

## Task 6: Full-stack hydration integration test

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:**
- Create: `modes/clipcraft/__tests__/hydration-integration.test.ts`

This is the test the user specifically asked for: "涉及 UI 的部分不多...尽量保证测试完备性". It validates the full hydration path without any React or browser involvement — feeds a complete `ProjectFile` into a real `TimelineCore`, dispatches every hydration command, and verifies the end state.

- [ ] **Step 6.1: Write the integration test**

Create `modes/clipcraft/__tests__/hydration-integration.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { createTimelineCore } from "@pneuma-craft/timeline";
import { parseProjectFile, projectFileToCommands } from "../persistence.js";
import type { ProjectFile } from "../persistence.js";

/**
 * Full-stack hydration test. Builds a complete ProjectFile, feeds it through
 * the persistence loader into a real TimelineCore, and verifies every piece
 * of state projects correctly with ids preserved.
 *
 * This is the canonical test for the Plan 3a id-stability contract:
 * if craft or the persistence layer loses id identity anywhere in the
 * round-trip, this test fails loudly.
 */

const completeFile: ProjectFile = {
  $schema: "pneuma-craft/project/v1",
  title: "Forest Opening",
  composition: {
    settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    tracks: [
      {
        id: "track-video-1",
        type: "video",
        name: "Main Video",
        muted: false,
        volume: 1,
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip-opener",
            assetId: "asset-forest-shot",
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
          },
        ],
      },
    ],
    transitions: [],
  },
  assets: [
    {
      id: "asset-forest-shot",
      type: "video",
      uri: "assets/clips/forest-dawn.mp4",
      name: "forest-dawn",
      metadata: { width: 1920, height: 1080, duration: 5, fps: 30 },
      createdAt: 1712934000000,
      status: "ready",
      tags: ["opener"],
    },
  ],
  provenance: [
    {
      toAssetId: "asset-forest-shot",
      fromAssetId: null,
      operation: {
        type: "generate",
        actor: "agent",
        agentId: "clipcraft-videogen",
        timestamp: 1712934000000,
        label: "runway gen3-alpha-turbo",
        params: {
          model: "gen3-alpha-turbo",
          prompt: "wide shot of a foggy forest at dawn",
          seed: 42,
        },
      },
    },
  ],
};

function hydrate(file: ProjectFile): ReturnType<typeof createTimelineCore> {
  const core = createTimelineCore();
  const cmds = projectFileToCommands(file);
  for (const env of cmds) {
    core.dispatch(env.actor, env.command);
  }
  return core;
}

describe("full-stack hydration", () => {
  it("hydrates a complete project file into a real TimelineCore", () => {
    const core = hydrate(completeFile);
    const coreState = core.getCoreState();
    const composition = core.getComposition();

    // Composition exists with the right settings
    expect(composition).not.toBeNull();
    expect(composition!.settings).toEqual(completeFile.composition.settings);

    // Asset registry has the asset under its on-disk id
    expect(coreState.registry.size).toBe(1);
    expect(coreState.registry.has("asset-forest-shot")).toBe(true);
    const asset = coreState.registry.get("asset-forest-shot");
    expect(asset!.type).toBe("video");
    expect(asset!.uri).toBe("assets/clips/forest-dawn.mp4");
    expect(asset!.status).toBe("ready");
    expect(asset!.tags).toEqual(["opener"]);

    // Provenance node + edge exist with the right operation
    expect(coreState.provenance.nodes.size).toBe(1);
    expect(coreState.provenance.nodes.has("asset-forest-shot")).toBe(true);
    const node = coreState.provenance.nodes.get("asset-forest-shot");
    expect(node!.parentIds).toEqual([]);
    expect(node!.rootOperation.type).toBe("generate");
    expect(node!.rootOperation.agentId).toBe("clipcraft-videogen");
    // AIGC params round-trip intact
    expect(node!.rootOperation.params).toMatchObject({
      model: "gen3-alpha-turbo",
      prompt: "wide shot of a foggy forest at dawn",
      seed: 42,
    });

    // Composition has the track under its on-disk id
    expect(composition!.tracks).toHaveLength(1);
    const track = composition!.tracks[0];
    expect(track.id).toBe("track-video-1");
    expect(track.type).toBe("video");
    expect(track.name).toBe("Main Video");

    // The track has the clip under its on-disk id, referencing the asset id
    expect(track.clips).toHaveLength(1);
    const clip = track.clips[0];
    expect(clip.id).toBe("clip-opener");
    expect(clip.assetId).toBe("asset-forest-shot");
    expect(clip.trackId).toBe("track-video-1");
    expect(clip.startTime).toBe(0);
    expect(clip.duration).toBe(5);
  });

  it("preserves ids across a round trip of the seed project", () => {
    // Use the exact text of modes/clipcraft/seed/project.json via parseProjectFile
    // rather than hardcoding — keeps the seed and this test in sync.
    const seedRaw = Bun.file(
      new URL("../seed/project.json", import.meta.url).pathname,
    );
    return seedRaw.text().then((text) => {
      const parsed = parseProjectFile(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const core = hydrate(parsed.value);
      const coreState = core.getCoreState();
      // The seed has seed-asset-1 as a pending image
      expect(coreState.registry.has("seed-asset-1")).toBe(true);
      expect(coreState.registry.get("seed-asset-1")!.status).toBe("pending");
      // And a provenance root edge
      expect(coreState.provenance.nodes.has("seed-asset-1")).toBe(true);
      expect(coreState.provenance.edges.size).toBe(1);
    });
  });

  it("rejects a duplicate hydration attempt by throwing in dispatch", () => {
    const core = hydrate(completeFile);
    // Dispatching the same asset:register again should throw because the id
    // already exists in the registry.
    expect(() =>
      core.dispatch("human", {
        type: "asset:register",
        asset: {
          id: "asset-forest-shot",
          type: "video",
          uri: "assets/clips/other.mp4",
          name: "other",
          metadata: {},
        },
      }),
    ).toThrow();
  });
});
```

Two notes on this test:

1. **The second test uses `Bun.file(...).text()`** to read the seed JSON from disk. This couples the test to the actual on-disk seed, so if the seed drifts (e.g. someone adds a track without updating the seed's id scheme), this test will catch it. Path resolution uses `new URL('../seed/project.json', import.meta.url)` to be robust against the test runner's cwd. If bun:test doesn't support this pattern cleanly, fall back to a hardcoded relative path from the test file (`../seed/project.json` joined from `__dirname`-equivalent, which in bun is `import.meta.dir`).

2. **The third test (duplicate rejection)** uses the try/catch-free `toThrow()` matcher because we don't care about the specific error class — just that craft rejected the duplicate. This locks in that the uniqueness check from Tasks 1-3 is actually enforced through the full dispatch pipeline.

- [ ] **Step 6.2: Run the integration test**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/hydration-integration.test.ts 2>&1 | tail -30
```

Expected: all 3 tests pass. If any fail, the most likely causes in order of probability:
- The `Bun.file` URL pattern doesn't resolve — swap for `${import.meta.dir}/../seed/project.json`
- An assertion like `asset.tags` fails because the `asset:register` handler is dropping fields when spreading — check Task 1's implementation didn't accidentally omit `...command.asset`
- Provenance edge is missing because `projectFileToCommands` emits commands in the wrong order — check Task 5's loop structure

- [ ] **Step 6.3: Full test suite regression**

```bash
bun test 2>&1 | tail -15
```

Expected: full suite passes. Should be 3 more tests than before Task 6.

- [ ] **Step 6.4: Commit**

```bash
git add modes/clipcraft/__tests__/hydration-integration.test.ts && git commit -m "test(clipcraft): full-stack hydration integration test"
```

---

## Task 7: E2E sanity re-verification

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:** none modified unless a fixup is required.

This task re-runs the Plan 2 E2E smoke test to confirm that the provenance warning is gone and the on-disk ids are visible in the browser console / StateDump.

- [ ] **Step 7.1: Launch in a fresh workspace**

Use a different workspace from previous smoke tests:

```bash
rm -rf /tmp/clipcraft-plan3a-smoke
```

Then (via background Bash):

```bash
bun run dev clipcraft --workspace /tmp/clipcraft-plan3a-smoke --no-open --no-prompt --port 18102
```

Wait for the server to boot, read the background log for the Vite URL.

- [ ] **Step 7.2: Screenshot via chrome-devtools-mcp**

Load `chrome-devtools-mcp` tools via ToolSearch (query `chrome-devtools new_page take_screenshot list_console_messages`). Open the Vite URL, screenshot, `list_console_messages`.

Expected StateDump content:
- Composition: `1920×1080 @ 30fps (16:9)`, `tracks: 0`, `transitions: 0`, `duration: 0.00s`
- Assets (1): yellow PENDING badge, `image · opening-shot (pending generation)`
- **Event Log (last 10 of 3)** — 3 events now, not 2: `composition:created`, `asset:registered`, `provenance:root-set`. The provenance event that Plan 2 couldn't emit (because the id didn't exist) now emits successfully.

Expected console:
- Vite HMR, React DevTools info — benign
- **No** `[clipcraft] hydration command rejected provenance:set-root Asset not found: seed-asset-1` warning. This warning was the Plan 2 footprint of the id-stability gap. Plan 3a should eliminate it.

If the warning is still present, Task 5's persistence.ts change isn't actually passing the asset id through — go back and check.

- [ ] **Step 7.3: Kill the dev server**

Stop the background job.

- [ ] **Step 7.4: Fixup commit (only if needed)**

If verification revealed any code fixes, commit them as `fix(clipcraft): plan 3a smoke-test fixups`.

No commit for Task 7 itself unless fixups.

---

## Self-Review Checklist

**Spec coverage:**
- [x] `asset:register` accepts explicit id → Task 1
- [x] Duplicate asset id rejection → Task 1 test
- [x] `composition:add-track` accepts explicit id → Task 2
- [x] Duplicate track id rejection → Task 2 test
- [x] `composition:add-clip` accepts explicit id → Task 3
- [x] Duplicate clip id rejection → Task 3 test
- [x] Consumer side verifies new API → Task 4 smoke test
- [x] `persistence.ts` passes ids through → Task 5
- [x] Persistence unit tests cover id passthrough → Task 5
- [x] Full-stack integration test → Task 6
- [x] E2E sanity re-verification → Task 7

**Placeholder scan:** every code step has a concrete code block. No TODO or "TBD" markers.

**Type consistency:** the `Omit<X, 'id' | 'createdAt'> & { id?: string }` pattern is used consistently for `asset:register`. For `add-track`/`add-clip`, the pattern is `Omit<X, 'id'> & { id?: string }` (no `createdAt` on those types). The tests use the same literal object shapes as the command type.

**Known risks:**

1. **Existing craft tests might break** if any of them register two assets/tracks/clips with accidentally-colliding generated ids. Very unlikely (generateId uses nanoid, collision probability is negligible), but worth running the full core + timeline suites after Task 3 to catch it.

2. **The Plan 2 `hydratedContentRef` strict-mode guard** stays in place. Its purpose is still valid: React 19 StrictMode double-invokes effects, the hook's effect runs twice on the same store, and without the guard you'd now see "Asset already registered" errors thrown on the second run (instead of the Plan 2 silent duplication). The try/catch in the effect catches those errors gracefully, so even without the guard, the end state would be correct — but the guard avoids the error-log noise. Plan 3c will remove it when diff-and-dispatch lands.

3. **The persistence loader's try/catch** around `dispatch` stays in place too. Now it catches a different class of errors (duplicate-id from re-run, vs Plan 2's "asset not found in provenance link"). Same shape, same behavior.

4. **Seed file unchanged.** `modes/clipcraft/seed/project.json` already has explicit ids; it just wasn't being used for anything. After Plan 3a it starts working automatically. No file rewrite needed.

**Cross-repo hygiene:** Tasks 1-3 commit in the craft repo (branch `feat/clipcraft-aigc-status`); tasks 5-6 commit in the pneuma-skills worktree (branch `feat/clipcraft-by-pneuma-craft`). Neither repo is pushed as part of this plan.
