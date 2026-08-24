# Generation brief

Use this reference when dispatching an isolated writer.

## The prompt is composed, not written

You no longer write a brief. A writer transcribes what it is given, so every
sentence of a hand-written brief is a style sample the article will copy — and
an orchestrator's Chinese is the worst Chinese in the prompt. The scripts write
the prompt instead:

```bash
bun <SKILL_DIR>/scripts/compose_unit_parts.ts workflow.json u2 .pneuma/private/u2
bun <SKILL_DIR>/scripts/compose_leaf_prompt.ts .pneuma/private/u2 .pneuma/private/u2/prompt.md
bun <SKILL_DIR>/scripts/run_leaf.ts writer .pneuma/private/u2/prompt.md > .pneuma/private/u2/candidate.md
```

The first command reads the plan stored under `layout.plan` and fills the parts
directory: an English `brief.en.md` built from the unit's role, its `notes_en`,
its pace and ending and its target length; a `material.md` sliced by code out
of the unit's own spans; a `kernel.md` of the sentences whose meaning must
survive; a `preceding.md` when the draft is not empty; and one English line in
`constraints.en.md`. The second wraps them in English scaffolding that is
identical on every run — and writes two files, not one. `prompt.md` is the
task message; `system.en.md` beside it is the writer's standing charter, which
says once, task-independently, who the writer is, why its prompt is built out
of human Chinese, and how to treat each block the task message carries.
Nothing in that chain asks you for a Chinese sentence.

The charter has two postures, selected by the stored workflow's `entry`.
Rewriting (`draft`, the default) makes the material the only source of facts:
the writer adds nothing. Creation (`idea`) hands the writer the author's
outline and interview notes as a binding anchor: every named fact, number, and
judgment in them survives exactly, the development — reasoning, transitions,
examples — is the writer's to do, and no factual claim the material does not
support may enter. `compose_unit_parts.ts` reads the entry out of
`workflow.json` and writes it as a small `entry` part beside the prose parts;
the task message is identical on both entries. The checker does not change:
its meaning check binds the plan's `must_keep` sentences and what the material
itself asserts, and a passage the writer developed has no material assertion
to lose — creation needed a different charter, not a different judge.

`run_leaf.ts` finds the charter on its own and sends it through the strongest
channel the route has: a real system message on the hosted route;
`--system-prompt-file` on the Claude CLI, which deliberately replaces that
CLI's own default system prompt — the fallback writer reads the charter, not a
coding agent's preamble; and on Codex, which has no system channel, the
charter prepended above the one message, the documented degradation. Checker
and planner prompts stay single-message on purpose: their primary family is
Codex, and their prompts work as measured.

The order the scaffolding puts the task message in is fixed and is not yours
to arrange: it begins at the brief, then material, frozen sentences, the
section under repair and its problems when there are any, reference prose, the
user's voice, the constraints — and last of all `preceding.md`, under
`<preceding_prose>`, with the closing line of the prompt telling the writer to
continue directly from where that text stops. Each block sits under a short
label; its treatment rule lives in the charter, said once. The finished prose
ends the prompt because continuation is the first thing a writer does and it
picks up the momentum of whatever it read last. A first unit has no draft
behind it and its prompt ends on the constraints, exactly as it always did.
A composed repair inherits the same order: the unit's own `preceding.md` is
cloned into the repair parts, so a repairer also finishes on the text it is
continuing — and its charter gains the repair rule, because the repair blocks
are present.

What the plan still owes the writer is the reasoning a script cannot infer, and
that lives in `notes_en`, in English: what this unit has to achieve, what the
section before it already spent, what to leave alone. Function comes before
length or rhythm — the plan assigns the role first, and pace, ending and length
follow from it.

Voice anchors, the human side of stored swaps, the content-type recipe under
`taste/recipes/`, and the evidence-backed defaults in
[preset-default.md](preset-default.md) remain your judgment calls. Where one of
them changes what this unit must do, it belongs in the plan; the composer will
carry it through.

