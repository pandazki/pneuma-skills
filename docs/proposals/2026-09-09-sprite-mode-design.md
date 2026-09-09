# Sprite mode — design brief and implementation spec

Status: brief confirmed by the product owner on 2026-09-09 (four decisions
recorded below). This document is the single spec every implementation task
reads. Task sections are anchored (`## TASK-n` / `## TASK-n-REVIEW`) so the
implementer and the reviewer of a task read different depths of the same bar.

## Summary

`sprite` is a builtin mode for **character-centric motion assets**: the user
designs a character once (turnaround / portrait references), then asks for
motions — idle, walk, attack, or story-video key poses. Each motion is one
GPT Image 2.5 sheet (an N×M grid of frames generated *with the character
references attached*, on a transparent background), which a deterministic
ffmpeg pipeline turns into aligned frames, a packed atlas (`sheet.png` +
`atlas.json`), a GIF/WebP preview, and — on request — a short clip from a
video model (Seedance 2.5 by default, MiniMax H3 Max as the alternative; both
on fal.ai). The viewer is a motion stage: it plays the frames at the motion's
fps, lets the user scrub, and shows the GIF / video / atlas side by side.

The inspiration is a public tweet showing GPT Image 2.5 producing a 4×4
combat sprite sheet from a single character image, then a GIF assembled by
"make the background transparent, split 4×4, align, animate". This mode makes
that loop reproducible: the model draws, scripts do the cutting and aligning,
the viewer is the agent's eyes.

### Decisions (confirmed)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Data layer | `@pneuma-craft` **project file format** (`pneuma-craft/project/v1`: `assets[]` + `provenance[]` + a `sprite` sidecar). v0.1 viewer is read-only and reads the JSON directly — no live craft store hydration yet. |
| D2 | Default video model | Seedance 2.5 (`bytedance/seedance-2.5/*` on fal). H3 Max supported as the alternative. |
| D3 | Hosted player | Whitelisted **in this build**, after a real player smoke (TASK-7). |
| D4 | Seed | One real character content set generated with the mode's own scripts (TASK-6). |

### Precedents this design leans on

- `modes/illustrate` — aggregate-file source over per-content-set manifests,
  images as workspace-relative paths, `/content/<contentSet>/<file>?v=<imageVersion>`,
  read-only viewer with agent-owned writes, `init.params` with `sensitive` keys +
  `envMapping` + `deriveParams`.
- `modes/clipcraft/persistence.ts` — the `ProjectFile` shape (`$schema`,
  `composition`, `assets`, `provenance`, mode sidecar fields).
- `modes/_shared/scripts/generate-video.mjs` + `fal-queue.mjs` — the fal queue
  driver (submit/poll/cancel, retry only on proven-not-reached failures,
  idle-based download timeout), `.env` discovery, `--json` contracts.
- `modes/_shared/scripts/storyboard.mjs` — ffmpeg via `spawnSync`, zero JS
  image dependencies (the project rule: no sharp/jimp/pngjs).
- `modes/remotion/manifest.ts` — frame-indexed playback actions
  (`seek-to-frame`, `get-playback-state`).

---

## Brief

### Identity

- name: `sprite`
- displayName: en `Sprite` · zh-CN `精灵图` · ja `スプライト`
- description: en "Design a character once, then generate consistent sprite
  sheets and motion reference frames with GPT Image 2.5 — auto-keyed, sliced,
  aligned, packed; previewed as GIF or a video clip." · zh-CN "先定角色，再用
  GPT Image 2.5 产出前后一致的雪碧图与动作参考帧；自动抠背景、切帧、对齐、打包，
  GIF 或视频模型预览。"
- icon: lucide-style single-stroke: a 3×3 grid with one cell filled
  (`currentColor`), no other fills.

### Domain

The user creates **characters**. One character = one content set directory
(`lumi/`). It holds identity references (`refs/`) and an ordered list of
**motions**. Each motion is one generated sheet processed into frames, an
atlas, previews, and optional video clips. The viewer renders the active
character: a refs rail, a motion list, a stage that plays the selected motion,
and preview panels (GIF · video · atlas). The agent designs the character,
writes motion prompts, runs the generation and pipeline scripts, then *looks*
(playback state, inspect report, capture) before claiming a motion is done.

### Source layer

- kind: `aggregate-file`, patterns `["**/project.json", "**/refs/**/*", "**/motions/**/*"]`
  (image entries arrive with empty content and only serve as change signals).
- T: `Roster = { byContentSet: Record<string, CharacterProject> }` — see
  "project.json schema" below for `CharacterProject`.
- `domain.ts`: `loadRoster(files) → Roster | null` (null when no project.json
  parses), `saveRoster()` throws (viewer is read-only in v0.1; the agent owns
  writes through `sprite-project.mjs`).

### Workspace model

`type: "manifest"`, `manifestFile: "project.json"`, `multiFile: true`,
`ordered: true`, `hasActiveFile: false`, `supportsContentSets: true`,
`topBarNavigation: false`. `resolveContentSets` =
`createDirectoryContentSetResolver()`. `resolveItems` returns one item per
motion (`path: "<contentSet>/motions/<id>/atlas.json"`, label = motion label).

### ViewerAddress vocabulary

| Key | Kind | Meaning |
|-----|------|---------|
| `contentSet` | framework reserved (coarse) | The character directory. There is no separate `character` key — the character *is* the content set. |
| `motion` | coarse | Motion id inside the character (`"idle"`). |
| `ref` | coarse | Reference image id (`"turnaround"`). Mutually exclusive with `motion`. |
| `frame` | fine | 0-based frame index inside `motion`. Navigating to an address with `frame` seeks there and pauses. |

Example: `{ "contentSet": "lumi", "motion": "attack", "frame": 7 }`.

`motion` and `ref` must be added to `COARSE_ADDRESS_KEYS` in
`src/hooks/useCaptureAction.ts` so `capture` navigates before it screenshots.

### Action space

| id | label | category | agentInvocable | params |
|----|-------|----------|----------------|--------|
| `navigate-to` | Show character / motion / frame | navigate | true | `{ address: object }` — with `frame`: seek + pause; with `ref`: open the reference in the stage. |
| `play` | Play motion | ui | true | `{ address?: object, fps?: number, loop?: boolean }` — starts playback of the addressed (or selected) motion; `fps`/`loop` override the motion's defaults for this playback only. |
| `pause` | Pause playback | ui | true | — |
| `get-playback-state` | Read what the stage shows | custom | true | `{ address?: object }` → `{ contentSet, motion, frame, frameCount, fps, loop, playing, source: "frames" \| "raw-sheet" \| "none", warnings: string[] }` |

`capture` is framework-built-in (not listed in the manifest).

Sensing layers the skill teaches: **look** = `get-playback-state` + `capture`;
**diagnose** = `sprite-sheet.mjs inspect` (deterministic, free);
**verify** = `play` + `capture` at specific frames.

Commands (user buttons → agent, rendered only when `editing !== false`):

| id | label | when |
|----|-------|------|
| `render-video` | Render video preview | The user picks a model (Seedance 2.5 / H3 Max) and a mode (`i2v` / `first-last` / `r2v`) in a small popover; the viewer notifies the agent with the selected motion + choices. |
| `regenerate-motion` | Regenerate this motion | Ask the agent to redo the selected motion's sheet (optionally with the user's note). |
| `fix-alignment` | Frames are misaligned | Ask the agent to re-run `align` with a different anchor / smoothing or regenerate. |

### Seed strategy

- shape: content sets by use case; v0.1 ships one: `lumi/`.
- Lumi: an original chibi "lantern courier" — short bob hair, oversized hooded
  cloak, satchel, a small floating paper lantern companion. Clean anime-chibi
  line art, flat colors. Refs: `turnaround` (front / side / back on one sheet)
  and `portrait`. Motions: `idle` (4×4, loop, 8 fps, anchor bottom) and
  `attack` (4×4, no loop, 10 fps, anchor bottom, lantern swing). Both fully
  processed (frames / atlas / gif / webp); `attack` also has one Seedance 2.5
  clip (480p, 4 s, no audio).
