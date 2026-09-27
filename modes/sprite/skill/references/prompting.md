# Sheet prompt grammar

How to ask GPT Image 2.5 for a sprite sheet that slices cleanly. The pipeline
can align frames and pack an atlas; it cannot fix a drawing whose character
changed size halfway through the grid. Everything here is about what happens
before the pipeline runs.

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
- **At least 16 px of empty background on every side of every cell**, moving
  accessories included. A pose that touches its cell edge is a pose whose
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

> **A single 1024×1024 image, a strict 4×4 grid of 16 equal 256×256 cells,
> read left to right, top to bottom. Each cell holds one frame of the
> character, with at least 16 px of empty background on every side —
> including anything the character is holding or wearing that moves. The
> camera is fixed, with consistent body proportions and drawing scale.
> Ground contacts share a baseline during grounded phases; the pose and
> movement follow the motion plan. A flat solid pure white background fills
> every cell, no gradient, no cell borders, no numbers.**

Adapt the grid and cell dimensions to the chosen frame count, paste it after
the style anchor, then say what the frames *are*.
`--image-size 1024x1024` gives exactly the 256 px cell a character with
`cell: 256×256` declares; go to `2048x2048` (a 512 px cell) when the frames
are a hand-off to an engine or may be re-packed larger, and say why. The
default the workflow prints is 2048; 1024 is the cheaper iteration tier and a
quarter of the bytes on disk.

## The idle recipe

For a quiet grounded idle, keep the primary motion small — an idle that
"does something" can read as a twitch. A starting recipe, as a
16-frame 4×4 sheet at 6–7 fps (a ≈ 2.4 s cycle):

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
- **The last cell flows back into the first** — say it by number ("cell 16
  leads into cell 1 on the next beat, without an extra hold").

Written out, that is the first worked prompt below.

## Three worked prompts

### Chibi idle (4×4, 8 fps, loop)

> Clean anime-chibi line art, flat colors, thick uniform outline, no shading.
> A single image laid out as a strict 4×4 grid of 16 equal cells, read left to
> right, top to bottom. The same character in every cell, matching the
> attached reference sheet exactly: short bob hair, oversized hooded cloak,
> satchel, small floating paper lantern. Facing right, three-quarter view,
> full body, consistent body proportions and fixed camera distance in every
> cell. A 16-frame idle breathing loop: cells 1-4 the chest rises and the
> cloak settles, cells 5-8 the rise peaks and the lantern drifts up, cells
> 9-12 the chest falls, cells 13-16 settle toward the opening pose, with cell
> 16 leading smoothly into cell 1. A flat solid pure white background filling
> every cell, no gradient. No grid lines, no cell borders, no numbers, no text, no
> drop shadow, no ground shadow, no motion blur, nothing crossing between
> cells.

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
character, and you get an attack drawn in the idle's poses. (The one sheet
that may go on is the same motion's other side, for rhythm only — see
*Direction anchors*.)

## Direction anchors

For a character that faces several ways — a top-down game's walk up, down,
left and right (`front | back | left | right`). Inspired by aldegad/sprite-gen
`docs/directional-anchor-workflow.md` and `sprite_gen/gen/prepare.py` (the
direction-anchor stage, "anchor = one image", the left/right and
asymmetric-identity gates); the difference is that our mirrored side is a
real motion made by `sprite-sheet.mjs mirror`, not a flip left to the engine.

**One anchor per direction, one pose each.** Before the first sheet facing a
direction, draw that direction once: a single full-body picture in a calm
standing pose — not a sheet, not a turnaround, not an idle row. A picture
with several poses reads to the model as identity that varies, and the
facing it is supposed to lock goes soft. It is generated like any reference,
with the turnaround and portrait attached (the chain has no gaps), 1024×1024,
on the white plate, and its prompt says what it is and what may change:

> Clean anime-chibi line art, flat colors, thick uniform outline, no shading.
> CANONICAL DIRECTION ANCHOR, back view: one single full-body picture of the
> character in the attached references, matching them exactly: pale ash-blond
> bob hair with a small ahoge, an oversized cream hooded cloak with dark red
> trim and a dark red back panel with a diamond motif, a brown satchel on a
> strap across the body, brown boots, and a small floating paper lantern. Take
> the identity from the references and change only the facing: the character
> stands facing straight away from the viewer, the back of the head and the
> hood toward the camera, no face visible. A calm neutral standing pose, feet
> planted side by side on one ground line, arms relaxed at the sides.
> Side-specific details keep their side: the satchel hangs at her left hip,
> which from behind is on the left of the picture; the red clover hairpin sits
> on her right side and is hidden behind the hair from this angle; the lantern
> floats beside her right shoulder, on the right of the picture. One pose
> only: not a turnaround, not a sheet, no second figure. Full body, centred,
> filling about 70% of the height, with clear empty margin on every side. A
> flat solid pure white background, no gradient. No floor, no ground shadow,
> no text, no labels.

