# ClipCraft 3D Timeline (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expandable 3D multi-layer overview to the ClipCraft timeline, triggered by a glow button with smooth framer-motion animations.

**Architecture:** The current 200px timeline bottom bar gains a `TimelineShell` wrapper that manages three modes (collapsed/overview/dive). In `overview` mode, the shell animates to full height while the top section (AssetPanel + VideoPreview) fades out. Inside, four CSS 3D layers (Caption, Video, Audio, BGM) are arranged in depth using `perspective` + `translateZ`. A camera hook manages three preset viewpoints with spring-animated transitions.

**Tech Stack:** React 19, framer-motion 12, CSS 3D transforms, existing ClipCraft store (Context+Reducer)

---

### Task 1: Store — Add timeline mode state

**Files:**
- Modify: `modes/clipcraft/viewer/store/types.ts`
- Modify: `modes/clipcraft/viewer/store/reducer.ts`

- [ ] **Step 1: Add new state fields and actions to types.ts**

In `modes/clipcraft/viewer/store/types.ts`, add to the `ClipCraftState` interface after `imageVersion: number;`:

```typescript
  // 3D timeline mode
  timelineMode: "collapsed" | "overview" | "dive";
  diveLayer: "caption" | "video" | "audio" | "bgm" | null;
```

Add to the `ClipCraftAction` union after the `SYNC_ASSETS` action:

```typescript
  // 3D Timeline
  | { type: "SET_TIMELINE_MODE"; mode: "collapsed" | "overview" | "dive" }
  | { type: "SET_DIVE_LAYER"; layer: "caption" | "video" | "audio" | "bgm" | null };
```

- [ ] **Step 2: Add initial state and reducer cases in reducer.ts**

In `modes/clipcraft/viewer/store/reducer.ts`, add to `initialState` after `imageVersion: 0,`:

```typescript
  timelineMode: "collapsed",
  diveLayer: null,
```

Add two new cases in `clipCraftReducer` before the `default:` case:

```typescript
    case "SET_TIMELINE_MODE":
      return { ...state, timelineMode: action.mode };

    case "SET_DIVE_LAYER":
      return { ...state, diveLayer: action.layer };
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -E "timeline|Timeline|reducer|types" | head -10`
Expected: No new errors from our changes

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/store/types.ts modes/clipcraft/viewer/store/reducer.ts
git commit -m "feat(clipcraft): add timelineMode + diveLayer to store"
```

---

### Task 2: ExpandButton — Glow button component

**Files:**
- Create: `modes/clipcraft/viewer/timeline/ExpandButton.tsx`

- [ ] **Step 1: Create ExpandButton component**

```tsx
// modes/clipcraft/viewer/timeline/ExpandButton.tsx
import { motion } from "framer-motion";

interface Props {
  mode: "collapsed" | "overview" | "dive";
  onToggle: () => void;
}

