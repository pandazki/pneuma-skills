# ClipCraft Architecture

> **Frame:** ClipCraft is a reference implementation of the [Pneuma Viewer–Agent Protocol](../../docs/reference/viewer-agent-protocol.md) on top of a structured domain model. It takes the protocol's file-centric design and shows that it scales up to a state-machine-backed editor without inventing a new runtime — by adding exactly one bidirectional sync layer at the viewer.
>
> **Status (2026-04-13):** Plans 1 + 2 + 3a + 3b + 3c landed. Persistence is done end-to-end. No playback, no timeline UI, no interactive user dispatch yet. Plan 4 adds playback.

---

## The twist

Most Pneuma modes treat the workspace **file** as the source of truth: agent edits file, viewer parses file, user interacts with file. Doc, Draw, Webcraft all work this way.

ClipCraft's source of truth is a **craft store** — an event-sourced state machine from [`@pneuma-craft`](https://github.com/pandazki/pneuma-craft) with Assets, Composition, and a Provenance DAG. The file (`project.json`) is a **projection** of that store. Both the agent and the viewer can mutate the store:

- **Agent** mutates it by editing `project.json` (goes through Pneuma's existing file surface, which flows into the viewer's `files` prop).
- **Viewer** mutates it by dispatching craft commands (user actions in Plan 4+; today, just hydration-replay).

Both sides must stay in sync. That's what the bidirectional sync layer (`useProjectSync`) does, and that's what Plans 3a/3b/3c were about.

---

## File structure

```
modes/clipcraft/
├── manifest.ts               Mode declaration (watchPatterns, skill, init, permissionMode)
├── pneuma-mode.ts            ModeDefinition — binds manifest + PreviewComponent + extractContext
├── persistence.ts            Pure domain logic (no React, no IO)
│                             ├ ProjectFile schema types
│                             ├ parseProjectFile       — JSON → validated ProjectFile
│                             ├ projectFileToCommands  — ProjectFile → CommandEnvelope[] (hydration)
│                             ├ serializeProject       — craft state → ProjectFile (inverse)
│                             └ formatProjectJson      — ProjectFile → 2-space-indent JSON
├── api-client.ts             writeProjectFile(content) — POST /api/files { path: "project.json", content }
├── seed/project.json         Default content for fresh workspaces (single pending AIGC asset example)
├── skill/SKILL.md            Agent-facing skill (current status + domain vocab)
├── viewer/
│   ├── ClipCraftPreview.tsx  Default-exported React component. Owns lastAppliedRef + providerKey state.
│   ├── externalEdit.ts       Pure helper: isExternalEdit(diskContent, lastApplied)
│   ├── assetResolver.ts      Minimal AssetResolver — /content/<id> URL mapping
│   ├── StateDump.tsx         Read-only text renderer (Plan 2 debug UI; Plan 5 replaces it)
│   └── hooks/
│       └── useProjectSync.ts Bidirectional sync hook (disk ↔ craft store)
└── __tests__/
    ├── persistence.test.ts          Unit tests for all persistence.ts functions + isExternalEdit
    ├── api-client.test.ts           writeProjectFile HTTP shape with mocked fetch
    ├── hydration-integration.test.ts  Full-stack round-trip against a real TimelineCore
    └── craft-imports.test.ts        @pneuma-craft/* public API contract tests
```

16 source + test files. Each has one responsibility. The pure-domain code (`persistence.ts`, `externalEdit.ts`, `api-client.ts`) is >60% of the line count, and it's all testable without React or a browser.

---

## How ClipCraft maps to the 6-direction protocol

The protocol defines six user/viewer/agent directions. ClipCraft implements a subset today:

| Direction | Protocol expectation | ClipCraft today | Wired via |
|---|---|---|---|
| **① User → Viewer: Interaction** | `onSelect`, `commands`, `onViewportChange` | **Not implemented.** StateDump is read-only. | Plan 4+ |
| **② Viewer → User: Rendering** | `files` prop drives render | `files.find(...project.json)` → hydrate craft store → render from store | `useProjectSync` + `StateDump` |
| **③ User → Agent: Intent** | Chat panel via WS | Standard, no mode customization | (default Pneuma chat) |
| **④ Agent → User: Response** | WS streaming | Standard | (default Pneuma chat) |
| **⑤ Agent → Viewer: Action** | `viewer_action` tool + `actionRequest` prop | **Not declared.** `manifest.viewerApi` is absent entirely. | Plan 4+ |
| **⑥ Viewer → Agent: Context & Notification** | `extractContext`, `onNotifyAgent` | Minimal: `<viewer-context mode="clipcraft" files="N">` | `pneuma-mode.ts:17-20`. Plan 10 will make it domain-aware. |

