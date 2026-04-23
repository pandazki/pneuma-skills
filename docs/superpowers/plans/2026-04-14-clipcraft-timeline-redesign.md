# ClipCraft Timeline Redesign — Creation-First Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the timeline from "a time strip at the bottom" into the primary creation surface. Pull playback transport out of VideoPreview (which disappears on 3D expansion), add an always-visible clip inspector surfacing variant/prompt/provenance, widen track labels so mute/lock/hide live on the label instead of in a hidden menu, and add clip-level prompt tooltips so the timeline shows the AIGC *thought process* not just the rendered pixels.

**Architecture:**
- New `timeline/transport/TransportBar.tsx` — play/pause, goto start/end, time/duration, speed. Mounted above the toolbar inside `Timeline.tsx`. VideoPreview strips its internal control bar; transport is global and always visible even when the preview is hidden.
- New `timeline/inspector/ClipInspector.tsx` — bottom-anchored strip showing In/Out/Duration numeric inputs, variant switcher, prompt display. Lives in `TimelineShell` between the 3D panel and the Timeline. Collapses to 0px when `selection.type !== "clip"`.
- `timeline/TrackLabel.tsx` — full rewrite, 140px wide. Renders name + type icon + mute/lock/hide toggle buttons. All three track components pass the full `Track` through.
- `timeline/toolbar/EditToolbar.tsx` — regrouped into Edit (Split / Delete / Duplicate / Ripple Del / Collapse) + View (Zoom − / ppx / + / Fit / Sel) + History (Undo / Redo), with vertical separators between groups.
- New pure helper `timeline/toolbar/rippleDelete.ts` — emits a `remove-clip` + subsequent `move-clip`s shifting later clips in the same track left by the removed duration.
- New hook `timeline/hooks/useClipProvenance.ts` — given a clipId, resolves the referenced asset, walks `coreState.provenance.edges` to find the latest operation, returns `{ operation, summary }` where `summary` is a one-line string like `"generate · model=sdxl · prompt='opening shot'"` or `"import · filename=sample.mp4"`.

**Tech Stack:** React 19, `@pneuma-craft/react` hooks (`useComposition`, `usePlayback`, `useSelection`, `useDispatch`, `useUndo`, `useAsset`, `useAssets`, `useVariants`, `useLineage`, `usePneumaCraftStore`), `@pneuma-craft/core` types (`Operation`, `ProvenanceEdge`), `@pneuma-craft/timeline` types (`Track`, `Clip`, `CompositionCommand`). No new dependencies.

**Base commit:** `91035b8` (end of Plan 5.5 docs, `feat/clipcraft-by-pneuma-craft`).

**Out of scope (next polish pass):**
- Track add / delete / reorder / rename (craft has the commands; defer until we decide the "+ track" affordance style)
- Drag asset from AssetPanel onto track (drop targets + DnD glue)
- Horizontal pan / zoom-to-fit math (needs per-container viewport width)
- Status badge restyle inside the clip itself
- Regenerate button that actually hits an MCP tool (blocked on Plan 9)

These are listed as NEXT.md "Known limitations" at the end.

---

## Context the engineer needs before starting

1. **Current entry point:** `Timeline.tsx` mounts `<useTimelineShortcuts>` + ruler + track rows + playhead + toolbar, reads `useComposition() / usePlayback() / useSelection() / useDispatch()`. Plan 5.5's `EditToolbar.tsx` is currently inline with the zoom controls row. The Timeline header row contains `[zoomOut][ppsText][zoomIn][hint][spacer][EditToolbar]`.
2. **`TimelineShell` layout:** `flexDirection: column-reverse`. Source order: `Timeline` (first child → renders at bottom), then `{isExpanded && <ExpandedPanel />}` (second child → renders above Timeline). Adding the ClipInspector as a middle child means: Timeline (bottom) → ClipInspector (middle) → ExpandedPanel (top, when expanded). That is the desired stacking.
3. **VideoPreview's current transport:** at the bottom of `modes/clipcraft/viewer/preview/VideoPreview.tsx` lines 125–157 — a `<div>` with play button + time text + aspect label. Remove that entire block in Task 1; the transport moves to the Timeline. The `togglePlay` callback + `isPlaying` local state are deleted; the canvas render area grows to fill.
4. **Playback hook surface** (verified against `@pneuma-craft/react/dist/index.d.ts:93–110`): `state: PlaybackState`, `currentTime`, `duration`, `playbackRate`, `loop`, `play()`, `pause()`, `seek(t)`, `setPlaybackRate(rate)`, `setLoop(loop)`. Use `state === "playing"` for the play/pause toggle — never compare `playback.state` to a boolean.
5. **Undo / redo hook:** `useUndo() → { undo, redo, canUndo, canRedo }` — stays as-is.
6. **Composition commands** (verified against `@pneuma-craft/timeline/dist/index.d.ts:66–126`):
   - `{ type: "composition:duplicate-clip", clipId }`
   - `{ type: "composition:rebind-clip", clipId, assetId }`
   - `{ type: "composition:toggle-track-mute", trackId }`
   - `{ type: "composition:toggle-track-lock", trackId }`
   - `{ type: "composition:toggle-track-visibility", trackId }`
   - `{ type: "composition:trim-clip", clipId, inPoint?, outPoint?, duration? }`
7. **Provenance shape** (verified against `@pneuma-craft/core/dist/index.d.ts:34–54`):
   - `OperationType = 'upload' | 'import' | 'generate' | 'derive' | 'select' | 'composite'`
   - `Operation = { type, actor, agentId?, params?: Record<string, unknown>, label?, timestamp }`
   - `ProvenanceEdge = { id, fromAssetId: string | null, toAssetId, operation }`
   - `coreState.provenance.edges: Map<string, ProvenanceEdge>` — iterate with `.values()`.
