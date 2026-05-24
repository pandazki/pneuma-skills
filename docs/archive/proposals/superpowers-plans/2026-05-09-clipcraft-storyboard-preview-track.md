# ClipCraft Storyboard Preview Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire ClipCraft to consume the upstream `PreviewFrame` capability (`@pneuma-craft/timeline ≥ 0.4.0`, `@pneuma-craft/video ≥ 0.5.0`) so agents can stage progressive-fidelity storyboards on the timeline before expensive video generation.

**Architecture:** Pure downstream wiring of upstream's already-landed PreviewFrame contract. Persistence migration (additive `previewFrames` field on tracks) → PlaybackEngine option (default `true`) → timeline-row preview thumbnail strip → click handler that selects the asset + seeks the playhead → locator card with `previewFrameId` data → draft export via existing `useExportVideo` with `includePreviewFrames: true` → lightweight dive (preview frame's asset reuses existing dive entry) → skill workflow doc + sketch script flag + version bump.

**Tech Stack:** TypeScript strict, Bun, React 19, Vite 7, `@pneuma-craft/timeline 0.4.0+` (linked locally), `@pneuma-craft/video 0.5.0+` (linked locally), Tailwind CSS 4. Existing ClipCraft viewer + skill conventions.

**Spec:** `docs/superpowers/specs/2026-05-09-clipcraft-storyboard-preview-track-design.md`. Read this before starting any phase.

**Upstream contract:** `~/Codes/pneuma-craft/docs/recipes/preview-frames.md` (PreviewFrame schema, four commands, `buildSetPreviewFrameCommand` helper, `resolveFrame` extension, PlaybackEngine/ExportEngine `includePreviewFrames`). Read this before starting any task that touches craft commands or rendering.

**Key spec deviations to honor in this plan:**

