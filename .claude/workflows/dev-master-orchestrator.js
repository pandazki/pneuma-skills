// dev-master-orchestrator — the Pneuma master orchestrator's GENERAL 5-stage dev-loop workflow.
//
// What it is: a named Claude Code workflow that drives one or more implementation
// tasks through a 5-stage inner loop (Impl -> Review ∥ Verify -> convergence test
// -> Amend, repeated until converged or escalated), with an outer loop over waves
// that run their tasks either in parallel or serially.
//
// The review/verify/amend prompts are PARAMETERIZED by per-task kind + review
// dimensions + gate command, instead of hardcoding a single review scenario. The
// loop adapts to contract work / feature impl / viewer (UI) work / test-suite
// completion (and anything else describable as review dimensions). A StructuredOutput
// hard close-out is appended to the reviewer/verifier prompts (both run general-purpose
// agents that DO emit structured output) so an agent that finishes by running gates
// does not forget to emit it (a prose-only ending was previously treated as a crash
// and hung the run). Impl and Amend run schemaless — pneuma-impl/pneuma-amender are
// roster agents whose system prompts mandate raw prose and forbid StructuredOutput,
// and their output is not a convergence input. The verify gate is fully overridable
// per task via task.gateCmd.
//
// How to call it (from any session, once this file is on disk):
//   Workflow({ name: 'dev-master-orchestrator', args: { specDoc, testCmd, maxRounds, effort, waves } })
// `args` may be passed as a JSON string or an object — see the compatibility header
// below. The task fields taskKind / reviewDimensions / gateK / gateCmd are optional
// with sensible defaults.
//
// Engine selection (opus default vs Fable-5 heavyweight) — see useFable() below:
//   - args.effort === 'ultracode'  → every task's impl/amend runs on the Fable-5 heavyweight
//     variant (pneuma-impl-fable / pneuma-amender-fable) instead of the opus default.
//   - task.engine === 'fable' | task.heavy === true → that ONE task uses fable even when the
//     global effort is not ultracode (the orchestrator marks a long-horizon / complex / high-
//     stakes task heavy). task.engine === 'opus' forces opus back even under global ultracode.
//   Both variants share identical discipline (gates / TDD / forbidden actions); only the
//   underlying model and turn budget differ. Omit effort/engine → opus everywhere.

export const meta = {
  name: 'dev-master-orchestrator',
  description: 'Master-orchestrator general 5-stage dev-loop: implement, then review ∥ verify in parallel, converge on no-blocker/major review plus all-green gates (bun run typecheck + bun test), otherwise amend and re-review; outer loop runs waves of tasks in parallel or serially. Review/verify/amend are parameterized by per-task kind, review dimensions, and gate command, so the loop adapts to contract, feature, viewer, or test-suite tasks.',
  phases: [{ title: 'Impl' }, { title: 'Review' }, { title: 'Verify' }, { title: 'Amend' }],
}

// ── Structured-output schemas for the Review / Verify roles ──
// Review and Verify run on general-purpose agents and DO return JSON via these schemas;
// the orchestrator reads structured fields (severity, allGreen) to decide convergence.
// IMPL_SCHEMA / AMEND_SCHEMA below are retained for documentation only and are NOT
// enforced: pneuma-impl and pneuma-amender are roster agents whose system prompts mandate
// raw prose output (they never call StructuredOutput), so Impl and Amend run schemaless —
// see runTask. Their output is not a convergence input.
const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    gateSelfReport: { type: 'string' },
    foundBug: { type: 'string' },
  },
  required: ['filesChanged', 'summary'],
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          rationale: { type: 'string' },
        },
        required: ['title', 'severity', 'rationale'],
      },
    },
    overallAssessment: { type: 'string' },
  },
  required: ['findings', 'overallAssessment'],
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    typecheck: { type: 'boolean' },
    tests: { type: 'boolean' },
    allGreen: { type: 'boolean' },
    // Contract-first boundary violations found in the changed set (empty when clean).
    boundaryViolations: { type: 'array', items: { type: 'string' } },
    // The full `git diff --name-only <BASE>` set verify already computes for its gate
    // scope; surfaced here so the orchestrator can report which files the task touched
    // (impl runs schemaless and reports no file list of its own).
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['allGreen', 'summary'],
}
const AMEND_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    dispositions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          findingTitle: { type: 'string' },
          disposition: { type: 'string', enum: ['FIXED', 'ESCALATED', 'FIXED_WITH_RESERVATION', 'FLAGGED_OUT_OF_SCOPE'] },
          note: { type: 'string' },
        },
        required: ['findingTitle', 'disposition'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['dispositions', 'summary'],
}

