# WordTaste v0.3 — upstream method alignment

> Source of truth: `/Users/pandazki/Codes/palate` at `786c579` (2026-07-28).
> v0.2 performed the product reset. v0.3 carries forward the method
> clarifications and terminal behavior added by upstream commits
> `984a267..786c579`.

## Purpose and conflict rule

WordTaste exists to give the user a Chinese draft they accept and can keep
reading without immediately feeling model-made, while accumulating each real
judgment into a taste record so the next task requires less effort. Every rule
below is a means to that end. When two rules appear to conflict, return to this
purpose rather than optimizing the machinery.

## Method kernel

The upstream repository mixes product method with research instruments. The
following six invariants must survive any product adaptation:

1. freeze and reinject meaning, facts, and fragile qualifications;
2. isolate writers and judges; the orchestrator neither writes nor judges;
3. check at two scales—near joins and far global shape;
4. let a different model family check the writer's work;
5. ask for the cheapest useful human signal: choose or point, not an essay;
6. archive candidates together with verdicts so taste compounds.

Rung numbers, symptom numbers, ablations, and measurement scripts are research
instruments. They are not required product surfaces. Rungs, symptom labels,
model provenance, and word counts must never enter a user's judgment.

## Three-direction no-leak boundary

Isolation is incomplete unless all three directions hold:

1. orchestration discussion and aesthetic opinions do not enter a writer;
2. family identity, generation order, token counts, and word counts do not
   enter user judgment;
3. prompts, raw judge output, complete logs, and intermediate artifacts do not
   enter the user interface through chat, terminal output, or expandable logs.

Even a one-word `clean` / `issues` result is private check state. The
orchestrator consumes it inside the same silent branch that keeps or repairs
the candidate; it never performs a visible status probe.

The shell command itself is a visible artifact. Private prompts are created
under `.pneuma/private/` through a file-edit surface whose result card exposes
the path but not the contents, never by embedding prompt text in a heredoc,
`printf`, inline string, or prompt-building pipeline. A visible leaf command
contains a neutral role and private paths only.

The raw check/repair exchange is executable, not left to prompt discipline:
`run_check_cycle.sh` keeps candidate, report, and repair prompt private, while
`project_check_cycle.sh` writes only a stable accepted/blocked/choice
projection. Raw judge summaries and issue arrays are never copied into
`workflow.json`. The cycle refuses candidates outside `.pneuma/private/`;
whole-piece work starts from a private copy, so blocked repair cannot mutate
`draft.md`.

Leaf Claude Code and Codex processes therefore start in neutral temporary
directories, receive only an explicit prompt file, write results directly to
private staging, and terminate with their wrapper. The orchestrator calls them
through a neutral writer/checker router, so family names and CLI transcripts do
not appear in command cards. It validates and projects private results without
printing their fields. The viewer consumes only the compact `workflow.json`
projection and neutral candidate files.

That clean cwd has no workspace access. Continuity survives only when the
orchestrator inlines the required goal, kernel, source excerpts, preceding
prose, and output contract into the private prompt. Passing a workspace path
would preserve isolation by destroying continuity: the leaf has no tools and
the path is inert text.

## Why the reset

The first Pneuma implementation turned the experimental machinery into the
product surface: a three-zone studio, a user-operated disruption dial,
block-freeze controls, symptom codes, model-family status, and a dense taste
dashboard.

The upgraded source project invalidates that product shape:

- the disruption level is internal control state, not a user preference;
- the user should not diagnose symptom categories;
- judge terminology must be translated into ordinary language;
- cross-family variance is expensive and belongs only on hard passages;
- the core workflow is now a two-level sequential loop;
- the user enters at three explicit boundaries, not continuously through a
  control panel;
- only Chinese knowledge essays/long-form are seriously calibrated;
- the source no longer distributes a public worked example.

The reset keeps the useful Pneuma primitives—files as canonical state, a live
viewer, direct selection, viewer notifications, and content sets—but replaces
the interaction model.

## Product sentence

WordTaste is a human-guided Chinese long-form writing loop: the system shapes
and writes; the user approves the argument, chooses by feel at hard places, and
points at the one line that still misses.

## Operating scene

