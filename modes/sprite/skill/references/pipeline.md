# Pipeline reference

Two scripts do all the mechanical work. `sprite-sheet.mjs` owns pixels;
`sprite-project.mjs` owns `project.json`. Neither one ever calls the other, so
a pipeline run and its bookkeeping fail independently and you can see which
half broke.

Both are plain ESM run with `node`, take `--json`, print `--help`, write
atomically, and put progress on stderr so `--json` stdout stays parseable.
Both need `ffmpeg` and `ffprobe` on PATH.

```bash
cd {SKILL_PATH} && node scripts/sprite-sheet.mjs <subcommand> [flags] --json
cd {SKILL_PATH} && node scripts/sprite-project.mjs <subcommand> --dir <characterDir> [flags] --json
```

## `sprite-sheet.mjs`

### `probe <image>`

`{ width, height, hasAlpha, alphaCoverage, cornerColor }`. `hasAlpha` is true
when any pixel's alpha is below 255; `alphaCoverage` is the fraction of pixels
above the alpha threshold; `cornerColor` is the median of the four 8×8 corner
patches as `#rrggbb`. Run this on every freshly generated sheet — it decides
whether you need the keying step, and it costs nothing.

### `key <in> --out <png> [--color auto|#rrggbb] [--similarity 0.12] [--blend 0.05]`

