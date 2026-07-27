# Generation brief

Use this reference when dispatching an isolated writer.

## Brief order

1. **Concrete goal** — what the piece must accomplish, for whom, and where it
   will be published.
2. **Frozen kernel** — claims, facts, and qualified statements that must
   survive. Mark fragile qualifications and name the failure mode.
3. **This unit's function and job** — whether it establishes background,
   brings the problem into focus, reasons step by step, states the conclusion,
   or closes; then where it enters, what it changes, and where it leaves the
   reader. Function comes before length or rhythm.
4. **Finished prose before it** — required for sequential writing. Ask the
   writer not to repeat images, examples, or explanations already used.
5. **Rhythm direction** — dense/loose, short/long-breathing, and whether this is
   one of the few strongest landing points. Derive these from function:
   background may stretch, a problem may stand alone, reasoning may use longer
   sentences, and a conclusion contracts and stops. These are directions, not
   metrics.
6. **Positive human material** — voice anchors and the human side of stored
   swaps. Learn posture, breathing, and syntax; do not copy subject matter.
7. **Content-type recipe** — if one exists under `taste/recipes/`.
8. **Evidence-backed default preset** — load
   [preset-default.md](preset-default.md) for Chinese long-form.

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
- Create that private prompt with the host's file-edit tool under
  `.pneuma/private/`. Never build it with a heredoc, `printf`, inline string, or
  shell pipeline: terminal commands are user-visible even when their stdout is
  redirected. The later `run_leaf.sh` command contains paths and the neutral
  role only.
- The writer's final response is prose only.
- For the manual path, resolve `<SKILL_DIR>` as the directory containing the
  parent `SKILL.md`, then invoke
  `<SKILL_DIR>/scripts/run_leaf.sh writer <promptfile>` for the initial prose,
  redirecting stdout into a private candidate. Run every objective check loop
  through
  `<SKILL_DIR>/scripts/run_check_cycle.sh <candidate> <check-brief> <scope> <result>`
  and immediately through the matching silent `project_check_cycle.sh`
  projection. The cycle privately invokes checker/repair roles and carries raw
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
  any status synonym; `run_check_cycle.sh` consumes the private report and
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
