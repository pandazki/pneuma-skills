# Backlot showcase

The six 1376 × 768 gallery PNGs are **screenshots of the running viewer**, not
artwork. Each one is a `--viewing` backlot session over the shipped seed —
`modes/backlot/seed/one-inch-of-wind/`, the 30-second film *一寸止风* as its
run ended — driven through CDP by [`shoot.mjs`](shoot.mjs) and resampled to the
size the launcher lays out. Every number, frame, chip and check in them is the
viewer's own, read off that seed: nothing is drawn, mocked or retouched.

## Status

Captured 2026-09-21, from the seed at that date. They replace the previz-era
set, which was composed in a `layout.html` mockup around the retired
`first-light` seed (one eight-second lab shot) and still carried a *Previz*
brand chip; that kit was removed with the seed it quoted, because a mockup of
a film the repository no longer ships cannot be corrected against anything.

| `showcase.json` media | What it is |
|---|---|
| `hero.png` | The stage rail over the finished cut, at 21.90 / 30.00 s |
| `highlight-stages.png` | The rail's eight statuses over the approved screenplay |
| `highlight-lineup.png` | Board \| anchor \| greybox — the previz gate's three tiles |
| `highlight-greybox-take.png` | The wipe on `s03-orbit`: greybox left, take right, 04.50 s |
| `highlight-cut-points.png` | The EDL and the out-frame \| in-frame cards with their verdicts |
| `highlight-cost.png` | The Cost tab: this shot, the whole film, and the by-stage table |

`__tests__/showcase.test.ts` fails if `showcase.json` ever names a file that is
not on disk, or if a capture is not exactly 1376 × 768 — the launcher serves
`showcase/*` straight off disk, so a missing file is a 404 on a gallery card
and a Retina-scaled capture is a silently cropped one, and nothing else reports
either.

## What is in each picture

- **`hero.png`** — the whole stage rail with every stage `APPROVED` and its
  spend (`Bible $0.10 · Boards $1.06 · Previz $1.53 · Takes $11.64 · Sound
  $0.08`, `$14.42 SPENT`), `final.mp4 · 30.0 s · 7 segments` paused on the
  film's title moment, the EDL with its SHOTS / VO / MUS rows, and six cut
  points with their `CONTINUOUS` and `PASS` / `FAIL` chips.
- **`highlight-stages.png`** — the same rail with `2 Screenplay` open: the
  scene list, the logline, `30 S · 24 FPS · 854×480`, and the screenplay itself
  with its per-shot slugs.
- **`highlight-lineup.png`** — the Lineup tab's own sentence ("the previz gate
  is the moment somebody says these are the same picture"), the three tiles
  (`Board — the whole shot`, `Anchor — first · 00.00 s`, `Greybox — rev 3`) and
  the anchor prompt that produced the middle one, verbatim.
- **`highlight-greybox-take.png`** — the lane toolbar (`Wipe`, `Greybox` over
  `Take 01`), both lane headers with what ffprobe measured
  (`854×480 · 24 fps · 144 f · 6.00 s · rev 3` against `145 f · 6.04 s`), the
  draggable seam, and the transport reading `04.50 s · f 109 / 144`.
- **`highlight-cut-points.png`** — the same hero view cropped to the joins:
  the transport, the EDL rows including `sound/music.mp3 · -18 dB`, and three
  cards with the frame that leaves and the frame that arrives.
- **`highlight-cost.png`** — `This shot $1.72`, `The whole film · 7 shots
  $14.42`, the estimate note, and the by-stage table down to `Every paid call`.

Two of the film's six joins read `FAIL` and one shot is `stuck`. That is the
seed's own record and it is left visible: a gallery that only ever showed green
would be advertising a different mode.

## Re-shoot

1. Copy the seed into a scratch workspace — never open the repository's copy
   with an agent attached:

   ```sh
   mkdir -p /tmp/backlot-ws
   cp -R modes/backlot/seed/one-inch-of-wind /tmp/backlot-ws/
   ```

2. Start a **viewing** session on ports of your own (`PNEUMA_VITE_PORT` is the
   page; `--port` is the API), so it cannot collide with another session:

   ```sh
   PNEUMA_VITE_PORT=18397 bun bin/pneuma.ts backlot --dev \
     --workspace /tmp/backlot-ws --viewing --no-open --no-prompt --port 18396
   # → [pneuma] ready http://localhost:18397?session=<id>&mode=backlot
   ```

3. Start a headless Chrome with its own profile and debugging port — a CLI
   Chrome on its own profile cannot collide with a running browser or with the
   chrome-devtools MCP's:

   ```sh
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless=new --remote-debugging-port=19425 \
     --user-data-dir=/tmp/backlot-shot-profile --no-first-run \
     --hide-scrollbars --force-device-scale-factor=1 --window-size=1376,768 \
     --autoplay-policy=no-user-gesture-required about:blank &
   ```

4. Shoot, then quantize in place:

   ```sh
   bun modes/backlot/showcase/shoot.mjs \
     --url "http://localhost:18397?session=<id>&mode=backlot" \
     --out modes/backlot/showcase

   pngquant --quality=70-95 --speed 1 --ext .png --force \
     modes/backlot/showcase/hero.png modes/backlot/showcase/highlight-*.png
   ```

That lands the six between 75 KB and 280 KB (≈ 1.1 MB for the six). The
quantization matters: these ship inside the npm package, which has run into the
registry's payload limit before.

`shoot.mjs` captures at `deviceScaleFactor: 3` and resamples **down** to
1376 × 768, which is what keeps a zoomed crop (the lineup, the cost panel, the
cut points) legible instead of upscaled — and what keeps a Retina machine from
producing 2752 × 1536, the mistake `showcase.test.ts` checks the PNG header
for. The seek times, the shot (`s03-orbit`) and the crop rectangles live at the
bottom of that file; a viewer layout change is corrected there, not by hand in
an image editor.
