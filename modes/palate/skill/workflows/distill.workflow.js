export const meta = {
  name: 'palate-distill',
  description:
    'Distill a writing session into sharper taste artifacts (GEPA-style, no weights touched): gather the trajectory → fan out cross-family reflectors → Pareto-validate candidate rubrics against the user’s PAST verdicts (anti reflection-drift) → return the synthesized taste-profile + recipe + prefs/swaps guidance for the agent to write. Degrades gracefully to reflect-only when fewer than 2 past verdicts exist (single trajectory).',
  phases: [
    { title: 'Gather', detail: 'one subagent reads the full trajectory: taste-profile.md + prefs.log.jsonl + examples/positive + swaps.jsonl' },
    { title: 'Reflect', detail: '≥2 cross-family reflectors (Claude/Agent + codex via run_codex.sh; gemini if present) each propose a sharper rubric / voice signature / generation recipe' },
    { title: 'Validate', detail: 'Pareto-select: a blind judge scores each candidate by how well it reproduces the user’s past verdicts; survivors are the non-dominated ones (skipped when n<2)' },
    { title: 'Commit', detail: 'synthesize the surviving candidates into one updated taste-profile + recipe + appended prefs/swaps guidance, returned as structured data for the agent to write' },
  ],
}

/*
 * palate distillation workflow — the CC-native, Workflow-backed path for the
 * `palate` mode (Taste Writing Studio). The session agent does the cheap
 * deterministic prep (resolves the active content-set, reads
 * `.pneuma/cross-family.json`) then hands the work here via `args`. This
 * script owns what a single context can't do well: reading the full
 * trajectory in a fresh context, running >=2 *cross-family* reflectors
 * (which break each model out of its own RLHF attractor basin), and — the
 * anti-drift part the chat-only experiment did by hand — scoring each
 * candidate rubric by how faithfully it reproduces the user's PAST verdicts
 * before any of them is allowed to ship.
 *
 * It returns the synthesized artifacts as DATA; the session agent performs
 * the actual file writes (taste-profile.md / recipes/<content-type>.md /
 * appended prefs.log.jsonl + swaps.jsonl) with its native Edit/Write tools.
 * This mirrors the source experiment's "all learning is disciplined file
 * updates" discipline and palate's §3.3 state-ownership rule: taste/ is
 * agent-owned, never mutated by anything but the agent's own tools.
 *
 * ── Path / shape note for the SKILL author (sibling task) ─────────────────
 * This artifact lives at `skill/workflows/distill.workflow.js` (installed to
 * `<skillsDir>/pneuma-palate/workflows/distill.workflow.js`). cosmos's
 * precedent puts its workflow under `skill/references/projection.workflow.js`;
 * we DEVIATE to `workflows/` because that directory name reads as exactly what
 * the file is (a launchable workflow, not reference prose) and the dispatch
 * brief named this path. The launch call the SKILL.md should use (Claude
 * backend only — the Workflow tool is CC-native) is:
 *
 *   Workflow({
 *     scriptPath: ".claude/skills/pneuma-palate/workflows/distill.workflow.js",
 *     args: { contentType, language, trajectory, reflectors, contentSetLabel }
 *   })
 *
 * When the Workflow tool is absent (Codex / Kimi orchestrators), the SKILL.md
 * must fall back to a MANUAL fan-out: shell out >=2 cross-family reflectors
 * with run_codex.sh / run_gemini.sh, then eyeball the verdict-reproduction
 * check by hand. This script is the automated path; the prompts below are the
 * source of truth the manual fallback should paraphrase.
 *
 * args: {
 *   contentType: string,             // e.g. "longform" — names the recipe file the commit targets
 *   language?: string,               // user working language for prose (default the trajectory's language)
 *   contentSetLabel?: string,        // human label of the writing project, for prompts
 *   trajectory: {                    // the FULL session trajectory, gathered by the agent OR by the Gather phase
 *     tasteProfile?: string,         // current taste/taste-profile.md text (may be the generic bootstrap)
 *     prefsJsonl?: string,           // taste/prefs.log.jsonl raw text (one judgment per line)
 *     swapsJsonl?: string,           // taste/swaps.jsonl raw text (AI->human sentence pairs)
 *     positives?: Array<{ name: string, text: string }>,  // accepted / voice-anchor texts (examples/positive)
 *   },
 *   reflectors?: Array<{             // which cross-family reflectors to run (>=2). Defaults below.
 *     family: string,                // "claude" | "codex" | "gemini"
 *     available?: boolean,           // from .pneuma/cross-family.json; absent families are dropped
 *   }>,
 *   maxReflectors?: number,          // cap (default 3)
 * }
 *
 * Returns: {
 *   updatedTasteProfile: string,     // the synthesized taste-profile.md the agent should write
 *   recipe: { contentType, markdown },  // recipes/<contentType>.md the agent should write
 *   prefsGuidance: string[],         // bullets to APPEND as a distill summary into prefs.log context
 *   swapsGuidance: string[],         // symbol-layer collection guidance (what to mine next)
 *   stats: { reflectors, candidates, validated, survivors, families, degraded },
 * }
 */

