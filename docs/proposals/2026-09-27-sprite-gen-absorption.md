# Sprite mode — absorbing aldegad/sprite-gen

Status: design brief, 2026-09-27. Branch `sprite/absorb-sprite-gen`. Mode
version after this work: **0.5.0**.

The owner shared `aldegad/sprite-gen` (Python CLI + Codex/Claude skill,
Apache-2.0, ~2k stars, 260 commits in six weeks) and asked for everything its
author treats as **reliable and useful** to be migrated into the `sprite`
mode, with explicit credit: a port says where it came from, an adaptation says
"inspired by".

Upstream pin for this round: commit `fbd1a08` (v2.11.0, 2026-09-26), cloned
read-only at
`/private/tmp/claude-501/-Users-pandazki-Codes-pneuma-skills/66fc6428-9b9b-4282-85c0-eeb2c675023e/scratchpad/sprite-gen`.

## Ground rules for every task

1. **No Python dependency.** Every port is Node built-ins + ffmpeg, the way
   `sprite-sheet.mjs` already is. Running upstream's Python in a throwaway
   venv *to compare outputs* is fine and encouraged
   (`scratchpad/sgvenv/` already has one); shipping it is not.
2. **Evidence before default.** Each mechanism lands with a before/after
   measurement on real assets (see *Test data*) or, where real assets cannot
   separate the candidates, on a synthetic ground truth. Numbers go into the
   skill reference's "Measured" section with date and asset. If a port does
   not beat what we do today on our assets, it ships off by default (or not
   at all) and the report says so — "the author says it works" is a reason to
   try, not a reason to ship.
3. **Credit.**
   - A **port** (same method, same constants, possibly re-expressed in JS):
     a header comment on the function or module —
     `Ported from aldegad/sprite-gen (Apache-2.0) <path>@fbd1a08: <what>. Changes: <what we changed>.`
     — and a row in `modes/sprite/NOTICE.md` (created by T12).
   - An **adaptation** (their idea, our design): `Inspired by aldegad/sprite-gen <doc or path>.`
     in the comment or the reference doc, plus a NOTICE row.
   - Code upstream itself ported from `gykim80/perfectpixel-studio` (MIT) —
     the run-length pitch estimator, alpha-centroid alignment, projection
     segmentation, the YCbCr matte — carries that credit too, copied from
     upstream's `NOTICE`.
   - Each worker lists its ports and adaptations in its final report so T12
     can write NOTICE.md without re-reading the diff.
4. **Scope of files.** Workers do **not** edit `skill/SKILL.md`,
   `manifest.ts` version/changelog, or `NOTICE.md` — the integration task
   (T12) writes those once, coherently. A worker documents its subcommand or
   flag in `skill/references/pipeline.md` (or the reference the topic lives
   in) and ends its report with a "SKILL.md needs" list. New logic goes in a
   **new sibling module** under `skill/scripts/` (like `rive.mjs`, `zip.mjs`),
   imported by `sprite-sheet.mjs`, so parallel workers touch as little of the
   5.9k-line file as possible.
5. **Never touch the owner's projects.** `~/pneuma-projects/**` and
   `~/pneuma-dev-scratch/**` are read-only inputs: copy what you need into
   your own scratch directory.
6. Existing invariants hold: `project.json` is written only by
   `sprite-project.mjs`; frames, atlases and previews only by
   `sprite-sheet.mjs`; the agent looks through the viewer before it claims.

## Test data (real, local)

| Asset | Path | What it is |
|---|---|---|
| Lumi | `modes/sprite/seed/lumi/` | Chibi anime, white-plate GPT Image sheets (idle 4×4, attack 4×4) + one Seedance clip |
| tanka | `~/pneuma-projects/sprite-20260923-1156/tanka/` | Plush character, 10 Seedance loops on chroma green (`video-seedance-1.mp4`), VEED mattes (`video-veed-3.webm`), Topaz 60 fps (`video-topaz-2.mp4`), `loop.webm`; front-facing waddle walk |
| tanka-connect | `~/pneuma-dev-scratch/2026-09-24/tanka-connect/tanka/` | Same, plus paid transition clips |
| Fenn | `~/pneuma-projects/sprite-20260910-0243/fenn/` | Owner's play session: idle, talking (H3 clip), thinking |
| Lumi attack clip | `~/pneuma-dev-scratch/2026-09-24/rive-try/lumi-src/motions/attack/video-seedance-1.mp4` | Seedance attack on green |

Missing and bought in wave 2 (paid): a **side-view** biped walk, a jump, a
timed-phase attack, a pixel-art sheet, a back-view walk.

## What we migrate

