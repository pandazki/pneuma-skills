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

The loop has two entries, and they ask opposite things of a writer. From
draft, the material is finished prose and the writer's charter forbids adding
anything: the material is the only source of facts. From idea, the material is
the author's outline plus `materials/notes.md` — the interview record of their
own chat answers, copied verbatim — and the charter expects development while
keeping every fact and judgment in the material binding and refusing any
factual claim it does not support. The checker is the same on both entries:
its meaning check binds the plan's `must_keep` sentences and the material's
own assertions, and prose the writer developed has no material assertion to
lose — creation needs a different charter, not a different judge.

## Outer loop

The outer loop never writes prose, and since 0.6.0 it does not write the plan
either: a planner returns JSON against `references/plan-schema.json`,
`validate_plan.ts` refuses any plan whose Chinese is not a literal quote of the
human input, and `project_plan.ts` turns the accepted plan into the layout the
viewer shows. What the loop still owns is the judgment below — the plan is the
place where it is written down.

The outer loop:

1. proposes a loose movement rather than a precise outline;
2. identifies the thesis and fragile qualifications;
3. groups natural sections into sequential writing units;
4. assigns each unit a function before length or rhythm, then derives different
   formal directions across units;
5. tracks used images/examples and the few strongest landing points.

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

On the writing path those inputs are files in a parts directory —
`preceding.md` for the finished prose, `material.md` for the source, both
copied by code — and `compose_leaf_prompt.ts` assembles them into the prompt
untouched. Copy, never paraphrase: an orchestrator that restates the source is
the text the reader ends up reading. The composer puts `preceding.md` last of
everything, past the constraints, and closes the prompt by telling the writer
to continue directly from where that text stops — the unit begins as a
continuation rather than as a fresh start.

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

## When the user turns the candidates down

Do not produce a graded series of settings. On `reject-candidates`, write one
more version that differs in kind rather than in degree — a different opening
move, a different sentence economy — and put it beside the one that was turned
down. Two versions that differ in kind are a choice; four that differ by a notch
each are a survey, and a survey is work the user did not ask for.

Objective checks belong to an isolated judge. Subjective selection belongs to
the user. The orchestrator does neither.

## Terminal routing

The shipped workflow permits one repair and one recheck. A manual/local path
may make at most two repair/recheck cycles at the same place. More rounds do not
converge: they tend to move issues and accumulate checker-preferred hedging
until the prose itself feels generated.

A repair is started only by lost meaning — `kernelOk` false or an issue of
kind `meaning`. Style findings are advisory: counted, surfaced to the user as
suggestions, never repaired. The repair loop is where checker-preferred prose
creeps in, and a style judgment is exactly the kind of call the user makes
better than a judge.

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
`issues`. `run_check_cycle.ts` consumes the private report, performs the
keep/repair action, and rechecks without announcing which branch ran.
`project_check_cycle.ts` then writes stable plain-language canonical state;
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

It composes what the scripts compose. Every English sentence in every prompt it
sends — the planner's rules, one unit's brief, the writer's charter and task
message, the judge's rubric — is read from
`references/prompt-scaffolding.en.json`, the same file
`compose_plan_prompt.ts`, `compose_unit_parts.ts`, `compose_leaf_prompt.ts` and
`compose_check_brief.ts` read. The workflow carries an embedded copy because a
workflow script is a pure coordinator with no filesystem. That copy is
generated, never hand-synced: `bun <SKILL_DIR>/scripts/generate_workflow_regions.ts`
rewrites the scaffolding, the plan schema, and the assembler region from
`scripts/lib/prompt-assembly.ts` and the two JSON files, a test regenerates and
diffs (`--check`), and a second test runs each composer and the workflow's own
assembler over the same inputs and compares the bytes. Change a sentence in one
place and both paths change together, or the tests refuse the change.

The system/user split holds here too, degraded: the script path writes the
writer's standing charter as `system.en.md` and `run_leaf.ts` carries it
through a real system channel where one exists, but `agent()` has no system
channel, so the workflow prepends the same charter above each writer and
repair prompt — the same degradation, and the same bytes, as the script path's
codex adapter. Checker prompts get no charter on either path.

**The orchestrator inlines every input.** The script cannot open a path, so
`args` carries the contents:

| `args` | What it is |
|---|---|
| `goal` | The user's goal in the user's own words — the `goal.md` of the manual path, copied, not restated |
| `material` | The source text. A string, or an object keyed by the path a plan span names when the plan spans several files |
| `entry` | Optional. The stored workflow's entry: exactly `idea` gives every writer and repairer the creation charter — the `entry` part file of the manual path |
| `voice` | Optional. A sample of the voice the essay sits in |
| `plan` | Optional. An already-planned plan; the Shape phase then runs no planner |
| `approved` | The user cleared the layout gate |
| `draft` | Optional. Prose finished before this run; it becomes the first unit's preceding prose |
| `unitIds` | Optional. Write only these units |
| `referenceProse` | Optional. Passages from `primer_sample.ts` |
| `voiceStyle` | Optional. The contents of `voice_style.en.md` — the distilled English directives |
| `voiceExamples` | Optional. The contents of `voice_examples.md` — the user's own Chinese |
| `emphasis` | Optional. Carried, never composed into a prompt — no more than `compose_unit_parts.ts` composes it |

Three things the workflow cannot do for itself, all of which stay with the
manual path:

- **Priming.** `primer_sample.ts` reads a library from disk. Pass its output as
  `referenceProse` to get the same `<reference_prose>` block a composed prompt
  carries; without it the block is omitted and the return says `primed: false`.
- **Sampling the user's voice.** `voice_sample.ts` reads `<content-set>/taste/`
  and draws from a seed, which the runtime cannot do either. Run it first and
  inline the two files it writes as `voiceStyle` and `voiceExamples`; give both,
  one, or neither, and the `<user_voice>` block appears exactly as it does on
  the script path.
- **Family routing.** `run_leaf.ts` privately picks the route that writes and a
  different family that checks. The workflow's leaves are all the host's own
  model, so its check is not a fresh-family check. Run a place that needs one
  through the manual path instead.

The plan is guarded in the workflow the same way `validate_plan.ts` guards it —
title, claims and kept sentences are literal quotes of the inlined input,
`notes_en` is English, spans resolve — including a plan handed in through
`args.plan`. A refused plan is re-asked once with the failing check named; a
second refusal returns at `intake` and the user hears one plain sentence.
