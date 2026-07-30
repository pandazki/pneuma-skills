# Default preset — Chinese long-form

These defaults come from comparisons between a small set of human Chinese
long-form pieces and unconstrained model outputs. They are directional, not
universal laws.

Statistics screen candidate constraints. They do not override human judgment.
However, if the model already uses a feature *less* than the human baseline,
banning that feature moves in the wrong direction.

## Included

### Use far fewer semicolons

The measured model output used roughly 4.9 semicolons per thousand Chinese
characters. Human samples ranged from 0 to 1.4, with a median near 0.3. Most
semicolons should become sentence breaks or comma-linked clauses.

### Avoid polished "not X, but Y" reductions

The human median was zero; the model used roughly 1.35 per thousand
characters. Softer forms such as "only X", "nothing more than X", and "X
merely..." often carry the same reduction. At most one in the whole piece, and
never as the ending.

### Vary sentence breathing

Observed sentence-length standard deviation was about 13.7 for model output
and 16.7–28.1 for human text. Avoid three consecutive sentences in the same
length band.

### Vary paragraph size

Observed paragraph-length variation was about 0.35 for model output and
0.57–0.76 for human text. A very short paragraph may sit beside a long one.
Avoid uniform "three sentences per paragraph" pacing.

## Explicitly excluded

Do not ban these globally:

- em dashes — humans in the sample used them more than the model;
- parenthetical insertions — humans used them more;
- explicit transitions such as "however", "therefore", "first", and
  "in summary" — the model was not over the human range.

Also exclude one-sentence-paragraph ratio because the result flipped with the
sample, and exclude pronoun/address rules because they are genre-dependent.

## Limits

- The human baseline contains only about 11–14 clearly usable articles.
- The model side is one family and one prompt style.
- Only Chinese essays/knowledge long-form are covered.

Treat every number as direction, not threshold. Recalculate when the corpus
grows.
