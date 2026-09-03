#!/usr/bin/env node

/**
 * Plotwise segment scriptwriter — a DETERMINISTIC LLM call, not an agent.
 *
 * Turns a segment brief (direction + beat + evidence + style recipe) into
 * the two artifacts a shoot needs: the verbatim narration script and the
 * H3 Max video prompt that embeds it. The prompt template lives HERE so
 * every segment goes through the same discipline regardless of which agent
 * asked — this is the fast inner loop, and it must not depend on an
 * agent's mood.
 *
 * Model: GPT 5.6 Luna via OpenRouter (--model to override).
 *
 * Fallback contract (SKILL.md `## Script fallback chain` documents the
 * policy): when no OPENROUTER_API_KEY is available this exits with CODE 3
 * and a machine-readable line, and the calling agent falls back to its own
 * backend's model — a light subagent where the backend has one, the main
 * agent itself as the last resort. The BRIEF → OUTPUT contract below stays
 * identical in every lane; only the writer changes.
 *
 * Usage:
 *   node write-script.mjs --brief-file brief.json [--model openai/gpt-5.6-luna]
 *
 * The brief file (JSON):
 *   {
 *     "direction":  "what this segment does, as pitched on the choice card",
 *     "language":   "zh" | "en" | ...,
 *     "duration":   5-15 (seconds),
 *     "style":      { "id": "...", "recipe": "<prompt fragment from styles.md>",
 *                     "narration": "on-camera" | "voiceover" },
 *     "beat":       { "title": "...", "summary": "..." },
 *     "evidence":   [ { "kind": "...", "file": "...", "note": "..." } ],
 *     "context":    "1-3 sentences: what the learner has already seen",
 *     "characters": [ "The code-rendered knowledge figure \"x.png\" is available as a reference..." ] // optional, by name
 *   }
 *
 * Output (stdout, strict JSON):
 *   {
 *     "script":       "verbatim narration, fits the duration",
 *     "video_prompt": "full H3 Max prompt embedding the narration in quotes",
 *     "needs_figure_refs": ["<evidence file the prompt depends on>", ...]
 *   }
 *
 * The caller is responsible for the EVIDENCE GATE: if the returned prompt
 * describes a knowledge visual (formula, plot, diagram, data) and
 * `needs_figure_refs` names no rendered figure to anchor it, the shoot
 * must not proceed on text-to-video — re-render the figure and shoot
 * image-/reference-to-video instead.
 *
 * Environment:
 *   OPENROUTER_API_KEY — environment first, then `.env` discovered like
 *   the shared scripts (skill root, then walking up from cwd). Never
 *   printed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

/** Speech budget: ~4.5 Chinese characters or ~2.4 English words per second. */
function speechBudget(language, seconds) {
  if (String(language).startsWith("zh")) {
    return `${Math.round(seconds * 4)}-${Math.round(seconds * 4.8)} Chinese characters`;
  }
  return `${Math.round(seconds * 2)}-${Math.round(seconds * 2.6)} English words`;
}

function findEnvFile() {
  const skillRoot = dirname(__dirname);
  const skillEnv = join(skillRoot, ".env");
  if (existsSync(skillEnv)) return skillEnv;

  let dir = process.cwd();
  while (true) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) return envPath;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = findEnvFile();
  if (!envPath) return null;
  const content = readFileSync(envPath, "utf-8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    if (line.slice(0, eqIdx).trim() !== "OPENROUTER_API_KEY") continue;
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return null;
}

