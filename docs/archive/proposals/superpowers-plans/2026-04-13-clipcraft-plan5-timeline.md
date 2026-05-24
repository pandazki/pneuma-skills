# Plan 5 — Timeline UI (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ClipCraft renders a real interactive timeline that reads from the craft composition store and drives play/pause/seek. A user can see every clip's position, duration, and content; scrub via click or playhead drag; and identify which clip is under the playhead. No clip manipulation (drag-to-move, resize, split) in this plan — that's Plan 5.5 or Plan 6.

**Architecture:** Port the *visual* components from `modes/clipcraft-legacy/viewer/timeline/` (Playhead, TimeRuler, VideoTrack filmstrip, waveform, zoom UX, frame extractor) but replace the legacy reducer data source with craft store selectors: `useComposition()`, `usePlayback()`, `useSelection()`. Zoom/scroll stay in local React state inside a mode-owned `useTimelineZoom` hook — upstream's headless `TimelineRoot` exposes a `pixelsPerSecond` prop but no zoom setter, so the mode owns that surface today. Click-to-seek dispatches `seek()` from `usePlayback()`; click-on-clip dispatches `selection:set`. Nothing writes composition shape.

**Tech Stack:** React 19, `@pneuma-craft/react` (`useComposition`, `usePlayback`, `useSelection`, `useDispatch`), Web Audio `decodeAudioData` for waveforms, HTMLVideoElement + canvas for thumbnail extraction. No new deps.

**Out of scope (deferred):**
- Clip drag-to-move, resize, split (Plan 5.5 or Plan 6).
- Asset library drag-and-drop onto timeline (Plan 6+).
- Ripple/snap (copy from `@pneuma-craft/react-ui/src/timeline/timeline-track.tsx` when clip editing lands — DO NOT import from react-ui, that package is intentionally not consumed).
- 3D overview (Plan 6 — TimelineOverview3D on craft).
- Dive canvas (Plan 7).
- Audio waveform performance optimization (lazy decode is enough; virtualization comes with real multi-track content in Plan 9+).

---

## File Structure

### New files under `modes/clipcraft/viewer/timeline/`

- `Timeline.tsx` — the root component. Reads `useComposition()`, `usePlayback()`, `useSelection()`; owns `useTimelineZoom` hook state; renders `TimeRuler` + one row per track + `Playhead` overlay.
- `TimeRuler.tsx` — adaptive tick marks (1/2/5/10s based on `pixelsPerSecond`). Pure math, no DOM measurement. Ported verbatim from legacy.
- `Playhead.tsx` — drag handle + click overlay. On drag/click, calls `usePlayback().seek()`. Ported from legacy, reducer dispatches replaced with `seek(t)`.
- `TrackRow.tsx` — single track row. Branches by `track.type`:
  - `"video"` → renders `<ClipStrip>` with thumbnail filmstrip via `useFrameExtractor`
  - `"audio"` → renders `<ClipStrip>` with waveform bars via `useWaveform`
  - `"subtitle"` → renders `<ClipStrip>` with text labels
  - unknown → renders `<ClipStrip>` with solid color
- `ClipStrip.tsx` — shared absolute-positioned clip rectangle. Takes `clip`, `pixelsPerSecond`, `scrollLeft`, children (the per-type inner content). Handles click → `selection:set` dispatch.
- `TrackLabel.tsx` — 24-px left sidebar label (track name + type icon).
- `hooks/useTimelineZoom.ts` — local React state for `{ pixelsPerSecond, scrollLeft }`, `useRef` for the container, `ResizeObserver` for viewport width, `useEffect` attaching a native passive:false wheel listener for ctrl/meta-wheel zoom. Mirrors legacy's API: `{ pixelsPerSecond, scrollLeft, totalWidth, viewportWidth, timeToX, xToTime, zoomIn, zoomOut, setZoom, scrollTo }`. The critical difference from legacy: persists to **local state** (`useState`) not to a reducer. No craft store involvement.
- `hooks/useFrameExtractor.ts` — ported verbatim from `modes/clipcraft-legacy/viewer/timeline/hooks/useFrameExtractor.ts`. Hidden `<video>` + `<canvas>`, async seek loop, `toDataURL("image/jpeg", 0.6)` per tick. Keyed on `videoUrl`.
- `hooks/useWaveform.ts` — ported verbatim from legacy. `fetch → decodeAudioData → per-bar peak`, in-hook `Map` cache keyed by `url:bars[:maxDuration]`.

### Modified files

