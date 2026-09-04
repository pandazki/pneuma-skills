/**
 * plan-course — ground a plotwise course so the play loop never has to.
 *
 * Two phases, and the course is usable after the first:
 *
 *   Outline    one agent proposes the master outline — beats, tiers,
 *              figure specs, and the VISUAL LAYER (each beat's device,
 *              plus the course's visual bible) — and LANDS all of it in
 *              course.json at once (course-edit.mjs outline). The viewer
 *              shows the beats, n1 is minted, and the opening can be shot
 *              while grounding is still running — an opening rarely needs
 *              a figure. The device is here and not with the writer
 *              because a writer handed a bare concept answers with a
 *              talking illustration, and because one running example has
 *              to carry the whole course, which no single scene can see.
 *   Grounding  the first beat that needs work gets its own agent, the rest
 *              are chunked; every agent COMMITS each beat's evidence into
 *              course.json the moment that beat is done (course-edit.mjs
 *              evidence), so segments pick up figures as they land and the
 *              viewer's "N/M 拍已接地" moves. Nothing waits for everything.
 *
 * There is no assembling agent at the end: the outline and the evidence
 * index are written by deterministic script ops, and the deterministic
 * `course-edit.mjs audit` is what the session runs to see what is missing.
 * The first course planned the old way blocked on all beats and an LLM
 * audit for 30-40 minutes before the first clip, while its grounding
 * agents downloaded PDFs and read pages as images; every rule below that
 * caps the work per beat exists because of that run.
 *
 * Args (from the session): { topic, contentSet, goal?, depth?, language?,
 * cwd, skillScripts? }. `cwd` is the session dir (the sandbox has no
 * `process`); `skillScripts` defaults to the installed skill's scripts dir.
 */