- Budget ≤ 8 MB for the whole seed (pngquant every PNG; 480p 4 s mp4).

### External integrations

- proxy: none.
- init.params: `openrouterApiKey` (sensitive), `falApiKey` (sensitive),
  `defaultVideoModel` (select `seedance-2.5` | `h3-max`, default `seedance-2.5`).
  `envMapping: { OPENROUTER_API_KEY: "openrouterApiKey", FAL_KEY: "falApiKey" }`.
  `deriveParams` → `imageGenEnabled` (`"true"` when the OpenRouter key is
  set), `videoGenEnabled` (`"true"` when the fal key is set).
- skill.mcpServers: none.
- sharedScripts: `generate_image.mjs`, `edit_image.mjs`, `generate-video.mjs`,
  `fal-queue.mjs`, `seedance-video.mjs` (new), `remove-background.mjs` (new).
  Reminder: `sharedScripts` is a whitelist; every script a listed script
  imports must be listed too.
- Shared-script change: `generate_image.mjs` gains `--background auto|transparent|opaque`.
- Mode-local scripts: `skill/scripts/sprite-sheet.mjs` (probe / key / flatten /
  slice / align / pack / gif / inspect / run), `skill/scripts/sprite-project.mjs`
  (all `project.json` mutations).
- NOTICE.md: no. inspiredBy: none.

### Cloud surfaces

- hosted player: **yes** — render from `project.json` + `/content/*` only;
  commands hidden and no writes when `editing === false`; no `/api/*` at
  render time. Obligations: whitelist entry in `core/player-support.ts`,
  `scripts/smoke-sprite.ts`, a browser pass on the built player with the seed
  package (console clean), and `scripts/deploy-player.sh` at bump time.
- artifact deploy: none.

### Launcher surface

- visibility: public. featured-eligible: yes.
- server: `hasInitParams` in `server/index.ts` is currently a hardcoded
  `slide|illustrate|kami` conditional; derive it from the parsed manifest
  instead (TASK-1).

### Evolution directive

> Learn the user's character and animation preferences: art style (chibi /
> pixel / anime / painterly), the grid and frame count they use per motion
> type, fps and loop conventions, anchor choice, which video model they render
> with and how they phrase those prompts, and recurring motion vocabularies
> (idle / walk / attack sets). Evidence comes from session history and
> `project.json` changes. Write them back into this skill's defaults so a new
> character starts from the user's house style while explicit instructions
> still win.

### Deferred

- True pixel-art re-rendering (v0.1 offers `--scale --nearest` in `pack`).
- Viewer write-back (frame reorder, fps edit, pivot drag) — v0.1 routes these
  through commands to the agent; when added, hydrate a craft store and
  implement `saveRoster`.
- Migrating clipcraft to the shared Seedance 2.5 script.

---

## Shared vocabulary (every task reads this)

### Workspace layout per character

```
<character>/                      # content set, kebab-case
  project.json                    # craft project file + sprite sidecar (schema below)
  refs/<ref-id>.png               # identity references (turnaround, portrait, expressions…)
  motions/<motion-id>/
    sheet-raw.png                 # as generated (may be opaque or already transparent)
    sheet-alpha.png               # background removed (only when sheet-raw had no alpha)
    frames/00.png … NN.png        # sliced + aligned, uniform cell, RGBA
    sheet.png                     # packed atlas image (cols × rows of aligned frames)
    atlas.json                    # frame rects + pivot + timing (schema below)
    preview.gif                   # animated preview (transparent, palette)
    preview.webp                  # animated preview (lossy WebP with alpha)
    video-<model>-<n>.mp4         # video-model clip: video-seedance-1.mp4, video-h3-1.mp4
    inspect.json                  # latest `sprite-sheet.mjs inspect` report
```

Frame files are two-digit zero-padded (`00`–`99`); a motion has at most 100
frames.

### project.json schema

The file is a `pneuma-craft/project/v1` project file exactly as clipcraft
persists it (`modes/clipcraft/persistence.ts::ProjectFile`), with an empty
composition and a `sprite` sidecar. Craft-owned fields:

- `$schema`: `"pneuma-craft/project/v1"`.
- `title`: character name.
- `composition`: `{ settings: { width, height, fps, aspectRatio }, tracks: [], transitions: [] }`
  where width/height = the character's cell size and fps = 8. Always present,
  always empty tracks (reserved for a future timeline).
- `assets[]`: craft `Asset` objects — `{ id, type: "image"|"video"|"text", uri, name, metadata: { width?, height?, duration?, fps? }, createdAt, status?: "pending"|"generating"|"ready"|"failed", tags? }`.
  `uri` is relative to the character directory (`motions/idle/frames/00.png`).
- `provenance[]`: `{ toAssetId, fromAssetId: string | null, operation: { type: "generate"|"derive"|"upload"|"select", actor: "agent"|"human", params?, label?, timestamp } }`.

Asset id convention: `ref-<refId>`, `<motion>-sheet-raw`, `<motion>-sheet-alpha`,
`<motion>-frame-NN`, `<motion>-sheet`, `<motion>-atlas`, `<motion>-gif`,
`<motion>-webp`, `<motion>-video-<n>`.

Mode sidecar (`sprite`), never dispatched as craft commands:

```ts
interface SpriteSidecar {
  version: 1;
  character: {
    name: string;
    description: string;          // one paragraph the agent keeps current
    style: string;                // the style anchor used in every prompt
    cell: { width: number; height: number }; // default frame cell in px
    facing?: "left" | "right";    // default facing for motions
  };
  refs: Array<{ id: string; asset: string; role: "turnaround" | "portrait" | "expression" | "custom"; label: string }>;
  motions: Motion[];
}
interface Motion {
  id: string; label: string;
  prompt: string;                 // the sheet prompt actually sent
  grid: { rows: number; cols: number };
  fps: number; loop: boolean;
  anchor: "bottom" | "center";
  status: "planned" | "generating" | "processing" | "ready" | "failed";
  notes?: string;                 // failure reason or agent remarks
  sheetRaw?: string; sheetAlpha?: string; sheet?: string; atlas?: string;
  frames: string[];               // asset ids in playback order
  gif?: string; webp?: string;
  videos: Array<{ id: string; asset: string; model: "seedance-2.5" | "h3-max"; mode: "i2v" | "first-last" | "r2v"; prompt: string; status: "generating" | "ready" | "failed" }>;
  inspect?: InspectSummary;       // copied from inspect.json by register-run
}
interface InspectSummary {
  frameCount: number;
  cell: { width: number; height: number };
  anchorDrift: { x: number; y: number };   // std-dev in px of the anchor point across frames
  maxJump: number;                          // largest anchor displacement between consecutive frames
  scaleDrift: number;                       // (max bbox height − min bbox height) / mean
  emptyFrames: number[];
  warnings: string[];                       // human sentences, e.g. "frame 09 is empty"
}
```

### Canonical fixture (use verbatim in tests: `modes/sprite/__tests__/fixtures/mini/project.json`)

A 2×2 `bounce` motion so fixtures stay short. Timestamps are fixed.