A person is reading a serious Chinese draft on a laptop, usually in a
low-distraction work session. They want the tool to disappear into the writing
and surface only the decisions no automated judge can make. This forces a
restrained dark product shell, a dedicated reading surface, and very little
decorative motion.

## The two-level loop

### Outer loop

The orchestrator sees the whole:

1. receive a concrete goal;
2. extract the semantic kernel and fragile qualifications;
3. propose a loose movement and individually addressable thesis;
4. group content into sequential units;
5. assign each unit a functional role, then derive rhythm and sparse emphasis
   from that role;
6. identify hard places and decide when to return to the user;
7. run whole-piece checks and finalize the trajectory.

The outer loop never writes prose.

### Inner loop

Each unit is a content-complete control point, normally 600–1200 Chinese
characters:

1. an isolated writer receives the goal, kernel, this unit's functional role,
   job, rhythm direction, human examples, and finished preceding prose;
2. it writes the unit;
3. an isolated check looks near (join/repetition) and far
   (main line/emphasis/pattern collapse, including whether every paragraph has
   collapsed to the same force);
4. real issues are repaired before advancing.

Units are sequential, not parallel. They exist for control, not model capacity.

## The three human gates

### 1. Layout gate

Before prose generation, the viewer shows:

- the core thesis as numbered claims;
- one open question, if a real user decision remains;
- an expandable summary of the unit movement;
- a control to mark at most three strongest landing points;
- one plain-language note field.

The user can approve or ask for a revision. The system does not write before
approval.

### 2. Hard-choice gate

A passage becomes hard when a repeated check fails, a fragile qualification is
at risk, the user marked it as a strongest landing, or zoom-out keeps finding
the same drift.

Escalation is incremental: fresh seed → different family → different reasoning
setting → different strategy/unit boundary.

If multiple versions deserve a human decision, the viewer presents neutral
labels only. Family, generation order, token count, and word count are hidden.
The user chooses one or says none land.

### 3. Local-tuning gate

The user selects text in the current draft. Two plain actions are enough:

- “This line feels fake.”
- “Show a few ways through.”

The address is `{ contentSet?, file, quote, start, end }`. The quote anchors the
current draft; no stable cross-rewrite block identity is necessary.

## File contract

```text
<content-set>/
  workflow.json
  draft.md
  materials/
    brief.md
    original.md
    kernel.md
    voice/
  candidates/
    <task-or-unit>/<neutral-id>.md
  taste/
    taste-profile.md
    recipes/<content-type>.md
    prefs.log.jsonl
    examples/
      candidates/<task-id>/
      positive/
      negative/
      swaps.jsonl
```

### `workflow.json`

This is a compact viewer projection:

```ts
type WritingStage =
  | "intake"
  | "layout"
  | "writing"
  | "review"
  | "choice"
  | "final"
  | "distilled"

interface WorkflowState {
  version: 2
  stage: WritingStage
  goal: string
  entry?: "idea" | "draft"
  taskId?: string
  layout?: {
    title: string
    thesis: string[]
    units: Array<{
      id: string
      role: string
      brief: string
      rhythm?: string
      targetChars?: number
      emphasis?: string
    }>
    openQuestion?: string
  }
  emphasis: number[]
  progress?: {
    currentUnit?: string
    completedUnits: string[]
    totalUnits: number
    note?: string
  }
  review?: {
    summary?: string
    issues: Array<{ quote: string; problem: string; status?: string }>
  }
  candidates: Array<{
    id: string
    label: string
    markdown?: string
    path?: string
    note?: string
  }>
  acceptedCandidateId?: string
  finalNote?: string
  updatedAt?: string
}
```

The agent writes stage transitions. The viewer never invents semantic state.
New v0.3 layouts write `role`; the parser keeps accepting older projections
that do not contain it.

## Functional layout

The first layout decision is not length. It is what each unit does in the
article: establish background, bring the problem into focus, reason step by
step, state the conclusion, or close. Prose form follows function:

- background can stretch and carry density;
- the moment a problem becomes clear may stand alone;
- reasoning may use longer sentences to make each step stable;
- a conclusion contracts into shorter sentences and stops;
- neighboring units should change gear.

