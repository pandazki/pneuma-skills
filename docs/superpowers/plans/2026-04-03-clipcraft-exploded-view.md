# ClipCraft Exploded View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3D timeline overview with a per-frame exploded layer view that decomposes the current playhead frame into separated 3D layers (Apple teardown style), serving as the entry point for dive-in editing.

**Architecture:** New `ExplodedView` component replaces `TimelineOverview3D` in the `TimelineShell` layout. Each material layer (caption, video, audio, BGM) renders as a flat CSS 3D-transformed rectangle at a fixed side-perspective angle. Scroll shifts layer focus (z=0 centered), single click enters dive-in mode. A new `useCurrentFrame` hook captures the active video element's current frame to canvas.

**Tech Stack:** React 19, Framer Motion, CSS 3D transforms (`preserve-3d`, `perspective`, `translateZ`), Canvas API for frame capture, existing `useWaveform` + `WaveformBars` for audio visualization.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `modes/clipcraft/viewer/timeline/exploded/ExplodedView.tsx` | **New.** Container: perspective scene, layer management, scroll-to-focus, collapse, escape key |
| `modes/clipcraft/viewer/timeline/exploded/ExplodedLayer.tsx` | **New.** Single layer: Z positioning via Framer Motion, content rendering by type, hover effect, click → dive-in |
| `modes/clipcraft/viewer/hooks/useCurrentFrame.ts` | **New.** Video frame capture: video element → offscreen canvas → data URL, throttled ~100ms |
| `modes/clipcraft/viewer/store/types.ts` | **Modify.** Add `focusedLayer` to state, `SET_FOCUSED_LAYER` action, move `LayerType` here |
| `modes/clipcraft/viewer/store/reducer.ts` | **Modify.** Handle `SET_FOCUSED_LAYER`, initialize `focusedLayer: null` |
| `modes/clipcraft/viewer/timeline/TimelineShell.tsx` | **Modify.** Swap `TimelineOverview3D` → `ExplodedView` |
| `modes/clipcraft/viewer/timeline/overview/LayerToggle.tsx` | **Modify.** Import `LayerType` from `../../store/types.js` instead of `./Layer3D.js` |

After confirmed working, delete:
- `modes/clipcraft/viewer/timeline/overview/TimelineOverview3D.tsx`
- `modes/clipcraft/viewer/timeline/overview/Layer3D.tsx`
- `modes/clipcraft/viewer/timeline/overview/useOverviewCamera.ts`
- `modes/clipcraft/viewer/timeline/overview/OverviewControls.tsx`

---

### Task 1: Add `focusedLayer` and `LayerType` to store

**Files:**
- Modify: `modes/clipcraft/viewer/store/types.ts`
- Modify: `modes/clipcraft/viewer/store/reducer.ts`
- Modify: `modes/clipcraft/viewer/timeline/overview/LayerToggle.tsx`

- [ ] **Step 1: Add `LayerType` and `focusedLayer` to store types**

In `modes/clipcraft/viewer/store/types.ts`, add `LayerType` export at the top (after existing imports) and add `focusedLayer` to state + new action:

```typescript
// Add after the AssetFile interface (around line 13):

/** Material layer types for the exploded/3D view */
export type LayerType = "caption" | "video" | "audio" | "bgm";
```

Add `focusedLayer` to `ClipCraftState` (after `diveLayer`):

```typescript
  // In ClipCraftState, after diveLayer line:
  focusedLayer: LayerType | null;
```

Add `SET_FOCUSED_LAYER` to the `ClipCraftAction` union (after `SET_DIVE_LAYER`):

```typescript
  | { type: "SET_FOCUSED_LAYER"; layer: LayerType | null }
```

- [ ] **Step 2: Handle `SET_FOCUSED_LAYER` in reducer**

In `modes/clipcraft/viewer/store/reducer.ts`:

Add `focusedLayer: null` to `initialState` (after `diveLayer: null`):

```typescript
  focusedLayer: null,
```

Add a case in the reducer switch (after `SET_DIVE_LAYER` case):

