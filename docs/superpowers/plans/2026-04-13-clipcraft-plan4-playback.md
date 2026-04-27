# Plan 4 — Playback + Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ClipCraft renders a real video preview canvas wired to `@pneuma-craft/video`'s `PlaybackEngine` and proves a single playable clip from `project.json` actually plays inside the viewer.

**Architecture:** Re-use upstream wiring as much as possible. `PneumaCraftProvider` (already mounted by `ClipCraftPreview`) creates a Zustand store that owns a `PlaybackEngine` lazily and auto-reloads it whenever `composition` reference changes (`packages/react/src/store.ts:140-160`). The mode's job is exactly three things:

1. Mount a `<canvas>` whose pixel size matches `composition.settings.{width,height}` and let upstream's headless `<PreviewRoot>` render frames into it via `subscribeToFrames`.
2. Drive play/pause/seek through `usePlayback()` with a minimal control bar (play button, time readout, seek input).
3. Make the seed `project.json` produce a non-zero-duration composition with a real, playable asset so the engine has something to load on first mount.

No engine glue, no asset preloading, no scene→composition mapping (the craft store IS the composition). Legacy's bespoke `<video>` + seek-gen dance from `clipcraft-legacy/viewer/usePlayback.ts` is NOT ported — it's structurally incompatible and the upstream engine replaces it cleanly.

**Tech Stack:** React 19, `@pneuma-craft/react` (`PreviewRoot`, `usePlayback`, `useComposition`), `@pneuma-craft/video` (lazy-loaded by the store on first `play()`), Bun test for unit coverage. No new deps.

**Out of scope (deferred):**
- Timeline UI / scrubber visualization (Plan 5).
- Audio mixer / volume controls (Plan 5+).
- Export (Plan 8).
- Any UI for adding clips — composition mutations still happen by editing `project.json`.
- Polished UI design — Plan 4 ships a functional canvas + controls, not a styled player.

---

## File Structure

New files under `modes/clipcraft/viewer/`:

- `PreviewCanvas.tsx` — wraps `<PreviewRoot>`, owns the `<canvas>` element sized from `useComposition().settings`.
- `PlaybackControls.tsx` — minimal control bar (play/pause toggle, time readout, seek input) wired to `usePlayback()`.
- `PreviewPanel.tsx` — composes `PreviewCanvas` + `PlaybackControls` with a tiny layout shell. This is the single component `ClipCraftPreview` mounts.

Modified files:

- `modes/clipcraft/viewer/ClipCraftPreview.tsx` — replace the `StateDump`-only body with `<PreviewPanel />` (StateDump moves into a collapsible debug pane below the preview).
- `modes/clipcraft/viewer/StateDump.tsx` — no behavioral change; only its parent layout changes.
- `modes/clipcraft/seed/project.json` — add a real ready asset + one track + one clip so the seed produces a non-zero-duration playable composition on a fresh workspace.
- `modes/clipcraft/seed/assets/sample.jpg` — new file. A small, license-clean static image checked in as the seed playable. ~50KB max.
- `modes/clipcraft/manifest.ts` — add `seed/assets/sample.jpg` to `init.seedFiles` so `pneuma launch clipcraft` copies it into a fresh workspace alongside `project.json`.

New tests under `modes/clipcraft/__tests__/`:

- `preview-canvas.test.tsx` — render `PreviewCanvas` inside a `PneumaCraftProvider` with a synthetic composition; assert the `<canvas>` element exists with the expected `width`/`height` attributes.
- `playback-controls.test.tsx` — render `PlaybackControls` with a mocked `usePlayback`; assert button click dispatches `play()`, time readout reflects `currentTime`, seek input dispatches `seek(t)`.

No test for the engine itself — that lives in `@pneuma-craft/video`'s own suite. The mode only validates wiring shape.

---

## Task 1: Add a real playable asset to the seed

