# The light board, under the face it actually names

Every acceptance frame on this branch until now was dark, and the two most
theme-sensitive pieces of recent work — the ink baseline (`engine/factories/
type-metrics.ts`, which reads the ACTUAL font's ascent/descent) and the marks
that draw against the board's own colours — had never been photographed in
light. The ink-baseline author flagged the gap honestly: *not* verified-same,
because "Bradley Hand is absent on this machine so both stacks fell back
identically, which proved nothing."

**That premise was wrong, and the way it was wrong is the finding.**

## 1. Bradley Hand is installed, and it resolves

`/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf` is on this machine;
`system_profiler SPFontsDataType` lists `Family: Bradley Hand`. The earlier
"absent" reading came from the **headless** harness browser, whose missing hand
face is already noted in `wall-room/README.md` and `wall-map/README.md`. Every
frame here was shot in a **headful** Chrome (own `--remote-debugging-port
9411`, own `--user-data-dir`), where the system font stack is live. The
"handwriting font fallback" badge is absent in all four frames — that is the
oracle, checked before each shot.

## 2. The two stacks are not the same stack

Measured in-page with `canvas.measureText` at `34px`, per the technique
`seed/*/theme.css` itself prescribes (never `document.fonts.check()`, which
lies):

| stack / face | Latin width | CJK width | ascent | descent | baseline in a 51px line box |
|---|---:|---:|---:|---:|---:|
| light `--hand` (`Bradley Hand` first) | 388.08 | 385.22 | 29 | 14 | **33.0** |
| dark `--hand` (`Chalkboard SE` first) | 403.04 | 385.22 | 38 | 10 | **39.5** |
| `Bradley Hand` alone | 388.08 | 374.00 | 29 | 14 | 33.0 |
| `Chalkboard SE` alone | 403.04 | 374.00 | 38 | 10 | 39.5 |
| `HanziPen SC` alone | 374.48 | 385.22 | 36 | 12 | 37.5 |
| `PingFang SC` (the "not drawing" control) | 410.04 | 374.00 | 36 | 12 | 37.5 |
| an unresolvable family (control) | 362.59 | 374.00 | 31 | 9 | 36.5 |

Three things follow, and they are why light deserved its own look:

- The light stack's Latin **is** Bradley Hand — 388.08 is its own number, not
  PingFang's 410.04 and not the unresolvable control's 362.59.
- **Latin baseline moves 6.5 px between the themes** at the board's 34px/1.5.
  `type-metrics.ts` reads that per-font, so light and dark genuinely place ink
  at different heights inside the same line box. Parity was never a thing that
  could be assumed.
- **CJK does not move.** Both stacks resolve CJK to HanziPen SC (385.22 in
  both), so a Chinese board's ink geometry is theme-invariant; the whole of the
  difference lives in Latin. An English board is therefore the sharp test, and
  it is what these frames are.

## 3. What the frames show

`tech-en`, light theme, headful Chrome, 1440x900 (frame 04 at 1376x768).
Theme forced **browser-locally** by patching this page's `GET /api/user-theme`
— `~/.pneuma/settings.json` is shared with the user's other live sessions, so
the UI toggle (which POSTs) was off limits.

| File | t | What it evidences |
|---|---|---|
| `01-latin-marks-51s.png` | 51.1 / 127.8 s | Backref circles land on `20×` and `100×`; the KaTeX block sits in the right column; the second column is mid-write with the pen visible. Marks sit **on** the Latin writing under Bradley Hand's metrics, not above or below it. |
| `02-underline-heading-97s.png` | 97.1 / 127.8 s | Two in-place underlines ("Contention flattens the curve." / "Coherence bends it back down.") and a heading rule. The underline is the mark most sensitive to a baseline error; all three sit correctly under the writing. |
| `03-room-overview-100s.png` | 100.3 / 127.8 s | The `@overview` camera in light: plaster wall `#cfc7ba`, white boards `#ffffff`, grey-brown rails and trays, and the wall map bottom-right drawing real ink outlines against the light board. The chart is drawing itself on the third face. |
| `04-end-highlight-circles-128s.png` | end | The end state: the `@highlight` band over two wrapped lines, `@circle` around "serial fraction" and "coherence cost", the aside's drawn margin bar, and the map's "you are here" tint. The band's vertical placement is the direct consumer of the baseline fix. |

**Verdict: light holds.** No mark is misplaced in any of the four frames, in a
theme whose Latin baseline sits 6.5 px higher than the one all the earlier
evidence was shot in. This is a verified-in-light result, not an assumed one.

## 4. The rig, so the next run does not re-derive it

These came from the **real product**, not the harness page: a `--viewing`
session (no agent — the `modes.md` gotcha about an idle agent editing files on
notification flush is real), seeded through the real `POST /api/seeds/apply`.

```bash
PNEUMA_VITE_PORT=17970 bun bin/pneuma.ts bansho \
  --workspace <scratch>/ws --port 17971 --viewing --no-open --no-prompt --dev
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9411 --user-data-dir=<scratch>/chrome --no-first-run
curl -X POST :17971/api/seeds/apply -d '{"sourceKey":"modes/bansho/seed/tech-en/"}'
bun modes/bansho/harness/cdp.mjs 9411 nav "http://localhost:17970?session=<id>&mode=bansho&layout=app"
```

Four things that cost time to find:

- **Headful, always.** Headless has no hand face, and that is what produced the
  false "Bradley Hand is absent" reading this file corrects.
- **The first navigation renders a blank root** while Vite transforms the
  module graph. Navigate a second time; do not debug it.
- **`--viewing` suppresses the seed gallery** (`App.tsx` gates
  `isEmptyWorkspace` on `editing !== false`), so the card UI is unavailable and
  `POST /api/seeds/apply` is the way in. Same server code path either way.
- **Never click the theme toggle.** `useAppTheme.set()` POSTs to
  `/api/user-theme`, which writes `~/.pneuma/settings.json` — shared with every
  other live session on the machine. Patch this page's `GET /api/user-theme` to
  return the wanted theme and dispatch `pneuma:theme-changed`;
  `useSystemPreferences` re-fetches on that event, so the patch is what makes
  it take. Verify with `data-bansho-theme` on `.bansho-board-surface` before
  shooting.

The transport is a `role="slider"` div (`aria-label="Timeline"`), driven by
`cdp.mjs click` at `track.x + fraction * track.width`; pause first via the
`aria-label="Pause"` button or the clock walks out from under the frame.
`Page.captureScreenshot` returns 2x on this display, so a 1376x768 viewport
yields 2752x1536 — downscale with `sips -Z`.

## 5. One thing that looks wrong and is not

In `03` the second board carries only its heading and rule while three other
faces are full. That is the seed's own script, not a fill failure: `tech-en`
ends with `@erase` retiring the algebra board once the chart takes it over —
the manifest's seed description says so in as many words ("the algebra retired
once the picture takes it over"). Frame `01` is the same board at 51.1 s,
written out across both columns, which is the counter-evidence.