// ── args compatibility header ──
// `args` may be a JSON string (cross-process invocation) or already an object
// (same-process invocation); normalize both.
const A = (typeof args === 'string') ? JSON.parse(args) : (args || {})
const WAVES = A.waves || []
const SPEC_DOC = A.specDoc
// Global default test gate. A single task can narrow it via task.gateK, or fully
// override it via task.gateCmd (see verifyPrompt).
const TEST_CMD = A.testCmd || 'bun test'
const MAX_ROUNDS = A.maxRounds || 3
// Global effort tier. 'ultracode' switches every task's impl/amend to the Fable-5
// heavyweight variant (see useFable).
const EFFORT = String(A.effort || '').toLowerCase()
log('dev-master-orchestrator start — waves=' + WAVES.length + ' testCmd=' + TEST_CMD + ' maxRounds=' + MAX_ROUNDS + ' effort=' + (EFFORT || 'default'))

// ── Engine routing: opus (default) vs fable (Fable-5 heavyweight variant) ──
// The master orchestrator picks the Fable-5 heavyweight impl/amender variants
// (pneuma-impl-fable / pneuma-amender-fable) under any of these conditions, otherwise
// the default opus versions (pneuma-impl / pneuma-amender):
//   - global tier maxed: A.effort === 'ultracode' — every task in the run uses fable;
//   - single task marked heavy: task.engine === 'fable' or task.heavy === true — the
//     master judges that task long-horizon / structurally complex / multi-step /
//     high-stakes and upgrades just that one even when the global tier is not ultracode.
// Reverse escape hatch: task.engine === 'opus' forces that task back onto opus even
// under global ultracode — used to keep individual trivial tasks on the lighter engine
// inside an ultracode run. The fable/opus variants share identical discipline
// (gates / TDD / forbidden actions / no-silent-failure do not fork by model); only the
// underlying model and turn budget differ.
function useFable(task) {
  if (task && task.engine === 'opus') return false
  if (task && (task.engine === 'fable' || task.heavy === true)) return true
  return EFFORT === 'ultracode'
}
function implAgentType(task) { return useFable(task) ? 'pneuma-impl-fable' : 'pneuma-impl' }
function amendAgentType(task) { return useFable(task) ? 'pneuma-amender-fable' : 'pneuma-amender' }

// ── StructuredOutput hard close-out ──
// review/verify are dispatched to general-purpose agents; after running a pile of gate
// commands they often forget to call the StructuredOutput tool and just emit prose —
// after two framework nudges fail, the whole run fails. This hard instruction is
// appended to those two prompts to make "finish with StructuredOutput" an explicit
// termination condition.
// Note: impl/amend do NOT get this close-out — pneuma-impl/pneuma-amender are roster
// agents whose system prompts mandate raw prose output and forbid StructuredOutput, so
// those two stages run schemaless (see runTask).
function structuredCloseout(roleNoun) {
  return ' CRITICAL OUTPUT REQUIREMENT: after your work you MUST finish by calling the StructuredOutput tool with the ' + roleNoun + ' JSON. '
    + 'Do NOT end your turn with prose only — a prose-only completion is treated as a crash and fails the run after two nudges. '
    + 'The StructuredOutput call is the last thing you do.'
}