- `modes/clipcraft/viewer/PreviewPanel.tsx` — replace the current `<StateDump>` debug pane with `<Timeline>` below the `<PreviewCanvas>` + `<PlaybackControls>`. `StateDump` moves to a collapsible `<details>` below the timeline (debug-only).
- `modes/clipcraft/viewer/ClipCraftPreview.tsx` — **unchanged**. The Source<T> + providerKey + hydration wiring from Plan 3d/4 stays exactly as-is.

### New tests under `modes/clipcraft/__tests__/`

- Extend `modes/clipcraft/__tests__/preview-components.test.ts` with import-smoke tests for each new component and hook. Project has no DOM test infra (see Plan 4 Task 2 for the rationale); verification is tsc + Task 6 browser smoke test.

Not touching:
- `modes/clipcraft/persistence.ts` — stable.
- `modes/clipcraft/manifest.ts` — stable.
- `modes/clipcraft/assetResolver.ts` — stable.
- Anything in `modes/clipcraft-legacy/` — frozen.
- Upstream `@pneuma-craft/*` — read-only.

---

## Task 1: Port useTimelineZoom + TimeRuler + Playhead

**Files:**
- Create: `modes/clipcraft/viewer/timeline/hooks/useTimelineZoom.ts`
- Create: `modes/clipcraft/viewer/timeline/TimeRuler.tsx`
- Create: `modes/clipcraft/viewer/timeline/Playhead.tsx`
- Test: `modes/clipcraft/__tests__/preview-components.test.ts` (append import-smoke tests)

**Why these three first:** they're the only parts of the timeline with no craft-store coupling. `useTimelineZoom` is pure local state + DOM measurement. `TimeRuler` is pure math + SVG. `Playhead` takes `currentTime` + `duration` + `onSeek` as props. Getting them in isolation means Task 2's `Timeline.tsx` can just compose them against the craft store selectors.

- [ ] **Step 1: Copy useTimelineZoom from legacy**

Copy `modes/clipcraft-legacy/viewer/timeline/hooks/useTimelineZoom.ts` to `modes/clipcraft/viewer/timeline/hooks/useTimelineZoom.ts`. Then modify:

- Remove the `useClipCraftState()` / `dispatch` imports entirely — no reducer.
- Replace the reducer-backed zoom state with two `useState` hooks:
  ```ts
  const [pixelsPerSecond, setPixelsPerSecond] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  ```
- Remove any `SET_TIMELINE_ZOOM` dispatch calls.
- Signature: `useTimelineZoom(duration: number, containerRef: RefObject<HTMLElement>)` → returns `{ pixelsPerSecond, scrollLeft, totalWidth, viewportWidth, timeToX, xToTime, zoomIn, zoomOut, setZoom, scrollTo }`.
- Keep the `ZOOM_STEP = 1.3`, `[5, 300]` pps clamp, dynamic min-pps (half of `viewportWidth / duration`), ResizeObserver auto-fit on first render (when `pps === 0`), ctrl/meta+wheel zoom around viewport center, plain wheel scroll (deltaX + deltaY).
- File header comment: reference the legacy source file and explain the reducer → local state port.

- [ ] **Step 2: Write import-smoke test**

Append to `modes/clipcraft/__tests__/preview-components.test.ts`:

```ts
test("useTimelineZoom exports a function", async () => {
  const mod = await import("../viewer/timeline/hooks/useTimelineZoom.js");
  expect(typeof mod.useTimelineZoom).toBe("function");
});
```

- [ ] **Step 3: Run test**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
bun test modes/clipcraft/__tests__/preview-components.test.ts
```

Expected: PASS (new test plus existing).

- [ ] **Step 4: Copy TimeRuler from legacy**

Copy `modes/clipcraft-legacy/viewer/timeline/TimeRuler.tsx` to `modes/clipcraft/viewer/timeline/TimeRuler.tsx`. It should be copy-paste — no dependencies on the legacy reducer. If the copy has any imports from `../store/`, `../reducer`, etc., remove them and port to inline props. Props should be `{ duration, pixelsPerSecond, scrollLeft, viewportWidth }`.

- [ ] **Step 5: Add TimeRuler import-smoke test**

Append:

```ts
test("TimeRuler exports a function", async () => {
  const mod = await import("../viewer/timeline/TimeRuler.js");
  expect(typeof mod.TimeRuler).toBe("function");
});
```

Run tests. Expected: PASS.

- [ ] **Step 6: Copy Playhead from legacy**

Copy `modes/clipcraft-legacy/viewer/timeline/Playhead.tsx` to `modes/clipcraft/viewer/timeline/Playhead.tsx`. Remove any reducer imports. Change the props shape:

```ts
interface PlayheadProps {
  globalTime: number;          // from usePlayback().currentTime
  duration: number;            // from usePlayback().duration or composition.duration
  pixelsPerSecond: number;
  scrollLeft: number;
  trackAreaHeight: number;
  onSeek: (time: number) => void;   // wires to usePlayback().seek
}
```

The component itself should be unchanged from legacy apart from this prop shape shift — the drag handler calls `onSeek(clampedTime)` instead of `dispatch(SEEK)`.

- [ ] **Step 7: Add Playhead import-smoke test**

Append:

```ts
test("Playhead exports a function", async () => {
  const mod = await import("../viewer/timeline/Playhead.js");
  expect(typeof mod.Playhead).toBe("function");
});
```

Run tests. Expected: PASS.

- [ ] **Step 8: Run tsc**

```bash
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Expected: empty.

