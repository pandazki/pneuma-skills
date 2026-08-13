# Final demo — the three classic boards, re-staged on the stage layer

Shot 2026-08-10 against three NEW content sets in `~/bansho-boards/_all/`:
`fourier-stage/` (`@board 3`), `kelly-stage/` (`@board 4`), `brain-stage/`
(`@board 3`). They teach the same three topics as the layout-baseline
originals (`fourier` / `kelly` / `brain` — untouched, byte-verified), but
re-organised around `@board` / `@focus` / `@overview` / `@erase`. Dev
server `--dev`, dark theme, viewport 1600×1100. All three boards pass
`check-board` with zero findings and play through with no unintended
auto-erase.

| File | Playhead | What it shows |
|---|---|---|
| `fourier-1-focus-hold.jpeg` | 60.0s of 98.7s | The `@focus "它和 440 赫兹有多像"` hold: the pen is on board 3 (the formula section, script pane), but the camera has walked BACK to board 2 and rests on the reframed question at reading size — the teacher's "before I write the formula, look again at what we are asking". The `@wait 2` after it gives the pose its breath. |
| `fourier-2-erase-midsweep.jpeg` | 77.7s | The explicit `@erase "混着说话声"` mid-sweep on board 1: the left of the board is already clean while fragments of the question board (「里面？」, the 混合波形 legend, an axis label) still stand to the right of the erase front. Reads as an eraser's pass, not a shutter. |
| `fourier-3-coda-on-cleared-board.jpeg` | 79.2s | ~1.5s later: the sweep is done and the pen writes the coda heading 「把所有频率都问一遍」 at the top of the freshly wiped board 1 — the spectrum will stand exactly where the useless waveform stood. |
| `fourier-4-final-overview.jpeg` | 98.7s (end) | The closing `@overview`: the whole wall — board 1 now carries the SPECTRUM (空调/人声/音叉 peaks) where the waveform was erased, board 2 the reframe + orthogonality mechanism, board 3 the integral, X(f), and the struck-out original question. The erase enacted the lecture's thesis: two notations of the same sound, one replacing the other on the same physical board. |
| `kelly-1-divergence-overview.jpeg` | 73.2s of 86.7s | The mid-lecture `@overview` at the exact moment the two rulers diverge: board 1 (the expectation ruler and its all-in path), board 2 (the log ruler, ln 0 = −∞), board 3 (the growth-rate curve with the 顶点 mark). Board 4 is still dark — `@overview` shows only what has been written so far. |
| `kelly-2-strike-landing.jpeg` | 79.3s | The cross-board turn-back: `@strike "每次都押上全部身家"` sends the pen from board 4 back to board 1 and the all-in claim dies in view, two boards away from where the closed form was just derived. |
| `kelly-3-answer-board-final.jpeg` | 86.7s (end) | The finale: a nearly clean board 4 carrying only f* = (bp−q)/b = 0.2, 「赢面六成，答案是押两成」, and the closing rule + aside — a whole board for the answer, the three boards of derivation standing to its left. |
| `brain-1-strike-back.jpeg` | 86.0s of 95.6s | After the 1998 delay experiment (board 3), `@strike "感觉是外界信号一路传上来的结果"` walks the camera back to board 1 and executes the naive model's thesis directly under its own graph — wounded early by the anomaly, killed late by the evidence. |
| `brain-2-final-overview.jpeg` | 95.6s (end) | The closing `@overview`: the argument's full shape — dead feedforward model (board 1, struck), the prediction/error loop (board 2), and the falsification experiment that separated them (board 3). The two competing models are simultaneously visible, which is the pedagogical point of staging this topic on a wall. |

Staging decisions (and deliberate non-uses):

- **fourier-stage (`@board 3` + `@focus` + `@strike` + `@erase` + `@overview`)**
  — the only board with an erase, because it is the only one with true
  scratch: the waveform board's question is struck as ANSWERED before the
  erase, so retiring the board is "finished, let it go", not refutation.
  Considered and rejected: erasing the verdict/reframe board later to make
  room for a longer coda (the inverse-transform section) — that erase
  would not have been earned; the coda was tightened instead.
- **kelly-stage (`@board 4` + mid `@overview` + cross-board `@strike`)** —
  NO erase anywhere: the refuted all-in board must keep hanging (strike
  semantics — the audience should keep seeing the dead claim; the final
  strike and the overview both need it standing). NO `@focus` before the
  final strike: a turn-back already walks the camera; a focus would be a
  redundant double move. Considered and rejected: a second `@overview` at
  the close — the divergence overview carries argument weight, a closing
  one would be ceremony.
- **brain-stage (`@board 3` + cross-board `@strike` + closing `@overview`)**
  — the task-named case: the two models must be simultaneously visible.
  NO erase (nothing is scratch — the dead model hanging struck-through IS
  the content), NO `@focus` (the final strike is the lecture's only
  turn-back moment and it already directs the camera).

Known cosmetic residual: in `kelly-stage` the 「换一把尺子」 and
「把这条曲线画出来」 section headings land at the bottom of the previous
board (the fold is height-emergent and breaks at step boundaries only).
Both read as a teacher writing the next topic before walking over;
`check-board` is clean and no content is mis-boarded.