// ── Default review dimensions (taskKind-aware) ──
// When a task does not pass reviewDimensions explicitly, taskKind selects a default
// set. Every taskKind covers at least the three generic baselines — correctness,
// readability & taste, test coverage; specific kinds layer their own concerns on top.
const GENERIC_DIMENSIONS = [
  'correctness — the change does what the acceptance bar requires; no behavioral regressions',
  'readability & taste — naming, module organization, structure, no dead code; English-only source per project convention',
  'test coverage — the relevant behaviors / equivalence classes are exercised by tests',
]
const DIMENSIONS_BY_KIND = {
  'contract': [
    'contract fidelity & backward compatibility — the changed contract (core/types or protocol surface) still honors what existing consumers depend on; any consumer-breaking change without a migration is a blocker',
    'thin-waist purity — no mode-specific or backend-specific knowledge leaks outside the registry seams (backends/index.ts for backend dispatch; ModeManifest-driven behavior elsewhere); server/ and bin/ stay mode-agnostic',
    'propagation completeness — core/__tests__ updated for the contract change; docs/reference and the AGENTS.md/CLAUDE.md contracts table updated if the contract surface changed',
    'test coverage — the new/changed contract behaviors are pinned by tests, including the compat path for old consumers',
    'readability & taste — naming, type organization, JSDoc on the contract surface, no dead code',
  ],
  'feature': [
    'correctness — the feature meets the acceptance bar end to end, INCLUDING failure paths (errors, timeouts, missing files, dead processes); edge cases handled',
    'API & contract design — public surface, types, and error contracts are sound and consistent with surrounding code; manifest-driven rather than hardcoded',
    'test coverage — happy path + edge cases + failure modes are tested',
    'readability & taste — naming, structure, module organization, no dead code',
  ],
  'viewer': [
    'correctness — the UI behaves per the acceptance bar; state wiring (Zustand slices, props from useViewerProps/useSource) is sound; no broken rendering on the main path',
    'visual quality & design-token adherence — uses the cc-* CSS custom properties and the Ethereal Tech theme (deep zinc bg, neon orange primary, glassmorphism); no ad-hoc colors or off-theme styling; no emoji in UI elements',
    'interaction & UX states — loading, empty, and error states exist and are coherent; interactive affordances respond correctly',
    'test coverage — where applicable (logic extracted from components, hooks, pure helpers); pure-JSX layout need not be unit-tested',
    'readability & taste — component structure, naming, no dead code',
  ],
  'test-suite': [
    'completeness — the COMPLETE set of input equivalence classes the bar enumerates is covered; flag every missing class',
    'contract pinning — the contracts the bar names (ordering, error shapes, message text) are asserted, not left loose',
    'assertion quality — assertions actually pin behavior (no tautological / overly-broad assertions)',
    'readability & taste — test naming, fixture organization, no copy-paste sprawl',
  ],
}
function reviewDimensionsFor(task) {
  if (task && Array.isArray(task.reviewDimensions) && task.reviewDimensions.length) return task.reviewDimensions
  const kind = task && task.taskKind
  if (kind && DIMENSIONS_BY_KIND[kind]) return DIMENSIONS_BY_KIND[kind]
  return GENERIC_DIMENSIONS
}

// ── Default severity guidance (taskKind-aware) ──
// No single hardcoded scenario. Each kind gets a one-line calibration of what counts
// as blocker / major / minor; callers passing reviewDimensions still get the matching
// kind's calibration (or the generic one) — the dimensions themselves already carry
// their own blocker hints.
const SEVERITY_BY_KIND = {
  'contract': 'a contract change that breaks an existing consumer or leaks domain (mode/backend) knowledge across the thin waist = blocker; missing propagation (core/__tests__, docs/reference, contracts table) or untested compat path = major; taste / naming / doc wording = minor or nit.',
  'feature': 'incorrect behavior or an unhandled failure on the main flow = blocker; missing edge-case coverage or unsound API/error contract = major; taste / readability / naming = minor or nit.',
  'viewer': 'broken rendering or broken interaction on the main path = blocker; missing loading/empty/error state, off-theme styling, or design-token violation = major; spacing / polish / naming = minor or nit.',
  'test-suite': 'a test that asserts the WRONG behavior = blocker; missing equivalence class or an unpinned contract the bar names = major; assertion not pinning named message text = minor; test taste / naming = minor or nit.',
}
const GENERIC_SEVERITY = 'a defect that breaks the acceptance bar or alters intended behavior = blocker; a meaningful gap (missing coverage, unsound contract, boundary violation) = major; taste / readability / naming = minor or nit.'
function severityFor(task) {
  const kind = task && task.taskKind
  return (kind && SEVERITY_BY_KIND[kind]) || GENERIC_SEVERITY
}

