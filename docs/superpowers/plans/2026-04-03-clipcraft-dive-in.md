# ClipCraft Dive In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build contextual per-material editing panels that let users send natural language modification instructions to the agent from a focused dive-in view.

**Architecture:** A shared `DivePanel` shell (header + per-type content + text input) renders in the expanded area when `timelineMode === "dive"`. Four content components show material-specific context. Text input sends messages via `sendUserMessage` wrapped in `<dive-context>` XML tags. Two new reducer actions enable direct caption editing and BGM slider adjustments.

**Tech Stack:** React 19, existing ClipCraft store (useReducer), `sendUserMessage` from `src/ws.ts`, existing `useCurrentFrame` / `useWaveform` / `WaveformBars` hooks/components.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `modes/clipcraft/viewer/timeline/dive/DivePanel.tsx` | **New.** Shell: renders DiveHeader + per-type content + DiveInput. Reads `diveLayer` from store to switch content. Accepts `videoRefs` prop. |
| `modes/clipcraft/viewer/timeline/dive/DiveHeader.tsx` | **New.** Back button, layer icon + colored label, scene ← → nav arrows, Escape key handler. |
| `modes/clipcraft/viewer/timeline/dive/DiveInput.tsx` | **New.** Text input + orange send button. Calls `sendUserMessage` with `<dive-context>` wrapping. |
| `modes/clipcraft/viewer/timeline/dive/VideoDiveContent.tsx` | **New.** Current frame (via `useCurrentFrame`), prompt text, duration, reference thumbnail. |
| `modes/clipcraft/viewer/timeline/dive/CaptionDiveContent.tsx` | **New.** Editable text area for caption, read-only style info labels. |
| `modes/clipcraft/viewer/timeline/dive/AudioDiveContent.tsx` | **New.** TTS text, voice label, waveform, duration. |
| `modes/clipcraft/viewer/timeline/dive/BgmDiveContent.tsx` | **New.** Track title, volume/fade sliders, waveform snippet. |
| `modes/clipcraft/viewer/store/types.ts` | **Modify.** Add `UPDATE_SCENE_CAPTION` and `UPDATE_BGM_CONFIG` actions. |
| `modes/clipcraft/viewer/store/reducer.ts` | **Modify.** Handle the two new actions. |
| `modes/clipcraft/viewer/timeline/TimelineShell.tsx` | **Modify.** Render `DivePanel` when `timelineMode === "dive"`, hide OverviewControls. |

---

### Task 1: Add store actions for caption editing and BGM config

**Files:**
- Modify: `modes/clipcraft/viewer/store/types.ts`
- Modify: `modes/clipcraft/viewer/store/reducer.ts`

- [ ] **Step 1: Add new actions to types**

In `modes/clipcraft/viewer/store/types.ts`, add two new action types to the `ClipCraftAction` union, after the `SET_TIMELINE_ZOOM` line (line 90):

```typescript
  // Dive-in direct edits
  | { type: "UPDATE_SCENE_CAPTION"; sceneId: string; caption: string }
  | { type: "UPDATE_BGM_CONFIG"; config: Partial<{ volume: number; fadeIn: number; fadeOut: number }> };
```

Note: the last line of the union already ends with `;` — replace that semicolon with the new lines above (the final new line ends with `;`).

- [ ] **Step 2: Handle new actions in reducer**

In `modes/clipcraft/viewer/store/reducer.ts`, add two new cases in the switch statement, before the `default` case:

```typescript
    case "UPDATE_SCENE_CAPTION": {
      const scenes = state.storyboard.scenes.map(s =>
        s.id === action.sceneId ? { ...s, caption: action.caption } : s,
      );
      return {
        ...state,
        storyboard: { ...state.storyboard, scenes },
      };
    }

    case "UPDATE_BGM_CONFIG": {
      if (!state.storyboard.bgm) return state;
      return {
        ...state,
        storyboard: {
          ...state.storyboard,
          bgm: { ...state.storyboard.bgm, ...action.config },
        },
      };
    }
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/store/types.ts modes/clipcraft/viewer/store/reducer.ts
git commit -m "feat(clipcraft): add UPDATE_SCENE_CAPTION and UPDATE_BGM_CONFIG store actions"
```