function fail(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

const { values: args } = parseArgs({
  options: {
    "brief-file": { type: "string" },
    model: { type: "string", default: DEFAULT_MODEL },
  },
});

if (!args["brief-file"]) fail("--brief-file is required");
if (!existsSync(args["brief-file"])) fail(`brief file not found: ${args["brief-file"]}`);

let brief;
try {
  brief = JSON.parse(readFileSync(args["brief-file"], "utf-8"));
} catch (e) {
  fail(`brief file is not valid JSON: ${e.message}`);
}
for (const field of ["direction", "language", "duration", "style", "beat"]) {
  if (brief[field] == null) fail(`brief is missing "${field}"`);
}

const key = loadKey();
if (!key) {
  // Machine-readable fallback signal — see the fallback contract above.
  console.error("NO_OPENROUTER_KEY: fall back to the backend's own model using the same brief contract.");
  process.exit(3);
}

// ---------------------------------------------------------------------------
// The segment-writing discipline. This template IS the deterministic part.
// ---------------------------------------------------------------------------

const evidenceBlock = (brief.evidence ?? [])
  .map((e) => `- [${e.kind}] ${e.file ?? e.url ?? ""} — ${e.note ?? ""}`)
  .join("\n");

const charactersBlock = (brief.characters ?? []).join("\n");

const systemPrompt = `You are the segment writer for an interactive learning-video course. You turn one segment brief into (a) a verbatim narration script and (b) a video-generation prompt for MiniMax H3 Max, which speaks tagged narration word-for-word with lipsync.

Hard rules, in priority order:
1. FACTUAL PRECISION LIVES IN THE NARRATION. Every claim in the script must be supported by the brief's evidence list or be uncontroversial world knowledge already vetted by the course plan. Never introduce facts the brief does not carry.
2. THE VIDEO MODEL IS NEVER TRUSTED WITH KNOWLEDGE VISUALS. If the segment needs a formula, plot, coordinate system, diagram, or data on screen, the prompt must describe it as faithfully reproducing a provided reference figure (name it in needs_figure_refs) — never ask the model to draw knowledge from imagination. Atmosphere, characters, camera moves, and generic scenery are the model's to invent; facts are not.
3. THE NARRATION FITS THE CLIP. Respect the speech budget exactly; a script that cannot be spoken in the duration produces a rushed or truncated clip.
4. ONE SEGMENT, ONE IDEA, ONE CONTINUOUS SHOT. Multi-cut sequences drift; a segment is a single continuous shot. End on a beat that makes the offered continuations feel like real choices.

Write video_prompt in the model's own three-section format (this is the shape its prompt expander rewrites toward — a well-formed prompt passes through with minimal mutation):

integrated_multimodal_description: [Shot 1] One continuous shot. The style recipe woven into concrete visual detail (never abstract words like "cinematic" or "beautiful"). Subject and scene, with close or medium framing whenever a character's face matters (wide shots distort faces — architecture-level, not fixable). Camera motion written inline as natural English (motion + amplitude + speed, e.g. "the camera pushes in with small amplitude at slow speed"), never as bracket tags. The narration clause: for on-camera mode, describe the speaker with a stable ID then the line — 'The <speaker description> (S1) says: <d>[<Language>] <exact narration></d>'; for voiceover mode use exactly — 'A <voice description> says in an off-screen voiceover: <d>[<Language>] <exact narration></d>' and state that no on-screen character's lips move. References when figures/characters are provided: mention each one you use by NAME with exactly ONE explicit job (the reference figure "x.png" appears on the board, reproduced faithfully — do not alter its labels); the producer binds and numbers the images. A figure you do not show is not mentioned at all. Close with explicit negative constraints — always at least: no soft dissolves or fluid morphs; do not introduce any on-screen text that is not spelled out in this prompt; no garbled characters. Any visible text MUST be spelled out verbatim in double quotes.
overall_soundscape: 1-2 sentences of diegetic ambience matched to the scene (chalk scratching, room tone), or N/A for silence-under-voiceover.
non_diegetic_music: N/A unless the style genuinely calls for scoring — unspecified music is the documented cause of random unwanted background tracks.

Output STRICT JSON only, no markdown fences:
{"script": "...", "video_prompt": "...", "needs_figure_refs": ["..."]}
script is the bare narration text (no tags); video_prompt embeds the same text inside the <d>...</d> clause, verbatim.`;

const userPrompt = `SEGMENT BRIEF

Direction (what this segment must do): ${brief.direction}
Course beat: ${brief.beat.title}${brief.beat.summary ? ` — ${brief.beat.summary}` : ""}
What the learner has already seen: ${brief.context ?? "(course opening — nothing yet)"}

Language of narration: ${brief.language}
Clip duration: ${brief.duration} seconds
Speech budget: ${speechBudget(brief.language, brief.duration)}

Visual style recipe (weave into the prompt): ${brief.style.recipe ?? brief.style.id}
Narration mode: ${brief.style.narration ?? "voiceover"}
${charactersBlock ? `References available to this segment (use only what the shot needs; refer to them by name):\n${charactersBlock}` : ""}

Evidence available to this segment:
${evidenceBlock || "(none — the segment must stay on vetted world knowledge and use NO knowledge visuals)"}

Binding rules: needs_figure_refs may name ONLY figure files from the evidence list above (use the exact path) — a figure that is not listed does not exist, and the prompt must not ask for it. A figure you show gets exactly one sentence in the prompt saying what it does in this shot, by name; a figure you do not show is left out of both the prompt and needs_figure_refs. Most segments show no figure — a scene, a character, a metaphor carry the idea; a figure is for the moment a plot, a coordinate system, a formula or a table must be exact.
${brief.revision_note ? `\nREVISION REQUEST (this overrides everything above about length): ${brief.revision_note}\n` : ""}
Write the script and the video prompt now.`;

const resp = await fetch(OPENROUTER_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: args.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  }),
});

if (!resp.ok) {
  const text = await resp.text().catch(() => "");
  fail(`OpenRouter returned HTTP ${resp.status}: ${text.slice(0, 500)}`);
}

const result = await resp.json();
const content = result?.choices?.[0]?.message?.content;
if (typeof content !== "string") {
  fail(`no completion in response: ${JSON.stringify(result).slice(0, 300)}`);
}

// Tolerate a fenced or prefixed JSON body.
const jsonMatch = content.match(/\{[\s\S]*\}/);
if (!jsonMatch) fail(`completion carried no JSON object: ${content.slice(0, 300)}`);

let parsed;
try {
  parsed = JSON.parse(jsonMatch[0]);
} catch (e) {
  fail(`completion JSON did not parse: ${e.message}\n${jsonMatch[0].slice(0, 300)}`);
}
if (typeof parsed.script !== "string" || typeof parsed.video_prompt !== "string") {
  fail(`completion JSON is missing script/video_prompt: ${jsonMatch[0].slice(0, 300)}`);
}

console.log(
  JSON.stringify({
    script: parsed.script,
    video_prompt: parsed.video_prompt,
    needs_figure_refs: Array.isArray(parsed.needs_figure_refs)
      ? parsed.needs_figure_refs.map(String)
      : [],
  }),
);
