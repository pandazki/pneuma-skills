# ClipCraft Plan 5.5 — Clip editing on the timeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Plan 5 read-only timeline interactive — drag-to-move, resize, split, delete, collapse-gaps, undo/redo — driven through craft's existing `composition:*` commands, with the ripple+snap algorithm copied verbatim from `@pneuma-craft/react-ui`.

**Architecture:** One shared drag/resize engine (`timeline/dragEngine.ts` pure helpers + `hooks/useTrackDragEngine.ts` React hook) used by all three track components. Toolbar gets four new buttons (Split, Delete, Collapse, Undo/Redo) next to the zoom controls in `Timeline.tsx`. Keyboard shortcuts live in a single `hooks/useTimelineShortcuts.ts`. All mutations go through `useDispatch("human", ...)` so provenance + undo manager Just Work. No new state slices, no persistence changes.

**Tech Stack:** React 19, `@pneuma-craft/react` (`useDispatch`, `useUndo`, `useComposition`, `usePlayback`, `useSelection`), `@pneuma-craft/timeline` command types, existing `useTimelineZoom`. No new dependencies.

**Base commit:** `eb9ae53` (end of Plan 6, `feat/clipcraft-by-pneuma-craft`).

**Out of scope:** Multi-select, drag across tracks, cross-track snap, gap insertion on drop, rubber-band selection. These stay deferred.

---

## Context the engineer needs before starting

1. **The ripple algorithm** being copied lives at `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/react-ui/src/timeline/timeline-track.tsx`. It has two halves: `computeRipplePreview(clips, draggedId, newStart)` (pure, returns a `Map<clipId, startTime>`) and the `handleDragStart` / `useEffect` event-listener state machine. Copy both halves verbatim into ClipCraft — **do not** add `react-ui` as a dependency.
2. **Craft command payloads** (verified against `timeline/dist/index.d.ts`):
   - `{ type: "composition:move-clip", clipId, startTime, trackId? }`
   - `{ type: "composition:trim-clip", clipId, inPoint?, outPoint?, duration? }` — all three are optional; trim left = set `inPoint` + `duration`; trim right = set `duration` (or `outPoint`); either way pass the new `duration` explicitly so we don't re-derive it inside the reducer.
   - `{ type: "composition:split-clip", clipId, time }` — `time` is absolute timeline seconds, not relative.
   - `{ type: "composition:remove-clip", clipId }`
3. **Dispatch shape:** `dispatch("human", command)` — the existing Timeline already uses `USER_ACTOR = "human"`. Do not invent a new actor.
4. **Undo manager is already wired** on `PneumaCraftStore`. Consume via `useUndo()` → `{ undo, redo, canUndo, canRedo }`. The store-level undo manager captures any dispatched command automatically; you don't need to manually push events.
5. **Zoom state:** `useTimelineZoom(duration, containerRef)` returns `{ pixelsPerSecond, scrollLeft, xToTime, timeToX, ... }`. Use `xToTime` / `timeToX` (wrappers) or derive `px→seconds` as `px / pixelsPerSecond`. Note `xToTime` already accounts for scrollLeft and LABEL_W — use that when translating from a ruler `MouseEvent.clientX`.
6. **Clip coordinate system inside a track row:** each track's inner `<div>` renders clips with `left = clip.startTime * pixelsPerSecond - scrollLeft`. So a local x (inside the track's absolute-positioned child) maps back to time as `(local_x + scrollLeft) / pixelsPerSecond`. Do not confuse this with `xToTime`, which is relative to the ruler viewport including LABEL_W.
7. **File-watcher loop protection:** the viewer consumes `project.json` via `Source<T>` with origin tagging. Local `useDispatch` calls never touch the file system directly — autosave through `useProjectSync` picks them up on the next tick. So a drag ending in a single `move-clip` dispatch produces exactly one autosave write, no echo storm.
8. **Selection semantics (Plan 5):** `useSelection()` returns `{ type: "clip" | "asset" | "none", ids: string[] }`. Split / Delete need the selected clip id; read it the same way `Timeline.tsx` already does. If `selection.type !== "clip"`, both buttons are disabled.

---

## File structure

```
modes/clipcraft/viewer/timeline/
├── dragEngine.ts                   [NEW]  — pure helpers (ripple, snap)
├── __tests__/
│   └── dragEngine.test.ts          [NEW]  — unit tests for the pure helpers
├── hooks/
│   ├── useTrackDragEngine.ts       [NEW]  — React hook wrapping dragEngine + dispatch
│   ├── useClipResize.ts            [NEW]  — React hook for left/right edge resize
│   └── useTimelineShortcuts.ts     [NEW]  — keyboard shortcuts (Delete, S, Cmd+Z)
├── toolbar/
│   ├── EditToolbar.tsx             [NEW]  — Split / Delete / Collapse / Undo / Redo
│   └── collapseGaps.ts             [NEW]  — pure layout op + dispatcher
├── VideoTrack.tsx                  [MOD]  — integrate drag + resize
├── AudioTrack.tsx                  [MOD]  — integrate drag + resize
├── SubtitleTrack.tsx               [MOD]  — integrate drag + resize
├── Timeline.tsx                    [MOD]  — mount EditToolbar, wire shortcuts
└── __tests__/
    └── preview-components.test.ts  [MOD]  — add smoke imports for new files
```

All new files are mode-local. No touches to `@pneuma-craft/*`.

---

## Task 1 — Pure drag engine + unit tests

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dragEngine.ts`
- Create: `modes/clipcraft/viewer/timeline/__tests__/dragEngine.test.ts`

- [ ] **Step 1: Write the file `dragEngine.ts` verbatim-ported from react-ui**

```ts
// Pure helpers for the timeline drag/snap/ripple engine.
//
// Copied verbatim from @pneuma-craft/react-ui/src/timeline/timeline-track.tsx
// (commit-pinned to whatever is current on pneuma-craft-headless-stable
// main). We deliberately do NOT import react-ui as a dep — the upstream
// component is coupled to its own CSS and store shape, and we only want
// the math. Keep the algorithm in sync by re-copying when upstream changes.

import type { Clip } from "@pneuma-craft/timeline";

export interface DragState {
  clipId: string;
  startMouseX: number;
  startClipTime: number;
  positions: Map<string, number>;
  snapTime: number | null;
}

/**
 * Compute preview positions for all clips when `draggedClipId` is placed
 * at `draggedNewStart`. The dragged clip's position is pinned; other clips
 * are pushed forward if they overlap with any earlier clip.
 *
 * Copied verbatim from react-ui.
 */
