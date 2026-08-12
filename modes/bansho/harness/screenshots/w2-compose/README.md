# Composition by default (W2, 2026-08-12)

The product owner's verdict on the previous wall, verbatim:

> 「3. 所有书写内容，我看不出跟先定位布局再书写有任何关系，所有内容都是左上角
>  同一位置开始，完全没有任何板书的随机感。我就像在看打印的内容。」
>
> 「你看了那么多 MIT 的开放课，哪个老师会这么写内容。甚至……谁会写这么小的字？
>  学生能看见吗？没有主次，没有中心往外的辐射。什么都没有。」

Both sides are the same lecture (`bayes`, four boards, `@turn`-driven), the
same window (1600x1100, viewer 1242 wide, board face **1154**), the same
theme (dark), the same playhead (the end), captured in one browser process
either side of the change through `harness/cdp.mjs`.

## before/

- `01-wall-4boards.png` — the complaint in one frame. Four boards, every one
  starting flush at its top-left corner, one uniform type size throughout,
  and a title that is a slightly larger paragraph. **44 glyphs per line** at
  26px on a 1154px face: a page measure, set in a handwriting font.
- `02-board-close.png` — board 1 at rest.

## after/

- `01-wall-4boards.png` — the same wall. Every board opens with a title
  written ACROSS its face at twice the body size and hand-underlined; the
  prose runs down a **565px column** (~16 glyphs a line); and each section's
  formula stands at the **top of the right column**, centred, half again the
  size of the words around it. You can see where the teacher chose to put
  each idea.
- `02-board-close.png` — board 1 at z = 1, the acceptance frame. Title across
  the whole face, the setup down the left column, `P(D|+) = P(+|D)P(D)/P(+)`
  standing alone at the top of the right one.

- `03-no-directive-column-flow.png` — **the frame the phase is actually
  about.** The same lecture with the author's three `@turn`s deleted, so the
  document says NOTHING about where anything goes. Board 1 fills its left
  column, resumes at the top of its right, then board 2 does the same — and
  the pen walks only when a FACE is full. Two boards carry what four
  half-empty ones carried before, and the reader can see the shape of the
  argument: setup left, the formula that answers it top-right, the count
  beneath, the conclusion across the second board. Nothing was written to get
  that; it is what happens when the author says nothing at all.

## What is NOT in these frames, and why

**中心往外的辐射** — true radial composition (a central object with prose
orbiting it) is a layout family this fold does not have. Every box is
rectangular, chained on a front, and claims a full column width; an orbit
would need a box that claims an ANNULUS, and faking it with offsets produces
mush. It is the next design question, not a defect of this phase.

The four boards still read as roughly half full, and that is the author's
three explicit `@turn`s rather than the engine: a turn walks whatever the
fill. What changed is that the room now SAYS so — `check-board` reports
`turnUnderfilled` with the percentage the abandoned board had reached.

## The instrument

See `harness/layout-baseline/README.md` — the phase's two legs (columns
alone are byte-identical on the three strips; the type scale moves every row
and every row lands on the y-oracle) are recorded there under "the 2026-08-12
composition phase".