```typescript
    case "SET_FOCUSED_LAYER":
      return { ...state, focusedLayer: action.layer };
```

- [ ] **Step 3: Update LayerToggle import**

In `modes/clipcraft/viewer/timeline/overview/LayerToggle.tsx`, change the import:

```typescript
// Old:
import type { LayerType } from "./Layer3D.js";

// New:
import type { LayerType } from "../../store/types.js";
```

- [ ] **Step 4: Verify the project builds**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds (no type errors from the new state fields)

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/viewer/store/types.ts modes/clipcraft/viewer/store/reducer.ts modes/clipcraft/viewer/timeline/overview/LayerToggle.tsx
git commit -m "feat(clipcraft): add focusedLayer state and move LayerType to store types"
```

---

### Task 2: Create `useCurrentFrame` hook

**Files:**
- Create: `modes/clipcraft/viewer/hooks/useCurrentFrame.ts`

- [ ] **Step 1: Create the hook file**

Create `modes/clipcraft/viewer/hooks/useCurrentFrame.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Captures the current frame of a video element as a data URL.
 *
 * During playback: throttled to ~100ms (10fps).
 * When paused: captures once per seek (globalTime change).
 * Returns null when no video or video not ready.
 */
export function useCurrentFrame(
  videoEl: HTMLVideoElement | null,
  globalTime: number,
  playing: boolean,
): string | null {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const lastCaptureRef = useRef<number>(0);

  const capture = useCallback(() => {
    if (!videoEl || videoEl.readyState < 2) return; // HAVE_CURRENT_DATA

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(videoEl, 0, 0, w, h);
    setFrameUrl(canvas.toDataURL("image/jpeg", 0.7));
  }, [videoEl]);

  // During playback: rAF loop, throttled to ~100ms
  useEffect(() => {
    if (!playing || !videoEl) return;

    const INTERVAL = 100; // ms

    const tick = () => {
      const now = performance.now();
      if (now - lastCaptureRef.current >= INTERVAL) {
        lastCaptureRef.current = now;
        capture();
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, videoEl, capture]);

  // When paused: capture on globalTime change (seek)
  useEffect(() => {
    if (playing) return;
    // Small delay to let video.currentTime settle after seek
    const timer = setTimeout(() => capture(), 50);
    return () => clearTimeout(timer);
  }, [playing, globalTime, capture]);

  // Capture initial frame when video element appears
  useEffect(() => {
    if (!videoEl) {
      setFrameUrl(null);
      return;
    }
    if (videoEl.readyState >= 2) {
      capture();
    } else {
      const handler = () => capture();
      videoEl.addEventListener("loadeddata", handler, { once: true });
      return () => videoEl.removeEventListener("loadeddata", handler);
    }
  }, [videoEl, capture]);

  return frameUrl;
}
```

- [ ] **Step 2: Verify the project builds**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds (hook is not imported yet, but should have no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/hooks/useCurrentFrame.ts
git commit -m "feat(clipcraft): add useCurrentFrame hook for video frame capture"
```

---

### Task 3: Create `ExplodedLayer` component

**Files:**
- Create: `modes/clipcraft/viewer/timeline/exploded/ExplodedLayer.tsx`

This component renders a single layer in the exploded view. It receives its Z offset, dimensions, content data, and handles hover/click.

- [ ] **Step 1: Create the ExplodedLayer component**

Create `modes/clipcraft/viewer/timeline/exploded/ExplodedLayer.tsx`:

```typescript
import { useMemo } from "react";
import { motion } from "framer-motion";
import type { LayerType } from "../../store/types.js";
import { useWaveform } from "../hooks/useWaveform.js";
import { WaveformBars } from "../WaveformBars.js";
import { useWorkspaceUrl } from "../../hooks/useWorkspaceUrl.js";

/** Color/metadata per layer type — matches existing LAYER_META from Layer3D */
const LAYER_META: Record<LayerType, { label: string; icon: string; color: string }> = {
  caption: { label: "Caption", icon: "Tt", color: "#f97316" },
  video:   { label: "Video",   icon: "🎬", color: "#eab308" },
  audio:   { label: "Audio",   icon: "🔊", color: "#38bdf8" },
  bgm:     { label: "BGM",     icon: "♪",  color: "#a78bfa" },
};

/** Layer ordering for z-index (front to back) */
export const LAYER_ORDER: LayerType[] = ["caption", "video", "audio", "bgm"];

export interface ExplodedLayerProps {
  layerType: LayerType;
  zOffset: number;
  /** Layer width in px */
  width: number;
  /** Layer height in px */
  height: number;
  /** Vertical offset from top of the 3D scene */
  top: number;
  /** Whether this layer is the scroll-focused one */
  focused: boolean;
  onClick: () => void;
  // Content data
  /** Current scene caption text (for caption layer) */
  caption: string | null;
  /** Current video frame data URL (for video layer) */
  frameUrl: string | null;
  /** TTS audio URL for current scene (for audio layer) */
  ttsAudioUrl: string | null;
  /** BGM audio URL (for bgm layer) */
  bgmAudioUrl: string | null;
  /** Current playhead time as fraction of total BGM duration (0-1) */
  bgmTimeFraction: number;
  /** Total BGM duration in seconds */
  bgmDuration: number;
}

const SPRING = { type: "spring" as const, stiffness: 150, damping: 25 };

export function ExplodedLayer({
  layerType,
  zOffset,
  width,
  height,
  top,
  focused,
  onClick,
  caption,
  frameUrl,
  ttsAudioUrl,
  bgmAudioUrl,
  bgmTimeFraction,
  bgmDuration,
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
        position: "absolute",
        left: "50%",
        width,
        height,
        marginLeft: -width / 2,
        transformStyle: "flat",
        cursor: "pointer",
        background: "rgba(9, 9, 11, 0.85)",
        border: `1px solid ${meta.color}${focused ? "80" : "40"}`,
        borderRadius: 8,
        boxShadow: focused
          ? `0 0 20px ${meta.color}25, 0 0 4px ${meta.color}15`
          : `0 0 12px ${meta.color}10`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Layer label */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        fontSize: 10,
        fontWeight: 600,
        color: meta.color,
        opacity: 0.8,
        flexShrink: 0,
      }}>
        <span>{meta.icon}</span>
        <span style={{ fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {meta.label}
        </span>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: "0 10px 6px" }}>
        <LayerContent
          layerType={layerType}
          height={height - 28}
          width={width - 20}
          caption={caption}
          frameUrl={frameUrl}
          ttsAudioUrl={ttsAudioUrl}
          bgmAudioUrl={bgmAudioUrl}
          bgmTimeFraction={bgmTimeFraction}
          bgmDuration={bgmDuration}
        />
      </div>
    </motion.div>
  );
}

// ── Per-type content rendering ──────────────────────────────────────────────

function LayerContent({
  layerType,
  height,
  width,
  caption,
  frameUrl,
  ttsAudioUrl,
  bgmAudioUrl,
  bgmTimeFraction,
  bgmDuration,
}: {
  layerType: LayerType;
  height: number;
  width: number;
  caption: string | null;
  frameUrl: string | null;
  ttsAudioUrl: string | null;
  bgmAudioUrl: string | null;
  bgmTimeFraction: number;
  bgmDuration: number;
}) {
  switch (layerType) {
    case "caption":
      return <CaptionContent caption={caption} height={height} />;
    case "video":
      return <VideoContent frameUrl={frameUrl} height={height} />;
    case "audio":
      return <AudioContent audioUrl={ttsAudioUrl} height={height} width={width} />;
    case "bgm":
      return <BgmContent audioUrl={bgmAudioUrl} height={height} width={width} timeFraction={bgmTimeFraction} duration={bgmDuration} />;
  }
}

function CaptionContent({ caption, height }: { caption: string | null; height: number }) {
  if (!caption) {
    return <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>No caption</span>;
  }
  return (
    <div style={{
      color: "#e4e4e7",
      fontSize: Math.min(16, Math.max(11, height * 0.25)),
      fontFamily: "'Inter', system-ui, sans-serif",
      fontWeight: 400,
      textAlign: "center",
      lineHeight: 1.4,
      padding: "0 8px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      width: "100%",
    }}>
      {caption.replace(/\n/g, " ")}
    </div>
  );
}

function VideoContent({ frameUrl, height }: { frameUrl: string | null; height: number }) {
  if (!frameUrl) {
    return (
      <div style={{ color: "#52525b", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 20 }}>🎬</span>
        <span style={{ fontStyle: "italic" }}>Capturing frame...</span>
      </div>
    );
  }
  return (
    <img
      src={frameUrl}
      alt="Current frame"
      style={{
        maxHeight: height,
        maxWidth: "100%",
        objectFit: "contain",
        borderRadius: 4,
      }}
    />
  );
}

function AudioContent({ audioUrl, height, width }: { audioUrl: string | null; height: number; width: number }) {
  const bars = Math.max(20, Math.floor(width / 3));
  const { waveform } = useWaveform(audioUrl ? { audioUrl, bars } : null);

  if (!audioUrl) {
    return <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>No TTS audio</span>;
  }

  if (!waveform) {
    return <span style={{ color: "#52525b", fontSize: 11 }}>Loading waveform...</span>;
  }

  return (
    <WaveformBars peaks={waveform.peaks} height={Math.max(16, height - 4)} color="#38bdf8" stretch />
  );
}

function BgmContent({
  audioUrl,
  height,
  width,
  timeFraction,
  duration,
}: {
  audioUrl: string | null;
  height: number;
  width: number;
  timeFraction: number;
  duration: number;
}) {
  // Decode full BGM, then window a 10s slice centered on current time
  const totalBars = Math.max(40, Math.floor(width / 3));
  // We need enough bars to cover the full duration so we can slice a window
  const barsPerSecond = duration > 0 ? totalBars / 10 : 4; // 10s window
  const fullBars = Math.max(totalBars, Math.ceil(duration * barsPerSecond));
  const { waveform } = useWaveform(audioUrl ? { audioUrl, bars: fullBars } : null);

  if (!audioUrl) {
    return <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>No BGM</span>;
  }

  if (!waveform) {
    return <span style={{ color: "#52525b", fontSize: 11 }}>Loading waveform...</span>;
  }

  // Slice a window of `totalBars` peaks centered on the current time
  const windowPeaks = useMemo(() => {
    const peaks = waveform.peaks;
    const centerIdx = Math.floor(timeFraction * peaks.length);
    const halfWindow = Math.floor(totalBars / 2);
    const start = Math.max(0, centerIdx - halfWindow);
    const end = Math.min(peaks.length, start + totalBars);
    const actualStart = Math.max(0, end - totalBars);
    return peaks.slice(actualStart, end);
  }, [waveform.peaks, timeFraction, totalBars]);

  return (
    <div style={{ width: "100%", position: "relative" }}>
      <WaveformBars peaks={windowPeaks} height={Math.max(16, height - 4)} color="#a78bfa" stretch />
      {/* Playhead indicator line at center */}
      <div style={{
        position: "absolute",
        left: "50%",
        top: 0,
        bottom: 0,
        width: 1,
        background: "#a78bfa",
        opacity: 0.6,
        pointerEvents: "none",
      }} />
    </div>
  );
}
```

- [ ] **Step 2: Verify the project builds**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds (component not imported yet but should compile cleanly)

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/exploded/ExplodedLayer.tsx
git commit -m "feat(clipcraft): add ExplodedLayer component for per-frame 3D layer rendering"
```

---

### Task 4: Create `ExplodedView` container

**Files:**
- Create: `modes/clipcraft/viewer/timeline/exploded/ExplodedView.tsx`

This is the main container that replaces `TimelineOverview3D`. It manages the perspective scene, active layers, scroll-to-focus, and renders `ExplodedLayer` instances.

- [ ] **Step 1: Create the ExplodedView component**

Create `modes/clipcraft/viewer/timeline/exploded/ExplodedView.tsx`:

```typescript
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import type { LayerType } from "../../store/types.js";
import { selectSortedScenes, selectTotalDuration } from "../../store/selectors.js";
import { useCurrentFrame } from "../../hooks/useCurrentFrame.js";
import { useWorkspaceUrl } from "../../hooks/useWorkspaceUrl.js";
import { ExplodedLayer, LAYER_ORDER } from "./ExplodedLayer.js";
import { LayerToggle } from "../overview/LayerToggle.js";

/** Fixed side-perspective camera constants */
const CAMERA = {
  rotateX: -12,
  rotateY: 20,
  perspective: 800,
  perspectiveOriginX: 50,
  perspectiveOriginY: 45,
} as const;

/** Z gap between layers in px */
const Z_GAP = 80;

/** Height distribution: max and min heights per layer type */
const MAX_H: Record<LayerType, number> = { video: 200, caption: 72, audio: 56, bgm: 56 };
const MIN_H: Record<LayerType, number> = { video: 80, caption: 32, audio: 32, bgm: 32 };

const SPRING = { type: "spring" as const, stiffness: 150, damping: 25 };

/**
 * Compute Z offsets so that `focusedLayer` sits at z=0.
 * Layers in front of focus get positive Z (closer), behind get negative.
 */
function computeZOffsets(activeLayers: LayerType[], focusedLayer: LayerType): Record<string, number> {
  const focusIdx = activeLayers.indexOf(focusedLayer);
  const offsets: Record<string, number> = {};
  for (let i = 0; i < activeLayers.length; i++) {
    offsets[activeLayers[i]] = (focusIdx - i) * Z_GAP;
  }
  return offsets;
}

/**
 * Given sorted scenes and a globalTime, find the scene at that time.
 */
function sceneAtTime(scenes: { id: string; duration: number }[], globalTime: number): { index: number; localTime: number } {
  let cumulative = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (globalTime < cumulative + scenes[i].duration || i === scenes.length - 1) {
      return { index: i, localTime: Math.max(0, globalTime - cumulative) };
    }
    cumulative += scenes[i].duration;
  }
  return { index: 0, localTime: 0 };
}

export function ExplodedView({ videoRefs }: { videoRefs: React.RefObject<Map<string, HTMLVideoElement>> }) {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const url = useWorkspaceUrl();

  const scenes = selectSortedScenes(state);
  const totalDuration = selectTotalDuration(state);
  const { playback, storyboard, focusedLayer: storedFocusedLayer } = state;
  const bgm = storyboard.bgm;

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });

  // Active layers — default: all available
  const [activeLayers, setActiveLayers] = useState<Set<LayerType>>(() => {
    const initial = new Set<LayerType>(["caption", "video", "audio"]);
    if (bgm) initial.add("bgm");
    return initial;
  });

  const disabledLayers = useMemo(() => {
    const d = new Set<LayerType>();
    if (!bgm) d.add("bgm");
    // Disable audio if no scenes have TTS
    if (!scenes.some(s => s.audio?.status === "ready" && s.audio?.source)) d.add("audio");
    return d;
  }, [bgm, scenes]);

  const toggleLayer = useCallback((layer: LayerType) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) {
        if (next.size > 1) next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }, []);

  // Ordered active layers (front to back)
  const orderedActive = useMemo(
    () => LAYER_ORDER.filter(l => activeLayers.has(l)),
    [activeLayers],
  );

  // Focused layer — default to video, clamp to active set
  const focusedLayer = useMemo(() => {
    if (storedFocusedLayer && activeLayers.has(storedFocusedLayer)) return storedFocusedLayer;
    if (activeLayers.has("video")) return "video";
    return orderedActive[0] ?? "video";
  }, [storedFocusedLayer, activeLayers, orderedActive]);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Scene at playhead ─────────────────────────────────────────────────────

  const { index: activeSceneIdx } = useMemo(
    () => sceneAtTime(scenes, playback.globalTime),
    [scenes, playback.globalTime],
  );
  const activeScene = scenes[activeSceneIdx] ?? null;

  // ── Video frame capture ───────────────────────────────────────────────────

  const activeVideoEl = activeScene ? videoRefs.current?.get(activeScene.id) ?? null : null;
  const frameUrl = useCurrentFrame(activeVideoEl, playback.globalTime, playback.playing);

  // ── Audio URLs ────────────────────────────────────────────────────────────

  const ttsAudioUrl = activeScene?.audio?.status === "ready" && activeScene.audio.source
    ? url(activeScene.audio.source)
    : null;

  const bgmAudioUrl = bgm?.source ? url(bgm.source) : null;
  const bgmTimeFraction = bgm && totalDuration > 0 ? playback.globalTime / totalDuration : 0;

  // ── Scroll to focus ───────────────────────────────────────────────────────

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY;
    if (Math.abs(delta) < 5) return;

    const currentIdx = orderedActive.indexOf(focusedLayer);
    let nextIdx: number;
    if (delta > 0) {
      // Scroll down → focus moves back (toward bgm)
      nextIdx = Math.min(orderedActive.length - 1, currentIdx + 1);
    } else {
      // Scroll up → focus moves front (toward caption)
      nextIdx = Math.max(0, currentIdx - 1);
    }
    if (nextIdx !== currentIdx) {
      dispatch({ type: "SET_FOCUSED_LAYER", layer: orderedActive[nextIdx] });
    }
  }, [orderedActive, focusedLayer, dispatch]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Escape to collapse ────────────────────────────────────────────────────

  const handleCollapse = useCallback(() => {
    dispatch({ type: "SET_TIMELINE_MODE", mode: "collapsed" });
  }, [dispatch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCollapse();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCollapse]);

  // ── Dive in ───────────────────────────────────────────────────────────────

  const handleDive = useCallback((layer: LayerType) => {
    dispatch({ type: "SET_DIVE_LAYER", layer });
    dispatch({ type: "SET_TIMELINE_MODE", mode: "dive" });
  }, [dispatch]);

  // ── Layout ────────────────────────────────────────────────────────────────

  const sceneW = containerSize.width - 88; // 44px LayerToggle + padding
  const sceneH = containerSize.height - 40; // top controls

  // Compute layer dimensions (width = aspect ratio of project)
  const ar = state.project.resolution;
  const arRatio = ar.width / ar.height;
  const layerWidth = Math.min(sceneW * 0.7, sceneH * arRatio * 0.5);

  // Distribute heights
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

  // Z offsets
  const zOffsets = computeZOffsets(orderedActive, focusedLayer);

  // Y positions for each layer
  const layerTops: Record<string, number> = {};
  let yAccum = topOffset;
  for (const l of orderedActive) {
    layerTops[l] = yAccum;
    yAccum += layerHeights[l] + gap;
  }

  // Render back-to-front for correct 3D overlap
  const renderOrder = [...orderedActive].reverse();

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        display: "flex",
        background: "#09090b",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Left: layer toggle */}
      <div style={{
        width: 44,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        borderRight: "1px solid #1a1a1e",
        zIndex: 20,
      }}>
        <LayerToggle
          activeLayers={activeLayers}
          onToggle={toggleLayer}
          disabledLayers={disabledLayers}
        />
      </div>

      {/* Right: 3D scene */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top controls — collapse button */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "4px 12px",
          flexShrink: 0,
          height: 32,
        }}>
          <button
            onClick={handleCollapse}
            title="Collapse"
            style={{
              background: "none",
              border: "1px solid #3f3f46",
              borderRadius: 4,
              color: "#71717a",
              cursor: "pointer",
              padding: "2px 8px",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 10 }}>↓</span> Collapse
          </button>
        </div>

        {/* 3D perspective scene */}
        <motion.div
          animate={{
            perspective: CAMERA.perspective,
            perspectiveOrigin: `${CAMERA.perspectiveOriginX}% ${CAMERA.perspectiveOriginY}%`,
          }}
          transition={SPRING}
          style={{
            flex: 1,
            position: "relative",
            transformStyle: "preserve-3d",
            overflow: "hidden",
          }}
        >
          <motion.div
            animate={{ rotateX: CAMERA.rotateX, rotateY: CAMERA.rotateY }}
            transition={SPRING}
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
            }}
          >
            <AnimatePresence>
              {renderOrder.map(layerType => (
                <ExplodedLayer
                  key={layerType}
                  layerType={layerType}
                  zOffset={zOffsets[layerType] ?? 0}
                  width={layerWidth}
                  height={layerHeights[layerType]}
                  top={layerTops[layerType]}
                  focused={layerType === focusedLayer}
                  onClick={() => handleDive(layerType)}
                  caption={activeScene?.caption ?? null}
                  frameUrl={frameUrl}
                  ttsAudioUrl={ttsAudioUrl}
                  bgmAudioUrl={bgmAudioUrl}
                  bgmTimeFraction={bgmTimeFraction}
                  bgmDuration={totalDuration}
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

- [ ] **Step 2: Verify the project builds**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/exploded/ExplodedView.tsx
git commit -m "feat(clipcraft): add ExplodedView container with 3D perspective, scroll-to-focus, and layer management"
```

---

### Task 5: Wire ExplodedView into TimelineShell

**Files:**
- Modify: `modes/clipcraft/viewer/timeline/TimelineShell.tsx`
- Modify: `modes/clipcraft/viewer/VideoPreview.tsx`

The ExplodedView needs access to the video element refs (held by VideoPreview via `usePlayback`). We need to lift the `videoRefs` map so both VideoPreview and ExplodedView can access it.

- [ ] **Step 1: Pass videoRefs from VideoPreview to TimelineShell**

The cleanest approach: VideoPreview already creates `videoRefs = useRef<Map<string, HTMLVideoElement>>()`. We need ExplodedView to access these same refs. Since both VideoPreview and TimelineShell are siblings rendered in the main ClipCraft layout, the simplest approach is to lift videoRefs to a shared ref.

First, check how the main layout renders these components. Read the main viewer file:

Look at how VideoPreview and TimelineShell are used together — they're siblings in the layout. We need to lift `videoRefs` to the parent.

In `modes/clipcraft/viewer/VideoPreview.tsx`, change the component to accept `videoRefs` as a prop instead of creating it internally:

```typescript
// Old (line 21):
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

// New — accept as prop:
export function VideoPreview({ videoRefs }: { videoRefs: React.RefObject<Map<string, HTMLVideoElement>> }) {
  const state = useClipCraftState();
  const url = useWorkspaceUrl();
  // Remove: const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
```

Then find the parent component that renders both `VideoPreview` and `TimelineShell`. Read the main viewer file to determine where to lift the ref.

- [ ] **Step 2: Read the main viewer to find the parent**

Read the file that imports both `VideoPreview` and `TimelineShell` to understand the layout. This is likely `modes/clipcraft/viewer/ClipCraftViewer.tsx` or similar — find it by grepping for `VideoPreview` and `TimelineShell` imports.

- [ ] **Step 3: Lift videoRefs to parent and pass down**

In the parent component that renders both:

```typescript
import { useRef } from "react";

// Inside the component:
const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

// Pass to both:
<VideoPreview videoRefs={videoRefs} />
// ...
<TimelineShell videoRefs={videoRefs} />
```

- [ ] **Step 4: Update TimelineShell to accept and pass videoRefs**

In `modes/clipcraft/viewer/timeline/TimelineShell.tsx`:

```typescript
// Old:
export function TimelineShell() {

// New:
export function TimelineShell({ videoRefs }: { videoRefs: React.RefObject<Map<string, HTMLVideoElement>> }) {
```

And replace the overview rendering section:

```typescript
// Old (line 5):
import { TimelineOverview3D } from "./overview/TimelineOverview3D.js";

// New:
import { ExplodedView } from "./exploded/ExplodedView.js";
```

```typescript
// Old (line 70):
          <TimelineOverview3D />

// New:
          <ExplodedView videoRefs={videoRefs} />
```

- [ ] **Step 5: Verify the project builds and test visually**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

Then start the dev server and test:
Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run dev clipcraft --workspace /tmp/test-clipcraft --no-open`

Test checklist:
1. Open browser to the dev URL
2. Create some test content with scenes
3. Click the expand button on the timeline — the exploded view should appear
4. Verify 3D perspective with separated layers
5. Scroll to shift layer focus
6. Click a layer — should dispatch dive-in (mode changes)
7. Press Escape — collapses back to timeline
8. Play video — frame should update in the video layer

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/VideoPreview.tsx modes/clipcraft/viewer/timeline/TimelineShell.tsx
# Also add the parent file you modified to lift videoRefs
git commit -m "feat(clipcraft): wire ExplodedView into TimelineShell, replacing TimelineOverview3D"
```

---

### Task 6: Delete old 3D overview files

**Files:**
- Delete: `modes/clipcraft/viewer/timeline/overview/TimelineOverview3D.tsx`
- Delete: `modes/clipcraft/viewer/timeline/overview/Layer3D.tsx`
- Delete: `modes/clipcraft/viewer/timeline/overview/useOverviewCamera.ts`
- Delete: `modes/clipcraft/viewer/timeline/overview/OverviewControls.tsx`

Only do this after Task 5 is confirmed working.

- [ ] **Step 1: Delete the old files**

```bash
rm modes/clipcraft/viewer/timeline/overview/TimelineOverview3D.tsx
rm modes/clipcraft/viewer/timeline/overview/Layer3D.tsx
rm modes/clipcraft/viewer/timeline/overview/useOverviewCamera.ts
rm modes/clipcraft/viewer/timeline/overview/OverviewControls.tsx
```

- [ ] **Step 2: Verify no remaining imports reference deleted files**

Run: `grep -r "TimelineOverview3D\|Layer3D\|useOverviewCamera\|OverviewControls" modes/clipcraft/viewer/ --include="*.ts" --include="*.tsx"`
Expected: No matches (or only the LayerToggle import which was already updated in Task 1)

- [ ] **Step 3: Verify the project builds**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add -u modes/clipcraft/viewer/timeline/overview/
git commit -m "refactor(clipcraft): remove old 3D timeline overview files (replaced by ExplodedView)"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Replace entire 3D overview → Task 5 (swap import) + Task 6 (delete old)
- ✅ Follow playhead (`globalTime`) → Task 4 (`sceneAtTime` in ExplodedView)
- ✅ Layers only (v1) → Task 3 (ExplodedLayer renders caption/video/audio/bgm)
- ✅ Single click → dive-in → Task 4 (`handleDive` on click)
- ✅ CSS 3D transforms → Task 3+4 (Framer Motion `z`, `preserve-3d`)
- ✅ Scroll to shift layer focus → Task 4 (`handleWheel`)
- ✅ Fixed side-perspective → Task 4 (`CAMERA` constant)
- ✅ `focusedLayer` state → Task 1 (store types + reducer)
- ✅ `useCurrentFrame` hook → Task 2
- ✅ Video frame capture throttled ~100ms → Task 2 (rAF + INTERVAL)
- ✅ BGM waveform 10s window → Task 3 (BgmContent in ExplodedLayer)
- ✅ LayerToggle reused → Task 4 (imported from existing location)
- ✅ Escape to collapse → Task 4 (keydown handler)
- ✅ `LayerType` moved to store → Task 1
- ✅ Delete old files → Task 6
- ✅ Opening animation (stacked → spread) → Task 3+4 (Framer Motion `animate={{ z }}`)
- ✅ Layer styling (dark bg, colored border, box-shadow) → Task 3

**Placeholder scan:** No TBDs, TODOs, or vague steps found. All code is complete.

**Type consistency:** `LayerType` is defined in Task 1 (`store/types.ts`) and imported consistently in Tasks 3, 4. `LAYER_ORDER` exported from Task 3 and imported in Task 4. `ExplodedLayerProps` interface matches all usages in Task 4. `useCurrentFrame` signature in Task 2 matches usage in Task 4.

Note on Task 5: Steps 2-3 require reading the parent component to find where `VideoPreview` and `TimelineShell` are rendered as siblings. The implementer needs to discover this file and lift `videoRefs` there. The exact file path couldn't be hard-coded because it wasn't read during planning — the steps guide the engineer through discovery.
