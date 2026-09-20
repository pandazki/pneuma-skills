# Previz showcase

The six 1376 × 768 gallery PNGs are stylized dark mockups of the previz player
composed around **real assets that already existed**. Not one pixel was
generated for the showcase: every frame is an `ffmpeg` still out of the shipped
seed's own two clips, both 3D pictures are WebGL captures of the real viewer
driving the seed's own `scene.glb`, and every number, label, check id, note and
price is read out of
`modes/previz/seed/first-light/shots/lab-walk/` (`shot.json`, `comparison.md`,
`prompts.md`, `shot-plan.md`) or `skill/scripts/prices.mjs`.

They were re-made after the mode moved to **pawns** (commits `5a86d00e` +
`e1cc564e`): the greybox no longer has limbs, so a picture that showed a
mannequin walking — or a check called `gait-phase` — would have been a picture
of a design that no longer exists.

## Status

All five highlights are captured.

| `showcase.json` media | `?view=` |
|---|---|
| `hero.png` | `hero` |
| `highlight-greybox-take.png` | `greybox-take` |
| `highlight-one-clock.png` | `one-clock` |
| `highlight-3d-inspection.png` | `3d-inspection` |
| `highlight-acceptance.png` | `acceptance` |
| `highlight-cost.png` | `cost` |

`__tests__/showcase.test.ts` fails if `showcase.json` ever names a file that is
not on disk, or if a capture is not exactly 1376 × 768 — the launcher serves
`showcase/*` straight off disk, so a missing file is a 404 on a gallery card
and a Retina-scaled capture is a silently cropped one, and nothing else
reports either.

## What the images are made of

| Image | Assets |
|---|---|
| `hero.png` | The player in Side at **02.90 s · f 71 / 192** — the moment the division of labour is visible: `greybox/greybox.mp4` shows the pawn a third of the way to the console, `takes/take-01.mp4` shows a scientist mid-stride at the same spot. Real lane headers (`1280×720 · 24 fps · 192 f · 8.00 s · rev 1` / `854×480 · 24 fps · 193 f · 8.04 s`), the transport, the beat timeline with all seven beats in their kind rows and the `touch → glow` connector, the shots rail card, five rows of the Checks panel |
| `highlight-greybox-take.png` | Six matching instants — 0.25 / 2.90 / 4.20 / 5.40 / 5.90 / 7.80 s — pawn over person. The blocked/acted split is quoted from `shot-plan.md`'s own “where it lives” column, the quotation is from the prompt in `prompts.md`, and the two check cards are `take-motion` and `take-body` with their notes verbatim |
| `highlight-one-clock.png` | The Wipe stage at 05.40 s (greybox left of the seam, take right, both 16:9 with no crop), the Side and Blend tiles at the same instant, the probe facts in the lane headers, and the measured `8.0417 s` against a greybox rendered to exactly `8.00 s` |
| `highlight-3d-inspection.png` | Two WebGL captures of **this seed's `scene.glb`** at **02.40 s · f 59 / 192**, taken from a live `--viewing` session: the greybox lane in **3D · Free** (camera path, frustum gizmo, the pawn, its floor trail, the ground grid and the viewer's own `Inspection view — the model received the Render, not this.` caption), annotated with five callouts; and the same lane in **3D · Shot camera**, boxed to the shot's aspect |
| `highlight-acceptance.png` | Two real acceptance records side by side — `lab-walk` (the shipped seed: 13 checks, all pass, each with its evidence line) and `fridge-light` (another project, caught the moment its take landed: 8 greybox checks pass, 5 take checks still `unverified`) — the three-state legend, and the timeline with `trigger-order`'s own 05.30–05.90 s span marked |
| `highlight-cost.png` | `take-01`'s recorded cost (`$2.12`, basis `(8 s out + 8 s ref) x $0.1323/s at 480p`), its request record, the four-cell Seedance price table from `prices.mjs`, the same 8 s shot priced through each of those four cells, and the take-policy ladder from the skill |

### Where each number comes from

- **Spec, beats, lane facts, check ids/labels/ranges/notes/statuses, the take's
  resolution, frames, duration, request id, timestamps, `selected` and the
  `$2.1168` cost with its basis string** — `shots/lab-walk/shot.json`, verbatim
  or trimmed, never reworded into a different claim.
- **`greybox rev 1` and `rendered in 9.4 s`** — `greybox.revision` and
  `greybox.final.renderSeconds` of that same file.
- **`02.90 s · f 71 / 192`, `05.40 s · f 131 / 192`, `02.40 s · f 59 / 192`** —
  `frameAt()` in `domain.ts` (`1 + round(t × fps)`), the same function the
  transport's readout uses; the 3D page's label is the one visible in the
  capture itself.
- **`8 pass` / `5 pass` / `13 checks`** — `checkTally()` over the thirteen
  checks: eight on the greybox, five on the take.
- **The blocked / acted lists** — the “where it lives” column of
  `shot-plan.md`, condensed but not re-assigned.