| # | Upstream mechanism | Upstream source | Kind | Task |
|---|---|---|---|---|
| 1 | Painted-key measurement (sample border, 8-wide colour bins, ≥12 %) | `frames/extract.py:350` | port | T1 |
| 2 | 3-pass RGB keyer: hard cut, soft un-mix `α'=α(1−k)`, `RGB=(obs−k·key)/(1−k)` near the cut, small tinted-cluster recolour | `extract.py:529` `remove_chroma_background`, `:82` `despill_color` | port | T1 |
| 3 | Leftover-key metric (visible key-tinted pixels) as an inspect warning | `frames/check_visible_magenta.py`, extract QA | inspired | T1 |
| 4 | Key-vs-subject distance check before flattening onto a plate | `gen/prepare.py:361` | inspired | T1 |
| 5 | Known-background colour recovery `F=(P−(1−α)B)/α` for white plates | `frames/cutout.py:212` | port (measure first) | T1 |
| 6 | Pixel-art lattice: per-frame pitch, cross-frame median, offset search, cut-line snap, dominant colour, binary alpha, shared palette pinned to disk, integer upscale | `extract.py:1332–2490`, `docs/pixel-unfake.md` | port | T5 |
| 7 | TexturePacker `anchor` + Aseprite JSON export (frameTags, per-frame duration) | `compose/export_aseprite.py`, `docs/engine-export.md` | port (format) | T2 |
| 8 | Projected ground shadow from the foot anchor | `effects/shadow.py` | port | T2 |
| 9 | Whole-clip period `P[L]=mean_j D[j,j+L]` on colour thumbnails, shortest dip within 15 % of deepest, ≥15 % below mean | `video/loop.py:192–313` | port (keep our window) | T3 |
| 10 | Gait floor / half-stride guard, P vs 2P ambiguity flag | `loop.py`, CHANGELOG v2.5.5 | port | T3 |
| 11 | One-shot (rest → action → rest) detector | `loop.py:335–411` | port | T3 |
| 12 | Absolute seam noise floor (0.005) under the seam/step gate | `loop.py:429` | port | T3 |
| 13 | Drift-trend removal instead of per-frame foot pinning (`feet` trend + `body` ramp) | `loop.py:516–578` | port | T4 |
| 14 | Per-state canvas room (tall jump, wide attack/gesture) + standing-height normalisation | `video/canvas.py:65`, `loop.py:590–669` | port | T4 |
| 15 | Adjacent-duplicate / row-boundary jump warning | `qa/inspect.py`, `qa/score.py` | inspired | T4 |
| 16 | Breathe: anatomy-aware procedural squash/stretch from one still | `effects/breathe.py`, `effects/anatomy.py`, `docs/breathing.md` | port (+ smooth mode for anti-aliased art) | T6 |
| 17 | Code-built sheet prompt (the agent supplies the action; code supplies identity/layout/guard clauses) | `gen/prepare.py:753–826` | inspired | T7 |
| 18 | Layout guide image sent with the prompt | `gen/prepare.py:728–750` | port (measure first) | T7 |
| 19 | Per-state "do not draw" guards; frame-count guidance | `prepare.py:71–136`, `docs/states-and-frames.md` | port (text) | T7 |
| 20 | Video prompt clauses: treadmill walk without naming limbs, planted idle with one blink, timed attack phases, no motion blur | `video/batch.py:59–127` | port (text) | T7 |
| 21 | First-frame-locked idle/attack clips (end image = start image) | `video/batch.py:41–49` | inspired | T7 |
| 22 | Direction anchors: one single-pose anchor per direction, mirror contract, handed-prop side lock | `docs/directional-anchor-workflow.md`, `gen/gen_set.py:222` | inspired | T8 |
| 23 | Frame curation: drop / reorder / hold / nudge, candidate takes, rerolls append | `curate/curation.py`, `serve/curator/`, `effects/reroll.py`, `docs/curation.md` | inspired | T9 |
| 24 | AI in-between: image model draws the frame between two with both attached | `effects/interpolate.py`, `docs/frame-interpolation.md` | inspired | T9 |
| 25 | Recolor: exact hex map + tolerance mode, report of unmatched entries | `effects/recolor.py`, `docs/recolor.md` | port (palette-quantised art) | T11 |

## What we do not migrate, and why

- **Palette decontamination** (`frames/decontam.py`) and the **YCbCr matte** —
  upstream ships both off by default (decontam after a magenta regression; its
  benchmark harness is not in the repo). Our paid VEED matte already measures
  zero green on loops.
- **Facing detector** (`gen/facing*.py`) — upstream says it "can be wrong even
  at high confidence" and publishes no accuracy; our capture-and-look step
  covers it.
- **Score + correction loop** — canned hints, no identity metric. The two
  useful signals (adjacent duplicates, row consistency) come over as T4's
  warning.
- **Layer tracks** — every landmark hand-declared per frame; Rive covers state
  switching for us.
