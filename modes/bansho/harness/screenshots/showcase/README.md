# The showcase, photographed off the running product

`modes/bansho/showcase/` now holds four 1376x768 files and the `showcase.json`
that names them. Three are frames of the real player; the fourth is the only
composed one, and both of its halves are real bytes. Nothing here is a drawing
of the mode.

## What each file is, and the moment it was taken at

| File | Source | Moment |
|---|---|---|
| `hero.png` | `three-months` (a real end-to-end lecture, `@board 4`, 446.8 s), dark, **script drawer open** | 69.1 s. The left pane is the plain markdown — `@at left`, `## 队为什么这么长`, `==有多满==`, `$$W \propto \frac{\rho}{1-\rho}$$`, a ```chart``` block with its `x:` / `y:` axes — and the right is that same passage performed: handwriting, the formula set by hand, and the chart's axes already drawn with its caption still being written. The script's last line is lit because the pen is on it. That is the tagline stated by the picture. |
| `highlight-performs.png` | same lecture, dark, drawer closed | The same 69.1 s without the drawer. Paused **mid-stroke**: the chart caption ends inside a half-formed character and the curve itself has not been drawn yet. The transport reads `69.1s / 446.8s` at `1x` with the wall map showing the room. A finished render could not look like this. |
| `highlight-wall.png` | same lecture, **light**, the lecture's own `@overview` step at 413.5 s | Four boards at their canonical 1242x894, in a room. Light was chosen deliberately: the plaster wall and the board frames make "boards standing in a room" legible, where dark greys them into the background. |
| `highlight-plan.png` | composed at 1376x768 in the same browser | `plan.md` verbatim on the left — the per-passage table (`medium` / `room` / `len`, with `FIGURE graph` / `FIGURE chart` picked out), the `> revised（b1 写满之后）` note the agent wrote **after measuring the real board**, and the column-by-column walk including its `@erase` retirements — beside the wall that plan produced. |

## The rig (additions to `../light-hand/README.md`, which still holds)

Its four traps are all still real: shoot **headful**; the first navigation
renders a blank root; `--viewing` suppresses the seed gallery so
`POST /api/seeds/apply` is the way in; never click the theme toggle (patch this
page's `GET /api/user-theme` — `theme-light.js` / `theme-dark.js`). Four more,
each of which cost this run time:

- **A Chrome window that is merely BEHIND another window is `visibilityState:
  "hidden"`, and a hidden window silently drops every `Input.dispatchMouseEvent`.**
  Screenshots keep working, `Runtime.evaluate` keeps working, and
  `outerWidth`/`outerHeight` read `0` — so the page looks alive while no click,
  drag or timeline seek ever lands, with no error anywhere. Launch with
  `--disable-features=CalculateNativeWinOcclusion`. `Page.bringToFront` does
  **not** fix it.
- **Do not use `Emulation.setDeviceMetricsOverride` for the viewport.** An
  override set by a session that then detaches survives visually but leaves
  input mapping in a state you cannot reason about, and it reports `dpr: 2` even
  when asked for 1. Size the real window instead: `--window-size=1376,855`
  yields exactly `innerWidth 1376 / innerHeight 768`, and at this display's
  dpr 2 a full-frame `Page.captureScreenshot` is 2752x1536 — downscale with
  `sips -z 768 1376` (lowercase `-z`, height then width; `-Z` takes one value).
- **`Page.captureScreenshot`'s clip `scale` multiplies the device pixel ratio,
  it does not replace it.** `scale: 1` on a 986x616 CSS clip gives 1972x1232.
- **The wheel cannot frame a 2x2 wall.** User-gesture zoom-out floors at
  scale 0.4, where the wall (2516x1820) is 1006x728 and taller than the board
  area. An `@overview` step deliberately sits below that floor to fit and
  centre, so the way to photograph a whole wall is to seek to one. `scan.sh`
  finds them: seek across a fraction range and read
  `getComputedStyle('.bansho-stage').transform` — the rest zoom is 1.05153 and
  an overview is the outlier (0.393 in `three-months`, at 413.5 s / f≈0.925).

## What was checked, and what is still open

Checked before every frame: `data-bansho-theme` on `.bansho-board-surface`, and
that the page carries no `handwriting font fallback` badge (`fontFallback:
false` in each `go.sh` line). Both held for all four.

Two things this run looked at and did **not** treat as bugs:

1. In `tech-en`'s `@overview` the third face stands half-wiped while the others
   are full. That is the seed's own `@erase` retiring the algebra board once the
   chart takes it over — the same non-bug `../light-hand/README.md` §5 records.
2. `three-months` reaches its `@overview` with all four faces written to their
   full column width but only about the top half of each face used. That is the
   lecture's own composition (it erases and reuses the wall three times over
   446 s), not a fill failure — the frame is honest about it, which is why it
   was kept.

**Open — the four seed-gallery thumbnails were NOT re-shot.** They still date
from 10 Aug, before the type scale, the canonical board size and the ink
baseline. The mechanism for shooting them is built and proven (`thumb.sh`:
seed-apply → light → zoom to a scale where one face fits ≈0.79 → pan the camera
onto a chosen face by drag → hide the viewport overlays → clip the face at
16:10 anchored on its top edge, which is exactly what the card's
`object-cover object-top` shows). `tech-en` came out correct at 1972x1232 on
the first complete pass. Three things remain for whoever finishes it:

- **Close the script drawer first.** It is remembered across reloads, and an
  open drawer both shifts the face and lands inside the clip.
- **Clamp the clip to the viewport.** `pitch-en` / `pitch-zh` are single TALL
  boards (2571 CSS px at 0.79); their `rect.y` is negative, so a crop anchored
  on the face top is entirely above the viewport and captures a blank frame.
- **Pick the face per seed from the manifest description** — it is the brief.
  `tech-*` want the curve board, `pitch-*` the pipeline boxes or the circled
  ask.

## The rig itself

`rig/` holds the drivers this run built, parameterized so the next one does not
rebuild them. `BANSHO_SHOT_DIR` (required) is where frames land;
`BANSHO_CDP_PORT` defaults to 9412; the repo root is derived from the script's
own path.

| File | What it does |
|---|---|
| `cdpx.mjs` | The CDP verbs `harness/cdp.mjs` lacks: `clearMetrics`, `bounds <w> <h>` (size the REAL window — see the metrics-override trap above), `front`, `key`. |
| `go.sh <set> <fraction> [light\|dark]` | Switch content set, force the theme browser-locally, pause, seek, pause again (a seek leaves the player running), then report `{t, dur, theme, set, fontFallback}` — the last field is the oracle to check before every shot. |
| `scan.sh <f0> <f1> <steps>` | Seek across a range reporting the stage scale, which is how an `@overview` is found (rest zoom 1.05153; an overview is the outlier). |
| `thumb.sh <seed> <fraction> <panelIndex>` | The seed-gallery thumbnail path: zoom until one face fits, pan onto the requested face by drag, hide the overlays, clip at 16:10 anchored on the face top. Pass `-1` for "whichever face the camera is on". Still needs the three fixes listed above. |
| `theme-light.js` / `theme-dark.js` | Patch this page's `GET /api/user-theme` — never the toggle, which POSTs into the shared `~/.pneuma/settings.json`. |
| `hide-all.js` / `show.js` | Hide and restore the viewport-fixed overlays (wall map, Board/Notes, Parallax) page-locally. |
| `mkplan.mjs` | Builds `plan-composite.html` from `plan.md`'s real bytes; the wall half points at the committed `highlight-wall.png`. |
