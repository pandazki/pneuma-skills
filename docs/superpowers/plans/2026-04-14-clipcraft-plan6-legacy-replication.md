# ClipCraft Plan 6 — Legacy Viewer Replication (Read-Only)

**Status:** draft, awaiting review
**Branch:** `feat/clipcraft-by-pneuma-craft`
**Depends on:** Plans 1-5 (bootstrap, domain store, id-stability, write path, dispatchEnvelope, playback, timeline)

## Goal

Port the legacy ClipCraft viewer's full shell (layout, asset panel, video preview, 3D overview, exploded view, dive canvas) onto the `@pneuma-craft/*` domain model as a **read-only** experience — the user opens the mode, sees their project, navigates scenes, plays it back, and switches between 2D timeline / 3D overview / exploded / dive views.

## Architecture

A new mode-local "Scene" logical grouping is added to `project.json` (top-level `scenes: Scene[]`). It does not partition the craft composition — it is purely a view over existing clips referenced by id. A mode-local React context holds transient UI state (`timelineMode`, `diveLayer`, `focusedLayer`, `diveFocusedNodeId`, `activePanel`, `captionsEnabled`, timeline zoom, variant pointers, asset errors). All persistent data lives in craft (`useComposition`, `useAssets`, provenance edges) — no duplicate state machine. Playback is driven through craft's `PlaybackEngine` via `usePlayback()` (already wired in Plan 4); we do not resurrect legacy's multi-`<video>` DOM pipeline. 3D rendering is CSS 2.5D via `framer-motion` perspective / rotate transforms — legacy uses the same approach, no Three.js involved.

## Tech Stack

| Layer | Tech |
|-------|------|
| State | Craft store (`useComposition`, `useAssets`, `usePlayback`, `useDispatch`, `useSelection`) + mode-local React context |
| Animation | framer-motion 12 (already installed) |
| Dive canvas | @xyflow/react (**needs install**) + @dagrejs/dagre (**needs install**) |
| Thumbnails | `modes/clipcraft/viewer/timeline/hooks/useFrameExtractor.ts` (existing, Plan 5) |
| Waveforms | `modes/clipcraft/viewer/timeline/hooks/useWaveform.ts` (existing, Plan 5) |
| Frame capture (for ExplodedView video surface) | craft `subscribeToFrames` via `usePneumaCraftStore(s => s.subscribeToFrames)` instead of legacy's DOM `<video>` capture |

## Out of scope — deferred

This plan is **read-only**. Every interaction below is explicitly out of scope and tracked for a follow-up plan:

- **Clip editing on timeline** (drag, resize, split, ripple, pack-left) — *Plan 5.5*.
- **Transitions UI** (add/remove crossfade etc.) — *Plan 5.5 or later*. `transitions[]` stays an empty-passthrough array.
- **Generation controls** (imagegen / videogen / tts / bgm action UI, DiveInlineInput text box that posts `<dive-context>` messages) — *Plan 9 (MCP tool integration)*.
- **Variant edit actions** — the dive canvas nodes render but the "Use This" button and `UPDATE_SLOT_BINDING` flow become read-only in Plan 6; they wire up to a mode-local variant pointer only, and do NOT dispatch craft commands. Full variant switching with provenance-aware "promote this generation" semantics is *Plan 9*.
- **Character references** — not ported in Plan 6. *Plan 9 or later.*
- **Skill rewrite** — `modes/clipcraft/skill/SKILL.md` is not touched. *Plan 10.*
- **Export panel** — the legacy corner "Export" button is dropped in Plan 6. *Plan 8.*
- **Storyboard / graph migration** — no `storyboard.json` or `graph.json` read/write. Plan 6 only reads `pneuma-craft/project/v1`.
- **BGM as first-class** — BGM stays a regular audio track in craft. No `BGMConfig` porting, no dedicated BGM lane in the 3D overview (legacy had a fourth bgm layer; Plan 6 collapses it into a normal audio track).
- **Diff-and-dispatch external edits** — the Plan 5 "remount on external edit" behaviour stays. *Addressed in a future craft-store-level plan.*

## File structure

All new/modified files grouped by task. The only files touched outside `modes/clipcraft/` are `package.json` (Task 7 dependency add) and `modes/clipcraft/seed/project.json`. No `core/`, `server/`, or `@pneuma-craft/*` changes.

### Task 1 — Scene layer + persistence

- **Modify** `modes/clipcraft/persistence.ts` — add `ProjectScene` type, `scenes?: ProjectScene[]` to `ProjectFile`, parse/serialize/round-trip through it. No craft command dispatch — scenes are mode-local.
- **Modify** `modes/clipcraft/seed/project.json` — add two demo scenes referencing `clip-1`.
- **Create** `modes/clipcraft/viewer/scenes/SceneContext.tsx` — React context + `useScenes()` + `useSetScenes()`.
- **Create** `modes/clipcraft/viewer/scenes/useSceneResolver.ts` — hook that takes a `sceneId` and returns the resolved member clips, member asset ids, startTime envelope, and duration envelope.
- **Create** `modes/clipcraft/__tests__/persistence.scenes.test.ts` — round-trip test, missing-clip tolerance test.
- **Create** `modes/clipcraft/__tests__/useSceneResolver.test.ts` — resolver unit test (pure function form).

### Task 2 — Layout shell

- **Create** `modes/clipcraft/viewer/layout/ClipCraftLayout.tsx` — top (AssetPanel + VideoPreview) / bottom (TimelineShell), animated flex-basis collapse.
- **Create** `modes/clipcraft/viewer/layout/TimelineShell.tsx` — holds the Timeline from Plan 5 at the bottom, expands above into overview/exploded/dive. Uses `useTimelineMode()`.
- **Create** `modes/clipcraft/viewer/hooks/useTimelineMode.ts` — React context for `timelineMode: "collapsed" | "overview" | "exploded" | "dive"` and `diveLayer` / `focusedLayer`.
- **Create** `modes/clipcraft/viewer/hooks/useTimelineZoomShared.ts` — mode-local context wrapping legacy's `useTimelineZoom` so the compact timeline and the overview share a single zoom.
- **Modify** `modes/clipcraft/viewer/PreviewPanel.tsx` — replace its current contents with `<ClipCraftLayout />`. Keep `hydrationError` pass-through for debug.

### Task 3 — VideoPreview + caption overlay

- **Create** `modes/clipcraft/viewer/preview/VideoPreview.tsx` — craft `PreviewRoot` render-prop, bottom control bar with play/pause + total duration + aspect ratio label.
- **Create** `modes/clipcraft/viewer/preview/CaptionOverlay.tsx` — reads active subtitle clip via `useActiveSubtitle()` and renders styled overlay.
- **Create** `modes/clipcraft/viewer/preview/useActiveSubtitle.ts` — hook that walks subtitle tracks and returns the clip whose `[startTime, startTime+duration)` straddles `usePlayback().currentTime`.
- **Create** `modes/clipcraft/viewer/preview/captionStyle.ts` — default style + merge with sidecar override.
- **Modify** `modes/clipcraft/persistence.ts` — add `captionStyle?: CaptionStyle` to `ProjectFile` (mode-local sidecar, not craft state).

### Task 4 — AssetPanel (Model B)

- **Create** `modes/clipcraft/viewer/assets/AssetPanel.tsx` — tab bar (Assets / Script), assets grid grouped by type, upload + delete.
- **Create** `modes/clipcraft/viewer/assets/AssetGroup.tsx` — per-type section (thumbnail grid or list).
- **Create** `modes/clipcraft/viewer/assets/AssetThumbnail.tsx` — single tile with preview + delete button + error badge.
- **Create** `modes/clipcraft/viewer/assets/AssetLightbox.tsx` — modal preview (image/video/audio).
- **Create** `modes/clipcraft/viewer/assets/ScriptTab.tsx` — scene-by-scene caption list.
- **Create** `modes/clipcraft/viewer/assets/useAssetActions.ts` — `upload(file)` and `remove(assetId)` hooks that dispatch craft commands.
- **Create** `modes/clipcraft/viewer/assets/useAssetErrors.tsx` — mode-local `Map<assetId, string>` via context.
- **Create** `modes/clipcraft/viewer/assets/useAssetMetadata.ts` — reads provenance edge for an asset and extracts `{ prompt, model, params, operation, actor }` from `operation.params`.
- **Create** `modes/clipcraft/viewer/assets/useWorkspaceAssetUrl.ts` — wraps `useAsset(assetId)` + `assetResolver.resolve(asset)` to produce a blob-or-http URL.

### Task 5 — TimelineOverview3D

- **Create** `modes/clipcraft/viewer/overview/TimelineOverview3D.tsx` — outer 3D scene, layer layout math, framer-motion perspective/rotate.
- **Create** `modes/clipcraft/viewer/overview/Layer3D.tsx` — single layer card with per-type content dispatch.
- **Create** `modes/clipcraft/viewer/overview/LayerToggle.tsx` — left sidebar toggle pills.
- **Create** `modes/clipcraft/viewer/overview/OverviewControls.tsx` — camera preset buttons + collapse.
- **Create** `modes/clipcraft/viewer/overview/useOverviewCamera.ts` — preset state machine (`"front" | "side" | "exploded"`).
- **Create** `modes/clipcraft/viewer/overview/layerMapping.ts` — helpers that bucket craft tracks into the legacy `LayerType` ("video" | "audio" | "caption"), with "bgm" collapsed into "audio".
- **Create** `modes/clipcraft/viewer/overview/VideoLayerContent.tsx`, `CaptionLayerContent.tsx`, `AudioLayerContent.tsx` — per-type content renderers using `useFrameExtractor` / `useWaveform`.
- **Create** `modes/clipcraft/viewer/overview/FakeWaveform.tsx` — deterministic fallback waveform.

### Task 6 — ExplodedView

- **Create** `modes/clipcraft/viewer/exploded/ExplodedView.tsx` — fixed side camera, scrollwheel focus shift, escape to collapse.
- **Create** `modes/clipcraft/viewer/exploded/ExplodedLayer.tsx` — per-layer card with active-frame / waveform / caption content.
- **Create** `modes/clipcraft/viewer/exploded/useCurrentFrame.ts` — craft-native frame capture via `subscribeToFrames`, replacing legacy's canvas-from-DOM-video.
- **Create** `modes/clipcraft/viewer/exploded/useActiveSceneAtTime.ts` — resolver: given `currentTime` and the Task 1 scenes, return the active scene + its member clips.

### Task 7 — DiveCanvas

- **Install** `@xyflow/react` and `@dagrejs/dagre` into `package.json`.
- **Create** `modes/clipcraft/viewer/dive/DiveCanvas.tsx` — ReactFlow provider + canvas shell.
- **Create** `modes/clipcraft/viewer/dive/DiveHeader.tsx` — back button + layer badge + prev/next scene.
- **Create** `modes/clipcraft/viewer/dive/useTreeLayout.ts` — dagre layout adapter taking a craft provenance lineage (`useLineage`) and returning xyflow `Node[]` + `Edge[]`.
- **Create** `modes/clipcraft/viewer/dive/useVariantPointer.tsx` — mode-local `Map<clipId, activeAssetId>` context, exposes `get(clipId)` and `set(clipId, assetId)`.
- **Create** `modes/clipcraft/viewer/dive/nodes/NodeShell.tsx` — shared shell (origin badge, status dot, prompt, model, Use This).
- **Create** `modes/clipcraft/viewer/dive/nodes/VisualNode.tsx`, `AudioNode.tsx`, `TextNode.tsx`.

---

## Task 1 — Scene logical layer + persistence extension

**Why first:** Every task below either reads `scenes[]` directly (ScriptTab, DiveHeader, ExplodedView) or expects a resolver that maps scene → clips → assets. Also the seed must ship with scene data so the rest of the work has something to render against.

**Files:**
- `modes/clipcraft/persistence.ts` (modify)
- `modes/clipcraft/seed/project.json` (modify)
- `modes/clipcraft/viewer/scenes/SceneContext.tsx` (create)
- `modes/clipcraft/viewer/scenes/useSceneResolver.ts` (create)
- `modes/clipcraft/__tests__/persistence.scenes.test.ts` (create)
- `modes/clipcraft/__tests__/useSceneResolver.test.ts` (create)

### Steps

- [ ] **Step 1.1** — Extend `ProjectFile` with a `scenes?: ProjectScene[]` field in `modes/clipcraft/persistence.ts`. Scenes are **mode-local**; they do NOT produce craft commands during hydration. Add the type declaration and a pass-through in the validator.

  In `modes/clipcraft/persistence.ts`, add this type near the other on-disk types:

  ```ts
  // ── Scene (mode-local logical grouping) ──────────────────────────────────
  //
  // A Scene is a view over existing craft clips — it does not partition
  // the composition. A clip can belong to 0 or 1 scenes. Scenes survive
  // round-trip but are never dispatched as craft commands: they live only
  // in the mode's React context tree.
  export interface ProjectScene {
    id: string;
    order: number;
    title: string;
    prompt?: string;
    memberClipIds: string[];
    memberAssetIds: string[];
  }
  ```

  Then update `ProjectFile`:

  ```ts
  export interface ProjectFile {
    $schema: "pneuma-craft/project/v1";
    title: string;
    composition: ProjectComposition;
    assets: ProjectAsset[];
    provenance: ProjectProvenanceEdge[];
    /** Mode-local scene grouping — optional; not part of craft state. */
    scenes?: ProjectScene[];
    /** Mode-local caption overlay styling — see Task 3. */
    captionStyle?: CaptionStyle;
  }
  ```

  (`CaptionStyle` is defined in Task 3; forward-declare it as `export interface CaptionStyle { fontSize?: number; color?: string; background?: string; bottomPercent?: number; }` in the same file for now, so Task 3 only has to fill in the default.)

- [ ] **Step 1.2** — Add a light validator pass to `validateProjectFile` that tolerates missing `scenes` (schema bump is **not** needed — the field is optional and old files remain valid). Insert immediately before the `return { ok: true, ... }`:

  ```ts
    if (value.scenes !== undefined) {
      if (!Array.isArray(value.scenes)) {
        return { ok: false, error: "scenes must be an array" };
      }
      for (const s of value.scenes) {
        if (!isObject(s)) return { ok: false, error: "scene entries must be objects" };
        if (typeof s.id !== "string") return { ok: false, error: "scene.id must be a string" };
        if (typeof s.order !== "number") return { ok: false, error: "scene.order must be a number" };
        if (typeof s.title !== "string") return { ok: false, error: "scene.title must be a string" };
        if (!Array.isArray(s.memberClipIds)) return { ok: false, error: "scene.memberClipIds must be an array" };
        if (!Array.isArray(s.memberAssetIds)) return { ok: false, error: "scene.memberAssetIds must be an array" };
      }
    }
    if (value.captionStyle !== undefined && !isObject(value.captionStyle)) {
      return { ok: false, error: "captionStyle must be an object" };
    }
  ```

- [ ] **Step 1.3** — Thread scenes through `serializeProject`. Since scenes are not held in craft, they must ride out-of-band. Change the signature to accept an extra `scenes` argument (and the caller — `ClipCraftPreview.tsx` — will be updated in Task 2 to pass them in):

  Replace the `serializeProject` signature with:

  ```ts
  export function serializeProject(
    coreState: PneumaCraftCoreState,
    composition: Composition | null,
    title: string = "Untitled",
    scenes: ProjectScene[] = [],
    captionStyle: CaptionStyle | undefined = undefined,
  ): ProjectFile {
  ```

  And at the bottom, replace the `return` block:

  ```ts
    return {
      $schema: "pneuma-craft/project/v1",
      title,
      composition: { settings, tracks, transitions },
      assets,
      provenance,
      ...(scenes.length > 0 ? { scenes } : {}),
      ...(captionStyle !== undefined ? { captionStyle } : {}),
    };
  }
  ```

- [ ] **Step 1.4** — `projectFileToCommands` does NOT emit scene-related envelopes. Add a one-line comment so nobody is tempted to port them into craft later:

  Locate the comment block above `projectFileToCommands` and append:

  ```ts
   *
   * NOTE: scenes[] and captionStyle are deliberately ignored here. They are
   * mode-local UI state owned by the ClipCraft viewer's React tree and never
   * round-trip through the craft store. Task 2+ reads them via useScenes().
  ```