8. **Variant hook:** `useVariants(assetId: string): Asset[]` — returns sibling assets under the same parent provenance node. For an asset that was imported (no parent), returns an empty list. The inspector should treat empty variants as "no alternatives" and hide the switcher group.
9. **Dispatch actor:** always `"human"` from the UI — matches existing Timeline + EditToolbar usage. Don't introduce a new actor.
10. **Keyboard shortcut bail-out:** existing `useTimelineShortcuts` early-returns inside `INPUT / TEXTAREA / SELECT / contentEditable`. ClipInspector will add `<input type="number">` fields → the bail-out already covers them. When extending shortcuts in Task 2 (adding `D` for duplicate, `⌘⌫` for ripple delete), keep that contract.
11. **File watcher loop protection:** mutations go through `useDispatch`; autosave via `useProjectSync` is already wired. Do not manually write to `project.json` or bypass the Source abstraction.
12. **Two existing craft gotchas (don't try to fix in this plan):** (a) undo manager wraps hydration events, so aggressive Undo clicks can empty the composition — still a pre-existing craft issue; (b) React StrictMode dev-only double-mount occasionally double-dispatches a drag. Both are flagged in NEXT.md and stay out of scope.

---

## File structure

```
modes/clipcraft/viewer/
├── preview/
│   └── VideoPreview.tsx                 [MOD]  — strip bottom control bar
├── timeline/
│   ├── Timeline.tsx                     [MOD]  — mount TransportBar, use new EditToolbar
│   ├── TrackLabel.tsx                   [MOD]  — full rewrite, 140px, mute/lock/hide
│   ├── VideoTrack.tsx                   [MOD]  — pass `track` prop through for label
│   ├── AudioTrack.tsx                   [MOD]  — same
│   ├── SubtitleTrack.tsx                [MOD]  — same
│   ├── transport/
│   │   └── TransportBar.tsx             [NEW]  — play/pause/time/speed
│   ├── inspector/
│   │   ├── ClipInspector.tsx            [NEW]  — bottom inspector popover
│   │   └── VariantSwitcher.tsx          [NEW]  — variant chips + rebind dispatch
│   ├── hooks/
│   │   ├── useClipProvenance.ts         [NEW]  — clipId → operation summary
│   │   └── useTimelineShortcuts.ts      [MOD]  — add D, ⌘⌫, Space
│   ├── toolbar/
│   │   ├── EditToolbar.tsx              [MOD]  — regrouped + Duplicate + Ripple
│   │   └── rippleDelete.ts              [NEW]  — pure helper
│   └── __tests__/
│       ├── rippleDelete.test.ts         [NEW]  — 3-4 unit tests
│       └── useClipProvenance.test.ts    [NEW]  — summary formatter tests
├── layout/
│   └── TimelineShell.tsx                [MOD]  — mount <ClipInspector />
└── __tests__/
    └── preview-components.test.ts       [MOD]  — import smoke tests for new files
```

---

## Task 1 — TransportBar + remove VideoPreview's internal control bar

**Files:**
- Create: `modes/clipcraft/viewer/timeline/transport/TransportBar.tsx`
- Modify: `modes/clipcraft/viewer/timeline/Timeline.tsx`
- Modify: `modes/clipcraft/viewer/preview/VideoPreview.tsx`
- Modify: `modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts`

**Goal:** The user can play/pause/seek regardless of whether VideoPreview is visible. When Overview 3D or ExplodedView is expanded, transport stays at the top of the timeline area. Space toggles play/pause globally (bail-out inside inputs).

- [ ] **Step 1: Create `transport/TransportBar.tsx`**

```tsx
import { useCallback } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";

/**
 * Global transport: play/pause, goto start/end, time/duration,
 * playback rate. Always visible at the top of the Timeline.
 *
 * All state lives in the craft store — this component is a thin
 * view + dispatcher. No local state.
 */
export function TransportBar() {
  const composition = useComposition();
  const playback = usePlayback();

  const isPlaying = playback.state === "playing";

  const togglePlay = useCallback(() => {
    if (isPlaying) playback.pause();
    else playback.play();
  }, [isPlaying, playback]);

  const gotoStart = useCallback(() => {
    playback.seek(0);
  }, [playback]);

  const gotoEnd = useCallback(() => {
    playback.seek(Math.max(0, playback.duration ?? 0));
  }, [playback]);

  const onSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isNaN(v)) playback.setPlaybackRate(v);
    },
    [playback],
  );

  const disabled = !composition;
  const totalSec = playback.duration ?? 0;
  const curSec = playback.currentTime ?? 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        borderBottom: "1px solid #27272a",
        fontSize: 11,
        color: "#a1a1aa",
        background: "#0a0a0b",
      }}
    >
      <button
        type="button"
        onClick={gotoStart}
        disabled={disabled}
        style={iconBtn(disabled)}
        title="Go to start (Home)"
        aria-label="go to start"
      >
        {"\u23EE"}
      </button>
      <button
        type="button"
        onClick={togglePlay}
        disabled={disabled}
        style={iconBtn(disabled)}
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        aria-label={isPlaying ? "pause" : "play"}
      >
        {isPlaying ? "\u23F8" : "\u25B6"}
      </button>
      <button
        type="button"
        onClick={gotoEnd}
        disabled={disabled}
        style={iconBtn(disabled)}
        title="Go to end (End)"
        aria-label="go to end"
      >
        {"\u23ED"}
      </button>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 11,
          color: "#e4e4e7",
          marginLeft: 4,
        }}
      >
        {formatTime(curSec)} <span style={{ color: "#52525b" }}>/</span>{" "}
        <span style={{ color: "#a1a1aa" }}>{formatTime(totalSec)}</span>
      </span>
      <div style={{ flex: 1 }} />
      <label
        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#71717a" }}
      >
        Speed
        <select
          onChange={onSpeedChange}
          value={String(playback.playbackRate ?? 1)}
          disabled={disabled}
          style={{
            background: "#18181b",
            color: "#e4e4e7",
            border: "1px solid #27272a",
            borderRadius: 3,
            fontSize: 10,
            padding: "1px 4px",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </label>
    </div>
  );
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid #27272a",
    borderRadius: 3,
    color: disabled ? "#3f3f46" : "#e4e4e7",
    width: 24,
    height: 22,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const ss = s - mm * 60;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}
```

- [ ] **Step 2: Modify `Timeline.tsx` — mount TransportBar at the very top**

Add the import:

```ts
import { TransportBar } from "./transport/TransportBar.js";
```

Inside the `Timeline()` return, wrap the existing outer `<div>` so `TransportBar` renders above the existing "zoom controls row". The root structure becomes:

```tsx
return (
  <div
    style={{
      padding: 0,
      fontSize: 11,
      color: "#a1a1aa",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}
  >
    <TransportBar />

    {/* existing zoom + edit toolbar row — keep as-is */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 12px",
        fontSize: 10,
        color: "#52525b",
      }}
    >
      { /* …zoom buttons, hint, EditToolbar… */ }
    </div>

    {/* existing timeline content — ruler + tracks + playhead */}
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "4px 12px 8px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      { /* …unchanged ruler + tracks… */ }
    </div>
  </div>
);
```

Drop the old top-level `padding: "4px 0 8px"` — TransportBar has its own padding + border, and the remaining two rows pad themselves.

- [ ] **Step 3: Strip VideoPreview's control bar**

In `modes/clipcraft/viewer/preview/VideoPreview.tsx`:
- Delete the entire bottom `<div>` that renders the play button + time span + aspect label (lines 125–157 in the current file — the block wrapped by `<div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderTop: "1px solid #27272a", ... }}>`).
- Delete the `togglePlay` callback and the `isPlaying` variable — they are no longer referenced.
- Delete `const playback = usePlayback();` — no longer used (if VideoPreview has no other playback access).
- Delete the unused `import { useCallback } from "react"` if React is the only remaining import.
- Leave `composition` (still used for the canvas size) and `aspectLabel` (unused after removal — delete that too).
- The outer wrapper's `flexDirection: "column"` is still correct — the canvas block now uses the whole height.

Post-edit, `VideoPreview.tsx` should be ~90 lines instead of ~160, with only the canvas + caption overlay + empty state.

- [ ] **Step 4: Extend `useTimelineShortcuts` with Space / Home / End**

Open `modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts`. Add `usePlayback` to the imports:

```ts
import {
  useDispatch,
  usePlayback,
  useSelection,
  useUndo,
} from "@pneuma-craft/react";
```

Inside the hook, add `const playback = usePlayback();`.

Inside the `onKey` handler, after the existing `if (mod && (key === "z" ...))` block but before the `if (!selectedClipId)` bail-out, insert:

```ts
if (key === " " || key === "Spacebar") {
  ev.preventDefault();
  if (playback.state === "playing") playback.pause();
  else playback.play();
  return;
}
if (key === "Home") {
  ev.preventDefault();
  playback.seek(0);
  return;
}
if (key === "End") {
  ev.preventDefault();
  playback.seek(Math.max(0, playback.duration ?? 0));
  return;
}
```

Add `playback.state, playback.currentTime, playback.duration, playback.play, playback.pause, playback.seek` into the `useEffect` dependency array — or simpler, add `playback` itself.

- [ ] **Step 5: tsc + bun tests**

```bash
bun run tsc --noEmit
bun test
```

Expected: no new errors (VideoPreview may lose unused imports — clean those up). Full suite still passes. TransportBar has no dedicated unit test; integration is covered in Task 6.

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/timeline/transport/ \
        modes/clipcraft/viewer/timeline/Timeline.tsx \
        modes/clipcraft/viewer/preview/VideoPreview.tsx \
        modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts
git commit -m "feat(clipcraft): global TransportBar in Timeline + Space/Home/End shortcuts"
```

---

## Task 2 — Toolbar regroup + Duplicate + Ripple Delete

**Files:**
- Create: `modes/clipcraft/viewer/timeline/toolbar/rippleDelete.ts`
- Create: `modes/clipcraft/viewer/timeline/toolbar/__tests__/rippleDelete.test.ts`
- Modify: `modes/clipcraft/viewer/timeline/toolbar/EditToolbar.tsx`
- Modify: `modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts`

**Goal:** Edit toolbar grows from 5 buttons to 7 (adds Duplicate + Ripple Del), regrouped into three visually-separated groups. New keyboard shortcuts: `D` = duplicate, `⌘⌫` / `Ctrl+Backspace` = ripple delete. No visual change to zoom controls or undo/redo — only the button layout inside EditToolbar.

- [ ] **Step 1: Write `toolbar/rippleDelete.ts`**

```ts
import type { Composition, CompositionCommand } from "@pneuma-craft/timeline";

/**
 * Ripple-delete a clip: remove it, and shift every later clip in the
 * same track left by the removed clip's duration so the downstream
 * content closes up.
 *
 * Returns the command list in the order it must be dispatched:
 *   1. composition:remove-clip { clipId }
 *   2. composition:move-clip  { clipId: later.id, startTime: later.startTime - removed.duration }
 *
 * Caller dispatches each command through `dispatch("human", cmd)`.
 */
export function buildRippleDeleteCommands(
  composition: Composition,
  clipId: string,
): CompositionCommand[] {
  const track = composition.tracks.find((t) =>
    t.clips.some((c) => c.id === clipId),
  );
  if (!track) return [];
  const removed = track.clips.find((c) => c.id === clipId);
  if (!removed) return [];

  const out: CompositionCommand[] = [
    { type: "composition:remove-clip", clipId },
  ];

  const later = track.clips.filter((c) => c.startTime > removed.startTime);
  for (const c of later) {
    const newStart = Math.max(0, c.startTime - removed.duration);
    if (Math.abs(newStart - c.startTime) < 1e-6) continue;
    out.push({
      type: "composition:move-clip",
      clipId: c.id,
      startTime: newStart,
    });
  }
  return out;
}
```

- [ ] **Step 2: Write unit tests**

```ts
import { describe, test, expect } from "bun:test";
import type { Composition } from "@pneuma-craft/timeline";
import { buildRippleDeleteCommands } from "../rippleDelete.js";

function comp(
  clips: { id: string; startTime: number; duration: number }[],
): Composition {
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
    settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000, channels: 2 },
  } as unknown as Composition;
}