- [ ] **Step 9: Commit**

```bash
git add modes/clipcraft/viewer/timeline/hooks/useTimelineZoom.ts \
        modes/clipcraft/viewer/timeline/TimeRuler.tsx \
        modes/clipcraft/viewer/timeline/Playhead.tsx \
        modes/clipcraft/__tests__/preview-components.test.ts
git commit -m "feat(clipcraft): port TimelineZoom + TimeRuler + Playhead from legacy

Plan 5 Task 1 — ruler, playhead, and zoom/scroll state hook are all
standalone (no craft store dependency), so they port verbatim from
clipcraft-legacy with reducer dispatches replaced by callbacks.
useTimelineZoom keeps local state instead of persisting to a reducer;
zoom/scroll are UI-only and don't survive page reload, which matches
every other editor on the runtime."
```

---

## Task 2: Port useFrameExtractor + useWaveform

**Files:**
- Create: `modes/clipcraft/viewer/timeline/hooks/useFrameExtractor.ts`
- Create: `modes/clipcraft/viewer/timeline/hooks/useWaveform.ts`
- Test: append import-smoke tests

These two hooks are pure — they fetch a URL and produce data. No store coupling. Copy verbatim.

- [ ] **Step 1: Copy useFrameExtractor from legacy**

Copy `modes/clipcraft-legacy/viewer/timeline/hooks/useFrameExtractor.ts` to `modes/clipcraft/viewer/timeline/hooks/useFrameExtractor.ts`. Remove any imports from the legacy store or reducer. The hook signature should stay `useFrameExtractor(videoUrl: string, frameInterval: number, clipDuration: number)` → returns `{ frames: string[], loading: boolean }`.

If legacy had a reducer-backed cache, replace with the hook-local `Map` cache shown in the legacy file's module scope.

- [ ] **Step 2: Copy useWaveform from legacy**

Copy `modes/clipcraft-legacy/viewer/timeline/hooks/useWaveform.ts` verbatim. Its API: `useWaveform(audioUrl: string, bars: number, maxDuration?: number)` → returns `{ peaks: number[], loading: boolean }`.

- [ ] **Step 3: Append import-smoke tests**

```ts
test("useFrameExtractor exports a function", async () => {
  const mod = await import("../viewer/timeline/hooks/useFrameExtractor.js");
  expect(typeof mod.useFrameExtractor).toBe("function");
});

test("useWaveform exports a function", async () => {
  const mod = await import("../viewer/timeline/hooks/useWaveform.js");
  expect(typeof mod.useWaveform).toBe("function");
});
```

- [ ] **Step 4: Test + tsc**

```bash
bun test modes/clipcraft/__tests__/preview-components.test.ts
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Both expected clean.

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/viewer/timeline/hooks/useFrameExtractor.ts \
        modes/clipcraft/viewer/timeline/hooks/useWaveform.ts \
        modes/clipcraft/__tests__/preview-components.test.ts
git commit -m "feat(clipcraft): port useFrameExtractor + useWaveform from legacy

Plan 5 Task 2 — both hooks are pure (fetch URL → produce data), no
store coupling, so they port verbatim. Frame cache + waveform cache
stay as in-hook module-scope Maps."
```

---

## Task 3: ClipStrip + TrackLabel

**Files:**
- Create: `modes/clipcraft/viewer/timeline/ClipStrip.tsx`
- Create: `modes/clipcraft/viewer/timeline/TrackLabel.tsx`
- Test: import-smoke tests

`ClipStrip` is the shared absolute-positioned rectangle every track type uses. `TrackLabel` is the 24-px-wide left sidebar label.

- [ ] **Step 1: Write TrackLabel.tsx**