function implPrompt(WT, anchor) {
  return 'Implementation task. STEP 0: cd to the worktree ' + WT + ' and confirm the branch is NOT main. '
    + 'STEP 1: your full spec is in ' + SPEC_DOC + ' under the markdown heading "## ' + anchor + '" — Read THAT section only for requirements + acceptance. '
    + 'STEP 2: implement with TDD, run every quality gate (bun run typecheck; bun test), return RAW output (do not claim green; verify re-runs independently).'
}

// merge-base baseline: the worktree's true base is git merge-base HEAD main, not main's
// current HEAD. main may advance during the session, so a bare `git diff main` would feed
// the reviewer unrelated main progress — both legs compute merge-base first.
//
// reviewPrompt reviews against THIS task's reviewDimensions + severity calibration
// instead of a single hardcoded scenario. Default dimensions come from taskKind, with a
// generic three-dimension fallback.
function reviewPrompt(WT, reviewAnchor, task) {
  const dims = reviewDimensionsFor(task)
  const dimsBlock = dims.map((d, i) => '(' + (i + 1) + ') ' + d).join('; ')
  const severity = severityFor(task)
  const kind = (task && task.taskKind) ? task.taskKind : 'general'
  let extra = ''
  if (kind === 'viewer') {
    extra = 'VISUAL EVIDENCE CHECK: the implementer was REQUIRED to verify UI changes visually via chrome-devtools screenshots of the running dev server (project rule: never judge visual correctness by reading code alone). Check that such evidence exists in the impl/amend output trail; its absence on a UI-facing change is itself a major finding. '
  }
  return 'Adversarial code review (' + kind + ' task). cd to ' + WT + '. '
    + 'First compute this worktree\'s true baseline commit: run "git merge-base HEAD main" to get BASE, then "git diff <BASE>" to see ONLY this task\'s net changes — do NOT use "git diff main" (main may have advanced during the session, which would feed you unrelated diff). '
    + 'Your acceptance bar is in ' + SPEC_DOC + ' under "## ' + reviewAnchor + '" — Read that section; it defines the COMPLETE bar this task must meet. '
    + 'The implementer may have been handed a thinner spec, so review against the FULLER bar and catch every gap. First Read the relevant source, then diff it against the change. '
    + extra
    + 'Review across these dimensions: ' + dimsBlock + '. '
    + 'Severity guidance: ' + severity + ' '
    + 'Emit one finding per gap with severity (blocker|major|minor|nit), file, and rationale; overallAssessment summarising whether the change meets the full bar.'
    + structuredCloseout('findings')
}

