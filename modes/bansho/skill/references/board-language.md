# Board language — the full dialect

The dialect is deliberately tiny, and every mark in it is one you would
write anyway. The test of a good `board.md`: take the board away and the
file is still a well-structured essay you could publish. All performance
semantics ride on ordinary punctuation and ordinary markdown — there are
no ids, no time fields, no effect names.

## Document skeleton

- One `#` title at the top. Written large with a hand-drawn underline;
  the board pauses longer after it, the way a lecturer lets a title land.
- `##` opens a section — and so does a later `#`: any heading after the
  title does. Everything between the title and the first section heading
  is the opening (section 0 in the address vocabulary). A section heading
  is a promise — "now we talk about this" — and earns the same longer
  breath.
- Those two levels are the whole heading vocabulary, and `- ` is the
  whole list vocabulary. `###` and deeper play as narration with the
  hashes handwritten; an ordered list (`1.` `2.` `3.`) collapses into one
  paragraph with the numbers written as text; `* 条目` keeps its
  asterisk. No warning fires for any of these — the file still reads as
  valid prose — so the only signal is the user watching it.
- Every block separated by a blank line is one **step** of the talk: a
  paragraph, a list item, an aside, a `---`, a formula block, a chart or
  graph block, a turn-back line. One step = one held pen.

## Narration (paragraphs)

Handwriting flows in as the paragraph is spoken. Punctuation carries the
pauses — a comma is a small one, a sentence-ender a fuller one, a
paragraph break fuller still. This is why punctuation discipline matters
more here than in print: Chinese appears a character or two at a time, so
a long unpunctuated Chinese run plays breathless. Write short sentences
and let the punctuation do the pacing.

## Lists

```markdown
- 可并行的部分：机器越多摊得越薄
- 串行的部分：加多少机器都不动
- 天花板：由第二类单独决定
```

Items appear one at a time, each with a hand-drawn dot. When consecutive
items all share the same kind of first separator — a colon (`:` or `：`)
or a spaced dash (` — `) — the board aligns them into two columns, label
column set by the widest label, the way a teacher tabulates parallel
claims. Zero extra syntax; an item without the separator ends the aligned
group. This is the board's table — markdown table syntax is not part of
the dialect.

## Asides

```markdown
> 供给侧的故事我们下一节再讲。
```

Smaller, tinted, set off from the main line. Use for side remarks,
caveats, and promises of what comes later. An aside is a stage whisper —
if the content is essential to the argument, it belongs in a paragraph.

## Closing a thought

`---` draws a hand-drawn line across the board and takes the longest
breath in the dialect. Use it to close a movement of the argument, not to
decorate. It usually precedes the summary or the next big turn.

## Mathematics

- Inline: `$S(n)$`, `$p = 0.95$` — rendered in place, written out left to
  right the way a hand writes a formula.
- Block: `$$S(n) = \frac{1}{(1 - p) + \frac{p}{n}}$$` on its own line —
  centered, larger, its own step.
- LaTeX coverage is broad (KaTeX): subscripts, fractions, Greek, set
  symbols, `\mathbb` / `\mathfrak` variants all work. A formula that
  fails to parse becomes a `mathRenderError` finding, not a blank.
- Currency is not math: `$100` stays money. The board only opens a
  formula when the `$` sits against real content on both sides — writing
  prices in a sentence is safe.

**The boundary that matters:** to the back-reference matcher a formula is
**zero characters** — it contributes nothing to a step's quotable text. A
quoted target that includes or crosses `$…$` can never match and degrades
to a `refUnresolved` warning. Quote the plain words next to the formula
instead: after `设可并行的比例是 $p$，……`, turn back with
`@circle "设可并行的比例是"` — never `@circle "比例是 $p$"`.

## Ink marks (inline)

| Mark | Move | Ink |
|---|---|---|
| `==三倍==` | emphasize | marker sweep across the phrase |
| `**结构性**` | stress | hand-drawn underline |
| `((35.6B))` | point at a value | hand-drawn circle |
| `~~常规反弹~~` | write it wrong on purpose | struck through after a pause |
| `*术语*` | light emphasis | tinted, no ink action |
| `` `code` `` | term of art | monospace, no ink action |

The sentence is always written first; the pen returns for the ink after
the final word, then the talk continues. Marks nest (`~~不是**结构**问题~~`
strikes the whole phrase, underline included). Budget: one heavy mark
(`==`, `((`, `**`) per sentence — a board covered in marker has no
emphasis left.