1. **Export is browser-side, not via a server route.** Spec's "backend route flag" is incorrect — `modes/clipcraft/viewer/export/useExportVideo.ts` calls `createExportEngine` directly. We pass `includePreviewFrames` through that hook's options.
2. **No new craft `Selection` variant.** Craft's `Selection.type` is fixed at `'asset' | 'clip' | 'track' | 'time-range' | 'none'`. We reuse `'asset'` selection (point at the preview frame's referenced image asset) and surface preview-frame context via `extractContext` (which finds the asset's hosting preview frame in the composition). Locator cards use `{ previewFrameId }` for navigation but resolve internally to `assetId + time` for the actual selection/seek.

**Cross-cutting concerns (every phase):**

- **Front-end interaction logic:** never leave a half-wired feature exposed in UI. If a button appears on the toolbar, it must work end-to-end. If a click handler is added, it must give visible feedback. Verify via browser smoke after each interaction-touching task.
- **Skill ↔ code synchronization:** when a phase ships a new agent-facing capability (a new command, locator-card data shape, viewer toolbar button, asset-metadata convention, etc.), the **same commit** updates `SKILL.md` / `mdScene` / `references/storyboard-workflow.md` accordingly. Don't let the agent's mental model lag behind the code.

**Local link state at plan start:** `~/Codes/pneuma-craft/packages/{core,timeline,video,react}` are `bun link`ed into this worktree's `node_modules`. `bun test` baseline is 959 pass / 0 fail. Upstream `dist/` already contains `PreviewFrame`, `ResolvedPreviewFrame`, the four commands, `includePreviewFrames` option, and `buildSetPreviewFrameCommand`. **Do not re-link.** If upstream source changes mid-plan, run `bun run build` in `~/Codes/pneuma-craft` and the link's `dist/` updates automatically.

---

## File structure

**Files created in this plan:**

- `modes/clipcraft/skill/references/storyboard-workflow.md` — agent-facing playbook
- `modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx` — timeline-row preview thumbnail rendering
- `modes/clipcraft/viewer/timeline/PreviewFrameStrip.test.ts` — pure helper tests for uncovered-interval computation
- `modes/clipcraft/__tests__/preview-frames-persistence.test.ts` — additional persistence round-trip tests for preview frames

**Files modified in this plan:**

- `modes/clipcraft/persistence.ts` — schema, parser, hydrator, serializer
- `modes/clipcraft/__tests__/persistence.test.ts` — extend coverage
- `modes/clipcraft/__tests__/hydration-integration.test.ts` — extend round-trip
- `modes/clipcraft/manifest.ts` — `viewerApi.commands` adds `export-draft`, version bump, `mdScene` augmentation
- `modes/clipcraft/pneuma-mode.ts` — `extractContext` surfaces preview-frame context for asset selection
- `modes/clipcraft/viewer/ClipCraftPreview.tsx` — declare `includePreviewFrames: true` on engine creation, register `previewFrameId` locator-card data shape, route click feedback for preview frames
- `modes/clipcraft/viewer/timeline/VideoTrack.tsx` — render `PreviewFrameStrip` in uncovered intervals
- `modes/clipcraft/viewer/timeline/Timeline.tsx` — pass preview-frame click handler down (if needed; usually flows through context already)
- `modes/clipcraft/viewer/CommandBar.tsx` — add "Export draft" button next to existing Export
- `modes/clipcraft/viewer/export/useExportVideo.ts` — accept and forward `includePreviewFrames`
- `modes/clipcraft/viewer/dive/DiveCanvas.tsx` — verify preview-frame asset selection opens the existing variant tree
- `modes/clipcraft/skill/SKILL.md` — progressive-fidelity section, locator card example, command table entry, link to storyboard-workflow.md
- `modes/clipcraft/skill/SKILL.md` references list (also in viewer-protocol section if any)
- `modes/_shared/scripts/generate_image.mjs` — add `--style sketch | photo` flag
- `CHANGELOG.md` — entry for `0.8.0`

**Plan structure:** 8 phases. Within a phase, tasks share a feature focus and end with a single commit. Phases are sequential (each depends on the prior). Phase 6 (script) and Phase 7 (skill doc) can be done in parallel with Phase 5 (dive) once Phase 4 lands.

---

## Phase 1 — Persistence + hydration

**Goal:** `project.json` round-trips with `track.previewFrames`. Hydration emits `composition:add-preview-frame` envelopes with stable ids. Old project files without the field default to empty array.

**Files in this phase:**
- Modify: `modes/clipcraft/persistence.ts`
- Modify: `modes/clipcraft/__tests__/persistence.test.ts`
- Modify: `modes/clipcraft/__tests__/hydration-integration.test.ts`
- Create: `modes/clipcraft/__tests__/preview-frames-persistence.test.ts`

### Task 1.1: Extend `PersistedTrack` and add `PersistedPreviewFrame` types

**Files:**
- Modify: `modes/clipcraft/persistence.ts` (locate the `PersistedTrack` interface; add `PersistedPreviewFrame`)

- [ ] **Step 1: Add the new types**

In `modes/clipcraft/persistence.ts`, immediately above the existing `PersistedTrack` interface, add:

```typescript
export interface PersistedPreviewFrame {
  readonly id: string;
  readonly trackId: string;
  readonly time: number;
  readonly assetId: string;
}
```

Then extend `PersistedTrack` (locate it via grep) with:

```typescript
readonly previewFrames?: PersistedPreviewFrame[];
```

The `previewFrames` field is **optional in JSON** so old project files without it parse cleanly. Place it right after `clips` and before `muted` to mirror upstream's `Track` field ordering.

- [ ] **Step 2: Verify typecheck**

Run: `bun run tsc --noEmit`
Expected: PASS (no new errors).

### Task 1.2: Extend `parseProjectFile` to read previewFrames

**Files:**
- Modify: `modes/clipcraft/persistence.ts` (find `parseProjectFile` / its track-loop)

- [ ] **Step 1: Write failing test**

In `modes/clipcraft/__tests__/persistence.test.ts`, add a new test case:

```typescript
test("parseProjectFile accepts a track with previewFrames", () => {
  const json = JSON.stringify({
    $schema: "pneuma-craft/project/v1",
    title: "test",
    composition: {
      settings: { width: 1280, height: 720, fps: 30, aspectRatio: "16:9" },
      tracks: [
        {
          id: "track-1",
          type: "video",
          name: "Plan",
          clips: [],
          previewFrames: [
            { id: "pf-1", trackId: "track-1", time: 0, assetId: "asset-1" },
            { id: "pf-2", trackId: "track-1", time: 4, assetId: "asset-2" },
          ],
          muted: false,
          volume: 1,
          locked: false,
          visible: true,
        },
      ],
      transitions: [],
    },
    assets: [
      { id: "asset-1", type: "image", uri: "/sketches/01.png", name: "sketch 01", metadata: {}, tags: [], status: "ready", createdAt: 1700000000000 },
      { id: "asset-2", type: "image", uri: "/sketches/02.png", name: "sketch 02", metadata: {}, tags: [], status: "ready", createdAt: 1700000000000 },
    ],
    provenance: [],
  });

  const result = parseProjectFile(json);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const track = result.value.composition.tracks[0];
  expect(track.previewFrames).toHaveLength(2);
  expect(track.previewFrames?.[0]).toEqual({
    id: "pf-1", trackId: "track-1", time: 0, assetId: "asset-1",
  });
});

test("parseProjectFile defaults previewFrames to undefined when absent (legacy file)", () => {
  const json = JSON.stringify({
    $schema: "pneuma-craft/project/v1",
    title: "legacy",
    composition: {
      settings: { width: 1280, height: 720, fps: 30, aspectRatio: "16:9" },
      tracks: [
        {
          id: "track-1",
          type: "video",
          name: "Main",
          clips: [],
          // No previewFrames field — pre-feature project file.
          muted: false, volume: 1, locked: false, visible: true,
        },
      ],
      transitions: [],
    },
    assets: [],
    provenance: [],
  });

  const result = parseProjectFile(json);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.composition.tracks[0].previewFrames).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test modes/clipcraft/__tests__/persistence.test.ts`
Expected: the new tests fail because the parser strips/rejects unknown fields. The exact failure mode depends on the existing parse implementation; capture the failure message before fixing.

- [ ] **Step 3: Update parser to accept previewFrames**

In `modes/clipcraft/persistence.ts`, find the track-parsing logic inside `parseProjectFile`. For each parsed track, parse the optional `previewFrames` array — each entry must have `id` (string), `trackId` (string), `time` (number ≥ 0), `assetId` (string). On invalid entries, the whole parse fails with a descriptive error (matches existing error-style for clip parsing). On absent field, the parsed track simply omits `previewFrames`.

The exact code shape should mirror how `clips` is parsed in the same function — find that block and parallel it. Pseudocode:

```typescript
const previewFramesRaw = (rawTrack as Record<string, unknown>).previewFrames;
let previewFrames: PersistedPreviewFrame[] | undefined;
if (Array.isArray(previewFramesRaw)) {
  previewFrames = previewFramesRaw.map((pfRaw, i) => {
    if (!isObject(pfRaw)) throw new Error(`previewFrames[${i}] not an object`);
    const id = pfRaw.id;
    const trackId = pfRaw.trackId;
    const time = pfRaw.time;
    const assetId = pfRaw.assetId;
    if (typeof id !== "string") throw new Error(`previewFrames[${i}].id not string`);
    if (typeof trackId !== "string") throw new Error(`previewFrames[${i}].trackId not string`);
    if (typeof time !== "number" || time < 0) throw new Error(`previewFrames[${i}].time invalid`);
    if (typeof assetId !== "string") throw new Error(`previewFrames[${i}].assetId not string`);
    return { id, trackId, time, assetId };
  });
}
// then attach to the parsed track:
return { /* existing fields */, ...(previewFrames !== undefined ? { previewFrames } : {}) };
```

Adapt to the actual parser style — the existing parser may use a different validation idiom (e.g. zod-like custom helpers). Read the file first.

- [ ] **Step 4: Run tests**

Run: `bun test modes/clipcraft/__tests__/persistence.test.ts`
Expected: PASS for both new tests + all existing.

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/persistence.ts modes/clipcraft/__tests__/persistence.test.ts
git commit -m "$(cat <<'EOF'
feat(clipcraft): parse track.previewFrames in project.json

Persistence accepts the new optional previewFrames field on tracks.
Legacy project files (no field) parse unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.3: Hydration emits `composition:add-preview-frame` envelopes

**Files:**
- Modify: `modes/clipcraft/persistence.ts` (find `projectFileToCommands`)
- Modify: `modes/clipcraft/__tests__/hydration-integration.test.ts`

- [ ] **Step 1: Write failing test in hydration-integration**

In `modes/clipcraft/__tests__/hydration-integration.test.ts`, add a test that:

1. Builds a `ProjectFile` (via the existing test helpers for that file) with an image asset and a single previewFrame at `t=4` referencing it
2. Runs `projectFileToCommands(projectFile)` and dispatches each into a fresh `TimelineCore`
3. Asserts the resulting `composition.tracks[0].previewFrames` equals the input shape, with id preserved

Reference existing tests in the file for the helper / setup pattern; mirror the closest one (clip-roundtrip-with-id-preservation is probably nearby).

- [ ] **Step 2: Run test to verify failure**

Run: `bun test modes/clipcraft/__tests__/hydration-integration.test.ts`
Expected: FAIL — `projectFileToCommands` doesn't emit the new command yet, so previewFrames stays empty.

- [ ] **Step 3: Update hydrator**

In `modes/clipcraft/persistence.ts`, find `projectFileToCommands`. The current order is approximately: `asset:register` for each asset → `composition:create` → `composition:add-track` for each track → `composition:add-clip` for each clip. **Append after the clip loop, for each track that has `previewFrames`, emit one envelope per preview frame:**

```typescript
// After all clips for this track are emitted:
if (track.previewFrames) {
  for (const pf of track.previewFrames) {
    envelopes.push({
      // Match the existing envelope shape used for clips —
      // same actor / timestamp / commandId pattern.
      command: {
        type: "composition:add-preview-frame",
        trackId: pf.trackId,
        time: pf.time,
        assetId: pf.assetId,
        id: pf.id,
      },
      // include createdAt / actor / commandId fields per existing pattern
    });
  }
}
```

Read the existing clip-emit block first; copy its exact envelope construction shape so timestamps and actor flow identically. The only change is `command.type` and field names.

- [ ] **Step 4: Run hydration test**

Run: `bun test modes/clipcraft/__tests__/hydration-integration.test.ts`
Expected: PASS.

### Task 1.4: Round-trip serializer

**Files:**
- Modify: `modes/clipcraft/persistence.ts` (find `serializeProject`)
- Modify: `modes/clipcraft/__tests__/hydration-integration.test.ts` (extend the round-trip test)

- [ ] **Step 1: Write failing round-trip test**

Extend the test added in Task 1.3 (or add a new one) that:
1. Builds the `ProjectFile` with previewFrames
2. Runs hydration
3. Calls `serializeProject(coreState, composition, title)` to get a `ProjectFile` back
4. Asserts the serialized track.previewFrames equals the original (id, time, assetId, trackId all preserved, sorted ascending)
5. Then `formatProjectJson(serialized)` should be byte-equal to `formatProjectJson(originalProjectFile)` — the standing round-trip invariant

- [ ] **Step 2: Run test to verify failure**

Run: `bun test modes/clipcraft/__tests__/hydration-integration.test.ts`
Expected: FAIL — `serializeProject` doesn't read previewFrames yet, so the output's tracks have no previewFrames field, breaking byte-equality.

- [ ] **Step 3: Update serializer**

In `modes/clipcraft/persistence.ts`, find `serializeProject`. For each track being written, after the `clips` array is built, also build the `previewFrames` array from `track.previewFrames` (which lives on the craft-state Track now). If the track has no previewFrames or an empty array, **emit the field as an empty array `[]` rather than omitting it**, to keep round-trip byte-equality with project files that explicitly listed an empty array. (Alternatively, if your input test file omits the field, handle the asymmetry: serialize as `[]` only when the source had it.)

Choose the consistent shape: **always emit `previewFrames: []` on tracks** in serializer output, even when empty. Update the parse-then-serialize round-trip test inputs to also explicitly include the field, so the byte-equal invariant matches your serializer behavior.

```typescript
// inside the track-mapping inside serializeProject:
const persistedPreviewFrames: PersistedPreviewFrame[] = (track.previewFrames ?? []).map(pf => ({
  id: pf.id,
  trackId: pf.trackId,
  time: pf.time,
  assetId: pf.assetId,
}));

return {
  // existing fields
  clips: persistedClips,
  previewFrames: persistedPreviewFrames,
  // remaining fields
};
```

- [ ] **Step 4: Run round-trip test**

Run: `bun test modes/clipcraft/__tests__/hydration-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: 959+ pass, 0 fail (the new tests should add to the pass count, not break anything).

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/persistence.ts modes/clipcraft/__tests__/
git commit -m "$(cat <<'EOF'
feat(clipcraft): hydrate + serialize track.previewFrames

projectFileToCommands emits composition:add-preview-frame envelopes
per persisted preview frame (after track + clip add). serializeProject
reads track.previewFrames from craft state and writes them back.
Round-trip test verifies byte equality on a sample with mixed
sketch/anchor previews.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — PreviewCanvas wiring

**Goal:** the central preview canvas renders preview frames during playback and scrub, via the existing `<PreviewRoot>` (which uses `PlaybackEngine`). One-line option declaration; the rest is upstream's responsibility.

**Files in this phase:**
- Modify: `modes/clipcraft/viewer/ClipCraftPreview.tsx` (find `PneumaCraftProvider` mount or wherever the engine option flows)

### Task 2.1: Declare `includePreviewFrames: true` for the playback engine

**Files:**
- Modify: `modes/clipcraft/viewer/ClipCraftPreview.tsx`

- [ ] **Step 1: Locate the engine creation site**

Run: `grep -n "createPneumaCraftStore\|PneumaCraftProvider\|playbackEngineOptions" modes/clipcraft/viewer/ClipCraftPreview.tsx`

Identify whether the engine options flow through `PneumaCraftProvider` props or `createPneumaCraftStore({ playbackEngineOptions: { ... } })`. Read the relevant block.

- [ ] **Step 2: Add `includePreviewFrames: true`**

At the engine-options spread (or wherever `subtitleRenderer` is currently passed to the engine), add:

```typescript
{
  subtitleRenderer,
  includePreviewFrames: true,  // playback always shows planning visuals
}
```

`true` is upstream's default already; the explicit declaration is for documentation — anyone reading the call site sees that ClipCraft chose this on purpose.

- [ ] **Step 3: Build + browser smoke**

Run dev server: `bun run dev clipcraft --workspace /tmp/clipcraft-pf-smoke --no-open --port 18100`. (If the workspace already exists, delete first: `rm -rf /tmp/clipcraft-pf-smoke`.)

Manually craft a `project.json` at `/tmp/clipcraft-pf-smoke/project.json` with:
- One image asset (use any local sketch image; copy to `/tmp/clipcraft-pf-smoke/assets/sketch-test.png`)
- A composition with one video track, no clips, **one previewFrame at `t=2` referencing that asset**

Open `http://localhost:18100/?session=<sessionId>&mode=clipcraft&layout=editor` (the launcher will print the session URL). Scrub the playhead to `t=3`. Verify the central canvas shows the sketch image. Verify scrubbing to `t=0` shows nothing (no preview before t=2).

- [ ] **Step 4: Commit (no skill update — this is a passive plumbing change)**

```bash
git add modes/clipcraft/viewer/ClipCraftPreview.tsx
git commit -m "$(cat <<'EOF'
feat(clipcraft): playback engine renders preview frames by default

Declare includePreviewFrames: true on the engine creation. Upstream's
default is already true; this is documentation for ClipCraft readers
that the planning layer is intentionally on during playback/scrub.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Timeline-row preview thumbnail strip

**Goal:** the timeline `VideoTrack` row visually shows preview frames in any region not covered by a real clip. Sketch and anchor previews look subtly different. Pending / error / missing assets show explicit placeholders.

**Files in this phase:**
- Create: `modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx`
- Create: `modes/clipcraft/viewer/timeline/PreviewFrameStrip.test.ts`
- Modify: `modes/clipcraft/viewer/timeline/VideoTrack.tsx`

### Task 3.1: Pure helper — compute uncovered intervals on a track

**Files:**
- Create: `modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx` (start with helpers only; component comes in next task)
- Create: `modes/clipcraft/viewer/timeline/PreviewFrameStrip.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `modes/clipcraft/viewer/timeline/PreviewFrameStrip.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { computePreviewSegments } from "./PreviewFrameStrip.js";
import type { Clip, PreviewFrame } from "@pneuma-craft/timeline";

const clip = (id: string, start: number, dur: number): Clip => ({
  id, trackId: "t1", assetId: "a-" + id,
  startTime: start, duration: dur,
  inPoint: 0, outPoint: dur,
});

const pf = (id: string, time: number): PreviewFrame => ({
  id, trackId: "t1", time, assetId: "a-" + id,
});

describe("computePreviewSegments", () => {
  test("empty inputs → no segments", () => {
    expect(computePreviewSegments([], [], 10)).toEqual([]);
  });

  test("single preview, no clips, duration 10 → segment [0|2 → 10]", () => {
    expect(computePreviewSegments([pf("p1", 2)], [], 10)).toEqual([
      { previewFrameId: "p1", startTime: 2, endTime: 10 },
    ]);
  });

  test("two previews, no clips → adjacent segments", () => {
    expect(computePreviewSegments([pf("p1", 0), pf("p2", 4)], [], 10)).toEqual([
      { previewFrameId: "p1", startTime: 0, endTime: 4 },
      { previewFrameId: "p2", startTime: 4, endTime: 10 },
    ]);
  });

  test("preview hidden under clip is not emitted", () => {
    const previews = [pf("p1", 0), pf("p2", 4), pf("p3", 8)];
    const clips = [clip("c1", 4, 4)];   // covers [4, 8)
    expect(computePreviewSegments(previews, clips, 10)).toEqual([
      { previewFrameId: "p1", startTime: 0, endTime: 4 },
      // p2 fully covered by clip
      { previewFrameId: "p3", startTime: 8, endTime: 10 },
    ]);
  });

  test("preview straddling clip end → segment starts after clip", () => {
    const previews = [pf("p1", 2)];
    const clips = [clip("c1", 4, 4)];   // covers [4, 8)
    // p1 displays [2, 4) before clip; then clip; then nothing after.
    expect(computePreviewSegments(previews, clips, 10)).toEqual([
      { previewFrameId: "p1", startTime: 2, endTime: 4 },
    ]);
  });

  test("preview at exactly clip start → not visible at all (clip wins via half-open interval)", () => {
    const previews = [pf("p1", 4)];
    const clips = [clip("c1", 4, 4)];
    expect(computePreviewSegments(previews, clips, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `bun test modes/clipcraft/viewer/timeline/PreviewFrameStrip.test.ts`
Expected: FAIL — file `PreviewFrameStrip.tsx` doesn't export `computePreviewSegments` yet.

- [ ] **Step 3: Implement the helper**

Create `modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx`:

```typescript
import type { Clip, PreviewFrame } from "@pneuma-craft/timeline";

/** A visible segment of a preview frame on the timeline. */
export interface PreviewSegment {
  readonly previewFrameId: string;
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * Walk preview frames + clips, producing the visible segments of preview
 * frames after auto-fallback. Mirrors the upstream resolveFrame rule:
 *   - For each preview frame at time T, it displays from T until the
 *     next preview frame's time, or the composition end.
 *   - A clip covering any point in that interval supersedes the preview
 *     in that sub-interval (clip wins).
 *
 * Inputs:
 *   previews — sorted ascending by time (matches upstream invariant I5)
 *   clips    — any order; we compute coverage internally
 *   duration — composition duration (cap on the trailing segment)
 *
 * Output: list of segments with [startTime, endTime), preserving order.
 *
 * Pure function. No allocation beyond return.
 */
export function computePreviewSegments(
  previews: readonly PreviewFrame[],
  clips: readonly Clip[],
  duration: number,
): PreviewSegment[] {
  if (previews.length === 0) return [];

  // For each preview, the natural interval is [pf.time, nextPf.time) — clamped to [0, duration].
  const segments: PreviewSegment[] = [];

  for (let i = 0; i < previews.length; i++) {
    const pf = previews[i]!;
    const naturalStart = pf.time;
    const naturalEnd = i + 1 < previews.length ? previews[i + 1]!.time : duration;
    if (naturalStart >= duration) continue;
    if (naturalEnd <= naturalStart) continue;

    // Intersect with NOT-COVERED-BY-CLIP regions.
    // We walk clips that intersect [naturalStart, naturalEnd) and split.
    let cursor = naturalStart;
    const overlapping = clips
      .filter(c => c.startTime < naturalEnd && c.startTime + c.duration > naturalStart)
      .slice()
      .sort((a, b) => a.startTime - b.startTime);

    for (const c of overlapping) {
      const cStart = c.startTime;
      const cEnd = c.startTime + c.duration;
      // Half-open interval: clip covers [cStart, cEnd). Preview wins outside that.
      if (cStart > cursor) {
        segments.push({ previewFrameId: pf.id, startTime: cursor, endTime: cStart });
      }
      cursor = Math.max(cursor, cEnd);
      if (cursor >= naturalEnd) break;
    }
    if (cursor < naturalEnd) {
      segments.push({ previewFrameId: pf.id, startTime: cursor, endTime: naturalEnd });
    }
  }

  return segments;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test modes/clipcraft/viewer/timeline/PreviewFrameStrip.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx modes/clipcraft/viewer/timeline/PreviewFrameStrip.test.ts
git commit -m "$(cat <<'EOF'
feat(clipcraft): pure helper for preview-frame visible-segment computation

computePreviewSegments folds preview frames + clips into a list of
visible [start, end) intervals respecting auto-fallback (clip wins per
half-open interval). Pure, fully tested.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.2: `<PreviewFrameStrip />` React component

**Files:**
- Modify: `modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx` (add the component)

- [ ] **Step 1: Add the component**

Append to `modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx`:

```typescript
import { useMemo } from "react";
import { useAsset } from "@pneuma-craft/react";
import { theme } from "../theme/tokens.js";
import type { Track } from "@pneuma-craft/timeline";

interface PreviewFrameStripProps {
  readonly track: Track;
  readonly duration: number;
  readonly pixelsPerSecond: number;
  readonly trackHeight: number;
  /** Called with the previewFrame id when the user clicks a strip cell. */
  readonly onSelect: (previewFrameId: string, time: number) => void;
}

/**
 * Renders the planning-layer thumbnail strip for a video track.
 *
 * For each visible preview-segment (computed via computePreviewSegments
 * over track.previewFrames + track.clips), draws an absolutely-positioned
 * tile sized by [startTime, endTime) × pixelsPerSecond. The tile shows
 * the referenced asset's image (background-image) with subtle visual
 * differentiation between sketch and anchor fidelity.
 *
 * Status fallback: if the referenced asset is `generating`, shows ⏳ +
 * label; if `error`, shows ⚠ + tooltip; if missing from registry, shows
 * ? + assetId tooltip. (See Asset.status from @pneuma-craft/core.)
 */
export function PreviewFrameStrip({
  track, duration, pixelsPerSecond, trackHeight, onSelect,
}: PreviewFrameStripProps) {
  const segments = useMemo(
    () => computePreviewSegments(track.previewFrames ?? [], track.clips, duration),
    [track.previewFrames, track.clips, duration],
  );

  if (segments.length === 0) return null;

  return (
    <>
      {segments.map(seg => {
        const pf = (track.previewFrames ?? []).find(p => p.id === seg.previewFrameId);
        if (!pf) return null;  // defensive — should never happen
        return (
          <PreviewSegmentTile
            key={`${seg.previewFrameId}@${seg.startTime}`}
            segment={seg}
            assetId={pf.assetId}
            pixelsPerSecond={pixelsPerSecond}
            trackHeight={trackHeight}
            onClick={() => onSelect(pf.id, pf.time)}
          />
        );
      })}
    </>
  );
}

interface PreviewSegmentTileProps {
  readonly segment: PreviewSegment;
  readonly assetId: string;
  readonly pixelsPerSecond: number;
  readonly trackHeight: number;
  readonly onClick: () => void;
}

function PreviewSegmentTile({
  segment, assetId, pixelsPerSecond, trackHeight, onClick,
}: PreviewSegmentTileProps) {
  const asset = useAsset(assetId);
  const widthPx = (segment.endTime - segment.startTime) * pixelsPerSecond;
  const leftPx = segment.startTime * pixelsPerSecond;

  // Visual treatment based on asset.metadata.fidelity
  // 'sketch' → dashed border + 70% opacity; default ('anchor' or absent) → solid border + full opacity.
  const fidelity = (asset?.metadata as { fidelity?: string } | undefined)?.fidelity;
  const isSketch = fidelity === "sketch";

  // Status placeholder
  const status = asset?.status;
  const isReady = !!asset && status === "ready" && !!asset.uri;
  const showPending = !!asset && status === "generating";
  const showError = !!asset && status === "error";
  const showMissing = !asset;

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: leftPx,
    top: 0,
    width: widthPx,
    height: trackHeight,
    boxSizing: "border-box",
    border: isSketch
      ? `1px dashed ${theme.color.borderWeak}`
      : `1px solid ${theme.color.borderWeak}`,
    opacity: isSketch ? 0.7 : 1,
    cursor: "pointer",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    color: theme.color.ink2,
  };

  if (isReady) {
    return (
      <div
        style={{
          ...baseStyle,
          backgroundImage: `url(${asset!.uri})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        onClick={onClick}
        title={asset!.name}
        data-preview-frame-id={segment.previewFrameId}
      />
    );
  }

  if (showPending) {
    return (
      <div style={baseStyle} onClick={onClick} title={asset!.name} data-preview-frame-id={segment.previewFrameId}>
        ⏳ {asset!.name}
      </div>
    );
  }
  if (showError) {
    return (
      <div style={{ ...baseStyle, borderColor: theme.color.danger ?? "#dc2626" }}
           onClick={onClick}
           title={(asset!.metadata as { error?: string } | undefined)?.error ?? "error"}
           data-preview-frame-id={segment.previewFrameId}>
        ⚠ {asset!.name}
      </div>
    );
  }
  if (showMissing) {
    return (
      <div style={baseStyle} onClick={onClick} title={`asset ${assetId} not in registry`}
           data-preview-frame-id={segment.previewFrameId}>
        ? {assetId}
      </div>
    );
  }
  return null;
}
```

The icons (⏳, ⚠, ?) are exception to the no-emoji rule (per the project memory). They are *placeholder* fallback icons, not decorative — they communicate state. If the project lint forbids any emoji at all, swap to inline SVG icons matching the existing icon set (likely in `modes/clipcraft/viewer/icons/`).

Check `modes/clipcraft/viewer/icons/` first; if there are existing status icons (clock for pending, warning for error, question for missing), use those instead of emoji.

**Note on `theme.color.danger`** — if this token doesn't exist in `theme/tokens.ts`, use the literal `#dc2626` and add a TODO at the top of the file. Don't block on adding the token; verify by reading `theme/tokens.ts` first.

