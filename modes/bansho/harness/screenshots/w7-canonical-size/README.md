# W7 — a board has a size (frames)

Both shot in one isolated Chrome at an emulated **1990x1200** window (the
frame the owner rejected), viewer pane **1632** wide, dark theme, content set
`bayes` (`@board 4`).

| Frame | What it answers |
|---|---|
| `bayes-wall-1990.png` | The whole 2x2 room at the lecture's own tail `@overview`. All **four** boards carry content (56 / 5 / 41 / 69 steps), the counting graph is on the fourth board and the two `chart` figures on the first and third — the owner's screenshot had the third and fourth boards blank and no figure at all. Each board is 1242x894 with a 1154px ink face, identical on every screen |
| `bayes-at-rest-1990.png` | 「字怎么又变小了」, answered. The at-rest camera reads `scale(1.31401)` — exactly `1632 / 1242`, one board filling the pane — so a wider window now renders the SAME board BIGGER. Before W7 the board grew with the window and the fit zoom was pinned near 0.5 whatever the monitor, which is why the type could never get larger |

Board numbering in this file is 1-based. Note on the wall frame: the tail `@overview` fits a union taller than the
wall because the fourth board is bursting (69 steps on one face). That is the `bayes`
lecture's own composition, unchanged by W7 — the same board at the same
width bursts identically on the pre-W7 code, which the same-session A/B
pins.
