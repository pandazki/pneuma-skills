/**
 * THE prompt assembler. Every English sentence a model reads is assembled here
 * out of `references/prompt-scaffolding.en.json` plus the parts a script
 * prepared — the plan prompt, one unit's brief, the writer/repair task message
 * and its standing system charter, the judge's brief, and the check/repair
 * tails.
 *
 * The functions between the `wordtaste:pure-region` markers are the single
 * implementation shared with the Claude Workflow path: a workflow script has
 * no filesystem, so `writing.workflow.js` carries a generated, type-stripped
 * copy of that region. Regenerate it with
 *
 *   bun modes/wordtaste/skill/scripts/generate_workflow_regions.ts
 *
 * and a test regenerates + diffs so the two can never drift. Nothing inside
 * the markers may import, reach for module state, or use a Node/Bun API.
 */

export interface RubricBlock {
  lead: string;
  bullets?: string[];
}

export interface RubricSection {
  heading: string;
  blocks: RubricBlock[];
}

/**
 * The writer's standing charter: who the writer is, why its prompt is built
 * out of human Chinese, where it sits in the loop, and how to treat each block
 * the task message may carry. Stated once, task-independent — it travels as a
 * system prompt where the route has that channel, and is prepended where it
 * does not.
 *
 * Two members are keyed by the workflow's entry (`draft` | `idea`), because
 * the two entries ask opposite things of the writer: rewriting treats the
 * material as the only source of facts and adds nothing; creation treats a
 * thin outline plus the author's own notes as a binding anchor the writer is
 * expected to develop, without introducing factual claims the material does
 * not support. An absent or unknown entry selects `draft`.
 */
export interface SystemScaffolding {
  persona: string;
  philosophy_heading: string;
  philosophy: string[];
  philosophy_close: Record<"draft" | "idea", string>;
  pipeline_heading: string;
  pipeline: string[];
  given_heading: string;
  given: {
    material: Record<"draft" | "idea", string>;
    must_keep: string;
    repair: string;
    reference_prose: string;
    user_voice: string;
    constraints: string;
    preceding: string;
  };
}

export interface Scaffolding {
  leaf_marker: string;
  system: SystemScaffolding;
  brief_heading: string;
  material_heading: string;
  must_keep_heading: string;
  current_heading: string;
  preceding_heading: string;
  preceding_closing: string;
  issues_heading: string;
  read_heading: string;
  voice_heading: string;
  constraints_heading: string;
  constraints: string[];
  closing: string;
  plan_marker: string;
  plan_role: string;
  plan_schema_heading: string;
  plan_schema_intro: string;
  plan_verbatim_heading: string;
  plan_verbatim_rule: string;
  plan_field_rules: string[];
  plan_how_heading: string;
  plan_rules: string[];
  plan_goal_heading: string;
  plan_material_heading: string;
  plan_material_intro: string;
  plan_voice_heading: string;
  plan_voice_intro: string;
  plan_closing: string;
  unit_brief_title: string;
  unit_role_sentences: Record<string, string>;
  pace_sentences: Record<string, string>;
  ends_sentences: Record<string, string>;
  unit_brief_length: string;
  unit_brief_stop: string;
  unit_constraint_first: string;
  unit_constraint_later: string;
  check_role_whole: string;
  check_role_unit: string;
  check_role_common: string;
  check_rubric: RubricSection[];
  check_must_keep_heading: string;
  check_output_heading: string;
  check_output_intro: string;
  check_output_shape: string;
  check_output_rules: string;
  check_tail_marker: string;
  check_tail_previous_label: string;
  check_tail_candidate_label: string;
  check_tail_output_intro: string;
  check_tail_output_rules: string;
  repair_tail_marker: string;
  repair_tail_candidate_label: string;
  repair_tail_report_label: string;
  repair_tail_closing: string[];
  plan_retry_intro: string;
  plan_retry_field_label: string;
  plan_retry_closing: string;
}

export interface PlanSpan {
  file: string;
  from: string;
  to: string;
}

export interface PlanUnit {
  id: string;
  role: string;
  spans: PlanSpan[];
  must_keep: string[];
  target_chars: number;
  pace: string;
  ends: string;
  notes_en: string;
}

export interface Plan {
  version: number;
  title: string;
  claims: Array<{ text: string; source: string }>;
  units: PlanUnit[];
  open_question?: string;
}

export type Material = string | Record<string, string>;

