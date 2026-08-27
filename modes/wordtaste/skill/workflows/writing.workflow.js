export const meta = {
  name: 'wordtaste-writing-loop',
  description: 'Two-level Chinese long-form loop: a JSON plan behind a verbatim guard, a loose layout gate, sequential units written from script-identical prompts, a fresh-family check, and one repair pass',
  phases: [
    { title: 'Shape', detail: 'Plan the essay as JSON, then hold it at the verbatim guard' },
    { title: 'Write', detail: 'Write sequential units from finished preceding prose' },
    { title: 'Check', detail: 'Check meaning and pattern collapse, then repair real issues' },
  ],
}

/*
 * The Claude Workflow path of the wordtaste writing loop.
 *
 * It composes exactly what the manual path composes. Every English sentence in
 * every prompt below comes from `references/prompt-scaffolding.en.json`, the
 * same file `compose_plan_prompt.ts`, `compose_unit_parts.ts`,
 * `compose_leaf_prompt.ts` and `compose_check_brief.ts` read; the object is
 * embedded here because a workflow script has no filesystem. The embedded
 * regions are generated, never hand-synced: `bun scripts/generate_workflow_regions.ts`
 * rewrites them from `scripts/lib/prompt-assembly.ts` and the two JSON files,
 * a test regenerates and diffs, and a second test runs each composer and this
 * file's assembler over the same inputs and compares the bytes. If the two
 * ever drift, the tests refuse the change.
 *
 * The scaffolding is embedded rather than imported for the same reason as the
 * inputs: the runtime contract is a pure coordinator — no filesystem, no shell,
 * no Node API — and module resolution inside it is not part of that contract.
 *
 * Every leaf here is the host's own model, through `agent()`. The hosted writer
 * route — a strong model reached over HTTP when the session has a key — belongs
 * to the script path alone: `run_leaf.ts` chooses it, and this file cannot shell
 * out to anything. That is the same boundary as family routing: the check below
 * is not a fresh-family check either. And because `agent()` has no system
 * channel, the writer's standing charter (`assembleLeafSystem`) is prepended to
 * each writer/repair prompt — the same degradation, and the same bytes, as the
 * script path's codex adapter.
 *
 * `args` (the session agent reads every file and inlines its contents; a leaf
 * cannot open a path):
 *
 *   goal            required, string — the user's goal in the user's own words,
 *                   copied, not restated. The `goal.md` of the manual path.
 *   material        required — the source text. A string for the usual single
 *                   material file, or an object keyed by the path a plan span
 *                   names (`{"materials/original.md": "…"}`) when the plan
 *                   spans several files.
 *   entry           optional, string — the stored workflow's entry. Exactly
 *                   'idea' gives every writer and repairer the creation
 *                   charter (material binding, development expected, no
 *                   unsupported facts); absent or anything else is the
 *                   rewrite charter, byte-identical to every run before the
 *                   field existed. The `entry` part file of the manual path.
 *   voice           optional, string — a sample of the voice the essay sits in.
 *   plan            optional, object or JSON string — an already-planned plan.
 *                   Given one, the Shape phase does not run a planner; the
 *                   verbatim guard still runs, because a plan that no longer
 *                   quotes this material cannot be written from.
 *   approved        optional, boolean — the user cleared the layout gate.
 *   draft           optional, string — prose already finished before this run.
 *                   It becomes the first unit's preceding prose and the head of
 *                   the returned draft.
 *   unitIds         optional, string[] — write only these units, in plan order.
 *   referenceProse  optional, string — passages from `primer_sample.ts`, which
 *                   this path cannot run itself. Absent, the `<reference_prose>`
 *                   block is omitted and the return says `primed: false`.
 *   voiceStyle      optional, string — the distilled English directives naming
 *                   how the person this essay is for writes. The contents of
 *                   `voice_style.en.md`, not a path.
 *   voiceExamples   optional, string — their own Chinese: hand-edit pairs and a
 *                   window of writing they accepted. The contents of
 *                   `voice_examples.md`, not a path.
 *                   This path cannot sample either of them — sampling reads
 *                   `<content-set>/taste/` and draws from a seed, and a
 *                   workflow script has no filesystem. So the orchestrator runs
 *                   `voice_sample.ts <content-set>/taste <parts-dir> --seed …`
 *                   first and inlines the two files it writes. Give both, one,
 *                   or neither: with neither the `<user_voice>` block is left
 *                   out, exactly as the script composer leaves it out when the
 *                   sampler wrote no parts.
 *   emphasis        optional, number[] — the claims the user marked at the
 *                   layout gate. Carried, and deliberately never composed into a
 *                   prompt: `compose_unit_parts.ts` does not show a writer the
 *                   emphasis either, and a prompt this path emits that the
 *                   manual path never would is the divergence this file exists
 *                   to close.
 *
 * Returns `{ stage: 'layout', plan }` at the gate, `{ stage: 'intake', error }`
 * when the plan cannot be made usable, and otherwise
 * `{ stage: 'blocked' | 'done', plan, prose, check, advisory, primed,
 * next }`.
 */

// args may arrive as an object or a JSON string.
const A = typeof args === 'string' ? JSON.parse(args) : args