- [ ] **Step 1.5** — Seed two demo scenes in `modes/clipcraft/seed/project.json`. Both reference the existing `clip-1`:

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
      "tracks": [
        {
          "id": "track-video-1",
          "type": "video",
          "name": "Main",
          "muted": false,
          "volume": 1,
          "locked": false,
          "visible": true,
          "clips": [
            {
              "id": "clip-1",
              "assetId": "seed-asset-sample",
              "startTime": 0,
              "duration": 5,
              "inPoint": 0,
              "outPoint": 5
            }
          ]
        }
      ],
      "transitions": []
    },
    "assets": [
      {
        "id": "seed-asset-sample",
        "type": "video",
        "uri": "assets/sample.mp4",
        "name": "Sample Clip",
        "metadata": {
          "width": 320,
          "height": 180,
          "duration": 5,
          "fps": 15,
          "codec": "h264"
        },
        "createdAt": 1712934000000,
        "tags": ["seed-example"]
      },
      {
        "id": "seed-asset-pending",
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
        "toAssetId": "seed-asset-sample",
        "fromAssetId": null,
        "operation": {
          "type": "import",
          "actor": "human",
          "timestamp": 1712934000000,
          "label": "bundled seed image"
        }
      },
      {
        "toAssetId": "seed-asset-pending",
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
    ],
    "scenes": [
      {
        "id": "scene-1",
        "order": 0,
        "title": "Opening",
        "prompt": "Establishing shot of the forest",
        "memberClipIds": ["clip-1"],
        "memberAssetIds": ["seed-asset-sample"]
      },
      {
        "id": "scene-2",
        "order": 1,
        "title": "Discovery",
        "prompt": "Reveal the hidden structure",
        "memberClipIds": [],
        "memberAssetIds": ["seed-asset-pending"]
      }
    ]
  }
  ```

- [ ] **Step 1.6** — Create `modes/clipcraft/viewer/scenes/SceneContext.tsx`. This context carries the scenes array and a setter. The setter is a stub in Plan 6 — editing is deferred — but shape it as `(updater: (prev: ProjectScene[]) => ProjectScene[]) => void` so Plan 7 can wire it to `writeProject` without touching the interface.

  ```tsx
  import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
  import type { ProjectScene } from "../../persistence.js";

  interface SceneContextValue {
    scenes: ProjectScene[];
    setScenes: (updater: (prev: ProjectScene[]) => ProjectScene[]) => void;
    selectedSceneId: string | null;
    setSelectedSceneId: (id: string | null) => void;
  }

  const SceneContext = createContext<SceneContextValue | null>(null);

  export interface SceneProviderProps {
    initialScenes: ProjectScene[];
    onScenesChange?: (next: ProjectScene[]) => void;
    children: React.ReactNode;
  }

  /**
   * Holds the mode-local scenes[] array. Scenes are ordered by `order` at
   * read time via `useScenes()`. In Plan 6 there is no edit path; `setScenes`
   * exists only so Plan 7 can wire it up without breaking this interface.
   */
  export function SceneProvider({ initialScenes, onScenesChange, children }: SceneProviderProps) {
    const [scenes, setScenesState] = useState<ProjectScene[]>(initialScenes);
    const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
      initialScenes[0]?.id ?? null,
    );

    const setScenes = useCallback(
      (updater: (prev: ProjectScene[]) => ProjectScene[]) => {
        setScenesState((prev) => {
          const next = updater(prev);
          onScenesChange?.(next);
          return next;
        });
      },
      [onScenesChange],
    );

    const value = useMemo<SceneContextValue>(
      () => ({ scenes, setScenes, selectedSceneId, setSelectedSceneId }),
      [scenes, setScenes, selectedSceneId],
    );

    return <SceneContext.Provider value={value}>{children}</SceneContext.Provider>;
  }

  export function useScenes(): ProjectScene[] {
    const ctx = useContext(SceneContext);
    if (!ctx) throw new Error("useScenes must be used inside <SceneProvider>");
    return useMemo(
      () => [...ctx.scenes].sort((a, b) => a.order - b.order),
      [ctx.scenes],
    );
  }

  export function useSceneSelection() {
    const ctx = useContext(SceneContext);
    if (!ctx) throw new Error("useSceneSelection must be used inside <SceneProvider>");
    return {
      selectedSceneId: ctx.selectedSceneId,
      setSelectedSceneId: ctx.setSelectedSceneId,
    };
  }

  export function useSetScenes() {
    const ctx = useContext(SceneContext);
    if (!ctx) throw new Error("useSetScenes must be used inside <SceneProvider>");
    return ctx.setScenes;
  }
  ```

- [ ] **Step 1.7** — Create `modes/clipcraft/viewer/scenes/useSceneResolver.ts`. Given a `sceneId`, return the member clips, member asset ids, the time envelope (`startTime = min(clip.startTime)`, `endTime = max(clip.startTime + clip.duration)` across referenced clips), and the set of referenced-but-missing clip ids (useful for diagnostics when the agent deletes a clip without updating its scene membership):

  ```ts
  import { useMemo } from "react";
  import { useComposition } from "@pneuma-craft/react";
  import type { Clip } from "@pneuma-craft/timeline";
  import { useScenes } from "./SceneContext.js";
  import type { ProjectScene } from "../../persistence.js";

  export interface ResolvedScene {
    scene: ProjectScene;
    clips: Clip[];
    memberAssetIds: string[];
    startTime: number;
    endTime: number;
    duration: number;
    missingClipIds: string[];
  }

  /**
   * Resolve a scene id to its concrete clip set and time envelope.
   *
   * The envelope is inclusive of all referenced clips regardless of track —
   * a scene can span multiple tracks (e.g. a video clip and its subtitle).
   * When a scene references a clip that doesn't exist in the composition,
   * it is listed in `missingClipIds` and silently excluded from the envelope.
   * Callers can ignore `missingClipIds` in the happy path.
   */
  export function useSceneResolver(sceneId: string | null): ResolvedScene | null {
    const composition = useComposition();
    const scenes = useScenes();

    return useMemo(() => {
      if (!sceneId) return null;
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return null;

      const allClips: Clip[] = [];
      for (const track of composition?.tracks ?? []) {
        for (const clip of track.clips) allClips.push(clip);
      }
      const byId = new Map(allClips.map((c) => [c.id, c] as const));

      const foundClips: Clip[] = [];
      const missingClipIds: string[] = [];
      for (const id of scene.memberClipIds) {
        const c = byId.get(id);
        if (c) foundClips.push(c);
        else missingClipIds.push(id);
      }

      let startTime = Infinity;
      let endTime = 0;
      for (const clip of foundClips) {
        if (clip.startTime < startTime) startTime = clip.startTime;
        const end = clip.startTime + clip.duration;
        if (end > endTime) endTime = end;
      }
      if (!Number.isFinite(startTime)) startTime = 0;

      return {
        scene,
        clips: foundClips,
        memberAssetIds: [...scene.memberAssetIds],
        startTime,
        endTime,
        duration: Math.max(0, endTime - startTime),
        missingClipIds,
      };
    }, [sceneId, scenes, composition]);
  }
  ```

- [ ] **Step 1.8** — Persistence round-trip test. `modes/clipcraft/__tests__/persistence.scenes.test.ts`:

  ```ts
  import { describe, expect, it } from "bun:test";
  import {
    parseProjectFile,
    formatProjectJson,
    type ProjectFile,
  } from "../persistence.js";

  const FIXTURE: ProjectFile = {
    $schema: "pneuma-craft/project/v1",
    title: "Scene Round-Trip",
    composition: {
      settings: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" },
      tracks: [
        {
          id: "track-video-1",
          type: "video",
          name: "Main",
          muted: false,
          volume: 1,
          locked: false,
          visible: true,
          clips: [
            {
              id: "clip-1",
              assetId: "asset-a",
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
        id: "asset-a",
        type: "video",
        uri: "assets/a.mp4",
        name: "A",
        metadata: {},
        createdAt: 1700000000000,
      },
    ],
    provenance: [],
    scenes: [
      {
        id: "scene-1",
        order: 0,
        title: "Opening",
        prompt: "establishing shot",
        memberClipIds: ["clip-1"],
        memberAssetIds: ["asset-a"],
      },
      {
        id: "scene-2",
        order: 1,
        title: "B-roll",
        memberClipIds: [],
        memberAssetIds: [],
      },
    ],
  };

  describe("persistence — scenes round-trip", () => {
    it("parse(format(x)) === x", () => {
      const json = formatProjectJson(FIXTURE);
      const parsed = parseProjectFile(json);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value).toEqual(FIXTURE);
      }
    });

    it("tolerates missing scenes[] on old files", () => {
      const old: Omit<ProjectFile, "scenes"> = {
        ...FIXTURE,
      };
      delete (old as { scenes?: unknown }).scenes;
      const parsed = parseProjectFile(JSON.stringify(old));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.scenes).toBeUndefined();
      }
    });

    it("rejects non-array scenes", () => {
      const bad = { ...FIXTURE, scenes: "not an array" };
      const parsed = parseProjectFile(JSON.stringify(bad));
      expect(parsed.ok).toBe(false);
    });

    it("rejects scene entries with wrong shape", () => {
      const bad = {
        ...FIXTURE,
        scenes: [{ id: 123, order: 0, title: "x", memberClipIds: [], memberAssetIds: [] }],
      };
      const parsed = parseProjectFile(JSON.stringify(bad));
      expect(parsed.ok).toBe(false);
    });
  });
  ```

- [ ] **Step 1.9** — Resolver test `modes/clipcraft/__tests__/useSceneResolver.test.ts`. Test the pure resolution logic by pulling it into a standalone function inside the same module (or by testing via `@testing-library/react`). The simplest path is to extract a pure helper `resolveScene(scene, composition)` and keep `useSceneResolver` as the thin wrapper:

  First, refactor `modes/clipcraft/viewer/scenes/useSceneResolver.ts` to export the pure helper alongside the hook:

  ```ts
  // At the top of useSceneResolver.ts, above the hook, add:
  export function resolveScene(
    scene: ProjectScene,
    allClips: Clip[],
  ): ResolvedScene {
    const byId = new Map(allClips.map((c) => [c.id, c] as const));
    const foundClips: Clip[] = [];
    const missingClipIds: string[] = [];
    for (const id of scene.memberClipIds) {
      const c = byId.get(id);
      if (c) foundClips.push(c);
      else missingClipIds.push(id);
    }
    let startTime = Infinity;
    let endTime = 0;
    for (const clip of foundClips) {
      if (clip.startTime < startTime) startTime = clip.startTime;
      const end = clip.startTime + clip.duration;
      if (end > endTime) endTime = end;
    }
    if (!Number.isFinite(startTime)) startTime = 0;
    return {
      scene,
      clips: foundClips,
      memberAssetIds: [...scene.memberAssetIds],
      startTime,
      endTime,
      duration: Math.max(0, endTime - startTime),
      missingClipIds,
    };
  }
  ```

  And have the hook delegate to it:

  ```ts
  export function useSceneResolver(sceneId: string | null): ResolvedScene | null {
    const composition = useComposition();
    const scenes = useScenes();
    return useMemo(() => {
      if (!sceneId) return null;
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return null;
      const allClips: Clip[] = [];
      for (const track of composition?.tracks ?? []) {
        for (const clip of track.clips) allClips.push(clip);
      }
      return resolveScene(scene, allClips);
    }, [sceneId, scenes, composition]);
  }
  ```

  Then the test file:

  ```ts
  import { describe, expect, it } from "bun:test";
  import type { Clip } from "@pneuma-craft/timeline";
  import { resolveScene } from "../viewer/scenes/useSceneResolver.js";
  import type { ProjectScene } from "../persistence.js";

  const clip = (id: string, startTime: number, duration: number): Clip => ({
    id,
    assetId: `asset-${id}`,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
  });

  describe("resolveScene", () => {
    const clips: Clip[] = [clip("a", 0, 5), clip("b", 5, 3), clip("c", 10, 2)];

    it("resolves member clips and computes envelope", () => {
      const scene: ProjectScene = {
        id: "s1",
        order: 0,
        title: "t",
        memberClipIds: ["a", "b"],
        memberAssetIds: ["asset-a", "asset-b"],
      };
      const r = resolveScene(scene, clips);
      expect(r.clips.map((c) => c.id)).toEqual(["a", "b"]);
      expect(r.startTime).toBe(0);
      expect(r.endTime).toBe(8);
      expect(r.duration).toBe(8);
      expect(r.missingClipIds).toEqual([]);
    });

    it("tracks missing clip ids without throwing", () => {
      const scene: ProjectScene = {
        id: "s2",
        order: 0,
        title: "t",
        memberClipIds: ["a", "ghost"],
        memberAssetIds: [],
      };
      const r = resolveScene(scene, clips);
      expect(r.missingClipIds).toEqual(["ghost"]);
      expect(r.clips.map((c) => c.id)).toEqual(["a"]);
      expect(r.endTime).toBe(5);
    });

    it("empty scene yields 0-duration envelope", () => {
      const scene: ProjectScene = {
        id: "s3",
        order: 0,
        title: "t",
        memberClipIds: [],
        memberAssetIds: [],
      };
      const r = resolveScene(scene, clips);
      expect(r.startTime).toBe(0);
      expect(r.endTime).toBe(0);
      expect(r.duration).toBe(0);
    });
  });
  ```

- [ ] **Step 1.10** — Run `bun test` in the repo root and confirm the two new test files pass alongside the existing 653+ tests.

**Draft commit message:**

```
feat(clipcraft): scene logical layer + persistence extension (Plan 6 Task 1)

Add mode-local ProjectScene to project.json (optional scenes[] field),
round-trip through parse/serialize, seed two demo scenes in the seed
project, and expose useScenes/useSceneResolver for downstream tasks.
Scenes are views, not partitions: they reference existing craft clips
by id and never dispatch craft commands. Missing-clip tolerance is
tested.
```

---

## Task 2 — ClipCraftLayout + TimelineShell shell

**Why:** The rest of the tasks render into slots that this shell defines. Everything from Task 3 onward assumes `ClipCraftLayout` exists, owns the `timelineMode` state, and mounts the expand/collapse animation.

**Files:**
- `modes/clipcraft/viewer/layout/ClipCraftLayout.tsx` (create)
- `modes/clipcraft/viewer/layout/TimelineShell.tsx` (create)
- `modes/clipcraft/viewer/hooks/useTimelineMode.ts` (create)
- `modes/clipcraft/viewer/hooks/useTimelineZoomShared.ts` (create)
- `modes/clipcraft/viewer/PreviewPanel.tsx` (modify — becomes a shim)
- `modes/clipcraft/viewer/ClipCraftPreview.tsx` (modify — wrap in SceneProvider + TimelineModeProvider)

### Steps

- [ ] **Step 2.1** — Create `modes/clipcraft/viewer/hooks/useTimelineMode.ts`. The context owns `timelineMode`, `diveLayer`, and `focusedLayer`. Keeping all three together lets the exploded view (Task 6) and the dive canvas (Task 7) read and write the same state without prop-drilling.

  ```tsx
  import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

  export type TimelineMode = "collapsed" | "overview" | "exploded" | "dive";
  export type LayerType = "video" | "audio" | "caption";

  interface TimelineModeContextValue {
    timelineMode: TimelineMode;
    setTimelineMode: (mode: TimelineMode) => void;
    diveLayer: LayerType | null;
    setDiveLayer: (layer: LayerType | null) => void;
    focusedLayer: LayerType | null;
    setFocusedLayer: (layer: LayerType | null) => void;
  }

  const TimelineModeContext = createContext<TimelineModeContextValue | null>(null);

  export function TimelineModeProvider({ children }: { children: React.ReactNode }) {
    const [timelineMode, setTimelineMode] = useState<TimelineMode>("collapsed");
    const [diveLayer, setDiveLayer] = useState<LayerType | null>(null);
    const [focusedLayer, setFocusedLayer] = useState<LayerType | null>(null);

    const value = useMemo<TimelineModeContextValue>(
      () => ({
        timelineMode,
        setTimelineMode,
        diveLayer,
        setDiveLayer,
        focusedLayer,
        setFocusedLayer,
      }),
      [timelineMode, diveLayer, focusedLayer],
    );

    return (
      <TimelineModeContext.Provider value={value}>
        {children}
      </TimelineModeContext.Provider>
    );
  }

  export function useTimelineMode() {
    const ctx = useContext(TimelineModeContext);
    if (!ctx) throw new Error("useTimelineMode must be used inside <TimelineModeProvider>");
    return ctx;
  }
  ```

- [ ] **Step 2.2** — Create `modes/clipcraft/viewer/hooks/useTimelineZoomShared.ts`. The existing `modes/clipcraft/viewer/timeline/hooks/useTimelineZoom.ts` is an internal hook bound to a specific container ref. Wrap it in a context so the compact `Timeline` (Plan 5) and the 3D overview (Task 5) share a single pixelsPerSecond + scrollLeft pair. In Plan 6, only the shared mutable state and the accessor matter — the container-ref wiring stays in each individual component (they each call `useTimelineZoom` against their own ref, passing the shared state through via the context setter).

  ```tsx
  import React, { createContext, useContext, useMemo, useState } from "react";

  export interface SharedZoomState {
    pixelsPerSecond: number;
    scrollLeft: number;
  }

  interface ZoomContextValue {
    zoom: SharedZoomState;
    setZoom: (updater: (prev: SharedZoomState) => SharedZoomState) => void;
  }

  const ZoomContext = createContext<ZoomContextValue | null>(null);

  const INITIAL: SharedZoomState = { pixelsPerSecond: 60, scrollLeft: 0 };

  export function TimelineZoomProvider({ children }: { children: React.ReactNode }) {
    const [zoom, setZoomState] = useState<SharedZoomState>(INITIAL);
    const setZoom = (updater: (prev: SharedZoomState) => SharedZoomState) => {
      setZoomState((prev) => updater(prev));
    };
    const value = useMemo(() => ({ zoom, setZoom }), [zoom]);
    return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>;
  }

  export function useSharedZoom() {
    const ctx = useContext(ZoomContext);
    if (!ctx) throw new Error("useSharedZoom must be used inside <TimelineZoomProvider>");
    return ctx;
  }
  ```

  NOTE: in Plan 6 the compact `Timeline` (Plan 5) still reads its own local zoom via `useTimelineZoom`. Integration with `useSharedZoom` is a follow-up; `TimelineZoomProvider` is installed in Step 2.6 so that the overview has somewhere to read a placeholder from. Sharing actually takes effect in Task 5 Step 5.8.

- [ ] **Step 2.3** — Create `modes/clipcraft/viewer/layout/ClipCraftLayout.tsx`. This is the top/bottom shell. The top half (AssetPanel + VideoPreview) collapses to `0` flex-basis when the timeline is expanded, exactly like legacy. Both `AssetPanel` and `VideoPreview` are stubbed in Task 2 — they become real in Tasks 3 and 4.

  ```tsx
  import { useTimelineMode } from "../hooks/useTimelineMode.js";
  import { TimelineShell } from "./TimelineShell.js";

  /**
   * ClipCraft's outer layout:
   *
   *   ┌────────────────┬──────────────────────────┐
   *   │  AssetPanel    │    VideoPreview          │
   *   │  (Task 4)      │    (Task 3)              │
   *   ├────────────────┴──────────────────────────┤
   *   │   TimelineShell — collapsed / overview /  │
   *   │   exploded / dive (Tasks 5 / 6 / 7)       │
   *   └───────────────────────────────────────────┘
   *
   * When `timelineMode !== "collapsed"`, the top half animates its flex-basis
   * to 0 and the shell takes the full height. Legacy reference:
   * modes/clipcraft-legacy/viewer/layout/ClipCraftLayout.tsx.
   */
  export function ClipCraftLayout() {
    const { timelineMode } = useTimelineMode();
    const isExpanded = timelineMode !== "collapsed";

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "#09090b",
          color: "#e4e4e7",
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: isExpanded ? "0 0 0px" : "1 1 60%",
            opacity: isExpanded ? 0 : 1,
            display: "flex",
            minHeight: 0,
            borderBottom: "1px solid #27272a",
            overflow: "hidden",
            transition:
              "flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
          }}
        >
          <AssetPanelPlaceholder />
          <div style={{ flex: 1, minWidth: 0 }}>
            <VideoPreviewPlaceholder />
          </div>
        </div>

        <TimelineShell />
      </div>
    );
  }

  function AssetPanelPlaceholder() {
    return (
      <div
        style={{
          width: 220,
          minWidth: 220,
          background: "#111113",
          borderRight: "1px solid #27272a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#52525b",
          fontSize: 11,
        }}
      >
        AssetPanel (Task 4)
      </div>
    );
  }

  function VideoPreviewPlaceholder() {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#52525b",
          fontSize: 11,
        }}
      >
        VideoPreview (Task 3)
      </div>
    );
  }
  ```

- [ ] **Step 2.4** — Create `modes/clipcraft/viewer/layout/TimelineShell.tsx`. Holds the Plan-5 `Timeline` pinned at the bottom via `flexDirection: column-reverse`, and conditionally renders the overview / exploded / dive above it. In Task 2, the overview / exploded / dive content is a trio of stubs.

  ```tsx
  import { useCallback, useEffect } from "react";
  import { Timeline } from "../timeline/Timeline.js";
  import { useTimelineMode, type TimelineMode } from "../hooks/useTimelineMode.js";

  /**
   * Timeline shell. Legacy reference:
   * modes/clipcraft-legacy/viewer/timeline/TimelineShell.tsx.
   *
   * Column-reverse pins the always-visible Timeline at the bottom. The
   * expanded panel (overview / exploded / dive) grows above it when
   * timelineMode !== "collapsed".
   *
   * The expand/collapse button is the ↑/↓ toggle rendered inside the
   * Plan 5 Timeline via a prop slot — Plan 5's Timeline does not yet accept
   * a leading control, so Task 2 renders it as a floating overlay instead
   * and Task 5 revises Timeline to accept the prop.
   */
  export function TimelineShell() {
    const { timelineMode, setTimelineMode } = useTimelineMode();
    const isExpanded = timelineMode !== "collapsed";

    const handleToggle = useCallback(() => {
      setTimelineMode(isExpanded ? "collapsed" : "overview");
    }, [isExpanded, setTimelineMode]);

    useEffect(() => {
      if (!isExpanded) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") setTimelineMode("collapsed");
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [isExpanded, setTimelineMode]);

    return (
      <div
        style={{
          flex: isExpanded ? "1 1 100%" : "0 0 auto",
          display: "flex",
          flexDirection: "column-reverse",
          background: "#09090b",
          borderTop: "1px solid #27272a",
          overflow: "hidden",
          transition: "flex 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          position: "relative",
        }}
      >
        {/* Timeline — pinned at bottom */}
        <div style={{ flexShrink: 0, position: "relative" }}>
          <Timeline />
          {/* Floating expand/collapse toggle — top-right of the timeline
              bar. Task 5 will migrate this into a proper leadingControl
              prop on Timeline. */}
          <button
            onClick={handleToggle}
            title={isExpanded ? "Collapse" : "Expand 3D view"}
            style={{
              position: "absolute",
              top: 6,
              right: 12,
              width: 22,
              height: 22,
              border: "1px solid #3f3f46",
              borderRadius: 3,
              background: isExpanded ? "#27272a" : "transparent",
              color: isExpanded ? "#f97316" : "#a1a1aa",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              zIndex: 20,
            }}
          >
            {isExpanded ? "↓" : "↑"}
          </button>
        </div>

        {/* Expanded panel */}
        {isExpanded && <ExpandedPanel mode={timelineMode} />}
      </div>
    );
  }

  function ExpandedPanel({ mode }: { mode: TimelineMode }) {
    return (
      <div
        style={{
          flex: "1 1 auto",
          overflow: "hidden",
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#52525b",
          fontSize: 12,
        }}
      >
        {mode === "overview" && "TimelineOverview3D (Task 5)"}
        {mode === "exploded" && "ExplodedView (Task 6)"}
        {mode === "dive" && "DiveCanvas (Task 7)"}
      </div>
    );
  }
  ```

- [ ] **Step 2.5** — Rewrite `modes/clipcraft/viewer/PreviewPanel.tsx` to delegate to `ClipCraftLayout`. The existing `StateDump` stays accessible via a collapsed `<details>` so Plan 2's debug affordance is preserved.

  ```tsx
  import { ClipCraftLayout } from "./layout/ClipCraftLayout.js";
  import { StateDump } from "./StateDump.js";

  export interface PreviewPanelProps {
    hydrationError: string | null;
  }

  /**
   * Plan 6 layout shell. The Plan 4 canvas + Plan 5 timeline + PlaybackControls
   * are owned by ClipCraftLayout; PreviewPanel is a thin shim that keeps
   * the debug StateDump accessible behind a collapsed details element.
   */
  export function PreviewPanel({ hydrationError }: PreviewPanelProps) {
    return (
      <div
        className="cc-preview-panel"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "#09090b",
          color: "#e4e4e7",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          <ClipCraftLayout />
        </div>
        <details style={{ borderTop: "1px solid #27272a", padding: "4px 12px" }}>
          <summary
            style={{ cursor: "pointer", color: "#a1a1aa", fontSize: 11 }}
          >
            debug · StateDump
          </summary>
          <StateDump hydrationError={hydrationError} />
        </details>
      </div>
    );
  }
  ```

- [ ] **Step 2.6** — Wire providers inside `modes/clipcraft/viewer/ClipCraftPreview.tsx` so every downstream component can reach `useScenes`, `useTimelineMode`, and `useSharedZoom`. `SceneProvider.initialScenes` comes from `project.scenes ?? []`. `onScenesChange` is omitted in Plan 6 (editing deferred).

  Modify `SyncedBody` in `ClipCraftPreview.tsx`. Near the top of the file add imports:

  ```tsx
  import { SceneProvider } from "./scenes/SceneContext.js";
  import { TimelineModeProvider } from "./hooks/useTimelineMode.js";
  import { TimelineZoomProvider } from "./hooks/useTimelineZoomShared.js";
  ```

  Then change the `return` of `SyncedBody` from:

  ```tsx
  return <PreviewPanel hydrationError={hydrationError} />;
  ```

  To:

  ```tsx
  return (
    <SceneProvider initialScenes={project?.scenes ?? []}>
      <TimelineModeProvider>
        <TimelineZoomProvider>
          <PreviewPanel hydrationError={hydrationError} />
        </TimelineZoomProvider>
      </TimelineModeProvider>
    </SceneProvider>
  );
  ```

  IMPORTANT: `SceneProvider` is a state-holding component, so re-running it when `project?.scenes` identity changes is safe — it only re-reads the `initialScenes` on mount. When the parent remounts via `providerKey` (Plan 3b echo guard), the fresh mount gets the fresh scenes.

- [ ] **Step 2.7** — Update the autosave call in `ClipCraftPreview.tsx`. Currently it passes `(coreState, composition, currentTitleRef.current)`. Because Task 1 extended `serializeProject` with a `scenes` argument, pass the current scenes from context. Since `SyncedBody` sits inside `SceneProvider`, add a `useScenes()` call at the top of `SyncedBody`:

  Add import:

  ```tsx
  import { useScenes } from "./scenes/SceneContext.js";
  ```

  Wait — `SyncedBody` is the parent of `SceneProvider`. Re-order: move `SceneProvider` and `TimelineModeProvider` **above** `SyncedBody` so `SyncedBody` can `useScenes()`. The new component layout is:

  ```tsx
  const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ sources }) => {
    // ... existing setup ...

    return (
      <PneumaCraftProvider key={providerKey} assetResolver={assetResolver}>
        <SceneProvider initialScenes={project?.scenes ?? []}>
          <TimelineModeProvider>
            <TimelineZoomProvider>
              <SyncedBody
                project={project}
                writeProject={writeProject}
                currentTitleRef={currentTitleRef}
                hydrationError={errorMessage}
              />
            </TimelineZoomProvider>
          </TimelineModeProvider>
        </SceneProvider>
      </PneumaCraftProvider>
    );
  };
  ```

  Then inside `SyncedBody`, read scenes and thread them to `serializeProject`:

  ```tsx
  function SyncedBody({ project, writeProject, currentTitleRef, hydrationError }: {
    project: ProjectFile | null;
    writeProject: (value: ProjectFile) => Promise<void>;
    currentTitleRef: React.MutableRefObject<string>;
    hydrationError: string | null;
  }) {
    const dispatchEnvelope = usePneumaCraftStore((s) => s.dispatchEnvelope);
    const coreState = usePneumaCraftStore((s) => s.coreState);
    const composition = usePneumaCraftStore((s) => s.composition);
    const eventCount = useEventLog().length;
    const scenes = useScenes();
    const captionStyle = project?.captionStyle;

    // ... existing hydration effect unchanged ...

    useEffect(() => {
      if (!hasHydratedRef.current) return;
      const timer = setTimeout(async () => {
        const file = serializeProject(
          coreState,
          composition,
          currentTitleRef.current,
          scenes,
          captionStyle,
        );
        try {
          await writeProject(file);
        } catch (err) {
          console.error("[clipcraft] autosave failed", err);
        }
      }, AUTOSAVE_DELAY_MS);
      return () => clearTimeout(timer);
    }, [eventCount, writeProject, scenes, captionStyle]);

    return <PreviewPanel hydrationError={hydrationError} />;
  }
  ```

- [ ] **Step 2.8** — Run `bun test` and a manual smoke check: `bun run dev clipcraft`. Expect:
  - The layout shell renders with the Plan 5 Timeline pinned at the bottom.
  - Clicking the ↑ button expands the bottom half and fills it with the "TimelineOverview3D (Task 5)" stub message.
  - Pressing Escape collapses it.
  - The AssetPanel placeholder and VideoPreview placeholder occupy the top half when collapsed.
  - Debug `<details>` still opens the StateDump.
- [ ] **Step 2.9** — Visual check via `chrome-devtools-mcp` screenshot. Must match the legacy shell proportions (220px asset sidebar, video area filling the rest, timeline pinned at bottom).

**Draft commit message:**

```
feat(clipcraft): ClipCraftLayout + TimelineShell mode-switch shell (Plan 6 Task 2)

