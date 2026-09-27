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

### `guide --rows R --cols C --cell WxH --out <png> [--margin 0.094]`

Draws the layout guide that `sheet-prompt --guide` names in its prompt, at
the sheet's own size (C × W by R × H): a `#f6f6f6` canvas, a 3 px `#333333`
box on each cell's edge, a 2 px `#2f80ed` box on its safe area (inset
`--margin` of the cell, floored per axis — 48 px on a 512 px cell) and a 1 px
`#b8c8e8` centre line through the safe area. `--cell` is the **generation**
cell, the one `sheet-prompt --json` reports (`guide.cell`, 512x512 for a 256 px
character), not `character.cell`. Reports `{ output, rows, cols, cell,
safeMargin, width, height }`.

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs guide --rows 2 --cols 4 --cell 512x512 \
  --out <character>/motions/<id>/layout-guide.png --json
```

Attach it **last** on the image call (`--image-urls`), after every reference:
the prompt calls it "the last attached image". It is a working file with no
asset id, like `first-green.png`, and reproducible from the motion's
`promptParts.guide`. Measured default: off (`prompting.md`, E2).

Ported from aldegad/sprite-gen (Apache-2.0) `sprite_gen/gen/prepare.py`
`draw_guide`@fbd1a08 — same colours, widths and inward-drawn boxes; a one-row
guide is pixel-identical to upstream's (checked 2026-09-27 at 256, 512 and
200×300 px cells). Changes: rows as well as columns, and the centre line
stays inside its own cell.

### `probe <image>`

`{ width, height, hasAlpha, alphaCoverage, cornerColor }`. `hasAlpha` is true
when any pixel's alpha is below 255; `alphaCoverage` is the fraction of pixels
above the alpha threshold; `cornerColor` is the median of the four 8×8 corner
patches as `#rrggbb`. Run this on every freshly generated sheet. On OpenRouter's
GPT Image 2.5 the answer is always `hasAlpha: false` with a near-white
`cornerColor`, so it is not really a branch — it is the free confirmation that
the plate is flat and one colour, and the colour `key --color auto` will use.

### `key <in> --out <png> [--color auto|#rrggbb] [--similarity 0.12] [--blend 0.05] [--keyer unmix|colorkey]`

Keys a plate away. Reports `alphaCoverage` after keying, so you can tell a
successful key (coverage drops to roughly the sprite's share of the image) from
one that ate the character (coverage near zero) or did nothing (coverage still
~1.0). Raise `--similarity` when a gradient background survives; lower it when
the character's own colours start disappearing. When neither setting separates
the character from its background, the sheet needs a matting model, not a
colour threshold — see `remove-background.mjs` below.

**Two keyers** (`--keyer`, default `unmix`). Both cut every pixel within the
`--similarity` radius of the plate (`similarity × 255√3` in RGB: 0.12 ≈ 53,
0.22 ≈ 97). They differ at the edge:

- **`unmix`** (`scripts/chroma.mjs`) reads an edge pixel as a mix,
  `observed = (1−k)·subject + k·plate`, takes `k` off how far the pixel leans
  toward the plate's hue, and writes back the subject's colour
  `(observed − k·plate)/(1−k)` at alpha `α·(1−k)` — within 4 px of the cut
  (2 px for colours close to the plate). Small plate-coloured clusters inside
  the subject (a green reflection) are recoloured with their alpha kept. A
  pixel that does not carry the plate's hue (every plate channel above every
  other one) is never touched, so yellow, gold, skin and white edges stay as
  drawn. An opaque edge pixel is also read against the character's own
  colours beside it, so a rim that is the character blended with the plate
  at full opacity comes out; plate-coloured shadow touching no part of the
  character (a floor shadow) is removed. `auto` measures the plate as the
  mode of 8-wide colour bins over the corner patches and the border.
  `--blend` and `--despill` do not apply, and a note says so.
- **`colorkey`** is ffmpeg's: alpha ramps over `--blend` past the radius and
  RGB is left as it was, so an anti-aliased edge keeps its plate colour at
  partial alpha — the 1 px green rim. `auto` uses the probed `cornerColor`.

A plate with no hue — white, cream, grey, which is every GPT Image sheet — has
nothing to un-mix and is keyed with `colorkey` whichever you ask for; stderr
says so and the JSON's `keyer` names the keyer that ran. On a hued plate the
JSON also carries `keyResidue` and `keyFringe` (see `inspect`), with a warning
above 0.005 and 0.01 respectively.
Ported from aldegad/sprite-gen (Apache-2.0); the method, the adaptations and
the numbers are in "Measured: the chroma keyer" at the end of this file.

**The keyed-out pixels come back black, not invisible-green.** ffmpeg's
`colorkey` only writes the alpha plane — the name is literal — so the plate is
still there underneath, and anything that ignores alpha gets it back whole: a
bilinear `--scale` bleeds green into every edge, and an engine that imports the
sheet as RGB shows a solid plate. This step therefore zeroes the colour of
every pixel left below the alpha threshold, the same rule `clean` applies when
it drops a blob (transparency is all four bytes). `run` inherits it through the
keyed sheet; `from-video` does the same to each sampled frame. Opaque pixels are
never touched, so nothing you can see changes.

### `flatten <in> --out <png> [--bg #ffffff] [--similarity 0.22] [--room tall|wide|square [--headroom f] [--lead f] [--trail f] [--facing left|right]]`

Composite onto a solid colour. Video models mishandle alpha — flatten frame 00
before handing it to `seedance-video.mjs --image`. Both paths are
workspace-relative: `flatten <character>/motions/<id>/frames/00.png --out
<character>/motions/<id>/first.png`.

**It checks the subject against the plate first.** The clip that comes back is
keyed at the video radius (`--similarity`, 0.22 ≈ 97 RGB units), and every
subject pixel inside that radius of `--bg` is cut away with the plate wherever
it sits — a green gem on a green plate, a white collar on a white one. Before
painting, `flatten` counts the subject's pixels (alpha ≥ `--threshold`) within
the radius, ignoring speckles (a pixel needs 3 of its 8 neighbours to be
subject within 40 of it), and reports
`plateCheck: { radius, subjectPixels, within, fraction, minDistance, nearest }`
with a warning when `within > 0`. Pick another plate before paying for the
clip. An input with no transparency has no subject to tell apart and gets no
`plateCheck`. Inspired by aldegad/sprite-gen `gen/prepare.py` (a key must clear
every subject pixel by the erase radius). The check reads the picture
itself, so `--room` (below) changes nothing about it.

**`--room` gives the motion room inside the first frame.** An image-to-video
model keeps the input's framing: Seedance handed a 416×506 frame returns
588×716 and refuses `--aspect-ratio` on i2v (`video-preview.md`). A frame 00
padded by `align`'s 8 px leaves a jump no room above the head and a swing no
room in front of the body, and no prompt wins that back — measured on a Lumi
jump shot from a tight frame, 53 of 97 frames touch an edge and the head is cut
off for 38 of them; the same jump from a `tall` frame touches nothing (see
Measured below). `--room` pads the picture into the canvas the motion needs
before it is painted onto `--bg`:

| `--room` | Canvas | Default room |
|---|---|---|
| `square` | 1:1 around the picture | none — the frame squared off, the picture standing on the bottom edge |
| `tall` | 3:4 | 34 % of the height empty **above** — a jump, a hop |
| `wide` | 16:9 | 35 % above, at least 28 % of the width **in front**, 20 % **behind** — an attack whose swing rises overhead and reaches forward, a weapon drawn back |

A wave, a cheer or a celebration is `--room wide --headroom 0 --lead 0.3
--trail 0` (raised, spread arms leave a 1:1 frame at the corners). Every other
in-place motion needs no room.

- `--headroom` is the empty share of the canvas **height** above the picture
  (`tall`, `wide`); `--lead` / `--trail` the empty share of the **width** in
  front of and behind the subject (`wide` only). Each in [0, 0.9), lead +
  trail < 0.9. The canvas grows in both directions to keep its ratio; the
  picture is never scaled or cut and always stands on the bottom edge.
- **Front is the side the character faces**: `--facing`, else
  `sprite.character.facing` from the nearest sprite `project.json` above the
  input (a frame or a ref lives a few directories below it), else `right`.
  The JSON's `room.facingFrom` says which — `"flag"`, the project.json path,
  or `"default"`.
- A fraction that shapes nothing is refused (`--lead` without `--room wide`,
  `--headroom` on a square room); an input with no transparency is padded but
  warned about — the plate then surrounds the picture's own background.

```json
{ "output": "…/first-green.png", "bg": "#00ff00", "width": 716, "height": 403,
  "plateCheck": { "radius": 97.2, "subjectPixels": 48210, "within": 0, "fraction": 0,
                  "minDistance": 131.2, "nearest": "#5f8f3a" },
  "room": { "shape": "wide", "still": { "width": 272, "height": 262 },
            "offset": { "x": 143, "y": 141 }, "headroom": 0.35, "lead": 0.28,
            "trail": 0.2, "facing": "right", "facingFrom": "…/lumi/project.json" },
  "warnings": [] }
```

`plateCheck` is there for any input with transparency, `room` only with
`--room`.

The room makes the character a smaller share of the clip, so a padded clip
samples it smaller than a tight one; `from-video --body-height` puts every
motion back at one standing height. Ported from aldegad/sprite-gen
`sprite_gen/video/canvas.py` (`pad_canvas`, the `STATE_CANVAS` rows) — the
geometry is identical on 168 of 168 cases run against the Python.

### `slice <sheet> --rows R --cols C --out <dir> [--margin px] [--gutter px]`

Cuts row-major into `<dir>/NN.png`, two-digit zero-padded. Cell size is
`(W − 2·margin − (C−1)·gutter) / C`, floored; a non-integer cell is reported so
you know a pixel column was dropped. Output keeps alpha.

It also writes `<dir>/slice.json` — `{ rows, cols, cell, margin, gutter }` —
the grid the cells were cut from, which is how `inspect` tells a row boundary
from an ordinary step. Anything that rewrites the directory's frames removes
it, so a clip sampled into the same `cells/` later is never judged as a grid.

**`--auto`: slice by where the poses are.** An image model asked for a grid
does not always draw one. The Kagari attack sheet (GPT Image, 4×4, 2048 px,
blind trial G, 2026-09-27) left its blank bands between rows at y ≈ 547, 1031
and 1533 instead of 512, 1024 and 1536: the first row's boots crossed y = 512,
and two lunging swords crossed the column lines — eight of sixteen cells
clipped. `--auto` finds the poses from the alpha instead
(`scripts/sheet-segment.mjs`):

1. the rows from the sheet's row profile (alpha mass per pixel row): its
   blank bands separate the rows, and the cut goes through the middle of each
   band; where two rows touch, the dynamic-programming cut goes through the
   least ink, each row near the ideal height;
2. inside each row band, the poses from its column profile, the same way;
3. every connected piece of ink (4-connected, at the alpha threshold) goes,
   whole, to the pose whose region its centre falls in — so the boots stay
   with their body; a piece with a quarter of itself in another region, or
   spanning more than 1.5 cells, is two poses drawn touching and is split at
   the region line (a small leftover touching the line is the neighbour's
   overhang and is dropped); the soft edge under the threshold follows the
   solid ink it touches;
4. each pose keeps the place it was drawn at **relative to its grid cell** —
   exactly where the fixed slice would put it — and all the cells grow, alike,
   as far as any pose reaches past the grid lines, plus 4 px.

On a sheet whose poses stay inside their cells nothing grows and the cells
are the fixed slice's (the E1 Lumi idle sheets, 4×4 / 4×2 / 2×2, grew 0 px on
every side). `slice.json` gains `auto`: `reason`, the cut lines (`cuts.rows`,
`cuts.cols` per row), the counts found on their own (`natural`) and whether
they had to be forced to R × C (`forced`, which warns — look at those cells),
how far the cell grew (`grew`) against the nominal cell, each pose's box on
the sheet (`poses[].box`, with `at`, the sheet point that became the cell's
top-left) and `clipped`: the poses clipped anyway — ink on the sheet's own
edge (`sheet-edge`) or cut apart from a pose they were drawn touching
(`cut`). `inspect` reports those, because a padded auto cell never touches
its own edge. Refused when the rows or a row's poses cannot be found at all
(an empty sheet). The sheet is only read.

`run` does this by itself when it has to: it cuts the fixed grid first, and
when a pose's own ink continues across a line shared by two cells (a pixel
of the cell's cleaned ink on its edge, and ink just across the line on the
sheet — a drawing that only touches the line is not cut) it slices again by
ink and says so in its warnings. The summary then carries `slice` (`mode:
"auto"`, `reason: "grid-clipped"`, `gridClipped`, and the record above);
absent means the fixed grid. `--no-auto-slice` keeps the fixed cut whatever it
clips; `--auto-slice` goes straight to the auto one. `sheet-raw.png` and
`sheet-alpha.png` are never rewritten — a re-layout is never a hand edit.

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

### `align <framesDir> --out <dir> [--anchor bottom|center] [--x-from feet|bbox|cell|trend|body] [--y-from anchor|cell|clip] [--cell auto|WxH] [--pad 8] [--smooth] [--force]`

The step that turns sixteen pictures into an animation. Computes each frame's
alpha bounding box, then crops to the bbox and pads onto a transparent cell so
the anchor point lands at the same coordinate in every frame.

**y comes from `--anchor`:**

- `bottom` — the bbox's bottom edge, placed at `H − pad`. Use for anything
  standing on the ground.
- `center` — the bbox centre, placed at `H/2`; for airborne pose sequences
  where the feet are not the reference. This recentres the body each frame;
  it does not preserve a jump's vertical trajectory.