export function ExpandButton({ mode, onToggle }: Props) {
  const isExpanded = mode !== "collapsed";

  return (
    <motion.button
      onClick={onToggle}
      title={isExpanded ? "Collapse timeline" : "Expand to 3D overview"}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      style={{
        position: "relative",
        width: 28,
        height: 28,
        border: "none",
        borderRadius: 6,
        background: isExpanded ? "#27272a" : "transparent",
        color: "#e4e4e7",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        zIndex: 1,
      }}
    >
      {/* Glow border — only in collapsed mode */}
      {!isExpanded && <GlowBorder />}

      {/* Icon */}
      <motion.svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        animate={{ rotate: isExpanded ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        {/* Expand/collapse chevron */}
        <path d="M4 10L8 6L12 10" />
      </motion.svg>
    </motion.button>
  );
}

/** Animated conic-gradient border that rotates continuously. */
function GlowBorder() {
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: -1,
          borderRadius: 7,
          padding: 1,
          background: "conic-gradient(from var(--glow-angle, 0deg), #f97316, #a855f7, #3b82f6, #10b981, #f97316)",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          animation: "glowSpin 3s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -4,
          borderRadius: 10,
          background: "conic-gradient(from var(--glow-angle, 0deg), rgba(249,115,22,0.3), rgba(168,85,247,0.3), rgba(59,130,246,0.3), rgba(16,185,129,0.3), rgba(249,115,22,0.3))",
          filter: "blur(6px)",
          animation: "glowSpin 3s linear infinite",
          zIndex: -1,
        }}
      />
      <style>{`
        @property --glow-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes glowSpin {
          to { --glow-angle: 360deg; }
        }
      `}</style>
    </>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep "ExpandButton" | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/ExpandButton.tsx
git commit -m "feat(clipcraft): add ExpandButton with conic-gradient glow effect"
```

---

### Task 3: useOverviewCamera — Camera state hook

**Files:**
- Create: `modes/clipcraft/viewer/timeline/overview/useOverviewCamera.ts`

- [ ] **Step 1: Create the camera hook**

```typescript
// modes/clipcraft/viewer/timeline/overview/useOverviewCamera.ts
import { useState, useCallback, useMemo } from "react";

export interface CameraState {
  rotateX: number;
  rotateY: number;
  perspective: number;
  perspectiveOriginX: number;
  perspectiveOriginY: number;
}

export type CameraPreset = "bird" | "front" | "side";

const PRESETS: Record<CameraPreset, CameraState> = {
  bird: {
    rotateX: -25,
    rotateY: 0,
    perspective: 1200,
    perspectiveOriginX: 50,
    perspectiveOriginY: 40,
  },
  front: {
    rotateX: 0,
    rotateY: 0,
    perspective: 1200,
    perspectiveOriginX: 50,
    perspectiveOriginY: 50,
  },
  side: {
    rotateX: -15,
    rotateY: 30,
    perspective: 1000,
    perspectiveOriginX: 40,
    perspectiveOriginY: 45,
  },
};

const PRESET_ORDER: CameraPreset[] = ["bird", "front", "side"];

export function useOverviewCamera() {
  const [preset, setPreset] = useState<CameraPreset>("bird");

  const camera = PRESETS[preset];

  const nextPreset = useCallback(() => {
    setPreset((p) => {
      const idx = PRESET_ORDER.indexOf(p);
      return PRESET_ORDER[(idx + 1) % PRESET_ORDER.length];
    });
  }, []);

  const selectPreset = useCallback((p: CameraPreset) => {
    setPreset(p);
  }, []);

  return useMemo(
    () => ({ camera, preset, nextPreset, selectPreset, PRESET_ORDER }),
    [camera, preset, nextPreset, selectPreset],
  );
}
```

- [ ] **Step 2: Create overview directory and verify build**

Run: `mkdir -p modes/clipcraft/viewer/timeline/overview && npx tsc --noEmit 2>&1 | grep "useOverviewCamera" | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/overview/useOverviewCamera.ts
git commit -m "feat(clipcraft): add useOverviewCamera hook with 3 presets"
```

---

### Task 4: OverviewControls — Camera preset buttons

**Files:**
- Create: `modes/clipcraft/viewer/timeline/overview/OverviewControls.tsx`

- [ ] **Step 1: Create the controls component**

```tsx
// modes/clipcraft/viewer/timeline/overview/OverviewControls.tsx
import type { CameraPreset } from "./useOverviewCamera.js";

const PRESET_LABELS: Record<CameraPreset, { label: string; icon: string }> = {
  bird: { label: "Bird's eye", icon: "⬇" },
  front: { label: "Front", icon: "⏺" },
  side: { label: "Side", icon: "◧" },
};

interface Props {
  current: CameraPreset;
  presets: readonly CameraPreset[];
  onSelect: (preset: CameraPreset) => void;
  onCollapse: () => void;
}

export function OverviewControls({ current, presets, onSelect, onCollapse }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 12,
        display: "flex",
        alignItems: "center",
        gap: 4,
        zIndex: 20,
      }}
    >
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
            width: 28,
            height: 24,
            cursor: "pointer",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
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
          background: "transparent",
          border: "1px solid #3f3f46",
          borderRadius: 3,
          color: "#71717a",
          width: 28,
          height: 24,
          cursor: "pointer",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ↓
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep "OverviewControls" | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/overview/OverviewControls.tsx
git commit -m "feat(clipcraft): add OverviewControls camera preset buttons"
```

---

### Task 5: Layer3D — Single 3D layer component

**Files:**
- Create: `modes/clipcraft/viewer/timeline/overview/Layer3D.tsx`

- [ ] **Step 1: Create the Layer3D component**

```tsx
// modes/clipcraft/viewer/timeline/overview/Layer3D.tsx
import { motion } from "framer-motion";
import type { Scene, BGMConfig } from "../../../types.js";
import { CaptionTrack } from "../CaptionTrack.js";
import { VideoTrack } from "../VideoTrack.js";
import { AudioTrack } from "../AudioTrack.js";
import { BgmTrack } from "../BgmTrack.js";

