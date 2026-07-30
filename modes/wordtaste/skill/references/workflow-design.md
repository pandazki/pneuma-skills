# Two-level Chinese long-form loop

This workflow is deliberately narrow: non-structured Chinese knowledge
long-form. Do not generalize its calibrated defaults to every language and
genre.

## Why two levels

A whole-piece one-shot has no pause at which to notice that sentence length,
paragraph size, syntax, and emphasis are converging into a metronome. Splitting
too finely creates joins and cross-unit repetition that only a late rewrite can
repair.

Use:

- an **outer planning loop** with the whole argument in view;
- an **inner unit loop** that stops to write, check, and repair one coherent
  content unit.

## Outer loop

The outer loop never writes prose. It:

1. proposes a loose movement rather than a precise outline;
2. identifies the thesis and fragile qualifications;
3. groups natural sections into sequential writing units;
4. assigns each unit a function before length or rhythm, then derives different
   formal directions across units;
5. tracks used images/examples and the few strongest landing points;
6. decides when a place is hard enough to escalate or return to the user.

## Unit size

A unit is a control point, not a model-capacity chunk. The current observed
range is roughly 600–1200 Chinese characters, usually two or three nearby
natural sections. Short pieces use one unit; do not create a separate short-form
workflow.

The source tests have not found an output-length cliff at ordinary 3–4k Chinese
characters. Unit boundaries exist to create places for control, not because the
model cannot emit more text.

## Sequential, not parallel

Write units in order. Every unit sees finished prose before it and grows from
that text. This reduces joins and repeated images at the source.

The orchestrator must inline that finished prose and every required kernel or
source excerpt in the private prompt; never ask the leaf to open a workspace
path. Leaf adapters deliberately run in a clean cwd without tools, so a path
reference cannot preserve continuity.

After a unit lands, check at two distances:

- **near:** does it connect cleanly, and did it reuse an image, example, or
  explanation from the preceding prose?
- **far:** is the main line intact, are the strongest landings still sparse,
  are sentence/paragraph shapes becoming uniform again, and is every paragraph
  speaking at the same force? The places that bring the problem into focus or
  state the conclusion should stand out in form.

Repair the current unit before advancing. Do not reopen unrelated finished
units without evidence.

## Plan irregularity

"Write irregularly" is not actionable. Start with function before length:
establish background, bring the problem into focus, reason step by step, state
the conclusion, or close. Let form follow that job—background may stretch, a
problem may stand alone, reasoning may use longer sentences, and a conclusion
contracts and stops. Then assign length tendency, breathing, density, and
whether it carries a strongest landing. Make neighboring units change gear.
Bind those directions to content weight or the user's emphasis choices.

Directions are not scores. Do not ask a writer to hit exact numeric thresholds.

## Hard-place escalation

Escalate only where variance is worth its cost:

1. same family, fresh seed/context;
2. another family;
3. another reasoning setting;
4. another strategy or unit boundary.

Objective checks belong to an isolated judge. Subjective selection belongs to
the user. The orchestrator does neither.

## Terminal routing

The shipped workflow permits one repair and one recheck. A manual/local path
may make at most two repair/recheck cycles at the same place. More rounds do not
converge: they tend to move issues and accumulate checker-preferred hedging
until the prose itself feels generated.

The initial draft is attempt 0. The neutral leaf runner rejects a third repair
for a stable passage scope before dispatch, regardless of
whether the orchestrator calls that rewrite expansion, tightening, formatting,
completion, or polish.

After the limit:

- a factual or frozen-kernel error is `blocked`; do not deliver it as final and
  do not overwrite an existing source draft;
- subjective residue is `needs-review`; give the user a neutral choice and do
  not start another internal repair loop;
- a clean result is `done`.

## Human gates

Dynamic workflows cannot stop mid-call and wait for a person. Return at a
boundary, write `workflow.json`, and let the viewer collect the decision.

1. **Layout gate:** confirm claims and mark two or three strongest landings.
2. **Hard-choice gate:** choose among neutral alternatives for a hard place.
3. **Local tuning gate:** point at current text and request alternatives or
   supply a hand edit.

The gate must put the decision first and hide execution detail. Never dump
internal structured data into the UI.

## Structured check results

Use a tool-enforced schema when the runtime supports it. Do not parse free-form
model output as JSON. If enforcement is unavailable, switch to a checker that
can honor the format or degrade explicitly to one `quote + problem` pair per
line, and record the degradation under `.pneuma/`. Never silently treat
malformed output as a normal structured report.

A standalone status probe is a leak even when it prints only `clean` or
`issues`. `run_check_cycle.sh` consumes the private report, performs the
keep/repair action, and rechecks without announcing which branch ran.
`project_check_cycle.sh` then writes stable plain-language canonical state;
raw judge summaries and issue arrays are never copied into `workflow.json`.
Only canonical viewer state or a plain terminal blocker crosses the boundary.
The cycle rejects candidates outside `.pneuma/private/`, so a blocked
whole-piece repair cannot mutate `draft.md` before the terminal decision.

The shell command itself is also a visible artifact. Compose every writer,
checker, and repair prompt with the host's file-edit tool under
`.pneuma/private/`; never inline prompt text in a heredoc, `printf`, command
substitution, or shell pipeline. A visible leaf command carries only the
neutral role, private paths, optional stable scope, and redirections.

## Claude Workflow runtime

`workflows/writing.workflow.js` is an optional implementation for a real Claude
Workflow runtime. It relies on injected `agent()`, `phase()`, and resume/cache
semantics. Use it only when those capabilities actually exist and the user has
authorized large multi-agent orchestration.

Codex and Kimi do not inherit that runtime. Drive the same control shape
manually there.