**Files:**
- Create: `modes/clipcraft/seed/assets/sample.jpg` (binary, ~30-50KB)
- Modify: `modes/clipcraft/seed/project.json`
- Modify: `modes/clipcraft/manifest.ts:39-44` (the `init.seedFiles` map)
- Test: `modes/clipcraft/__tests__/persistence.test.ts` (add a round-trip case for the new seed shape)

**Why first:** The viewer changes in Tasks 2-5 will be tested against this seed shape. Doing seed first means every later test has a real composition to bind to, and the manual smoke test at the end of the plan has a deterministic starting state.

- [ ] **Step 1: Pick or create the seed image**

Use a small public-domain or generated placeholder JPG. ~640x360, ~30KB. Save to `modes/clipcraft/seed/assets/sample.jpg`.

If unsure where to source: generate one with `bun -e 'process.stdout.write(Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAQDAwQDAwQEBAQFBQQFBwsHBwYGBw4KCggLEA4REA8ODw8SFBkWEhMYEw8PFh0WGBoaHBwcERYfIR8bIRkbHBv/2wBDAQUFBQcGBw0HBw0bEg8SGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxv/wAARCAFoAlgDASIA", "base64"))' > modes/clipcraft/seed/assets/sample.jpg` — that's a JPG SOI marker, NOT a valid image. Don't actually do this. Instead, fail loudly and ask the controller to provide a real image, OR generate one in pure code with `Bun.write` and a tiny valid 16x16 JPEG byte sequence (look up "smallest valid JPEG" on the web — there's a 119-byte minimal one). Either is fine; the test only checks the file exists and is non-empty.

- [ ] **Step 2: Update `seed/project.json`**

Replace the current pending-asset-only seed with this shape:

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
      "type": "image",
      "uri": "assets/sample.jpg",
      "name": "Sample Frame",
      "metadata": { "width": 640, "height": 360 },
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
  ]
}
```

The pending asset stays so the existing `Asset.status` + AIGC narrative still has a live example. The new `seed-asset-sample` is the playable one.

- [ ] **Step 3: Update `manifest.ts` seedFiles**

Add the new asset file to the seed file map:

```ts
init: {
  contentCheckPattern: "project.json",
  seedFiles: {
    "modes/clipcraft/seed/project.json": "project.json",
    "modes/clipcraft/seed/assets/sample.jpg": "assets/sample.jpg",
  },
},
```

- [ ] **Step 4: Add a persistence round-trip test for the new seed shape**

In `modes/clipcraft/__tests__/persistence.test.ts`, add:

```ts
import seedJson from "../seed/project.json" with { type: "json" };

test("seed project.json round-trips through parse → serialize byte-equal", () => {
  const raw = JSON.stringify(seedJson, null, 2) + "\n";
  const parsed = parseProjectFile(raw);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  // hydrate-then-serialize would require a real craft store; here we just
  // verify the parser accepts the seed and the JSON survives a re-format.
  const reformatted = formatProjectJson(parsed.value);
  expect(reformatted).toBe(raw);
});
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
bun test modes/clipcraft/__tests__/persistence.test.ts
```

Expected: PASS (the new test plus all existing).

- [ ] **Step 6: Verify the existing hydration-integration test still passes**

```bash
bun test modes/clipcraft/__tests__/hydration-integration.test.ts
```

Expected: PASS. The new seed has more entities (1 track, 1 clip, 2 assets, 2 provenance edges) so this test exercises more of the hydration pipeline than before. If it fails, the failure points at a real missing case in `projectFileToCommands` or `serializeProject` — fix it before moving on.

- [ ] **Step 7: Commit**

```bash
git add modes/clipcraft/seed/ modes/clipcraft/manifest.ts modes/clipcraft/__tests__/persistence.test.ts
git commit -m "feat(clipcraft): seed real playable asset + clip in project.json