```json
{
  "$schema": "pneuma-craft/project/v1",
  "title": "Mini",
  "composition": { "settings": { "width": 64, "height": 64, "fps": 8, "aspectRatio": "1:1" }, "tracks": [], "transitions": [] },
  "assets": [
    { "id": "ref-portrait", "type": "image", "uri": "refs/portrait.png", "name": "Portrait", "metadata": { "width": 256, "height": 256 }, "createdAt": 1757400000000, "status": "ready", "tags": ["ref"] },
    { "id": "bounce-sheet-raw", "type": "image", "uri": "motions/bounce/sheet-raw.png", "name": "bounce sheet (raw)", "metadata": { "width": 128, "height": 128 }, "createdAt": 1757400001000, "status": "ready" },
    { "id": "bounce-frame-00", "type": "image", "uri": "motions/bounce/frames/00.png", "name": "bounce frame 00", "metadata": { "width": 64, "height": 64 }, "createdAt": 1757400002000, "status": "ready" },
    { "id": "bounce-frame-01", "type": "image", "uri": "motions/bounce/frames/01.png", "name": "bounce frame 01", "metadata": { "width": 64, "height": 64 }, "createdAt": 1757400002000, "status": "ready" },
    { "id": "bounce-frame-02", "type": "image", "uri": "motions/bounce/frames/02.png", "name": "bounce frame 02", "metadata": { "width": 64, "height": 64 }, "createdAt": 1757400002000, "status": "ready" },
    { "id": "bounce-frame-03", "type": "image", "uri": "motions/bounce/frames/03.png", "name": "bounce frame 03", "metadata": { "width": 64, "height": 64 }, "createdAt": 1757400002000, "status": "ready" },
    { "id": "bounce-sheet", "type": "image", "uri": "motions/bounce/sheet.png", "name": "bounce atlas image", "metadata": { "width": 128, "height": 128 }, "createdAt": 1757400003000, "status": "ready" },
    { "id": "bounce-atlas", "type": "text", "uri": "motions/bounce/atlas.json", "name": "bounce atlas", "metadata": {}, "createdAt": 1757400003000, "status": "ready" },
    { "id": "bounce-gif", "type": "image", "uri": "motions/bounce/preview.gif", "name": "bounce preview", "metadata": { "width": 64, "height": 64, "fps": 8 }, "createdAt": 1757400004000, "status": "ready" }
  ],
  "provenance": [
    { "toAssetId": "ref-portrait", "fromAssetId": null, "operation": { "type": "generate", "actor": "agent", "params": { "model": "openai/gpt-image-2.5-sunburst", "prompt": "portrait of Mini" }, "timestamp": 1757400000000 } },
    { "toAssetId": "bounce-sheet-raw", "fromAssetId": "ref-portrait", "operation": { "type": "generate", "actor": "agent", "params": { "model": "openai/gpt-image-2.5-flare", "prompt": "2x2 bounce sheet", "background": "transparent" }, "timestamp": 1757400001000 } },
    { "toAssetId": "bounce-frame-00", "fromAssetId": "bounce-sheet-raw", "operation": { "type": "derive", "actor": "agent", "params": { "tool": "sprite-sheet.mjs", "step": "run", "cell": 0 }, "timestamp": 1757400002000 } },
    { "toAssetId": "bounce-frame-01", "fromAssetId": "bounce-sheet-raw", "operation": { "type": "derive", "actor": "agent", "params": { "tool": "sprite-sheet.mjs", "step": "run", "cell": 1 }, "timestamp": 1757400002000 } },
    { "toAssetId": "bounce-frame-02", "fromAssetId": "bounce-sheet-raw", "operation": { "type": "derive", "actor": "agent", "params": { "tool": "sprite-sheet.mjs", "step": "run", "cell": 2 }, "timestamp": 1757400002000 } },
    { "toAssetId": "bounce-frame-03", "fromAssetId": "bounce-sheet-raw", "operation": { "type": "derive", "actor": "agent", "params": { "tool": "sprite-sheet.mjs", "step": "run", "cell": 3 }, "timestamp": 1757400002000 } },
    { "toAssetId": "bounce-sheet", "fromAssetId": "bounce-frame-00", "operation": { "type": "derive", "actor": "agent", "params": { "tool": "sprite-sheet.mjs", "step": "pack" }, "timestamp": 1757400003000 } },
    { "toAssetId": "bounce-atlas", "fromAssetId": "bounce-sheet", "operation": { "type": "derive", "actor": "agent", "params": { "tool": "sprite-sheet.mjs", "step": "pack" }, "timestamp": 1757400003000 } },
    { "toAssetId": "bounce-gif", "fromAssetId": "bounce-frame-00", "operation": { "type": "derive", "actor": "agent", "params": { "tool": "sprite-sheet.mjs", "step": "gif" }, "timestamp": 1757400004000 } }
  ],
  "sprite": {
    "version": 1,
    "character": { "name": "Mini", "description": "A test blob.", "style": "flat vector blob, thick outline", "cell": { "width": 64, "height": 64 }, "facing": "right" },
    "refs": [ { "id": "portrait", "asset": "ref-portrait", "role": "portrait", "label": "Portrait" } ],
    "motions": [
      {
        "id": "bounce", "label": "Bounce", "prompt": "2x2 bounce sheet",
        "grid": { "rows": 2, "cols": 2 }, "fps": 8, "loop": true, "anchor": "bottom", "status": "ready",
        "sheetRaw": "bounce-sheet-raw", "sheet": "bounce-sheet", "atlas": "bounce-atlas",
        "frames": ["bounce-frame-00", "bounce-frame-01", "bounce-frame-02", "bounce-frame-03"],
        "gif": "bounce-gif", "videos": [],
        "inspect": { "frameCount": 4, "cell": { "width": 64, "height": 64 }, "anchorDrift": { "x": 0.5, "y": 0 }, "maxJump": 1, "scaleDrift": 0.02, "emptyFrames": [], "warnings": [] }
      }
    ]
  }
}
```

Derive edges for a multi-input step (`pack`, `gif`, `r2v` video) use the
first input as `fromAssetId` and list every input id in
`operation.params.inputs` — craft edges are single-parent; the params carry
the full fan-in.

### atlas.json schema (game-engine consumable, TexturePacker JSON-hash compatible)

```json
{
  "meta": { "app": "pneuma-sprite", "version": 1, "image": "sheet.png", "size": { "w": 1024, "h": 1024 }, "scale": 1, "fps": 8, "loop": true, "anchor": "bottom" },
  "frames": {
    "idle_00": { "frame": { "x": 0, "y": 0, "w": 256, "h": 256 }, "rotated": false, "trimmed": false,
                 "spriteSourceSize": { "x": 0, "y": 0, "w": 256, "h": 256 }, "sourceSize": { "w": 256, "h": 256 },
                 "pivot": { "x": 0.5, "y": 1.0 }, "duration": 125 }
  },
  "animations": { "idle": ["idle_00", "idle_01"] }
}
```

`pivot` is `{0.5, 1.0}` for `anchor: bottom` and `{0.5, 0.5}` for `center`.
`duration` is `round(1000 / fps)` ms. Frames are laid out row-major in the
packed image, `cols` per row, no margin, no gutter.

### Viewer URL and cache-busting

`/content/<contentSet>/<uri>?v=<imageVersion>` with each path segment
`encodeURIComponent`-ed (`modes/illustrate/viewer/IllustratePreview.tsx::getImageUrl`
and `modes/clipcraft/viewer/assets/useWorkspaceAssetUrl.ts`). Image bytes never
flow through `useSource`; only the global `imageVersion` prop changes when any
image changes.

### Script conventions (all of TASK-2 and TASK-4)

- Plain `node`/`bun`-runnable ESM (`.mjs`), no npm dependencies, Node built-ins
  only; ffmpeg/ffprobe on PATH via `spawnSync` (check presence once, fail with
  a clear message).
- Key discovery like the existing shared scripts: `process.env` first, then
  `.env` at the skill root, then walk up from `cwd`. Never print keys.
- `--json` prints exactly one JSON object on stdout; progress goes to stderr.
  Exit code 0 on success, 1 on failure with a one-line `ERROR:` on stderr.
- fal calls go through `fal-queue.mjs::runFalJob` (queue URL, poll, cancel on
  deadline/abort, retry only on proven-not-reached failures). Local files
  become base64 data URIs (≤ 30 MB for Seedance, ≤ 8 MB is the practical
  size for references; error out above the limit with a clear message).
- Writes are atomic (write to `<path>.tmp` then rename).
- Every script has `--help` text listing all flags.

---

## Wave plan

| Wave | Mode | Tasks |
|------|------|-------|
| 1 | parallel | TASK-1 core seams · TASK-2 shared scripts · TASK-3 mode skeleton · TASK-4 pipeline scripts |
| 2 | parallel (after wave 1 merged) | TASK-5 viewer · TASK-6 seed content |
| 3 | serial (after wave 2 merged) | TASK-7 hosted player |
| — | orchestrator | showcase imagery (`/showcase`), Codex end-to-end blind trial, bump |

