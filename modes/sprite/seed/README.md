# Sprite seed — Lumi

One character, `lumi/`, ready to play the moment the card is applied. It is
also the worked example the prompting reference points at: every prompt below
is the exact string that produced the file next to it, copied out of
`lumi/project.json`.

## What Lumi is

A chibi **lantern courier** — pale ash-blond bob under an oversized cream
hooded cloak with dark red trim, a brown satchel on a cross-body strap, brown
boots, and a small paper lantern that floats at her shoulder like a pet.

- style anchor (opens every prompt, verbatim): *"Clean anime-chibi line art,
  flat colors, thick uniform outline, no shading."*
- cell `256×256`, facing `right`
- refs: `turnaround` (front / side / back on one sheet) + `portrait`
- motions: `idle` (4×4, 8 fps, loop, anchor bottom) and `attack` (4×4, 10 fps,
  no loop, anchor bottom — a lantern swing), both fully processed
- `attack` also carries one Seedance 2.5 `first-last` clip (480p, 4 s, no audio)

## How it was made

Generated end to end with this mode's own scripts, run exactly as the skill
tells the agent to run them (`node <skill>/scripts/…` from the workspace, every
path workspace-relative). Attempts, in order:

| Asset | Attempts | Note |
|---|---|---|
| `refs/turnaround.png` | 1 | accepted as drawn |
| `refs/portrait.png` | 2 | attempt 1 came back a *different* character (dark brown hair, red cloak) because the portrait call carried no reference; attempt 2 attached `turnaround.png` via `--image-urls` and matched |
| `motions/idle` | 1 | zero inspect warnings |
| `motions/attack` | 1 | zero inspect warnings |
| `motions/attack/video-seedance-1.mp4` | 1 | Seedance 2.5, `first-last` |

**Background path: keying, not transparency.** Every `--background transparent`
call was rejected by OpenRouter with `400 … background: not supported.
Accepted: auto, opaque` — for `gpt-image-2.5-sunburst` *and* for
`gpt-image-2.5-flare`, with and without references. So each sheet was generated
`--background opaque` against a prompt that asks for *a flat solid pure white
background*, probed (`hasAlpha: false`, corner `#fefefe`), then cut out with
`remove-background.mjs --model heavy --resolution 2048` (fal) and fed back in as
`run --alpha`. Alpha coverage after keying: 26.4 % (idle) / 28.6 % (attack).

**Resolution.** Sheets and refs were generated at 2048×2048 and are shipped
here downscaled to 1024×1024, so the sliced cells are 256 px — the character's
own declared `cell`. That keeps the whole seed at 5 MB (budget: 8 MB) with
every asset `project.json` references present, including `sheet-raw.png` (the
provenance root, and what `edit_image.mjs` edits when one cell is wrong). Only
the intermediates were dropped: `cells/`, `run.json`, and the flattened
`first.png` / `last.png` handed to the video model — none of them are registered
assets. Every PNG is `pngquant --quality=85-100`.

## Prompts, verbatim

### `refs/turnaround.png` — `gpt-image-2.5-sunburst`, 2048², quality high

> Clean anime-chibi line art, flat colors, thick uniform outline, no shading. A
> front view, a side view and a back view of the same character standing
> neutral, evenly spaced in one row, identical height and identical camera
> distance in all three. The character is a chibi lantern courier: short bob
> hair, an oversized hooded cloak with the hood down, a worn satchel on a strap
> across the body, short boots, and a small floating paper lantern hovering at
> shoulder height beside the character. The side view faces right. A flat solid
> pure white background, no gradient, no ground shadow, no drop shadow, no
> text, no labels, no numbers.

### `refs/portrait.png` — `gpt-image-2.5-flare`, `--image-urls refs/turnaround.png`

> Clean anime-chibi line art, flat colors, thick uniform outline, no shading. A
> head and shoulders portrait of the character in the attached reference sheet,
> matching it exactly: the same pale ash-blond bob hair with the small red
> clover hairpin, the same cream hooded cloak with dark red trim and diamond
> pattern, the same brown satchel strap across the chest. Three-quarter view
> facing right, calm friendly expression, the small floating paper lantern
> hovering beside the head. A flat solid pure white background, no gradient, no
> ground shadow, no drop shadow, no text, no labels, no numbers.