Wire the top/bottom layout shell with expand/collapse animation, a
mode-local TimelineModeProvider ("collapsed" | "overview" | "exploded" |
"dive"), a SceneProvider fed from project.scenes, and a
TimelineZoomProvider placeholder for the shared zoom. PreviewPanel
becomes a shim that mounts ClipCraftLayout while keeping the debug
StateDump accessible. Overview/exploded/dive panels render stub
content; real viewers land in Tasks 5/6/7.
```

---

## Task 3 — VideoPreview with caption overlay

**Why:** Fills the top-right area. Must use craft's `PreviewRoot` canvas (already wired in Plan 4), NOT legacy's multi-`<video>` DOM pipeline. Caption overlay is a thin DOM layer above the canvas that reads the active subtitle clip via `useActiveSubtitle`.

**Files:**
- `modes/clipcraft/viewer/preview/VideoPreview.tsx` (create)
- `modes/clipcraft/viewer/preview/CaptionOverlay.tsx` (create)
- `modes/clipcraft/viewer/preview/useActiveSubtitle.ts` (create)
- `modes/clipcraft/viewer/preview/captionStyle.ts` (create)
- `modes/clipcraft/persistence.ts` (modify — fill in CaptionStyle definition, already forward-declared in Task 1)
- `modes/clipcraft/viewer/layout/ClipCraftLayout.tsx` (modify — drop the placeholder, import real VideoPreview)

### Steps

- [ ] **Step 3.1** — Replace the forward-declared `CaptionStyle` in `modes/clipcraft/persistence.ts` with the full shape:

  ```ts
  /**
   * Caption overlay styling — mode-local sidecar. Rendered on top of the
   * craft preview canvas by modes/clipcraft/viewer/preview/CaptionOverlay.
   * All fields optional so legacy project files remain valid.
   */
  export interface CaptionStyle {
    fontSize?: number;       // px, default 16
    color?: string;          // default "#ffffff"
    background?: string;     // default "rgba(0,0,0,0.65)"
    bottomPercent?: number;  // 0..1, default 0.08
    fontWeight?: number;     // default 400
    maxWidthPercent?: number; // default 0.9
  }
  ```

- [ ] **Step 3.2** — Create `modes/clipcraft/viewer/preview/captionStyle.ts` with the default + merge helper:

  ```ts
  import type { CaptionStyle } from "../../persistence.js";

  export const DEFAULT_CAPTION_STYLE: Required<CaptionStyle> = {
    fontSize: 16,
    color: "#ffffff",
    background: "rgba(0, 0, 0, 0.65)",
    bottomPercent: 0.08,
    fontWeight: 400,
    maxWidthPercent: 0.9,
  };

  export function resolveCaptionStyle(
    override: CaptionStyle | undefined,
  ): Required<CaptionStyle> {
    return { ...DEFAULT_CAPTION_STYLE, ...(override ?? {}) };
  }
  ```

- [ ] **Step 3.3** — Create `modes/clipcraft/viewer/preview/useActiveSubtitle.ts`. It walks every subtitle track's clips and returns the clip whose `[startTime, startTime + duration)` interval contains `usePlayback().currentTime`. If more than one subtitle track has an active clip at the same time, the first one wins (tracks sorted by their natural order in the composition).

  ```ts
  import { useMemo } from "react";
  import { useComposition, usePlayback } from "@pneuma-craft/react";
  import type { Clip } from "@pneuma-craft/timeline";

  export function useActiveSubtitle(): Clip | null {
    const composition = useComposition();
    const { currentTime } = usePlayback();
    return useMemo(() => {
      if (!composition) return null;
      for (const track of composition.tracks) {
        if (track.type !== "subtitle") continue;
        for (const clip of track.clips) {
          const end = clip.startTime + clip.duration;
          if (currentTime >= clip.startTime && currentTime < end) {
            return clip;
          }
        }
      }
      return null;
    }, [composition, currentTime]);
  }
  ```

- [ ] **Step 3.4** — Create `modes/clipcraft/viewer/preview/CaptionOverlay.tsx`. Reads the active subtitle clip and the caption style, renders a positioned element absolutely over the canvas. When no caption is active, renders `null`.

  ```tsx
  import { useActiveSubtitle } from "./useActiveSubtitle.js";
  import { resolveCaptionStyle } from "./captionStyle.js";
  import type { CaptionStyle } from "../../persistence.js";

  export interface CaptionOverlayProps {
    style?: CaptionStyle;
  }

  export function CaptionOverlay({ style }: CaptionOverlayProps) {
    const clip = useActiveSubtitle();
    const resolved = resolveCaptionStyle(style);

    if (!clip || !clip.text) return null;

    return (
      <div
        style={{
          position: "absolute",
          bottom: `${resolved.bottomPercent * 100}%`,
          left: "50%",
          transform: "translateX(-50%)",
          background: resolved.background,
          color: resolved.color,
          fontSize: resolved.fontSize,
          fontWeight: resolved.fontWeight,
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          padding: "6px 16px",
          borderRadius: 4,
          maxWidth: `${resolved.maxWidthPercent * 100}%`,
          textAlign: "center",
          lineHeight: 1.4,
          whiteSpace: "pre-wrap",
          textShadow: "0 1px 3px rgba(0,0,0,0.6)",
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {clip.text}
      </div>
    );
  }
  ```

- [ ] **Step 3.5** — Create `modes/clipcraft/viewer/preview/VideoPreview.tsx`. Uses craft's `PreviewRoot` render prop, which receives `{ canvasRef, isReady, isLoading }` and the consumer is responsible for rendering the `<canvas>`. Caption overlay is a sibling absolutely positioned over the canvas. Bottom control bar has play/pause, total duration, and aspect ratio label.

  IMPORTANT: the existing Plan 4 `PreviewCanvas.tsx` already mounts `PreviewRoot` for the current `PreviewPanel`. It will become redundant once Task 3 lands; delete `modes/clipcraft/viewer/PreviewCanvas.tsx` in this step (and update any imports — grep confirms only `PreviewPanel.tsx` and `ClipCraftPreview.tsx` reference it; after Task 2 only the Plan 6 `VideoPreview` mounts `PreviewRoot`).

  ```tsx
  import { useCallback } from "react";
  import { PreviewRoot, useComposition, usePlayback } from "@pneuma-craft/react";
  import { CaptionOverlay } from "./CaptionOverlay.js";
  import type { CaptionStyle } from "../../persistence.js";

  export interface VideoPreviewProps {
    captionStyle?: CaptionStyle;
  }

  /**
   * Read-only preview surface. The craft PreviewRoot renders into a
   * <canvas> via its render-prop; we stack a caption DOM layer on top
   * and a compact control bar below.
   *
   * NOTE: we do NOT mount <video> elements here. Legacy did so because
   * its playback was driven from DOM video elements; craft's
   * PlaybackEngine renders frames into the canvas directly, so all
   * video decoding is inside the engine.
   */
  export function VideoPreview({ captionStyle }: VideoPreviewProps) {
    const composition = useComposition();
    const playback = usePlayback();

    const aspect = composition?.settings
      ? composition.settings.width / composition.settings.height
      : 16 / 9;
    const aspectLabel = composition?.settings?.aspectRatio ?? "16:9";

    const togglePlay = useCallback(() => {
      if (playback.isPlaying) playback.pause();
      else playback.play();
    }, [playback]);

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "#09090b",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              width: "100%",
              maxHeight: "100%",
              aspectRatio: `${aspect}`,
              background: "#0a0a0a",
              borderRadius: 4,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <PreviewRoot>
              {({ canvasRef, isReady, isLoading }) => (
                <>
                  <canvas
                    ref={canvasRef}
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "block",
                      background: "#000",
                    }}
                  />
                  {!isReady && isLoading && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#a1a1aa",
                        fontSize: 12,
                      }}
                    >
                      Loading preview…
                    </div>
                  )}
                </>
              )}
            </PreviewRoot>

            <CaptionOverlay style={captionStyle} />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 16px",
            borderTop: "1px solid #27272a",
            fontSize: 12,
            color: "#a1a1aa",
          }}
        >
          <button
            onClick={togglePlay}
            style={{
              background: "none",
              border: "none",
              color: "#e4e4e7",
              cursor: "pointer",
              fontSize: 18,
              padding: 0,
            }}
            aria-label={playback.isPlaying ? "Pause" : "Play"}
          >
            {playback.isPlaying ? "\u23F8" : "\u25B6"}
          </button>
          <span style={{ fontFamily: "monospace" }}>
            {(playback.currentTime ?? 0).toFixed(1)}s / {(playback.duration ?? 0).toFixed(1)}s
          </span>
          <span style={{ fontSize: 11, color: "#52525b" }}>{aspectLabel}</span>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 3.6** — Update `modes/clipcraft/viewer/layout/ClipCraftLayout.tsx` to import and render the real `VideoPreview`. Also thread `captionStyle` from the current project through context — the simplest route is to add a tiny `CaptionStyleContext`, but for Plan 6 a direct prop from `PreviewPanel` is sufficient. Prefer the prop.

  Change `ClipCraftLayout.tsx`'s `VideoPreviewPlaceholder` to import the real component:

  ```tsx
  import { VideoPreview } from "../preview/VideoPreview.js";
  import type { CaptionStyle } from "../../persistence.js";
  import { useTimelineMode } from "../hooks/useTimelineMode.js";
  import { TimelineShell } from "./TimelineShell.js";

  export interface ClipCraftLayoutProps {
    captionStyle?: CaptionStyle;
  }

  export function ClipCraftLayout({ captionStyle }: ClipCraftLayoutProps) {
    const { timelineMode } = useTimelineMode();
    const isExpanded = timelineMode !== "collapsed";

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "#09090b",
          color: "#e4e4e7",
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: isExpanded ? "0 0 0px" : "1 1 60%",
            opacity: isExpanded ? 0 : 1,
            display: "flex",
            minHeight: 0,
            borderBottom: "1px solid #27272a",
            overflow: "hidden",
            transition:
              "flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
          }}
        >
          <AssetPanelPlaceholder />
          <div style={{ flex: 1, minWidth: 0 }}>
            <VideoPreview captionStyle={captionStyle} />
          </div>
        </div>

        <TimelineShell />
      </div>
    );
  }
  ```

  And in `PreviewPanel.tsx` thread the caption style through. The caption style lives on `project?.captionStyle` which isn't directly accessible inside `PreviewPanel`. The cleanest approach is to plumb it from `SyncedBody`:

  ```tsx
  // In ClipCraftPreview.tsx SyncedBody, after reading scenes/captionStyle:
  return <PreviewPanel hydrationError={hydrationError} captionStyle={captionStyle} />;
  ```

  Then:

  ```tsx
  // PreviewPanel.tsx
  import { ClipCraftLayout } from "./layout/ClipCraftLayout.js";
  import { StateDump } from "./StateDump.js";
  import type { CaptionStyle } from "../persistence.js";

  export interface PreviewPanelProps {
    hydrationError: string | null;
    captionStyle?: CaptionStyle;
  }

  export function PreviewPanel({ hydrationError, captionStyle }: PreviewPanelProps) {
    return (
      <div
        className="cc-preview-panel"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "#09090b",
          color: "#e4e4e7",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          <ClipCraftLayout captionStyle={captionStyle} />
        </div>
        <details style={{ borderTop: "1px solid #27272a", padding: "4px 12px" }}>
          <summary style={{ cursor: "pointer", color: "#a1a1aa", fontSize: 11 }}>
            debug · StateDump
          </summary>
          <StateDump hydrationError={hydrationError} />
        </details>
      </div>
    );
  }
  ```

- [ ] **Step 3.7** — Delete `modes/clipcraft/viewer/PreviewCanvas.tsx` (now redundant). Verify with `grep -r PreviewCanvas modes/clipcraft` that no import remains. Also delete `modes/clipcraft/viewer/PlaybackControls.tsx` (its play/pause button is now inside `VideoPreview`) — grep for `PlaybackControls` and confirm only `PreviewPanel.tsx` imported it pre-Task-2.
- [ ] **Step 3.8** — Run `bun test`. Then `bun run dev clipcraft`: expect the canvas to render in the top-right, the seed clip to play when pressing play, and no caption to appear (seed has no subtitle track). Add a temporary subtitle clip to the seed to eyeball the caption overlay if needed — revert before committing.
- [ ] **Step 3.9** — `chrome-devtools-mcp` screenshot to verify aspect ratio is preserved and the caption overlay positions correctly.

**Draft commit message:**

```
feat(clipcraft): VideoPreview + caption overlay on craft PreviewRoot (Plan 6 Task 3)

Replace the Plan 4 PreviewCanvas with a medeo-style VideoPreview that
mounts craft's PreviewRoot render-prop, overlays captions from the
active subtitle clip, and exposes a compact control bar (play/pause,
time, aspect label). Caption styling lives in a mode-local sidecar
(project.captionStyle) so the agent can tweak overlay look without
touching craft state. Remove redundant PreviewCanvas + PlaybackControls
from Plan 4 — their responsibilities are now inside VideoPreview.
```

---

## Task 4 — AssetPanel (Model B, read + upload + delete)

**Why:** The asset panel is the left sidebar of the top half. Model B means **the craft asset registry IS the material library** — there is no filesystem scan, no `assets/` subdirectory enumeration. Upload copies a file into the workspace and dispatches `asset:register` + a `provenance:set-root` with `operation.type === "import"` and `params: { source: "upload" }`. Delete dispatches `asset:remove` (logical only — the file stays on disk).

**Files:**
- `modes/clipcraft/viewer/assets/AssetPanel.tsx` (create)
- `modes/clipcraft/viewer/assets/AssetGroup.tsx` (create)
- `modes/clipcraft/viewer/assets/AssetThumbnail.tsx` (create)
- `modes/clipcraft/viewer/assets/AssetLightbox.tsx` (create)
- `modes/clipcraft/viewer/assets/ScriptTab.tsx` (create)
- `modes/clipcraft/viewer/assets/useAssetActions.ts` (create)
- `modes/clipcraft/viewer/assets/useAssetErrors.tsx` (create)
- `modes/clipcraft/viewer/assets/useAssetMetadata.ts` (create)
- `modes/clipcraft/viewer/assets/useWorkspaceAssetUrl.ts` (create)
- `modes/clipcraft/viewer/layout/ClipCraftLayout.tsx` (modify — mount real AssetPanel)
- `modes/clipcraft/viewer/ClipCraftPreview.tsx` (modify — wrap in AssetErrorsProvider)

### UX simplification note

Legacy had five filesystem-grouped panels (Images / Clips / Reference / Audio / BGM). Model B has no Reference or BGM asset subtypes in craft — assets are `image | video | audio | text`. Plan 6 therefore renders four groups: **Images**, **Clips** (video assets), **Audio**, **Text**. The visual layout (thumbnail grid vs. list) stays the same: images and clips use thumbnail grid, audio and text use list. `text` assets are rare in read-only mode and likely empty in Plan 6; the group still renders so the UX scaffolding is consistent with the editable future.

### Steps

- [ ] **Step 4.1** — Create `modes/clipcraft/viewer/assets/useAssetErrors.tsx`. Mode-local `Map<assetId, string>` via React context. Exposes `setError(assetId, message)`, `clearError(assetId)`, and `useAssetError(assetId)` for per-asset reads.

  ```tsx
  import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

  interface AssetErrorsContextValue {
    errors: Map<string, string>;
    setError: (assetId: string, message: string) => void;
    clearError: (assetId: string) => void;
  }

  const AssetErrorsContext = createContext<AssetErrorsContextValue | null>(null);

  export function AssetErrorsProvider({ children }: { children: React.ReactNode }) {
    const [errors, setErrors] = useState<Map<string, string>>(() => new Map());

    const setError = useCallback((assetId: string, message: string) => {
      setErrors((prev) => {
        const next = new Map(prev);
        next.set(assetId, message);
        return next;
      });
    }, []);

    const clearError = useCallback((assetId: string) => {
      setErrors((prev) => {
        if (!prev.has(assetId)) return prev;
        const next = new Map(prev);
        next.delete(assetId);
        return next;
      });
    }, []);

    const value = useMemo(() => ({ errors, setError, clearError }), [errors, setError, clearError]);

    return <AssetErrorsContext.Provider value={value}>{children}</AssetErrorsContext.Provider>;
  }

  export function useAssetErrors() {
    const ctx = useContext(AssetErrorsContext);
    if (!ctx) throw new Error("useAssetErrors must be used inside <AssetErrorsProvider>");
    return ctx;
  }

  export function useAssetError(assetId: string): string | null {
    const { errors } = useAssetErrors();
    return errors.get(assetId) ?? null;
  }
  ```

