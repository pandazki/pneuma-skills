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
| 25 | Recolor: exact hex map + tolerance mode, report of unmatched entries | `effects/recolor.py`, `docs/recolor.md` | port (palette-quantised art) | T11 |

## What we do not migrate, and why

- **Frame curation, candidate takes, AI in-betweens** (`curate/`,
  `serve/curator/`, `effects/reroll.py`, `effects/interpolate.py`) — the
  owner's call (2026-09-27): our users are not animators; a frame editor is a
  professional's tool. Bad frames stay the agent's job (fix-alignment,
  regenerate), and the round spends its product effort on routes instead.
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

## Routes, not features

Owner direction (2026-09-27): "功能不用多，但是要在产品上给用户不同的路线思考好使用过程"
— few features, but a well-thought usage process for each route a user
takes. Everything above is plumbing; what the user meets is a route chosen by
what they are making. The skill (T12) is organised around these routes, each
with its opening question in plain language (no grid / fps / anchor jargon),
the defaults it implies, the cost and wait said up front, where to look in the
viewer at each step, and the finish line (what they download). Working set,
refined by D1:

| Route | For | Implies |
|---|---|---|
| Game character | a move set for an engine | sheet or video per motion, engine export (Aseprite for Phaser, atlas with anchor for Pixi), shadow optional |
| ↳ pixel-art game | the same, in pixel art | pixel lattice on, palette pinned, recolor variants |
| ↳ top-down game | four facings | direction anchors, mirrored side |
| Make my image move | someone with one picture and no budget | upload → breathe idle (free, seconds) → one video motion if they want more |
| UI loop | a living icon or element | workflow E (unchanged) |
| Interactive mascot | a character that switches states in an app | loops + transitions → Rive (workflow F) |

Every route ends with a blind cold-start trial in wave 3.

## Waves

| Wave | Tasks | Depends on |
|---|---|---|
| 1a (now, parallel) | T1 chroma · T2 engine export · T3 cycle analysis · T4 align & framing · T5 pixel lattice · T6 breathe core | this document |
| 1a′ (now, parallel) | D1 schema design (architect) | this document |
| 1b | T7 generation · T8 directions · T10 breathe wiring · T11 recolor | D1 (T7, T8, T10), T5 (T11) |
| 2 | E1–E7 paid validation runs, numbers into references | 1a/1b merged |
| 3 | T12 integration (SKILL.md organised by user route, manifest 0.5.0, NOTICE.md, `inspiredBy`, viewer surfacing) → review → gates → blind cold-start trial per route → PR | all |

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

The user routes first (see *Routes, not features*): the opening questions,
defaults, cost lines, viewer touchpoints and finish line of each, and whether
the route is recorded on the character. Then one design for every sidecar
addition this round, so the concepts have one authority: breathe as a motion
source; per-motion direction, direction anchors and mirrored motions; the
recorded sheet-prompt parts; the pixel palette record. Output: a design note
appended to this document.

### T7, T8, T10, T11

Specified after D1 lands; see the appended design note. (T9, frame
curation, was dropped by the owner on 2026-09-27.)

---

# Appendix — D1 design note (architect, 2026-09-27)

Design note for `docs/proposals/2026-09-27-sprite-gen-absorption.md`. Scope
after the owner's 2026-09-27 change: **no frame curation, no candidate takes,
no AI in-betweens.** Consequences: `saveRoster` keeps throwing, the viewer
stays a reader, the hosted player (`editing === false`) is unaffected, and
`regenerate-motion` keeps replace-in-place semantics. Everything below is
mode-local: no `core/types` change, no new Source kind, no new ViewerAddress
key, no new action or command.

### 1. Routes — what the user is making