// The English scaffolding, byte for byte from
// `references/prompt-scaffolding.en.json`. Do not edit one copy alone; the
// markers are how the test reads this copy back out.
// wordtaste:scaffolding:start
const SCAFFOLD = {
  "leaf_marker": "<!-- wordtaste:composed v1 -->",
  "system": {
    "persona": "You are a writer of long-form Chinese knowledge essays. You write plain Chinese a person would actually say: meaning first, no template rhetoric — short sentences next to long ones, paragraphs that do not all weigh the same, a person explaining rather than a system describing itself.",
    "philosophy_heading": "## Why your prompt is built the way it is",
    "philosophy": [
      "Every Chinese sentence in it was written by a person: the author's own material, passages of published prose, the draft as it stands. Machine-organized Chinese is deliberately kept out, because register is contagious — the Chinese you read just before writing is the Chinese you will write.",
      "For the same reason, texture is never asked for with rules. The prompt shows you human prose and trusts what reading does; your sentences take their shape from what you just read, not from a list of what good writing is."
    ],
    "philosophy_close": {
      "draft": "One thing is a hard constraint: the meaning of the author's material must survive. Everything stylistic is taste.",
      "idea": "Two things are hard constraints: the meaning of the author's material must survive, and no factual claim it does not support may enter. The development — the reasoning, the transitions, the examples — is yours to write; everything stylistic is taste."
    },
    "pipeline_heading": "## Where you sit",
    "pipeline": [
      "You are one isolated writer inside a larger loop: an essay is planned, its sections are written one after another, and a separate checker then verifies that no meaning was lost. You write exactly one section, continuing an essay in progress.",
      "Because the checker exists, your only job is to write well. Do not annotate, explain, or hedge about your own text: your entire output is prose, and it enters the draft verbatim."
    ],
    "shape_heading": "## What may appear in your output besides sentences",
    "shape": [
      "Your output is prose. Two constructs are allowed inside it and nothing else is: no bullet points, no numbered lists, no bold, no italics, no tables, no code, no images, no links.",
      "A section heading — one line beginning with `## `, in your own Chinese, naming what the section is about. Write one only when the constraints for this task ask you to open a section; otherwise your output begins with prose. There is one level of section and no level below it.",
      "An asset block — how this pipeline writes down something that is not a sentence. Where a passage needs a diagram, a photograph, a screenshot, a clip, you neither make it nor link to a file: you write what belongs there and the words that thing has to carry, and a later agent builds it from your description. It looks like this:"
    ],
    "shape_asset_example": [
      "```asset",
      "what: a diagram of three agents rewriting one passage in turn, with arrows marking the two return trips",
      "copy: input",
      "copy: first rewrite",
      "copy: second rewrite",
      "```"
    ],
    "shape_close": [
      "`what` says what the thing is, once, in one sentence. Each `copy` line is one string that has to appear inside the thing itself, in the order it should appear; leave them out entirely when it carries no words. Those two keys are the whole format — no others, no nesting, no prose inside the block.",
      "The example is written in English so that this charter stays free of Chinese you might imitate; your own blocks are written in the language of the essay, like everything else you write.",
      "An asset block stands between paragraphs, on its own. The prose around it has to stand on its own too: write as though the thing may never be built, and never make a sentence depend on it the way \"as the diagram below shows\" does. Most sections need none at all."
    ],
    "given_heading": "## What the task message may contain, and how to treat it",
    "given": {
      "material": {
        "draft": "`<material>` — the author's own text, the only source of facts. Keep every number, name, and qualification exactly as it is given; add no facts, relationships, or claims of your own, and do not carry over its headings, lists, or diagrams.",
        "idea": "`<material>` — the author's outline and their own notes, the anchor of the essay rather than its finished text. Every named fact, number, and judgment in it is binding: keep each one exactly as it is given. You are expected to develop — the reasoning between its points, the transitions, the examples that unfold what it asserts are yours to write. What you may not add is a factual claim the material does not support: no statistics, named events, attributions, or technical specifics of your own; where an argument would need one, stay at the level of common knowledge or explicit generality. Do not carry over the material's headings, lists, or diagrams."
      },
      "must_keep": "`<must_keep>` — sentences whose meaning must survive exactly. You may place them differently and say them in your own words, but nothing they assert or qualify may soften, widen, or drop.",
      "repair": "`<current_text>` with `<issues>` — a repair. The section as it stands and the problems to fix: fix only what is quoted, keep every sentence that is not, and return the complete revised section, never a diff and never only the parts you changed.",
      "reference_prose": "`<reference_prose>` — texture only. The passages are unrelated to the subject and are not templates: do not quote them and never borrow their content, imagery, topics, voice, or pronouns. They are there so the Chinese you write has the same directness, economy, and uneven breathing.",
      "user_voice": "`<user_voice>` — the person this essay is written for, distilled from writing they accepted and corrections they made by hand. Follow the directives; read the examples for rhythm, sentence length, and word choice, never for subject matter. Where this disagrees with the reference passages, the user's voice wins.",
      "constraints": "`Constraints` — the requirements of this one task. They bind this section only.",
      "preceding": "`<preceding_prose>` — the finished draft so far, the text you are continuing. It is done: pick up its momentum and its register, do not repeat its images, examples, or explanations, and do not rewrite it."
    }
  },
  "brief_heading": "## What you are writing",
  "material_heading": "## Source material (Chinese, written by the author — the only source of facts)",
  "must_keep_heading": "## What must survive",
  "current_heading": "## The section as it stands",
  "preceding_heading": "## The text so far — you are continuing it",
  "preceding_closing": "Continue directly from where that text stops. Output only your own section.",
  "issues_heading": "## What to fix",
  "read_heading": "## How it should read",
  "voice_heading": "## The voice of the person this is for",
  "constraints_heading": "## Constraints",
  "constraints": [
    "Chinese throughout; keep technical identifiers in English exactly as they appear in the material; one space between Chinese and Latin text; full-width Chinese punctuation.",
    "Prose only, apart from the two constructs above: no bullet points, no numbered lists, no bold, no italics, no tables, no diagrams, no code blocks.",
    "Length: roughly 600–900 Chinese characters, unless the brief above names a different target.",
    "Output the section only. No preface, no notes, no explanation after the text."
  ],
  "closing": "Write the section now, in Chinese.",
  "plan_marker": "<!-- wordtaste:composed v1 plan -->",
  "plan_role": "You are planning a long-form Chinese essay. You do not write the essay. You return one JSON object and nothing else.",
  "plan_schema_heading": "## What you return",
  "plan_schema_intro": "One JSON object matching this schema exactly. Every key it marks as required must be present.",
  "plan_verbatim_heading": "## The rule that decides whether the plan is usable",
  "plan_verbatim_rule": "`title`, every `claims[].text`, and every `must_keep[]` sentence MUST be copied out of the material character for character. Do not translate them, do not tidy them, do not shorten them, do not change one punctuation mark. A quote may cross a line break, but nothing else may differ. A plan whose Chinese is not a literal quote is rejected and thrown away.",
  "plan_field_rules": [
    "Anything you want to say in your own words goes in `notes_en`, in English, and nowhere else. `notes_en` is read by the writer, so put there what a writer needs and cannot infer: what this unit has to achieve, what the section before it already spent, what to leave alone.",
    "You may ask the user exactly one question, in `open_question`. That field is the only place you may write Chinese of your own; it is shown to the user and never reaches a writer.",
    "`spans[].from` and `spans[].to` are whole lines copied from the material file — normally its headings. The range starts at `from` and ends just before `to`; leave `to` empty to run to the end of the file. Every `must_keep` sentence of a unit must sit inside that unit's own spans."
  ],
  "plan_how_heading": "## How to plan",
  "plan_rules": [
    "Propose a loose movement, not a rigid outline. The plan says what each part of the essay has to do; it does not pre-write the essay.",
    "Assign every unit its role before anything else. Length, pace and ending follow from the role, never the other way round.",
    "Group the material into sequential units of roughly 600-1200 Chinese characters each, grouped by content rather than by capacity. A short piece is one unit.",
    "Make neighbouring units change gear: a dense unit next to one that gives the reader room, a unit that stops next to one that leaves the reader waiting.",
    "At most two or three claims deserve the strongest landing. If everything lands hardest, nothing does.",
    "Keep the qualifications. A claim that carries a condition must arrive with its condition; flattening one into a confident generalisation changes the meaning."
  ],
  "plan_goal_heading": "## The goal, in the user's own words",
  "plan_material_heading": "## The material",
  "plan_material_intro": "This is the only source of facts, and the only source of the Chinese you may quote.",
  "plan_voice_heading": "## The voice this essay sits in",
  "plan_voice_intro": "A sample of how the author writes. Do not quote it and do not plan its subject matter; it is here so the plan does not fight the voice.",
  "plan_closing": "Output the JSON object only. No prose before it, no explanation after it, no code fence.",
  "unit_brief_title": "This is one section of a long-form Chinese essay. Its title is: {title}",
  "unit_role_sentences": {
    "background": "This section establishes the background the reader needs before the argument can start. Explain what is there, not what follows from it.",
    "problem": "This section brings the problem into focus and leaves the reader standing in front of it. Do not resolve it here.",
    "reasoning": "This section reasons step by step, from what the reader already accepts towards what follows from it. One move at a time.",
    "conclusion": "This section states the conclusion the argument has earned, and states it plainly.",
    "close": "This section closes the piece. It adds no new argument and no summary of what was already said.",
    "default": "This section carries one step of the essay."
  },
  "pace_sentences": {
    "dense": "Keep it dense: little room between the points, and no filler between them.",
    "loose": "Let it breathe: give the reader room between the points.",
    "mixed": "Vary the pressure: dense passages next to passages that give the reader room."
  },
  "ends_sentences": {
    "stop": "End where the section ends. Do not add a closing summary sentence.",
    "open": "Leave the ending open: the next section continues from here."
  },
  "unit_brief_length": "Length: roughly {target_chars} Chinese characters. Anything within twenty per cent of that is fine; it is a direction, not a threshold.",
  "unit_brief_stop": "Stop where this section's material ends. What comes after it belongs to another section.",
  "unit_constraint_first": "First line: the author's own title, exactly as it is given above, as a level-one heading — `# ` and then the title.",
  "unit_constraint_later": "Do not repeat the title.",
  "unit_constraint_section": "This section opens a new part of the essay: begin with a heading of your own on a line starting with `## `, a few words in Chinese saying what this part is about, and then write the prose.",
  "check_role_whole": "You are checking a complete long-form Chinese essay.",
  "check_role_unit": "You are checking one section of a long-form Chinese essay.",
  "check_role_common": "You check. You do not write, you do not rank versions, and you do not predict what anyone will like. Report quoted evidence only.",
  "check_structure_note": "Two things in the text are structure, not writing, and are never issues on their own: a section heading (a line starting with `## `) and an asset block (a fenced ```asset block). Inside an asset block the `copy:` lines are prose the reader will see, and you check them as prose; the `what:` line is a specification for a later agent and is out of scope. Everything else is prose.",
  "check_rubric": [
    {
      "heading": "## 1. Meaning first",
      "blocks": [
        {
          "lead": "Compare the text against the sentences whose meaning must survive, below.",
          "bullets": [
            "Is every core claim still alive?",
            "Did any fact, number, or name change?",
            "Did a precise qualification become a confident generalisation?",
            "Did a rewrite keep the quoted meaning and change only the writing?"
          ]
        },
        {
          "lead": "Lost meaning is a blocking failure even when the new prose sounds better. Report it with `\"kind\":\"meaning\"`."
        }
      ]
    },
    {
      "heading": "## 2. Chinese a person would actually say",
      "blocks": [
        {
          "lead": "Quote any phrase that is grammatical but unnatural in Chinese: an invented verb-object pair, a translation-shaped collocation, a decorative abstraction, or a phrase that looks polished until it is read aloud."
        }
      ]
    },
    {
      "heading": "## 3. Pattern collapse",
      "blocks": [
        {
          "lead": "Quote each of these where it appears:",
          "bullets": [
            "over-explained terminology and definition scaffolding;",
            "a marching sequence of evenly shaped sentences or paragraphs;",
            "the same conclusion shape used again and again;",
            "polished \"not X but Y\" reductions and their softer disguises;",
            "safety-balancing language that removes the position;",
            "tidy explanatory analogies, stock metaphors, poetic vapour endings, anthropomorphised technical objects, and triple parallelism;",
            "two incompatible metaphors in one sentence;",
            "a metaphor introduced as if the reader had already seen it."
          ]
        }
      ]
    },
    {
      "heading": "## 4. Readability is a separate axis",
      "blocks": [
        {
          "lead": "Judge readability on its own, not as a synonym for quality. Name the hardest paragraph to read. Look for long comma chains, half-screen paragraphs, no rest after a dense passage, and an argument that has become hard to follow."
        }
      ]
    },
    {
      "heading": "## 5. Colloquial language can also overshoot",
      "blocks": [
        {
          "lead": "Where the prose is loose and spoken, verify that the looseness did not erase a condition or a precise qualification. Loose and wrong is worse than stiff and right."
        }
      ]
    },
    {
      "heading": "## 6. Rechecking a repair",
      "blocks": [
        {
          "lead": "When a previous issue report is included, answer for every issue it quoted: fixed, partly fixed, still present, moved into a different form, or over-corrected. The last two matter most — a repair that only relocates the same impulse has not succeeded. Report anything not fixed as an issue again."
        }
      ]
    }
  ],
  "check_must_keep_heading": "## Sentences whose meaning must survive",
  "check_output_heading": "## Output",
  "check_output_intro": "Return JSON only, with this exact shape:",
  "check_output_shape": "{\"pass\":boolean,\"kernelOk\":boolean,\"issues\":[{\"kind\":\"meaning|style\",\"quote\":\"exact quote\",\"problem\":\"specific problem\"}]}",
  "check_output_rules": "Use an empty issues array when the text is clean. `kernelOk` is false when any sentence above lost its meaning. Every `quote` is copied from the text you were given. No greeting, no provenance, no summary, no ranking, no advice, no markdown, and no prose outside the JSON.",
  "check_tail_marker": "WORDTASTE_CHECK",
  "check_tail_previous_label": "Previous private issue report:",
  "check_tail_candidate_label": "Candidate to check:",
  "check_tail_output_intro": "Return JSON only with this exact shape:",
  "check_tail_output_rules": "Use an empty issues array when clean. Do not add summary, advice, ranking, markdown, or prose outside JSON.",
  "repair_tail_marker": "WORDTASTE_REPAIR",
  "repair_tail_candidate_label": "Current candidate:",
  "repair_tail_report_label": "One-use private issue report:",
  "repair_tail_closing": [
    "Repair only the quoted issues while preserving the frozen meaning and useful surrounding prose.",
    "Return the complete repaired prose only. No preface, explanation, list, markdown fence, or afterword."
  ],
  "plan_retry_intro": "Your previous plan was rejected. Nothing about the material has changed: the plan has to quote it exactly.",
  "plan_retry_field_label": "The check that failed:",
  "plan_retry_closing": "Return one corrected JSON object and nothing else."
}
// wordtaste:scaffolding:end