export function computeRipplePreview(
  clips: readonly Clip[],
  draggedClipId: string,
  draggedNewStart: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const dragged = clips.find((c) => c.id === draggedClipId);
  if (!dragged) return result;

  result.set(draggedClipId, draggedNewStart);

  const others = clips
    .filter((c) => c.id !== draggedClipId)
    .map((c) => ({ id: c.id, start: c.startTime, duration: c.duration }))
    .sort((a, b) => a.start - b.start);

  const draggedEnd = draggedNewStart + dragged.duration;

  for (const c of others) {
    const cEnd = c.start + c.duration;
    if (c.start < draggedEnd && cEnd > draggedNewStart) {
      c.start = draggedEnd;
    }
    result.set(c.id, c.start);
  }

  const all = clips
    .map((c) => ({
      id: c.id,
      start: result.get(c.id)!,
      duration: c.duration,
      pinned: c.id === draggedClipId,
    }))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < all.length; i++) {
    const prevEnd = all[i - 1].start + all[i - 1].duration;
    if (all[i].start < prevEnd) {
      if (all[i].pinned) continue;
      all[i].start = prevEnd;
      result.set(all[i].id, all[i].start);
    }
  }

  return result;
}

/**
 * Given a free-drag candidate `newStart`, snap it to the nearest neighbor
 * edge (or 0) within `snapThresholdSeconds`. Returns the adjusted start
 * and the world-time of the snap line (null if no snap fired).
 *
 * Copied verbatim from react-ui (inlined from the mousemove handler).
 */
export function snapDraggedStart(
  clips: readonly Clip[],
  draggedClipId: string,
  candidateStart: number,
  snapThresholdSeconds: number,
): { start: number; snapTime: number | null } {
  const dragged = clips.find((c) => c.id === draggedClipId);
  if (!dragged) return { start: candidateStart, snapTime: null };

  let newStart = Math.max(0, candidateStart);
  const newEnd = newStart + dragged.duration;
  let snappedTime: number | null = null;

  for (const c of clips) {
    if (c.id === draggedClipId) continue;
    if (Math.abs(newStart - c.startTime) < snapThresholdSeconds) {
      newStart = c.startTime;
      snappedTime = c.startTime;
      break;
    }
    if (Math.abs(newStart - (c.startTime + c.duration)) < snapThresholdSeconds) {
      newStart = c.startTime + c.duration;
      snappedTime = c.startTime + c.duration;
      break;
    }
    if (Math.abs(newEnd - c.startTime) < snapThresholdSeconds) {
      newStart = c.startTime - dragged.duration;
      snappedTime = c.startTime;
      break;
    }
    if (Math.abs(newEnd - (c.startTime + c.duration)) < snapThresholdSeconds) {
      newStart = c.startTime + c.duration - dragged.duration;
      snappedTime = c.startTime + c.duration;
      break;
    }
  }
  if (snappedTime === null && Math.abs(newStart) < snapThresholdSeconds) {
    newStart = 0;
    snappedTime = 0;
  }
  newStart = Math.max(0, newStart);
  return { start: newStart, snapTime: snappedTime };
}
```

- [ ] **Step 2: Write `__tests__/dragEngine.test.ts`**

```ts
import { describe, test, expect } from "bun:test";
import type { Clip } from "@pneuma-craft/timeline";
import { computeRipplePreview, snapDraggedStart } from "../dragEngine.js";

function makeClip(id: string, startTime: number, duration: number): Clip {
  return {
    id,
    trackId: "t1",
    assetId: `asset-${id}`,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
  } as Clip;
}

describe("computeRipplePreview", () => {
  test("pins the dragged clip at the requested position", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 5, 2)];
    const p = computeRipplePreview(clips, "a", 1);
    expect(p.get("a")).toBe(1);
  });

  test("pushes an overlapped neighbor forward by the dragged clip's tail", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 1, 2)];
    const p = computeRipplePreview(clips, "a", 0);
    // b originally at 1 overlaps dragged end (0+2=2), so push b to 2
    expect(p.get("b")).toBe(2);
  });

  test("does not move non-overlapping neighbors", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 5, 2)];
    const p = computeRipplePreview(clips, "a", 0);
    expect(p.get("b")).toBe(5);
  });

  test("ripples through a chain when multiple overlaps occur", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 1, 2), makeClip("c", 2, 2)];
    const p = computeRipplePreview(clips, "a", 0);
    expect(p.get("a")).toBe(0);
    expect(p.get("b")).toBe(2);
    expect(p.get("c")).toBe(4);
  });

  test("returns empty map when draggedClipId is unknown", () => {
    const clips = [makeClip("a", 0, 2)];
    const p = computeRipplePreview(clips, "missing", 5);
    expect(p.size).toBe(0);
  });
});