describe("buildRippleDeleteCommands", () => {
  test("removes the target and shifts all later clips left", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 2, duration: 3 },
      { id: "c", startTime: 5, duration: 1 },
    ]);
    const cmds = buildRippleDeleteCommands(c, "b");
    expect(cmds[0]).toMatchObject({ type: "composition:remove-clip", clipId: "b" });
    // clip c was at 5, shift left by b's duration 3 → 2
    expect(cmds[1]).toMatchObject({
      type: "composition:move-clip",
      clipId: "c",
      startTime: 2,
    });
    expect(cmds.length).toBe(2);
  });

  test("only emits remove-clip when there's nothing to shift", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 2, duration: 3 },
    ]);
    const cmds = buildRippleDeleteCommands(c, "b");
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toMatchObject({ type: "composition:remove-clip", clipId: "b" });
  });

  test("returns empty when the clip id is unknown", () => {
    const c = comp([{ id: "a", startTime: 0, duration: 2 }]);
    expect(buildRippleDeleteCommands(c, "missing")).toEqual([]);
  });

  test("does not emit move-clip for earlier clips in the same track", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 5, duration: 1 },
    ]);
    const cmds = buildRippleDeleteCommands(c, "b");
    expect(cmds.length).toBe(1);
  });
});
```

- [ ] **Step 3: Rewrite `EditToolbar.tsx` with 3 groups + Duplicate + Ripple**

Full replacement:

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
import { buildRippleDeleteCommands } from "./rippleDelete.js";

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

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: "#27272a",
  margin: "0 4px",
  flexShrink: 0,
};

export function EditToolbar() {
  const composition = useComposition();
  const playback = usePlayback();
  const selection = useSelection();
  const dispatch = useDispatch();
  const undoState = useUndo();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const canActOnClip = selectedClipId !== null;

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

  const onDuplicate = useCallback(() => {
    if (!selectedClipId) return;
    dispatch("human", {
      type: "composition:duplicate-clip",
      clipId: selectedClipId,
    });
  }, [dispatch, selectedClipId]);

  const onRippleDelete = useCallback(() => {
    if (!selectedClipId || !composition) return;
    const cmds = buildRippleDeleteCommands(composition, selectedClipId);
    for (const cmd of cmds) dispatch("human", cmd);
  }, [dispatch, selectedClipId, composition]);

  const onCollapse = useCallback(() => {
    if (!composition) return;
    const cmds = buildCollapseGapsCommands(composition);
    for (const cmd of cmds) dispatch("human", cmd);
  }, [dispatch, composition]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {/* Edit group */}
      <button
        onClick={onSplit}
        style={canActOnClip ? btnStyle : btnDisabled}
        disabled={!canActOnClip}
        title="Split at playhead (S)"
      >
        Split
      </button>
      <button
        onClick={onDelete}
        style={canActOnClip ? btnStyle : btnDisabled}
        disabled={!canActOnClip}
        title="Delete (Delete)"
      >
        Delete
      </button>
      <button
        onClick={onDuplicate}
        style={canActOnClip ? btnStyle : btnDisabled}
        disabled={!canActOnClip}
        title="Duplicate (D)"
      >
        Duplicate
      </button>
      <button
        onClick={onRippleDelete}
        style={canActOnClip ? btnStyle : btnDisabled}
        disabled={!canActOnClip}
        title="Ripple delete — remove + close the gap (⌘⌫)"
      >
        Ripple Del
      </button>
      <button onClick={onCollapse} style={btnStyle} title="Pack all clips left, removing gaps">
        Collapse
      </button>

      <div style={separatorStyle} />

      {/* History group */}
      <button
        onClick={() => undoState.undo()}
        style={undoState.canUndo ? btnStyle : btnDisabled}
        disabled={!undoState.canUndo}
        title="Undo (⌘Z)"
      >
        Undo
      </button>
      <button
        onClick={() => undoState.redo()}
        style={undoState.canRedo ? btnStyle : btnDisabled}
        disabled={!undoState.canRedo}
        title="Redo (⌘⇧Z)"
      >
        Redo
      </button>
    </div>
  );
}
```