The facing clause per direction: *front* — faces the viewer; *back* — faces
straight away, back of the head to the camera, no face; *right* / *left* — a
pure side profile facing the right / left of the picture. Register it as the
direction's anchor (one per direction; registering the same id again
replaces it):

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs add-ref --dir <character> --id anchor-back \
  --file refs/anchor-back.png --role anchor --direction back \
  --from ref-turnaround,ref-portrait --model openai/gpt-image-2.5-flare --prompt "<the prompt>" --json
```

A frame the user already likes can be the anchor instead:
`add-ref --role anchor --direction right --derived-from walk-right-frame-00`.

**Look at the anchor beside the turnaround before anything uses it.** Every
sheet facing that way reproduces the anchor, including what the anchor got
wrong (measured below: a motif the anchor redrew went into all 24 cells). A
wrong anchor is regenerated; the sheets made from it are not worth fixing.

**Right before left, and the left is a mirror.** Generate the side the
character is set to face (`character.facing`; right when none is set) and
make the other side with `sprite-sheet.mjs mirror` — free, seconds, pixel for pixel
the same drawing. A mirrored direction is not generated. Loops and
transitions are not mirrored.

**Handed props and hairpins keep their side.** A hairpin, an earring, a scar,
a logo, a one-sided marking, a sword always in the right hand, a satchel at
one hip: a flip moves each to the other side of the body. Record them in one
sentence before any directional work — `set-character --asymmetric "the red
clover hairpin sits on the right side of her head; the satchel hangs at her
left hip"` — and `mirror` refuses from then on, saying the sentence back.
Then the other side is generated after all: its own anchor first, then its
sheets, with the finished first side's sheet of the same motion attached
**last and for rhythm only** — step timing, stride and scale, never facing or
identity (upstream's left/right gate; not measured here). Every directional
prompt re-tells the sentence for its own view: from behind, her left hip is on
the left of the picture; facing left, the hairpin is on the far side and
hidden.

**What a directional sheet attaches, in order:** its direction's anchor
first, then the turnaround and the portrait; for the generated second side
of an asymmetric character, the first side's sheet of the same motion last.
Never another motion's sheet. The prompt says what the first image is and
names the facing for every cell:

> The first attached image is the accepted back-view anchor: it owns the
> facing and how she looks from behind in every cell; the other references
> carry identity details only, not the facing. … Back view in every cell: the
> character faces straight away from the viewer, walking away up the screen
> like a top-down RPG character walking north; no face visible in any cell.

### Measured (E7, Lumi back view, 2026-09-27)

A back anchor from the turnaround + portrait (1024², Flare, $0.0707, 23 s),
then a 4×2 back-view walk (2048×1024) three times per condition: **(a)**
turnaround + portrait attached, **(b)** the back anchor first, then both,
with the anchor clause above; prompts otherwise identical and both naming the
facing and the sides. $0.0540 per (a) sheet, $0.0625 per (b) sheet, 20–22 s
each; all six keyed with BiRefNet and run through `run` with zero warnings.
Images $0.42 in all.

| | (a) turnaround + portrait | (b) anchor first |
|---|---|---|
| Cells facing the wrong way | 0 / 24 | 0 / 24 |
| Identity breaks inside a sheet | 0 / 24 | 0 / 24 |
| Sleeve diamond clusters (turnaround's back view has them) | reduced to a trim band with small marks, 24 / 24 | drawn on both sleeves, 24 / 24 |
| Back-panel motif | the turnaround's diamond over a chevron, 24 / 24 | the anchor's two stacked diamonds, 24 / 24 |
| `inspect` max jump / anchor drift x | 9.5–13.5 px / 3.5–4.8 px | 6.5–11.5 px / 2.1–4.0 px |

What it says: on a character whose turnaround already draws the back and a
prompt that names the facing, the anchor bought no facing errors back —
there were none to buy. What it did do is make every sheet look like the
anchor, cell after cell: the sleeves it drew correctly and the motif it
redrew wrongly alike. That is the reason to have one for each direction
(every motion facing that way agrees with one picture), and the reason to
check it first. A colour-histogram distance between sheets, which ignores
pose, does not separate the two conditions (mean pairwise 0.409 vs 0.426).
Not measured: a direction the turnaround does not show — there the anchor is
the only picture of it.