---

### Task 2: Create DiveHeader component

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/DiveHeader.tsx`

- [ ] **Step 1: Create the DiveHeader component**

Create `modes/clipcraft/viewer/timeline/dive/DiveHeader.tsx`:

```typescript
import { useCallback, useEffect } from "react";
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import { selectSortedScenes, selectTotalDuration } from "../../store/selectors.js";
import type { LayerType } from "../../store/types.js";

const LAYER_META: Record<LayerType, { label: string; icon: string; color: string }> = {
  caption: { label: "CAPTION", icon: "Tt", color: "#f97316" },
  video:   { label: "VIDEO",   icon: "🎬", color: "#eab308" },
  audio:   { label: "AUDIO",   icon: "🔊", color: "#38bdf8" },
  bgm:     { label: "BGM",     icon: "♪",  color: "#a78bfa" },
};

export function DiveHeader() {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const { diveLayer, playback } = state;
  const scenes = selectSortedScenes(state);

  const layer = diveLayer ?? "video";
  const meta = LAYER_META[layer];
  const sceneIndex = playback.currentSceneIndex;
  const scene = scenes[sceneIndex];
  const sceneLabel = scene ? `Scene ${scene.order + 1}` : "";

  // Back to exploded view
  const handleBack = useCallback(() => {
    dispatch({ type: "SET_TIMELINE_MODE", mode: "overview" });
    dispatch({ type: "SET_DIVE_LAYER", layer: null });
  }, [dispatch]);

  // Scene navigation — seek to previous/next scene start
  const handlePrevScene = useCallback(() => {
    if (sceneIndex <= 0) return;
    let cumulative = 0;
    for (let i = 0; i < sceneIndex - 1; i++) {
      cumulative += scenes[i].duration;
    }
    dispatch({ type: "SEEK", globalTime: cumulative });
  }, [dispatch, scenes, sceneIndex]);

  const handleNextScene = useCallback(() => {
    if (sceneIndex >= scenes.length - 1) return;
    let cumulative = 0;
    for (let i = 0; i <= sceneIndex; i++) {
      cumulative += scenes[i].duration;
    }
    dispatch({ type: "SEEK", globalTime: cumulative });
  }, [dispatch, scenes, sceneIndex]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleBack]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: 40,
      padding: "0 12px",
      borderBottom: "1px solid #27272a",
      flexShrink: 0,
    }}>
      {/* Back button */}
      <button
        onClick={handleBack}
        title="Back to overview"
        style={{
          background: "none",
          border: "1px solid #3f3f46",
          borderRadius: 4,
          color: "#a1a1aa",
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
        }}
      >
        ←
      </button>

      {/* Layer icon + label */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: meta.color,
        fontWeight: 600,
        fontSize: 12,
        fontFamily: "'Inter', system-ui, sans-serif",
        letterSpacing: "0.05em",
      }}>
        <span>{meta.icon}</span>
        <span>{meta.label}</span>
      </div>

      {/* Scene label */}
      <span style={{ color: "#71717a", fontSize: 11 }}>
        — {sceneLabel}
      </span>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Scene navigation */}
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={handlePrevScene}
          disabled={sceneIndex <= 0}
          title="Previous scene"
          style={{
            background: "none",
            border: "1px solid #3f3f46",
            borderRadius: 4,
            color: sceneIndex <= 0 ? "#3f3f46" : "#a1a1aa",
            cursor: sceneIndex <= 0 ? "default" : "pointer",
            padding: "2px 6px",
            fontSize: 12,
          }}
        >
          ←
        </button>
        <button
          onClick={handleNextScene}
          disabled={sceneIndex >= scenes.length - 1}
          title="Next scene"
          style={{
            background: "none",
            border: "1px solid #3f3f46",
            borderRadius: 4,
            color: sceneIndex >= scenes.length - 1 ? "#3f3f46" : "#a1a1aa",
            cursor: sceneIndex >= scenes.length - 1 ? "default" : "pointer",
            padding: "2px 6px",
            fontSize: 12,
          }}
        >
          →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/DiveHeader.tsx