- [ ] **Step 2: Typecheck**

Run: `bun run tsc --noEmit`
Expected: PASS. If `useAsset` import path differs (it's `@pneuma-craft/react`), adjust per the verified type definitions.

- [ ] **Step 3: Commit (component-only, not yet wired)**

```bash
git add modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx
git commit -m "$(cat <<'EOF'
feat(clipcraft): PreviewFrameStrip component for timeline planning layer

Renders preview-frame thumbnails in uncovered regions of a video track.
Sketch fidelity (asset.metadata.fidelity === 'sketch') gets dashed
border + 70% opacity; anchor or absent gets solid + full. Pending /
error / missing assets render explicit placeholders.

Component is created but not yet wired into VideoTrack — that's the
next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.3: Wire `<PreviewFrameStrip />` into `VideoTrack.tsx`

**Files:**
- Modify: `modes/clipcraft/viewer/timeline/VideoTrack.tsx`

- [ ] **Step 1: Locate the row's render structure**

Read `modes/clipcraft/viewer/timeline/VideoTrack.tsx`. Find the JSX that renders the track row's content area (the absolutely-positioned space where each `VideoClip` sits). Note the local variables for `pixelsPerSecond`, `trackHeight`, `duration`, and the `track` prop shape.

- [ ] **Step 2: Add `<PreviewFrameStrip />` underneath the clip layer**

Inside the row's content container, add the strip *before* the clip rendering loop so clips render on top (z-order via DOM order). It should look like:

```tsx
<PreviewFrameStrip
  track={track}
  duration={duration}
  pixelsPerSecond={pixelsPerSecond}
  trackHeight={trackHeight}
  onSelect={(previewFrameId, time) => {
    dispatch("human", {
      type: "selection:set",
      selection: { type: "asset", ids: [/* asset id */] },
    });
    seek(time);
  }}
/>
{/* existing clips loop ... */}
```

But note the `onSelect` needs the `assetId` — the strip already knows it internally; let's adjust the callback signature in PreviewFrameStrip to pass the asset id too:

In `PreviewFrameStrip.tsx`, change the `onSelect` callback signature to:
```typescript
readonly onSelect: (previewFrameId: string, time: number, assetId: string) => void;
```
And update the `onClick` inside `PreviewSegmentTile` to call `onClick()` with the third arg by lifting `pf.assetId` into the parent's call site:

In `PreviewFrameStrip` map:
```tsx
onSelect={(id, t) => onSelect(id, t, pf.assetId)}
```

Then in `VideoTrack`:
```tsx
onSelect={(previewFrameId, time, assetId) => {
  dispatch("human", { type: "selection:set", selection: { type: "asset", ids: [assetId] } });
  seek(time);
}}
```

Use the existing `useDispatch()` + `usePlayback()` hooks already imported into `VideoTrack`.

- [ ] **Step 3: Build + browser smoke**

Restart dev server. Reuse the workspace from Phase 2 smoke (which has a single previewFrame at t=2). Verify:
1. The timeline row for that video track shows a small thumbnail at the t=2 position spanning to the composition end
2. Clicking the thumbnail seeks the playhead to t=2 and selects the underlying image asset (verify in the asset panel that the image gets selected/highlighted)

If the strip overlaps weirdly with empty-track placeholders, consult `modes/clipcraft/viewer/timeline/VideoTrack.tsx`'s existing empty-state rendering and reorder DOM accordingly.

- [ ] **Step 4: Add a 2-frame test**

Update `/tmp/clipcraft-pf-smoke/project.json` to include 2 sketches at t=0 and t=4, plus a real clip at t=4 spanning 4s. Verify:
1. t=0 to t=4 shows the first sketch
2. t=4 to t=8 shows the real clip (not the sketch underneath)
3. After t=8 nothing shows (no more previews and no clip)

If correct, the auto-fallback rule is wired.

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/viewer/timeline/VideoTrack.tsx modes/clipcraft/viewer/timeline/PreviewFrameStrip.tsx
git commit -m "$(cat <<'EOF'
feat(clipcraft): timeline VideoTrack renders preview-frame strip

Plans the planning-layer thumbnails in uncovered intervals of a video
track. Click on a thumbnail selects the referenced asset and seeks the
playhead to the preview frame's time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Locator card + extractContext

**Goal:** the agent can emit `<viewer-locator data='{"previewFrameId":"pf-04"}'>` and clicks land cleanly. `extractContext` surfaces "this asset is currently a preview frame" so the agent has rich context when an asset selection lands on a preview frame's image.

**Files in this phase:**
- Modify: `modes/clipcraft/viewer/ClipCraftPreview.tsx` (locator routing block)
- Modify: `modes/clipcraft/pneuma-mode.ts` (extractContext)
- Modify: `modes/clipcraft/skill/SKILL.md` (locator card example + new data shape registration)

### Task 4.1: Locator-card routing for `previewFrameId`

**Files:**
- Modify: `modes/clipcraft/viewer/ClipCraftPreview.tsx` (find the navigateRequest effect, around line 187+)

- [ ] **Step 1: Add a previewFrameId branch to the navigateRequest effect**

In `ClipCraftPreview.tsx`, in the existing `useEffect` that handles `navigateRequest`, add a new branch:

```typescript
if (typeof data.previewFrameId === "string") {
  const previewFrameId = data.previewFrameId;
  let pf: { trackId: string; time: number; assetId: string } | null = null;
  if (composition) {
    for (const track of composition.tracks) {
      const found = track.previewFrames?.find(p => p.id === previewFrameId);
      if (found) { pf = found; break; }
    }
  }
  if (pf) {
    seek(pf.time);
    dispatch("human", {
      type: "selection:set",
      selection: { type: "asset", ids: [pf.assetId] },
    });
    // Defer to next tick so the strip mounts after selection state propagates.
    requestAnimationFrame(() => {
      flashElement(`[data-preview-frame-id="${previewFrameId}"]`);
    });
  }
  return;
}
```

The `data-preview-frame-id` attribute is already wired in `PreviewFrameStrip.tsx` (Task 3.2).

- [ ] **Step 2: Browser smoke for locator routing**

Restart dev server. In the chat panel, paste a message that emits a locator card:
```
<viewer-locator data='{"previewFrameId":"pf-1"}'>panel 1</viewer-locator>
```

(Simulate this by calling the agent or by hand-injecting via the dev console if you have a hook for that.) Click the card. Verify:
1. The playhead seeks to the previewFrame's time
2. The asset gets selected
3. The thumbnail in the timeline row briefly flashes (orange outline)

- [ ] **Step 3: Commit (skill update follows in next task — keep this commit code-only)**

```bash
git add modes/clipcraft/viewer/ClipCraftPreview.tsx
git commit -m "$(cat <<'EOF'
feat(clipcraft): handle previewFrameId in viewer-locator routing

Locator cards with { previewFrameId } resolve to: seek playhead to the
preview's time, select the referenced asset, flash the strip thumbnail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.2: `extractContext` augmentation

**Files:**
- Modify: `modes/clipcraft/pneuma-mode.ts`

- [ ] **Step 1: Read the current extractContext**

Read `modes/clipcraft/pneuma-mode.ts:17-...`. Identify the current selection/context shape.

- [ ] **Step 2: Add preview-frame derivation**

When an asset is selected and that asset is referenced by a preview frame in the composition, surface that fact in the context. Example output extension:

```typescript
extractContext(selection, files) {
  // ... existing logic that handles asset/clip/track selections ...

  if (selection?.type === "asset" && selection.ids.length === 1) {
    const assetId = selection.ids[0];
    // Try to find a preview frame referencing this asset.
    // (composition is on the craft store; pneuma-mode does not have a direct
    //  store handle, so we depend on the files being passed in OR the existing
    //  context source. Read the file to see how composition is reached.)
    // ...
    // If found:
    //   contextLines.push(`<preview-frame id="${pf.id}" time="${pf.time}" track="${pf.trackId}" fidelity="${asset.metadata?.fidelity ?? 'unknown'}" />`);
  }

  return contextLines.join("\n");
}
```

The exact file-access pattern depends on how `extractContext` currently sources data. If it parses `project.json` from the `files` array, walk that to find preview frames. If it has a Zustand store handle, use it. Read the file first.

- [ ] **Step 3: Test extractContext**

If there's an existing extractContext test (`modes/clipcraft/__tests__/extract-context.test.ts` or similar), add a case where an asset selection is on an asset referenced by a preview frame and verify the context output includes the preview-frame line. If no such test file exists, create one following the existing test style for clip context.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/pneuma-mode.ts modes/clipcraft/__tests__/
git commit -m "$(cat <<'EOF'
feat(clipcraft): extractContext surfaces preview-frame on asset selection

When the user (or a locator card) selects an image asset that's
currently referenced by a preview frame, viewer-context emits a
<preview-frame .../> element so the agent can reason about what the
selection represents in the planning layer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.3: Skill update — locator card + viewer-context

**Files:**
- Modify: `modes/clipcraft/skill/SKILL.md`

- [ ] **Step 1: Add the new locator-card data shape**

In `SKILL.md`, find the "Locator cards" section (around line 50-78 of the current file). Add a fifth data shape example:

````markdown
<!-- previewFrameId — selects the referenced image asset, seeks the
     playhead to the preview frame's time, scrolls + flashes the strip
     thumbnail. Use when pointing at a sketch or anchor on the timeline,
     e.g. when reporting "I generated 3 sketches; here are the panels". -->
<viewer-locator data='{"previewFrameId":"pf-04"}'>panel 4 — opening sketch</viewer-locator>
````

- [ ] **Step 2: Add a preview-frame note in the viewer-context section**

In `SKILL.md`, find the "Reading what the user sees" section. Add to the bulleted list of `<viewer-context>` elements:

```markdown
- `<preview-frame>` — emitted when the selected asset is referenced by
  a preview frame on the timeline. Carries `id` (previewFrameId),
  `time` (seconds), `track` (trackId), and `fidelity` (sketch / anchor
  / absent). Use this to disambiguate "the user is looking at a
  planning-layer sketch" vs "the user is looking at a finished clip's
  source asset".
```

- [ ] **Step 3: Reinstall the skill in your dev workspace + verify in chat**

Restart dev server. Confirm `CLAUDE.md` in the workspace reflects the new locator/context content (skill installer copies + templates the SKILL.md). Test in chat: ask the agent to emit a locator card pointing at a preview frame; click it; verify behavior.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/skill/SKILL.md
git commit -m "$(cat <<'EOF'
docs(clipcraft): skill teaches the previewFrameId locator + context

SKILL.md adds the previewFrameId locator-card data shape and the
<preview-frame /> viewer-context element. Agents can now emit
clickable cards that land users on a specific anchor / sketch on the
timeline, and they receive structured context when the user clicks
back at one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Draft export (toolbar + skill command)

**Goal:** "Export draft" appears next to the existing Export button on the toolbar; clicking it produces a video with preview frames baked in. The skill exposes `export-draft` as an agent-callable command.

**Files in this phase:**
- Modify: `modes/clipcraft/viewer/export/useExportVideo.ts`
- Modify: `modes/clipcraft/viewer/CommandBar.tsx`
- Modify: `modes/clipcraft/manifest.ts` (`viewerApi.commands`)
- Modify: `modes/clipcraft/skill/SKILL.md` (commands table + workflow notes)

### Task 5.1: Thread `includePreviewFrames` through `useExportVideo`

**Files:**
- Modify: `modes/clipcraft/viewer/export/useExportVideo.ts`

- [ ] **Step 1: Extend the hook signature**

The hook currently accepts `(composition, resolver, subtitleRenderer)`. Add a fourth optional argument:

```typescript
export interface UseExportVideoOptions {
  readonly subtitleRenderer?: SubtitleRenderer;
  readonly includePreviewFrames?: boolean;  // default false (final cut)
}

export function useExportVideo(
  composition: Composition | null,
  resolver: WorkspaceAssetResolver,
  options?: UseExportVideoOptions,
): UseExportVideoResult { /* ... */ }
```

(Convert the third positional `subtitleRenderer` argument into `options.subtitleRenderer`. If there are existing call sites passing `subtitleRenderer` positionally, update them to use the options object — search for `useExportVideo(`.)

Inside `start`, where `createExportEngine` is called, pass through:
```typescript
const engine = createExportEngine({
  subtitleRenderer: options?.subtitleRenderer,
  includePreviewFrames: options?.includePreviewFrames ?? false,
});
```

- [ ] **Step 2: Update existing call sites**

Run: `grep -rn "useExportVideo(" modes/clipcraft --include="*.tsx" --include="*.ts"`

For each existing call site, change the positional `subtitleRenderer` argument to `{ subtitleRenderer }`. Don't change behavior; default `includePreviewFrames` is false.

- [ ] **Step 3: Typecheck + tests**

Run: `bun run tsc --noEmit && bun test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/export/useExportVideo.ts modes/clipcraft/viewer/
git commit -m "$(cat <<'EOF'
feat(clipcraft): useExportVideo accepts includePreviewFrames option

Threads the upstream ExportEngine flag through. Default remains false
(final cut excludes planning visuals). Existing call sites converted
to the options-object signature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.2: Add "Export draft" toolbar entry

**Files:**
- Modify: `modes/clipcraft/viewer/CommandBar.tsx`

- [ ] **Step 1: Read the existing Export button structure**

Open `modes/clipcraft/viewer/CommandBar.tsx`. Identify how the existing Export button is rendered and how it triggers an export.

- [ ] **Step 2: Add the Export draft button**

Place a new "Export draft" button **immediately to the left of** the existing Export button, with a slightly muted style to indicate it's the secondary path. The button calls `useExportVideo` with `includePreviewFrames: true`.

If the existing Export button currently uses a single `useExportVideo()` instance, use the **same hook instance** but call `start()` with two distinct paths — but that's not possible because the option is set at hook construction. Instead, instantiate two hooks: one for final, one for draft.

Actual approach:
```tsx
const finalExport = useExportVideo(composition, resolver, { subtitleRenderer });
const draftExport = useExportVideo(composition, resolver, { subtitleRenderer, includePreviewFrames: true });
```

Render two buttons:
- "Export draft" → `draftExport.start("clipcraft-draft")`
- "Export" → `finalExport.start(currentTitleRef.current)`

The two hooks share progress state UI (each emits its own; you might choose to render only one progress indicator at a time and gate by which one is running).

Visual: use a subtle outline icon variant for the draft button (look at `modes/clipcraft/viewer/icons/` for available outline icons; if none fit, render a wireframe of the Export icon by reducing its fill opacity to 40%).

- [ ] **Step 3: Browser smoke**

Restart dev server. In the workspace from earlier phases (with a sketch at t=2 and an empty composition):
1. Click "Export draft" → wait for the export to finish → download → play the resulting MP4 → verify the sketch is visible in the rendered video
2. Click "Export" (final) → verify the sketch is **not** visible (transparent / black where the preview was)

If both behave correctly, the export branch is wired.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/CommandBar.tsx
git commit -m "$(cat <<'EOF'
feat(clipcraft): \"Export draft\" toolbar button

Sits next to the existing Export. Triggers ExportEngine with
includePreviewFrames: true so sketches + anchors bake into the output.
Useful for review before committing to expensive seedance generation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.3: Manifest viewerApi command + skill update

**Files:**
- Modify: `modes/clipcraft/manifest.ts` (the `viewerApi.commands` array)
- Modify: `modes/clipcraft/skill/SKILL.md` (commands table)

- [ ] **Step 1: Add manifest entry**

In `modes/clipcraft/manifest.ts`, add to `viewerApi.commands`:

```typescript
{
  id: "export-draft",
  label: "Make a draft export",
  description:
    "Export the current composition with all preview frames (sketch + anchor) baked in, so the user can review pacing before committing to expensive seedance generation. Use this proactively after stage-1 sketches are placed and after stage-2 anchors are placed, asking the user to review.",
},
```

Place it just before `export-video` so the related export commands cluster.

- [ ] **Step 2: Wire the command to invoke the draft export hook**

Find where the existing toolbar command dispatcher (probably in `CommandBar.tsx` or `ClipCraftPreview.tsx`) handles incoming command-button clicks. For commands like `export-video`, the click sends a chat message; for `export-draft`, it should call `draftExport.start()` directly (no chat round-trip).

Mirror the existing `export-video` handling: that one is also direct-action (per the manifest description — "No agent involvement"). Add an identical case for `export-draft`.

- [ ] **Step 3: Update skill commands table**

In `modes/clipcraft/skill/SKILL.md`, find the commands table. Add a row:

```markdown
| Make a draft export | Same as Export — handled in the viewer with `includePreviewFrames: true`. Used during planning to verify pacing with sketches/anchors baked in. **No agent involvement** for the click. The agent *can* invoke the same workflow by mentioning it in chat; the user usually triggers via the toolbar button. |
```

Place between the existing "Add BGM" and "Export video" rows.

- [ ] **Step 4: Browser smoke**

Restart dev server. Click the new "Export draft" button. The output should be the same as Task 5.2 (sketch baked in). The manifest entry appearing in the launcher's command list shouldn't affect viewer button behavior.

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/manifest.ts modes/clipcraft/skill/SKILL.md modes/clipcraft/viewer/
git commit -m "$(cat <<'EOF'
feat(clipcraft): export-draft viewer command + skill entry

Manifest exposes export-draft alongside export-video. SKILL.md
commands table documents that the click is direct-action (no agent
involvement) and explains when the agent should suggest using it
during the progressive-fidelity workflow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Lightweight dive integration

**Goal:** clicking a preview frame on the timeline (which selects the referenced asset) and then clicking the existing dive button opens the asset's variant tree. No new dive UI.

**Files in this phase:**
- Verify: `modes/clipcraft/viewer/dive/DiveCanvas.tsx`

### Task 6.1: Verify dive entry handles preview-frame asset selection

**Files:**
- Verify: `modes/clipcraft/viewer/dive/DiveCanvas.tsx`
- Possibly: `modes/clipcraft/viewer/dive/useTreeLayout.ts` if asset traversal is the entry point

- [ ] **Step 1: Read the existing dive entry logic**

Open `modes/clipcraft/viewer/dive/DiveCanvas.tsx`. Identify the input — usually `selection.type === 'asset'` with `ids[0]` as the root asset. Read `useTreeLayout.ts` to confirm.

- [ ] **Step 2: Smoke test with a real preview-frame asset**

Restart dev server. In a workspace with: 1 sketch asset + 1 anchor asset (both `image` type) where the anchor's provenance has the sketch as parent (use `provenance:link` or set the seed `project.json` to include the edge).

1. Click the sketch on the timeline strip → asset selection of the sketch
2. Click the dive button → dive should open showing the sketch + the anchor as a downstream variant
3. Click back on the anchor (visible as a related node in dive) → the anchor's lineage shows the sketch as parent

If this all works without code changes, no work needed in this phase. If dive doesn't recognize the asset selection (e.g. only opens for clip selections), add a one-line guard that allows asset selections too. This depends on the existing implementation.

- [ ] **Step 3: If no code change needed, skip the commit; otherwise commit**

```bash
# only if there was a change:
git add modes/clipcraft/viewer/dive/
git commit -m "$(cat <<'EOF'
fix(clipcraft): dive opens for asset selection sourced from preview frame

Preview-frame clicks select the referenced asset; the dive button must
accept asset-type selections so the user can inspect the sketch →
anchor → final-video provenance chain without a separate \"storyboard
dive\" mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Sketch script + skill workflow doc

**Goal:** `generate_image.mjs` accepts `--style sketch` for cheap line-art generation. The agent has a written playbook (`storyboard-workflow.md`) for progressive-fidelity workflows that mentions the new flag and the `metadata.fidelity` convention.

**Files in this phase:**
- Modify: `modes/_shared/scripts/generate_image.mjs`
- Create: `modes/clipcraft/skill/references/storyboard-workflow.md`
- Modify: `modes/clipcraft/skill/SKILL.md` (link to new ref doc)
- Modify: `modes/clipcraft/manifest.ts` (`mdScene` augmentation)

### Task 7.1: `--style sketch | photo` flag in `generate_image.mjs`

**Files:**
- Modify: `modes/_shared/scripts/generate_image.mjs`

- [ ] **Step 1: Read the existing flag-parsing block**

Open `modes/_shared/scripts/generate_image.mjs`. Find where flags are parsed (likely a manual loop or `parseArgs`). Note where the prompt is composed before the API call.

- [ ] **Step 2: Add `--style` flag**

Add a new flag `--style sketch | photo` (default `photo`). When `--style sketch`:
- Append " in clean black-and-white pencil sketch style, line art, no shading, white background" to the user-supplied prompt before sending
- Override `--quality` to `low` (cheaper) — but if user explicitly passes `--quality high`, honor that
- Print a stderr line "(style: sketch — added line-art prompt suffix, quality: low)" so the user sees what changed

Update the script's `--help` output to document the new flag.

- [ ] **Step 3: Smoke test**

Run a sketch generation:
```bash
node modes/_shared/scripts/generate_image.mjs "a panda balancing on a coffee cup" \
  --style sketch \
  --aspect-ratio 16:9 \
  --output-dir /tmp/sketch-test \
  --filename-prefix panda-sketch
```
Verify the output is a line-art PNG (not photoreal).

Then a photo generation (default):
```bash
node modes/_shared/scripts/generate_image.mjs "a panda balancing on a coffee cup" \
  --aspect-ratio 16:9 \
  --output-dir /tmp/photo-test \
  --filename-prefix panda-photo
```
Verify the output is photoreal (current behavior).

- [ ] **Step 4: Commit**

```bash
git add modes/_shared/scripts/generate_image.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): generate_image.mjs --style sketch | photo flag

--style sketch appends a line-art prompt suffix and lowers quality to
'low' for cheap progressive-fidelity stage-1 generation. ClipCraft
storyboard workflow consumes this for sketch overlay creation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.2: `references/storyboard-workflow.md` — agent playbook

**Files:**
- Create: `modes/clipcraft/skill/references/storyboard-workflow.md`

- [ ] **Step 1: Write the doc**

Create the file with the full playbook. Use the content below verbatim (copy-paste the markdown):

````markdown
# Storyboard Workflow — progressive-fidelity video planning

ClipCraft's planning layer is the `previewFrames` array on each video track. It lets you stage three layers of fidelity on the timeline before any expensive video generation runs:

1. **Sketch layer** — line-art images placed across the timeline. Cheap (`gpt-image-2 --style sketch --quality low` ≈ $0.01 per image). Defines vibe, blocking, pacing.
2. **Anchor layer** — photoreal first/last frames at planned generation boundaries (`gpt-image-2 --style photo --quality high`). Replaces specific sketch positions. Used as seedance anchors.
3. **Real clip layer** — `Clip` on the same track from a seedance run. Replaces the planning layer in its time range.

The user reviews at every layer transition. Your job is to surface the right artifact at the right time and ask "ready to commit?" before each escalation.

## When to reach for this

Use storyboard workflow when the request implies a multi-beat segment: "make me a 15-second latte art musical video", "a 30s opening with three cuts", anything that's clearly more than a single moment.

Skip it for trivial single-shot requests: "make me a 4-second clip of a panda rolling over" — just generate.

If you're unsure: ask the user "do you want to plan this out first with sketches, or go straight to generation?"

## Working with `previewFrames`

A preview frame is `{ id, trackId, time, assetId }`. Time is in seconds (always quantize to milliseconds: `Math.round(t * 1000) / 1000`). The `assetId` must point at a `type: 'image'` asset. The four craft commands you'll use:

- `composition:add-preview-frame { trackId, time, assetId, id? }` — place a new entry. Rejects on `(trackId, time)` collision.
- `composition:remove-preview-frame { previewFrameId }` — by id.
- `composition:move-preview-frame { previewFrameId, time, trackId? }` — atomic move; preserves `id` so locator cards survive. Rejects collision at destination.
- `composition:rebind-preview-frame { previewFrameId, assetId }` — swap the referenced image without changing placement.

For "ensure asset X is the preview at this slot" (the typical upgrade flow), use the `buildSetPreviewFrameCommand` helper from `@pneuma-craft/timeline` — returns an `add` if empty, a `rebind` if occupied (preserves id), or `null` if already correct.

## Stage 1 — sketch the whole timeline

Decide N panels and their times. Density rule of thumb:
- ~1 panel per 1s for fast cuts / dialogue
- ~1 panel per 2-3s for action sequences
- ~1 panel per 4s+ for long held shots / slow zooms

For each panel:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "<panel description>" \
  --style sketch \
  --aspect-ratio 16:9 \
  --output-dir assets/sketches \
  --filename-prefix panel-<N>
```

Then for each output file, register the asset and add the preview frame. Important — set `metadata.fidelity = "sketch"` so the timeline row renders with the sketch visual treatment (dashed border, 70% opacity).

```typescript
// pseudocode for the agent's edit operations on project.json
assets.push({
  id: "asset-sketch-01",
  type: "image",
  uri: "assets/sketches/panel-01-1.png",
  name: "Panel 01 sketch",
  metadata: { fidelity: "sketch", width: 1280, height: 720 },
  status: "ready",
  // ...
});
provenance.push({
  toAssetId: "asset-sketch-01",
  fromAssetId: null,  // generated from prompt alone
  operation: { type: "generate", actor: "agent", agentId: "...", timestamp: ..., params: { model: "gpt-image-2", prompt: "...", style: "sketch" } },
});

// Then dispatch a craft command for the preview frame:
{ type: "composition:add-preview-frame", trackId: "track-1", time: Math.round(0 * 1000) / 1000, assetId: "asset-sketch-01" }
```

After all sketches are placed, **ask the user to scrub** and consider asking for a draft export (next stage).

## Stage 2 — review with a draft export

Suggest: "我先做个草样片让你看看节奏，再决定哪几段做真视频。"

User clicks "Export draft" in the toolbar (or asks you to invoke `export-draft`). The resulting video bakes in the sketches as visible frames at their placement times. The user scrubs the file or watches it.

If the user wants changes:
- "make panel 3 faster" → remove the entry at panel 3's time, place new sketches at sub-second timings
- "different vibe overall" → regenerate sketches with a different prompt style; rebind the existing preview frames to the new assets via `buildSetPreviewFrameCommand`
- "this beat doesn't fit" → `remove-preview-frame { previewFrameId }`

When the user says "this looks right", proceed to stage 3.

## Stage 3 — upgrade to anchors at gen boundaries

Decide the gen segments. For seedance, each segment is 4-15 seconds. The boundaries between segments need photoreal anchor frames (sketch quality is too low to use as a seedance from-image / end-image-url).

For each gen boundary, generate a photoreal anchor at exact composition pixel dimensions:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "<the same panel description, possibly more detailed>" \
  --image-size 1280x720 \
  --quality high \
  --output-dir assets/anchors \
  --filename-prefix anchor-<segment-N>
```

Register the asset with `metadata.fidelity = "anchor"`. Then upgrade the slot:

```typescript
import { buildSetPreviewFrameCommand } from "@pneuma-craft/timeline";

const cmd = buildSetPreviewFrameCommand(composition, "track-1", 4.0, "asset-anchor-01");
if (cmd) await dispatch(cmd);  // returns rebind-preview-frame, preserving the existing slot's id
```

The slot's id stays stable across the upgrade. Locator cards pointing at this preview frame keep working.

## Stage 4 — second review, then generate

Suggest: "我再做个 draft，你看看 anchor 接得上不上。"

Second draft export → user reviews. If anchors look right, run seedance:

```bash
# For each segment:
node .claude/skills/pneuma-clipcraft/scripts/generate-video.mjs from-image \
  --prompt "<segment narration>" \
  --image-url assets/anchors/anchor-segment-01.png \
  --end-image-url assets/anchors/anchor-segment-02.png \
  --duration 4 \
  --aspect-ratio 16:9 \
  --output assets/clips/segment-01.mp4
```

Register the resulting video asset. Add a `Clip` to the same video track at the segment's start time:

```typescript
{ type: "composition:add-clip", trackId: "track-1", clip: { startTime: 0, duration: 4, ..., assetId: "asset-clip-01" } }
```

The preview frames in the clip's interval auto-fall-go (clip wins per the upstream resolveFrame rule). The preview frame data **stays in `track.previewFrames`** for audit / undo / revisit.

## Stage 5 — polish and finalize

The user may not care about the planning layer once final clips land. By default, leave the preview frames in place. Only remove them if the user explicitly says "clean up the sketches".

If they do, dispatch `composition:remove-preview-frame { previewFrameId }` for each, in any order. The undo will be one step per frame; warn the user before bulk-removing more than 5 at a time.

## Path B — single long-form generation with internal beats

When the user wants a single 15s continuous shot with multiple internal beats (the Kōda latte art recipe), don't split into N seedance calls. Place anchors at the visible "beat moments" but at gen time issue **one** seedance call:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate-video.mjs from-image \
  --prompt "<full 15s narration with embedded beat directions: 'first lift the milk pitcher, push in close, then [beat 2: tiny waves dancing in], [beat 3: foam goes round]...'>" \
  --image-url assets/anchors/anchor-start.png \
  --end-image-url assets/anchors/anchor-end.png \
  --duration 15 \
  --aspect-ratio 16:9 \
  --output assets/clips/full-shot.mp4
```

Result is a single 15s clip; it auto-fall-goes all preview frames in `[0, 15)`. The interleaved beat anchors stay in the data as audit trail (and as backup if the user wants to redo with a different gen strategy).

## Density and pacing recipes

| Total length | Cuts / beats | Pattern |
|---|---|---|
| 4-8s | 1 (single shot) | No storyboard needed; just generate |
| 10-15s | 1 (long held shot) | No storyboard needed |
| 10-15s | 3-5 (musical / dialogue) | Path B: single gen, N internal beats, ~3 anchors total |
| 30s | 2-3 cuts | Path A: 2-3 separate gens, 3-4 anchors at boundaries, 5-8 sketches between |
| 60s | 3-5 cuts | Path A: 3-5 separate gens, 4-6 anchors, 10-15 sketches |

## Move semantics — re-pacing without losing identity

If the user says "shift everything 0.5s later", iterate from the *last* preview frame to the first (high time first). For each, dispatch:

```typescript
{ type: "composition:move-preview-frame", previewFrameId: pf.id, time: pf.time + 0.5 }
```

Reverse iteration order avoids destination collisions because each move's destination is currently empty. If a destination is somehow occupied (shouldn't happen with reverse-iteration but defensive: agent dispatched something in parallel), `move-preview-frame` will reject; remove the destination first.