Plan 4 prep — give a fresh ClipCraft workspace a non-zero-duration
composition so the new PlaybackEngine has something to load and render
on first mount. The pending-generation example asset stays for the AIGC
narrative; a new seed-asset-sample with assets/sample.jpg is the playable
one referenced by track-video-1 / clip-1 over [0, 5)s."
```

---

## Task 2: PreviewCanvas component

**Files:**
- Create: `modes/clipcraft/viewer/PreviewCanvas.tsx`
- Test: `modes/clipcraft/__tests__/preview-canvas.test.tsx`

**Why this shape:** `<PreviewRoot>` from `@pneuma-craft/react` is a render-prop that owns the `canvasRef` and the `subscribeToFrames` effect. The mode mounts the actual `<canvas>` element and binds the ref. Canvas pixel dimensions come from `useComposition().settings.{width, height}`; CSS dimensions are responsive (`width: 100%; height: auto`) so the player fits any layout. `aspect-ratio` from `composition.settings.aspectRatio` keeps the box stable while loading.

- [ ] **Step 1: Write the failing test**

```tsx
// modes/clipcraft/__tests__/preview-canvas.test.tsx
import { describe, test, expect } from "bun:test";
import { render } from "@testing-library/react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import { PreviewCanvas } from "../viewer/PreviewCanvas.js";
import { createWorkspaceAssetResolver } from "../viewer/assetResolver.js";