// verifyPrompt receives the whole task so that:
//   - task.gateCmd fully overrides the test command (most flexible — custom runner,
//     scoped suite, integration invocation, anything gateK cannot express);
//   - otherwise task.gateK narrows the gate to "bun test <gateK>" (a bun test filter:
//     positional file/path filter, or include flags like -t "<pattern>" inside gateK);
//   - with neither, falls back to the global TEST_CMD (default "bun test").
// Changed-file framing also goes through merge-base. Boundary guard: pneuma has no
// import-linter — the contract-first rules are checked by inspecting the changed diff
// for the three forbidden patterns listed in the prompt; any hit is a gate failure.
function verifyPrompt(WT, task) {
  let testCmd
  if (task && task.gateCmd) {
    testCmd = task.gateCmd
  } else if (task && task.gateK) {
    testCmd = 'bun test ' + task.gateK
  } else {
    testCmd = TEST_CMD
  }
  return 'Independent quality-gate verification — do NOT trust any prior agent self-report; run the gates yourself. '
    + 'cd to ' + WT + ' (confirm branch is NOT main). '
    + 'Frame the changed file set against this worktree\'s true baseline: run "git merge-base HEAD main" to get BASE, then "git diff --name-only <BASE>" — do NOT use "git diff main" (main may have advanced). '
    + 'From inside the worktree run the gates: (1) typecheck gate: bun run typecheck — pass/fail from the ACTUAL exit code → boolean typecheck. '
    + '(2) test gate: ' + testCmd + ' (redirect to a /tmp log, then tail) → boolean tests. Healthy bun test output looks like "NNNN pass / NN skip / 0 fail"; backend lifecycle suites report "(skip) ... binary not available" — skips are FINE and expected, but ANY fail is red. '
    + '(3) Contract-first boundary check: inspect the diff of the changed files for these forbidden patterns — (a) any NEW "if (backendType === ...)"-style backend-type conditional outside backends/index.ts; (b) any React import inside a modes/*/manifest.ts (manifests are read by the Bun backend, which has no React); (c) any hardcoded mode name in server/ or bin/ (those layers must be ModeManifest-driven). List each hit in boundaryViolations with file + pattern; these violate pneuma\'s contract-first rules and count as a FAILED gate. '
    + 'Report each gate pass/fail truthfully from ACTUAL exit codes; allGreen = typecheck AND tests AND boundaryViolations is empty. '
    + 'Also return changedFiles: the FULL list from "git diff --name-only <BASE>" so the orchestrator can report which files this task touched. '
    + structuredCloseout('verify (typecheck/tests/allGreen/boundaryViolations/changedFiles)')
}

// amendPrompt is generic: no single hardcoded fix recipe — the amender resolves the
// reviewer's findings one by one. Still surgical / no-scope-creep, with an ESCALATE
// fallback for out-of-scope source bugs.
function amendPrompt(WT, review, verify, round, task) {
  const kind = (task && task.taskKind) ? task.taskKind : 'general'
  return 'Amendment task (round ' + round + ', ' + kind + '). cd to ' + WT + '. '
    + 'Review findings to resolve: ' + JSON.stringify((review && review.findings) || []) + '. '
    + 'Current gate status: ' + JSON.stringify(verify) + '. '
    + 'Fix each valid finding surgically (no scope creep): address exactly what the reviewer flagged for this finding — whether that is correcting behavior, adding missing test coverage, fixing a contract-first boundary violation, restoring design-token adherence, or pinning a contract. '
    + 'For findings that point at out-of-scope source bugs you should NOT fix here, either pin them with a skipped/failing-marker test or mark the disposition ESCALATED with a note. Re-run gates (bun run typecheck; bun test). Return a per-finding disposition ledger (one entry per finding) as raw prose — convergence is re-tested by the next review ∥ verify round, not parsed from this output.'
}

function hasBlockerOrMajor(review) {
  return !!(review && review.findings && review.findings.some(f => f.severity === 'blocker' || f.severity === 'major'))
}