// args may arrive as an object or, depending on how the call is serialized,
// as a JSON string — normalize both (cosmos precedent).
let A = args
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch { A = {} }
}
A = A || {}

const contentType = (A.contentType && String(A.contentType)) || 'general'
const contentSetLabel = A.contentSetLabel ? String(A.contentSetLabel) : 'this writing project'
const trajectoryIn = A.trajectory || {}
const language = A.language || trajectoryIn.language || 'the user’s working language'
const maxReflectors = Number.isInteger(A.maxReflectors) ? A.maxReflectors : 3

// Default reflector roster — Claude (in-process Agent, isolated fresh context)
// + codex (the validated 2-family minimum) + gemini (neutral third when present).
const REFLECTOR_DEFAULTS = [
  { family: 'claude', available: true },
  { family: 'codex', available: true },
  { family: 'gemini', available: true },
]
const reflectorRoster = (Array.isArray(A.reflectors) && A.reflectors.length
  ? A.reflectors
  : REFLECTOR_DEFAULTS
)
  .filter((r) => r && r.family && r.available !== false)
  .slice(0, maxReflectors)

log(`palate-distill: contentType=${contentType}; reflectors=${reflectorRoster.map((r) => r.family).join(',') || 'NONE'}`)

// pneuma:pure:start
// Deterministic, injected-global-free helpers. Fenced between markers so the
// test suite (modes/palate/__tests__/distill-workflow.test.ts) can extract and
// execute them in isolation — this is the GEPA anti-drift core and MUST be
// correct, so it is unit-tested directly against the shipped source. Touch
// nothing outside this region from in here (no agent/parallel/args/Date/random).

// A "past verdict" is any prefs.log line carrying a real judgment signal:
// an `event` (reject / better / accept-ish / surgical-fix / ...), an explicit
// `verdict` string, or a family `prefer` ("gpt>claude"). Lines that are pure
// notes / metadata are not verdicts and must not inflate the n>=2 gate.
function parseVerdicts(prefsJsonl) {
  const out = []
  if (!prefsJsonl || typeof prefsJsonl !== 'string') return out
  const lines = prefsJsonl.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    if (!rec || typeof rec !== 'object') continue
    const decision =
      typeof rec.event === 'string' ? rec.event
        : typeof rec.verdict === 'string' ? rec.verdict
          : null
    const prefer = typeof rec.prefer === 'string' ? rec.prefer : null
    // No judgment signal at all → not a usable past verdict.
    if (decision == null && prefer == null) continue
    const symptoms = Array.isArray(rec.symptom_tags)
      ? rec.symptom_tags.filter((s) => typeof s === 'string')
      : []
    out.push({ index: out.length, raw: rec, decision, prefer, symptoms })
  }
  return out
}

