# ClipCraft Exploded View — Design Spec

## Overview

Replace the existing 3D timeline overview (`TimelineOverview3D`) with a **per-frame exploded layer view**. Instead of showing time-axis strips in 3D, the new view decomposes the current playhead frame into separated 3D layers — like an Apple product teardown video. This view serves as the entry point for Phase 2B-2 Dive In (click a layer → contextual editing panel).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Replace entire 3D overview | Old timeline-in-3D wasn't useful; flat timeline below handles time-axis |
| Frame source | Follow playhead (`globalTime`) | Scrubbing timeline updates exploded view in real time, works paused or playing |
| Floating context | Layers only (v1) | Dependencies (prompts, refs) come with dive-in panels in 2B-2 |
| Click behavior | Single click → dive-in | Exploded view is navigation hub, not workspace; no useful "select without diving" |
| Rendering | CSS 3D transforms | Already proven in codebase, no new deps, GPU-accelerated |
| Scroll | Shift layer focus | Wheel scrolls which layer is centered/prominent, natural dive-in target |
| Camera | Fixed side-perspective | One angle, not user-adjustable. No presets. |

## Architecture

### Component Tree

```
TimelineShell (unchanged layout: column-reverse)
├── Timeline (pinned bottom, always visible, goes compact when exploded)
│   └── ... tracks, playhead, ruler (unchanged)
└── ExplodedView (replaces TimelineOverview3D)
    ├── ExplodedLayer × N (one per active layer type)
    │   ├── caption  → current scene's caption text
    │   ├── video    → current video frame as <img>
    │   ├── audio    → current scene's TTS waveform
    │   └── bgm      → BGM waveform snippet around playhead
    └── LayerToggle (reused from existing overview)
```

### State

Uses existing store fields — minimal additions:

| Field | Source | Purpose |
|-------|--------|---------|
| `playback.globalTime` | Existing | Determines which scene/frame to show |
| `timelineMode` | Existing | `"overview"` now means exploded view |
| `diveLayer` | Existing | Set on layer click for dive-in |
| `focusedLayer` | **New** | Which layer is scroll-centered (`LayerType \| null`) |

New action: `SET_FOCUSED_LAYER` — sets `focusedLayer` in state.

No camera preset state needed (delete `useOverviewCamera`).

## Layer Layout

### Ordering (front to back)

Caption → Video → Audio (TTS) → BGM

### Z Positioning

Layers are flat rectangles at the project's aspect ratio, separated along the Z axis.

**Focus-based Z calculation:**
- The `focusedLayer` sits at z=0 (closest to viewer, most prominent)
- Other layers spread behind it with fixed gaps (e.g. 80px apart)
- Default focus: `video` layer
- Scroll (wheel) cycles `focusedLayer` through active layers
- Z offsets recalculated on focus change, animated with Framer Motion springs

Example with all 4 layers active, video focused:
```
caption:  z = 80   (in front of focus)
video:    z = 0    (focused, centered)
audio:    z = -80
bgm:     z = -160
```

If user scrolls to focus audio:
```
caption:  z = 160
video:    z = 80
audio:    z = 0    (focused)
bgm:     z = -80
```

### Layer Dimensions

- All layers share the same width (proportional to project aspect ratio)
- Video layer is tallest; caption/audio/bgm layers are shorter
- Container sizes layers to fit the available height of the expanded area

### Per-Layer Content

| Layer | Content | Implementation |
|-------|---------|----------------|
| **Caption** | Current scene's caption text, centered | Plain DOM text, styled like preview overlay |
| **Video** | Current video frame as still image | New `useCurrentFrame` hook — seek video, draw to canvas, return data URL |
| **Audio** | Current scene's TTS waveform | `useWaveform` + `WaveformBars` (full scene waveform) |
| **BGM** | BGM waveform snippet: 10s window centered on playhead time | `useWaveform` (full BGM) + `WaveformBars` (slice peaks array to 10s window) |

### Layer Styling