Every task: `bun run typecheck` clean, `bun test <scope>` green, no new
`if (backendType === …)`, no React in `manifest.ts`, no hardcoded mode name in
`server/` or `bin/`.

---

## TASK-1

Core seams the sprite mode needs. Small, contract-flavoured.

1. `src/hooks/useCaptureAction.ts`: add `"motion"` and `"ref"` to
   `COARSE_ADDRESS_KEYS` (keep the array sorted by the existing grouping; add
   a comment naming the mode that introduced them). If a test pins the list,
   extend it.
2. `hasInitParams` in `server/index.ts` (search `hasInitParams`): replace the
   hardcoded `name === "slide" || … ` conditional with a value derived from the
   parsed manifest. Extend `core/utils/manifest-parser.ts::ParsedManifest` with
   `hasInitParams?: boolean` set when the manifest source declares a non-empty
   `params: [ … ]` array inside `init` (regex-level like the other extractors —
   the parser never evaluates TS). Then `server/index.ts` spreads
   `parsed.hasInitParams ? { hasInitParams: true } : {}`. First read what the
   launcher does with the flag (`grep -n hasInitParams src/components/Launcher.tsx`)
   and keep that behaviour identical for slide / illustrate / kami; the change
   must also make plotwise, clipcraft, bansho and any future mode with params
   report `true`.
3. Tests: `core/utils/__tests__/manifest-parser*.test.ts` (extend or create):
   a manifest with `init: { params: [ {…} ] }` → `hasInitParams: true`; with
   `params: []` or no `init` → falsy; a `params:` array that appears only in a
   comment or outside `init` must not trip it (be pragmatic — the parser is
   regex-based; document the limitation in a comment). `server/__tests__`
   registry test (find the one that asserts `/api/registry` builtins) gets a
   case asserting `hasInitParams` is `true` for illustrate and plotwise and
   absent/false for `doc`.
4. `docs/reference/viewer-agent-protocol.md`: if it documents
   `COARSE_ADDRESS_KEYS` or the capture pre-navigation, add the two keys.

Acceptance: typecheck clean; `bun test core server src` green; grep confirms no
mode name remains in the `hasInitParams` expression.

## TASK-1-REVIEW

Everything in TASK-1 plus: the parser change must not regress any existing
`ParsedManifest` field (run the full `core/utils` tests); the capture keys
must not collide with an existing mode's fine key (grep `motion` / `ref` in
`modes/*/viewer` and `modes/*/manifest.ts` for address usage); the server
diff contains no hardcoded mode names (this task *removes* three). The
reviewer also checks that `hasInitParams` semantics in the launcher UI are
unchanged for the three modes that had it.

---

## TASK-2

Shared scripts under `modes/_shared/scripts/` (source of truth; the installer
copies whitelisted ones per mode).

### 2a. `generate_image.mjs --background`

- New flag `--background auto|transparent|opaque` (default: flag absent → the
  `background` field is **omitted** from the request body, preserving current
  behaviour byte-for-byte).
- When `transparent`: `output_format` must be `png` or `webp`; if the user
  passed `jpeg`, fail before the request with a clear message. Pass
  `background` in the OpenRouter body (`POST https://openrouter.ai/api/v1/images`,
  field name `background`).
- `edit_image.mjs` forwards the flag.
- After saving, when `--background transparent` was requested, probe the saved
  file and report `hasAlpha: boolean` in the JSON result (decode the PNG
  header: color type 4 or 6, or a `tRNS` chunk; WebP: VP8X alpha flag; no
  ffmpeg needed here). Print a stderr warning when the provider ignored the
  request. Update `generate_image.d.mts` and `--help`.
- Tests in `modes/_shared/scripts/__tests__/image-generation.test.ts`:
  `buildImageRequest` includes/omits `background`; jpeg + transparent throws;
  `hasAlpha` detection on a hand-built 1×1 RGBA PNG buffer vs an RGB one.

### 2b. `seedance-video.mjs` (new)

Seedance 2.5 on fal, same CLI shape as `generate-video.mjs` so the skill text
can describe both with one grammar.

- Endpoints: `https://fal.run/bytedance/seedance-2.5/text-to-video`,
  `…/image-to-video`, `…/reference-to-video`, driven through
  `fal-queue.mjs::runFalJob` (queue URL rewrite is inside the helper).
- Flags: `--prompt` (required), `--output <path>` (required), `--endpoint text|image|reference`
  (inferred: `--ref-*` → reference, `--image` → image, else text), `--image <path|url>`,
  `--end-image <path|url>`, `--ref-image` (repeatable, ≤ 30), `--ref-video`
  (repeatable, ≤ 10), `--ref-audio` (repeatable, ≤ 10), `--duration auto|4..30`
  (default `auto`; refuse values outside 4–30), `--resolution 480p|720p|1080p`
  (default `480p` — the cheap tier is the right default for previews),
  `--aspect-ratio auto|21:9|16:9|4:3|1:1|3:4|9:16` (refused on the image
  endpoint, which is fixed to `auto`), `--no-audio` (sets `generate_audio: false`;
  default true like fal), `--bitrate standard|high`, `--seed N`, `--json`,
  `--deadline-s` (default 900).
- Payload field names exactly: `prompt`, `image_url`, `end_image_url`,
  `image_urls`, `video_urls`, `audio_urls`, `resolution`, `duration`,
  `aspect_ratio`, `generate_audio`, `bitrate_mode`, `seed`.
- Local inputs → data URIs; refuse files over 30 MB. References are addressed
  in the prompt as `@Image1`, `@Video1`, `@Audio1` (document in `--help`).
- Download with the idle-based timeout pattern from `generate-video.mjs`
  (extract a shared helper into `fal-queue.mjs` if that is cleaner — keep the
  existing exports intact). After download, if ffmpeg is on PATH, remux with
  `-c copy -movflags +faststart` (browser range-seek); skip with a stderr note
  when ffmpeg is absent.
- `--json` → `{ path, url, file_size, model: "bytedance/seedance-2.5", endpoint, requested_duration, resolution, seed? }`.
- SIGINT/SIGTERM → remote cancel, exit 130 (mirror the H3 script).
- Add `seedance-video.d.mts` mirroring `generate-video`'s stub style.
- Tests (`__tests__/seedance-video.test.ts`): request-body builder per endpoint
  (image endpoint refuses `--aspect-ratio`; duration validation; audio flag;
  data-URI conversion for a tiny local file; the 30 MB guard), endpoint
  inference. Network is mocked — never call fal in tests.

### 2c. `remove-background.mjs` (new)

- fal `fal-ai/birefnet/v2` through `runFalJob`. Flags: `--input <png|jpg|webp>`
  (required), `--output <png>` (required), `--model light|light-2k|heavy|matting|portrait|dynamic`
  mapped to fal's enum strings (`"General Use (Light)"`, `"General Use (Light 2K)"`,
  `"General Use (Heavy)"`, `"Matting"`, `"Portrait"`, `"General Use (Dynamic)"`;
  default `heavy`), `--resolution 1024|2048|2304` → `operating_resolution`
  (`"2048x2048"`; default `2048`), `--no-refine` → `refine_foreground: false`,
  `--json`, `--deadline-s` (default 300).
- Payload: `{ image_url, model, operating_resolution, output_format: "png", refine_foreground }`.
  Result: download `image.url` to `--output`. `--json` → `{ path, url, width, height, model }`.
- `remove-background.d.mts` stub; `--help`.
- Tests: payload mapping for every `--model` alias; unknown alias fails; output
  path handling; mocked job runner.

Acceptance for TASK-2: `bun test modes/_shared` green; `bun run typecheck`
clean; `node modes/_shared/scripts/<each>.mjs --help` prints usage and exits 0;
no script imports a sibling that is not `fal-queue.mjs` or `generate_image.mjs`.

## TASK-2-REVIEW

