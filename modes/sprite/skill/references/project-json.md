# `project.json`

One per character directory. It is a `pneuma-craft/project/v1` project file —
the same format ClipCraft persists — plus a `sprite` sidecar. The craft half
gives every file a provenance edge (what made it, from what, with which
parameters); the sidecar carries everything this mode adds.

**Read it freely. Write it only through `{SKILL_PATH}/scripts/sprite-project.mjs`.** A
single 4×4 motion adds 16 frame assets plus their edges; typed by hand, ids
drift and the viewer renders a motion with missing frames while the files sit
correctly on disk.

## Workspace layout

```
<character>/                      # content set, kebab-case
  project.json
  refs/<ref-id>.png               # turnaround, portrait, expressions…
  motions/<motion-id>/
    sheet-raw.png                 # as generated
    sheet-alpha.png               # background removed (only when raw had none)
    cells/00.png … NN.png         # raw sliced cells before alignment; kept so
                                  # `inspect` can measure clipping/jumps and
                                  # `align` can re-run from them
    frames/00.png … NN.png        # sliced + aligned, uniform cell, RGBA
    sheet.png                     # packed atlas image
    atlas.json                    # frame rects + pivot + timing
    preview.gif
    preview.webp
    video-<model>-<n>.mp4         # video-seedance-1.mp4, video-h3-1.mp4
    inspect.json                  # latest inspect report
```

Frame files are two-digit zero-padded; a motion has at most 100 frames.

## Craft-owned fields

- **`$schema`** — `"pneuma-craft/project/v1"`. A file without it is not read as
  a character.
- **`title`** — the character name.
- **`composition`** — `{ settings: { width, height, fps, aspectRatio },
  tracks: [], transitions: [] }`, where width/height are the character's cell
  size and fps is 8. Always present, tracks always empty — reserved for a
  future timeline, not used by anything today.
- **`assets[]`** — `{ id, type: "image"|"video"|"text", uri, name,
  metadata: { width?, height?, duration?, fps? }, createdAt,
  status?: "pending"|"generating"|"ready"|"failed", tags? }`. `uri` is
  relative to the character directory (`motions/idle/frames/00.png`).
- **`provenance[]`** — `{ toAssetId, fromAssetId: string | null,
  operation: { type: "generate"|"derive"|"upload"|"select",
  actor: "agent"|"human", params?, label?, timestamp } }`.

Craft edges are single-parent. A step with several inputs (`pack`, `gif`, an
`r2v` or `first-last` video, a sheet generated from two or more references)
names its **first** input as `fromAssetId` and lists every input id in
`operation.params.inputs` — so the fan-in is recorded without inventing a
multi-parent edge type. `inputs` appears **only when there really are two or
more**: a single-parent edge (`<motion>-atlas` ← `<motion>-sheet`, an `i2v`
video, a sheet generated from one reference) is fully described by
`fromAssetId` and carries no `inputs` key at all.

### Asset id conventions

| Id | What |
|---|---|
| `ref-<refId>` | A reference image |
| `<motion>-sheet-raw` | The sheet as generated |
| `<motion>-sheet-alpha` | The sheet after background removal |
| `<motion>-frame-NN` | One aligned frame |
| `<motion>-sheet` | The packed atlas image |
| `<motion>-atlas` | `atlas.json` (type `text`) |
| `<motion>-gif` / `<motion>-webp` | The previews |
| `<motion>-video-<n>` | A video clip, n from 1 |

Ids are stable across re-runs: `register-run` removes the previous frame
assets and their edges before writing the new ones, so re-running a motion
updates it instead of accumulating orphans.

`cells/NN.png` has no id on purpose. The pre-align cells are intermediate
files — `inspect` measures clipping on them and `align` can re-run from them —
but they are not part of what the character *is*, so `register-run` ignores the
`cells` key in the run summary and nothing in `assets[]` ever points at them.

`<motion>-sheet-raw` is the one asset that legitimately exists before its file
does: `set-sheet --status generating` reserves it with `status: "generating"`
and an empty `metadata` so the stage has something to show while the model
draws, and the second `set-sheet` (after the image lands) measures it and flips
the same id to `ready`.

## The `sprite` sidecar

Never dispatched as craft commands — it lives only in this mode.

```ts
interface SpriteSidecar {
  version: 1;
  character: {
    name: string;
    description: string;          // one paragraph you keep current
    style: string;                // the style anchor that opens every prompt
    cell: { width: number; height: number };
    facing?: "left" | "right";
  };
  refs: Array<{ id: string; asset: string;
                role: "turnaround" | "portrait" | "expression" | "custom";
                label: string }>;
  motions: Motion[];
}

interface Motion {
  id: string; label: string;
  prompt: string;                 // the sheet prompt actually sent
  grid: { rows: number; cols: number };
  fps: number; loop: boolean;
  anchor: "bottom" | "center";
  status: "planned" | "generating" | "processing" | "ready" | "failed";
  notes?: string;                 // failure reason or your remarks
  sheetRaw?: string; sheetAlpha?: string; sheet?: string; atlas?: string;
  frames: string[];               // asset ids in playback order
  gif?: string; webp?: string;
  videos: Array<{ id: string; asset: string;
                  model: "seedance-2.5" | "h3-max";
                  mode: "i2v" | "first-last" | "r2v";
                  prompt: string;
                  status: "generating" | "ready" | "failed" }>;
  inspect?: InspectSummary;       // copied from inspect.json by register-run
}

interface InspectSummary {
  frameCount: number;
  cell: { width: number; height: number };
  anchorDrift: { x: number; y: number };   // std-dev in px across frames
  maxJump: number;                          // largest step between neighbours
  scaleDrift: number;                       // (max h − min h) / mean
  emptyFrames: number[];
  warnings: string[];                       // human sentences
}
```

Three things the shapes are quietly telling you:

- **Motions reference assets by id, not by path.** `frames` is a list of asset
  ids; the uri lives on the asset. That is what lets `register-run` swap a
  motion's frames without every consumer re-deriving paths.
- **`motions[]` order is playback order in the viewer's rail.** It is the
  order you added them; `add-motion` appends. There is no sort.
- **`status` is a real state machine and the stage renders it.** `planned` →
  `generating` (before the image call) → `processing` (sheet saved, pipeline
  running) → `ready` (register-run landed) or `failed` (with `notes`). Skipping
  the intermediate states means the user watches a still list while you work.

## Character identity vs content set

There is no `character` key in the ViewerAddress vocabulary because the
character *is* the content set: `{ "contentSet": "lumi", "motion": "attack" }`.
A new character is a new top-level directory with its own `project.json` —
never a second entry inside an existing one.
