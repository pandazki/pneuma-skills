# `dev-master-orchestrator` — master orchestrator dev-loop workflow

`dev-master-orchestrator.js` is the Pneuma master orchestrator's formal **named Claude
Code workflow**. Once on disk it can be invoked from any session with
`Workflow({ name: "dev-master-orchestrator", args })` (or via `scriptPath` pointing at
this file), completing the orchestrator toolchain alongside the `.claude/agents/` roster.

---

## 1. Purpose

It runs the master orchestrator's **5-stage dev-loop** over one or more
implementation tasks. The Review / Verify / Amend stages are **parameterized
per task** (kind, review dimensions, gate command) so the same workflow drives
contract work, new-feature impl, viewer (UI) work, and test-suite completion
alike — see §3.1 for the task fields and the per-kind review semantics.

```
Impl  ──▶  Review ∥ Verify  ──▶  convergence test  ──▶  Amend  ──┐
  │            (parallel)                                          │
  └─────────────────────  re-Review ∥ re-Verify  ◀────────────────┘
```

- **Inner loop** (per task): implement → review and gate-verify in parallel →
  test convergence → if not converged, amend → loop back to re-review/re-verify,
  until the task is `ACCEPTED` or `ESCALATED`.
- **Outer loop** (across tasks): tasks are grouped into **waves**; each wave runs
  its tasks either in `parallel` (concurrent) or `serial` (one after another).

The orchestrator never implements or reviews by hand — every Impl / Review /
Verify / Amend step is a dispatched sub-agent.

---

## 2. Prerequisites

- **Roster agents installed.** The workflow dispatches to `pneuma-impl` (Impl),
  `pneuma-amender` (Amend) — plus their Fable-5 heavyweight variants
  `pneuma-impl-fable` / `pneuma-amender-fable` — and `general-purpose` (Review and
  Verify). These must already live in `.claude/agents/`. If you just authored a
  new agent, run `/reload-plugins`: **the agent registry is a session snapshot**, so
  a newly created agent is not dispatchable until the registry reloads.
- **Worktrees pre-built.** The orchestrator pre-creates each task's git worktree on
  a feature branch (**never `main`**) before invoking the workflow. Every dispatched
  agent `cd`s into the task's worktree first and confirms the branch is not main.
  Bun resolves dependencies from the repo root's `node_modules`, so a fresh worktree
  may need a `bun install` if the lockfile changed on the branch.
- **Spec doc reachable.** `specDoc` is an absolute path the dispatched agents Read;
  each task points at a heading inside it via `anchor` / `reviewAnchor`.

---

## 3. Full `args` schema

`args` may be passed as a JSON string or as an object — the script normalizes both
via `(typeof args === 'string') ? JSON.parse(args) : (args || {})`.

| Field | Type | Required | Default | Meaning |
|-------|------|----------|---------|---------|
| `specDoc` | string (absolute path) | yes | — | Absolute path to the spec doc the agents Read for requirements and acceptance bars. |
| `testCmd` | string | no | `'bun test'` | Global default test-gate command, used when a task sets neither `gateCmd` nor `gateK`. |
| `maxRounds` | number | no | `3` | Max review rounds per task before `ESCALATED`. |
| `effort` | string | no | — | Global engine tier. `'ultracode'` routes **every** task's Impl/Amend to the Fable-5 heavyweight variants (`pneuma-impl-fable` / `pneuma-amender-fable`); anything else (or absent) keeps the opus defaults. See §3.3. |
| `waves` | array of wave objects | no | `[]` | Outer-loop wave list (see below). |

### Wave object

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `id` | string / number | yes | Wave identifier (used in logs). |
| `mode` | `'parallel'` \| `'serial'` | no | Defaults to serial when omitted. `parallel` runs the wave's tasks concurrently; any other value (including absent) runs them serially. |
| `tasks` | array of task objects | yes | Tasks belonging to this wave. |