// Pareto anti-drift validation is only meaningful when there are >=2 past
// verdicts to reproduce (a single trajectory can't reveal over-fitting). With
// n<2, reflect still runs but validate degrades — the SKILL's n<2 contract.
function shouldValidate(verdicts) {
  return Array.isArray(verdicts) && verdicts.length >= 2
}

// A candidate rubric's score = the fraction of past verdicts a blind judge
// reproduced while applying ONLY that candidate. High score == low drift.
function scoreCandidate(agreements, total) {
  if (!total || total <= 0) return 0
  let agreed = 0
  for (const a of agreements || []) if (a && a.agree) agreed++
  return agreed / total
}

// Keep the non-dominated candidates (Pareto frontier over score x coverage)
// rather than collapsing to a single argmax — co-optimal reflectors carry
// genuinely different sharpenings, and the commit step synthesizes across the
// survivors. A candidate is dropped only if another beats it on BOTH axes.
function paretoSurvivors(candidates) {
  const list = Array.isArray(candidates) ? candidates : []
  return list.filter((c) => {
    if (!c) return false
    return !list.some(
      (o) =>
        o &&
        o !== c &&
        o.score >= c.score &&
        o.coverage >= c.coverage &&
        (o.score > c.score || o.coverage > c.coverage),
    )
  })
}
// pneuma:pure:end

// ── Shared prompt fragments ──────────────────────────────────────────────────

const RULES = `
Discipline (palate distillation — from the validated reflect->validate->commit method):
- Prose (rubric titles, recipe text, voice notes) in ${language}; structural keys (symptom ids S1..S7, content-type, jsonl field names) stay stable.
- The goal is "reach the quality the USER accepted", not "imitate the user". Voice is a FLOOR; taste is the target.
- A sharper rubric means: better discriminators, phrase-level "tells", merged/split/reordered symptoms — NOT more symptoms for their own sake.
- A generation recipe is operational: an inject-and-go prompt for THIS content-type that aims to hit the accepted version in one or two steps, NOT climb the ladder from rung 0. Distillation succeeds when the ladder is flattened.
- The symbol layer (metaphors / aphorisms) is the deepest AI tell; a model cannot invent a human replacement — it must be MINED from the user's own sentences (swaps.jsonl). Say what to collect next, do not fabricate swaps.
- n=1 honesty: everything here is a small-sample strong-hypothesis, never locked truth.`

function trajectoryBlock(t) {
  const parts = []
  if (t.tasteProfile) parts.push(`# Current taste-profile.md\n${t.tasteProfile}`)
  if (t.prefsJsonl) parts.push(`# prefs.log.jsonl (the user's judgments, one per line)\n${t.prefsJsonl}`)
  if (t.swapsJsonl) parts.push(`# swaps.jsonl (AI->human sentence pairs already mined)\n${t.swapsJsonl}`)
  if (Array.isArray(t.positives) && t.positives.length) {
    parts.push(
      `# Accepted / voice-anchor texts (the gold standard)\n` +
        t.positives.map((p) => `## ${p.name}\n${p.text || ''}`).join('\n\n'),
    )
  }
  return parts.length ? parts.join('\n\n---\n\n') : '(no trajectory text provided — ask the agent to gather it)'
}

