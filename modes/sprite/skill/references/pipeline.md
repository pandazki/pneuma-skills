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
- `center` — the bbox centre, placed at `H/2`; for airborne pose sequences
  where the feet are not the reference. This recentres the body each frame;
  it does not preserve a jump's vertical trajectory.

**x comes from `--x-from`**, and the three modes answer three different
questions about where the character *is*:

| `--x-from` | x is | Use when |
|---|---|---|
| `feet` (default) | the mean x of the alpha pixels in the bottom **10 %** of the bbox | Grounded poses intended to stay in place; use `cell` when deliberate lateral offsets should survive. |
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

**Preserving movement:** `cell` keeps horizontal offsets only. Neither
vertical anchor preserves the source's full vertical travel; both reposition
each frame. A jump's body poses can survive while its rise and fall disappear.
Preserving that trajectory requires pipeline support beyond these flags, so
do not claim the exported frames retain it. Compare source cells and aligned
frames before treating a planned step, crouch or turn as jitter to remove.

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
animated WebP with alpha through **`libwebp_anim`** when that encoder is
present; when it is not, the JSON carries a warning instead of failing. The
encoder name matters: plain `libwebp` does not composite animation frames, so
every `preview.webp` written through it ghosted the frames before it (mean
alpha error per frame 9.8 against 0.03 with `libwebp_anim`).

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
| "body drifts sideways between frames — re-run align with --x-from feet/cell" | `bodyDrift > 0.05 · cellWidth` | Check the motion plan first. For unintended sliding, re-align from `cells/` with `--x-from feet`; use `cell` to retain well-placed intentional lateral motion. |
| "anchor jumps between frames NN and MM" | `maxJump > 0.08 · cellWidth` **and** the feet moved that far too | Compare the source poses with the plan. For unintended placement jumps, try `align --smooth` or the other anchor; fix discontinuous drawing when alignment cannot help. Preserve deliberate fast movement. |
| "character scale varies across frames — regenerate with a fixed-scale instruction" | `scaleDrift > 0.15` | This measures silhouette height, including props. Check for intended crouching, turning or prop movement; acknowledge it when justified. Regenerate actual proportion or drawing-scale drift with the fixed-scale guidance in `prompting.md`. |
| "cell NN is clipped — the drawing leaves its grid cell" | Bbox touches the cell edge before alignment | The pose is bigger than its cell. Regenerate with the "stays inside its own cell" clause. |

These are geometric heuristics. `maxJump` does not include last-to-first, and
the report does not judge identity, contacts or animation rhythm. Check those
in playback, even when there are no warnings.

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

### `contact <clip> --out <png> [--count 24 | --every s] [--cols 8] [--width 160] [flags]`

Look at the clip before you sample it. A motion sampled from a clip is only as
good as the window it came from, and without this there is no way to see the
clip at all — `from-video` gets N frames spread across whatever it was handed,
and the dead frames only show up in the preview.

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs contact \
  <character>/motions/<id>/video-seedance-1.mp4 \
  --out <character>/motions/<id>/contact.png --json