### Task object

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `id` | string | yes | Task identifier (used in agent labels and logs). |
| `anchor` | string | yes | Markdown heading in `specDoc` the **implementer** Reads (`## <anchor>`). |
| `reviewAnchor` | string | no (falls back to `anchor`) | Heading the **reviewer** Reads (`## <reviewAnchor>`); enables the dual-anchor information asymmetry. |
| `worktree` | string (absolute path) | yes | The task's pre-built worktree the agents `cd` into (feature branch, never main). |
| `taskKind` | `'contract'` \| `'feature'` \| `'viewer'` \| `'test-suite'` | no (defaults to generic) | Selects the default review **dimensions** and **severity guidance** the reviewer/amender are handed (see §3.1). When omitted, a generic dimension set + generic severity calibration is used. |
| `reviewDimensions` | array of strings | no | Explicit list of review dimensions, each phrased as `"<name> — <what to check>"`. When a non-empty array is supplied it **overrides** the `taskKind` defaults entirely; the `taskKind`'s severity guidance still applies (or generic severity when `taskKind` is absent). |
| `gateK` | string | no | Per-task `bun test` filter. When set (and `gateCmd` is not), Verify runs `bun test <gateK>` — `gateK` can be a positional file/path filter (e.g. `core/__tests__/source-registry.test.ts`) or include flags such as `-t "<name pattern>"`. When absent, falls back to the global `testCmd`. |
| `gateCmd` | string | no | **Full override** of the test-gate command. When set it takes precedence over both `gateK` and the global `testCmd` — use it for a custom runner, a scoped suite, or anything `gateK` cannot express. The typecheck gate (`bun run typecheck`) and the boundary check still run independently. |
| `engine` | `'fable'` \| `'opus'` | no | Per-task engine routing override. See §3.3. |
| `heavy` | boolean | no | `true` marks this one task long-horizon / complex / high-stakes → Fable-5 variants, regardless of global `effort`. See §3.3. |
| `preSeeded` | boolean | no | Debug/demo only — skip Impl and drive the loop from a pre-committed worktree state (see §7). Normal tasks omit it. |
| `seededFiles` | array of strings | no | Only meaningful with `preSeeded`; the fallback file list reported as the (skipped) impl's `filesChanged` when the verify leg surfaces no `changedFiles`. |

### 3.1. `taskKind` and `reviewDimensions` — what the reviewer checks

The Review and Amend stages are parameterized so the loop adapts to the kind of
work. Each task resolves to a set of **review dimensions** (what the reviewer
audits, finding by finding) and a one-line **severity calibration** (what counts
as blocker / major / minor) by this precedence:

1. **`reviewDimensions` (explicit)** → used verbatim as the review dimensions.
2. else **`taskKind`** → its built-in dimension set:
   - `contract` — changes to `core/types/` or protocol surfaces: contract fidelity
     & backward compat, thin-waist purity (no mode/backend knowledge leaking
     outside the registry seams), propagation completeness (`core/__tests__`,
     `docs/reference`, the AGENTS.md/CLAUDE.md contracts table), test coverage,
     readability/taste. **Blocker** = a contract change that breaks an existing
     consumer or leaks domain knowledge across the thin waist.
   - `feature` — correctness including failure paths, API & contract design,
     test coverage, readability/taste. **Blocker** = unhandled failure on the
     main flow.
   - `viewer` — UI work in `src/` or `modes/*/viewer/`: correctness, visual
     quality & design-token adherence (`cc-*` custom properties, Ethereal Tech
     theme), interaction/UX states (loading/empty/error), test coverage where
     applicable, readability. The reviewer is additionally told that the
     implementer was **required to verify visually via chrome-devtools
     screenshots** and to check that the evidence exists in the impl/amend output
     trail. **Blocker** = broken rendering or interaction on the main path.
   - `test-suite` — equivalence-class completeness, contract pinning, assertion
     quality, readability/taste. **Blocker** = a test that asserts wrong behavior.
3. else (**neither set**) → a **generic** dimension set: correctness,
   readability & taste, test coverage.

Severity calibration follows `taskKind` when present (each kind ships its own
blocker/major/minor mapping), otherwise a generic calibration. Supplying
`reviewDimensions` does **not** change which severity calibration is used.