`buildSetPreviewFrameCommand` is for *upserts at a slot*, not for moves — don't reach for it during repositioning.

## Bulk-undo expectation

Placing 8 sketches is 8 undo steps, not one. Warn the user before satellite operations: "I'll plant 8 sketches now; if you want to wipe them, ask me to clear them rather than mash undo." If they want to clear: dispatch 8 `remove-preview-frame` calls.

## Locator cards

When you've placed sketches or anchors, emit one locator card per *distinct thing you want the user to verify*. Don't emit one per frame — emit one per "look at this beat":

```html
<viewer-locator data='{"previewFrameId":"pf-04"}'>panel 4 — opening close-up</viewer-locator>
```

Click flashes the strip thumbnail and selects the asset. Use sparingly.

## Pitfalls

- **Forgetting `metadata.fidelity`** — without it, the timeline row renders sketches as anchors. Always set the field at registration time.
- **Floating-point time** — always `Math.round(t * 1000) / 1000` before passing to commands. Otherwise, equality checks (e.g. for the move detection) misbehave.
- **Adding a preview frame at exact `time === composition.duration`** — engine pauses at duration, so the last preview won't render. Either add a sentinel after, or trim duration via the upstream `Composition.explicitDuration` future feature.
- **Anchor ≠ first frame of seedance** — the anchor *is* the seedance from-image. Generate at the exact composition pixel dimensions (`--image-size WxH`), not via `--aspect-ratio` which routes through fal presets.
- **Sketch fidelity in the final cut** — the user occasionally says "I want to keep the sketch in the final video". That's a real `Clip` of an image asset, not a preview frame. Add it via `composition:add-clip { assetId: sketchAssetId, ... }`. Preview frames don't show up in final exports by default.
````

