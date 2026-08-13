# The measure host is as wide as the box (W2b, 2026-08-12)

The defect in one sentence: **the measure host was still a full-width panel
after W2 put the content in columns**, so every line break, row group and
block height the measure pass produced answered a face the content does not
live in.

Measured on the running board (narrow window, `bayes` four-board wall):

```
.bansho-measure-layer  width = 1025   <- what the measure pass sees
.bansho-measure-host   width =  937   <- the width every run wrapped at
the step's own box     width =  456.5 <- where the content actually lives
```

Both sides are the same lecture (`~/bansho-wall/bayes/board.md`, four
boards, `@turn`-driven), the same playhead (the end), the same theme
(dark), captured in one browser process either side of the change through
`harness/cdp.mjs` — one browser per window width, so neither A/B ever
resizes between its halves.

## The two windows

| window | viewer | face | columns | column |
|---|---|---|---|---|
| narrow (1383 x 1100) | 1025 | 937 | 2 | **456.5** |
| wide (1600 x 1100) | 1242 | 1154 | 2 | **565** |

The narrow one is where the defect is loud: a 15-glyph bolded run is ~510px
at the board's body size, so it fits a 565px column and **wraps** in a
456.5px one — which is exactly the case the measure pass could not see.

## before/

- `01-narrow-board4-1x.jpeg` — **the frame the phase is about.** Board 4,
  `1x`. 「证据不给答案，证据只改」 carries one underline that runs past 改 to
  the column edge, and 「变比例」 on the next line gets no ink at all. Same
  for 「先验小，再准的证据也翻不」 / 「动」. The `##` heading's hand baseline
  runs the whole 937px face rather than its 456.5px column. This is the
  broken-renderer look, and after W2 it fires on almost every emphasised
  run.
- `02-wide-board4-1x.jpeg` — the same board in the wide window. The bullets
  do not wrap at 565px, so the only visible symptom left is the heading
  baseline overshooting to the face. The defect is the same; the window is
  just kinder about it.

## after/

- `01-narrow-board4-1x.jpeg` — every wrapped line carries its own
  underline, ending at its own last glyph, and the heading's baseline spans
  its column. Nothing else on the board moved.
- `02-wide-board4-1x.jpeg` — the wide window: the heading baseline is a
  column wide now. That is the design's intent (a `##` stands in its column
  — `board-css.ts`), not a regression.
- `03-narrow-board4-1x-hang.jpeg` / `04-wide-board4-1x-hang.jpeg` — the
  second, smaller thing in the same pass: a wrapped bullet **hangs**. Its
  continuation lines (「变比例」, 「动」, 「后验变成新的先验」) line up under
  the item's text instead of starting back under the dot.

## The instrument

`harness/layout-baseline/README.md` — this phase's two legs are recorded
there under "the 2026-08-12 measure-width phase". Both are byte-identical
on all three strips, and both for a reason the design predicts rather than
by luck.

## A dead end, recorded so nobody re-walks it

The hanging indent's obvious implementation — `padding-left` plus a
negative `text-indent` — **shreds the line**. `text-indent` is inherited
and applies to every block container it reaches, and every written word on
this board is an `inline-block` span (the reveal clip needs a box), so the
negative indent lands on each of them individually. Measured live: the
board drew 「据给案 据改比」 for 「证据不给答案，证据只改变比例」.

The shipped mechanism is `padding-left` on the text plus a negative
`margin-left` on the bullet, whose **net inline advance is zero** — which is
also why an unwrapped item's ink does not move by a byte.