export interface LeafParts {
  brief?: string;
  material: string;
  kernel?: string;
  current?: string;
  preceding?: string;
  issues?: string;
  constraints?: string;
  referenceProse?: string;
  voiceStyle?: string;
  voiceExamples?: string;
  /**
   * The stored workflow's entry, carried as the `entry` part file. Exactly
   * `"idea"` selects the creation charter; anything else — including the
   * absent field of every pre-0.15.0 workflow — is the rewrite default.
   */
  entry?: string;
}

export interface PlanPromptInputs {
  schemaText: string;
  goal: string;
  material: string;
  voice?: string;
}

export interface CheckIssue {
  kind: string;
  quote: string;
  problem: string;
}

export interface CheckReport {
  pass: boolean;
  kernelOk: boolean;
  issues: CheckIssue[];
}

interface Body {
  say(...items: string[]): void;
  part(text: string): void;
  text(): string;
}

// wordtaste:pure-region:start
// Everything between these two markers is pure: it takes the scaffolding and
// the inputs and returns text. The Claude Workflow path runs a generated,
// type-stripped copy of this region. Nothing here may import, reach for outer
// bindings, or touch a runtime API.

function present(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** `say('')` is a blank line; a part is copied byte for byte, as `cat` does. */
function makeBody(): Body {
  const lines: string[] = []
  return {
    say(...items: string[]) {
      for (const item of items) lines.push(item)
    },
    // Mirrors emit_part: the file as it is, plus the final newline it lacks.
    part(text: string) {
      const closed = text.endsWith('\n') ? text : `${text}\n`
      for (const line of closed.slice(0, -1).split('\n')) lines.push(line)
    },
    text() {
      return `${lines.join('\n')}\n`
    },
  }
}

/** `{title}` / `{target_chars}` in a scaffolding template. */
function fill(template: string, values: Record<string, string>): string {
  let out = template
  for (const key of Object.keys(values)) out = out.split(`{${key}}`).join(values[key])
  return out
}

/**
 * The writer's standing system charter. Who the writer is, why the prompt is
 * built out of human Chinese, where it sits in the loop — stated once,
 * task-independent — and then one treatment rule per block the task message
 * actually carries: a first unit's charter has no `<preceding_prose>` rule, a
 * repair's has the repair rule. The entries keep the order the blocks appear
 * in the task message.
 *
 * Two lines vary by the workflow's entry: the `<material>` treatment and the
 * closing hard-constraint paragraph. Rewriting (`draft`) makes the material
 * the only source of facts and forbids adding anything; creation (`idea`)
 * keeps every fact and judgment in the material binding while expecting the
 * writer to develop, and forbids only factual claims the material does not
 * support. Anything but the exact string `"idea"` is `draft`, byte for byte
 * the charter this function always wrote.
 */
function assembleLeafSystem(S: Scaffolding, parts: LeafParts): string {
  const sys = S.system
  const entry = parts.entry === 'idea' ? 'idea' : 'draft'
  const b = makeBody()
  b.say(sys.persona, '')
  b.say(sys.philosophy_heading, '')
  for (const paragraph of sys.philosophy) b.say(paragraph, '')
  b.say(sys.philosophy_close[entry], '')
  b.say(sys.pipeline_heading, '')
  for (const paragraph of sys.pipeline) b.say(paragraph, '')
  b.say(sys.given_heading, '')
  b.say(`- ${sys.given.material[entry]}`)
  if (present(parts.kernel)) b.say(`- ${sys.given.must_keep}`)
  if (present(parts.current) || present(parts.issues)) b.say(`- ${sys.given.repair}`)
  if (present(parts.referenceProse)) b.say(`- ${sys.given.reference_prose}`)
  if (present(parts.voiceStyle) || present(parts.voiceExamples)) b.say(`- ${sys.given.user_voice}`)
  b.say(`- ${sys.given.constraints}`)
  if (present(parts.preceding)) b.say(`- ${sys.given.preceding}`)
  return b.text()
}

/**
 * The degradation for a route with no system channel: the charter rides at
 * the top of the one message, one blank line between. The codex adapter and
 * the workflow's `agent()` calls share these bytes.
 */
function prependSystem(system: string, prompt: string): string {
  const closed = system.endsWith('\n') ? system : `${system}\n`
  return `${closed}\n${prompt}`
}

/**
 * The writer/repair task message. Everything standing about the writer moved
 * into the system charter above, so this begins at the brief and carries only
 * this task's instances: the brief, the typed blocks under short labels, the
 * constraints — and the draft so far last of all. `brief` is required of the
 * script path because a planned unit always has one. The whole-piece repair
 * does not: there is no unit brief for a finished article, and writing one
 * here would put an English sentence in front of a model that does not come
 * from the scaffolding file. So the section is skipped when there is no
 * brief. Every optional part that was not prepared is skipped the same way —
 * an absent part and an empty one are the same thing, and neither leaves an
 * empty block behind.
 */
function assembleLeafPrompt(S: Scaffolding, parts: LeafParts): string {
  const b = makeBody()
  b.say(S.leaf_marker, '')
  if (present(parts.brief)) {
    b.say(S.brief_heading, '')
    b.part(parts.brief)
    b.say('')
  }
  b.say(S.material_heading, '', '<material>')
  b.part(parts.material)
  b.say('</material>', '')
  if (present(parts.kernel)) {
    b.say(S.must_keep_heading, '', '<must_keep>')
    b.part(parts.kernel)
    b.say('</must_keep>', '')
  }
  if (present(parts.current)) {
    b.say(S.current_heading, '', '<current_text>')
    b.part(parts.current)
    b.say('</current_text>', '')
  }
  if (present(parts.issues)) {
    b.say(S.issues_heading, '', '<issues>')
    b.part(parts.issues)
    b.say('</issues>', '')
  }
  if (present(parts.referenceProse)) {
    b.say(S.read_heading, '', '<reference_prose>')
    b.part(parts.referenceProse)
    b.say('</reference_prose>', '')
  }
  if (present(parts.voiceStyle) || present(parts.voiceExamples)) {
    b.say(S.voice_heading, '', '<user_voice>')
    if (present(parts.voiceStyle)) b.part(parts.voiceStyle)
    if (present(parts.voiceExamples)) {
      if (present(parts.voiceStyle)) b.say('')
      b.part(parts.voiceExamples)
    }
    b.say('</user_voice>', '')
  }
  b.say(S.constraints_heading, '')
  for (const constraint of S.constraints) b.say(`- ${constraint}`)
  if (present(parts.constraints)) b.part(parts.constraints)
  b.say('', S.closing)
  // The finished text goes last, past the constraints, and the prompt ends on
  // the line that tells the writer to carry straight on from it. Continuation
  // is the first thing the writer does, and the momentum it picks up is the
  // momentum of whatever it read last. A first unit has nothing behind it, so
  // it gets neither the block nor the line, and its prompt ends where it
  // always ended.
  if (present(parts.preceding)) {
    b.say('', S.preceding_heading, '', '<preceding_prose>')
    b.part(parts.preceding)
    b.say('</preceding_prose>', '', S.preceding_closing)
  }
  return b.text()
}

/** One unit's `brief.en.md`, filled from the stored plan. */
function assembleUnitBrief(S: Scaffolding, unit: PlanUnit, title: string): string {
  const b = makeBody()
  b.say(fill(S.unit_brief_title, { title }), '')
  b.say(S.unit_role_sentences[unit.role] || S.unit_role_sentences.default!)
  if (present(unit.notes_en)) b.say('', unit.notes_en)
  b.say('')
  const pace = S.pace_sentences[unit.pace]
  if (present(pace)) b.say(pace)
  const ends = S.ends_sentences[unit.ends]
  if (present(ends)) b.say(ends)
  b.say('')
  b.say(fill(S.unit_brief_length, { target_chars: String(unit.target_chars) }))
  b.say(S.unit_brief_stop)
  return b.text()
}

/** One unit's `constraints.en.md`. */
function assembleUnitConstraints(S: Scaffolding, isFirstUnit: boolean): string {
  return `- ${isFirstUnit ? S.unit_constraint_first : S.unit_constraint_later}\n`
}

/** One unit's `kernel.md`, absent when the unit keeps nothing. */
function assembleUnitKernel(unit: PlanUnit): string {
  return unit.must_keep.length > 0 ? `${unit.must_keep.join('\n\n')}\n` : ''
}

/** The planner's prompt. */
function assemblePlanPrompt(S: Scaffolding, inputs: PlanPromptInputs): string {
  const b = makeBody()
  b.say(
    S.plan_marker,
    S.plan_role,
    '',
    S.plan_schema_heading,
    '',
    S.plan_schema_intro,
    '',
    '<schema>',
  )
  b.part(inputs.schemaText)
  b.say('</schema>', '')
  b.say(S.plan_verbatim_heading, '', S.plan_verbatim_rule, '')
  for (const rule of S.plan_field_rules) b.say(rule, '')
  b.say(S.plan_how_heading, '')
  for (const rule of S.plan_rules) b.say(`- ${rule}`)
  b.say('', S.plan_goal_heading, '', '<goal>')
  b.part(inputs.goal)
  b.say('</goal>', '')
  b.say(S.plan_material_heading, '', S.plan_material_intro, '', '<material>')
  b.part(inputs.material)
  b.say('</material>', '')
  if (present(inputs.voice)) {
    b.say(S.plan_voice_heading, '', S.plan_voice_intro, '', '<voice>')
    b.part(inputs.voice)
    b.say('</voice>', '')
  }
  b.say(S.plan_closing)
  return b.text()
}

/**
 * A refused plan is re-asked once, with the check that refused it named. The
 * script path re-runs the planner too; naming the field is what a script
 * cannot do, because it never opens the plan.
 */
function assemblePlanRetryPrompt(S: Scaffolding, planPrompt: string, failure: string): string {
  return [
    planPrompt,
    S.plan_retry_intro,
    '',
    `${S.plan_retry_field_label} ${failure}`,
    '',
    S.plan_retry_closing,
    '',
  ].join('\n')
}

/** The judge's brief. */
function assembleCheckBrief(S: Scaffolding, scope: string, mustKeep: string[]): string {
  const b = makeBody()
  b.say(scope === 'whole' ? S.check_role_whole : S.check_role_unit)
  b.say(S.check_role_common, '')
  for (const section of S.check_rubric) {
    b.say(section.heading, '')
    for (const block of section.blocks) {
      b.say(block.lead)
      for (const bullet of block.bullets || []) b.say(`- ${bullet}`)
      b.say('')
    }
  }
  b.say(S.check_must_keep_heading, '', '<must_keep>')
  b.part(mustKeep.join('\n\n'))
  b.say('</must_keep>', '')
  b.say(S.check_output_heading, '', S.check_output_intro, S.check_output_shape, S.check_output_rules)
  return b.text()
}

/** The check cycle's dispatch prompt — the brief plus the text under check. */
function assembleCheckPrompt(
  S: Scaffolding,
  brief: string,
  candidate: string,
  previousReport?: string,
): string {
  let out = `${brief}\n\n${S.check_tail_marker}\n`
  if (present(previousReport)) out += `\n${S.check_tail_previous_label}\n${previousReport}`
  out += `\n${S.check_tail_candidate_label}\n${candidate}`
  out += `\n\n${S.check_tail_output_intro}\n`
  out += `${S.check_output_shape}\n`
  out += `${S.check_tail_output_rules}\n`
  return out
}

/**
 * The legacy concatenated repair prompt: the judge's brief plus the one-use
 * issue report. Kept because the four-argument check cycle still builds it;
 * the composed repair path reads `assembleRepairIssues` below instead.
 */
function assembleRepairPrompt(S: Scaffolding, brief: string, candidate: string, report: string): string {
  let out = `${brief}\n\n${S.repair_tail_marker}\n`
  out += `\n${S.repair_tail_candidate_label}\n${candidate}`
  out += `\n\n${S.repair_tail_report_label}\n${report}`
  out += `\n\n${S.repair_tail_closing[0]}\n`
  out += `${S.repair_tail_closing[1]}\n`
  return out
}

/**
 * The composed repair's `issues.md` — the quoted problems pulled out of the
 * report. The checker's own words, never restated: the same two lines per
 * issue the script-era `jq -r` wrote.
 */
function assembleRepairIssues(check: { issues: CheckIssue[] }): string {
  return check.issues.map((issue) => `- ${issue.quote}\n  ${issue.problem}`).join('\n')
}

// ── the verbatim guard, shared with validate_plan.ts ────────────────────────
// Runs of ASCII whitespace collapse to one space on both sides, so a quote may
// cross a line break. `\s` is not usable here: it also matches the full-width
// space, and a full-width space is a character of the author's text, not
// layout.
function collapseSpace(text: string): string {
  return text.replace(/[ \t\r\n]+/g, ' ')
}

function normalizeQuote(text: string): string {
  return collapseSpace(text).replace(/^ +/, '').replace(/ +$/, '')
}

/**
 * U+3000-U+9FFF: CJK punctuation through the common ideographs, the range the
 * bash guard matched as UTF-8 lead bytes E3-E9. An em dash or a curly quote is
 * ordinary English typography and stays allowed.
 */
function hasCjk(text: string): boolean {
  return /[　-鿿]/.test(text)
}

/** awk records: a trailing newline does not open one more empty line. */
function textLines(text: string): string[] {
  const closed = text.endsWith('\n') ? text.slice(0, -1) : text
  return closed.split('\n')
}

/** validate_plan.ts / compose_unit_parts.ts share this one slicing rule. */
function sliceSpan(lines: string[], from: string, to: string): string[] {
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    if (!inside) {
      if (line === from) {
        inside = true
        out.push(line)
      }
      continue
    }
    if (to !== '' && line === to) break
    out.push(line)
  }
  return out
}