ffmpeg `colorkey`. `auto` uses the probed `cornerColor`. Reports
`alphaCoverage` after keying, so you can tell a successful key (coverage drops
to roughly the sprite's share of the image) from one that ate the character
(coverage near zero) or did nothing (coverage still ~1.0). Raise
`--similarity` when a gradient background survives; lower it when the
character's own colours start disappearing.

### `flatten <in> --out <png> [--bg #ffffff]`

Composite onto a solid colour. Video models mishandle alpha — flatten frame 00
before handing it to `seedance-video.mjs --image`.

### `slice <sheet> --rows R --cols C --out <dir> [--margin px] [--gutter px]`

Cuts row-major into `<dir>/NN.png`, two-digit zero-padded. Cell size is
`(W − 2·margin − (C−1)·gutter) / C`, floored; a non-integer cell is reported so
you know a pixel column was dropped. Output keeps alpha.

### `align <framesDir> --out <dir> [--anchor bottom|center] [--cell auto|WxH] [--pad 8] [--smooth]`

The step that turns sixteen pictures into an animation. Computes each frame's
alpha bounding box, then crops to the bbox and pads onto a transparent cell so
the anchor point lands at the same coordinate in every frame:

- `bottom` — anchor is the bbox's bottom-centre; x centred, y at `H − pad`.
  Use for anything standing on the ground.
- `center` — anchor is the bbox centre; used for airborne motions (jump,
  float) where the feet are not the reference.

`--cell auto` is the max bbox width/height across frames plus `2·pad`, rounded
up to an even number. `--smooth` replaces each frame's anchor x with the
3-frame median, which removes single-frame jitter without flattening a real
lateral movement (y is untouched for `bottom` — vertical bounce is the motion).
Empty frames come out as fully transparent cells and are reported.

### `pack <framesDir> --out <sheet.png> --atlas <atlas.json> --name <motionId> --fps N [--loop] [--anchor bottom|center] [--cols C] [--scale 0.5] [--nearest]`

Tiles the aligned frames row-major into one image and writes the atlas.
`--scale` resizes every frame first; add `--nearest` for pixel art so
downscaling stays hard-edged. No margin, no gutter — a game engine reads the
rects from the atlas, and gutters only cost texture memory.

### `gif <framesDir> --out <preview.gif> --fps N [--loop|--no-loop] [--webp <preview.webp>] [--width W]`

Palette-based GIF with transparency preserved (`palettegen
reserve_transparent=1`, `paletteuse alpha_threshold=128`). `--loop` writes an
infinite loop, `--no-loop` plays once. `--webp` additionally writes a lossy
animated WebP with alpha when the libwebp encoder is present; when it is not,
the JSON carries a warning instead of failing.

### `inspect <motionDir> [--anchor bottom|center]`

The deterministic quality gate. Writes `<motionDir>/inspect.json` and prints
the same object.

| Field | Meaning |
|---|---|
| `frameCount` | Frames found in `frames/` |
| `cell` | `{ width, height }` of the aligned cell |
| `anchorDrift` | Std-dev in px of the anchor point across frames |
| `maxJump` | Largest anchor displacement between consecutive frames |
| `scaleDrift` | `(max bbox height − min bbox height) / mean` |
| `emptyFrames` | Indices with no pixel above the alpha threshold |
| `warnings` | Human sentences — read these, they name the fix |

Warning rules and what each one means:

| Warning | Trigger | What to do |
|---|---|---|
| "frame NN is empty" | No pixel above threshold | A cell the model left blank. Edit that one cell (see `prompting.md`) and re-run. |
| "frame NN is nearly empty" | Alpha coverage < 0.02 | Usually the key ate the character. Re-key with a lower `--similarity`. |
| "anchor jumps between frames NN and MM" | `maxJump > 0.08 · cellWidth` | Try `align --smooth`, or the other anchor. If it persists, the pose genuinely teleports — fix the drawing. |
| "character scale varies across frames — regenerate with a fixed-scale instruction" | `scaleDrift > 0.15` | Not fixable by alignment. Regenerate with the identical-height clause from `prompting.md`. |
| "cell NN is clipped — the drawing leaves its grid cell" | Bbox touches the cell edge before alignment | The pose is bigger than its cell. Regenerate with the "stays inside its own cell" clause. |

### `run <sheet-raw> --rows R --cols C --out <motionDir> --name <motionId> --fps N [flags]`

The whole chain in one call: probe → key (when the sheet is opaque and `--key`
is not `none`, writing `sheet-alpha.png`) → slice → align → pack → gif (+ webp)
→ inspect. Accepts every flag the individual steps take (`--loop`, `--anchor`,
`--key auto|#rrggbb|none`, `--cell`, `--pad`, `--smooth`, `--scale`,
`--nearest`, `--margin`, `--gutter`).

Emits one JSON object:

```json
{ "motionDir": "...", "sheetRaw": "...", "sheetAlpha": "...",
  "frames": ["..."], "sheet": "...", "atlas": "...", "gif": "...",
  "webp": "...", "inspect": { }, "cell": { "width": 0, "height": 0 },
  "warnings": [] }
```

Save that JSON — `sprite-project.mjs register-run` consumes it verbatim. The
input sheet is never moved.

## `sprite-project.mjs`

Every subcommand takes `--dir <characterDir>` and prints the resulting motion
or project summary with `--json`. Writes are atomic; unknown top-level fields
in `project.json` are preserved; asset ids are validated unique. Timestamps
come from `Date.now()` unless `--at <ms>` is passed.

| Subcommand | Purpose |
|---|---|
| `init --name "Lumi" [--description] [--style] [--cell 256x256] [--facing right]` | Creates `project.json`. Fails if one exists unless `--force`. |
| `add-ref --id turnaround --file refs/turnaround.png --role turnaround [--label] [--prompt] [--model] [--from <assetId,…>]` | Registers `ref-<id>` with a `generate` edge. |
| `add-motion --id idle --label Idle --rows 4 --cols 4 --fps 8 [--loop] [--anchor bottom] [--prompt] [--status planned]` | Adds the motion. Call it before you generate, so the stage shows a placeholder. |
| `set-motion --motion idle [--label] [--fps] [--loop\|--no-loop] [--anchor] [--prompt] [--status] [--notes]` | Edits motion metadata. `--notes` is where a failure reason belongs. |
| `set-sheet --motion idle --file motions/idle/sheet-raw.png --from ref-turnaround[,…] [--model] [--prompt] [--background transparent] [--status processing]` | Registers `<motion>-sheet-raw` with a `generate` edge whose `params.inputs` lists every reference. Re-running replaces the previous raw sheet and its edges, keeping the id stable. |
| `register-run --motion idle --run <run.json \| ->` | Consumes `sprite-sheet.mjs run` output: registers the alpha sheet (if any), every frame, the packed sheet, atlas, gif and webp with `derive` edges; **removes** the previous frame assets and edges for that motion; copies `inspect` into the motion; sets status `ready`. |
| `add-video --motion idle --file motions/idle/video-seedance-1.mp4 --model seedance-2.5 --mode i2v --from idle-frame-00[,idle-frame-15] [--prompt] [--duration 4] [--status generating]` | Registers `<motion>-video-<n>` (n is the next free number) with a `generate` edge. |
| `set-video --motion idle --video <id> --status ready\|failed [--notes]` | Closes out a video after the render returns. |
| `remove-motion --motion idle` | Removes the motion, its assets and its edges. Files on disk are left alone; the orphaned paths are printed so you can delete them deliberately. |
| `show [--motion id]` | Compact summary: name, refs, motions with status / grid / fps / frame count / warnings. The cheapest way to re-orient at the start of a turn. |

## `atlas.json`

TexturePacker JSON-hash, which Phaser and PixiJS both load without a
converter.

```json
{
  "meta": { "app": "pneuma-sprite", "version": 1, "image": "sheet.png",
            "size": { "w": 1024, "h": 1024 }, "scale": 1,
            "fps": 8, "loop": true, "anchor": "bottom" },
  "frames": {
    "idle_00": {
      "frame": { "x": 0, "y": 0, "w": 256, "h": 256 },
      "rotated": false, "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 256, "h": 256 },
      "sourceSize": { "w": 256, "h": 256 },
      "pivot": { "x": 0.5, "y": 1.0 },
      "duration": 125
    }
  },
  "animations": { "idle": ["idle_00", "idle_01"] }
}
```

- Frame keys are `<motionId>_NN`; `animations[<motionId>]` lists them in
  playback order.
- `pivot` is `{0.5, 1.0}` for `anchor: bottom`, `{0.5, 0.5}` for `center`.
- `duration` is `round(1000 / fps)` in milliseconds.
- Frames are laid out row-major, `cols` per row, no margin and no gutter.