- [ ] **Step 4.2** — Create `modes/clipcraft/viewer/assets/useAssetMetadata.ts`. Reads the provenance edge for an asset id and extracts `{ prompt, model, params, operation, actor, agentId }` from `operation.params` (via craft's `useEventLog` or a direct store read). Craft exposes assets via `useAssets()` but provenance edges live inside the core state registry — the simplest read path in the react package is `usePneumaCraftStore((s) => s.coreState.provenance.edges)`.

  ```ts
  import { useMemo } from "react";
  import { usePneumaCraftStore } from "@pneuma-craft/react";

  export interface AssetGenerationMetadata {
    operationType: string;
    actor: "human" | "agent";
    agentId?: string;
    label?: string;
    prompt?: string;
    model?: string;
    params?: Record<string, unknown>;
  }

  /**
   * Look up the incoming provenance edge for an asset and extract the
   * generation metadata recorded on operation.params. Returns null if
   * the asset has no recorded provenance.
   *
   * Model B convention: upload → operation.type === "import" with params.source === "upload";
   * ai generation → operation.type === "generate" with params.model + params.prompt.
   */
  export function useAssetMetadata(assetId: string): AssetGenerationMetadata | null {
    const edges = usePneumaCraftStore((s) => s.coreState.provenance.edges);
    return useMemo(() => {
      for (const edge of edges.values()) {
        if (edge.toAssetId !== assetId) continue;
        const op = edge.operation;
        const params = op.params as Record<string, unknown> | undefined;
        return {
          operationType: op.type,
          actor: op.actor,
          agentId: op.agentId,
          label: op.label,
          prompt: typeof params?.prompt === "string" ? params.prompt : undefined,
          model: typeof params?.model === "string" ? params.model : undefined,
          params,
        };
      }
      return null;
    }, [edges, assetId]);
  }
  ```

- [ ] **Step 4.3** — Create `modes/clipcraft/viewer/assets/useWorkspaceAssetUrl.ts`. Converts an asset id into a browser-loadable URL. The mode already has `modes/clipcraft/viewer/assetResolver.ts` (Plan 4) — this hook delegates to it, but for asset-panel thumbnail use we can bypass it and emit `/content/<uri>` directly because every clip in the project has a concrete `uri`. If an asset has an empty `uri` (pending generation), return `null`.

  ```ts
  import { useAsset } from "@pneuma-craft/react";

  /**
   * Resolve an asset id to a workspace-relative content URL for <img>/<video>
   * consumption. Returns null if the asset is not yet materialized (uri === "").
   */
  export function useWorkspaceAssetUrl(assetId: string): string | null {
    const asset = useAsset(assetId);
    if (!asset) return null;
    if (!asset.uri || asset.uri.length === 0) return null;
    return `/content/${asset.uri}`;
  }
  ```

- [ ] **Step 4.4** — Create `modes/clipcraft/viewer/assets/useAssetActions.ts`. `upload(file)` and `remove(assetId)`.

  The upload flow has three steps:
  1. Copy the file into `workspace/assets/<generated-name>` via `POST /api/files` with a data URL.
  2. Generate a fresh asset id (`asset-<Date.now()>-<random>`).
  3. Dispatch two craft commands: `asset:register` with the new id + classified type + the workspace URI, then `provenance:set-root` with `operation.type === "import"` and `params.source === "upload"` and `params.originalName === file.name`.

  The delete flow dispatches `asset:remove` with the given id. Files are NOT removed from disk in Plan 6.

  ```ts
  import { useCallback } from "react";
  import { useDispatch } from "@pneuma-craft/react";
  import type { Actor, AssetType } from "@pneuma-craft/core";
  import { useAssetErrors } from "./useAssetErrors.js";

  const ACTOR: Actor = "human";

  function classifyAssetType(file: File): AssetType | null {
    const mime = file.type;
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    // Fall back on extension
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
    if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
    if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) return "audio";
    return null;
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function makeAssetId(): string {
    return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeSafeFilename(originalName: string, assetId: string): string {
    // Deterministic, collision-free filename. Keep the extension for content type.
    const ext = originalName.includes(".") ? originalName.split(".").pop() : "";
    return ext ? `${assetId}.${ext}` : assetId;
  }

  export function useAssetActions() {
    const dispatch = useDispatch();
    const { setError, clearError } = useAssetErrors();

    const upload = useCallback(
      async (file: File): Promise<string | null> => {
        const type = classifyAssetType(file);
        if (!type) {
          console.warn("[clipcraft] upload rejected — unknown asset type", file.name);
          return null;
        }

        const assetId = makeAssetId();
        const filename = makeSafeFilename(file.name, assetId);
        const workspacePath = `assets/${filename}`;

        try {
          const dataUrl = await readFileAsDataUrl(file);
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: workspacePath, content: dataUrl }),
          });
          if (!res.ok) {
            setError(assetId, `upload failed: ${res.status}`);
            return null;
          }
        } catch (e) {
          setError(assetId, `upload failed: ${(e as Error).message}`);
          return null;
        }

        try {
          dispatch(ACTOR, {
            type: "asset:register",
            asset: {
              id: assetId,
              type,
              uri: workspacePath,
              name: file.name,
              metadata: { size: file.size, originalName: file.name },
            },
          });
          dispatch(ACTOR, {
            type: "provenance:set-root",
            assetId,
            operation: {
              type: "import",
              actor: "human",
              timestamp: Date.now(),
              label: `uploaded ${file.name}`,
              params: {
                source: "upload",
                originalName: file.name,
                mimeType: file.type,
              },
            },
          });
          clearError(assetId);
          return assetId;
        } catch (e) {
          setError(assetId, `register failed: ${(e as Error).message}`);
          return null;
        }
      },
      [dispatch, setError, clearError],
    );

    const remove = useCallback(
      (assetId: string) => {
        try {
          dispatch(ACTOR, { type: "asset:remove", assetId });
          clearError(assetId);
        } catch (e) {
          setError(assetId, `remove failed: ${(e as Error).message}`);
        }
      },
      [dispatch, setError, clearError],
    );

    return { upload, remove };
  }
  ```

  VERIFY BEFORE IMPLEMENTING: the subagent must check `node_modules/@pneuma-craft/core/dist/index.d.ts` for the exact shapes of `asset:register`, `provenance:set-root`, and `asset:remove` commands — if any field name differs (e.g. `assetId` vs `id`), adjust inline. The shapes above mirror Plan 2 / Plan 3a — they should be correct but the subagent confirms.

- [ ] **Step 4.5** — Create `modes/clipcraft/viewer/assets/AssetThumbnail.tsx`. Single tile with image/video thumbnail, error badge, delete-on-hover, click-to-open lightbox.

  ```tsx
  import { useCallback } from "react";
  import type { Asset } from "@pneuma-craft/react";
  import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";
  import { useAssetError } from "./useAssetErrors.js";
  import { useAssetMetadata } from "./useAssetMetadata.js";

  export interface AssetThumbnailProps {
    asset: Asset;
    onOpen: (asset: Asset) => void;
    onDelete: (assetId: string) => void;
  }

  export function AssetThumbnail({ asset, onOpen, onDelete }: AssetThumbnailProps) {
    const url = useWorkspaceAssetUrl(asset.id);
    const error = useAssetError(asset.id);
    const meta = useAssetMetadata(asset.id);

    const tooltip = [
      asset.name,
      meta?.model ? `model: ${meta.model}` : null,
      meta?.prompt ? `prompt: ${meta.prompt}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const handleDelete = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(asset.id);
      },
      [asset.id, onDelete],
    );

    return (
      <div
        onClick={() => onOpen(asset)}
        title={tooltip}
        style={{
          position: "relative",
          width: 48,
          height: 48,
          borderRadius: 3,
          overflow: "hidden",
          background: "#18181b",
          cursor: "pointer",
          border: error ? "1px solid #ef4444" : "1px solid transparent",
        }}
      >
        {url && asset.type === "video" ? (
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onLoadedData={(e) => {
              (e.target as HTMLVideoElement).currentTime = 0.1;
            }}
          />
        ) : url && asset.type === "image" ? (
          <img
            src={url}
            alt={asset.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              fontSize: 10,
              color: "#71717a",
              textAlign: "center",
              padding: 2,
            }}
          >
            {asset.status === "pending" ? "…pending" : asset.name.slice(0, 8)}
          </div>
        )}

        {error && (
          <div
            style={{
              position: "absolute",
              left: 2,
              bottom: 2,
              background: "rgba(239,68,68,0.9)",
              color: "#fff",
              fontSize: 8,
              padding: "0 3px",
              borderRadius: 2,
              maxWidth: "90%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleDelete}
          className="asset-delete-btn"
          style={{
            position: "absolute",
            top: 1,
            right: 1,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: "rgba(0,0,0,0.7)",
            border: "none",
            color: "#ef4444",
            fontSize: 9,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label={`remove ${asset.name}`}
        >
          x
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 4.6** — Create `modes/clipcraft/viewer/assets/AssetLightbox.tsx`. Modal preview matching legacy's lightbox — closes on backdrop click, shows full image/video/audio.

  ```tsx
  import type { Asset } from "@pneuma-craft/react";
  import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";

  export function AssetLightbox({
    asset,
    onClose,
  }: {
    asset: Asset;
    onClose: () => void;
  }) {
    const url = useWorkspaceAssetUrl(asset.id);

    return (
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,0.85)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          onClick={onClose}
          aria-label="close"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 32,
            height: 32,
            borderRadius: 16,
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#e4e4e7",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          ×
        </button>

        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            maxWidth: "90vw",
            maxHeight: "80vh",
          }}
        >
          {url && asset.type === "image" && (
            <img
              src={url}
              alt={asset.name}
              style={{
                maxWidth: "90vw",
                maxHeight: "75vh",
                objectFit: "contain",
                borderRadius: 4,
              }}
            />
          )}
          {url && asset.type === "video" && (
            <video
              src={url}
              controls
              autoPlay
              muted
              style={{
                maxWidth: "90vw",
                maxHeight: "75vh",
                objectFit: "contain",
                borderRadius: 4,
              }}
            />
          )}
          {url && asset.type === "audio" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
                padding: 32,
              }}
            >
              <div style={{ fontSize: 48, color: "#71717a" }}>♪</div>
              <audio src={url} controls autoPlay style={{ width: 320 }} />
            </div>
          )}
          {!url && (
            <div style={{ fontSize: 13, color: "#71717a", padding: 32 }}>
              {asset.status === "pending" ? "Pending generation" : "Preview not available"}
            </div>
          )}
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          style={{ marginTop: 12, textAlign: "center", maxWidth: "90vw" }}
        >
          <div style={{ fontSize: 13, color: "#e4e4e7", fontWeight: 500 }}>{asset.name}</div>
          <div style={{ fontSize: 11, color: "#71717a", marginTop: 2 }}>{asset.uri || asset.id}</div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4.7** — Create `modes/clipcraft/viewer/assets/AssetGroup.tsx`. Per-type section with upload button, empty state, thumbnail grid or list, drag-and-drop.

  ```tsx
  import { useCallback, useRef, useState } from "react";
  import type { Asset, AssetType } from "@pneuma-craft/react";
  import { AssetThumbnail } from "./AssetThumbnail.js";
  import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";

  export interface AssetGroupProps {
    label: string;
    type: AssetType;
    display: "thumbnail" | "list";
    accept: string;
    assets: Asset[];
    onOpen: (asset: Asset) => void;
    onDelete: (assetId: string) => void;
    onUpload: (files: FileList) => void;
  }

  export function AssetGroup({
    label,
    type,
    display,
    accept,
    assets,
    onOpen,
    onDelete,
    onUpload,
  }: AssetGroupProps) {
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const triggerPicker = useCallback(() => {
      if (fileInputRef.current) {
        fileInputRef.current.accept = accept;
        fileInputRef.current.click();
      }
    }, [accept]);

    const handleInput = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        onUpload(e.target.files);
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
      [onUpload],
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (!e.dataTransfer.files?.length) return;
        onUpload(e.dataTransfer.files);
      },
      [onUpload],
    );

    return (
      <div
        style={{
          marginBottom: 16,
          borderRadius: 4,
          border: dragOver ? "1px dashed #f97316" : "1px dashed transparent",
          background: dragOver ? "rgba(249, 115, 22, 0.05)" : "transparent",
          padding: dragOver ? 4 : 0,
          transition: "border-color 0.15s, background 0.15s",
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleInput}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#a1a1aa",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {label}
            <span style={{ marginLeft: 6, color: "#52525b", fontWeight: 400 }}>
              {assets.length}
            </span>
          </span>
          <button
            onClick={triggerPicker}
            title={`Upload to ${label}`}
            style={{
              background: "none",
              border: "1px solid #3f3f46",
              borderRadius: 3,
              color: "#71717a",
              fontSize: 11,
              padding: "1px 6px",
              cursor: "pointer",
              lineHeight: "16px",
            }}
          >
            +
          </button>
        </div>

        {assets.length === 0 ? (
          <div style={{ fontSize: 11, color: "#52525b", padding: "4px 0" }}>
            Drop files here
          </div>
        ) : display === "thumbnail" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 48px)", gap: 4 }}>
            {assets.map((a) => (
              <AssetThumbnail key={a.id} asset={a} onOpen={onOpen} onDelete={onDelete} />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {assets.map((a) => (
              <AssetListRow
                key={a.id}
                asset={a}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  function AssetListRow({
    asset,
    onOpen,
    onDelete,
  }: {
    asset: Asset;
    onOpen: (a: Asset) => void;
    onDelete: (id: string) => void;
  }) {
    return (
      <div
        onClick={() => onOpen(asset)}
        title={asset.uri || asset.name}
        style={{
          fontSize: 11,
          color: "#d4d4d8",
          padding: "3px 4px",
          borderRadius: 3,
          background: "#18181b",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {asset.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(asset.id);
          }}
          style={{
            background: "none",
            border: "none",
            color: "#52525b",
            cursor: "pointer",
            fontSize: 10,
            padding: "0 2px",
            flexShrink: 0,
          }}
          aria-label={`remove ${asset.name}`}
        >
          x
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 4.8** — Create `modes/clipcraft/viewer/assets/ScriptTab.tsx`. Lists each scene's title + the concatenated text of its member subtitle clips.

  ```tsx
  import { useMemo } from "react";
  import { useComposition } from "@pneuma-craft/react";
  import { useScenes, useSceneSelection } from "../scenes/SceneContext.js";

  export function ScriptTab() {
    const scenes = useScenes();
    const composition = useComposition();
    const { selectedSceneId, setSelectedSceneId } = useSceneSelection();

    const subtitlesByClipId = useMemo(() => {
      const map = new Map<string, string>();
      for (const track of composition?.tracks ?? []) {
        if (track.type !== "subtitle") continue;
        for (const clip of track.clips) {
          if (clip.text) map.set(clip.id, clip.text);
        }
      }
      return map;
    }, [composition]);

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 10px" }}>
          {scenes.length === 0 ? (
            <div style={{ fontSize: 11, color: "#52525b", padding: "4px 0" }}>
              No scenes yet
            </div>
          ) : (
            scenes.map((scene, index) => {
              const isSelected = scene.id === selectedSceneId;
              const captionText = scene.memberClipIds
                .map((id) => subtitlesByClipId.get(id))
                .filter((s): s is string => typeof s === "string")
                .join(" ");

              return (
                <div
                  key={scene.id}
                  onClick={() => setSelectedSceneId(scene.id)}
                  style={{
                    padding: "8px 8px",
                    marginBottom: 4,
                    borderRadius: 4,
                    border: isSelected
                      ? "1px solid #f97316"
                      : "1px solid transparent",
                    background: isSelected
                      ? "rgba(249, 115, 22, 0.08)"
                      : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isSelected ? "#f97316" : "#a1a1aa",
                      marginBottom: 2,
                    }}
                  >
                    {scene.title || `Scene ${index + 1}`}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#d4d4d8",
                      lineHeight: 1.4,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {captionText || (
                      <span style={{ color: "#52525b" }}>
                        {scene.prompt || "No caption"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4.9** — Create `modes/clipcraft/viewer/assets/AssetPanel.tsx`. The main component. Tab bar, groups, lightbox state.

  ```tsx
  import { useCallback, useMemo, useState } from "react";
  import { useAssets, type Asset, type AssetType } from "@pneuma-craft/react";
  import { AssetGroup } from "./AssetGroup.js";
  import { AssetLightbox } from "./AssetLightbox.js";
  import { ScriptTab } from "./ScriptTab.js";
  import { useAssetActions } from "./useAssetActions.js";

  type Tab = "assets" | "script";

  interface GroupSpec {
    label: string;
    type: AssetType;
    display: "thumbnail" | "list";
    accept: string;
  }

  const GROUPS: GroupSpec[] = [
    { label: "Images", type: "image", display: "thumbnail", accept: "image/*" },
    { label: "Clips", type: "video", display: "thumbnail", accept: "video/*" },
    { label: "Audio", type: "audio", display: "list", accept: "audio/*" },
    { label: "Text", type: "text", display: "list", accept: "text/*" },
  ];

  export function AssetPanel() {
    const assets = useAssets();
    const { upload, remove } = useAssetActions();
    const [tab, setTab] = useState<Tab>("assets");
    const [preview, setPreview] = useState<Asset | null>(null);

    const grouped = useMemo(() => {
      const byType = new Map<AssetType, Asset[]>();
      for (const a of assets) {
        const arr = byType.get(a.type) ?? [];
        arr.push(a);
        byType.set(a.type, arr);
      }
      return byType;
    }, [assets]);

    const handleUpload = useCallback(
      async (files: FileList) => {
        for (const file of Array.from(files)) {
          await upload(file);
        }
      },
      [upload],
    );

    return (
      <div
        style={{
          width: 220,
          minWidth: 220,
          background: "#111113",
          borderRight: "1px solid #27272a",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", borderBottom: "1px solid #27272a", flexShrink: 0 }}>
          {(["assets", "script"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                borderBottom:
                  tab === t ? "2px solid #f97316" : "2px solid transparent",
                color: tab === t ? "#e4e4e7" : "#71717a",
                fontSize: 12,
                fontWeight: 500,
                padding: "8px 0",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {t === "assets" ? "Assets" : "Script"}
            </button>
          ))}
        </div>

        {tab === "assets" ? (
          <div style={{ padding: "8px 10px", overflowY: "auto", flex: 1 }}>
            {GROUPS.map((g) => (
              <AssetGroup
                key={g.type}
                label={g.label}
                type={g.type}
                display={g.display}
                accept={g.accept}
                assets={grouped.get(g.type) ?? []}
                onOpen={setPreview}
                onDelete={remove}
                onUpload={handleUpload}
              />
            ))}
          </div>
        ) : (
          <ScriptTab />
        )}

        {preview && (
          <AssetLightbox asset={preview} onClose={() => setPreview(null)} />
        )}
      </div>
    );
  }
  ```

- [ ] **Step 4.10** — Mount `AssetErrorsProvider` in `ClipCraftPreview.tsx`. Place it inside `PneumaCraftProvider` so any child can dispatch errors. Update the provider nesting inside the main `return`:

  ```tsx
  <PneumaCraftProvider key={providerKey} assetResolver={assetResolver}>
    <AssetErrorsProvider>
      <SceneProvider initialScenes={project?.scenes ?? []}>
        <TimelineModeProvider>
          <TimelineZoomProvider>
            <SyncedBody {...} />
          </TimelineZoomProvider>
        </TimelineModeProvider>
      </SceneProvider>
    </AssetErrorsProvider>
  </PneumaCraftProvider>
  ```

- [ ] **Step 4.11** — Replace the `AssetPanelPlaceholder` in `ClipCraftLayout.tsx` with the real component:

  ```tsx
  import { AssetPanel } from "../assets/AssetPanel.js";
  // ...
  <AssetPanel />
  ```

  And delete the `AssetPanelPlaceholder` function.

- [ ] **Step 4.12** — Smoke test: `bun run dev clipcraft`. Expect Images + Clips groups to show the seed video thumbnail, click-to-open lightbox, drag-and-drop upload actually writes a new file and the new asset appears via craft's reactive store, delete makes the asset disappear (file stays on disk, confirm via `ls workspace/assets`). Script tab shows the two seed scenes.
- [ ] **Step 4.13** — `chrome-devtools-mcp` screenshot to confirm the panel matches legacy proportions.

**Draft commit message:**

```
feat(clipcraft): AssetPanel with Model B (Plan 6 Task 4)

Port legacy AssetPanel to read from craft's asset registry directly:
useAssets() is the source of truth, no filesystem scan. Upload copies
to workspace/assets/ via POST /api/files and dispatches asset:register
+ provenance:set-root with operation.type "import" and params.source
"upload". Delete is logical via asset:remove (files stay on disk).
Errors live in a mode-local AssetErrorsContext. Provenance metadata
(prompt, model, params) is extracted for tooltips. Four groups —
Images, Clips, Audio, Text — replacing legacy's five filesystem
prefixes (Reference and BGM folded into their craft type
counterparts).
```

---

## Task 5 — TimelineOverview3D (CSS 2.5D on framer-motion)

**Why:** The 3D overview is the signature "exploded deck of glass layers" view that differentiates ClipCraft from other editors. Legacy implements it with framer-motion perspective + rotate transforms — NOT Three.js / r3f. Confirmed by reading `modes/clipcraft-legacy/viewer/timeline/overview/TimelineOverview3D.tsx`: the outermost scene is a `<motion.div>` with animated `perspective` / `perspectiveOrigin`; inside, a second `<motion.div>` animates `rotateX` / `rotateY` / `x`; each layer is a `<motion.div>` with `z` / `y` / `rotateX` / `opacity` animation. That's it. Plan 6 does exactly the same with framer-motion 12 (already installed).

The key reframing vs. legacy: legacy iterates `scenes[]` with per-scene `visual` / `caption` / `audio` slot bindings. Plan 6 iterates **craft tracks**, with each layer aggregating clips from one or more tracks. Legacy `LayerType` ("video" | "caption" | "audio" | "bgm") maps to craft track types: `caption → subtitle`, `audio → audio` (including BGM — no dedicated BGM lane in Plan 6), `video → video`. A fourth "bgm" pseudo-layer is **dropped** in Plan 6 per the mode-level decision.

**Files:**
- `modes/clipcraft/viewer/overview/TimelineOverview3D.tsx` (create)
- `modes/clipcraft/viewer/overview/Layer3D.tsx` (create)
- `modes/clipcraft/viewer/overview/LayerToggle.tsx` (create)
- `modes/clipcraft/viewer/overview/OverviewControls.tsx` (create)
- `modes/clipcraft/viewer/overview/useOverviewCamera.ts` (create)
- `modes/clipcraft/viewer/overview/layerTypes.ts` (create — shared `LayerType` union + mapping helpers)
- `modes/clipcraft/viewer/overview/VideoLayerContent.tsx` (create)
- `modes/clipcraft/viewer/overview/CaptionLayerContent.tsx` (create)
- `modes/clipcraft/viewer/overview/AudioLayerContent.tsx` (create)
- `modes/clipcraft/viewer/overview/FakeWaveform.tsx` (create)
- `modes/clipcraft/viewer/layout/TimelineShell.tsx` (modify — mount real Overview in place of placeholder)

### Steps

- [ ] **Step 5.1** — Create `modes/clipcraft/viewer/overview/layerTypes.ts`.

  ```ts
  // Overview layer taxonomy. Legacy had 4 types (video / caption / audio / bgm);
  // Plan 6 drops "bgm" entirely — BGM is just another audio track in craft and
  // the overview renders it inside the Audio layer.
  import type { Track } from "@pneuma-craft/timeline";

  export type LayerType = "video" | "caption" | "audio";

  export const LAYER_PRIORITY: LayerType[] = ["caption", "video", "audio"];

  export function tracksForLayer(
    tracks: readonly Track[],
    layer: LayerType,
  ): Track[] {
    switch (layer) {
      case "video":
        return tracks.filter((t) => t.type === "video");
      case "caption":
        return tracks.filter((t) => t.type === "subtitle");
      case "audio":
        return tracks.filter((t) => t.type === "audio");
    }
  }

  export const LAYER_META: Record<
    LayerType,
    { label: string; icon: string; color: string; bg: string }
  > = {
    video:   { label: "Video",   icon: "\uD83C\uDFAC", color: "#eab308", bg: "rgba(234,179,8,0.04)" },
    caption: { label: "Caption", icon: "Tt",            color: "#f97316", bg: "rgba(249,115,22,0.04)" },
    audio:   { label: "Audio",   icon: "\uD83D\uDD0A",  color: "#38bdf8", bg: "rgba(56,189,248,0.04)" },
  };
  ```

- [ ] **Step 5.2** — Create `modes/clipcraft/viewer/overview/useOverviewCamera.ts`. Ported verbatim from legacy with `"exploded"` preset retained (ExplodedView takes over when that preset is selected).

  ```ts
  import { useState, useCallback, useMemo } from "react";

  export interface CameraState {
    rotateX: number;
    rotateY: number;
    perspective: number;
    perspectiveOriginX: number;
    perspectiveOriginY: number;
    translateX: number;
  }

  export type CameraPreset = "exploded" | "front" | "side";

  const PRESETS: Record<CameraPreset, CameraState> = {
    exploded: {
      rotateX: 0, rotateY: 0, perspective: 800,
      perspectiveOriginX: 50, perspectiveOriginY: 50, translateX: 0,
    },
    front: {
      rotateX: -5, rotateY: 0, perspective: 1600,
      perspectiveOriginX: 50, perspectiveOriginY: 50, translateX: 0,
    },
    side: {
      rotateX: -8, rotateY: 28, perspective: 750,
      perspectiveOriginX: 50, perspectiveOriginY: 48, translateX: 15,
    },
  };

  const PRESET_ORDER: CameraPreset[] = ["exploded", "front", "side"];

  export function useOverviewCamera(fixedPreset?: CameraPreset) {
    const [internalPreset, setPreset] = useState<CameraPreset>("front");
    const preset = fixedPreset ?? internalPreset;
    const camera = PRESETS[preset];

    const nextPreset = useCallback(() => {
      setPreset((p) => {
        const idx = PRESET_ORDER.indexOf(p);
        return PRESET_ORDER[(idx + 1) % PRESET_ORDER.length];
      });
    }, []);

    const selectPreset = useCallback((p: CameraPreset) => setPreset(p), []);

    return useMemo(
      () => ({ camera, preset, nextPreset, selectPreset, PRESET_ORDER }),
      [camera, preset, nextPreset, selectPreset],
    );
  }
  ```

- [ ] **Step 5.3** — Create `modes/clipcraft/viewer/overview/OverviewControls.tsx`. Ported verbatim from legacy.

  ```tsx
  import type { CameraPreset } from "./useOverviewCamera.js";

  const PRESET_LABELS: Record<CameraPreset, { label: string; icon: string }> = {
    exploded: { label: "Exploded", icon: "\u{1F4A5}" },
    front: { label: "Front", icon: "\u23FA" },
    side: { label: "Side", icon: "\u25E7" },
  };

  interface Props {
    current: CameraPreset;
    presets: readonly CameraPreset[];
    onSelect: (preset: CameraPreset) => void;
    onCollapse: () => void;
  }

  export function OverviewControls({ current, presets, onSelect, onCollapse }: Props) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            title={PRESET_LABELS[p].label}
            style={{
              background: p === current ? "#27272a" : "transparent",
              border: "1px solid #3f3f46",
              borderRadius: 3,
              color: p === current ? "#f97316" : "#71717a",
              width: 28, height: 24, cursor: "pointer", fontSize: 12,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {PRESET_LABELS[p].icon}
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: "#27272a", margin: "0 4px" }} />
        <button
          onClick={onCollapse}
          title="Collapse"
          style={{
            background: "transparent", border: "1px solid #3f3f46", borderRadius: 3,
            color: "#71717a", width: 28, height: 24, cursor: "pointer", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {"\u2193"}
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 5.4** — Create `modes/clipcraft/viewer/overview/LayerToggle.tsx`. Ported from legacy, reduced to 3 layers (no bgm).

  ```tsx
  import { motion } from "framer-motion";
  import type { LayerType } from "./layerTypes.js";

  const LAYERS: { type: LayerType; icon: string; color: string; label: string }[] = [
    { type: "video",   icon: "\uD83C\uDFAC", color: "#eab308", label: "Video" },
    { type: "caption", icon: "Tt",            color: "#f97316", label: "Caption" },
    { type: "audio",   icon: "\uD83D\uDD0A",  color: "#38bdf8", label: "Audio" },
  ];

  interface Props {
    activeLayers: Set<LayerType>;
    onToggle: (layer: LayerType) => void;
    disabledLayers?: Set<LayerType>;
  }

  export function LayerToggle({ activeLayers, onToggle, disabledLayers }: Props) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 0" }}>
        {LAYERS.map(({ type, icon, color, label }) => {
          const active = activeLayers.has(type);
          const disabled = disabledLayers?.has(type);
          return (
            <motion.button
              key={type}
              onClick={() => !disabled && onToggle(type)}
              title={label}
              animate={{ height: active ? 40 : 24, opacity: disabled ? 0.3 : 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              style={{
                width: 28, borderRadius: 14, border: "none",
                background: active ? `${color}25` : "#18181b",
                outline: `1px solid ${active ? color + "50" : "#27272a"}`,
                color: active ? color : "#52525b",
                cursor: disabled ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 600, flexShrink: 0,
                position: "relative", overflow: "hidden",
              }}
            >
              {active && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  style={{
                    position: "absolute", width: 6, height: 6, borderRadius: 3,
                    background: color, boxShadow: `0 0 8px ${color}`, top: 4,
                  }}
                />
              )}
              <span style={{ marginTop: active ? 10 : 0, transition: "margin 0.2s" }}>
                {icon}
              </span>
            </motion.button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 5.5** — Create `modes/clipcraft/viewer/overview/FakeWaveform.tsx`. Deterministic fallback waveform shared by audio content renderers.

  ```tsx
  import { useMemo } from "react";

  export function FakeWaveform({ seed, bars, height, color }: {
    seed: string; bars: number; height: number; color: string;
  }) {
    const heights = useMemo(() => {
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
      const out: number[] = [];
      for (let i = 0; i < bars; i++) {
        h = ((h << 5) - h + i * 7) | 0;
        out.push(0.15 + ((h >>> 0) % 100) / 100 * 0.85);
      }
      return out;
    }, [seed, bars]);

    return (
      <div style={{ display: "flex", alignItems: "center", height, gap: 1 }}>
        {heights.map((v, i) => (
          <div key={i} style={{
            width: 3, height: Math.max(2, Math.round(v * height)),
            background: color, borderRadius: 1.5, flexShrink: 0,
          }} />
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 5.6** — Create `modes/clipcraft/viewer/overview/VideoLayerContent.tsx`. Iterates video track clips and renders thumbnails using the existing `useFrameExtractor` hook from Plan 5. Uses `useAsset(clip.assetId)` to resolve each clip's backing video URL, then walks it through `assetResolver` via a helper from Task 4's `useWorkspaceAssetUrl`.

  ```tsx
  import { useMemo } from "react";
  import type { Clip, Track } from "@pneuma-craft/timeline";
  import { useFrameExtractor } from "../timeline/hooks/useFrameExtractor.js";
  import { useWorkspaceAssetUrl } from "../assets/useWorkspaceAssetUrl.js";

  interface Props {
    tracks: Track[];
    totalDuration: number;
    height: number;
    pixelsPerSecond: number;
    scrollLeft: number;
    selectedClipId: string | null;
  }

  export function VideoLayerContent({
    tracks, totalDuration, height, pixelsPerSecond, scrollLeft, selectedClipId,
  }: Props) {
    const frameH = height - 8;

    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 4px" }}>
        {tracks.flatMap((track) =>
          track.clips.map((clip) => {
            const x = clip.startTime * pixelsPerSecond - scrollLeft;
            const w = clip.duration * pixelsPerSecond;
            if (x + w < -10 || x > 3000) return null;
            return (
              <VideoClip3D
                key={clip.id}
                clip={clip}
                x={x}
                w={w}
                frameH={frameH}
                pixelsPerSecond={pixelsPerSecond}
                selected={clip.id === selectedClipId}
              />
            );
          }),
        )}
      </div>
    );
  }

  function VideoClip3D({
    clip, x, w, frameH, pixelsPerSecond, selected,
  }: {
    clip: Clip; x: number; w: number; frameH: number;
    pixelsPerSecond: number; selected: boolean;
  }) {
    const videoUrl = useWorkspaceAssetUrl(clip.assetId);
    const frameInterval =
      pixelsPerSecond >= 150 ? 0.25 :
      pixelsPerSecond >= 60 ? 0.5 :
      pixelsPerSecond >= 30 ? 1 : 2;

    const frameOpts = useMemo(() => {
      if (!videoUrl) return null;
      return {
        videoUrl,
        duration: clip.duration,
        frameInterval,
        frameHeight: frameH,
      };
    }, [videoUrl, clip.duration, frameInterval, frameH]);

    const { frames } = useFrameExtractor(frameOpts);

    return (
      <div style={{
        position: "absolute", left: x, width: w - 2, height: frameH,
        borderRadius: 4, overflow: "hidden",
        border: selected ? "1px solid rgba(249,115,22,0.4)" : "1px solid rgba(255,255,255,0.06)",
        background: "#0a0a0a",
      }}>
        {frames.length > 0 ? (
          <div style={{ display: "flex", height: "100%", alignItems: "center", overflow: "hidden" }}>
            {(() => {
              const aspect = frames[0].width / frames[0].height;
              const naturalW = frameH * aspect;
              const clipW = w - 2;
              const visibleCount = Math.max(1, Math.ceil(clipW / naturalW));
              const step = Math.max(1, frames.length / visibleCount);
              const picked = [];
              for (let i = 0; i < visibleCount && i * step < frames.length; i++) {
                picked.push(frames[Math.min(Math.floor(i * step), frames.length - 1)]);
              }
              const tileW = clipW / picked.length;
              return picked.map((f, i) => (
                <img key={i} src={f.dataUrl} alt="" style={{
                  height: frameH, width: tileW, objectFit: "cover", flexShrink: 0,
                }} />
              ));
            })()}
          </div>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", color: "#27272a", fontSize: 12,
          }}>—</div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5.7** — Create `modes/clipcraft/viewer/overview/CaptionLayerContent.tsx`. Iterates subtitle-track clips and renders each clip's `.text` as a readable card.

  ```tsx
  import type { Track } from "@pneuma-craft/timeline";

  interface Props {
    tracks: Track[];
    totalDuration: number;
    height: number;
    pixelsPerSecond: number;
    scrollLeft: number;
    selectedClipId: string | null;
  }

  export function CaptionLayerContent({
    tracks, height, pixelsPerSecond, scrollLeft, selectedClipId,
  }: Props) {
    return (
      <div style={{ position: "absolute", inset: 0, padding: "4px" }}>
        {tracks.flatMap((track) =>
          track.clips.map((clip) => {
            const x = clip.startTime * pixelsPerSecond - scrollLeft;
            const w = clip.duration * pixelsPerSecond;
            if (x + w < -10 || x > 3000) return null;
            const sel = clip.id === selectedClipId;
            return (
              <div key={clip.id} style={{
                position: "absolute", left: x, width: w - 2, top: 4, bottom: 4,
                borderRadius: 4, overflow: "hidden",
                background: sel ? "#2d2519" : "#1a1a1e",
                border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
                padding: "6px 10px",
                display: "flex", alignItems: "center",
              }}>
                <span style={{
                  fontSize: Math.min(13, height * 0.3),
                  color: clip.text ? (sel ? "#e4e4e7" : "#a1a1aa") : "#3f3f46",
                  lineHeight: "1.4",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {clip.text ?? "No caption"}
                </span>
              </div>
            );
          }),
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5.8** — Create `modes/clipcraft/viewer/overview/AudioLayerContent.tsx`. Iterates audio-track clips (including BGM, which is just another audio track in craft). Uses a `FakeWaveform` fallback for each clip because computing real waveforms per-clip at 3D-overview scale is overkill; the existing `useWaveform` hook is reserved for the ExplodedView audio focus lane (Task 6).

  ```tsx
  import type { Track } from "@pneuma-craft/timeline";
  import { FakeWaveform } from "./FakeWaveform.js";

  interface Props {
    tracks: Track[];
    totalDuration: number;
    height: number;
    pixelsPerSecond: number;
    scrollLeft: number;
    selectedClipId: string | null;
  }

  export function AudioLayerContent({
    tracks, height, pixelsPerSecond, scrollLeft, selectedClipId,
  }: Props) {
    const barH = height - 12;

    return (
      <div style={{ position: "absolute", inset: 0, padding: "4px" }}>
        {tracks.flatMap((track) =>
          track.clips.map((clip) => {
            const x = clip.startTime * pixelsPerSecond - scrollLeft;
            const w = clip.duration * pixelsPerSecond;
            if (x + w < -10 || x > 3000) return null;
            const sel = clip.id === selectedClipId;
            return (
              <div key={clip.id} style={{
                position: "absolute", left: x, width: w - 2, top: 4, bottom: 4,
                borderRadius: 4, overflow: "hidden",
                background: sel ? "#1a1e2a" : "#111318",
                border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #1e2030",
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 1, padding: "0 4px",
              }}>
                <FakeWaveform
                  seed={clip.id}
                  bars={Math.max(10, Math.floor(w / 5))}
                  height={barH}
                  color={sel ? "#38bdf8" : "#1e3a5f"}
                />
              </div>
            );
          }),
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5.9** — Create `modes/clipcraft/viewer/overview/Layer3D.tsx`. Per-layer framer-motion card. Dispatches to the three Content components above based on `layerType`.

  ```tsx
  import { motion } from "framer-motion";
  import type { Track } from "@pneuma-craft/timeline";
  import { LAYER_META, type LayerType } from "./layerTypes.js";
  import { VideoLayerContent } from "./VideoLayerContent.js";
  import { CaptionLayerContent } from "./CaptionLayerContent.js";
  import { AudioLayerContent } from "./AudioLayerContent.js";

  interface Props {
    layerType: LayerType;
    tracks: Track[];
    zOffset: number;
    yPosition: number;
    heightPx: number;
    rotateX: number;
    totalDuration: number;
    pixelsPerSecond: number;
    scrollLeft: number;
    viewportWidth: number;
    selectedClipId: string | null;
    selected: boolean;
    onSelect: () => void;
    onDive: () => void;
    playheadX: number;
  }

  export function Layer3D(props: Props) {
    const {
      layerType, tracks, zOffset, yPosition, heightPx, rotateX,
      totalDuration, pixelsPerSecond, scrollLeft,
      viewportWidth, selectedClipId, selected, onSelect, onDive, playheadX,
    } = props;
    const meta = LAYER_META[layerType];

    return (
      <motion.div
        onClick={onSelect}
        onDoubleClick={onDive}
        animate={{ z: zOffset, y: yPosition, rotateX, opacity: selected ? 1 : 0.75 }}
        transition={{ type: "spring", stiffness: 180, damping: 24 }}
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: heightPx,
          transformStyle: "preserve-3d", cursor: "pointer", borderRadius: 8,
          willChange: "transform",
          background: meta.bg,
          border: `1px solid ${meta.color}${selected ? "40" : "15"}`,
          boxShadow: selected ? `0 0 20px ${meta.color}25` : "0 1px 6px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{
          position: "absolute", left: 8, top: 6, fontSize: 10, zIndex: 10,
          color: meta.color, fontWeight: 600, opacity: 0.85,
          textShadow: "0 1px 3px rgba(0,0,0,0.9)",
        }}>
          {meta.icon} {meta.label}
        </div>

        <div style={{
          position: "absolute", inset: 0, transformStyle: "flat",
          overflow: "hidden", borderRadius: 8,
        }}>
          {layerType === "video" && (
            <VideoLayerContent
              tracks={tracks} totalDuration={totalDuration} height={heightPx}
              pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
              selectedClipId={selectedClipId}
            />
          )}
          {layerType === "caption" && (
            <CaptionLayerContent
              tracks={tracks} totalDuration={totalDuration} height={heightPx}
              pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
              selectedClipId={selectedClipId}
            />
          )}
          {layerType === "audio" && (
            <AudioLayerContent
              tracks={tracks} totalDuration={totalDuration} height={heightPx}
              pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
              selectedClipId={selectedClipId}
            />
          )}
        </div>

        {playheadX >= -10 && playheadX <= viewportWidth + 10 && (
          <div style={{
            position: "absolute", left: playheadX, top: 0, bottom: 0,
            width: 2, marginLeft: -1, background: "#f97316",
            boxShadow: "0 0 8px rgba(249,115,22,0.6)",
            pointerEvents: "none", zIndex: 5,
            transition: "left 100ms linear", willChange: "left",
          }} />
        )}
      </motion.div>
    );
  }
  ```

- [ ] **Step 5.10** — Create `modes/clipcraft/viewer/overview/TimelineOverview3D.tsx`. Top-level 3D scene. Reads craft via `useComposition` / `usePlayback` / `useSelection`, computes per-layer heights, and renders `<Layer3D>` children inside a perspective + rotate stack.

  ```tsx
  import { useRef, useState, useCallback, useEffect, useMemo } from "react";
  import { motion, AnimatePresence } from "framer-motion";
  import {
    useComposition,
    usePlayback,
    useSelection,
  } from "@pneuma-craft/react";
  import { useTimelineZoom } from "../timeline/hooks/useTimelineZoom.js";
  import { useTimelineMode } from "../hooks/useTimelineMode.js";
  import { useOverviewCamera, type CameraPreset } from "./useOverviewCamera.js";
  import { LAYER_PRIORITY, tracksForLayer, type LayerType } from "./layerTypes.js";
  import { Layer3D } from "./Layer3D.js";
  import { LayerToggle } from "./LayerToggle.js";

  function computeZOffsets(activeLayers: LayerType[]): Record<string, number> {
    const count = activeLayers.length;
    if (count <= 1) return Object.fromEntries(activeLayers.map((l) => [l, 0]));
    const spread = count === 2 ? 120 : count === 3 ? 80 : 60;
    const offsets: Record<string, number> = {};
    activeLayers.forEach((l, i) => {
      offsets[l] = ((count - 1) / 2 - i) * spread;
    });
    return offsets;
  }

  export function TimelineOverview3D({ cameraPreset }: { cameraPreset: CameraPreset }) {
    const composition = useComposition();
    const playback = usePlayback();
    const selection = useSelection();
    const { setTimelineMode, setDiveLayer } = useTimelineMode();

    const selectedClipId =
      selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<HTMLDivElement>(null);
    const [containerH, setContainerH] = useState(600);

    const tracks = composition?.tracks ?? [];
    const totalDuration = Math.max(composition?.duration ?? 0, 1);
    const zoom = useTimelineZoom(totalDuration, sceneRef);
    const { camera } = useOverviewCamera(cameraPreset);

    const [activeLayers, setActiveLayers] = useState<Set<LayerType>>(new Set(["video"]));

    const disabledLayers = useMemo(() => {
      const d = new Set<LayerType>();
      for (const l of ["video", "caption", "audio"] as LayerType[]) {
        if (tracksForLayer(tracks, l).length === 0) d.add(l);
      }
      return d;
    }, [tracks]);

    const toggleLayer = useCallback((layer: LayerType) => {
      setActiveLayers((prev) => {
        const next = new Set(prev);
        if (next.has(layer)) {
          if (next.size > 1) next.delete(layer);
        } else {
          next.add(layer);
        }
        return next;
      });
    }, []);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const obs = new ResizeObserver((entries) => {
        setContainerH(entries[0]?.contentRect.height ?? 600);
      });
      obs.observe(el);
      return () => obs.disconnect();
    }, []);

    const handleCollapse = useCallback(() => {
      setTimelineMode("collapsed");
    }, [setTimelineMode]);

    const handleDive = useCallback((layer: LayerType) => {
      setDiveLayer(layer);
      setTimelineMode("dive");
    }, [setDiveLayer, setTimelineMode]);

    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") handleCollapse();
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [handleCollapse]);

    const playheadX = playback.currentTime * zoom.pixelsPerSecond - zoom.scrollLeft;

    const MAX_H: Record<LayerType, number> = { video: 240, caption: 80, audio: 60 };
    const MIN_H: Record<LayerType, number> = { video: 80, caption: 32, audio: 32 };

    const orderedActive = LAYER_PRIORITY.filter((l) => activeLayers.has(l));
    const zOffsets = computeZOffsets(orderedActive);
    const availH = Math.max(containerH - 80, 200);
    const gap = 10;
    const totalGap = Math.max(0, orderedActive.length - 1) * gap;
    const totalMaxH = orderedActive.reduce((s, l) => s + MAX_H[l], 0);
    const spaceForLayers = availH - totalGap;

    const layerHeights: Record<string, number> = {};
    for (const l of orderedActive) {
      const ratio = MAX_H[l] / totalMaxH;
      const h = Math.floor(spaceForLayers * ratio);
      layerHeights[l] = Math.max(MIN_H[l], Math.min(h, MAX_H[l]));
    }

    const totalLayersH = orderedActive.reduce((s, l) => s + layerHeights[l], 0) + totalGap;
    const topOffset = Math.max(0, Math.floor((availH - totalLayersH) / 2));
    const renderOrder = [...orderedActive].reverse();

    return (
      <div
        ref={containerRef}
        style={{
          height: "100%", display: "flex", background: "#09090b",
          position: "relative", overflow: "hidden",
        }}
      >
        <div style={{
          width: 44, flexShrink: 0, display: "flex", flexDirection: "column",
          justifyContent: "center", borderRight: "1px solid #1a1a1e", zIndex: 20,
        }}>
          <LayerToggle
            activeLayers={activeLayers}
            onToggle={toggleLayer}
            disabledLayers={disabledLayers}
          />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <motion.div
            ref={sceneRef}
            animate={{
              perspective: camera.perspective,
              perspectiveOrigin: `${camera.perspectiveOriginX}% ${camera.perspectiveOriginY}%`,
            }}
            transition={{ type: "spring", stiffness: 150, damping: 25 }}
            style={{
              flex: 1, position: "relative",
              transformStyle: "preserve-3d", overflow: "hidden",
            }}
          >
            <motion.div
              animate={{ rotateX: camera.rotateX, rotateY: camera.rotateY, x: `${camera.translateX}%` }}
              transition={{ type: "spring", stiffness: 150, damping: 25 }}
              style={{
                position: "absolute", inset: "4px 12px",
                transformStyle: "preserve-3d",
              }}
            >
              <AnimatePresence>
                {renderOrder.map((layerType) => {
                  const activeIdx = orderedActive.indexOf(layerType);
                  let yPos = topOffset;
                  for (let i = 0; i < activeIdx; i++) {
                    yPos += layerHeights[orderedActive[i]] + gap;
                  }
                  return (
                    <Layer3D
                      key={layerType}
                      layerType={layerType}
                      tracks={tracksForLayer(tracks, layerType)}
                      zOffset={zOffsets[layerType] ?? 0}
                      yPosition={yPos}
                      heightPx={layerHeights[layerType]}
                      rotateX={0}
                      totalDuration={totalDuration}
                      pixelsPerSecond={zoom.pixelsPerSecond}
                      scrollLeft={zoom.scrollLeft}
                      viewportWidth={zoom.viewportWidth - 80}
                      selectedClipId={selectedClipId}
                      selected={false}
                      onSelect={() => {}}
                      onDive={() => handleDive(layerType)}
                      playheadX={playheadX}
                    />
                  );
                })}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 5.11** — Update `modes/clipcraft/viewer/layout/TimelineShell.tsx` to render the real `<TimelineOverview3D>` instead of the Task 2 placeholder. Also wire in `<OverviewControls>` at the top when `timelineMode === "overview"` or `"exploded"`, and dispatch `camera.selectPreset`. (Task 2 already scaffolds the expanded region — this step swaps the `<OverviewPlaceholder>` for the real component.)

  ```tsx
  // Inside TimelineShell's expanded branch, replace the placeholder:
  import { TimelineOverview3D } from "../overview/TimelineOverview3D.js";
  import { OverviewControls } from "../overview/OverviewControls.js";
  import { useOverviewCamera } from "../overview/useOverviewCamera.js";
  // ...
  const { preset, selectPreset, PRESET_ORDER } = useOverviewCamera();
  // ...
  {timelineMode === "dive" ? (
    <DiveCanvasPlaceholder />
  ) : (
    <>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        padding: "4px 12px", flexShrink: 0,
      }}>
        <OverviewControls
          current={preset}
          presets={PRESET_ORDER}
          onSelect={selectPreset}
          onCollapse={() => setTimelineMode("collapsed")}
        />
      </div>
      <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
        {preset === "exploded" ? (
          <ExplodedViewPlaceholder />
        ) : (
          <TimelineOverview3D cameraPreset={preset} />
        )}
      </div>
    </>
  )}
  ```

  Task 6 replaces `ExplodedViewPlaceholder` with the real component. Task 7 replaces `DiveCanvasPlaceholder`.

- [ ] **Step 5.12** — Smoke test: `bun run dev clipcraft`. Click the timeline expand arrow. Expect the 3D scene to rise from the bottom, showing one video layer at z=0 with filmstrip thumbnails spanning the full composition duration. Toggle Caption and Audio layers on — they fly in at their spread Z offsets. Switch between Front/Side camera presets — the whole stack rotates. Press Escape to collapse.

- [ ] **Step 5.13** — `chrome-devtools-mcp` screenshot: verify perspective and playhead alignment visually against the legacy screenshots in `docs/design/clipcraft-overview-2025-03.png` (if present — otherwise just sanity-check the Front preset looks like an angled deck).

**Draft commit message:**

```
feat(clipcraft): TimelineOverview3D ported to craft (Plan 6 Task 5)

Port the legacy 3D overview with framer-motion perspective/rotate
transforms — no Three.js involved. Three layer types (video, caption,
audio), BGM collapsed into the audio layer per mode decision. Layers
read craft tracks directly via useComposition; per-layer content
components iterate clips and render thumbnails (useFrameExtractor),
text, or fake waveforms. Camera presets (front/side) and layer toggle
pills match the legacy look. Escape collapses back to compact.
```

---

## Task 6 — ExplodedView (focused 2.5D stack)

**Why:** ExplodedView is the overview's "exploded" camera preset — a fixed side-angle stack with one layer focused at z=0 and the others receding in front/behind. Scrollwheel shifts focus up/down; clicking a layer dives into it. Legacy implements it with the same framer-motion approach as Overview3D but with a different Y distribution and scene-at-time logic.

Plan 6's twist: legacy resolves "which scene is active" via `sceneAtTime(scenes, globalTime)`. In Plan 6 that lookup uses **Task 1 scenes** (mode-local) when they exist, otherwise falls back to "the clip under the playhead on each track". Clips with no owning scene still render in their natural track position.

Frame capture: legacy uses a DOM `<video>` element and `useCurrentFrame` to snapshot the current frame. Plan 6 replaces that with craft's `subscribeToFrames` hook (on the Zustand store), which delivers `RenderedFrame` objects from the compositor as playback progresses. No DOM video is involved.

**Files:**
- `modes/clipcraft/viewer/exploded/ExplodedView.tsx` (create)
- `modes/clipcraft/viewer/exploded/ExplodedLayer.tsx` (create)
- `modes/clipcraft/viewer/exploded/useCurrentFrame.ts` (create — craft-native)
- `modes/clipcraft/viewer/exploded/useActiveSceneAtTime.ts` (create)
- `modes/clipcraft/viewer/exploded/WaveformBars.tsx` (create — thin wrapper around the existing Plan 5 bars component)
- `modes/clipcraft/viewer/layout/TimelineShell.tsx` (modify — mount real ExplodedView)
- `modes/clipcraft/viewer/hooks/useTimelineMode.ts` (modify — add `focusedLayer` state if not already present from Task 2)

### Steps

- [ ] **Step 6.1** — Create `modes/clipcraft/viewer/exploded/useCurrentFrame.ts`. This is the craft-native replacement for legacy's DOM-based frame grabber. It subscribes to `usePneumaCraftStore((s) => s.subscribeToFrames)` and stores the latest `RenderedFrame.bitmap` as an `<img>`-consumable data URL.

  ```ts
  import { useEffect, useRef, useState } from "react";
  import { usePneumaCraftStore } from "@pneuma-craft/react";
  import type { RenderedFrame } from "@pneuma-craft/video";

  /**
   * Craft-native current-frame capture.
   *
   * Subscribes to the compositor's frame stream via the Zustand store's
   * `subscribeToFrames` method (exposed in Plan 4). Returns the latest
   * rendered frame as a data URL usable inside an <img src>.
   *
   * Throttled to ~100ms to match legacy's DOM capture cadence.
   */
  export function useCurrentFrame(): string | null {
    const subscribeToFrames = usePneumaCraftStore((s) => s.subscribeToFrames);
    const [dataUrl, setDataUrl] = useState<string | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const lastEmitRef = useRef<number>(0);

    useEffect(() => {
      if (!subscribeToFrames) return;
      const off = subscribeToFrames((frame: RenderedFrame) => {
        const now = performance.now();
        if (now - lastEmitRef.current < 100) return;
        lastEmitRef.current = now;

        if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
        const canvas = canvasRef.current;
        // RenderedFrame shape varies by compositor — handle both bitmap and imageData.
        const bmp: ImageBitmap | undefined = (frame as unknown as { bitmap?: ImageBitmap }).bitmap;
        const w = (frame as unknown as { width?: number }).width ?? bmp?.width ?? 0;
        const h = (frame as unknown as { height?: number }).height ?? bmp?.height ?? 0;
        if (!w || !h) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        if (bmp) {
          ctx.drawImage(bmp, 0, 0, w, h);
        } else {
          const img = (frame as unknown as { imageData?: ImageData }).imageData;
          if (img) ctx.putImageData(img, 0, 0);
          else return;
        }
        setDataUrl(canvas.toDataURL("image/jpeg", 0.7));
      });
      return off;
    }, [subscribeToFrames]);

    return dataUrl;
  }
  ```

  **Note:** The `RenderedFrame` shape isn't fully pinned in the `.d.ts` (it's `import('@pneuma-craft/video').RenderedFrame` but the interior surface isn't fully public). The structural typing above covers both the `ImageBitmap` and `ImageData` shapes that the compositor has shipped. If the subagent runs this and gets `null` forever, log one frame via `console.log(frame)` inside the callback and adjust the destructuring.

- [ ] **Step 6.2** — Create `modes/clipcraft/viewer/exploded/useActiveSceneAtTime.ts`. Given the Task 1 scenes list and a current time, returns the active scene (if any). Falls back to "no scene" when the time isn't covered by any member-clip envelope.

  ```ts
  import { useMemo } from "react";
  import { useScenes } from "../scenes/SceneContext.js";
  import { useSceneResolver } from "../scenes/useSceneResolver.js";
  import type { ProjectScene } from "../../persistence.js";

  export function useActiveSceneAtTime(globalTime: number): ProjectScene | null {
    const scenes = useScenes();
    const resolver = useSceneResolver();

    return useMemo(() => {
      for (const scene of scenes) {
        const env = resolver(scene.id);
        if (!env) continue;
        if (globalTime >= env.startTime && globalTime < env.startTime + env.duration) {
          return scene;
        }
      }
      return null;
    }, [scenes, resolver, globalTime]);
  }
  ```

- [ ] **Step 6.3** — Create `modes/clipcraft/viewer/exploded/WaveformBars.tsx`. Thin wrapper around the existing Plan 5 bars renderer so ExplodedLayer doesn't reach across subdirectories.

  ```tsx
  export function WaveformBars({
    peaks, height, color, stretch = false,
  }: { peaks: number[]; height: number; color: string; stretch?: boolean }) {
    return (
      <div style={{
        display: "flex", alignItems: "center", height,
        gap: 1, width: stretch ? "100%" : undefined,
      }}>
        {peaks.map((v, i) => (
          <div key={i} style={{
            flex: stretch ? "1 1 0" : "0 0 3px",
            height: Math.max(2, Math.round(v * height)),
            background: color, borderRadius: 1.5,
          }} />
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 6.4** — Create `modes/clipcraft/viewer/exploded/ExplodedLayer.tsx`. Per-layer card with content dispatch. Uses the layer meta from Task 5.

  ```tsx
  import { useMemo } from "react";
  import { motion } from "framer-motion";
  import { useWaveform } from "../timeline/hooks/useWaveform.js";
  import { WaveformBars } from "./WaveformBars.js";
  import { LAYER_META, type LayerType } from "../overview/layerTypes.js";

  export const LAYER_ORDER: LayerType[] = ["caption", "video", "audio"];

  export interface ExplodedLayerProps {
    layerType: LayerType;
    zOffset: number;
    width: number;
    height: number;
    top: number;
    focused: boolean;
    onClick: () => void;
    captionText: string | null;
    frameUrl: string | null;
    audioUrl: string | null;
  }

  const SPRING = { type: "spring" as const, stiffness: 150, damping: 25 };

  export function ExplodedLayer({
    layerType, zOffset, width, height, top, focused, onClick,
    captionText, frameUrl, audioUrl,
  }: ExplodedLayerProps) {
    const meta = LAYER_META[layerType];

    return (
      <motion.div
        layout
        animate={{ z: zOffset, y: top, scale: focused ? 1.0 : 0.95 }}
        transition={SPRING}
        onClick={onClick}
        whileHover={{ scale: focused ? 1.02 : 0.97 }}
        style={{
          position: "absolute", left: "50%", width, height,
          marginLeft: -width / 2, transformStyle: "flat", cursor: "pointer",
          background: "rgba(9, 9, 11, 0.85)",
          border: `1px solid ${meta.color}${focused ? "80" : "40"}`,
          borderRadius: 8,
          boxShadow: focused
            ? `0 0 20px ${meta.color}25, 0 0 4px ${meta.color}15`
            : `0 0 12px ${meta.color}10`,
          overflow: "hidden", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 10px", fontSize: 10, fontWeight: 600,
          color: meta.color, opacity: 0.8, flexShrink: 0,
        }}>
          <span>{meta.icon}</span>
          <span style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            {meta.label}
          </span>
        </div>

        <div style={{
          flex: 1, display: "flex", alignItems: "center",
          justifyContent: "center", overflow: "hidden", padding: "0 10px 6px",
        }}>
          <LayerContent
            layerType={layerType}
            height={height - 28}
            width={width - 20}
            captionText={captionText}
            frameUrl={frameUrl}
            audioUrl={audioUrl}
          />
        </div>
      </motion.div>
    );
  }

  function LayerContent({
    layerType, height, width, captionText, frameUrl, audioUrl,
  }: {
    layerType: LayerType;
    height: number; width: number;
    captionText: string | null;
    frameUrl: string | null;
    audioUrl: string | null;
  }) {
    switch (layerType) {
      case "caption":
        return <CaptionContent text={captionText} height={height} />;
      case "video":
        return <VideoContent frameUrl={frameUrl} height={height} />;
      case "audio":
        return <AudioContent audioUrl={audioUrl} height={height} width={width} />;
    }
  }

  function CaptionContent({ text, height }: { text: string | null; height: number }) {
    if (!text) {
      return <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>No caption</span>;
    }
    return (
      <div style={{
        color: "#e4e4e7",
        fontSize: Math.min(16, Math.max(11, height * 0.25)),
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight: 400, textAlign: "center",
        lineHeight: 1.4, padding: "0 8px",
        overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", width: "100%",
      }}>
        {text.replace(/\n/g, " ")}
      </div>
    );
  }

  function VideoContent({ frameUrl, height }: { frameUrl: string | null; height: number }) {
    if (!frameUrl) {
      return (
        <div style={{ color: "#52525b", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 20 }}>{"\uD83C\uDFAC"}</span>
          <span style={{ fontStyle: "italic" }}>Capturing frame...</span>
        </div>
      );
    }
    return (
      <img
        src={frameUrl}
        alt="Current frame"
        style={{
          maxHeight: height, maxWidth: "100%", objectFit: "contain",
          borderRadius: 4,
        }}
      />
    );
  }

  function AudioContent({ audioUrl, height, width }: { audioUrl: string | null; height: number; width: number }) {
    const bars = Math.max(20, Math.floor(width / 3));
    const { waveform } = useWaveform(audioUrl ? { audioUrl, bars } : null);

    if (!audioUrl) {
      return <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>No audio</span>;
    }
    if (!waveform) {
      return <span style={{ color: "#52525b", fontSize: 11 }}>Loading waveform...</span>;
    }
    return (
      <WaveformBars
        peaks={waveform.peaks}
        height={Math.max(16, height - 4)}
        color="#38bdf8"
        stretch
      />
    );
  }
  ```

- [ ] **Step 6.5** — Create `modes/clipcraft/viewer/exploded/ExplodedView.tsx`. Top-level exploded stack. Reads craft state, uses the Task 1 scene resolver to figure out the active scene's caption + member-clip audio URL, and uses `useCurrentFrame` (Step 6.1) for the live video surface.

  ```tsx
  import { useRef, useState, useCallback, useEffect, useMemo } from "react";
  import { motion, AnimatePresence } from "framer-motion";
  import { useComposition, usePlayback, useAsset } from "@pneuma-craft/react";
  import { useTimelineMode } from "../hooks/useTimelineMode.js";
  import { tracksForLayer, type LayerType } from "../overview/layerTypes.js";
  import { LayerToggle } from "../overview/LayerToggle.js";
  import { ExplodedLayer, LAYER_ORDER } from "./ExplodedLayer.js";
  import { useCurrentFrame } from "./useCurrentFrame.js";
  import { useActiveSceneAtTime } from "./useActiveSceneAtTime.js";
  import { useWorkspaceAssetUrl } from "../assets/useWorkspaceAssetUrl.js";

  const CAMERA = {
    rotateX: -12,
    rotateY: 20,
    perspective: 800,
    perspectiveOriginX: 50,
    perspectiveOriginY: 45,
  } as const;

  const Z_GAP = 80;
  const MAX_H: Record<LayerType, number> = { video: 200, caption: 72, audio: 56 };
  const MIN_H: Record<LayerType, number> = { video: 80, caption: 32, audio: 32 };
  const SPRING = { type: "spring" as const, stiffness: 150, damping: 25 };

  function computeZOffsets(activeLayers: LayerType[], focusedLayer: LayerType): Record<string, number> {
    const focusIdx = activeLayers.indexOf(focusedLayer);
    const offsets: Record<string, number> = {};
    for (let i = 0; i < activeLayers.length; i++) {
      offsets[activeLayers[i]] = (focusIdx - i) * Z_GAP;
    }
    return offsets;
  }

  export function ExplodedView() {
    const composition = useComposition();
    const playback = usePlayback();
    const { setTimelineMode, setDiveLayer, focusedLayer: storedFocus, setFocusedLayer } = useTimelineMode();

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });

    const tracks = composition?.tracks ?? [];

    const [activeLayers, setActiveLayers] = useState<Set<LayerType>>(() => {
      const initial = new Set<LayerType>(["caption", "video", "audio"]);
      return initial;
    });

    const disabledLayers = useMemo(() => {
      const d = new Set<LayerType>();
      if (tracksForLayer(tracks, "video").length === 0) d.add("video");
      if (tracksForLayer(tracks, "caption").length === 0) d.add("caption");
      if (tracksForLayer(tracks, "audio").length === 0) d.add("audio");
      return d;
    }, [tracks]);

    const toggleLayer = useCallback((layer: LayerType) => {
      setActiveLayers((prev) => {
        const next = new Set(prev);
        if (next.has(layer)) {
          if (next.size > 1) next.delete(layer);
        } else {
          next.add(layer);
        }
        return next;
      });
    }, []);

    const orderedActive = useMemo(
      () => LAYER_ORDER.filter((l) => activeLayers.has(l)),
      [activeLayers],
    );

    const focusedLayer = useMemo((): LayerType => {
      if (storedFocus && activeLayers.has(storedFocus)) return storedFocus;
      if (activeLayers.has("video")) return "video";
      return orderedActive[0] ?? "video";
    }, [storedFocus, activeLayers, orderedActive]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const obs = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect) setContainerSize({ width: rect.width, height: rect.height });
      });
      obs.observe(el);
      return () => obs.disconnect();
    }, []);

    // Active scene at playhead (via Task 1 scene resolver)
    const activeScene = useActiveSceneAtTime(playback.currentTime);

    // Caption text: first subtitle clip whose envelope covers currentTime.
    const captionText = useMemo(() => {
      for (const track of tracksForLayer(tracks, "caption")) {
        for (const clip of track.clips) {
          if (
            playback.currentTime >= clip.startTime &&
            playback.currentTime < clip.startTime + clip.duration
          ) {
            return clip.text ?? null;
          }
        }
      }
      return null;
    }, [tracks, playback.currentTime]);

    // Audio clip at playhead (first audio track's clip envelope straddling currentTime).
    const activeAudioClip = useMemo(() => {
      for (const track of tracksForLayer(tracks, "audio")) {
        for (const clip of track.clips) {
          if (
            playback.currentTime >= clip.startTime &&
            playback.currentTime < clip.startTime + clip.duration
          ) {
            return clip;
          }
        }
      }
      return null;
    }, [tracks, playback.currentTime]);

    const audioUrl = useWorkspaceAssetUrl(activeAudioClip?.assetId ?? null);
    const frameUrl = useCurrentFrame();

    const handleWheel = useCallback((e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      if (Math.abs(delta) < 5) return;
      const currentIdx = orderedActive.indexOf(focusedLayer);
      let nextIdx: number;
      if (delta > 0) {
        nextIdx = Math.min(orderedActive.length - 1, currentIdx + 1);
      } else {
        nextIdx = Math.max(0, currentIdx - 1);
      }
      if (nextIdx !== currentIdx) {
        setFocusedLayer(orderedActive[nextIdx]);
      }
    }, [orderedActive, focusedLayer, setFocusedLayer]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      el.addEventListener("wheel", handleWheel, { passive: false });
      return () => el.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    const handleCollapse = useCallback(() => {
      setTimelineMode("collapsed");
    }, [setTimelineMode]);

    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") handleCollapse();
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [handleCollapse]);

    const handleDive = useCallback((layer: LayerType) => {
      setDiveLayer(layer);
      setTimelineMode("dive");
    }, [setDiveLayer, setTimelineMode]);

    const sceneW = containerSize.width - 88;
    const sceneH = containerSize.height;
    const settings = composition?.settings;
    const arRatio = settings ? settings.width / settings.height : 16 / 9;
    const layerWidth = Math.min(sceneW * 0.7, sceneH * arRatio * 0.5);

    const gap = 8;
    const totalGap = Math.max(0, orderedActive.length - 1) * gap;
    const availH = sceneH - totalGap;
    const totalMaxH = orderedActive.reduce((s, l) => s + MAX_H[l], 0);

    const layerHeights: Record<string, number> = {};
    for (const l of orderedActive) {
      const ratio = MAX_H[l] / totalMaxH;
      const h = Math.floor(availH * ratio);
      layerHeights[l] = Math.max(MIN_H[l], Math.min(h, MAX_H[l]));
    }

    const totalLayersH = orderedActive.reduce((s, l) => s + layerHeights[l], 0) + totalGap;
    const topOffset = Math.max(0, Math.floor((sceneH - totalLayersH) / 2));
    const zOffsets = computeZOffsets(orderedActive, focusedLayer);

    const layerTops: Record<string, number> = {};
    let yAccum = topOffset;
    for (const l of orderedActive) {
      layerTops[l] = yAccum;
      yAccum += layerHeights[l] + gap;
    }

    const renderOrder = [...orderedActive].reverse();

    return (
      <div
        ref={containerRef}
        style={{
          height: "100%", display: "flex", background: "#09090b",
          position: "relative", overflow: "hidden",
        }}
      >
        <div style={{
          width: 44, flexShrink: 0, display: "flex", flexDirection: "column",
          justifyContent: "center", borderRight: "1px solid #1a1a1e", zIndex: 20,
        }}>
          <LayerToggle
            activeLayers={activeLayers}
            onToggle={toggleLayer}
            disabledLayers={disabledLayers}
          />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <motion.div
            animate={{
              perspective: CAMERA.perspective,
              perspectiveOrigin: `${CAMERA.perspectiveOriginX}% ${CAMERA.perspectiveOriginY}%`,
            }}
            transition={SPRING}
            style={{
              flex: 1, position: "relative",
              transformStyle: "preserve-3d", overflow: "hidden",
            }}
          >
            <motion.div
              animate={{ rotateX: CAMERA.rotateX, rotateY: CAMERA.rotateY }}
              transition={SPRING}
              style={{
                position: "absolute", inset: 0,
                transformStyle: "preserve-3d",
              }}
            >
              <AnimatePresence>
                {renderOrder.map((layerType) => (
                  <ExplodedLayer
                    key={layerType}
                    layerType={layerType}
                    zOffset={zOffsets[layerType] ?? 0}
                    width={layerWidth}
                    height={layerHeights[layerType]}
                    top={layerTops[layerType]}
                    focused={layerType === focusedLayer}
                    onClick={() => handleDive(layerType)}
                    captionText={captionText}
                    frameUrl={frameUrl}
                    audioUrl={audioUrl}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 6.6** — Update `modes/clipcraft/viewer/layout/TimelineShell.tsx` to mount the real `<ExplodedView />` when `preset === "exploded"`, replacing the Task 5 placeholder.

  ```tsx
  import { ExplodedView } from "../exploded/ExplodedView.js";
  // ...
  {preset === "exploded" ? (
    <ExplodedView />
  ) : (
    <TimelineOverview3D cameraPreset={preset} />
  )}
  ```

- [ ] **Step 6.7** — If Task 2 didn't already expose `focusedLayer` + `setFocusedLayer` from `useTimelineMode`, add them now. The state is a plain `useState<LayerType | null>(null)` inside the `TimelineModeProvider`.

- [ ] **Step 6.8** — Smoke test: `bun run dev clipcraft`. Click the Exploded camera preset. Expect a fixed side angle with three layers stacked, the active one scaled 1.0 and the others 0.95. Scroll up/down inside the view — focus walks through the layers. Click a non-focused layer — the shell switches to dive mode (Task 7 placeholder until then).

- [ ] **Step 6.9** — Verify the craft frame subscription actually fires. During playback the video layer's content area should show the live compositor output, not "Capturing frame..." forever. If it stays in the fallback state, log the frame shape once and adjust Step 6.1's destructuring — this is the single most likely place to discover a `RenderedFrame` shape mismatch.

**Draft commit message:**

```
feat(clipcraft): ExplodedView ported to craft (Plan 6 Task 6)

Port the legacy side-camera exploded stack. Scenes come from Task 1's
mode-local scene context; caption/audio clips at the playhead are
resolved directly from craft tracks. Video frame capture switches
from legacy's DOM-video approach to craft's PlaybackEngine
subscribeToFrames stream, snapshotted to a hidden canvas and emitted
as a data URL. Focus-layer state moves into the mode-local
TimelineModeContext.
```

---

## Task 7 — DiveCanvas + nodes (xyflow + dagre on provenance)

**Why:** Dive is the "zoom into the generation tree for a single slot" view — a horizontal dag of variant nodes with the active path highlighted in orange. Legacy used a custom `AssetGraph` keyed by `clip.visual/audio/caption` slot bindings. Plan 6 switches the data source to **craft's provenance**: `useLineage(assetId)` returns ancestor-to-variant chain, `useVariants(assetId)` returns siblings. Dagre lays them out LR; xyflow renders nodes.

**Variant pointer** is mode-local `Map<clipId, activeAssetId>` via React context. The dive canvas does NOT dispatch `asset:register` or mutate provenance edges — it only reads, and "Use This" updates the pointer Map. (Future Plan 9 will rewire this to dispatch real variant-switch commands.)

**Dependencies to add:**

- [ ] **Step 7.1** — Install `@xyflow/react` and `@dagrejs/dagre`:

  ```bash
  bun add @xyflow/react@^12 @dagrejs/dagre@^1
  ```

  Add to `package.json` dependencies; verify `bun install` succeeds. Confirm the TypeScript types ship with both packages (they do as of `@xyflow/react@12` and `@dagrejs/dagre@1`).

**Files:**
- `package.json` (modify — add deps)
- `modes/clipcraft/viewer/dive/DiveCanvas.tsx` (create)
- `modes/clipcraft/viewer/dive/DiveHeader.tsx` (create)
- `modes/clipcraft/viewer/dive/useTreeLayout.ts` (create)
- `modes/clipcraft/viewer/dive/useVariantPointer.tsx` (create)
- `modes/clipcraft/viewer/dive/nodes/NodeShell.tsx` (create)
- `modes/clipcraft/viewer/dive/nodes/VisualNode.tsx` (create)
- `modes/clipcraft/viewer/dive/nodes/AudioNode.tsx` (create)
- `modes/clipcraft/viewer/dive/nodes/TextNode.tsx` (create)
- `modes/clipcraft/viewer/layout/TimelineShell.tsx` (modify — mount real DiveCanvas)
- `modes/clipcraft/viewer/ClipCraftPreview.tsx` (modify — wrap in `VariantPointerProvider`)

### Steps

- [ ] **Step 7.2** — Create `modes/clipcraft/viewer/dive/useVariantPointer.tsx`. Mode-local `Map<clipId, activeAssetId>` context. Defaults to a clip's `assetId` if no pointer set.

  ```tsx
  import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

  interface VariantPointerContextValue {
    pointers: Map<string, string>;
    get: (clipId: string) => string | undefined;
    set: (clipId: string, assetId: string) => void;
  }

  const VariantPointerContext = createContext<VariantPointerContextValue | null>(null);

  export function VariantPointerProvider({ children }: { children: React.ReactNode }) {
    const [pointers, setPointers] = useState<Map<string, string>>(() => new Map());

    const get = useCallback((clipId: string) => pointers.get(clipId), [pointers]);

    const set = useCallback((clipId: string, assetId: string) => {
      setPointers((prev) => {
        const next = new Map(prev);
        next.set(clipId, assetId);
        return next;
      });
    }, []);

    const value = useMemo(() => ({ pointers, get, set }), [pointers, get, set]);

    return <VariantPointerContext.Provider value={value}>{children}</VariantPointerContext.Provider>;
  }

  export function useVariantPointer(): VariantPointerContextValue {
    const ctx = useContext(VariantPointerContext);
    if (!ctx) throw new Error("useVariantPointer must be used inside VariantPointerProvider");
    return ctx;
  }
  ```

- [ ] **Step 7.3** — Create `modes/clipcraft/viewer/dive/useTreeLayout.ts`. Dagre layout over a craft-provenance lineage. Inputs: root `assetId` + `activeAssetId`. Output: xyflow `Node[]` + `Edge[]`.

  The craft equivalent of legacy's `AssetGraph` traversal is a BFS through provenance edges. Since `@pneuma-craft/react` exports `useLineage(assetId)` (returns ancestors) and `useVariants(assetId)` (returns siblings), we compose a small local tree here.

  ```ts
  import { useMemo } from "react";
  import dagre from "@dagrejs/dagre";
  import type { Node, Edge } from "@xyflow/react";
  import type { Asset } from "@pneuma-craft/core";
  import { usePneumaCraftStore } from "@pneuma-craft/react";

  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 160;

  export interface TreeNodeData {
    asset: Asset;
    isActive: boolean;
    isFocused: boolean;
    isOnActivePath: boolean;
    clipId: string;
  }

  /**
   * Collect every asset reachable from `rootAssetId` through provenance edges
   * (both ancestors and descendants/variants) and lay them out horizontally
   * with dagre. Highlights the path from root to `activeAssetId`.
   */
  export function useTreeLayout(
    rootAssetId: string | null,
    activeAssetId: string | null,
    diveFocusedNodeId: string | null,
    clipId: string,
  ): { nodes: Node<TreeNodeData>[]; edges: Edge[] } {
    const coreState = usePneumaCraftStore((s) => s.coreState);

    return useMemo(() => {
      if (!rootAssetId) return { nodes: [], edges: [] };

      // 1. BFS over provenance edges, collecting reachable assets.
      const reachable = new Set<string>();
      const parentByChild = new Map<string, string | null>();
      const queue: string[] = [rootAssetId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        for (const edge of coreState.provenance.edges.values()) {
          if (edge.fromAssetId === id && !reachable.has(edge.toAssetId)) {
            parentByChild.set(edge.toAssetId, id);
            queue.push(edge.toAssetId);
          }
          if (edge.toAssetId === id && edge.fromAssetId && !reachable.has(edge.fromAssetId)) {
            parentByChild.set(id, edge.fromAssetId);
            queue.push(edge.fromAssetId);
          }
        }
      }

      const treeAssets: Asset[] = [];
      for (const id of reachable) {
        const asset = coreState.registry.get(id);
        if (asset) treeAssets.push(asset);
      }
      if (treeAssets.length === 0) return { nodes: [], edges: [] };

      // 2. Active path: walk parentByChild from activeAssetId to root.
      const activePath = new Set<string>();
      let cur: string | null = activeAssetId ?? rootAssetId;
      while (cur) {
        activePath.add(cur);
        cur = parentByChild.get(cur) ?? null;
      }

      // 3. Dagre layout.
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120 });
      g.setDefaultEdgeLabel(() => ({}));

      for (const asset of treeAssets) {
        g.setNode(asset.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
      }
      for (const [child, parent] of parentByChild.entries()) {
        if (parent && reachable.has(parent) && reachable.has(child)) {
          g.setEdge(parent, child);
        }
      }

      dagre.layout(g);

      // 4. Map to xyflow nodes.
      const xyNodes: Node<TreeNodeData>[] = treeAssets.map((asset) => {
        const pos = g.node(asset.id);
        const nodeType =
          asset.type === "image" || asset.type === "video" ? "visual" :
          asset.type === "audio" ? "audio" : "text";
        return {
          id: asset.id,
          type: nodeType,
          position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
          data: {
            asset,
            isActive: asset.id === activeAssetId,
            isFocused: asset.id === diveFocusedNodeId,
            isOnActivePath: activePath.has(asset.id),
            clipId,
          },
        };
      });

      // 5. Edges.
      const xyEdges: Edge[] = [];
      for (const [child, parent] of parentByChild.entries()) {
        if (!parent || !reachable.has(parent) || !reachable.has(child)) continue;
        const isActive = activePath.has(child) && activePath.has(parent);
        const childAsset = coreState.registry.get(child);
        xyEdges.push({
          id: `edge-${parent}-${child}`,
          source: parent,
          target: child,
          style: {
            stroke: isActive ? "#f97316" : "#3f3f46",
            strokeWidth: isActive ? 2 : 1,
          },
          animated: childAsset?.status === "generating",
        });
      }

      return { nodes: xyNodes, edges: xyEdges };
    }, [rootAssetId, activeAssetId, diveFocusedNodeId, clipId, coreState]);
  }
  ```

- [ ] **Step 7.4** — Create `modes/clipcraft/viewer/dive/nodes/NodeShell.tsx`. Shared node shell, ported from legacy with provenance-edge lookup replacing `graphNode.metadata`.

  ```tsx
  import { useCallback, useMemo } from "react";
  import type { Asset } from "@pneuma-craft/core";
  import { usePneumaCraftStore } from "@pneuma-craft/react";
  import { useVariantPointer } from "../useVariantPointer.js";
  import { useTimelineMode } from "../../hooks/useTimelineMode.js";

  type NodeOrigin = "upload" | "ai-gen" | "manual" | "ai-search";

  const ORIGIN_CONFIG: Record<NodeOrigin, { icon: string; label: string }> = {
    "upload":     { icon: "\u2191", label: "Upload" },
    "ai-gen":     { icon: "\u2726", label: "AI Generated" },
    "manual":     { icon: "\u270E", label: "Manual" },
    "ai-search":  { icon: "\u2315", label: "AI Search" },
  };

  const STATUS_COLORS: Record<string, string> = {
    ready: "#22c55e",
    generating: "#f59e0b",
    pending: "#71717a",
    failed: "#ef4444",
  };

  interface Props {
    asset: Asset;
    isActive: boolean;
    isFocused: boolean;
    clipId: string;
    children: React.ReactNode;
  }

  export function NodeShell({ asset, isActive, isFocused, clipId, children }: Props) {
    const { set } = useVariantPointer();
    const { setDiveFocusedNodeId } = useTimelineMode();
    const coreState = usePneumaCraftStore((s) => s.coreState);

    // Look up the provenance edge that terminates at this asset. That edge's
    // operation carries the prompt/model/params metadata legacy read from
    // graphNode.metadata.
    const edge = useMemo(() => {
      for (const e of coreState.provenance.edges.values()) {
        if (e.toAssetId === asset.id) return e;
      }
      return null;
    }, [coreState.provenance.edges, asset.id]);

    const op = edge?.operation;
    const originRaw = op?.params?.source as string | undefined;
    const origin: NodeOrigin =
      originRaw === "upload" ? "upload" :
      op?.type === "generate" ? "ai-gen" :
      op?.type === "import" ? "upload" :
      "manual";
    const originCfg = ORIGIN_CONFIG[origin];
    const statusColor = STATUS_COLORS[asset.status ?? "ready"] ?? STATUS_COLORS.pending;

    const prompt = op?.params?.prompt as string | undefined;
    const model = op?.params?.model as string | undefined;

    const handleUseThis = useCallback(() => {
      set(clipId, asset.id);
    }, [set, clipId, asset.id]);

    const handleClick = useCallback(() => {
      setDiveFocusedNodeId(asset.id);
    }, [setDiveFocusedNodeId, asset.id]);

    const borderColor = isActive ? "#f97316" : isFocused ? "#a1a1aa" : "#3f3f46";
    const bgColor = isActive ? "#431407" : "#1c1917";

    return (
      <div
        onClick={handleClick}
        style={{
          width: 200, background: bgColor,
          border: `${isActive ? 2 : 1}px solid ${borderColor}`,
          borderRadius: 10, padding: 10, cursor: "pointer",
          boxShadow: isActive ? "0 0 20px rgba(249,115,22,0.15)" : "none",
          animation: asset.status === "generating" ? "pulse 2s ease-in-out infinite" : undefined,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 8,
        }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: isActive ? "#7c2d12" : "#27272a",
            padding: "2px 8px", borderRadius: 4, fontSize: 10,
            color: isActive ? "#fdba74" : "#a1a1aa",
          }}>
            <span style={{ fontSize: 11 }}>{originCfg.icon}</span>
            {originCfg.label}
          </span>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: statusColor, flexShrink: 0,
          }} />
        </div>

        {children}

        {prompt && (
          <div style={{
            fontSize: 10, color: isActive ? "#e5e5e5" : "#a1a1aa",
            marginTop: 8, lineHeight: 1.4, overflow: "hidden",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            "{prompt}"
          </div>
        )}

        {model && (
          <div style={{ fontSize: 9, color: "#71717a", marginTop: 4 }}>
            {model}
            {asset.metadata.duration != null && ` · ${asset.metadata.duration.toFixed(1)}s`}
            {asset.metadata.width != null && ` · ${asset.metadata.width}\u00D7${asset.metadata.height}`}
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          {isActive ? (
            <div style={{
              padding: "4px 0", textAlign: "center", background: "#7c2d12",
              borderRadius: 4, fontSize: 10, color: "#fdba74",
            }}>
              {"\u2713"} Active
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleUseThis(); }}
              style={{
                width: "100%", padding: "4px 0", textAlign: "center",
                background: "#27272a", border: "1px solid #3f3f46",
                borderRadius: 4, fontSize: 10, color: "#a1a1aa", cursor: "pointer",
              }}
            >
              Use This
            </button>
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 7.5** — Create `modes/clipcraft/viewer/dive/nodes/VisualNode.tsx`.

  ```tsx
  import { Handle, Position, type NodeProps } from "@xyflow/react";
  import type { TreeNodeData } from "../useTreeLayout.js";
  import { NodeShell } from "./NodeShell.js";
  import { useWorkspaceAssetUrl } from "../../assets/useWorkspaceAssetUrl.js";

  export function VisualNode({ data }: NodeProps) {
    const { asset, isActive, isFocused, clipId } = data as unknown as TreeNodeData;
    const src = useWorkspaceAssetUrl(asset.id);
    const hasThumb = !!src && asset.status !== "failed" && asset.status !== "pending";

    return (
      <>
        <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />
        <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
          <div style={{
            width: "100%", height: 90, background: "#292524",
            borderRadius: 6, overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {hasThumb ? (
              <img
                src={src}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                draggable={false}
              />
            ) : asset.status === "generating" ? (
              <span style={{ color: "#f59e0b", fontSize: 11 }}>Generating...</span>
            ) : asset.status === "failed" ? (
              <span style={{ color: "#ef4444", fontSize: 11 }}>Error</span>
            ) : (
              <span style={{ color: "#52525b", fontSize: 11 }}>
                {asset.type === "video" ? "Video" : "Image"}
              </span>
            )}
          </div>
        </NodeShell>
        <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
      </>
    );
  }
  ```

- [ ] **Step 7.6** — Create `modes/clipcraft/viewer/dive/nodes/AudioNode.tsx`.

  ```tsx
  import { Handle, Position, type NodeProps } from "@xyflow/react";
  import { usePneumaCraftStore } from "@pneuma-craft/react";
  import type { TreeNodeData } from "../useTreeLayout.js";
  import { NodeShell } from "./NodeShell.js";

  export function AudioNode({ data }: NodeProps) {
    const { asset, isActive, isFocused, clipId } = data as unknown as TreeNodeData;
    const coreState = usePneumaCraftStore((s) => s.coreState);

    let voice: string | undefined;
    let content: string | undefined;
    for (const e of coreState.provenance.edges.values()) {
      if (e.toAssetId === asset.id) {
        voice = e.operation.params?.voice as string | undefined;
        content = e.operation.params?.text as string | undefined;
        break;
      }
    }
    const duration = asset.metadata.duration;

    return (
      <>
        <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />
        <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
          {content && (
            <div style={{
              background: "#292524", borderRadius: 6, padding: "8px 10px",
              fontSize: 11, color: "#d4d4d8", lineHeight: 1.4,
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
            }}>
              {content}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: "#71717a" }}>
            {voice && <span>Voice: {voice}</span>}
            {duration != null && <span>{duration.toFixed(1)}s</span>}
          </div>
          {asset.status === "generating" && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#f59e0b" }}>Generating...</div>
          )}
          {asset.status === "failed" && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#ef4444" }}>Generation failed</div>
          )}
        </NodeShell>
        <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
      </>
    );
  }
  ```

- [ ] **Step 7.7** — Create `modes/clipcraft/viewer/dive/nodes/TextNode.tsx`. TextNode renders `Clip.text` directly — but since nodes are indexed by asset and text isn't an asset in Plan 6, the TextNode is only used when the dive layer is `caption` AND we render a single synthetic node keyed by clip id. The helper in `DiveCanvas` injects this synthetic node.

  ```tsx
  import { Handle, Position, type NodeProps } from "@xyflow/react";
  import type { TreeNodeData } from "../useTreeLayout.js";
  import { NodeShell } from "./NodeShell.js";

  export function TextNode({ data }: NodeProps) {
    const { asset, isActive, isFocused, clipId } = data as unknown as TreeNodeData;
    // For caption-layer synthetic nodes we stuff the clip text into
    // asset.name via the DiveCanvas adapter.
    const body = asset.name || "";

    return (
      <>
        <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />
        <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
          <div style={{
            background: "#292524", borderRadius: 6, padding: "8px 10px",
            fontSize: 12, color: "#e5e5e5", lineHeight: 1.5, minHeight: 40,
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
          }}>
            {body || <span style={{ color: "#52525b", fontStyle: "italic" }}>Empty</span>}
          </div>
        </NodeShell>
        <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
      </>
    );
  }
  ```

- [ ] **Step 7.8** — Create `modes/clipcraft/viewer/dive/DiveHeader.tsx`. Ported from legacy with back/prev/next driven by `useTimelineMode` and `usePlayback`.

  ```tsx
  import { useCallback, useEffect, useMemo } from "react";
  import { usePlayback } from "@pneuma-craft/react";
  import { useTimelineMode } from "../hooks/useTimelineMode.js";
  import { LAYER_META, type LayerType } from "../overview/layerTypes.js";
  import { useScenes } from "../scenes/SceneContext.js";
  import { useSceneResolver } from "../scenes/useSceneResolver.js";

  export function DiveHeader() {
    const { diveLayer, setTimelineMode, setDiveLayer } = useTimelineMode();
    const playback = usePlayback();
    const scenes = useScenes();
    const resolver = useSceneResolver();

    const layer: LayerType = (diveLayer ?? "video") as LayerType;
    const meta = LAYER_META[layer];

    const sceneIndex = useMemo(() => {
      for (let i = 0; i < scenes.length; i++) {
        const env = resolver(scenes[i].id);
        if (!env) continue;
        if (playback.currentTime >= env.startTime && playback.currentTime < env.startTime + env.duration) {
          return i;
        }
      }
      return -1;
    }, [scenes, resolver, playback.currentTime]);

    const scene = sceneIndex >= 0 ? scenes[sceneIndex] : null;
    const sceneLabel = scene ? `Scene ${scene.order + 1}` : "";

    const handleBack = useCallback(() => {
      setTimelineMode("overview");
      setDiveLayer(null);
    }, [setTimelineMode, setDiveLayer]);

    const handlePrevScene = useCallback(() => {
      if (sceneIndex <= 0) return;
      const env = resolver(scenes[sceneIndex - 1].id);
      if (env) playback.seek(env.startTime);
    }, [sceneIndex, scenes, resolver, playback]);

    const handleNextScene = useCallback(() => {
      if (sceneIndex < 0 || sceneIndex >= scenes.length - 1) return;
      const env = resolver(scenes[sceneIndex + 1].id);
      if (env) playback.seek(env.startTime);
    }, [sceneIndex, scenes, resolver, playback]);

    useEffect(() => {
      const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleBack(); };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [handleBack]);

    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, height: 40,
        padding: "0 12px", borderBottom: "1px solid #27272a", flexShrink: 0,
      }}>
        <button
          onClick={handleBack}
          title="Back to overview"
          style={{
            background: "none", border: "1px solid #3f3f46", borderRadius: 4,
            color: "#a1a1aa", cursor: "pointer", padding: "2px 8px",
            fontSize: 13, display: "flex", alignItems: "center",
          }}
        >
          {"\u2190"}
        </button>

        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          color: meta.color, fontWeight: 600, fontSize: 12,
          fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "0.05em",
        }}>
          <span>{meta.icon}</span>
          <span>{meta.label.toUpperCase()}</span>
        </div>

        <span style={{ color: "#71717a", fontSize: 11 }}>— {sceneLabel}</span>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={handlePrevScene}
            disabled={sceneIndex <= 0}
            title="Previous scene"
            style={{
              background: "none", border: "1px solid #3f3f46", borderRadius: 4,
              color: sceneIndex <= 0 ? "#3f3f46" : "#a1a1aa",
              cursor: sceneIndex <= 0 ? "default" : "pointer",
              padding: "2px 6px", fontSize: 12,
            }}
          >
            {"\u2190"}
          </button>
          <button
            onClick={handleNextScene}
            disabled={sceneIndex < 0 || sceneIndex >= scenes.length - 1}
            title="Next scene"
            style={{
              background: "none", border: "1px solid #3f3f46", borderRadius: 4,
              color: sceneIndex < 0 || sceneIndex >= scenes.length - 1 ? "#3f3f46" : "#a1a1aa",
              cursor: sceneIndex < 0 || sceneIndex >= scenes.length - 1 ? "default" : "pointer",
              padding: "2px 6px", fontSize: 12,
            }}
          >
            {"\u2192"}
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 7.9** — Create `modes/clipcraft/viewer/dive/DiveCanvas.tsx`. Pulls the clip under the playhead for the active dive layer, then renders the xyflow tree rooted at that clip's current asset.

  ```tsx
  import { useMemo, useEffect } from "react";
  import {
    ReactFlow,
    MiniMap,
    Controls,
    Background,
    BackgroundVariant,
    ReactFlowProvider,
    useReactFlow,
    type NodeTypes,
  } from "@xyflow/react";
  import "@xyflow/react/dist/style.css";
  import { useComposition, usePlayback } from "@pneuma-craft/react";
  import type { Asset } from "@pneuma-craft/core";
  import { useTimelineMode } from "../hooks/useTimelineMode.js";
  import { useVariantPointer } from "./useVariantPointer.js";
  import { tracksForLayer, type LayerType } from "../overview/layerTypes.js";
  import { useTreeLayout } from "./useTreeLayout.js";
  import { DiveHeader } from "./DiveHeader.js";
  import { VisualNode } from "./nodes/VisualNode.js";
  import { AudioNode } from "./nodes/AudioNode.js";
  import { TextNode } from "./nodes/TextNode.js";

  const RF_DARK_STYLES = `
  .react-flow {
    --xy-controls-button-background-color-default: #27272a;
    --xy-controls-button-background-color-hover-default: #3f3f46;
    --xy-controls-button-color-default: #a1a1aa;
    --xy-controls-button-color-hover-default: #fafafa;
    --xy-background-color-default: #09090b;
    --xy-background-pattern-dots-color-default: rgba(255,255,255,0.05);
    --xy-node-background-color-default: transparent;
    --xy-node-border-default: none;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  `;

  const nodeTypes: NodeTypes = {
    visual: VisualNode,
    audio: AudioNode,
    text: TextNode,
  };

  function DiveCanvasInner() {
    const composition = useComposition();
    const playback = usePlayback();
    const { diveLayer, diveFocusedNodeId, setDiveFocusedNodeId } = useTimelineMode();
    const { get: getVariant } = useVariantPointer();
    const { fitView, setCenter, getNode } = useReactFlow();

    const layer: LayerType = (diveLayer ?? "video") as LayerType;
    const tracks = composition?.tracks ?? [];

    // Find the clip at the current time for the active dive layer.
    const activeClip = useMemo(() => {
      for (const track of tracksForLayer(tracks, layer)) {
        for (const clip of track.clips) {
          if (
            playback.currentTime >= clip.startTime &&
            playback.currentTime < clip.startTime + clip.duration
          ) {
            return clip;
          }
        }
      }
      return null;
    }, [tracks, layer, playback.currentTime]);

    const clipId = activeClip?.id ?? "";
    // Root asset for the provenance tree = the clip's current assetId, or the
    // mode-local pointer override if set.
    const rootAssetId = useMemo(() => {
      if (!activeClip) return null;
      const override = getVariant(activeClip.id);
      return override ?? activeClip.assetId;
    }, [activeClip, getVariant]);

    const activeAssetId = rootAssetId;

    const { nodes, edges } = useTreeLayout(rootAssetId, activeAssetId, diveFocusedNodeId, clipId);

    // Caption layer: synthesize a single TextNode from clip.text.
    const effectiveNodes = useMemo(() => {
      if (layer !== "caption") return nodes;
      if (!activeClip) return [];
      const syntheticAsset: Asset = {
        id: `caption-${activeClip.id}`,
        type: "text",
        uri: "",
        name: activeClip.text ?? "",
        metadata: {},
        createdAt: Date.now(),
      };
      return [{
        id: syntheticAsset.id,
        type: "text",
        position: { x: 0, y: 0 },
        data: {
          asset: syntheticAsset,
          isActive: true,
          isFocused: false,
          isOnActivePath: true,
          clipId: activeClip.id,
        },
      }];
    }, [layer, nodes, activeClip]);

    const effectiveEdges = layer === "caption" ? [] : edges;

    useEffect(() => {
      if (effectiveNodes.length > 0) {
        const timer = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
        return () => clearTimeout(timer);
      }
    }, [effectiveNodes.length, fitView]);

    useEffect(() => {
      if (!diveFocusedNodeId) return;
      const rfNode = getNode(diveFocusedNodeId);
      if (rfNode) {
        const x = rfNode.position.x + (rfNode.measured?.width ?? 200) / 2;
        const y = rfNode.position.y + (rfNode.measured?.height ?? 160) / 2;
        setCenter(x, y, { duration: 300 });
      }
    }, [diveFocusedNodeId, getNode, setCenter]);

    useEffect(() => {
      return () => setDiveFocusedNodeId(null);
    }, [setDiveFocusedNodeId]);

    return (
      <div style={{
        height: "100%", display: "flex", flexDirection: "column",
        background: "#09090b",
      }}>
        <style>{RF_DARK_STYLES}</style>

        <DiveHeader />

        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {effectiveNodes.length > 0 ? (
            <ReactFlow
              nodes={effectiveNodes}
              edges={effectiveEdges}
              nodeTypes={nodeTypes}
              proOptions={{ hideAttribution: true }}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              style={{ background: "#09090b" }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1}
                color="rgba(255,255,255,0.04)"
              />
              <Controls showInteractive={false} />
              <MiniMap nodeColor={() => "#f97316"} pannable zoomable />
            </ReactFlow>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", color: "#52525b", fontSize: 13, fontStyle: "italic",
            }}>
              No generation tree for this slot yet.
            </div>
          )}
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "6px 16px", borderTop: "1px solid #27272a",
          fontSize: 11, flexShrink: 0,
        }}>
          <span style={{ color: "#71717a" }}>
            {effectiveNodes.length} node{effectiveNodes.length !== 1 ? "s" : ""}
          </span>
          {rootAssetId && (
            <>
              <span style={{ color: "#3f3f46" }}>|</span>
              <span style={{ color: "#a1a1aa" }}>
                Active: <span style={{ color: "#f97316" }}>{rootAssetId}</span>
              </span>
            </>
          )}
          <span style={{ marginLeft: "auto", color: "#52525b" }}>
            Click to browse · "Use This" to switch variant pointer
          </span>
        </div>
      </div>
    );
  }

  export function DiveCanvas() {
    return (
      <ReactFlowProvider>
        <DiveCanvasInner />
      </ReactFlowProvider>
    );
  }
  ```

- [ ] **Step 7.10** — Modify `modes/clipcraft/viewer/ClipCraftPreview.tsx` to wrap `SyncedBody` in `<VariantPointerProvider>` alongside `AssetErrorsProvider` (from Task 4). Order is not significant; both are sibling React contexts.

  ```tsx
  import { VariantPointerProvider } from "./dive/useVariantPointer.js";
  // ...
  return (
    <PneumaCraftProvider key={providerKey} assetResolver={assetResolver}>
      <AssetErrorsProvider>
        <VariantPointerProvider>
          <SyncedBody
            project={project}
            writeProject={writeProject}
            currentTitleRef={currentTitleRef}
            hydrationError={errorMessage}
          />
        </VariantPointerProvider>
      </AssetErrorsProvider>
    </PneumaCraftProvider>
  );
  ```

- [ ] **Step 7.11** — Update `modes/clipcraft/viewer/layout/TimelineShell.tsx` to mount the real `<DiveCanvas />` when `timelineMode === "dive"`, replacing the Task 5 placeholder.

  ```tsx
  import { DiveCanvas } from "../dive/DiveCanvas.js";
  // ...
  {timelineMode === "dive" ? <DiveCanvas /> : ( /* overview / exploded branch */ )}
  ```

- [ ] **Step 7.12** — Smoke test: `bun run dev clipcraft`. From the 3D overview, double-click the Video layer. Expect the shell to expand to full and a horizontal dagre tree rooted at the seed video asset to appear. Scrollwheel pans, minimap shows. Click "Use This" on a non-active variant — the variant pointer updates (log via React DevTools or add a temporary `console.log` inside `useVariantPointer.set`). Press Escape → back to overview.

- [ ] **Step 7.13** — `chrome-devtools-mcp` screenshot to confirm node layout and MiniMap visuals match legacy styling.

**Draft commit message:**

```
feat(clipcraft): DiveCanvas ported to craft provenance (Plan 6 Task 7)

Add @xyflow/react + @dagrejs/dagre as runtime deps. DiveCanvas reads
the clip under the playhead for the active dive layer, looks up its
rooted provenance tree directly from craft's provenance.edges Map,
and lays it out LR with dagre. NodeShell extracts prompt/model from
the provenance edge's operation.params. Variant switching updates a
mode-local VariantPointerContext — no craft commands are dispatched.
Caption layer renders a single synthetic TextNode carrying Clip.text.
```

---

## Gap-coverage checklist

`NEXT.md` doesn't ship a literal 20-item gap list, but between its "Known limitations" and the implicit legacy-vs-current-mode delta the functional gaps collapse to this set. Each item maps to the task that addresses it, or to a deferred plan.

| # | Gap | Covered by |
|---|---|---|
| 1  | No scene concept in current mode | Task 1 |
| 2  | No mode-switch shell (only flat PreviewPanel) | Task 2 |
| 3  | No asset panel | Task 4 |
| 4  | No video preview (PreviewCanvas is a bare craft canvas with no caption overlay, aspect-ratio framing, or RefreshButton) | Task 3 |
| 5  | No caption overlay on preview | Task 3 |
| 6  | No 3D overview | Task 5 |
| 7  | No exploded view | Task 6 |
| 8  | No dive canvas / provenance tree UI | Task 7 |
| 9  | No variant switching UI | Task 7 (read-only pointer; true variant commands deferred to Plan 9) |
| 10 | No provenance metadata surfacing (prompt / model / params) | Task 4 (tooltip) + Task 7 (NodeShell) |
| 11 | No error surfacing per asset | Task 4 (useAssetErrors) |
| 12 | No upload flow | Task 4 |
| 13 | No delete flow | Task 4 |
| 14 | No script tab | Task 4 (ScriptTab) |
| 15 | No active-scene resolver | Task 1 + Task 6 (useActiveSceneAtTime) |
| 16 | Clip editing (drag / resize / split / ripple) | Deferred — Plan 5.5 |
| 17 | Transitions UI | Deferred — Plan 5.5 or later |
| 18 | Generation controls (imagegen / tts / bgm buttons; DiveInlineInput) | Deferred — Plan 9 |
| 19 | Export panel | Deferred — Plan 8 |
| 20 | Character references | Deferred — Plan 9 or later |
| 21 | Skill rewrite against craft vocabulary | Deferred — Plan 10 |
| 22 | Diff-and-dispatch external edits (no remount on agent write) | Deferred — craft-store-level future plan |
| 23 | Storyboard.json / graph.json migration | **Not happening** — Plan 6 only reads `pneuma-craft/project/v1` |
| 24 | BGM as first-class slot | **Not happening** — BGM is a normal audio track in craft |

## Risks / unknowns

- **xyflow / dagre runtime surface.** We have never shipped `@xyflow/react` in this repo. Version pinning matters: legacy targeted `@xyflow/react@12.3.x`. If Task 7 installs a newer minor and it introduces breaking node-type API shifts, NodeShell's `NodeProps` cast may need updating. Validate with `bun run build` + a single browser smoke test before declaring Task 7 done.
- **Legacy 3D was assumed to be CSS transforms.** **Confirmed** by reading `TimelineOverview3D.tsx` / `Layer3D.tsx` / `ExplodedView.tsx` — it's all framer-motion `perspective` / `rotateX` / `rotateY` / `z` on `<motion.div>` elements. No Three.js, no r3f. The plan is safe as written.
- **Persistence schema bump.** Task 1 adds an optional `scenes?: ProjectScene[]` and Task 3 adds an optional `captionStyle?: CaptionStyle`. Both are **additive optionals** so the `$schema` stays `"pneuma-craft/project/v1"`. The validator explicitly skips unknown siblings at the root (structural check only), so old files load fine and new files round-trip through old code as long as they don't rely on the extra fields. If a future plan makes either field required, bump the schema to `v1.1` at that time.
- **`SceneResolver` when `memberClipIds` references a missing clip.** The resolver must tolerate dangling ids — filter them out and log a console.warn, never throw. Task 1 Step 1.X's resolver test covers this explicitly.
- **Upload provenance edge shape.** `ProvenanceCommand` of type `provenance:set-root` takes `{ assetId, operation }`. Task 4's upload flow uses `operation: { type: "import", actor: "human", timestamp: Date.now(), params: { source: "upload" } }`. The `OperationType` union in core allows `'upload' | 'import' | 'generate' | 'derive' | 'select' | 'composite'`, so we could alternatively use `"upload"` as the operation type itself. The plan uses `"import"` + `params.source: "upload"` because that matches how the seed `project.json` already describes upload-origin assets and keeps NodeShell's origin-badge heuristic simple. If the user prefers the literal `"upload"` OperationType, flip both the dispatch in `useAssetActions` and the heuristic in `NodeShell` in a single commit.
- **AssetPanel grouping simplification.** Legacy grouped by **filesystem subdirectory** (Images / Clips / Reference / Audio / BGM). Model B has no "Reference" or "BGM" asset subtype — craft assets are only `image | video | audio | text`. Task 4 collapses this to four groups (Images / Clips / Audio / Text). **Reference images** still work — they live in the same `image` bucket. **BGM** works — it lives in the `audio` bucket. The UX note at the top of Task 4 calls this out for the reviewer.
- **`RenderedFrame` interior shape.** Step 6.1 destructures both `.bitmap` and `.imageData` shapes because the `.d.ts` doesn't pin it. If the subagent runs into `null` frames forever, log one frame inside the subscription callback and update the capture branch to match. This is the single most likely place the plan trips on an upstream surface change.
- **Full re-dispatch on external edit** (inherited from Plan 5's Known Limitations). Every agent-originated write still remounts the craft store, which resets timeline zoom, variant pointers, asset errors, focused layer, and dive focus node. Plan 6 accepts that behavior — the mode-local context state gets wiped and rebuilt on each remount. A future craft-store-level plan will move to diff-and-dispatch, at which point the mode-local contexts become durable across edits for free.
- **`useAsset` vs `useWorkspaceAssetUrl` semantics.** `useAsset(id)` returns the `Asset` (uri + metadata). Resolving that URI to a browser-loadable URL requires walking it through the workspace `assetResolver` (Plan 4). Task 4 introduces `useWorkspaceAssetUrl(id)` as the single place that bridge happens; every other component in Tasks 5/6/7 imports that hook. If the resolver ever becomes async (e.g. a blob-URL resolver for in-memory assets), `useWorkspaceAssetUrl` is the one touchpoint to update.
- **Task 2 placeholder lifetime.** Tasks 2 lands `AssetPanelPlaceholder`, `ExplodedViewPlaceholder`, `DiveCanvasPlaceholder`, and `TimelineOverviewPlaceholder` so the shell compiles. Tasks 4/5/6/7 each replace one placeholder. Running Plan 6 in task order means: after Task 2 the shell animates but shows stubs; after Task 3 the video preview works; after Task 4 the asset panel works; and each 5/6/7 commit lights up one more viewing mode. At no point between tasks does the app fail to build.
- **Task parallelism.** Task 1 must land first. Task 2 must land second. Tasks 3 + 4 can parallelize (different subtrees). Tasks 5 / 6 / 7 can parallelize after Tasks 1 + 2 + 4 (Task 7 depends on Task 4's `useWorkspaceAssetUrl`; Task 6 depends on Task 4's same hook AND on Task 1's scene resolver). The safe serial order is 1 → 2 → 3 → 4 → 5 → 6 → 7. The aggressive parallel order is 1 → 2 → (3 || 4) → (5 || (after 4: 6) || (after 4: 7)).