describe("PreviewCanvas", () => {
  test("renders a canvas element inside a PneumaCraftProvider", () => {
    const resolver = createWorkspaceAssetResolver();
    const { container } = render(
      <PneumaCraftProvider assetResolver={resolver}>
        <PreviewCanvas />
      </PneumaCraftProvider>,
    );
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
  });

  test("renders a placeholder when composition is null (no clip loaded yet)", () => {
    const resolver = createWorkspaceAssetResolver();
    const { container, getByText } = render(
      <PneumaCraftProvider assetResolver={resolver}>
        <PreviewCanvas />
      </PneumaCraftProvider>,
    );
    // Fresh provider with no composition dispatched → placeholder visible.
    expect(getByText(/no composition/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test modes/clipcraft/__tests__/preview-canvas.test.tsx
```

Expected: FAIL with "Cannot find module '../viewer/PreviewCanvas.js'".

- [ ] **Step 3: Implement `PreviewCanvas.tsx`**

```tsx
// modes/clipcraft/viewer/PreviewCanvas.tsx
import { PreviewRoot, useComposition } from "@pneuma-craft/react";

/**
 * Headless canvas binding for the upstream PlaybackEngine.
 *
 * Uses PreviewRoot's render-prop to receive a canvasRef that is wired to
 * the store's frame subscription. This component owns the actual <canvas>
 * element and sizes it from composition.settings — width/height are pixel
 * dimensions used by the engine compositor; CSS sizing is responsive so
 * the canvas fits its parent.
 *
 * When no composition is loaded yet (fresh workspace before hydration,
 * or hydration produced no composition), shows a placeholder instead of
 * a 0×0 canvas so the layout doesn't collapse.
 */
export function PreviewCanvas() {
  const composition = useComposition();

  if (!composition) {
    return (
      <div
        data-testid="preview-empty"
        className="cc-preview-empty"
        style={{
          aspectRatio: "16 / 9",
          background: "#0a0a0a",
          color: "#71717a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
        }}
      >
        no composition loaded
      </div>
    );
  }

  const { width, height, aspectRatio } = composition.settings;

  return (
    <PreviewRoot>
      {({ canvasRef, isLoading }) => (
        <div
          className="cc-preview-canvas-wrap"
          style={{
            position: "relative",
            background: "#0a0a0a",
            aspectRatio: aspectRatio.replace(":", " / "),
            overflow: "hidden",
          }}
        >
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
            }}
          />
          {isLoading && (
            <div
              className="cc-preview-loading"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#a1a1aa",
                fontFamily: "system-ui, sans-serif",
                fontSize: 12,
                pointerEvents: "none",
              }}
            >
              loading…
            </div>
          )}
        </div>
      )}
    </PreviewRoot>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test modes/clipcraft/__tests__/preview-canvas.test.tsx
```

Expected: PASS (both tests). If `@testing-library/react` isn't already a dev dep, install it: `bun add -D @testing-library/react @testing-library/dom`. Check `package.json` first — it may already be present from another mode's tests.

- [ ] **Step 5: Run tsc**

```bash
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/PreviewCanvas.tsx modes/clipcraft/__tests__/preview-canvas.test.tsx
git commit -m "feat(clipcraft): PreviewCanvas component wraps PreviewRoot

Plan 4 step 2 — headless canvas binding to @pneuma-craft/video's
PlaybackEngine via @pneuma-craft/react's PreviewRoot render-prop.
Sized from composition.settings.{width,height,aspectRatio}; renders
a placeholder when composition is null."
```

---

## Task 3: PlaybackControls component

**Files:**
- Create: `modes/clipcraft/viewer/PlaybackControls.tsx`
- Test: `modes/clipcraft/__tests__/playback-controls.test.tsx`

**Why this shape:** `usePlayback()` returns the full control surface (`{ state, currentTime, duration, play, pause, seek, ... }`). The control bar reads those values and dispatches store actions. The first interaction (`play()`) doubles as the user gesture that unlocks the browser's audio context — no special handling needed.

- [ ] **Step 1: Write the failing test**

```tsx
// modes/clipcraft/__tests__/playback-controls.test.tsx
import { describe, test, expect, mock } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import { PlaybackControls } from "../viewer/PlaybackControls.js";

// Mock @pneuma-craft/react's usePlayback for unit-isolation.
const playMock = mock(() => {});
const pauseMock = mock(() => {});
const seekMock = mock((_t: number) => {});

mock.module("@pneuma-craft/react", () => ({
  usePlayback: () => ({
    state: "ready" as const,
    currentTime: 1.5,
    duration: 5,
    playbackRate: 1,
    loop: null,
    play: playMock,
    pause: pauseMock,
    seek: seekMock,
    setPlaybackRate: () => {},
    setLoop: () => {},
  }),
}));

describe("PlaybackControls", () => {
  test("renders play button when state is ready/paused", () => {
    const { getByRole } = render(<PlaybackControls />);
    const btn = getByRole("button", { name: /play/i });
    expect(btn).toBeTruthy();
  });

  test("clicking play calls usePlayback().play", () => {
    playMock.mockClear();
    const { getByRole } = render(<PlaybackControls />);
    fireEvent.click(getByRole("button", { name: /play/i }));
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  test("displays current time and duration", () => {
    const { getByText } = render(<PlaybackControls />);
    expect(getByText(/1\.5\s*\/\s*5/)).toBeTruthy();
  });

  test("seek input dispatches seek(value)", () => {
    seekMock.mockClear();
    const { getByRole } = render(<PlaybackControls />);
    const slider = getByRole("slider");
    fireEvent.change(slider, { target: { value: "2.75" } });
    expect(seekMock).toHaveBeenCalledTimes(1);
    expect(seekMock).toHaveBeenCalledWith(2.75);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test modes/clipcraft/__tests__/playback-controls.test.tsx
```

Expected: FAIL with "Cannot find module '../viewer/PlaybackControls.js'".

- [ ] **Step 3: Implement `PlaybackControls.tsx`**

```tsx
// modes/clipcraft/viewer/PlaybackControls.tsx
import { usePlayback } from "@pneuma-craft/react";

const formatTime = (t: number): string => {
  if (!Number.isFinite(t)) return "0";
  return t.toFixed(1);
};

export function PlaybackControls() {
  const { state, currentTime, duration, play, pause, seek } = usePlayback();
  const isPlaying = state === "playing";
  const canSeek = duration > 0;

  return (
    <div
      className="cc-playback-controls"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        background: "#18181b",
        color: "#e4e4e7",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      <button
        type="button"
        onClick={isPlaying ? pause : play}
        aria-label={isPlaying ? "pause" : "play"}
        disabled={!canSeek}
        style={{
          padding: "4px 10px",
          background: "#27272a",
          color: "#fafafa",
          border: "1px solid #3f3f46",
          borderRadius: 4,
          cursor: canSeek ? "pointer" : "not-allowed",
        }}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        role="slider"
        min={0}
        max={canSeek ? duration : 1}
        step={0.01}
        value={currentTime}
        disabled={!canSeek}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span
        className="cc-time-readout"
        style={{ fontVariantNumeric: "tabular-nums", minWidth: 80, textAlign: "right" }}
      >
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test modes/clipcraft/__tests__/playback-controls.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run tsc**

```bash
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/viewer/PlaybackControls.tsx modes/clipcraft/__tests__/playback-controls.test.tsx
git commit -m "feat(clipcraft): PlaybackControls bar wired to usePlayback

Plan 4 step 3 — minimal play/pause + seek + time readout against
@pneuma-craft/react's usePlayback. First click on Play doubles as the
user gesture that unlocks AudioContext; no special handling needed."
```

---

## Task 4: PreviewPanel + integrate into ClipCraftPreview

**Files:**
- Create: `modes/clipcraft/viewer/PreviewPanel.tsx`
- Modify: `modes/clipcraft/viewer/ClipCraftPreview.tsx`
- Test: `modes/clipcraft/__tests__/preview-panel.test.tsx`

**Why this shape:** `PreviewPanel` is the layout glue — preview canvas on top, controls below, debug `StateDump` underneath in a collapsed panel. Keeping it separate from `ClipCraftPreview` means the parent can stay focused on Source<T> wiring (it already owns `providerKey` remount + `currentTitleRef`) and the visual structure lives in one file.

- [ ] **Step 1: Write the failing test**

```tsx
// modes/clipcraft/__tests__/preview-panel.test.tsx
import { describe, test, expect } from "bun:test";
import { render } from "@testing-library/react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import { PreviewPanel } from "../viewer/PreviewPanel.js";
import { createWorkspaceAssetResolver } from "../viewer/assetResolver.js";

describe("PreviewPanel", () => {
  test("renders preview canvas region and controls region", () => {
    const resolver = createWorkspaceAssetResolver();
    const { container } = render(
      <PneumaCraftProvider assetResolver={resolver}>
        <PreviewPanel hydrationError={null} />
      </PneumaCraftProvider>,
    );
    expect(container.querySelector(".cc-preview-canvas-wrap, .cc-preview-empty")).not.toBeNull();
    expect(container.querySelector(".cc-playback-controls")).not.toBeNull();
  });

  test("forwards hydrationError to StateDump", () => {
    const resolver = createWorkspaceAssetResolver();
    const { getByText } = render(
      <PneumaCraftProvider assetResolver={resolver}>
        <PreviewPanel hydrationError="parse failed: bad json" />
      </PneumaCraftProvider>,
    );
    expect(getByText(/parse failed: bad json/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test modes/clipcraft/__tests__/preview-panel.test.tsx
```

Expected: FAIL with "Cannot find module '../viewer/PreviewPanel.js'".

- [ ] **Step 3: Implement `PreviewPanel.tsx`**

```tsx
// modes/clipcraft/viewer/PreviewPanel.tsx
import { PreviewCanvas } from "./PreviewCanvas.js";
import { PlaybackControls } from "./PlaybackControls.js";
import { StateDump } from "./StateDump.js";

export interface PreviewPanelProps {
  hydrationError: string | null;
}

/**
 * Layout shell for ClipCraft's editing surface.
 *
 *   [ PreviewCanvas      ]   ← drawn by upstream PlaybackEngine
 *   [ PlaybackControls   ]
 *   [ StateDump (debug)  ]
 *
 * StateDump survives Plan 4 as a debug pane until the real timeline /
 * inspector lands in Plan 5+. It's not collapsible yet — that's noise
 * not worth the code right now.
 */
export function PreviewPanel({ hydrationError }: PreviewPanelProps) {
  return (
    <div
      className="cc-preview-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        padding: 12,
        background: "#09090b",
        color: "#e4e4e7",
        overflow: "auto",
      }}
    >
      <PreviewCanvas />
      <PlaybackControls />
      <div style={{ marginTop: 12, opacity: 0.85 }}>
        <StateDump hydrationError={hydrationError} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify PreviewPanel passes**

```bash
bun test modes/clipcraft/__tests__/preview-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Update `ClipCraftPreview.tsx` to use `PreviewPanel`**

Open `modes/clipcraft/viewer/ClipCraftPreview.tsx`. Find the `SyncedBody` component (the child of `PneumaCraftProvider`). It currently returns `<StateDump hydrationError={...} />`. Change it to return `<PreviewPanel hydrationError={...} />`. Update the `StateDump` import to a `PreviewPanel` import. Leave everything else (the `useSource` wiring, `hasHydratedRef`, autosave effect, parent's `providerKey` subscribe) alone — that's all stable from Plan 3d.

Concrete diff:

```tsx
// at the top of the file, replace:
import { StateDump } from "./StateDump.js";
// with:
import { PreviewPanel } from "./PreviewPanel.js";

// inside SyncedBody, replace:
return <StateDump hydrationError={hydrationError} />;
// with:
return <PreviewPanel hydrationError={hydrationError} />;
```

- [ ] **Step 6: Run the full clipcraft test suite**

```bash
bun test modes/clipcraft 2>&1 | tail -10
```

Expected: all pass (existing 38 + the 7 new ones from Tasks 2-4 ≈ 45). If a hydration-integration test breaks because the seed change in Task 1 introduced new entities the test doesn't expect, fix the test to assert the new shape.

- [ ] **Step 7: Run tsc**

```bash
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
```

Expected: empty.

- [ ] **Step 8: Commit**

```bash
git add modes/clipcraft/viewer/PreviewPanel.tsx modes/clipcraft/viewer/ClipCraftPreview.tsx modes/clipcraft/__tests__/preview-panel.test.tsx
git commit -m "feat(clipcraft): PreviewPanel layout + wire into ClipCraftPreview

Plan 4 step 4 — preview canvas on top, controls below, StateDump
underneath as a debug pane until Plan 5 brings a real inspector.
ClipCraftPreview's Source<T> + providerKey wiring is unchanged."
```

---

## Task 5: Manual smoke test + ARCHITECTURE/NEXT update

**Files:**
- Modify: `modes/clipcraft/ARCHITECTURE.md`
- Modify: `docs/superpowers/plans/NEXT.md`

This task does NOT touch code. Its job is (a) verify Plan 4 actually works in a browser, (b) document what shipped, (c) flag any limitations the smoke test surfaces so they end up in NEXT.md instead of being forgotten.

- [ ] **Step 1: Visual verification**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
bun run dev clipcraft --workspace /tmp/clipcraft-plan4-smoke --backend claude-code --no-prompt --debug
```

Wait for the launcher to print the URL. Use `chrome-devtools-mcp` to navigate to it (per CLAUDE.md: *"After modifying viewer components, CSS, or any UI-facing code, use chrome-devtools-mcp to take a screenshot of the running dev server and verify the rendered result before reporting completion."*).

Verify by screenshot:
1. The preview canvas renders (not the empty placeholder) and shows the seed image as the first frame.
2. The play button is enabled.
3. Clicking play advances `currentTime`; the time readout updates.
4. The seek slider works; dragging it updates the canvas.
5. `StateDump` below shows the seed assets/composition with the new `track-video-1` entry.
6. Open devtools console: no errors related to `PlaybackEngine`, `AssetResolver`, or `subscribeToFrames`. AudioContext autoplay warnings are expected on first load and clear after the first Play click.

If any step fails, STOP. Diagnose. Common causes:
- `assets/sample.jpg` not actually copied to the workspace → check `seedFiles` mapping in manifest.
- `composition.duration` is 0 → check `clip.duration` made it through hydration via `projectFileToCommands`.
- `ImageBitmap` not produced → check the engine's compositor mode (default `canvas2d` should work everywhere).

- [ ] **Step 2: Take a reference screenshot**

Save the working preview screenshot somewhere temporary; you'll cite it in the commit message but don't check it into the repo.

- [ ] **Step 3: Update `modes/clipcraft/ARCHITECTURE.md`**

Add a new section after the "Sources" section: **"Playback (Plan 4)"**. Describe the wiring:

> ClipCraft's playback is delegated end-to-end to `@pneuma-craft/video`'s `PlaybackEngine`, which the upstream Zustand store (`@pneuma-craft/react`'s `createPneumaCraftStore`) creates lazily on first `play()` and auto-reloads whenever the `composition` reference changes. The mode mounts a `<canvas>` via `@pneuma-craft/react`'s `<PreviewRoot>` render-prop and dispatches play/pause/seek through `usePlayback()`. The mode does NOT call `engine.load()`, NOT call `engine.subscribeToFrames()`, NOT own the engine lifecycle — all of that is upstream's responsibility once the composition is in the store.

> The `AssetResolver` (`modes/clipcraft/viewer/assetResolver.ts`) implements the upstream contract: `resolveUrl(assetId): string` returns `"/content/<uri>"` and `fetchBlob(assetId): Promise<Blob>` fetches the same URL. Asset ids are currently treated as workspace-relative paths in the bootstrap; real content addressing arrives with the provenance layer in a later plan.

Also remove from the "Limitations" / "Status" section any line that says playback isn't implemented yet.

- [ ] **Step 4: Update `docs/superpowers/plans/NEXT.md`**

Move "Plan 4 — Playback + preview" from `## Upcoming` to `## Completed` with a short description matching what actually shipped (canvas + controls, no timeline UI, single playable seed clip). Reference the commit range.

If the smoke test surfaced any new limitation worth tracking, add it to the "Known limitations" section with a one-line description and the plan number where it'll be addressed.

- [ ] **Step 5: Run final verification**

```bash
bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]"
bun test 2>&1 | tail -10
```

Expected: tsc empty, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add modes/clipcraft/ARCHITECTURE.md docs/superpowers/plans/NEXT.md
git commit -m "docs(clipcraft): document Plan 4 playback + preview wiring

ClipCraft now mounts a real PlaybackEngine canvas via @pneuma-craft/react's
PreviewRoot and drives play/pause/seek through usePlayback(). Engine
lifecycle, frame subscription, and composition reload are all upstream's
responsibility — the mode only owns the canvas DOM, the control bar, and
a workspace AssetResolver. Smoke-tested with the new seed playable clip.

Closes Plan 4."
```

---

## Done When

- [ ] All 5 task commits land on `feat/clipcraft-by-pneuma-craft`.
- [ ] `bun test` reports all green (existing + ~7 new).
- [ ] `bun run tsc --noEmit` clean for `modes/clipcraft/`.
- [ ] Manual smoke test passes — the seed clip plays in the browser, the time readout advances, the seek slider works.
- [ ] `ARCHITECTURE.md` and `NEXT.md` updated.

## Out of scope (deferred to later plans)

- Timeline track / clip visualization (Plan 5).
- Audio mixer UI (Plan 5+).
- Asset library panel / drag-and-drop (Plan 6+).
- Export (Plan 8).
- MCP generation tools (Plan 9).
- Polished player UI / theming.

## Risks / unknowns

1. **`@pneuma-craft/video`'s `MediaDecoder` may not handle static image assets gracefully.** The seed uses an `image`-typed asset, not a video. The decoder is built for video frames; image assets may need a different code path inside the engine. If the smoke test fails specifically because the image asset can't decode, fall back to a real (small) MP4 seed file instead — a 2-second silent test pattern at 320x180 is ~50KB and will exercise the video path the engine is actually built for. Document the swap in the commit message; don't ship a broken seed.

2. **First-render flicker / 0×0 canvas.** If `composition` is briefly null on first mount, `<PreviewCanvas>` shows the placeholder. When hydration completes and composition arrives, the canvas mounts. Make sure this transition doesn't cause a layout shift that breaks the controls bar — the placeholder uses the same `aspect-ratio` so it should be stable, but verify in the smoke test.

3. **Audio autoplay policy on dev refresh.** Browser refreshes that bypass user gesture will fail to play audio until the user clicks. This is not a regression — it's the browser. Document in NEXT.md known-limitations only if the smoke test makes it a usability issue.