// The reflector prompt. `family` steers whether the leaf does the reflection
// itself (claude/Agent — naturally an isolated fresh context) or shells out to
// the other family's CLI via the palate-owned scripts (codex/gemini). The
// workflow is a pure coordinator: the leaf agent owns the Bun.spawn.
function reflectPrompt(family, trajText) {
  const crossFamilyInstruction =
    family === 'claude'
      ? `You ARE the reflector (Claude family) — reflect directly. You have a fresh context; read the entire trajectory before answering.`
      : `Reflect via the ${family} family to escape your own model's RLHF attractor basin. Write the prompt below to a temp file and shell out:\n` +
        `  - codex: run \`bash <skillDir>/scripts/run_codex.sh <promptfile>\` (wraps codex exec --skip-git-repo-check)\n` +
        `  - gemini: run \`bash <skillDir>/scripts/run_gemini.sh <promptfile>\` (gemini non-interactive)\n` +
        `Then return THAT family's answer, normalized into the schema. If the CLI is missing or errors, say so in \`notes\` and fall back to reflecting yourself.`

  return `You are a REFLECTOR distilling a finished palate writing session for ${contentSetLabel} (content-type: ${contentType}).

${crossFamilyInstruction}

Read the full trajectory below. Answer the one GEPA question:
"What sharper rubric / voice signature / generation recipe would make the generator hit the version the user ACCEPTED on the first try — flattening the disruption ladder?"

Trajectory:
${trajText}

Produce three things:
1. rubricDelta: concrete sharpenings to the symptom rubric (better tells, phrase templates, merges/splits, new symptoms). Each as { id?, change, why }.
2. recipe: an operational, inject-and-go generation recipe for ${contentType} (markdown) that targets the accepted quality directly. Fold in any structural-disruption + readability constraints the trajectory revealed.
3. voiceSignature: 2-5 bullets naming the user's voice floor (breathing/hedging habits, metaphor style, structural preferences) AND the AI-symptoms they reject hardest.
Plus: collectNext (what symbol-layer material to mine next), notes (caveats, family used).

${RULES}

Return JSON.`
}

const REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    family: { type: 'string' },
    rubricDelta: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          change: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['change'],
        additionalProperties: false,
      },
    },
    recipe: { type: 'string', description: 'Operational generation recipe (markdown) for the content-type.' },
    voiceSignature: { type: 'array', items: { type: 'string' } },
    collectNext: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['rubricDelta', 'recipe', 'voiceSignature'],
  additionalProperties: false,
}

// The validate judge. A candidate is one reflector's proposed rubric. The
// judge applies ONLY that candidate's rubric and predicts the user's verdict
// for each PAST trajectory verdict; agreement == low drift. This is the
// Pareto anti-drift step: a clever-but-wrong reflection mispredicts known
// judgments and scores low, so it can't dominate the survivors.
function judgePrompt(candidate, verdicts) {
  const verdictLines = verdicts
    .map(
      (v) =>
        `  - verdict#${v.index}: decision="${v.decision || ''}"` +
        (v.prefer ? ` prefer="${v.prefer}"` : '') +
        (v.symptoms.length ? ` symptom_tags=[${v.symptoms.join(',')}]` : '') +
        (typeof v.raw.note === 'string' ? ` note="${v.raw.note.slice(0, 120)}"` : ''),
    )
    .join('\n')

  return `You are a BLIND JUDGE testing one candidate taste-rubric for anti-drift. Apply ONLY the candidate rubric below — ignore your own taste.

Candidate rubric delta + voice signature:
${JSON.stringify({ rubricDelta: candidate.rubricDelta, voiceSignature: candidate.voiceSignature }, null, 2)}

Below are the user's PAST verdicts from this session. For each, decide: if the generator had been driven by THIS candidate rubric, would the candidate have PREDICTED the same judgment the user actually made (rejecting what the user rejected, preferring the family the user preferred, flagging the symptoms the user flagged)? Default to agree=false when the candidate is silent on a verdict's signal — a rubric that can't speak to a known judgment did not reproduce it.

Past verdicts:
${verdictLines}

Also report \`coverage\`: the fraction of these verdicts the candidate's rubric meaningfully ADDRESSES at all (0-1), so a rubric that agrees by being vague is penalized.

Return {agreements:[{verdictIndex, agree, reason?}], coverage}.`
}

const JUDGMENT_SCHEMA = {
  type: 'object',
  properties: {
    agreements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          verdictIndex: { type: 'integer', minimum: 0, maximum: 100000 },
          agree: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['verdictIndex', 'agree'],
        additionalProperties: false,
      },
    },
    coverage: { type: 'number' },
  },
  required: ['agreements', 'coverage'],
  additionalProperties: false,
}

