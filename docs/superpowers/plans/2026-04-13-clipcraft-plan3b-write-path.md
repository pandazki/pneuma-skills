# ClipCraft Plan 3b: Write Path + Loop Protection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a serialize path so craft state can be written back to `project.json`, wire it through a debounced auto-save, and protect the write ↔ file-watcher cycle so our own writes don't cause spurious remounts. After this plan, future user-initiated actions (Plan 4+) will auto-persist without any additional plumbing.

**Architecture:** Everything lives in the pneuma-skills worktree — no cross-repo work, no craft changes. We reuse the existing generic `POST /api/files` server endpoint (at `server/index.ts:1735`) for writes rather than adding a mode-specific route. Loop protection is client-side: a `lastAppliedContent` ref tracks the content we've committed to, and we compare against it on both reads (to skip echoes of our own writes) and writes (to skip no-ops). The `providerKey` strategy from Plan 2 stays, but its key is now state-based instead of content-based — bumped explicitly when an external edit is detected, never by our own writes.

**Tech Stack:**
- pneuma-skills worktree (branch `feat/clipcraft-by-pneuma-craft`)
- bun:test, React 19, existing `@pneuma-craft/*` symlinks
- Plan 3a's id stability is a prerequisite (and already landed)

**Out of scope (explicit):**
- Diff-and-dispatch / partial hydration (Plan 3c)
- Preserving undo history across external edits (Plan 3c — requires 3c's diff path)
- Preserving PlaybackEngine state across external edits (Plan 3c)
- Real Timeline UI / playback / export (Plans 4+)
- Agent-dispatched commands via MCP (much later plan)
- E2E verification of a USER-initiated write path (no user actions exist yet — Plan 4 will be the first real consumer and will be the natural place to verify end-to-end)

---

## The problem being solved

Plan 2's ClipCraft is read-only: disk → memory via hydration, nothing in the reverse direction. User-initiated state changes (once Plan 4 adds real UI) can't persist anywhere. And the Plan 2 `providerKey = content` strategy means ANY content change — including our own writes — triggers a full provider remount, which tears down the store, the (future) `PlaybackEngine`, and any in-flight work.

Plan 3b adds three capabilities:

1. **Serialize craft state back to a `ProjectFile`** — inverse of `projectFileToCommands`. Plan 3a's id stability makes this trivial: ids in the registry are the on-disk ids, so serialization is pure field rename + JSON.
2. **Write it to disk via `POST /api/files`** — the existing server endpoint already accepts `{ path: "project.json", content }` and handles path traversal protection. Nothing new on the server side.
3. **Distinguish our own echoes from real external edits** — via a `lastAppliedContent` ref. When we write C, we stash C in the ref before the fetch. When the chokidar echo arrives (same C), we skip hydration AND skip bumping the `providerKey`, so the provider stays mounted.

The primary risk is the loop-protection logic: if the ref gets stale, we either miss real external edits (bug) or we re-hydrate our own writes (remount churn, not a correctness issue). Testing is covered by pure-function unit tests plus a round-trip integration test on top of a real `TimelineCore`.

---

## File Structure

### Created
- `modes/clipcraft/api-client.ts` — `writeProjectFile(content: string): Promise<void>` function that POSTs to `/api/files` with `path: "project.json"`.
- `modes/clipcraft/viewer/hooks/useProjectSync.ts` — replaces `useProjectHydration.ts`. Single hook that handles both directions: rehydrate on external disk change, debounced serialize+write on craft-state change. Accepts `lastAppliedRef` and `onLocalWrite` callback from the parent.
- `modes/clipcraft/__tests__/api-client.test.ts` — unit tests for `writeProjectFile` with a mocked global `fetch`.

### Modified
- `modes/clipcraft/persistence.ts` — add `serializeProject(coreState, composition): ProjectFile` and `formatProjectJson(file: ProjectFile): string` functions. Existing parse/hydrate functions untouched.
- `modes/clipcraft/__tests__/persistence.test.ts` — add unit tests for the two new functions: empty project, AIGC asset with status, provenance edges, full composition, deterministic output, trailing newline in formatted output.
- `modes/clipcraft/__tests__/hydration-integration.test.ts` — add round-trip test: hydrate `completeFile` → `serializeProject` → `parseProjectFile` → `projectFileToCommands` → hydrate fresh → assert final state equals original `completeFile`'s shape (modulo field ordering).
- `modes/clipcraft/viewer/ClipCraftPreview.tsx` — replace `useProjectHydration` import with `useProjectSync`. Lift `lastAppliedContent` ref to this component. Use state-based `providerKey` bumped only when an external edit is detected (pure-function helper `shouldBumpProviderKey` co-located with the hook for testability).

### Deleted
- `modes/clipcraft/viewer/hooks/useProjectHydration.ts` — superseded by `useProjectSync.ts` in Task 4 and removed in the same commit via `git rm`.

---

## Task Ordering

Each task is one atomic commit, and each task's tests pass before moving on. All tasks live in the pneuma-skills worktree — no cross-repo work.

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 (optional verification).

---

## Task 1: `serializeProject` + `formatProjectJson` (persistence.ts)

**Files:**
- Modify: `modes/clipcraft/persistence.ts`
- Modify: `modes/clipcraft/__tests__/persistence.test.ts`

- [ ] **Step 1.1: Write the failing unit tests**

Open `modes/clipcraft/__tests__/persistence.test.ts`. Append a new describe block at the bottom:

```ts
import { createTimelineCore } from "@pneuma-craft/timeline";
import { serializeProject, formatProjectJson } from "../persistence.js";

describe("serializeProject", () => {
  it("returns a minimal ProjectFile for an empty composition", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.$schema).toBe("pneuma-craft/project/v1");
    expect(file.composition.settings).toEqual({
      width: 1920, height: 1080, fps: 30, aspectRatio: "16:9",
    });
    expect(file.composition.tracks).toEqual([]);
    expect(file.composition.transitions).toEqual([]);
    expect(file.assets).toEqual([]);
    expect(file.provenance).toEqual([]);
  });

  it("preserves AIGC asset status, tags, and metadata", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    core.dispatch("human", {
      type: "asset:register",
      asset: {
        id: "a1",
        type: "image",
        uri: "",
        name: "pending-shot",
        metadata: { width: 1024 },
        tags: ["reference"],
        status: "generating",
      },
    });
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.assets).toHaveLength(1);
    const a = file.assets[0];
    expect(a.id).toBe("a1");
    expect(a.type).toBe("image");
    expect(a.name).toBe("pending-shot");
    expect(a.status).toBe("generating");
    expect(a.tags).toEqual(["reference"]);
    expect(a.metadata).toEqual({ width: 1024 });
  });

  it("serializes a provenance root edge with the operation intact", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    core.dispatch("human", {
      type: "asset:register",
      asset: {
        id: "a1", type: "video", uri: "a.mp4", name: "a",
        metadata: {}, status: "ready",
      },
    });
    core.dispatch("agent", {
      type: "provenance:set-root",
      assetId: "a1",
      operation: {
        type: "generate",
        actor: "agent",
        agentId: "clipcraft-videogen",
        timestamp: 1000,
        label: "runway gen3",
        params: { model: "gen3", prompt: "a forest", seed: 42 },
      },
    });
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.provenance).toHaveLength(1);
    const edge = file.provenance[0];
    expect(edge.toAssetId).toBe("a1");
    expect(edge.fromAssetId).toBeNull();
    expect(edge.operation.type).toBe("generate");
    expect(edge.operation.agentId).toBe("clipcraft-videogen");
    expect(edge.operation.params).toMatchObject({
      model: "gen3", prompt: "a forest", seed: 42,
    });
  });

  it("serializes a composition with a track and a clip, preserving ids", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    core.dispatch("human", {
      type: "asset:register",
      asset: { id: "a1", type: "video", uri: "a.mp4", name: "a", metadata: { duration: 5 } },
    });
    core.dispatch("human", {
      type: "composition:add-track",
      track: {
        id: "v1",
        type: "video",
        name: "Video 1",
        clips: [],
        muted: false, volume: 1, locked: false, visible: true,
      },
    });
    core.dispatch("human", {
      type: "composition:add-clip",
      trackId: "v1",
      clip: {
        id: "c1", assetId: "a1",
        startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
      },
    });

    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.composition.tracks).toHaveLength(1);
    const track = file.composition.tracks[0];
    expect(track.id).toBe("v1");
    expect(track.type).toBe("video");
    expect(track.clips).toHaveLength(1);
    expect(track.clips[0].id).toBe("c1");
    expect(track.clips[0].assetId).toBe("a1");
    expect(track.clips[0].startTime).toBe(0);
    expect(track.clips[0].duration).toBe(5);
  });

  it("returns an empty-settings ProjectFile when composition is null", () => {
    const core = createTimelineCore();
    // No composition:create — getComposition() returns null
    const file = serializeProject(core.getCoreState(), core.getComposition());
    expect(file.composition.tracks).toEqual([]);
    expect(file.assets).toEqual([]);
    // Settings should fall back to sensible defaults matching the seed file
    expect(file.composition.settings.width).toBe(1920);
    expect(file.composition.settings.height).toBe(1080);
    expect(file.composition.settings.fps).toBe(30);
    expect(file.composition.settings.aspectRatio).toBe("16:9");
  });

  it("is deterministic — same input produces byte-identical output", () => {
    const core = createTimelineCore();
    core.dispatch("human", {
      type: "composition:create",
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
    });
    const file1 = serializeProject(core.getCoreState(), core.getComposition());
    const file2 = serializeProject(core.getCoreState(), core.getComposition());
    expect(formatProjectJson(file1)).toBe(formatProjectJson(file2));
  });
});

describe("formatProjectJson", () => {
  it("produces JSON with 2-space indent and a trailing newline", () => {
    const file: import("../persistence.js").ProjectFile = {
      $schema: "pneuma-craft/project/v1",
      title: "Test",
      composition: {
        settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
        tracks: [],
        transitions: [],
      },
      assets: [],
      provenance: [],
    };
    const text = formatProjectJson(file);
    // 2-space indent
    expect(text).toContain('  "title": "Test"');
    // Trailing newline
    expect(text.endsWith("\n")).toBe(true);
    // Round-trips through JSON.parse
    const parsed = JSON.parse(text);
    expect(parsed.title).toBe("Test");
  });
});
```

- [ ] **Step 1.2: Run the tests to confirm they fail**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/__tests__/persistence.test.ts 2>&1 | tail -30
```

Expected: the existing 8 persistence tests still pass; the 7 new tests fail with "serializeProject is not a function" or similar.

- [ ] **Step 1.3: Implement `serializeProject` and `formatProjectJson`**

Open `modes/clipcraft/persistence.ts`. After the existing `projectFileToCommands` function, append:

```ts
// ── Serialize: TimelineCore state → ProjectFile ───────────────────────────

import type { PneumaCraftCoreState } from "@pneuma-craft/core";
import type { Composition } from "@pneuma-craft/timeline";

// Default settings used when the core has no composition yet. Matches the
// seed project.json so a fresh load produces a stable, recognizable shape.
const DEFAULT_SETTINGS: ProjectComposition["settings"] = {
  width: 1920,
  height: 1080,
  fps: 30,
  aspectRatio: "16:9",
};

/**
 * Serialize craft state to a ProjectFile. Inverse of projectFileToCommands.
 *
 * Relies on Plan 3a's id stability: every asset/track/clip in the core state
 * carries the on-disk id that was dispatched, so serialization is a direct
 * field rename + array walk. Field order matches projectFileToCommands's
 * dispatch order so a round-trip through parse → hydrate → serialize produces
 * byte-equal output given identical input.
 */
export function serializeProject(
  coreState: PneumaCraftCoreState,
  composition: Composition | null,
): ProjectFile {
  // 1. Settings (fall back to defaults when composition is null)
  const settings: ProjectComposition["settings"] = composition
    ? {
        width: composition.settings.width,
        height: composition.settings.height,
        fps: composition.settings.fps,
        aspectRatio: composition.settings.aspectRatio,
        ...(composition.settings.sampleRate !== undefined
          ? { sampleRate: composition.settings.sampleRate }
          : {}),
      }
    : { ...DEFAULT_SETTINGS };

  // 2. Assets — iterate registry in insertion order (Map preserves it)
  const assets: ProjectAsset[] = [];
  for (const asset of coreState.registry.values()) {
    assets.push({
      id: asset.id,
      type: asset.type,
      uri: asset.uri,
      name: asset.name,
      metadata: asset.metadata as Record<string, number | string | undefined>,
      createdAt: asset.createdAt,
      ...(asset.tags ? { tags: [...asset.tags] } : {}),
      ...(asset.status ? { status: asset.status } : {}),
    });
  }

  // 3. Provenance edges — iterate edges Map
  const provenance: ProjectProvenanceEdge[] = [];
  for (const edge of coreState.provenance.edges.values()) {
    provenance.push({
      toAssetId: edge.toAssetId,
      fromAssetId: edge.fromAssetId,
      operation: {
        type: edge.operation.type,
        actor: edge.operation.actor,
        timestamp: edge.operation.timestamp,
        ...(edge.operation.agentId !== undefined
          ? { agentId: edge.operation.agentId }
          : {}),
        ...(edge.operation.label !== undefined
          ? { label: edge.operation.label }
          : {}),
        ...(edge.operation.params !== undefined
          ? { params: { ...edge.operation.params } }
          : {}),
      },
    });
  }

  // 4. Tracks + clips
  const tracks: ProjectTrack[] = composition
    ? composition.tracks.map((track) => ({
        id: track.id,
        type: track.type,
        name: track.name,
        muted: track.muted,
        volume: track.volume,
        locked: track.locked,
        visible: track.visible,
        clips: track.clips.map((clip) => ({
          id: clip.id,
          assetId: clip.assetId,
          startTime: clip.startTime,
          duration: clip.duration,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          ...(clip.text !== undefined ? { text: clip.text } : {}),
          ...(clip.volume !== undefined ? { volume: clip.volume } : {}),
          ...(clip.fadeIn !== undefined ? { fadeIn: clip.fadeIn } : {}),
          ...(clip.fadeOut !== undefined ? { fadeOut: clip.fadeOut } : {}),
        })),
      }))
    : [];

  // 5. Transitions — pass through (currently unused)
  const transitions: ProjectTransition[] = composition
    ? [...composition.transitions]
    : [];

  return {
    $schema: "pneuma-craft/project/v1",
    title: "Untitled",
    composition: { settings, tracks, transitions },
    assets,
    provenance,
  };
}

/**
 * Format a ProjectFile as JSON for disk. 2-space indent + trailing newline.
 * Kept separate from serializeProject so tests can assert structure without
 * being brittle about whitespace.
 */
export function formatProjectJson(file: ProjectFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}
```

Key details:
- **Conditional spread for optional fields** (`...(x ? { x } : {})`) means serialize produces the same JSON shape as a hand-written file — absent fields stay absent rather than turning into `"foo": undefined`.
- **Map iteration is insertion-ordered** in JavaScript, so assets and edges appear in dispatch order, which (after Plan 3a's id stability) matches the source file's order.
- **`title` is hardcoded to "Untitled"** for now. Plan 3b doesn't yet preserve the title through hydration (it's not in craft state). Plan 3c or later can add a mode-level title field if needed.
- **Settings fall back to defaults when composition is null** so a freshly-initialized store still produces a valid ProjectFile that can be written back and re-hydrated.

- [ ] **Step 1.4: Run the tests to confirm pass**

```bash
bun test modes/clipcraft/__tests__/persistence.test.ts 2>&1 | tail -30
```

Expected: 15 tests pass (8 existing + 7 new). If any assertion on field presence fails, check the conditional-spread logic.

- [ ] **Step 1.5: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: no errors.

- [ ] **Step 1.6: Commit**

```bash
git add modes/clipcraft/persistence.ts modes/clipcraft/__tests__/persistence.test.ts && git commit -m "feat(clipcraft): serializeProject + formatProjectJson"
```

---

## Task 2: Round-trip integration test

**Files:**
- Modify: `modes/clipcraft/__tests__/hydration-integration.test.ts`

- [ ] **Step 2.1: Add the round-trip test**

Open `modes/clipcraft/__tests__/hydration-integration.test.ts`. Inside the existing `describe("full-stack hydration", ...)` block, append:

```ts
it("round-trips: hydrate → serialize → hydrate → assert same state", () => {
  const core1 = hydrate(completeFile);
  const serialized = serializeProject(
    core1.getCoreState(),
    core1.getComposition(),
  );

  // Serialize → format → parse — simulates a full disk roundtrip
  const text = formatProjectJson(serialized);
  const parsed = parseProjectFile(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  // Hydrate the parsed output into a fresh TimelineCore
  const core2 = hydrate(parsed.value);

  // Assert the second core has the same observable state as the first
  const s1 = core1.getCoreState();
  const s2 = core2.getCoreState();

  // Assets: same size and same ids
  expect(s2.registry.size).toBe(s1.registry.size);
  for (const [id, asset] of s1.registry.entries()) {
    const a2 = s2.registry.get(id);
    expect(a2).toBeDefined();
    expect(a2!.type).toBe(asset.type);
    expect(a2!.uri).toBe(asset.uri);
    expect(a2!.name).toBe(asset.name);
    expect(a2!.status).toBe(asset.status);
    expect(a2!.tags).toEqual(asset.tags);
    expect(a2!.metadata).toEqual(asset.metadata);
  }

  // Provenance: same edges
  expect(s2.provenance.edges.size).toBe(s1.provenance.edges.size);
  // Collect edges from both sides, keyed by toAssetId, and compare operations
  const edges1 = Array.from(s1.provenance.edges.values());
  const edges2 = Array.from(s2.provenance.edges.values());
  expect(edges2).toHaveLength(edges1.length);
  // Order-independent compare by toAssetId
  const byTo = (m: Map<string, typeof edges1[0]>, e: typeof edges1[0]) => {
    m.set(e.toAssetId, e);
    return m;
  };
  const map1 = edges1.reduce(byTo, new Map());
  const map2 = edges2.reduce(byTo, new Map());
  for (const [toAssetId, e1] of map1.entries()) {
    const e2 = map2.get(toAssetId);
    expect(e2).toBeDefined();
    expect(e2!.fromAssetId).toBe(e1.fromAssetId);
    expect(e2!.operation.type).toBe(e1.operation.type);
    expect(e2!.operation.params).toEqual(e1.operation.params);
  }

  // Composition: same tracks with same clip ids
  const c1 = core1.getComposition();
  const c2 = core2.getComposition();
  expect(c2).not.toBeNull();
  expect(c2!.settings).toEqual(c1!.settings);
  expect(c2!.tracks).toHaveLength(c1!.tracks.length);
  for (let i = 0; i < c1!.tracks.length; i++) {
    const t1 = c1!.tracks[i];
    const t2 = c2!.tracks[i];
    expect(t2.id).toBe(t1.id);
    expect(t2.clips).toHaveLength(t1.clips.length);
    for (let j = 0; j < t1.clips.length; j++) {
      expect(t2.clips[j].id).toBe(t1.clips[j].id);
      expect(t2.clips[j].assetId).toBe(t1.clips[j].assetId);
      expect(t2.clips[j].startTime).toBe(t1.clips[j].startTime);
      expect(t2.clips[j].duration).toBe(t1.clips[j].duration);
    }
  }
});

it("round-trip is stable after a second pass", () => {
  // Invariant: serialize(hydrate(serialize(hydrate(x)))) === serialize(hydrate(x))
  // Catches any serialization pass that's non-deterministic or accumulates
  // small differences (whitespace, field order, default values).
  const core1 = hydrate(completeFile);
  const text1 = formatProjectJson(
    serializeProject(core1.getCoreState(), core1.getComposition()),
  );

  const parsed = parseProjectFile(text1);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const core2 = hydrate(parsed.value);
  const text2 = formatProjectJson(
    serializeProject(core2.getCoreState(), core2.getComposition()),
  );

  expect(text2).toBe(text1);
});
```

Add the two imports at the top of the file (if not already present):

```ts
import { serializeProject, formatProjectJson } from "../persistence.js";
```

- [ ] **Step 2.2: Run the tests**

```bash
bun test modes/clipcraft/__tests__/hydration-integration.test.ts 2>&1 | tail -30
```

Expected: 5 tests pass (3 from Plan 3a + 2 new).

If the stability test fails with text1 ≠ text2, the most likely cause is `serializeProject` producing non-deterministic output — check for Object.keys-style iteration over unordered maps, or optional fields being included/excluded inconsistently.

If the round-trip state comparison fails, check:
- `completeFile`'s `operation.timestamp` survives through the serialization loop (it's in `edge.operation.timestamp`, not stripped)
- `createdAt` is preserved via the asset spread in projectFileToCommands (it's set from envelope timestamp, not from the disk value — so the round-trip `createdAt` may differ from `completeFile`'s literal `1712934000000`, but should be equal between s1 and s2)

- [ ] **Step 2.3: Full test suite regression**

```bash
bun test 2>&1 | tail -15
```

Expected: 573 pass (previous 571 + 2 new).

- [ ] **Step 2.4: Commit**

```bash
git add modes/clipcraft/__tests__/hydration-integration.test.ts && git commit -m "test(clipcraft): round-trip hydration → serialization fidelity"
```

---

## Task 3: Client-side `writeProjectFile`

**Files:**
- Create: `modes/clipcraft/api-client.ts`
- Create: `modes/clipcraft/__tests__/api-client.test.ts`

- [ ] **Step 3.1: Write the failing unit tests**

Create `modes/clipcraft/__tests__/api-client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeProjectFile } from "../api-client.js";

const originalFetch = globalThis.fetch;

describe("writeProjectFile", () => {
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: { ok: boolean; status?: number; body?: unknown }) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return {
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 500),
        json: async () => response.body ?? {},
      } as Response;
    }) as typeof fetch;
  }

  it("POSTs to /api/files with path=project.json and the given content", async () => {
    mockFetch({ ok: true, body: { ok: true } });
    await writeProjectFile("{\"hello\": \"world\"}");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/files");
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect(fetchCalls[0].init?.headers).toMatchObject({
      "content-type": "application/json",
    });
    const body = JSON.parse(fetchCalls[0].init?.body as string);
    expect(body).toEqual({
      path: "project.json",
      content: "{\"hello\": \"world\"}",
    });
  });

  it("throws when the server responds with a non-OK status", async () => {
    mockFetch({ ok: false, status: 403, body: { error: "Forbidden" } });
    await expect(writeProjectFile("x")).rejects.toThrow(/403/);
  });

  it("throws when the server responds 500", async () => {
    mockFetch({ ok: false, status: 500, body: { error: "Failed to write file" } });
    await expect(writeProjectFile("x")).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 3.2: Run the tests to confirm they fail (module missing)**

```bash
bun test modes/clipcraft/__tests__/api-client.test.ts 2>&1 | tail -15
```

Expected: module-not-found error because `../api-client.js` doesn't exist yet.

- [ ] **Step 3.3: Create `api-client.ts`**

Create `modes/clipcraft/api-client.ts`:

```ts
/**
 * Clipcraft mode → pneuma server HTTP client.
 *
 * Currently exposes one function: writeProjectFile. Persistence is the only
 * direction that goes through an explicit API call — reads come via the
 * viewer's `files` prop from the existing chokidar → WS broadcast pipeline.
 *
 * The endpoint is the pneuma-generic `POST /api/files`, not a clipcraft-
 * specific route. Reusing the generic endpoint keeps the blast radius small
 * and means clipcraft doesn't need its own server-side code.
 */

/**
 * Write the ProjectFile content to the workspace's `project.json`.
 *
 * The returned promise resolves on a 2xx response, rejects on anything else
 * (including network failures). Callers are responsible for:
 *   - updating their in-memory "last applied content" ref BEFORE calling
 *     this function, so loop protection is active while the write is in
 *     flight and when the chokidar echo arrives
 *   - surfacing errors to the user (this module only logs to the console)
 */
export async function writeProjectFile(content: string): Promise<void> {
  const res = await fetch("/api/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "project.json", content }),
  });
  if (!res.ok) {
    let errorDetail = "";
    try {
      const body = await res.json();
      errorDetail =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : JSON.stringify(body);
    } catch {
      // non-JSON error body — ignore
    }
    throw new Error(
      `writeProjectFile failed: ${res.status}${errorDetail ? ` ${errorDetail}` : ""}`,
    );
  }
}
```

- [ ] **Step 3.4: Run the tests to confirm they pass**

```bash
bun test modes/clipcraft/__tests__/api-client.test.ts 2>&1 | tail -20
```

Expected: 3 tests pass.

- [ ] **Step 3.5: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: no errors.

- [ ] **Step 3.6: Commit**

```bash
git add modes/clipcraft/api-client.ts modes/clipcraft/__tests__/api-client.test.ts && git commit -m "feat(clipcraft): writeProjectFile client for POST /api/files"
```

---

## Task 4: `useProjectSync` hook (replaces `useProjectHydration`)

**Files:**
- Create: `modes/clipcraft/viewer/hooks/useProjectSync.ts`
- Delete: `modes/clipcraft/viewer/hooks/useProjectHydration.ts`

- [ ] **Step 4.1: Create the new hook**

Create `modes/clipcraft/viewer/hooks/useProjectSync.ts`:

```ts
import { useEffect, type MutableRefObject } from "react";
import type { ViewerFileContent } from "../../../../core/types/viewer-contract.js";
import {
  usePneumaCraftStore,
  useEventLog,
} from "@pneuma-craft/react";
import {
  parseProjectFile,
  projectFileToCommands,
  serializeProject,
  formatProjectJson,
} from "../../persistence.js";
import { writeProjectFile } from "../../api-client.js";

const AUTOSAVE_DELAY_MS = 500;

export interface UseProjectSyncOptions {
  /**
   * Parent-owned ref tracking the content we've committed to (either by
   * hydrating from disk or by writing to disk). The hook reads from it to
   * skip echoes and writes to it after each successful write.
   *
   * Must be a stable ref (declared via useRef at the parent component level).
   */
  lastAppliedRef: MutableRefObject<string | null>;
  /**
   * Called after a successful local write with the content we just wrote.
   * Parent uses this to avoid bumping the providerKey when its own write
   * echoes back through the file watcher.
   *
   * Must be a stable reference (useCallback at the parent level).
   */
  onLocalWrite: (content: string) => void;
}

/**
 * Bidirectional project.json sync.
 *
 * Hydration direction:
 *   disk → files prop → hook → dispatch hydration commands to craft store
 *   Skipped when incoming content equals lastAppliedRef.current — that
 *   either means we just wrote it ourselves, or we already hydrated this
 *   exact content (strict-mode double-invoke protection).
 *
 * Persistence direction:
 *   craft events → debounced serialize → POST /api/files
 *   Skipped when the serialized content equals lastAppliedRef.current —
 *   prevents no-op writes when state changes but the serialization is the
 *   same (e.g. a selection:set that produces no on-disk delta).
 *
 * TODO(plan-3c): replace the "full re-dispatch on external edit" path with
 * diff-and-dispatch so the store (and any active PlaybackEngine) survives
 * cross-session edits. Also remove the lastAppliedRef band-aid once the diff
 * path is reliable.
 */
export function useProjectSync(
  files: ViewerFileContent[],
  options: UseProjectSyncOptions,
): { error: string | null } {
  const { lastAppliedRef, onLocalWrite } = options;
  const dispatch = usePneumaCraftStore((s) => s.dispatch);
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const composition = usePneumaCraftStore((s) => s.composition);
  const eventCount = useEventLog().length;

  // Locate project.json
  const projectFile = files.find(
    (f) => f.path === "project.json" || f.path.endsWith("/project.json"),
  );
  const diskContent = projectFile?.content ?? null;

  // ── Hydration: disk → memory ─────────────────────────────────────────
  useEffect(() => {
    if (diskContent === null) return;
    if (diskContent === lastAppliedRef.current) return;

    // Claim this content as "applied" BEFORE dispatching so any echo that
    // arrives during the dispatch loop is correctly skipped.
    lastAppliedRef.current = diskContent;

    const parsed = parseProjectFile(diskContent);
    if (!parsed.ok) return;

    for (const env of projectFileToCommands(parsed.value)) {
      try {
        dispatch(env.actor, env.command);
      } catch (e) {
        // Expected for re-dispatch scenarios (strict-mode, debounced echo).
        // eslint-disable-next-line no-console
        console.warn(
          "[clipcraft] hydration command rejected",
          env.command.type,
          (e as Error).message,
        );
      }
    }
  }, [diskContent, dispatch, lastAppliedRef]);

  // ── Persistence: memory → disk (debounced) ──────────────────────────
  useEffect(() => {
    const timer = setTimeout(async () => {
      const file = serializeProject(coreState, composition);
      const content = formatProjectJson(file);
      if (content === lastAppliedRef.current) return;

      // Claim the new content BEFORE the fetch so the echo is skipped.
      // If the write fails, we still leave the ref updated — the in-memory
      // state is still the truth, and a subsequent successful write (or
      // external edit) will reconcile. Errors are logged so a developer
      // can spot them in the console.
      const previousApplied = lastAppliedRef.current;
      lastAppliedRef.current = content;

      try {
        await writeProjectFile(content);
        onLocalWrite(content);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[clipcraft] autosave failed", e);
        // Roll back the claim so the next persistence attempt actually tries
        // again instead of thinking the (failed) write already happened.
        lastAppliedRef.current = previousApplied;
      }
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [eventCount, coreState, composition, lastAppliedRef, onLocalWrite]);

  // Return value: parse errors only (command dispatch errors are logged).
  if (diskContent === null) {
    return { error: "project.json not found in workspace" };
  }
  const parsed = parseProjectFile(diskContent);
  return { error: parsed.ok ? null : parsed.error };
}
```

Notes on the shape:
- **`lastAppliedRef` is parent-owned.** The parent (`ClipCraftPreview`) owns the ref so it can also use it for the `providerKey` bump logic. Both places reading the same ref keeps the invariant consistent.
- **`eventCount` dep** triggers the persistence effect once per dispatch. The effect captures `coreState` and `composition` by closure, and the 500ms debounce means only the last rapid-fire dispatch actually writes.
- **Rollback on write failure** — we optimistically claim the new content in the ref before the fetch, then roll back if the write failed. This keeps the "next attempt will try again" invariant.
- **The TODO(plan-3c) comment** explicitly flags what Plan 3c will fix.

- [ ] **Step 4.2: Delete the old hook**

```bash
git rm modes/clipcraft/viewer/hooks/useProjectHydration.ts
```

- [ ] **Step 4.3: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: **ONE error** about `ClipCraftPreview.tsx` still importing the deleted `useProjectHydration` module. That's expected — Task 5 fixes it. Don't try to fix it now.

If there are additional errors in the hook file itself (missing imports, type mismatches), fix them before moving on.

- [ ] **Step 4.4: Commit Task 4**

```bash
git add modes/clipcraft/viewer/hooks/ && git commit -m "feat(clipcraft): useProjectSync hook replacing useProjectHydration"
```

The commit intentionally leaves `ClipCraftPreview.tsx` broken — Task 5 fixes it in the next commit. Don't amend.

---

## Task 5: `ClipCraftPreview` refactor (state-based providerKey + onLocalWrite)

**Files:**
- Modify: `modes/clipcraft/viewer/ClipCraftPreview.tsx`

- [ ] **Step 5.1: Replace `ClipCraftPreview.tsx`**

Replace the entire contents of `modes/clipcraft/viewer/ClipCraftPreview.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";
import { useProjectSync } from "./hooks/useProjectSync.js";
import { StateDump } from "./StateDump.js";

/**
 * Pure helper: given the current disk content and the last content the
 * viewer has committed to, decide whether an external edit was detected.
 *
 * Exported for unit testing — the real component just calls this inside
 * a useEffect.
 */
export function isExternalEdit(
  diskContent: string | null,
  lastApplied: string | null,
): boolean {
  if (diskContent === null) return false;
  return diskContent !== lastApplied;
}

const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ files }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);

  // Parent-owned "last applied content" — the single source of truth for
  // loop protection. Both the providerKey bump logic (below) and the
  // useProjectSync hook (inside the provider) read and write it.
  const lastAppliedRef = useRef<string | null>(null);

  // providerKey is bumped ONLY when an external edit is detected. Our own
  // writes update lastAppliedRef.current before they hit the wire, so the
  // echo arrives with diskContent === lastAppliedRef.current and doesn't
  // trigger a bump. Net effect: own writes don't remount, external edits do.
  const [providerKey, setProviderKey] = useState(0);

  const projectFile = files.find(
    (f) => f.path === "project.json" || f.path.endsWith("/project.json"),
  );
  const diskContent = projectFile?.content ?? null;

  useEffect(() => {
    if (isExternalEdit(diskContent, lastAppliedRef.current)) {
      setProviderKey((k) => k + 1);
    }
  }, [diskContent]);

  // onLocalWrite is called by useProjectSync after a successful write. It
  // doesn't need to do anything here — lastAppliedRef was already updated
  // inside the hook. Callback kept for future expansion (status banner,
  // dirty indicator, etc.) and because hooks like to have stable callbacks
  // even when empty.
  const onLocalWrite = useCallback((_content: string) => {
    // no-op — lastAppliedRef is updated inside useProjectSync
  }, []);

  return (
    <PneumaCraftProvider key={providerKey} assetResolver={assetResolver}>
      <SyncedBody
        files={files}
        lastAppliedRef={lastAppliedRef}
        onLocalWrite={onLocalWrite}
      />
    </PneumaCraftProvider>
  );
};

function SyncedBody({
  files,
  lastAppliedRef,
  onLocalWrite,
}: {
  files: ViewerPreviewProps["files"];
  lastAppliedRef: React.MutableRefObject<string | null>;
  onLocalWrite: (content: string) => void;
}) {
  const { error } = useProjectSync(files, { lastAppliedRef, onLocalWrite });
  return <StateDump hydrationError={error} />;
}

export default ClipCraftPreview;
```

Key change from Plan 3a: the `providerKey` is now a counter (`useState(0)`), not the content itself. It's only bumped when `isExternalEdit` returns true. Our own writes update `lastAppliedRef.current` inside `useProjectSync`, so the effect's next run sees `diskContent === lastAppliedRef.current` and skips the bump.

Note: `onLocalWrite` is an intentional no-op right now. `useProjectSync` already updates `lastAppliedRef.current` synchronously before the fetch. Leaving the callback in place gives Plan 4+ a hook point for status UI (e.g. "Saved" toast) without a refactor.

- [ ] **Step 5.2: Add a unit test for the pure helper**

Open `modes/clipcraft/__tests__/persistence.test.ts` (or create a new test file if you prefer — `__tests__/clipcraft-preview.test.ts` would work). Append:

```ts
import { isExternalEdit } from "../viewer/ClipCraftPreview.js";

describe("isExternalEdit", () => {
  it("returns false when diskContent is null", () => {
    expect(isExternalEdit(null, null)).toBe(false);
    expect(isExternalEdit(null, "anything")).toBe(false);
  });

  it("returns true when diskContent is new and lastApplied is null", () => {
    expect(isExternalEdit("x", null)).toBe(true);
  });

  it("returns false when diskContent matches lastApplied", () => {
    expect(isExternalEdit("x", "x")).toBe(false);
  });

  it("returns true when diskContent differs from lastApplied", () => {
    expect(isExternalEdit("x", "y")).toBe(true);
  });
});
```

If you add these to `persistence.test.ts`, put them in their own describe block near the bottom so they don't mingle with the serializeProject tests.

- [ ] **Step 5.3: Run the tests**

```bash
bun test 2>&1 | tail -15
```

Expected: all tests pass. `isExternalEdit` tests should add 4 to the count.

- [ ] **Step 5.4: Typecheck**

```bash
bun run tsc --noEmit 2>&1 | grep "modes/clipcraft[^-]" | head -20
```

Expected: no errors (the Task 4 hole is now fixed).

- [ ] **Step 5.5: Commit**

```bash
git add modes/clipcraft/viewer/ClipCraftPreview.tsx modes/clipcraft/__tests__/persistence.test.ts && git commit -m "refactor(clipcraft): state-based providerKey + onLocalWrite wiring"
```

---

## Task 6: E2E regression check

**Working directory:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft`

**Files:** none modified unless a fixup is required.

This is a sanity re-run of Plan 3a's Task 7 E2E with the new `useProjectSync` hook in place. The goal is to confirm that switching from `useProjectHydration` to `useProjectSync` hasn't broken the "agent edits file → badge flips" path, and that the new `providerKey = state counter` strategy correctly detects external edits.

**There is no Plan 3b-specific behavior to verify E2E.** The write path has no user trigger yet (Plan 4 will add one). All write-path correctness is covered by Task 1 + Task 2 + Task 3's unit and integration tests. Task 6 is purely regression.

### Steps

- [ ] **Step 6.1: Launch in a fresh workspace**

```bash
rm -rf /tmp/clipcraft-plan3b-smoke
```

Launch via background Bash:

```bash
bun run dev clipcraft --workspace /tmp/clipcraft-plan3b-smoke --no-open --no-prompt --port 18103
```

- [ ] **Step 6.2: Screenshot via chrome-devtools-mcp**

Load the tools via ToolSearch if needed. Open the Vite URL, take a screenshot, list console messages.

Expected (same as Plan 3a Task 7):
- Composition: 1920×1080 @ 30fps
- Assets (1): yellow PENDING badge
- Event Log: 3 events (composition:created, asset:registered, provenance:root-set)
- Console: no red errors, no `[clipcraft] hydration command rejected` warnings

- [ ] **Step 6.3: External-edit simulation**

```bash
cat > /tmp/clipcraft-plan3b-smoke/project.json <<'EOF'
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

Wait ~1 second and re-screenshot. Expected:
- Badge flips from yellow PENDING to green READY
- Asset line shows the real uri
- Still `Assets (1)`, NOT duplicated
- Event log still shows 3 events (fresh provider instance after remount)

If duplication is visible, the providerKey bump logic is wrong — check `isExternalEdit` and the effect in `ClipCraftPreview.tsx`.

- [ ] **Step 6.4: Brief observation — check for autosave chatter**

After the initial hydration, the persistence effect should run a single debounced pass and skip because `formatProjectJson(serializeProject(...))` equals `lastAppliedRef.current`. No `POST /api/files` should actually hit the server.

Check the server log output — search for `POST /api/files`. Expected: ZERO entries. If you see one or more, the hydration path isn't leaving the ref in a state the persistence path agrees with (usually a formatting mismatch: the disk file uses different whitespace than `formatProjectJson` produces).

If there IS chatter:
- Compare the bytes of `/tmp/clipcraft-plan3b-smoke/project.json` (the seed) with `formatProjectJson(serializeProject(parseProjectFile(seed)))`. The difference is the source of the chatter.
- Likely culprits: trailing newline, indent size, quote style, field order.
- Fix by adjusting either the seed file or `serializeProject` / `formatProjectJson` until they match.

If there's no chatter, the loop-protection invariant works correctly in practice.

- [ ] **Step 6.5: Kill the dev server**

- [ ] **Step 6.6: Fixup commit (only if needed)**

```bash
git add <files> && git commit -m "fix(clipcraft): plan 3b smoke-test fixups"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Serialize craft state → ProjectFile (Task 1)
- [x] Deterministic formatted JSON output (Task 1 + formatProjectJson)
- [x] Round-trip fidelity (Task 2 integration test)
- [x] Write to disk via existing `POST /api/files` endpoint (Task 3)
- [x] Error handling on write failures (Task 3 tests)
- [x] Debounced persistence hook (Task 4)
- [x] Bidirectional sync with loop protection (Task 4 + Task 5)
- [x] `providerKey` decoupled from content (Task 5)
- [x] `isExternalEdit` pure helper tested (Task 5)
- [x] E2E regression check (Task 6)

**Placeholder scan:** one legitimate `TODO(plan-3c)` comment in `useProjectSync.ts` flagging the "full re-dispatch on external edit" limitation. That's a forward-reference, not a placeholder.

**Type consistency:**
- `serializeProject` returns `ProjectFile`, `formatProjectJson` takes `ProjectFile`, round-trips match.
- `useProjectSync` signature matches what `ClipCraftPreview` passes.
- `isExternalEdit` is a pure helper, tested in isolation.

**Known risks:**

1. **Serialization format drift.** If `serializeProject(parseProjectFile(seed))` doesn't produce byte-identical output to the seed, the first persistence pass will write the normalized version back to disk. Not a correctness bug but causes a spurious write on startup. Task 6 Step 6.4 explicitly checks for this and provides remediation guidance.

2. **`lastAppliedRef` is lost on provider remount.** When an external edit fires, the provider remounts and `useProjectSync`'s internal refs reset. But `lastAppliedRef` is OWNED BY THE PARENT, not by the hook — it survives the remount. The hook's hydration effect reads it on mount and sees the latest value. Verified by structure, not by test.

3. **Rollback on write failure is optimistic.** If the POST fails, we roll back `lastAppliedRef.current` to the previous value. That means the NEXT debounced write will retry with the current state, not the failed state. Good. But if the failure is persistent (server dead), we'll retry on every state change. Acceptable for Plan 3b — Plan 3c can add backoff.

4. **No test of the loop-protection invariant under real chokidar echoes.** We verify the logic via unit tests (`isExternalEdit`) and an E2E smoke test (Task 6). A full integration test with a real file watcher would need browser/React-testing-library infrastructure that we don't currently have. Acceptable given the pure-function coverage is strong.

**Cross-repo hygiene:** no cross-repo work. Everything is in the pneuma-skills worktree. No craft rebuilds, no symlinks to refresh.
