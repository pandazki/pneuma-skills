# Lucid showcase

The 1376 × 768 gallery PNGs are stylized dark mockups of the lucid instrument
panel composed around **real assets that already existed**. Not one pixel was
generated for the showcase: the target, the three round captures, the four
textures, the scores, the gap ids, the ledger rows and the scene vitals all
come out of one run of the mode that happened for its own reasons — the
zero-leak blind trial, whose project is now the shipped seed
(`modes/lucid/seed/ember-abbey/`).

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
| `hero.png` | The stage in Split: `rounds/03/capture.png` under `target.png`, wiped at 53 %, with the rounds rail (`R1 3.35 · R2 4.0 · R3 4.25`, round 3 marked `rethink`), the trajectory sparkline on the rubric's own 0–10 scale, the status strip, and the four ledger rows with the four `scene/textures/*.png` thumbnails |
| `highlight-locked-target.png` | The project's real `brief` quoted verbatim from `lucid.json`, an orange arrow, and `target.png` at its real size (1456 × 819) with the `v1 · locked` badge and the **empty** history strip — the run never replaced its target, and the strip says what would land there if it had |
| `highlight-wipe-compare.png` | The Split stage close-up: `rounds/02/capture.png` under `target.png`, seam at 45 %, corner labels `Target` / `Round 2`, with round 2's real score (4.0 / 10) on the caption line |
| `highlight-fresh-judge.png` | Round 3's verdict, read straight out of `lucid.json`: the four axis scores (1.45 / 1.3 / 1.2 / 0.3 against the rubric's 3 / 3 / 3 / 1), the 4.25 total, three of its nineteen gaps with their real ids, areas, issues and fixes, an excerpt of its `summary`, the 3.35 → 4.0 → 4.25 trend, and the `stall-approaching` verdict with both of `evaluation.reasons` |
| `highlight-asset-ladder.png` | The four rungs from `skill/references/assets.md` with the real endpoints and prices, the real `blender.mjs doctor` line from this machine, the four `assets[]` rows (id · role · source · state) and the `knight` note quoted verbatim, the four generated textures, the scene vitals, and `rounds/03/capture.png` as what those four assets add up to |

### Where each number comes from

- **Scores, gap ids, areas, issues, fixes, summaries, `stall-approaching` and
  its two reasons, the asset rows and their notes, the brief, the target's
  version and lock time** — `modes/lucid/seed/ember-abbey/lucid.json`, verbatim
  or trimmed, never reworded into a different claim.
- **Stage 1091 × 738** — the stage size the blind trial ran at, recorded in
  `docs/proposals/2026-09-16-lucid-blind-trial-findings.md`. The same note is
  the source of `42 min` (the budget the agent set itself) and of
  `/root/judge_03` (the judge subagents were `/root/judge_NN`, one per round).
- **`120 fps · 8.3 ms · 240 draws · 1.66M tris · 11 textures`** —
  `renderer.info` as the scene's own bridge reports it. Re-measured from the
  shipped seed rather than copied from a transcript, so it is reproducible:

  ```sh
  # serve modes/lucid/seed/ember-abbey/scene/ on a port, load it in headless
  # Chrome with --remote-debugging-port, then over CDP:
  #   Runtime.evaluate: JSON.stringify(window.__lucidBridge.state())
  # → { fps: 120.9, fpsSource: "render", frameMs: …, drawCalls: 240,
  #     triangles: 1664160, textures: 11, geometries: 53, errors: [] }
  ```

  `fps` is render-based (the bridge wraps `renderer.render`), `8.3 ms` is
  120 fps expressed as a frame time, and `1.66M` is `compactCount(1664160)` —
  the same function the status strip uses. The draw count moves by a couple
  with the lazy-follow camera's frustum culling; 240 is what the scene reports
  at its opening camera.

The two round captures and the target are only scaled and cropped by CSS —
`object-fit: cover` inside the mockup's stage box, both layers at the same
scale so the wipe compares like with like. No image was retouched, recoloured
or regenerated.

The one thing in these frames that is a composition rather than a reading: the
project title is shown as `Ember Abbey`, while `lucid.json` carries the full
`余烬修道院 · Ember Abbey`. The bundled DM Sans has no CJK glyphs, so the real
string would render as tofu.

## Regenerate

`.tmp-lucid-showcase/` is an ignored working directory (`.tmp-*/` is in the
repo's `.gitignore`). Stage it from the seed — the filenames `layout.html`
references:

```sh
S=modes/lucid/seed/ember-abbey
mkdir -p .tmp-lucid-showcase/tex
cp $S/target.png            .tmp-lucid-showcase/target.png
cp $S/rounds/01/capture.png .tmp-lucid-showcase/r01.png
cp $S/rounds/02/capture.png .tmp-lucid-showcase/r02.png
cp $S/rounds/03/capture.png .tmp-lucid-showcase/r03.png
cp $S/scene/textures/*.png  .tmp-lucid-showcase/tex/
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

That lands these five between 120 KB and 420 KB (1.4 MB for the directory).
Heavier than sprite's 90–180 KB, and intrinsically so: most of every lucid
frame is a photographic render, where sprite's frames were mostly flat dark
panel. Lowering pngquant's quality floor, disabling dithering and dropping to
160 colours were all measured and bought at most 12 % — not worth the banding.
The directory is still under the per-mode showcase average in this repo
(~2 MB), and the launcher ships every mode's showcase inside the npm package.

Nothing in `layout.html` animates, so a re-capture is byte-comparable apart
from PNG encoding.