TASK-2 plus: the OpenRouter request for callers that never pass `--background`
must be identical to before (compare the body in tests); the seedance script
must never resubmit after a lost response (fal has no idempotency key — check
that submit retries are delegated to `runFalJob`, not re-implemented); every
fal payload key matches the fal schema listed in TASK-2 exactly; keys never
reach argv or logs; `--help` output is complete; the `.d.mts` stubs match the
exported functions. The reviewer also confirms `edit_image.mjs` forwards
`--background` and that `generate_image.mjs`'s `--style sketch` prompt mutation
is untouched.

---

## TASK-3

Mode skeleton: manifest, domain, binding, skill text, showcase copy,
registration. The viewer is a stub in this task (TASK-5 replaces it). Read
`.claude/skills/create-mode/assets/templates/*` and `modes/illustrate/` first;
follow the template structure, not memory.

### 3a. `modes/sprite/manifest.ts`

Fill from the brief: identity (three locales for displayName/description),
icon, `changelog: { "0.1.0": [...] }`, `skill` (`sourceDir: "skill"`,
`installName: "pneuma-sprite"`, `mdScene`, `envMapping`, `sharedScripts` as
listed in the brief), `viewer.watchPatterns` / `ignorePatterns`, `agent`
(`bypassPermissions`, a greeting modelled on illustrate's), `init`
(`contentCheckPattern: "**/project.json"`, `seedFiles: {}` and `seeds: []` for
now — TASK-6 fills them, `params` for the two keys + `defaultVideoModel`,
`deriveParams` → `imageGenEnabled` / `videoGenEnabled`), `viewerApi`
(workspace model, the four actions with imperative descriptions that say *when*
to use them, the three commands, optional `scaffold` mirroring illustrate's if
it costs nothing), `evolution.directive`, `sources.roster` (aggregate-file with
`loadRoster` / `saveRoster` from `domain.ts`). No React imports.

### 3b. `modes/sprite/domain.ts`

Types from "project.json schema" (`CharacterProject` = parsed craft file +
`sprite` sidecar; export `SpriteSidecar`, `Motion`, `InspectSummary`,
`Roster`). `loadRoster(files)`: for every `project.json` in the snapshot, key
by directory prefix (root-level file → `""`), parse defensively — a file that
fails to parse or lacks `$schema === "pneuma-craft/project/v1"` or a `sprite`
object is skipped (not thrown), assets are indexed into a `Map<id, Asset>` and
exposed as `assetsById`; motions keep their declared order. Return `null` when
nothing loaded. `saveRoster` throws with the same wording as illustrate's stub.
Helper: `resolveAssetUri(project, assetId) → string | undefined`.

### 3c. `modes/sprite/pneuma-mode.ts`

`ModeDefinition` binding: `PreviewComponent` = stub `viewer/SpritePreview.tsx`
(renders the character name, motion list with status chips, and the copy
"Sprite mode initialized — ask the agent to design a character" when the roster
is null; uses `useSource(props.sources.roster)`); `extractContext` emits a
`<viewer-context mode="sprite">` block with `Address:` (verbatim JSON), the
selected motion's grid / fps / loop / anchor / status / frame count, inspect
warnings when present, and — with no selection — a character overview (name,
style, refs, motions with statuses). `workspace` copied from the manifest,
`resolveContentSets: createDirectoryContentSetResolver()`, `resolveItems` (one
item per motion), `createEmpty` returns a fresh `project.json` skeleton for a
new `<name>/` (use `sprite-project.mjs init`'s output shape; keep the two in
sync by sharing a tiny pure function if it fits, otherwise a test pins both).
`actions: manifest.viewerApi?.actions`, `updateStrategy: "incremental"`.

### 3d. `modes/sprite/skill/SKILL.md` + `skill/references/`

Follow `.claude/skills/create-mode/references/skill-md-patterns.md`:
Scene → Viewer contract (address table with coarse/fine kinds; the four
actions and when to call them; capture; the three commands) → Core rules →
Workflows → Commands → References. Keep SKILL.md under 400 lines; depth goes
to references. All English.

Core rules (each with its *why*):
- `project.json` is written only through `scripts/sprite-project.mjs`; never
  hand-edit it (16 asset entries per motion drift the moment a human types
  them). Frames, atlas, previews are written only by `sprite-sheet.mjs`.
- Every sheet is generated with the character references attached
  (`--image-urls` for each ref) and `--background transparent`; the style
  anchor sentence from `character.style` opens every prompt.
- Look before you claim: after `register-run`, read the inspect warnings,
  `navigate-to` the motion, `play`, `capture` two or three frames, and only
  then report. The viewer is the agent's eyes; the sheet PNG is not the
  animation.
- Scripts retry upstream failures themselves; call once, report the failure
  state to the user, do not improvise retry loops.
- Never pass `--style` to `generate_image.mjs` (it rewrites the prompt).
- Video clips are previews of a motion, not sources of frames — frames come
  from the sheet.

Workflows:
- **A. Design a character** — short interview (name, one-paragraph description,
  style, facing, cell size), generate `refs/turnaround.png` (three-view sheet
  on transparent background, 2048×2048, high quality) and `refs/portrait.png`;
  `sprite-project.mjs init` + `add-ref`; `navigate-to { ref }` + capture.
- **B. Add a motion** — decide grid / fps / loop / anchor from the motion type
  (table: idle 4×4 8fps loop bottom; walk/run 4×2 or 4×4 10–12fps loop bottom;
  attack 4×4 10fps no-loop bottom; jump 4×2 center; story key poses 3×3
  no-loop bottom); `add-motion --status planned` → `set-sheet … --status generating`
  before calling `generate_image.mjs` (viewer shows a placeholder) → probe
  alpha (`sprite-sheet.mjs probe`) → if opaque: `remove-background.mjs`
  (fal) or, without a fal key, `sprite-sheet.mjs key` → `sprite-sheet.mjs run`
  → `register-run` → read `inspect` → verify via play + capture → fix loop
  (edit a single bad cell with `edit_image.mjs` on the raw sheet and re-run, or
  regenerate with a tightened prompt).
- **C. Render a video preview** — choose the model (default from
  `{{defaultVideoModel}}`); `i2v`: flatten frame 00 onto the character's
  background color, `seedance-video.mjs --image … --duration 4 --resolution 480p --no-audio`;
  `first-last`: add `--end-image` (last frame, or frame 00 for a loop); `r2v`:
  `--ref-image refs/turnaround.png --ref-image motions/<id>/sheet.png` with a
  prompt that says `@Image1` is the character and `@Image2` is the motion
  sequence to perform; H3 alternative with `generate-video.mjs` (`--image`,
  `--end-image`, `--ref-image`, 480P, duration ≥ 5). `add-video` before the
  call with status `generating`, then `--status ready`.
- **D. Hand off to a game engine** — what `sheet.png` + `atlas.json` are, how
  Phaser / PixiJS load JSON-hash atlases, `pack --scale 0.5 --nearest` for
  pixel look.

References (each ≤ 300 lines): `references/prompting.md` (sheet prompt grammar
with three worked prompts — chibi, pixel, anime; what breaks consistency:
mixed facing, per-cell scale drift, cell numbers, drop shadows, effects that
leave the cell; how to phrase frame-to-frame continuity; how to fix one cell),
`references/pipeline.md` (every `sprite-sheet.mjs` and `sprite-project.mjs`
subcommand with flags, the atlas schema, the inspect report fields and what
each warning means), `references/video-preview.md` (both video scripts' flags,
endpoint choice, cost/latency table with the numbers known today: Seedance 2.5
i2v ≈ $0.22/s at 480p and $0.47/s at 720p; H3 480P/768P from plotwise's
measurements; the reference binding grammar for both), `references/project-json.md`
(the schema section of this document, condensed).

Template variables used: `{{defaultVideoModel}}`, `{{#imageGenEnabled}}…{{/imageGenEnabled}}`
and `{{#videoGenEnabled}}…{{/videoGenEnabled}}` sections modelled on
illustrate's `{{#imageGenEnabled}}` block (read its opening/closing syntax in
`modes/illustrate/skill/SKILL.md` before using it).

