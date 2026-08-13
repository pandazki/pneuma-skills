// plan-lecture — design the lecture before any of it is written on the board.
//
// The failure this exists to prevent, measured on a real four-board wall:
// three faces at 46% of their width and ZERO figures, in a lecture whose
// central idea was a picture. Every sentence in it read fine. Nothing was
// decided badly — nothing was decided at all, because writing prose section
// by section never produces a moment where the whole is chosen.
//
// SKILL.md carries the same strategy in words, for every backend. This file
// is the Claude-Code half, and what it adds is not more advice: it is an
// ORDER OF WORK that cannot be skipped. Prose can ask an agent under
// pressure to produce to stop and design first; a workflow makes designing
// the only way to reach the writing. The stages differ in kind, too —
// rival arcs are generated in parallel by agents that cannot see each
// other's answer, and the design is critiqued by an agent that did not
// write it. Neither is available to a document.
//
// It ends by WRITING `<contentSet>/plan.md` and returns its path. It never
// writes `board.md` — the calling session does that, one passage at a time,
// holding what stands against the design.
//
// How to call it, from inside a bansho session:
//   Workflow({ name: 'plan-lecture', args: { topic, contentSet, boards, minutes, language } })
//   Workflow({ scriptPath: `${PNEUMA_SESSION_DIR}/.claude/workflows/plan-lecture.js`, args: {...} })
// `args` may be a JSON string or an object.

export const meta = {
  name: 'plan-lecture',
  description:
    "Design a board lecture before writing it: propose rival arcs, judge them, write <contentSet>/plan.md with every passage's medium (prose / figure / formula / worked example), room (which board, which column, in @at words) and rough length, then critique the design for missing pictures and unused columns. Produces the plan only — the session writes the board against it.",
  phases: [{ title: 'Arcs' }, { title: 'Design' }, { title: 'Critique' }],
}

const A = typeof args === 'string' ? JSON.parse(args) : args || {}

const TOPIC = A.topic || ''
const SET = A.contentSet || ''
const BOARDS = Number(A.boards) > 0 ? Number(A.boards) : 3
const MINUTES = Number(A.minutes) > 0 ? Number(A.minutes) : 6
const LANGUAGE = A.language || "the user's language"
const CWD = A.cwd || process.env.PNEUMA_SESSION_DIR || '.'

if (!TOPIC || !SET) {
  return {
    status: 'FAILED',
    reason:
      'plan-lecture needs both `topic` (what the lecture explains) and `contentSet` (the lecture directory, where plan.md and board.md live).',
  }
}

const PLAN_PATH = `${CWD}/${SET}/plan.md`
const COLUMNS = BOARDS * 2

// Shared ground every agent is handed. Kept in one place because a rule
// stated differently to the proposer and to the critic is a rule that gets
// argued about instead of applied.
const GROUND = `
You are designing a lecture that a board will PERFORM: plain markdown in
\`${SET}/board.md\` is written out by a hand, at the speed a hand writes, while
the user watches. The room is ${BOARDS} board${BOARDS === 1 ? '' : 's'}.

The three facts that decide a design here:

1. A face fills in COLUMNS, not in one downward strip. ${BOARDS} boards is
   ${COLUMNS} columns. \`@at left\` / \`@at right\` place a passage in one column;
   \`@at full\` takes the face's width and always writes BELOW everything
   standing. A design that never says \`left\`/\`right\` uses ${BOARDS} columns of
   ${COLUMNS} and leaves the rest of the wall blank.
2. A passage that COUNTS, COMPARES, SPLITS or TRACES A FLOW is a PICTURE —
   a \`\`\`chart (trend lines) or \`\`\`graph (boxes and arrows). A passage that
   names or concludes is words. A formula is words that convince nobody who
   does not already believe them, so a formula is almost always followed by
   a picture.
3. Length is structure, not a schedule: a spoken sentence is 4-6 seconds, a
   three-sentence paragraph with its pauses 15-25, a chart layer 8-15 on top
   of the sentence that introduces it.

The lecture: ${TOPIC}
Target length: about ${MINUTES} minutes. Write the lecture's own content in
${LANGUAGE}.
`.trim()

const ARC_BRIEF = (angle) => `
${GROUND}

Propose ONE arc for this lecture, taking this angle: ${angle}

Give exactly:
- Q: the question the board opens on, one line.
- A: the payoff it closes on, one line. If the payoff restates the question,
  you have a topic and not a lecture — keep pulling.
- 3 to 6 passages, one line each: what it does, and whether it is prose /
  figure / formula / worked example. A passage is one thing the audience
  takes away, usually two to five board steps.
- One line on what this arc is BEST at, and one line on its weakness.

Do not write any board prose. Do not write any file. Return the arc as text.
`.trim()

