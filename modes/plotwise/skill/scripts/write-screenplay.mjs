#!/usr/bin/env node

/**
 * Plotwise screenplay writer — the whole main line of a course, in one
 * command.
 *
 * Runs after the outline has landed and the style has been confirmed,
 * and before the play manager starts: Luna turns every outline beat into
 * ONE scene of 1-3 montage clips (with a detour brief hanging off each),
 * the draft is validated against the speech budget, the shot list's shape
 * and the beat's rendered evidence, and the result is landed into
 * course.json under the same lock every other writer uses — `n1..nK` main
 * scenes, `n<k>d` detour stubs, children linked, `rootNode` set.
 *
 * This is a DETERMINISTIC LLM call, not an agent: the discipline lives in
 * `screenplay-lib.mjs` so every course goes through the same one.
 *
 * Usage (from the session cwd; paths inside course.json are set-relative):
 *   node write-screenplay.mjs --set plexus [--model openai/gpt-5.6-luna] [--json]
 *
 * Output (--json): { scenes, clips, cuts, problems, mode }
 *   mode is "single" when one call covered the whole spine, "fallback"
 *   when it was written scene by scene. `problems` names every clip that
 *   is over its speech budget or short of a montage, every figure that is
 *   not on disk, and every beat the writer missed — reported, never
 *   swallowed.
 *
 * Exit codes:
 *   0  landed
 *   1  nothing to write against (empty outline), no confirmed style, no
 *      API key, or the write/land itself failed
 *
 * Environment:
 *   OPENROUTER_API_KEY — environment first, then the skill's `.env`, then
 *   a `.env` walking up from cwd. Never printed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  DEFAULT_MODEL,
  chatJson,
  detectLanguage,
  loadEnvKey,
  readCourse,
  resolveStyle,
  withCourseLock,
} from "./segment-lib.mjs";
import { landScreenplay, writeScreenplay } from "./screenplay-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(__dirname);
const STYLES_MD = join(SKILL_ROOT, "references", "styles.md");

const { values: args } = parseArgs({
  options: {
    set: { type: "string" },
    model: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

function fail(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

if (!args.set) fail("--set is required");
const setDir = resolve(args.set);

let course;
try {
  course = readCourse(setDir);
} catch (e) {
  fail(e.message);
}

const beats = Array.isArray(course.outline) ? course.outline : [];
if (beats.length === 0) {
  fail(
    "the outline is empty — a screenplay is written against the spine. Land the planner's beats first: `course-edit.mjs outline --set <dir> --file <beats.json>`.",
  );
}

const style = resolveStyle(course, existsSync(STYLES_MD) ? readFileSync(STYLES_MD, "utf-8") : null);
if (!style.id || style.status !== "confirmed") {
  fail(
    `the style is ${style.id ? `"${style.id}" (${style.status})` : "not chosen yet"} — every cut is composed in the style's materials, so confirm it on the board first (\`course-edit.mjs confirm-style --set <dir>\`).`,
  );
}

const key = loadEnvKey("OPENROUTER_API_KEY", { skillRoot: SKILL_ROOT });
if (!key) {
  fail(
    "no OPENROUTER_API_KEY (checked the environment, the skill's .env, and every .env above the session) — the screenplay is one designed model call and has no offline lane.",
  );
}

const language = course.language ?? detectLanguage(`${course.title ?? ""} ${course.topic ?? ""} ${course.goal ?? ""}`);
const model = args.model ?? DEFAULT_MODEL;
const chat = ({ system, user }) => chatJson({ key, model, system, user, temperature: 0.7 });

let written;
try {
  written = await writeScreenplay({
    course,
    chat,
    setDir,
    styleRecipe: style.recipe,
    styleDevices: style.devices,
    narration: style.narration,
    language,
  });
} catch (e) {
  fail(`the screenplay could not be written: ${e.message}`);
}

if (written.scenes.length === 0) {
  fail(
    `the writer produced no scenes${written.problems.length ? ` — ${written.problems.join("; ")}` : ""}`,
  );
}

try {
  withCourseLock(setDir, (c) =>
    landScreenplay(c, written.scenes, {
      language,
      styleRecipe: style.recipe,
      narration: style.narration,
    }),
  );
} catch (e) {
  fail(`the screenplay was written but could not be landed in course.json: ${e.message}`);
}

const clips = written.scenes.reduce((n, s) => n + s.clips.length, 0);
const cuts = written.scenes.reduce((n, s) => n + s.clips.reduce((m, c) => m + c.cuts.length, 0), 0);
const payload = {
  scenes: written.scenes.length,
  clips,
  cuts,
  problems: written.problems,
  mode: written.mode,
};

if (args.json) {
  console.log(JSON.stringify(payload));
} else {
  console.log(`${payload.scenes} scenes / ${payload.clips} clips / ${payload.cuts} cuts landed (${payload.mode})`);
  for (const problem of payload.problems) console.log(`  ! ${problem}`);
}
