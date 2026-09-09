# Pipeline reference

Two scripts do all the mechanical work. `sprite-sheet.mjs` owns pixels;
`sprite-project.mjs` owns `project.json`. Neither one ever calls the other, so
a pipeline run and its bookkeeping fail independently and you can see which
half broke.

Both are plain ESM run with `node`, take `--json`, print `--help`, write
atomically, and put progress on stderr so `--json` stdout stays parseable.
Both need `ffmpeg` and `ffprobe` on PATH.

`--json` is the convention here and for `remove-background.mjs` and the two
video scripts — but **not** for `generate_image.mjs` / `edit_image.mjs`. Those
two always print one JSON object and have no flag for it; passing `--json`
anyway kills the call with `ERROR: Unknown option '--json'`, which reads like a
quoting complaint. Same two scripts, same shape of trap as their positional
prompt (`references/prompting.md`).

## How every script here is invoked

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs <subcommand> [flags] --json
node {SKILL_PATH}/scripts/sprite-project.mjs <subcommand> --dir <character> [flags] --json
```

**Never `cd` into the skill.** `{SKILL_PATH}` is an absolute path, so the
script is found from wherever you are — and your working directory stays the
workspace, which is the only place the paths you type mean what they say. A
`cd` re-roots every one of them inside the skill directory, where
`motions/idle/sheet-raw.png` does not exist, and the whole call dies on
ENOENT after the image was already paid for.

So, on every command on this page:

- **File arguments are workspace-relative**, which means they carry the
  character directory — `lumi/motions/idle/sheet-raw.png`,
  `--out lumi/motions/idle`, `--run lumi/motions/idle/run.json`.
- **`--dir` names the character directory** — the top-level content-set
  directory holding `project.json`, `refs/` and `motions/`.
- **`sprite-project.mjs --file` is the one exception: it is relative to
  `--dir`.** That is not an inconsistency, it is the point — a `--file` is
  literally the uri stored in `project.json`, and every uri in that file is
  character-relative. `--dir lumi --file refs/turnaround.png` registers
  `refs/turnaround.png` and reads `lumi/refs/turnaround.png` off disk.

The same rule covers the shared model scripts the workflows call
(`generate_image.mjs`, `edit_image.mjs`, `remove-background.mjs`,
`seedance-video.mjs`, `generate-video.mjs`): `node {SKILL_PATH}/scripts/<name>.mjs`,
no `cd`, workspace-relative paths.

## `sprite-sheet.mjs`

### `probe <image>`

`{ width, height, hasAlpha, alphaCoverage, cornerColor }`. `hasAlpha` is true
when any pixel's alpha is below 255; `alphaCoverage` is the fraction of pixels
above the alpha threshold; `cornerColor` is the median of the four 8×8 corner
patches as `#rrggbb`. Run this on every freshly generated sheet. On OpenRouter's
GPT Image 2.5 the answer is always `hasAlpha: false` with a near-white
`cornerColor`, so it is not really a branch — it is the free confirmation that
the plate is flat and one colour, and the colour `key --color auto` will use.

### `key <in> --out <png> [--color auto|#rrggbb] [--similarity 0.12] [--blend 0.05]`