- [ ] **Step 2: Verify**

Read the file back. Make sure all command names match the upstream recipe doc exactly (`composition:add-preview-frame`, `composition:remove-preview-frame`, etc.).

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/skill/references/storyboard-workflow.md
git commit -m "$(cat <<'EOF'
docs(clipcraft): storyboard-workflow agent playbook

End-to-end progressive-fidelity guide: sketch → anchor → real clip,
with concrete script invocations, density/pacing tables, move and
bulk-undo recipes, Path B long-form gen, and pitfalls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.3: SKILL.md and `mdScene` updates

**Files:**
- Modify: `modes/clipcraft/skill/SKILL.md`
- Modify: `modes/clipcraft/manifest.ts`

- [ ] **Step 1: Add the storyboard workflow paragraph to SKILL.md**

In `SKILL.md`, find the "When to reach for which reference" section. Add an entry:

```markdown
- `references/storyboard-workflow.md` — when the user wants a multi-beat
  video segment (more than a single trivial shot). Walks through the
  three-layer planning workflow (sketch → anchor → clip), density
  recipes, and the Path B long-form-gen recipe.
```

In the same `SKILL.md`, find the "See also" section at the bottom. Add:

```markdown
- `references/storyboard-workflow.md` — progressive-fidelity playbook
```

