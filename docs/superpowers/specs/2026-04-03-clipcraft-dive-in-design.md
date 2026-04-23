# ClipCraft Dive In — Design Spec

## Overview

When the user clicks a layer in the exploded view (or double-clicks in the 3D timeline view), they enter a **focused editing context** for that material type. The dive-in panel shows the current state of the material, lets the user formulate a natural language modification instruction, and sends it to the agent with full context attached.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Instruction delivery | Existing chat channel | Natural language to agent is the core value; `sendUserMessage` with `<dive-context>` wrapping |
| Panel location | Replace expanded area | Same spatial logic as exploded view; timeline stays below for navigation |
| Architecture | One shell + per-type content | Consistent UX, shared input/header, per-type context display |
| v1 direct edits | Caption text + BGM sliders only | Simple values the user wants to tweak without asking the agent |
| Scope | Simple panels | xyflow for complex scenarios (multi-variant comparison, generation history) deferred |

## Architecture

### Component Tree

```
TimelineShell
├── Timeline (pinned bottom, compact)
└── [expanded area]
    ├── OverviewControls          ← hidden when timelineMode === "dive"
    ├── ExplodedView / Overview3D ← when timelineMode === "overview"
    └── DivePanel                 ← when timelineMode === "dive"
        ├── DiveHeader
        │   ├── Back button → returns to exploded view
        │   ├── Layer icon + label (e.g. "🎬 VIDEO — Scene 3")
        │   └── Scene nav: ← → arrows to jump scenes while in dive
        ├── DiveContent (per-type, scrollable, flex: 1)
        │   ├── VideoDiveContent
        │   ├── CaptionDiveContent
        │   ├── AudioDiveContent
        │   └── BgmDiveContent
        └── DiveInput (pinned bottom)
            ├── Text input (placeholder: "Describe what you want to change...")
            └── Send button (orange)
```

### State

Uses existing fields — no new state needed:

| Field | Source | Purpose |
|-------|--------|---------|
| `timelineMode` | Existing | `"dive"` activates DivePanel |
| `diveLayer` | Existing | Which layer type is being edited |
| `playback.globalTime` | Existing | Determines which scene to show |
| `playback.currentSceneIndex` | Existing | Current scene for context |

### Navigation

- **Enter dive:** Click layer in exploded view → `SET_DIVE_LAYER(type)` + `SET_TIMELINE_MODE("dive")`
- **Back:** DiveHeader back button → `SET_TIMELINE_MODE("overview")` + `SET_DIVE_LAYER(null)`
- **Scene nav:** ← → arrows in DiveHeader seek to previous/next scene start time via `SEEK` action, staying in dive mode
- **Escape:** Returns to exploded view (same as back)
- **Collapse:** Not directly available in dive mode — user must go back to exploded first, then collapse

## Per-Type Content

### VideoDiveContent

- **Current frame** (large): from `useCurrentFrame` hook, same as exploded view. Needs `videoRefs` passed through.
- **Prompt** (read-only, mono font): from `scene.visual.prompt`. Shows "No prompt" if absent.
- **Duration label**: `scene.duration` seconds.
- **Reference thumbnail** (small, if present): from `scene.visual.thumbnail`.

### CaptionDiveContent

- **Editable text area**: Pre-filled with `scene.caption`. On change, writes back to storyboard via a new action `UPDATE_SCENE_CAPTION { sceneId, caption }`.
- **Style info** (read-only labels): Current font, position, style from `project.style.captionFont`, `captionPosition`, `captionStyle`.

### AudioDiveContent

- **TTS text** (read-only): from `scene.audio.text`.
- **Voice** (read-only label): from `scene.audio.voice`.
- **Waveform**: `useWaveform` + `WaveformBars` for the scene's TTS audio.
- **Duration label**: from `scene.audio.duration`.

### BgmDiveContent

