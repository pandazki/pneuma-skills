# ClipCraft Viewer — Component Architecture

**Date:** 2026-04-02
**Goal:** Scalable frontend architecture for a complex video editor viewer, supporting future layout changes and feature expansion.

## Current Problems

1. **Prop drilling** — all state in ClipCraftPreview, passed 3-4 levels deep
2. **Mixed concerns** — AssetPanel (382 lines) handles UI + API calls + drag-drop
3. **No shared state layer** — components can't communicate without lifting everything to root
4. **Layout tightly coupled** — changing the layout means rewiring all prop connections

## Architecture Principles

1. **State lives in a store, not component tree** — components subscribe to what they need
2. **Components are pure renderers** — data in, events out, no API calls inside components
3. **Hooks encapsulate logic** — data fetching, parsing, playback control are hooks
4. **Layout is a separate concern** — swap layouts without touching feature components

## State Management: ClipCraft Store

A React Context + useReducer store (not Zustand — stay within the viewer's own scope, pneuma's main store handles the framework layer).

```
viewer/
├── store/
│   ├── ClipCraftContext.tsx    # Context provider + useClipCraft() hook
│   ├── types.ts               # Store state & action types
│   ├── reducer.ts             # Pure reducer function
│   └── selectors.ts           # Derived state selectors
```

### State Shape

```typescript
interface ClipCraftState {
  // Data (parsed from files)
  project: ProjectConfig;
  storyboard: Storyboard;
  
  // Assets (derived from file list)
  assets: {
    images: AssetFile[];
    clips: AssetFile[];
    reference: AssetFile[];
    audio: AssetFile[];
    bgm: AssetFile[];
  };
  
  // UI state
  selectedSceneId: string | null;
  activePanel: "assets" | "script";
  captionsEnabled: boolean;
  
  // Playback state
  playback: {
    playing: boolean;
    currentSceneIndex: number;
    currentTime: number;       // seconds into current scene
    globalTime: number;        // seconds into total video
  };
  
  // Async state
  uploading: boolean;
}

interface AssetFile {
  path: string;         // relative path
  name: string;         // filename only
  type: "image" | "video" | "audio" | "unknown";
}
```

### Actions

```typescript
type ClipCraftAction =
  // Scene
  | { type: "SELECT_SCENE"; sceneId: string | null }
  
  // UI
  | { type: "SET_PANEL"; panel: "assets" | "script" }
  | { type: "TOGGLE_CAPTIONS" }
  
  // Playback
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SEEK"; globalTime: number }
  | { type: "SCENE_ENDED" }
  | { type: "UPDATE_TIME"; currentTime: number }
  
  // Async
  | { type: "SET_UPLOADING"; uploading: boolean }
  
  // Data (triggered by file changes from pneuma)
  | { type: "SYNC_FILES"; files: ViewerFileContent[]; imageVersion: number }
```

### Selectors (derived state)

```typescript
// Sorted scenes
selectSortedScenes(state): Scene[]

// Total duration
selectTotalDuration(state): number

// Active scene (playing or selected)
selectActiveScene(state): Scene | null

// Scene at global time
selectSceneAtTime(state, globalTime): { scene: Scene; localTime: number } | null

// Assets grouped by type
selectAssetsByType(state): Record<string, AssetFile[]>

// Scene generation progress
selectProgress(state): { ready: number; generating: number; pending: number; total: number }
```

## Component Tree

```
ClipCraftPreview (pneuma entry point)
└── ClipCraftProvider (context provider, syncs files → store)
    └── ClipCraftLayout (layout shell — swappable)
        ├── Sidebar
        │   ├── SidebarTabs (Assets | Script toggle)
        │   ├── AssetBrowser
        │   │   ├── AssetGroup (per type: images, clips, etc.)
        │   │   │   ├── AssetThumbnail
        │   │   │   └── AssetListItem
        │   │   └── UploadZone (drag-drop + button)
        │   └── ScriptPanel
        │       ├── CaptionToggle
        │       └── SceneScriptCard (per scene: caption + meta)
        │
        ├── PreviewArea
        │   ├── VideoPlayer
        │   │   ├── VideoRenderer (img/video element)
        │   │   └── CaptionOverlay
        │   └── PlaybackControls
        │       ├── PlayPauseButton
        │       ├── TimeDisplay
        │       └── AspectRatioSelector
        │
        └── Timeline
            ├── TimeRuler
            ├── CaptionTrack
            ├── VideoTrack (filmstrip thumbnails)
            ├── SpeechTrack (audio waveform)
            └── BgmTrack (music waveform)
```