- [ ] **Step 2: Update `mdScene` in `manifest.ts`**

In `modes/clipcraft/manifest.ts`, locate the `skill.mdScene` field. Append (preserving the existing text):

```
You can stage planning visuals on the timeline before running expensive seedance generation: line-art sketches across the whole video, then photoreal anchor frames at gen boundaries, then the real video clips. Use `references/storyboard-workflow.md` when planning a multi-beat segment.
```

- [ ] **Step 3: Reinstall skill in dev workspace + verify**

Restart dev server. Confirm `CLAUDE.md` in the workspace has the new mdScene + SKILL.md content. Spot-check by asking the agent (in chat) "what's in the storyboard workflow reference?" — the agent should be aware of the new file.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/manifest.ts modes/clipcraft/skill/SKILL.md
git commit -m "$(cat <<'EOF'
docs(clipcraft): SKILL.md + mdScene cite the storyboard workflow

Anchors the agent's awareness of progressive-fidelity planning. The
new reference doc is now discoverable via SKILL.md's reference table
and the agent's system-prompt scene-setting paragraph.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — End-to-end smoke + version bump

**Goal:** an integration walkthrough proves the workflow works for a real user. Mode version bumps to 0.8.0. CHANGELOG entry.

**Files in this phase:**
- Modify: `modes/clipcraft/manifest.ts` (version)
- Modify: `CHANGELOG.md`