- **Track title** (read-only): from `storyboard.bgm.title`.
- **Volume slider** (0-100%): Directly editable. Writes to storyboard via `UPDATE_BGM_CONFIG { volume }`.
- **Fade in slider** (seconds): Directly editable. Writes via `UPDATE_BGM_CONFIG { fadeIn }`.
- **Fade out slider** (seconds): Directly editable. Writes via `UPDATE_BGM_CONFIG { fadeOut }`.
- **Waveform snippet**: 10s window centered on playhead (reuse from exploded view pattern).

## DiveInput — Sending Instructions to Agent

The text input at the bottom of the dive panel sends a message through pneuma's existing chat channel using `sendUserMessage` from `src/ws.ts`.

**Message format:**

```xml
<dive-context layer="video" sceneId="scene-003" sceneOrder="3">
画面再亮一点，换个暖色调
</dive-context>
```

The agent's ClipCraft skill prompt already understands `<viewer-context>` patterns. The `<dive-context>` tag provides:
- `layer`: which material type ("video", "caption", "audio", "bgm")
- `sceneId`: which scene
- `sceneOrder`: scene order number (human-readable)

The agent interprets this as a contextual editing request for the specified material.

**After sending:** The input clears. The panel stays in dive mode so the user can see the result when the agent makes changes (file watcher → SYNC_FILES → updated scene data).

## Styling

- Same dark theme as exploded view: `#09090b` background, `#27272a` borders
- Layer color accent from `LAYER_META` (orange for caption, yellow for video, blue for audio, purple for bgm)
- DiveHeader: 40px height, layer icon + colored label
- DiveInput: 48px height, dark input with subtle border, orange send button
- Content area: scrollable, padded, comfortable reading

## Files

### New

| File | Purpose |
|------|---------|
| `viewer/timeline/dive/DivePanel.tsx` | Shell: header + content + input layout |
| `viewer/timeline/dive/DiveHeader.tsx` | Back button, layer label, scene nav arrows |
| `viewer/timeline/dive/DiveInput.tsx` | Text input + send via `sendUserMessage` |
| `viewer/timeline/dive/VideoDiveContent.tsx` | Video layer: frame + prompt + duration + thumbnail |
| `viewer/timeline/dive/CaptionDiveContent.tsx` | Caption layer: editable text + style info |
| `viewer/timeline/dive/AudioDiveContent.tsx` | Audio layer: TTS text + voice + waveform |
| `viewer/timeline/dive/BgmDiveContent.tsx` | BGM layer: title + volume/fade sliders + waveform |

### Modified

| File | Change |
|------|--------|
| `viewer/timeline/TimelineShell.tsx` | Render `DivePanel` when `timelineMode === "dive"`, hide OverviewControls |
| `viewer/store/types.ts` | Add `UPDATE_SCENE_CAPTION` and `UPDATE_BGM_CONFIG` actions |
| `viewer/store/reducer.ts` | Handle new actions (write caption/bgm changes to storyboard) |

### Reused

- `useCurrentFrame` hook — for video frame in VideoDiveContent
- `useWaveform` + `WaveformBars` — for audio/bgm waveforms
- `useWorkspaceUrl` — for asset URL resolution
- `sendUserMessage` from `src/ws.ts` — for chat channel

## New Store Actions

```typescript
| { type: "UPDATE_SCENE_CAPTION"; sceneId: string; caption: string }
| { type: "UPDATE_BGM_CONFIG"; config: Partial<{ volume: number; fadeIn: number; fadeOut: number }> }
```

`UPDATE_SCENE_CAPTION` writes the caption directly to the scene in `storyboard.scenes`. This is a local-only edit — the agent can persist it to `storyboard.json` on its next turn, or the user can ask it to.

`UPDATE_BGM_CONFIG` merges partial config into `storyboard.bgm`. Same local-only approach.

## Non-Goals (v1)

- xyflow canvas for multi-variant comparison or generation history trees
- Direct video regeneration controls (button to trigger re-generation)
- Audio playback preview within the dive panel
- Undo/redo for direct edits
- Persisting local edits to disk (agent handles file writes)
