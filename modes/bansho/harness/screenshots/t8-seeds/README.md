# T8 English seeds — G7 visual verification artifacts

Shot against the real viewer through the **real seed-apply path** — the only
one that counts as evidence here (see the warning at the top of
`../t5-seeds/README.md`): an empty scratch workspace,
`bun bin/pneuma.ts bansho --dev --viewing --no-open --workspace <scratch>`,
then `POST /api/seeds/apply {"sourceKey":"modes/bansho/seed/<id>/"}`. The
seed lands in `<id>/` as a content set and the board performs. Nothing was
pre-copied; nothing but the transport and the theme was touched.
1440×1000 viewport, chrome-devtools screenshots. Timestamps are the
transport clock in each frame.

The Chinese half of the 双语 × 双主题 matrix is `../t5-seeds/` frames
`13`–`17`; this directory is the English half.

| File | Proves |
|------|--------|
| `00-tech-en-live-mid.png` | **The English board performs, it does not appear.** Caught at 14.4 s / 118.1 s with the transport LIVE, the pen part-way through a sentence (`…when it stops being true` — the period is not written yet). Handwriting stack live (Bradley Hand), script pane tracking the line being written. Shot on the first cut of the board, before the ink rewording below; what it evidences — streaming, not joining at the tip — is untouched by that edit. |
| `01-tech-en-light-end.png` | **tech-en × light**, end state (116.9 s). Both curves on one chart with the `peak` mark and right-anchored series labels (G8-C), the `((serial fraction))` / `((coherence cost))` circles, the `==…==` marker band, the hand-drawn heading rules, the closing rule and aside. **Re-shot** — see "What the first cut of this frame really showed" below. |
| `02-tech-en-dark-end.png` | **tech-en × dark**, end state. Chalkboard surface, chalk ink, the same marks under the dark `--hand` stack (Chalkboard SE first). The board was rebuilt (seed re-applied after a byte edit) while dark was already active, so its overlays were measured against the dark metrics. tech-en's bytes are unchanged by the amendment, so this one still stands. |
| `03-pitch-en-light-end.png` | **pitch-en × light**, end state (90.2 s). 对比 chart (Monthly flat, Daily falling) with the `24 min` mark. **Re-shot** after the board learned to write `0 min` / `Daily release 24 min` instead of `0min` / `24min`, to declare `(month)` where it used to declare the year, and to circle `without a meeting`. |
| `04-pitch-en-dark-end.png` | **pitch-en × dark**, end state — and the proof of the viewer fix below: this is `03`'s board, still mounted, after the user flipped the theme to dark. Text re-flowed into the dark face and every mark re-measured onto its words. Before the fix the same flip left the closing circle around the paragraph's first two words and a stray arc on the heading rule. |

## Two things the English boards taught us

Both were found by shooting these frames. Both are **authoring** rules,
and both now live where an agent actually reads them —
`skill/references/board-language.md` and `skill/references/charts.md` —
with `skill.test.ts` pinning that they stay written down and
`seeds.test.ts` pinning that the 范文 keeps obeying them. This section is
the story; the skill is the instruction.

1. **A circle is drawn around a phrase, so it lands on whatever sits
   beside the phrase.** In CJK the neighbouring glyph is a full em wide and
   the arc's tip stops inside its side bearing; in Latin text the next word
   starts a ~4 px space away, so the tip lands on letters. The first cut of
   tech-en circled `the serial fraction` and `the coherence cost` — long
   enough to wrap, so the pen drew a lone arc around a stranded `the` at a
   line end. **Rule for English: circle two or three short words, never a
   clause.** pitch-en was brought under the same rule in the amendment
   (`an outage for ((one tenth))`, `@circle "without a meeting"`).
2. **What an axis measures is written glued to the number** (`24` +
   `minutes`), which is right for `24分钟` and wrong for `24minutes`. Pick
   something that reads glued (`(×)`, `(%)`) — or write the separator into
   the parentheses: `( min)` renders `0 min` / `Daily release 24 min`.
   pitch-en shipped `(min)` and read `0min` / `24min`; it now reads
   correctly, and `domain.test.ts` pins that the parser keeps that space.

## What the first cut of this frame really showed

`01` originally had three marks on the wrong words: the circle for
`((serial fraction))` enclosed `l fraction; the`, the one for
`((coherence cost))` enclosed `e cost; and the`, and the marker band
started two words late and overran the sentence. That was read here as an
authoring residual. It was not: the identical bytes render correctly on
`02`, and the re-shot `01` — same bytes, board built under light through
the same seed-apply path — has all five marks on their targets. The
displacement was the measurement bug below, caught in the act.

## The finding that was out of T8's scope, and is now fixed

**Switching the app theme after a board is built left its ink overlays
measured against the old font metrics.** The light and dark stacks are
different faces, so the text re-flowed underneath overlays that never
re-measured: the closing circle ended up around `Not the` at a
paragraph's head, with a stray arc floating on the heading rule.
Re-applying the identical seed did not fix it (same bytes → reconcile
no-op) — which is exactly why adding `theme` to a dependency array would
not have either.

`BoardCanvas.tsx` now invalidates every measured cache on a theme change,
the same way it already did on a width change
(`invalidateMeasurements`). `__tests__/theme-remeasure.test.tsx` mounts
the canvas and asserts every step node is rebuilt across the flip (it
fails without the fix), `04` is the visual proof on the real board, and
the trap itself is written into `.claude/rules/frontend.md` so the next
person who measures something in a viewer meets it.

## Route check

The four cards' thumbnails were fetched over the route the gallery uses,
on a fresh session: `GET /api/mode/seed-gallery/<id>.png` → `200 image/png`
for `tech-zh`, `pitch-zh`, `tech-en`, `pitch-en`. `GET /api/seeds/list`
returns the four declared cards with their localized copy resolved.