```

**The picture.** One PNG: `--count` stills spaced evenly across the (trimmed)
clip with **both ends included**, each scaled to `--width` px, its timestamp
burnt into the corner, tiled `--cols` per row with a 2 px grey gutter. The last
still is pulled back to the last frame that can be seeked to, the same clamp
`from-video` applies. `--every s` is the alternative schedule — one still every
s seconds from the trim start — and the two are mutually exclusive. Read it,
then pass the times you picked to `from-video --at`.

`--trim-start` / `--trim-end` window the clip exactly as they do for
`from-video`. `--key`, `--similarity`, `--blend` and `--threshold` only affect
the numbers below: the stills are always the clip as it was shot, plate and
all, because that is what you need to look at.

**The numbers**, measured deterministically, no model. The clip is decoded once
into alpha silhouettes (keyed with `--key`, 96 px wide, at
`min(clip fps, 12)` fps), and every pair of them is compared by
**`Σ|a−b| / Σ max(a,b)`** — the fraction of the combined ink that changed, so
0 is the same pose and the number means the same thing whether the character
fills the frame or a tenth of it.

| Key | What it says | The threshold behind it |
|---|---|---|
| `stillStart` | When the opening pose breaks — everything before it is the same picture N times | first frame with `diff(first, i) > 0.05`; `null` (plus a warning) when nothing ever differs |
| `stillEnd` | Where the closing hold begins | last frame with `diff(last, j) > 0.05` |
| `loops[]` | The windows that close on themselves: `{ start, end, period, seam, step }` | periods from 0.4 s to 2.5 s; **`seam`** is how different the two ends are, **`step`** how much a frame moves inside the window, so `seam ≪ step` is a clean cycle. A window only counts when it really moves (`max diff(start, ·) ≥ 0.25` inside it), or a held pose would score a perfect seam. Best 3 by seam |
| `profile.deltas` | The rhythm: frame-to-frame change at `profile.fps`, from `profile.start` | none — read the zeros as holds and the plateaus as beats |
| `alphaCoverage` | Mean opaque share after keying | over 0.9 raises the same "was this shot on a flat chroma background?" warning `from-video` raises |

```json
{ "clip": "<abs>", "out": "<abs png>", "duration": 4.0, "fps": 24,
  "trim": { "start": 0, "end": 4.0 },
  "tiles": [ { "index": 0, "t": 0, "row": 0, "col": 0 }, "…" ],
  "grid": { "rows": 3, "cols": 8 }, "tile": { "width": 160, "height": 90 },
  "keyColor": "#08f00d", "alphaCoverage": 0.29,
  "stillStart": 0.458, "stillEnd": 3.9,
  "loops": [ { "start": 0.917, "end": 2.292, "period": 1.375, "seam": 0.0553, "step": 0.08 } ],
  "profile": { "fps": 12, "start": 0, "deltas": [0, 0, 0.04, "…"] },
  "warnings": [] }
```

Three things worth knowing before you trust a number:

- **A silhouette diff cannot see direction.** A motion that retraces its own
  path scores a perfect seam on its half-period as well as on its period, and
  a perfectly cyclic clip scores one on every multiple. Ties break towards the
  earliest, then shortest window; when the top candidates differ by a factor of
  two, look at the contact sheet and decide.
- **`--key none` measures luma instead of alpha**, with the frame's own median
  subtracted so the background still sits at zero. It works, but it is noisier
  than a keyed clip and `keyColor` is omitted. The thresholds above were set on
  keyed silhouettes.
- Analysis stops after the first 60 s of the window and says so in a warning;
  `drawtext` is missing or fontless in some ffmpeg builds, in which case the
  tiles come out unlabelled with a warning naming the filter — never a failed
  command over a caption.

**The contact sheet is a working file, never an asset.** The stills are
extracted into a temp directory that is removed on the way out (success or
failure); the only thing left behind is the PNG you named. Nothing is written
to a motion directory, and `register-run` / `project.json` never hear about it.

### `from-video <clip> --out <motionDir> --name <motionId> --frames N [flags]`

The second motion source. There is no sheet: `--frames` frames are cut evenly
out of the (trimmed) clip into `<motionDir>/cells/NN.png`, and from there it is
the same chain `run` drives — clean → align → pack → gif (+webp) → inspect —
so the JSON it prints is `run`'s plus the video keys, and `register-run`
consumes it unchanged.

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs from-video \
  <character>/motions/<id>/video-seedance-1.mp4 \
  --out <character>/motions/<id> --name <id> --frames 16 --loop --json
```

| Flag | Default | Notes |
|---|---|---|
| `--frames N` | **required**, unless `--at` | 2–100. Sampled evenly across the trimmed clip |
| `--at t1,t2,…` | — | Sample these times instead, see below |
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

**`--at` replaces the schedule with times you chose** — run `contact` first,
read the holds and the loop off it, then name the frames:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs from-video <clip> \
  --out <character>/motions/<id> --name <id> \
  --at 0.917,1.003,1.089 --at 1.175,1.261 --loop --json