- **Scene, background-tile, stride measurement** — composition and level art
  belong to other modes.
- **Grok-specific levers** — 2 s clips (Seedance's minimum is 4 s), magenta
  painting, request staggering.
- **Magenta plates / automatic key choice** — our sheets are white + BiRefNet
  and VEED's green-screen endpoint is green only; T1 warns instead of
  switching plates.

## Waves

| Wave | Tasks | Depends on |
|---|---|---|
| 1a (now, parallel) | T1 chroma · T2 engine export · T3 cycle analysis · T4 align & framing · T5 pixel lattice · T6 breathe core | this document |
| 1a′ (now, parallel) | D1 schema design (architect) | this document |
| 1b | T7 generation · T8 directions · T9 curation · T10 breathe wiring · T11 recolor | D1 (T7–T10), T5 (T11) |
| 2 | E1–E7 paid validation runs, numbers into references | 1a/1b merged |
| 3 | T12 integration (SKILL.md, manifest 0.5.0, NOTICE.md, `inspiredBy`, viewer surfacing) → review → gates → blind cold-start trial → PR | all |

## Tasks

Every task: worktree `.claude/worktrees/sg-<task>` on branch
`sprite-sg/<task>` from `sprite/absorb-sprite-gen`; gate
`bun test modes/sprite` + `bun run typecheck`; commit with conventional
messages; report ports/adaptations, measured numbers, and "SKILL.md needs".

### T1 — Chroma keyer with un-mixing, key-residue metric

Replace ffmpeg `colorkey` (+ `despill`) in the video paths — `from-video`
(`sprite-sheet.mjs:2509-2537`), the free `loop` / `transition` key chain
(`loopKeyChain`, `:2790`) and `contact`'s masks where it matters — with a JS
keyer in a new `skill/scripts/chroma.mjs`:

- measure the painted key from the frame border (upstream `extract.py:350`),
  per clip on more than frame 0;
- hard cut within the key radius, un-mix the band near the cut, recolour small
  tinted clusters, zero RGB under α = 0 (`remove_chroma_background:529`);
- a `keyResidue` measure (visible key-tinted pixels and partial-alpha tinted
  pixels) reported by `inspect`, `from-video`, `loop`, `transition`, with a
  warning threshold;
- a subject-vs-plate distance check `flatten` runs before it paints the
  plate (warn when any subject pixel sits inside the key radius).

Evidence, before switching the default: a synthetic ground-truth scene (draw
at 4×, downsample, place on a painted green, round-trip through x264 CRF 16
yuv420p with our ffmpeg) scored on contamination / halo / thin-strand recall
for `colorkey`, `colorkey+despill`, the new keyer, and (optional, a few
cents) VEED green-screen; then the same comparison on tanka's and Lumi's real
green clips with `keyResidue`. The verified defects to beat: `from-video`'s
1 px dark-green rim (2.8 % of opaque pixels, `video-preview.md:655`) and the
free loop path's black rim (despill turns `(0,145,0)` at α 148 into black).
Throughput check: 300 frames at 512² must stay within 2× today's wall time.

Also measure (do not build unless it shows): whether Lumi's white-plate
`sheet-alpha.png` has a light halo on a `#0A0A0D` background; if it does, add
the known-background colour recovery (`cutout.py:212`).

### T2 — Engine export: anchor, Aseprite, shadow

- `atlas.json` frames carry `anchor` equal to `pivot` (PixiJS 8 reads only
  `anchor`, `Spritesheet.mjs:119`; Phaser reads `anchor || pivot`).
- `sprite-sheet.mjs export --format aseprite` for a motion, and for the whole
  character (one sheet, `frameTags` per motion, per-frame `duration`, numeric
  frame keys `"0"…`) so Phaser's `createFromAseprite` builds every
  animation. Shape from upstream `compose/export_aseprite.py`. Register
  through the existing `register-export` path; the Export tab lists it.
- `export --shadow` for video formats (and a separate shadow sheet for
  engines): alpha silhouette squashed and sheared about the foot anchor,
  blurred (`effects/shadow.py` defaults: squash 0.25, shear 0.8, opacity 0.4,
  blur 3).
- Evidence: a test that loads our atlas with PixiJS's real `Spritesheet`
  parser and checks the anchor, and a headless Phaser page that plays Lumi
  idle through `load.aseprite` with a screenshot of where the feet land
  (engine packages go in scratch, not in `package.json`, unless a test needs
  them — then as devDependencies with a reason).

### T3 — Cycle analysis: period, half-stride, one-shot, seam floor

In a new `skill/scripts/cycle.mjs`, used by `contact`, `loop` and
`transition`:

- colour-aware thumbnails at the **source** fps (today: alpha only, 12 fps);
- whole-clip lag profile `P[L]`; the period is the shortest dip within 15 %
  of the deepest, and it must sit ≥ 15 % below the mean or `contact` says
  there is no cycle; keep **our** 0.4–2.5 s window (upstream's biped window
  refuses the tanka walk: its true dip is at 1.875 s);
- half-stride guard: a candidate period whose double has a comparable dip is
  flagged (`loops[].ambiguous` with both lengths) instead of silently taking
  the half;
- `oneShots[]`: rest → action → rest windows (`loop.py:335-411`), because
  Seedance's 4 s minimum makes repeated strikes and hops common;
- an absolute seam floor (0.005) under `seam ≤ 2 × step` and under
  `planSeamFill`, and colour in the seam measure so a blink counts.

Evidence: tanka's 10 loops (seam-fill fired on 6 at near-zero seams; `reading`
false-warns at 0.001 vs 0.0003), the tanka walk (true period 1.875 s), the
Lumi attack clip (one-shot), and the side-view walk from wave 2 for the
half-stride guard. Report old vs new `contact` output per clip.

