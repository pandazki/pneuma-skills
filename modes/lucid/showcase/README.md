# Lucid showcase

The 1376 × 768 gallery PNGs are stylized dark mockups of the lucid instrument
panel composed around **real assets that already existed**. Not one pixel was
generated for the showcase: the target, the four round captures, the textures,
the scores, the gap ids, the ledger rows and the scene vitals all come out of
one run of the mode that happened for its own reasons — the second blind trial,
"The Weeping Sanctuary" (`docs/proposals/2026-09-16-lucid-blind-trial-findings.md`,
section 5). The shipped seed is a different, smaller project
(`modes/lucid/seed/ember-abbey/`, the first trial).

## Status

All four highlights are captured.

| `showcase.json` media | `?view=` |
|---|---|
| `hero.png` | `hero` |
| `highlight-locked-target.png` | `locked-target` |
| `highlight-wipe-compare.png` | `wipe-compare` |
| `highlight-fresh-judge.png` | `fresh-judge` |
| `highlight-asset-ladder.png` | `asset-ladder` |

`registration.test.ts` fails if `showcase.json` ever names a file that is not
on disk — the launcher serves `showcase/*` straight off disk, so that would be
a 404 on a gallery card and nothing else would report it.

## What the images are made of

| Image | Assets |
|---|---|
| `hero.png` | The stage in Split: `rounds/04/capture.png` under `target.png`, wiped at 53 %, with the rounds rail (`R1 4.85 · R2 5.75 · R3 5.95 · R4 6.10`, rounds 3 and 4 marked `rethink`), the trajectory sparkline on the rubric's own 0–10 scale, the status strip (`Stalled · a rethink under a full point`, `60 fps · 16.6 ms · 249 draws · 3.68M tris · 22 textures`), and four of the twelve ledger rows with four `scene/textures/*.png` thumbnails |
| `highlight-locked-target.png` | The project's real `brief` quoted verbatim from `lucid.json`, an orange arrow, and `target.png` at its real size (1524 × 1032) with the `v1 · locked` badge and the **empty** history strip — the run never replaced its target |
| `highlight-wipe-compare.png` | The Split stage close-up: `rounds/04/capture.png` under `target.png`, seam at 45 %, corner labels `Target` / `Round 4`, with round 4's real score (6.10 / 10) on the caption line |
| `highlight-fresh-judge.png` | Round 4's verdict, read straight out of `lucid.json`: the four axis scores (2.05 / 1.95 / 1.65 / 0.45 against the rubric's 3 / 3 / 3 / 1), the 6.10 total, three of its seventeen gaps with their real ids, areas, issues and fixes, an excerpt of its `summary`, the 4.85 → 5.75 → 5.95 → 6.10 trend, and the `stalled` verdict with `evaluation.reasons[0]` verbatim plus the seventeen `stubbornGaps` |
| `highlight-asset-ladder.png` | The four rungs from `skill/references/assets.md` with the real endpoints and list prices, the real `blender.mjs doctor` line from this machine, five of the twelve `assets[]` rows (id · role · source · state) and the `saint` note quoted verbatim, the fal bill at list price ($3.02, six jobs), four textures (two generated albedos, a derived normal map, the banner cloth), the scene vitals, and `rounds/04/capture.png` as what those twelve assets add up to |

### Where each number comes from

- **Scores, gap ids, areas, issues, fixes, the summary, `stalled` and its
  reason, the seventeen `stubbornGaps`, the asset rows and their notes, the
  brief, the target's version and lock time** — the trial project's
  `lucid.json` (`~/lucid-blind-2/dusk-shrine/`, not shipped), verbatim or
  trimmed, never reworded into a different claim. The findings document
  (section 5) records the same run.
- **Stage 1100 × 733** — the stage size the trial's first capture ran at
  (a 1650 × 1100 capture at a 1.5 pixel ratio).
- **`60 fps · 16.6 ms · 249 draws · 3.68M tris · 22 textures`** —
  `get-scene-state` as the scene's own bridge reported it in the windowless
  Chrome the trial ran in after its resume (60 Hz cap); `fps` is render-based
  (the bridge wraps `renderer.render`), `16.6 ms` is 60 fps as a frame time,
  and `3.68M` is `compactCount(3682660)`, the same function the status strip
  uses.
- **`$3.02 image-to-3D at list price`** — the project's six fal jobs priced by
  `skill/scripts/costs.mjs` (five Tripo H3.1 detailed at $0.60, one Trellis at
  $0.02), the number `lucid.mjs status` prints as `costs.fal.usd`.
- **`tripo3d/h3.1 detailed ≈ $0.60 · fal-ai/trellis $0.02`** — `prices.mjs`.
- **The blender doctor line** — `blender.mjs doctor` on this machine.

The round capture and the target are only scaled and cropped by CSS —
`object-fit: cover` inside the mockup's stage box, both layers at the same
scale so the wipe compares like with like. The four texture thumbnails were
downscaled to 512 px for the staging directory. No image was retouched,
recoloured or regenerated.

## Regenerate

`.tmp-lucid-showcase/` is an ignored working directory (`.tmp-*/` is in the
repo's `.gitignore`). Stage it from the trial project — the filenames
`layout.html` references (`r04.png` and `target.png` are the ones on screen;
`r01`–`r03` are kept for a re-composition):

```sh
S=~/lucid-blind-2/dusk-shrine
mkdir -p .tmp-lucid-showcase/tex
cp $S/target.png .tmp-lucid-showcase/target.png
for n in 1 2 3 4; do cp $S/rounds/0$n/capture.png .tmp-lucid-showcase/r0$n.png; done
for t in stone paving stone-normal banner; do sips -Z 512 $S/scene/textures/$t.png --out .tmp-lucid-showcase/tex/$t.png; done
```

Then, from the repository root:

```sh
bun modes/lucid/showcase/preview.mjs            # serves on 127.0.0.1:18144
```

`preview.mjs` serves only the staged artwork, `layout.html` and the
repository's bundled fonts on localhost. It launches no agent and touches no
session.

Capture each view at exactly 1376 × 768 CSS pixels. A CLI Chrome with its own
profile is what these were shot with — it cannot collide with a running
browser or with the chrome-devtools MCP's profile:

```sh
for v in hero locked-target wipe-compare fresh-judge asset-ladder; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --user-data-dir="/tmp/lucid-shot-$v" --no-first-run \
    --hide-scrollbars --force-device-scale-factor=1 --window-size=1376,768 \
    --virtual-time-budget=5000 --screenshot="/tmp/$v.png" \
    "http://127.0.0.1:18144/?view=$v"
done
```

`--force-device-scale-factor=1` is what keeps a Retina machine from producing
2752 × 1536; check with `magick identify` before compressing. Then rename them
to the `showcase.json` media names and compress in place:

```sh
pngquant --quality=85-100 --speed 1 --ext .png --force modes/lucid/showcase/*.png
```

That lands these five between 90 KB and 450 KB (1.3 MB for the directory).
Heavier than sprite's 90–180 KB, and intrinsically so: most of every lucid
frame is a photographic render, where sprite's frames were mostly flat dark
panel. Lowering pngquant's quality floor, disabling dithering and dropping to
160 colours were all measured and bought at most 12 % — not worth the banding.
The directory is still under the per-mode showcase average in this repo
(~2 MB), and the launcher ships every mode's showcase inside the npm package.

Nothing in `layout.html` animates, so a re-capture is byte-comparable apart
from PNG encoding.