### Task 8.1: End-to-end smoke walkthrough

This task is manual; not all steps map to automated tests. Treat each as a checklist item:

- [ ] **Fresh workspace.** `rm -rf /tmp/clipcraft-pf-e2e && bun run dev clipcraft --workspace /tmp/clipcraft-pf-e2e --no-open --port 18101`. Open the URL.

- [ ] **Stage 1 sketches.** In chat, ask the agent to stage 8 line-art sketches for a 30-second composition at times 0/4/8/12/16/20/24/28. Verify the strip renders with dashed-border tiles in the timeline row.

- [ ] **Draft export 1.** Click "Export draft". Verify the resulting MP4 contains the sketches.

- [ ] **Anchor upgrade.** Ask the agent to upgrade the t=0, t=12, t=24 sketches to anchors (photoreal). Verify the strip tiles at those times now have solid borders + full opacity.

- [ ] **Draft export 2.** Click "Export draft" again. Verify the new export shows anchors at the upgraded positions.

- [ ] **Real clip.** Ask the agent to run seedance for the t=0–t=12 segment using anchors at t=0 and t=12 as from/end images. Wait for the seedance to complete and the clip to land.

- [ ] **Auto-fallback.** Verify the t=0–t=12 region of the timeline now shows the real video clip; the sketches at t=4 and t=8 underneath are visually hidden. Verify scrubbing through this region plays the real clip on the canvas.