export type LayerType = "caption" | "video" | "audio" | "bgm";

const LAYER_META: Record<LayerType, { label: string; icon: string; color: string; height: number }> = {
  caption: { label: "Caption", icon: "Tt", color: "#f97316", height: 48 },
  video: { label: "Video", icon: "\uD83C\uDFAC", color: "#eab308", height: 64 },
  audio: { label: "Audio", icon: "\uD83D\uDD0A", color: "#38bdf8", height: 48 },
  bgm: { label: "BGM", icon: "\u266A", color: "#a78bfa", height: 48 },
};

interface Props {
  layerType: LayerType;
  zOffset: number;
  rotateX: number;
  scenes: Scene[];
  bgm: BGMConfig | null;
  totalDuration: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
  selectedSceneId: string | null;
  selected: boolean;
  onSelect: () => void;
  onDive: () => void;
  /** playhead X position in pixels (relative to scroll) */
  playheadX: number;
}

export function Layer3D({
  layerType,
  zOffset,
  rotateX,
  scenes,
  bgm,
  totalDuration,
  pixelsPerSecond,
  scrollLeft,
  viewportWidth,
  selectedSceneId,
  selected,
  onSelect,
  onDive,
  playheadX,
}: Props) {
  const meta = LAYER_META[layerType];

  return (
    <motion.div
      onClick={onSelect}
      onDoubleClick={onDive}
      animate={{
        z: zOffset,
        rotateX,
        opacity: selected ? 1 : 0.6,
        scale: selected ? 1.01 : 1,
      }}
      transition={{ type: "spring", stiffness: 200, damping: 25 }}
      style={{
        transformStyle: "preserve-3d",
        position: "relative",
        width: "100%",
        height: meta.height,
        cursor: "pointer",
        borderRadius: 6,
        overflow: "hidden",
        willChange: "transform",
        marginBottom: 12,
      }}
    >
      {/* Layer label */}
      <div
        style={{
          position: "absolute",
          left: -40,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 10,
          color: meta.color,
          fontWeight: 600,
          whiteSpace: "nowrap",
          opacity: 0.8,
        }}
      >
        {meta.icon} {meta.label}
      </div>

      {/* Track content */}
      <div style={{ height: "100%", overflow: "hidden" }}>
        {layerType === "caption" && (
          <CaptionTrack
            scenes={scenes}
            totalDuration={totalDuration}
            selectedSceneId={selectedSceneId}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
          />
        )}
        {layerType === "video" && (
          <VideoTrack
            scenes={scenes}
            totalDuration={totalDuration}
            selectedSceneId={selectedSceneId}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
          />
        )}
        {layerType === "audio" && (
          <AudioTrack
            scenes={scenes}
            totalDuration={totalDuration}
            selectedSceneId={selectedSceneId}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
          />
        )}
        {layerType === "bgm" && bgm && (
          <BgmTrack
            bgm={bgm}
            totalDuration={totalDuration}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            viewportWidth={viewportWidth}
          />
        )}
      </div>

      {/* Playhead line on this layer */}
      {playheadX >= 0 && playheadX <= viewportWidth && (
        <div
          style={{
            position: "absolute",
            left: playheadX,
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: "#f97316",
            boxShadow: "0 0 6px rgba(249, 115, 22, 0.5)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        />
      )}

      {/* Selection highlight border */}
      {selected && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: `1px solid ${meta.color}40`,
            borderRadius: 6,
            pointerEvents: "none",
          }}
        />
      )}
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep "Layer3D" | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/overview/Layer3D.tsx
git commit -m "feat(clipcraft): add Layer3D component with 3D transform + track rendering"
```

---

### Task 6: TimelineOverview3D — 3D container

**Files:**
- Create: `modes/clipcraft/viewer/timeline/overview/TimelineOverview3D.tsx`

- [ ] **Step 1: Create the 3D overview container**

```tsx
// modes/clipcraft/viewer/timeline/overview/TimelineOverview3D.tsx
import { useRef, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import { selectSortedScenes, selectTotalDuration } from "../../store/selectors.js";
import { useTimelineZoom } from "../hooks/useTimelineZoom.js";
import { TimeRuler } from "../TimeRuler.js";
import { useOverviewCamera } from "./useOverviewCamera.js";
import { OverviewControls } from "./OverviewControls.js";
import { Layer3D, type LayerType } from "./Layer3D.js";

const LAYER_ORDER: LayerType[] = ["caption", "video", "audio", "bgm"];
const Z_OFFSETS: Record<LayerType, number> = {
  caption: 120,
  video: 40,
  audio: -40,
  bgm: -120,
};

export function TimelineOverview3D() {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const scenes = selectSortedScenes(state);
  const totalDuration = selectTotalDuration(state);
  const { selectedSceneId, playback, storyboard } = state;
  const bgm = storyboard.bgm;

  const containerRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(totalDuration, 1);
  const zoom = useTimelineZoom(dur, containerRef);
  const { camera, preset, selectPreset, PRESET_ORDER } = useOverviewCamera();

  const [selectedLayer, setSelectedLayer] = useState<LayerType | null>(null);

  const handleCollapse = useCallback(() => {
    dispatch({ type: "SET_TIMELINE_MODE", mode: "collapsed" });
  }, [dispatch]);

  const handleDive = useCallback(
    (layer: LayerType) => {
      dispatch({ type: "SET_DIVE_LAYER", layer });
      dispatch({ type: "SET_TIMELINE_MODE", mode: "dive" });
    },
    [dispatch],
  );

  // Keyboard: Esc to collapse
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCollapse();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCollapse]);

  // Wheel: Shift+scroll = pan, Alt+scroll = zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.altKey) {
        // Zoom
        const factor = e.deltaY > 0 ? 1 / 1.3 : 1.3;
        zoom.setZoom(zoom.pixelsPerSecond * factor);
      } else if (e.shiftKey) {
        // Pan
        zoom.scrollTo(zoom.scrollLeft + e.deltaY);
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoom]);

  const playheadX = playback.globalTime * zoom.pixelsPerSecond - zoom.scrollLeft;

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#09090b",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <OverviewControls
        current={preset}
        presets={PRESET_ORDER}
        onSelect={selectPreset}
        onCollapse={handleCollapse}
      />

      {/* Time ruler at top */}
      <div style={{ padding: "8px 60px 0", flexShrink: 0 }}>
        <TimeRuler
          duration={dur}
          pixelsPerSecond={zoom.pixelsPerSecond}
          scrollLeft={zoom.scrollLeft}
          width={zoom.viewportWidth - 60}
        />
      </div>

      {/* 3D scene */}
      <motion.div
        animate={{
          perspective: camera.perspective,
          perspectiveOrigin: `${camera.perspectiveOriginX}% ${camera.perspectiveOriginY}%`,
        }}
        transition={{ type: "spring", stiffness: 150, damping: 25 }}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "0 60px",
          transformStyle: "preserve-3d",
        }}
      >
        <motion.div
          animate={{
            rotateX: camera.rotateX,
            rotateY: camera.rotateY,
          }}
          transition={{ type: "spring", stiffness: 150, damping: 25 }}
          style={{
            width: "100%",
            transformStyle: "preserve-3d",
          }}
        >
          {LAYER_ORDER.map((layerType) => {
            // Skip BGM layer if no BGM
            if (layerType === "bgm" && !bgm) return null;

            return (
              <Layer3D
                key={layerType}
                layerType={layerType}
                zOffset={Z_OFFSETS[layerType]}
                rotateX={0}
                scenes={scenes}
                bgm={bgm}
                totalDuration={dur}
                pixelsPerSecond={zoom.pixelsPerSecond}
                scrollLeft={zoom.scrollLeft}
                viewportWidth={zoom.viewportWidth - 120}
                selectedSceneId={selectedSceneId}
                selected={selectedLayer === layerType}
                onSelect={() => setSelectedLayer(layerType)}
                onDive={() => handleDive(layerType)}
                playheadX={playheadX}
              />
            );
          })}
        </motion.div>
      </motion.div>

      {/* Zoom info */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 12,
          fontSize: 10,
          color: "#3f3f46",
        }}
      >
        {Math.round(zoom.pixelsPerSecond)}px/s · shift+scroll pan · alt+scroll zoom · esc close
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep "TimelineOverview3D" | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/overview/TimelineOverview3D.tsx
git commit -m "feat(clipcraft): add TimelineOverview3D with CSS 3D layers + camera"
```

---

### Task 7: TimelineShell — Mode manager with animations

**Files:**
- Create: `modes/clipcraft/viewer/timeline/TimelineShell.tsx`

- [ ] **Step 1: Create TimelineShell**

```tsx
// modes/clipcraft/viewer/timeline/TimelineShell.tsx
import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useClipCraftState, useClipCraftDispatch } from "../store/ClipCraftContext.js";
import { Timeline } from "./Timeline.js";
import { ExpandButton } from "./ExpandButton.js";
import { TimelineOverview3D } from "./overview/TimelineOverview3D.js";