/** A string material answers for every span; a map answers by span file. */
function materialFor(material: Material, file: string): string | null {
  if (typeof material === 'string') return material
  if (material && typeof material === 'object' && typeof material[file] === 'string') {
    return material[file]!
  }
  return null
}

function allMaterial(material: Material): string {
  return typeof material === 'string' ? material : Object.keys(material || {}).map((key) => material[key]).join('\n')
}

/** One unit's material.md: its spans, in order, one blank line between them. */
function unitMaterial(unit: PlanUnit, material: Material): string | null {
  const chunks: string[] = []
  for (const span of unit.spans) {
    const text = materialFor(material, span.file)
    if (text === null) return null
    const sliced = sliceSpan(textLines(text), span.from, span.to)
    if (sliced.length === 0) return null
    chunks.push(`${sliced.join('\n')}\n`)
  }
  return chunks.length > 0 ? chunks.join('\n') : null
}

/**
 * Returns the name of the first check the plan fails, or `null` when it
 * passes. The shape checks a schema already enforces are not repeated; what is
 * left is what a schema cannot say — the Chinese is quoted, `notes_en` is
 * English, the spans resolve, and the unit ids are distinct.
 */
function guardPlan(plan: Plan, goal: string, material: Material): string | null {
  const haystack = collapseSpace(`${goal}\n${allMaterial(material)}`)
  const quoted = (text: string) => {
    const needle = normalizeQuote(text)
    return needle.length > 0 && haystack.indexOf(needle) >= 0
  }

  if (!quoted(plan.title)) return 'title'
  for (const claim of plan.claims) {
    if (!quoted(claim.text)) return 'claims[].text'
  }

  const seen: string[] = []
  for (const unit of plan.units) {
    if (seen.indexOf(unit.id) >= 0) return 'units[].id'
    seen.push(unit.id)
    if (hasCjk(unit.notes_en)) return 'units[].notes_en'

    const chunks: string[] = []
    for (const span of unit.spans) {
      const text = materialFor(material, span.file)
      if (text === null) return 'units[].spans[].file'
      const lines = textLines(text)
      const start = lines.indexOf(span.from)
      if (start < 0) return 'units[].spans[].from'
      if (span.to !== '' && lines.indexOf(span.to, start + 1) < 0) return 'units[].spans[].to'
      chunks.push(`${sliceSpan(lines, span.from, span.to).join('\n')}\n`)
    }

    const spanText = collapseSpace(chunks.join('\n'))
    for (const keep of unit.must_keep) {
      const needle = normalizeQuote(keep)
      if (needle.length === 0 || spanText.indexOf(needle) < 0) return 'units[].must_keep[]'
    }
  }
  return null
}
// wordtaste:pure-region:end