### 3.2. Verify gates and the contract-first boundary check

The Verify leg runs three independent checks inside the task's worktree, framed
against the worktree's **true baseline** (`git merge-base HEAD main`, never a bare
`git diff main` — main may advance during the session):

1. **Typecheck gate** — `bun run typecheck` → boolean `typecheck`.
2. **Test gate** — `gateCmd` / `bun test <gateK>` / global `testCmd` (default
   `bun test`) → boolean `tests`. Healthy `bun test` output reads
   `"NNNN pass / NN skip / 0 fail"`; the backend lifecycle suites report
   `"(skip) ... binary not available"` when a CLI binary is absent — **skips are
   fine, any fail is red**.
3. **Contract-first boundary check** — the verifier inspects the changed diff for
   three forbidden patterns and lists every hit in `boundaryViolations`:
   - any **new** `if (backendType === ...)`-style conditional outside
     `backends/index.ts`;
   - any **React import inside a `modes/*/manifest.ts`** (manifests are loaded by
     the Bun backend, which has no React);
   - any **hardcoded mode name in `server/` or `bin/`** (those layers must be
     ModeManifest-driven).

```
allGreen = typecheck AND tests AND boundaryViolations is empty
```

`changedFiles` is the full `git diff --name-only <BASE>` list and is how the
orchestrator reports which files the task touched (Impl runs schemaless and
reports no file list of its own).

### 3.3. Engine routing — opus default vs Fable-5 heavyweight

Impl and Amend dispatch to one of two variants per task:

- **`args.effort === 'ultracode'`** → every task uses `pneuma-impl-fable` /
  `pneuma-amender-fable`.
- **`task.engine === 'fable'` or `task.heavy === true`** → that one task uses the
  fable variants even when the global effort is not ultracode.
- **`task.engine === 'opus'`** → forces that task back onto `pneuma-impl` /
  `pneuma-amender` even under global ultracode (escape hatch for trivial tasks in
  a heavyweight run).

Both variants share identical discipline (gates / TDD / forbidden actions /
no-silent-failure); only the underlying model and turn budget differ. Omitting
`effort`/`engine`/`heavy` keeps opus everywhere.

---

## 4. Five-stage closed loop and the convergence test

Each round runs Review and Verify in parallel, then evaluates one convergence test:

```
reviewOk  = review is present AND has no blocker/major finding
converged = reviewOk AND verify.allGreen
```

- `converged` → task returns **`ACCEPTED`**.
- not converged and `round >= maxRounds` → task returns **`ESCALATED`**.
- otherwise → **Amend** runs, then the loop re-reviews and re-verifies.

**Gate-green is necessary but not sufficient.** `verify.allGreen` alone does not
accept a task — the review must also be free of blocker/major findings. A missing
review (agent crash/timeout returns `null`) is treated as **not converged**, never as
"zero majors" — this is the no-silent-failure guard in `reviewOk = !!review && ...`.

Impl and Amend run **schemaless** (raw prose): `pneuma-impl` / `pneuma-amender` are
roster agents whose system prompts mandate raw prose and forbid StructuredOutput.
Their output is never a convergence input — convergence is decided solely by the
structured Review + Verify legs.

---

## 5. Dual anchor (information asymmetry)

The implementer and the reviewer read **different** spec sections on purpose:

- **Impl** reads `## <anchor>` — the task's build requirements and acceptance.
- **Review** reads `## <reviewAnchor>` — a fuller acceptance bar (e.g. the complete
  set of states, contracts, and edge cases the change must cover).

When a task omits `reviewAnchor`, the reviewer falls back to `anchor`
(`const reviewAnchor = task.reviewAnchor || task.anchor`). Giving the reviewer a
fuller bar than the implementer was handed lets the loop catch gaps the implementer
could not have known to close.

---

## 6. Invocation example

