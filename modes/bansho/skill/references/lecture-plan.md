# Designing the lecture — `plan.md`

SKILL.md carries the rule: the design is written down, in `plan.md`, before
the first board step. This file is the craft — how to size a passage, how
to tell a real figure from a paragraph with a box drawn round it, how much
room a thing actually needs, and how to revise a design without quietly
abandoning it.

## Why a file and not a thought

Three reasons, and each of them is the reason on its own.

- **Your memory is not durable.** A long lecture outlives the window you
  are thinking in. What you carry from the first passage to the ninth is
  whatever you wrote down.
- **The user wants to see the design.** A teacher who says "here is where
  we are going" before going there is easier to follow, and easier to
  argue with. `plan.md` sits beside `board.md`; they can open it.
- **`board.md` cannot hold it.** Everything in `board.md` is performed. A
  design pasted in there is handwritten onto the board, in front of them,
  as narration. There is no comment syntax that hides from the pen.

`plan.md` is not watched, not parsed, and never performed. It will not
become a second board and will not appear in the set switcher.

## The arc, in two lines

Before any table, write the question and the payoff, in one line each.

```markdown
Q 加一倍机器，为什么不快一倍？
A 串行的那一段就是天花板，而且它比谁想的都低。
```

If the payoff is a restatement of the question, there is no lecture yet —
there is a topic. Keep pulling until the answer says something the
audience did not walk in with.

## Passages — how big is one

A passage is one thing the audience takes away, not one paragraph. It is
usually two to five board steps: a claim, its picture or its arithmetic,
and the sentence that lands it.

- Three to six passages is a lecture. A dozen is a syllabus; cut it into
  two lectures rather than writing a fast one.
- A passage that fits in one sentence is not a passage — fold it into its
  neighbour.
- A passage you cannot say the point of in one line is two passages.

## MEDIUM — the decision that gets skipped

Decide the medium in the design, per passage, before the sentences exist.
Afterwards it is too late in the only way that matters: prose that has
been written already reads finished, and nobody deletes finished prose to
draw the picture it was standing in for.

A passage is a **picture** when it:

- **counts** — 10000 人里有 100 个有病，其中 99 个测出来 → the numbers ARE
  the explanation, and a `graph` splitting the population says it faster
  than any sentence;
- **compares** — two series, two costs, before and after → one `chart`
  with the second line drawn against the first;
- **splits** — one whole into parts, a case into branches;
- **traces a flow** — A 到 B 到 C, a pipeline, a chain of causes → `graph`.

A passage is **words** when it names a thing, states a claim, or concludes.
A passage is a **formula** when the notation is the shortest true statement
— and a formula is almost always followed by a picture, because a formula
convinces nobody who does not already believe it.

Two traps:

- **A figure that only labels prose is not a figure.** A `graph` whose
  boxes contain the sentences you were going to write is a paragraph in a
  box. If the picture does not do work the sentence cannot, write the
  sentence.
- **A lecture whose central idea is a picture must draw it.** If the one
  thing you want them to remember is a shape, a proportion or a flow, that
  passage is a figure — no matter how well the paragraph reads.

## ROOM — a wall of four boards is eight columns

A face fills in columns. Writing carries on at the top of the next column
before the room turns to another board. So the capacity of a wall is
`boards × 2` columns, and a design that only ever says "board 2" spends
half of every face.

Say the room in `@at` words:

- `@at left` / `@at right` — one column. A figure beside the prose that
  explains it, a table of numbers beside the claim it supports.
- `@at full` — the whole face's flow, below everything standing. Titles,
  closes, and anything that needs the width.
- A wall's corners (`top-left`, `bottom-right`, …) — a definition parked
  where it can stay visible while the argument moves on.

Rules of thumb: a figure and its prose are a `left` / `right` pair, and
the pair is the reason a passage earns a whole face. A close wants `full`.
Two consecutive prose passages on the same face should be `left` then
`right`, not `full` then `full` — the second `full` writes BELOW the first
and the face runs out at half its real capacity.

**The word in the ROOM column is a size, so weigh the passage against it.**
A named region never migrates: writing that outgrows its word does not
move to the next board, it runs off the bottom of this one, and what
passes the board's own edge is not written at all. Rough capacities to
design against — a whole face is around six short paragraphs, `left` or
`right` about three, a half-height band (`top`, `bottom`) about three, a
corner one or two, and **a figure needs a face or a column of its own,
never a band shared with the prose that introduces it**. A passage you
have written down as "prose + figure" in a corner is already over budget
on paper, which is the cheapest place to find out.