```tsx
// modes/clipcraft/viewer/timeline/TrackLabel.tsx
import type { Track } from "@pneuma-craft/timeline";

export const TRACK_LABEL_WIDTH = 96;

export interface TrackLabelProps {
  track: Track;
}

export function TrackLabel({ track }: TrackLabelProps) {
  const icon = iconFor(track.type);
  return (
    <div
      className="cc-track-label"
      style={{
        width: TRACK_LABEL_WIDTH,
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        fontSize: 11,
        color: "#d4d4d8",
        background: "#18181b",
        borderRight: "1px solid #27272a",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span aria-hidden style={{ opacity: 0.6 }}>{icon}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {track.name || track.type}
      </span>
    </div>
  );
}

function iconFor(type: Track["type"]): string {
  switch (type) {
    case "video": return "V";
    case "audio": return "A";
    case "subtitle": return "T";
    default: return "?";
  }
}
```

- [ ] **Step 2: Write ClipStrip.tsx**

```tsx
// modes/clipcraft/viewer/timeline/ClipStrip.tsx
import type { ReactNode } from "react";
import type { Clip } from "@pneuma-craft/timeline";

export interface ClipStripProps {
  clip: Clip;
  pixelsPerSecond: number;
  scrollLeft: number;
  trackHeight: number;
  selected: boolean;
  onSelect: (clipId: string) => void;
  children?: ReactNode;
}

/**
 * Absolute-positioned clip rectangle. Handles click-to-select; the
 * visual inner content (thumbnails, waveform, text) is passed as
 * children so each track type can render its own representation
 * without ClipStrip knowing about it.
 */
export function ClipStrip({
  clip,
  pixelsPerSecond,
  scrollLeft,
  trackHeight,
  selected,
  onSelect,
  children,
}: ClipStripProps) {
  const x = clip.startTime * pixelsPerSecond - scrollLeft;
  const width = clip.duration * pixelsPerSecond;
  // Off-screen culling — don't render clips that are completely outside
  // the viewport. Matches legacy VideoTrack's x + width < -10 || x > 2000
  // heuristic; 2000 is an over-estimate for "reasonable viewport width".
  if (x + width < -10 || x > 4000) return null;

  return (
    <div
      className="cc-clip-strip"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(clip.id);
      }}
      style={{
        position: "absolute",
        left: x,
        top: 0,
        width,
        height: trackHeight,
        background: selected ? "#fb923c22" : "#27272a",
        border: selected ? "1px solid #f97316" : "1px solid #3f3f46",
        borderRadius: 3,
        overflow: "hidden",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Append import-smoke tests**

```ts
test("TrackLabel exports a function", async () => {
  const mod = await import("../viewer/timeline/TrackLabel.js");
  expect(typeof mod.TrackLabel).toBe("function");
});

test("ClipStrip exports a function", async () => {
  const mod = await import("../viewer/timeline/ClipStrip.js");
  expect(typeof mod.ClipStrip).toBe("function");
});
```

- [ ] **Step 4: Test + tsc**

```bash
bun test modes/clipcraft/__tests__/preview-components.test.ts
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Both expected clean.

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/viewer/timeline/ClipStrip.tsx \
        modes/clipcraft/viewer/timeline/TrackLabel.tsx \
        modes/clipcraft/__tests__/preview-components.test.ts
git commit -m "feat(clipcraft): ClipStrip + TrackLabel primitives

Plan 5 Task 3 — ClipStrip is the absolute-positioned clip rectangle
every track type wraps around its per-type inner content (thumbnails,
waveform, text labels). TrackLabel is the 24-96px left sidebar label.
Neither couples to the craft store — they take craft types (Track,
Clip) as props and dispatch clicks via callback."
```

---

## Task 4: TrackRow branching + useAsset resolution

**Files:**
- Create: `modes/clipcraft/viewer/timeline/TrackRow.tsx`
- Test: import-smoke

`TrackRow` walks a track's clips, resolves each clip's asset via `useAsset(clip.assetId)`, and picks the right inner-content renderer based on the track type. This is where craft selector integration lives.

- [ ] **Step 1: Write TrackRow.tsx**

```tsx
// modes/clipcraft/viewer/timeline/TrackRow.tsx
import type { CSSProperties } from "react";
import { useAsset, useSelection } from "@pneuma-craft/react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import { ClipStrip } from "./ClipStrip.js";
import { TrackLabel } from "./TrackLabel.js";
import { useFrameExtractor } from "./hooks/useFrameExtractor.js";
import { useWaveform } from "./hooks/useWaveform.js";

export interface TrackRowProps {
  track: Track;
  pixelsPerSecond: number;
  scrollLeft: number;
  trackHeight: number;
  totalWidth: number;
  onSelectClip: (clipId: string) => void;
}

const WORKSPACE_CONTENT_BASE = "/content";

function contentUrlFor(uri: string): string {
  if (!uri) return "";
  return `${WORKSPACE_CONTENT_BASE}/${uri}`;
}

