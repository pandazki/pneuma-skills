# W4a — the canvas behaves like a canvas, and the map tells the truth (2026-08-12)

Three defects the product owner found in one sitting, all in the camera /
map family. Frames from the four-board `bayes` wall, dark theme, viewport
1600x1100, board 1242 wide, one isolated Chrome (`harness/cdp.mjs`, own
debug port and user-data-dir, own dev server) — the same universe as
`v1-canvas/` and every A/B since.

## 1 — the map is the present tense

| Frame | Playhead | What to look at |
|---|---|---|
| `01-map-at-start.png` | 2% (21.9s ⁄ 66.2s bar at the left) | **1 of 31** mark groups drawn. Board 1 carries one line; boards 2–4 are bare wall. |
| `02-map-at-a-third.png` | 33% | **10 of 31**. Board 1 is full, board 2 (the current one, orange outline) carries exactly the heading and the one line the big board shows — 「先别算，先数人」 and 「拿 10000 个人来数。」 — and the bottom row is still bare. **The map and the board agree.** |
| `03-map-at-the-end.png` | 99% | **31 of 31**. All four boards written; the current board's three bullets and closing line are on the map at the same shape they have on the slate. |

Before this change all three frames were identical: 31 of 31, always. The
geometry is still measured once per compile — a reveal is opacity, a clip
path or a dash offset, and none of them move a rect — so what the playhead
decides is only which groups are drawn, at one integer comparison each.

## 2 — the new gesture table

| Frame | Gesture | Result |
|---|---|---|
| `04-wheel-zooms-at-the-cursor.png` | three wheel notches up, pointer at 30% ⁄ 30% of the viewport | z **1 → 2.054**, anchored on the point under the cursor. No modifier, and nothing scrolled. |
| `05-middle-drag-pans.png` | middle-button drag up-left | the camera walked with the hand (1464.9, 959.5) → (1646.3, 1083.3). |

Wheel = zoom, middle-drag = pan, left-drag = pan, pinch = zoom, page
scrolling = never. `board-grab.test.tsx` pins the wiring, including the two
browser middle-click defaults (Windows autoscroll on `mousedown`, X11 paste
on `auxclick`) being cancelled on the viewport only.

## 3 — the camera keeps the pen

`06-after-a-wheel-the-camera-is-still-with-the-pen.png` is the end state of
the reproduction that found defect 3(a). The gesture sequence, recorded
before anything was changed and re-run against the fix:

```
seek to 42%  ->  press play  ->  three wheel notches down  ->  keep watching
```

| | before | after |
|---|---|---|
| the wheel | detaches the follow, performance keeps running | detaches AND stops the performance |
| at the `@turn` (~53%) | camera frozen at (1274, 360) — board 2's column, straddling both rows — for **eleven seconds** while the pen wrote on board 3 | press play: re-attach to (1274, 0), board 2's own corner; the turn walks to (0, 803) and the follow stays with the pen for the rest of the lecture |
| the map | showed the whole lecture throughout | 15 → 20 groups over the same stretch |

The second cause of 3(a) lives in a window too short to hold a whole board
(1600x720 here, viewport height 637 against an 894-tall board), where the
follow used to fall back to a chase down one long strip. Measured there,
before the fix: the row-crossing turn landed at y = 527, with the row
ABOVE filling five sixths of the view and the new writing in the bottom
sliver. The board's own height now travels with its origin, so the camera
cannot leave the board it is following; `camera.test.ts`'s
`W4a-3a` block pins it at zero tolerance.

`07-short-window-after-the-row-crossing-turn.png` is that same window a
second after the turn, on the fixed build: the camera stands squarely on
board 3 with its heading and both written bullets in view, and the map's
own rectangle sits over board 3 rather than across the gap. Measured over
the walk, live:

```
+2s  pct=50.5  cam=(1274, 257, 1)     still on board 2, following the pen
+3s  pct=52.3  cam=(1224.7, 178.8, 0.956)   mid-walk (the Van Wijk arc)
+4s  pct=54.1  cam=(0, 926, 1)        board 3's own corner  [was (0, 527)]
```

Defect 3(b) — the arbitrary re-attach pose — was reproduced in the same
short window:

```
seek to 62%  ->  drag the board DOWN 420px (the view goes below the pen)  ->  press play
```

which put the camera at y = 1061, i.e. the newest line's top pinned 96px
below the top edge with nothing but blank board beneath it — the owner's
「纵向只移到能显示最新一句话的最上面」. Dragging the other way at the same
moment produced a different pose, because the old path was `followShift`,
whose job is the SMALLEST shift. `reattachCamera` has one answer for every
approach: the pen's board, z = 1, the live line one `FOLLOW_MARGIN` above
the bottom edge and its context filling the view above it.

Both approaches, same moment (62%), before and after:

| the reader drags... | to | re-attach BEFORE | re-attach AFTER |
|---|---|---|---|
| up, above the pen | y = 626 | y = 736 | **y = 926** |
| down, past the pen | y = 1183 | y = 1061 | **y = 926** |

926 is board 3's own corner — in this window the board is 894 tall against
a 637 view, so standing at its top is where the writing and its context
are. Two gestures, one pose, and it is the pose the performance itself
would have been in.

## The layout gate

This phase moves no ink, and `layout-baseline/README.md`'s protocol was run
for it — before-side captured first out of the unmodified working tree,
browser kept alive across the whole implementation. `brain` (**zero**
formulas) is **byte-identical on both projections**. `fourier` and `kelly`
differ on **1 and 2 rows respectively, every one of them `cls:
bansho-math`**, board heights unchanged — a concurrent agent edited
`engine/factories/math.ts` between the two captures (sha `9e0f4d6` →
`5ef78fe`; `board-css.ts` unchanged), which is exactly the blast radius
that change predicts and is disjoint from this one.