function commitPrompt(survivors, currentProfile, verdictCount, degraded) {
  return `You are SYNTHESIZING the final palate taste artifacts for ${contentSetLabel} (content-type: ${contentType}) from the surviving distilled candidates.

${degraded
      ? `NOTE: only ${verdictCount} past verdict(s) existed, so the Pareto validation was SKIPPED (single-trajectory degradation). Treat every candidate as a hypothesis of equal standing; lean on the reflection that best flattens the ladder, and mark new claims as n-small strong-hypotheses.`
      : `These ${survivors.length} candidate(s) survived Pareto validation against ${verdictCount} past verdicts — they reproduce the user's known judgments best. Synthesize across them; where they agree, the signal is strong; where they diverge, prefer the sharper, more concrete sharpening.`}

Current taste-profile.md (preserve its structure — §0 calibration / §1 voice floor / §2 symptom rubric / §3+ discipline / meta-principles):
${currentProfile || '(none — write a fresh profile in that structure)'}

Surviving candidates:
${JSON.stringify(survivors.map((s) => ({ family: s.family, rubricDelta: s.rubricDelta, recipe: s.recipe, voiceSignature: s.voiceSignature, collectNext: s.collectNext, score: s.score, coverage: s.coverage })), null, 2)}

${RULES}

Produce:
- updatedTasteProfile: the FULL rewritten taste-profile.md (same section structure, sharper rubric folded in, launch rung re-calibrated if the trajectory justifies it).
- recipe.markdown: the operational recipes/${contentType}.md (inject-and-go, ladder-flattening).
- prefsGuidance: 2-5 bullets summarizing what this distillation learned (for the distill changelog the agent appends).
- swapsGuidance: 1-4 bullets on which symbol-layer (metaphor/aphorism) material to mine from the user next.

Return {updatedTasteProfile, recipe:{contentType, markdown}, prefsGuidance, swapsGuidance}.`
}

const COMMIT_SCHEMA = {
  type: 'object',
  properties: {
    updatedTasteProfile: { type: 'string' },
    recipe: {
      type: 'object',
      properties: {
        contentType: { type: 'string' },
        markdown: { type: 'string' },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
    prefsGuidance: { type: 'array', items: { type: 'string' } },
    swapsGuidance: { type: 'array', items: { type: 'string' } },
  },
  required: ['updatedTasteProfile', 'recipe'],
  additionalProperties: false,
}

// ── Orchestration ────────────────────────────────────────────────────────────

// Phase 1 — gather. If the agent didn't pre-fill the trajectory text, a single
// fresh-context subagent reads it off disk; otherwise we use what was passed.
phase('Gather')
let trajectory = trajectoryIn
const haveTrajectoryText =
  trajectoryIn.tasteProfile || trajectoryIn.prefsJsonl || trajectoryIn.swapsJsonl ||
  (Array.isArray(trajectoryIn.positives) && trajectoryIn.positives.length)
if (!haveTrajectoryText) {
  const gathered = await agent(
    `Read the palate taste trajectory for the active content-set (${contentSetLabel}). From the workspace, read:\n` +
      `  - taste/taste-profile.md (the current rubric + voice floor)\n` +
      `  - taste/prefs.log.jsonl (every judgment, raw)\n` +
      `  - taste/swaps.jsonl (mined AI->human pairs, if present)\n` +
      `  - examples/positive/* OR materials/voice/* (accepted / anchor texts)\n` +
      `Return their raw contents verbatim — do NOT summarize. positives[] is a list of {name, text}.`,
    {
      phase: 'Gather',
      label: 'gather-trajectory',
      schema: {
        type: 'object',
        properties: {
          tasteProfile: { type: 'string' },
          prefsJsonl: { type: 'string' },
          swapsJsonl: { type: 'string' },
          positives: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, text: { type: 'string' } },
              required: ['name'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  ).catch(() => null)
  if (gathered) trajectory = { ...trajectoryIn, ...gathered }
}

const verdicts = parseVerdicts(trajectory.prefsJsonl)
const trajText = trajectoryBlock(trajectory)
log(`gathered trajectory: ${verdicts.length} past verdict(s)`)

// Phase 2 — reflect: fan out >=2 cross-family reflectors, barrier so validate
// can score the full candidate set against each other (Pareto needs the set).
phase('Reflect')
const reflections = await parallel(
  reflectorRoster.map((r, i) => () =>
    agent(reflectPrompt(r.family, trajText), {
      schema: REFLECTION_SCHEMA,
      phase: 'Reflect',
      // claude reflects in-process via an isolated Agent subagent; codex/gemini
      // are reached by the leaf shelling out, so no special model override here.
      label: `reflect:${r.family || i}`,
    }).then((res) => (res ? { family: r.family, ...res } : null)),
  ),
)
let candidates = reflections.filter(Boolean)
log(`reflect: ${reflectorRoster.length} reflectors -> ${candidates.length} candidate(s)`)

if (!candidates.length) {
  // Nothing came back — surface it rather than fabricate artifacts.
  throw new Error('palate-distill: no reflector produced a candidate; cannot distill')
}

// Phase 3 — validate: Pareto-select against past verdicts. DEGRADES when n<2
// (single trajectory) — reflect already ran; we just skip scoring and keep all.
const degraded = !shouldValidate(verdicts)
let survivors = candidates
let validated = false
if (degraded) {
  log(`validate: only ${verdicts.length} past verdict(s) (<2) — Pareto validation skipped, keeping all ${candidates.length} candidate(s)`)
} else {
  phase('Validate')
  const scored = await parallel(
    candidates.map((c, i) => () =>
      agent(judgePrompt(c, verdicts), {
        schema: JUDGMENT_SCHEMA,
        phase: 'Validate',
        label: `judge:${c.family || i}`,
      })
        .then((j) => {
          const score = scoreCandidate(j?.agreements, verdicts.length)
          const coverage = typeof j?.coverage === 'number'
            ? Math.max(0, Math.min(1, j.coverage))
            : 0
          return { ...c, score, coverage }
        })
        .catch(() => ({ ...c, score: 0, coverage: 0 })),
    ),
  )
  const scoredCandidates = scored.filter(Boolean)
  survivors = paretoSurvivors(scoredCandidates)
  validated = true
  log(
    `validate: ${scoredCandidates.length} scored -> ${survivors.length} Pareto survivor(s) ` +
      `(scores ${scoredCandidates.map((s) => s.score.toFixed(2)).join('/')})`,
  )
}

// Defensive: candidates that never went through validate carry no score —
// give them a neutral one so the commit prompt's JSON is well-formed.
survivors = survivors.map((s) => ({
  score: typeof s.score === 'number' ? s.score : 0,
  coverage: typeof s.coverage === 'number' ? s.coverage : 0,
  ...s,
}))

// Phase 4 — commit: synthesize the survivors into the artifacts. The workflow
// RETURNS them; the agent does the real file writes (taste/ is agent-owned).
phase('Commit')
const committed = await agent(
  commitPrompt(survivors, trajectory.tasteProfile, verdicts.length, degraded),
  { schema: COMMIT_SCHEMA, phase: 'Commit', label: 'synthesize' },
)

const families = [...new Set(candidates.map((c) => c.family).filter(Boolean))]
const recipe = committed.recipe || { contentType, markdown: '' }
if (!recipe.contentType) recipe.contentType = contentType

return {
  updatedTasteProfile: committed.updatedTasteProfile,
  recipe,
  prefsGuidance: committed.prefsGuidance || [],
  swapsGuidance: committed.swapsGuidance || [],
  stats: {
    reflectors: reflectorRoster.length,
    candidates: candidates.length,
    validated,
    survivors: survivors.length,
    families,
    degraded,
    pastVerdicts: verdicts.length,
  },
}