**Circle two or three short words — never a clause.** A circle is one arc
drawn around whatever the phrase occupies, so its length is its risk. A
target long enough to wrap is drawn as two arcs, one per line, and the
second can end up lassoing a single stranded word. In CJK the arc's tip
also stops inside the neighbouring glyph's side bearing (a full em wide);
in Latin script the next word begins a ~4 px space away, so a tip that
overshoots lands on letters. Circle `((serial fraction))`, not
`((the serial fraction that sets the ceiling))`; move the article and the
scaffolding outside the parens — `an outage for ((one tenth))` reads
better than `((an outage for one tenth))` and draws better too. The same
bound applies to a turn-back `@circle "…"`. `==marker==` sweeps are a
band, not an arc, so they tolerate a full clause.

## Turn-back lines

```markdown
@strike "慢了就加机器"
```

Verbs: `@strike`, `@circle`, `@highlight`, `@underline`. The line stands
alone, target quoted. The pen physically returns: the view turns back to
the target, the ink lands, and the talk resumes where it left off — an
independent step, serial like everything else.

Resolution rules:

- The target is the **nearest earlier exact substring match**, searching
  upward from the directive, within a single step's text (matches never
  stitch across steps).
- Ambiguous? Quote a longer run — nearest-match plus a longer quote
  resolves every practical case; there is no id syntax to learn.
- No match → the step degrades to a visible bad-step badge on the board —
  the same badge a broken block gets — plus a `refUnresolved` warning
  with the address. A sloppy quote is not silent; the user sees the
  badge. Fix the quote and both the badge and the warning clear.
- Formula text is invisible to matching (see Mathematics above).

## The room — `@board`

```markdown
@board 3

# 为什么加机器不一定更快
```

The lecture's opening stage direction — like "(三块板)" at the top of a
script. It must be the document's **very first line**, before even the
title; anywhere else (or a second one) is a broken step. Counts 1–4:
absent or `@board 1` is the single long strip (the default board you
already know); 2–4 stand that many fixed-size boards side by side. The
lecture fills them in document order, whole steps only — a step that does
not fit moves entirely to the next board. You never place anything: no
verb in the dialect takes a board number, and the camera walks with the
pen on its own.

When a board fills and you keep writing, the pen walks to a clean one —
a never-used board first, then one an erase has emptied. When there is no
clean board left, **the room stops deciding**: the pen stays where it is
and the writing runs on past the bottom edge, visibly, and says so. It
never picks a board to retire for you. When the retiring is part of the
talk — "this part is done, put it down" — say it yourself with `@erase`.

## Placing — `@at`

```markdown
@at right

```chart 增长率
…
```

@at top-right "那个定义"
```

A board is a surface, not a column. `@at` stands alone on its own line,
like `@erase`, and walks the pen to a named part of the board under it.
It is **pen-scoped**: everything after it lands there, until the next
`@at`, the next `@turn`, or the end of the document.

- **`@at <word>`** — walk to that part of the board the pen is on.
- **`@at <word> "锚文本"`** — resolves the quote like a turn-back line
  (nearest earlier match), then walks to that part of the board **the
  quoted text lives on**. On a wall this is how you cross back to an
  earlier board without ever naming a number; on the strip it is how you
  return to a placement you left half-written, and how you set two
  columns against each other: `@at left` for A, then
  `@at right "A 的开头"` opens B top-aligned with it.

### The words are all there are

Nine on a wall of boards (`@board 2`–`4`); on the single strip only the
three that name no vertical fraction, because a strip has no bottom to
take fractions of.

| Word | Where it stands | On the strip |
|---|---|---|
| `full` | the whole board — the default, never needs saying | yes |
| `left` / `right` | half-width column, that edge, top to bottom | yes |
| `top` / `bottom` | full-width band, that half | no |
| `top-left` / `top-right` | quarter, that corner | no |
| `bottom-left` / `bottom-right` | quarter, that corner | no |

No pixels, no percentages, no board numbers, no "put it wherever there is
room" — **the word says how wide and which edge, and the board says from
where**. A word outside the table is a bad step that lists the legal ones;
a vertical word on the strip is a bad step that teaches the way out
(columns, an anchor, or standing real boards with `@board 2`–`4`). Neither
ever quietly falls back to `full` — silently putting content where you did
not say is the failure this verb exists to remove.

The table grows by adding words, never by adding numbers. Size comes with
the word: a chart that is too big is fixed by choosing a narrower word,
not by a size field.

Size comes with the word in the other direction too — **the word you say
is the room that passage gets, for the whole passage**. A half-height band
(`top`, `bottom`) is about three short paragraphs on a standard board; a
corner is half of that. Ask what the passage weighs before you name its
word, because a named region never migrates: when the writing outgrows the
word, it does not walk to the next board — it runs off this one
(`regionBurst`, below).

### The one asymmetry — read this before your first `@at`

`full` and a named region do **not** start in the same place, and the
difference is the whole of what you have to hold in your head:

