# Sprite showcase

The 1376 × 768 gallery PNGs are stylized dark mockups of the motion stage
composed around **real sprite assets**. Not one pixel was generated for the
showcase: every sheet, frame, clip and still is the output of a run of the
mode that happened for its own reasons, and no sprite was retouched. Images
are only scaled and cropped by CSS; the pixel-art frames and the edge crops
are scaled nearest-neighbour (`image-rendering: pixelated`).

All six images come from the 0.5.0 round (the sprite-gen absorption) and its
three blind cold-start trials, one per route: **Kagari** (route G, a game
character for Phaser), the **frog wizard** (route A, the creator's own
picture) and the **slime** (route G-pixel, a pixel-art RPG enemy). The
fourth trial (four facings) is not shown: its side walks carried the basket
on the wrong side, which was that trial's failure.

## Status

| `showcase.json` media | `?view=` |
|---|---|
| `hero.png` | `hero` |
| `highlight-say-what-its-for.png` | `routes` |
| `highlight-picture-breathes.png` | `breathe` |
| `highlight-pixel-stays-pixel.png` | `pixel` |
| `highlight-every-pose-whole.png` | `ink-slice` |
| `highlight-clean-warm-edges.png` | `edges` |

`registration.test.ts` fails if `showcase.json` ever names a file that is not
on disk — the launcher serves `showcase/*` straight off disk, so that would be
a 404 on a gallery card and nothing else would report it.

## The outputs were re-run on the final scripts

The trials ran on an earlier 0.5.0 build. Before capture, their workspaces were
**copied** and the free local steps re-run on the copies with the final
`sprite-sheet.mjs` / `sprite-project.mjs` — no image, video or matting call:

| Motion | Re-run | What changed |
|---|---|---|
| Kagari `walk` | `from-video video-seedance-1.mp4 --trim-start 1.083 --trim-end 2.417 --frames 12 --loop --x-from trend --body-height 492 --cols 4 --scale 0.5` (the trial's flags, minus its `--similarity 0.3`) | un-mix keyer: keyFringe 0.0373 → 0, keyResidue 0.0036 → 0 |
| Kagari `attack` | `run` on the trial's **original** sheet (`sheet-raw-original.png` + `sheet-alpha-original.png`; the trial agent had re-laid the sheet by hand) with `--rows 4 --cols 4 --fps 12 --no-loop --scale 0.5` | the fixed grid clipped 7 cells, so the run fell back to slicing by ink: 0 clipped |
| Frog `idle` | `breathe refs/still.png --out motions/idle --name idle` | same parameters; 9 of 12 frames byte-identical, the other 3 differ in a single pixel, by one level; the head offset and its extremes are now in the run summary |
| Slime `idle` | `run --pixel --pitch-hint 11 --logical-height 27` with the pinned palette | byte-identical frames; the declared height (27) is now honoured |
| Slime colourways | `recolor slime` (the two recorded colourways) | byte-identical variants |

Each re-run was registered on the copy (`register-run`, plus the trial's own
`set-motion --fps 9` on the walk and its warning acknowledgement on the
attack). The whole-character exports were then made on the copies:
`export kagari --format aseprite`, `rive kagari`, `rive slime`, and
`export frog-wizard/motions/idle --format webm|apng|lottie`.

## What the images are made of

| Image | Assets → numbers |
|---|---|
| `hero.png` | Kagari: `refs/turnaround.png`, `refs/portrait.png`; `idle/00`, `walk/03`, `attack/03–10` frames; one frame of `walk/video-seedance-1.mp4` at 1.083 s (`ffmpeg -ss 1.083`). Header from `project.json` + attack `inspect.json` / `atlas.json` (declared 256, measured 578×520, packed ×0.5, facing right); motion rows from the motion records (4×2 · 8 · 3.3 fps, 4×3 · 12 · 9 fps, 4×4 · 16 · 12 fps); anchor 289, 512; 0 clipped (`slice.clipped`); `kagari-aseprite.zip` 36 frames, 1156 × 2320, 1,765,649 B; `kagari.riv` 1,005,386 B, inputs `motion` and `play_attack` |
| `highlight-say-what-its-for.png` | G: Kagari `idle/00`, `walk/03`, `attack/07`, the Aseprite export (36 frames, 3 tags). A: the frog's `upload.png` and breathe frame 10, `preview.webp` 12 frames at 8 fps. L: the frog's breathe exported — `idle.webm` 58,319 B (VP9, alpha), `idle.apng` 1,796,402 B, `idle.json` 2,522,689 B. M: slime `idle/00` at 3×, `slime.riv` 8,827 B (lossless WebP, input `motion`, trigger `play_jump`) and `kagari.riv`. The quotes paraphrase the trials' opening messages ("for my Phaser game", "my homepage corner") |
| `highlight-picture-breathes.png` | Frog: `refs/upload.png` (1024 × 1536), `refs/still.png` (221 × 496), breathe frames 03, 00, 10. From the breathe run summary: depth 0.02, smooth (from the style), 12 frames · 8 fps · 1.5 s, rigid row y 221 at the neck, per-frame head offset −2, 1, 4, 5, 4, 3, 1, −1, −2, −4, −5, −4 (travel 10, highest 10, lowest 03), head identical to the still in 12 of 12 frames, body height 475–485 (still 480); anchor drift 0 from `inspect.json`, whose frame boxes give the hat guides (y 9 on frame 10, y 19 on frame 03) |
| `highlight-pixel-stays-pixel.png` | Slime: `motions/idle/cells/00.png` (the sheet cell, 2×) beside idle frame 00 (22×), registered block for block (the cell's pixel (93, 155) is the frame's block (12, 13), pitch 11); idle frame 00 and its `lv2-blue` / `lv3-red` variants at 4×; the 48 colours of `palette.json`, outlined where `recolor.json` leaves them unmapped. Numbers: logical height declared 27 / measured 27, pitch 11 × 11, `inspect.pixel.held` true, 38 colours mapped per colourway, 4,133 px swapped on idle per colourway, 10 colours left as they were (782 px over idle and jump), 0 unmatched |
| `highlight-every-pose-whole.png` | Kagari attack: the original 2048² `sheet-raw.png`, with the 512 grid and the ink cuts drawn over it from the run's `slice.cuts` (rows at 551 / 1038 / 1536; columns per row); cells 03, 06, 07 of a `--no-auto-slice` run (512 × 512, clipped at the bottom, right and left edge) beside the same cells of the ink slice (561 × 530). `gridClipped` 00–03, 06, 07, 08 (7 of 16), `clipped` none, natural 4 rows × 4 poses, none forced, grew 27 / 0 / 22 / 18 px |
| `highlight-clean-warm-edges.png` | Kagari walk frame 03: the trial's delivered frame and the re-keyed one, the same window of about 62 × 52 px at 4× on #0a0a0d and #f5f5f5 (the re-keyed frame sits 1 px left and 1 px lower: alpha boxes 17,10 vs 16,11). keyFringe 0.0373 → 0, keyResidue 0.0036 → 0, 1 warning → 0: `inspect --key "#00f604"` on a copy of the trial's frames vs the re-run's `inspect.json`. The clip still is the one in the hero |

The trial's delivered walk was keyed by the trial build with
`--similarity 0.3`; the amend round's own before/after (keyFringe 0.0231 → 0)
compared that build's keyer at the default 0.22, so its "before" number differs.
The amend ledger's "8 of 16 cells clipped" for the attack is 7: its warning
list reads six cells and "…and 1 more".

Not shown, on purpose: the slime's jump. Re-cut on a copy with `--y-from cell`
its lift reads 4, 2, 0, 5, 15, 11, 8, 5 px and the run warns that row 1
(frames 04–07) never comes down to the ground row 0 stands on: the model drew
that row on a higher ground line, so the landing squash floats 8 px up. The
amend round's E4 jump clip, which does keep its height, is Lumi — a seed
character from an earlier round.

## Regenerate

`.tmp-sprite-showcase/` is an ignored working directory (`.tmp-*/` is in the
repo's `.gitignore`). Stage it from the refreshed copies, keeping these paths
(the ones `layout.html` reads):

```
.tmp-sprite-showcase/
  kagari/refs/{turnaround,portrait}.png
  kagari/idle/NN.png          kagari/walk/NN.png         (re-keyed frames)
  kagari/walk-trial/NN.png    (the trial's delivered walk frames)
  kagari/walk-clip.png        (ffmpeg -ss 1.083 -i video-seedance-1.mp4 -frames:v 1)
  kagari/attack/NN.png        (ink-sliced frames)
  kagari/attack-sheet-raw.png (sheet-raw-original.png)
  kagari/attack-cells-grid/NN.png   (cells/ of the --no-auto-slice run)
  kagari/attack-cells-ink/NN.png    (cells/ of the ink-sliced run)
  frog/{upload,still}.png     frog/NN.png   (breathe frames)
  slime/cell-00.png           (motions/idle/cells/00.png)
  slime/idle/NN.png  slime/lv2-blue/NN.png  slime/lv3-red/NN.png
  slime/palette.json          slime/recolor.json
```

Then, from the repository root:

```sh
SHOWCASE_PORT=18643 bun modes/sprite/showcase/preview.mjs .tmp-sprite-showcase
```

`preview.mjs` serves only the staged artwork, `layout.html` and the
repository's bundled fonts on localhost. It launches no agent and touches no
session. `SHOWCASE_PORT` defaults to 18143; use a free port.

Capture each view at exactly 1376 × 768 CSS pixels and a device scale factor
of 1, with a headless browser of your own (a fresh profile), once fonts,
images and the pixel view's two JSON fetches have landed (`body[data-ready]`
is set then). A headless shell does it in one call per view:

```sh
chrome-headless-shell --user-data-dir=<fresh profile> --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1376,768 \
  --virtual-time-budget=15000 --screenshot=hero.png \
  "http://127.0.0.1:18643/?view=hero"
```

Then compress all of them in place:

```sh
pngquant 128 --quality=80-100 --speed 1 --ext .png --force modes/sprite/showcase/*.png
```

That brings 210–590 KB captures down to 75–175 KB with no visible banding —
worth doing, because the launcher ships every mode's showcase inside the npm
package, and the package is close to the registry's size limit. Keep each
image under about 180 KB.