export {
  assembleCheckBrief,
  assembleCheckPrompt,
  assembleLeafPrompt,
  assembleLeafSystem,
  assemblePlanPrompt,
  assemblePlanRetryPrompt,
  assembleRepairIssues,
  assembleRepairPrompt,
  assembleUnitBrief,
  assembleUnitConstraints,
  assembleUnitKernel,
  collapseSpace,
  guardPlan,
  hasCjk,
  normalizeQuote,
  prependSystem,
  sliceSpan,
  textLines,
  unitMaterial,
};

// ── scaffolding completeness ────────────────────────────────────────────────
// A missing key would compose the word "undefined" into a prompt, exactly as
// `jq -r` used to print `null`. Each composer asserts the keys it reads before
// writing anything; the predicates mirror the retired jq assertions.

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString)
}

function stringValuedObject(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(nonEmptyString)
  )
}

type Raw = Record<string, unknown>

/** `{ draft, idea }` — both entries present and non-empty, nothing missing. */
function entryKeyedString(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    nonEmptyString((value as Raw).draft) &&
    nonEmptyString((value as Raw).idea)
  )
}

function hasSystemScaffolding(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const sys = value as Raw
  const strings = ['persona', 'philosophy_heading', 'pipeline_heading', 'given_heading']
  if (!strings.every((key) => nonEmptyString(sys[key]))) return false
  if (!nonEmptyStringArray(sys.philosophy) || !nonEmptyStringArray(sys.pipeline)) return false
  if (!entryKeyedString(sys.philosophy_close)) return false
  const given = sys.given
  if (typeof given !== 'object' || given === null || Array.isArray(given)) return false
  if (!entryKeyedString((given as Raw).material)) return false
  const entries = [
    'must_keep', 'repair', 'reference_prose',
    'user_voice', 'constraints', 'preceding',
  ]
  return entries.every((key) => nonEmptyString((given as Raw)[key]))
}