**What's intentionally not in the table**: the Viewer ↔ Agent write loop. In classic file-centric modes, the agent edits files and the viewer passively re-renders. In ClipCraft, the viewer **also writes** — autosave serializes craft state back to `project.json`. This is a new capability the protocol doesn't enumerate but has built-in infrastructure for.

### The unofficial seventh direction: Viewer → Disk (Autosave)

```
⑦ Viewer → Disk: Autosave
```

- **Why it exists:** with a structured domain model, user actions modify the *store*, not the file. Someone has to serialize the store back to disk so the agent can read it and the next session can rehydrate.
- **How it works:** `useProjectSync` listens to craft's event log (via `useEventLog().length`), debounces 500ms, serializes the current state, and POSTs to the existing `/api/files` endpoint. No mode-specific server route.
- **Why it's safe:** the `/api/files` endpoint already has path-traversal protection (`server/index.ts:1742`). The viewer is treated with the same trust level as the agent's Write tool.
- **Why it's invisible to the agent:** the agent only sees `project.json` changes arrive in its file view. It doesn't care whether the change came from its own Edit tool or from the viewer's autosave. Both go through the same chokidar → WebSocket → `files` prop pipe.

This makes ClipCraft a **bidirectional implementation of direction ② + direction ⑦**, layered on top of the protocol's existing primitives. No new transport, no new server code, no new protocol semantics.

---

## Data flow

### A. Fresh mount / hydration (disk → craft store)

```
project.json on disk
      │
      ▼  chokidar (server-side, from manifest.watchPatterns)
Pneuma server
      │
      ▼  WebSocket (runtime's standard files broadcast)
ClipCraftPreview.files prop
      │
      ▼  useProjectSync — diffs diskContent vs lastAppliedRef.current
parseProjectFile (validator)
      │
      ▼
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
- Title has no craft concept; `useProjectSync` holds it in `currentTitleRef` and passes it into `serializeProject` as an out-of-band parameter.

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
      ▼  compare against lastAppliedRef.current
if EQUAL → skip   (this is how hydration doesn't trigger its own autosave)
if DIFFER:
      │
      ▼  optimistically set lastAppliedRef.current = new content
POST /api/files { path: "project.json", content }
      │                                           │
      │ (on failure) roll back lastAppliedRef ◄──┤
      ▼
server writes file → chokidar detects → files prop echoes back
      │
      ▼  useProjectSync sees diskContent === lastAppliedRef.current → skip
(no infinite loop)
```

**Key invariant:** `formatProjectJson(serializeProject(hydrate(seed))) === seed` as bytes. Plan 3b's Task 6 verifies this E2E by asserting zero `POST /api/files` requests on fresh mount. When any field drifts — different formatting, missing optional, non-preserved id, non-preserved timestamp — the test catches it immediately.

### C. External edit (agent → disk → craft store rebuild)

```
agent invokes Edit tool on project.json
      │
      ▼  filesystem write → chokidar → WS → files prop changes
ClipCraftPreview re-renders with new diskContent
      │
      ▼  useProjectSync runs (child effect, before parent effect)
hook checks: diskContent === lastAppliedRef.current ?
      │ NO — this is a real change
      │
      ▼  diskContent === hydratedDiskRef.current ?
      │ NO — first time seeing this content on this hook instance
      │
      ▼  lastAppliedRef.current !== null ?
      │ YES — store is already live with previous content
      │
      ▼  onExternalEdit()  (defers to parent, does NOT dispatch here)
ClipCraftPreview.onExternalEdit callback:
      1. lastAppliedRef.current = null   ← critical: lets the fresh hook hydrate
      2. setProviderKey(k => k + 1)      ← triggers React remount
      │
      ▼
PneumaCraftProvider remounts with a fresh key
      │
      ▼
new useProjectSync instance mounts
      │   hydratedDiskRef.current === null  (new instance)
      │   lastAppliedRef.current === null   (parent cleared it)
      ▼
hook does a normal hydration (path from flow A) on the new content
```