- **`full` writes below everything standing** — every board's own flow
  carries on beneath all the ink on that board, a corner's included. The
  room's flow never writes over anything.
- **A named region starts at its word's own y** — `left` begins at the
  top of the board because that is where the left column starts, whatever
  else stands there. Your frame, your cursor, your consequence.

So this puts the column on top of the title:

```markdown
@board 2

# 两种记法，同一段声音        ← this is `full`, and it stands at the top

@at left                     ← `left` also starts at the top: on top of it

## 波形的说法
```

That is not a defect and nothing will move it: `left` means the left
column of the board, so a `left` that dodged downward would no longer be
top-aligned with the `right` you are about to open — and paired columns
are the reason the word exists. **The way out is a word, not a nudge**:

```markdown
@at top                      ← the banner takes the upper band

# 两种记法，同一段声音

@at bottom-left              ← the two columns take the lower one,
                               top-aligned with each other, clear of it
## 波形的说法

@at bottom-right

## 频谱的说法
```

The middle gutter goes unused, and that is fine — a teacher wastes board
too. The other way out is to put the title inside the column. (A banner
across the top with two columns beneath it, sharing the full height, is
the one shape this table cannot say; it is written down as a known gap,
not an oversight.)

### When two things do land on each other

The room lets it happen and repairs nothing. Both are written, later ink
over earlier, both still there when you scrub back — ink is matter. What
you get is told, not fixed:

- **`regionCollision`** — two declarations standing on each other, both
  named, with how much of the smaller one is covered. When the flow is one
  of the two, the overlap is against its **claimed** width: a `full`
  paragraph claims the whole board even where its last line stops short,
  so the ink may not actually touch. Look before you believe it.
- **`regionBurst`** — writing taller than the frame it was put in. A
  region's size is a budget, not a wall: the writing stands where you put
  it, never shrunk, never moved to another board. **But a board is not a
  budget — it is an object with an edge.** What passes the bottom of the
  board is not written at all: the reader watches a sentence stop in the
  middle of a word, and the board draws a dashed line across that column
  with how much fell below it, so `capture` shows the loss too. The
  finding says which of the two you have. A burst inside a corner that
  spills into the half below is ink the reader still has; a burst off the
  bottom of the board is a paragraph nobody will ever read.

  Three ways out, and only these three change the height: **say less
  there**, **place it under a word with more room** (a corner is a quarter
  of the board, `left`/`right` a half), or **give the passage a board of
  its own** — `@turn` walks the pen to a clean board and back into the
  flow. Splitting the passage into two steps is not one of them: the
  region does not migrate, so two short steps stand exactly as tall as one
  long one. When the flow itself (`full`) runs off the bottom, there is no
  wider word and `@turn` has nowhere to go — retire a finished board with
  `@erase "锚"`, or say less.

  **A burst is not a weather report.** It is the one finding that costs
  the audience words, so answer it before you write the next passage;
  measuring one and writing on is how a lecture ends up with two boards
  that end mid-sentence.

The first collision of a pair also arrives unasked, without your having to
check. Three ways out, all of them yours: erase one side (`@erase "锚"`),
rewrite the side that has not played yet under a different word, or leave
it if writing over is what you meant.

Look before you place — `glance-board` for what stands, `frame-board` to
lay your candidate words over the real board and be told what they would
land on. That is cheaper than writing and looking.

Place because the content asks for it. A placement for decoration is as
bad as a sentence written for geometry.

## The camera — `@focus` / `@overview`

```markdown
@focus "串行的部分"

@overview
```

- **`@focus "锚文本"`** — resolves the quoted text exactly like a
  turn-back line (nearest earlier match), then walks the view to it at
  reading size — "let me take you to look at this". Never magnified:
  closing in is a different act, and the dialect does not have it.
- **`@overview`** — steps back until everything written **so far** is in
  view; content not yet written never appears early. "Let us look at the
  whole board."
- Neither takes a board number or a coordinate — content anchors, like
  every other verb.
- A directed view **holds** through pauses (`@wait`) and through erases,
  and hands back to the pen the moment the next writing step begins. The
  camera follows the pen by default, so a board with no camera verbs
  behaves exactly as before — direct it at the turns of the argument,
  not per step.
- The user's own camera always outranks your direction — the wheel, and
  dragging the board by hand (which also pauses playback). Pressing Live,
  seeking, or simply resuming playback hands the camera back.
- An unresolvable `@focus` anchor degrades exactly like a turn-back:
  a bad-step badge plus `refUnresolved`, and the view simply does not
  move.

## The eraser — `@erase`

```markdown
@erase

@erase "并行的天花板"
```