export function hasLeafScaffolding(s: Raw): boolean {
  const strings = [
    'leaf_marker', 'brief_heading', 'material_heading',
    'must_keep_heading', 'current_heading',
    'preceding_heading', 'preceding_closing',
    'issues_heading', 'read_heading', 'voice_heading',
    'constraints_heading', 'closing',
  ]
  return (
    strings.every((key) => nonEmptyString(s[key])) &&
    nonEmptyStringArray(s.constraints) &&
    hasSystemScaffolding(s.system)
  )
}

export function hasPlanScaffolding(s: Raw): boolean {
  const strings = [
    'plan_marker', 'plan_role', 'plan_schema_heading', 'plan_schema_intro',
    'plan_verbatim_heading', 'plan_verbatim_rule', 'plan_how_heading',
    'plan_goal_heading', 'plan_material_heading', 'plan_material_intro',
    'plan_voice_heading', 'plan_voice_intro', 'plan_closing',
  ]
  return (
    strings.every((key) => nonEmptyString(s[key])) &&
    nonEmptyStringArray(s.plan_field_rules) &&
    nonEmptyStringArray(s.plan_rules)
  )
}

export function hasUnitScaffolding(s: Raw): boolean {
  const strings = [
    'unit_brief_title', 'unit_brief_length', 'unit_brief_stop',
    'unit_constraint_first', 'unit_constraint_later',
  ]
  const roles = s.unit_role_sentences
  return (
    strings.every((key) => nonEmptyString(s[key])) &&
    stringValuedObject(roles) &&
    nonEmptyString(roles.default) &&
    stringValuedObject(s.pace_sentences) &&
    stringValuedObject(s.ends_sentences)
  )
}

