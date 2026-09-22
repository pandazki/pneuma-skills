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
    frames/align.json             # anchor point align used; the atlas pivot
                                  # is measured from it, not from the cell edge
    sheet.png                     # packed atlas image
    atlas.json                    # frame rects + pivot + timing
    preview.gif
    preview.webp
    video-<model>-<n>.mp4         # video-seedance-1.mp4, video-h3-1.mp4
    inspect.json                  # latest inspect report
```

A **loop motion** (workflow E) has a different shape inside `motions/<id>/`:

```
<character>/motions/<id>/
  keyframe.png                  # GPT Image, white plate, as generated
  keyframe-alpha.png            # remove-background.mjs (BiRefNet) cut-out
  first-green.png               # flatten --bg "#00ff00" — a working file, no id
  video-seedance-1.mp4          # the first-last clip, both ends the same image
  video-topaz-2.mp4             # optional: 60 fps of video-1  (derived, interpolate)
  video-veed-3.webm             # optional: matte of video-2   (derived, matte)
  contact.png                   # working file
  frames/000.png … NNN.png      # every frame of the loop, unaligned, uncleaned
  loop.webp  loop.apng  loop.webm  loop.json
  inspect.json                  # the loop-shaped report
  run.json                      # `loop --json`, consumed by register-run