Problem: the round adds six capabilities; a user should never have to know
them. The agent picks one of four routes from the opening message (or asks
one plain question when unclear: *"a game character, a looping animation
for a page, a mascot for an app, or bring a picture to life?"*). A route
fixes the defaults, the up-front questions, the price the user is told, and
the finish line. Jargon (grid, fps, anchor, cell) never reaches the user.

| Route | For | Up-front questions (plain) | Defaults implied | Told cost / time | Finish line |
|---|---|---|---|---|---|
| **G · Game character** | someone building in Phaser / Pixi / Godot / Unity, or wanting a sheet | 1. "What must it do — stand, walk, attack, jump? Must it face several directions?" 2. "Roughly how big on screen, and is it pixel art?" | style sentence from the character interview; cell 256 (pixel: `pixel.logicalHeight`, lattice on every run); motion set from Q1; source `sheet` for idle/attack/poses, `video` offered for walk/run; exports `sheet+atlas`, Aseprite JSON, PNG sequence | sheet motion ≈ 1 min, image cost only; video motion ≈ $1, 5–7 min; 4-direction: three generated + one mirrored per state, plus one anchor per direction (≈ 35 s each) | Export tab → sheet + atlas.json (built by every run), Aseprite JSON, PNG sequence |
| **G-pixel** (sub-route) | pixel-art game | Q2's "pixel art" + "how tall in pixels" | `character.pixel = { logicalHeight }`; first run pins `palette.json`; nearest-neighbour everywhere; Rive lossless | same as G | same as G at integer scale; recolor (T11) from the palette |
| **G-4dir** (sub-route) | top-down / RPG | Q1's "directions" | one anchor ref per direction; ids `<state>-<direction>`; `facing` side generated, other side `mirror`ed unless `asymmetric` | ×3 generated per state | same as G; tags per motion |
| **L · UI loop** (workflow E, unchanged) | frontend / product | the five answers in one message (subject, verb, style, duration, width) + budget | `kind: "loop"`, brief gate | ≈ $1.2–1.3, 5–7 min | Loop tab → webp / apng / webm / lottie |
| **M · Mascot for Rive** (E×N + F, unchanged) | app team switching states from code | "Which 2–4 states does the app switch between, and how large?" + budget | loops + transitions, hub idle | N × ≈ $1.2 + transitions | Export tab → `.riv` with preview |
| **A · Bring my picture to life** (new) | anyone with a drawing / character image | none beyond the image; optional "subtle or noticeable?" | `add-ref --uploaded` → `remove-background` → `breathe` idle: smooth mode, depth 0.02 (0.04 noticeable), 16 frames @ 8 fps, cell = the image's box + pad (≤ 512) | free, seconds | GIF tab → webp / gif; Export → apng. Funnel: "want it to walk?" continues as G with the same image (A′ + anchors) |

Where the user looks at each step (unchanged surfaces): refs rail as
references and anchors land; motion rows moving `planned → generating →
processing → ready`; the stage playing; GIF / Loop / Atlas tabs; Export tab
at the finish line. The agent still looks before it claims (`inspect`,
`get-playback-state`, `capture`).

**Record the route?** Yes, minimally: `character.purpose?: "game" | "loop" |
"mascot" | "animate"`. It earns its place with three consumers and one
writer: (1) `extractContext` prints `Purpose: game` so a later session does
not re-ask; (2) the rail's `noMotions` hint names the right next ask per
purpose; (3) the Export tab orders its families by purpose (`game`: frames →
video → rive; `mascot`: rive → video → frames; else unchanged). Absent =
today (the agent infers or asks). Sub-routes are *not* enum values: pixel is
recorded by `character.pixel`, directions by the anchor refs. Writer: `init
--purpose` and a new `set-character` subcommand (also the first writer of
`description`/`style`/`facing` after init — a real gap today).

Viewer legibility, minimal: the empty-state body lists the four routes in one
sentence each; `noMotions` varies by purpose; export family order by purpose
(one pure function in `panel.ts`). No chips, no wizard, no new component.

#### 2. Sidecar additions (one authority per concept)

```ts
// domain.ts — all optional; absent = 0.4.x behaviour
export type CharacterPurpose = "game" | "loop" | "mascot" | "animate";
export const DIRECTIONS = ["front", "back", "left", "right",
  "front-left", "front-right", "back-left", "back-right"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface PixelSpec {
  logicalHeight: number;   // character height in logical px the lattice snaps to
  palette?: string;        // asset id `<character>-palette` (text, uri palette.json); absent until pinned
  colors?: number;         // size it was pinned with
}
export interface SpriteCharacter {
  /* existing */ purpose?: CharacterPurpose; pixel?: PixelSpec;
  asymmetric?: string;     // side-specific features that must not flip; gates `mirror`, feeds the prompt guard
}
export type SpriteRefRole = "turnaround" | "portrait" | "expression" | "anchor" | "custom";
export interface SpriteRef { /* existing */ direction?: Direction }  // required when role === "anchor"

export type MotionSource = "sheet" | "video" | "breathe" | "mirror";
export interface BreatheRecord {
  still: string;           // asset id the frames were warped from
  depth: number; depthX?: number; breaths: number; lag: number;
  mode: "smooth" | "pixel";
  anatomy?: { rigidRow: number; axisX: number; from: "detected" | "override" };
}
export interface PromptParts {
  builder: string;         // e.g. "sheet-prompt/1": the code version that assembled `prompt`
  action: string;          // the agent's action / phase plan, verbatim
  guards: string[];        // clause ids included: "walk-gait", "no-shadow", "direction:front-right", …
  guide?: { rows: number; cols: number; cell: { width: number; height: number }; safeMargin: { x: number; y: number } };
}
export interface Motion {
  /* existing */ source?: MotionSource; direction?: Direction;
  mirrorOf?: string;       // source "mirror": the motion whose frames these flip
  breathe?: BreatheRecord; // source "breathe"
  promptParts?: PromptParts; // present when `prompt` came from sheet-prompt
}
// InspectSummary: pitch?: number  — pixel runs, measured block pitch in source px
```

Writers (unchanged invariants: `project.json` only by `sprite-project.mjs`;
frames, atlases, previews, palette and guide images only by `sprite-sheet.mjs`):

| Field / file | Command |
|---|---|
| `purpose`, `asymmetric`, `pixel.logicalHeight`/`colors` | `init --purpose --asymmetric --pixel H [--colors N]`; `set-character` (new) same flags + `--description --style --facing` |
| `palette.json` (file) | `sprite-sheet.mjs run --pixel` / `pixel` on the first pixel run; later runs read it |
| `pixel.palette` + asset `<character>-palette` | `register-run` when `run.pixel.palette` is present: pins once, `derive` edge from that run's frames; a later run carrying a different palette is refused unless `--repin`, which warns that earlier motions were quantised to the old one |
| anchor refs | `add-ref --role anchor --direction front …` (`--direction` required for the role); `--derived-from` accepts a ref id or any asset id (a frame) |
| `motion.direction` | `add-motion --direction`, `set-motion --direction` |
| `mirrorOf` + flipped frames | `sprite-sheet.mjs mirror <char>/motions/<of> --out … --name <id> --json` → `register-run` (`run.source: "mirror"`, `run.mirrorOf`) |
| `breathe` + frames | `sprite-sheet.mjs breathe <still> --out … --name <id> --frames --depth [--mode] [--rigid-row --axis --torso] --json` (T6 core + pack/gif/inspect, T10) → `register-run` (`run.source: "breathe"`, `run.still`, `run.breathe`) |
| `promptParts` + `prompt` | `sprite-project.mjs sheet-prompt --motion <id> --action "…" [--frames] --json` prints the prompt and records both |
| `motions/<id>/layout-guide.png` | `sprite-sheet.mjs guide --rows --cols --cell --out …` — a working file with no id, like `first-green.png`; reproducible from `promptParts.guide` |

#### 2.3 Breathe as a source

`source: "breathe"`; frames are `derive` edges from `breathe.still` (single
parent, no `inputs`), `params: { tool, step: "breathe", depth, breaths, lag,
mode }`. `register-run` resolves `run.still` to an asset by uri and refuses an
unregistered still ("register it first: `add-ref --uploaded`"), mirroring the
video path's "register the clip first". `anatomy` records the boundary
actually used and whether it was detected or overridden — what the agent needs
to answer "the head wobbles" with `--rigid-row` on the next run; detector
warnings go into `inspect.warnings`, the existing channel. Route A stills are
cut out first (`remove-background` → `add-ref --derived-from upload --op key`),
so provenance reads frames ← alpha still ← upload.

Lifecycle: `register-run` deletes `breathe` unless the run carries it (as it
already corrects `video → sheet`); `regenerate-motion` on a breathe motion is a
free re-run with changed params; `fix-alignment` is hidden for it
(`SPRITE_ONLY_COMMANDS` → a per-source predicate), since the frames are warps
of one still. Viewer: plays as any sprite motion; `describeMotion` prints
`Source: breathe (from <still>)`.

#### 2.4 Directions

Minimal model, no character-level block. The direction *set* is derived: the
`direction`s of the anchor refs; `facing` keeps its meaning and becomes the
side that is generated, the other side mirrored. An anchor is one single-pose
image (upstream's "anchor = one image" rule), generated from the turnaround
(`--from ref-turnaround`) or cut from a frame; the file lives in `refs/`, so a
later re-run of that motion leaves the anchor intact (its edge parent is
nulled by the existing `dropAssets` rule — documented, acceptable).

Motion ids are `<state>-<direction>` (`walk-right`, label "Walk · right"), so
atlas keys, Aseprite `frameTags`, Phaser animation keys and Rive
`play_<motionId>` all carry the direction with no new naming layer; the
ViewerAddress stays `{ motion: "walk-right" }`. `mirror` writes real flipped
frames (pivot x → cell.width − x) and registers like `--reverse-of`: same
frame count, source ready, opposite direction, frames hang off the source's
frames (`step: "mirror"`). It refuses when `character.asymmetric` is set
unless `--force`, and the same string becomes a guard clause in
`sheet-prompt` (upstream's asymmetric-identity gate). Loops and transitions
are not mirrored. Re-running a source motion prints a stderr note per mirror
made from it and `show` lists stale mirrors — the reverse-transition
precedent; the fix is one free command.

Rail: a small direction text on the motion row; nothing else. `rive`
treating `mirrorOf` like `reverseOf` (shared images, flipped) is T8/T2 work,
not schema.

#### 2.5 Recorded prompt parts

`sheet-prompt` assembles: `character.style` first, description, grid/cell/
safe margin, per-state guards (upstream `STATE_REQUIREMENTS`, ported text),
direction clauses (`directional_requirements`), transparency rules, the
white-plate ending, and the `asymmetric` lock — the agent supplies `action`
only. `promptParts` records the builder version, the action verbatim, the
clause ids and the guide parameters; `prompt` keeps the full text. Same
`builder` + parts ⇒ same text, pinned by a test, which is what makes T7's
layout-guide and guard experiments reproducible. Attached refs stay on the
sheet's `generate` edge (`set-sheet --from`), not duplicated here. Video
prompts (`video-prompt`) print text only this round; `MotionVideo.prompt`
unchanged (open question 4). Absent `promptParts` = a hand-written prompt.

#### 2.6 Pixel palette

Per **character**, not per motion: the palette exists to stop colour flicker
*between* motions as much as between frames. `character.pixel` is the one
authority for "this is pixel art": `riveDefaultImages` / `--filter auto` /
`export --scale` read it first and fall back to `RIVE_PIXEL_ART_STYLE` on
`style` for older projects. `logicalHeight` is the user's answer from route
G-pixel and every later run snaps to it; `pitch` per motion is a measurement
and lives in `inspect`. Recolor (T11) consumes `pixel.palette`; where its
colourways are recorded is T11's proposal (suggest `pixel.variants`), not
fixed here.

### Migration and tests

Every field is optional and dropped when malformed: `breathe` only with
`source: "breathe"`, whole-or-nothing like `brief`; `mirrorOf` only with
`source: "mirror"`; an anchor without a direction loads as `custom`; an
unknown `source` or `direction` is absent. 0.4.x files load byte-for-byte
the same.

Pin: `domain.test` (each field's survive/fallback, `pixel` gating
`riveDefaultImages`); `sprite-project.test` (`set-character`; anchor needs
`--direction`; `register-run` breathe resolves the still by uri and refuses an
unregistered one; mirror validation and stale-mirror notes; palette pinned
once, `--repin` warns; `sheet-prompt` determinism and `prompt === printed`);
`sprite-sheet.test` (mirror flips frames and pivot; guide PNG geometry;
breathe run.json shape); `viewer-logic.test` (export family order by purpose;
`fix-alignment` hidden for breathe/mirror); strings snapshot for `noMotions`
per purpose in both locales; `project-json.md` updated in the same change.

### 3. Open questions for the owner

1. **Ask or infer the route?** Recommended: infer from the opening message,
   ask the one-line question only when unclear; record via `init --purpose`.
   Enum name for route A (`"animate"`) is open.
2. **Direction vocabulary**: the 8-value union (`front/back/left/right` +
   four diagonals) with "side" expressed through `facing`; ids
   `<state>-<direction>`. Alternative: upstream's `down/side/up`.
3. **Stale mirrors**: note-only (reverse-transition precedent) vs flipping
   the mirrored motion to `processing` until `mirror` runs again.
4. **Video prompt parts**: text only this round, or the same `promptParts`
   on `MotionVideo` for parity.
5. **Route A defaults** (depth 0.02 smooth, 16 @ 8 fps) await T6's Lumi
   evidence; the owner judges.
6. **`asymmetric` as a sentence** (doubles as the prompt clause) vs a flag.

## Decisions on D1's open questions (coordinator, 2026-09-27)

The owner delegated routine choices ("其他的按照你的来吧"); these follow the
smallest correct model and can be overturned.

1. **Infer the route**, ask the one-line question only when the opening
   message does not say; record it with `init --purpose` / `set-character`.
   Route A's enum value is `"animate"`.
2. **Four directions only**: `front | back | left | right`. Diagonals are an
   8-direction game's need nobody has asked for; the union can grow later.
   `facing` stays the generated side; ids are `<state>-<direction>`.
3. **Stale mirrors are a note**, not a status flip (reverse-transition
   precedent).
4. **Video prompts: text only** this round; `MotionVideo.prompt` unchanged.
5. **Route A defaults** wait for T6's Lumi evidence and the owner's eye.
6. **`asymmetric` is a sentence** — it doubles as the prompt guard clause.

## Wave 1b tasks

### S — Sidecar contract (lands first)

Everything in the D1 TypeScript block with the 4-direction union: domain
types + parsing (whole-or-nothing, 0.4.x byte-for-byte), `sprite-project.mjs`
writers (`init --purpose --asymmetric --pixel --colors`, new `set-character`,
`add-ref --role anchor --direction`, `add-motion/set-motion --direction`,
`register-run` accepting `run.source` `breathe` / `mirror` with `run.still` /
`run.breathe` / `run.mirrorOf`, `run.pixel.palette` pinning with `--repin`,
`sheet-prompt`'s recording half = a `set-motion --prompt-parts <json>` or
equivalent writer), stale-mirror notes in `show`, `project-json.md`, and the
viewer's read side: `extractContext` purpose line, `noMotions` per purpose
(en + zh-CN + ja strings), Export-tab family order by purpose (one pure
function), direction text on the motion row, `describeMotion` for breathe /
mirror, `fix-alignment` hidden for breathe and mirror sources. No new
subcommands in `sprite-sheet.mjs` (those are T7/T8/T10). Tests per D1's
"Migration and tests". Visual check of the rail/export changes with a
screenshot.

### T7 — Generation: sheet-prompt builder, layout guide, guards

After S. `sprite-project.mjs sheet-prompt --motion <id> --action "…"` builds
the prompt in code (style sentence first, description, grid/cell/safe
margin, per-state guards ported from upstream `STATE_REQUIREMENTS`, direction
clauses, `asymmetric` lock, identity-over-motion clauses — "This row owns
motion only…", "Prefer a subtler animation over any change that mutates the
character identity" — adapted to a grid sheet, white-plate ending), prints it
and records `promptParts` + `prompt`; deterministic, pinned by test.
`sprite-sheet.mjs guide --rows --cols --cell --out` draws the layout guide
(upstream `prepare.py:728-750` geometry). Video prompt clauses (row 20) go
into `references/video-preview.md` as the template. Frame-count guidance and
the guide's default (on/off) wait for E1/E2 numbers.

### T8 — Directions and mirror

After S. `sprite-sheet.mjs mirror` (flipped frames, pivot `x → w − x`,
refuses on `asymmetric` without `--force`), `rive` and `export --format
aseprite` treating `mirrorOf` like `reverseOf` where images can be shared,
anchor generation guidance in `references/prompting.md` (one single-pose image
per direction, generated from the turnaround; right before left; handed props
keep their side). E7 validates.

### T10 — Breathe wiring and route A

After S and T6. `breathe` through `register-run` (`run.json` shape per D1),
pack/gif/inspect on its frames, the route-A path end to end on an uploaded
image (`add-ref --uploaded` → `remove-background` → `breathe` → ready motion),
`regenerate-motion` on a breathe motion = re-run with new params.

### T11 — Recolor

After T5 and S. `sprite-sheet.mjs recolor` (exact hex map + tolerance mode,
report of unmatched map entries and uncovered colours, alpha untouched,
deterministic bytes) for palette-pinned characters, a `recolor-palette`
draft from `pixel.palette`; variants recorded where T11 proposes
(`pixel.variants` suggested). Not offered for non-pixel characters (measured:
252 colours on Lumi, top 64 cover 54 %).

## Wave 2 — real inputs (shot now, used as the tasks land)

Paid, ≈ $5, run by one agent with the repo `.env` keys, inputs to
`scratchpad/sg/shoot/`: E1 Lumi idle as 4×4 / 4×2 / 2×2 sheets; E3 Lumi
side-view in-place walk (Seedance, green, generous room); E4 Lumi jump tight
(8 px pad) vs tall 3:4 with 34 % headroom; E5 Lumi attack first-last with the
same image and timed phases; E6 a small pixel-art character (turnaround +
4×2 walk sheet). E2 (layout guide ±) waits for T7; E7 (back-view walk,
anchor vs turnaround) waits for T8.