### 3e. `modes/sprite/showcase/showcase.json`

From the template: tagline (en/zh-CN/ja), `hero.png`, three highlights —
"Character-Locked Sheets" (references attached to every generation),
"Auto Slice & Align" (transparent, aligned frames + atlas + GIF),
"Video Preview" (Seedance / H3 clip beside the GIF). Image files are produced
later by `/showcase`; do not draw placeholders.

### 3f. Registration

- `core/mode-loader.ts` builtin entry (copy the neighbouring shape).
- `server/index.ts` `builtinNames` += `"sprite"`.
- `AGENTS.md` `**Builtin Modes:**` line += `sprite` (never touch `CLAUDE.md`).
- `README.md` and `README.zh.md` Built-in Modes tables: one row each.
- `docs/reference/` — if a per-mode address vocabulary table exists in
  `viewer-agent-protocol.md`, add sprite's row.

### 3g. Tests

`modes/sprite/__tests__/domain.test.ts` with the canonical fixture: loads one
content set keyed `mini`, motions ordered, `assetsById` resolves frame uris,
null on empty snapshot, a malformed `project.json` is skipped while a valid
sibling loads, root-level project keys as `""`. `extractContext` test: address
line is verbatim JSON; selected motion summary includes grid and fps.
`resolveItems` returns one item per motion.

Acceptance: `bun run typecheck` clean; `bun test modes/sprite core server`
green; `curl /api/registry` would list `sprite` (assert via the existing
registry test if one enumerates builtins — extend it); `bun run dev sprite`
starts (run it for 20 s in the worktree with `--no-open --port 18990` and
confirm the log reaches "ready" — if the environment blocks this, say so).

## TASK-3-REVIEW

TASK-3 plus: manifest has zero React imports and both `manifest.ts` and
`pneuma-mode.ts` declare the *same* four actions (the project's known
duplication — the reviewer diffs them); every action `description` states
*when* the agent should use it; the SKILL.md address table lists all four keys
with the right coarse/fine kind; the `commands` ids in the manifest match the
SKILL.md Commands section; the skill never references another skill's path;
`sharedScripts` lists every script the skill text invokes and every import of
those scripts; registration touched all five places (mode-loader, builtinNames,
AGENTS.md, README.md, README.zh.md); `showcase.json` has all three locales;
`domain.ts` never throws on malformed input. The reviewer also reads the
prompting reference for the four consistency traps (facing, scale, labels,
effects outside the cell) and checks the motion-type table exists.

---

## TASK-4

Mode-local pipeline scripts: `modes/sprite/skill/scripts/sprite-sheet.mjs`
and `modes/sprite/skill/scripts/sprite-project.mjs`. Zero npm deps; ffmpeg /
ffprobe via `spawnSync`. Read `modes/_shared/scripts/storyboard.mjs` (crop
slicing) and `generate-video.mjs` (`imageSize`, `fitReference`) first.

### 4a. `sprite-sheet.mjs`

Shared internals: `readRgba(path) → { width, height, data: Buffer }` via
`ffmpeg -v error -i <path> -f rawvideo -pix_fmt rgba -` (one decode per file;
an opaque source yields all-255 alpha); `writeFrame(...)` via ffmpeg filters
with `-pix_fmt rgba`; bbox computation over the alpha channel with a
threshold (default 16/255).

Subcommands (all accept `--json`; all print `--help`):

- `probe <image>` → `{ width, height, hasAlpha, alphaCoverage, cornerColor }`
  (`hasAlpha` = any alpha < 255; `alphaCoverage` = fraction of pixels with
  alpha ≥ threshold; `cornerColor` = median of the four 8×8 corner patches as
  `#rrggbb`).
- `key <in> --out <png> [--color auto|#rrggbb] [--similarity 0.12] [--blend 0.05]`
  → ffmpeg `colorkey=<color>:<similarity>:<blend>,format=rgba`; `auto` uses
  `cornerColor`. Report `alphaCoverage` after keying.
- `flatten <in> --out <png> [--bg #ffffff]` → composite onto a solid color
  (for video-model inputs that mishandle alpha).
- `slice <sheet> --rows R --cols C --out <dir> [--margin px] [--gutter px]`
  → `<dir>/NN.png` row-major; cell = `(W − 2·margin − (C−1)·gutter) / C`
  (same for rows); non-integer cell sizes are floored and reported; the
  output keeps alpha (`-pix_fmt rgba`).
- `align <framesDir> --out <dir> [--anchor bottom|center] [--cell auto|WxH] [--pad 8] [--smooth]`
  → per-frame bbox; anchor point = bottom-center of bbox (`bottom`) or bbox
  center (`center`); cell `auto` = max bbox w/h across frames + 2·pad, made
  even; each frame is `crop`ped to its bbox then `pad`ded onto a transparent
  cell (`pad=W:H:x:y:black@0`) so the anchor lands at the same point in every
  frame (bottom: x centered, y = H − pad; center: cell center). `--smooth`
  replaces each frame's anchor x with the 3-frame median (y untouched for
  `bottom`). Empty frames (no pixel above threshold) are emitted as a fully
  transparent cell and reported.
- `pack <framesDir> --out <sheet.png> --atlas <atlas.json> --name <motionId> --fps N [--loop] [--anchor bottom|center] [--cols C] [--scale 0.5] [--nearest]`
  → packed image via ffmpeg `tile=CxR` over the frame sequence with a
  transparent fill (verify alpha survives; if `tile`'s `color` cannot be
  transparent, compose with `overlay` on a `color=black@0` canvas), `--scale`
  resizes every frame first (`scale=…:flags=neighbor` when `--nearest`), and
  writes `atlas.json` exactly per the schema above.
- `gif <framesDir> --out <preview.gif> --fps N [--loop|--no-loop] [--webp <preview.webp>] [--width W]`
  → ffmpeg `split → palettegen=reserve_transparent=1:stats_mode=full →
  paletteuse=alpha_threshold=128:dither=sierra2_4a`, `-loop 0` for loop, `-loop -1`
  for play-once; WebP via `libwebp` (`-loop 0`, `-q:v 85`, `-pix_fmt yuva420p`)
  when the encoder exists, otherwise skip with a warning in the JSON.
