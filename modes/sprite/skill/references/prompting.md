# Sheet prompt grammar

How to ask GPT Image 2.5 for a sprite sheet that slices cleanly. The pipeline
can align frames and pack an atlas; it cannot fix a drawing whose character
changed size halfway through the grid. Everything here is about what happens
before the pipeline runs.

`sprite-project.mjs sheet-prompt` writes this grammar for you: you write the
motion (the action), the code writes everything else and records how it did
(*Building the prompt: `sheet-prompt`*, below). The grammar is still the thing
to know — it is what the builder encodes, and what you read when a sheet comes
back wrong.

## The five-part grammar

Write every sheet prompt in this order. The order matters — the model weights
the opening of the prompt most heavily, and the thing you least want to drift
is the style.

1. **Style anchor, verbatim.** The exact `character.style` sentence from
   `project.json`, copied character for character. Not paraphrased, not
   "in the same style as before" — the model has no "before".
2. **Grid instruction.** "A single image laid out as a strict N×M grid of
   equal cells, read left to right, top to bottom." Say *strict* and *equal*;
   without it the model composes a poster.
3. **Subject and continuity.** "The same character in all cells" plus the
   identity facts that must not change: proportions, palette, costume and
   distinguishing props. Specify the starting view and any intended turn.
4. **The motion, in related phases.** Map phases to cell ranges, with the
   contacts, trajectories and follow-through that connect them. Add individual
   pose details where needed; phase boundaries need not follow grid rows.
5. **Negative constraints.** A flat solid pure white background filling every
   cell, no gradient, no cell borders, no numbers, no drop shadow, no ground
   shadow, no motion blur, no effects leaving the cell. The white plate is
   asked for here and cut off afterwards by the keying step — a *drawn* floor
   or a gradient is what makes that cut hard, so name them as negatives.

## The five clauses that make the cut clean

These are not style choices; they are what the keying and alignment steps need
in order to work at all. Every sheet prompt carries all five.

- **No floor, no cast shadow.** A shadow is opaque, so it lands in the alpha
  and the aligner treats it as part of the character — the silhouette grows a
  smear that moves with the pose, and the anchor moves with it.
