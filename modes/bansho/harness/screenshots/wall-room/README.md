# The room, and a map of it (2026-08-12)

The product owner's verdict on the previous wall, verbatim:

> 「1. 4 块黑板肯定不是横向摆，整个黑板空间应该是仿真的，跟现实世界更像的。
>  2. 总览肯定不是右上角的控件，是一个类似无限画布的缩略图。可以缩放拖拽去观测的，
>     并且能看到黑板中内容的轮廓形状。」

Both frames are the same lecture (`bayes`, four boards, `@turn`-driven), same
window (1600x1100, viewer 1242 wide), same theme (dark), same playhead
(t = 67.2s, the end), captured in one browser process either side of the
change.

## before/

- `before/01-wall-4boards.jpeg` — at rest, z = 1. The camera stands on board 3 and
  there is no way to know boards 1, 2 and 4 exist except by dragging.
- `before/02-wall-zoomed-out.jpeg` — the whole wall, and the rejection in one
  picture: four boards march off to the right at **z = 0.245**, the fill-bar
  widget sits over board 4, and two thirds of the frame is void.

## after/

- `after/01-wall-2x2.jpeg` — the same wall as a **room**: 2x2, each board framed,
  a chalk tray under every row, lit wall behind them. The whole wall fits at
  **z = 0.4** (the camera's own floor, not a fit limit — the room's aspect
  ratio is now close to the viewport's).
- `after/02-wall-and-map.jpeg` — the room with the wall map in the bottom right.
- `after/04-diagonal-walk.jpeg` — mid-walk from board 2 to board 3, which in a
  2x2 room is a DIAGONAL: a pose that did not exist before this change.
  The camera pulls back to z = 0.68, the wall turns toward where it is
  going (`rotateX 3.04deg rotateY 4.83deg`, the V1.5 depth reading the same
  schedule), and the map's rectangle straddles the row boundary. Captured
  by scrubbing into the move, which is also the proof that a row change is
  a resolved camera MOVE and not a cut.
- `after/03-map-detail.jpeg` — the map at 3x. Four boards, each drawn with the
  REAL shape of its writing: a word per bar, every ink `d` string re-emitted
  as itself, so a reader recognises the board with the formula island and
  the board that is all bullets without reading a character.

## What the map does

- the orange rectangle is the camera — where the reader currently stands;
- **drag** the map to pan the real stage (verified: camera x 1274 -> 741,
  the rectangle following);
- **wheel** to zoom the map itself (verified: viewBox 2516x1820 -> 925x669);
- **click a board** to stand in front of it (verified: camera -> that
  board's slot). A click that ends a pan is swallowed, the same rule the
  stage grab uses.

One trap, found by measurement rather than by review: taking pointer capture
on `pointerdown` retargets the `pointerup`, so the browser fires `click` on
the `<svg>` instead of on the board's own `<rect>` — the rect saw
`pointerdown` and never saw `click`, and clicking a board silently did
nothing. Capture is now taken only once the press passes the slop and has
become a pan.

## The byte gate

Same-session A/B through `harness/cdp.mjs` (isolated Chrome, own port and
user-data-dir), the three strips captured before the change and again after,
back to back in one browser process:

```
fourier        BYTE-IDENTICAL
fourier.notes  BYTE-IDENTICAL
kelly          BYTE-IDENTICAL
kelly.notes    BYTE-IDENTICAL
brain          BYTE-IDENTICAL
brain.notes    BYTE-IDENTICAL
```

Which is what the design predicts rather than a lucky result: the wall's
arrangement is stage-level offset only, the panel's own box is untouched
(every frame, tray and wall-light is box-shadow or an overflowing pseudo
element), the slot wrapper is `display: contents` on a single strip, and the
map is behind a `panelCount > 1` **mount** gate — on a strip the node does
not exist rather than being hidden. Confirmed live on `fourier`: no map, no
`[data-bansho-multi]`, slot `display: contents`, viewport background
transparent.

The frames here were captured in the headless harness browser; the
"handwriting font fallback" state some frames show is that environment's
missing hand face, not a regression.

## Light theme

Eyeball pass only (the light stack names a different font face, so nothing
was captured for the byte gate in that state): plaster wall, white boards,
grey-brown rails and trays, and the map inheriting the same room from the
same `--wall` token. Checked by setting `data-bansho-theme="light"` on the
surface directly rather than by touching `~/.pneuma/settings.json`, which is
the user's own environment.