- **`$0.1323 · $0.2205 · $0.2838 · $0.4730`, the basis sentence and
  `Read 2026-09-20`** — `skill/scripts/prices.mjs`.
- **`$2.12 / $1.76 / $4.54 / $3.78`** — `priceTake()`'s arithmetic on that table
  for this shot's 8 s (billed 16 s where a reference is carried). `$2.12` is the
  one that was actually run and is the number in `shot.json`.
- **The `fridge-light` record** — a cold-start agent's own shot, captured at the
  moment its take landed, staged for this showcase as
  `trial3-shot-just-landed.json` outside the repository. Its check ids, labels,
  statuses, notes, the `12:01:52Z` landing time and the `rev 3` greybox are
  verbatim. Its title is in Chinese and is therefore not printed in the image;
  the shot is named by its id.
- **The take-policy ladder** — `skill/SKILL.md` (“a second take needs a concrete
  fix you can name (`--fix`); a third needs the user's explicit yes
  (`--user-approved`)”).

### What is a real capture and what is a mockup

- **Real, unretouched captures:** every greybox and take frame (`ffmpeg -ss`, no
  colour work, no crop beyond the CSS frame), and both 3D pictures — they are
  screenshots of the previz viewer in a `--viewing` session over a scratch copy
  of this seed, in Solo → Greybox → 3D, one in Shot camera and one in Free after
  orbiting to where the pawn, its trail, the camera path and the frustum are all
  in view. The caption chip inside the Free picture is the viewer's own.
- **Mockup:** the surrounding chrome — the window, rails, tabs, transport, beat
  timeline, chips, tables and callout labels are HTML/CSS in `layout.html`,
  drawn to look like the viewer's real components with the viewer's real
  strings. They are not screenshots of a running session.
- **No invented failure.** The shipped seed's record is all-pass, so the `fail`
  state is shown only in the three-state legend, described as what a failure
  does; neither record in the picture contains one.

## Regenerate

Stage the artwork into an ignored directory — these are stills, not files the
repository needs to carry twice:

```sh
S=modes/previz/seed/first-light/shots/lab-walk
mkdir -p .tmp-previz-showcase
for t in 0.25 2.9 4.2 5.4 5.9 7.8; do
  n=$(echo "$t" | tr -d '.')
  ffmpeg -nostdin -loglevel error -ss "$t" -i "$S/greybox/greybox.mp4" -frames:v 1 -y ".tmp-previz-showcase/g-$n.png"
  ffmpeg -nostdin -loglevel error -ss "$t" -i "$S/takes/take-01.mp4"  -frames:v 1 -y ".tmp-previz-showcase/t-$n.png"
done
```

`free3d.png` and `shotcam.png` are screenshots, not stills. Copy the seed into a
scratch workspace, open it read-only on a port of your own, and drive the lane:

```sh
cp -R modes/previz/seed/first-light/. /tmp/previz-ws/
bun bin/pneuma.ts previz --dev --workspace /tmp/previz-ws --viewing --no-open --no-prompt
# In the session: collapse the agent surface, Solo → Greybox → 3D,
# seek to 2.40 s, capture Shot camera, then Free (wheel-zoom until the pawn,
# its trail, the camera path and the frustum are all in frame).
# Crop the lane canvas — 1620 × 864 at this window size — into the art dir.
```

Then, from the repository root:

```sh
bun modes/previz/showcase/preview.mjs .tmp-previz-showcase   # 127.0.0.1:18347
```

`preview.mjs` serves only the staged artwork, `layout.html` and the
repository's bundled fonts on localhost. It launches no agent and touches no
session.

Capture each view at exactly 1376 × 768 CSS pixels. A CLI Chrome with its own
profile cannot collide with a running browser or with the chrome-devtools MCP's
profile:

```sh
for v in hero greybox-take one-clock 3d-inspection acceptance cost; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --user-data-dir="/tmp/previz-shot-$v" --no-first-run \
    --hide-scrollbars --force-device-scale-factor=1 --window-size=1376,768 \
    --virtual-time-budget=5000 --screenshot="/tmp/$v.png" \
    "http://127.0.0.1:18347/?view=$v"
done
```

`--force-device-scale-factor=1` is what keeps a Retina machine from producing
2752 × 1536; `showcase.test.ts` checks the header of every shipped PNG for
exactly that mistake. (These six were shot through CDP instead —
`Emulation.setDeviceMetricsOverride` at `deviceScaleFactor: 1` — which is the
same viewport with one browser for all six views.)

Rename to the `showcase.json` media names and compress in place:

```sh
pngquant --quality=85-100 --speed 1 --ext .png --force \
  modes/previz/showcase/hero.png modes/previz/showcase/highlight-*.png
```

That lands these six between 95 KB and 235 KB (≈ 870 KB for the six) —
comfortably under the per-mode showcase average in this repo, even though four
of the six are mostly photographic video frames.

Nothing in `layout.html` animates, so a re-capture is byte-comparable apart
from PNG encoding.