const shellVariants = {
  collapsed: { height: 200 },
  overview: { height: "100vh" },
  dive: { height: "100vh" },
};

const shellTransition = { type: "spring" as const, stiffness: 200, damping: 30 };

export function TimelineShell() {
  const { timelineMode } = useClipCraftState();
  const dispatch = useClipCraftDispatch();

  const handleToggle = useCallback(() => {
    dispatch({
      type: "SET_TIMELINE_MODE",
      mode: timelineMode === "collapsed" ? "overview" : "collapsed",
    });
  }, [timelineMode, dispatch]);

  return (
    <motion.div
      animate={timelineMode}
      variants={shellVariants}
      transition={shellTransition}
      style={{
        overflow: "hidden",
        position: "relative",
        background: "#09090b",
        borderTop: "1px solid #27272a",
      }}
    >
      {/* Expand/Collapse button */}
      <div
        style={{
          position: "absolute",
          top: 4,
          left: 12,
          zIndex: 30,
        }}
      >
        <ExpandButton mode={timelineMode} onToggle={handleToggle} />
      </div>

      {/* Mode content */}
      <AnimatePresence mode="wait">
        {timelineMode === "collapsed" && (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ height: "100%" }}
          >
            <Timeline />
          </motion.div>
        )}

        {timelineMode === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{ height: "100%" }}
          >
            <TimelineOverview3D />
          </motion.div>
        )}

        {timelineMode === "dive" && (
          <motion.div
            key="dive"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#52525b",
              fontSize: 14,
            }}
          >
            Layer Dive — coming in Phase 2
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep "TimelineShell" | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/TimelineShell.tsx
git commit -m "feat(clipcraft): add TimelineShell with framer-motion mode animations"
```

---

### Task 8: ClipCraftLayout — Integrate TimelineShell + top section animation

**Files:**
- Modify: `modes/clipcraft/viewer/layout/ClipCraftLayout.tsx`

- [ ] **Step 1: Replace Timeline with TimelineShell, animate top section**

Replace the entire content of `modes/clipcraft/viewer/layout/ClipCraftLayout.tsx`:

```tsx
// modes/clipcraft/viewer/layout/ClipCraftLayout.tsx
import { motion } from "framer-motion";
import { AssetPanel } from "../AssetPanel.js";
import { VideoPreview } from "../VideoPreview.js";
import { TimelineShell } from "../timeline/TimelineShell.js";
import { useClipCraftState } from "../store/ClipCraftContext.js";