Length, density, breathing, and emphasis implement that function; they are not
independent targets. The far check asks whether the problem and conclusion
actually stand out in form, not merely whether paragraph lengths differ.

## Repair terminal and format failure

A check may trigger one repair and one recheck in the shipped workflow. Manual
or local repair must never exceed two repair/recheck cycles at the same place.
This is executable policy, not prompt etiquette: the neutral leaf router stores
a private counter per stable passage scope and rejects a third repair before
dispatch. The initial draft is attempt zero, and renaming a rewrite does not
reset the scope.
After the limit:

- an unresolved factual or kernel error is a valid blocked result; do not
  publish it as final and do not overwrite an existing source draft;
- a remaining subjective tradeoff becomes a neutral user choice;
- a passing result may proceed to final.

Repeated repair is not convergence: it tends to move problems and add defensive
qualifications until the checker itself produces model-like prose.

Structured judge output is accepted only when the tool layer enforces the
schema. If that is unavailable, switch checker or degrade explicitly to a
line-based “quote + problem” report and record the degradation. Never silently
parse arbitrary model prose as JSON.

Writers use simple, traditional text. Sections and headings are welcome when
the article needs them; intra-paragraph bold, italic, and list-shaped argument
are avoided because they replace real sentence and paragraph work. A writer
returns prose only because its response is consumed verbatim as a candidate.

## Viewer information architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ WordTaste · Chinese long-form        status    project    export    │
├───────────────┬─────────────────────────────────────────────────────┤
│ Goal          │ Active human gate                                  │
│ Shape         │                                                     │
│ Write         │ Current draft / neutral candidate                   │
│ Check         │                                                     │
│ Keep          │ Selection → two plain local actions                 │
│               │                                                     │
│ source files  │                                                     │
│ memory        │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

The left rail communicates sequence and exposes supporting files as secondary
details. The main workspace always prioritizes the active decision and the
text. Taste history is a small expandable memory surface, not a competing
dashboard.

## Manifest surface

Sources:

- `draft` — aggregate `**/draft.md`;
- `workflow` — aggregate `**/workflow.json`;
- `materials` — read-only file glob;
- `candidates` — read-only file glob;
- `taste` — aggregate read projection;
- `crossFamily` — root probe result;
- `config` — root viewer surface config.

Agent → viewer actions:

- `navigate-to`;
- `focus-stage`.

User → agent commands:

- `begin-from-idea`;
- `begin-from-draft`;
- `approve-layout`;
- `revise-layout`;
- `choose-candidate`;
- `reject-candidates`;
- `flag-selection`;
- `request-variants`;
- `accept-draft`.

## What is deliberately gone

- user-operated disruption dial;
- block freezing;
- per-block annotation dashboard;
- visible symptom taxonomy;
- “five rewrite directions” generated from internal categories;
- automatic whole-draft regeneration from a single button;
- model-family provenance beside candidates;
- public worked-example seed.

## Design register

Product UI, restrained color strategy.

- Deep zinc shell and existing `cc-*` tokens.
- Orange only for the active decision or primary action.
- One system sans family for UI; script-aware reading font for the draft.
- 150–250ms state motion only.
- Responsive structure collapses the process rail into a horizontal stepper.
- Reduced-motion alternatives are required.
- No decorative glass, gradient text, repeated card grid, or internal jargon.

## Verification

1. Domain tests pin workflow parsing, current-draft addressing, and content-set
   derivation.
2. Manifest tests pin v0.3 sources, stage actions, two seeds, and removal of the
   old ladder/symptom controls.
3. Workflow source-shape tests pin functional roles, deterministic Claude
   runtime usage, explicit terminal routing, and manual format fallback.
4. Wrapper integration tests prove a stopped leaf process is reaped and that
   both families start from neutral directories.
5. `bun test modes/wordtaste`.
6. `bun run typecheck`.
7. `bun run build`.
8. Run the mode with a layout-stage fixture and visually verify desktop and
   narrow widths in a real browser.
9. Run one real CC/Codex writing loop from a fresh temporary workspace. Verify
   that chat/history contains no raw leaf prompts, reports, prose dumps, family
   labels, or counts; stop the session and verify no leaf wrapper or CLI remains.
