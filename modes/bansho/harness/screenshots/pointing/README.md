# Pointing on a wall — one outline, and the chip agrees (2026-08-12)

The acceptance evidence for the T6 pointing fix: on a lecture with more
than one board, the clear that enforces single selection swept `boardRef`
— which is **panel 0**, not the wall — so every outline set on boards 2–4
stood forever. The board claimed six selections while the ask bar's chip
named one, and clearing the chip left all six standing for a selection
that no longer existed.

Board: the product owner's `three-months` (`@board 4`, a 7:27 lecture with
three `@erase`s and `@at` on every passage), copied to a private
workspace, served on a private port, own Chrome profile, 1600×1000 at
DPR 2, dark. The camera is zoomed out far enough that **all four boards
are in frame at once** — a zoomed-in frame cannot falsify "a stale
outline is standing on another board".

Every frame is paired with a wall-wide DOM probe
(`document.querySelectorAll('[data-bansho-selected]')`), because an
outline outside the crop is exactly the failure being ruled out.

| frame | click | probe | ask-bar chip |
|---|---|---|---|
| `click1-board1.jpeg` | `11:1`, board 1 (top-left) | `1` mark: `11:1`, panel 0 | `section 11, step 2` |
| `click2-board2.jpeg` | `12:1`, board 2 (top-right) | `1` mark: `12:1`, panel 1 | `section 12, step 2` |
| `click3-board3.jpeg` | `11:14`, board 3 (bottom-left) | `1` mark: `11:14`, panel 2 | `section 11, step 15` |
| `click4-board4.jpeg` | `13:1`, board 4 (bottom-right) | `1` mark: `13:1`, panel 3 | `section 13, step 2` |
| `cleared-wall.jpeg` | the chip's clear | `0` marks | *(empty — "Click anything on the board to point at it.")* |

Read as a sequence: the outline **moves** board to board rather than
accumulating, and the chip under it names the same step every time. The
last frame is the end state the bug was caught in — chip gone, and now
the wall gone with it.

## The same instrument, before the fix

Four clicks driven through the same page on the unfixed build, one probe
after each:

```
click 11:0  (board 1) -> marks: [11:0]
click 12:0  (board 2) -> marks: [12:0]
click 11:13 (board 3) -> marks: [12:0, 11:13]
click 13:0  (board 4) -> marks: [12:0, 11:13, 13:0]
```

Board 1's outline cleared (it is the one panel the old sweep could reach);
every other board kept its own. The property this restores is pinned in
`__tests__/pointing-mark.test.tsx`, which asserts the agreement — the
board's outlines name exactly what the chat's context names — rather than
the sweep's scope, so any other mechanism that broke it would be caught
too.