## Hooks

```
viewer/
├── hooks/
│   ├── useStoryboard.ts       # Parse storyboard.json + project.json from files
│   ├── useAssets.ts            # Parse + group asset files, upload/delete API
│   ├── usePlayback.ts          # Video playback logic, scene sequencing
│   ├── useTimeline.ts          # Time ↔ scene mapping, track layout calculation
│   └── useAssetUpload.ts       # File reading, data URL conversion, POST /api/files
```

### useAssets

```typescript
function useAssets(files: ViewerFileContent[]) {
  // Parse files into typed asset groups
  // Returns: { groups, upload(file, targetDir), delete(path) }
}
```

### usePlayback

```typescript
function usePlayback(scenes: Scene[], assetBaseUrl: string) {
  // Manages video element ref, scene sequencing, play/pause
  // Returns: { playing, currentScene, globalTime, play, pause, seekTo, videoRef }
}
```

### useTimeline

```typescript
function useTimeline(scenes: Scene[], totalDuration: number) {
  // Computes track layout: scene positions, text block positions
  // Returns: { scenePositions, captionBlocks, globalTimeToX, xToGlobalTime }
}
```

## File Structure (target)

```
modes/clipcraft/viewer/
├── ClipCraftPreview.tsx          # Pneuma entry, wires ViewerPreviewProps → store
├── store/
│   ├── ClipCraftContext.tsx       # Provider + useClipCraft()
│   ├── types.ts                  # State, Action, AssetFile types
│   ├── reducer.ts                # Pure reducer
│   └── selectors.ts              # Derived state
├── hooks/
│   ├── useStoryboard.ts          # Parse JSON files
│   ├── useAssets.ts              # Asset grouping + API
│   ├── usePlayback.ts            # Video playback logic
│   └── useTimeline.ts            # Time ↔ position mapping
├── layout/
│   ├── ClipCraftLayout.tsx       # Default layout (sidebar + preview + timeline)
│   └── (future: CompactLayout, FullscreenLayout, etc.)
├── sidebar/
│   ├── Sidebar.tsx               # Tab container
│   ├── AssetBrowser.tsx          # Asset grid/list with upload
│   ├── AssetGroup.tsx            # Single asset type group
│   ├── AssetThumbnail.tsx        # Image/video thumbnail
│   ├── UploadZone.tsx            # Drag-drop + button
│   └── ScriptPanel.tsx           # Scene caption list
├── preview/
│   ├── PreviewArea.tsx           # Preview container
│   ├── VideoPlayer.tsx           # Video/image renderer
│   ├── CaptionOverlay.tsx        # Subtitle overlay
│   └── PlaybackControls.tsx      # Play, time, aspect ratio
└── timeline/
    ├── Timeline.tsx              # Timeline container
    ├── TimeRuler.tsx             # Time markers
    ├── CaptionTrack.tsx          # Text blocks on track
    ├── VideoTrack.tsx            # Filmstrip thumbnails
    ├── AudioTrack.tsx            # Waveform display (speech)
    └── BgmTrack.tsx              # Waveform display (music)
```

~25 files, each < 150 lines. Clear boundaries, easy to test and refactor.

## Layout Swapping

The `ClipCraftLayout` component receives children as named slots:

```typescript
interface LayoutProps {
  sidebar: ReactNode;
  preview: ReactNode;
  timeline: ReactNode;
}
```

All feature components talk to the store, not to each other. Changing layout = new layout component, zero feature code changes.

## Data Flow

```
pneuma files (ViewerPreviewProps)
    ↓ ClipCraftPreview
    ↓ SYNC_FILES action
    ↓ reducer parses JSON, groups assets
    ↓ store state updated
    ↓ components subscribe via useClipCraft()
    ↓ render

user interaction (click scene, upload file, play video)
    ↓ component dispatches action
    ↓ reducer updates state
    ↓ subscribed components re-render

agent action (select-scene, play-preview)
    ↓ ClipCraftPreview handles actionRequest
    ↓ dispatches corresponding action
    ↓ same flow as user interaction
```

## Migration Path

1. Create store/ — context, reducer, types, selectors
2. Create hooks/ — extract logic from existing components
3. Wrap existing components with provider
4. Gradually refactor components to use store instead of props
5. Extract into subdirectories (sidebar/, preview/, timeline/)
6. Upgrade timeline to real multi-track editor

Each step is independently shippable — no big bang rewrite needed.