export function TrackRow({
  track,
  pixelsPerSecond,
  scrollLeft,
  trackHeight,
  totalWidth,
  onSelectClip,
}: TrackRowProps) {
  const selection = useSelection();
  const selectedClipIds = new Set(
    selection.type === "clip" ? selection.ids : [],
  );

  const rowStyle: CSSProperties = {
    display: "flex",
    height: trackHeight,
    borderBottom: "1px solid #27272a",
  };

  const trackAreaStyle: CSSProperties = {
    position: "relative",
    flex: 1,
    height: "100%",
    overflow: "hidden",
  };

  return (
    <div className="cc-track-row" style={rowStyle}>
      <TrackLabel track={track} />
      <div className="cc-track-area" style={trackAreaStyle}>
        {/* Fixed-width inner sizer so scrollLeft is meaningful relative
            to the full composition duration, not the viewport. */}
        <div style={{ position: "absolute", left: 0, top: 0, width: totalWidth, height: "100%" }}>
          {track.clips.map((clip) => (
            <ClipStrip
              key={clip.id}
              clip={clip}
              pixelsPerSecond={pixelsPerSecond}
              scrollLeft={scrollLeft}
              trackHeight={trackHeight}
              selected={selectedClipIds.has(clip.id)}
              onSelect={onSelectClip}
            >
              <ClipInner track={track} clip={clip} />
            </ClipStrip>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClipInner({ track, clip }: { track: Track; clip: Clip }) {
  const asset = useAsset(clip.assetId);
  if (!asset) {
    return <PlaceholderInner reason="missing asset" />;
  }
  if (asset.status === "pending" || asset.status === "generating") {
    return <PlaceholderInner reason={asset.status} />;
  }
  if (asset.status === "failed") {
    return <PlaceholderInner reason="failed" />;
  }

  if (track.type === "video") {
    return <VideoInner uri={asset.uri} clip={clip} />;
  }
  if (track.type === "audio") {
    return <AudioInner uri={asset.uri} clip={clip} />;
  }
  if (track.type === "subtitle") {
    return <SubtitleInner clip={clip} />;
  }
  return <PlaceholderInner reason={`unknown track type: ${track.type}`} />;
}

function VideoInner({ uri, clip }: { uri: string; clip: Clip }) {
  const { frames } = useFrameExtractor(
    contentUrlFor(uri),
    frameIntervalFor(clip.duration),
    clip.duration,
  );
  return (
    <div
      className="cc-video-inner"
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        background: "#0a0a0a",
      }}
    >
      {frames.length === 0 ? (
        <div style={{ ...placeholderTextStyle, width: "100%" }}>decoding…</div>
      ) : (
        frames.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            style={{
              height: "100%",
              width: `${100 / frames.length}%`,
              objectFit: "cover",
              pointerEvents: "none",
            }}
          />
        ))
      )}
    </div>
  );
}

function frameIntervalFor(clipDurationSec: number): number {
  if (clipDurationSec <= 4) return 0.5;
  if (clipDurationSec <= 15) return 1;
  return 2;
}

function AudioInner({ uri, clip }: { uri: string; clip: Clip }) {
  const bars = 64; // fine-grained enough for a 96px-wide clip
  const { peaks } = useWaveform(contentUrlFor(uri), bars, clip.duration);
  return (
    <div
      className="cc-audio-inner"
      style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        padding: "4px 2px",
        gap: 1,
      }}
    >
      {peaks.length === 0 ? (
        <div style={{ ...placeholderTextStyle, width: "100%" }}>decoding…</div>
      ) : (
        peaks.map((p, i) => (
          <div
            key={i}
            style={{
              width: `${100 / bars}%`,
              height: `${Math.max(4, p * 100)}%`,
              background: "#f97316",
              borderRadius: 1,
            }}
          />
        ))
      )}
    </div>
  );
}

function SubtitleInner({ clip }: { clip: Clip }) {
  return (
    <div
      className="cc-subtitle-inner"
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        padding: "0 6px",
        color: "#e4e4e7",
        fontSize: 11,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {clip.text || <em style={{ opacity: 0.5 }}>subtitle</em>}
    </div>
  );
}

function PlaceholderInner({ reason }: { reason: string }) {
  return <div style={{ ...placeholderTextStyle, width: "100%" }}>{reason}</div>;
}

const placeholderTextStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "#71717a",
  fontSize: 10,
  fontFamily: "system-ui, sans-serif",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
```

- [ ] **Step 2: Append import-smoke test**

```ts
test("TrackRow exports a function", async () => {
  const mod = await import("../viewer/timeline/TrackRow.js");
  expect(typeof mod.TrackRow).toBe("function");
});
```

- [ ] **Step 3: Test + tsc**

```bash
bun test modes/clipcraft/__tests__/preview-components.test.ts
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Both expected clean.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/timeline/TrackRow.tsx \
        modes/clipcraft/__tests__/preview-components.test.ts
