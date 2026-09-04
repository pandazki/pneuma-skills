#!/usr/bin/env node

/**
 * Plotwise style sample — the style board's one producer.
 *
 * Turns a style candidate (a catalog preset, or a custom recipe the
 * session wrote from the learner's description) into the SAMPLE the
 * learner confirms on the board: a STYLE KEY FRAME (GPT-Image-2, the
 * recipe composed around the hook's device) and the hook's first MONTAGE
 * CLIP shot from it. course.json `style` moves pending → sampling (anchor
 * written) → sampled (clip written); the board renders each step as it
 * lands. On confirmation the clip becomes the course's voice reference
 * and the anchor becomes Image 1 of every clip — the sample IS the course
 * in miniature, shot through the same writer and the same assembler, so
 * what the learner confirms is what they get.
 *
 * Usage (from the session cwd):
 *   node make-style-sample.mjs --set <dir> --style-id chalkboard \
 *     --hook "为什么直角三角形的三条边,永远绑在一个等式里?" \
 *     --action "three chalk line segments slide together into a right triangle, and a chalk square grows off each side until the two smaller squares visibly tile the largest" \
 *     [--name "<display name>"] [--recipe "<custom recipe>"] \
 *     [--rationale "<why this style, user's language>"] \
 *     [--ref-image style/refs/a.png]... [--duration 15] [--language zh] --json
 *
 * --hook is the spoken line; --action is the VISUAL DEVICE — what these
 * seconds show, in matter the camera can see, no formulas or labels or
 * numbers (those are the course's job, with real figures). Both are
 * required: a sample without a device is the empty set with a voice over
 * it, which shows the look but not the topic — the first live sample of
 * this mode was exactly that (an empty papercraft blackboard under a
 * Fourier hook), and it is also what the anchor is now composed around.
 *
 * The shot list itself is written by Luna (`SAMPLE_SYSTEM`) and assembled
 * by `h3-prompt.mjs`, exactly as a scene is. Without an
 * OPENROUTER_API_KEY the sample falls back to one long cut over the
 * device — the same four blocks, one cut instead of six — and says so.
 *
 * --recipe is required for --style-id custom and optional for presets
 * (an adjusted preset keeps its id and carries the revised recipe).
 * --ref-image records learner-provided references (set-relative paths;
 * copy them under <set>/style/refs/ first) and binds them into the
 * sample shoot as Image 2+.
 *
 * Exit 0 with JSON { status: "sampled", image, video, timings } — or
 * exit 1 with the style reset to pending and `sample.error` set, so the
 * board shows what went wrong instead of spinning forever.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

import { DEFAULT_MODEL, chatJson, detectLanguage, loadEnvKey, parseStyleCatalog, readCourse, withCourseLock } from "./segment-lib.mjs";
import { SAMPLE_SYSTEM, sampleUser, validateSampleClip } from "./screenplay-lib.mjs";
import { bindingLines, buildClipPrompt, defaultCamera, insertReferenceBlock } from "./h3-prompt.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(__dirname);
const STYLES_MD = join(SKILL_ROOT, "references", "styles.md");
const GENERATE_IMAGE = join(__dirname, "generate_image.mjs");
const GENERATE_VIDEO = join(__dirname, "generate-video.mjs");

const { values: args } = parseArgs({
  options: {
    set: { type: "string" },
    "style-id": { type: "string" },
    name: { type: "string" },
    recipe: { type: "string" },
    rationale: { type: "string" },
    hook: { type: "string" },
    action: { type: "string" },
    language: { type: "string" },
    model: { type: "string" },
    duration: { type: "string", default: "15" },
    resolution: { type: "string", default: "480P" },
    "ref-image": { type: "string", multiple: true, default: [] },
    json: { type: "boolean", default: false },
  },
});

function fail(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

for (const required of ["set", "style-id", "hook", "action"]) {
  if (!args[required] || !String(args[required]).trim()) {
    fail(
      required === "action"
        ? "--action is required: the visual device these seconds SHOW, in matter the camera can see. Without it the sample is the empty set with a voice over it, and so is the anchor."
        : `--${required} is required`,
    );
  }
}
const action = args.action.trim().replace(/[.。]+$/, "");

const setDir = resolve(args.set);
const styleId = args["style-id"];
const catalog = existsSync(STYLES_MD) ? parseStyleCatalog(readFileSync(STYLES_MD, "utf-8")) : new Map();
const preset = catalog.get(styleId);
const recipe = (args.recipe && args.recipe.trim()) || preset?.recipe;
if (!recipe) fail(`"${styleId}" is not a catalog style and no --recipe was given`);
const narration = preset?.narration ?? "voiceover";

const course = readCourse(setDir);
const language = args.language ?? course.language ?? detectLanguage(`${course.title ?? ""} ${course.goal ?? ""}`);
const topic = course.topic || course.title || "";
const duration = Math.min(15, Math.max(8, Number(args.duration) || 15));
const userRefs = args["ref-image"].filter((f) => existsSync(join(setDir, f)));
for (const f of args["ref-image"]) if (!userRefs.includes(f)) console.error(`WARN: reference image not found, skipped: ${f}`);

const styleDir = join(setDir, "style");
mkdirSync(styleDir, { recursive: true });
const ANCHOR_REL = "style/anchor.png";
const SAMPLE_REL = "style/sample.mp4";

const timings = {};
const t0 = performance.now();
let stepStart = t0;
function mark(step) {
  const now = performance.now();
  timings[step] = Math.round((now - stepStart) / 100) / 10;
  stepStart = now;
}

function setStyle(patch) {
  withCourseLock(setDir, (c) => {
    const prev = c.style && typeof c.style === "object" ? c.style : {};
    c.style = { ...prev, ...patch, sample: { ...(prev.sample ?? {}), ...(patch.sample ?? {}) } };
    return c;
  });
}

function run(script, argv) {
  return spawnSync(process.execPath, [script, ...argv], { encoding: "utf-8", cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 });
}

function abort(reason) {
  setStyle({ status: "pending", sample: { error: reason } });
  timings.total = Math.round((performance.now() - t0) / 100) / 10;
  if (args.json) console.log(JSON.stringify({ status: "failed", reason, timings }));
  else console.log(`failed: ${reason}`);
  process.exit(1);
}

// ── 1. Candidate on file ────────────────────────────────────────────────

setStyle({
  id: styleId,
  ...(args.name ? { name: args.name } : styleId === "custom" ? { name: "自定义风格" } : {}),
  ...(args.recipe ? { recipe: args.recipe.trim() } : {}),
  ...(args.rationale ? { rationale: args.rationale } : {}),
  ...(userRefs.length ? { userRefs } : {}),
  status: "sampling",
  sample: { hook: args.hook, image: undefined, video: undefined, error: undefined },
});

// ── 2. Anchor still ─────────────────────────────────────────────────────

// A STYLE KEY FRAME, not an empty set. This still is Image 1 of every
// clip in the course, so it has to carry the look at full strength —
// composed, lit, with the topic's own device in frame. "The set, ready
// but not yet in use" was the 0.5 anchor, and a course of montages
// anchored on an empty room inherits the emptiness (2026-09-04).
const anchorPrompt = `${recipe} A single composed key frame from a short learning video about "${topic || "the course topic"}": ${action}, caught at its most legible moment and filling the frame. No text, no letters, no captions, no numbers, no logos, no watermark. 16:9.`;
// An anchor already on file for this exact recipe and topic is kept: a
// re-run after a failed shoot (the clip endpoint was down; the learner
// asked again) must not spend another minute and another image on a
// frame that did not change. `style/anchor.json` is the record of what
// the frame on file was made from.
const ANCHOR_META = join(styleDir, "anchor.json");
let anchorReused = false;
{
  let onFile = null;
  try {
    onFile = existsSync(ANCHOR_META) ? JSON.parse(readFileSync(ANCHOR_META, "utf-8")) : null;
  } catch {
    onFile = null;
  }
  // The device is part of the frame now, so it is part of the identity of
  // what is on file: a re-run with a different device needs a new anchor.
  if (
    onFile &&
    onFile.style_id === styleId &&
    onFile.recipe === recipe &&
    (onFile.topic ?? "") === topic &&
    (onFile.action ?? "") === action &&
    existsSync(join(setDir, ANCHOR_REL))
  ) {
    anchorReused = true;
  } else {
    const r = run(GENERATE_IMAGE, [anchorPrompt, "--aspect-ratio", "16:9", "--quality", "medium", "--output-dir", styleDir, "--filename-prefix", "anchor"]);
    if (r.status !== 0 || !existsSync(join(setDir, ANCHOR_REL))) {
      abort(`style anchor generation failed: ${(r.stderr || "").trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    }
    writeFileSync(ANCHOR_META, `${JSON.stringify({ produced_at: new Date().toISOString(), style_id: styleId, recipe, topic, action, prompt: anchorPrompt }, null, 2)}\n`);
  }
}
mark("anchor");
setStyle({ sample: { image: ANCHOR_REL } });

// ── 3. Sample clip ──────────────────────────────────────────────────────

// The shot list: written by the same writer, under the same grammar, and
// assembled by the same module as every scene of the course. Keyless (or
// when the call fails) it degrades to ONE cut over the device — still the
// four blocks, so the sample is never a different kind of artifact.
const key = loadEnvKey("OPENROUTER_API_KEY", { skillRoot: SKILL_ROOT, cwd: setDir });
let clip = null;
let writer = "luna";
let writerProblems = [];
if (key) {
  try {
    const raw = await chatJson({
      key,
      model: args.model ?? DEFAULT_MODEL,
      system: SAMPLE_SYSTEM,
      user: sampleUser({ topic, goal: course.goal, hook: args.hook, action, styleRecipe: recipe, styleDevices: preset?.devices ?? "", styleName: args.name ?? styleId, narration, language, duration }),
      temperature: 0.7,
    });
    const checked = validateSampleClip(raw?.clips?.[0] ?? raw?.clip ?? raw, { language, duration });
    writerProblems = checked.problems;
    if (checked.clip?.cuts?.length) clip = { ...checked.clip, duration };
    else writerProblems.push("the writer returned no cuts");
  } catch (e) {
    writerProblems.push(`the writer failed — ${e.message}`);
  }
}
if (!clip) {
  writer = key ? "fallback" : "keyless";
  if (writerProblems.length) console.error(`WARN: ${writerProblems.join("; ")} — shooting the device as one cut instead`);
  clip = {
    duration,
    theme: topic,
    cuts: [{ from: 0, to: duration, shot: action, camera: defaultCamera(language) }],
    narration: [{ from: 0, to: duration, text: args.hook }],
    figures: [],
  };
}

const samplePrompt = insertReferenceBlock(
  buildClipPrompt({ styleRecipe: recipe, narration, language, clip }),
  bindingLines({
    refs: [
      { file: ANCHOR_REL, job: "style-anchor", kind: "image" },
      ...userRefs.map((file) => ({ file, job: "character", kind: "image" })),
    ],
    narration,
  }),
);

// Reference-to-video, like every clip of the course: the anchor is a look
// reference, not a first frame. If that endpoint is down — 2026-09-02 it
// answered 504 "downstream_service_unavailable" for hours while
// text-to-video and image-to-video answered — the shoot falls back to
// image-to-video from the anchor rather than leaving the board stuck.
let shot;
let endpointUsed = "reference";
let fallbackReason = null;
{
  const base = ["--prompt", samplePrompt, "--output", join(setDir, SAMPLE_REL), "--duration", String(duration), "--resolution", args.resolution, "--expansion", "balanced", "--json"];
  const viaReference = () => {
    const argv = [...base, "--ref-image", join(setDir, ANCHOR_REL)];
    for (const f of userRefs) argv.push("--ref-image", join(setDir, f));
    return run(GENERATE_VIDEO, argv);
  };
  const viaImage = () => run(GENERATE_VIDEO, [...base, "--image", join(setDir, ANCHOR_REL)]);
  let r = viaReference();
  if (r.status !== 0 && /HTTP 5\d\d|request failed/.test(r.stderr || "")) {
    fallbackReason = (r.stderr || "").trim().split("\n").pop().slice(0, 200);
    console.error(`WARN: reference-to-video failed (${fallbackReason}) — shooting image-to-video from the anchor instead; the learner's references are not in this sample`);
    endpointUsed = "image";
    r = viaImage();
  }
  if (r.status !== 0) abort(`sample shoot failed: ${(r.stderr || "").trim().slice(0, 300)}`);
  try {
    shot = JSON.parse(r.stdout);
  } catch (e) {
    abort(`generate-video.mjs returned non-JSON: ${e.message}`);
  }
}
mark("sample");

writeFileSync(
  join(styleDir, "sample.json"),
  `${JSON.stringify(
    {
      produced_at: new Date().toISOString(),
      style_id: styleId,
      recipe,
      narration,
      hook: args.hook,
      action,
      anchor_prompt: anchorPrompt,
      anchor_reused: anchorReused,
      endpoint: endpointUsed,
      fallback: fallbackReason,
      writer,
      writer_problems: writerProblems,
      clip,
      prompt: samplePrompt,
      expanded_prompt: shot.expanded_prompt ?? null,
      seed: shot.seed ?? null,
      refs: [ANCHOR_REL, ...userRefs],
      loudness: shot.loudness ?? null,
      timings,
    },
    null,
    2,
  )}\n`,
);

setStyle({ status: "sampled", sample: { video: SAMPLE_REL } });
timings.total = Math.round((performance.now() - t0) / 100) / 10;

if (args.json) {
  console.log(JSON.stringify({ status: "sampled", style: styleId, image: ANCHOR_REL, video: SAMPLE_REL, timings }));
} else {
  console.log(`sampled: ${styleId} → ${SAMPLE_REL}`);
}
