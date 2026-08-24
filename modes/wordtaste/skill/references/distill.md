# Distilling a finished task

Distillation here means disciplined file updates. No model weights are trained,
and nothing about the next task is guessed at: everything written below is
written because a real judgment in a real session demonstrated it.

## Always archive the trajectory

Save:

- every candidate, not only the winner;
- every real rejection, preference, local flag, and acceptance;
- the final accepted piece;
- every before/after pair the user typed with their own hands.

A judgment without the text it judged cannot be reconstructed later. That has
already cost one experiment; do not repeat it.

## Per-task update

1. Archive the candidates under `taste/examples/candidates/<task-id>/`.
2. Append each real decision to `taste/prefs.log.jsonl`.
3. Save the accepted piece as a `.md` file under `taste/examples/positive/`.
4. Save a rejected version under `taste/examples/negative/` when it is useful —
   when it shows what the accepted one avoided.
5. Append the user's hand edits to `taste/examples/swaps.jsonl`, one JSON object
   per line with a `before` and an `after`.
6. Update the content-type recipe under `taste/recipes/` so the next task starts
   closer to the quality this one ended at.
7. Write or refresh `taste/style.en.md` — see below.

Do not turn one session into a permanent universal rule. A new claim is a
small-sample hypothesis and should be written as one.

## `taste/style.en.md`

This is the distilled record of how the person writes, and it is the one taste
artifact a writer reads directly: `voice_sample.ts` samples it and
`compose_leaf_prompt.ts` puts it in the `<user_voice>` block, the last of the
style inputs in every writer prompt — after the reference prose it may
override, and before the constraints. So its shape is fixed.

- **Five to ten lines, one directive per line.** An imperative a writer can act
  on, not a description of the person. "Open on the concrete case, never on a
  definition" is a directive; "writes concretely" is not.
- **Every line is grounded in a real judgment** from a real session: a choice
  the user made between candidates, a version they rejected, a sentence they
  fixed by hand. No line without evidence. If you cannot name what a directive
  came from, it does not go in the file.
- **Name the evidence in an HTML comment after the line** — `<!-- evidence: swap
  2026-08-24#3 -->`, `<!-- evidence: rejected candidate B -->`. The comment is
  the audit trail for the next distillation; the sampler strips it, so a writer
  never sees it.
- **English.** The lines are yours to write and yours are English, which is why
  they are safe to compose. The one exception is a short quoted fragment inside
  a directive when the point is a specific tic — `never open with "值得注意的是"`
  — and that quote comes out of the user's own text, at most a handful of
  characters. Everything else Chinese in the block is verbatim: their hand edits
  and a window of writing they accepted, sampled straight out of
  `taste/examples/`.
- **Drop a directive when a later session contradicts it.** A file that only
  ever grows stops describing anyone. Rewriting it whole each time, from the
  evidence that still stands, is the point.

Both content-set seeds ship this file with a comment header and no directives.
That is the honest starting state, and the sampler treats it as empty.

## Reflect → validate → commit

For a deeper update than the per-task one:

1. **Gather** the full trajectory.
2. **Reflect** with at least two isolated families. Ask what sharper rubric and
   what more operational recipe would have reached the accepted version sooner.
3. **Validate** the candidate updates against past verdicts: a candidate that
   mispredicts judgments the user has already made is a clever answer to the
   wrong question. With fewer than two real verdicts, skip this step and keep
   the result explicitly tentative.
4. **Commit** a synthesis of the candidates that survived.

`workflows/distill.workflow.js` runs this shape under the Claude Workflow
runtime and returns the artifacts as data — including the rewritten
`style.en.md` — for the agent to write. `taste/` is agent-owned; nothing else
writes into it. Where that runtime does not exist, perform the same four steps
by hand with the isolated families that are available.

## Federation

Detailed artifacts stay in the content set. Only a concise cross-mode summary of
stable voice and rejection signals may be written to the normal Pneuma
preference layer.
