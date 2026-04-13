# ClipCraft Architecture

> **Frame:** ClipCraft is a reference implementation of the [Pneuma Viewer–Agent Protocol](../../docs/reference/viewer-agent-protocol.md) on top of a structured domain model. It takes the protocol's file-centric design and shows that it scales up to a state-machine-backed editor without inventing a new runtime — by consuming the runtime's `Source<T>` abstraction for the one piece classic file-centric modes don't need: a viewer that also writes.
>
> **Status (2026-04-13):** Plans 1 + 2 + 3a + 3b + 3c landed, then the bidirectional sync layer was migrated off mode-local code onto the upstream `Source<T>` abstraction (commits `5319436`, `7582009`, `42bca41`, `06204f6`). Persistence is done end-to-end. No playback, no timeline UI, no interactive user dispatch yet. Plan 4 adds playback.

---

## The twist

Most Pneuma modes treat the workspace **file** as the source of truth: agent edits file, viewer parses file, user interacts with file. Doc, Draw, Webcraft all work this way.

ClipCraft's source of truth is a **craft store** — an event-sourced state machine from [`@pneuma-craft`](https://github.com/pandazki/pneuma-craft) with Assets, Composition, and a Provenance DAG. The file (`project.json`) is a **projection** of that store. Both the agent and the viewer can mutate the store:

- **Agent** mutates it by editing `project.json` (goes through Pneuma's existing file surface, which now arrives via the runtime's `Source<T>` instead of the raw `files` prop).
- **Viewer** mutates it by dispatching craft commands (user actions in Plan 4+; today, just hydration-replay) and serializing back through the same source.

Both sides must stay in sync. That used to be the job of a mode-local `useProjectSync` hook with three loop-protection refs. It is now the job of `Source<T>`, declared once in the manifest and consumed via `useSource`.

---

## File structure

```
modes/clipcraft/
├── manifest.ts               Mode declaration (watchPatterns, skill, init, sources.project)
├── pneuma-mode.ts            ModeDefinition — binds manifest + PreviewComponent + extractContext
├── persistence.ts            Pure domain logic (no React, no IO)
│                             ├ ProjectFile schema types
│                             ├ parseProjectFile       — JSON → validated ProjectFile
│                             ├ projectFileToCommands  — ProjectFile → CommandEnvelope[] (hydration)
│                             ├ serializeProject       — craft state → ProjectFile (inverse)
│                             └ formatProjectJson      — ProjectFile → 2-space-indent JSON
├── seed/project.json         Default content for fresh workspaces (single pending AIGC asset example)
├── skill/SKILL.md            Agent-facing skill (current status + domain vocab)
├── viewer/
│   ├── ClipCraftPreview.tsx  Default-exported React component. Consumes sources.project via useSource.
│   ├── assetResolver.ts      Minimal AssetResolver — /content/<id> URL mapping
│   └── StateDump.tsx         Read-only text renderer (Plan 2 debug UI; Plan 5 replaces it)
└── __tests__/
    ├── persistence.test.ts            Unit tests for persistence.ts (parse / serialize / format / hydrate)
    ├── hydration-integration.test.ts  Full-stack round-trip against a real TimelineCore
    └── craft-imports.test.ts          @pneuma-craft/* public API contract tests
```

The pure-domain code (`persistence.ts`) carries the round-trip guarantees; everything React-side is now thin enough to read in one sitting. The viewer-owned sync hook, the mode-local `api-client`, and the `externalEdit` helper all disappeared in commit `42bca41` — that work moved upstream into the runtime's source abstraction.

---

## How ClipCraft maps to the 6-direction protocol

The protocol defines six user/viewer/agent directions. ClipCraft implements a subset today:

| Direction | Protocol expectation | ClipCraft today | Wired via |
|---|---|---|---|
| **① User → Viewer: Interaction** | `onSelect`, `commands`, `onViewportChange` | **Partial: play/pause/seek, click-to-seek on timeline ruler, click-to-select-clip, zoom.** `PlaybackControls` and `Timeline` dispatch through `usePlayback()` + `useDispatch()`. Clip drag/resize/split, viewport, command menus still unwired. | Plan 4 (playback) / Plan 5 (timeline read-only) / Plan 5.5+ (clip edit) |
| **② Viewer → User: Rendering** | `files` prop drives render | `useSource(sources.project)` → hydrate craft store → `<PreviewRoot>` draws frames onto a `<canvas>` + `<Timeline>` ruler/rows/playhead + `StateDump` collapsed | `ClipCraftPreview` + `PreviewPanel` + `PreviewCanvas` + `PlaybackControls` + `timeline/Timeline` |
| **③ User → Agent: Intent** | Chat panel via WS | Standard, no mode customization | (default Pneuma chat) |
| **④ Agent → User: Response** | WS streaming | Standard | (default Pneuma chat) |
| **⑤ Agent → Viewer: Action** | `viewer_action` tool + `actionRequest` prop | **Not declared.** `manifest.viewerApi` is absent entirely. | Plan 5+ |
| **⑥ Viewer → Agent: Context & Notification** | `extractContext`, `onNotifyAgent` | Minimal: `<viewer-context mode="clipcraft" files="N">` | `pneuma-mode.ts:17-20`. Plan 10 will make it domain-aware. |

**What's intentionally not in the table**: the Viewer ↔ Agent write loop. In classic file-centric modes, the agent edits files and the viewer passively re-renders. In ClipCraft, the viewer **also writes** — autosave serializes craft state back to `project.json`. The protocol's six directions don't enumerate this, but the runtime now has built-in infrastructure for it.

### The seventh direction: Viewer → Disk, via `Source<T>`

```
⑦ Viewer ⇄ Disk: bidirectional sync, provided by the runtime
```

- **Why it exists:** with a structured domain model, user actions modify the *store*, not the file. Someone has to serialize the store back to disk so the agent can read it and the next session can rehydrate. Symmetrically, when the agent edits the file, the viewer needs to know whether the change came from itself (its own autosave echoing back) or from the agent (a real external edit that must rebuild the store).
- **How it works:** the manifest declares `sources.project` as a `json-file` source pointing at `project.json` with `parse` / `serialize` callbacks from `persistence.ts`. The viewer calls `useSource(sources.project)` and receives `{ value, write, status }`. Calls to `write()` are tagged on the server with `pendingSelfWrites`, so when chokidar echoes the change back, the source emits an event with `origin === "self"` instead of `"external"`. The viewer ignores self events; only `external` events bump the provider key to remount the craft store with fresh content.
- **Why it's safe:** the underlying `/api/files` endpoint already has path-traversal protection. The `json-file` provider reuses it; no mode-specific server route.
- **Why it's invisible to the agent:** the agent only sees `project.json` changes arrive in its file view. It doesn't care whether the change came from its own Edit tool or from the viewer's autosave — both flow through the same chokidar pipe. The origin tag is internal to the viewer/runtime.

This makes ClipCraft a **bidirectional implementation of direction ② + direction ⑦**, layered on top of a primitive (`Source<T>`) the runtime exposes to every mode that needs it. Cross-references: `core/types/source.ts` (the contract), `core/sources/json-file.ts` (the provider), `src/hooks/useSource.ts` (the React binding), `docs/migration/2.29-source-abstraction.md` (the runtime-side migration), `docs/superpowers/plans/clipcraft-source-migration.md` (the ClipCraft-side migration).

#### Historical note (pre-migration)

Before commit `42bca41`, ClipCraft owned all of this directly. A `useProjectSync` hook plus `lastAppliedRef`, `hydratedDiskRef`, an `externalEdit.ts` helper, and a mode-local `api-client.ts` together reverse-engineered "is this disk content my own echo, or did someone else write it?" by comparing strings against a shadow of the last value the viewer had committed. Three separate refs were needed because three distinct races overlapped (parent-vs-instance lifetime, StrictMode double-invocation, and the provider remount that followed an external edit). The migration replaced that bookkeeping with a single source contract that tags origin at the write site, removed roughly 300 lines of mode-local glue, and deleted the entire `viewer/hooks/` directory along with `externalEdit.ts`, `api-client.ts`, and their tests.

---

## Data flow

### A. Fresh mount / hydration (disk → craft store)

```
project.json on disk
      │
      ▼  chokidar (server-side, from manifest.watchPatterns)
Pneuma server
      │
      ▼  json-file source — parses raw JSON via persistence.parseProjectFile
useSource(sources.project) inside ClipCraftPreview
      │
      ▼  hydration effect runs once per provider mount
projectFileToCommands (envelope stream, per-command timestamps from on-disk createdAt / operation.timestamp)
      │
      ▼  store.dispatchEnvelope × N
@pneuma-craft Zustand store
      │   (Composition + Asset registry + Provenance DAG, events replayed into state)
      ▼
StateDump re-renders via useAssets / useComposition / useEventLog
```