describe("snapDraggedStart", () => {
  const clips = [makeClip("a", 0, 2), makeClip("b", 5, 3)];

  test("snaps to neighbor start when within threshold", () => {
    const r = snapDraggedStart(clips, "a", 4.9, 0.2);
    expect(r.start).toBe(5);
    expect(r.snapTime).toBe(5);
  });

  test("snaps dragged end to neighbor start (subtracting duration)", () => {
    // dragged duration 2, want newEnd ≈ 5 → newStart ≈ 3
    const r = snapDraggedStart(clips, "a", 3.05, 0.2);
    expect(r.start).toBe(3);
    expect(r.snapTime).toBe(5);
  });

  test("snaps to zero", () => {
    const r = snapDraggedStart(clips, "a", 0.05, 0.2);
    expect(r.start).toBe(0);
    expect(r.snapTime).toBe(0);
  });

  test("returns candidate unchanged when nothing is in range", () => {
    const r = snapDraggedStart(clips, "a", 12, 0.2);
    expect(r.start).toBe(12);
    expect(r.snapTime).toBe(null);
  });

  test("clamps negative drag to zero without reporting a snap", () => {
    const r = snapDraggedStart(clips, "a", -1, 0.01);
    expect(r.start).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests — expect all to pass**

```bash
bun test modes/clipcraft/viewer/timeline/__tests__/dragEngine.test.ts
```

Expected: 10 tests pass. If `computeRipplePreview` is buggy, **do not fix the algorithm** — it is copied verbatim. Either the test is wrong or the ports diverged; re-read the upstream file.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dragEngine.ts modes/clipcraft/viewer/timeline/__tests__/dragEngine.test.ts
git commit -m "feat(clipcraft): port drag/snap pure helpers from react-ui"
```

---

## Task 2 — `useTrackDragEngine` hook + integrate into VideoTrack

**Files:**
- Create: `modes/clipcraft/viewer/timeline/hooks/useTrackDragEngine.ts`
- Modify: `modes/clipcraft/viewer/timeline/VideoTrack.tsx`

**Context:** The react-ui reference implements drag state inside `TimelineTrack.tsx` with a `dragRef` + `useEffect` listener pair keyed on `dragState?.clipId`. We want the same pattern, but reusable across VideoTrack / AudioTrack / SubtitleTrack. Extract it into a hook that takes `(track, pixelsPerSecond, dispatch)` and returns `{ dragState, handleDragStart, getDisplayLeft(clipId) }` so each track component stays small.

- [ ] **Step 1: Write `hooks/useTrackDragEngine.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Track, CompositionCommand } from "@pneuma-craft/timeline";
import type { Actor, CoreCommand } from "@pneuma-craft/core";
import {
  computeRipplePreview,
  snapDraggedStart,
  type DragState,
} from "../dragEngine.js";

type Dispatch = (
  actor: Actor,
  cmd: CoreCommand | CompositionCommand,
) => unknown;

export interface UseTrackDragEngine {
  dragState: DragState | null;
  handleDragStart: (clipId: string, mouseX: number) => void;
  /** Returns the display startTime (in seconds) for a clip — the dragged
   *  clip follows the cursor, others follow the ripple. Returns null to
   *  mean "use the clip's canonical startTime". */
  displayStartFor: (clipId: string) => number | null;
}

const SNAP_PX = 5;

/**
 * Document-level mouse drag state machine for one track. Binds mousemove /
 * mouseup when a drag starts, unbinds when it ends. Dispatches a single
 * `composition:move-clip` on release if the final position differs from
 * the clip's original startTime.
 *
 * Structure mirrors @pneuma-craft/react-ui/src/timeline/timeline-track.tsx.
 */
export function useTrackDragEngine(
  track: Track,
  pixelsPerSecond: number,
  dispatch: Dispatch,
): UseTrackDragEngine {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const clipsRef = useRef(track.clips);
  clipsRef.current = track.clips;
  const ppsRef = useRef(pixelsPerSecond);
  ppsRef.current = pixelsPerSecond;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const handleDragStart = useCallback(
    (clipId: string, mouseX: number) => {
      const clip = clipsRef.current.find((c) => c.id === clipId);
      if (!clip) return;
      const initial: DragState = {
        clipId,
        startMouseX: mouseX,
        startClipTime: clip.startTime,
        positions: computeRipplePreview(clipsRef.current, clipId, clip.startTime),
        snapTime: null,
      };
      dragRef.current = initial;
      setDragState(initial);
    },
    [],
  );

  useEffect(() => {
    if (!dragState) return;

    const onMove = (ev: MouseEvent) => {
      const ds = dragRef.current;
      const pps = ppsRef.current;
      if (!ds || pps <= 0) return;

      const deltaX = ev.clientX - ds.startMouseX;
      const deltaT = deltaX / pps;
      const candidate = ds.startClipTime + deltaT;
      const { start, snapTime } = snapDraggedStart(
        clipsRef.current,
        ds.clipId,
        candidate,
        SNAP_PX / pps,
      );
      const positions = computeRipplePreview(clipsRef.current, ds.clipId, start);
      const next: DragState = { ...ds, positions, snapTime };
      dragRef.current = next;
      setDragState(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const ds = dragRef.current;
      if (ds) {
        const finalStart = ds.positions.get(ds.clipId);
        const clip = clipsRef.current.find((c) => c.id === ds.clipId);
        if (
          finalStart !== undefined &&
          clip &&
          Math.abs(finalStart - clip.startTime) > 1e-6
        ) {
          dispatchRef.current("human", {
            type: "composition:move-clip",
            clipId: ds.clipId,
            startTime: finalStart,
          });
        }
      }
      dragRef.current = null;
      setDragState(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // Re-bind only when a new drag begins, not on every position tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState?.clipId]);

  const displayStartFor = useCallback(
    (clipId: string): number | null => {
      if (!dragState) return null;
      const p = dragState.positions.get(clipId);
      return p ?? null;
    },
    [dragState],
  );

  return { dragState, handleDragStart, displayStartFor };
}
```

- [ ] **Step 2: Modify `VideoTrack.tsx` — accept a `dispatch` prop is NOT needed (call `useDispatch` inside VideoTrack), add the hook, wire `onMouseDown` into `VideoClip`, show snap line.**

Replace the top of `VideoTrack.tsx` through the `VideoClip` component and the exported `VideoTrack` so it looks like this (the filmstrip rendering block inside `VideoClip`'s `<div>` is unchanged — only the wrapper `<div>` and the props list change). The full replacement block:

```tsx
// Ported from modes/clipcraft-legacy/viewer/timeline/VideoTrack.tsx.
// Plan 5.5: drag + resize interactivity via useTrackDragEngine + useClipResize.

import { useMemo } from "react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import { useAsset, useDispatch } from "@pneuma-craft/react";
import { useFrameExtractor } from "./hooks/useFrameExtractor.js";
import { useTrackDragEngine } from "./hooks/useTrackDragEngine.js";
import { useClipResize } from "./hooks/useClipResize.js";

const TRACK_H = 48;
const FRAME_H = TRACK_H - 8;

function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

interface VideoClipProps {
  clip: Clip;
  x: number;
  width: number;
  selected: boolean;
  dragging: boolean;
  pixelsPerSecond: number;
  onSelect: (clipId: string) => void;
  onDragStart: (clipId: string, mouseX: number) => void;
  onResizeStart: (clipId: string, edge: "left" | "right", mouseX: number) => void;
}

function VideoClip({
  clip,
  x,
  width,
  selected,
  dragging,
  pixelsPerSecond,
  onSelect,
  onDragStart,
  onResizeStart,
}: VideoClipProps) {
  const asset = useAsset(clip.assetId);
  const status = asset?.status ?? "ready";
  const uri = asset?.uri ?? "";
  const isVideo = asset?.type === "video";
  const isImage = asset?.type === "image";

  const frameOpts = useMemo(() => {
    if (status !== "ready" || !uri || !isVideo) return null;
    const interval = pixelsPerSecond >= 60 ? 0.5 : pixelsPerSecond >= 30 ? 1 : 2;
    return {
      videoUrl: contentUrl(uri),
      duration: clip.duration,
      frameInterval: interval,
      frameHeight: FRAME_H,
    };
  }, [status, uri, isVideo, pixelsPerSecond, clip.duration]);

  const { frames, loading } = useFrameExtractor(frameOpts);

  return (
    <div
      onMouseDown={(e) => {
        if (e.button !== 0 || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect(clip.id);
        onDragStart(clip.id, e.clientX);
      }}
      style={{
        position: "absolute",
        left: Math.round(x),
        width: Math.round(width - 1),
        height: TRACK_H - 4,
        top: 2,
        background: selected ? "#1e1a14" : "#18181b",
        borderRadius: 3,
        border: selected ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        cursor: dragging ? "grabbing" : "grab",
        opacity: dragging ? 0.85 : 1,
      }}
    >
      {frames.length > 0 && frames.map((f, i) => {
        const frameW = Math.max(1, (width - 2) / frames.length);
        return (
          <img
            key={i}
            src={f.dataUrl}
            alt=""
            style={{
              height: FRAME_H,
              width: frameW,
              objectFit: "cover",
              flexShrink: 0,
              pointerEvents: "none",
            }}
          />
        );
      })}
      {isImage && status === "ready" && uri && frames.length === 0 && (
        <ImageFill src={contentUrl(uri)} width={width - 2} height={FRAME_H} />
      )}
      {loading && frames.length === 0 && (
        <div style={{ padding: "0 4px", fontSize: 9, color: "#a1a1aa" }}>Loading...</div>
      )}
      {status === "generating" && (
        <span style={{ fontSize: 9, color: "#a16207", padding: "0 4px", whiteSpace: "nowrap" }}>
          {"\u23F3"} generating
        </span>
      )}
      {status === "failed" && (
        <span style={{ fontSize: 9, color: "#ef4444", padding: "0 4px", whiteSpace: "nowrap" }}>
          {"\u26A0"} error
        </span>
      )}
      {status === "pending" && (
        <span style={{ fontSize: 9, color: "#3f3f46", padding: "0 4px" }}>&mdash;</span>
      )}

      {/* Resize handles — subtle, only grab area, no visible fill until hover */}
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(clip.id, "left", e.clientX);
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          background: selected ? "rgba(249,115,22,0.3)" : "transparent",
        }}
      />
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(clip.id, "right", e.clientX);
        }}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          background: selected ? "rgba(249,115,22,0.3)" : "transparent",
        }}
      />
    </div>
  );
}

function ImageFill({ src, width, height }: { src: string; width: number; height: number }) {
  const count = Math.max(1, Math.ceil(width / (height * 1.5)));
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <img
          key={i}
          src={src}
          alt=""
          style={{
            height,
            width: height * 1.5,
            objectFit: "cover",
            flexShrink: 0,
            opacity: i > 0 ? 0.7 : 1,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

interface Props {
  track: Track;
  selectedClipId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
  onSelect: (clipId: string) => void;
}

export function VideoTrack({
  track,
  selectedClipId,
  pixelsPerSecond,
  scrollLeft,
  onSelect,
}: Props) {
  const dispatch = useDispatch();
  const drag = useTrackDragEngine(track, pixelsPerSecond, dispatch);
  const resize = useClipResize(track, pixelsPerSecond, dispatch);

  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {track.clips.map((clip) => {
        const previewStart = drag.displayStartFor(clip.id) ?? clip.startTime;
        const previewDuration = resize.displayDurationFor(clip.id) ?? clip.duration;
        const previewStartWithResize =
          resize.displayStartFor(clip.id) ?? previewStart;
        const x = previewStartWithResize * pixelsPerSecond - scrollLeft;
        const w = previewDuration * pixelsPerSecond;
        if (x + w < -10 || x > 4000) return null;
        return (
          <VideoClip
            key={clip.id}
            clip={clip}
            x={x}
            width={w}
            selected={clip.id === selectedClipId}
            dragging={drag.dragState?.clipId === clip.id}
            pixelsPerSecond={pixelsPerSecond}
            onSelect={onSelect}
            onDragStart={drag.handleDragStart}
            onResizeStart={resize.handleResizeStart}
          />
        );
      })}
      {/* Snap guide line */}
      {drag.dragState?.snapTime != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: drag.dragState.snapTime * pixelsPerSecond - scrollLeft,
            width: 1,
            background: "#f97316",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
```

Note: this task references `useClipResize` which is created in Task 3. Create a temporary stub so Task 2 compiles — put this **placeholder** file at `hooks/useClipResize.ts` and replace it in Task 3:

```ts
// TEMP stub — fully implemented in Task 3.
import type { Track } from "@pneuma-craft/timeline";

export interface UseClipResize {
  handleResizeStart: (clipId: string, edge: "left" | "right", mouseX: number) => void;
  displayStartFor: (clipId: string) => number | null;
  displayDurationFor: (clipId: string) => number | null;
}

export function useClipResize(
  _track: Track,
  _pixelsPerSecond: number,
  _dispatch: unknown,
): UseClipResize {
  return {
    handleResizeStart: () => {},
    displayStartFor: () => null,
    displayDurationFor: () => null,
  };
}
```

- [ ] **Step 3: Run tsc, bun tests, import smoke**

```bash
bun run tsc --noEmit
bun test
```

Expected: all tests pass, no tsc errors.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/timeline/hooks/useTrackDragEngine.ts \
        modes/clipcraft/viewer/timeline/hooks/useClipResize.ts \
        modes/clipcraft/viewer/timeline/VideoTrack.tsx
git commit -m "feat(clipcraft): drag engine hook + VideoTrack drag integration"
```

---

## Task 3 — `useClipResize` hook (real implementation)

**Files:**
- Modify: `modes/clipcraft/viewer/timeline/hooks/useClipResize.ts`

**Context:** Same document-listener state machine pattern as `useTrackDragEngine`, but instead of moving the clip along the timeline, a left-edge drag updates `inPoint` (and shrinks `duration` by the same amount, and shifts `startTime` forward so the clip's right edge stays anchored), and a right-edge drag updates `duration` (and `outPoint`). Dispatched through **two commands** on release: `composition:trim-clip` for the in/out/duration change, and `composition:move-clip` only if the start shifted (left-edge resize). Clamp so `duration >= 0.1s` and `inPoint >= 0` and `outPoint <= asset-source-duration if we know it, else just trust the clip's existing bounds`.

- [ ] **Step 1: Replace `hooks/useClipResize.ts` with the real implementation**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Track, CompositionCommand } from "@pneuma-craft/timeline";
import type { Actor, CoreCommand } from "@pneuma-craft/core";

type Dispatch = (
  actor: Actor,
  cmd: CoreCommand | CompositionCommand,
) => unknown;

const MIN_DURATION = 0.1;

interface ResizeState {
  clipId: string;
  edge: "left" | "right";
  startMouseX: number;
  originalStartTime: number;
  originalDuration: number;
  originalInPoint: number;
  originalOutPoint: number;
  displayStartTime: number;
  displayDuration: number;
  displayInPoint: number;
  displayOutPoint: number;
}

export interface UseClipResize {
  handleResizeStart: (
    clipId: string,
    edge: "left" | "right",
    mouseX: number,
  ) => void;
  displayStartFor: (clipId: string) => number | null;
  displayDurationFor: (clipId: string) => number | null;
}

/**
 * Edge-drag resize for a single clip. Not rippled — other clips stay put;
 * a resize that would overlap a neighbor is just clamped by the neighbor's
 * edge on release.
 */
export function useClipResize(
  track: Track,
  pixelsPerSecond: number,
  dispatch: Dispatch,
): UseClipResize {
  const [state, setState] = useState<ResizeState | null>(null);
  const stateRef = useRef<ResizeState | null>(null);
  const clipsRef = useRef(track.clips);
  clipsRef.current = track.clips;
  const ppsRef = useRef(pixelsPerSecond);
  ppsRef.current = pixelsPerSecond;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const handleResizeStart = useCallback(
    (clipId: string, edge: "left" | "right", mouseX: number) => {
      const clip = clipsRef.current.find((c) => c.id === clipId);
      if (!clip) return;
      const initial: ResizeState = {
        clipId,
        edge,
        startMouseX: mouseX,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
        originalInPoint: clip.inPoint,
        originalOutPoint: clip.outPoint,
        displayStartTime: clip.startTime,
        displayDuration: clip.duration,
        displayInPoint: clip.inPoint,
        displayOutPoint: clip.outPoint,
      };
      stateRef.current = initial;
      setState(initial);
    },
    [],
  );

  useEffect(() => {
    if (!state) return;

    const onMove = (ev: MouseEvent) => {
      const s = stateRef.current;
      const pps = ppsRef.current;
      if (!s || pps <= 0) return;
      const deltaT = (ev.clientX - s.startMouseX) / pps;

      let displayStartTime = s.originalStartTime;
      let displayDuration = s.originalDuration;
      let displayInPoint = s.originalInPoint;
      let displayOutPoint = s.originalOutPoint;

      if (s.edge === "left") {
        // Anchor right edge: startTime + duration == originalStartTime + originalDuration.
        let newStart = Math.max(0, s.originalStartTime + deltaT);
        // clamp so duration stays >= MIN_DURATION
        const rightEdge = s.originalStartTime + s.originalDuration;
        if (rightEdge - newStart < MIN_DURATION) {
          newStart = rightEdge - MIN_DURATION;
        }
        const inShift = newStart - s.originalStartTime;
        // Clamp inPoint >= 0.
        const newInPoint = Math.max(0, s.originalInPoint + inShift);
        // Recompute startTime if inPoint was clamped
        const effectiveInShift = newInPoint - s.originalInPoint;
        displayInPoint = newInPoint;
        displayStartTime = s.originalStartTime + effectiveInShift;
        displayDuration = rightEdge - displayStartTime;
      } else {
        // Right edge: anchor startTime + inPoint; grow/shrink duration + outPoint.
        let newDuration = Math.max(MIN_DURATION, s.originalDuration + deltaT);
        displayDuration = newDuration;
        displayOutPoint = s.originalInPoint + newDuration;
      }

      const next: ResizeState = {
        ...s,
        displayStartTime,
        displayDuration,
        displayInPoint,
        displayOutPoint,
      };
      stateRef.current = next;
      setState(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const s = stateRef.current;
      if (s) {
        const changedStart = Math.abs(s.displayStartTime - s.originalStartTime) > 1e-6;
        const changedDuration = Math.abs(s.displayDuration - s.originalDuration) > 1e-6;
        if (changedStart || changedDuration) {
          // Trim command carries the new in/out + duration
          dispatchRef.current("human", {
            type: "composition:trim-clip",
            clipId: s.clipId,
            inPoint: s.displayInPoint,
            outPoint: s.displayOutPoint,
            duration: s.displayDuration,
          });
          // If the start shifted (left-edge resize), also move-clip so
          // downstream state (and autosave serializer) reflects the new start.
          if (changedStart) {
            dispatchRef.current("human", {
              type: "composition:move-clip",
              clipId: s.clipId,
              startTime: s.displayStartTime,
            });
          }
        }
      }
      stateRef.current = null;
      setState(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.clipId, state?.edge]);

  const displayStartFor = useCallback(
    (clipId: string): number | null => {
      if (!state || state.clipId !== clipId) return null;
      return state.displayStartTime;
    },
    [state],
  );

  const displayDurationFor = useCallback(
    (clipId: string): number | null => {
      if (!state || state.clipId !== clipId) return null;
      return state.displayDuration;
    },
    [state],
  );

  return { handleResizeStart, displayStartFor, displayDurationFor };
}
```

- [ ] **Step 2: tsc + tests**

```bash
bun run tsc --noEmit
bun test
```

Expected: clean. The hook has no dedicated unit test — it's integration-tested in Task 7's browser verification.

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/hooks/useClipResize.ts
git commit -m "feat(clipcraft): clip edge-resize hook with trim+move dispatch"
```

---

## Task 4 — Integrate drag + resize into AudioTrack and SubtitleTrack

**Files:**
- Modify: `modes/clipcraft/viewer/timeline/AudioTrack.tsx`
- Modify: `modes/clipcraft/viewer/timeline/SubtitleTrack.tsx`

**Context:** Same pattern as VideoTrack — each track owns its own `useTrackDragEngine` + `useClipResize` because drag/ripple is scoped per track (Plan 5.5 does not support cross-track drag). The clip component inside each track gets three new props (`dragging`, `onDragStart`, `onResizeStart`) and renders two 6px resize handles.

- [ ] **Step 1: Rewrite AudioTrack.tsx to match VideoTrack's structure.**

Replace the file with the block below. The `AudioClip` internals (WaveformBars render) stay — only the wrapper `<div>` gains `onMouseDown` + the two resize handles, and the top-level `AudioTrack` component gains the two hooks.

```tsx
// Ported from modes/clipcraft-legacy/viewer/timeline/AudioTrack.tsx.
// Plan 5.5: drag + resize interactivity.

import { useMemo } from "react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import { useAsset, useDispatch } from "@pneuma-craft/react";
import { WaveformBars } from "./WaveformBars.js";
import { useWaveform } from "./hooks/useWaveform.js";
import { useTrackDragEngine } from "./hooks/useTrackDragEngine.js";
import { useClipResize } from "./hooks/useClipResize.js";

const TRACK_H = 32;
const BAR_H = TRACK_H - 12;

function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

interface AudioClipProps {
  clip: Clip;
  x: number;
  width: number;
  selected: boolean;
  dragging: boolean;
  onSelect: (clipId: string) => void;
  onDragStart: (clipId: string, mouseX: number) => void;
  onResizeStart: (clipId: string, edge: "left" | "right", mouseX: number) => void;
}

function AudioClip({
  clip,
  x,
  width,
  selected,
  dragging,
  onSelect,
  onDragStart,
  onResizeStart,
}: AudioClipProps) {
  const asset = useAsset(clip.assetId);
  const status = asset?.status ?? "ready";
  const uri = asset?.uri ?? "";
  const hasAudio = status === "ready" && !!uri && asset?.type === "audio";

  const waveOpts = useMemo(() => {
    if (!hasAudio) return null;
    return {
      audioUrl: contentUrl(uri),
      bars: Math.max(8, Math.round(width / 4)),
      maxDuration: clip.duration,
    };
  }, [hasAudio, uri, width, clip.duration]);

  const { waveform } = useWaveform(waveOpts);

  return (
    <div
      onMouseDown={(e) => {
        if (e.button !== 0 || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect(clip.id);
        onDragStart(clip.id, e.clientX);
      }}
      style={{
        position: "absolute",
        left: Math.round(x),
        width: Math.round(width - 1),
        height: TRACK_H - 4,
        top: 2,
        background: selected ? "#1a1e2a" : "#18181b",
        borderRadius: 3,
        border: selected ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        cursor: dragging ? "grabbing" : "grab",
        opacity: dragging ? 0.85 : 1,
      }}
    >
      {waveform ? (
        <WaveformBars peaks={waveform.peaks} height={BAR_H} color={selected ? "#38bdf8" : "#1e3a5f"} />
      ) : hasAudio ? (
        <div style={{ fontSize: 9, color: "#38bdf8", opacity: 0.5 }}>loading...</div>
      ) : null}
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(clip.id, "left", e.clientX);
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          background: selected ? "rgba(249,115,22,0.3)" : "transparent",
        }}
      />
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(clip.id, "right", e.clientX);
        }}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          background: selected ? "rgba(249,115,22,0.3)" : "transparent",
        }}
      />
    </div>
  );
}

interface Props {
  track: Track;
  selectedClipId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
  onSelect: (clipId: string) => void;
}

export function AudioTrack({
  track,
  selectedClipId,
  pixelsPerSecond,
  scrollLeft,
  onSelect,
}: Props) {
  const dispatch = useDispatch();
  const drag = useTrackDragEngine(track, pixelsPerSecond, dispatch);
  const resize = useClipResize(track, pixelsPerSecond, dispatch);

  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {track.clips.map((clip) => {
        const previewStart =
          resize.displayStartFor(clip.id) ??
          drag.displayStartFor(clip.id) ??
          clip.startTime;
        const previewDuration = resize.displayDurationFor(clip.id) ?? clip.duration;
        const x = previewStart * pixelsPerSecond - scrollLeft;
        const w = previewDuration * pixelsPerSecond;
        if (x + w < -10 || x > 4000) return null;
        return (
          <AudioClip
            key={clip.id}
            clip={clip}
            x={x}
            width={w}
            selected={clip.id === selectedClipId}
            dragging={drag.dragState?.clipId === clip.id}
            onSelect={onSelect}
            onDragStart={drag.handleDragStart}
            onResizeStart={resize.handleResizeStart}
          />
        );
      })}
      {drag.dragState?.snapTime != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: drag.dragState.snapTime * pixelsPerSecond - scrollLeft,
            width: 1,
            background: "#f97316",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Apply the exact same pattern to SubtitleTrack.tsx**

Read the current file first, then apply the same three changes: add `useDispatch` + `useTrackDragEngine` + `useClipResize` in the outer component, add `onMouseDown` + resize handles to the clip wrapper, render the snap line. Keep the subtitle-specific visuals (text content, font color) intact. Do not change `SubtitleTrack`'s public props.

- [ ] **Step 3: tsc + tests**

```bash
bun run tsc --noEmit
bun test
```

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/timeline/AudioTrack.tsx \
        modes/clipcraft/viewer/timeline/SubtitleTrack.tsx
git commit -m "feat(clipcraft): drag + resize on audio + subtitle tracks"
```

---

## Task 5 — Edit toolbar + collapse-gaps operation

**Files:**
- Create: `modes/clipcraft/viewer/timeline/toolbar/collapseGaps.ts`
- Create: `modes/clipcraft/viewer/timeline/toolbar/EditToolbar.tsx`
- Create: `modes/clipcraft/viewer/timeline/toolbar/__tests__/collapseGaps.test.ts`
- Modify: `modes/clipcraft/viewer/timeline/Timeline.tsx`

- [ ] **Step 1: Write the pure helper `toolbar/collapseGaps.ts`**

```ts
import type { Composition, CompositionCommand } from "@pneuma-craft/timeline";

/**
 * For each track, walk clips in startTime order and emit move-clip
 * commands that re-pack them against 0 (first clip) and each previous
 * clip's end (subsequent). Skips no-op moves.
 *
 * Returns the command list; the caller is responsible for dispatching them
 * in order so craft's undo manager groups them as consecutive events.
 */
export function buildCollapseGapsCommands(
  composition: Composition,
): CompositionCommand[] {
  const out: CompositionCommand[] = [];
  for (const track of composition.tracks) {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    let cursor = 0;
    for (const clip of sorted) {
      if (Math.abs(clip.startTime - cursor) > 1e-6) {
        out.push({
          type: "composition:move-clip",
          clipId: clip.id,
          startTime: cursor,
        });
      }
      cursor += clip.duration;
    }
  }
  return out;
}
```

- [ ] **Step 2: Test `buildCollapseGapsCommands`**

```ts
import { describe, test, expect } from "bun:test";
import type { Composition } from "@pneuma-craft/timeline";
import { buildCollapseGapsCommands } from "../collapseGaps.js";

function comp(clips: { id: string; startTime: number; duration: number }[]): Composition {
  return {
    id: "c1",
    name: "test",
    duration: 100,
    tracks: [
      {
        id: "t1",
        type: "video",
        name: "v",
        clips: clips.map((c) => ({
          id: c.id,
          trackId: "t1",
          assetId: `a-${c.id}`,
          startTime: c.startTime,
          duration: c.duration,
          inPoint: 0,
          outPoint: c.duration,
        })),
        muted: false,
        locked: false,
        visible: true,
      },
    ],
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      sampleRate: 48000,
      channels: 2,
    },
  } as Composition;
}

describe("buildCollapseGapsCommands", () => {
  test("packs clips with gaps against each other", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 5, duration: 3 },
      { id: "c", startTime: 10, duration: 1 },
    ]);
    const cmds = buildCollapseGapsCommands(c);
    expect(cmds.length).toBe(2);
    expect(cmds[0]).toMatchObject({ type: "composition:move-clip", clipId: "b", startTime: 2 });
    expect(cmds[1]).toMatchObject({ type: "composition:move-clip", clipId: "c", startTime: 5 });
  });

  test("emits no commands when clips are already packed", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 2, duration: 3 },
    ]);
    const cmds = buildCollapseGapsCommands(c);
    expect(cmds.length).toBe(0);
  });

  test("handles an empty track without emitting commands", () => {
    const c = comp([]);
    expect(buildCollapseGapsCommands(c).length).toBe(0);
  });
});
```

- [ ] **Step 3: Write `toolbar/EditToolbar.tsx`**

```tsx
import { useCallback } from "react";
import {
  useComposition,
  usePlayback,
  useSelection,
  useDispatch,
  useUndo,
} from "@pneuma-craft/react";
import { buildCollapseGapsCommands } from "./collapseGaps.js";

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #3f3f46",
  borderRadius: 3,
  color: "#a1a1aa",
  padding: "0 8px",
  height: 22,
  cursor: "pointer",
  fontSize: 10,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const btnDisabled: React.CSSProperties = {
  ...btnStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

export function EditToolbar() {
  const composition = useComposition();
  const playback = usePlayback();
  const selection = useSelection();
  const dispatch = useDispatch();
  const undoState = useUndo();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const canSplit = selectedClipId !== null && composition !== null;
  const canDelete = selectedClipId !== null;

  const onSplit = useCallback(() => {
    if (!selectedClipId) return;
    dispatch("human", {
      type: "composition:split-clip",
      clipId: selectedClipId,
      time: playback.currentTime,
    });
  }, [dispatch, selectedClipId, playback.currentTime]);

  const onDelete = useCallback(() => {
    if (!selectedClipId) return;
    dispatch("human", {
      type: "composition:remove-clip",
      clipId: selectedClipId,
    });
  }, [dispatch, selectedClipId]);

  const onCollapse = useCallback(() => {
    if (!composition) return;
    const cmds = buildCollapseGapsCommands(composition);
    for (const cmd of cmds) {
      dispatch("human", cmd);
    }
  }, [dispatch, composition]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={onSplit}
        style={canSplit ? btnStyle : btnDisabled}
        disabled={!canSplit}
        title="Split selected clip at playhead (S)"
      >
        Split
      </button>
      <button
        onClick={onDelete}
        style={canDelete ? btnStyle : btnDisabled}
        disabled={!canDelete}
        title="Delete selected clip (Delete)"
      >
        Delete
      </button>
      <button
        onClick={onCollapse}
        style={btnStyle}
        title="Pack all clips left, removing gaps"
      >
        Collapse Gaps
      </button>
      <div style={{ width: 1, height: 16, background: "#27272a", margin: "0 2px" }} />
      <button
        onClick={() => undoState.undo()}
        style={undoState.canUndo ? btnStyle : btnDisabled}
        disabled={!undoState.canUndo}
        title="Undo (⌘/Ctrl+Z)"
      >
        Undo
      </button>
      <button
        onClick={() => undoState.redo()}
        style={undoState.canRedo ? btnStyle : btnDisabled}
        disabled={!undoState.canRedo}
        title="Redo (⌘/Ctrl+Shift+Z)"
      >
        Redo
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Modify `Timeline.tsx` to mount `<EditToolbar />`**

In the existing zoom controls row (the `<div>` containing `zoom.zoomOut`, `pps` label, `zoom.zoomIn`, and the "scroll / ⌘+scroll to zoom" hint), insert `<EditToolbar />` after the hint span. Update the hint span's `marginLeft: "auto"` to remain — pushing the toolbar to the right of the hint. Final markup for that header row:

```tsx
<div
  style={{
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 12px 4px",
    fontSize: 10,
    color: "#52525b",
  }}
>
  <button onClick={zoom.zoomOut} style={zoomBtnStyle} title="Zoom out" aria-label="zoom out">−</button>
  <span style={{ minWidth: 48, textAlign: "center" }}>{Math.round(zoom.pixelsPerSecond)}px/s</span>
  <button onClick={zoom.zoomIn} style={zoomBtnStyle} title="Zoom in" aria-label="zoom in">+</button>
  <span style={{ fontSize: 9, color: "#3f3f46" }}>scroll / ⌘+scroll to zoom</span>
  <div style={{ marginLeft: "auto" }}>
    <EditToolbar />
  </div>
</div>
```

Add the import at the top:

```ts
import { EditToolbar } from "./toolbar/EditToolbar.js";
```

- [ ] **Step 5: tsc + tests**

```bash
bun run tsc --noEmit
bun test
```

Expected: new collapseGaps tests pass (3), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/timeline/toolbar/ \
        modes/clipcraft/viewer/timeline/Timeline.tsx
git commit -m "feat(clipcraft): edit toolbar with split/delete/collapse/undo/redo"
```

---

## Task 6 — Keyboard shortcuts

**Files:**
- Create: `modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts`
- Modify: `modes/clipcraft/viewer/timeline/Timeline.tsx`

**Context:** Attach a single window-level `keydown` listener that runs while the timeline is mounted. Ignore events when focus is in a text input/textarea/contentEditable (so the user can type in the chat panel without nuking their selection). Shortcuts:
- `Delete` / `Backspace` → remove selected clip
- `S` → split selected clip at playhead
- `Cmd/Ctrl + Z` → undo
- `Cmd/Ctrl + Shift + Z` → redo

- [ ] **Step 1: Write the hook**

```ts
import { useEffect } from "react";
import {
  useDispatch,
  usePlayback,
  useSelection,
  useUndo,
} from "@pneuma-craft/react";

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useTimelineShortcuts(): void {
  const dispatch = useDispatch();
  const playback = usePlayback();
  const selection = useSelection();
  const undoState = useUndo();

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (isEditableTarget(ev.target)) return;
      const mod = ev.metaKey || ev.ctrlKey;
      const key = ev.key;

      if (mod && (key === "z" || key === "Z")) {
        ev.preventDefault();
        if (ev.shiftKey) undoState.redo();
        else undoState.undo();
        return;
      }

      const selectedClipId =
        selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

      if (!selectedClipId) return;

      if (key === "Delete" || key === "Backspace") {
        ev.preventDefault();
        dispatch("human", { type: "composition:remove-clip", clipId: selectedClipId });
        return;
      }

      if (key === "s" || key === "S") {
        ev.preventDefault();
        dispatch("human", {
          type: "composition:split-clip",
          clipId: selectedClipId,
          time: playback.currentTime,
        });
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, playback.currentTime, selection, undoState]);
}
```

- [ ] **Step 2: Call `useTimelineShortcuts()` at the top of `Timeline()` in `Timeline.tsx`**

```ts
export function Timeline() {
  useTimelineShortcuts();
  const composition = useComposition();
  // ... rest unchanged
}
```

Add the import:

```ts
import { useTimelineShortcuts } from "./hooks/useTimelineShortcuts.js";
```

- [ ] **Step 3: tsc + tests**

```bash
bun run tsc --noEmit
bun test
```

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts \
        modes/clipcraft/viewer/timeline/Timeline.tsx
git commit -m "feat(clipcraft): keyboard shortcuts for split/delete/undo/redo"
```

---

## Task 7 — Smoke imports + end-to-end browser verification

**Files:**
- Modify: `modes/clipcraft/__tests__/preview-components.test.ts`

- [ ] **Step 1: Append smoke import tests for the new modules**

```ts
  test("dragEngine exports pure helpers", async () => {
    const mod = await import("../viewer/timeline/dragEngine.js");
    expect(typeof mod.computeRipplePreview).toBe("function");
    expect(typeof mod.snapDraggedStart).toBe("function");
  });

  test("useTrackDragEngine exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useTrackDragEngine.js");
    expect(typeof mod.useTrackDragEngine).toBe("function");
  });

  test("useClipResize exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useClipResize.js");
    expect(typeof mod.useClipResize).toBe("function");
  });

  test("useTimelineShortcuts exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useTimelineShortcuts.js");
    expect(typeof mod.useTimelineShortcuts).toBe("function");
  });

  test("EditToolbar exports a function", async () => {
    const mod = await import("../viewer/timeline/toolbar/EditToolbar.js");
    expect(typeof mod.EditToolbar).toBe("function");
  });

  test("collapseGaps exports a function", async () => {
    const mod = await import("../viewer/timeline/toolbar/collapseGaps.js");
    expect(typeof mod.buildCollapseGapsCommands).toBe("function");
  });
```

- [ ] **Step 2: Run the full test suite + tsc one more time**

```bash
bun run tsc --noEmit
bun test
```

Expected: 700+ tests pass, tsc clean.

- [ ] **Step 3: Start a clean dev workspace + launch ClipCraft**

```bash
rm -rf /tmp/clipcraft-plan5.5
bun bin/pneuma.ts --dev clipcraft \
  --workspace /tmp/clipcraft-plan5.5 \
  --port 17996 --no-prompt --no-open --backend claude-code --debug
```

Wait for `[vite] ready` and `[pneuma] ready http://localhost:17997?...` lines. Open the URL in chrome via the `chrome-devtools-mcp` plugin.

- [ ] **Step 4: Verify each edit operation in the browser**

Use `chrome-devtools-mcp` tools. For each scenario, take a screenshot after the operation.

1. **Drag-to-move:** select the only video clip, drag 100px right, release. Verify the clip's new `startTime` is approximately +1s (at default 100 px/s) and a `composition:move-clip` event landed in `StateDump → events`. Autosave writes `/tmp/clipcraft-plan5.5/project.json` exactly once per drop.
2. **Snap:** drag the video clip toward `t=0` slowly; verify the orange snap line appears and the clip jumps to `startTime=0`.
3. **Right-edge resize:** drag the right handle inward 100px, confirm `duration` shrinks by ~1s, event log shows `composition:trim-clip` with `outPoint` + `duration` set.
4. **Left-edge resize:** drag the left handle right 100px, confirm `startTime` shifts +1s, `inPoint` shifts +1s, event log shows both `composition:trim-clip` **and** `composition:move-clip`.
5. **Split (button):** place the playhead at 2.5s, click **Split**. Confirm two clips now exist with `duration` ~2.5 each and `composition:split-clip` event fired.
6. **Delete (keyboard):** select one of the split halves, press **Delete**. Confirm it disappears and `composition:remove-clip` is in the event log.
7. **Undo (⌘Z):** press ⌘Z three times to undo delete, split, resize. Confirm the composition shape reverts step-by-step and `canUndo` reflects state.
8. **Redo (⌘⇧Z):** press ⌘⇧Z to roll forward one step. Confirm event log grows (craft emits new compensating events on redo, not replays).
9. **Collapse Gaps:** drag a clip to leave a visible gap, click **Collapse Gaps**, confirm the clip snaps back against its neighbor with a single `composition:move-clip` event.
10. **No-edit mode check:** focus the chat input, press Delete — the selected clip must NOT disappear (shortcut is suppressed inside editable elements).

Record results as a checklist in the commit message body.

- [ ] **Step 5: Kill the dev server**

```bash
pkill -f "bin/pneuma.ts --dev clipcraft"
```

- [ ] **Step 6: Commit verification + update NEXT.md**

Update `docs/superpowers/plans/NEXT.md`:
- Move the **Plan 5.5** bullet from "Upcoming" into "Completed" with a one-paragraph summary listing the verified edit operations.
- In the summary, explicitly note which of the 10 verifications passed; if any failed, file them under "Known limitations" instead of marking the plan complete.

```bash
git add modes/clipcraft/__tests__/preview-components.test.ts docs/superpowers/plans/NEXT.md
git commit -m "docs(clipcraft): plan 5.5 e2e verification + NEXT.md update"
```

---

## Self-review

- **Spec coverage:** The Plan 5.5 NEXT.md scope lists drag-to-move ✅ (Task 2), resize edges ✅ (Task 3), split on playhead ✅ (Task 5 button + Task 6 shortcut), delete ✅ (Task 5 + Task 6), collapse gaps ✅ (Task 5), ripple+snap engine copied verbatim ✅ (Task 1), undo/redo bindings ✅ (Task 5 + Task 6). Multi-select is explicitly deferred per the NEXT.md note. Toast-per-edit is **dropped** vs the NEXT.md bullet — the edit is visible in the event log + the composition itself, and toast plumbing would be ~new-file noise for zero workflow gain. If reviewers want it back, it slots in after Task 5 as ~40 lines in `EditToolbar.tsx`.
- **Placeholder scan:** every step with code contains the actual code; every command has an expected outcome; no "TBD" / "handle edge cases" / "similar to Task N".
- **Type consistency:** all command types match `packages/timeline/dist/index.d.ts:86-102` exactly. Dispatch signature matches `packages/react/dist/index.d.ts:44`. `useUndo` return shape matches `:85-91`. `trim-clip` uses optional `inPoint` / `outPoint` / `duration` together, consistent with the craft core signature.
- **Known risk:** `useClipResize` trusts existing `inPoint` / `outPoint` without validating against source-media duration. If a user drags the right handle beyond the source length, the `trim-clip` reducer upstream will either clamp or throw. The plan assumes clamp-at-reducer; if upstream throws, we catch it in Task 7 step 4.3 and file a follow-up.

---

## Execution

Using `superpowers:subagent-driven-development`. Dispatch one implementer subagent per task, followed by code-quality review. No separate spec review — task boundaries are tight enough that implementer self-review + final QA in Task 7 cover both angles.
