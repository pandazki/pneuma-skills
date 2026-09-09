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
   identity facts that must not move: facing, proportions, palette,
   distinguishing props.
4. **The motion, cell by cell.** One clause per cell, or one clause per row
   when the row is a phase. This is the part that makes the frames a motion
   rather than sixteen poses.
5. **Negative constraints.** A flat solid pure white background filling every
   cell, no gradient, no cell borders, no numbers, no drop shadow, no ground
   shadow, no motion blur, no effects leaving the cell. The white plate is
   asked for here and cut off afterwards by the keying step — a *drawn* floor
   or a gradient is what makes that cut hard, so name them as negatives.

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

## Three worked prompts

### Chibi idle (4×4, 8 fps, loop)

> Clean anime-chibi line art, flat colors, thick uniform outline, no shading.
> A single image laid out as a strict 4×4 grid of 16 equal cells, read left to
> right, top to bottom. The same character in every cell, matching the
> attached reference sheet exactly: short bob hair, oversized hooded cloak,
> satchel, small floating paper lantern. Facing right, three-quarter view,
> full body, identical height and identical distance from the camera in every
> cell. A 16-frame idle breathing loop: cells 1-4 the chest rises and the
> cloak settles, cells 5-8 the rise peaks and the lantern drifts up, cells
> 9-12 the chest falls, cells 13-16 return exactly to the cell-1 pose so the
> loop closes seamlessly. A flat solid pure white background filling every
> cell, no gradient. No grid lines, no cell borders, no numbers, no text, no
> drop shadow, no ground shadow, no motion blur, nothing crossing between
> cells.

### Pixel walk (4×2, 12 fps, loop)

> 32-bit pixel art, limited 16-color palette, hard pixel edges, no
> anti-aliasing, no gradients. A single image laid out as a strict 4×2 grid of
> 8 equal cells, read left to right, top to bottom. The same character in
> every cell, matching the attached reference: green tunic, leather boots,
> short sword on the back. Side view facing right, full body, identical pixel
> height in every cell. An 8-frame walk cycle: contact, down, pass, up for the
> left leg in cells 1-4 and the mirrored half for the right leg in cells 5-8,
> arms swinging opposite the legs, the head bobbing one pixel. A flat solid
> pure white background filling every cell, no gradient. No grid lines, no
> numbers, no shadow, no anti-aliased halo around the sprite.

### Anime attack (4×4, 10 fps, no loop)

> Crisp anime cel-shading, two-tone shadows, clean ink outline. A single image
> laid out as a strict 4×4 grid of 16 equal cells, read left to right, top to
> bottom. The same character in every cell, matching the attached references
> exactly. Three-quarter view facing right, full body, identical height and
> identical camera distance in every cell — the character must not grow or
> shrink across the grid. A 16-frame sword attack: cells 1-4 wind up and
> weight shifts back, cells 5-8 the step forward begins, cells 9-12 the swing
> passes through the strike, cells 13-16 recover to a ready stance. The blade
> stays inside its own cell at all times. A flat solid pure white background
> filling every cell, no gradient. No speed lines, no impact flashes, no glow,
> no motion blur, no cell borders, no numbers, no shadow.

## What breaks consistency, and the phrasing that fixes it

| Symptom | Cause | Fix in the prompt |
|---|---|---|
| Character faces left in some cells | No facing declared, or an ambiguous "turning" clause | "Facing right in every cell" — and never ask for a turn inside one sheet; make the turn its own motion |
| Character grows or shrinks across the grid | The model treats each cell as its own composition | "Identical height and identical distance from the camera in every cell — the character must not grow or shrink across the grid" |
| Numbers or letters in the corners | Grids read as contact sheets to the model | "No numbers, no labels, no text anywhere" |
| A grey, tinted or gradient plate behind the sprite | The model drew its own backdrop instead of the flat white you asked for | Say "a flat solid pure white background filling every cell, no gradient" — a gradient is what makes the cut-out (workflow B step 6) leave a halo. A *flat* plate of any colour is fine; the keyer takes it |
| Sprite clipped at a cell edge | The pose is bigger than the cell | "The whole character, including the weapon, stays inside its own cell with a clear margin" |
| Ground shadow follows the sprite | Default illustration habit | "No ground shadow, no drop shadow, no contact shadow" — a shadow is opaque and it lands in the alpha, so the aligner treats it as part of the silhouette |
| Effects bleed between cells | Motion blur, speed lines, glow | "Nothing crossing between cells, no motion blur, no speed lines, no glow" |
| Frame 16 does not return to frame 1 | Nobody asked it to | "Cells 13-16 return exactly to the cell-1 pose so the loop closes seamlessly" |

Two of those — scale drift and cell clipping — the `inspect` report names for
you (`scaleDrift`, "cell NN is clipped"). Read the report before rewriting the
prompt, so the rewrite targets the fault the pipeline actually measured.

## Frame-to-frame continuity

The model does not animate; it draws sixteen pictures and you asked for them
to be related. Give it the relation explicitly:

- **Name the phases, not the frames.** "Cells 1-4 wind up, 5-8 step through,
  9-12 strike, 13-16 recover" produces a readable arc. Sixteen separate
  sentences produce sixteen unrelated poses.
- **Name what carries through.** The weight foot, the arc a weapon traces, the
  direction a cloak lags. "The cloak lags one beat behind the body throughout"
  buys more continuity than three extra pose descriptions.
- **Close the loop explicitly** when `loop: true`, referencing cell 1 by
  number.
- **For a non-loop motion, name the end state** — "recover to a ready stance"
  — or the last cell is wherever the swing happened to stop.

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