**Key points:**
- Hydration is **replay, not parse-and-assign.** The ProjectFile becomes a sequence of `asset:register`, `provenance:set-root`, `composition:create`, `composition:add-track`, `composition:add-clip` commands. Craft's event log ends up holding the same sequence it would have if a human-authored the project live.
- `dispatchEnvelope` (Plan 3c) lets hydration preserve the on-disk `createdAt` and `operation.timestamp` exactly. Craft's standard `dispatch(actor, command)` stamps `Date.now()` internally, which would break round-trip.
- Title has no craft concept; `ClipCraftPreview` holds it in `currentTitleRef` (parent-owned, survives provider remount) and passes it into `serializeProject` as an out-of-band parameter.
- The hydration effect uses a `hasHydratedRef` instance guard so React 19 StrictMode double-invocation doesn't dispatch the same envelopes twice.

### B. Autosave (craft store → disk)

```
any craft command dispatch
      │
      ▼  eventCount (via useEventLog().length) changes
useEffect sets a 500ms setTimeout
      │   (last pending timer wins — debounces a burst)
      ▼
serializeProject(coreState, composition, currentTitleRef.current)
      │
      ▼
formatProjectJson  (2-space indent + trailing newline, byte-equal to what a human would write)
      │
      ▼  await writeProject(file)   ← from useSource
json-file source registers a pendingSelfWrite tag, then POST /api/files
      │
      ▼
server writes file → chokidar detects → source receives the change
      │
      ▼  pendingSelfWrites match → source emits { kind: "value", origin: "self" }
ClipCraftPreview's subscribe callback ignores self events
(no remount, no infinite loop)
```

**Key invariant:** `formatProjectJson(serializeProject(hydrate(seed))) === seed` as bytes. Plan 3b's Task 6 verified this E2E by asserting zero `POST /api/files` requests on fresh mount; the invariant is unchanged after the source migration — what changed is the *mechanism* protecting the loop, not the data round-trip. When any field drifts — different formatting, missing optional, non-preserved id, non-preserved timestamp — the hydration integration test catches it.

### C. External edit (agent → disk → craft store rebuild)

```
agent invokes Edit tool on project.json
      │
      ▼  filesystem write → chokidar → source
no pendingSelfWrite outstanding → source emits { kind: "value", origin: "external" }
      │
      ▼
ClipCraftPreview's subscribe callback bumps providerKey
      │
      ▼
PneumaCraftProvider remounts with a fresh craft store
      │
      ▼
SyncedBody mounts fresh — hasHydratedRef === false
      │
      ▼  hydration effect dispatches the new envelopes against the fresh store
StateDump re-renders against new state
```