git commit -m "feat(clipcraft): add DiveHeader with back button, layer label, and scene navigation"
```

---

### Task 3: Create DiveInput component

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/DiveInput.tsx`

- [ ] **Step 1: Create the DiveInput component**

Create `modes/clipcraft/viewer/timeline/dive/DiveInput.tsx`:

```typescript
import { useState, useCallback } from "react";
import { sendUserMessage } from "../../../../../src/ws.js";
import { useClipCraftState } from "../../store/ClipCraftContext.js";
import { selectSortedScenes } from "../../store/selectors.js";
import type { LayerType } from "../../store/types.js";

export function DiveInput() {
  const [text, setText] = useState("");
  const state = useClipCraftState();
  const { diveLayer, playback } = state;
  const scenes = selectSortedScenes(state);

  const layer = diveLayer ?? "video";
  const scene = scenes[playback.currentSceneIndex];

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !scene) return;

    const message = `<dive-context layer="${layer}" sceneId="${scene.id}" sceneOrder="${scene.order + 1}">\n${trimmed}\n</dive-context>`;
    sendUserMessage(message);
    setText("");
  }, [text, layer, scene]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: 48,
      padding: "0 12px",
      borderTop: "1px solid #27272a",
      flexShrink: 0,
    }}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want to change..."
        style={{
          flex: 1,
          background: "#18181b",
          border: "1px solid #3f3f46",
          borderRadius: 6,
          color: "#e4e4e7",
          padding: "6px 12px",
          fontSize: 13,
          fontFamily: "'Inter', system-ui, sans-serif",
          outline: "none",
        }}
      />
      <button
        onClick={handleSend}
        disabled={!text.trim()}
        style={{
          background: text.trim() ? "#f97316" : "#3f3f46",
          border: "none",
          borderRadius: 6,
          color: "#fff",
          cursor: text.trim() ? "pointer" : "default",
          padding: "6px 16px",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

Note: The import `from "../../../../../src/ws.js"` is a deep relative path. This matches the pattern used by other mode viewer files that need to reach into the main `src/` directory. If the build fails due to this import path, check `modes/clipcraft/viewer/` depth and adjust.

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/DiveInput.tsx
git commit -m "feat(clipcraft): add DiveInput for sending dive-context messages to agent"
```

---

### Task 4: Create per-type dive content components

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/VideoDiveContent.tsx`
- Create: `modes/clipcraft/viewer/timeline/dive/CaptionDiveContent.tsx`
- Create: `modes/clipcraft/viewer/timeline/dive/AudioDiveContent.tsx`
- Create: `modes/clipcraft/viewer/timeline/dive/BgmDiveContent.tsx`

- [ ] **Step 1: Create VideoDiveContent**

Create `modes/clipcraft/viewer/timeline/dive/VideoDiveContent.tsx`:

```typescript
import type { Scene } from "../../../types.js";
import { useCurrentFrame } from "../../hooks/useCurrentFrame.js";
import { useWorkspaceUrl } from "../../hooks/useWorkspaceUrl.js";

interface Props {
  scene: Scene;
  videoEl: HTMLVideoElement | null;
  globalTime: number;
  playing: boolean;
}