## Positive before negative

Tell the writer what to make. Do not make the standing brief a wall of bans.
The source experiment repeatedly found that suppressed patterns migrate:
remove a neat metaphor and the same closure impulse may reappear as a polished
definition or uniformly sized paragraphs.

A negative list is permitted only as a one-use surgical list from the
immediately previous draft. Every item must quote the exact problem sentence
and describe the desired correction. Discard it after that repair.

## Isolation

- Do not pass orchestration discussion or aesthetic opinions into a writer.
- Start a fresh context for every family/seed change.
- Do not pass user preference discussion, judge commentary, model names, or
  previous rankings.
- Passing the accepted source text and the finished prose before the current
  unit is required. Isolation protects aesthetic provenance, not continuity.
- Inline the full required contents in the private prompt: goal, kernel, source
  material, preceding prose, issue evidence, and output contract. The leaf runs
  in a clean cwd without tools; a workspace path is not a substitute for its
  contents.
- Let the composer build that private prompt under `.pneuma/private/`. Never
  build one with a heredoc, `printf`, inline string, or shell pipeline:
  terminal commands are user-visible even when their stdout is redirected. The
  compose and `run_leaf.ts` commands carry paths and a neutral role only, so
  they are safe to run in the open.
- The writer's final response is prose only.
- For the manual path, resolve `<SKILL_DIR>` as the directory containing the
  parent `SKILL.md`, then compose the parts and the prompt and invoke
  `bun <SKILL_DIR>/scripts/run_leaf.ts writer <promptfile>` for the initial prose,
  redirecting stdout into a private candidate. Run every objective check loop
  through
  `bun <SKILL_DIR>/scripts/run_check_cycle.ts <candidate> <check-brief> <scope> <result> <parts-dir>`
  and immediately through the matching silent `project_check_cycle.ts`
  projection. `<parts-dir>` is the unit's own parts directory, and passing it is
  what keeps a repair framed as writing: the repairer reads the brief, material
  and frozen sentences the unit was written from, its own text under
  `<current_text>`, and the problems under `<issues>`. A whole-piece cycle has
  no parts directory and leaves the argument off. The cycle privately invokes checker/repair roles and carries raw
  issue evidence between them. Never invoke or inspect the private adapters
  from a task.
- Candidate, check brief, and sanitized result all live under
  `.pneuma/private/`. For a whole-piece check, copy `draft.md` to a private
  candidate first. Never let a repair cycle mutate `draft.md` in place; only
  the projector may copy an accepted private candidate back.
- Treat prompt, response, and log files as private orchestration state. Validate
  them quietly, then transform them directly into the next canonical file.
  Never print fields first or dump a complete staging file or log into a
  user-visible tool result.
- Treat check classification the same way. Do not echo `clean`, `issues`, or
  any status synonym; `run_check_cycle.ts` consumes the private report and
  applies the keep/repair branch before the next check.

## Current adapter posture

The neutral router owns availability, primary generation, and independent
cross-check routing. Do not copy its private routing table into a prompt or
visible task state. The order is empirical but confounded by effort and length;
it is a starting posture, not a permanent ranking.

## Output formatting

Use simple, traditional text. Sections and headings are normal when the article
needs them, especially in long-form work. Avoid using bold, italic, or
list-shaped argument inside a paragraph as a shortcut for actual emphasis:
those are easy model habits that displace sentence order, pauses, and
independent paragraphs. Formatting should appear only when it helps the reader.

Return prose only. The response is consumed verbatim as a candidate, so a
preface, explanation, or afterword can leak into what the user reads.

The initial draft is attempt 0. Every post-check rewrite is a repair cycle,
including one described as expansion, tightening, formatting, completion, or
polish. Use one stable scope for the same passage. After two repair calls, route
the remaining factual/kernel failure to `blocked` or the subjective residue to
`needs-review`; do not invent a new label to buy another generation.
