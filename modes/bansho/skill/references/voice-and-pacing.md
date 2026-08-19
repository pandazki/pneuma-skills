# Voice & pacing — writing like a lecturer

The board performs your text at the speed a hand writes it. That single
fact decides the voice: everything you write will be watched appearing,
not skimmed. Prose that works in a document — long qualified sentences,
three ideas per paragraph — plays as a wall of slowly-arriving text.

## The voice

- **Short sentences.** One clause lands, its pause lands, the next clause
  starts. A 60-character Chinese sentence with no punctuation plays
  breathless — the board reveals CJK a character or two at a time, so the
  commas are where the audience (and the writing hand) breathe.
- **One idea per paragraph.** A paragraph is one step; the pause after it
  is the audience's chance to absorb. Two ideas in one block means the
  first never gets its silence.
- **Speak, don't document.** 「先看英伟达——每个季度都在加速」 is lecture
  speech; "The following chart shows NVIDIA's quarterly figures" is a
  caption. Write the former: address the audience, promise what comes
  next, react to what just appeared.
- **Concrete numbers over adjectives.** The board can circle `((35.6B))`;
  it cannot circle "significant growth".
- **Write in the user's language.** The board is theirs; match the
  language they asked in unless told otherwise.

## Punctuation sets the pauses

There is a ladder, and it is your whole timing instrument:

| Mark | Weight |
|---|---|
| comma / 、 | a breath |
| period / 。/ ？/ ！ | a fuller one |
| paragraph break | fuller still |
| `##` heading | a long one — the page turns |
| `---` | the longest — the movement closes |

You never write time; you write punctuation, and the time falls out. When
a passage feels too fast, the fix is a period where a comma was, or a
paragraph split — not `@wait`.

## Sections

Open a `##` when the argument turns, not by word count. A heading is a
promise ("now we deal with the objection"), and the board gives it a
hand-drawn underline and a long breath — spend that pause on real turns.
Three to five sections is a typical lecture; a section with one paragraph
in it is usually a paragraph, not a section.

## Structure is the tempo lever

When the play feels wrong, rearrange — do not decorate:

- Feels rushed → split the paragraph; give the key sentence its own
  block; move the chart layer behind its own sentence.
- Feels draggy → merge narration; cut the aside; one fewer series.
- A genuine dramatic silence → `@wait` (the one escape valve; more than
  two or three per lecture means the structure needs the fix).

## Live rhythm — writing while the board plays

Every save streams onto the user's board. The write granularity IS the
performance:

1. **Append one or two steps per edit.** The board plays them while you
   compose the next. Dumping a full lecture in one write compresses a
   live talk into a wall poster — technically correct, dead on arrival.
2. **Let evidence land with its sentence.** Write the claim + its chart
   layer in one edit, so the pen goes claim → curve without a stall.
3. **After a batch, `check-board`.** Warnings (`stepParseError`,
   `refUnresolved`, `boardOverflow`) also arrive on their own — treat
   each as a to-do with an address, fix it in `board.md`, and the board
   quietly clears it.
4. **After a correction, `navigate-to`** the fixed step — put the user's
   eyes on what changed instead of making them hunt.
5. **Keep lines inside the board.** Very long unbroken tokens (URLs,
   identifiers) can run past the right edge; the board cuts them off and
   warns (`boardOverflow`), quoting the token and how far over it runs.
   Break the line or shorten the token. The board's own marks (`@strike`,
   `@circle` and friends) bleed past a step's box by design and never
   trip this warning — when it fires, something the reader should see
   really is cut off.

## Answering the three buttons

The user's requests arrive with the exact step they were pointing at:

- **Continue from here** — go deeper from that step: an example, the next
  consequence, the question it raises. Append after the current end;
  reference the step they pointed at in your first new sentence.
- **Say this part again** — they lost the thread. Re-explain in smaller
  steps with plainer words, as new appended content (the original stays —
  the board does not forget). Repeating the same sentences is not an
  answer; smaller steps are.
- **Explain it differently** — the words landed but the idea did not.
  Change the route: a concrete example instead of the abstraction, a
  comparison, the tiny case first. New content, new approach — not a
  paraphrase.