**`--y-from cell` keeps a jump's height.** With the default (`anchor`) every
frame stands its own feet on the anchor, so a jump plays as squash and
stretch on the ground — blind trial G-pixel's slime jump had no vertical
travel at all. `--y-from cell` (`clip` is accepted as the same mode, the
name a clip's frames go by; bottom anchor only; refused with `center`)
keeps the height each frame was drawn or filmed at: the ground is the lowest
feet across the frames, in their shared coordinates (the cells of one grid,
the frames of one clip — they must be one height), every frame keeps its lift
above it, and the cell grows tall enough for the highest frame. `align.json`
records `yFrom: "cell"`, `lift` (px per frame) and `ground`; `inspect` reports
`lift` measured on the frames; `run` and `from-video` take the same flag and
put `lift` in their summary. Two readings are warned rather than assumed: no
frame more than 2 % of the cell (at least one block) off the ground — the
source has no drawn height, so it has to come from the game or a redraw; and,
on a grid, a row that never comes down to the ground the other rows stand on
— airborne throughout (the middle rows of a 4×4 jump), or drawn on a higher
ground line (the model's rows drifted); the pixels cannot tell which, so look
at those frames. Measured below ("slicing, lift and sizes").

**x comes from `--x-from`**, and the three modes answer three different
questions about where the character *is*:

| `--x-from` | x is | Use when |
|---|---|---|
| `feet` (default) | the mean x of the alpha pixels in the bottom **10 %** of the bbox | Grounded poses intended to stay in place; use `cell` when deliberate lateral offsets should survive. |
| `bbox` | the bbox centre, props included | The drawing has no ground contact worth pinning. It is also what a `center` anchor uses. |
| `cell` | the centre of the grid cell the frame was cut from, i.e. **no horizontal re-placement at all** | The model already places the body consistently and you only want the vertical levelled. |
| `trend` | the placement the frames were filmed with, minus one straight line fitted to the body's mass centre across them | A **walk or run cycle out of a clip**. Removes the slow slide across the canvas and nothing else. |
| `body` | the placement as filmed, plus a ramp: the last frame's head and torso registered against the first's, that offset spread `round(dx·k/L)` over the frames | The same cycles, with the drift read where the wrap shows it — the head and torso at the ends — rather than fitted to the mass centre across the cycle. Upstream's default for gaits; measured here it matches `trend` (below). |

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

**Why a walk out of a clip wants `trend`, not `feet`.** In a walk one foot is
always in the air, so the foot band holds the planted foot alone — and on a
treadmill that foot slides a whole stride back under the hip, then hands over
to the other. Pinning it moves the *body* by about a stride every step: the
lurch aldegad/sprite-gen retired its own per-frame foot pin over. `trend`
keeps the filmed placement and removes only a straight drift line (fitted to
the mass centre, which a gait swings far less than the foot line), so every
frame stands on the mean foot line and the step stays the step. Measured on
the Lumi side-view walk (Measured below): the head swings 25 px across 16
frames after `feet`, 3.6 px after `trend` — and the onion skin shows the
feet-pinned head smeared sideways. `body` measures one head-and-torso offset
between the last frame and the first (top 60 % of the first frame's box,
±24 px, whole pixels) and ramps it; it never fits frame by frame, which turns
a head bob into a full-body shiver.

`trend` fits a *straight* line, so it needs whole cycles: on a one-shot (an
attack that steps in and back) the lunge itself reads as drift — a first-last
Lumi attack clip, whose true drift is 0, had 21.7 px "removed". Keep one-shots
on `cell` (as filmed) or `body` (a first-last clip's ends coincide, so its
ramp is ~0), or `feet` when the feet should be pinned. Sheets stay on `feet`
by default — a prop that swings sideways needs it — but a walk SHEET lurches
the same way when a reaching foot owns the foot band: a pixel knight walk
jumped its head 24.7 px on the two reaching frames under `feet` and moved
under 2 px under `cell`, `trend` or `bbox`. `inspect`'s added-sway warning
names that case (below); re-align from `cells/`.

Both modes read the frames in ONE coordinate system (a clip's frames, one
grid's cells) and refuse frames of different widths. They record what they
removed in `align.json` and in the JSON as `drift`: `trend` → `{ slope,
driftPx, footSwayPx }` (the slide taken out, and how far the foot line still
moves inside the gait — kept, not an error); `body` → `{ wrapDx, band,
search, shifts }`. Ported from aldegad/sprite-gen `sprite_gen/video/loop.py`
(`drift_reference`, `body_wrap_offset`, `ramp_frames`); the ports reproduce
upstream's numbers on its own fixtures exactly.

**Preserving movement:** `--x-from cell` keeps the horizontal offsets the
source drew; `--y-from cell` (or `clip`) keeps the vertical ones. Under the
default `--y-from anchor` a jump's body poses survive while its rise and fall
disappear — say which the frames carry: the rise is in them only when the
run used `--y-from cell|clip` and `lift` shows it (a peak well above 0), and
otherwise the game code moves the sprite. A jump clip that should keep its
height is shot from `flatten --room tall`, or the peak has no headroom to
rise into.
Compare source cells and aligned frames before treating a planned step,
crouch or turn as jitter to remove.

`--cell auto` sizes the cell around the anchor, not around the bbox: twice the
worst frame's reach from its anchor, plus `2·pad`, rounded up to an even
number (`cell` mode keeps the source grid cell's width, since shrinking it
would shift the very offsets that mode preserves). Under `bbox` that is
`max bbox + 2·pad`; under `feet` it is wider whenever the pose
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

**Frames written by `pixel`** (a `pixel.json` next to them) are N×N blocks of
logical pixels, and `align` keeps them that way: every offset and the pad
(rounded up) are whole multiples of N, so no block straddles the cell's
N-grid and the atlas divides back to logical pixels exactly. The auto cell
is a whole multiple of 2N, so the anchor in its middle is a block boundary
rather than the middle of a block. An explicit `--cell` that is not a multiple of N is refused. The
record's `{ scale, pitch, palette }` is copied into `align.json` as `pixel`,
which is where `inspect` finds it. That is also why a pixel motion is
re-aligned from `pixel/`, never from `cells/`: the cells carry no
`pixel.json`, so frames aligned from them are smooth and the record goes. When
`--out` already holds frames whose `align.json` carries a lattice and the
input has no `pixel.json`, `align` refuses and names the `pixel/` directory;
`--force` does it anyway and says so first in the warnings.

### `pack <framesDir> --out <sheet.png> --atlas <atlas.json> --name <motionId> --fps N [--loop] [--anchor bottom|center] [--cols C] [--scale 1] [--nearest]`

Tiles the aligned frames row-major into one image and writes the atlas.
`--scale` (default 1) resizes every frame first; `--nearest` keeps a
downscale hard-edged, and a scale other than 1 records `meta.filter`
(`nearest` or `smooth`) so a later pack of the same frames repeats it. A
pack at `--scale 0.5` is a half-size copy: the full-size atlas is a re-pack
of the same frames at `--scale 1`, never an upscale of the half. No margin, no gutter — a game engine reads the rects from the
atlas, and gutters only cost texture memory.

For **generated** pixel art, `--scale 0.5 --nearest` is not a pixel-art
path: a fixed factor cuts through block centres wherever the model's block
width is not that factor, so blocks come out uneven, the soft edge stays
soft and every frame keeps thousands of colours. Use `run --pixel` /
`pixel` (below), which measures the grid first; the numbers are in
"Measured (pixel lattice, 2026-09-27)".

The pivot it writes is the anchor point `<framesDir>/align.json` recorded, not
the cell edge, under two keys per frame: `pivot` and `anchor` (the same
point — see `atlas.json` below for which engine reads which). `--scale` leaves the normalized pivot alone (it is a ratio) and
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

### `inspect <motionDir> [--anchor bottom|center] [--cells <dir>] [--key #rrggbb] [--threshold 16]`

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
| `bodyDrift` | Std-dev in px of the feet-centre x across frames. Near zero after `align --x-from feet` **by construction** — it is the line that mode pins; large when a prop-inflated bbox pushed the body around, and large by design after `trend`/`body`, which keep a walk's stepping foot line |
| `headDrift` | Std-dev in px of the head-and-torso x across frames: each frame's top 60 % band (as column profiles in 8 strips) registered against the first frame's. A region no alignment pins, so it sees what `bodyDrift` cannot — a feet-pinned walk lurching by the stride. Absent when it cannot be measured (frames of different widths, fewer than two heads) — never a 0 that looks like a steady head |
| `sourceHeadDrift` | The same spread measured on the pre-align cells (the clip as filmed, the grid as drawn), with its straight-line drift removed — the sway the motion itself has. Absent without cells |
| `maxJump` | Largest anchor displacement between consecutive frames |
| `scaleDrift` | `(max bbox height − min bbox height) / mean` |
| `emptyFrames` | Indices with no pixel above the alpha threshold |
| `nearDuplicates` | `[from, to]` pairs whose step is under 0.01 — `[last, 0]` is the wrap of a looping motion. `[]` when checked and none. Listed for a breathe too, but not warned about there (see `breathe`) |
| `rowJumps` | `[from, to]` row boundaries of the sheet's grid that jump (below). `[]` when checked and none |
| `anchorPoint` | The point `align` recorded for these frames, in cell pixels — the same point the atlas pivot names. Absent when the frames carry no `align.json` for this anchor and cell |
| `lift` | Only for frames aligned with `--y-from cell`: each frame's feet above the anchor point, px (null for an empty frame), measured on the frames — a jump's travel in numbers; all zeros means it has none. `register-run` keeps it, whole or not at all |
| `keyResidue` | Share of the visible pixels (alpha ≥ threshold) that still carry the plate, pooled over the frames: its hue (every plate channel clears every other channel by more than 40), or an opaque edge pixel that is the colour beside it blended with the plate — a floor shadow counts. Absent unless the motion was keyed off a hued plate: `--key` names the plate, otherwise the `keyColor` the last `inspect.json` recorded (`run` and `from-video` record it). The fat report adds `keyResidueEdge`, the same share over the partially transparent pixels. `register-run` copies `keyResidue` into the sidecar |
| `keyFringe` | Share of the fully opaque edge pixels (within 2 px of transparency) that still read as at least 20 % plate — the rim a colour key leaves at full opacity. Same presence rule as `keyResidue`; not copied into the sidecar |
| `pixel` | Only for frames that went through `pixel`: `{ pitch, scale, held, palette, paletteChecked }` — the block size it cut at (source px per logical px), the whole-number scale, and whether the lattice survived everything after it: alpha only 0/255, every N×N block one colour, every colour a pinned-palette colour (not checked after `--outline`, which darkens the edge on purpose). When `held` is false the offending frames are listed (`softAlphaFrames`, `offGridFrames`, `offPaletteFrames`). On these frames `headDrift` is in frame pixels and `sourceHeadDrift`, measured on the source-resolution cells, is converted to them (× scale / pitch.x) so the two compare. `register-run` keeps it |
| `warnings` | Human sentences — read these, they name the fix |

Warning rules and what each one means:

| Warning | Trigger | What to do |
|---|---|---|
| "frame NN is empty" | No pixel above threshold | A cell the model left blank. Edit that one cell (see `prompting.md`) and re-run. |
| "frame NN is nearly empty" | Alpha coverage < 0.02 | Usually the key ate the character. Re-key with a lower `--similarity`. |
| "body drifts sideways between frames — re-run align with --x-from feet/cell" | `bodyDrift > 0.05 · cellWidth` **and** `headDrift > 0.01 · cellWidth` (the upper body moves too); never for `trend`/`body` alignments | Check the motion plan first. For unintended sliding, re-align from `cells/` with `--x-from feet`; use `cell` to retain well-placed intentional lateral motion. A foot line sweeping under a still head is a walk's step, not a slide — it no longer warns. |
| "head sways N px across the frames but M px in the source once its slow drift is removed — the alignment (--x-from X) added sway … re-align from cells/ (pixel/ for pixel art) with --x-from …" | `headDrift > 2 · sourceHeadDrift` **and** `headDrift − sourceHeadDrift` over the larger of `0.01 · cellWidth` and, for pixel frames, one block (the scale) | The alignment added sideways sway the source does not have — a pinned stepping foot, or a slide `cell` kept. Re-align a clip's cycle with `--x-from trend`; a sheet with `trend` or `cell`. The advice never repeats the mode the frames were aligned with, and names `pixel/` when the frames carry a lattice (aligning from `cells/` would drop it — `align` refuses). On pixel frames the bar is at least one block: a lattice moves in whole blocks, and a 44 px pixel cell put the 1 % bar at 0.44 px, under what the snap alone produces. Feet-pinned walks measured 9.7× (Lumi side clip), 7.4× (pixel knight sheet) and 44× (synthetic); every alignment that kept or reduced its source's motion stayed at or under 1.8× or +0.95 % of the cell. |
| "near-duplicate frames AA→BB, … (step under 0.01) — the animation holds there" | A step (mean RGBA difference at 64×64, 0..1) under 0.01 — less than nudging the same drawing one pixel (0.014–0.021 on Lumi's frames); never for frames `breathe` made (a `breathe.json` in the cells or frames) | Fine for a held idle; a hitch in a stroke or a step. For a clip, the sampling hit a hold — resample with `--at` around it. For a sheet, drop or redraw the repeated frame. |
| "row boundaries jump: AA→BB, … — the sheet's rows were drawn as separate sequences" | A grid row boundary (the wrap too, for a looping sheet) whose step is over 3× the in-row median, over every in-row step, and at least 0.01; rows of 3+ frames only; the grid comes from `cells/slice.json` | The model drew each row as its own little animation. Regenerate with a continuity instruction across rows, or fewer frames (Lumi idle as 4×2 or 2×2 has no jump); a sheet whose rows are phases (windup, strike, recovery) measures under the bar. |
| "anchor jumps between frames NN and MM" | `maxJump > 0.08 · cellWidth` **and** the feet moved that far too | Compare the source poses with the plan. For unintended placement jumps, try `align --smooth` or the other anchor; fix discontinuous drawing when alignment cannot help. Preserve deliberate fast movement. |
| "character scale varies across frames — regenerate with a fixed-scale instruction" | `scaleDrift > 0.15` | This measures silhouette height, including props. Check for intended crouching, turning or prop movement; acknowledge it when justified. Regenerate actual proportion or drawing-scale drift with the fixed-scale guidance in `prompting.md`. |
| "cell NN is clipped — the drawing leaves its grid cell" | Bbox touches the cell edge before alignment (fixed-grid cells; `run` slices by ink instead when a pose continues across a line, so this is what `--no-auto-slice` leaves) | The pose is bigger than its cell. Regenerate with the "stays inside its own cell" clause. |
| "cell NN is clipped — the drawing runs off the edge of the sheet" / "— it was drawn touching a neighbouring pose and cut apart from it" | Cells sliced by ink (`slice --auto`, `run`'s fallback): the pose's ink reaches the sheet's own edge, or it was split from a pose it touched (`slice.json` `auto.clipped`) | No slicing gives back what was drawn off the image — regenerate. A split pose: look at the two cells; the cut went through the least ink between them. |
| "keyResidue 0.0158: 1.6% of the visible pixels still carry the plate … a fringe the key left, a shadow on the floor, or colour the character really has" | `keyResidue > 0.005` | Look at an edge and under the feet at 4× on a dark background. A `--keyer colorkey` cut leaves a green rim — re-cut with `--keyer unmix`. After `unmix` the usual cause is the character's own plate-coloured material or a translucent effect (smoke, glow) the plate shows through; a matte (`remove-video-background.mjs`, then `--key alpha`) is the fix for the second |
| "keyFringe 0.0252: 2.5% of the edge is the character still blended with the plate … a yellow-green rim on warm colours, a teal one on blue" | `keyFringe > 0.01` (said only when `keyResidue` is under its bar) | Re-cut with `--keyer unmix`, which reads each edge pixel against the colour beside it. A wider `--similarity` does not remove it: the rim is opaque character colour, outside any radius of the plate |
| "pixel lattice broken: frame(s) … have soft alpha / blocks off the N× grid / colours outside the palette …" | Pixel frames that no longer match their lattice | Something resampled or re-aligned them from the wrong source. Re-align from `pixel/`, not `cells/`; re-run `pixel` if the palette was rebuilt after them. |

These are geometric heuristics. `maxJump` does not include last-to-first (the
step checks do, for a motion whose atlas says it loops), and the report does
not judge identity or contacts. Check those in playback, even when there are no
warnings.

The full report adds, per frame, `headX` (the head band's offset from frame
00, px) and `step` (the step to the next frame; the last frame's is the wrap,
or null for a one-shot), and at the top `grid` (from `slice.json`), `loop`
(from `atlas.json`, null before `pack`) and `inRowMedianStep`. The step is
aldegad/sprite-gen's `qa/inspect.py` measure (their "motion presence", scored
per row), area-averaged in premultiplied alpha here: on the Lumi sheets it
reads 0.98–1.13× their Pillow-bilinear numbers (median 1.06×), so the idle has
6 pairs under 0.01 here against their 8. Inspired by their row-level signal;
judged here per pair and per row boundary.

### `run <sheet-raw> --rows R --cols C --out <motionDir> --name <motionId> --fps N [--alpha <png>] [--force] [flags]`

The whole chain in one call: probe → key (when the sheet is opaque and `--key`
is not `none`, writing `sheet-alpha.png`) → slice → align → pack → gif (+ webp)
→ inspect. Accepts every flag the individual steps take (`--loop`, `--anchor`,
`--key auto|#rrggbb|none`, `--cell`, `--pad`, `--smooth`, `--scale`,
`--nearest`, `--margin`, `--gutter`, `--x-from`, `--y-from`).

The slice is the fixed grid unless a pose's ink continues across a grid line;
then `run` slices by ink (`slice --auto`, above), warns that it did, and the
summary carries `slice` — `--no-auto-slice` / `--auto-slice` choose outright.
With `--y-from cell` the summary carries `yFrom` and `lift`.

`--pixel` puts the `pixel` step between the cleaned cells and `align` (the
lattice frames stay at `<motionDir>/pixel/NN.png`, beside `cells/`) and turns
`--scale` into the whole-number upscale of the lattice (default 1: one image
pixel per logical pixel; pack then packs at 1). The palette it quantises to
is, in order: `--palette` when named; else the palette pinned on the
character (`character.pixel.palette`, which `register-run` pinned from the
first pixel run — every motion of a pixel character shares it, and a run
quantised to another is refused there); else, with nothing pinned yet, a new
`<motionDir>/palette.json`. `--repalette` never rebuilds the pinned file: it builds this motion's own
(beside it, as `palette-rebuilt.json`, when this motion's `palette.json` is
the pinned one), and `register-run` then needs `--repin`. A pinned palette
whose file is gone is refused, and an empty palette is never pinned.
`--palette-size` defaults to the character's `character.pixel.colors`, else
48. The lattice is decided in a scratch directory before anything in
`<motionDir>` is replaced, so a refusal leaves the previous run exactly as
it was. It
takes `pixel`'s flags (`--palette`, `--repalette`, `--palette-size`,
`--pitch-hint`, `--outline`, `--outline-strength`, `--no-detail-bias`); they
are refused without `--pixel`. The JSON gains `pixel: { dir, scale, pitch,
logicalCell, palette: { file, colors, pinned, from }, outline, record }`
(`from`: `flag`, `character` or `motion`) and `inspect.pixel`; `register-run`
reads `pixel.palette.file` / `.colors` to pin it. Every pixel run of a
character is held to its declared height — `character.pixel.logicalHeight`,
or `--logical-height H` for this run (see `pixel`) — and the JSON's `pixel`
gains `logicalHeight`. A `run` **without**
`--pixel` on a pixel-art character — `character.pixel`, else a
`character.style` that says so (the reading `rive --filter auto` uses) — ends
with a warning suggesting it. A run without `--pixel` also removes the
`pixel/` frames and the unpinned palette an earlier pixel run of that motion
left, and warns `not a pixel run: removed …`; a pinned palette stays.

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

### `pixel <framesDir> --out <dir> [--palette <file>] [--repalette] [--palette-size 48] [--scale 1] [--pitch-hint N] [--logical-height H] [--outline] [--outline-strength 0.62] [--no-detail-bias]`

Snaps generated "pixel art" onto the pixel grid it was drawn on. An image
model's blocks are not whole pixels wide (10.3, not 10), differ per axis,
wobble inside a frame and carry anti-aliased, half-transparent edges; this
measures the grid and collapses every block to one logical pixel. Per frame,
on its solid-alpha (α ≥ 128) bbox:

1. **Pitch per axis, 2–48 px, sub-pixel** — an integer lattice score (the
   share of colour edges within ±1 px of a grid line, minus the share chance
   puts there), then a 0.02 px refinement around the integer seed and its
   halves to fifths. A frame whose best score is under 0.2 reads "no grid".
   Pixels whose alpha is 0 are read as transparent black: colour a key left
   under them is no edge. (The slime jump's fixed-grid cell 00 snapped
   26×25 before that rule and 26×26 after, the same as its auto-sliced
   cell.)
2. **The generation's consensus** — the median of the frames' readings;
   readings under 60 % of the ceiling are collapsed (a divisor) and dropped,
   and so are readings above the ceiling's family that fewer than a quarter
   of the frames share (a harmonic). A frame keeps **its own** pitch when it
   is within 10 % of the consensus on both axes, and is cut at the consensus
   otherwise — said per frame in `warnings`.
3. **Phase**, measured: the most uniform of 8×8 offsets at that pitch.
4. **Cut lines** move onto the strongest colour boundary within ±pitch/3,
   never closer than 0.6 × pitch to the next line (2 px under pitch 3.3).
5. **One colour per block** — a two-cluster vote; a near-black minority of
   at least 40 % wins (eyes, 1 px outlines) unless `--no-detail-bias`. A
   block less than half solid is transparent; alpha is 0 or 255.
6. **One palette** of at most `--palette-size` colours (median cut) over all
   the frames, **pinned** to `--palette` (default `<dir>/palette.json`,
   `run --pixel`: `<motionDir>/palette.json`): when that file exists it is
   used as it is, so a re-run cannot move the colours, and a later motion
   that names the same file gets the same ones. `--repalette` rebuilds it; a
   pinned palette more than 48 (RGB distance) from some colour of the new
   frames is said, not silently applied; an unreadable one is refused.
7. `--outline` darkens every silhouette-edge pixel to (1 − strength) of its
   colour, after the palette (so those colours are not palette colours).

Writes `<dir>/NN.png` (the input's names) — every frame on **one** canvas of
logical pixels, at the logical position it sat at in its cell (so
`align --x-from cell` still means something), upscaled by `--scale N`
(whole number, nearest; refused otherwise) — and `<dir>/pixel.json`:

```json
{ "kind": "pneuma-sprite-pixel", "version": 1, "source": "…/cells", "scale": 1,
  "pitch": { "x": 10.367, "y": 10.6 }, "runlen": { "x": 8.574, "y": 9.04 },
  "logicalCell": { "width": 49, "height": 48 }, "cell": { "width": 49, "height": 48 },
  "palette": { "file": "…/palette.json", "colors": 48, "pinned": false },
  "detailBias": true, "outline": null,
  "frames": [{ "index": 0, "source": "own", "own": { "x": 10.3, "y": 10.6 },
               "pitch": { "x": 10.3, "y": 10.6 }, "logical": { "width": 17, "height": 39 },
               "at": { "x": 16, "y": 7 } }],
  "warnings": [] }
```

`source` per frame: `own`, `consensus` (its own reading was inconclusive),
`outlier` (its reading was outside the family) or `empty`. `palette.json` is
`{ kind: "pneuma-sprite-palette", version: 1, source, colors: ["#rrggbb", …] }`.
`--out` must not be the input directory — the cells are what a re-run snaps
again. A same-colour run-length estimate is kept as a second opinion only:
when it disagrees (a divisor, a harmonic, one axis collapsed onto the other)
it is a warning, never a change to the cut.

**When the frames do not show their grid, it refuses rather than guesses.**
If fewer than half of the non-empty frames read a grid on their own, the step
stops and says what the frames suggest — where they score best *together*,
and what the same-colour runs measure (those read short at soft edges) — and
asks for `--pitch-hint N`. This is the normal case for real GPT-Image pixel
art (see "Measured"): its blocks are ~8 px but only loosely on one lattice.
Look at a frame at 8× (count a few blocks across a flat area) and pass the
block width in source pixels. The hint then **is** the consensus: a frame
keeps its own reading within 10 % of it and is cut at N otherwise. No
automatic floor can replace the look: a plush video walk that is not pixel
art pools a higher lattice score (0.168 at 32 px) than a real pixel-art
walk (0.154 at 9 px).

**The declared height** (`--logical-height H`; `run --pixel` passes
`character.pixel.logicalHeight`) is the figure's height in logical pixels —
the user's answer to "how tall, in pixels". It never resamples a block. It
does two things:

- **It can stand in for the look**, when the frames do not show their grid
  and no `--pitch-hint` was given: the pitch at which the frames (their
  median solid height, in source pixels) are H tall is used as the hint —
  but only when one of the frames' own loose readings (the pooled
  whole-number pitch, the same-colour run length) is within 25 % of it. The
  warning says so first (`pitch detection was inconclusive … — cut at 8.06
  px, the block size at which these frames (427 px tall) are the declared 53
  logical px …`), and the lattice's per-frame notes name it `the declared
  height's pitch`. When the readings do not back it, the refusal names it
  (`The declared height (32 logical px) would mean 13.34 px blocks for
  frames 427 px tall, which the frames do not back — the sheet was probably
  drawn at another height`) and still asks for `--pitch-hint`. An explicit
  `--pitch-hint` always wins.
- **It catches a wrong grid.** Cut at the frames' own pitch, a height 1.5×
  or more off H either way is a divisor or a multiple of the real blocks,
  not a figure drawn a little off: the pitch that makes the frames H tall is
  taken when the frames' readings back it (said in `warnings`, `pitchFrom:
  "height"`), and otherwise the step refuses. Measured: a slime idle
  declared 24 tall used to snap at pitch 3 to 96 logical px with exit 0; it
  now cuts at 12 and comes out 25 tall. Without H, a consensus the
  same-colour runs call a divisor (runs 1.5× or more its size) takes a
  larger reading those runs back, or refuses. Both refusals say `Nothing was
  written.` and name the two ways on: `--pitch-hint N` after looking at a
  frame at 8×, or `set-character --pixel H` with the height the frames were
  drawn at.
- **It is checked** after the snap: the frames' median logical height
  against H, within 5 % (at least 1 px — a walk bobs by one). A miss is a
  warning with the numbers to act on — regenerate at H, pass the hint that
  would give H only if the blocks really are that wide, or declare the
  height the frames have (`set-character --pixel <measured>`) so later
  motions are held to it. The frames keep the blocks they were drawn with:
  squashing a drawing to a height merges blocks (upstream removed exactly
  that for the same reason).

`pixel.json` and the JSON gain `logicalHeight: { declared, measured, range:
[min, max], honoured, pitchFrom: "hint" | "height" | "measured" }`.

The method is a port of aldegad/sprite-gen's "Backbone Lattice"
(`sprite_gen/frames/extract.py@fbd1a08`, Apache-2.0; its run-length
estimator is itself a port of perfectpixel-studio, MIT). Before three
measured changes it produced pixel-identical frames and palettes to
upstream's Python; the changes are: divisor seeds down to a fifth (upstream:
half and third), a consensus ceiling that needs a quarter of the frames'
support (upstream: the single largest reading), and the hint as the family
centre (upstream: a fallback when every frame is inconclusive). Upstream's
component extraction, row registration and physical-cell cap are not
ported: `slice`/`clean` cut the cells and `align` places and sizes them.
The declared height is ours: upstream's `fit.logical_height` sizes the
logical cell, not the figure.

### `recolor-palette <characterDir|motionDir> [--out <map.json>] [--force]`

Drafts a **recolor map** for a pixel-art character — one declared
(`character.pixel`) with a pinned palette. Anything else is refused, saying
why: an exact swap needs art made of a few exact colours, and painted art is
not (each frame of the seed character Lumi carries about 250 colours; the 64
most used cover 53–55 % of its visible pixels).

Reads the registered frames of every ready sprite motion (or the one named)
and writes `<character>/recolor.json`:

```json
{ "kind": "pneuma-sprite-recolor", "version": 1, "character": "Pip",
  "palette": "pip-palette", "swatches": "recolor-swatches.png", "help": "…",
  "colors": [ { "hex": "#070e1d", "pixels": 767, "share": 0.1022, "swatch": 1 },
              { "hex": "#1954bf", "pixels": 447, "share": 0.0595, "swatch": 4 },
              { "hex": "#2b2b2b", "pixels": 12, "share": 0.0016, "inPalette": false, "swatch": 48 },
              { "hex": "#7e3222", "pixels": 0 } ],
  "variants": [ { "name": "variant-1", "map": {} } ] }
```

`colors` is every colour the frames use, most used first (then by hex, so a
re-draft is the same file), then the pinned palette's colours no frame uses
(`pixels: 0`); `inPalette: false` marks a colour the palette lacks (an outline
darkened after it, `run --pixel --outline`). Beside it, `recolor-swatches.png`
draws one numbered cell per colour in use: the frame that uses it most,
faded, with that colour's pixels in a mark colour none of them is near, and
a square of the colour beside the number. **Look at it** to learn which
number is the tabard and which the plume — hex values alone do not say.
Fill in the colourways (`"name": "red-team", "map": { "#1954bf": "#bf191f" }`,
only the colours that change) and pass the file to `recolor --map`. The one
template colourway has an empty map, which `recolor` refuses. An existing
map is never drafted over without `--force` (it may hold colourways);
`--out` writes elsewhere, the swatch sheet then `<name>-swatches.png`
beside it. More than 256 colours in use (frames not quantised to one
palette) or a swatch sheet over 32 MP (frames larger than pixel art is
drawn at — check they went through `--pixel` at scale 1) is refused.

### `recolor <characterDir|motionDir> [--map <map.json>] [--variant name,…]`

Bakes colourways — a palette swap into new files, never a tint at run time:
a baked sheet can be checked pixel by pixel and costs the engine nothing.
Every ready sprite motion of the character, or the one named; loops and
transitions are left out (listed in `skipped`). Same refusal as
`recolor-palette` for a character that is not palette-pinned pixel art.

**The colourways** come from `--map` (`kind: "pneuma-sprite-recolor"`,
`variants: [{ name, map, tolerance? }]`, every other key ignored), else from
the ones the character recorded (`character.pixel.variants`) — so a motion
made again gets its colourways back with no map at hand. `--variant` narrows
either to the names given. A name is a slug (`red-team`: lower-case letters,
digits, single hyphens, at most 32); map keys and values are `#rrggbb`
(written lower-case); a source mapped twice, an empty map, two colourways of
one name are refused.

**The swap.** Exact by default: a pixel changes only when its RGB is a
source. `tolerance: N` (1–255, per colourway; absent or 0 is exact) is for
soft-edged art: a pixel within Chebyshev distance N of a source takes the
target of the **nearest** source (squared RGB distance; a tie goes to the
earlier map entry). Alpha is never touched, nor is any pixel with alpha 8 or
less. Integer arithmetic only: the same frames and map give the same bytes.

**Where it lands**, per motion and colourway:

```
<character>/motions/<id>/variants/<name>/
  frames/NN.png  frames/align.json   # the motion's frames, recoloured; its align record
  sheet.png  atlas.json              # pack, with the motion's layout, fps, anchor and pivot
  preview.gif                        # gif (no WebP: lossy colour is the one thing to avoid here)
```

The atlas is the motion's own, byte for byte — `meta.image` is `sheet.png`
in both — so an engine loading the motion loads any colourway by swapping
the directory.

**The report** (`--json`), per motion (`motions[].variants[]`) and summed
over the motions (`summary[]`), for each colourway: `substituted` (pixels
swapped), `substitutions` (each entry's pixels, by source), `unmatched`
(entries that matched nothing — a typo, or a colour these frames do not use;
in the summary only those no motion used, and each is a warning), and
`uncovered: { pixels, colors, top, truncated? }` — the colours the map left
as they were, the 64 most used named. A motion whose frames carry colours
the pinned palette lacks is warned (not for an outlined run, whose outline
shades are expected). `variants` echoes the colourways as checked — what
`register-recolor` records — and `map` is the `--map` path or null.

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs recolor <character> --map <character>/recolor.json --json \
  | node {SKILL_PATH}/scripts/sprite-project.mjs register-recolor --dir <character> --report -
```

Recolor is a port of aldegad/sprite-gen's palette-swap bake
(`sprite_gen/effects/recolor.py@fbd1a08`, Apache-2.0): on the knight walk
below, every variant sheet decodes to exactly upstream's pixels and every
report number matches. Ours: the tolerance per colourway, slug names, the
bake over a motion's frames through `pack` and `gif`, the draft read off the
pinned palette, and the swatch sheet.

### `contact <clip> --out <png> [--count 24 | --every s] [--cols 8] [--width 160] [--gait walk|run] [flags]`

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
at **its own frame rate** (a window longer than 480 frames is thinned to fit,
never below 12 fps; analysis stops after 40 s and says so) into 96 px RGBA
thumbnails, keyed with `--key`. Two readings come out of them.

**The silhouettes** — each thumbnail's alpha — give the ends of the clip. Two
silhouettes are compared by **`Σ|a−b| / Σ max(a,b)`**, the fraction of the
combined ink that changed, so 0 is the same pose and the number means the same
thing whether the character fills the frame or a tenth of it.

**The colour** — each thumbnail premultiplied by its alpha — gives the cycle.
Two frames are compared by **`D` = the mean `|a−b|` of their premultiplied
RGBA**, 0..1 over the whole frame. Colour, because an outline cannot tell a
near leg from a far one (a side walk repeats in outline every *step*, and a
stride is two) and cannot see a blink. The cycle reading is ported from
aldegad/sprite-gen's `video-loop` (`cycle.mjs`, credits there):

1. The whole-clip **lag profile** `P[L] = mean_j D(j, j+L)`: a cycle of L
   frames makes every frame look like the one L frames later, so `P` dips at
   L, 2L, 3L…
2. The **period** is the shortest dip within 15 % of the deepest, looked for
   between **0.4 and 2.5 s** (our window; sprite-gen's walk window, 0.5–1.6 s,
   refuses tanka's 1.875 s front-facing stride), leaving half a second of clip
   past it to compare against.
3. It must dip **≥ 15 % below the profile's mean** (more when the clip holds
   less than two periods — two lucky pairs do not prove a repeat), or the
   verdict is **no cycle**, with the reason and a warning. A profile with no
   dip inside the window at all is no cycle too: a first-last idle drifts
   steadily away from its keyframe and back, and has no period.
4. **Half a stride?** When a dip at about twice the period repeats within
   25 % as well, and the period's own repeat is not near-exact, the cycle is
   **`ambiguous`**: both lengths are named, the short one stays first (pixels
   cannot say which is the gait), and the long one's best window is added to
   `loops[]`. `--gait walk|run` says it IS a gait: a period under the gait's
   floor (0.6 s walk, 0.35 s run; in frames, the seconds × fps rounded half
   to even — a run at 30 fps is 10 frames) is one step, so the doubled period is taken
   when it repeats within 25 %, and the verdict is no cycle (half a stride)
   when it does not; an ambiguous period above the floor takes the long one.
5. **Where to cut it**: every start for the period ± 1 frame, ranked by how
   the wrap plays — the step from the window's last frame back to its first
   against the window's own step, penalised in log space either way (a wrap
   much smaller than a step is a stall, much larger a snap) — plus how well
   the quarter-cycle either side of the cut repeats one period later. A
   window must move (its step ≥ ¼ of the clip's median step), or a held pose
   would place a perfect cycle inside a closing hold. Up to three distinct
   cuts.
6. **One-shots**, only when nothing repeats: every window where the clip
   leaves a rest pose and comes back to it — the endpoints within a quarter of
   the departure, the action ≥ 4 frames with ≥ 2 quieter frames inside the
   window on each side (an action cut off by the clip's first or last frame is
   never padded into one), and the departure ≥ 3 ordinary steps. Seedance's
   4 s minimum makes a strike performed twice common, so each non-overlapping
   one is listed.

| Key | What it says | The threshold behind it |
|---|---|---|
| `stillStart` | When the opening pose breaks — everything before it is the same picture N times | first frame with silhouette `diff(first, i) > 0.05`; `null` (plus a warning) when nothing ever differs |
| `stillEnd` | Where the closing hold begins | last frame with `diff(last, j) > 0.05` |
| `cycle` | The verdict: `{ verdict: "periodic"\|"none", reason, period, periodicity, periodicityMin, ambiguous, minima }`, plus `gait` with `--gait` | `reason` is `still`, `window` (too short to see a cycle repeat), `no-dip`, `flat` (`periodicity < periodicityMin`), `half-stride` or `held`; `minima` are the profile's deepest dips as `[seconds, P]` — where else the clip nearly repeats |
| `loops[]` | The windows to sample for the cycle: `{ start, end, period, seam, step, wrap, ambiguous }`, `[]` with no cycle | **`seam`** is how different the two ends are (the start against the frame one period later), **`step`** the window's mean frame-to-frame change, so `seam ≪ step` is a clean cycle; **`wrap`** is the step the loop plays from its last frame back to its first, ideally about one `step`; `ambiguous` is `null` or `{ periods: [short, long], depthRatio }` |
| `oneShots[]` | Rest → action → rest windows: `{ start, end, action: { start, end }, peak, departure, seam, step, rule }` | only when `cycle.verdict` is `none`; `rule` is `contrast` (peak ≥ 3 MADs above the clip's typical distance) or `moved` (departure ≥ 0.4 of the subject's pixel mass) |
| `profile.deltas` | The rhythm: frame-to-frame silhouette change at `profile.fps`, from `profile.start` | none — read the zeros as holds and the plateaus as beats |
| `alphaCoverage` | Mean opaque share after keying | over 0.9 raises the same "was this shot on a flat chroma background?" warning `from-video` raises |

```json
{ "clip": "<abs>", "out": "<abs png>", "duration": 4.042, "fps": 24,
  "trim": { "start": 0, "end": 4.042 },
  "tiles": [ { "index": 0, "t": 0, "row": 0, "col": 0 }, "…" ],
  "grid": { "rows": 3, "cols": 8 }, "tile": { "width": 160, "height": 160 },
  "keyColor": "#00f104", "alphaCoverage": 0.34,
  "stillStart": 0.125, "stillEnd": 3.75,
  "loops": [ { "start": 0.875, "end": 2.75, "period": 1.875, "seam": 0.0023, "step": 0.0093,
               "wrap": 0.0095, "ambiguous": null }, "…" ],
  "cycle": { "verdict": "periodic", "reason": null, "period": 1.875, "periodicity": 0.747,
             "periodicityMin": 0.15, "ambiguous": null, "minima": [[1.875, 0.0145], [0.875, 0.0743]] },
  "oneShots": [],
  "profile": { "fps": 24, "start": 0, "deltas": [0.02, 0.03, "…"] },
  "warnings": [] }
```

(That is tanka's front-facing walk; `video-preview.md`, "Measured: cycle
analysis", has the before/after on every clip it was checked against.)

Things worth knowing before you trust a number:

- **`loops[]` and `oneShots[]` answer different questions.** A clip that
  repeats is sampled from `loops[0]`; a clip that performs its action once
  (or twice, with a rest between) from a one-shot's `start`–`end`. A clip with
  neither — an action that starts at once and ends in a different pose, like
  the Lumi lantern swing — is sampled from `stillStart`–`stillEnd`.
- **`ambiguous` is a question for your eyes.** Look at both windows on the
  contact sheet: if the legs alternate within the short one, it is a stride;
  if the short one ends on the other leg forward, it is a step and the long
  one is the loop. Pass `--gait walk|run` to let the gait floor decide.
- **`--key none` leaves the frames opaque**: the plate is then part of every
  picture — constant, so it adds nothing to a difference — and the
  silhouettes are luma with the frame's own median subtracted. It works, but
  it is noisier than a keyed clip and `keyColor` is omitted.
- `drawtext` is missing or fontless in some ffmpeg builds, in which case the
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
| `--key auto\|#rrggbb\|none` | `auto` | `auto` = the plate the model actually painted: with `unmix`, the mode of the border colours over 8 of the sampled frames; with `colorkey`, the median of frame 00's four corner patches |
| `--keyer unmix\|colorkey` | `unmix` | See `key`. `colorkey` leaves the 1 px green rim `video-preview.md` measured; a plate with no hue is keyed with `colorkey` either way. The JSON says `keyer` |
| `--similarity` | **0.22** | Wider than a sheet's 0.12: a codec's "solid" green is a range, not a colour. Measurements in `video-preview.md` |
| `--no-clean` | cleaning on | As in `run` |
| `--body-height N` | off | Scale every sample so the subject in the clip's **first** frame stands N px tall — see below |
| `--anchor` `--x-from` `--cell` `--pad` `--smooth` `--scale` `--nearest` `--cols` `--width` `--no-webp` | as `run` | `--x-from trend` for a walk or run cycle, see `align` |
| `--y-from anchor\|clip` | `anchor` | `clip` (the same mode as `align`'s `cell`, recorded as `cell`) keeps where the clip had each frame vertically: on a locked camera, a jump's rise above the floor it takes off from (see `align`). The summary's `lift` says how far each frame rose — E4's roomy jump: `[2, 0, 0, 132, 182, 192, 194, 190, 152, 2, 2, 2]` px, the same 192 px its clip measured |

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

**`--body-height N` gives a character one size across its clips.** Every
image-to-video clip of a character starts from the same still, so the subject's
height in the clip's frame at t = 0 is the same standing pose in every state —
the one height that means the same thing in a walk, a jump and an attack (the
tallest frame would not: an attack's windup lifts the weapon over the head).
Each clip is filmed at its own scale, though — a still padded with `flatten
--room` puts the character in a smaller share of the frame (0.647 of the
height in a `tall` jump clip against 0.979 in a tight one). `--body-height`
keys the clip's first frame with the clip's own key, cleans it like a cell,
measures the subject's height, and scales every sample by `N / measured`
(`area`) before cleaning and alignment, so the same `N` on every
clip puts the character at one size in every motion. Where the resize sits
depends on the keyer: a `colorkey` cut is keyed first and scaled
premultiplied (the plate under zero alpha cannot bleed into the edge); the
default `unmix` keyer runs on the raw frame, so the raw frame is scaled and
then keyed — area-averaging mixes subject and plate at the edge the way the
camera already did, which is what un-mixing inverts. The standing frame is
keyed with frame 0's plate (the one that chose the keyer). The measurements
below were taken with `colorkey`, before `unmix` became the default. Up or down — a target is
a size, not a cap — but scaling up is warned (the frames are softer than the
clip). It needs a keyed clip (`--key none` is refused: there is no subject to
measure). The JSON gains `"bodyHeight": { target, measured, scale, frame }`,
`frame` being the scaled sample size. Inspired by aldegad/sprite-gen
`video/loop.py` `--body-height` (`first_frame_height`); applied to the samples
here rather than to a finished strip.

The extra keys on top of `run`'s JSON:

```json
{ "source": "video", "video": "<abs path to the clip>",
  "sampledAt": [0, 0.253, 0.505, "…"], "schedule": "even",
  "bodyHeight": { "target": 60, "measured": 94, "scale": 0.6383, "frame": { "width": 123, "height": 82 } },
  "trim": { "start": 0, "end": 4.042 }, "duration": 4.042,
  "alphaCoverage": 0.4438, "keyColor": "#08f00d", "keyer": "unmix",
  "xFrom": "trend", "drift": { "slope": 1.3672, "driftPx": 15.04, "footSwayPx": 16.54 } }
```

`bodyHeight` is there only with `--body-height`, `drift` only with `--x-from
trend|body` (as in `run` and `align`).

`inspect` in that JSON carries `keyResidue` when the plate had a hue.

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
| `--keyer unmix\|colorkey` | `unmix` | See `key`. `unmix` measures the plate on 8 frames spread over the window and un-mixes every edge; `colorkey` is the previous chain (frame 0's corner colour, `colorkey`, `despill`). A plate with no hue is keyed with `colorkey` either way |
| `--similarity` / `--blend` | **0.22** / 0.05 | The key radius (both keyers) and `colorkey`'s ramp (`video-preview.md` has the sweep behind them) |
| `--despill` / `--no-despill` | on whenever `colorkey` keys a hued plate | ffmpeg `despill` on the plate hue, applied **after** the key. `colorkey` only — and see step 4 for what it does to the rest of the picture |
| `--trim-holds` / `--no-trim-holds` | on | Drops a frozen opening or closing, see below |
| `--seam-fill auto\|none\|<N>` | `auto` | Interpolates in-between frames into the **wrap** when the seam is past `seamLimit` = max(`2·step`, 0.005), see below |
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
4. **Key, then zero the keyed RGB.** With `--keyer unmix` (the default) the
   window is decoded once to raw RGBA in the work directory (W × H × 4 bytes a
   frame at the clip's own size — 200 MB for 121 frames of 640², 1 GB for 122
   of 1440² — deleted as soon as it is keyed), the plate is measured on 8
   frames spread over it, and every frame is un-mixed in JS and written as PNG
   in batches of at most 256 MB. No despill runs: the un-mix already took the plate out of the
   edge, and it leaves every pixel without the plate's hue exactly as it was.
   Then every pixel under the alpha threshold has its RGB zeroed — the same
   rule `key` and `from-video` apply, because transparency is all four bytes.

   **Why `despill` is no longer the default.** ffmpeg 8.0's
   `despill=type=green:mix=0.6:expand=0.5` subtracts `G − (0.6·R + 0.2·B)` from
   green wherever that is positive — which is every neutral pixel, not just the
   rim. White comes out `(255,204,255)`, grey 128 `(128,102,128)`, skin and
   yellow pink or salmon: on tanka's ten loops it moved the body's colour by
   7.7–12.0 ΔE00 and turned the yellow fur salmon, and on the synthetic set it
   changed 71 % of the interior (see Measured at the end). It also turns the
   dark-green rim pixel `(0,145,0)` black at whatever alpha the key left it
   (148 against a pure-green key) — the loop's dark rim.

   `--keyer colorkey` keeps the previous chain — `colorkey`, then `despill`:

   **The order is the opposite of the intuitive one, and it was measured.**
   Despilling first recolours the plate, so the colour measured on frame 0's
   corners no longer matches the pixels it is aimed at and the key misses:
   on a real Seedance clip (2026-09-22) the plate came out **opaque and nearly
   black**, with no error and no warning. Keying first and despilling the
   remainder is also what removes the **1–2 px green fringe** a plain key
   leaves on a soft 3D edge at 640² — which is why `--despill` is on by default
   in that chain and why a loop cannot rely on the sprite path's "it disappears
   when you downscale": a loop is rendered at the size it was cut at. A VEED
   matte read back with `--key alpha` (`video-preview.md`) remains the paid
   alternative; the free path is now `--keyer unmix`.
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
6. **Seam.** `seam = D(lastKept, first)` against `step` (the median of `D`
   between neighbours) and `maxStep`, where **`D` is the mean `|a−b|` of two
   frames' premultiplied RGBA** on 96 px thumbnails — colour, so a blink or a
   swapped leg at the wrap counts where a silhouette saw nothing (the holds in
   step 5 are still read on silhouettes). This is the number a loop lives or
   dies on, and it is printed whether or not it trips the warning. **A loop
   closes when `seam ≤ seamLimit`, `seamLimit = max(2·step, 0.005)`**: two
   normal steps, or a noise floor when that is larger. The floor is
   sprite-gen's `PIN_NOISE_MAX` ("a re-rendered first frame lands within this
   of its source") and it is what a near-still loop needs: tanka's idle wraps
   at 0.0021 against a step of 0.0004 — five steps of fur-texture noise, the
   same pose to the eye — and without the floor it was "fixed" with four
   interpolated frames. The run records the bar it used as `seamLimit`, and
   the viewer and `sprite-project.mjs show` read that rather than
   re-deriving a rule (a loop cut before `seamLimit` existed is judged by the
   `seam ≤ 2·step` its run used). `video-preview.md`, "Measured: cycle
   analysis", has the numbers.

   The floor is in `D` units — a mean over the whole clip frame — so it
   forgives more when the character fills less of the frame: 0.005 is a mean
   difference of about 1.4 % of full scale (≈ 4/255) per channel inside a
   subject covering 35 % of the frame (every clip it was measured on), and
   5 % (≈ 13/255) inside one covering a tenth. Shoot the character large in
   the frame.

   **Filling the seam** (`--seam-fill`, default `auto`). When `seam > seamLimit`,
   `auto` interpolates `N = min(4, ceil(seam/step) − 1)` in-between frames at
   the wrap with ffmpeg `minterpolate` and **appends** them after the last
   frame, so the loop grows by N frames: `duration` grows by `N/fps` and those
   frames carry `sampledAt: null` — they were never sampled from anything.
   `seam` is then re-measured as the largest step across the filled wrap, and
   the warning is re-evaluated against it. `inspect.json` and the run summary
   carry `"seamFill": N` (**0** when nothing was filled). On the flame trial
   clip that came to N = 3; on tanka's ten loops it fires on one, the walk
   (a real 0.0079 wrap against a 0.0031 step), where the silhouette rule
   without the floor fired on six. `none` turns it off and leaves the seam as measured;
   `<N>` forces a count. It closes a seam that is *nearly* closed — four
   frames cannot invent the way back from a pose the clip never returned to,
   which is still a reshoot.
7. **Crop and scale.** The union of every kept frame's alpha bounding box, plus
   `--pad`, as **one** rectangle applied identically to every frame — a
   per-frame crop would silently re-centre the motion, which is the one thing a
   loop must not do. `--width` then scales in premultiplied space, so soft
   edges do not darken.

   The report records both: **`crop`** `{ x, y, w, h }` is that rectangle in
   clip pixels and **`scale`** is frame pixels per clip pixel (the width
   ratio), so frame px = (clip px − crop.xy) × scale. Every clip is cropped to
   its own box before the one width, so the same character comes out at a
   different scale in each loop — tanka's ten at 1.03–1.42× their clips — and
   anything that plays loops together (the `.riv`) divides this back out.
   `register-run` copies both into the sidecar's `inspect`.

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
   cutting a large clip rather than after it fills the disk. With `--keyer
   unmix` the raw window step 4 keys from comes on top, briefly and at the
   clip's own size whatever `--width` says: about 1 GB more for that clip.
   A raw window over 4 GiB, or more than the free space beside the output
   less 512 MiB, is refused before a byte is decoded; narrow the window
   (`--trim-start` / `--trim-end`) or key with `--keyer colorkey`.
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
{ "kind": "loop", "frameCount": 96, "cell": { "width": 512, "height": 592 },
  "crop": { "x": 64, "y": 48, "w": 434, "h": 502 }, "scale": 1.1797, "widthDefaulted": true,
  "fps": 24, "duration": 4.0, "seam": 0.0025, "step": 0.0036, "maxStep": 0.107,
  "seamLimit": 0.0072, "seamFill": 0, "alphaCoverage": 0.31, "keyColor": "#08f00d",
  "keyResidue": 0, "keyResidueEdge": 0, "emptyFrames": [],
  "dropped": { "leading": 0, "trailing": 1 },
  "exports": { "webp": 1843201, "apng": 9120033, "webm": 612330, "lottie": 12400021 },
  "warnings": [] }
```

No `anchorDrift`, `bodyDrift`, `maxJump` or `scaleDrift`: a loop is not judged
on any of them, and a number nobody judges is noise on the stage. What replaces
them is `seam` read against `seamLimit` — tanka's celebrate (above) wraps at
0.0025 against a step of 0.0036, under one normal frame. (Loops cut before
2026-09-27 carry silhouette numbers here, in other units — compare a seam
only with its own step — and no `seamLimit`.)

| Warning | Trigger | What to do |
|---|---|---|
| "the loop does not close — the last frame is 0.0659 from the first against a normal step of 0.0056 (it closes at 0.0112)" | `seam > seamLimit`, re-checked **after** `--seam-fill` | Shoot again with the same image at both ends, or pass `--trim-start` / `--trim-end` read off the contact sheet. Filling the wrap closes a near miss; it cannot invent a return the clip never made |
| "was it shot on a flat plate?" | `alphaCoverage > 0.9` after keying | The key did nothing — the plate is not flat, or `--key` names the wrong colour. Check `keyColor` against the contact sheet |
| "keyResidue 0.0158: …% of the visible pixels still carry the plate's hue …" | `keyResidue > 0.005`, measured on the frames the loop ships (after crop and scale) | As in `inspect`. Note that `--keyer colorkey` with `--despill` reads near 0 here because despill removes the green by recolouring everything — look at the frames, not only the number |
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
  "keyColor": "#08f00d", "keyer": "unmix", "alphaCoverage": 0.31,
  "cell": { "width": 512, "height": 592 },
  "crop": { "x": 64, "y": 48, "w": 434, "h": 502 }, "scale": 1.1797, "widthDefaulted": true,
  "webp": "<abs>/loop.webp", "apng": "<abs>/loop.apng", "webm": "<abs>/loop.webm",
  "lottie": "<abs>/loop.json", "inspect": { "…": "as above" }, "warnings": [] }
```

`sampledAt[i]` is the source timestamp of frame `i` — after interpolation,
`i / N` from the window start, and **`null`** for a frame `--seam-fill` added
at the wrap, which was sampled from nothing. There is no `sheet`, `atlas`, `gif` or `cells`
key, and `register-run` does not ask for them on a run whose `kind` is `loop`.
As with `from-video`, the clip is only ever read: it is already an asset, and
the frames' provenance points at it.

### `transition <clip> --character <dir> --from <loopId> --to <loopId> [flags]`

The clip between two loops, for a `.riv` (SKILL.md workflow F): a first-last
take from `--from`'s keyframe plate to `--to`'s, cut so it starts on the one
loop's frame 0 and ends on the other's. Both must be **ready loops** of the
character, and not the same one. Written to
`<character>/motions/<from>-to-<to>/frames/NNN.png` (`--out`, `--name`
override) with an `inspect.json`; `--json` is what `register-run` takes.

It shares `loop`'s whole cutting path — the same decode, key, crop and scale
code (`prepareClip` → `decodeClipFrames` → `cutClipFrames`), picked over a
one-shot mode inside `loop` because a transition asks a different question of
the frames and has different flags (no seam, no seam fill, no exports) — so:

- **One decode.** Every frame of the window is decoded once. `--key alpha`
  reads a matted clip's own alpha (the `veed-gs` matte of step 5); `auto` /
  `#rrggbb` key a green plate with `--keyer` (default `unmix`) and
  `--similarity` — or `colorkey` with `--blend` and the despill — exactly as
  `loop`, `keyResidue` included. `--key none` is refused: a transition is
  placed by its silhouette.
- **Holds, both ends** (`--trim-holds`, default on). A first-last take waits
  on each keyframe; leading frames that are the first pose and trailing
  frames that are the last collapse to one of each. "The same pose" is a step
  under a quarter of the upper-quartile step — the upper quartile rather than
  the median, because a take can spend half its length holding and its median
  step is then a hold. `dropped: { leading, trailing }` says how many went.
  `--trim-start` / `--trim-end` (seconds) cut the window first.
- **`--duration s`** retimes to the length it should play: `k = max(2,
  round(s × fps))` frames at `round(i × (n − 1) / (k − 1))` — evenly spread,
  the first and last frame always kept (`retime: { from, to }`). A duration
  longer than the movement keeps every frame and says so; nothing is
  stretched. The rate stays the clip's.
- **Crop and scale recorded**, as `loop` does: one union crop over the kept
  frames plus `--pad`, drawn `--width` wide (default 512, `widthDefaulted`),
  `crop` and `scale` in the report and `inspect.json`, so the frames sit in
  clip coordinates beside the loops.
- **Does it land?** `step` is the median silhouette distance (1 − alpha IoU)
  between consecutive kept frames. `startGap` is the first frame against
  `--from`'s registered frame 0 and `endGap` the last against `--to`'s, both
  placed in clip coordinates (each loop's recorded, stored or measured clip
  scale and origin) and drawn at one analysis scale. A gap of at most
  **2 · step** lands — the same factor as a loop's seam. Past it, a warning names
  the end and the free remedy (`--trim-start` / `--trim-end`) before the paid
  one (a new take from that keyframe). A loop whose place in its clip is
  unknown leaves that gap `null`, with a warning.

  **The joins stay silhouette, with no noise floor**, on purpose: a loop's
  seam compares one clip with itself, a join compares two separately
  rendered clips, and their fur texture and shading differ where the pose
  does not. Measured 2026-09-27 on tanka-connect's four transitions,
  premultiplied colour (the loop's `D`) put `idle-to-reading`'s end at 0.0154
  against a limit of 0.0135 — "does not land" — on two frames that are the
  same pose; the silhouette gap, 0.0083 against 0.0194, lands, as the eye
  does. And `loop`'s 0.005 floor is in colour units, which do not carry over
  to a silhouette gap. Colour-aware joins wait for a measure that sees pose
  inside the silhouette without seeing texture (`lineup`'s `chroma` is a
  candidate).

`--reverse-of <transitionId>` makes the way back, free: the registered frames
of that transition copied in reverse order into
`motions/<to>-to-<from>/frames/`, with its crop, scale and rate, and its own
ends measured again against the loops it now joins (they come out as the
source's gaps swapped). No clip is read. `register-run` records it with
`reverseOf` and one `derive` edge per frame from the source frame it plays.

tanka's idle → coffee (2026-09-24): a 4 s take that bent down, picked the mug
up off the floor and straightened up in 1.7 s, then held the last pose for
2.1 s — 5 frames dropped at the start, 51 at the end, 41 kept and sampled to
29 for its 1.2 s brief:

```json
{ "kind": "transition", "source": "video", "video": "<abs>/motions/idle-to-coffee/video-veed-2.webm",
  "from": "idle", "to": "coffee", "motionDir": "<abs>/motions/idle-to-coffee", "name": "idle-to-coffee",
  "frames": ["<abs>/motions/idle-to-coffee/frames/000.png", "… 29 in all"],
  "sampledAt": [0.208, 0.25, 0.333, "…", 1.875],
  "fps": 24, "duration": 1.208, "trim": { "start": 0, "end": 4.041 },
  "dropped": { "leading": 5, "trailing": 51 }, "retime": { "from": 41, "to": 29 },
  "alphaCoverage": 0.304, "cell": { "width": 444, "height": 586 },
  "crop": { "x": 87, "y": 54, "w": 444, "h": 586 }, "scale": 1,
  "inspect": { "kind": "transition", "frameCount": 29, "step": 0.03,
               "startGap": 0.009, "endGap": 0.0184, "…": "…" },
  "warnings": [] }
```

### `mirror <character>/motions/<of> --name <id> [--out <dir>] [--force]`

The other side of a side view, free: a character facing right gets its
left-facing motion without a second generation (the top-down route's
"mirrored side"). `<of>`'s **registered** frames are flipped left to right
with ffmpeg's `hflip` — a pure reorder of pixels, so every RGBA value
survives exactly — and then finished the way `run` finishes a sheet:
`pack` → `gif` (+ `webp`) → `inspect`, with `<of>`'s atlas fps, loop,
anchor, scale and columns. A scaled atlas is repacked with the filter it was
packed with — `pack` records it as `meta.filter` (`nearest` / `smooth`); an
atlas from before that falls back to nearest for a pixel-art character
(`character.pixel` / the style), which used to repack a `--nearest`
non-pixel source smooth. Written to `--out`, default
`<character>/motions/<id>`; `--json` is a sprite run summary plus
`source: "mirror"`, `mirrorOf` and `direction`, with `grid` (the rows and
columns the mirror's atlas was packed on — the grid the stage plays it
with), `fps`, `loop` and `anchor`, which `register-run` takes as it is. Its
`inspect` measures `keyResidue` against the plate `<of>` was keyed off (the
`keyColor` of `<of>`'s `inspect.json`; a flip keeps every colour) and never
takes a `keyColor` from an `inspect.json` left in a reused `--out`. A
planned mirror needs no grid, fps or loop — it plays on its source's, and
`register-run` takes them from the run:

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> --id walk-left \
  --source mirror --direction left --json
node {SKILL_PATH}/scripts/sprite-sheet.mjs mirror <character>/motions/walk-right --name walk-left --json \
  | node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion walk-left --run - --json
```

- **The anchor lands at `cell.width − x`**, y unchanged — in the frames'
  `align.json` (which also names `mirrorOf`) and so in the atlas pivot and
  `meta.anchorPoint`. The point is taken from the source's **atlas**, the
  authority every export reads; its `align.json` lends `pad`, `smooth`,
  `xFrom` (and a `--y-from cell` source's `yFrom`, `lift` and `ground`, which
  a horizontal flip does not change) when it describes the same point, and its pixel lattice
  (`pixel`: scale, pitch, palette) whenever it describes frames of the same
  size — a flip about a cell a whole number of blocks wide keeps every block
  on the grid, so `inspect` checks the mirror against the source's lattice
  and palette (`inspect.pixel.held`). Its `drift` record is not lent: a
  signed measurement of the source's clip, which the mirror did not take. A source whose record is
  gone still flips its measured point (`"from": "atlas"`): the Lumi seed
  ships atlases without `frames/align.json`, and before this the mirror
  fell back to the `{0.5, 1}` default where idle ships `{0.5, 0.9683}`.
  `align` centres the anchor, so for frames it aligned the pivot's x is 0.5
  on both sides; anything anchored off-centre keeps its true point.
- **Cells:** when `<of>` kept its pre-align cells (`run`, `from-video`),
  they are flipped into `<id>/cells/` too, so `inspect` judges clipping on
  them and `inspect <id>` reproduces the report. What made those cells goes
  with them: `slice.json` (the grid, so a row boundary is told from a step)
  and a breathe's `breathe.json` (so a mirrored breathe's planned holds are
  listed but not called a drawing the model repeated). A flip keeps every
  measurement: drift, jump, scale drift and clipping read the same as the
  source's. A `cells/` left in `--out` by an earlier run of `<id>` goes.
- **Refused, before anything is written:** `<of>` not ready, a loop, a
  transition, declared or registered as a mirror itself, facing front or
  back, or facing nothing yet (`set-motion --direction` first); `--name`
  equal to `<of>`; an `--out` that is `<of>`'s own directory.
- **Asymmetric characters.** When `character.asymmetric` holds a sentence
  ("the red clover hairpin sits on the right side of her head"), a flip
  moves exactly that to the other side in every frame, so `mirror` refuses
  and says the sentence back, pointing at the direction-anchor route
  (`prompting.md`, *Direction anchors*). `--force` makes the mirror anyway,
  keeps the sentence in `warnings` and `asymmetric`, adds `"force": true` to
  the summary, and leaves the verdict to the user looking at the stage.
  `register-run` refuses a mirror of an asymmetric character whose summary
  does not carry `"force": true`, so the lock holds whichever way the
  summary reaches it. To draw that side instead, keep the planned motion and
  change how it gets its frames: `set-motion --motion walk-left --source
  sheet`, then `sheet-prompt` (which refuses a planned mirror) writes its
  prompt with the row's `sides[d]` sentence.
- **Stale mirrors.** Running `<of>` again leaves the mirror showing the old
  frames: `register-run` notes it, `show` lists it under `staleMirrors` and
  names this command (`mirror <character>/motions/<of> --name <id>`), and
  the fix is that plus `register-run` again. When `<of>` is gone, `show`
  says there is nothing to mirror it from again.
- **Colourways are per motion.** A mirror of a recoloured motion carries
  none (`show` lists it under `variantsMissing`, the Export tab offers no
  colourway row for it) until `recolor` runs on it — with the recorded
  colourways, no `--map` needed. The swap is per pixel, so its colourway is
  the source's flipped, on the mirror's own pivot. Re-running `<of>` retires
  `<of>`'s colourway files and notes the stale mirror; the mirror's own
  colourway files go when it is mirrored and registered again.
- **In a `.riv`,** a current mirror whose source is in the file embeds
  nothing: it shows the source's images flipped (see `rive`).

Lumi (2026-09-27, the seed's idle and attack given `--direction right`):
16 frames each in 4.1 s / 6.3 s wall; every frame the exact horizontal flip
of its source (0 of 2,999,808 idle bytes differ); pivot `{0.5, 0.9683}` and
`meta.anchorPoint {93, 244}` carried from idle's atlas; `inspect` identical
to the source's (attack: anchor drift 17.373 px, body drift 0.263, max jump
50, scale drift 0.126 on both sides). With Lumi's asymmetric sentence
recorded the call is refused; forced, every frame carries the hairpin on her
left side, which is why the gate is there.

### `lineup <characterDir> [--hub <loopId>] [--out <png>]`

Look before paying for transitions. Every **ready loop**'s frame 0 beside the
hub's — the hub is `--hub`, else the looping idle, else the first loop, the
same rule `rive` uses — each at its clip's scale and placed in clip
coordinates, drawn on one canvas at one scale with the hub's floor across
every panel, written to `<character>/lineup.png` and labelled with the motion
ids (without labels, and said, when ffmpeg's `drawtext` cannot run). Writes
nothing to project.json.

Per loop: `scale` and `scaleFrom` (`recorded` / `measured`) and `origin`;
`poseGap` to the hub — `iou` (soft alpha overlap), `gap` = 1 − iou, `rgb`
(mean colour difference inside the union) and `chroma` (mean chromaticity
difference where both are opaque: it ignores shading and fur, and sees where
the arms lie across the body and whether a mug is in hand); `closestFrame`,
the loop frame nearest the hub pose (data only — `rive` leaves a loop at its
cycle end, which is frame 0); the ready `transitions` already registered for
the pair, either way; and a `suggestion`, **`direct`** when `iou ≥ 0.87` and
`chroma ≤ 0.085`, else **`transition`**, with the rule in `threshold`.

**The threshold, calibrated on tanka (2026-09-24)** — ten loops of one plush
mascot, each shot from its own keyframe; idle is the hub, and walk is the only
loop whose opening pose stands the way idle does:

| loop | iou | chroma | rgb | pose | suggestion |
|---|---|---|---|---|---|
| walk | 0.876 | 0.069 | 0.146 | standing, arms down | direct |
| coffee | 0.910 | 0.097 | 0.139 | standing, mug in both paws | transition |
| thinking | 0.857 | 0.079 | 0.170 | standing, paw at the chin | transition |
| wave | 0.830 | 0.050 | 0.160 | standing, one arm up | transition |
| celebrate | 0.819 | 0.058 | 0.180 | standing, both arms up | transition |
| dance | 0.729 | 0.079 | 0.255 | one leg lifted | transition |
| reading | 0.794 | 0.154 | 0.279 | sitting, tablet | transition |
| typing | 0.751 | 0.189 | 0.308 | sitting, laptop | transition |
| sleep | 0.750 | 0.138 | 0.270 | sitting, eyes closed | transition |

Neither number separates them alone: coffee has the best silhouette overlap
(the mug sits inside the body's outline) and wave the lowest chroma (the arm
is outside it). `rgb` was tried and dropped — it put coffee (0.139) nearer
idle than walk (0.146). The margins are thin (walk passes the overlap bar by
0.006), so the suggestion is a starting point for looking at `lineup.png`, not
a verdict.

### `sizes <characterDir> [--motions id,id,…] [--out <png>] [--threshold 16]`

Is the character one size across its motions? `inspect`'s `scaleDrift` is the
spread **inside** one motion and says nothing about this — blind trial G-4dir
claimed "the sizes differ at most 2.8 % across the set" from the largest
within-motion `scaleDrift` while its front walk stood 480 px and its right
walk 456.5 px. Run this before saying a set is one size.

Every ready sprite motion (loops and transitions are `lineup`'s), or the ones
`--motions` names (at least two), is measured on its registered frames: a
looping motion stands at the median of its frames' solid-alpha bbox heights,
a one-shot (an attack, a jump) at its **first** frame — it starts from the
rest pose and spends the rest crouched or stretched — times its atlas scale:
the height it ships at. The JSON gives per motion `height { standing, from,
median, min, max, first, scale, shipped }` and `heights` per frame; for the
set `spread` (tallest ÷ shortest − 1), `tallest`, `shortest`, `reference`
(the median of the shipped heights) and `scaleToMatch` per motion (what its
shipped height would be multiplied by to meet the reference). Over 3.5 % it
warns, naming both motions; pixel art is warned only past two logical pixels
(each height is quantised to a block). It writes `<character>/sizes.png` (or
`--out`): each motion's measured frame at shipped scale, cropped to its
figure, feet on one orange baseline, the reference height a grey line.
Reads `project.json`, writes nothing to it. Numbers in "Measured: slicing,
lift and sizes".

### `export <motionDir> --format mp4|mov|webm|apng|lottie|png-seq|aseprite [--bg #rrggbb] [--repeat N] [--scale N] [--shadow …]`
### `export <characterDir> --format aseprite [--scale N] [--shadow …]`

One **ready** motion in a format somebody else's tool reads. It reads
`project.json` (never writes it) and refuses a motion whose status is not
`ready`, or whose `frames/` on disk are not the frames registered — "register
the run … before exporting". Registration is the separate
`sprite-project.mjs register-export` step below.

| `--format` | File | What it is |
|---|---|---|
| `mp4` | `exports/<id>.mp4` | H.264 `yuv420p`, flattened onto `--bg` (default `#ffffff`) — no alpha |
| `mov` | `exports/<id>.mov` | ProRes 4444, `yuva444p10le`: keeps alpha, for editing software |
| `webm` | `exports/<id>.webm` | VP9 `yuva420p` with `alpha_mode=1` (`-auto-alt-ref 0`, as `loop.webm`) |
| `apng` | `exports/<id>.apng` | every frame once; plays forever when the motion loops, once when not |
| `lottie` | `exports/<id>.json` | the loop writer's raster image sequence, one layer per frame |
| `png-seq` | `exports/<id>-frames.zip` | a **stored** zip (PNG is already compressed) of `<id>/NN.png` plus `<id>/animation.json` |
| `aseprite` | `exports/<id>-aseprite.zip` | a stored zip of `<id>/<id>.png` — the motion's packed `sheet.png`, byte for byte at `--scale 1` — and `<id>/<id>.json`, the same sheet described in Aseprite's JSON-hash shape (below). A sprite motion only: a loop or transition has no sheet |

`exports/` is inside the motion directory (`lumi/motions/attack/exports/`).

**The whole character** — `export <characterDir> --format aseprite` (the
directory that holds `project.json`; any other format there is refused and
pointed at the motion, or at `rive`): every **ready sprite motion**, in rail
order, on one sheet — their packed sheets stacked top to bottom, left-aligned,
each keeping its atlas rects offset by its row — with one frame tag per motion,
as `<characterDir>/exports/<character>-aseprite.zip`
(`<character>/<character>.png` + `<character>/<character>.json`). Loops,
transitions and unfinished motions are left out and listed in `excluded[]`
with the reason, as `rive` leaves loops out. Motions packed at different
`pack --scale` are warned about (the character changes size between tags); a
sheet past 4096 px on a side is warned about too (many phones and some WebGL
contexts cannot load it as one texture). Registration files it on the
character, like the `.riv`.

The Aseprite JSON (ported from aldegad/sprite-gen `compose/export_aseprite.py`,
Apache-2.0 — the shape; our rects come from the atlas):

```json
{ "frames": {
    "0": { "frame": { "x": 0, "y": 0, "w": 186, "h": 252 }, "rotated": false, "trimmed": false,
           "spriteSourceSize": { "x": 0, "y": 0, "w": 186, "h": 252 }, "sourceSize": { "w": 186, "h": 252 },
           "duration": 125, "anchor": { "x": 0.5, "y": 0.9683 }, "pivot": { "x": 0.5, "y": 0.9683 } },
    "…": {} },
  "meta": { "app": "pneuma-sprite", "version": "1", "image": "lumi.png", "format": "RGBA8888",
            "size": { "w": 1088, "h": 2056 }, "scale": "1",
            "frameTags": [ { "name": "idle", "from": 0, "to": 15, "direction": "forward" },
                           { "name": "attack", "from": 16, "to": 31, "direction": "forward" } ] } }
```

- Frames are keyed by their **global** playback index `"0"…"N-1"` and each
  carries its own `duration` in ms (the atlas's). Phaser's
  `anims.createFromAseprite(key)` walks each tag's `from..to`, looks every
  frame up as `frames[String(i)]`, and uses that duration — so
  `this.load.aseprite('lumi', 'lumi.png', 'lumi.json');
  this.anims.createFromAseprite('lumi'); sprite.play({ key: 'idle', repeat: -1 })`
  is the whole setup. Loop policy is not in the file (Aseprite tags carry a
  range and a direction); pass `repeat: -1` for a looping motion.
- Each frame's `anchor` (and `pivot`, the same point) is the atlas pivot:
  Phaser's hash parser turns `anchor || pivot` into the frame's origin, so the
  sprite's position IS where the feet stand, in every tag.
- The hash form is also what Flame's `SpriteAnimation.fromAsepriteData` reads
  (it wants `frames` as a map and ignores tags): use a **per-motion** export,
  whose indices start at 0.

- **Which frames, at which rate.** A sprite motion plays its aligned
  `frames/NN.png` at the **atlas** fps, and its per-frame `duration` and
  `pivot` come from `atlas.json`. A loop plays `frames/NNN.png` at its own fps.
- **`--repeat N`** — video formats only: the frames are played N times. The
  default is stated in the report (`repeatDefaulted: true`): a looping motion
  repeats until the clip lasts at least 3 s (`ceil(3 / (frames / fps))`), a
  one-shot plays once. On a frame animation it is reported as ignored.
- **`--scale N`** — an integer, default 1, always nearest-neighbour, so pixel
  art and hard edges survive. The pivot in `animation.json` scales with it.
- **`--bg #rrggbb`** — MP4 only. On every other format it is **reported as
  ignored** in `warnings[]`, never applied and never an error: the caller asked
  for it, the format has alpha, and saying so is the useful answer. A word
  (`white`) is refused; `#rgb` is not a `#rrggbb`.
- **`--shadow`** — a ground shadow cast from the frame's own silhouette about
  the foot: the alpha is projected `x' = x + shear·(y − ay)`,
  `y' = ay + squash·(y − ay)` about the anchor `(ax, ay)`, bicubic-sampled,
  Gaussian-blurred and multiplied by the opacity (ported from
  aldegad/sprite-gen `effects/shadow.py`, Apache-2.0, with its defaults:
  `--shadow-squash 0.25`, `--shadow-shear 0.8` — positive falls **left**, a
  negative one is written `--shadow-shear=-0.5` — `--shadow-opacity 0.4`,
  `--shadow-blur 3` px, `--shadow-color #140f1e`). The anchor is the atlas
  pivot for a sprite motion, and a loop's or transition's first frame's feet
  (the point the `.riv` stands it on) — reported as `shadow.from`
  `"atlas"` / `"feet"`.
  - **mp4 / mov / webm**: cast INTO the frames, behind the figure. The canvas
    grows to hold the whole projection (from the frame rectangle, never a
    per-frame alpha box, so every frame is the same size) — Lumi attack goes
    from 272×262 to 520×272 with the figure at x = 222 — and the report gives
    the new `width` / `height` and `shadow.anchor`, the foot in the video's
    frame. A loop's own `loop.webm` is its deliverable, so a shadowed WebM of
    a loop is refused and pointed at `mov` (keeps the alpha) or `mp4`.
  - **aseprite**: a **separate** shadow sheet for the engine to place itself
    — `<name>-shadow.png` + `<name>-shadow.json` in the same zip, frame for
    frame with the sprite (same durations), tags named `<motion>-shadow` (an
    engine's animation names can be global — Phaser refuses a second `idle`),
    each shadow frame's `anchor` on the same foot. Put the shadow sprite at the
    character's position, one depth below, and play `<motion>-shadow` with
    `<motion>`.
  - Any other format: **reported as ignored**. A tuning flag without
    `--shadow` is refused, and so is a value outside upstream's ranges
    (squash 0.001–1, shear −16–16, opacity 0–1, blur 0–128).
- **Even sides.** H.264 and VP9 4:2:0 need even dimensions, so an odd side gets
  one transparent column or row on the right / bottom — the pivot does not
  move. The report says so in `padded`.
- **Verified before it is named.** Every export is written to a scratch file
  beside the destination and renamed only after it checks out. A video is
  probed with `ffprobe -count_frames`: codec, pixel format with alpha where it
  is claimed (`yuva…` for MOV, `alpha_mode=1` for WebM), frame count =
  frames × repeat, and duration. Any mismatch is an `ERROR:` and the old file,
  if there was one, is untouched. An APNG's frame count is checked the same way.
- **Refusals**, each with nothing written: an unknown format; a motion that is
  not ready; frames that do not match the registration; a file the motion
  **already ships** — a sprite motion's GIF / WebP / sheet + atlas, a loop's
  own WebP / APNG / WebM / Lottie (the refusal names the file it already is);
  a loop as GIF (1-bit alpha, hundreds of frames) or as an atlas (a loop is a
  sequence); an ffmpeg build without the encoder the format needs.

**`--json`** is what `register-export` consumes:

```json
{ "kind": "export", "scope": "motion", "character": "<abs>", "motion": "attack", "motionKind": "sprite",
  "format": "mp4", "out": "<abs>/motions/attack/exports/attack.mp4",
  "frames": ["<abs>/motions/attack/frames/00.png", "…"], "frameCount": 12,
  "fps": 12, "loop": false, "scale": 1, "width": 188, "height": 250,
  "repeat": 1, "repeatDefaulted": true, "background": "#ffffff",
  "padded": { "width": 1, "height": 0 }, "duration": 1.0,
  "probe": { "codec": "h264", "pixFmt": "yuv420p", "alpha": false, "frames": 12, "duration": 1.0 },
  "shadow": null,
  "size": 48213, "notes": ["MP4 has no alpha: the frames are flattened onto #ffffff"],
  "warnings": [] }
```

`repeatDefaulted`, `padded` and `probe.pixFmt` are on video formats only;
`entries` (the number of files in the zip) on `png-seq` and `aseprite`.
`background` is null except on MP4. `shadow` is null unless one was cast:
`{ squash, shear, opacity, blur, color, from }`, plus `anchor` on a video and
`sheet: { w, h }` (the shadow sheet) on an Aseprite export. An Aseprite export
also carries `sheet: { w, h }` and `tags: [{ name, from, to }]`.

The whole character's report has `"scope": "character"`, no `motion`, and:
`name`, `motions: [{ id, frames, fps, loop, from, to, atlasScale }]`,
`excluded: [{ motion, reason }]`, `frames` (every registered frame of every
motion on the sheet, in order — what `register-export` checks), `frameCount`,
`scale`, `sheet`, `tags`, `shadow`, `entries`, `size`, `notes`, `warnings`.

`animation.json`, inside the PNG-sequence zip:

```json
{ "app": "pneuma-sprite", "version": 1, "name": "attack", "kind": "sprite",
  "fps": 12, "loop": false, "size": { "w": 188, "h": 250 }, "scale": 1,
  "pivot": { "x": 0.5, "y": 0.968 }, "anchorPoint": { "x": 94, "y": 242 },
  "frames": [ { "file": "00.png", "duration": 83 }, "…" ] }
```

`pivot` is the atlas pivot (normalized), `anchorPoint` the same point in
pixels (scaled by `--scale`; null when the frames carried no `align.json`),
and each frame's `duration` is in ms. A loop has no pivot: both are `null`,
and `kind` is `"loop"`.

**Measured (2026-09-27, Lumi seed and tanka walk, ffmpeg 8.0, M-series mac).**

| What | Result |
|---|---|
| Shadow port vs upstream `project_shadow` (Pillow 12.3.0) on Lumi attack frame 05, 272×262, foot (136, 254) | same canvas 519×97 and anchor (358, 79); at blur 0 **0 differing pixels** (36,135 at shear 0.8, 49,713 at −1.5); at the default blur 3, max \|Δα\| 2/255, mean 0.093, alpha mass ratio 0.9999 — the Gaussian against Pillow's three-box approximation |
| Lumi attack → mp4 | 0.42 s; with `--shadow` 0.60 s, 272×262 → 520×272 |
| tanka walk, 242 frames of 512×566 → mov | 1.8 s; with `--shadow` 7.2 s, 1004×570 (shear 0.8 on a 566 px figure throws the head's shadow ~450 px left) |
| Lumi whole character → aseprite | 32 frames, idle 0–15 + attack 16–31 on 1088×2056, 1.44 MB, 0.6 s; with `--shadow` 0.8 s, shadow sheet 2076×768 |
| Phaser 4.2.1 and 3.90.0, `load.aseprite` + `anims.createFromAseprite` on that zip (headless Chrome) | `idle` 16 × 125 ms, `attack` 16 × 100 ms, `idle-shadow` / `attack-shadow` built; at four sampled times every frame's pivot pixel landed on the baseline (y = 430 of 430) |
| PixiJS 8.21.0 `Spritesheet` | the seed atlas (pivot only): `Sprite.anchor` (0, 0); a current pack: (0.5, 0.9683) on all 16 frames; the Aseprite JSON parses with its anchors |

### `rive <characterDir> [--motions id,…] [--include-loops] [--hub id] [--fps N] [--max-size N] [--filter auto|smooth|nearest] [--images webp|webp-lossless|png]`

The whole character as `<characterDir>/exports/<character>.riv`, encoded by
the zero-dependency writer in `scripts/rive.mjs`, planned by
`scripts/rive-plan.mjs`, and validated against the official
`@rive-app/canvas` runtime (2.43.1).

- **Which motions:** by default every **ready sprite motion**, in rail order.
  Loops go in when asked: `--include-loops` adds every ready loop and every
  ready transition (still in rail order); `--motions idle,wave` names exactly
  which motions go in, loops or not, **in that order** — `--include-loops` is
  then ignored with a warning. A transition goes in only with **both** loops
  it joins: left out with the reason under `--include-loops` when one is not
  going in, refused by name when `--motions` names it without them. A named
  motion that does not exist, is not ready, or is named twice is refused.
  Everything left out is in `excluded[]` with its reason.
- **Why loops are resampled:** every Rive runtime decodes every embedded image
  when the file LOADS — Σ frames × width × height × 4, paid up front whichever
  motion plays — and a loop is cut at its clip's rate and width: tanka's are
  230-300 frames of 512 px at 60 fps, about 90 MB each as they are.
- **Rate, `--fps N`** (loops default **24**; sprite motions keep their atlas
  fps unless it is given). A motion keeps `round(count × fps / sourceFps)`
  frames — the same duration. A loop takes source frame `floor(i × count /
  kept)`: frame 0 first, evenly spread, and the step from the last kept frame
  back to frame 0 is one of the steps the loop takes anyway, so it stays
  seamless (the loop's own last frame is already one step short of its
  first). A one-shot takes `round(i × (count − 1) / (kept − 1))`, which keeps
  its last pose. A rate at or above the motion's own keeps every frame —
  nothing is sped up by repeating frames. The kept indices are in the report
  (`indices`) whenever frames were dropped.
- **Size, `--max-size N`** (the longest edge; loops default **320**; sprite
  motions keep their size unless it is given). One factor per kind — all the
  loops shrink by the same factor, chosen so the largest fits, and the sprite
  motions by theirs — so the character keeps its relative size from motion to
  motion. Nothing is enlarged past the frames as cut.
- **Transitions** are sampled with the loops (their rate, their factor) and
  keep their first and last frame. A **reverse** (`reverseOf`) whose source is
  in the file shows the source's embedded images in reverse order — it adds
  no image and no memory (`shares` in its report entry, `estimatedDecodeBytes`
  0; `frameCount` counts embedded images once). A reverse made from an
  earlier cut of its source — the source registered again since — carries its
  own frames instead, with a warning to cut it again.
- **Mirrors** (`source: "mirror"`, made by `mirror`) do the same for a sprite
  motion: when the motion it flips is in the file and it was mirrored from
  that motion's current frames, with the same frame count, size, fps and
  loop, it embeds nothing and shows the source's images flipped — one more
  `Image` per frame over the same asset with `scaleX` −1 about the same
  origin, which is exactly the flipped frame standing on its pivot at
  `width − x` (`shares` and `mirrored: true` in its report entry,
  `estimatedDecodeBytes` 0, a note `walk-left: walk-right's 8 images flipped`).
  Poses for `cuts` are measured on the flipped pixels. A mirror of an earlier
  run of its source carries its own frames, with a warning that names the
  command to mirror it again from its source. Measured on Lumi (2026-09-27): idle + attack is 333,948 bytes and
  7.2 MB decoded; adding their mirrors `idle-left` and `attack-left` makes it
  335,982 bytes and the same 7.2 MB, where embedding `idle-left`'s own frames
  costs 161,743 bytes and 2.9 MB more. In the official runtime
  (`rive-runtime.live.test.ts`) the first frame of a hub mirror differs from
  the flipped frame on disk placed by its pivot by 1.26 (mean alpha + ¼ RGB
  difference, 0–255) and from the unflipped frame by 100.75.
- **Clip scale (loops and transitions):** each loop is cropped to its own union box and scaled
  to the brief's width, so one character is cut at a different scale in each
  loop (tanka's ten: 1.03–1.42× their clips, a 38% spread). With **two loops
  or transitions or more**, each is first divided by its clip scale, so the
  factor is in clip pixels and the character is one size in every state:
  a motion's `scale` in the report is that factor over its clip scale. The
  clip scale and the crop origin are **recorded** by `loop` and `transition`
  (`inspect.scale`, `inspect.crop`). A loop cut before that uses the
  **measured** record an earlier export left on it (`motion.clip`, written by
  `register-export`, so the Export tab quotes the same plan); failing that,
  they are **measured** off the clip: about five frames, spread across the loop, each against the same
  moment of the clip — found through the frame's registered `derive` edge
  (the clip asset and the second it was sampled at; `run.json` is not read) —
  comparing half-coverage (alpha ≥ 128) boxes: height ratio for the scale,
  box corner for the origin, medians. Per-frame scales more than 3% apart,
  a clip that is missing, outside the character, opaque or undecodable: the
  scale is **unknown**, a warning names the loop, and it is drawn as cut and
  stood on its feet. An origin that varies by more than 3 px (or 1% of the
  clip) keeps the scale and stands the loop on its feet, with a warning.
  `clip` in each loop's report is `{ scale, origin: { x, y } | null, from:
  "recorded" | "measured" }`, or null when unknown (and for a lone loop,
  which has nothing to be matched against and is not measured). A recorded
  crop always wins over a measured one, and cutting the loop again clears the
  measured record with the frames it described. tanka's ten,
  measured: rendered body height per clip pixel 0.529–0.533 in every state.
- **Downscale, `--filter`:** `auto` (default) is nearest-neighbour for a
  pixel-art character — `character.pixel` when it is there, else a
  `character.style` that says pixel art (`pixel art`, `8-bit`/`16-bit`,
  `像素`…) — and smooth otherwise: premultiply → `area` → unpremultiply, the chain `loop`
  measured to keep alpha edges free of dark fringes. `smooth` / `nearest`
  force it. The report says which, and what chose: the character's pixel
  spec (`filterFrom: "pixel"`), its style sentence (`"style"`), or the flag.
- **Placement:** every frame is pinned to one shared point of the artboard.
  Loops whose clip scale and origin are known are placed in **clip
  coordinates** (`anchor.from: "clip"`): one point of the clips lands on the
  same point of the artboard in all of them, so each stands where its clip
  put it — what a transition clip shot from one keyframe to the next needs to
  hand over without a jump. Transitions are placed the same way, so their
  first and last frames sit on the loops they join. That point is the feet of
  the hub's (else the first placed loop's) frame 0. A sprite motion is pinned by its
  **atlas pivot** there, and a loop whose place is not known by its **first
  frame's feet** (`feet`: the mean x of the alpha pixels in the bottom tenth
  of the figure, as `align --x-from feet` and `inspect` measure it, and the
  bottom of the figure; `frame` for an empty frame 0). The keyframes are
  drawn independently, so loops placed by their clips do not share one
  footing: tanka's standing loops land within 9–10 px of each other at
  320 px, exactly where their clips put them (within 1.4 px). The artboard
  is the union of every frame around the point.
- **Memory:** `estimatedDecodeBytes` is counted AFTER resampling and scaling,
  per motion and in total (1 MB = 1024 × 1024 bytes). Over **128 MB** the
  report warns; over **768 MB** `rive` refuses before a frame is scaled or a
  byte written (only a legacy loop's clip-scale samples are decoded first), with
  each motion's share and the three ways down: a lower `--fps`, a smaller
  `--max-size`, fewer `--motions`.
- **Structure:** one artboard; one Solo holding every frame as an Image; one
  timeline per motion keying which frame the Solo shows (hold interpolation),
  at the motion's effective fps — an integer rate as-is, anything else re-keyed
  on a 60 fps timeline (`timelineFps`); a loop's timeline loops, a
  transition's and a one-shot's play once.
- **The state machine, `State Machine 1`** (`riveStateMachine` in `rive.mjs`
  builds it as a graph; the file is that graph):
  - **Inputs:** one number, **`motion`**, the loop the character should be
    in — loop *i* of the file, in file order, is value *i*; the mapping is in
    `stateMachine.inputs[0].values` — and one **trigger per one-shot**,
    `play_<motionId>`. A loop is a state the character is IN, reached in one
    or several steps, so it is a value that stays set; a trigger is consumed
    after one step and could not carry that. A file with no loop has no
    number, and its triggers work as before.
  - **The hub** is `--hub <loopId>`, else the looping motion called `idle`
    (`idle-2`, `sword_idle` — never a transition), else the first loop. The
    machine starts there and `motion` starts at its value.
  - **Routing.** Every exit from a loop is on **100 % exit time**, which on a
    looping animation is the end of the cycle it is in: the character never
    leaves a loop mid-cycle. From loop C toward the loop T that `motion`
    names: C→T's transition if one is registered; otherwise, when C is not
    the hub, C→hub's transition; otherwise the hub→T transition, or T itself
    — a **direct cut**. A transition's last frame branches on `motion` the
    same way from the loop it ends on, so it never settles into the hub for a
    whole idle cycle when `motion` already names another loop; with nothing
    else asked it arrives at its own end loop. A one-shot plays at once from
    any state, then cuts to the loop `motion` names (the hub when it names
    none). Rive checks a state's exits in order, so each is written as
    `motion == value` plus the exit time.
  - **In the report:** `stateMachine.hub`; `routes`, every ordered pair of
    loops as steps — `{ transition: id }`, or `{ cut: { from, to } }` — with
    the worst-case `seconds` (the whole cycle of the loop being left, plus
    every clip on the way); `waits`, each loop's cycle, which is the longest
    anyone waits after setting `motion`; and `cuts`, every edge in the file
    whose two sides do not share a pose (a loop's last frame and the next
    state's first), each with its **`poseGap`** measured on the frames as the
    file draws them — `iou`, `gap`, `rgb` and `chroma`, the same numbers as
    `lineup`. `from: null` is a one-shot fired from any state (no single gap).
    A cut into a clip from a loop other than the one it starts on is a cut
    too. The `notes` say that leaving a loop waits for its cycle end, and how
    many cuts there are with the largest gap.
- **`--images webp|webp-lossless|png`** (default webp; webp-lossless for pixel
  art) — how each frame is embedded. WebP is
  lossy at quality 85 (`libwebp`, `yuva420p`) and several times smaller: on
  tanka-connect (10 loops, 10 transitions, 320 px) 13.0 MB against PNG's
  81.1 MB, with the same 324.9 MB decoded — the memory is the pixels, not the
  bytes. Every Rive runtime decodes it: rive-runtime, the C++ core the native
  runtimes share, builds its own WebP decoder in (`decoders/src/decode_webp.cpp`,
  libwebp from `dependencies/premake5_libwebp_v2.lua`), and Rive's own
  best-practices guide recommends WebP for the smallest files.
  **`webp-lossless`** (`-lossless 1`, `bgra`: no chroma subsampling) keeps
  every visible pixel exactly as drawn — only the hidden colour of a fully
  transparent pixel may change — and is the default for a pixel-art
  character, by the same reading as `--filter auto`: lossy WebP would put
  colours between the hard pixels nearest-neighbour kept. On the pixel-art test
  character it is 1,768 B against PNG's 3,010 B (lossy WebP: 3,364 B).
  `--images png` embeds PNG. An ffmpeg without the `libwebp` encoder: with no
  `--images`, the frames go in as PNG and `warnings` says why; a WebP format
  asked for by name is refused.
- **Honesty:** the frames are raster images, not vector shapes. The file plays
  in every Rive runtime but is a runtime file — it cannot be reopened in the
  Rive editor. The report's `notes` say this every time, plus one line per
  resampled or scaled motion (`idle: 244 frames at 60 fps, 512×652 → 98 frames
  at 24 fps, 251×320 in the .riv`).

**`--json`** (consumed by `register-export`) — tanka, `--include-loops` at the
defaults (2026-09-24): ten loops cut before `loop` recorded its crop, five
entries from idle and their five reverses (3 of 20 motions shown):

```json
{ "kind": "rive", "character": "<abs>", "name": "Tanka",
  "out": "<abs>/exports/tanka.riv", "size": 13627331, "images": "webp",
  "artboard": {"name": "Tanka", "width": 315, "height": 341, "anchor": {"x": 168, "y": 313}},
  "resample": { "loop": { "fps": 24, "maxSize": 320 }, "sprite": { "fps": null, "maxSize": null },
                "filter": "smooth", "filterFrom": "style" },
  "motions": [
    {"id": "idle", "kind": "loop", "loop": true, "frames": 98, "fps": 24, "width": 230, "height": 293, "scale": 0.4496, "clip": {"scale": 1.1816, "origin": {"x": 97.46, "y": 46.07}, "from": "measured"}, "seconds": 4.083, "anchor": {"x": 115.62, "y": 288.06, "from": "clip"}, "estimatedDecodeBytes": 26416880},
    {"id": "idle-to-coffee", "kind": "transition", "loop": false, "from": "idle", "to": "coffee", "frames": 29, "fps": 24, "width": 236, "height": 311, "scale": 0.5313, "clip": {"scale": 1, "origin": {"x": 87, "y": 54}, "from": "recorded"}, "seconds": 1.208, "anchor": {"x": 121.34, "y": 283.7, "from": "clip"}, "estimatedDecodeBytes": 8513936},
    {"id": "coffee-to-idle", "kind": "transition", "loop": false, "from": "coffee", "to": "idle", "shares": "idle-to-coffee", "frames": 29, "fps": 24, "width": 236, "height": 311, "scale": 0.5313, "clip": {"scale": 1, "origin": {"x": 87, "y": 54}, "from": "recorded"}, "seconds": 1.208, "anchor": {"x": 121.34, "y": 283.7, "from": "clip"}, "estimatedDecodeBytes": 0},
    "… 20 in all" ],
  "frames": ["<abs>/motions/wave/frames/000.png", "… every registered frame of all 20"], "frameCount": 1235,
  "estimatedDecodeBytes": 340723148,
  "stateMachine": { "name": "State Machine 1", "hub": "idle", "defaultMotion": "idle",
    "inputs": [ { "name": "motion", "type": "number", "default": 8,
                  "values": [ { "value": 0, "motion": "wave" }, "…", { "value": 3, "motion": "coffee" }, "…", { "value": 8, "motion": "idle" }, { "value": 9, "motion": "dance" } ] } ],
    "routes": [ {"from": "idle", "to": "coffee", "steps": [{"transition": "idle-to-coffee"}], "seconds": 5.291},
                {"from": "coffee", "to": "wave", "steps": [{"transition": "coffee-to-idle"}, {"cut": {"from": "coffee-to-idle", "to": "wave"}}], "seconds": 6.25},
                {"from": "coffee", "to": "typing", "steps": [{"transition": "coffee-to-idle"}, {"transition": "idle-to-typing"}], "seconds": 7.75}, "… 90 in all" ],
    "cuts": [ {"from": "coffee-to-idle", "to": "wave", "poseGap": {"iou": 0.8313, "gap": 0.1687, "rgb": 0.1599, "chroma": 0.0497}}, "… 60 in all" ],
    "waits": [ { "motion": "idle", "seconds": 4.083 }, { "motion": "coffee", "seconds": 5.042 }, "…" ] },
  "excluded": [],
  "notes": ["The frames are raster images, not vector shapes: …", "…",
            "coffee-to-idle: idle-to-coffee's 29 images played backwards — nothing more embedded", "…",
            "Leaving a loop waits for the end of its cycle: set 'motion' and the loop plays out the cycle it is in before anything moves — up to 5.083s from reading (every loop's wait is in stateMachine.waits). Routes go through idle unless a transition joins two loops directly.",
            "60 direct cuts where no transition joins the poses, the largest poseGap 0.2843 (walk → dance) — each is in stateMachine.cuts; a transition clip between those loops removes it.",
            "The frames are embedded as WebP, lossy at quality 85 — several times smaller than PNG, and decoded by every Rive runtime (the native ones share rive-runtime's own WebP decoder); --images png embeds them lossless."],
  "warnings": ["the runtime decodes every frame when the file loads: about 325 MB of memory before anything plays (over 128 MB) — lower --fps or --max-size, or pass fewer motions with --motions"] }
```

`frames` is what the file was made FROM — every registered frame of every
motion in it, which `register-export` checks against project.json and hangs
the `.riv` off; `frameCount` is what it embeds. Per motion, `source` is the
motion as registered and `frames` / `fps` / `width` / `height` are what the
file plays — quote those, never the source's.

`stateMachine.inputs` is what a developer wires: set `motion` to wave's value
from their code and the character finishes the cycle it is in, goes through
whatever clips join the two, and waves until `motion` changes; fire
`play_attack` on a sprite one-shot and it plays once and goes to the loop
`motion` names.

### Fixing the alignment without regenerating the sheet

Use this when the drawing is fine but placement drifts unintentionally.
The cells are still on disk, so nothing has to be re-sliced (a pixel-art
motion re-aligns from `<id>/pixel`, not `cells` — see `align`):

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
with a colour threshold unless you pass the cut-out it kept —
`run <motionDir>/sheet-raw.png --alpha <motionDir>/sheet-alpha.png …`, the
same two paths as the first run.

### `fit <image> --out <png> [--max 480] [--pad 8]`

The still a breathe is made from, **at the size it plays**. Takes a cut-out
(transparent background), drops specks the background remover left clear of
the body (the rule `run` cleans a cell by), trims it to the character plus
`--pad` px, and brings the character's larger side down to `--max` px — area
averaging in **premultiplied** alpha, never an enlargement. With the default
480 and a breathe's stretch the breathing cell stays within 512 px. `--out`
may be the input (the file is read whole first).

Why it exists: a breathe keeps its still's canvas, so an untrimmed 1024×1536
upload made a 1024-px-wide cell around a 550-px character, and its 1289-px
frog came out as a 1300-px sprite. Fitting **before** the still is registered
keeps two things true: the reference in the rail is exactly the picture the
frames were warped from, and every coordinate the breathe report prints
(`--rigid-row`, `--axis`) is a pixel of that file.

- **Refuses a picture with no transparent background** (≥ 99 % opaque) — cut
  it out first: `remove-background.mjs` for a busy or photographic
  background, `key` for a flat plate.
- **Warns when the character touches an edge** of the image — the upload
  cropped it (feet cut off at the bottom); look before breathing it.
- **Pixel art is trimmed, never resampled** (the nearest character's
  `character.pixel`, then its style — `riveIsPixelArt`, as `breathe` reads
  it); a note says when it is over `--max`.

Reports `width`/`height`, the `box` it kept in the input's pixels, the
character's size, `scale` (1 = not resampled) and `cleaned`.

### `breathe <still> --out <motionDir> --name <motionId> [--fps 8] [--frames N] [--depth 0.02] [--breaths 1] [--mode smooth|pixel] [--rigid-row y] [--axis x] [--torso halfWidth] [--pad 8] [--width W] [--no-webp]`

A breathing idle from **one still**, no model call and no money: the body
below the neck swells and settles on a travelling wave, the head rides on top
as one rigid block, the soles never move, and anything that reaches far past
the torso (an arm, a wing, a held lantern) is pushed outward instead of
stretched. Ported from aldegad/sprite-gen (`effects/breathe.py`,
`effects/anatomy.py` @ fbd1a08, Apache-2.0); the `smooth` mode is ours.

**With `--name` it is the whole motion in one command**, the way `run` is for
a sheet: `--out` is the motion directory. The bake lands in
`<motionDir>/cells` — every frame cut to the one rectangle all of them reach,
plus `--pad` — and the half every source ends with follows: `align --x-from
cell`, `pack`, `gif` (+ WebP), `inspect`, at `--fps` (default 8: 12 frames a
breath is 1.5 s). The `--json` output is the run summary `register-run` takes,
so the documented form is one pipe:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs breathe <character>/refs/still.png \
  --out <character>/motions/idle --name idle --json \
  | node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion idle --run -
```

(Redirecting to `<character>/motions/idle/run.json` works too, once that directory
exists — on a first breathe it does not.) The summary is a sprite run
(`frames`, `sheet`, `atlas`, `gif`, `webp`, `inspect`, `cell`, `grid`, `fps`,
`loop: true`, `xFrom: "cell"`) plus `source: "breathe"`, `still` (the path
breathed) and the record a re-run starts from:
`breathe: { depth, breaths, lag, mode, anatomy: { rigidRow, axisX, from,
torsoHalf? } }` — the boundary in the still's pixels, `from: "override"` when
any of `--rigid-row` / `--axis` / `--torso` was given, and `torsoHalf` only
when `--torso` was (a manual band changes what is pushed, so a re-run must be
given it again). `register-run` makes the motion ready, derives every frame
from the still, and takes the motion's `grid` and `fps` from the run — a
breathe is drawn on no grid and timed by its run, so `add-motion --source
breathe` needs no `--rows/--cols` and no `--fps`.

**Warnings go where the stage shows them.** The detector's warnings that ask
for a decision — a prop across the rigid row, pixel mode on anti-aliased art,
too few frames a breath, a character cut off by the still's edge — join
`inspect.warnings` (and `inspect.json`), so the rail marks the motion and the
agent reads them in the viewer context. How the anatomy was read
(`face-absent:`, `neck-absent:`, the `*-override:` notes, and in pixel mode
the outline-thinned head) goes to `notes` in the run output only. A still
that is one of the frames the run rewrites is refused.

**Without `--name`** it writes only `NN.png` frames into `--out` — `--frames`
(default 12 × `--breaths`) frames holding `--breaths` whole breaths — on the
still's canvas, grown only as far as the stretch needs (`canvas.grew`; the
bottom never grows); the motion's flags (`--fps`, `--pad`, `--width`,
`--no-webp`) are refused there. Use it to try a depth or read the anatomy
before cutting anything; the chain it stands for is the one `--name` runs:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs breathe <character>/refs/still.png \
  --out <character>/work/breathe-try/cells --json
node {SKILL_PATH}/scripts/sprite-sheet.mjs align <character>/work/breathe-try/cells \
  --out <character>/work/breathe-try/frames --x-from cell --json
```

`--x-from cell` because the frames already stand where they stand — the axis
column and the soles are fixed by construction — and `feet` would re-round a
feet centroid that the stretch moves by a fraction of a pixel. On the Lumi
stills this chain measures `bodyDrift` 0.03–0.06 px and no `inspect` warnings.

Beside the frames it writes `breathe.json` (`{ kind: "pneuma-sprite-breathe",
version, still, frames, breaths, depth, mode, headOffset, perFrame, warnings }`;
`clean` carries it along) — with `--name`, in `<motionDir>/cells/`.
`register-run` keeps the run's `headOffset` as `motion.breathe.headOffset`,
and `show --motion <id>` prints it under the breathe line, word for word as
`breathe` does: `head offset -1..+1px (travel 2px: highest in frame 9, 10,
11, lowest in 2, 3, 4, 5)`.
`inspect` reads it from the cells or the frames: the head moves by whole
pixels, so at each turn of the breath two neighbours can share the head's row
and differ by a sub-pixel body warp alone (Lumi idle frame 00, depth 0.02, 16
frames: 4 pairs at steps 0.001–0.002 among steps of 0.010–0.013). Those pairs
stay in `nearDuplicates`; the near-duplicate sentence, whose fixes are
resampling and redrawing, is not said for a breathe.
`--out` must not be the directory the still sits in (it is cleared first; that
is refused by name).

**The anatomy is measured, printed, and yours to correct.** Every report
carries, in the still's pixel coordinates: the body axis `axisX` (alpha
centroid), `neckY` and `neckSource` (`bottleneck` = the most prominent
narrowing of the width profile in the top 5–70 %; `shoulder-gradient` when
there is none — a slime), `face` (a mirror-symmetric pair of small dark blobs
above 65 % height; anime eyes with highlights usually are not found, which is
fine), `rigidY` (nothing above it deforms: the lower of the neck and the face
plus room for the mouth, capped at 80 % of the height), `torsoHalf` /
`maxHalf` and `appendage` (something reaches sideways when the widest
half-width is ≥ 1.3 × the torso's). Check them against the still before
looking at the frames; `--rigid-row y`, `--axis x` and `--torso halfWidth`
replace a detected value (the report names what they replaced). A manual
`--torso` pushes everything outside the band.

**Two modes.** `smooth` resamples the same deformation continuously
(area-weighted, premultiplied alpha) for anti-aliased art, and moves the head
by a whole number of pixels so it is pixel-identical to the still in every
frame. `pixel` is upstream's whole-pixel bake — rows duplicated or dropped,
columns remapped, a dark outline thinned back to 1 px — so every pixel stays a
source pixel and pixel art stays on its grid. Without `--mode` the character
decides — `character.pixel`, else its `style` (pixel art → `pixel`, the
reading `rive --filter auto` uses; `modeFrom` says which) — from the nearest
`project.json` above `--out`, the still, or the working directory; with no
character, `--mode` is required.

**Read the report, per frame and overall:** `height` (solid alpha, min..max
against the still's), `headOffset` (per frame, negative = up; overall
`{ min, max, travel, highest: [frames], lowest: [frames] }` — the head rides
the breath by `travel` px, and `highest` / `lowest` name the two frames to
capture when saying so), `headDiffPx` (head pixels
that differ from the still; 0 = identical — nonzero only in `pixel` mode on
art with dark outlines, where the thinning pass runs over the whole frame),
`strain` (the largest per-row strain; over 0.25 is refused), and warnings.
Two warnings to act on:

- **something beside the body crosses the rigid row** — a prop there (Lumi's
  lantern) rides with the head above the row and is stretched and pushed with
  the body below it, so it squashes and shears. The warning names the
  `--rigid-row` that keeps it whole; the price is a chest that no longer
  breathes above that row. Look at both and choose.
- **pixel mode on anti-aliased art** — duplicated rows step the diagonals and
  the thinning eats a pixel of a thick line; use `smooth`.
- **the head never moves** — the character is too short for the depth to
  lift it a whole pixel, so the frames only widen and narrow. The warning
  names the `--depth` at which the head starts to move; or breathe a larger
  still.

A still whose working canvas (the still plus a third of the character on
every side) is over 3 MP is refused, naming `fit`: breathe the picture at
the size it plays at (an unfitted 2048² upload measured ≈ 1.9 GB resident).

`--depth` is the total stretch as a share of the body below the neck (the
same number means the same on every character). Fewer than 6 frames a breath
reads as a twitch and is warned about.

#### Route A — a picture brought to life, end to end

The user brings one picture; nothing is generated. Every step is local and
free except the cut-out of a busy background (one BiRefNet call on fal).

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs init --dir <character> --name "<Name>" --style "<what you see>" --purpose animate
mkdir -p <character>/refs && cp .pneuma/uploads/<file> <character>/refs/upload.png
node {SKILL_PATH}/scripts/sprite-project.mjs add-ref --dir <character> --id upload \
  --file refs/upload.png --role custom --uploaded
node {SKILL_PATH}/scripts/sprite-sheet.mjs probe <character>/refs/upload.png
# the cut-out, one of three: alpha=yes and coverage < 99% means it is already cut out
node {SKILL_PATH}/scripts/remove-background.mjs --input <character>/refs/upload.png \
  --output <character>/refs/still.png                      # busy background (fal)
node {SKILL_PATH}/scripts/sprite-sheet.mjs key <character>/refs/upload.png \
  --out <character>/refs/still.png                         # flat plate (free)
cp <character>/refs/upload.png <character>/refs/still.png  # already transparent
# then, whichever it was:
node {SKILL_PATH}/scripts/sprite-sheet.mjs fit <character>/refs/still.png --out <character>/refs/still.png
node {SKILL_PATH}/scripts/sprite-project.mjs add-ref --dir <character> --id still \
  --file refs/still.png --role custom --derived-from upload --op key   # --op fit when nothing was removed
node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> --id idle --label Idle \
  --source breathe
node {SKILL_PATH}/scripts/sprite-sheet.mjs breathe <character>/refs/still.png \
  --out <character>/motions/idle --name idle --json \
  | node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion idle --run -
```

Provenance then reads frames ← `ref-still` (`derive`, `op: key`) ←
`ref-upload` (`upload`, by the human). `register-run` accepts the still only
as a registered reference; a frame of another motion is registered first
(`add-ref --derived-from <frame id>`), then breathed.

**Re-running (`regenerate-motion` on a breathe).** Free and seconds: run the
same pipe with the parameter changed and the rest from the record (`show
--motion <id>` prints `breathe of ref-still (refs/still.png): depth …,
rigid row …, axis … (detected|override)`; the viewer context says the same).
"Breathe more" is `--depth 0.03`–`0.04`; "the head wobbles" or a prop that
shears is the `--rigid-row` the warning names; a slower breath is `--frames
16` or `--fps 6`. `register-run` replaces the frames, their edges, the atlas,
the GIF and the record in place, drops the old tail when there are fewer
frames, and takes the new grid and fps. The still and the upload are not
touched. `fix-alignment` is not offered on a breathe: the frames are warps
of one still and share its footing by construction.

## `remove-background.mjs` — the fal keying path

The one model call on this page, and **the default way a sprite sheet gets its
alpha** (workflow B-sheet step 5): BiRefNet matting on fal, which cuts the character
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
| `init --name "Lumi" [--description] [--style] [--cell 256x256] [--facing right] [--purpose game\|loop\|mascot\|animate] [--asymmetric "<sentence>"] [--pixel <H> [--colors N]]` | Creates the character directory if it is not there yet, then writes `project.json`. Fails if one exists unless `--force`. `--purpose` records the route (SKILL.md, *Pick the route*); `--asymmetric` is one sentence naming what must never flip — it stops `mirror` and guards every built prompt; `--pixel` declares pixel art at H logical px tall; `--colors N` is the palette size, the default `--palette-size` of every `run --pixel`. |
| `set-character [--description] [--style] [--facing] [--purpose] [--asymmetric "<sentence>"] [--pixel <H>] [--colors N] [--no-pixel] [--remove-variant <name,…>]` | Changes the character after `init`; only the flags given change. `--asymmetric ""` takes the sentence back. `--no-pixel` removes the pixel spec and unregisters the pinned palette and every colourway's files (the files stay on disk); `--remove-variant` drops the named colourways and their files. `show` prints the purpose, the pixel height and the sentence on its second line. |
| `add-ref --id turnaround --file refs/turnaround.png --role turnaround\|portrait\|expression\|anchor\|custom [--direction front\|back\|left\|right] [--label] [--prompt] [--model] [--from <assetId,…>] [--uploaded \| --derived-from <refId\|assetId> [--op crop]]` | `--role anchor` needs `--direction`: one single-pose image facing that way, one per direction (a second anchor for the same direction is refused; re-register that id to replace it); no other role takes a direction (`prompting.md`, *Direction anchors*). Registers `ref-<id>` with a `generate` edge carrying the model and prompt you used. `--uploaded` instead records a file **the user brought**: an `upload` edge with `actor: "human"`, no parent and no params — it refuses `--model` / `--prompt` / `--from` by name, since none of them happened. `--derived-from <refId>` records an image you cut or cleaned out of another registered reference (a single pose out of an uploaded design sheet): a `derive` edge from that ref with `params.op` — `--op` is one word, default `crop`, and only valid here. Re-adding an id replaces its edge whatever its type. |
| `add-motion --id idle --label Idle --rows 4 --cols 4 --fps 8 [--loop] [--anchor bottom] [--prompt] [--status planned] [--direction front\|back\|left\|right]` | Adds the motion. Call it before you generate, so the stage shows a placeholder. `--direction` is the way it faces; name it `<state>-<direction>` (`walk-left`) so every atlas key, Aseprite tag and Rive input carries it. |
| `set-motion --motion idle [--label] [--fps] [--loop\|--no-loop] [--anchor] [--prompt [--prompt-parts '<json>']] [--direction] [--source sheet\|video\|breathe\|mirror] [--status] [--notes]` | Edits motion metadata. `--source` says again how a motion with no frames yet will get them — the way out when a planned mirror is refused on an asymmetric character: `--source sheet`, then `sheet-prompt`; a motion with frames keeps the source that made them. `--notes` is where a failure reason belongs. `--prompt` alone is a hand-written prompt and drops any recorded parts; `--prompt-parts` records how code built the `--prompt` given with it (what `sheet-prompt` writes; `project-json.md`, *Recorded prompt parts*). A mirror's `--direction` must stay the opposite of its source's. |
| `sheet-prompt --motion idle --action "<phase plan>" [--frames N] [--state …] [--guide\|--no-guide]` | Builds the sheet prompt in code from the character, the motion and your action, records `prompt` + `promptParts`, and prints the prompt (stdout alone without `--json`; `imageSize`, `attach`, `rhythm`, `guide` and `sides` with it — `sides[d]` is where the character's own right and left fall in view `d`). `--frames` redraws the motion's grid. Refused on loop, transition, breathe and mirror motions, a planned mirror included. Grammar, guards and the frames table: `prompting.md`, *Building the prompt*. |
| `set-sheet --motion idle --file motions/idle/sheet-raw.png --from ref-turnaround[,…] [--model] [--prompt] [--background opaque] [--status generating\|processing]` | Registers `<motion>-sheet-raw` with a `generate` edge. `--from` becomes the edge's `fromAssetId`; `params.inputs` lists the whole set **only when you attach two or more references** — with one, `fromAssetId` already says everything. Re-running replaces the previous raw sheet and its edges, keeping the id stable. Call it twice per sheet (see below). |
| `add-motion … [--source sheet\|video\|breathe\|mirror]` | Records how the frames will be obtained, before anything is generated. Absent means `sheet`; `register-run` corrects it from the run that lands. `--source breathe` needs no `--rows/--cols` and no `--fps` (1×1 at 8 fps until the run lands: a breathe is drawn on no grid and timed by its run). `--source mirror` needs none of them either: a mirror plays on its source's grid, fps and loop, which `register-run` takes from the run. |
| `add-motion … [--kind loop]` | Declares a **loop motion** (workflow E). `--rows/--cols` become optional (1×1 is recorded), `source` defaults to `video`, and `set-keyframe` is accepted only here. A sprite motion is unchanged. |
| `set-keyframe --motion <id> --file motions/<id>/keyframe.png [--alpha motions/<id>/keyframe-alpha.png] [--model] [--prompt] [--from <refIds>] [--status generating\|processing\|ready]` | The loop's `set-sheet`. Registers `<motion>-keyframe` with a `generate` edge carrying the model and prompt; `--alpha` registers `<motion>-keyframe-alpha` with a `derive` edge (`step: "key"`) from it. Refused on a motion that is not `--kind loop`. Called twice per keyframe, as `set-sheet` is — but the closing call needs only `--file` and `--alpha`: an omitted `--model` / `--prompt` / `--from` **keeps** what the reserving call recorded rather than blanking the edge. Once `--alpha` has reserved the cut-out, a closing call without `--alpha` is refused, because the stage prefers the cut-out and a placeholder there is a broken image. |
| `add-video … --file motions/<id>/<clip> --derived-from <videoId> --op matte\|interpolate\|retime --model veed\|veed-gs\|bria\|topaz\|rife\|ffmpeg [--duration] [--status]` | Registers a clip made **from another clip**: a `derive` edge from the parent's asset with `params: { op, model }`, and a sidecar entry with `mode: "derived"`. `--file` is required here as everywhere. It takes no `--mode`, `--prompt` or `--from` — nothing was prompted, and a prompt invented to fill the field is what makes a later turn believe the clip was generated. `--op retime --model ffmpeg` is the local reorder (`sprite-sheet.mjs retime`), which invents no pixel and so is neither a matte nor an interpolation. `--status` defaults to **`ready`**: the script that made the clip wrote the file before there was anything to register, so there is no wait to show (a shot clip still defaults to `generating`). |
| `set-motion … --brief-duration <s> --brief-width <px> --brief-interpolator topaz\|rife\|ffmpeg\|none [--brief-budget <usd>]` | Records the **loop brief** — the answers workflow E step 1 collects before anything is paid for. The first call needs the three required flags together; any later call may change one. Refused on a motion that is not `--kind loop` or a transition; a transition's brief is `--brief-duration` and `--brief-budget` alone. Warns on stderr when `duration × 60 > 400` with an interpolator that targets 60 fps, naming the rate that fits (`--target-fps 48` for a 7–8 s loop). |
| `add-video` on a **loop** motion, generated clip | **Refused** when the motion has no brief: `add-video: loop '<id>' has no brief — record the user's answers first: set-motion --brief-duration … --brief-width … --brief-interpolator …`. A record that is only half a brief is refused the same way and names what it is missing (`… has an incomplete brief, missing --brief-width, --brief-interpolator and recordedAt — …`): the reader is all-or-nothing everywhere — the gate, `show` and the JSON summaries — so half an answer never travels as one. A `--derived-from` clip is exempt: that money is already spent, and refusing to record it would only lose the provenance. |
| `set-motion … [--ack-warnings "<reason>"] [--clear-ack]` | Accepts the motion's remaining inspect warnings with a one-sentence reason the user reads on the stage; the numbers stay visible and the badge dims. `--clear-ack` takes it back. Refused when the motion has no inspect report, and refused with an empty reason — the acknowledgement *is* the reason. |
| `register-run --motion idle --run <run.json \| -> [--video <videoId>] [--repin]` | Consumes `sprite-sheet.mjs run` output: registers the alpha sheet (if any), every frame, the packed sheet, atlas, gif and webp with `derive` edges; **removes** the previous frame assets and edges for that motion; copies `inspect` into the motion field by field (including the measured `anchorPoint`, which is what the viewer's pivot guide stands on, a jump's `lift` and the `pixel` lattice report; `keyFringe` stays in `inspect.json`); takes the motion's `grid` and `fps` from the run (the grid a sheet was sliced on, the columns a clip's frames were packed on); keeps an auto slice's record as `motion.slice` and a breathe's `headOffset` as `motion.breathe.headOffset` — `show --motion` and the viewer context print the slice, the lift and the head offset, so a later turn reads them without the run summary; sets status `ready`. A `from-video` summary derives the frames from the clip asset instead (`--video` names which, the newest is used with a note on stderr) and sets `motion.source`. A summary with `"kind": "loop"` has no sheet, atlas or gif — those become optional, and a sprite run still requires them — and registers the webp plus `<motion>-apng`, `<motion>-webm` and `<motion>-lottie` instead; it sets `motion.kind = "loop"`, `motion.exports`, `motion.source = "video"`, `motion.fps` from the run (interpolation changes it) and `grid = {1,1}`, and the inspect summary it copies carries `seam`, `step`, `seamFill` and `alphaCoverage`. Any acknowledgement goes with the measurement it covered. Re-registering a motion **retires** the on-demand exports made from its old frames (`<motion>-export-*`, and the character's `.riv` when it held this motion): the assets and edges go, the files stay on disk, and stderr says `note: retired <id> — it was cut from the frames this run replaced; re-export it`. A loop's own WebP / APNG / WebM / Lottie are rewritten by the run itself and are not retired. Its colourway files (`<motion>-variant-*`, `motion.variants`) are retired the same way, with a note naming the command that bakes them again from the recorded colourways. A **breathe** summary (`source: "breathe"`) needs its `still` registered as a reference and takes the motion's grid and fps from the run; a **mirror** summary (`source: "mirror"`) needs a ready left- or right-facing source with as many frames, takes its grid, fps, loop and anchor from the run (the source's where the summary does not say), refuses an asymmetric character unless the summary carries `force: true`, and notes every mirror a re-run leaves stale; a **pixel** summary pins its palette on the character the first time and refuses a different one later unless `--repin` (which warns that the other motions used the old one) — all three in `project-json.md`, *Routes, directions, breathe, mirror, pixel art*. On a loop it also compares the registered `inspect.cell.width` with `brief.width` and warns — stderr, and `warnings[]` in the `--json` payload — when they are more than 2 px apart (`frames are <w> px wide but the brief said <width> — pass --width to loop`). A warning, not an error: the frames are already cut, and cutting them again is free. It is said once per channel and is **not** written into `inspect.warnings`: that list is the measurement of the frames — what the viewer shows and what `--ack-warnings` accepts — and this is a comparison against the brief. |
| `register-export --report <report.json \| ->` | Consumes the `--json` report of `sprite-sheet.mjs export` or `rive`, usually piped (`--report -`). A motion export becomes `<motion>-export-<format>` (type `video` for mp4/mov/webm, `image` for apng, `text` for lottie, `image` with `metadata.container: "zip"` for png-seq and aseprite) and `motion.exports[format]` names it, with `metadata.shadow` `{ squash, shear, opacity, blur, color }` when it was made with `--shadow`; the character's Aseprite sheet (`"scope": "character"`) becomes `<character>-export-aseprite` (type `image`, `metadata.container: "zip"`, `width`/`height` of the sheet, `frames`, `motionCount`) with `params.motions` and `params.tags`, and `sprite.exports.aseprite` names it — retired with the `.riv` by a `register-run` or `remove-motion` of a motion it holds; the `.riv` becomes `<character>-export-riv` (type `image`, `metadata.container: "riv"`) and `sprite.exports.riv` names it. Metadata carries `size` in bytes plus what the report measured (`width`, `height`, `fps`, `duration`, `frames`, `repeat`, `scale`, `background` on MP4; `motionCount`, `images`, `estimatedDecodeBytes` on the `.riv`). One `derive` edge from every frame it was made of, `params: { tool, step: "export"\|"rive", format, repeat, scale, background }` — the `.riv`'s edge lists `params.motions` and `params.sampled` (each motion's frames, fps, width and height as the file plays it), and its `metadata.frames` is what it embeds. The report's frames must be the ones registered **now**, or it is refused ("export it again"). Re-registering replaces the asset in place. An empty report — the export failed and printed only its `ERROR:` — is said as such and registers nothing. A format a loop already ships (its own WebM, APNG, Lottie) is refused. |
| `register-recolor --report <recolor.json \| ->` | Consumes the `--json` report of `sprite-sheet.mjs recolor`. Records each colourway once, on the character (`character.pixel.variants`: a changed one replaces its record in place, a new one is appended), and per motion its `sheet.png`, `atlas.json` and `preview.gif` as `<motion>-variant-<name>-sheet` / `-atlas` / `-gif` (sheet: `metadata.substituted`, `unmatched`, `uncovered` counts), named by `motion.variants[name]`. The sheet and preview are `derive` edges from the motion's frames (`params: { step: "recolor", variant, tolerance?, inputs }`), the atlas from the sheet. The report's frames must be the ones registered now. A colourway whose map changed unregisters the files other motions baked with the old one (said on stderr). |
| `add-video --motion idle --file motions/idle/video-seedance-1.mp4 --model seedance-2.5 --mode i2v --from idle-frame-00[,idle-frame-15] [--prompt] [--duration 4] [--status generating]` | Registers `<motion>-video-<n>` (n is the next free number) with a `generate` edge. |
| `set-video --motion idle --video <id> --status ready\|failed [--notes]` | Closes out a video after the render returns. |
| `remove-motion --motion idle` | Removes the motion, its assets and its edges — its on-demand exports included, and the character's `.riv` when it holds this motion. Files on disk are left alone; the orphaned paths are printed so you can delete them deliberately. |
| `show [--motion id]` | Compact summary (with `staleMirrors` — a mirror whose source was registered again after it, fixed by the `mirror` command it names + `register-run`; `staleBreathes` — a breathe whose still was registered again after it or is gone, fixed by `breathe --name` + `register-run`; and `variantsMissing` — the ready sprite motions missing a recorded colourway, which is what a re-run leaves; the fix is `recolor` on that motion without `--map`): name, the recorded purpose, pixel height and asymmetry sentence, refs (each with `origin: generated \| uploaded \| derived`, read off its edge — whether an image was drawn here or brought in decides what you may regenerate), motions with status / grid / fps / frame count / warnings, and derived clips as `video-3 ← video-2 (matte, veed-gs)`. The cheapest way to re-orient at the start of a turn. |

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

## How long each step takes

Measured wall times. Nothing here has a progress bar, so this is how to tell
"working" from "hung", and the number the user hears before a wait. The loop
and transition rows (keyframe, first-last clip, matte, interpolation, `loop`)
are in `loops.md`.

| Step | Wall time |
|---|---|
| a reference image (2048², `--quality high`); a direction anchor (1024²) | 30–40 s; ≈ 25 s |
| a sheet (2048 wide, refs attached) | 20–35 s |
| `remove-background.mjs --model heavy` at 2048 / 1024 | 10–20 s / ≈ 6 s |
| `sprite-sheet.mjs run` (`--pixel` adds ≈ 1 s) | ≈ 5 s |
| `breathe --name … \| register-run` (route A, the cut-out aside) | ≈ 7 s |
| `mirror` + `register-run` | ≈ 5 s |
| `sprite-sheet.mjs contact` (4 s clip, 24 stills + analysis) | ≈ 3 s |
| `sprite-sheet.mjs from-video` (16 frames, 640² clip) | ≈ 12 s |
| **a 4 s Seedance 480p clip** | **140–400 s**, and 632 s on one loop take — the queue decides, not the clip |

Quote a Seedance take as a range. It is the step that looks broken and is
not: register the placeholder, say the range, and wait — no polling, no
second call. The script retries transient failures itself, and a second
submission is a second bill.

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
      "anchor": { "x": 0.5, "y": 0.9688 },
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
- `anchor` is the same point as `pivot`, under the key **PixiJS 8 reads**:
  its `Spritesheet` parser sets each texture's `defaultAnchor` from
  `frames[key].anchor` and never reads `pivot`, so an atlas with `pivot` alone
  stands every Pixi sprite on its **top-left corner** (measured with pixi.js
  8.21.0 on the seed's Lumi idle atlas, 2026-09-27: `Sprite.anchor` (0, 0); a
  current pack: (0.5, 0.9683)). Phaser 3.90 / 4.2 read `anchor || pivot`.
  `pivot` stays for readers of older atlases. The seed Lumi atlases predate
  `anchor` and cannot be re-packed to gain it: their frames carry no
  `align.json`, so `pack` would fall back to `{0.5, 1}` — re-run the motion.
- Neither engine plays per-frame `duration` from a texture atlas: it is a
  record, and the animation's rate is set in code (`frameRate: fps`). The
  Aseprite export is what carries durations an engine plays.
- `meta.scale` is `pack --scale`, a record of how the cells were resized.
  **PixiJS reads it as the texture resolution** (`parseFloat(meta.scale)`), so
  a sheet packed at `--scale 0.5` is drawn at twice its pixel size there —
  back at the frames' size (measured, pixi.js 8.21.0: a 186 px cell at
  `scale: 0.5` comes out 372 px wide). Phaser ignores it.
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


## Measured: the chroma keyer (2026-09-27)

Why `--keyer unmix` is the default for every hued plate (`key`, `run`,
`from-video`, `loop`, `transition`). M-series mac, ffmpeg 8.0, node 25 / Bun
1.4. `contact` keeps `colorkey` for its silhouettes: they are thresholded at
96 px wide, where a rim does not exist, and both keyers cut the same radius.

**What was ported.** aldegad/sprite-gen (Apache-2.0)
`sprite_gen/frames/extract.py@fbd1a08` — `remove_chroma_background` (hard cut,
soft-alpha un-mix within 4 px of the cut, 2 px for in-band blends, trapped-spill
despill of clusters ≤ max(32, 0.5 % of the subject) with a pixel tinted past
40), `despill_color` / `unmix_key_blend`, `detect_background_key_rgb` (mode of
8-wide bins over corner patches and border), with their constants. Changes, each
measured: one hard-cut ball around the **measured** plate at our `--similarity`
radius (upstream: a ball around the requested pure key plus a gated ball around
the painted one — its border rule rejects broadcast green `#00b140`); the
channel split taken from the plate's own hue; the plate measured over 8 frames
of the clip; blends **classified** by channel excess rather than the mean tint
(upstream's opt-in `spill_require_hue` rule), because the mean tint reads
yellow and gold as green — on tanka it lowered the alpha of 42–77 % of the
yellow fur within 4 px of the edge (a pale translucent ring round every ear),
and on the synthetic gold disc it left an orange one.

**Synthetic ground truth.** A 512² scene drawn at 4× and box-downsampled, so
every edge pixel's true colour and coverage are known: an ink-outlined skin
disc, a white panel with no outline, a purple-over-yellow plush with a 1.5 px
feathered edge, a gold disc on its rim, a teal gem inside it, crimson strands
0.5–3 px wide, and a translucent pale-blue wisp. Composited on a painted green
`(8,240,13)` with a ±5 light falloff, 8 frames of sub-pixel drift, through
`libx264 -crf 16 -pix_fmt yuv420p`, decoded, keyed. Scores: **halo** = mean
CIEDE2000 of the composite against the true composite on `#0A0A0D` / white over
the 2 px band round every true edge; **contamination** = pixels covered in both
whose hue turned ≥ 12° toward the key (upstream's definition); **strand
recall** = Σmin(α,α̂)/Σα over the strands; **interior damage** = pixels ≥ 3 px
inside with ΔE00 > 5.

| chain | halo dark / white, edges | contamination, edges | strand recall | interior damage | keyResidue |
|---|---|---|---|---|---|
| `colorkey` (the previous `from-video`) | 8.39 / 7.48 | 44.9 % | 76.7 % | 0.7 % | 3.11 % |
| `colorkey` + `despill` (the previous `loop`) | 7.48 / 9.27 | 9.8 % | 76.7 % | **71.0 %** | 0 |
| **`unmix`** | **5.49 / 4.88** | 23.7 % | 74.5 % | 0.7 % | 0.72 % |
| upstream Python, `--spill small` | 5.82 / 5.09 | 21.8 % | 73.9 % | 1.1 % | 0.74 % |
| upstream Python, `--spill full` | 5.72 / 4.99 | 19.4 % | 73.9 % | 1.1 % | 0 |

"Edges" leaves out the wisp, which no chain keys right (a translucent subject
over the plate stays green at partial alpha; upstream's `--spill full` makes it
opaque grey-blue). `despill`'s low contamination is bought by recolouring the
whole picture — hence its interior damage and its white halo. On lossless
stills (a sheet on green), `unmix` gives 2.45 / 2.31 against `colorkey`'s
4.53 / 3.95 and the best strand recall, 90.7 % against 89.6 %. The JS port runs
at 5–6 ms a 512² frame against upstream's 50–90 ms in Python.

**Real clips: tanka's ten Seedance loops** (640², 97–121 frames, plates
`#00ee01`–`#00f500`), 24 frames each. No ground truth, so: `keyResidue`; the
rim — mean luma of the outermost opaque ring over the ring 3 px in (a green rim
lifts it a little, a black rim drags it down; tanka has no outline, so near 1
is right); the body — ΔE00 between keyed and source pixels ≥ 5 px inside; and
the yellow ring — the share of yellow-fur pixels within 4 px of the edge whose
alpha was lowered.

| chain | keyResidue | rim / 3 px in | body ΔE00 vs source | yellow ring |
|---|---|---|---|---|
| `colorkey` | 1.22–1.56 % | 0.83–0.88 | 0.45–0.53 | 0 |
| `colorkey` + `despill` | 0 | 0.60–0.65 | **7.7–12.0** (yellow fur → salmon) | 0 |
| **`unmix`** | **0** | **0.93–0.97** | **0.00** | **0** |
| upstream Python (mean tint) | 0 | 0.92–0.96 | 0.01–0.04 | **42–77 %** |

`from-video --frames 12` on tanka's walk: `keyResidue` 0.0158 with `--keyer
colorkey` (the 1 px rim `video-preview.md` measured on Lumi's portrait), 0 with
`unmix`. Alpha coverage is the same to 0.1 % across all three chains.

**Throughput**, 300 frames at 512² (tanka's walk looped to 300 frames, x264
CRF 16): the key stage alone, six rounds over two sessions on a shared
machine, went from 1.36–2.18 s (one ffmpeg pass: decode, colorkey, despill,
PNG) to 2.30–2.79 s (decode to raw RGBA 0.1–0.15 s, key 1.28–1.35 s — about
4.4 ms a frame — PNG 0.9–1.3 s): 1.22–1.96×, never past the 2× budget. The
whole `loop --width 512 --formats webm --seam-fill none --no-trim-holds`
command: 11.4–12.7 s on the previous script, 13.7–15.9 s with `unmix` (one
round of the previous script took 28.7 s under load).

**The edge read against the character** (a later round the same day; the
tables above predate it). An opaque edge pixel is now read against the
character's own colours beside it before the green-tint rule, floor shadow
that touches no part of the character is removed, and `keyFringe` counts
the opaque rim that is left. Fox walk (`from-video`, `--similarity` 0.22):
`keyResidue` 0.0119 → 0 and `keyFringe` 0.0231 → 0, no warnings; at 0.3 the
old measure read 0 while the new one reads `keyResidue` 0.0024 and
`keyFringe` 0.0252 and warns — a wider radius does not take the rim out. An
independent green check flagged 941 → 99 pixels; the real bench's fox
residue went 1.24 % → 0.00 %. Synthetic edges (ΔE00 halo): red 27.9 → 1.2,
blue 28.7 → 2.0, copper 21.7 → 1.8, purple 34.3 → 0.1; floor shadow left
behind 71.3 % → 3.6 %. Tanka's ten clips: residue 0.00 % before and after,
body ΔE00 0. The costs: tanka's yellow fur gets partial alpha on 5.8–12.2 %
of its edge pixels (was 0; it reads cleaner), strand recall 74.4 → 70.5 %,
subject lost 0.59 → 0.66 %, and the keyer is about twice as slow (5.4 →
11.3 ms a 640² frame; `from-video` 9.6 → 12.2 s).

**Where it does not apply.** A white, cream or grey plate has no hue to un-mix
and keeps `colorkey`. The Lumi attack clip is on cream `#ece9e1`: `colorkey`
there eats the cream hair and coat fills (a hair tip keys hollow) and leaves a
light rim on dark (outer-ring luma 3.1× the inner) — no colour key separates a
subject from a plate it shares colours with; that clip needs a matte.

**Lumi's white-plate `sheet-alpha.png` (BiRefNet) has no light halo** on
`#0A0A0D` at 8×. Its opaque interior matches `sheet-raw.png` to 2.6 levels
(palette noise), but its partially transparent pixels differ by ~97: the matte
already carries foreground colour, not a white blend. Known-background recovery
`F = (P − (1−α)·B)/α` (upstream `frames/cutout.py:212`) would over-darken them
(edge composite luma 26 → 8.8) and was not built.

## Measured: `breathe` on the Lumi stills (2026-09-27)

Two stills, both with a 233 px character: idle frame 00 (3/4 view, 186×252)
and the front view cut from `refs/turnaround.png` (keyed off its white plate
by a border flood, scaled to the same height, 132×249). 16 frames, 1 breath,
lag 0.10, through `breathe → align --x-from cell → gif --fps 8 → inspect`.

| still | depth | height (still 233) | head offset | head = still (smooth / pixel) | `bodyDrift` |
|---|---|---|---|---|---|
| idle 00 | 0.02 | 230–236 px | −3…+3 px | 16/16 / 0/16 (≤ 33 px differ) | 0.03 / 0.06 px |
| idle 00 | 0.03 | 229–237 px | −4…+4 px | 16/16 / 0/16 | 0.04 / 0.06 px |
| front | 0.02 | 230–236 px | −3…+3 px | 16/16 / 0/16 (≤ 2 px differ) | 0.06 / 0.03 px |
| front | 0.03 | 229–237 px | −4…+4 px | 16/16 / 0/16 | 0.04 / 0.03 px |

- **Anatomy.** Idle 00: axis x=92, neck y=99 (bottleneck), no face pair,
  torso half-width 31 px vs widest 82 px (the lantern). Front: axis x=66, neck
  y=89 (bottleneck), face y=60–80, torso 33 vs 58 px. Both rigid rows are the
  neck, and both put the lantern across it (the warning fires; the lantern's
  lower half swings ±1.2 px against its top at 0.02 on idle 00).
- **Depth.** Upstream's 0.06 default is tuned for 32–64 px pixel art. At our
  scale 0.05 already swings the height 227–240 px and the head −7…+6 px, which
  reads as bouncing (0.06: 226–241 px); 0.02 (the default) moves the head ±3 px,
  0.03 ±4 px.
- **Stair-steps.** Silhouette edge roughness in the stretched band (RMS second
  difference of each row's sub-pixel edge, y 110–220): idle 00 still 1.09,
  smooth 0.89 / 0.88, pixel 1.17 / 1.21 (0.02 / 0.03); front still 1.30,
  smooth 0.98 / 1.02, pixel 1.33 / 1.35. `pixel` adds 7–12 % roughness
  (duplicated rows); `smooth` is 18–24 % smoother than the still, i.e. slightly
  softer where the band is resampled at a fractional offset.
- **Parity with upstream.** `pixel` reproduces sprite-gen's Python bake
  (`bake_breathe_sequence`, CPython 3.14) with **0 differing pixels** in all
  64 frames above and at depth 0.06; the suite pins five of upstream's
  synthetic fixtures by golden hash. That needs the envelope's float sum to
  be CPython's compensated one: a plain sum differs in the last bits for 270
  of 426 rigid rows on these stills.
- **Cost.** 1.2 s for 16 frames at 186×252 in either mode, frame writes
  included (upstream's Python: 1.5 s).

## Measured: alignment and framing (2026-09-27)

Measured on the development machine with scripted runs (not shipped with
the mode). Clips from the wave-2 shoot of this round:
Lumi side-view walk (Seedance 2.5 i2v, 4 s, 480p; contact period 1.333 s,
sampled 1.5–2.833 s, 16 frames), Lumi first-last attack (4 s), Lumi jump from
a tight and from a `tall` frame (4 s each); tanka's front-view walk
(`video-seedance-1.mp4`, 1.417–3.333 s); the Lumi seed sheets; the wave-2 Lumi
idle sheets (4×4 first take and regenerated, 4 cols × 2 rows, 2×2) and a
pixel knight walk sheet (4 × 2). The synthetic walker is
`buildWalkerClip({ drift: 8 })` (192×128, stride 28 px, 1 s cycle).

**Alignment, per `--x-from`.** `headDrift` / source = `inspect`'s head-band
spread on the frames / on the cells with drift removed; head range and max
step are from the per-frame `headX`; torso = the synthetic walker's red torso
x, the ground truth.

| Clip | `feet` | `cell` | `trend` | `body` | `bbox` |
|---|---|---|---|---|---|
| synthetic side walk: torso range / sd | **21 / 7.82 px** | 15 / 4.61 (the slide) | 1.1 / 0.50 | 1.1 / 0.50 | 0.1 / 0.02 |
| synthetic: headDrift (source 0.17) | 7.46 — warns | 4.64 — warns | 0.53 | 0.55 | 0.17 |
| Lumi side walk: headDrift (source 0.77) | **7.45** — warns | 1.04 | 0.97 | 1.04 | 1.37 |
| Lumi side walk: head range / max step | **25.0 / 12.3 px** | 3.6 / 1.3 | 3.6 / 1.7 | 3.6 / 1.3 | 4.7 / 2.6 |
| tanka front waddle: headDrift (source 15.74) | 11.24 | 16.12 | 15.94 | 15.91 | 3.94 |
| tanka: max head step / wrap | **19.6** / 4.3 px | 13.2 / 4.3 | 13.2 / **0.3** | 13.2 / 0.3 | 3.2 / 3.3 |
| pixel knight walk sheet: headDrift (source 1.44) | **10.60** — warns | 1.46 | 1.85 | 1.75 | 1.29 |
| Lumi first-last attack: head range | 43.7 (lunge pinned) | 76.7 (as filmed) | 76.3, **21.7 px "drift" removed** | 76.7 (wrapDx 0) | — |

What it says: on a side-view walk, pinning each frame's feet moves the body by
about the stride (the onion skin of the 16 Lumi frames shows the head smeared
sideways under `feet`, sharp under `cell`/`trend`); `trend` keeps the filmed
placement and removed 1.1 px of slide (Lumi), 4.1 px (tanka) and 14.8 px
(synthetic). On tanka's front-view waddle the sway IS the motion: `trend` keeps
it (head range 45 px as filmed), closes the wrap (4.3 → 0.3 px) and removes the
19.6 px jump `feet` puts at the foot switch; `bbox` recentres the silhouette
and takes the waddle out. `trend` is wrong for one-shots: the attack's lunge
read as 21.7 px of drift in a clip whose ends coincide. The upstream ports
reproduce aldegad/sprite-gen's own fixtures exactly (`bodyWrapOffset` −6 / 8 /
−16 and the same ramps; `trendReference` to 1e-14), and `flatten`'s geometry
matches `pad_canvas` on 168 of 168 cases.

**Step checks.** Step = mean |RGBA| at 64×64 (this pipeline's area-averaged
reading).

| Sheet | In-row steps (median) | Boundaries, wrap (× in-row median) | Warns |
|---|---|---|---|
| Lumi seed idle 4×4 | 0.008–0.016 (0.0102) | 0.051 (5.0×), 0.041 (4.0×), 0.018 (1.8×); wrap 0.015 | row jump 03→04, 07→08; 6 near-duplicates |
| wave-2 idle 4×4, first take | 0.009–0.018 (0.0109) | 0.045 (4.1×), 0.039 (3.6×), 0.021 (1.9×); wrap 0.023 (2.1×) | row jump 03→04, 07→08; near-duplicate 14→15 |
| wave-2 idle 4×4, regenerated | 0.010–0.029 (0.017) | 0.029 (1.7×), 0.042 (2.4×), 0.025 (1.5×); wrap 0.043 (2.5×) | none — under the 3× bar; its largest step is the wrap (the lantern rises across all 16 frames and drops back) |
| wave-2 idle 4 cols × 2 rows, first take | 0.018–0.024 (0.0221) | 0.018; wrap 0.026 | none (regenerated: none) |
| wave-2 idle 2×2, first take | 0.036–0.046 | rows too short to judge | none (regenerated: none) |
| Lumi seed attack 4×4 (windup, overhead, strike, recovery, a row each) | 0.030–0.095 (0.0535) | 0.095 (1.8×), 0.102 (1.9×), 0.140 (2.6×) | none |

A one-pixel nudge of the same Lumi frame measures 0.014–0.021 (0.012–0.016
vertically), so a step under 0.01 is two frames closer than that. On clips the
check names holds: the first-last attack's 16 even samples land 6 near-duplicate
pairs (under `feet`) in its windup, impact and settle holds — the impact was
asked for ≈ 0.3 s and filmed 0.8 s. The step is measured at 64×64 of the
aligned cell, so the same frames read smaller steps in a wider cell (`cell`
keeps the 854 px clip width and names 8 pairs).
The seed idle's "zero warnings" of 2026-09-09 predates these checks.

**Framing and one size.** The same Lumi jump shot twice from a 360×494 still:
tight (the frame `flatten` made before `--room`), 53 of 97 frames touch an
edge and the head is cut off for 38, the character 0.979 of the frame height;
padded to 3:4 with 34 % headroom (`--room tall` on that still makes 561×748;
the clip came back 562×748), no frame touches an edge and the character is
0.647 of the height. Sampled 16 frames each: tight — 9 of 16 cells clipped
(16 of 16 once `--body-height 240` shrinks them ×0.32: a subject 1–3 source px
from the frame edge lands on the edge row after an area downscale); tall —
none. The standing heights in the two clips' first frames are 744 and 484 px;
`--body-height 240` scales them ×0.3226 and ×0.4959 and both motions' frame 00
stands 240–241 px, where unscaled they differ 1.54×.

**Cost.** `inspect` on 16 frames of 506×536 with 16 cells of 640² took
4.9–6.0 s before and 5.0–5.5 s after (three runs each, noise-bound);
`from-video --body-height` adds one keyed decode of the clip's first frame.

## Measured (pixel lattice, 2026-09-27)

What `pixel` / `run --pixel` does on generated pixel art, against what this
mode did before, and against the Python it was ported from. Machine: Apple
M4 Max, Node 25, ffmpeg 8.0; upstream aldegad/sprite-gen at `fbd1a08` on
Python 3.14 + Pillow 12.3. The scripts and 8× panels stayed on the
development machine.

**Synthetic ground truth.** A 30 × 44 logical walking character (16 frames,
a 1 px outline, 1 px eyes, a two-block gold buckle) drawn the way a model
draws "pixel art": a fractional pitch that differs per axis and jitters ±1.5 %
per frame, a sub-pixel phase, a slow sine wobble of the lattice (0.08 pitch),
area-filtered block edges, a Gaussian blur, a white plate, a JPEG round trip —
then keyed and sliced by `run` exactly as a real sheet is. Scored per truth
cell: **colour** = the output's cell within 40 of the truth on every channel
(and the same alpha side), after a monotonic alignment of output lines to
truth lines; **doubled / dropped** = output lines the alignment had to insert
or skip. (a) is today's pixel-art path, `run --scale 0.5 --nearest`, read at
each truth cell's centre through the known geometry — its most generous
reading; (a2) pushes today's tools to native resolution, nearest at
1/round(pitch). (b0) is the faithful port (commit `c97924e1`), (c) upstream's
Python on the same cells, (b) this port as shipped.

| Fixture | Method | Pitch error mean / max (px) | Colour | Doubled + dropped lines (frames hit) | Soft-alpha px | Colours / frame |
|---|---|---|---|---|---|---|
| 10.3 × 10.6, 4×4 of 512² | a today 0.5 nearest | — (fixed ×0.5) | 100 % | — (blocks 5.15 px wide) | 0.65 % | 1835 |
| | a2 nearest 1/10 | — | 98.9 % | 54 (16/16) | 0.19 % | 167 |
| | b0 = c upstream | 0.039 / 0.176 | 100 % | 7 (7/16) | 0 | 27 |
| | **b shipped** | 0.058 / 0.461 | 100 % | 9 (7/16) | 0 | 27 |
| 7.35 × 7.2 | a today | — | 100 % | — | 0.93 % | 1553 |
| | a2 nearest 1/7 | — | 95.0 % | 39 (16/16) | 1.49 % | 216 |
| | b0 = c upstream | **31.8 / 31.8** | **0.07 %** | 710 (16/16) | 0 | 18 |
| | **b shipped** | 0.091 / 0.721 | 99.3 % | 15 (10/16) | 0 | 30 |
| 6.2 × 6.3, blur 0.9, JPEG q6 | a today | — | 100 % | — | 1.35 % | 1468 |
| | a2 nearest 1/6 | — | 98.3 % | 53 (16/16) | 2.63 % | 232 |
| | b0 = c upstream | **25.3 / 27.4** | **0.33 %** | 680 (16/16) | 0 | 20 |
| | **b shipped** | 0.036 / 0.108 | 99.9 % | 23 (15/16) | 0 | 31 |
| 21.4 × 20.8, 2×2 of 1024² | a today | — | 100 % | — | 0.48 % | 2300 |
| | a2 nearest 1/21 | — | 97.4 % | 7 (4/4) | 0.67 % | 105 |
| | b0 = b = c | 0.314 / 0.861 | 98.6 % | 2 (1/4) | 0 | 32 |

- **Parity.** On all four fixtures (and on the real sheet below) the faithful
  port's logical frames *and* palette are pixel-identical to upstream's
  Python (16/16, 16/16, 16/16, 4/4, 8/8 frames, 0 differing pixels).
- **Why upstream fails at 7.35 and 6.2.** At 7.35 one frame of 16 read the
  5th harmonic (38.94); upstream's collapse filter anchors on the largest
  reading, so the fifteen true readings fell under its 60 % floor and all 16
  frames were cut at 38.94 (4 × 7 logical pixels). At 6.2, 10 of 16 frames'
  integer seeds landed on ~31 and the refinement only tried halves and
  thirds. Seeding fourths and fifths takes those misreadings from 10 → 0
  (6.2) and 4 → 2 (7.35); a ceiling that needs a quarter of the frames'
  support removes the single-harmonic takeover. Upstream's ported
  ground-truth suite passes unchanged with both.
- **What the change costs.** On the 10.3 fixture one frame's y axis now reads
  10.29 for a true 10.75 — 4 %, inside the 10 % family, so it is kept and the
  frame gains 3 rows (b0: it read 9.00, an outlier, and was cut at the
  consensus). That is the family guard's known trade (upstream keeps a 4 %
  own reading because forcing the consensus split an eye).
- **The lines that remain** are mostly one extra column at the silhouette
  edge: the blurred dark outline over white keeps a light halo that the white
  key leaves solid, and it becomes a logical column. It does not touch a
  truth cell (colour stays 100 % on the 10.3 fixture).
- (a) reads 100 % only because it is sampled at block centres: its blocks are
  5.15 px wide on the 10.3 fixture (so 5 or 6 px, unevenly), its edge is still
  soft and each frame carries 1.5–2.3 thousand colours. It is not pixel art at
  any size; (a2) shows what happens when it is pushed to one pixel per block.

**A real GPT-Image sheet** (sg shoot e6: GPT Image 2.5 Flare, 4×2 walk at
2048 × 1024 with the turnaround attached, BiRefNet heavy matte; the knight's
blocks are ≈ 8 px by eye, irregular, with half-blocks, and he stands ≈ 53 art
pixels tall where 32 was asked):

| | Detected pitch per frame (00–07) | Result |
|---|---|---|
| upstream / b0 (identical, 8/8) | 00–05 no grid; 06 3.00 × 4.00; 07 3.00 × 3.00 | consensus 3 × 4 → sprites 69–74 × 104–108 "logical" px: every 8 px block cut into ~2.5 × 2 |
| **b, no hint** | same readings | **refused**: "only 2 of 8 frames … read a pixel grid on their own; together the frames score best at 9 px (0.154); same-colour runs measure 7.1 × 7.0 px" |
| **b, `--pitch-hint 8`** | all 8 cut at 8 (06, 07 as outliers of the hint) | 27–28 × 52–54 logical px in every frame, cell 50 × 70, **0** semi-transparent px (today's frames: 6,831–8,254 each), 42–45 colours per frame (today: ≈ 23,000), palette 48, `inspect` lattice held; `run --pixel` 5.3 s |

- The pitch cannot be picked for this art automatically. At hints 6 / 7 /
  7.5 / 8 / 9 / 10 the frames stay consistent (heights 70–72 / 60–61 / 56–58
  / 52–54 / 46–48 / 42–43), the fractional lattice score peaks at *every*
  whole number (≈ 0.30 at 6, 7, 8 and 9), and the error of painting each
  logical pixel back over its block rises smoothly (13.9 → 15.2 → 16.1 →
  17.3 → 19.5 → 22.0 per channel) with no elbow. The hint is a person's
  reading; 8 matches the shoot's independent one (≈ 8 px, ≈ 53 px tall).
- At 8 px the knight reads as pixel art, but what the model drew at
  half-block scale merges: the bright gap between the two visor slits and the
  rivet ring's centre become one block. Whether that beats today's soft
  output is a judgement to make on the 8× panels, not a number — `--pixel`
  stays opt-in.
- The turnaround (2048², ≈ 18–22 px blocks by eye): 0 of 1 frame reads a grid;
  the pooled suggestion is 22 px; `--pitch-hint 22` gives an 89 × 63 sheet of
  three views.
- Calibration of "does it look like pixel art at all": the per-frame score
  pooled over a generation is 0.154 at 9 px on this walk, 0.072 on Lumi's
  attack, 0.067 on Fenn's idle, and **0.168** at 32 px on tanka's plush
  video walk (3 of its 16 frames even pass the single-frame 0.2 floor). No
  threshold separates them, which is why thin evidence is refused rather
  than guessed; the half-the-frames rule also refuses tanka.

**Time**, 4 × 4 sheet of 512² cells (the 10.3 fixture), three runs each:
`run` 8.2 s, `run --pixel` 8.9–9.1 s (+0.8 s). The lattice itself is 0.29 s
for the 16 frames (upstream's Python: 3.0 s on the same cells); a standalone
`pixel` on the cells directory is 3.0 s, almost all of it decoding and
writing 16 PNGs through ffmpeg.

## Measured: route A end to end (2026-09-27)

Two uploads through the documented sequence (`fit` → `add-ref` →
`breathe --name … | register-run`), defaults throughout (depth 0.02, 12
frames, 8 fps, smooth), on a machine with load average ≈ 12 from parallel
work.

| upload | cut-out | fitted still | cell | anatomy | warnings | wall time |
|---|---|---|---|---|---|---|
| Lumi idle frame 00 (186×252, already transparent) | none | 159×249, ×1 | 162×252 | neck y=96 (bottleneck), no face pair | the lantern crosses the rigid row (`--rigid-row 134` keeps it whole) | 8.2 s |
| a generated frog wizard, 1024×1536 opaque, cluttered workshop background | `remove-background.mjs` (BiRefNet heavy), 5.6 s | 221×496, ×0.372 (character 205×480) | 226×502 | neck y=221, face y=159–188 | none | 14.4 s |

- **Where the time goes.** `breathe --name | register-run` took 6.5 s (Lumi)
  and 7.1 s (frog): the bake is 1.2 s, `register-run` 1.0 s, and the rest is
  one ffmpeg process per frame read or written in align, pack, gif and
  inspect — the same cost `run` pays for a sheet. Under a load average of 45
  the same Lumi re-run took 38 s; nothing in the chain waits on the network.
- **Heights.** Lumi 233 → 230..236 px, head −3…+3 px; frog 480 → 475..485 px,
  head −5…+5 px; the head identical to the still in 12/12 frames on both.
  `bodyDrift` 0.0 px, `anchorDrift` y 0.
- **Premultiplied downscale, measured.** BiRefNet zeroes the colour under
  alpha 0 (mean RGB 1.3 over the frog's 1.14 M transparent pixels), so a
  straight-alpha area scale darkens the edge: against `fit`'s premultiplied
  result the 3,231 partly transparent pixels differ by a mean 5.2 and up to
  65 levels (ffmpeg `scale=…:flags=area` on the same crop).
- **Re-run.** Lumi again with `--rigid-row 134`: the record became
  `rigid row 134 (override)`, the lantern warning left `inspect.warnings`,
  and the open viewer showed the new frames with no reload.

## Measured: colourways and the declared height (2026-09-27)

The pixel knight walk (sg shoot e6: GPT Image 2.5 Flare, 4×2 at 2048 × 1024,
BiRefNet matte; blocks ≈ 8 px by eye, the figure 427 px tall where 32
logical px were asked for). Apple M4 Max, Node 25, ffmpeg 8.0; upstream
aldegad/sprite-gen at `fbd1a08` on Python 3.14 + Pillow 12.3. The scripts,
8× contact sheet and reports stayed on the development machine.

**The declared height.**

| Declared | Flags | Result |
|---|---|---|
| 32 (the prompt's) | — | refused: 2 of 8 frames read a grid; "the declared height (32 logical px) would mean 13.34 px blocks for frames 427 px tall, which the frames do not back" (pooled 9, runs 7.05 — 1.48× / 1.89× away) |
| 32 | `--pitch-hint 8` | 52–54 logical px tall; warned: "these frames snap to 53 … declared 32", with the three ways out |
| 53 | `--pitch-hint 8` | held (53, 52–54); `run --pixel` 4.1–4.3 s |
| 53 | — | cut at 8.06, the height's pitch, backed by pooled 9 (1.12×); held (53, 52–54); 4.23 s against 4.13–4.16 s with the hint — the second lattice pass costs ≈ 0.1 s. The sprites differ from the 8.00 cut by at most one logical pixel of width or height per frame |

So the height does the job `--pitch-hint` did whenever the sheet was drawn
at the declared height, and refuses — naming the numbers — when it was not.
The 25 % evidence window is set on this one real sheet: its loose readings
sit 12 % from the true 8 px, and a height 40 % off (32 for 53) is caught.
Synthetic generations (loose lattices with ±3 px jitter, half-block detail,
box blur of radius 4) all read their grid on their own, so they never reach
the stand-in; the CLI test pins it with one real-grid frame and two frames
of noise.

**Colourways.** `recolor-palette`: 48 colours in use (the whole pinned
palette), 1.0 s; its colours, order and counts are exactly upstream's
`extract_palette` on the packed sheet. Two colourways by hand from the swatch
sheet: `red-team` (the tabard's 7 blues → reds) and `blue-team` (the plume's
5 reds → blues, the cross's 2 golds → off-white).

| | red-team | blue-team |
|---|---|---|
| swapped | 602 px, 7 of 7 entries | 867 px, 7 of 7 entries |
| unmatched | 0 | 0 |
| left as they were | 41 colours, 6,958 px | 41 colours, 6,693 px |
| alpha bytes changed | 0 | 0 |

A map with one typo (`#1954be` for `#1954bf`) swaps only its other entry
(52 px) and warns `#1954be → #bf191f matched no pixel of walk`.

- **Parity with upstream's Python** (`recolor.py` `bake` on the motion's
  sheet): both colourways and a tolerance-24 colourway (481 px against the
  exact 466) decode to exactly upstream's pixels — 0 of 112,000 RGBA bytes
  differ — and every report number matches (per-entry hits, unused sources,
  passthrough count, pixels and the top 64). The PNG files themselves differ
  in bytes (ffmpeg's encoder, not Pillow's); decoded pixels are the contract,
  and a re-run of `recolor` writes byte-identical files.
- **Time**: `recolor` 3.87–3.92 s for both colourways over 8 frames
  (three runs). The swap is 0.12 ms per colourway; the rest is ffmpeg — 16
  frame PNGs, two packs, two GIFs, 8 decodes. Upstream's bake of the one
  sheet is 0.026 s, because it writes a sheet and nothing else.
- **Painted art** is refused: each Lumi frame (the seed) carries 248–252
  colours, and the 64 most used cover 53.4 % (idle) / 55.2 % (attack) of its
  visible pixels — an exact map would leave half of every edge behind.

## Measured: slicing, lift and sizes (2026-09-27)

Real inputs from this round's blind trials and paid shoots, copied (never
the owner's files) and measured on the development machine.

**Slicing by ink (`slice --auto`, `run`'s fallback).** The Kagari attack
sheet (blind trial G, GPT Image 4×4, 2048 px, the original before the
trial's hand re-layout): blank bands between rows at y 525–569, 1006–1056
and 1512–1553. Fixed grid: 8 of 16 cells clipped (00–03 by their boots
across y = 512, 06/07/08 by swords across column lines). `run` now sees ink
continue across those lines, slices by ink and reports 0 clipped: row cuts
551 / 1038 / 1536, every row 4 poses found without forcing, cells 561×530
(the 512 cell grown 27 / 0 / 22 / 18 px left / top / right / bottom), 0.1 s
for the segmentation on the 2048² sheet, `sheet-raw.png` byte-identical.
Upstream's width heuristic (a one-peak run over 1.45 median widths is two
poses) read row 0 as 5 poses (a 374 px lunge against a 257 px median) and
forced it; it is tried here only when the plain count falls short. The six
E1 Lumi idle sheets (4×4 / 4×2 / 2×2, two shoots each) find every row and
pose unforced and grow the cell 0 px — the same cells as the fixed slice;
none of them, nor the four G-4dir walks, the slime's two sheets or Kagari's
idle, crosses a grid line, so none falls back.

**`--y-from cell`.** E4 "roomy" jump (Seedance on green, 3:4 with 34 %
headroom), 12 frames 0.2–3.4 s: default lift all 0 (the jump plays as squash
on the ground); `--y-from cell` lift `[2, 0, 0, 132, 182, 192, 194, 190, 152,
2, 2, 2]` px — the 192 px the clip's own feet rise — in a 358×734 cell
(550 tall before). E4 "tight" (8 px pad): peak 72 px, but its head leaves
the top of the frame in 8 of 12 samples (clipped warnings), which is why
the tall room is the way to shoot a jump. The G-pixel slime's jump sheet
(2×4): lift `[3, 3, 0, 2, 12, 8, 5, 5]` logical px — the model drew no rise
in row 0 (the apex frame 03 sits 2 px up) and drew row 1 on a ground line
4–5 px higher, which the row warning names. The sheet has no usable jump
height; the lift has to come from the game or a redraw.

**`sizes`.** Standing heights as shipped: the G-4dir granny walks front 480
/ back 461.5 / left 461 / right 456.5 px — spread 5.1 %, warned (the trial's
reviewer measured 4.8 % on means and saw her change size turning); Kagari
idle 247 / walk 246.25 / attack 246 (first frame; its median 229 is the
lunges) — 0.4 %; the Lumi seed idle 234.5 / attack 227 — 3.3 %; the slime
idle 26.5 / jump 25 logical px — 6 %, but within two pixels of the lattice,
not warned. The 3.5 % bar sits between Lumi and the granny.