- **Preserve white and pale details inside the character.** Say it out loud
  ("keep the white highlights, the cream cloak and the eye whites fully
  opaque, only the background is white") — a colour key cannot tell the plate
  from a white the character is wearing, and the fastest way to lose an eye is
  to let the model paint it the same white as the backdrop.
- **Empty background on every side of every cell** — 9.4 % of the cell, 48 px
  on a 512 px cell — moving accessories included. A pose that touches its cell edge is a pose whose
  neighbour bleeds into it, and `inspect` will say so ("cell NN is clipped").
  The padding is what `clean` needs too: a fragment that reaches a border is
  the one thing it can safely identify as litter.
- **A fixed camera and an explicit movement frame of reference.** Keep body
  proportions and drawing scale consistent. For grounded phases, place
  support contacts on one ground line; say when they lift or switch. Specify
  whether the motion stays in place or travels within the cell. A fixed cell
  origin does not freeze the body. The aligner cannot distinguish a planned
  lunge from accidental drift; its limits are in `pipeline.md`.
- **Close the loop** when the motion loops: "the last cell leads smoothly
  into the first on the next beat, with compatible movement direction".
  For a one-shot or transition, name the final pose instead.

## Building the prompt: `sheet-prompt`

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs sheet-prompt --dir <character> \
  --motion <id> --action "<the phase plan, by cell>" [--frames 8] [--state idle] [--guide] --json
```

It builds the whole prompt in code, records it on the motion (`prompt`, and
`promptParts` — builder version, your action verbatim, the clause ids, the
guide's geometry when one was used) and prints it. Without `--json` stdout is
the prompt alone, so `PROMPT="$(node … sheet-prompt …)"` feeds
`generate_image.mjs "$PROMPT"` directly; the image size, the references to
attach (in order) and the guide call go to stderr. With `--json` they are
`imageSize`, `attach`, `guide` and `notes`.

**You write the action**: the view if it matters ("three-quarter view"), the
phases by cell, what leads and follows, the one secondary motion, the blink,
the final pose of a one-shot. Nothing else — the rest below is written for you,
the same way every time.

**The code writes**, in grammar order:

| Part | What it says | Clause id (recorded only when conditional) |
|---|---|---|
| 1 | `character.style`, verbatim | — (refused when empty) |
| 1 | pixel art at `pixel.logicalHeight` logical px: square blocks, one size in every cell, no anti-aliasing | `pixel:<h>` when `character.pixel` is set |
| 2 | the image and grid in pixels, C columns × R rows, read order | — |
| 2 | each cell holds the whole character once, centred, with the safe margin (9.4 % of the cell), props included | — |
| 2 | the layout guide is the last attached image: follow it, never draw it | `guide` |
| 3 | the same character as the references, then `character.description`; pale details stay opaque | — |
| 3 | the facing: the motion's direction locked for the whole sheet, else `character.facing` | `direction:<d>` |
| 3 | the attached anchor for that direction owns the facing | `anchor:<d>` when an anchor ref faces that way |
| 3 | fixed camera and scale; identity over motion ("This sheet owns motion only… Prefer a subtler animation over any change that alters the character's identity") | — |
| 3 | the asymmetry lock, with `character.asymmetric` verbatim | `asymmetric` |
| 4 | your action, headed by the frame count and loop / once | — |
| 4 | the state guard (below) | `state:<s>` |
| 4 | the motion runs straight on across row ends | `row-continuity` when rows > 1 |
| 4 | cell N leads into cell 1 / cell N is the final pose | `loop-close` / `one-shot-end` |
| 4 | no detached effects (sparkles, arcs, speed lines, smears, glows) | — |
| 5 | the flat pure white plate and the negatives | — |

**State guards.** The state is read off the motion's id, then its label, first
matching word wins (`walk-right` → walk, `lantern-swing` → attack); anything
else is `generic`, and `--state` overrides.

| State | Words | The guard |
|---|---|---|
| idle | idle, breathe | feet planted on one baseline, never lift, step, shuffle or slide; no turning; the eyes close in one cell at most |
| walk / run | walk, march; run, sprint, dash, jog | in place, on the spot; distinct gait poses with support passing between feet, not repeated standing or bobbing; no speed lines, dust or trails. Front or back: alternate legs, arms, shoulders and body height visibly |
| jump | jump, hop, leap | one jump, not repeated hops; anticipation, lift, peak, descent, settle; the peak stays in the safe area; no shadows, landing marks or smears |
| attack | attack, slash, strike, swing, punch, kick, stab | windup, strike, follow-through, recovery with what it already holds; every grip stays; the weapon stays in the safe area; no slash arcs, flashes or trails |
| wave | wave, greet, hello | the arm alone; feet planted unless the action steps; no wave marks or sparkles |
| generic | — | carry the action in the body, one readable phase after the next |

Ported (text) from aldegad/sprite-gen `sprite_gen/gen/prepare.py`
`STATE_REQUIREMENTS` (walk, run, frontwalk, jump, wave) and `video/batch.py`
`HOLD_TEXT` (the attack grip lines); the idle and attack guards are ours, from
the idle recipe below and upstream's default attack action. The identity lines
are adapted from upstream's row prompt anchor lock, from a one-row strip to a
grid.

**Frames and grid.** `--frames N` redraws the motion's grid (and `run` must
then slice that grid); without it the motion's own grid is used.

| Frames | Grid (columns × rows) | Image at a 512 px cell |
|---|---|---|
| 2, 3 | N × 1 | 1024×512, 1536×512 |
| 4 | 2 × 2 | 1024×1024 |
| 6 | 3 × 2 | 1536×1024 |
| 8 | 4 × 2 | 2048×1024 |
| 9 | 3 × 3 | 1536×1536 |
| 12 | 4 × 3 | 2048×1536 |
| 16 | 4 × 4 | 2048×2048 |

The cell drawn is the character's cell times the largest whole factor that
keeps it at most 512 px (256 → 512), so pixel art stays on an integer scale.
Pass the printed `imageSize` as `--image-size`; the prompt names those exact
pixels. More than 16 frames come from a clip. An idle that is not 8 frames
gets a note (E1, *Measured* below).

**The layout guide** (`--guide`, default **off**): the prompt says the last
attached image is the guide, and the output gives the call that draws it —
`sprite-sheet.mjs guide --rows R --cols C --cell 512x512 --out
<character>/motions/<id>/layout-guide.png` (`pipeline.md`). Attach it last.
On E2 (below) it fixed nothing — no arm clipped, drew lines or misplaced a
cell — and cost 22 % more per sheet; reach for it when a sheet comes back with
merged or misplaced cells.

**Deterministic.** The same character, grid and parts give the same text byte
for byte; `builder: "sheet-prompt/1"` names the wording. Changing a sentence
means a new builder version, so a recorded prompt keeps meaning what it said.
A prompt you write yourself goes in with `set-motion --prompt` and drops the
parts.

**Where it departs from upstream, deliberately.** Upstream's row prompt asks
for a one-row strip on a chroma key with a sectioned "authoritative spec"; we
keep a grid, the white plate (BiRefNet cuts it) and one paragraph in grammar
order. The safe margin is upstream's 9.4 % of the cell rather than our
earlier 16 px, which was written for 256 px cells and is 3 % of a 512 px
cell — one number, which the guide draws too. Neither number is honoured to
the pixel (E2: no cell kept 48 px), and neither clipped.

## Drawing a character that is not a person

- **Adapt the anatomy to the chibi proportions, do not force the body into a
  human one.** A two-headed-tall human is a chibi; a two-headed-tall dragon is
  a dragon with its own proportions squashed, not a human with a snout. Say
  which parts scale ("large head, short limbs, the tail and wings keep their
  own proportions") rather than naming a human template.
- **Infer what the reference does not show.** A portrait reference is a bust,
  so a full-body sheet has to invent legs. Say so — "the reference is cropped
  at the chest; extend it to a full body consistent with the costume and
  palette" — or the model either crops every cell to the same bust or invents
  a different lower half in each one.

## The call

The five parts above are one argument, quoted. This is the whole invocation —
the three worked prompts below are what belongs inside the quotes:

```bash
node {SKILL_PATH}/scripts/generate_image.mjs \
  "Clean anime-chibi line art, flat colors, thick uniform outline, no shading. A single image laid out as a strict 4x4 grid of 16 equal cells, read left to right, top to bottom. …" \
  --image-urls <character>/refs/turnaround.png \
  --image-urls <character>/refs/portrait.png \
  --background opaque \
  --image-size 2048x2048 \
  --quality high \
  --output-format png \
  --output-dir <character>/motions/<id> \
  --filename-prefix sheet-raw
```

Run it from the workspace — no `cd`, `{SKILL_PATH}` is absolute, and every
path here is workspace-relative (`references/pipeline.md` states the rule
once for all the scripts).

- **The prompt is a positional argument.** There is no `--prompt` flag on
  `generate_image.mjs` or `edit_image.mjs`; writing one fails the call outright
  with `ERROR: Unknown option '--prompt'`. The video scripts on the next page
  *do* take `--prompt` — that asymmetry is the trap, and it costs you a turn,
  not an image.
- **Nor is there a `--json` flag on those two.** They always print one JSON
  object on stdout, so there is nothing to switch on; passing `--json` anyway
  dies with `ERROR: Unknown option '--json'. To specify a positional argument
  starting with a '-'…`, which reads like a quoting problem and is not one.
  Every other script this mode runs — `sprite-sheet.mjs`,
  `sprite-project.mjs`, `remove-background.mjs`, `seedance-video.mjs`,
  `generate-video.mjs` — *does* take `--json`, which is exactly why the habit
  reaches for it. The two that take a positional prompt are the same two that
  have no `--json`; learn them as a pair.
- **`--image-urls` repeats, once per reference** (up to 16), and it is what
  makes the sheet the *same* character. Passing any reference switches the
  model to Flare automatically; do not override with `--model`.
- **`--background` takes `auto`, `opaque` or `transparent`; use `opaque`.**
  The alpha comes from the keying step, not from this flag. The flag reference
  in full: `--background transparent` needs `--output-format png` or `webp`
  (it refuses on jpeg, which has no alpha channel), the JSON result reports
  `hasAlpha` for what actually arrived, and the script prints a `WARN` when a
  provider ignores the request. None of that is reachable on OpenRouter's GPT
  Image 2.5 today: as of 2026-09-09 both `sunburst` and `flare` reject the
  parameter with a `400` before generating anything — `background: not
  supported. Accepted: auto, opaque` — so the try is free and the answer is
  always the same. Ask for the white plate in the prompt, pass `opaque`, and
  probe the sheet (workflow B step 5) instead of trusting any flag.
- **`--image-size 2048x2048` pins the pixels**; `--aspect-ratio 1:1` only asks
  for a square at whatever size the provider picks. Pin the size for a sheet —
  2048 across a 4×4 grid is a 512 px cell, which survives slicing and
  downscaling. `--quality high` is the default; write it anyway on anything a
  later motion inherits.
- **Where the file lands:** with one image (the default) the output is exactly
  `<output-dir>/<filename-prefix>.<format>` — `sheet-raw.png` here, with no
  `-1` or `_1` suffix; the `_2`, `_3` … suffixes appear only when you ask for
  more than one. The extension follows the bytes that actually arrived, so read
  `files[0]` out of the JSON instead of assuming. The prefixes are not
  decoration: `sheet-raw` is the name `set-sheet --file motions/<id>/sheet-raw.png`
  registers, and `--output-dir <character>/refs --filename-prefix turnaround`
  is what puts the reference where `add-ref --file refs/turnaround.png` expects
  it.

## The canonical sheet spec

One shape covers most motions, and it is the one the pipeline is tuned for:

> **A single 2048×1024 image, a strict 4×2 grid of 8 equal 512×512 cells,
> 4 columns and 2 rows, read left to right, top to bottom. Each cell holds the
> whole character exactly once, centred, with at least 48 px of empty
> background on every side — including anything the character is holding or
> wearing that moves. The camera is fixed, with consistent body proportions
> and drawing scale. Ground contacts share a baseline during grounded phases;
> the pose and movement follow the motion plan. A flat solid pure white
> background fills every cell, no gradient, no cell borders, no numbers.**

`sheet-prompt` writes it for the chosen frame count (the grid table above) and
prints the matching `--image-size`: 512 px cells for a 256 px character, the
tier a hand-off to an engine needs. The margin is 9.4 % of the cell (48 px
here, 24 px on a 256 px cell). A 1024 px sheet is the cheaper iteration tier
and a quarter of the bytes on disk; write that prompt by hand if you choose it.

## The idle recipe

For a quiet grounded idle, keep the primary motion small — an idle that
"does something" can read as a twitch. A starting recipe, as an **8-frame
sheet, 4 columns × 2 rows, at ≈ 3.3 fps (a ≈ 2.4 s cycle)** — the shape that
read best in both E1 takes (*Measured* below); 4×4 showed a pop at a row
boundary or at the wrap, and 2×2 held each pose 0.6 s:

- **One gentle breathing rise and fall across the whole cycle.** The chest and
  shoulders lift over the first half and settle over the second; the head
  follows by a pixel or two. That is the entire primary motion.
- **Exactly one secondary motion**, lagging a beat behind the body — hair, a
  cloak hem, a tail, a held lantern. One, not three: two competing secondaries
  read as wind, not as breathing.
- **One brief blink** if the eyes are visible, in a single cell somewhere in
  the second half. A blink spread over three cells is a character falling
  asleep.
- **The feet, or whatever the character rests on, do not move at all.** Name
  the contact points and pin them: "the feet stay planted on the same baseline
  in every cell".
- **No walking, no turning, no stepping toward the camera**, and no change of
  facing. Those are other motions.
- **The last cell flows back into the first** — say it by number ("cell 8
  leads into cell 1 on the next beat, without an extra hold"; `sheet-prompt`
  writes this line).

Written out, that is the first worked prompt below.

## Three worked prompts

### Chibi idle (4×2, ≈ 3.3 fps, loop)

> Clean anime-chibi line art, flat colors, thick uniform outline, no shading.
> A single 2048x1024 image laid out as a strict 4x2 grid of 8 equal 512x512
> cells, 4 columns and 2 rows, read left to right, top to bottom. The same
> character in every cell, matching the attached reference sheet exactly:
> short bob hair, oversized hooded cloak, satchel, small floating paper
> lantern. Facing right, three-quarter view, full body, consistent body
> proportions and fixed camera distance in every cell. An 8-frame idle
> breathing loop: cells 1-2 the chest begins to rise, cells 3-4 the rise
> peaks and the lantern drifts up a beat behind, cells 5-6 the chest falls,
> cells 7-8 settle toward the opening pose, with cell 8 leading smoothly into
> cell 1. A flat solid pure white background filling every cell, no gradient.
> No grid lines, no cell borders, no numbers, no text, no drop shadow, no
> ground shadow, no motion blur, nothing crossing between cells.

With `sheet-prompt`, the action is only the middle: "Three-quarter view. An
8-frame idle breathing loop: cells 1-2 … cells 7-8 settle toward the opening
pose." Everything around it is written for you.

### Pixel walk (4×2, 12 fps, loop)

> 32-bit pixel art, limited 16-color palette, hard pixel edges, no
> anti-aliasing, no gradients. A single image laid out as a strict 4×2 grid of
> 8 equal cells, read left to right, top to bottom. The same character in
> every cell, matching the attached reference: green tunic, leather boots,
> short sword on the back. Side view facing right, full body, consistent body
> proportions and pixel scale in every cell. An 8-frame in-place walk cycle:
> contact, down, pass, up for the left leg in cells 1-4 and the mirrored half
> for the right leg in cells 5-8,
> arms swinging opposite the legs, the head bobbing one pixel. A flat solid
> pure white background filling every cell, no gradient. No grid lines, no
> numbers, no shadow, no anti-aliased halo around the sprite.

### Anime attack (4×4, 10 fps, no loop)

> Crisp anime cel-shading, two-tone shadows, clean ink outline. A single image
> laid out as a strict 4×4 grid of 16 equal cells, read left to right, top to
> bottom. The same character in every cell, matching the attached references
> exactly. Three-quarter view facing right, full body, consistent body
> proportions and fixed camera distance in every cell, allowing the knees
> and torso to bend. A 16-frame sword attack: cells 1-4 wind up and
> weight shifts back, cells 5-8 the step forward begins, cells 9-12 the swing
> passes through the strike, cells 13-16 recover to a ready stance. The blade
> stays inside its own cell at all times. A flat solid pure white background
> filling every cell, no gradient. No speed lines, no impact flashes, no glow,
> no motion blur, no cell borders, no numbers, no shadow.

## The 3D icon keyframe

Workflow E starts from one picture, not a grid. That picture is drawn once,
cut out once, and then handed to the video model as *both* ends of the clip —
so every one of the loop's hundred frames is an interpolation of it, and
whatever is wrong with it is wrong a hundred times. It is worth one extra look
before the clip is paid for.

**The style anchor**, when the user has no style of their own and wants the
look of a modern UI icon:

> Smooth claymation-style 3D icon, soft matte clay, rounded forms, soft studio
> key light from the upper left, no outline.

Four constraints then do the mechanical work, and each one pays for itself:

- **One subject, centred, filling about 70 % of the frame.** One subject
  because the cut-out keeps the largest silhouette and a second object either
  survives as unexplained litter or vanishes mid-loop. 70 % because the export
  is cropped to the union of every frame's bounding box and then scaled to
  `--width`: a subject that occupies a fifth of the frame is enlarged from a
  fifth of the pixels, and at UI size that shows.
- **A generous margin on all four sides.** The motion happens inside this
  frame. A flame that already touches the top edge has nowhere to flicker: the
  model either clips it or quietly shrinks it to make room, and a loop whose
  subject changes size is a loop that pulses.
- **A flat solid pure white background**, asked for in the prompt, with
  `--background opaque` on the call. The alpha comes from
  `remove-background.mjs` afterwards, exactly as a sheet's does.
- **No floor, no cast or contact shadow, no reflection, no vignette, no text.**
  A shadow and a reflection are opaque, so they land inside the alpha and then
  sway along with the subject — a UI icon with a shadow attached to it is the
  single most common way a loop comes back unusable. A vignette makes the plate
  stop being one colour, which is what the clip's `--key auto` measures. Text
  becomes plausible fake glyphs the moment the model animates it.

**The character variant.** When the subject is the character rather than an
icon of its own, the style anchor is the character's own `character.style`
sentence verbatim, every reference goes on `--image-urls` (once each, as for a
sheet), and the prompt asks for **one pose** — a keyframe is a single picture,
not a turnaround. Everything else on this list is unchanged; the white plate,
the margin and the no-shadow clause matter more here, not less, because a
character has more silhouette to lose.

### One worked keyframe prompt

> Smooth claymation-style 3D icon, soft matte clay, rounded forms, soft studio
> key light from the upper left, no outline. A single flame standing upright,
> centred, filling about 70 % of the frame with clear empty margin on all four
> sides. Warm orange-to-yellow clay, soft rounded tongues curling upward, a
> slight forward lean, visible fingerprint texture in the matte surface. A flat
> solid pure white background filling the whole frame, no gradient. No floor,
> no ground plane, no cast shadow, no contact shadow, no reflection, no
> vignette, no text, no labels.

### The call

```bash
node {SKILL_PATH}/scripts/generate_image.mjs \
  "Smooth claymation-style 3D icon, soft matte clay, rounded forms, soft studio key light from the upper left, no outline. A single flame standing upright, centred, filling about 70 % of the frame …" \
  --image-size 1024x1024 \
  --quality high \
  --background opaque \
  --output-format png \
  --output-dir <character>/motions/<id> \
  --filename-prefix keyframe
```

The prompt is positional and there is no `--json`, the same pair of traps as a
sheet. `--image-size 1024x1024` rather than a sheet's 2048: the keyframe is one
picture at UI scale, the clip that consumes it is shot at 480p, and the export
is cropped and scaled to `--width` anyway — pixels past that are paid for and
then thrown away by the encoder. For the character variant add
`--image-urls <character>/refs/turnaround.png` once per reference.

The file lands at exactly `<character>/motions/<id>/keyframe.png`, which is the
path `set-keyframe --file motions/<id>/keyframe.png` registers, and
`remove-background.mjs --resolution 1024` writes `keyframe-alpha.png` beside
it for `--alpha`.

## What breaks consistency, and the phrasing that fixes it

| Symptom | Cause | Fix in the prompt |
|---|---|---|
| Character unexpectedly reverses facing | No facing declared, or an ambiguous turn | Declare the starting view; keep it fixed when no turn is intended, otherwise name the turn direction and end view |
| Character proportions drift across the grid | The model treats each cell as its own composition | "Consistent body proportions and drawing scale, fixed camera distance" — a crouch or turn may legitimately change silhouette dimensions |
| Numbers or letters in the corners | Grids read as contact sheets to the model | "No numbers, no labels, no text anywhere" |
| A grey, tinted or gradient plate behind the sprite | The model drew its own backdrop instead of the flat white you asked for | Say "a flat solid pure white background filling every cell, no gradient" — a gradient is what makes the cut-out (workflow B step 6) leave a halo. A *flat* plate of any colour is fine; the keyer takes it |
| Sprite clipped at a cell edge | The pose is bigger than the cell | "The whole character, including the weapon, stays inside its own cell with a clear margin" |
| Ground shadow follows the sprite | Default illustration habit | "No ground shadow, no drop shadow, no contact shadow" — a shadow is opaque and it lands in the alpha, so the aligner treats it as part of the silhouette |
| Effects bleed between cells | Motion blur, speed lines, glow | "Nothing crossing between cells, no motion blur, no speed lines, no glow" |
| Loop jumps from frame 16 to frame 1 | The closing transition was not specified | "Cells 13-16 settle toward the opening pose; cell 16 leads into cell 1 on the next beat" — check movement direction as well as pose similarity |
| A prop appears twice in a cell (a held lantern and a floating one) | The description says how the prop is usually carried, the action says something else, and the model draws both | Say it in the action: "she grips the paper lantern by its cord — the one lantern, no other" (E2: 3 of 8 cells in one of four sheets) |

Two of those — scale drift and cell clipping — the `inspect` report names for
you (`scaleDrift`, "cell NN is clipped"). Read the report before rewriting the
prompt, so the rewrite targets the fault the pipeline actually measured.

## Frame-to-frame continuity

Design the relationship between poses before mapping them to cells. The same
plan guides a source clip, with phases described over time instead of cells.

- **Separate identity from motion.** Keep head-to-body proportions, costume
  construction, palette and distinctive details consistent with the refs.
  Preserve handedness and asymmetric accessories through a turn; visible
  features can become occluded. Pose, facing and silhouette height may change
  as the action requires.
- **Choose phases for this action.** They need not be equally long or begin
  on new rows. These examples are starting points, not required sequences:

  | Motion | Possible phases | What connects them |
  |---|---|---|
  | Breathing | inhale, crest, exhale | planted support; hair or clothing lags the torso |
  | Walking | contact, down, pass, up; alternate sides | support transfers between feet; arms counter-swing |
  | Jumping | crouch, push-off, rise, fall, land | feet release and regain contact; knees absorb landing |
  | Waving | raise, wave, lower | shoulder leads the lift; elbow and wrist carry the gesture |
  | Turning | weight shift, pivot, settle | declare turn direction, support foot and final view |

- **Name what leads and follows.** Describe the body or prop trajectory,
  support changes and one relevant secondary motion. Use articulated pose
  changes when the action needs them; translating or rotating one rigid pose
  cannot stand in for walking or waving. Intentional holds and rigid motion
  are valid when they belong to the requested action.
- **Distribute frames for rhythm.** Smaller pose steps read as slower motion;
  larger steps read as faster motion. Preserve deliberate holds. The current
  viewer, atlas and GIF use one fps per motion, not per-frame durations: keep
  the planned timing achievable with that frame budget and uniform interval.
- **Choose the ending.** For a loop, the last sampled pose leads into the
  first with compatible movement direction, without an unintended repeated
  endpoint pause. For a one-shot or transition, name the destination pose;
  a seated character can stay seated and a turn can finish facing away.

Verify these relationships in playback, including phase boundaries and the
loop seam. `inspect` checks geometry; it cannot establish identity, support
contact or temporal continuity. Compare source cells with aligned frames when
the processed motion loses a deliberate movement.

## Fixing one bad cell

When fifteen cells are right and one is wrong, do not regenerate the sheet:
a fresh generation rerolls all sixteen, and the fifteen good ones will not
come back.

1. Work on the raw sheet, not the aligned frames — the pipeline re-derives
   everything downstream anyway.
2. `edit_image.mjs` on the raw sheet, describing the cell by position, not by
   index — "the third cell of the second row" — and saying both what is wrong
   and what it should be:

   ```bash
   node {SKILL_PATH}/scripts/edit_image.mjs \
     "The third cell of the second row: the character's sword arm is missing. Redraw that cell with the sword raised, matching the neighbouring cells exactly. Change nothing else in the image." \
     --input <character>/motions/<id>/sheet-raw.png \
     --output-dir <character>/motions/<id> \
     --filename-prefix sheet-raw
   ```

   The prompt is positional here too. The output prefix overwrites
   `sheet-raw.png` on purpose — the raw sheet is the motion's source and
   `set-sheet` keeps the same asset id across regenerations — so copy the file
   aside first if you want a fallback; a re-run never brings the fifteen good
   cells back.
3. Re-run `sprite-sheet.mjs run` from the edited raw sheet and
   `register-run` again. The old frames and their provenance edges are
   replaced, not duplicated.

If three or more cells are wrong, the prompt is the problem, not the draw —
tighten it against the table above and regenerate.

## Reference images

**The chain has no gaps.** The turnaround is the only image in a character
that is drawn from nothing but words. *Every reference after it is generated
with the earlier references attached* — the portrait carries
`--image-urls <character>/refs/turnaround.png`, a third ref carries both — and
*every sheet is generated with all of them attached*. Skip one link and the
model draws a plausible character from your adjectives instead of *the*
character: the first Lumi portrait was generated with no reference and came
back as somebody else — dark brown hair, a red cloak, nobody had asked for
either. Words narrow the space; only an attached image pins the identity. Say
it in the prompt as well ("the character in the attached reference sheet,
matching it exactly: …") — the attachment tells the model what to look at, the
clause tells it that matching is the job.

Attach **every** reference the character has
(`--image-urls <character>/refs/turnaround.png --image-urls <character>/refs/portrait.png`). The turnaround carries proportions and
silhouette; the portrait carries the face, which is what a viewer notices
first when it drifts. Passing references switches `generate_image.mjs` to the
Flare model automatically — do not override it with `--model`.

Do not attach a previous motion's sheet as a reference. It looks like a helpful
consistency anchor and it is not: the model copies the *grid* as well as the
character, and you get an attack drawn in the idle's poses.

## Measured (Lumi, 2026-09-27)

**E1 — idle frame count.** One idle breath at the same 2.4 s cycle drawn as
4×4 (16 frames at 6.67 fps), 4×2 (8 at 3.33 fps) and 2×2 (4 at 1.67 fps), two
takes each (GPT Image 2.5 flare, the seed's refs, one prompt per grid).
Adjacent-frame change is mean |RGBA| at 64×64 in play order:

| | in-row steps min–max (median) | row boundaries | wrap |
|---|---|---|---|
| 4×4, take 2 | 0.0097–0.0265 (0.0166) | 0.0257, 0.0376, 0.0231 | 0.0393 |
| 4×4, take 1 | 0.0083–0.0166 (0.0100) | 0.0409, 0.0365, 0.0185 | 0.0202 |
| 4×2, take 2 / 1 | 0.0128–0.0218 / 0.016–0.0235 | 0.0195 / 0.0155 | 0.0178 / 0.0256 |
| 2×2, take 2 / 1 | 0.038–0.055 / 0.033–0.043 | 0.0505 / 0.0426 | 0.0423 / 0.0358 |

On 4×4 the model draws each row as a unit: row-boundary steps ran 3.6–4.1× the
median in-row step in take 1, and in take 2 the wrap was the biggest step
(2.4×). On 4×2 no step — boundary and wrap included — exceeds 1.25× its
median in-row step in either take (the largest is take 1's wrap, 0.0256).
2×2 moves smoothly but holds each pose 0.6 s. `inspect` raised no warning on
any of the six. Hence the idle recipe's 8 frames; `sheet-prompt` notes an idle
of any other count. Other states were not measured for frame count.

**E2 — the layout guide, on vs off.** Four 8-frame lantern-swing attack sheets
(4×2, 2048×1024, flare, turnaround + portrait), prompts from `sheet-prompt/1`
differing only by the guide clause; the guide arm attached the guide last.
Each sheet → BiRefNet → `run` → `register-run`.

| | guide 1 | guide 2 | none 1 | none 2 |
|---|---|---|---|---|
| drawn grid lines / boxes, guide colours, grey plate | none | none | none | none |
| clipped cells | 0/8 | 0/8 | 0/8 | 0/8 |
| cells keeping the stated 48 px margin | 0/8 | 0/8 | 0/8 | 0/8 |
| closest approach to a cell edge (px) | 9 | 12 | 9 | 8 |
| mean character height (px of 512) | 440 | 443 | 455 | 459 |
| mean feet offset from the cell centre (px) | 20.4 | 20.2 | 39.3 | 27.2 |
| row-boundary step / median in-row step | 1.18 | 1.19 | 0.87 | 1.45 |
| scale spread (cv of √area) | 0.025 | 0.030 | 0.022 | 0.027 |
| `inspect` scaleDrift (warns over 0.15) | 0.161 | 0.167 | 0.125 | 0.135 |
| cells with a second lantern | 0 | 0 | 3 | 0 |
| image cost | $0.067 | $0.067 | $0.055 | $0.055 |

What the guide is for — cells the model misplaces, merges, clips, or boxes
drawn into the art — happened in neither arm. It nudged the drawing the way it
asks (characters ≈ 3.5 % smaller, feet nearer the centre) without getting any
cell inside its safe area, and two sheets per arm cannot separate that from
take noise. Both guide sheets tripped `scaleDrift`; the area-based spread is
the same in both arms, so that is the raised lantern stretching the bbox, not
the guide. Default off; the flag stays for a sheet that comes back misplaced.
Spend: images $0.2451 + 4 BiRefNet calls.