```

No `cells/`, no `frames/align.json`, no `sheet.png`, no `atlas.json` and no
GIF: nothing about a loop is aligned or packed, so none of those files exist.

Frame files are **two-digit** zero-padded on a sprite motion (at most 100
frames) and **three-digit** on a loop motion (at most 400). The loader accepts
either width, so an older motion keeps loading.

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
| `<motion>-gif` / `<motion>-webp` | The previews. A loop has no GIF; its `<motion>-webp` is `loop.webp` |
| `<motion>-video-<n>` | A video clip, n from 1 — including a derived one |
| `<motion>-keyframe` | A loop's keyframe, as generated (white plate) |
| `<motion>-keyframe-alpha` | The same keyframe cut out, a `derive` edge (`step: "key"`) from it |
| `<motion>-frame-NNN` | One frame of a loop — three digits, unaligned |
| `<motion>-apng` (image) / `<motion>-webm` (video) / `<motion>-lottie` (text) | A loop's other three exports |

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
the same id to `ready`. `<motion>-keyframe` is the loop's copy of exactly that
arrangement, through `set-keyframe`.

The three loop exports carry **`metadata.size`** in bytes, measured when they
are registered, so the viewer can print "4.2 MB" beside a download link without
fetching the file to find out. A Lottie is the one that grows fastest — it
embeds every frame as base64 — which is why the size is on the asset rather
than left for the browser to discover.

### References the user brought

A `ref-<id>` carries one of three edges, and `add-ref` writes the one that
actually happened. The default is `generate`, with the `--model` and `--prompt`
that drew it. `--uploaded` writes an `upload` edge with `actor: "human"`,
`fromAssetId: null` and **no `params`** — a design sheet or drawing the user
brought has no model and no prompt to record, and inventing one is the only
other way to get it into the project. `--derived-from <refId>` writes a
`derive` edge from that reference carrying `params.op` (`--op`, default
`crop`) — the single pose you cut out of an uploaded sheet. The asset entry is
identical in all three cases (`tags: ["ref"]`, measured metadata, `ready`), and
re-registering an id replaces its edge whatever its type, so a reference can
move between origins without collecting duplicates. `show` reports the result
as `origin: "generated" | "uploaded" | "derived"` per ref (`"unknown"` for a
ref with no edge at all).

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
  videos: MotionVideo[];
  inspect?: InspectSummary;       // copied from inspect.json by register-run
  source?: "sheet" | "video";     // how the frames were obtained; absent means
                                  // "sheet" (set by add-motion --source and by
                                  // register-run for a from-video run)
  kind?: "loop";                  // what the motion is FOR; absent = a sprite
                                  // motion. `source` still says how the frames
                                  // were obtained ("video" for a loop)
  brief?: LoopBrief;              // loop only: the interview's answers, written
                                  // by `set-motion --brief-…` before anything
                                  // is paid for. `add-video` refuses a
                                  // generated clip without it
  keyframe?: string;              // asset id, `<motion>-keyframe`
  keyframeAlpha?: string;         // asset id, `<motion>-keyframe-alpha`
  exports?: {                     // asset ids; the WebP stays `motion.webp`
    apng?: string; webm?: string; lottie?: string;
  };
}

interface LoopBrief {
  duration: number;               // seconds of one cycle, as asked for
  width: number;                  // px the UI renders it at — `loop --width`
  interpolator: "topaz" | "rife" | "ffmpeg" | "none";
  budgetUsd?: number;             // the ceiling the user set. Absent when they
                                  // set none — which is a different statement
                                  // from a ceiling of 0
  recordedAt: string;             // ISO timestamp of the set-motion call
}

type VideoModel = "seedance-2.5" | "h3-max"          // shot
                | "veed" | "veed-gs" | "bria"        // matted
                | "topaz" | "rife"                   // interpolated
                | "ffmpeg";                          // retimed, locally
type VideoMode  = "i2v" | "first-last" | "r2v" | "derived";

interface MotionVideo {
  id: string; asset: string;
  model: VideoModel;
  mode: VideoMode;
  prompt: string;                 // "" on a derived clip — nothing was prompted
  status: "generating" | "ready" | "failed";
  derivedFrom?: string;           // the parent clip's SIDECAR id ("video-1"),
                                  // not its asset id — the panel says "matte
                                  // of video-1" without walking the graph.
                                  // The provenance edge carries the same fact
                                  // in asset ids
  op?: "matte" | "interpolate"    // what was done to it
     | "retime";                  // the parent's own frames in another order
                                  // (`sprite-sheet.mjs retime`, model
                                  // "ffmpeg"). Its own op because it invents
                                  // nothing: filing it as an `interpolate`
                                  // claims a paid endpoint ran that did not
}

interface InspectSummary {
  frameCount: number;
  cell: { width: number; height: number };
  anchorPoint?: { x: number; y: number };   // where align put the anchor inside
                                            // that cell, in px — the point the
                                            // atlas pivot names. Absent when the
                                            // frames carry no align.json
  anchorDrift: { x: number; y: number };   // std-dev in px across frames — the
                                            // silhouette, props included
  bodyDrift?: number;                       // std-dev in px of the feet-centre x
                                            // across frames — the body. Absent
                                            // when the report carried no finite
                                            // number; 0 is a real reading, not
                                            // an absence
  maxJump: number;                          // largest step between neighbours
  scaleDrift: number;                       // (max h − min h) / mean
  emptyFrames: number[];
  seam?: number;                            // loop only: how far the last frame
                                            // is from the first, in the same
                                            // silhouette-diff units as `step`
  step?: number;                            // loop only: the median frame-to-
                                            // frame change. `seam <= 2 * step`
                                            // is a loop that closes — the one
                                            // rule, the same in SKILL.md step
                                            // 10, `pipeline.md` and the
                                            // viewer's SEAM_STEP_FACTOR
  seamFill?: number;                        // loop only: in-between frames
                                            // `loop --seam-fill` inserted at
                                            // the wrap, after which `seam` is
                                            // the largest step across it. 0 is
                                            // "the loop closed on its own"
  alphaCoverage?: number;                   // loop only: fraction of the frame
                                            // area that is opaque, averaged
                                            // over the frames
                                            // All four are absent unless the
                                            // report carried finite numbers —
                                            // 0 is a reading, not an absence
  warnings: string[];                       // human sentences
  acknowledged?: { reason: string; at: number }; // written by
                                            // `set-motion --ack-warnings`; the
                                            // viewer dims the badge and shows
                                            // the reason, numbers stay visible
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

### Derived clips

A clip made **from another clip** — a matte, an interpolation, a retime — is
registered with `add-video --derived-from <videoId> --op matte|interpolate|retime
--model veed|veed-gs|bria|topaz|rife|ffmpeg`. It gets a `derive` edge from the parent clip's asset carrying
`params: { op, model }`, and its sidecar entry reads
`{ mode: "derived", derivedFrom, op, prompt: "" }` — `derivedFrom` is the
parent's sidecar id (`video-1`), the same spelling `--derived-from` accepts.
Its `--status` defaults to **`ready`**, not `generating`: the script that made
it wrote the file before there was anything to register, so there is no wait
to show. There is no prompt because
nothing was prompted; the empty string is the honest record, and a sentence
invented to fill it is what makes a later turn treat the clip as a generation
it could re-roll. `show` prints the chain — `video-3 ← video-2 (matte, veed-gs)` —
so which clip the frames were cut from is answerable without reading the edges
by hand.

### The loop brief

`motion.brief` is the only part of a motion the agent does not decide. A loop's
length, its size and who invents its in-between frames are the user's money,
and they are recorded — with the `set-motion --brief-…` call that collected
them — before the first paid render:

```json
"brief": { "duration": 4, "width": 512, "interpolator": "topaz",
           "budgetUsd": 3, "recordedAt": "2026-09-22T07:11:00.000Z" }
```

It is a gate, not a note: `add-video` refuses a generated clip on a loop motion
that has none, and `register-run` compares `brief.width` with the width that
actually landed. Both readers are all-or-nothing — a record missing any of the
three answers or its `recordedAt` is read as no brief at all, by the viewer's
loader and by the scripts alike, because half a brief would open the gate while
answering none of the question. `add-video` and `show` say which answers are
missing rather than reading half a record out loud. A sprite motion never
carries one; the loader drops it there the way it drops every other loop-only
field.

## Character identity vs content set

There is no `character` key in the ViewerAddress vocabulary because the
character *is* the content set: `{ "contentSet": "lumi", "motion": "attack" }`.
A new character is a new top-level directory with its own `project.json` —
never a second entry inside an existing one.