export function VideoDiveContent({ scene, videoEl, globalTime, playing }: Props) {
  const frameUrl = useCurrentFrame(videoEl, globalTime, playing);
  const url = useWorkspaceUrl();
  const prompt = scene.visual?.prompt;
  const thumbnail = scene.visual?.thumbnail;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      {/* Current frame */}
      <div style={{
        background: "#000",
        borderRadius: 6,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 120,
      }}>
        {frameUrl ? (
          <img src={frameUrl} alt="Current frame" style={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain" }} />
        ) : (
          <div style={{ color: "#52525b", fontSize: 13, padding: 24 }}>Capturing frame...</div>
        )}
      </div>

      {/* Reference thumbnail */}
      {thumbnail && (
        <div>
          <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Reference</div>
          <img src={url(thumbnail)} alt="Reference" style={{ maxWidth: 120, maxHeight: 80, objectFit: "contain", borderRadius: 4, border: "1px solid #27272a" }} />
        </div>
      )}

      {/* Prompt */}
      <div>
        <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Prompt</div>
        <div style={{
          fontFamily: "monospace",
          fontSize: 12,
          color: prompt ? "#d4d4d8" : "#52525b",
          background: "#18181b",
          borderRadius: 6,
          padding: "8px 12px",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          fontStyle: prompt ? "normal" : "italic",
        }}>
          {prompt ?? "No prompt"}
        </div>
      </div>

      {/* Duration */}
      <div style={{ fontSize: 11, color: "#71717a" }}>
        Duration: <span style={{ color: "#a1a1aa", fontFamily: "monospace" }}>{scene.duration.toFixed(1)}s</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CaptionDiveContent**

Create `modes/clipcraft/viewer/timeline/dive/CaptionDiveContent.tsx`:

```typescript
import { useCallback } from "react";
import type { Scene, ProjectConfig } from "../../../types.js";
import { useClipCraftDispatch } from "../../store/ClipCraftContext.js";

interface Props {
  scene: Scene;
  project: ProjectConfig;
}

export function CaptionDiveContent({ scene, project }: Props) {
  const dispatch = useClipCraftDispatch();
  const caption = scene.caption ?? "";

  const handleCaptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    dispatch({ type: "UPDATE_SCENE_CAPTION", sceneId: scene.id, caption: e.target.value });
  }, [dispatch, scene.id]);

  const style = project.style;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      {/* Editable caption */}
      <div>
        <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Caption Text</div>
        <textarea
          value={caption}
          onChange={handleCaptionChange}
          placeholder="Enter caption..."
          rows={3}
          style={{
            width: "100%",
            background: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: 6,
            color: "#e4e4e7",
            padding: "8px 12px",
            fontSize: 14,
            fontFamily: "'Inter', system-ui, sans-serif",
            lineHeight: 1.5,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Style info (read-only) */}
      <div>
        <div style={{ fontSize: 10, color: "#71717a", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Style Settings</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <StyleLabel label="Font" value={style.captionFont} />
          <StyleLabel label="Position" value={style.captionPosition} />
          <StyleLabel label="Style" value={style.captionStyle} />
        </div>
      </div>
    </div>
  );
}

function StyleLabel({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "#18181b",
      border: "1px solid #27272a",
      borderRadius: 4,
      padding: "4px 10px",
      fontSize: 11,
    }}>
      <span style={{ color: "#71717a" }}>{label}: </span>
      <span style={{ color: "#a1a1aa" }}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 3: Create AudioDiveContent**

Create `modes/clipcraft/viewer/timeline/dive/AudioDiveContent.tsx`:

```typescript
import type { Scene } from "../../../types.js";
import { useWaveform } from "../../timeline/hooks/useWaveform.js";
import { WaveformBars } from "../../timeline/WaveformBars.js";
import { useWorkspaceUrl } from "../../hooks/useWorkspaceUrl.js";

interface Props {
  scene: Scene;
}

export function AudioDiveContent({ scene }: Props) {
  const url = useWorkspaceUrl();
  const audio = scene.audio;
  const audioUrl = audio?.status === "ready" && audio.source ? url(audio.source) : null;
  const { waveform } = useWaveform(audioUrl ? { audioUrl, bars: 120 } : null);

  if (!audio) {
    return (
      <div style={{ padding: 16, color: "#52525b", fontSize: 13, fontStyle: "italic" }}>
        No TTS audio for this scene.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      {/* TTS text */}
      <div>
        <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>TTS Text</div>
        <div style={{
          background: "#18181b",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 13,
          color: "#d4d4d8",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}>
          {audio.text}
        </div>
      </div>

      {/* Voice */}
      {audio.voice && (
        <div style={{ fontSize: 11, color: "#71717a" }}>
          Voice: <span style={{ color: "#a1a1aa" }}>{audio.voice}</span>
        </div>
      )}

      {/* Waveform */}
      {waveform && (
        <div>
          <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Waveform</div>
          <div style={{ background: "#18181b", borderRadius: 6, padding: "8px 12px" }}>
            <WaveformBars peaks={waveform.peaks} height={40} color="#38bdf8" stretch />
          </div>
        </div>
      )}

      {/* Duration */}
      {audio.duration != null && (
        <div style={{ fontSize: 11, color: "#71717a" }}>
          Duration: <span style={{ color: "#a1a1aa", fontFamily: "monospace" }}>{audio.duration.toFixed(1)}s</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create BgmDiveContent**

Create `modes/clipcraft/viewer/timeline/dive/BgmDiveContent.tsx`:

```typescript
import { useCallback, useMemo } from "react";
import type { BGMConfig } from "../../../types.js";
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import { selectTotalDuration } from "../../store/selectors.js";
import { useWaveform } from "../../timeline/hooks/useWaveform.js";
import { WaveformBars } from "../../timeline/WaveformBars.js";
import { useWorkspaceUrl } from "../../hooks/useWorkspaceUrl.js";

interface Props {
  bgm: BGMConfig;
}

export function BgmDiveContent({ bgm }: Props) {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const url = useWorkspaceUrl();
  const totalDuration = selectTotalDuration(state);
  const { playback } = state;

  const bgmAudioUrl = url(bgm.source);
  const totalBars = 120;
  const barsPerSecond = totalDuration > 0 ? totalBars / 10 : 4;
  const fullBars = Math.max(totalBars, Math.ceil(totalDuration * barsPerSecond));
  const { waveform } = useWaveform({ audioUrl: bgmAudioUrl, bars: fullBars });

  const timeFraction = totalDuration > 0 ? playback.globalTime / totalDuration : 0;

  const windowPeaks = useMemo(() => {
    if (!waveform) return [];
    const peaks = waveform.peaks;
    const centerIdx = Math.floor(timeFraction * peaks.length);
    const halfWindow = Math.floor(totalBars / 2);
    const start = Math.max(0, centerIdx - halfWindow);
    const end = Math.min(peaks.length, start + totalBars);
    const actualStart = Math.max(0, end - totalBars);
    return peaks.slice(actualStart, end);
  }, [waveform, timeFraction, totalBars]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: "UPDATE_BGM_CONFIG", config: { volume: parseFloat(e.target.value) } });
  }, [dispatch]);

  const handleFadeInChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: "UPDATE_BGM_CONFIG", config: { fadeIn: parseFloat(e.target.value) } });
  }, [dispatch]);

  const handleFadeOutChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: "UPDATE_BGM_CONFIG", config: { fadeOut: parseFloat(e.target.value) } });
  }, [dispatch]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      {/* Track title */}
      <div>
        <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Track</div>
        <div style={{ fontSize: 14, color: "#d4d4d8" }}>{bgm.title}</div>
      </div>

      {/* Waveform snippet */}
      {windowPeaks.length > 0 && (
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Waveform</div>
          <div style={{ background: "#18181b", borderRadius: 6, padding: "8px 12px", position: "relative" }}>
            <WaveformBars peaks={windowPeaks} height={40} color="#a78bfa" stretch />
            <div style={{
              position: "absolute",
              left: "50%",
              top: 8,
              bottom: 8,
              width: 1,
              background: "#a78bfa",
              opacity: 0.6,
              pointerEvents: "none",
            }} />
          </div>
        </div>
      )}

      {/* Volume slider */}
      <SliderControl
        label="Volume"
        value={bgm.volume}
        min={0}
        max={1}
        step={0.01}
        displayValue={`${Math.round(bgm.volume * 100)}%`}
        onChange={handleVolumeChange}
        color="#a78bfa"
      />

      {/* Fade in */}
      <SliderControl
        label="Fade In"
        value={bgm.fadeIn}
        min={0}
        max={10}
        step={0.1}
        displayValue={`${bgm.fadeIn.toFixed(1)}s`}
        onChange={handleFadeInChange}
        color="#a78bfa"
      />

      {/* Fade out */}
      <SliderControl
        label="Fade Out"
        value={bgm.fadeOut}
        min={0}
        max={10}
        step={0.1}
        displayValue={`${bgm.fadeOut.toFixed(1)}s`}
        onChange={handleFadeOutChange}
        color="#a78bfa"
      />
    </div>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
  color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  color: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
        <span style={{ fontSize: 11, color: "#a1a1aa", fontFamily: "monospace" }}>{displayValue}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        style={{
          width: "100%",
          accentColor: color,
          height: 4,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/VideoDiveContent.tsx modes/clipcraft/viewer/timeline/dive/CaptionDiveContent.tsx modes/clipcraft/viewer/timeline/dive/AudioDiveContent.tsx modes/clipcraft/viewer/timeline/dive/BgmDiveContent.tsx
git commit -m "feat(clipcraft): add per-type dive content components (video, caption, audio, bgm)"
```

---

### Task 5: Create DivePanel shell

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/DivePanel.tsx`

- [ ] **Step 1: Create the DivePanel component**

Create `modes/clipcraft/viewer/timeline/dive/DivePanel.tsx`:

```typescript
import { useMemo } from "react";
import { useClipCraftState } from "../../store/ClipCraftContext.js";
import { selectSortedScenes } from "../../store/selectors.js";
import { DiveHeader } from "./DiveHeader.js";
import { DiveInput } from "./DiveInput.js";
import { VideoDiveContent } from "./VideoDiveContent.js";
import { CaptionDiveContent } from "./CaptionDiveContent.js";
import { AudioDiveContent } from "./AudioDiveContent.js";
import { BgmDiveContent } from "./BgmDiveContent.js";

/**
 * Given sorted scenes and a globalTime, find the scene at that time.
 */
function sceneAtTime(scenes: { id: string; duration: number }[], globalTime: number): number {
  let cumulative = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (globalTime < cumulative + scenes[i].duration || i === scenes.length - 1) {
      return i;
    }
    cumulative += scenes[i].duration;
  }
  return 0;
}

interface Props {
  videoRefs: React.RefObject<Map<string, HTMLVideoElement>>;
}

export function DivePanel({ videoRefs }: Props) {
  const state = useClipCraftState();
  const { diveLayer, playback, project, storyboard } = state;
  const scenes = selectSortedScenes(state);

  const activeSceneIdx = useMemo(
    () => sceneAtTime(scenes, playback.globalTime),
    [scenes, playback.globalTime],
  );
  const activeScene = scenes[activeSceneIdx] ?? null;

  const layer = diveLayer ?? "video";

  // Get video element for current scene
  const activeVideoEl = activeScene ? videoRefs.current?.get(activeScene.id) ?? null : null;

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "#09090b",
    }}>
      <DiveHeader />

      {/* Scrollable content area */}
      <div style={{
        flex: 1,
        overflow: "auto",
        minHeight: 0,
      }}>
        {activeScene ? (
          <DiveContent
            layer={layer}
            scene={activeScene}
            project={project}
            bgm={storyboard.bgm}
            videoEl={activeVideoEl}
            globalTime={playback.globalTime}
            playing={playback.playing}
          />
        ) : (
          <div style={{ padding: 16, color: "#52525b", fontSize: 13, fontStyle: "italic" }}>
            No scene at current position.
          </div>
        )}
      </div>

      <DiveInput />
    </div>
  );
}

function DiveContent({
  layer,
  scene,
  project,
  bgm,
  videoEl,
  globalTime,
  playing,
}: {
  layer: string;
  scene: import("../../../types.js").Scene;
  project: import("../../../types.js").ProjectConfig;
  bgm: import("../../../types.js").BGMConfig | null;
  videoEl: HTMLVideoElement | null;
  globalTime: number;
  playing: boolean;
}) {
  switch (layer) {
    case "video":
      return <VideoDiveContent scene={scene} videoEl={videoEl} globalTime={globalTime} playing={playing} />;
    case "caption":
      return <CaptionDiveContent scene={scene} project={project} />;
    case "audio":
      return <AudioDiveContent scene={scene} />;
    case "bgm":
      return bgm ? <BgmDiveContent bgm={bgm} /> : (
        <div style={{ padding: 16, color: "#52525b", fontSize: 13, fontStyle: "italic" }}>No BGM configured.</div>
      );
    default:
      return null;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/DivePanel.tsx
git commit -m "feat(clipcraft): add DivePanel shell with header, per-type content routing, and input"
```

---

### Task 6: Wire DivePanel into TimelineShell

**Files:**
- Modify: `modes/clipcraft/viewer/timeline/TimelineShell.tsx`

- [ ] **Step 1: Add DivePanel import and conditional rendering**

In `modes/clipcraft/viewer/timeline/TimelineShell.tsx`:

Add import at the top (after the existing imports):

```typescript
import { DivePanel } from "./dive/DivePanel.js";
```

Then modify the expanded area to handle `timelineMode === "dive"`. Replace the entire `{isExpanded && (...)}` block (lines 66–99) with:

```typescript
      {/* Expanded view */}
      {isExpanded && (
        <div style={{
          flex: "1 1 auto",
          overflow: "hidden",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}>
          {timelineMode === "dive" ? (
            // Dive mode — full panel, no overview controls
            <DivePanel videoRefs={videoRefs} />
          ) : (
            <>
              {/* Shared controls bar — camera presets + collapse */}
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                padding: "4px 12px",
                flexShrink: 0,
              }}>
                <OverviewControls
                  current={preset}
                  presets={PRESET_ORDER}
                  onSelect={selectPreset}
                  onCollapse={handleCollapse}
                />
              </div>

              {/* Content area */}
              <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
                {preset === "exploded" ? (
                  <ExplodedView videoRefs={videoRefs} />
                ) : (
                  <TimelineOverview3D cameraPreset={preset} />
                )}
              </div>
            </>
          )}
        </div>
      )}
```

Also update the `isExpanded` check. Currently it's `timelineMode !== "collapsed"`, which already handles `"dive"` correctly (dive is expanded). No change needed there.

- [ ] **Step 2: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Test visually**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run dev clipcraft --workspace /tmp/test-clipcraft --no-open`

Test checklist:
1. Open browser, create content with scenes
2. Expand timeline → switch to Exploded preset
3. Click a layer → should enter dive mode (DivePanel appears)
4. Verify DiveHeader shows layer name + scene number
5. Use ← → to navigate scenes within dive
6. Type in DiveInput and press Enter → message appears in chat with `<dive-context>` tags
7. Press Back → returns to exploded view
8. Press Escape → also returns to exploded view
9. Test caption dive: edit caption text in textarea
10. Test BGM dive: adjust volume/fade sliders

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/timeline/TimelineShell.tsx
git commit -m "feat(clipcraft): wire DivePanel into TimelineShell for dive mode rendering"
```

---

## Self-Review

**Spec coverage check:**
- ✅ DivePanel replaces expanded area when `timelineMode === "dive"` → Task 6
- ✅ DiveHeader: back button, layer icon + label, scene nav, Escape → Task 2
- ✅ DiveInput: text input, send via `sendUserMessage`, `<dive-context>` wrapping → Task 3
- ✅ VideoDiveContent: frame, prompt, duration, thumbnail → Task 4 Step 1
- ✅ CaptionDiveContent: editable text, style info → Task 4 Step 2
- ✅ AudioDiveContent: TTS text, voice, waveform, duration → Task 4 Step 3
- ✅ BgmDiveContent: title, volume/fade sliders, waveform → Task 4 Step 4
- ✅ `UPDATE_SCENE_CAPTION` action → Task 1
- ✅ `UPDATE_BGM_CONFIG` action → Task 1
- ✅ OverviewControls hidden in dive mode → Task 6
- ✅ Styling: dark theme, layer colors, 40px header, 48px input → Tasks 2, 3
- ✅ Enter clears input, stays in dive → Task 3
- ✅ Back → `SET_TIMELINE_MODE("overview")` + `SET_DIVE_LAYER(null)` → Task 2

**Placeholder scan:** No TBDs, TODOs, or vague steps. All code complete.

**Type consistency:** `LayerType` imported from `../../store/types.js` consistently. `Scene`, `ProjectConfig`, `BGMConfig` imported from `../../../types.js`. `UPDATE_SCENE_CAPTION` and `UPDATE_BGM_CONFIG` action types match between Task 1 (definition) and Tasks 4 (usage). `DivePanel` accepts `videoRefs` prop, matches `TimelineShell` passing in Task 6.