ffmpeg `colorkey`. `auto` uses the probed `cornerColor`. Reports
`alphaCoverage` after keying, so you can tell a successful key (coverage drops
to roughly the sprite's share of the image) from one that ate the character
(coverage near zero) or did nothing (coverage still ~1.0). Raise
`--similarity` when a gradient background survives; lower it when the
character's own colours start disappearing. When neither setting separates the
character from its background, the sheet needs a matting model, not a colour
threshold — see `remove-background.mjs` below.

**The keyed-out pixels come back black, not invisible-green.** ffmpeg's
`colorkey` only writes the alpha plane — the name is literal — so the plate is
still there underneath, and anything that ignores alpha gets it back whole: a
bilinear `--scale` bleeds green into every edge, and an engine that imports the
sheet as RGB shows a solid plate. This step therefore zeroes the colour of
every pixel left below the alpha threshold, the same rule `clean` applies when
it drops a blob (transparency is all four bytes). `run` inherits it through the
keyed sheet; `from-video` does the same to each sampled frame. Opaque pixels are
never touched, so nothing you can see changes.

### `flatten <in> --out <png> [--bg #ffffff]`

Composite onto a solid colour. Video models mishandle alpha — flatten frame 00
before handing it to `seedance-video.mjs --image`. Both paths are
workspace-relative: `flatten <character>/motions/<id>/frames/00.png --out
<character>/motions/<id>/first.png`.

### `slice <sheet> --rows R --cols C --out <dir> [--margin px] [--gutter px]`

Cuts row-major into `<dir>/NN.png`, two-digit zero-padded. Cell size is
`(W − 2·margin − (C−1)·gutter) / C`, floored; a non-integer cell is reported so
you know a pixel column was dropped. Output keeps alpha.

These are the **cells** — the raw crop of each grid square, before any
alignment. `run` writes them to `<motionDir>/cells/NN.png` and leaves them
there, because two later steps need the un-padded crop: `inspect` judges
"leaves its grid cell" on it (a padded frame has no edge left to touch), and
`align` re-reads it when only the alignment has to be redone. They are
intermediate files, not assets — `register-run` never registers them.

### `clean <cellsDir> --out <dir> [--threshold 16]`

Removes what is not the character from every cell, and runs **by default**
inside `run` and `from-video` (`--no-clean` skips it). Standalone it is for
cells you sliced yourself, or a re-clean at another threshold; `--out` may be
the input directory.

It labels the connected alpha blobs of each cell (4-connectivity — 8 would
weld a fragment to the body through one diagonal pixel) and then:

1. keeps the largest blob: that is the character;
2. keeps anything **≥ 2 % of its area**: a lantern held at arm's length, a
   thrown weapon, a detached shadow the artist drew — those are design and
   are never removed, wherever they sit;
3. of what is left, drops only what **touches a cell border** (the
   neighbouring cell's drawing bleeding in) or floats **clear above the head
   or below the feet** (specks over the hair, dirt under the boots).

A small blob *beside* the body — a separated hand, a hair strand — is kept:
at that size and position it is far more likely to be the drawing than litter.

```json
{ "cleaned": [{ "cell": 3, "removedComponents": 2, "removedPixels": 25 }],
  "warnings": ["cell 03 lost 9% to cleaning — check the sheet"] }
```

`cleaned[]` lists only the cells something came off; a cell that lost more
than **5 % of its ink** (its opaque pixels, not its area) also gets a warning,
because at that point the sheet is the thing to look at, not the cleaner.

Cleaning happens **before** the bbox that positions the frame is measured —
that is the whole point. A 4 px fragment jammed against the left cell border
moves the bbox 17 px left, and the aligner then faithfully centres the
character around the litter.

### `align <framesDir> --out <dir> [--anchor bottom|center] [--x-from feet|bbox|cell] [--cell auto|WxH] [--pad 8] [--smooth]`

The step that turns sixteen pictures into an animation. Computes each frame's
alpha bounding box, then crops to the bbox and pads onto a transparent cell so
the anchor point lands at the same coordinate in every frame.

**y comes from `--anchor`:**

- `bottom` — the bbox's bottom edge, placed at `H − pad`. Use for anything
  standing on the ground.
- `center` — the bbox centre, placed at `H/2`; for airborne motions (jump,
  float) where the feet are not the reference.

**x comes from `--x-from`**, and the three modes answer three different
questions about where the character *is*:

| `--x-from` | x is | Use when |
|---|---|---|
| `feet` (default) | the mean x of the alpha pixels in the bottom **10 %** of the bbox | Always, for a `bottom` anchor. It is where the character stands. |
| `bbox` | the bbox centre — the behaviour before this flag existed | The drawing has no ground contact worth pinning, or you want the old frames back. It is also what a `center` anchor uses. |
| `cell` | the centre of the grid cell the frame was cut from, i.e. **no horizontal re-placement at all** | The model already places the body consistently and you only want the vertical levelled. |

**Why `feet` is the default.** The bbox is the whole drawing, props included.
Give the character an umbrella, a lantern or a wrench that reaches sideways and
the bbox centre moves while the body does not — so pinning the bbox centre pays
for the prop by shoving the body the other way, and the character visibly
splits sideways during playback. Measured on the Lumi attack sheet (4×4,
250 px cells): the bbox centre sat still while the feet swung 81 → 134 px, an
18 % of cell jump every time the lantern crossed the body. The feet band is
mass-weighted (a mean, not the midpoint of the extent) because the lantern
sweeping *into* the band on three frames moves the extent by half its
overshoot and the mean by a couple of pixels.

Under `--anchor center` the `feet` default resolves to `bbox` — an airborne
pose has no feet on the ground to pin — and `align.json` records `bbox`, which
is what it used. `--x-from cell` is honoured under both anchors.

`--cell auto` sizes the cell around the anchor, not around the bbox: twice the
worst frame's reach from its anchor, plus `2·pad`, rounded up to an even
number (`cell` mode keeps the source grid cell's width, since shrinking it
would shift the very offsets that mode preserves). Under `bbox` that is
exactly the old `max bbox + 2·pad`; under `feet` it is wider whenever the pose
hangs off one side, and it has to be — a narrower cell clamps every frame
against the edge and puts the body back where it was.

`--smooth` replaces each frame's x with the 3-frame median, which removes
single-frame jitter without flattening a real lateral movement (y is untouched
for `bottom` — vertical bounce is the motion). Empty frames come out as fully
transparent cells and are reported.

It also writes `<dir>/align.json` — `{ anchor, cell, pad, anchorPoint, smooth,
xFrom }` — where `anchorPoint` is the pixel coordinate **inside the cell** the
anchor landed on: `{W/2, H − pad}` for `bottom`, `{W/2, H/2}` for `center`.
That file is how `pack` knows what to declare as the atlas pivot. Nothing
downstream can measure the point from the frames alone — a uniform cell cannot
tell padding from artwork — so this step, the only one that knows, records it.
`xFrom` is the mode it *used*, so "why does the body sit off-centre" has an
answer sitting next to the frames. The record travels with the frames it
describes and every align rewrites it; like the cells it is an intermediate
file, not an asset, and `register-run` never registers it.

### `pack <framesDir> --out <sheet.png> --atlas <atlas.json> --name <motionId> --fps N [--loop] [--anchor bottom|center] [--cols C] [--scale 0.5] [--nearest]`

Tiles the aligned frames row-major into one image and writes the atlas.
`--scale` resizes every frame first; add `--nearest` for pixel art so
downscaling stays hard-edged. No margin, no gutter — a game engine reads the
rects from the atlas, and gutters only cost texture memory.

The pivot it writes is the anchor point `<framesDir>/align.json` recorded, not
the cell edge. `--scale` leaves the normalized pivot alone (it is a ratio) and
scales `meta.anchorPoint`, which carries the same point in pixels. Frames that
carry no usable record — aligned by something else, or a record describing a
different cell or a different anchor — fall back to `{0.5, 1.0}` / `{0.5, 0.5}`,
omit `meta.anchorPoint`, and print the reason on stderr; a *malformed*
`align.json` is a hard error instead, because guessing past a file that is
sitting right there would be the silent kind of wrong.

### `gif <framesDir> --out <preview.gif> --fps N [--loop|--no-loop] [--webp <preview.webp>] [--width W]`

Palette-based GIF with transparency preserved (`palettegen
reserve_transparent=1`, `paletteuse alpha_threshold=128`). `--loop` writes an
infinite loop, `--no-loop` plays once. `--webp` additionally writes a lossy
animated WebP with alpha when the libwebp encoder is present; when it is not,
the JSON carries a warning instead of failing.

### `inspect <motionDir> [--anchor bottom|center] [--cells <dir>] [--threshold 16]`

The deterministic quality gate. Writes `<motionDir>/inspect.json` and prints
the same object.

`--cells` points at the pre-align cells, and **defaults to `<motionDir>/cells`
whenever that directory exists** — which it does after any `run`, so you
normally pass nothing. It only changes one verdict: "leaves its grid cell" is a
statement about the raw crop, and an aligned frame has been re-padded away from
its edges, so without the cells that warning can never fire. Point it elsewhere
only if you sliced into a directory of your own.

| Field | Meaning |
|---|---|
| `frameCount` | Frames found in `frames/` |
| `cell` | `{ width, height }` of the aligned cell |
| `anchorDrift` | Std-dev in px of the anchor point across frames — the *silhouette*, props included |
| `bodyDrift` | Std-dev in px of the feet-centre x across frames — the *body*. Near zero after `align --x-from feet`; large when a prop-inflated bbox pushed the body around |
| `maxJump` | Largest anchor displacement between consecutive frames |
| `scaleDrift` | `(max bbox height − min bbox height) / mean` |
| `emptyFrames` | Indices with no pixel above the alpha threshold |
| `anchorPoint` | The point `align` recorded for these frames, in cell pixels — the same point the atlas pivot names. Absent when the frames carry no `align.json` for this anchor and cell |
| `warnings` | Human sentences — read these, they name the fix |

Warning rules and what each one means:

| Warning | Trigger | What to do |
|---|---|---|
| "frame NN is empty" | No pixel above threshold | A cell the model left blank. Edit that one cell (see `prompting.md`) and re-run. |
| "frame NN is nearly empty" | Alpha coverage < 0.02 | Usually the key ate the character. Re-key with a lower `--similarity`. |
| "body drifts sideways between frames — re-run align with --x-from feet/cell" | `bodyDrift > 0.05 · cellWidth` | The body slides during playback. Re-align from `cells/` with `--x-from feet` (or `cell` when the model already placed it well). |
| "anchor jumps between frames NN and MM" | `maxJump > 0.08 · cellWidth` **and** the feet moved that far too | Try `align --smooth`, or the other anchor. If it persists, the pose genuinely teleports — fix the drawing. The feet condition is what keeps a swinging prop quiet: under `--x-from feet` the silhouette is *supposed* to move while the body does not. |
| "character scale varies across frames — regenerate with a fixed-scale instruction" | `scaleDrift > 0.15` | Not fixable by alignment. Regenerate with the identical-height clause from `prompting.md`. |
| "cell NN is clipped — the drawing leaves its grid cell" | Bbox touches the cell edge before alignment | The pose is bigger than its cell. Regenerate with the "stays inside its own cell" clause. |

### `run <sheet-raw> --rows R --cols C --out <motionDir> --name <motionId> --fps N [--alpha <png>] [--force] [flags]`

The whole chain in one call: probe → key (when the sheet is opaque and `--key`
is not `none`, writing `sheet-alpha.png`) → slice → align → pack → gif (+ webp)
→ inspect. Accepts every flag the individual steps take (`--loop`, `--anchor`,
`--key auto|#rrggbb|none`, `--cell`, `--pad`, `--smooth`, `--scale`,
`--nearest`, `--margin`, `--gutter`, `--x-from`).

The one command to remember, keyed or not:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs run <character>/motions/<id>/sheet-raw.png \
  --alpha <character>/motions/<id>/sheet-alpha.png \
  --rows 4 --cols 4 --out <character>/motions/<id> --name <id> --fps 8 --loop --json
```

`--alpha` names an already-keyed sheet — from `remove-background.mjs` or from
`sprite-sheet.mjs key`, at any path. It is copied to
`<motionDir>/sheet-alpha.png` and sliced, and `run` does not probe or key.
Leave it off when the generated sheet already had alpha.

**`sheet-raw.png` is the only copy of what the model drew, and `run` will not
lose it.** Where the input sheet lives decides what happens to it:

| Input sheet | What `run` does |
|---|---|
| Outside `<motionDir>` | Copies it to `sheet-raw.png`. If a *different* `sheet-raw.png` is already there, refuses unless `--force` — a regeneration is the legitimate case and says so. |
| `<motionDir>/sheet-raw.png` | Uses it where it lies. Nothing is copied. |
| `<motionDir>/sheet-alpha.png` | Uses it as the already-keyed sheet (same as `--alpha`): no probe, no key, `sheet-raw.png` untouched. |
| Any other file inside `<motionDir>` | Refused, naming the two accepted in-place names. |

That table is the fix for a real data loss: `run <motionDir>/sheet-alpha.png
--out <motionDir>` used to copy the keyed sheet over `sheet-raw.png`, so the
un-keyed original was gone and `<motion>-sheet-raw` pointed at a keyed file.

It also keeps the pre-align cells at `<motionDir>/cells/NN.png` (see `slice`),
which is what makes the fix-alignment path below possible.

Emits one JSON object:

```json
{ "motionDir": "...", "sheetRaw": "...", "sheetAlpha": "...",
  "alphaSource": "provided", "keyed": false,
  "cells": "...", "frames": ["..."], "sheet": "...", "atlas": "...",
  "gif": "...", "webp": "...", "inspect": { },
  "cell": { "width": 0, "height": 0 }, "warnings": [] }
```

`alphaSource` appears only when the alpha sheet was handed in rather than keyed
here; `keyed` + `keyColor` mark the other branch. `sheetRaw` is omitted (with a
`note:` on stderr) in the one case where there is no raw sheet on disk — an
in-place `sheet-alpha.png` run in a directory that never held one.

Save that JSON — `sprite-project.mjs register-run` consumes it verbatim. It
reads `frames` / `sheet` / `atlas` / `gif` / `webp` / `sheetAlpha` and **ignores
`cells`**: the cells are intermediate files, not assets, so no `cells/NN.png`
ever appears in `project.json`. The input sheet is never moved.

`register-run` also carries `inspect.anchorPoint` into the motion's sidecar,
and that copy is the only route the measurement has to the screen: the viewer
renders from `project.json` alone, so its pivot guide stands on this point when
it is there and falls back to the cell edge when it is not — which with any
`--pad` draws a confident ground line under a floating sprite. Frames aligned
before the point was recorded simply carry none; that absence is honest and the
stage says "assumed" rather than guessing.

### `from-video <clip> --out <motionDir> --name <motionId> --frames N [flags]`

The second motion source. There is no sheet: `--frames` frames are cut evenly
out of the (trimmed) clip into `<motionDir>/cells/NN.png`, and from there it is
the same chain `run` drives — clean → align → pack → gif (+webp) → inspect —
so the JSON it prints is `run`'s plus three keys and `register-run` consumes it
unchanged.

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs from-video \
  <character>/motions/<id>/video-seedance-1.mp4 \
  --out <character>/motions/<id> --name <id> --frames 16 --loop --json
```

| Flag | Default | Notes |
|---|---|---|
| `--frames N` | **required** | 2–100. Sampled evenly across the trimmed clip |
| `--fps N` | frames / trimmed duration | The default plays the motion at the speed the clip was shot at |
| `--loop` / `--no-loop` | `--no-loop` | Decides the sampling schedule, see below |
| `--trim-start` / `--trim-end` | 0 / the duration | **Timestamps** in seconds, like ffmpeg's `-ss` / `-to` — not durations |
| `--key auto\|#rrggbb\|none` | `auto` | `auto` = the median of frame 00's four corner patches, i.e. the plate the model actually painted |
| `--similarity` | **0.22** | Wider than a sheet's 0.12: a codec's "solid" green is a range, not a colour. Measurements in `video-preview.md` |
| `--no-clean` | cleaning on | As in `run` |
| `--anchor` `--x-from` `--cell` `--pad` `--smooth` `--scale` `--nearest` `--cols` `--width` `--no-webp` | as `run` | |

**The sampling schedule depends on `--loop`**, and it matters: a looping
motion stops one step short of the end, because the closing pose is the
opening pose and sampling both puts the same picture in frame 00 and frame
N-1 — a visible stutter at the seam. A one-shot motion samples both ends, so
the recovery pose is in the sheet. The last timestamp is clamped to the last
frame that can actually be seeked to (`-ss` past it writes no file and still
exits 0, which is why this is worth saying).

The extra keys on top of `run`'s JSON:

```json
{ "source": "video", "video": "<abs path to the clip>",
  "sampledAt": [0, 0.253, 0.505, "…"],
  "trim": { "start": 0, "end": 4.042 }, "duration": 4.042,
  "alphaCoverage": 0.4438, "keyColor": "#08f00d" }
```

`register-run` reads `source` and `video`: it hangs every frame's `derive`
edge off the **clip asset** instead of a sheet, with `params.frameIndex` and
`params.t` (the second it was cut from), and sets `motion.source = "video"`.
So the clip has to be registered first with `add-video` — the script refuses
otherwise and names the command.

The clip is only ever read. Unlike a sheet it is not copied into the motion
directory, because it is already an asset in its own right and the frames'
provenance points at it.

### Fixing the alignment without regenerating the sheet

The drawing is fine, the character just swims or jumps — that is an alignment
problem, and the cells are still on disk, so nothing has to be re-sliced:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs align <character>/motions/<id>/cells \
  --out <character>/motions/<id>/frames --anchor center --smooth --json
```

Read the inspect warnings first: `bodyDrift` says re-align with a different
`--x-from` (the body is sliding), `maxJump` says try `--smooth` or the other
`--anchor` (the pose lurches), `scaleDrift` says the drawing is the problem.

`align` clears the old `NN.png` and the old `align.json` out of `--out` before
writing, so the frames — and the anchor point recorded for them — are replaced,
never mixed. Then rebuild what depends on them and re-measure:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs pack <character>/motions/<id>/frames \
  --out <character>/motions/<id>/sheet.png --atlas <character>/motions/<id>/atlas.json \
  --name <id> --fps 8 --loop --anchor center --json
node {SKILL_PATH}/scripts/sprite-sheet.mjs gif <character>/motions/<id>/frames \
  --out <character>/motions/<id>/preview.gif --fps 8 --loop \
  --webp <character>/motions/<id>/preview.webp --json
node {SKILL_PATH}/scripts/sprite-sheet.mjs inspect <character>/motions/<id> --anchor center --json
```

Every path the old `run.json` names is still correct — same frames, same sheet,
same previews — so `register-run --run <character>/motions/<id>/run.json`
re-registers the new bytes with no id churn. The one field that has gone stale
is its `inspect` block; paste the fresh `inspect` output into it first, or the
motion in `project.json` keeps reporting the drift you just fixed.

**Which one to reach for.** Re-running `run` with the new `--anchor` / `--smooth`
is one command and hands you a complete, fresh `run.json`; it costs a re-probe
and a re-slice (one ffmpeg crop per cell — sixteen for a 4×4) on top of the work
the manual chain does anyway. The four-command chain is worth it while you are
trying two or three anchor/smoothing settings and only want to *look* at the
result; once you have settled, do the final pass with `run` so the summary
`register-run` reads is one the pipeline actually produced. One caution on the
`run` route: it re-probes whatever sheet you hand it and keys it again if that
image is opaque, so a matting you paid `remove-background.mjs` for is redone
with a colour threshold unless the sheet you pass already carries alpha.

## `remove-background.mjs` — the fal keying path

The one model call on this page, and **the default way a sprite sheet gets its
alpha** (workflow B step 6): BiRefNet matting on fal, which cuts the character
out on its own silhouette instead of by colour distance. Every sheet needs it,
because every sheet is generated against a white plate — the transparent
background the image API nominally offers is refused by the provider (see
*Measured* below). Matting also survives what a colour key cannot: white
highlights inside the character, a soft edge, a drawn floor. Needs `FAL_KEY`;
with no fal key, `sprite-sheet.mjs key --color auto` above is the ffmpeg
fallback, and it is good enough on a genuinely flat plate.

```bash
node {SKILL_PATH}/scripts/remove-background.mjs \
  --input <character>/motions/<id>/sheet-raw.png \
  --output <character>/motions/<id>/sheet-alpha.png \
  --model heavy \
  --resolution 2048 \
  --json
```

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--input` | path or URL | **required** | png, jpg or webp; local files are inlined as data URIs (30 MB max) |
| `--output` | path | **required** | Where the RGBA cut-out is written |
| `--model` | `light`, `light-2k`, `heavy`, `matting`, `portrait`, `dynamic` | `heavy` | `heavy` is the quality tier; `light`/`light-2k` are the quick ones |
| `--resolution` | `1024`, `2048`, `2304` | `2048` | Match the sheet you generated, or you pay for a downscale |
| `--no-refine` | flag | refinement on | Faster, softer edges — wrong trade for a sheet you are about to slice |
| `--deadline-s` | seconds | `300` | |
| `--json` | flag | | One JSON object on stdout |

Write the output to `sheet-alpha.png` — the same name `sprite-sheet.mjs key`
uses, and the name `run` would have written had it keyed the sheet itself, so
nothing downstream needs to know which of the two made the cut. Then hand
*that* file to `run` rather than the raw one: `run` probes first and skips its
own keying step for a sheet that already carries alpha, so the matting you
just paid for survives instead of being redone with a colour threshold.

## `sprite-project.mjs`

Every subcommand takes `--dir <character>` (workspace-relative) and prints the
resulting motion or project summary with `--json`. Every `--file` below is
relative to that directory, because a `--file` is the uri that lands in
`project.json`. Writes are atomic; unknown top-level fields
in `project.json` are preserved; asset ids are validated unique. Timestamps
come from `Date.now()` unless `--at <ms>` is passed.

| Subcommand | Purpose |
|---|---|
| `init --name "Lumi" [--description] [--style] [--cell 256x256] [--facing right]` | Creates the character directory if it is not there yet, then writes `project.json`. Fails if one exists unless `--force`. |
| `add-ref --id turnaround --file refs/turnaround.png --role turnaround [--label] [--prompt] [--model] [--from <assetId,…>]` | Registers `ref-<id>` with a `generate` edge. |
| `add-motion --id idle --label Idle --rows 4 --cols 4 --fps 8 [--loop] [--anchor bottom] [--prompt] [--status planned]` | Adds the motion. Call it before you generate, so the stage shows a placeholder. |
| `set-motion --motion idle [--label] [--fps] [--loop\|--no-loop] [--anchor] [--prompt] [--status] [--notes]` | Edits motion metadata. `--notes` is where a failure reason belongs. |
| `set-sheet --motion idle --file motions/idle/sheet-raw.png --from ref-turnaround[,…] [--model] [--prompt] [--background opaque] [--status generating\|processing]` | Registers `<motion>-sheet-raw` with a `generate` edge. `--from` becomes the edge's `fromAssetId`; `params.inputs` lists the whole set **only when you attach two or more references** — with one, `fromAssetId` already says everything. Re-running replaces the previous raw sheet and its edges, keeping the id stable. Call it twice per sheet (see below). |
| `add-motion … [--source sheet\|video]` | Records how the frames will be obtained, before anything is generated. Absent means `sheet`. |
| `set-motion … [--ack-warnings "<reason>"] [--clear-ack]` | Accepts the motion's remaining inspect warnings with a one-sentence reason the user reads on the stage; the numbers stay visible and the badge dims. `--clear-ack` takes it back. Refused when the motion has no inspect report, and refused with an empty reason — the acknowledgement *is* the reason. |
| `register-run --motion idle --run <run.json \| -> [--video <videoId>]` | Consumes `sprite-sheet.mjs run` output: registers the alpha sheet (if any), every frame, the packed sheet, atlas, gif and webp with `derive` edges; **removes** the previous frame assets and edges for that motion; copies `inspect` into the motion (including the measured `anchorPoint`, which is what the viewer's pivot guide stands on); sets status `ready`. A `from-video` summary derives the frames from the clip asset instead (`--video` names which, the newest is used with a note on stderr) and sets `motion.source`. Any acknowledgement goes with the measurement it covered. |
| `add-video --motion idle --file motions/idle/video-seedance-1.mp4 --model seedance-2.5 --mode i2v --from idle-frame-00[,idle-frame-15] [--prompt] [--duration 4] [--status generating]` | Registers `<motion>-video-<n>` (n is the next free number) with a `generate` edge. |
| `set-video --motion idle --video <id> --status ready\|failed [--notes]` | Closes out a video after the render returns. |
| `remove-motion --motion idle` | Removes the motion, its assets and its edges. Files on disk are left alone; the orphaned paths are printed so you can delete them deliberately. |
| `show [--motion id]` | Compact summary: name, refs, motions with status / grid / fps / frame count / warnings. The cheapest way to re-orient at the start of a turn. |

### `set-sheet` is called twice per sheet

The image call takes a minute or two, and the stage should not be empty for it.
So the first call goes **before** `generate_image.mjs`:

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs set-sheet --dir <character> --motion <id> \
  --file motions/<id>/sheet-raw.png --from ref-turnaround,ref-portrait \
  --model openai/gpt-image-2.5-flare --prompt "<the prompt you are about to send>" \
  --background opaque --status generating --json
```

`--status generating` is the one status that accepts a `--file` which does not
exist yet: it reserves `<motion>-sheet-raw` with `status: "generating"` and
empty `metadata`, writes the `generate` edge with the model and prompt (which
are known now and nowhere later), and sets the motion to `generating`.

The second call goes **after** the image has landed — the same command without
`--status`, so it defaults to `processing`:

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs set-sheet --dir <character> --motion <id> \
  --file motions/<id>/sheet-raw.png --from ref-turnaround,ref-portrait \
  --model openai/gpt-image-2.5-flare --prompt "<the same prompt>" --background opaque --json
```

Now the file is measured and the same asset flips to `status: "ready"` with real
dimensions — same id, same edge slot, nothing duplicated. **Skipping this second
call leaves the sheet asset stuck at `generating` with no dimensions forever**;
`register-run` writes the frames and the atlas but never revisits the raw sheet.
A missing file under any status other than `generating` is still a hard error.

## `atlas.json`

TexturePacker JSON-hash, which Phaser and PixiJS both load without a
converter.

```json
{
  "meta": { "app": "pneuma-sprite", "version": 1, "image": "sheet.png",
            "size": { "w": 1024, "h": 1024 }, "scale": 1,
            "fps": 8, "loop": true, "anchor": "bottom",
            "anchorPoint": { "x": 128, "y": 248 } },
  "frames": {
    "idle_00": {
      "frame": { "x": 0, "y": 0, "w": 256, "h": 256 },
      "rotated": false, "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 256, "h": 256 },
      "sourceSize": { "w": 256, "h": 256 },
      "pivot": { "x": 0.5, "y": 0.9688 },
      "duration": 125
    }
  },
  "animations": { "idle": ["idle_00", "idle_01"] }
}
```

- Frame keys are `<motionId>_NN`; `animations[<motionId>]` lists them in
  playback order.
- `pivot` is the anchor point `align` measured, normalized by the cell:
  `{0.5, (H − pad) / H}` for `anchor: bottom`, `{0.5, 0.5}` for `center`,
  rounded to 4 decimals. With `--pad 8` on a 256px cell that is
  `pivot.y = 0.9688`, **not** `1.0` — the feet sit 8px above the cell floor,
  and an engine pivoting on the cell edge would hover the character those 8px
  above the ground. `meta.anchorPoint` is the same point in pixels (scaled with
  `--scale`); it is absent when the frames carried no `align.json`, which is
  how you tell a measured pivot from the assumed default.
- `duration` is `round(1000 / fps)` in milliseconds.
- Frames are laid out row-major, `cols` per row, no margin and no gutter.

## Measured (Lumi seed, 2026-09-09)

The first real end-to-end run of this pipeline, recorded so the next agent
knows what "normal" looks like. Machine: M-series mac, ffmpeg 8 on PATH,
OpenRouter + fal.

**`--background transparent` is refused, not ignored.** Every attempt returned
`400` from OpenRouter *before* generating anything (so it costs nothing, and
the retry is free):

```
ERROR: OpenRouter Images API returned 400: … No provider for
openai/gpt-image-2.5-flare supports the requested parameter(s): output_format
"png", quality "high", background "transparent", n "1", input_references
(2 items). Provider rejections: OpenAI: background: not supported.
Accepted: auto, opaque
```

Same rejection for `openai/gpt-image-2.5-sunburst`, and the same with and
without references — both models, both ways. That is why workflow B has no
transparent branch left to take: ask the prompt for *a flat solid pure white
background*, pass `--background opaque`, and key afterwards. `probe` then
reports `hasAlpha: false`, `alphaCoverage: 1`, `cornerColor: "#fefefe"` —
every time. The flag itself is still there and still free to try, since the
rejection arrives before any image is drawn; this record is what it answers.

| Step | Wall time | Result |
|---|---|---|
| ref generation (2048², quality high, no reference) | 40–41 s | $0.108 per image |
| ref generation (2048², one reference attached → Flare) | 30 s | $0.120 |
| sheet generation (2048², two references attached) | 33 s (idle) / 34 s (attack) | $0.133 each |
| `remove-background.mjs --model heavy --resolution 2048` | 10 s (idle) / 20 s (attack) | alpha coverage 26.4 % / 28.6 % |
| `run` (probe → key → slice → align → pack → gif+webp → inspect), 2048 sheet | 6 s (idle) / 7 s (attack) | 16 frames, zero warnings |
| `run` again from a 1024 sheet | ~4 s | same geometry at 256 px cells |

Both motions passed `inspect` with **no warnings on the first generation**:
anchor drift 0.25 px, max jump 0.5 px, empty frames none; scale drift 0.009
(idle) and 0.130 (attack — the swung lantern changes the bounding box, not the
character's size). A 4×4 sheet at 2048² gives 512 px grid cells and, after
`--cell auto` tightens to the silhouette plus `--pad 8`, frames of 304×484
(idle) / 416×506 (attack).

**Sheet resolution drives seed size more than anything else.** At 2048 the two
finished motions plus refs came to 11 MB after pruning and 5 MB was needed;
re-running the same two commands from 1024² sheets (`ffmpeg -vf scale=1024:1024`
→ `set-sheet` again → `run --alpha` → `register-run`) gives 256 px grid cells —
the character's own declared `cell` — and lands the whole seed at 5.0 MB with
every referenced asset kept. Re-running `set-sheet` and `register-run` after a
resolution change is what keeps `project.json`'s recorded dimensions honest;
both are idempotent on the same ids.

**`init` used to die on a character directory that did not exist yet.**
`sprite-project.mjs init --dir lumi` in a workspace with no `lumi/` threw a raw
Node `ENOENT` stack out of `saveProject`. Fixed the same day: `init` now
`mkdir -p`s the directory it is initialising, and every filesystem failure in
`saveProject` comes back as the one-line `ERROR:` the rest of the script
promises. You no longer sequence a `mkdir` before it — but the lesson stands
for any new writer added here: a stack trace is not a message the agent can
act on.
