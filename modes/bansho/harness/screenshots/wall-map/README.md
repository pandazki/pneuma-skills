> **SUPERSEDED 2026-08-12 by `../wall-room/`.** The frames below are the
> fill-bar widget the product owner rejected — 「总览肯定不是右上角的控件」 —
> kept because they are the picture of what a "how full is this board"
> overview looks like next to what replaced it. The live affordance is now
> `viewer/WallMap.tsx`: a scaled drawing of the whole wall with the real
> shape of the ink on it, draggable, zoomable, in the bottom right.

# The wall map (2026-08-12)

The product owner's third complaint: 「没有总览/鸟瞰的界面,不知道有多少板」.
`@overview` is a verb the **author** writes; a **reader** had no affordance
at all — no way to know how big the room is, which wall they are standing
in front of, or whether a board is full.

- `board-3-of-4.jpeg` — the map in context, playhead at t = 70.0s. Four
  tiles, board 3 current (primary border, brighter fill, brighter number).
- `map-detail.png` — the same map at 3×. Board 2 is empty, board 3 nearly
  full, boards 1 and 4 partly written. Boards fill from the TOP, because
  that is the way a hand writes on one.

Mounted only on a real wall (`panelCount > 1`) — a single strip IS its own
overview, and the MOUNT gate (not a hidden node) is what keeps the layout
baseline captures untouched. The fill bars come from `layout.panels[].cursor`
divided by the fold's own budget: the same number that decides when the wall
is full, so the bar answers "did I fill this board?" with the fold's answer,
not an approximation of it.

"You are here" is written imperatively from `applyCamera` (the camera's hot
path — a setState there would re-render the viewer on every frame of every
glide); the fill bars are compile-rate React state. Same split as
`applyDepth`.

Captured in the isolated harness browser (`harness/cdp.mjs`, own port and
user-data-dir). The "handwriting font fallback" badge in the frame is the
headless environment's missing hand face, not a regression.
