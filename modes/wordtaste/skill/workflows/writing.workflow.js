export const meta = {
  name: 'wordtaste-writing-loop',
  description: 'Two-level Chinese long-form loop: loose layout gate, sequential units, fresh-family check, and one repair pass',
  phases: [
    { title: 'Shape', detail: 'Plan the thesis, unit functions, and derived rhythm directions' },
    { title: 'Write', detail: 'Write sequential units from finished preceding prose' },
    { title: 'Check', detail: 'Check meaning and pattern collapse, then repair real issues' },
  ],
}

// Claude Workflow runtime only. Codex/Kimi must drive the same loop manually.
// args may arrive as an object or a JSON string.
const A = typeof args === 'string' ? JSON.parse(args) : args

const LAYOUT_SCHEMA = {
  type: 'object',
  required: ['title', 'thesis', 'units'],
  properties: {
    title: { type: 'string' },
    thesis: { type: 'array', items: { type: 'string' } },
    units: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'role', 'brief', 'rhythm', 'targetChars'],
        properties: {
          id: { type: 'string' },
          role: { type: 'string', description: 'What this unit does in the article; function before length or rhythm' },
          brief: { type: 'string' },
          rhythm: { type: 'string' },
          targetChars: { type: 'integer' },
          emphasis: { type: 'string' },
        },
      },
    },
    openQuestion: { type: 'string' },
  },
}

const CHECK_SCHEMA = {
  type: 'object',
  required: ['pass', 'kernelOk', 'summary', 'issues'],
  properties: {
    pass: { type: 'boolean' },
    kernelOk: { type: 'boolean' },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['quote', 'problem'],
        properties: {
          quote: { type: 'string' },
          problem: { type: 'string' },
        },
      },
    },
  },
}

phase('Shape')
const layout = await agent(
  `You are an isolated Chinese long-form planner. Plan only; do not write prose.

Goal:
${A.goal}

Frozen kernel:
${A.kernel}

Read ${A.skillDir}/references/workflow-design.md. Return a loose movement:
- individually addressable core claims;
- coherent sequential units, normally 600–1200 Chinese characters;
- for every unit, assign its function before length or rhythm: establish
  background, bring the problem into focus, reason step by step, state the
  conclusion, or close;
- derive different rhythm directions from those functions (directions, not metrics);
- make neighboring units change gear;
- no more than two or three suggested strongest landing points;
- one open question only when the user must decide it.

Do not turn this into a rigid detailed outline.`,
  { schema: LAYOUT_SCHEMA, label: 'layout', phase: 'Shape' },
)

if (!A.approved) {
  return {
    stage: 'layout',
    layout,
    next: 'Write this projection to workflow.json and return at the layout gate.',
  }
}

phase('Write')
let prose = ''
const unitDrafts = []
for (const unit of layout.units) {
  const draft = await agent(
    `You are an isolated Chinese prose writer.
Read ${A.skillDir}/references/generation.md and ${A.skillDir}/references/preset-default.md.

Goal:
${A.goal}

Frozen kernel:
${A.kernel}

Core claims:
${JSON.stringify(layout.thesis)}

This unit:
${unit.brief}

Functional role:
${unit.role}

Rhythm/length direction (not a score to optimize):
${unit.rhythm}; about ${unit.targetChars} Chinese characters.
${unit.emphasis ? `Strongest landing direction: ${unit.emphasis}` : ''}

User-marked strongest claims:
${JSON.stringify(A.emphasis || [])}

User layout note:
${A.layoutNote || '(none)'}

Finished prose before this unit:
${prose || '(first unit)'}

Write prose only. Grow naturally from the preceding text. Do not repeat its images, examples, or explanations.`,
    { label: `unit-${unit.id}`, phase: 'Write' },
  )
  unitDrafts.push(draft)
  prose = unitDrafts.join('\n\n')
}

phase('Check')
let check = await agent(
  `You are a blind Chinese prose judge. You did not write this draft.
Read ${A.skillDir}/references/judge-brief.md and ${A.skillDir}/references/preset-default.md.

Frozen kernel:
${A.kernel}

Core claims:
${JSON.stringify(layout.thesis)}

Check:
- meaning and fragile qualifications;
- joins and repeated images/examples;
- sentence/paragraph pattern collapse;
- whether every paragraph speaks at the same force instead of letting the
  problem and conclusion stand out in form;
- unnatural Chinese and polished-but-empty endings;
- readability as a separate axis.

Quote every issue. Report only; do not rewrite or rank.

Draft:
${prose}`,
  { schema: CHECK_SCHEMA, label: 'whole-check', phase: 'Check' },
)

if (check.issues.length > 0) {
  prose = await agent(
    `You are an isolated cross-family repairer. Repair only the quoted issues
below, preserve the frozen kernel, and return the complete revised prose.

Frozen kernel:
${A.kernel}

Issues:
${check.issues.map((issue) => `- "${issue.quote}": ${issue.problem}`).join('\n')}

Draft:
${prose}`,
    { label: 'repair', phase: 'Check' },
  )

  check = await agent(
    `You are the blind rechecker. Read ${A.skillDir}/references/judge-brief.md.
Verify every previous issue is fixed rather than moved into another form, and
report any new issue. Preserve meaning first.

Previous issues:
${check.issues.map((issue) => `- "${issue.quote}": ${issue.problem}`).join('\n')}

Frozen kernel:
${A.kernel}

Revised draft:
${prose}`,
    { schema: CHECK_SCHEMA, label: 'recheck', phase: 'Check' },
  )
}

const stage =
  check.kernelOk === false ? 'blocked' : check.pass ? 'done' : 'needs-review'

// blocked: do not overwrite an existing source draft.
// needs-review: do not start another internal repair loop.
return {
  stage,
  layout,
  prose,
  check,
  next:
    stage === 'blocked'
      ? 'Do not publish this prose or overwrite an existing source draft. Keep workflow.json at review and explain the hard blocker in plain language.'
      : stage === 'needs-review'
        ? 'Keep workflow.json at review or choice and present neutral alternatives. Do not start another internal repair loop.'
        : 'Write draft.md, set workflow.json to final, and translate judge language into plain user-facing copy.',
}