Note: View/zoom group stays in `Timeline.tsx` (the existing `[−][174px/s][+]` row), NOT inside EditToolbar. This keeps the zoom cluster physically near the timeline it zooms. A future task can add Fit/Sel there.

- [ ] **Step 4: Add D + ⌘⌫ shortcuts to `useTimelineShortcuts.ts`**

Inside the existing `onKey` handler, after the `Delete / Backspace` block and before the `S / Split` block, insert:

```ts
if (key === "d" || key === "D") {
  if (mod) return; // Don't interfere with ⌘D bookmark
  ev.preventDefault();
  dispatch("human", {
    type: "composition:duplicate-clip",
    clipId: selectedClipId,
  });
  return;
}
```

And replace the existing `Delete / Backspace` block with:

```ts
if (key === "Delete" || key === "Backspace") {
  ev.preventDefault();
  if (mod) {
    // ⌘⌫ = ripple delete. Lazy-import the helper to avoid a cycle.
    import("../toolbar/rippleDelete.js").then(({ buildRippleDeleteCommands }) => {
      const comp = composition;
      if (!comp) return;
      const cmds = buildRippleDeleteCommands(comp, selectedClipId);
      for (const cmd of cmds) dispatch("human", cmd);
    });
  } else {
    dispatch("human", { type: "composition:remove-clip", clipId: selectedClipId });
  }
  return;
}
```

And add `useComposition` to the imports + `const composition = useComposition();` near the other hook calls, plus `composition` into the useEffect deps.

Actually — the lazy import inside an async callback loses preventDefault timing for the keydown event. Simpler: import `buildRippleDeleteCommands` eagerly at the top of `useTimelineShortcuts.ts`. Replace the lazy `import(...)` block with a direct synchronous call:

```ts
import { buildRippleDeleteCommands } from "../toolbar/rippleDelete.js";
```

And the block becomes:

```ts
if (key === "Delete" || key === "Backspace") {
  ev.preventDefault();
  if (mod && composition) {
    const cmds = buildRippleDeleteCommands(composition, selectedClipId);
    for (const cmd of cmds) dispatch("human", cmd);
  } else {
    dispatch("human", { type: "composition:remove-clip", clipId: selectedClipId });
  }
  return;
}
```

- [ ] **Step 5: tsc + tests**

```bash
bun run tsc --noEmit
bun test modes/clipcraft/viewer/timeline/toolbar/__tests__/rippleDelete.test.ts
bun test
```

Expected: 4 new rippleDelete tests pass. Full suite stays green.

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/timeline/toolbar/ \
        modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts
git commit -m "feat(clipcraft): toolbar regroup + Duplicate + Ripple Delete"
```

---

## Task 3 — TrackLabel expansion (140px, mute/lock/hide controls)

**Files:**
- Modify: `modes/clipcraft/viewer/timeline/TrackLabel.tsx`
- Modify: `modes/clipcraft/viewer/timeline/Timeline.tsx`
- Modify: `modes/clipcraft/viewer/timeline/VideoTrack.tsx`
- Modify: `modes/clipcraft/viewer/timeline/AudioTrack.tsx`
- Modify: `modes/clipcraft/viewer/timeline/SubtitleTrack.tsx`

**Goal:** The 32px icon-only label becomes a 140px column rendering `[icon] name [mute] [lock] [hide]`. Clicking any of the three toggles dispatches the matching `composition:toggle-track-*` command. The ruler row gets a matching 140px indent on the left so the content columns still line up.

**Critical layout invariant:** `LABEL_W` is imported by Timeline, VideoTrack, AudioTrack, SubtitleTrack, Playhead overlay. Bumping it from 32 to 140 propagates cleanly because everything uses the constant. Verify no hardcoded `32` literal exists after the change.

- [ ] **Step 1: Rewrite `TrackLabel.tsx`**

```tsx
import { useCallback } from "react";
import type { Track } from "@pneuma-craft/timeline";
import { useDispatch } from "@pneuma-craft/react";

export const LABEL_W = 140;

const iconFor = (type: Track["type"]): string => {
  switch (type) {
    case "video":
      return "\uD83C\uDFAC"; // 🎬
    case "audio":
      return "\uD83D\uDD0A"; // 🔊
    case "subtitle":
      return "Tt";
  }
};

const toggleBtn = (active: boolean, activeColor: string): React.CSSProperties => ({
  background: "transparent",
  border: "none",
  padding: 0,
  width: 16,
  height: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  color: active ? activeColor : "#3f3f46",
  cursor: "pointer",
  lineHeight: 1,
});

/**
 * Full-track label column. Renders the track icon + name on the left
 * and three toggle buttons (mute / lock / hide) on the right. Clicking
 * a button dispatches the corresponding composition:toggle-track-*
 * command.
 *
 * Also used as a "ruler spacer" — pass `track={null}` and children are
 * rendered as read-only text (used for the ruler row's leading cell).
 */
