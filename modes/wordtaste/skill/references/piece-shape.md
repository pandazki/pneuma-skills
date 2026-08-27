# What a finished piece may contain

A WordTaste piece is prose. Two constructs live inside it and nothing else
does: no bullet points, no numbered lists, no bold, no italics, no tables, no
code, no images, no links. Both constructs are narrow on purpose, and both are
described to the writer once, in its standing charter — the `shape` block of
`prompt-scaffolding.en.json`.

## Sections

One heading level, `## `, and no level below it. The first unit still opens
with the author's own title, as `# `.

Where a section opens and what it is called are decided by different parties,
and that split is the whole design:

- **Where** is the plan's: `opens_section`, an optional boolean on a unit.
- **What it says** is the writer's, in Chinese, as the first line of that
  unit's output.

A boolean carries no Chinese, so sections cost the verbatim rule nothing — a
planner still cannot put a sentence of its own into a prompt. And because the
plan decides placement, section openings cannot become a per-unit habit. An
isolated writer asked to decide for itself would open one every time, which is
the list-shaped output the whole pipeline is built to avoid. Many pieces want
no sections at all.

The flag on the first unit is ignored rather than refused: that unit's first
line is the title, which is already the opening, and asking one writer for two
different first lines is worse than dropping a redundant mark. Refusing would
throw away a whole plan over it, which costs far more than it is worth.

The layout gate shows which units open a section, in the same table where units
are approved, reordered, and merged. A boundary the user cannot see is one they
cannot move.

## Asset slots

This mode makes text and only text. When a piece needs something that is not a
sentence — a diagram, a photograph, a screenshot, a clip — nothing is generated
and no file is linked. The writer writes down what belongs there and the words
that thing has to carry:

```asset
what: a diagram of three agents rewriting one passage in turn, with arrows marking the two return trips
copy: input
copy: first rewrite
copy: second rewrite
```

The example is English because every file in this skill is; a real block is
written in the language of the essay.

`what` says what the thing is, once, in one sentence. Each `copy` line is one
string that has to appear inside the thing itself, in the order it should
appear; a thing that carries no words has no `copy` lines. Those two keys are
the whole format — no others, no nesting, no prose inside the block. Anything
else does not parse, and a block that does not parse stays visible as a code
block rather than disappearing: a malformed slot the author can see is one they
can fix.

The viewer draws a parsed slot as a card. A later agent whose job is making
artifacts reads the same block as its brief; that hand-off is what the format
is for.

Two rules that do not follow from the format:

- **The prose around a slot stands on its own.** Write as though the thing may
  never be built, and never make a sentence depend on it the way "as the
  diagram below shows" does.
- **`copy` is prose and is checked as prose.** It is text a reader will see, so
  it carries the same taste as the paragraphs around it. `what` is a
  specification for a later agent and is out of the checker's scope. The
  checker is told both, in `check_structure_note`.

## What the next writer sees

Slots are stripped out of `<preceding_prose>` before it reaches the next
writer; headings stay. The reason is the same one the charter opens with: the
Chinese you read just before writing is the Chinese you will write, and the
draft so far is the last thing a writer reads. A block of keys and values in
that position is a register to imitate. Nothing replaces it — a marker would be
Chinese this pipeline wrote, which is exactly what the prompt is built to keep
out.

The cost is real and is not hidden. A later unit cannot see that a diagram was
asked for two paragraphs back, and may explain in prose what that diagram was
going to show. Watch for it when you read the draft; it is a thing to fix by
editing, not by loosening the rule.
