# Distillation after a real task

Distillation means disciplined file updates. No model weights are trained.

## Always archive the trajectory

Save:

- every candidate, not only the winner;
- every real reject, preference, local flag, and acceptance;
- the final accepted piece;
- any user-authored before/after sentence pair.

A judgment without the text it judged cannot be reconstructed later. This has
already caused a lost experiment; do not repeat it.

## Per-task update

1. Append judgment events to `taste/prefs.log.jsonl`.
2. Copy candidates to `taste/examples/candidates/<task-id>/`.
3. Save the accepted version under `taste/examples/positive/`.
4. Save useful rejected versions under `taste/examples/negative/`.
5. Append user hand-edits to `taste/examples/swaps.jsonl`.
6. Update the content-type recipe so the next task starts closer to the
   accepted quality.
7. Update the profile's voice floor and strongest rejections.

Do not turn one session into a permanent universal rule. Mark new claims as
small-sample hypotheses.

## Offline reflect → validate → commit

For a deeper update:

1. **Gather** the full trajectory.
2. **Reflect** with at least two isolated families. Ask what sharper rubric and
   operational recipe would have reached the accepted version sooner.
3. **Validate** candidate updates against past verdicts. If fewer than two real
   verdicts exist, skip validation and keep the result explicitly tentative.
4. **Commit** a synthesis of the non-dominated updates.

The optional `workflows/distill.workflow.js` implements this shape in the
Claude Workflow runtime. Elsewhere, perform it manually with available isolated
families.

## Federation

Detailed artifacts stay in the content set. Only a concise cross-mode summary
of stable voice/rejection signals may be written to the normal Pneuma
preference layer.