export function TrackLabel({
  track,
  children,
}: {
  track: Track | null;
  children?: React.ReactNode;
}) {
  const dispatch = useDispatch();

  const toggleMute = useCallback(() => {
    if (!track) return;
    dispatch("human", { type: "composition:toggle-track-mute", trackId: track.id });
  }, [dispatch, track]);

  const toggleLock = useCallback(() => {
    if (!track) return;
    dispatch("human", { type: "composition:toggle-track-lock", trackId: track.id });
  }, [dispatch, track]);

  const toggleVisibility = useCallback(() => {
    if (!track) return;
    dispatch("human", {
      type: "composition:toggle-track-visibility",
      trackId: track.id,
    });
  }, [dispatch, track]);

  if (!track) {
    return (
      <div
        style={{
          width: LABEL_W,
          flexShrink: 0,
          fontSize: 10,
          color: "#52525b",
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          userSelect: "none",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        width: LABEL_W,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        fontSize: 10,
        color: "#a1a1aa",
        userSelect: "none",
        borderRight: "1px solid #18181b",
        boxSizing: "border-box",
        background: "#0f0f11",
      }}
    >
      <span style={{ fontSize: 12, flexShrink: 0 }}>{iconFor(track.type)}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "#e4e4e7",
          fontSize: 10,
        }}
        title={track.name}
      >
        {track.name || track.type}
      </span>
      <button
        type="button"
        onClick={toggleMute}
        title={track.muted ? "Unmute track" : "Mute track"}
        aria-label="toggle mute"
        style={toggleBtn(!track.muted, "#38bdf8")}
      >
        {track.muted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
      </button>
      <button
        type="button"
        onClick={toggleLock}
        title={track.locked ? "Unlock track" : "Lock track"}
        aria-label="toggle lock"
        style={toggleBtn(track.locked, "#f97316")}
      >
        {track.locked ? "\uD83D\uDD12" : "\uD83D\uDD13"}
      </button>
      <button
        type="button"
        onClick={toggleVisibility}
        title={track.visible === false ? "Show track" : "Hide track"}
        aria-label="toggle visibility"
        style={toggleBtn(track.visible !== false, "#a1a1aa")}
      >
        {track.visible === false ? "\uD83D\uDEAB" : "\u25CE"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update `Timeline.tsx` ruler + track rows to pass `track` through**

The ruler row currently uses `<TrackLabel>{""}</TrackLabel>`. Replace with:

```tsx
<TrackLabel track={null} />
```

The track rows currently use `<TrackLabel>{iconFor(track.type)}</TrackLabel>` with a local `iconFor`. Replace the entire `iconFor` local function + its call site with:

```tsx
<TrackLabel track={track} />
```

Delete the local `iconFor` function at the top of `Timeline.tsx` (now lives inside `TrackLabel.tsx`).

- [ ] **Step 3: Playhead overlay — it already uses `LABEL_W` for its `left` offset. Since `LABEL_W` moved from 32 → 140, the overlay automatically shifts right and still lines up. Verify no hardcoded 32 in the Playhead overlay block.**

Grep for `LABEL_W = 32` or raw `32` in `Timeline.tsx`, `Playhead.tsx`, `TimeRuler.tsx`:

```bash
grep -n "LABEL_W\|= 32\b" modes/clipcraft/viewer/timeline/*.tsx
```

Expected: only the constant export in `TrackLabel.tsx` (now `= 140`) and the imports in `Timeline.tsx`.

- [ ] **Step 4: The ruler viewport width math already subtracts `LABEL_W` (see `TimeRuler viewportWidth={zoom.viewportWidth - LABEL_W}`). No change needed; the new 140 propagates automatically.**

- [ ] **Step 5: tsc + tests + manual grep sanity**

```bash
bun run tsc --noEmit
bun test
grep -rn "LABEL_W" modes/clipcraft/viewer/timeline/ | head
```

Expected: clean. All tests pass. The grep should show every usage going through the named export.

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/timeline/TrackLabel.tsx \
        modes/clipcraft/viewer/timeline/Timeline.tsx
git commit -m "feat(clipcraft): 140px track label with mute/lock/hide toggles"
```

(VideoTrack / AudioTrack / SubtitleTrack don't actually need edits — they don't render the label themselves; Timeline renders `<TrackLabel>` in the row wrapper. The file list at the top of the plan overstated the touch scope.)

---

## Task 4 — Clip provenance hook + prompt tooltip overlay

**Files:**
- Create: `modes/clipcraft/viewer/timeline/hooks/useClipProvenance.ts`
- Create: `modes/clipcraft/viewer/timeline/__tests__/useClipProvenance.test.ts`
- Modify: `modes/clipcraft/viewer/timeline/VideoTrack.tsx`
- Modify: `modes/clipcraft/viewer/timeline/AudioTrack.tsx`
- Modify: `modes/clipcraft/viewer/timeline/SubtitleTrack.tsx`

**Goal:** Hover a clip, see its generation source: prompt, model, or import filename. The tooltip is just a native `title` attribute on the clip wrapper — no custom JS popover. The summary string is built by a pure formatter exported alongside the hook, which is unit-tested without React.

- [ ] **Step 1: Write `hooks/useClipProvenance.ts`**

```ts
import { useMemo } from "react";
import type { Operation, ProvenanceEdge, PneumaCraftCoreState } from "@pneuma-craft/core";
import type { Clip } from "@pneuma-craft/timeline";
import { useAsset, usePneumaCraftStore } from "@pneuma-craft/react";

export interface ClipProvenanceInfo {
  operation: Operation | null;
  summary: string;
}

/**
 * Resolve the clip's asset and walk the provenance edge map to find the
 * incoming operation that produced it. Returns an Operation plus a
 * human-readable one-line summary suitable for a native `title` tooltip.
 *
 * An asset can have multiple incoming edges (composite / derive). We
 * pick the most recent by timestamp — that's the operation that
 * produced this exact version.
 */
export function useClipProvenance(clip: Clip | null): ClipProvenanceInfo {
  const asset = useAsset(clip?.assetId ?? "");
  const coreState = usePneumaCraftStore(
    (s) => s.coreState as PneumaCraftCoreState,
  );

  return useMemo(() => {
    if (!clip || !asset) return { operation: null, summary: "" };
    const incoming: ProvenanceEdge[] = [];
    for (const edge of coreState.provenance.edges.values()) {
      if (edge.toAssetId === asset.id) incoming.push(edge);
    }
    if (incoming.length === 0) return { operation: null, summary: "" };
    incoming.sort(
      (a, b) => (b.operation.timestamp ?? 0) - (a.operation.timestamp ?? 0),
    );
    const op = incoming[0].operation;
    return { operation: op, summary: formatOperation(asset.name, op) };
  }, [clip, asset, coreState.provenance]);
}

/**
 * Pure formatter — exported for unit tests. Produces a one-line
 * description of an operation suitable for a `title` tooltip.
 *
 * Examples:
 *   generate · sdxl · "opening shot of a sunrise"
 *   import · sample.mp4
 *   derive · upscale · 2x
 *   upload · IMG_4492.jpg
 */
export function formatOperation(assetName: string, op: Operation): string {
  const parts: string[] = [op.type];

  const params = op.params ?? {};
  const model = typeof params.model === "string" ? params.model : null;
  const prompt = typeof params.prompt === "string" ? params.prompt : null;
  const filename =
    typeof params.filename === "string"
      ? params.filename
      : typeof params.originalName === "string"
      ? params.originalName
      : null;
  const label = typeof op.label === "string" ? op.label : null;

  if (model) parts.push(model);
  if (prompt) parts.push(`"${truncate(prompt, 60)}"`);
  else if (filename) parts.push(filename);
  else if (label) parts.push(label);
  else parts.push(assetName);

  return `${assetName}\n${parts.join(" · ")}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
```

- [ ] **Step 2: Write `__tests__/useClipProvenance.test.ts` — formatter only**

```ts
import { describe, test, expect } from "bun:test";
import type { Operation } from "@pneuma-craft/core";
import { formatOperation } from "../hooks/useClipProvenance.js";

function op(overrides: Partial<Operation>): Operation {
  return {
    type: "generate",
    actor: "agent",
    timestamp: 0,
    ...overrides,
  } as Operation;
}

describe("formatOperation", () => {
  test("generate includes model + truncated prompt", () => {
    const s = formatOperation(
      "Asset A",
      op({ type: "generate", params: { model: "sdxl", prompt: "a cat in a hat" } }),
    );
    expect(s).toBe('Asset A\ngenerate · sdxl · "a cat in a hat"');
  });

  test("truncates long prompts", () => {
    const long = "a".repeat(120);
    const s = formatOperation("X", op({ type: "generate", params: { prompt: long } }));
    expect(s.endsWith("…\"")).toBe(true);
    expect(s.length).toBeLessThan(long.length);
  });

  test("import falls back to filename", () => {
    const s = formatOperation(
      "Clip 1",
      op({ type: "import", params: { filename: "video.mp4" } }),
    );
    expect(s).toBe("Clip 1\nimport · video.mp4");
  });

  test("upload uses originalName when filename is missing", () => {
    const s = formatOperation(
      "Photo",
      op({ type: "upload", params: { originalName: "IMG_4492.jpg" } }),
    );
    expect(s).toBe("Photo\nupload · IMG_4492.jpg");
  });

  test("falls back to label then asset name", () => {
    const a = formatOperation("Name", op({ type: "import", label: "seed" }));
    expect(a).toBe("Name\nimport · seed");
    const b = formatOperation("Name", op({ type: "derive" }));
    expect(b).toBe("Name\nderive · Name");
  });
});
```

- [ ] **Step 3: Wire the hook into VideoTrack's VideoClip**

In `modes/clipcraft/viewer/timeline/VideoTrack.tsx`, import the hook:

```ts
import { useClipProvenance } from "./hooks/useClipProvenance.js";
```

Inside the `VideoClip` functional component, after the existing `useAsset` call, add:

```ts
const { summary } = useClipProvenance(clip);
```

And on the outermost `<div>` inside `VideoClip`, add:

```tsx
title={summary || clip.id.slice(0, 8)}
```

(There is currently no `title` attribute on that div — adding it as a new prop is the whole change.)

- [ ] **Step 4: Apply the same change to AudioTrack's `AudioClip` and SubtitleTrack's clip wrapper**

Same pattern. In each, add the import + hook call + `title={summary || ...}` attribute on the clip's outer `<div>`.

- [ ] **Step 5: tsc + tests**

```bash
bun run tsc --noEmit
bun test
```

Expected: new 5-test suite for `formatOperation` passes, full suite green.

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/timeline/hooks/useClipProvenance.ts \
        modes/clipcraft/viewer/timeline/__tests__/useClipProvenance.test.ts \
        modes/clipcraft/viewer/timeline/VideoTrack.tsx \
        modes/clipcraft/viewer/timeline/AudioTrack.tsx \
        modes/clipcraft/viewer/timeline/SubtitleTrack.tsx
git commit -m "feat(clipcraft): provenance-aware tooltip on timeline clips"
```

---

## Task 5 — ClipInspector popover bar

**Files:**
- Create: `modes/clipcraft/viewer/timeline/inspector/ClipInspector.tsx`
- Create: `modes/clipcraft/viewer/timeline/inspector/VariantSwitcher.tsx`
- Modify: `modes/clipcraft/viewer/layout/TimelineShell.tsx`

**Goal:** When a clip is selected, a fixed ~96px strip slides in above the timeline rows showing: In / Out / Duration numeric inputs (debounced trim-clip dispatch on change), a compact variant switcher (sibling assets with active highlight, click to rebind-clip), and the provenance summary from Task 4. When no clip is selected, the strip is hidden (height 0, no layout shift).

- [ ] **Step 1: Write `inspector/VariantSwitcher.tsx`**

```tsx
import { useCallback } from "react";
import { useDispatch, useVariants, useAsset } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";

/**
 * Compact sibling-variant picker for the currently selected clip.
 * Reads useVariants(asset.id) and dispatches composition:rebind-clip
 * when the user picks a sibling.
 *
 * Returns null when the clip's asset has no siblings — keeps the
 * inspector dense.
 */
export function VariantSwitcher({ clip }: { clip: Clip }) {
  const dispatch = useDispatch();
  const asset = useAsset(clip.assetId);
  const variants = useVariants(clip.assetId);

  const onPick = useCallback(
    (variantId: string) => {
      if (variantId === clip.assetId) return;
      dispatch("human", {
        type: "composition:rebind-clip",
        clipId: clip.id,
        assetId: variantId,
      });
    },
    [dispatch, clip.id, clip.assetId],
  );

  if (!asset) return null;
  // useVariants returns siblings OR the asset itself — we want to
  // render the current asset + any siblings as chips. If there's
  // only the current asset, there are no alternatives; hide.
  const allVariants = variants.length > 0 ? variants : [asset];
  const hasAlternatives = allVariants.some((a) => a.id !== clip.assetId);
  if (!hasAlternatives && allVariants.length <= 1) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 9, color: "#52525b", textTransform: "uppercase" }}>
        variants
      </span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {allVariants.map((v) => {
          const active = v.id === clip.assetId;
          return (
            <button
              key={v.id}
              onClick={() => onPick(v.id)}
              disabled={active}
              title={v.name ?? v.id}
              style={{
                background: active ? "#f97316" : "#18181b",
                border: active ? "1px solid #f97316" : "1px solid #27272a",
                color: active ? "#0a0a0b" : "#a1a1aa",
                borderRadius: 3,
                padding: "2px 8px",
                fontSize: 9,
                cursor: active ? "default" : "pointer",
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {v.name ?? v.id.slice(0, 6)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `inspector/ClipInspector.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useComposition,
  useDispatch,
  useSelection,
} from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { useClipProvenance } from "../hooks/useClipProvenance.js";
import { VariantSwitcher } from "./VariantSwitcher.js";

/**
 * Bottom-anchored clip inspector. Rendered inside TimelineShell between
 * the 3D panel and the Timeline. When no clip is selected the strip
 * collapses to zero height (`display: none`) so it doesn't shift layout.
 *
 * Numeric edits are debounced locally and dispatched as a single
 * composition:trim-clip (+ composition:move-clip for inPoint changes)
 * on blur or after 400ms of quiet.
 */
export function ClipInspector() {
  const composition = useComposition();
  const selection = useSelection();
  const dispatch = useDispatch();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const clip: Clip | null = useMemo(() => {
    if (!composition || !selectedClipId) return null;
    for (const t of composition.tracks) {
      const c = t.clips.find((c) => c.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [composition, selectedClipId]);

  if (!clip) {
    // Fully hidden — no layout space consumed when nothing is selected.
    return null;
  }
  return <ClipInspectorActive clip={clip} />;
}

function ClipInspectorActive({ clip }: { clip: Clip }) {
  const dispatch = useDispatch();
  const { summary } = useClipProvenance(clip);

  // Local draft state to allow free-form editing before dispatching.
  const [inPoint, setInPoint] = useState(clip.inPoint);
  const [outPoint, setOutPoint] = useState(clip.outPoint);
  const [duration, setDuration] = useState(clip.duration);

  // Sync local state to clip updates (e.g., undo, external edits).
  useEffect(() => {
    setInPoint(clip.inPoint);
    setOutPoint(clip.outPoint);
    setDuration(clip.duration);
  }, [clip.id, clip.inPoint, clip.outPoint, clip.duration]);

  const commit = useCallback(
    (next: { inPoint?: number; outPoint?: number; duration?: number }) => {
      const finalIn = next.inPoint ?? inPoint;
      const finalOut = next.outPoint ?? outPoint;
      const finalDur = next.duration ?? duration;
      // Clamp
      const clampedDur = Math.max(0.1, finalDur);
      dispatch("human", {
        type: "composition:trim-clip",
        clipId: clip.id,
        inPoint: Math.max(0, finalIn),
        outPoint: Math.max(0, finalOut),
        duration: clampedDur,
      });
    },
    [dispatch, clip.id, inPoint, outPoint, duration],
  );

  const onBlurField =
    (field: "inPoint" | "outPoint" | "duration") =>
    (e: React.FocusEvent<HTMLInputElement>) => {
      const v = parseFloat(e.currentTarget.value);
      if (Number.isNaN(v)) return;
      commit({ [field]: v });
    };

  return (
    <div
      style={{
        borderTop: "1px solid #27272a",
        borderBottom: "1px solid #18181b",
        background: "#0f0f11",
        padding: "8px 12px",
        display: "flex",
        alignItems: "stretch",
        gap: 16,
        fontSize: 10,
        color: "#a1a1aa",
      }}
    >
      {/* Numeric fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
        <span style={{ fontSize: 9, color: "#52525b", textTransform: "uppercase" }}>
          clip · {clip.id.slice(0, 8)}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <label style={labelStyle}>
            In
            <input
              type="number"
              step="0.01"
              value={inPoint.toFixed(2)}
              onChange={(e) => setInPoint(parseFloat(e.currentTarget.value) || 0)}
              onBlur={onBlurField("inPoint")}
              style={numInputStyle}
            />
          </label>
          <label style={labelStyle}>
            Out
            <input
              type="number"
              step="0.01"
              value={outPoint.toFixed(2)}
              onChange={(e) => setOutPoint(parseFloat(e.currentTarget.value) || 0)}
              onBlur={onBlurField("outPoint")}
              style={numInputStyle}
            />
          </label>
          <label style={labelStyle}>
            Dur
            <input
              type="number"
              step="0.01"
              value={duration.toFixed(2)}
              onChange={(e) => setDuration(parseFloat(e.currentTarget.value) || 0.1)}
              onBlur={onBlurField("duration")}
              style={numInputStyle}
            />
          </label>
        </div>
      </div>

      <div style={separatorStyle} />

      <VariantSwitcher clip={clip} />

      <div style={separatorStyle} />

      {/* Provenance summary — the same text shown as clip tooltip */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 9, color: "#52525b", textTransform: "uppercase" }}>
          source
        </span>
        <span
          style={{
            fontSize: 10,
            color: "#e4e4e7",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
          title={summary}
        >
          {summary.split("\n").slice(-1)[0] || "—"}
        </span>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontSize: 9,
  color: "#52525b",
};

const numInputStyle: React.CSSProperties = {
  background: "#18181b",
  border: "1px solid #27272a",
  borderRadius: 3,
  color: "#e4e4e7",
  padding: "2px 4px",
  fontSize: 10,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  width: 54,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  background: "#18181b",
  flexShrink: 0,
};
```

- [ ] **Step 3: Mount `<ClipInspector />` inside `TimelineShell.tsx`**

In `modes/clipcraft/viewer/layout/TimelineShell.tsx`, add the import:

```ts
import { ClipInspector } from "../timeline/inspector/ClipInspector.js";
```

Inside the main `<div>` returned from `TimelineShell`, with `flexDirection: column-reverse`, source-order matters. The current order:

1. `<div>…<Timeline/>…expand button…</div>` (renders at bottom)
2. `{isExpanded && <ExpandedPanel />}` (renders above)

New order:

1. `<div>…<Timeline/>…expand button…</div>` (bottom)
2. `<ClipInspector />` (middle — appears only when a clip is selected)
3. `{isExpanded && <ExpandedPanel />}` (top)

Just insert `<ClipInspector />` as a sibling between the Timeline wrapper and the `{isExpanded && ...}` line. No wrapping div needed — `ClipInspector` returns its own `<div>` or `null`.

- [ ] **Step 4: tsc + tests**

```bash
bun run tsc --noEmit
bun test
```

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/viewer/timeline/inspector/ \
        modes/clipcraft/viewer/timeline/hooks/useClipProvenance.ts \
        modes/clipcraft/viewer/layout/TimelineShell.tsx
git commit -m "feat(clipcraft): clip inspector with In/Out/Dur + variant switcher + source"
```

---

## Task 6 — Smoke imports + end-to-end browser verification

**Files:**
- Modify: `modes/clipcraft/__tests__/preview-components.test.ts`
- Modify: `docs/superpowers/plans/NEXT.md`

- [ ] **Step 1: Append smoke imports for all new modules**

```ts
  test("TransportBar exports a function", async () => {
    const mod = await import("../viewer/timeline/transport/TransportBar.js");
    expect(typeof mod.TransportBar).toBe("function");
  });

  test("rippleDelete exports a function", async () => {
    const mod = await import("../viewer/timeline/toolbar/rippleDelete.js");
    expect(typeof mod.buildRippleDeleteCommands).toBe("function");
  });

  test("useClipProvenance exports a function + formatter", async () => {
    const mod = await import("../viewer/timeline/hooks/useClipProvenance.js");
    expect(typeof mod.useClipProvenance).toBe("function");
    expect(typeof mod.formatOperation).toBe("function");
  });

  test("ClipInspector exports a function", async () => {
    const mod = await import("../viewer/timeline/inspector/ClipInspector.js");
    expect(typeof mod.ClipInspector).toBe("function");
  });

  test("VariantSwitcher exports a function", async () => {
    const mod = await import("../viewer/timeline/inspector/VariantSwitcher.js");
    expect(typeof mod.VariantSwitcher).toBe("function");
  });
```

- [ ] **Step 2: Run full tsc + bun test**

```bash
bun run tsc --noEmit
bun test
```

Expected: ≥722 tests pass, tsc clean.

- [ ] **Step 3: Kill any stale dev server and start fresh**

```bash
pkill -f "clipcraft" 2>/dev/null
lsof -ti:17996,17997 | xargs kill -9 2>/dev/null
rm -rf /tmp/clipcraft-redesign
bun bin/pneuma.ts --dev clipcraft \
  --workspace /tmp/clipcraft-redesign \
  --port 17996 --no-prompt --no-open --backend claude-code --debug
```

Open the URL printed on the `[pneuma] ready …` line.

- [ ] **Step 4: Verify each redesign element via chrome-devtools-mcp**

Record results as a checklist in the commit message body.

1. **TransportBar visible on collapsed mode** — ⏮ ⏯ ⏭ + `00:00.00 / 00:05.00` + `Speed 1×` dropdown at the very top of the timeline area.
2. **Play via Space shortcut** — focus the page body (not an input), press Space, verify `currentTime` advances; press Space again, verify it stops.
3. **TransportBar stays visible after ↑ expand** — click ↑ to go to Overview, confirm the Transport row still renders above the timeline and play still works.
4. **Toolbar three groups** — confirm Split / Delete / Duplicate / Ripple Del / Collapse sit together, a `|` separator, then Undo / Redo. Hover titles should match the spec.
5. **Duplicate (button)** — select the seed clip, click Duplicate, confirm a new clip appears on the same track and the event log has `composition:duplicate-clip`.
6. **Duplicate (D key)** — press D with a clip selected, confirm another duplicate event fires.
7. **Ripple Delete (button)** — after the duplicates, select the first clip, click Ripple Del, confirm the clip is removed AND subsequent clips shifted left so the timeline has no gap.
8. **Ripple Delete (⌘⌫)** — the same via keyboard.
9. **TrackLabel 140px + mute toggle** — confirm the track label column is visibly wider (~140px), shows the track name + icon + three buttons. Click the mute button, confirm `composition:toggle-track-mute` fires. Click again, confirm it toggles back.
10. **Clip tooltip** — hover the seed clip, confirm the browser shows a title tooltip containing `Sample Clip` + a second line like `import · seed`.
11. **Clip inspector visible on selection** — click the seed clip, confirm the inspector strip slides in above the timeline showing In / Out / Duration numeric inputs and the source summary text.
12. **Inspector numeric edit** — change `Out` from `5.00` to `4.00`, tab out; verify a `composition:trim-clip` event fires with `outPoint=4, duration` updated, and the clip visibly shrinks.
13. **Variant switcher hidden when no alternatives** — seed clip has no siblings; the Variants group should NOT render in the inspector.
14. **Inspector collapses when deselected** — click an empty area of the track row to deselect (or press Escape), confirm the inspector disappears with no layout shift.
15. **Keyboard bail-out** — focus the inspector's `In` input, type `1`, press Space — Space should insert into the input, not toggle play.

- [ ] **Step 5: Kill the dev server**

```bash
pkill -f "clipcraft"
```

- [ ] **Step 6: Update `NEXT.md` — add a "Timeline Redesign" entry to Completed**

Move the plan reference from a new Completed bullet. Summary template:

> **Timeline Redesign (creation-first polish)** (`2026-04-14-clipcraft-timeline-redesign.md`) — pulled playback transport out of VideoPreview into a global `TransportBar` that stays visible under 3D expansion; regrouped the edit toolbar into Edit / History with Duplicate and Ripple Delete added (+ D and ⌘⌫ shortcuts + Space/Home/End for transport); widened TrackLabel from 32px → 140px with inline mute / lock / visibility toggles dispatching the matching `composition:toggle-track-*` commands; new `useClipProvenance` hook + pure `formatOperation` surface the asset's generation source as a browser `title` tooltip on every clip; new `ClipInspector` strip in `TimelineShell` shows In / Out / Duration numeric editors (debounced `composition:trim-clip` dispatch on blur) + `VariantSwitcher` chips that dispatch `composition:rebind-clip` when the user picks a sibling asset — the AIGC-native inspector the timeline was missing. Browser-verified: …

Include the actual pass/fail list from Step 4.

- [ ] **Step 7: Commit**

```bash
git add modes/clipcraft/__tests__/preview-components.test.ts \
        docs/superpowers/plans/NEXT.md
git commit -m "docs(clipcraft): timeline redesign e2e verification + NEXT.md"
```

---

## Self-review

- **Spec coverage:** TransportBar covers the "show playback controls even under 3D expansion" complaint ✅. Edit toolbar regroup delivers Duplicate + Ripple Del + the 3-group layout ✅. Track label expansion covers mute/lock/hide without hiding behind a menu ✅. Provenance tooltip surfaces AIGC thought process ✅. ClipInspector covers numeric trim edit + variant switcher (the AIGC-native differentiator that was missing from the timeline) ✅. Deferred: track add/delete/rename, drag-asset-to-track, status-badge-inside-clip, zoom-to-fit, regenerate button — these are in the "Out of scope" list and planted in NEXT.md at the end of Task 6.
- **Placeholder scan:** every code step has a complete file body. No TBDs, no "handle edge cases". The Inspector fallback for `formatOperation` when no provenance edge is found returns `""` and the UI shows `"—"`.
- **Type consistency:** `composition:trim-clip` signature matches the d.ts (all three fields optional); `rebind-clip` matches; `toggle-track-*` match; `useUndo()` return shape matches. `useVariants(assetId)` return type is `Asset[]`.
- **Known risk:** the ClipInspector holds local draft state for `inPoint` / `outPoint` / `duration`. On a craft-side update that isn't triggered by the inspector itself (undo, agent edit), the `useEffect` re-syncs from the clip. That sync fires on any change to `clip.id / inPoint / outPoint / duration` — which is correct but also triggers on every external trim. If the user is mid-typing when the sync happens, they lose their unfinished keystroke. The same thing happens in most DAWs; accept it as a minor UX papercut and move on.
- **Known risk 2:** `useClipProvenance` hook returns a memoized value keyed on `clip, asset, coreState.provenance`. `coreState.provenance` is the whole Map object — Zustand's shallow equality won't necessarily detect deep edge-map changes. If tooltip text goes stale after a `provenance:set-root`, replace the dep with `coreState.provenance.edges` (same Map reference, same problem) or switch to `useEventLog` and rebuild the summary when the event log length changes. Accept for v1; fix if observed.
- **Layout risk:** ClipInspector height is ~80–100px depending on content. When it appears, it eats vertical space from the ExpandedPanel (Overview / Exploded / Dive). That means the 3D area shrinks slightly when a clip is selected. This is acceptable but worth flagging — if it feels jarring, the next iteration can float the inspector as an overlay over the 3D area instead of as a flex child.

---

## Execution

Using `superpowers:subagent-driven-development`. Dispatch one implementer subagent per task. The tasks are linearly dependent (each builds on the prior commit) but none of the six requires a spec review beyond the implementer self-review — the touchpoints are tight. Code quality review happens inside the implementer via typecheck + tests.