The first attempt was this prompt *without* the reference and without the
identity clause — it produced a plausible chibi courier who was not Lumi. The
fix is the reference, not the adjectives.

### `motions/idle` — both refs attached

> Clean anime-chibi line art, flat colors, thick uniform outline, no shading. A
> single image laid out as a strict 4x4 grid of 16 equal cells, read left to
> right, top to bottom. The same character in every cell, matching the attached
> references exactly: pale ash-blond bob hair with a small red clover hairpin,
> an oversized cream hooded cloak with dark red trim, a brown satchel on a strap
> across the body, brown boots, and a small floating paper lantern beside the
> character. Facing right, three-quarter view, full body, identical height and
> identical distance from the camera in every cell - the character must not grow
> or shrink across the grid, and the whole character including the lantern stays
> inside its own cell with a clear margin. A 16-frame idle breathing loop: cells
> 1-4 the chest rises and the cloak settles, cells 5-8 the rise peaks and the
> lantern drifts up, cells 9-12 the chest falls and the lantern drifts down,
> cells 13-16 return exactly to the cell-1 pose so the loop closes seamlessly.
> The feet stay planted on the same line in every cell. A flat solid pure white
> background filling every cell, no gradient. No grid lines, no cell borders, no
> numbers, no text, no drop shadow, no ground shadow, no motion blur, nothing
> crossing between cells.

### `motions/attack` — both refs attached

> Clean anime-chibi line art, flat colors, thick uniform outline, no shading. A
> single image laid out as a strict 4x4 grid of 16 equal cells, read left to
> right, top to bottom. The same character in every cell, matching the attached
> references exactly: pale ash-blond bob hair with a small red clover hairpin,
> an oversized cream hooded cloak with dark red trim, a brown satchel on a strap
> across the body, brown boots, and a small paper lantern held on a short cord.
> Facing right, three-quarter view, full body, identical height and identical
> distance from the camera in every cell - the character must not grow or shrink
> across the grid, and the whole character including the lantern stays inside its
> own cell with a clear margin. A 16-frame lantern swing attack: cells 1-4 wind
> up, the weight shifts back and the lantern swings behind the shoulder; cells
> 5-8 the step forward begins and the lantern arcs up overhead; cells 9-12 the
> swing passes through the strike, the lantern sweeping down and forward past
> the front foot; cells 13-16 recover to a ready stance facing right. The feet
> stay on the same ground line in every cell. A flat solid pure white background
> filling every cell, no gradient. No grid lines, no cell borders, no numbers, no
> text, no drop shadow, no ground shadow, no motion blur, no speed lines, no
> impact flash, no glow, nothing crossing between cells.

### `motions/attack/video-seedance-1.mp4` — Seedance 2.5, `image` endpoint + `--end-image`

> The chibi lantern courier swings her paper lantern through one continuous arc:
> she winds up, steps forward, sweeps the lantern down past her front foot, and
> recovers to a ready stance. Flat cel-shaded anime style, plain light neutral
> background, static camera, no text.

First and last frames were flattened onto `#f0ece4` with `sprite-sheet.mjs
flatten` before being handed to the model — video models mishandle alpha.

## What the pipeline measured

| | idle | attack |
|---|---|---|
| frames | 16 | 16 |
| cell | 186×252 | 272×262 |
| anchor drift (px, σ) | 0.306 | 17.373 |
| body drift (px, σ) | 0.199 | 0.263 |
| max jump (px) | 0.5 | 50 |
| scale drift | 0.009 | 0.126 |
| empty frames | none | none |
| warnings | none | none |

`attack`'s scale drift is the lantern arc changing the silhouette's bounding
box, not the character changing size — the drawing holds, which is why it was
accepted on the first attempt.

Both motions are aligned with `--x-from feet` (the default). That is what the
last two rows of the attack column are about: the *body* holds still to a
quarter of a pixel while the *silhouette* swings 17 px, because the lantern
arcs overhead and back. The earlier build pinned the silhouette instead, which
bought that flat anchor drift by shoving the body 17 px from side to side —
`bodyDrift` was 17.4 px on a 216 px cell, an 8 % of cell sideways split every
time the lantern crossed the body. The wider cells are the same trade: sizing
follows the anchor, so a pose that hangs off one side of the feet gets room
instead of being clamped back.
