# Sprite showcase

The 1376 × 768 gallery PNGs are stylized dark mockups of the motion stage
composed around **real sprite assets that already existed**. Nothing was
generated for the showcase — no image model, no video model, no paid call.

## Status

Four highlights are declared in `showcase.json`. Three are captured;
`highlight-sheet-or-video.png` is **pending** — see below.

| `showcase.json` media | `?view=` | State |
|---|---|---|
| `hero.png` | `hero` | captured |
| `highlight-character-locked-sheets.png` | `character-locked` | captured |
| `highlight-auto-slice-align.png` | `slice-align` | captured |
| `highlight-sheet-or-video.png` | `sheet-or-video` | **pending assets** — layout composed, not captured |
| `highlight-any-style-any-grid.png` | `any-style` | captured |

`registration.test.ts` pins that gap explicitly: `PENDING_MEDIA` names the file
and the reason, one test allows exactly those names to be missing, and another
fails the moment the image lands and the exemption is not removed. The launcher
serves `showcase/*` straight off disk, so until then that one gallery card 404s
— deliberate and loud, not silent.

### What `sheet-or-video` still needs

The right-hand path in that view (the video-sourced one) is composed around
staged files that do not exist yet. Drop them under
`.tmp-sprite-showcase/video-source/` and the view renders with no edit to
`layout.html` — the slots are real `<img>` elements at the final paths:

| Staged path | Used for |
|---|---|
| `video-source/clip-still.png` | one still from the Seedance clip **before keying**, character on chroma green — the "source" panel |
| `video-source/frames/00.png` `03` `06` `09` | four sampled + keyed + aligned frames (transparent PNG) — the output strip |

Two more files are wanted as text, not art, so the panel's numbers stay real
rather than invented: the motion's `inspect.json` (frame count, cell, anchor
drift) and its `atlas.json`. The caption's cost/time figures
("one sheet ≈ 35 s · one 4 s Seedance clip ≈ $1, 5–7 min") are already in
`layout.html` and should be reconciled against whatever the real run measures.

## What the images are made of

| Image | Assets |
|---|---|
| `hero.png` | Lumi (the shipped seed, `modes/sprite/seed/lumi/`): `attack` frames 04–11 on the stage and strip, `attack/preview.gif`, one frame lifted out of `attack/video-seedance-1.mp4` with ffmpeg, plus one frame each from Rivet / Ame / Mio as the character rail |
| `highlight-character-locked-sheets.png` | Lumi's `refs/turnaround.png` and `refs/portrait.png` beside both packed sheets, `attack/sheet.png` and `idle/sheet.png` |
| `highlight-auto-slice-align.png` | Rivet's `walk` motion — all 8 aligned frames, with the numbers (0.22 px anchor drift, 0.5 px max jump, 0 empty frames) and the `atlas.json` excerpt taken verbatim from that motion's real output |
| `highlight-sheet-or-video.png` | *(pending)* left path: Lumi's `attack/sheet.png` and four of its frames; right path: the video-source files listed above |
| `highlight-any-style-any-grid.png` | Four packed sheets and four style sentences quoted from `project.json`: Lumi `idle` 4 × 4, Rivet `walk` 2 × 4, Ame `attack` 4 × 4, Mio `pickup-letter` 3 × 3 |

Lumi ships in the repo. Rivet (flat-vector cat knight), Ame (128px pixel art)
and Mio (semi-realistic) come from three end-to-end runs of the mode and live
outside the repo; only the frames used above were copied into the ignored
working directory, never into `modes/`.

Reference images (`turnaround.png`, `portrait.png`) are drawn on white, so the
layout keys them with `ffmpeg -vf colorkey=0xffffff:0.015:0.0` before placing
them on the dark checkerboard — the same operation the pipeline's `key` step
performs. Everything else was already transparent. No sprite was retouched;
images are only scaled and cropped by CSS.

Every number and filename in the mockups is real: cell sizes, frame counts,
fps, anchor points, clip durations, style sentences and the atlas excerpt all
come from the matching `inspect.json` / `atlas.json` / `project.json`.

## Regenerate

`.tmp-sprite-showcase/` is an ignored working directory (`.tmp-*/` is in the
repo's `.gitignore`). Stage it with the assets listed above — one flat
directory per character (`lumi/`, `rivet/`, `ame/`, `mio/`, plus
`video-source/`) using the filenames referenced from `layout.html` — then, from
the repository root:

```sh
bun modes/sprite/showcase/preview.mjs            # serves on 127.0.0.1:18143
```

`preview.mjs` serves only the staged artwork, `layout.html` and the
repository's bundled fonts on localhost. It launches no agent and touches no
session.

Capture each view at exactly 1376 × 768 CSS pixels once the fonts and images
have loaded:

```sh
chrome-devtools new_page "http://127.0.0.1:18143/?view=hero"
chrome-devtools emulate --colorScheme dark
chrome-devtools resize_page 1376 768
chrome-devtools take_screenshot --filePath modes/sprite/showcase/hero.png
```

If the display is Retina and a PNG comes out 2752 × 1536, downscale it first:

```sh
ffmpeg -i shot.png -vf scale=1376:768:flags=lanczos out.png
```

Then compress all of them in place:

```sh
pngquant --quality=85-100 --speed 1 --ext .png --force modes/sprite/showcase/*.png
```

That runs roughly 400 KB per image down to 90–180 KB with no visible banding —
worth doing, because the launcher ships every mode's showcase inside the npm
package.

Note that `hero.png` embeds a live `preview.gif`, so the exact frame that lands
in the screenshot varies between runs. That is cosmetic; any frame of the loop
reads correctly.