- **Bare `@erase`** — the board currently being written is erased; the
  next thing you write starts at its top. On the single strip this is
  "clear the stage for a new chapter".
- **`@erase "锚文本"`** — resolves the quoted text exactly like a
  turn-back line (nearest earlier match), then erases **the part of the
  board that text lives in**. It never takes a board number — anchor
  content, like every other verb.
- The eraser's reach is one **region**, not the whole board: bare
  `@erase` takes back what stands where the pen is, the anchored form
  what stands around the quote. On a board that never said `@at` the pen
  is in `full` and `full` is the whole board, so both read exactly as
  they always did. After a placement, `@erase "锚"` is how you take back
  one column and leave the other standing.
- To take back one claim, use `@strike` — strike negates in view and
  leaves the words standing; erase retires finished writing without
  judgment.
- Erasing changes the stage, never history: scrub back and the content
  reappears; the Notes view keeps every word forever. And `@erase` is an
  **appended instruction** — deleting played text from `board.md` is
  still destroying history, and still forbidden (see Editing rules).
- An unresolvable anchor degrades exactly like a turn-back: a bad-step
  badge plus `refUnresolved`.

## Turning to a new board — `@turn`

```markdown
## 换一个问法

@turn

新话题的第一段。
```

- The family's third member: `~~x~~` / `@strike` negates in view,
  `@erase` retires to make room, **`@turn` leaves a FULL board standing
  and walks to a blank one**. It stands alone and takes no argument — the
  room picks the board, never you.
- **The trigger is no room left, not a new topic.** The room already
  turns for you: writing that does not fit its board continues on a blank
  one by itself, the moment the face runs out. A heading therefore needs
  no turn — `##` turns the topic, `@turn` walks the room, and most
  documents want only the first. Write one because you want the rest of
  that board kept blank, not because the subject changed.
- **Fill the face first.** A board is a surface, not a column. Before you
  turn, ask whether the right half is empty — if it is, the block you
  were about to put on a fresh board belongs at `@at right`. A turn at
  three-quarters spends a whole blackboard on a paragraph, and a turn
  whose destination ends up holding one line spends one on a sentence.
  `glance-board` reports each board's fill; read it before the turn.
- The pen walks to a blank board when the room has one (never-used first,
  then an erased-empty one); on a **full wall** it does nothing and says
  so (`turnOnFullWall`) — the room will not choose which of your boards to
  retire, the same way writing into overflow no longer erases anything. So
  glance (`glance-board`) before you turn, and say your own retirement
  first when the wall is full: `@erase "锚"`, then `@turn`.
- On a board that is already clean, `@turn` is just a breath — a pause at
  the topic boundary, nothing moves. Only the single strip refuses it: a
  strip has no next board, and the line degrades to a bad step that says
  so.
- `@turn` right after `##` is the textbook pairing: the heading turns the
  page of the TOPIC, the turn walks the ROOM. Two redundant combinations
  to avoid: `@erase` then `@turn` (the erase already cleared the stage —
  the turn adds only a breath; pick ONE: erase = clear and reuse this
  board, turn = leave it standing and go) and `@turn` then bare `@erase`
  (it erases the empty board you just reached — noise). `@turn` then
  `@erase "锚"` is meaningful: a new board for the new topic, and an old
  board retired to make future room.

## The escape valve

`@wait` on its own line adds one extra breath; `@wait 2` makes it about
two seconds. It is the only timing word in the dialect, and it is for the
rare spot where a silence IS the rhetoric (after a bombshell, before the
reveal). Needing it more than two or three times in one lecture means the
structure wants rearranging — split a paragraph, add a heading, layer the
chart — not more pauses.

## Removed words

`@with` and `@after` are dead syntax from a discarded parallel model and
now parse as broken steps. The board is single-threaded: order is
document order, and there is no simultaneity to express.

## When a block breaks

The blast radius of any mistake is one step, never the board. A block the
parser cannot read becomes a small badge on the board plus a
`stepParseError` warning with the address and excerpt; everything before
and after plays untouched. An unknown fence type renders its body as
plain text (the dialect grows by addition — unrecognized marks degrade to
text, they never crash).

## Editing rules

- **Append** — always safe; the mode is built around it.
- **In place** — only for blocks that have not yet played, or typo-level
  fixes that keep the block's shape. The user has seen everything that
  played; the timeline is history and the board is its projection.
- **Never** insert mid-board or reorder: step identity is positional, and
  shifting every later step forces the board to reconcile what the user
  already watched.
- **Never** delete played content — strike it (`~~x~~` in the moment,
  `@strike "…"` after the argument) and write the correction after; or
  retire its whole board with an appended `@erase` when it has served its
  purpose. The crossed-out mistake is content, the erased board is
  history — deleting from the file is neither, and destroys both.
