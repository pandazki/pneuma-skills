# Anime-series showcase

The five 1376 × 768 gallery PNGs are **screenshots of the running viewer**, not
artwork. Each one is a `--viewing` anime-series session over the shipped seed —
`modes/anime-series/seed/guang-niuma/`, the series 《光和牛马》 with episode 1
《准点下班》 shot, checked and re-shot as that run ended — driven through CDP by
[`shoot.mjs`](shoot.mjs) and resampled to the size the launcher lays out. Every
sheet, frame, chip, verdict and dollar figure in them is the viewer's own, read
off that seed: nothing is drawn, mocked or retouched.

## Status

Captured 2026-10-29, from the seed at that date (bible v1 locked 2026-10-29,
episode 1 finished with three drifts open, $7.99 spent), and re-shot the same
day after the viewer fixes: the time ruler tucked under the strip's cells, no
raw address in the shot header, avatars cropped to the character, the take's
stamp priced over its measured length. The UI is English, as
in the backlot and sprite galleries and the launcher's default locale; the
content — names, shot words, the agent's verdicts — is the seed's own Chinese.

| `showcase.json` media | What it is | Viewer width |
|---|---|---|
| `hero.png` | Rail, wall and desk, the final cut paused at 8.0 s in shot 3 | 1376 |
| `highlight-wall.png` | The stacked wall: four locked cards in one row | 816 |
| `highlight-shot-strip.png` | The strip, playhead in shot 6, that shot's stamps and check | 1180 |
| `highlight-drift-check.png` | Shot 7's check: 光 drifted, sheet beside the sampled frames | 1180 |
| `highlight-season.png` | The episode log opened: season spend, cast drift, the log | 816 |

`__tests__/showcase.test.ts` fails if `showcase.json` ever names a file that is
not on disk, if a capture is not exactly 1376 × 768, or if a PNG is left in the
directory that nothing references — the launcher serves `showcase/*` straight
off disk, so a missing file is a 404 on a gallery card and a Retina-scaled
capture is a silently cropped one, and nothing else reports either.

## What is in each picture

- **`hero.png`** — the season rail (`光和牛马`, `Bible v1 · locked 10-29`, the
  `ep01 《准点下班》` card reading `Finished · 3 drift · $7.58`, `$7.99
  estimate`), the wall's 光 and 牛马 cards, and the desk: the episode header,
  `Final cut · 29.9s` paused at `8.0s / 30.0s` on the frame where 牛马 runs
  with the file stack and 光 lights the way as a torch, the takes (`Take 1 ·
  480p · $6.19 · 3 drift`, `Re-shoot 8 · $1.25 · in the cut`), the episode's
  spend down to `Total $7.58`, and the whole shot strip with the playhead in
  shot 3. The window ends under the strip's time ruler; the wall column goes
  on below it, as it does in the viewer.
- **`highlight-wall.png`** — below 820 px the wall stacks into a grid, and at
  816 px the four cards share one row: 光 and 牛马 (character), 便利贴群
  (group), 夜晚的开放办公区 (scene), each with its picked sheet, `v1 locked`,
  the sheet's price, `in 1 episode` and, on three of them, the drift that
  points back into episode 1 (`1 drift · ep01 shot 7`, `… shot 9`).
- **`highlight-shot-strip.png`** — at a 1180 px viewer the desk is `mid`: the
  selected shot sits under the strip instead of beside its check, so the strip
  (nine panels as wide as their seconds, the verdict dots, `光` and
  `牛马、便利贴群` under the drifted shots, `not redrawn` under shot 8), the
  time ruler, shot 6's words and its `Made from` stamps (four sheets, `Grid
  ep01 · candidate 2`, `seedance-2.5 · 480p`, `$6.19 / 30.1s`) and its check
  (three `matches`) fit one window. Shot 6 is the panel that was redrawn.
- **`highlight-drift-check.png`** — the same width, shot 7: `drifted` beside
  the agent's note (光桥是一道淡金色的光带，没有脸 …；设定图里拱桥形是橙色身体、
  脸在拱顶), `Sheet · 光 v1` beside `Frames · ep01-a-take-1 · shot 7` at 20.7 /
  22.0 / 23.3 s, and `Your call: Re-shoot this shot | Accept it as it is`.
- **`highlight-season.png`** — the `Episode log` button and the season it
  opens: `Season spend $7.99` (`Design sheets $0.36`, `Lineups $0.052`,
  `ep01 《准点下班》 $7.58`), `Cast` with each lead's open drift, the log
  table (place · goal · ability · ending) and the episode chip.

Left as the seed has them, on purpose: three drifts are open and shot 1 reads
`named, but missing` (the clip opens on the empty office before 牛马 appears).
A gallery that only ever showed green would be advertising a different mode.
The `Check the frames` and `Re-shoot this span` buttons look inactive because
a viewing session has no agent to send a command to.

Not pictured: the lineup card (`Lineup · one scale`, 光 beside 牛马 at one
scale). It sits in the wall's second row at every width where the four cards
share a row, and no 16:9 window holds both rows.

## Re-shoot

1. Copy the seed into a scratch workspace — never open the repository's copy
   with an agent attached. The seed's files sit at the workspace root:

   ```sh
   rm -rf /tmp/anime-series-ws
   cp -R modes/anime-series/seed/guang-niuma /tmp/anime-series-ws
   ```

2. Start a **viewing** session on ports of your own (`PNEUMA_VITE_PORT` is the
   page; `--port` is the API), so it cannot collide with another session:

   ```sh
   PNEUMA_VITE_PORT=19301 bun bin/pneuma.ts anime-series --dev \
     --workspace /tmp/anime-series-ws --viewing --no-open --no-prompt --port 19300
   # → [pneuma] ready http://localhost:19301?session=<id>&mode=anime-series
   ```

   The UI language follows `~/.pneuma/settings.json`'s `locale`; it was `en`
   for these captures.

3. Start a headless Chrome with its own profile and debugging port — a CLI
   Chrome on its own profile cannot collide with a running browser or with the
   chrome-devtools MCP's:

   ```sh
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless=new --remote-debugging-port=19425 \
     --user-data-dir=/tmp/anime-series-shot-profile --no-first-run \
     --hide-scrollbars --force-device-scale-factor=1 --window-size=1376,768 \
     --autoplay-policy=no-user-gesture-required --lang=en-US about:blank &
   ```

4. Shoot, then quantize in place:

   ```sh
   bun modes/anime-series/showcase/shoot.mjs \
     --url "http://localhost:19301?session=<id>&mode=anime-series" \
     --out modes/anime-series/showcase

   pngquant --quality=70-95 --speed 1 --ext .png --force \
     modes/anime-series/showcase/hero.png modes/anime-series/showcase/highlight-*.png
   ```

5. Stop the session and the Chrome, and look at every picture before keeping
   it.

`shoot.mjs` captures at `deviceScaleFactor: 3` and resamples **down** to
1376 × 768, which keeps a zoomed crop (the wall, the check) legible instead of
upscaled — and keeps a Retina machine from producing 2752 × 1536, the mistake
`showcase.test.ts` checks the PNG header for. The crops are not fixed
rectangles: each is computed from the viewer's own elements (the rail, the
wall's rows, the strip, the selected shot's cards) and printed in CSS pixels,
and the script refuses a crop that would leave the viewport or cut the check
short. The viewer widths, shots and seek times live at the top of that file;
a layout change is corrected there, not by hand in an image editor.
