<!--
  Adapted from tw93/kami (MIT) — references/deck-preflight.md.
  Source: https://github.com/tw93/kami/blob/main/references/deck-preflight.md
  Credit retained per MIT License; see ../../NOTICE.md.

  Upstream's path-selection and page-size sections are not carried here:
  a Pneuma deck is HTML paper pages in the viewer, and the page size is
  locked at workspace creation. See ../../NOTICE.md.
-->

# Deck pre-flight (slides only)

Read this before drafting a deck. Every other document genre skips the file
entirely. `design.md` §8 «Deck Recipe» owns the visual grammar — typography
scale, layout patterns, table styles, SVG constraints — and this file owns what
has to be settled *before* any of that matters.

## What a deck is here

One `<div class="page">` per slide, rendered as paper in the viewer, at the
paper size locked for the workspace. There is no size decision and no export
path to pick: the Export menu handles PDF and PNG, and the fit loop
(`.pneuma/kami-fit.json`) is the same referee as for any other document.

The consequence worth stating out loud: **a slide cannot be made to fit by
resizing it.** Overflow is resolved by cutting or splitting content. If a whole
deck reads sparse, that is a content problem, not a geometry one.

If the user wants a Landscape deck and the workspace is Portrait, say so early —
that is a new workspace, not an edit.

## Content pre-flight

Confirm these before drafting any slide. Ask them **all at once**, skip anything
already answered, and do not stall the work waiting for a full set — draft on
the answers you have and mark what is still open.

| # | Question |
|---|---|
| 1 | **Audience + venue** — who is in the room, and is this a live talk, a 1:1, or a link someone reads alone? |
| 2 | **Length target** — speaking time or slide count? (15 min ≈ 10 slides · 30 min ≈ 20 · 45 min ≈ 25-30) |
| 3 | **Source material** — what already exists: outline, doc, notes, data? |
| 4 | **Evidence** — which screenshots, charts, logos, or product images are available; which slides need a real evidence slot; is a separate visual brief needed? |
| 5 | **Hard constraints** — brand colors, a required logo, slides that must exist? |
| 6 | **Format confirmation** — is this actually a deck, or a one-pager that looks like one? |

Question 6 is not a formality. A one-pager wearing deck clothes is the single
most common miss in this genre, and it is much cheaper to catch here than after
twenty slides exist.

## Content rules for slides

- **Ghost deck test**: read only the slide titles, in order. They must carry the argument on their own. If they read as a pile of topics, fix the titles and the order before touching layout.
- **One evidence shape per slide**: chart, table, screenshot, code, quote, or conclusion — pick one. Split mixed evidence across adjacent slides instead of crowding a sheet.
- **Audience copy stays clean**: titles, body, and captions never contain image prompts, crop instructions, or generation notes. Those live in your slot map.
- **No section divider slides**: use `.eyebrow` for section numbering rather than spending a whole sheet on a coloured title card.
- **No CJK parentheses**: replace `（...）` with `·` or a comma.
- **Each bullet fits one line**: trim until it does.
- **2×2 layouts use `table.t2x2`**, not CSS Grid — table rows share height naturally, grid does not guarantee it.
- **Pinned conclusions** use `.co` at the bottom of the sheet. The whitespace above a pinned callout is the design, not a sparse page.

## Before handing the deck back

The deck's definition of done is the document one (SKILL.md «Definition of
done») plus one thing this genre adds: run the ghost-deck test again on the
finished titles. Titles drift while slides get filled, and a deck that argued
cleanly in the outline can end up merely listing topics by the time it renders.