git commit -m "feat(clipcraft): TrackRow with per-type clip renderers

Plan 5 Task 4 — TrackRow walks a track's clips, resolves each clip's
asset via useAsset(), and branches by track.type to render filmstrip
thumbnails (video), waveform bars (audio), or text (subtitle). Also
consumes useSelection() to highlight selected clips. Asset status
(pending/generating/failed) takes over the inner content with a
placeholder."
```

---

## Task 5: Timeline.tsx — the root composition

**Files:**
- Create: `modes/clipcraft/viewer/timeline/Timeline.tsx`
- Test: import-smoke

`Timeline` is where everything comes together. It reads the craft selectors, owns the zoom hook, renders the ruler + every track row + the playhead overlay, and wires click-to-seek and click-to-select into the craft store.

- [ ] **Step 1: Write Timeline.tsx**

```tsx
// modes/clipcraft/viewer/timeline/Timeline.tsx
import { useCallback, useRef } from "react";
import { useComposition, usePlayback, useDispatch } from "@pneuma-craft/react";
import type { Actor } from "@pneuma-craft/core";
import { TimeRuler } from "./TimeRuler.js";
import { Playhead } from "./Playhead.js";
import { TrackRow } from "./TrackRow.js";
import { TRACK_LABEL_WIDTH } from "./TrackLabel.js";
import { useTimelineZoom } from "./hooks/useTimelineZoom.js";

const TRACK_HEIGHT = 48;
const RULER_HEIGHT = 20;
const USER_ACTOR: Actor = "human";