**Why the deferred remount matters:** if we tried to dispatch the new commands into the *existing* store, craft would reject them as duplicates (Plan 3a's uniqueness checks). Even if we removed the uniqueness checks, the resulting store would contain both old and new assets side-by-side. Remounting forces a clean slate.

**Cost:** external edits wipe in-memory state (future undo history, PlaybackEngine position). Acceptable today because there's nothing valuable in memory yet. Plan 4+ will revisit via diff-and-dispatch if playback interruption becomes painful.

---

## Loop protection: three refs, three different races

The current architecture has **three** refs doing loop-protection work, plus one plain state variable. They're often mistaken for duplicates; they aren't. Each handles a race the others can't:

| Ref | Owner | Lifetime | Race it solves |
|---|---|---|---|
| `lastAppliedRef` | `ClipCraftPreview` (parent) | As long as the component is mounted; **survives provider remount** | Echo-skip: when the viewer writes X and chokidar echoes X back, the hook sees `diskContent === lastAppliedRef.current` and skips. |
| `hydratedDiskRef` | `useProjectSync` (hook, instance-local) | One hook instance only; **wiped on remount** | React 19 StrictMode's effect double-invoke: the same hook instance's effect runs twice with the same `diskContent`, and the second run would otherwise try to re-dispatch commands into the now-populated store. |
| `providerKey` (state, not a ref) | `ClipCraftPreview` (parent) | Integer counter, persisted in React state | Store isolation: bumping it forces `PneumaCraftProvider` to remount with a fresh Zustand store, giving the hook a clean slate for external-edit re-hydration. |
| `currentTitleRef` | `useProjectSync` (hook, instance-local) | One hook instance; refreshed on hydration | Title round-trip: craft has no title concept, so this ref carries the value from `parseProjectFile` → `serializeProject`. Not loop-protection per se, but same mechanism. |

### Why not collapse them

- `lastAppliedRef` can't be instance-local because the provider remount destroys hook refs, and the parent needs to remember "what we committed to" across remounts to avoid infinite external-edit cycles.
- `hydratedDiskRef` can't be parent-owned because StrictMode double-invokes effects on the *same* instance — the parent ref already holds the content, so you'd need a second signal anyway.
- `providerKey` is a **counter**, not the content, because a content-based key would remount on the viewer's own writes (which we don't want) and match content would have to be pushed through React state (clunky). A counter bumped only via `onExternalEdit` is clean.

**Load-bearing coupling:** `ClipCraftPreview.onExternalEdit` must reset `lastAppliedRef.current = null` before bumping `providerKey`. If you forget this, the fresh hook instance sees a non-null ref with the old content and incorrectly treats the new content as "another external edit", calling `onExternalEdit` again → infinite remount. `NEXT.md` flags this; a future refactor should either move the reset inside the hook or add a regression test.

---

## Domain mapping

| On-disk (`ProjectFile`) | In craft | Round-trip fidelity |
|---|---|---|
| `$schema` (literal `"pneuma-craft/project/v1"`) | — | Constant |
| `title` | `useProjectSync.currentTitleRef` (side-channel) | ✅ Plan 3c title param to `serializeProject` |
| `composition.settings.{width,height,fps,aspectRatio}` | `Composition.settings` | ✅ via `composition:create` |
| `composition.tracks[].{id,type,name,muted,volume,locked,visible}` | `Composition.tracks[]` | ✅ id preserved by Plan 3a's explicit-id `composition:add-track` |
| `composition.tracks[].clips[].{id,assetId,startTime,duration,inPoint,outPoint,...}` | Clips inside tracks | ✅ id preserved by Plan 3a's explicit-id `composition:add-clip` |
| `composition.transitions[]` | `Composition.transitions` | Pass-through (currently unused) |
| `assets[].{id,type,uri,name,metadata,tags,status}` | `coreState.registry: Map<id, Asset>` | ✅ id and `status` preserved by Plan 3a + Plan 2's `AssetStatus` |
| `assets[].createdAt` | `Asset.createdAt` | ✅ Plan 3c's `dispatchEnvelope` preserves the caller-supplied timestamp |
| `provenance[].{toAssetId,fromAssetId,operation}` | `coreState.provenance.edges: Map<id, ProvenanceEdge>` | ✅ via `provenance:set-root` (null parent) or `provenance:link` |
| `provenance[].operation.{type,actor,agentId,timestamp,label,params}` | `Operation` | ✅ Plan 3c preserves `operation.timestamp` via envelope |

The `operation.params` field is intentionally `Record<string, unknown>` in craft. Clipcraft's AIGC convention (model / prompt / seed / costUsd / durationMs / providerJobId) lives at the schema documentation level — craft doesn't enforce it, and other craft consumers can use their own conventions.