**Why remount instead of diff-and-dispatch:** if we tried to dispatch the new commands into the *existing* store, craft would reject them as duplicates (Plan 3a's uniqueness checks). Even if we removed the uniqueness checks, the resulting store would contain both old and new assets side-by-side. Remounting forces a clean slate.

**Why subscribe directly instead of `useEffect` on `status.lastOrigin`:** back-to-back external edits would land the same `"external"` string into `status.lastOrigin`, and a `useEffect` keyed on it would not re-run. Subscribing to the source events fires once per actual event, which is exactly what we need for "bump providerKey on every external write".

**Cost:** external edits wipe in-memory state (future undo history, PlaybackEngine position). Acceptable today because there's nothing valuable in memory yet. Plan 4+ will revisit via diff-and-dispatch if playback interruption becomes painful.

---

## Loop protection: now a single concept

Pre-migration, `ClipCraftPreview` carried three refs (`lastAppliedRef`, `hydratedDiskRef`, `providerKey`) plus a `currentTitleRef`, each guarding a distinct race the others couldn't see. Post-migration there is one concept and one piece of state:

| What | Owner | Purpose |
|---|---|---|
| `pendingSelfWrites` (server-side, in the json-file source) | runtime | Echo-skip: when the viewer writes X and chokidar echoes X back, the source tags the event `origin: "self"` and the viewer ignores it. |
| `providerKey` (parent React state) | `ClipCraftPreview` | Store isolation: bumped when the source emits an `external` event so the craft store remounts with a clean slate. |
| `hasHydratedRef` (instance ref inside `SyncedBody`) | hook instance | StrictMode guard: stops the once-per-mount hydration effect from dispatching twice on the same mount. |
| `currentTitleRef` (parent ref) | `ClipCraftPreview` | Title side-channel — craft has no `title` concept, so the parent carries it across hydrate/serialize. Not loop-protection per se, same mechanism. |

There is no longer any cross-component coupling around resetting refs in the right order before remount. The `ClipCraftPreview.onExternalEdit` callback that used to reset `lastAppliedRef.current = null` before bumping `providerKey` is gone — that whole race went away with the source abstraction. See `viewer/ClipCraftPreview.tsx` for the live wiring.

---

## Domain mapping

| On-disk (`ProjectFile`) | In craft | Round-trip fidelity |
|---|---|---|
| `$schema` (literal `"pneuma-craft/project/v1"`) | — | Constant |
| `title` | `ClipCraftPreview.currentTitleRef` (side-channel) | Plan 3c title param to `serializeProject` |
| `composition.settings.{width,height,fps,aspectRatio}` | `Composition.settings` | via `composition:create` |
| `composition.tracks[].{id,type,name,muted,volume,locked,visible}` | `Composition.tracks[]` | id preserved by Plan 3a's explicit-id `composition:add-track` |
| `composition.tracks[].clips[].{id,assetId,startTime,duration,inPoint,outPoint,...}` | Clips inside tracks | id preserved by Plan 3a's explicit-id `composition:add-clip` |
| `composition.transitions[]` | `Composition.transitions` | Pass-through (currently unused) |
| `assets[].{id,type,uri,name,metadata,tags,status}` | `coreState.registry: Map<id, Asset>` | id and `status` preserved by Plan 3a + Plan 2's `AssetStatus` |
| `assets[].createdAt` | `Asset.createdAt` | Plan 3c's `dispatchEnvelope` preserves the caller-supplied timestamp |
| `provenance[].{toAssetId,fromAssetId,operation}` | `coreState.provenance.edges: Map<id, ProvenanceEdge>` | via `provenance:set-root` (null parent) or `provenance:link` |
| `provenance[].operation.{type,actor,agentId,timestamp,label,params}` | `Operation` | Plan 3c preserves `operation.timestamp` via envelope |

The `operation.params` field is intentionally `Record<string, unknown>` in craft. ClipCraft's AIGC convention (model / prompt / seed / costUsd / durationMs / providerJobId) lives at the schema documentation level — craft doesn't enforce it, and other craft consumers can use their own conventions.

---

## Testing shape

| Layer | File | What it locks down |
|---|---|---|
| **Unit (pure)** | `persistence.test.ts` | `parseProjectFile` (JSON / schema validation), `projectFileToCommands` (command sequence + timestamps + id preservation), `serializeProject` (all optional fields, null composition fallback, determinism), `formatProjectJson` (indent + newline) |
| **Integration** | `hydration-integration.test.ts` | Full round-trip against a real `TimelineCore`: hydrate `completeFile` → serialize → parse → hydrate again → deep-equal state including `createdAt` and `title`; stability check: second pass produces byte-identical output; duplicate-hydration throws |
| **Contract** | `craft-imports.test.ts` | `@pneuma-craft/*` public API lock-down — `createCore`, `createTimelineCore`, `createPlaybackEngine`, `createPneumaCraftStore`, `dispatchEnvelope` behavior, Asset.status undo/redo roundtrip. If craft ships a breaking change, this fails the mode's test suite immediately. |
| **Source provider (upstream)** | `core/sources/__tests__/` | `json-file` provider behavior — pendingSelfWrites tagging, parse/serialize roundtrip, external echo classification. Lives upstream because the provider is a runtime primitive, not mode-specific. |
| **E2E (manual)** | chrome-devtools-mcp + server log | Fresh mount → **zero `POST /api/files`** (the key loop-protection invariant); agent edits file → badge flips pending→ready without asset duplication; console has zero `[clipcraft] hydration envelope rejected` warnings |

The pure-function tests carry most of the weight; the integration test is the single canonical check that the round-trip composes. The mode no longer ships an `api-client.test.ts` or an `externalEdit` unit test — the equivalent coverage moved upstream when the underlying code did.

---

## Playback (Plan 4)

ClipCraft's playback is delegated end-to-end to `@pneuma-craft/video`'s `PlaybackEngine`. The engine is headless — it does not own a canvas. The upstream Zustand store (`@pneuma-craft/react`'s `createPneumaCraftStore`) instantiates it lazily on first `play()` and auto-reloads it whenever the `composition` reference changes. The mode is responsible for three things:

1. **Mounting a `<canvas>`** sized from `useComposition().settings.{width, height, aspectRatio}`. The canvas DOM and ref wiring come from `@pneuma-craft/react`'s headless `<PreviewRoot>` render-prop (`canvasRef`, `isLoading`, `isReady`). `PreviewRoot` internally subscribes via `store.subscribeToFrames` and calls `ctx.drawImage(frame.image, …)` on every rendered frame. ClipCraft's `PreviewCanvas.tsx` is a ~40-line wrapper that supplies the styled box + the `<canvas>` element and a "no composition loaded" placeholder for the pre-hydration window.

2. **Dispatching play/pause/seek** through `usePlayback()`, which exposes `{ state, currentTime, duration, play, pause, seek, … }` against the store. ClipCraft's `PlaybackControls.tsx` is a ~60-line button + range + time-readout bar. The first click on Play doubles as the user gesture that unlocks the browser's `AudioContext` — no special handling needed.

3. **Resolving craft asset ids to playable URLs**. The store calls `AssetResolver.resolveUrl(assetId)` and `AssetResolver.fetchBlob(assetId)` with opaque craft ids (e.g. `seed-asset-sample`) — NOT file paths. ClipCraft's `assetResolver.ts` extends the structural `AssetResolver` with a mutable id → uri map (`WorkspaceAssetResolver.setAssets(assets)`) and maps both calls to `/content/<uri>`. `ClipCraftPreview` refreshes the map in an effect keyed on `project` (the `useSource` value) so every project-level update re-populates it before the engine asks. The resolver identity stays stable, which matters because `PneumaCraftProvider` requires a stable resolver prop.

### What the mode deliberately does NOT do

- **Create the `PlaybackEngine`.** That's `createPneumaCraftStore` inside `@pneuma-craft/react`.
- **Call `engine.load(composition, resolver)`.** The store auto-loads on composition reference change (`store.ts:140-160` in upstream).
- **Subscribe to `onTimeUpdate` / `onStateChange` / `onFrameRendered` directly.** Those are wired into store state fields that `usePlayback()` and `<PreviewRoot>` read — the mode reads store state, not engine events.
- **Own the engine lifecycle.** Creation is lazy on first play; destruction is tied to the store's `destroy()`, which runs when `PneumaCraftProvider` unmounts.

The mode-side surface is roughly 200 lines total (`PreviewCanvas.tsx` + `PlaybackControls.tsx` + `PreviewPanel.tsx` + `assetResolver.ts`), and none of it reaches past the upstream React bindings.

### Timeline (Plan 5) — read-only

Plan 5 ports the visual timeline from `modes/clipcraft-legacy/viewer/timeline/` onto the craft store. Everything lives under `modes/clipcraft/viewer/timeline/`:

- `Timeline.tsx` — root composition. Reads `useComposition()`, `usePlayback()`, `useDispatch()`, owns `useTimelineZoom` state, and renders a zoom toolbar + ruler row + one `TrackRow` per track + a `Playhead` overlay.
- `TimeRuler.tsx` / `Playhead.tsx` — pure prop-driven, no store coupling.
- `TrackRow.tsx` — walks `track.clips`, resolves each clip's asset via `useAsset(clip.assetId)`, and branches by `track.type` to render a filmstrip (`useFrameExtractor` → `<img>` tiles), waveform (`useWaveform` → bars), or subtitle text. Subtitles bypass the asset gate entirely.
- `ClipStrip.tsx` / `TrackLabel.tsx` — shared primitives. `ClipStrip` is an absolute-positioned clip rectangle with click-to-select; per-type inner content is a `children` prop.
- `hooks/useTimelineZoom.ts` — **local React state** (`useState`) for `{ pixelsPerSecond, scrollLeft }`, a `ResizeObserver` for viewport width + one-shot auto-fit (gated by `didAutoFitRef`), and a native `addEventListener("wheel", handler, { passive: false })` for ctrl/meta-wheel zoom that can `preventDefault` to block browser page zoom.
- `hooks/useFrameExtractor.ts` / `hooks/useWaveform.ts` — pure data hooks, byte-identical ports from legacy with module-scope `Map` caches.

**What the timeline deliberately is not:**

- **Not interactive for composition shape.** Click-to-select is wired; click-drag-to-move, resize, and split are NOT. Plan 5.5 (or Plan 6 rolled together) will port the ripple+snap drag engine from `@pneuma-craft/react-ui/src/timeline/timeline-track.tsx` by **copying the algorithm** into ClipCraft — the react-ui package stays unconsumed.
- **Not a craft-state citizen for zoom/scroll.** Zoom and scroll are UI-only ephemeral state. Page reload or provider remount resets them to the auto-fit value. This matches every other editor on the runtime and keeps the craft store free of presentation junk.
- **Not the overview/dive surfaces.** `TimelineOverview3D` (Plan 6) and `DiveCanvas` (Plan 7) are future work.

**Command dispatch shape** — `useDispatch()` returns a two-arg `(actor: Actor, command) => Event[]` function. `Actor` is `'human' | 'agent'`; Timeline dispatches `("human", { type: "selection:set", selection: { type: "clip", ids: [clipId] } })`. Ruler click calls `usePlayback().seek(Math.max(0, Math.min(t, effectiveDuration)))`.

**Playhead overlay pointer events** — the overlay wrapper is `pointerEvents: none` so clicks pass through to the track rows beneath. `Playhead` itself sets `pointerEvents: auto` on just its line and drag handle — the tooltip stays `none`. This is load-bearing: without it, the playhead wrapper would eat every click on empty track space.

**`xToTime` contract** — `useTimelineZoom.xToTime` takes a *viewport-local* x coordinate and adds `scrollLeft` internally. Call sites pass `e.clientX - rect.left` on the scroll-viewport element.

**Hook signature drift** — during Plan 5 Task 4 implementation the plan prose for `useFrameExtractor` / `useWaveform` turned out to be stale. The real signatures take an options object (`{ videoUrl, duration, frameInterval, frameHeight }` / `{ audioUrl, bars, maxDuration }`) and return `{ frames: FrameData[] }` / `{ waveform: { peaks, duration } }`. TrackRow adapts to the real shapes. If you refactor these hooks, update TrackRow too.

### StrictMode safety

React 18+ StrictMode simulates an unmount/remount cycle for effects in dev without re-running the render body. Plan 4 discovered that `PneumaCraftProvider`'s cleanup unconditionally destroyed the store, so the remounted tree was reading from a dangling reference — the first `play()` click after page load threw `Store destroyed`. Fixed upstream by deferring the destroy through a microtask gated by a ref flag: the effect body resets the flag on any re-run (including StrictMode's simulated re-run), so a just-queued destroy is cancelled when the component stays mounted. Real unmounts have no re-run, the flag stays set, and the microtask destroys cleanly. See commit `969bdf7` on `feat/clipcraft-aigc-status` and the smoke-test report in Plan 4's Task 5.

---

## Dependencies on `@pneuma-craft`

ClipCraft consumes four packages as local `file:` dependencies from a sibling worktree at `/Users/pandazki/Codes/pneuma-craft-headless-stable`:

| Package | Used for |
|---|---|
| `@pneuma-craft/core` | `Asset`, `AssetStatus`, `CommandEnvelope`, `createCore`, `dispatchEnvelope` (Plan 3c), `asset:set-status` + `asset:register`-with-explicit-id (Plan 3a + 2) |
| `@pneuma-craft/timeline` | `Composition`, `Track`, `Clip`, `createTimelineCore`, `composition:create` / `add-track` / `add-clip` (with explicit-id support) |
| `@pneuma-craft/video` | `AssetResolver` type (structural, implemented by `assetResolver.ts`). The `PlaybackEngine` itself is created lazily by `@pneuma-craft/react`'s store on first `play()` — ClipCraft never imports it directly. |
| `@pneuma-craft/react` | `PneumaCraftProvider`, `usePneumaCraftStore`, `useEventLog`, `useAssets`, `useComposition`, **`usePlayback`**, **`PreviewRoot`** (Plan 2 → Plan 4) |

The craft packages all live on branch `feat/clipcraft-aigc-status`. Changes that ClipCraft needed during Plan 2/3a/3c/4 were pushed upstream instead of being worked around — that's why `AssetStatus`, explicit-ids, `dispatchEnvelope`, and a StrictMode-safe `PneumaCraftProvider` store lifecycle now exist in craft.

**The `@pneuma-craft/react-ui` package is intentionally NOT consumed.** ClipCraft builds its UI directly on the headless hooks; ui-package adoption is a future decision once clipcraft has real timeline components.

---

## Known limitations (forward references)

- **External edits wipe in-memory state — and now playback position too.** Current strategy is "remount the provider on external edit." Plan 4 made this pain real: an agent-originated `project.json` edit drops the `PlaybackEngine` playhead back to 0s and re-loads the composition from scratch, even for a tweak that left the tracks/clips untouched. The source migration tags origin precisely (so the viewer knows *that* a change is external), but the response is still a full re-hydration. Mitigation: diff-and-dispatch, a follow-up plan that computes a minimal command sequence from the old→new project diff and dispatches it against the live store without a remount.
- **Clip edit is not wired.** The Plan 5 timeline is read-only for composition shape — click-to-select works, but drag-to-move / resize / split do not. Plan 5.5 (or Plan 6) will port the ripple+snap drag engine from `@pneuma-craft/react-ui/src/timeline/timeline-track.tsx` by copying the algorithm into ClipCraft. react-ui stays unconsumed.
- **No DOM-level tests for preview/timeline components.** The project has no happy-dom / testing-library setup, and adding it for what are still mostly presentational wrappers over craft hooks was out of scope. Verification is tsc + import-smoke tests + browser smoke tests via `chrome-devtools-mcp` captured in Plan 4 Task 5 and Plan 5 Task 6. Once clip-edit lands and the timeline grows non-trivial drag math, install happy-dom and cover the ripple/snap algorithm.
- **TimeRuler renders pre-zero ticks at high zoom.** A legacy cosmetic bug carried over in the port: at large viewport widths the tick generator emits labels for negative timestamps (`-1:-4`, `-1:-2`). Harmless but ugly — clamp the tick range to `[0, duration]` when polishing Plan 5.5.
- **Zoom in is rate-limited by synchronous clicks.** Three rapid `zoomIn()` calls in the same tick all read the same closed-over `pixelsPerSecond` and only the last write lands. Add a functional-updater form (`setPixelsPerSecond(prev => clamp(prev * ZOOM_STEP))`) when polishing.
- **Minimal `extractContext`.** Just `"ClipCraft bootstrap — N file(s) in workspace"`. Plan 10's skill rewrite will make it domain-aware (current composition summary, selected asset, provenance lineage of selection).
- **`project.json` is the only canonical file.** Legacy clipcraft had `storyboard.json` + `graph.json` + `project.json` as separate files; the new mode consolidates. Plans don't include reintroducing splits — one file is fine until it isn't.

---

## How to run

```bash
bun run dev clipcraft --workspace /tmp/clipcraft-dev --no-open --port 18100
```

The Vite URL appears in the server log (`[pneuma] ready http://localhost:17996?session=...&mode=clipcraft&layout=editor`). Load it in a browser to see the StateDump.

For E2E verification:

```bash
# Clean workspace + launch
rm -rf /tmp/clipcraft-dev
bun run dev clipcraft --workspace /tmp/clipcraft-dev --no-open --port 18100

# Edit project.json externally to simulate an agent touch
cat > /tmp/clipcraft-dev/project.json <<'EOF'
  (use modes/clipcraft/seed/project.json as a template and tweak status)
EOF
```

Running the test suite:

```bash
bun test modes/clipcraft/            # mode-specific tests only
bun test                             # full suite
bun run tsc --noEmit                 # typecheck
```

---

## Reading order for new contributors

1. **This doc** — top-level mental model
2. **`../../docs/reference/viewer-agent-protocol.md`** — the protocol ClipCraft implements
3. **`../../core/types/source.ts`** — the `Source<T>` contract that powers the seventh direction
4. **`../../core/sources/json-file.ts`** — the provider ClipCraft's manifest declares
5. **`../../src/hooks/useSource.ts`** — the React binding the viewer consumes
6. **`persistence.ts`** (skim) — the domain mapping in code
7. **`viewer/ClipCraftPreview.tsx`** — how the viewer wires hydration + autosave on top of `useSource`
8. **`../../docs/migration/2.29-source-abstraction.md`** and **`../../docs/superpowers/plans/clipcraft-source-migration.md`** — the migration that turned three refs into one source
9. **`../../docs/superpowers/plans/2026-04-12-clipcraft-craft-bootstrap.md`** through `plan3c` — the incremental history, if you want to understand *why* a specific decision was made

Each plan document is self-contained and references the commits it produced.
