# W8 — the burst, before and after the cut line

The lecture is `bayes` (`@board 3`), copied out of the authoring workspace
and driven in a `--viewing` session on its own port and its own browser, at
the end of the timeline. Two of its three boards burst: the fold reports
`full` running 138px and 135px past the board's own floor, and the panel's
`overflow: hidden` takes the rest.

| Frame | What it shows |
|---|---|
| `before-full.png` | HEAD before the change, the view the reader lands on at the end of the lecture: one board, filling the window, saying nothing about the two OTHER boards that run off their edges. (Read the last line as clipped and you would be wrong — the playhead is at 396.6 of 397.2 and that sentence is mid-write. That is the point: from here the defect is unreadable either way.) |
| `after-full.png` | The same camera, after. Byte-for-byte the same board: the mark lives at the floor of the boards that burst, and adds nothing anywhere else. |
| `after-wall.png` | The whole wall after. Both bursting boards (top-left, bottom-left) carry a rule at the board's floor with the writing crossing it and dying at the edge. |
| `after-closeup.png` | The mark itself: `full · 138px below the board's edge` + `the writing goes on below; the board does not`, the dashed rule at the floor, and the two lines below it that the board keeps only as far as its edge. |

There is no before-frame of a marked board, and none is needed: the change
adds ONE absolutely positioned overlay and nothing else, so the old
rendering is exactly `after-wall.png` with the `[data-bansho-bursts]`
layers removed — which is the tidy, silent edge the whole finding is about.

The number is the fold's (`RegionBurst.cut`), so the caption and
`check-board` can never disagree about which board lost a sentence. The
layer is absolutely positioned and `pointer-events: none`, repainted per
rebuild — nothing here reaches a number the fold reads.