// ── Inner loop: single-task convergence ──
// Standard path: impl -> (review ∥ verify) -> convergence test -> if not converged,
//                amend -> back to re-review, until the review has no blocker/major AND
//                verify.allGreen, or MAX_ROUNDS is reached and the task ESCALATEs.
// task.preSeeded (debug/demo capability): skip impl and enter the review loop directly
//                from the (deliberately incomplete) state already committed in the
//                worktree — deterministically lights up the review->amend->re-review
//                multi-round path (real impls usually pass in one round, so that path
//                is rarely exercised). Normal tasks never set this.
async function runTask(task) {
  const WT = task.worktree
  const reviewAnchor = task.reviewAnchor || task.anchor
  let impl
  if (task.preSeeded) {
    phase('Impl')
    log('task=' + task.id + ' preSeeded — skipping impl, driving loop from committed worktree state')
    impl = { filesChanged: task.seededFiles || [], summary: 'pre-seeded (impl skipped)', foundBug: '' }
  } else {
    phase('Impl')
    // pneuma-impl returns raw prose by design — its system prompt mandates pasting raw
    // gate output and forbids self-judging green, so it never calls StructuredOutput.
    // Run it schemaless and wrap the prose. impl output is NOT a convergence input:
    // convergence is decided solely by review (no blocker/major) + verify (allGreen).
    // The changed-file set is recovered from the verify leg (it already runs
    // "git diff --name-only <BASE>" for its gate scope and returns changedFiles) —
    // impl reports no file list of its own, so this wrap leaves filesChanged empty and
    // runTask fills it from verify at report time. Forcing IMPL_SCHEMA here would only
    // make pneuma-impl (which has no StructuredOutput tool) finish the work yet leave
    // the run without structured output, silently dropping impl metadata.
    log('task=' + task.id + ' engine=' + (useFable(task) ? 'fable' : 'opus') + ' (impl=' + implAgentType(task) + ')')
    const implRaw = await agent(implPrompt(WT, task.anchor), { agentType: implAgentType(task), label: 'impl:' + task.id, phase: 'Impl' })
    if (!implRaw) return { taskId: task.id, status: 'FAILED', reason: 'impl returned null' }
    impl = { filesChanged: [], summary: typeof implRaw === 'string' ? implRaw : '', foundBug: '' }
  }

  const amendLog = []
  let lastReview = null
  let lastVerify = null
  let round = 0
  while (true) {
    phase('Review')
    const [review, verify] = await parallel([
      () => agent(reviewPrompt(WT, reviewAnchor, task), { agentType: 'general-purpose', label: 'review:' + task.id + ':r' + round, phase: 'Review', schema: REVIEW_SCHEMA }),
      () => agent(verifyPrompt(WT, task), { agentType: 'general-purpose', label: 'verify:' + task.id + ':r' + round, phase: 'Verify', schema: VERIFY_SCHEMA }),
    ])
    lastReview = review
    lastVerify = verify
    // no-silent-failure: a null review means the reviewer agent crashed/timed out.
    // Treat that as NOT-converged (never let a missing review read as "zero majors").
    const reviewOk = !!review && !hasBlockerOrMajor(review)
    const converged = reviewOk && !!(verify && verify.allGreen)
    log('task=' + task.id + ' round=' + round + ' converged=' + converged + ' green=' + !!(verify && verify.allGreen) + ' reviewOk=' + reviewOk + ' reviewPresent=' + !!review)
    if (converged) {
      const changedFiles = (verify && verify.changedFiles) || impl.filesChanged || []
      return { taskId: task.id, status: 'ACCEPTED', rounds: round, impl: { filesChanged: changedFiles, foundBug: impl.foundBug || '' }, finalReview: review, finalVerify: verify, amendLog }
    }
    round++
    if (round >= MAX_ROUNDS) {
      const changedFiles = (lastVerify && lastVerify.changedFiles) || impl.filesChanged || []
      return { taskId: task.id, status: 'ESCALATED', rounds: round, reason: 'not converged after ' + MAX_ROUNDS + ' review rounds', impl: { filesChanged: changedFiles, foundBug: impl.foundBug || '' }, lastReview, lastVerify, amendLog }
    }
    phase('Amend')
    // pneuma-amender, like pneuma-impl, returns raw prose (never calls StructuredOutput);
    // run schemaless. The disposition ledger is prose and is not parsed — convergence is
    // re-tested by the next review ∥ verify round, not read from amend output.
    const amend = await agent(amendPrompt(WT, review, verify, round, task), { agentType: amendAgentType(task), label: 'amend:' + task.id + ':r' + round, phase: 'Amend' })
    amendLog.push({ round, amend })
    // loop back → re-review ∥ re-verify
  }
}

// ── Outer loop: waves / tasks ──
// Each wave declares mode=parallel|serial. parallel: the wave's tasks run runTask
// concurrently; serial: one after another.
const results = []
for (const wave of WAVES) {
  log('=== Wave ' + wave.id + ' [' + wave.mode + '] — ' + wave.tasks.length + ' task(s) ===')
  if (wave.mode === 'parallel') {
    results.push(...(await parallel(wave.tasks.map(t => () => runTask(t)))))
  } else {
    for (const t of wave.tasks) results.push(await runTask(t))
  }
}

const accepted = results.filter(r => r && r.status === 'ACCEPTED').length
const escalated = results.filter(r => r && r.status === 'ESCALATED').length
return { summary: { total: results.length, accepted, escalated }, tasks: results }