// `references/plan-schema.json`, byte for byte. Kept as text because the
// planner's prompt embeds the file itself; the object the runtime validates
// against is parsed from that same text, so the two cannot disagree.
// wordtaste:plan-schema:start
const PLAN_SCHEMA_TEXT = String.raw`{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "WordTaste plan",
  "description": "The plan a planner returns for one Chinese long-form essay. Every Chinese string in it is copied character for character from the human material; everything the planner says in its own words is English, in notes_en. open_question is the one exception: it is shown to the user and never composed into a prompt.",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "title", "claims", "units"],
  "properties": {
    "version": { "const": 1 },
    "title": {
      "type": "string",
      "minLength": 1,
      "description": "The essay title, verbatim from the material."
    },
    "claims": {
      "type": "array",
      "minItems": 1,
      "description": "The argument as individually addressable claims.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "source"],
        "properties": {
          "text": {
            "type": "string",
            "minLength": 1,
            "description": "Verbatim from the material."
          },
          "source": {
            "type": "string",
            "minLength": 1,
            "description": "Where it came from: materials/original.md or materials/outline.md, optionally with a line anchor such as #L12."
          }
        }
      }
    },
    "units": {
      "type": "array",
      "minItems": 1,
      "description": "Sequential writing units, normally 600-1200 Chinese characters, grouped by content rather than by capacity.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "role",
          "spans",
          "must_keep",
          "target_chars",
          "pace",
          "ends",
          "notes_en"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "description": "u1, u2, ... — unique within the plan."
          },
          "role": {
            "enum": ["background", "problem", "reasoning", "conclusion", "close"],
            "description": "What this unit does in the essay. Assigned before length or pace; the prose form follows from it."
          },
          "spans": {
            "type": "array",
            "description": "Heading-to-heading ranges of a material file. The range starts at the from line and ends before the to line; an empty to means end of file.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["file", "from", "to"],
              "properties": {
                "file": {
                  "type": "string",
                  "minLength": 1,
                  "description": "A material file path relative to the content set, such as materials/original.md."
                },
                "from": {
                  "type": "string",
                  "minLength": 1,
                  "description": "A whole line of that file, copied exactly."
                },
                "to": {
                  "type": "string",
                  "description": "A whole line of that file after from, copied exactly, or empty for end of file."
                }
              }
            }
          },
          "must_keep": {
            "type": "array",
            "description": "Sentences whose meaning must survive, verbatim from the spanned material.",
            "items": { "type": "string", "minLength": 1 }
          },
          "target_chars": {
            "type": "integer",
            "minimum": 300,
            "maximum": 2000,
            "description": "A rough length in Chinese characters, not a threshold to hit."
          },
          "pace": {
            "enum": ["dense", "loose", "mixed"],
            "description": "How tightly this unit is packed. Neighbouring units change gear."
          },
          "ends": {
            "enum": ["stop", "open"],
            "description": "stop: the unit ends and says nothing more. open: it leaves the reader waiting for the next unit."
          },
          "notes_en": {
            "type": "string",
            "description": "English only. Anything the planner wants to tell the writer in its own words belongs here and nowhere else."
          },
          "opens_section": {
            "type": "boolean",
            "description": "Optional, default false. True when this unit opens a new section of the essay; the writer then gives that section a heading of its own. You decide where sections begin, not what they are called — the heading is Chinese, and Chinese you wrote is not allowed in a plan. Use it sparingly: a heading before every unit is the same as no headings at all. The first unit is already the opening and its first line is the title, so the flag is ignored there."
          }
        }
      }
    },
    "open_question": {
      "type": "string",
      "description": "Optional. One question for the user, Chinese allowed. It is shown to the user and never composed into a prompt."
    }
  }
}`

