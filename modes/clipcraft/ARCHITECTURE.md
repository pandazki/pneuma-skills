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
| **① User → Viewer: Interaction** | `onSelect`, `commands`, `onViewportChange` | **Not implemented.** StateDump is read-only. | Plan 4+ |
| **② Viewer → User: Rendering** | `files` prop drives render | `useSource(sources.project)` → hydrate craft store → render from store | `ClipCraftPreview` + `StateDump` |
| **③ User → Agent: Intent** | Chat panel via WS | Standard, no mode customization | (default Pneuma chat) |
| **④ Agent → User: Response** | WS streaming | Standard | (default Pneuma chat) |
| **⑤ Agent → Viewer: Action** | `viewer_action` tool + `actionRequest` prop | **Not declared.** `manifest.viewerApi` is absent entirely. | Plan 4+ |
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

- **External edits wipe in-memory state.** Current strategy is "remount the provider on external edit." Works today because there's no valuable in-memory state. Will become painful when Plan 4 adds playback and the `PlaybackEngine` is mid-playback. The source migration did **not** address this — origin tagging tells the viewer *that* a change is external, but the response is still a full re-hydration. Mitigation: diff-and-dispatch, deferred until playback makes the cost real.
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
3. **`../../core/types/source.ts`** — the `Source<T>` contract that powers the seventh direction
4. **`../../core/sources/json-file.ts`** — the provider ClipCraft's manifest declares
5. **`../../src/hooks/useSource.ts`** — the React binding the viewer consumes
6. **`persistence.ts`** (skim) — the domain mapping in code
7. **`viewer/ClipCraftPreview.tsx`** — how the viewer wires hydration + autosave on top of `useSource`
8. **`../../docs/migration/2.29-source-abstraction.md`** and **`../../docs/superpowers/plans/clipcraft-source-migration.md`** — the migration that turned three refs into one source
9. **`../../docs/superpowers/plans/2026-04-12-clipcraft-craft-bootstrap.md`** through `plan3c` — the incremental history, if you want to understand *why* a specific decision was made

Each plan document is self-contained and references the commits it produced.