---

## Testing shape

| Layer | File | What it locks down |
|---|---|---|
| **Unit (pure)** | `persistence.test.ts` | `parseProjectFile` (JSON / schema validation), `projectFileToCommands` (command sequence + timestamps + id preservation), `serializeProject` (all optional fields, null composition fallback, determinism), `formatProjectJson` (indent + newline), `isExternalEdit` (all 4 cases) |
| **Unit (mocked)** | `api-client.test.ts` | `writeProjectFile` HTTP shape — URL, method, headers, body, error handling (403, 500) — all with a swappable `globalThis.fetch` |
| **Integration** | `hydration-integration.test.ts` | Full round-trip against a real `TimelineCore`: hydrate `completeFile` → serialize → parse → hydrate again → deep-equal state including `createdAt` and `title`; stability check: second pass produces byte-identical output; duplicate-hydration throws |
| **Contract** | `craft-imports.test.ts` | `@pneuma-craft/*` public API lock-down — `createCore`, `createTimelineCore`, `createPlaybackEngine`, `createPneumaCraftStore`, `dispatchEnvelope` behavior, Asset.status undo/redo roundtrip. If craft ships a breaking change, this fails the mode's test suite immediately. |
| **E2E (manual)** | chrome-devtools-mcp + server log | Fresh mount → **zero `POST /api/files`** (the key loop-protection invariant); agent edits file → badge flips pending→ready without asset duplication; console has zero `[clipcraft] hydration envelope rejected` warnings |

40 mode-specific tests across 4 files. The pure-function tests carry most of the weight; the integration test is the single canonical check that all the pieces compose. E2E is only used for things unit/integration tests can't see (the debounced autosave behavior interacting with real chokidar + React StrictMode).

---

## Dependencies on `@pneuma-craft`

ClipCraft consumes four packages as local `file:` dependencies from a sibling worktree at `/Users/pandazki/Codes/pneuma-craft-headless-stable`:

| Package | Used for |
|---|---|
| `@pneuma-craft/core` | `Asset`, `AssetStatus`, `CommandEnvelope`, `createCore`, `dispatchEnvelope` (Plan 3c), `asset:set-status` + `asset:register`-with-explicit-id (Plan 3a + 2) |
| `@pneuma-craft/timeline` | `Composition`, `Track`, `Clip`, `createTimelineCore`, `composition:create` / `add-track` / `add-clip` (with explicit-id support) |
| `@pneuma-craft/video` | `AssetResolver` type (used by `assetResolver.ts`). No playback engine consumed yet — that's Plan 4. |
| `@pneuma-craft/react` | `PneumaCraftProvider`, `usePneumaCraftStore`, `useEventLog`, `useAssets`, `useComposition` (Plan 2 onward) |

The craft packages all live on branch `feat/clipcraft-aigc-status`. Changes that ClipCraft needed during Plan 2/3a/3c were pushed upstream instead of being worked around — that's why `AssetStatus`, explicit-ids, and `dispatchEnvelope` now exist in craft.

**The `@pneuma-craft/react-ui` package is intentionally NOT consumed.** ClipCraft builds its UI directly on the headless hooks; ui-package adoption is a future decision once clipcraft has real timeline components.

---

## Known limitations (forward references)

- **External edits wipe in-memory state.** Current strategy is "remount the provider on external edit." Works today because there's no valuable in-memory state. Will become painful when Plan 4 adds playback and the `PlaybackEngine` is mid-playback. Mitigation: diff-and-dispatch (Plan 3d or merged into Plan 4, TBD).
- **Load-bearing `lastAppliedRef.current = null` in `onExternalEdit`.** If someone removes that line without understanding, the hook's next run will misclassify the disk content as another external edit and loop. Either move the reset into the hook or add a regression test.
- **StateDump is read-only text.** All user interaction directions (①) are unwired. Plan 4 starts changing this with play/pause/seek. Plan 5 adds the timeline UI.
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
3. **`persistence.ts`** (skim) — the domain mapping in code
4. **`viewer/hooks/useProjectSync.ts`** — the bidirectional sync heart
5. **`viewer/ClipCraftPreview.tsx`** — how the parent wires the loop-protection refs
6. **`../../docs/superpowers/plans/2026-04-12-clipcraft-craft-bootstrap.md`** through `plan3c` — the incremental history, if you want to understand *why* a specific decision was made

Each plan document is self-contained and references the commits it produced.