phase('Arcs')
// Two proposers, in parallel and blind to each other. Rival arcs from one
// agent converge; from two they do not, and the choice is real.
const [arcA, arcB] = await parallel([
  () =>
    agent(ARC_BRIEF('the concrete case first — open on a specific worked situation and generalize from it'), {
      agentType: 'general-purpose',
      label: 'arc:concrete',
      phase: 'Arcs',
    }),
  () =>
    agent(ARC_BRIEF('the misconception first — open on the thing the audience already believes, then break it'), {
      agentType: 'general-purpose',
      label: 'arc:misconception',
      phase: 'Arcs',
    }),
])

phase('Design')
const design = await agent(
  `
${GROUND}

Two arcs were proposed for this lecture. Judge them and produce the design.

── ARC A ──
${arcA}

── ARC B ──
${arcB}

Pick the arc that gets the audience to the payoff with the fewest words, or
merge them if the merge is genuinely better than either — say in one line
which you did and why. Then WRITE the design to \`${PLAN_PATH}\` (create the
directory if needed) in exactly this shape:

# <lecture title> — plan   @board ${BOARDS} · ~${MINUTES} min

Q <the question, one line>
A <the payoff, one line>

| # | 内容 / what it does | medium | room | len |
|---|---|---|---|---|
| 1 | … | prose | b1 \`@at left\` | ~40s |
| 2 | … | FIGURE | b1 \`@at right\` | ~60s |

Rules the table must obey, and you are accountable for each:
- EVERY passage names a medium, a room and a length. No blanks.
- \`room\` is a board number plus an \`@at\` word — never a size, never a
  percentage.
- The lengths must sum to roughly ${MINUTES} minutes. Put the sum under the
  table. If it does not reach the target, the design is thin — add a passage
  or deepen one, do not pad a sentence.
- Under the table, one line per FIGURE saying what it draws (\`chart\` of what
  against what, or \`graph\` of which flow) — enough that the writer does not
  have to reinvent it.

Write the file. Then return: the path, the passage count, the figure count,
the column count you used out of ${COLUMNS}, and the length sum.
`.trim(),
  { agentType: 'general-purpose', label: 'design', phase: 'Design' },
)

phase('Critique')
// A different agent, reading the file rather than its own reasoning. The
// three checks are the three ways this design fails silently.
const critique = await agent(
  `
${GROUND}

Read \`${PLAN_PATH}\`. It is a design for the lecture above, written by another
agent. Critique it on exactly three axes and FIX what you find, in the file:

1. MISSING PICTURES — is there a passage that counts, compares, splits or
   traces a flow and is still marked \`prose\`? Is the lecture's CENTRAL idea
   drawn? A lecture whose central idea is a picture and which draws none is
   the failure this design step exists to prevent. Be specific: name the row.
2. UNUSED COLUMNS — count the distinct board+column slots the table uses,
   out of ${COLUMNS}. If a face carries two consecutive \`@at full\` passages,
   the second writes below the first and the face runs out at half its real
   capacity; those two usually want \`left\` then \`right\`. Figures and the
   prose that explains them are a \`left\`/\`right\` pair.
3. LENGTH — do the estimates sum to roughly ${MINUTES} minutes, and is any
   single passage more than about a third of the whole?

Fix the table in place — you may change a medium, a room or a length, and
you may add or drop a passage. Do not rewrite the arc unless it is broken.
Do not write \`board.md\`; do not write any lecture prose.

Return: what you changed and why (one line each), then the final numbers —
passages, figures, columns used out of ${COLUMNS}, length sum.
`.trim(),
  { agentType: 'general-purpose', label: 'critique', phase: 'Critique' },
)

log(`plan-lecture — design written to ${PLAN_PATH}`)

return {
  status: 'PLANNED',
  planPath: PLAN_PATH,
  room: { boards: BOARDS, columns: COLUMNS, targetMinutes: MINUTES },
  arcs: { concrete: arcA, misconception: arcB },
  design,
  critique,
  next: `Read ${PLAN_PATH}, then write ${SET}/board.md one passage at a time: write it, let it play, glance-board, hold what stands against the design, next. When reality disagrees with the design, edit ${PLAN_PATH} and say in one line what changed and why.`,
}