- Background: `rgba(9, 9, 11, 0.85)` (dark, semi-transparent)
- Border: `1px solid` in layer color (from existing `LAYER_META`: yellow/orange/blue/purple)
- Subtle `box-shadow: 0 0 12px rgba(layerColor, 0.15)` for depth
- Hover: brighten border, slight scale-up (1.02) as click affordance
- Cursor: pointer on hover

## Interaction

### Opening

1. User clicks expand button on timeline → `SET_TIMELINE_MODE: "overview"`
2. Layers animate in: from stacked (all z=0) to spread Z positions
3. Timeline below goes compact (ruler + video track only, existing behavior)
4. Animation: Framer Motion spring (`stiffness: 150, damping: 25`)

### Playhead Sync

- ExplodedView reads `playback.globalTime`
- Computes active scene: find scene whose time range contains globalTime
- During playback: video frame updates ~10fps (throttled canvas capture), caption/waveform update at scene boundaries
- Scrubbing timeline playhead updates exploded view live

### Video Frame Capture (`useCurrentFrame` hook)

- Input: active video element ref + globalTime
- Draws video to offscreen canvas → returns data URL
- Throttled to ~100ms intervals during playback
- When paused: captures once per seek
- Returns `null` while loading (layer shows placeholder)

### Scroll to Focus

- Wheel event on ExplodedView shifts `focusedLayer` through active layers
- Scroll up → focus moves toward front (caption direction)
- Scroll down → focus moves toward back (bgm direction)
- Z offsets recalculated with spring animation
- Focused layer appears largest/closest

### Layer Click → Dive In

1. Single click on any layer
2. Dispatch `SET_DIVE_LAYER(layerType)` + `SET_TIMELINE_MODE: "dive"`
3. Clicked layer animates forward (z increases, scale up) as exit transition
4. Dive-in panel renders (Phase 2B-2, not in this spec)

### Collapse

- Escape key or collapse button → `SET_TIMELINE_MODE: "collapsed"`
- Layers animate to stacked (z=0), container shrinks
- Timeline returns to full (non-compact) mode

## 3D Camera

Fixed side-perspective, not user-adjustable:

```typescript
{
  rotateX: -12,              // slight downward pitch
  rotateY: 20,               // side angle for Z depth visibility
  perspective: 800,           // moderate depth
  perspectiveOriginX: 50,    // centered
  perspectiveOriginY: 45,    // slightly above center
}
```

These values are constants, tuned once. No preset switching UI.

## Files

### New

| File | Purpose |
|------|---------|
| `viewer/timeline/exploded/ExplodedView.tsx` | Container — perspective scene, layer management, scroll handler, collapse |
| `viewer/timeline/exploded/ExplodedLayer.tsx` | Single layer — Z positioning, content rendering by type, click → dive-in |
| `viewer/hooks/useCurrentFrame.ts` | Video frame capture: video element → canvas → data URL, throttled |

### Modified

| File | Change |
|------|--------|
| `viewer/timeline/TimelineShell.tsx` | Import `ExplodedView` instead of `TimelineOverview3D` |
| `viewer/store/types.ts` | Add `focusedLayer: LayerType \| null` to `ClipCraftState`, add `SET_FOCUSED_LAYER` action |
| `viewer/store/reducer.ts` | Handle `SET_FOCUSED_LAYER`, initialize `focusedLayer: null` |

### Reused (no changes)

- `LayerToggle.tsx` — left sidebar layer toggles
- `WaveformBars.tsx` — bar visualization
- `useWaveform.ts` — audio peak data

### Deleted (after ExplodedView confirmed working)

- `viewer/timeline/overview/TimelineOverview3D.tsx`
- `viewer/timeline/overview/Layer3D.tsx`
- `viewer/timeline/overview/useOverviewCamera.ts`
- `viewer/timeline/overview/OverviewControls.tsx`

## Non-Goals (v1)

- Floating dependency context (prompts, reference images, generation history) — deferred to 2B-2
- Dive-in panels — separate spec (Phase 2B-2)
- WebGL / Three.js rendering
- User-adjustable camera angles
- SVG filter glow effects