// wordtaste:plan-schema:end

const PLAN_SCHEMA = JSON.parse(PLAN_SCHEMA_TEXT)

// The judge's output contract, as `check_output_shape` states it to the judge.
const CHECK_SCHEMA = {
  type: 'object',
  required: ['pass', 'kernelOk', 'issues'],
  properties: {
    pass: { type: 'boolean' },
    kernelOk: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'quote', 'problem'],
        properties: {
          kind: { enum: ['meaning', 'style'] },
          quote: { type: 'string', description: 'Copied from the text that was checked' },
          problem: { type: 'string' },
        },
      },
    },
  },
}

// wordtaste:pure-region:start
// Everything between these two markers is pure: it takes the scaffolding and
// the inputs and returns text. The Claude Workflow path runs a generated,
// type-stripped copy of this region. Nothing here may import, reach for outer
// bindings, or touch a runtime API.
function present(value) {
    return typeof value === 'string' && value.length > 0;
}
/** `say('')` is a blank line; a part is copied byte for byte, as `cat` does. */
function makeBody() {
    const lines = [];
    return {
        say(...items) {
            for (const item of items)
                lines.push(item);
        },
        // Mirrors emit_part: the file as it is, plus the final newline it lacks.
        part(text) {
            const closed = text.endsWith('\n') ? text : `${text}\n`;
            for (const line of closed.slice(0, -1).split('\n'))
                lines.push(line);
        },
        text() {
            return `${lines.join('\n')}\n`;
        },
    };
}
/** `{title}` / `{target_chars}` in a scaffolding template. */
function fill(template, values) {
    let out = template;
    for (const key of Object.keys(values))
        out = out.split(`{${key}}`).join(values[key]);
    return out;
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
function assembleLeafSystem(S, parts) {
    const sys = S.system;
    const entry = parts.entry === 'idea' ? 'idea' : 'draft';
    const b = makeBody();
    b.say(sys.persona, '');
    b.say(sys.philosophy_heading, '');
    for (const paragraph of sys.philosophy)
        b.say(paragraph, '');
    b.say(sys.philosophy_close[entry], '');
    b.say(sys.pipeline_heading, '');
    for (const paragraph of sys.pipeline)
        b.say(paragraph, '');
    b.say(sys.shape_heading, '');
    for (const paragraph of sys.shape)
        b.say(paragraph, '');
    for (const line of sys.shape_asset_example)
        b.say(line);
    b.say('');
    for (const paragraph of sys.shape_close)
        b.say(paragraph, '');
    b.say(sys.given_heading, '');
    b.say(`- ${sys.given.material[entry]}`);
    if (present(parts.kernel))
        b.say(`- ${sys.given.must_keep}`);
    if (present(parts.current) || present(parts.issues))
        b.say(`- ${sys.given.repair}`);
    if (present(parts.referenceProse))
        b.say(`- ${sys.given.reference_prose}`);
    if (present(parts.voiceStyle) || present(parts.voiceExamples))
        b.say(`- ${sys.given.user_voice}`);
    b.say(`- ${sys.given.constraints}`);
    if (present(parts.preceding))
        b.say(`- ${sys.given.preceding}`);
    return b.text();
}
/**
 * An `asset` block, fences and all, wherever one sits on its own lines.
 * Mirrors `modes/wordtaste/domain.ts`, which parses the same construct for the
 * viewer; the two live apart because the skill scripts and the mode's frontend
 * module share no code.
 */
const ASSET_BLOCK = /^[ \t]*```asset[ \t]*\r?\n[\s\S]*?^[ \t]*```[ \t]*(?:\r?\n|$)/gm;
/**
 * Take the asset blocks out of the draft before it becomes `<preceding_prose>`.
 *
 * The charter says it plainly: the Chinese you read just before writing is the
 * Chinese you will write — and the draft so far is the last thing a writer
 * reads. An asset block is a specification, written in keys and values, and
 * leaving one in that position hands the next writer a register to imitate.
 * Nothing replaces it: a marker would be Chinese this pipeline wrote, which is
 * the thing the whole prompt is built to keep out. The cost is stated rather
 * than hidden — a writer continuing the essay cannot see that a diagram was
 * asked for two paragraphs ago, and may explain in prose what the diagram was
 * going to show. Section headings stay: they are the writer's own Chinese and
 * they are how the essay's shape reads.
 */
function stripAssetBlocks(markdown) {
    // The early return is not an optimisation. Text with no slot in it comes
    // back byte for byte, which is what lets the frozen sampler fixtures keep
    // meaning what they meant: the blank-line collapse below can only ever run
    // on text a slot was actually cut out of.
    if (!markdown.includes('```asset'))
        return markdown;
    return markdown.replace(ASSET_BLOCK, '').replace(/\n{3,}/g, '\n\n');
}
/**
 * The degradation for a route with no system channel: the charter rides at
 * the top of the one message, one blank line between. The codex adapter and
 * the workflow's `agent()` calls share these bytes.
 */
function prependSystem(system, prompt) {
    const closed = system.endsWith('\n') ? system : `${system}\n`;
    return `${closed}\n${prompt}`;
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
function assembleLeafPrompt(S, parts) {
    const b = makeBody();
    b.say(S.leaf_marker, '');
    if (present(parts.brief)) {
        b.say(S.brief_heading, '');
        b.part(parts.brief);
        b.say('');
    }
    b.say(S.material_heading, '', '<material>');
    b.part(parts.material);
    b.say('</material>', '');
    if (present(parts.kernel)) {
        b.say(S.must_keep_heading, '', '<must_keep>');
        b.part(parts.kernel);
        b.say('</must_keep>', '');
    }
    if (present(parts.current)) {
        b.say(S.current_heading, '', '<current_text>');
        b.part(parts.current);
        b.say('</current_text>', '');
    }
    if (present(parts.issues)) {
        b.say(S.issues_heading, '', '<issues>');
        b.part(parts.issues);
        b.say('</issues>', '');
    }
    if (present(parts.referenceProse)) {
        b.say(S.read_heading, '', '<reference_prose>');
        b.part(parts.referenceProse);
        b.say('</reference_prose>', '');
    }
    if (present(parts.voiceStyle) || present(parts.voiceExamples)) {
        b.say(S.voice_heading, '', '<user_voice>');
        if (present(parts.voiceStyle))
            b.part(parts.voiceStyle);
        if (present(parts.voiceExamples)) {
            if (present(parts.voiceStyle))
                b.say('');
            b.part(parts.voiceExamples);
        }
        b.say('</user_voice>', '');
    }
    b.say(S.constraints_heading, '');
    for (const constraint of S.constraints)
        b.say(`- ${constraint}`);
    if (present(parts.constraints))
        b.part(parts.constraints);
    b.say('', S.closing);
    // The finished text goes last, past the constraints, and the prompt ends on
    // the line that tells the writer to carry straight on from it. Continuation
    // is the first thing the writer does, and the momentum it picks up is the
    // momentum of whatever it read last. A first unit has nothing behind it, so
    // it gets neither the block nor the line, and its prompt ends where it
    // always ended.
    if (present(parts.preceding)) {
        b.say('', S.preceding_heading, '', '<preceding_prose>');
        b.part(parts.preceding);
        b.say('</preceding_prose>', '', S.preceding_closing);
    }
    return b.text();
}
/** One unit's `brief.en.md`, filled from the stored plan. */
function assembleUnitBrief(S, unit, title) {
    const b = makeBody();
    b.say(fill(S.unit_brief_title, { title }), '');
    b.say(S.unit_role_sentences[unit.role] || S.unit_role_sentences.default);
    if (present(unit.notes_en))
        b.say('', unit.notes_en);
    b.say('');
    const pace = S.pace_sentences[unit.pace];
    if (present(pace))
        b.say(pace);
    const ends = S.ends_sentences[unit.ends];
    if (present(ends))
        b.say(ends);
    b.say('');
    b.say(fill(S.unit_brief_length, { target_chars: String(unit.target_chars) }));
    b.say(S.unit_brief_stop);
    return b.text();
}
/**
 * One unit's `constraints.en.md`.
 *
 * The section line is here rather than in the brief because the plan decides
 * where a section opens and the writer decides what it is called: a boolean
 * travels through the plan without touching the verbatim rule, and the Chinese
 * of the heading is written where all the other Chinese is written.
 */
function assembleUnitConstraints(S, isFirstUnit, opensSection = false) {
    const lines = [isFirstUnit ? S.unit_constraint_first : S.unit_constraint_later];
    // The first unit is already an opening, and its first line is the title. A
    // plan that marks it as opening a section too would otherwise ask the same
    // writer for two different first lines; the mark is dropped rather than
    // refused, because throwing away an entire plan over a redundant flag costs
    // far more than ignoring it.
    if (opensSection && !isFirstUnit)
        lines.push(S.unit_constraint_section);
    return `${lines.map((line) => `- ${line}`).join('\n')}\n`;
}
/** One unit's `kernel.md`, absent when the unit keeps nothing. */
function assembleUnitKernel(unit) {
    return unit.must_keep.length > 0 ? `${unit.must_keep.join('\n\n')}\n` : '';
}
/** The planner's prompt. */
function assemblePlanPrompt(S, inputs) {
    const b = makeBody();
    b.say(S.plan_marker, S.plan_role, '', S.plan_schema_heading, '', S.plan_schema_intro, '', '<schema>');
    b.part(inputs.schemaText);
    b.say('</schema>', '');
    b.say(S.plan_verbatim_heading, '', S.plan_verbatim_rule, '');
    for (const rule of S.plan_field_rules)
        b.say(rule, '');
    b.say(S.plan_how_heading, '');
    for (const rule of S.plan_rules)
        b.say(`- ${rule}`);
    b.say('', S.plan_goal_heading, '', '<goal>');
    b.part(inputs.goal);
    b.say('</goal>', '');
    b.say(S.plan_material_heading, '', S.plan_material_intro, '', '<material>');
    b.part(inputs.material);
    b.say('</material>', '');
    if (present(inputs.voice)) {
        b.say(S.plan_voice_heading, '', S.plan_voice_intro, '', '<voice>');
        b.part(inputs.voice);
        b.say('</voice>', '');
    }
    b.say(S.plan_closing);
    return b.text();
}
/**
 * A refused plan is re-asked once, with the check that refused it named. The
 * script path re-runs the planner too; naming the field is what a script
 * cannot do, because it never opens the plan.
 */
function assemblePlanRetryPrompt(S, planPrompt, failure) {
    return [
        planPrompt,
        S.plan_retry_intro,
        '',
        `${S.plan_retry_field_label} ${failure}`,
        '',
        S.plan_retry_closing,
        '',
    ].join('\n');
}
/** The judge's brief. */
function assembleCheckBrief(S, scope, mustKeep) {
    const b = makeBody();
    b.say(scope === 'whole' ? S.check_role_whole : S.check_role_unit);
    b.say(S.check_role_common, '');
    b.say(S.check_structure_note, '');
    for (const section of S.check_rubric) {
        b.say(section.heading, '');
        for (const block of section.blocks) {
            b.say(block.lead);
            for (const bullet of block.bullets || [])
                b.say(`- ${bullet}`);
            b.say('');
        }
    }
    b.say(S.check_must_keep_heading, '', '<must_keep>');
    b.part(mustKeep.join('\n\n'));
    b.say('</must_keep>', '');
    b.say(S.check_output_heading, '', S.check_output_intro, S.check_output_shape, S.check_output_rules);
    return b.text();
}
/** The check cycle's dispatch prompt — the brief plus the text under check. */
function assembleCheckPrompt(S, brief, candidate, previousReport) {
    let out = `${brief}\n\n${S.check_tail_marker}\n`;
    if (present(previousReport))
        out += `\n${S.check_tail_previous_label}\n${previousReport}`;
    out += `\n${S.check_tail_candidate_label}\n${candidate}`;
    out += `\n\n${S.check_tail_output_intro}\n`;
    out += `${S.check_output_shape}\n`;
    out += `${S.check_tail_output_rules}\n`;
    return out;
}
/**
 * The legacy concatenated repair prompt: the judge's brief plus the one-use
 * issue report. Kept because the four-argument check cycle still builds it;
 * the composed repair path reads `assembleRepairIssues` below instead.
 */
function assembleRepairPrompt(S, brief, candidate, report) {
    let out = `${brief}\n\n${S.repair_tail_marker}\n`;
    out += `\n${S.repair_tail_candidate_label}\n${candidate}`;
    out += `\n\n${S.repair_tail_report_label}\n${report}`;
    out += `\n\n${S.repair_tail_closing[0]}\n`;
    out += `${S.repair_tail_closing[1]}\n`;
    return out;
}
/**
 * The composed repair's `issues.md` — the quoted problems pulled out of the
 * report. The checker's own words, never restated: the same two lines per
 * issue the script-era `jq -r` wrote.
 */
function assembleRepairIssues(check) {
    return check.issues.map((issue) => `- ${issue.quote}\n  ${issue.problem}`).join('\n');
}
// ── the verbatim guard, shared with validate_plan.ts ────────────────────────
// Runs of ASCII whitespace collapse to one space on both sides, so a quote may
// cross a line break. `\s` is not usable here: it also matches the full-width
// space, and a full-width space is a character of the author's text, not
// layout.
function collapseSpace(text) {
    return text.replace(/[ \t\r\n]+/g, ' ');
}
function normalizeQuote(text) {
    return collapseSpace(text).replace(/^ +/, '').replace(/ +$/, '');
}
/**
 * U+3000-U+9FFF: CJK punctuation through the common ideographs, the range the
 * bash guard matched as UTF-8 lead bytes E3-E9. An em dash or a curly quote is
 * ordinary English typography and stays allowed.
 */
function hasCjk(text) {
    return /[　-鿿]/.test(text);
}
/** awk records: a trailing newline does not open one more empty line. */
function textLines(text) {
    const closed = text.endsWith('\n') ? text.slice(0, -1) : text;
    return closed.split('\n');
}
/** validate_plan.ts / compose_unit_parts.ts share this one slicing rule. */
function sliceSpan(lines, from, to) {
    const out = [];
    let inside = false;
    for (const line of lines) {
        if (!inside) {
            if (line === from) {
                inside = true;
                out.push(line);
            }
            continue;
        }
        if (to !== '' && line === to)
            break;
        out.push(line);
    }
    return out;
}
/** A string material answers for every span; a map answers by span file. */
function materialFor(material, file) {
    if (typeof material === 'string')
        return material;
    if (material && typeof material === 'object' && typeof material[file] === 'string') {
        return material[file];
    }
    return null;
}
function allMaterial(material) {
    return typeof material === 'string' ? material : Object.keys(material || {}).map((key) => material[key]).join('\n');
}
/** One unit's material.md: its spans, in order, one blank line between them. */
function unitMaterial(unit, material) {
    const chunks = [];
    for (const span of unit.spans) {
        const text = materialFor(material, span.file);
        if (text === null)
            return null;
        const sliced = sliceSpan(textLines(text), span.from, span.to);
        if (sliced.length === 0)
            return null;
        chunks.push(`${sliced.join('\n')}\n`);
    }
    return chunks.length > 0 ? chunks.join('\n') : null;
}
/**
 * Returns the name of the first check the plan fails, or `null` when it
 * passes. The shape checks a schema already enforces are not repeated; what is
 * left is what a schema cannot say — the Chinese is quoted, `notes_en` is
 * English, the spans resolve, and the unit ids are distinct.
 */
function guardPlan(plan, goal, material) {
    const haystack = collapseSpace(`${goal}\n${allMaterial(material)}`);
    const quoted = (text) => {
        const needle = normalizeQuote(text);
        return needle.length > 0 && haystack.indexOf(needle) >= 0;
    };
    if (!quoted(plan.title))
        return 'title';
    for (const claim of plan.claims) {
        if (!quoted(claim.text))
            return 'claims[].text';
    }
    const seen = [];
    for (const unit of plan.units) {
        if (seen.indexOf(unit.id) >= 0)
            return 'units[].id';
        seen.push(unit.id);
        if (hasCjk(unit.notes_en))
            return 'units[].notes_en';
        const chunks = [];
        for (const span of unit.spans) {
            const text = materialFor(material, span.file);
            if (text === null)
                return 'units[].spans[].file';
            const lines = textLines(text);
            const start = lines.indexOf(span.from);
            if (start < 0)
                return 'units[].spans[].from';
            if (span.to !== '' && lines.indexOf(span.to, start + 1) < 0)
                return 'units[].spans[].to';
            chunks.push(`${sliceSpan(lines, span.from, span.to).join('\n')}\n`);
        }
        const spanText = collapseSpace(chunks.join('\n'));
        for (const keep of unit.must_keep) {
            const needle = normalizeQuote(keep);
            if (needle.length === 0 || spanText.indexOf(needle) < 0)
                return 'units[].must_keep[]';
        }
    }
    return null;
}
// wordtaste:pure-region:end

const material = A.material
const primed = present(A.referenceProse)
// The entry decides which charter the writers read. Normalized once: only the
// exact string 'idea' selects the creation posture, exactly as the composer
// treats the `entry` part file.
const entry = A.entry === 'idea' ? 'idea' : undefined

function intake(error) {
  return {
    stage: 'intake',
    error,
    next: 'Tell the user in one plain sentence that the plan did not come back usable, and stay at intake. Never repair a plan by hand: a sentence you fix is a sentence you wrote.',
  }
}

function halted(plan, prose, error) {
  return {
    stage: 'blocked',
    plan,
    prose,
    error,
    primed,
    next: 'Do not publish this prose or overwrite an existing source draft. Keep workflow.json at review and explain the hard blocker in plain language.',
  }
}

phase('Shape')
let plan = typeof A.plan === 'string' ? JSON.parse(A.plan) : A.plan

if (!plan) {
  const planPrompt = assemblePlanPrompt(SCAFFOLD, {
    schemaText: PLAN_SCHEMA_TEXT,
    goal: A.goal,
    material: allMaterial(material),
    voice: A.voice,
  })
  plan = await agent(planPrompt, { schema: PLAN_SCHEMA, label: 'plan', phase: 'Shape' })

  let failure = plan ? guardPlan(plan, A.goal, material) : 'the planner returned nothing'
  if (failure) {
    // One re-ask, with the check that refused it named. A second refusal is the
    // user's to hear about; it is never the orchestrator's to fix by hand.
    plan = await agent(assemblePlanRetryPrompt(SCAFFOLD, planPrompt, failure), {
      schema: PLAN_SCHEMA,
      label: 'plan-again',
      phase: 'Shape',
    })
    failure = plan ? guardPlan(plan, A.goal, material) : 'the planner returned nothing'
    if (failure) return intake(`the plan was refused twice: ${failure}`)
  }
} else {
  // A stored plan is guarded too: it was written against this material, and a
  // plan that no longer quotes it cannot be written from.
  const failure = guardPlan(plan, A.goal, material)
  if (failure) return intake(`the stored plan no longer matches the material: ${failure}`)
}

if (!A.approved) {
  return {
    stage: 'layout',
    plan,
    next: 'Project this plan with project_plan.ts and return at the layout gate.',
  }
}

phase('Write')
let prose = present(A.draft) ? A.draft : ''
const only = Array.isArray(A.unitIds) && A.unitIds.length > 0 ? A.unitIds : null

for (const unit of plan.units) {
  if (only && only.indexOf(unit.id) < 0) continue

  const unitText = unitMaterial(unit, material)
  if (unitText === null) {
    return intake(`a span of unit ${unit.id} does not resolve against the material given`)
  }

  const unitParts = {
    brief: assembleUnitBrief(SCAFFOLD, unit, plan.title),
    material: unitText,
    kernel: assembleUnitKernel(unit),
    // Stripped, for the reason `stripAssetBlocks` gives: a specification block
    // in the last position a writer reads is a register it will imitate.
    preceding: stripAssetBlocks(prose),
    constraints: assembleUnitConstraints(
      SCAFFOLD,
      unit.id === plan.units[0].id,
      unit.opens_section === true,
    ),
    referenceProse: A.referenceProse,
    voiceStyle: A.voiceStyle,
    voiceExamples: A.voiceExamples,
    entry,
  }
  // `agent()` has no system channel, so the writer's standing charter is
  // prepended to the task message — the same degradation, and the same
  // bytes, as the script path's codex adapter.
  const prompt = prependSystem(
    assembleLeafSystem(SCAFFOLD, unitParts),
    assembleLeafPrompt(SCAFFOLD, unitParts),
  )

  const draft = await agent(prompt, { label: unit.id, phase: 'Write' })
  if (!present(draft)) {
    return halted(plan, prose, `unit ${unit.id} came back empty`)
  }
  prose = prose.length > 0 ? `${prose}\n\n${draft}` : draft
}

phase('Check')
const brief = assembleCheckBrief(
  SCAFFOLD,
  'whole',
  plan.units.reduce((keeps, unit) => keeps.concat(unit.must_keep), []),
)

let check = await agent(assembleCheckPrompt(SCAFFOLD, brief, prose), {
  schema: CHECK_SCHEMA,
  label: 'whole-check',
  phase: 'Check',
})
if (!check) return halted(plan, prose, 'the check did not come back')

// Style findings are advisory and never start a repair: the checker's taste
// in sentences is not the reader's, and a style-only repair loop was seen
// pushing the author's own verbatim sentences out of the text. Only lost
// meaning — kernelOk false or a "meaning" issue — is worth a repair cycle.
const meaningLost = (c) =>
  c.kernelOk === false || c.issues.some((issue) => issue.kind === 'meaning')

if (meaningLost(check)) {
  const report = JSON.stringify(check, null, 2)
  // The repair is a writing job, framed as one. Handed the judge's brief, a
  // repairer answers like a judge — a real run came back with commentary about
  // the issues where the prose should have been. So it reads the material, the
  // sentences that must survive, its own text, and the problems to fix.
  const repairParts = {
    material: allMaterial(A.material),
    kernel: plan.units.reduce((keeps, unit) => keeps.concat(unit.must_keep), []).join('\n\n'),
    current: prose,
    issues: assembleRepairIssues(check),
    referenceProse: A.referenceProse,
    voiceStyle: A.voiceStyle,
    voiceExamples: A.voiceExamples,
    entry,
  }
  // The same system/user split as a written unit, degraded the same way:
  // `agent()` has no system channel, so the charter rides at the top of the
  // one message.
  const repairPrompt = prependSystem(
    assembleLeafSystem(SCAFFOLD, repairParts),
    assembleLeafPrompt(SCAFFOLD, repairParts),
  )
  const repaired = await agent(repairPrompt, {
    label: 'repair',
    phase: 'Check',
  })
  if (!present(repaired)) return halted(plan, prose, 'the repair did not come back')
  prose = repaired

  check = await agent(assembleCheckPrompt(SCAFFOLD, brief, prose, report), {
    schema: CHECK_SCHEMA,
    label: 'recheck',
    phase: 'Check',
  })
  if (!check) return halted(plan, prose, 'the recheck did not come back')
}

const advisory = check.issues.filter((issue) => issue.kind === 'style').length
const stage = meaningLost(check) ? 'blocked' : 'done'

// blocked: do not overwrite an existing source draft; the limit is one repair
// and one recheck, so do not start another internal repair loop.
// done: style findings, if any, ride along as `advisory` for the user.
return {
  stage,
  plan,
  prose,
  check,
  advisory,
  primed,
  next:
    stage === 'blocked'
      ? 'Do not publish this prose or overwrite an existing source draft. Keep workflow.json at review and explain the hard blocker in plain language.'
      : 'Write draft.md, set workflow.json to final, and translate judge language into plain user-facing copy. Style findings, if any, are advisory: show them as suggestions, never as a gate.',
}
