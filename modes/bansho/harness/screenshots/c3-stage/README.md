# C3 stage evidence — @board 2–4, @erase, auto-erase, the notes view

Shot 2026-08-10 against the `four-boards` demo board
(`~/bansho-boards/_all/four-boards/board.md` — a queueing-theory lecture
opening with `@board 4`, one explicit `@erase "先立一个最简单的模型"`
mid-way, and enough content past it that the fold fills all four boards
and synthesizes an auto-erase). Dev server `--dev`, dark theme,
viewport 1600×1100 (panel 1176×847 — the 0.72 ratio).

| File | What it shows |
|---|---|
| `g7-1-mid-sweep.jpeg` | The auto-erase mid-flight (t≈122.9s): board 2's standing content (the W formula, the "十一倍" highlight) being taken off left→right behind a seeded, jittered erase front — the right of the board still stands while the left is already clean. Reads as an eraser pass, not a shutter. |
| `g7-3-rewriting.jpeg` | ~3s later: the sweep is done and the pen writes the triggering sentence at the top of the freshly wiped board, script-pane highlight following. The teacher walked back, wiped, and kept talking. |
| `g7-4-wall.jpeg` | The whole wall, user-zoomed to scale 0.245 — BELOW the old constant floor (0.4): the C3 stage-fit zoom floor (`min(0.4, viewW/stageW)`) lets a four-board wall be seen whole. Four fixed-size boards with gaps; board 2 carries the post-erase content. |
| `g7-5-scrub-back-restored.jpeg` | `navigate-to {section:2,step:2}` — scrubbed back to t=31s, the content that was later auto-erased stands fully restored (G5: the board erases, history does not). |
| `g7-6-notes-view.jpeg` | The Notes toggle (top right, active): the same lecture as ONE unbounded strip — all 60 steps, erased content included, no wrappers, no camera. 板 ≠ 笔记. |

Verdict against the G7 bar ("does it read like a teacher going back to
wipe the first board, rather than content vanishing"): yes — the sweep
front is visibly a hand's pass with old content surviving to its right
mid-sweep, the camera walks to the board BEFORE the wipe (the follow
targets the erased board), and writing resumes at its top immediately
after. Residual polish noted in the C3 report: the sweep is one
horizontal pass (real erasing is often several vertical strokes), and
the 1.6 s `erase` constant is brisk — both are T5-family tuning, not
mechanism changes.

Same-session A/B (the degradation gate) was run separately the same day:
`fourier` / `kelly` / `brain` captured on this branch and on `200919a`
with the same probe in the same browser session — `cmp` byte-identical
on all three.