export function Timeline() {
  const composition = useComposition();
  const { currentTime, duration, seek } = usePlayback();
  const dispatch = useDispatch();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const effectiveDuration = duration || composition?.duration || 0;
  const {
    pixelsPerSecond,
    scrollLeft,
    totalWidth,
    viewportWidth,
    xToTime,
    zoomIn,
    zoomOut,
  } = useTimelineZoom(effectiveDuration, containerRef);

  const onSelectClip = useCallback(
    (clipId: string) => {
      dispatch(USER_ACTOR, {
        type: "selection:set",
        selection: { type: "clip", ids: [clipId] },
      });
    },
    [dispatch],
  );

  const handleRulerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const xInTrack = e.clientX - rect.left;
      const t = xToTime(xInTrack);
      seek(Math.max(0, Math.min(t, effectiveDuration)));
    },
    [xToTime, seek, effectiveDuration],
  );

  if (!composition) {
    return (
      <div
        data-testid="timeline-empty"
        style={{
          padding: 12,
          color: "#71717a",
          fontSize: 12,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        no composition loaded
      </div>
    );
  }

  const trackCount = composition.tracks.length;
  const trackAreaHeight = trackCount * TRACK_HEIGHT;

  return (
    <div
      ref={containerRef}
      className="cc-timeline"
      style={{
        position: "relative",
        background: "#0a0a0a",
        color: "#e4e4e7",
        fontFamily: "system-ui, sans-serif",
        border: "1px solid #27272a",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      {/* zoom toolbar */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "6px 8px",
          borderBottom: "1px solid #27272a",
          fontSize: 11,
        }}
      >
        <button
          type="button"
          onClick={zoomOut}
          aria-label="zoom out"
          style={zoomBtnStyle}
        >−</button>
        <span style={{ minWidth: 80, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {pixelsPerSecond.toFixed(0)} px/s
        </span>
        <button
          type="button"
          onClick={zoomIn}
          aria-label="zoom in"
          style={zoomBtnStyle}
        >+</button>
      </div>

      {/* ruler row */}
      <div
        style={{ display: "flex", height: RULER_HEIGHT, borderBottom: "1px solid #27272a" }}
      >
        <div style={{ width: TRACK_LABEL_WIDTH }} />
        <div
          onClick={handleRulerClick}
          style={{ position: "relative", flex: 1, overflow: "hidden", cursor: "pointer" }}
        >
          <div style={{ position: "absolute", left: -scrollLeft, top: 0, width: totalWidth, height: "100%" }}>
            <TimeRuler
              duration={effectiveDuration}
              pixelsPerSecond={pixelsPerSecond}
              scrollLeft={scrollLeft}
              viewportWidth={viewportWidth}
            />
          </div>
        </div>
      </div>

      {/* track rows */}
      <div style={{ position: "relative", height: trackAreaHeight }}>
        {composition.tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            trackHeight={TRACK_HEIGHT}
            totalWidth={totalWidth}
            onSelectClip={onSelectClip}
          />
        ))}

        {/* playhead overlay spans every track row but NOT the sidebar */}
        <div
          style={{
            position: "absolute",
            left: TRACK_LABEL_WIDTH,
            right: 0,
            top: 0,
            bottom: 0,
            pointerEvents: "none",
          }}
        >
          <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>
            <Playhead
              globalTime={currentTime}
              duration={effectiveDuration}
              pixelsPerSecond={pixelsPerSecond}
              scrollLeft={scrollLeft}
              trackAreaHeight={trackAreaHeight}
              onSeek={seek}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  background: "#27272a",
  color: "#fafafa",
  border: "1px solid #3f3f46",
  borderRadius: 3,
  cursor: "pointer",
};
```

- [ ] **Step 2: Import-smoke test**

```ts
test("Timeline exports a function", async () => {
  const mod = await import("../viewer/timeline/Timeline.js");
  expect(typeof mod.Timeline).toBe("function");
});
```

- [ ] **Step 3: Test + tsc**

```bash
bun test modes/clipcraft/__tests__/preview-components.test.ts
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Both clean.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/timeline/Timeline.tsx \
        modes/clipcraft/__tests__/preview-components.test.ts
git commit -m "feat(clipcraft): Timeline root composes ruler + rows + playhead

Plan 5 Task 5 — Timeline reads useComposition/usePlayback/useDispatch,
owns useTimelineZoom for local UI state, renders a zoom toolbar + ruler
row + per-track rows + a playhead overlay. Click on ruler → seek. Click
on clip → dispatch selection:set with type \"clip\". Empty state (no
composition) renders a placeholder."
```

---

## Task 6: Wire into PreviewPanel + browser smoke test

**Files:**
- Modify: `modes/clipcraft/viewer/PreviewPanel.tsx`
- Modify: `modes/clipcraft/ARCHITECTURE.md`
- Modify: `docs/superpowers/plans/NEXT.md`

- [ ] **Step 1: Modify PreviewPanel.tsx**

Find the current shape:
```tsx
<PreviewCanvas />
<PlaybackControls />
<StateDump hydrationError={hydrationError} />
```

Replace with:
```tsx
<PreviewCanvas />
<PlaybackControls />
<Timeline />
<details>
  <summary style={{ cursor: "pointer", color: "#a1a1aa", fontSize: 11, padding: "6px 0" }}>
    debug · StateDump
  </summary>
  <StateDump hydrationError={hydrationError} />
</details>
```

Add the `Timeline` import.

- [ ] **Step 2: Run full clipcraft test suite**

```bash
bun test modes/clipcraft 2>&1 | tail -10
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Both clean.

- [ ] **Step 3: Browser smoke test**

With the existing dev server (`/tmp/ccp4-show-*` workspace, Cliper.mp4), navigate the browser to the current session URL. Verify via `chrome-devtools-mcp`:

1. Timeline mounts below `<PlaybackControls>`.
2. Time ruler shows tick marks from 0 to ~10s at whatever `pps` the ResizeObserver picked.
3. One track row (`"Main"` / `track-video-1`) with a filmstrip of Cliper.mp4 thumbnails spanning [0, 10)s. Thumbnails appear after a ~1-2s decode delay.
4. Playhead starts at 0. Click anywhere on the ruler → playhead jumps and preview canvas shows the corresponding frame (wires `usePlayback().seek()` through to the engine).
5. Click on the clip → clip gets a selection outline (orange border), StateDump shows `selection: { type: "clip", ids: ["clip-1"] }`.
6. Press Play → playhead advances smoothly 0 → 10 at 1× rate, thumbnails stay visible, canvas keeps rendering.
7. Ctrl+scroll on the timeline → zoom changes, ruler tick density updates, clip width changes, playhead stays anchored to `currentTime`.
8. Open the Editor tab, change `composition.tracks[0].clips[0].duration` from 10 to 5, Cmd+S. Verify:
   - Timeline duration changes to 5s
   - Thumbnails re-decode for the new length (or if cached, just re-render)
   - Playhead respects the new clamp
   - (This also validates the Plan 5 pre-task `origin=external` fix is working for real multi-source user edits.)

If any step fails, STOP and report. Common failure modes:
- `useFrameExtractor` may hang on non-keyframe-aligned seeks — legacy's seek loop has a 30ms settle delay; if ported accurately it should be fine.
- `useWaveform` only fires for audio tracks; with a video-only seed, no waveform should appear (good).
- Ctrl+scroll might conflict with the browser's page zoom — verify the native passive:false listener is attached to the timeline container, not window.

- [ ] **Step 4: Update ARCHITECTURE.md**

Add a "Timeline (Plan 5)" subsection under the existing "Playback (Plan 4)" section. Describe:
- Timeline is mode-owned; zoom and scroll are local React state, not persisted
- Reads composition / currentTime / selection from craft store selectors
- Click-to-seek dispatches `seek()` from `usePlayback()`
- Click-on-clip dispatches `selection:set` with `type: "clip"` via `useDispatch()`
- Frame extractor and waveform decoder are mode-local with in-memory caches
- Ripple/snap/drag-to-move are NOT implemented — deferred to Plan 5.5 / 6
- Cross-reference the legacy components that were ported

Update the 6-direction protocol table: row ① (User → Viewer: Interaction) now includes "click-to-seek, click-to-select-clip, zoom".

- [ ] **Step 5: Update NEXT.md**

Move Plan 5 from "Upcoming" to "Completed" with a description matching what shipped. Add a new "Known limitations" entry:
- Clip-level drag/resize/split is not wired. Clicking selects but the Plan 5 timeline is read-only for composition shape. Plan 5.5 (or Plan 6 rolled together) will port the `react-ui/src/timeline/timeline-track.tsx` ripple+snap drag engine into ClipCraft.

- [ ] **Step 6: Final verification + commit**

```bash
bun test 2>&1 | tail -5
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Both clean.

```bash
git add modes/clipcraft/viewer/PreviewPanel.tsx \
        modes/clipcraft/ARCHITECTURE.md \
        docs/superpowers/plans/NEXT.md
git commit -m "feat(clipcraft): wire Timeline into PreviewPanel + docs

Plan 5 step 6 — PreviewPanel lays out PreviewCanvas / PlaybackControls
/ Timeline / StateDump (collapsed). ARCHITECTURE.md gains a Timeline
subsection under Playback; NEXT.md moves Plan 5 to Completed with a
known-limitation entry for deferred clip manipulation.

Closes Plan 5 (read-only timeline). Plan 5.5 or Plan 6 will add clip
drag/resize/split by porting the ripple+snap algorithm from
@pneuma-craft/react-ui/src/timeline/timeline-track.tsx — NOT by
consuming react-ui as a dep."
```

---

## Done When

- [ ] All 6 task commits land on `feat/clipcraft-by-pneuma-craft`.
- [ ] `bun test` green for `modes/clipcraft/`.
- [ ] `bun run tsc --noEmit` clean for `modes/clipcraft/`.
- [ ] Browser smoke test passes: ruler + filmstrip + playhead render, click-to-seek works, click-on-clip highlights, zoom works, external editor save refreshes timeline.
- [ ] ARCHITECTURE.md + NEXT.md updated.

## Out of scope (deferred)

- **Clip drag-to-move / resize / split** — Plan 5.5 or Plan 6. Copy ripple+snap from `@pneuma-craft/react-ui` verbatim; do not import react-ui as a dep.
- **Asset library panel + drag onto timeline** — Plan 6+.
- **TimelineOverview3D** — Plan 6.
- **DiveCanvas** — Plan 7.
- **Audio scheduler + separate audio UI** — Plan 9+ when there's actual audio content.
- **Virtualized rendering for >100 clips** — add when user content makes it matter.

## Risks / unknowns

1. **`useFrameExtractor` on non-keyframe-aligned seeks.** Legacy's loop has a 30ms settle delay. If the H.264 decoder returns a blank frame for the first seek request, the loop retries. Should work out of the box on our all-keyframe seed; Cliper.mp4 with normal GOP should also work because the user just uses it for whole-clip playback, not fine-grained seeks. If frames come out wrong, add a keyframe-align pre-roll to `useFrameExtractor`.
2. **Native wheel listener vs React synthetic event.** Ctrl+wheel zoom MUST use a native `addEventListener("wheel", handler, { passive: false })` because React's synthetic wheel event is always passive (can't preventDefault to stop browser zoom). Legacy's hook already does this; make sure the port preserves it.
3. **`scrollLeft` vs CSS transform.** Legacy uses `scrollLeft` via direct style on an inner container (not the browser scroll position). This is important because it avoids the browser's scrollbar UI and keeps the ruler + tracks in lock-step. The port must preserve this pattern — do NOT switch to `overflow-x: auto`.
4. **Selection state may go stale if the user deletes a selected clip via Editor tab.** The `selection:set` command records an id, and if the next hydration doesn't have that id, `useAsset`/`useClip` return undefined and TrackRow shows no highlight — which is fine, but Plan 5.5's drag work may need to explicitly clear dangling selections on every hydration.
5. **Zoom state is ephemeral.** Page reload or provider remount resets zoom to the auto-fit value. This is intentional (matches every other editor on the runtime), but document it in ARCHITECTURE.md so users don't mistake it for a bug.
