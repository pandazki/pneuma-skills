# Charts & graphs — the craft of giving evidence

Both are **named accumulating containers**: the first block for a name
declares the container; every later block with the same name draws into
the same picture. The picture stays where it was first declared — your
text continues below while the pen turns back to add to it. That is the
whole trick of "the chart draws as the talk reaches it": the talk moves
forward, the evidence grows in place.

## Chart: the axes

````markdown
```chart 恢复时间
x: 第1月 第2月 第3月 第4月 第5月 第6月  (月)
y: 0 .. 240  (分钟)
```
````

- The first block stands the axes up: ruled first (x then y), tick by
  tick, label by label — the board standing up the skeleton before any
  data exists. Declare it right after the sentence that motivates the
  chart, so the audience knows what the empty axes are for.
- Axis forms: a range (`0 .. 40`) or enumerated values
  (`第1月 第2月 …`). A range names its two ends and nothing in between; an
  enumerated axis names every position you list, and the board writes each
  one under the axis. The choice decides what you can point at later —
  see [Where a mark may point](#where-a-mark-may-point).
- **Both ends of a y range are real.** The lower end is the floor the plot
  is drawn from, not a decoration: `y: -3 .. 3` puts 0 in the middle of the
  picture, and `y: -40 .. 25` gives the losses as much room as the gains.
  Pick the interval the argument lives in — a series that never drops below
  60 says more on `y: 60 .. 100` than on `y: 0 .. 100`. The two ends must
  differ; `y: 0 .. 0` (and the `y: 0 ..` typo) names a point, nothing can be
  scaled against a point, and the block is refused with a badge.
  What the axis measures rides in parentheses at the end — how much of
  what (`(分钟)`, `(×)`, `(machines)`), never a scenario label. `(2026)`
  there measures nothing; if the year matters it belongs in the sentence
  that introduces the chart.
- **What the y axis measures is written glued to the number**: it is
  appended straight onto every tick and onto the series' end label, so
  `(分钟)` gives `0分钟` / `日发 24分钟` — right in Chinese — while
  `(min)` gives `0min` / `Daily release 24min`, which is wrong in
  English. Either choose something that reads glued (`(×)`, `(%)`), or
  write the separator into the parentheses yourself:
  `y: 0 .. 240  ( min)` renders `0 min` / `Daily release 24 min`. That
  leading space is load-bearing — it is the only place the board can
  learn that this language keeps a number and its measure apart. (The x
  parentheses are for whoever reads the source: the board writes the x
  labels you enumerated, so what you put there is never written out.)
- `type: line` is the default and the only performed type (see edges).
- Axes belong to that first block only — a later same-name block that
  re-declares `x:` / `y:` breaks that block (one badge, neighbours fine).
  A first block that has only `+` rows and no axes is an orphan layer and
  raises `refUnresolved`.

## Chart: the layers

````markdown
```chart 恢复时间
+ 月发: 205 198 212 190 201 196
```
````

- `+ 系列名: v v v …` — one series, values separated by spaces or commas,
  one value per x position. The line grows left to right; its label is
  written after the line completes; the legend accumulates by itself.
- `+ mark 系列 @ x : "文本"` — circle a data point and write a short label
  at it. The closing gesture of a chart story: the eye lands where the
  argument ends.
- `+ note @ x , y : "文本"` — a free note at coordinates, for context
  that belongs to the picture rather than to one series.
- One unreadable row breaks its whole block (small badge + warning with
  the address); other blocks of the same chart are untouched.

### Where a mark may point

`@ x` is a position the board has to FIND on the x axis, spelled the way
the axis spells it:

- **Enumerated axis** — any value you listed, written exactly:
  `x: 第1月 第2月 第3月 第4月` takes `@ 第4月`.
- **Range axis** — either end, written exactly (`x: 2023Q1 .. 2024Q4`
  takes `@ 2023Q1` and `@ 2024Q4`); or, when both ends are numbers, any
  number between them (`x: 0 .. 64` takes `@ 32`).

Nothing else is a position. `x: 2023Q1 .. 2024Q4` names two quarters and
no way to order what lies between them, so `@ 2023Q3` points nowhere — the
label is not written, and the board reports the row (`refUnresolved`,
addressed to the block) rather than leave you a picture quietly missing
its point. **If you mean to point INSIDE a span, enumerate it**:
`x: 2023Q1 2023Q2 2023Q3 2023Q4 2024Q1 …` — now every quarter is a place
you can mark, and each is written under the axis.

Two more things an annotation has to match, with the same consequence
(nothing written, reported the same way):

- a mark's series name is one already drawn on this chart — the same name,
  spelled the same;
- a note's `y` is a plain number (`+ note @ 2024Q4 , 35.6 : "…"`), never
  `35.6B` — what the axis measures already rides on the axis.

## Chart pacing

The rhythm that makes evidence feel narrated instead of pasted:

1. **Sentence, then axes.** "我们把两家公司的营收放到同一张图上：" —
   then the axes block. The empty axes are suspense.
2. **One layer per sentence.** Say what the line will show, then the
   block that draws it. Two layers under one sentence reads as a data
   dump; the audience needs the claim before the curve.
3. **Order is argument.** The first series is the baseline the audience
   holds in mind; the second draws against it. Put the surprising one
   second.
4. **Mark to close.** End the story with `+ mark … : "…"` on the number
   the whole chart existed to reach.
5. **Two or three series.** More than three lines in one picture stops
   being contrast and starts being a dataset. Short series names — they
   are hand-written at the right edge of the picture.

## Graph: structure as evidence

````markdown
```graph 数据流
讲稿 → 推断 → 时间轴 → 播放
推断 → 语音合成
语音合成 → 播放
推断: 把讲稿变成串行 step
```
````

Rows read as lines of the talk, not configuration:

- **A chain** — `甲 → 乙 → 丙` (`->` works too): consecutive names are
  linked in order. Boxes and arrows are drawn one at a time, in reading
  order.
- **An annotation** — `名字: 说明` writes the explanation into that
  node's box (and introduces the node if this is its first mention).
- **A lone name** — a node with nothing hanging off it yet.

First mention owns the ink: naming a node or repeating an edge later —
same block or a later same-name block — draws nothing new, because it is
already on the board. Layout is computed for you; you never place boxes.
The trade for that: the arrangement is computed over everything the
picture holds so far, so a later same-name block re-arranges the **whole
picture** — boxes and arrows already standing move to make room for the
new ones. A chart never does this (you declared the axes, so every point
has its place); a graph does it on every added block.

## Graph pacing

- **Declare the whole structure in the first block when the picture must
  not shift.** This is the default. A single block still performs box by
  box, arrow by arrow, in reading order — the audience watches it grow;
  nothing about pacing requires splitting it up.
- **Growing a graph across blocks is legal, at a cost:** each added block
  re-arranges what is already drawn, in front of the user. Reach for it
  when the re-arrangement is the point ("now the picture has to make room
  for this"), never as the default.
- **One block per stretch of talk** when you do grow it: introduce a
  branch with the sentence that explains why it exists.
- Annotations are for one-line explanations, not paragraphs — a box is a
  box. If a node needs real explanation, that is narration's job. Nothing
  you write there is dropped: the box grows downward to hold every line, so
  a paragraph gives you a paragraph-shaped box standing in your picture.
  That swollen box is the board telling you the sentence belongs in the
  talk, not in the node.

## Is it big enough? — look, because nothing will tell you

The two containers do not take their size the same way, and the
difference is the whole reason a figure comes out too small to read:

- **A chart fills the width it is given.** Its picture is stretched to the
  room its `@at` word named, so its axis labels and series names grow and
  shrink with that room and stay roughly in proportion with the
  handwriting beside them.
- **A graph is drawn at the size its boxes need, and from there it only
  ever shrinks.** The lettering inside a graph is a fixed size in the
  picture's own coordinates: a node's name is about seven tenths of the
  body handwriting, an explanation line under half of it. Two consequences
  follow, and both are the "postage stamp" complaint. A small graph sits
  small on a big board instead of growing into it — a three-box chain
  covers about a third of a full board's width. And a graph wider than the
  room it was given is shrunk **whole**, lettering included: a five-box
  CJK chain carrying explanations, put under `@at left`, lands with its
  names at roughly two fifths of the body text and its explanations at
  under a third. Nobody at the back of the room can read that.

Neither is a fault, so **`check-board` says nothing about it** — there is
no finding for "too small", because you asked for the word and the board
gave you exactly what the word means. The only instrument is your eyes:
`capture` the figure once it has played and ask whether its labels read at
the same distance as the sentence above it. Look once per figure, not once
per block.

Three things make a graph bigger, and only these three:

- **a wider word** — `@at full` rather than a column. A picture that
  carries the passage deserves the face; a picture in a corner is a
  decoration.
- **fewer boxes** — two three-box pictures say more than one seven-box
  one, and each is drawn at full size.
- **shorter names** — a box grows to its text, so every character cut is
  width the picture keeps for itself.

Making it taller changes nothing: width alone decides how much the picture
is shrunk. And splitting one wide graph into two same-name blocks does not
help either — the container lays out over everything it holds, so the
second block re-arranges the first into the same wide picture.

## Honest edges

- Chart series always draw as lines. `type: bar` parses and is reserved;
  no bars, no pies, no stacked areas today.
- A chart or graph name is one container per board — reusing a name means
  adding to that picture, so name them by what they show (`恢复时间`,
  `数据流`), not generically (`图1`).
- Values are numbers only in series rows; anything else breaks the row's
  block.