- [ ] **Locator card.** Ask the agent to emit a locator card pointing at the t=20 sketch. Click it. Verify the playhead seeks to t=20, the asset gets selected, and the strip thumbnail flashes.

- [ ] **Dive.** Click the dive button after a preview-frame asset is selected. Verify dive opens to the asset's variant tree.

- [ ] **Persistence.** Restart the dev server (kill + restart). Verify the project reloads with all preview frames intact.

- [ ] **Final export.** Click the regular Export button. Verify the resulting MP4 has the real clip at t=0–t=12 but **no preview content** in the rest of the timeline (transparent / black there).

If any step fails: file the issue, fix, repeat the smoke from where it failed.

- [ ] **Commit (no code change in this task; the smoke produces only artifacts in the workspace, which we discard)**

(Skip — no commit needed for this task.)

### Task 8.2: Version bump + CHANGELOG

**Files:**
- Modify: `modes/clipcraft/manifest.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version**

In `modes/clipcraft/manifest.ts`, change `version: "0.7.2"` to `version: "0.8.0"`.

- [ ] **Step 2: Update CHANGELOG**

In `CHANGELOG.md`, add a new section at the top:

```markdown
## [3.2.0] - 2026-05-09

### ClipCraft 0.8.0 — Storyboard preview track

- **Progressive-fidelity storyboarding** on the timeline. Agents can
  stage line-art sketches across the whole video, upgrade selected
  moments to photoreal anchors, then generate real video clips on
  the same track — preview frames auto-fall-go under real clips.
  Backed by upstream `@pneuma-craft/timeline 0.4.0+` /
  `@pneuma-craft/video 0.5.0+` `PreviewFrame` capability.
- **Draft export** toolbar button: produces a video with sketches +
  anchors baked in for review before committing to expensive
  generation.
- **Locator card** new data shape: `{ previewFrameId }` for clickable
  navigation to a specific anchor / sketch on the timeline.
- **`generate_image.mjs --style sketch | photo`** flag for cheap
  line-art generation.
- **`references/storyboard-workflow.md`** agent-facing playbook.
```

(The repo-level pneuma-skills version probably also needs a bump per `CLAUDE.md`'s release process — check the current top-of-CHANGELOG format and follow.)

- [ ] **Step 3: Run full test suite**

Run: `bun test && bun run tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/manifest.ts CHANGELOG.md
git commit -m "$(cat <<'EOF'
release(clipcraft): 0.8.0 — storyboard preview track

Lands progressive-fidelity storyboarding via upstream PreviewFrame
support. See docs/superpowers/specs/2026-05-09-clipcraft-storyboard-
preview-track-design.md for the full design.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Production cutover (deferred)

**Trigger:** when upstream publishes `@pneuma-craft/timeline ≥ 0.4.0`, `@pneuma-craft/video ≥ 0.5.0` (and any matching `core` / `react` bumps).

This is **not part of the initial implementation**. Do these steps only after the user confirms upstream has published.

- [ ] **Step 1: Unlink**

```bash
bun unlink @pneuma-craft/core
bun unlink @pneuma-craft/timeline
bun unlink @pneuma-craft/video
bun unlink @pneuma-craft/react
```

- [ ] **Step 2: Update `package.json`**

Bump the version constraints to match the published majors.

- [ ] **Step 3: Reinstall**

```bash
bun install
```

Verify `node_modules/@pneuma-craft/timeline` is no longer a symlink.

- [ ] **Step 4: Test**

```bash
bun test && bun run tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "$(cat <<'EOF'
chore(deps): cut over to published @pneuma-craft 0.4.0+ / 0.5.0+

After dev was complete via local link, upstream published. This commit
swaps the link for published versions. No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

This plan covers spec sections 1–11 of the implementation order; spec section 12 (production cutover) is captured as Phase 9, gated on upstream publishing. All in-scope items from the spec's Scope section have a corresponding task. Out-of-scope items (audio/subtitle previews, storyboard dive, bulk commands, explicit duration) are not in any task — that's correct per the spec.

Two known plan deviations from spec:
1. Export is browser-side (not a server route) — fixed in Phase 5 with explicit comment.
2. No new craft `Selection` variant; reuse `'asset'` selection — fixed in Phase 4 with explicit comment.

Both are flagged in the plan header.

The plan is implementable by a subagent that reads the spec + recipe doc + the relevant source file before each task. Files cited where exact line numbers matter; complete code where new files are introduced; concrete script command examples. The TDD + commit cadence is preserved throughout. Browser smoke replaces unit tests for UI layer per spec's "no DOM tests until ripple/snap lands" stance.