```js
Workflow({
  name: "dev-master-orchestrator",
  args: {
    specDoc: "/abs/path/docs/plans/my-feature-spec.md",
    testCmd: "bun test",
    maxRounds: 3,
    waves: [
      {
        id: "w1",
        mode: "parallel",
        tasks: [
          {
            // a contract task: contract-kind review dimensions + severity,
            // marked heavy → Fable-5 impl/amend even without global ultracode
            id: "T1",
            taskKind: "contract",
            heavy: true,
            anchor: "TASK-1",
            reviewAnchor: "TASK-1-REVIEW",
            worktree: "/abs/path/.claude/worktrees/feat-t1",
            gateK: "core/__tests__"
          },
          {
            // generic review (no taskKind) + full custom gate command
            id: "T2",
            anchor: "TASK-2",
            worktree: "/abs/path/.claude/worktrees/feat-t2",
            gateCmd: "bun test server/__tests__ backends/__tests__"
          }
        ]
      },
      {
        id: "w2",
        mode: "serial",
        tasks: [
          {
            // a viewer task with explicit, overriding review dimensions
            id: "T3",
            taskKind: "viewer",
            reviewDimensions: [
              "correctness — gallery cards render from the seed catalog; clicking applies the seed",
              "visual quality — cc-* design tokens, Ethereal Tech theme, no emoji in UI",
              "interaction states — loading/empty/error states exist and are coherent"
            ],
            anchor: "TASK-3",
            reviewAnchor: "TASK-3-REVIEW",
            worktree: "/abs/path/.claude/worktrees/feat-t3",
            gateK: "-t \"seed gallery\""
          }
        ]
      }
    ]
  }
})
```

`w1` runs `T1` and `T2` concurrently; once both settle, `w2` runs `T3` serially.
`T1` uses the `contract` review dimensions on the Fable-5 engine, `T2` takes the
generic defaults but a fully custom gate command, and `T3` supplies explicit
`reviewDimensions` (overriding the `viewer` defaults) while keeping the `viewer`
severity calibration.

---

## 7. `preSeeded` debug usage

`preSeeded` is a **debug/demo** capability, not for normal tasks. With real
implementers the work usually passes review in one round, so the
review → amend → re-review multi-round path is rarely exercised. To light it up
deterministically:

1. Pre-commit a deliberately **incomplete** state into the task's worktree (e.g. a
   change missing several states or contracts the `reviewAnchor` bar requires).
2. Set `preSeeded: true` (and optionally `seededFiles`) on the task.

The workflow then **skips Impl** and enters the loop directly from the committed
state, so Review finds real gaps and Amend has genuine work — driving the inner loop
through multiple rounds on demand.

---

## 8. Return structure

```jsonc
{
  "summary": { "total": 3, "accepted": 2, "escalated": 1 },
  "tasks": [
    {
      "taskId": "T1",
      "status": "ACCEPTED",          // ACCEPTED | ESCALATED | FAILED
      "rounds": 0,
      "impl": { "filesChanged": ["..."], "foundBug": "" },
      "finalReview": { "findings": [], "overallAssessment": "..." },
      "finalVerify": { "typecheck": true, "tests": true, "allGreen": true, "boundaryViolations": [], "summary": "..." },
      "amendLog": []
    },
    {
      "taskId": "T3",
      "status": "ESCALATED",
      "rounds": 3,
      "reason": "not converged after 3 review rounds",
      "impl": { "filesChanged": ["..."], "foundBug": "" },
      "lastReview": { "findings": ["..."], "overallAssessment": "..." },
      "lastVerify": { "allGreen": false, "summary": "..." },
      "amendLog": [{ "round": 1, "amend": "<raw prose disposition ledger>" }]
    }
  ]
}
```

`summary` aggregates counts across all tasks; each `tasks[]` entry carries its
terminal `status`, the number of review `rounds`, the final (or last) review and
verify payloads, and the per-round `amendLog`. `impl.filesChanged` is recovered
from the verify leg's `git diff --name-only $(git merge-base HEAD main)` — impl
and amend run schemaless and emit raw prose, so each `amendLog[].amend` is a prose
string, not a structured ledger. An impl that returns `null` yields a `FAILED`
task (`reason: "impl returned null"`).