### T4 — Alignment and framing

- `align --x-from trend`: fit a line to body-centre x across the frames and
  remove only that trend (every frame stands on the average foot line), plus
  the `body` variant: register the top 60 % of the last frame against the
  first (±24 px, whole pixels) and ramp `round(dx·k/L)`. Upstream warns that
  per-frame foot pinning — our `--x-from feet` — lurches by about a stride
  on a lifting leg. Also make `bodyDrift` measurable independently of the
  alignment it judges (today it is measured on the aligned feet and reads ~0
  by construction).
- `flatten --room tall|wide|square` and explicit `--headroom/--lead/--trail`
  fractions (upstream `canvas.py:65`: jump 3:4 with 34 % above; attack 16:9
  with 35 % above, 28 % lead, 20 % trail; gestures 16:9 with 30 % lead), and a
  standing-height normalisation across a character's motions measured on each
  clip's first frame.
- `inspect` warnings: adjacent near-duplicates (mean RGBA diff at 64² < 0.01)
  and row-boundary jumps (boundary step ≫ in-row median step). Lumi idle
  measures in-row 0.007–0.016 vs boundaries 0.048 / 0.040.
- Evidence: synthetic lifting-leg walker for trend vs feet; tanka walk and the
  wave-2 side walk; Lumi idle for the duplicate warning.

### T5 — Pixel-art lattice

Port the Backbone Lattice (`extract.py:1332–2490`, `docs/pixel-unfake.md`) to
`skill/scripts/pixel-lattice.mjs`: per-frame pitch detection (2–48 px,
sub-pixel), median across one generation's frames (a frame keeps its own
pitch only within 10 %), offset search, cut-line snapping (min 0.6× pitch),
dominant colour per block biased toward dark detail, binary alpha, one run-wide
palette pinned to disk (48 colours), optional outline darkening, integer
upscale with grid-snapped placement. Entry: `run --pixel` / `pixel <framesDir>`,
automatically suggested when `character.style` says pixel art. Port upstream's
ground-truth pitch tests. Evidence: upstream's own fixtures, then a
pixel-art sheet from wave 2 compared at 8× against today's
`pack --scale 0.5 --nearest`.

### T6 — Breathe core

Port `effects/breathe.py` + `effects/anatomy.py` to
`skill/scripts/breathe.mjs`: anatomy detection (axis, neck/shoulder row,
face pair, rigid row, appendages), the wave `0.86·sin2πt + 0.14·sin4πt`, lag
/ taper / foot params, a **whole-pixel** mode for pixel art (upstream's) and
a **smooth** mode (bilinear, premultiplied) for anti-aliased art, plus
manual overrides for the rigid row / axis / torso width. Our defaults start
from the measurement: depth 0.05 swings Lumi 227–240 px (too much at 256 px),
0.02 keeps 231–236 px. CLI: `sprite-sheet.mjs breathe <still> --out <framesDir> --frames N --depth D [--mode smooth|pixel]`,
writing frames that the existing `pack`/`gif`/`inspect` steps consume.
Registration as a motion source is T10 (needs D1). Evidence: Lumi turnaround
front view and idle frame 00 at 0.02/0.03, side by side with the generated
idle, for the owner to judge.

### D1 — Schema design (architect)

One design for every sidecar addition this round, so the concepts have one
authority: breathe as a motion source; per-motion direction, direction
anchors and mirrored motions; frame curation (drop / reorder / hold / nudge),
who writes it and how a re-run treats it; candidate takes and AI in-betweens;
the recorded sheet-prompt parts; the pixel palette record. Output: a design
note appended to this document, with a recommendation for the viewer-edit
question (viewer writes a record directly vs. structured request to the
agent).

### T7–T11

Specified after D1 lands; see the appended design note.