export const meta = {
  name: 'plan-course',
  description:
    "Ground a plotwise course before shooting: propose the master outline — with each beat's visual device and the course's visual bible — and land it in course.json at once, then ground every beat (citations searched, derivations run as code, knowledge figures rendered by code into evidence/) with each beat committed to course.json the moment it is done. The opening can be shot as soon as the outline lands.",
  phases: [
    { title: 'Outline', detail: 'one agent; the outline and its visual layer land in course.json' },
    { title: 'Grounding', detail: 'first beat alone, the rest chunked; each beat commits itself' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args || {}

const TOPIC = A.topic || ''
const SET = A.contentSet || ''
const GOAL = A.goal || ''
const DEPTH = ['light', 'standard', 'deep'].includes(A.depth) ? A.depth : 'standard'
const LANGUAGE = A.language || "the user's language"
// The workflow sandbox has no `process` global — the session passes cwd
// explicitly (SKILL.md documents the call shape).
const CWD = A.cwd || '.'
const SKILL_SCRIPTS = A.skillScripts || `${CWD}/.claude/skills/pneuma-plotwise/scripts`

if (!TOPIC || !SET) {
  return {
    status: 'FAILED',
    reason:
      'plan-course needs both `topic` (what the course teaches) and `contentSet` (the course directory, where course.json and evidence/ live).',
  }
}

const BEAT_RANGE = { light: '4-6', standard: '6-10', deep: '10-14' }[DEPTH]
const SET_DIR = `${CWD}/${SET}`
const COURSE_PATH = `${SET_DIR}/course.json`
const EVIDENCE_DIR = `${SET_DIR}/evidence`
const COURSE_EDIT = `node ${SKILL_SCRIPTS}/course-edit.mjs`

// Shared ground every agent is handed. One text, so the rule the proposer
// works under is the rule the grounders follow.
const GROUND = `
You are planning an interactive learning-video course ("${TOPIC}"${GOAL ? ` — goal: ${GOAL}` : ''}).
The course is a MASTER OUTLINE of beats; at play time each beat becomes
5-15s narrated video segments and the learner branches between them. The
outline is the attention anchor — branches always return to it.

The four facts that decide a plan here:

1. EVERY BEAT CARRIES AN ACCURACY TIER, decided now and nowhere else:
   - world-knowledge: uncontroversial textbook fact. No lookup.
   - citation: specific / niche / recent / contested. Must be searched and
     pinned to sources a learner could be shown.
   - code-verification: derivable or checkable (math, algorithms, data,
     conversions). Must be derived or checked by code that is actually run.
2. KNOWLEDGE VISUALS ARE RENDERED BY CODE AT PLANNING TIME. Any beat whose
   segments will want a formula, plot, coordinate system, diagram or table
   on screen needs that figure produced NOW — matplotlib via Python, or a
   hand-authored SVG (converted to PNG beside it for the video model) —
   correct first, styled second. Few, large labels: the video model
   reproduces a figure with three big labels and garbles one with twenty
   small ones. ONE figure per idea in a screen-like shape — 16:9 or 4:3,
   never wider than 2.5:1 or taller than 1:2.5 (a three-panel strip is
   rejected by the video model's reference upload; make three figures
   instead). NEVER use image-generation models for knowledge figures.
3. HEAVY WORK LIVES HERE. The per-segment loop during play must never need
   a search or a derivation; if a beat would force one mid-course, the
   plan is wrong.
4. THE IDEA GETS A DEVICE, THE FACT GETS A FIGURE. Every beat also names a
   VISUAL DEVICE — the concrete objects, metaphor or character the audience
   SEES carrying that beat's idea. It is what the writer films, and it is
   decided here: a beat handed a bare concept comes back as a talking
   illustration. A device is not a figure — the device carries the IDEA
   (coins that breed), a figure carries an exact FACT (the labelled curve
   with its values). Most beats need only a device.

Write course-facing text (beat titles, summaries, devices, the visual
bible, evidence notes) in ${LANGUAGE}.
`.trim()

const OUTLINE_SCHEMA = {
  type: 'object',
  required: ['beats', 'visual', 'landed'],
  properties: {
    beats: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'summary', 'tier', 'device'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          tier: { type: 'string', enum: ['world-knowledge', 'citation', 'code-verification'] },
          device: {
            type: 'string',
            description: "what the audience SEES carrying this beat's idea — concrete, filmable, style-agnostic",
          },
          figures: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    visual: {
      type: 'object',
      required: ['bible', 'motifs', 'neverDraw'],
      description: 'how the course looks as a whole — style-agnostic',
      properties: {
        bible: { type: 'string' },
        motifs: { type: 'array', items: { type: 'string' } },
        neverDraw: { type: 'array', items: { type: 'string' } },
      },
    },
    landed: { type: 'boolean', description: 'true only if course-edit.mjs outline printed a JSON result' },
  },
}

phase('Outline')
const outline = await agent(
  `
${GROUND}

Propose the master outline: ${BEAT_RANGE} beats (depth: ${DEPTH}).

A beat is one thing the learner must take away — the spine, not the
detours (branches and side quests are minted at play time). Order them so
each beat earns the next; the FIRST beat is the opening — the hook the
whole course is remembered by, and it should need no figure. For each
beat give:
- id: "b1", "b2", ... in order
- title: one line, in ${LANGUAGE}
- summary: one line — what the learner can do/say after it, in ${LANGUAGE}
- tier: world-knowledge | citation | code-verification
- device: one or two sentences, in ${LANGUAGE}, naming the concrete
  objects, metaphor or character the audience SEES carrying this beat's
  idea — what a camera could film, never the concept restated. For
  compound interest: "a coin that buds a second coin, then both bud
  again, and the pile climbs one step higher each time" — NOT "the
  exponential effect of interest earning interest".
  STYLE-AGNOSTIC: no palette, material, lighting or camera words. The
  learner settles the style separately on the board, and the writer
  translates the device into the materials of the style they confirmed —
  so "flat vector coins in coral, seen top-down" is WRONG and "a coin
  that buds a second coin" is right.
  THE DEVICES COMPOSE: one running example carries the whole course, so
  each beat's device grows out of the one before it (the coins pile into
  a staircase, the staircase feeds a snowball) instead of opening a new
  world every beat.
- figures: array (possibly empty) of one-line specs, each naming a
  knowledge visual this beat's segments will need — WHAT it shows exactly
  (axes, labels, values), not how it should look. One idea per figure.
  A beat whose device is enough needs no figure: the device carries the
  idea, a figure carries a fact that must be exact on screen.

Then, for the course as a whole, a VISUAL BIBLE — also in ${LANGUAGE},
also style-agnostic:
- bible: one paragraph — how this course looks as a whole: where it
  happens, how the running example is drawn, what recurs from beat to
  beat, what makes the audience feel they are still inside the same
  course.
- motifs: 2-5 recurring things a viewer would notice a second time (the
  budding coin, the climbing pile, the margin of a notebook).
- neverDraw: what this course NEVER draws — whatever your topic invites
  and this pipeline cannot deliver. Almost always: a formula or a labelled
  axis with no rendered figure behind it, floating text, gradients. Add
  what your own topic tempts (for money: real metal coins, brand logos).

Then LAND it, so the course can start while grounding runs:
1. Write \`${SET_DIR}/outline.json\` as
   { "beats": [ <the beats, in order> ], "visual": { "bible": "...", "motifs": [...], "neverDraw": [...] } }
2. Run exactly: \`${COURSE_EDIT} outline --set ${SET_DIR} --file ${SET_DIR}/outline.json\`
   It merges into the existing course.json (title, topic, style and path
   are kept), mints the root node n1 on the first beat, records every
   world-knowledge beat that needs no figure as already grounded, and
   writes each beat's device plus the visual bible. Its JSON result
   reports \`devices\` (how many beats carry one) and \`visual\` (whether
   the bible landed) — check both are what you wrote. Never write
   course.json by hand.
Return the beats, the visual bible, and whether the command printed a
JSON result.
`.trim(),
  { agentType: 'general-purpose', label: 'outline', phase: 'Outline', schema: OUTLINE_SCHEMA },
)

if (!outline || !Array.isArray(outline.beats) || outline.beats.length === 0) {
  return { status: 'FAILED', reason: 'outline agent produced no beats' }
}
const beats = outline.beats
const visual =
  outline.visual && typeof outline.visual === 'object' && !Array.isArray(outline.visual) ? outline.visual : null
const LAND_CMD = `${COURSE_EDIT} outline --set ${SET_DIR} --file ${SET_DIR}/outline.json`
let landed = outline.landed === true
if (!landed) {
  // Grounding commits into the outline's beats (course-edit.mjs evidence
  // refuses a beat that is not in course.json), so nothing below is worth
  // paying for until the outline is on disk. One cheap, deterministic
  // attempt to land it; then stop, rather than ground into a void.
  log('outline agent did not confirm landing course.json — landing it now')
  const attempt = await agent(
    `
Land a course outline that was proposed but not committed.
1. Write this JSON to \`${SET_DIR}/outline.json\` verbatim if that file is
   missing, or if what is already there has no top-level "visual" key. It
   carries each beat's visual device and the course's visual bible — land
   it whole; without them the writer is handed a bare concept and answers
   with a talking illustration.
${JSON.stringify({ beats, ...(visual ? { visual } : {}) }, null, 2)}
2. Run exactly: \`${LAND_CMD}\`
Return whether the command printed a JSON result (a line starting with "{"), and its stderr verbatim if it failed.
`.trim(),
    {
      agentType: 'general-purpose',
      label: 'land-outline',
      phase: 'Outline',
      effort: 'low',
      schema: {
        type: 'object',
        required: ['landed'],
        properties: { landed: { type: 'boolean' }, error: { type: 'string' } },
      },
    },
  )
  landed = attempt?.landed === true
  if (!landed) {
    return {
      status: 'FAILED',
      reason: `the outline could not be landed in ${COURSE_PATH}${attempt?.error ? ` (${attempt.error})` : ''} — nothing was grounded. Run \`${LAND_CMD}\` yourself, read its error, then resume this workflow with resumeFromRunId (the outline agent's answer is cached).`,
      beats,
    }
  }
}
log(`outline landed: ${beats.length} beats in ${COURSE_PATH} — the opening can be shot now`)

// The visual layer is planning work, so a hole in it is REPORTED here
// rather than discovered as a talking illustration three phases later.
// `course-edit.mjs audit` names the same two holes from disk.
const warnings = []
const deviceless = beats.filter((b) => !String(b?.device ?? '').trim()).map((b) => b?.id ?? '?')
if (deviceless.length) {
  warnings.push(
    `beats [${deviceless.join(', ')}] have no visual device — their writer is handed a bare concept and answers with a talking illustration. Write one or two concrete, style-agnostic sentences for each into ${SET_DIR}/outline.json and re-run \`${LAND_CMD}\`.`,
  )
}
const bible = String(visual?.bible ?? '').trim()
if (!bible) {
  warnings.push(
    `the course has no visual bible — nothing says how it looks as a whole, so every scene invents its own world. Add "visual": { "bible", "motifs", "neverDraw" } to ${SET_DIR}/outline.json and re-run \`${LAND_CMD}\`.`,
  )
}
log(`visual layer: ${beats.length - deviceless.length}/${beats.length} beats carry a device, bible ${bible ? 'written' : 'MISSING'}`)

phase('Grounding')
// World-knowledge beats with no figures were recorded by the outline op.
// The first beat that needs work goes alone so its evidence lands first
// (the opening chains into it); the rest share up to three agents.
const needsWork = beats.filter(
  (b) => b && (b.tier !== 'world-knowledge' || (b.figures || []).length > 0),
)
const chunks = []
if (needsWork.length) {
  chunks.push([needsWork[0]])
  const rest = needsWork.slice(1)
  const n = Math.min(3, rest.length)
  for (let i = 0; i < rest.length; i++) (chunks[1 + (i % n)] = chunks[1 + (i % n)] || []).push(rest[i])
}
log(`grounding ${needsWork.length} of ${beats.length} beats in ${chunks.length} agent(s)`)

const GROUND_SCHEMA = {
  type: 'object',
  required: ['beats'],
  properties: {
    beats: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'committed', 'evidenceCount', 'problems'],
        properties: {
          id: { type: 'string' },
          committed: { type: 'boolean', description: 'course-edit.mjs evidence printed a JSON result for this beat' },
          evidenceCount: { type: 'integer' },
          problems: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const GROUNDING_BRIEF = (group) => `
${GROUND}

Ground these beats of the outline, ONE AT A TIME, committing each before
starting the next. Evidence for a beat lives under
\`${EVIDENCE_DIR}/<beatId>/\` (create it). A previous run may have left
files there already: reuse any file that matches its spec, do not redo it.

Python: if matplotlib is missing, build or reuse ONE virtualenv OUTSIDE
the course — \`python3 -m venv ~/.cache/pneuma/plotwise-py && ~/.cache/pneuma/plotwise-py/bin/pip install -q matplotlib numpy\`
— and run scripts with \`~/.cache/pneuma/plotwise-py/bin/python\`. NEVER
create a venv, install packages, or leave caches anywhere under
\`${CWD}\`: the viewer watches every file there, and a virtualenv's ten
thousand files silence it for the rest of the session.

Budget: at most 10 tool calls per beat. The tiers' work:
- citation → one web search; take the URL and a one-line note straight
  from the results. Two sources per beat are enough. Do NOT download
  PDFs, do NOT open pages as images, do NOT read whole papers — a pinned
  URL with an honest note is the deliverable. Write \`sources.json\`:
  [{ "url", "note" }] (notes in ${LANGUAGE}).
- code-verification → ONE script that derives or checks the claim, run
  once; keep the script and its output in the directory.
- every figure spec → ONE PNG by code (matplotlib, or SVG converted to
  PNG beside it) that matches the spec exactly — axes, labels, values —
  with few, large labels. Name files clearly.

COMMIT THE BEAT THE MOMENT IT IS DONE — the play loop reads course.json,
so a figure that is on disk but not committed is invisible to every
segment:
1. Write \`${EVIDENCE_DIR}/<beatId>/grounding.json\`:
   { "evidence": [ { "kind": "citation|code-verification|rendered-figure",
                     "file"?: "evidence/<beatId>/<file>", "url"?: "...",
                     "note": "<one line, ${LANGUAGE}>" } ],
     "problems": [ "<anything you could not verify or render — be
                    specific; an unverifiable claim is NAMED, never passed
                    silently>" ] }
   Paths are set-relative (\`evidence/<beatId>/...\`); one rendered-figure
   entry per PNG, one citation entry per URL, one code-verification entry
   per script/output pair.
2. Run exactly: \`${COURSE_EDIT} evidence --set ${SET_DIR} --beat <beatId> --file ${EVIDENCE_DIR}/<beatId>/grounding.json\`
   (it merges, checks the files exist, and records the problems).

Beats:
${JSON.stringify(group, null, 2)}

Return, per beat: id, whether the commit command printed a JSON result,
how many evidence entries you committed, and the problems verbatim.
`.trim()

const groundingResults = await parallel(
  chunks.map((group) => () =>
    agent(GROUNDING_BRIEF(group), {
      agentType: 'general-purpose',
      label: `ground:${group.map((b) => b.id).join(',')}`,
      phase: 'Grounding',
      schema: GROUND_SCHEMA,
    }),
  ),
)

// agent() failures resolve to null, not reject — a dead chunk must become
// a REPORTED hole, never a silently missing one.
let committed = 0
groundingResults.forEach((res, i) => {
  const ids = chunks[i].map((b) => b.id).join(',')
  if (res == null) {
    warnings.push(`grounding agent for beats [${ids}] died — their evidence is MISSING; ground them by hand and commit with course-edit.mjs evidence`)
    return
  }
  for (const entry of res.beats || []) {
    if (entry.committed) committed += 1
    else warnings.push(`${entry.id}: evidence was not committed to course.json (${entry.evidenceCount} entries on disk?) — commit it with course-edit.mjs evidence`)
    for (const p of entry.problems || []) warnings.push(`${entry.id}: ${p}`)
  }
})
const alreadyGrounded = beats.length - needsWork.length
log(`grounding done: ${committed + alreadyGrounded}/${beats.length} beats carry evidence, ${warnings.length} warning(s)`)

return {
  status: 'PLANNED',
  coursePath: COURSE_PATH,
  evidenceDir: EVIDENCE_DIR,
  beatCount: beats.length,
  grounded: committed + alreadyGrounded,
  devices: beats.length - deviceless.length,
  visualBible: Boolean(bible),
  warnings,
  next: `Run \`${COURSE_EDIT} audit --set ${SET_DIR}\` and read its problems (per beat) and its top-level \`problems\` (the course's). The outline has been in course.json since the Outline phase — the root should already be shooting; a segment for a beat with problems must not claim what could not be verified. A beat with no device or a course with no visual bible is a planning hole to fill BEFORE the screenplay is written, not something the writer can invent. Heavy verification is DONE — the play loop must not search, derive, or render.`,
}