If the board tells you afterwards that a passage burst (`regionBurst`),
that is a design number coming back wrong — revise the design, do not
write on. Give it a wider word, split it into two passages with two rooms,
or cut it. Writing the passage anyway costs the audience the end of it.

## LENGTH — an estimate you can be wrong about

Write a rough number of seconds per passage. It is not a schedule; it is
the thing that makes a mistake visible. Rough calibration: a spoken
sentence is 4–6 seconds; a paragraph of three sentences with its pauses is
15–25; a chart layer is 8–15 on top of the sentence that introduces it.

Sum them. If the sum is two minutes and the user asked for a ten-minute
lecture, the design is thin before you have written a word — which is the
cheapest possible moment to find out.

## Working against the design

```
write the passage → let it play → glance-board → hold it against the
design → next passage
```

`glance-board` answers the two questions the design cannot: how full each
face really is, and where the pen actually stands. Two passages behind a
glance and you are guessing about both.

What to check each time, in this order:

1. **Room** — is the face filling the way the design said? A face that
   reads 46% after two passages that were supposed to fill it means the
   columns are not being used: the next passage goes `@at right`, not on a
   new board.
2. **Length** — is the passage roughly its estimate? Twice the estimate,
   twice, means the whole design is half as long as it says.
3. **Medium** — did the passage you planned as a figure get written as
   prose? This one is nearly invisible from the inside, which is exactly
   why it is on the checklist.

## A clean check IS a fact about your file — for width

A board has a fixed size now (1242 x 894, every screen). **Which board a
passage lands on, where a line wraps and whether a `@turn` finds a clean
board no longer move with the window**, and that is measured rather than
promised: the layout gate captures the canonical layout at 1280 and at 1990
and the two files are byte-identical. So `check-board` came back clean is a
statement about `board.md`, and you and your reader are looking at the same
lecture.

It was not always true, and the failure is worth carrying because the habit
it teaches is still right. A lecture in this repo's own history was composed
until the flow stopped at exactly the last line of board 3, so that a
`@turn` would find board 4 clean. `glance-board` read `board 3 — full`. Not
92% — **full**, with zero margin, because the author had been deleting
content until the findings went away. One narrower window later, the flow
reached board 4 first, the `@turn` became a no-op on a full wall, and two
passages were written on top of each other.

That particular trap is closed. The rule it produced is not, because the
thing it really protects against is **composing against the fold instead of
against the lecture**:

- **Never shape prose to steer where the fold breaks.** Deleting a formula
  or demoting a heading until a finding disappears is not fixing the
  finding; it is moving the board out from under it. SKILL.md bans this in
  as many words, and it is worth knowing what it feels like from the
  inside: it feels like making progress. A fixed board width does not make
  this honest — it just means the wreckage is now reproducible.
- **Prefer a composition that does not care where the fold falls.** `@erase`
  names no board — it retires whatever the pen just wrote, wherever the
  fold put it. `@turn` needs a clean board to exist and silently does
  nothing when there is none. A composition that survives one more sentence
  being added upstream is worth more than one tuned to today's line count.

### What a check is still a fact about only ONE of: THE THEME

Light and dark name different handwriting faces (Bradley Hand vs Chalkboard
SE) with different metrics, so a theme flip re-measures everything — the
wraps, the ink drawn under the words, the heights the fold charges. It is
the one input that still moves the geometry underneath a clean check, and
it is the one the viewer cannot see coming (a width change has a
ResizeObserver; a font swap has nothing). If a lecture is meant to be read
in both, look at it in both.
## Revising honestly

The design is a promise; reality gets a vote. When they disagree, **edit
`plan.md`** and add one line saying what changed and why:

```markdown
> revised: 3 ran ~90s, not 50 — the derivation needed a worked example.
> Dropped 6 (the historical aside); 5 keeps the close.
```

That is a teacher adjusting, and it is visible to the user and to you.
What is forbidden is the silent version: writing on past the design and
never looking at it again. It is the failure mode the whole move exists to
prevent, and it hides perfectly — every individual sentence still reads
fine, and only the finished wall shows what happened.
