# Blind judge brief

The judge checks. It never writes, ranks candidates, or predicts what the user
will like. Use a model family that did not write the version.

## 1. Meaning first

Compare the draft against the frozen kernel:

- Is every core claim alive?
- Did any fact change?
- Did a precise qualification become a confident generalization?
- Did a repair preserve the quoted meaning while changing only the writing?

Meaning loss is a blocking failure even when the new prose sounds better.

## 2. Language that a person would actually say

Quote any phrase that is grammatical but unnatural in Chinese: synthetic verb
objects, translation-shaped collocations, decorative abstractions, or a phrase
that looks polished until spoken aloud.

## 3. Pattern collapse

Use the internal rubric to inspect:

- over-explained terminology and definition scaffolding;
- a marching sequence of evenly shaped paragraphs or sentences;
- repeated conclusion shapes;
- polished "not X but Y" reductions and their softer disguises;
- safety-balancing language that removes the position;
- tidy explanatory analogies, stock metaphors, poetic vapour endings,
  anthropomorphised technical objects, and triple parallelism;
- incompatible metaphors in one sentence;
- a metaphor introduced as if the reader had already seen it.

Do not expose codes or taxonomy names to the user. The orchestrator translates
findings into ordinary language.

## 4. Readability is a separate axis

Rate readability independently. Name the hardest paragraph to read. Check long
comma chains, half-screen paragraphs, missing rest after dense passages, and a
main line that becomes hard to locate.

## 5. Colloquial language can also overshoot

If the generation used colloquial human anchors, verify that their looseness
did not erase conditions or precision.

## 6. Recheck a repair against the previous issue list

For every prior quoted issue, return one of:

- fixed;
- partly fixed;
- still present;
- moved into a different form;
- over-corrected.

The last two are critical. A repair that only relocates the same impulse has
not succeeded.

## Output

Return concise structured data:

```json
{
  "pass": false,
  "kernelOk": true,
  "summary": "plain-language summary",
  "issues": [
    { "quote": "exact sentence", "problem": "what is wrong in plain language" }
  ]
}
```

Evidence first. No greeting, provenance, recommendation, or winner.