```

A comma-separated list of seconds, repeatable and flattened — the two `--at`
flags above are one list of five times — 2 to 100 strictly increasing entries,
each inside the clip. Everything is refused **by name**: a time past the last seekable frame,
a list that goes backwards, one value, 101 values. It also excludes `--frames`,
`--trim-start` and `--trim-end` — those are the other way of saying the same
thing, and passing both says nothing. `--loop` / `--no-loop` keep their gif and
atlas meaning but no longer touch the schedule: the times are the schedule.
`trim` then reports the first and last time you gave, and `--fps` defaults to
the **mean** sampling rate, `(N − 1) / (last − first)`.

Nothing downstream changes: `sampledAt[i]` is still where frame `i` came from,
so `register-run` hangs the same provenance off the same clip. The JSON gains
`"schedule": "even" | "explicit"` so the run summary says which one ran.

The extra keys on top of `run`'s JSON:

```json
{ "source": "video", "video": "<abs path to the clip>",
  "sampledAt": [0, 0.253, 0.505, "…"], "schedule": "even",
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

### `retime <clip> --keep <ranges> --out <mp4> [--fps N]`

A clip's own frames, in another order. Nothing is generated and nothing is
interpolated: the frames are decoded once, written back in the order `--keep`
names, and re-encoded as an opaque H.264 mp4 (`yuv420p`, crf 12).

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs retime \
  <character>/motions/<id>/video-seedance-1.mp4 \
  --keep 2-45,60-66,75-112,2-58 \
  --out <character>/motions/<id>/video-retime-2.mp4 --json
```

| Flag | Default | Notes |
|---|---|---|
| `--keep <ranges>` | required | Comma list of **inclusive** frame index ranges **in playback order**, repeats allowed: `2-40,41-60,2-40` plays a beat twice. A single frame is `40-40`. A range that runs backwards, or names a frame the clip does not have, is refused |
| `--out <mp4>` | required | Must end in `.mp4` — the result is an opaque plate for the interpolation and matting steps |
| `--fps N` | the clip's own rate | What the reordered frames play at. It renames the rate; it does not resample |

**Where it belongs: on the PLATE, before interpolation and before matting.**
A clip that already carries alpha is refused by name, because the re-encode is
opaque and would drop the matte — the same rule, for the same reason, as
`loop --fps` on a matted clip. Bounds: at most 600 source frames decoded, and
at most 400 written (a retimed plate is still a loop's input).

**What it is for.** Seedance's idle-loop failure modes are reproducible and
prompt wording does not fix them: a 1.5–2 s freeze at the inhale apex, a double
blink, a still tail (`video-preview.md` has the measured numbers). Cutting the
freeze, dropping the second blink and repeating a beat is free and deterministic
— every written frame is a frame the model really drew.

**What it costs.** The first-last construction argument. Before a retime the
clip's two ends are the same generated image; afterwards they are whichever
frames the ranges put there, so `firstIs` / `lastIs` report the source indices
now at the wrap and `loop`'s measured seam becomes the only evidence the cycle
closes.

```json
{ "kind": "retime", "source": "<abs clip>", "out": "<abs mp4>", "fps": 24,
  "keep": [[2, 45], [60, 66], [75, 112], [2, 58]], "frames": 146,
  "sourceFrames": 121, "duration": 6.083, "firstIs": 2, "lastIs": 58 }
```

Register it like any other derived clip — it is one:

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
  --motion <id> --file motions/<id>/video-retime-2.mp4 \
  --derived-from <id>-video-1 --op retime --model ffmpeg --json
```

### `loop <clip> --out <motionDir> --name <motionId> [flags]`

The third way frames come into existence, and the only one whose deliverable is
an animation rather than an atlas. `from-video` samples a cycle out of a clip
and aligns it; `loop` keeps **every** frame of the window, unaligned and
uncleaned, and writes four UI-ready exports beside them. There is no sheet, no
atlas and no GIF, and nothing here re-centres a frame — a bobbing icon is
supposed to bob.

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs loop \
  <character>/motions/<id>/video-seedance-1.mp4 \
  --out <character>/motions/<id> --name <id> --width 512 --json \
  > <character>/motions/<id>/run.json
```

| Flag | Default | Notes |
|---|---|---|
| `--trim-start` / `--trim-end` | 0 / the duration | **Timestamps** in seconds, exactly as for `from-video` and `contact` |
| `--key auto\|#rrggbb\|none\|alpha` | `auto` | `auto` measures frame 0's corner plate and keys that colour. `alpha` = the clip carries its own alpha (a VEED `.webm`, a Bria `.mov`): decode it, key nothing. `none` = opaque frames, no plate, and a warning saying so |
| `--similarity` / `--blend` | **0.22** / 0.05 | `colorkey`, the video defaults (`video-preview.md` has the sweep behind them) |
| `--despill` / `--no-despill` | on whenever it keys | ffmpeg `despill` on the plate hue, applied **after** the key |
| `--trim-holds` / `--no-trim-holds` | on | Drops a frozen opening or closing, see below |
| `--seam-fill auto\|none\|<N>` | `auto` | Interpolates in-between frames into the **wrap** when the seam is worse than `2·step`, see below |
| `--crop union\|none` / `--pad 8` | `union` / 8 | One rect, computed over every kept frame, applied to all of them |
| `--width W` | **512 when the cropped frame is wider**, else the source width | Scales in premultiplied space, aspect kept. The cap is announced on stderr (`no --width given: frames capped at 512 px (source <w> px); pass --width to choose`) and recorded as `widthDefaulted: true` in the run summary and `inspect.json` |
| `--fps N` | the clip's own fps | `minterpolate`, loop-wrapped. **Refused with `--key alpha`** |
| `--formats webp,apng,webm,lottie` | all four | |
| `--threshold 16` / `--json` | | as elsewhere |

**What it does, in order.** The order is the contract — several of these steps
are wrong if they move:

1. **Probe** the clip. For `--key alpha` it looks for a real alpha plane: a
   `pix_fmt` carrying one, ProRes 4444, or a VP9 webm with `alpha_mode=1`
   (decoded with `-c:v libvpx-vp9`, because the native `vp9` decoder drops
   alpha on the floor and hands back opaque frames).
2. **Decode the whole window in one pass** — `-ss start -to end` on the input,
   no per-frame seek. This is the difference from `from-video`, which seeks
   once per sample: a UI loop wants all 100–300 frames, and 300 seeks are both
   slower and exposed to the last-frame clamp that a single decode pass simply
   never has to make.
3. **Interpolate** (`--fps N`, plate clips only). The kept window plus a copy of
   frame 0 appended, `minterpolate=fps=N:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
   over the *plate* frames, then the trailing frames that came from the
   appended copy are dropped. Interpolating with the wrap in the window is what
   makes the last frame lead back into the first as smoothly as any other pair.

   **This is one of three interpolators, and the user picks** (`video-preview.md`
   has the table and the prices): this free one, Topaz on fal (`interpolate-video.mjs`,
   exactly 60 fps, the sharpest in-betweens, ≈ $0.10 per 5 s — but it
   interpolates the clip as a clip and never sees the wrap: measured
   2026-09-22, its 60 fps output opened the seam to 0.067 against a step of
   0.029 where the untouched 24 fps clip closed at 0.028 against 0.046), or
   RIFE on fal (`interpolate-video.mjs --model rife --between 1 --loop`,
   48 fps, ≈ $0.03, and `loop: true` interpolates the wrap too — measured seam
   0.0107 against a step of 0.0275). The session's `defaultInterpolator`
   setting says which to reach for; ffmpeg's is the weakest of the three and
   is the fallback for a session with no fal key.
4. **Key, then despill, then zero the keyed RGB.** `colorkey` with the measured
   plate colour runs first; `despill` takes the green rim off what survives;
   then every pixel under the alpha threshold has its RGB zeroed — the same
   rule `key` and `from-video` apply, because transparency is all four bytes.

   **The order is the opposite of the intuitive one, and it was measured.**
   Despilling first recolours the plate, so the colour measured on frame 0's
   corners no longer matches the pixels it is aimed at and the key misses:
   on a real Seedance clip (2026-09-22) the plate came out **opaque and nearly
   black**, with no error and no warning. Keying first and despilling the
   remainder is also what removes the **1–2 px green fringe** a plain key
   leaves on a soft 3D edge at 640² — which is why `--despill` is on by default
   here and why a loop cannot rely on the sprite path's "it disappears when you
   downscale": a loop is rendered at the size it was cut at. The best edge
   measured so far is not this path at all but a VEED matte read back with
   `--key alpha` (`video-preview.md`); key-then-despill is what you use when
   there is no fal key, and it is good enough at UI size.
5. **Trim holds** (`--trim-holds`, default on). Silhouette masks for every
   frame, `toFirst[i] = diff(mask0, maski)`, `step[i] = diff(maski, maski+1)`,
   `med = median(step)`, **`HOLD = 0.25 · med`** — a fraction of this clip's
   own motion, with no absolute floor under it. **Trailing** frames go while
   `toFirst[last] < HOLD` — that is the return to the keyframe, held — and
   **leading** frames go while `step[0] < HOLD`, keeping the last frame of the
   freeze. A first-last clip's duplicate closing keyframe is exactly what this
   removes; report it as `dropped: { leading, trailing }`.

   The floor was dropped because it was a number in the wrong units: on the
   grey reference clip a fixed 0.005 would have eaten frames the clip needs,
   and with the relative bar nothing is dropped there (its seam is 0.0036
   against a step of 0.0043). On the Seedance trial clip the same bar still
   drops the one frozen leading frame and the duplicate closing keyframe.
6. **Seam.** `seam = diff(mask[lastKept], mask[0])` against `step` (the median)
   and `maxStep`. This is the number a loop lives or dies on, and it is printed
   whether or not it trips the warning. **A loop closes when `seam ≤ 2·step`**
   — the same rule everywhere: `SKILL.md` step 10, the warning below, and the
   viewer's `SEAM_STEP_FACTOR`.

   **Filling the seam** (`--seam-fill`, default `auto`). When `seam > 2·step`,
   `auto` interpolates `N = min(4, ceil(seam/step) − 1)` in-between frames at
   the wrap with ffmpeg `minterpolate` and **appends** them after the last
   frame, so the loop grows by N frames: `duration` grows by `N/fps` and those
   frames carry `sampledAt: null` — they were never sampled from anything.
   `seam` is then re-measured as the largest step across the filled wrap, and
   the warning is re-evaluated against it. `inspect.json` and the run summary
   carry `"seamFill": N` (**0** when nothing was filled). On the trial clip
   that came to N = 3. `none` turns it off and leaves the seam as measured;
   `<N>` forces a count. It closes a seam that is *nearly* closed — four
   frames cannot invent the way back from a pose the clip never returned to,
   which is still a reshoot.
7. **Crop and scale.** The union of every kept frame's alpha bounding box, plus
   `--pad`, as **one** rectangle applied identically to every frame — a
   per-frame crop would silently re-centre the motion, which is the one thing a
   loop must not do. `--width` then scales in premultiplied space, so soft
   edges do not darken.

   **Choose `--width` from the size the UI renders at**, doubled for retina —
   not from the clip, and in workflow E not from anywhere but `brief.width`.
   Omitted, a cropped frame wider than **512 px is capped there**: one line on
   stderr naming the source width and the flag that overrides it, and
   `widthDefaulted: true` in the report. That default exists because the
   alternative is what the Kiki trial shipped — 532 px frames straight off the
   clip, a 45 MB Lottie and a 33 MB APNG, of which one export (the WebM, 0.55
   MB) was usable. It is a guard, not a choice: a loop the user asked for at
   1024 still gets 1024.

   Measured on 119 frames of 512×596 at 24 fps: WebP
   3.4 MB, APNG 21 MB, WebM **367 KB**, Lottie 28 MB (the Lottie warning
   fired). At `--width 256` the same loop lands near 7 MB of Lottie and 5 MB
   of APNG; the WebM is small at any width. The width also decides how much
   disk the run needs: `loop` stages its working PNGs under
   `<motionDir>/.loop-work` while it runs, about `frames × W × H × 4` bytes —
   roughly **600 MB** for a 122-frame 1440² clip — so pass `--width` before
   cutting a large clip rather than after it fills the disk.
8. **Write `frames/NNN.png` and the exports.** Three digits, up to **400**
   frames (a sprite motion's two-digit frames still load; the contiguity check
   is unchanged). Each export is skipped with a warning, never a failed command,
   when its encoder is missing:

   | File | How |
   |---|---|
   | `loop.webp` | **`libwebp_anim`**, `yuva420p`, `-q:v 85`, `-loop 0` — and **no** `flags=neighbor`: a 3D icon is not pixel art |
   | `loop.apng` | `-f apng -plays 0 -pred mixed`, rgba. Served as `image/apng`, so it keeps its honest extension |
   | `loop.webm` | `libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 30 -row-mt 1`; `-auto-alt-ref 0` is required for alpha |
   | `loop.json` | Lottie, one image layer per frame with the PNG base64-embedded. Plays in lottie-web and dotLottie players; warns past 8 MB, and `--width` is the remedy |

   **The WebP encoder is `libwebp_anim`, not `libwebp`.** `libwebp` does not
   composite animation frames: every frame past the first was drawn over the
   one before it, so a transparent loop ghosted its own history — and so did
   every sprite `preview.webp` this mode has ever written. Measured: mean
   alpha error per frame **9.8 → 0.03** on the same sequence. Anything here
   that writes an animated WebP uses `libwebp_anim`.

**`inspect.json` for a loop** is a different report, written by `loop` itself
and returned as `inspect` in the JSON:

```json
{ "kind": "loop", "frameCount": 96, "cell": { "width": 512, "height": 591 },
  "widthDefaulted": true,
  "fps": 24, "duration": 4.0, "seam": 0.0065, "step": 0.020, "maxStep": 0.069,
  "seamFill": 0, "alphaCoverage": 0.31, "keyColor": "#08f00d", "emptyFrames": [],
  "dropped": { "leading": 0, "trailing": 1 },
  "exports": { "webp": 1843201, "apng": 9120033, "webm": 612330, "lottie": 12400021 },
  "warnings": [] }
```

No `anchorDrift`, `bodyDrift`, `maxJump` or `scaleDrift`: a loop is not judged
on any of them, and a number nobody judges is noise on the stage. What replaces
them is `seam` read against `step` — the reference clip this workflow was built
against measures 0.0065 against a step of 0.020, a seam a third of a normal
frame.

| Warning | Trigger | What to do |
|---|---|---|
| "the loop does not close — the last frame is 0.13 from the first against a normal step of 0.02" | `seam > 2·step`, re-checked **after** `--seam-fill` | Shoot again with the same image at both ends, or pass `--trim-start` / `--trim-end` read off the contact sheet. Filling the wrap closes a near miss; it cannot invent a return the clip never made |
| "was it shot on a flat plate?" | `alphaCoverage > 0.9` after keying | The key did nothing — the plate is not flat, or `--key` names the wrong colour. Check `keyColor` against the contact sheet |
| "frames are opaque" | `--key none` | Deliberate only when the clip already has no plate. A UI loop with opaque frames is a video, not a loop |
| "frame NNN is empty" | No pixel above the alpha threshold | Usually the key ate the subject; lower `--similarity` |
| "only N frames" | `frameCount < 8` | The window is too short, or hold trimming ate it. Check `dropped` and the trim timestamps |
| "<encoder> is missing — <file> was not written" | ffmpeg has no encoder for that format | Install it or drop the format from `--formats`; the other three still land |
| "loop.json is 12.4 MB of base64 PNG" | Lottie over 8 MB | A Lottie carries every frame as a base64 PNG, so it is the format that grows fastest |
| "loop.apng is 21.0 MB" | APNG over 8 MB | APNG is lossless and grows with the picture; the WebM is a tenth of it at the same size |
| …"pass --width to shrink the frames" / …"already at --width 512; halve it, or ship loop.webm instead" | the two size warnings above, worded by whether `--width` was passed | Without the flag, pass it. **With** it, "pass --width" would be advice already taken: halve the number, or deliver the WebM and keep the big format out of the page |

**`--json`** is what `register-run` consumes:

```json
{ "kind": "loop", "source": "video", "video": "<abs clip>", "motionDir": "<abs>",
  "frames": ["<abs>/frames/000.png", "…"], "sampledAt": [0, 0.0417, "…"],
  "fps": 24, "duration": 4.0, "trim": { "start": 0, "end": 4.042 },
  "dropped": { "leading": 0, "trailing": 1 }, "seamFill": 0,
  "keyColor": "#08f00d", "alphaCoverage": 0.31,
  "cell": { "width": 512, "height": 591 }, "widthDefaulted": true,
  "webp": "<abs>/loop.webp", "apng": "<abs>/loop.apng", "webm": "<abs>/loop.webm",
  "lottie": "<abs>/loop.json", "inspect": { "…": "as above" }, "warnings": [] }
```

`sampledAt[i]` is the source timestamp of frame `i` — after interpolation,
`i / N` from the window start, and **`null`** for a frame `--seam-fill` added
at the wrap, which was sampled from nothing. There is no `sheet`, `atlas`, `gif` or `cells`
key, and `register-run` does not ask for them on a run whose `kind` is `loop`.
As with `from-video`, the clip is only ever read: it is already an asset, and
the frames' provenance points at it.

### Fixing the alignment without regenerating the sheet

Use this when the drawing is fine but placement drifts unintentionally.
The cells are still on disk, so nothing has to be re-sliced:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs align <character>/motions/<id>/cells \
  --out <character>/motions/<id>/frames --anchor center --smooth --json
```

Read the warning table above against the motion plan first. Change `--x-from`
for unintended sliding and try `--smooth` or the other `--anchor` for
placement jumps. A `scaleDrift` warning alone does not establish a drawing
fault; check the poses before regenerating.

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
| `add-ref --id turnaround --file refs/turnaround.png --role turnaround [--label] [--prompt] [--model] [--from <assetId,…>] [--uploaded \| --derived-from <refId> [--op crop]]` | Registers `ref-<id>` with a `generate` edge carrying the model and prompt you used. `--uploaded` instead records a file **the user brought**: an `upload` edge with `actor: "human"`, no parent and no params — it refuses `--model` / `--prompt` / `--from` by name, since none of them happened. `--derived-from <refId>` records an image you cut or cleaned out of another registered reference (a single pose out of an uploaded design sheet): a `derive` edge from that ref with `params.op` — `--op` is one word, default `crop`, and only valid here. Re-adding an id replaces its edge whatever its type. |
| `add-motion --id idle --label Idle --rows 4 --cols 4 --fps 8 [--loop] [--anchor bottom] [--prompt] [--status planned]` | Adds the motion. Call it before you generate, so the stage shows a placeholder. |
| `set-motion --motion idle [--label] [--fps] [--loop\|--no-loop] [--anchor] [--prompt] [--status] [--notes]` | Edits motion metadata. `--notes` is where a failure reason belongs. |
| `set-sheet --motion idle --file motions/idle/sheet-raw.png --from ref-turnaround[,…] [--model] [--prompt] [--background opaque] [--status generating\|processing]` | Registers `<motion>-sheet-raw` with a `generate` edge. `--from` becomes the edge's `fromAssetId`; `params.inputs` lists the whole set **only when you attach two or more references** — with one, `fromAssetId` already says everything. Re-running replaces the previous raw sheet and its edges, keeping the id stable. Call it twice per sheet (see below). |
| `add-motion … [--source sheet\|video]` | Records how the frames will be obtained, before anything is generated. Absent means `sheet`. |
| `add-motion … [--kind loop]` | Declares a **loop motion** (workflow E). `--rows/--cols` become optional (1×1 is recorded), `source` defaults to `video`, and `set-keyframe` is accepted only here. A sprite motion is unchanged. |
| `set-keyframe --motion <id> --file motions/<id>/keyframe.png [--alpha motions/<id>/keyframe-alpha.png] [--model] [--prompt] [--from <refIds>] [--status generating\|processing\|ready]` | The loop's `set-sheet`. Registers `<motion>-keyframe` with a `generate` edge carrying the model and prompt; `--alpha` registers `<motion>-keyframe-alpha` with a `derive` edge (`step: "key"`) from it. Refused on a motion that is not `--kind loop`. Called twice per keyframe, as `set-sheet` is — but the closing call needs only `--file` and `--alpha`: an omitted `--model` / `--prompt` / `--from` **keeps** what the reserving call recorded rather than blanking the edge. Once `--alpha` has reserved the cut-out, a closing call without `--alpha` is refused, because the stage prefers the cut-out and a placeholder there is a broken image. |
| `add-video … --file motions/<id>/<clip> --derived-from <videoId> --op matte\|interpolate\|retime --model veed\|veed-gs\|bria\|topaz\|rife\|ffmpeg [--duration] [--status]` | Registers a clip made **from another clip**: a `derive` edge from the parent's asset with `params: { op, model }`, and a sidecar entry with `mode: "derived"`. `--file` is required here as everywhere. It takes no `--mode`, `--prompt` or `--from` — nothing was prompted, and a prompt invented to fill the field is what makes a later turn believe the clip was generated. `--op retime --model ffmpeg` is the local reorder (`sprite-sheet.mjs retime`), which invents no pixel and so is neither a matte nor an interpolation. `--status` defaults to **`ready`**: the script that made the clip wrote the file before there was anything to register, so there is no wait to show (a shot clip still defaults to `generating`). |
| `set-motion … --brief-duration <s> --brief-width <px> --brief-interpolator topaz\|rife\|ffmpeg\|none [--brief-budget <usd>]` | Records the **loop brief** — the answers workflow E step 1 collects before anything is paid for. The first call needs the three required flags together; any later call may change one. Refused on a motion that is not `--kind loop`. Warns on stderr when `duration × 60 > 400` with an interpolator that targets 60 fps, naming the rate that fits (`--target-fps 48` for a 7–8 s loop). |
| `add-video` on a **loop** motion, generated clip | **Refused** when the motion has no brief: `add-video: loop '<id>' has no brief — record the user's answers first: set-motion --brief-duration … --brief-width … --brief-interpolator …`. A record that is only half a brief is refused the same way and names what it is missing (`… has an incomplete brief, missing --brief-width, --brief-interpolator and recordedAt — …`): the reader is all-or-nothing everywhere — the gate, `show` and the JSON summaries — so half an answer never travels as one. A `--derived-from` clip is exempt: that money is already spent, and refusing to record it would only lose the provenance. |
| `set-motion … [--ack-warnings "<reason>"] [--clear-ack]` | Accepts the motion's remaining inspect warnings with a one-sentence reason the user reads on the stage; the numbers stay visible and the badge dims. `--clear-ack` takes it back. Refused when the motion has no inspect report, and refused with an empty reason — the acknowledgement *is* the reason. |
| `register-run --motion idle --run <run.json \| -> [--video <videoId>]` | Consumes `sprite-sheet.mjs run` output: registers the alpha sheet (if any), every frame, the packed sheet, atlas, gif and webp with `derive` edges; **removes** the previous frame assets and edges for that motion; copies `inspect` into the motion (including the measured `anchorPoint`, which is what the viewer's pivot guide stands on); sets status `ready`. A `from-video` summary derives the frames from the clip asset instead (`--video` names which, the newest is used with a note on stderr) and sets `motion.source`. A summary with `"kind": "loop"` has no sheet, atlas or gif — those become optional, and a sprite run still requires them — and registers the webp plus `<motion>-apng`, `<motion>-webm` and `<motion>-lottie` instead; it sets `motion.kind = "loop"`, `motion.exports`, `motion.source = "video"`, `motion.fps` from the run (interpolation changes it) and `grid = {1,1}`, and the inspect summary it copies carries `seam`, `step`, `seamFill` and `alphaCoverage`. Any acknowledgement goes with the measurement it covered. On a loop it also compares the registered `inspect.cell.width` with `brief.width` and warns — stderr, and `warnings[]` in the `--json` payload — when they are more than 2 px apart (`frames are <w> px wide but the brief said <width> — pass --width to loop`). A warning, not an error: the frames are already cut, and cutting them again is free. It is said once per channel and is **not** written into `inspect.warnings`: that list is the measurement of the frames — what the viewer shows and what `--ack-warnings` accepts — and this is a comparison against the brief. |
| `add-video --motion idle --file motions/idle/video-seedance-1.mp4 --model seedance-2.5 --mode i2v --from idle-frame-00[,idle-frame-15] [--prompt] [--duration 4] [--status generating]` | Registers `<motion>-video-<n>` (n is the next free number) with a `generate` edge. |
| `set-video --motion idle --video <id> --status ready\|failed [--notes]` | Closes out a video after the render returns. |
| `remove-motion --motion idle` | Removes the motion, its assets and its edges. Files on disk are left alone; the orphaned paths are printed so you can delete them deliberately. |
| `show [--motion id]` | Compact summary: name, refs (each with `origin: generated \| uploaded \| derived`, read off its edge — whether an image was drawn here or brought in decides what you may regenerate), motions with status / grid / fps / frame count / warnings, and derived clips as `video-3 ← video-2 (matte, veed-gs)`. The cheapest way to re-orient at the start of a turn. |

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

`set-keyframe` repeats the arrangement for a loop motion, with one addition:
the second call also takes `--alpha motions/<id>/keyframe-alpha.png`, which
registers `<motion>-keyframe-alpha` with a `derive` edge (`step: "key"`) from
the keyframe. The green flatten the clip is actually shot from
(`first-green.png`) is deliberately *not* registered — it is a working file,
the same rule `first.png` follows — so the clip's `--from` names the cut-out
keyframe, which is the last thing in the chain that is an asset.

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