- `inspect <motionDir> [--anchor bottom|center]` → the `InspectSummary` JSON
  (frame count, cell, per-frame bbox list, `anchorDrift` std-dev, `maxJump`,
  `scaleDrift`, `emptyFrames`, `warnings[]`) and writes `<motionDir>/inspect.json`.
  Warning rules: empty frame; `maxJump > 0.08·cellWidth` ("anchor jumps
  between frames NN and MM"); `scaleDrift > 0.15` ("character scale varies
  across frames — regenerate with a fixed-scale instruction"); alpha
  coverage < 0.02 in a frame ("frame NN is nearly empty"); bbox touching the
  cell edge before alignment ("cell NN is clipped — the drawing leaves its
  grid cell").
- `run <sheet-raw> --rows R --cols C --out <motionDir> --name <motionId> --fps N [--loop] [--anchor bottom|center] [--key auto|#rrggbb|none] [--cell auto|WxH] [--pad 8] [--smooth] [--scale] [--nearest] [--margin] [--gutter]`
  → the whole chain: probe → (key when opaque and `--key` ≠ none, writing
  `sheet-alpha.png`) → slice (to a temp dir) → align (to `frames/`) → pack
  (`sheet.png`, `atlas.json`) → gif (+ webp) → inspect. Emits one JSON:
  `{ motionDir, sheetRaw, sheetAlpha?, frames: [paths], sheet, atlas, gif, webp?, inspect: InspectSummary, cell, warnings }`.
  Copies/leaves `sheet-raw.png` in place (never moves the input).

### 4b. `sprite-project.mjs`

Deterministic `project.json` mutations (the only writer). Every subcommand
takes `--dir <characterDir>` and prints the resulting motion or project summary
as JSON with `--json`. Atomic writes; preserves unknown top-level fields;
validates unique asset ids; `createdAt`/`timestamp` from `Date.now()` unless
`--at <ms>` is passed (tests use `--at`).

- `init --name "Lumi" [--description ""] [--style ""] [--cell 256x256] [--facing right]`
  → creates `<dir>/project.json` per the schema (fails if it exists unless
  `--force`).
- `add-ref --id turnaround --file refs/turnaround.png --role turnaround [--label] [--prompt] [--model] [--from <assetId,…>]`
  → asset `ref-<id>` (+ `generate` edge; `fromAssetId` = first `--from` or null).
- `add-motion --id idle --label Idle --rows 4 --cols 4 --fps 8 [--loop] [--anchor bottom] [--prompt ""] [--status planned]`.
- `set-motion --motion idle [--label] [--fps] [--loop|--no-loop] [--anchor] [--prompt] [--status] [--notes]`.
- `set-sheet --motion idle --file motions/idle/sheet-raw.png --from ref-turnaround[,…] [--model] [--prompt] [--background transparent] [--status processing]`
  → asset `<motion>-sheet-raw` (+ generate edge with `inputs` in params);
  status defaults to `processing`. Re-running replaces the previous raw sheet
  asset and edges (keeps the id stable).
- `register-run --motion idle --run <run.json | ->` → consumes `sprite-sheet.mjs run`
  output: registers `sheet-alpha` (if present), every frame, `sheet`, `atlas`,
  `gif`, `webp` as assets with `derive` edges (frames from the raw or alpha
  sheet with `params.cell`; pack/gif from frame 00 with `params.inputs` =
  all frame ids), replaces any previous frame assets for the motion (stale
  ids removed from `assets`, `provenance`, and the motion), copies
  `inspect` into the motion, sets status `ready`.
- `add-video --motion idle --file motions/idle/video-seedance-1.mp4 --model seedance-2.5 --mode i2v --from idle-frame-00[,idle-frame-15] [--prompt] [--duration 4] [--status generating]`
  → asset `<motion>-video-<n>` (n = next free) + generate edge; `set-video --motion idle --video <id> --status ready|failed [--notes]`.
- `remove-motion --motion idle` → removes the motion, its assets and edges
  (files on disk untouched; prints the orphaned paths).
- `show [--motion id]` → compact summary for the agent (name, refs, motions
  with status / grid / fps / frame count / warnings).

### 4c. Tests (`modes/sprite/__tests__/`)

- `sprite-sheet.test.ts`: build a synthetic 2×2 sheet with ffmpeg
  (`-f lavfi -i color=c=black@0:s=128x128,format=rgba` plus `drawbox` of a
  filled colored square at a different offset in each cell), then assert:
  `probe` reports alpha; `slice` yields four 64×64 RGBA files; `align --anchor bottom`
  produces identical bottom-center anchors (decode outputs with `readRgba`
  and compute bboxes); `pack` writes a 128×128 image and an `atlas.json`
  matching the schema (four frames, pivot `{0.5,1}`, `duration 125`); `gif`
  produces a GIF (magic `GIF89a`) and, if libwebp is present, a WebP;
  `inspect` returns zero warnings on the clean sheet and flags an injected
  empty cell; `key` turns an opaque green-background sheet transparent
  (alphaCoverage drops below 0.5). Skip the suite with a clear message when
  ffmpeg is absent (the routine suite must not fail on machines without it,
  but CI and this machine have it).
- `sprite-project.test.ts`: `init` → `add-ref` → `add-motion` → `set-sheet`
  → `register-run` (feed a hand-written run JSON pointing at the fixture
  paths) reproduces the canonical fixture byte-for-byte except timestamps
  (use `--at`); re-running `register-run` leaves no orphan assets; `add-video`
  numbering; `remove-motion` cleans edges; atomic write leaves no `.tmp`.

Acceptance: `bun test modes/sprite` green on this machine; `bun run typecheck`
clean; both scripts print `--help`; a manual run of `run` on the fixture sheet
in the worktree produces the documented files.

## TASK-4-REVIEW

TASK-4 plus: no npm dependency added; every ffmpeg invocation passes `-y -v error`
and never inherits stdin; temp dirs are cleaned; `align` guarantees a
*uniform* cell across frames (the reviewer decodes two outputs); the atlas
`frame` rects tile the packed image exactly; `register-run` is idempotent;
`sprite-project.mjs` never writes a partial file; `inspect` warning thresholds
are constants with a comment; error messages name the failing step and file.
The reviewer also runs `run` on a deliberately opaque sheet (`--key auto`) and
confirms `sheet-alpha.png` is produced and used for slicing.

---

## TASK-5

The real viewer: `modes/sprite/viewer/` (replace the TASK-3 stub). Read
`.claude/rules/frontend.md` first; visual verification through the
`chrome-devtools-mcp:chrome-devtools-cli` skill (screenshots into the impl
report) is mandatory. Theme tokens `cc-*`, no native `<select>`, no emoji, both
light and dark themes.

### 5a. Layout (editor layout; the viewer is the right pane)

- **Header**: character name, style chip, cell size, refs count / motions
  count. Content-set switching stays with the framework.
- **Left rail** (collapsible, ~240 px): "References" (thumbnails; click →
  `onSelect` with address `{ contentSet, ref }` and the stage shows the image),
  "Motions" (ordered list, status chip per motion: planned / generating /
  processing / ready / failed, frame count, fps; click → select).
- **Stage** (center): a `<canvas>` playing the selected motion. Frame source
  precedence: (1) aligned `frames[]` via `/content/…?v=imageVersion`, all
  preloaded before playback starts; (2) when `frames` is empty but `sheetRaw`
  (or `sheetAlpha`) and `grid` exist, slice the sheet client-side with
  `drawImage` (the instant "unprocessed preview" right after generation —
  label it as such); (3) nothing → empty stage with the motion's status text.
  Playback uses `requestAnimationFrame` with an accumulator against
  `1000/fps`; loop honours `motion.loop`; non-loop motions stop on the last
  frame. Background toggle (checkerboard / solid / character bg), zoom
  (fit / 1× / 2× with `imageSmoothingEnabled=false` at 2×), a ground line at
  the anchor y for `bottom`, onion-skin toggle (previous and next frame at
  30 % alpha in two tints). Selecting a frame (scrubber click) calls
  `onSelect` with `{ contentSet, motion, frame }` plus a `thumbnail` data URL
  of that frame (≤ 200 px) for the chat context.
- **Transport bar** under the stage: play/pause, frame back/forward, loop
  toggle (local), fps stepper (local override, shows the motion's default),
  frame counter `07 / 16`, and a **frame strip** (thumbnails, current frame
  highlighted, click to seek).
- **Preview panel** (right or bottom, responsive): tabs *GIF* (renders
  `preview.gif` when present with a "Download" link built from the `/content`
  URL; otherwise "Not rendered yet"), *Video* (list of `videos[]` with a
  `<video controls>` per ready clip, model + mode chips, prompt excerpt,
  generating shimmer / failed note), *Atlas* (`sheet.png` with the grid drawn
  from `atlas.json` rects, cell size, and links to both files).
- **States**: roster null → onboarding copy; character with no motions → copy
  that suggests the first motion; motion `generating` → shimmer on the stage
  with the prompt excerpt; `processing` → "Slicing and aligning…";
  `failed` → notes in a warning block; inspect warnings → an amber badge on
  the motion and a list in the panel.
- **Commands** (`props.commands`) render as buttons in the header only when
  `props.editing !== false`; `render-video` opens a popover with model
  (Seedance 2.5 / H3 Max, default from `props.initParams?.defaultVideoModel`)
  and mode (i2v / first-last / r2v); on confirm call `props.onNotifyAgent`
  with a structured text: `command: render-video · motion: attack · model: seedance-2.5 · mode: first-last`
  (mirror the shape other modes use — read how illustrate/clipcraft format
  notifications). `regenerate-motion` and `fix-alignment` notify with the
  selected motion and an optional note typed in the popover.

### 5b. Actions and capture

Handle `props.actionRequest` for `navigate-to` (address with `ref` → show ref;
with `motion` → select; with `frame` → seek + pause; content set switch is the
store's job — if the address names another content set, return
`{ success: false, message }` like `src/store/navigate-plan.ts` expects),
`play`, `pause`, `get-playback-state` (return the documented object in
`data`). Report through `props.onActionResult`. `navigateRequest` /
`onNavigateComplete` follow the same resolution as `navigate-to`. Register
`useCaptureAction` so a capture at `{ motion, frame }` seeks first (the hook
pre-navigates via `navigateRequest`; make sure the seek has painted before
the hook screenshots — the hook waits ~1.1 s) and captures the stage element
(not the whole pane).

### 5c. Player compatibility

No `/api/*` calls at render. Anything that would need the backend is gated on
`useStore((s) => s.staticPlayer)` and `props.editing !== false`. All asset URLs
are `/content/<contentSet>/<uri>` with per-segment encoding. Nothing writes.

### 5d. Structure and tests

Split sensibly: `SpritePreview.tsx` (shell + source subscription),
`Stage.tsx`, `FrameStrip.tsx`, `MotionRail.tsx`, `PreviewPanel.tsx`,
`CommandPopovers.tsx`, `playback.ts` (pure: frame scheduler, address
normalization, frame-source resolution), `urls.ts`. Tests in
`modes/sprite/__tests__/viewer-logic.test.ts` for the pure modules:
scheduler advances at 8 fps, stops on last frame when not looping, wraps
when looping; frame-source precedence with the canonical fixture; address
resolution (`{ frame }` alone applies to the selected motion; unknown motion
→ failure result); URL builder encodes each segment.

Acceptance: typecheck clean; `bun test modes/sprite` green; screenshots of
(1) the seed or fixture character playing, (2) the frame strip with a selected
frame, (3) the Video tab, (4) the empty state — light and dark — attached to
the report; `get-playback-state` verified by dispatching the action from a
`--viewing` session or the fixture harness (state your method).

## TASK-5-REVIEW

TASK-5 plus: playback timing does not drift (accumulator, not `setInterval`);
frames are preloaded before the first paint (no flicker on first loop);
`imageVersion` changes reload frames without resetting the playhead when the
frame count is unchanged; keyboard: space toggles play, arrows step frames;
the stage keeps aspect on resize; selection context includes a thumbnail;
commands are hidden when `editing === false` and nothing calls `/api/*`
without the `staticPlayer` guard; every visible string is English; no native
form controls; `cc-*` tokens only; dark and light screenshots exist in the
report; `get-playback-state` returns `warnings` from the motion's inspect
summary. The reviewer checks that the client-side sheet slicing fallback
labels itself as unprocessed and that a `failed` motion shows its notes.

---

## TASK-6

Seed content: generate the real Lumi character with the mode's own scripts,
in a scratch workspace, then place the result under `modes/sprite/seed/lumi/`
and wire it into the manifest. This is also the first real end-to-end run of
TASK-2 + TASK-4 — record what you learn.

1. Keys: `set -a; . <main checkout>/.env; set +a` (the worktree cannot find the
   repo `.env` by walking up — see `.claude/rules/modes.md`). Never print them.
2. In a scratch dir (`/private/tmp/...` or the session scratchpad), copy the
   scripts as the installer would (`modes/sprite/skill/scripts/*` + the shared
   ones listed in `sharedScripts`) and run the SKILL.md workflows literally:
   `init` → turnaround + portrait (GPT Image 2.5, `--background transparent`,
   2048×2048, high) → `add-ref` ×2 → `idle` (4×4, 8 fps, loop, bottom) and
   `attack` (4×4, 10 fps, no loop, bottom): `add-motion` → `set-sheet` →
   `generate_image.mjs` with both refs → probe → (remove-background if
   opaque) → `run` → `register-run`. Then one Seedance 2.5 `first-last` clip for
   `attack` (480p, 4 s, `--no-audio`) → `add-video` / `set-video`.
3. Judge the results like the agent would: read `inspect.json` warnings; if
   the sheet drifts (scale / facing / clipped cells), fix the prompt and
   regenerate — at most three attempts per motion; keep the best. Write a
   short `modes/sprite/seed/README.md` (what the seed is, how it was made, the
   prompts used) — this doubles as the prompting reference's worked example.
4. Copy the character directory to `modes/sprite/seed/lumi/`. Run
   `pngquant --quality=85-100 --ext .png --force` on every PNG; keep
   `preview.gif`/`preview.webp` as produced; confirm the seed is ≤ 8 MB
   (`du -sh`). Remove `inspect.json`? No — keep it (small, and the viewer shows
   warnings).
5. Manifest: `init.seedFiles: { "lumi/": "seed/lumi/" }`, `init.seeds: [{ id: "lumi", sourceKey: "lumi/", displayName: {…}, description: {…}, thumbnail: "lumi.png", tags: ["chibi", "sprite-sheet"] }]`,
   and `modes/sprite/seed-gallery/lumi.png` (a 640×360 pngquant-ed crop of the
   attack sheet or a frame — read how other modes produce gallery thumbnails).
6. Append the measured numbers (generation time per sheet, Seedance clip time
   and size, whether `background: transparent` was honoured by the provider,
   which background-removal path was needed) to `skill/references/video-preview.md`
   and `skill/references/pipeline.md` under a "Measured" heading.

Acceptance: `bun run typecheck` clean; `bun test modes/sprite` green;
`du -sh modes/sprite/seed` ≤ 8 MB; `resolveSeedCatalog` lists the seed
(extend the seed-installer test or assert via a quick script); the seed
README exists; the report states which prompts were used and how many
attempts each motion took.

## TASK-6-REVIEW

TASK-6 plus: every PNG in the seed is quantized (check `pngquant` left no
`-fs8` leftovers and files are RGBA); `project.json` in the seed validates
against `loadRoster` and every asset uri exists on disk; no `.tmp`, no
`sheet-raw` duplicates, no absolute paths or keys anywhere in the seed;
`seeds[].sourceKey` matches a `seedFiles` key exactly; the measured numbers
were written into the references; the README's prompts match
`project.json`'s `prompt` fields. The reviewer also checks the frames look
aligned (open two frames, compare bboxes with `sprite-sheet.mjs inspect`).

---

## TASK-7

Hosted player support, earned by verification.

1. `scripts/smoke-sprite.ts` modelled on `scripts/smoke-kami.ts`: materialize a
   play package from a workspace containing `modes/sprite/seed/lumi/` (one
   checkpoint), serve `dist-player` + the package on one origin, print the
   URL.
2. Build the player (`bunx vite build --config vite.player.config.ts`), run the
   smoke, open the URL with the chrome-devtools CLI skill, and exercise the
   viewer read-only: the character loads, idle plays, the frame strip seeks,
   the Video tab plays the clip (Range requests through the content service
   worker), the Atlas tab renders, no command buttons are visible, the console
   has no 404s / unhandled rejections. Attach screenshots.
3. Only then add `"sprite"` to `WEB_PLAYER_SUPPORTED_MODES` in
   `core/player-support.ts` with a comment naming what was verified (mirror
   the style of the bansho/wordtaste comment). Extend any test that pins the
   whitelist.
4. If the package's text allowlist (`src/replay/provider.ts::TEXT_EXTENSIONS`)
   blocks `project.json` or `atlas.json` — it should not, `json` is listed —
   or `.gif`/`.webp`/`.mp4` fail through `/content/*`, fix the cause in the
   player runtime with a test, and report it.

Acceptance: typecheck + `bun test core src` green; the whitelist entry exists
only alongside the screenshots and the console-clean statement in the report.

## TASK-7-REVIEW

TASK-7 plus: the smoke script cleans up its temp dirs; the whitelist comment
is accurate; no viewer code path calls `/api/*` in the player (grep the viewer
for `fetch(`/`/api/`); the report's screenshots show the video actually
playing (a non-zero currentTime) and the GIF tab rendered; `scripts/deploy-player.sh`
is mentioned in the report as the bump-time obligation (not run here).