/**
 * Default ClipCraft layout — medeo-inspired:
 * ┌──────────────┬────────────────────────┐
 * │ AssetPanel   │     Video Preview      │
 * │ (Assets/     │     (with captions)    │
 * │  Script tabs)│                        │
 * ├──────────────┴────────────────────────┤
 * │ TimelineShell (collapsed / 3D / dive) │
 * └───────────────────────────────────────┘
 */
export function ClipCraftLayout() {
  const { timelineMode } = useClipCraftState();
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
      {/* Top: sidebar + preview — collapses when timeline expands */}
      <motion.div
        animate={{
          flex: isExpanded ? "0 0 0px" : "1 1 60%",
          opacity: isExpanded ? 0 : 1,
        }}
        transition={{ type: "spring", stiffness: 200, damping: 30 }}
        style={{
          display: "flex",
          minHeight: 0,
          borderBottom: "1px solid #27272a",
          overflow: "hidden",
        }}
      >
        <AssetPanel />
        <div style={{ flex: 1, minWidth: 0 }}>
          <VideoPreview />
        </div>
      </motion.div>

      {/* Timeline shell — manages its own height animation */}
      <TimelineShell />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -E "ClipCraftLayout|TimelineShell" | head -5`
Expected: No errors

- [ ] **Step 3: Test manually**

Run the dev server: `bun run dev clipcraft --workspace ~/pneuma-projects/clipcraft-20260402-0411 --dev`

Verify:
1. Default view shows the collapsed timeline as before (200px bottom bar)
2. Glow button visible in timeline top-left corner with rotating gradient border
3. Click glow button → top section fades out, timeline expands to full height, 3D layers appear
4. Three camera preset buttons in top-right (bird/front/side) — clicking switches view with spring animation
5. Shift+scroll pans timeline, Alt+scroll zooms
6. Esc or clicking collapse button → animates back to collapsed state
7. Double-click a layer → shows "Layer Dive — coming in Phase 2" placeholder

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/layout/ClipCraftLayout.tsx
git commit -m "feat(clipcraft): integrate TimelineShell into layout with top section animation"
```

---

### Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Store | `timelineMode` + `diveLayer` state and actions |
| 2 | ExpandButton | Glow button with conic-gradient animation |
| 3 | useOverviewCamera | Camera state hook with 3 presets |
| 4 | OverviewControls | Preset switch buttons + collapse |
| 5 | Layer3D | Single 3D layer wrapping existing track components |
| 6 | TimelineOverview3D | 3D container with perspective + wheel controls |
| 7 | TimelineShell | Mode manager with framer-motion height/opacity animations |
| 8 | ClipCraftLayout | Integration — top section collapse + TimelineShell |