export function hasCheckScaffolding(s: Raw): boolean {
  const strings = [
    'check_role_whole', 'check_role_unit', 'check_role_common',
    'check_must_keep_heading', 'check_output_heading', 'check_output_intro',
    'check_output_shape', 'check_output_rules',
  ]
  const rubric = s.check_rubric
  return (
    strings.every((key) => nonEmptyString(s[key])) &&
    Array.isArray(rubric) &&
    rubric.length > 0 &&
    rubric.every(
      (section: unknown) =>
        typeof section === 'object' &&
        section !== null &&
        nonEmptyString((section as Raw).heading) &&
        Array.isArray((section as Raw).blocks) &&
        ((section as Raw).blocks as unknown[]).length > 0 &&
        ((section as Raw).blocks as unknown[]).every(
          (block: unknown) =>
            typeof block === 'object' &&
            block !== null &&
            nonEmptyString((block as Raw).lead) &&
            (((block as Raw).bullets ?? []) as unknown) instanceof Array &&
            (((block as Raw).bullets ?? []) as unknown[]).every(nonEmptyString),
        ),
    )
  )
}

export function hasCycleScaffolding(s: Raw): boolean {
  const strings = [
    'check_tail_marker', 'check_tail_previous_label', 'check_tail_candidate_label',
    'check_tail_output_intro', 'check_tail_output_rules', 'check_output_shape',
    'repair_tail_marker', 'repair_tail_candidate_label', 'repair_tail_report_label',
  ]
  return strings.every((key) => nonEmptyString(s[key])) && nonEmptyStringArray(s.repair_tail_closing)
}
