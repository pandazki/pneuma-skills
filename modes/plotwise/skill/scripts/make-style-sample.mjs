#!/usr/bin/env node

/**
 * Plotwise style sample — the style board's one producer.
 *
 * Turns a style candidate (a catalog preset, or a custom recipe the
 * session wrote from the learner's description) into the SAMPLE the
 * learner confirms on the board: a style-anchor still (GPT-Image-2, from
 * the recipe) and a 5-second H3 Max clip shot from that anchor, speaking
 * one hook line about the topic. course.json `style` moves
 * pending → sampling (anchor written) → sampled (clip written); the
 * board renders each step as it lands. On confirmation the clip's last
 * frame seeds the course's frame chain — the sample IS the opening look.
 *
 * Usage (from the session cwd):
 *   node make-style-sample.mjs --set <dir> --style-id chalkboard \
 *     --hook "为什么直角三角形的三条边,永远绑在一个等式里?" \
 *     --action "three chalk line segments slide together into a right triangle, and a chalk square grows off each side until the two smaller squares visibly tile the largest" \
 *     [--name "<display name>"] [--recipe "<custom recipe>"] \
 *     [--rationale "<why this style, user's language>"] \
 *     [--ref-image style/refs/a.png]... [--duration 5] [--language zh] --json
 *
 * --hook is the spoken line; --action is what those five seconds SHOW —
 * the hook made visible in the style's own materials (motion, not text:
 * no formulas, labels or numbers, which are the course's job with real
 * figures). Both are required: a sample without an action is the empty
 * set with a voice over it, which shows the look but not the topic — the
 * first live sample of this mode was exactly that (an empty papercraft
 * blackboard under a Fourier hook).
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

import { detectLanguage, parseStyleCatalog, readCourse, withCourseLock } from "./segment-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(__dirname);
const STYLES_MD = join(SKILL_ROOT, "references", "styles.md");
const GENERATE_IMAGE = join(__dirname, "generate_image.mjs");
const GENERATE_VIDEO = join(__dirname, "generate-video.mjs");

const LANGUAGE_NAMES = { zh: "Chinese", en: "English", ja: "Japanese" };

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
    duration: { type: "string", default: "5" },
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
        ? "--action is required: what the five seconds SHOW, in the style's materials — the hook made visible. Without it the sample is the empty set with a voice over it."
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
const langName = LANGUAGE_NAMES[String(language).slice(0, 2)] ?? "English";
const topic = course.topic || course.title || "";
const duration = Math.min(15, Math.max(5, Number(args.duration) || 5));
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

const anchorPrompt = `${recipe} A single wide establishing frame of the set where a short learning video about "${topic || "the course topic"}" will be narrated — the board, stage or scene itself, ready but not yet in use. No text, no letters, no captions, no logos, no watermark. Clean composition, 16:9.`;
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
  if (onFile && onFile.style_id === styleId && onFile.recipe === recipe && (onFile.topic ?? "") === topic && existsSync(join(setDir, ANCHOR_REL))) {
    anchorReused = true;
  } else {
    const r = run(GENERATE_IMAGE, [anchorPrompt, "--aspect-ratio", "16:9", "--quality", "medium", "--output-dir", styleDir, "--filename-prefix", "anchor"]);
    if (r.status !== 0 || !existsSync(join(setDir, ANCHOR_REL))) {
      abort(`style anchor generation failed: ${(r.stderr || "").trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    }
    writeFileSync(ANCHOR_META, `${JSON.stringify({ produced_at: new Date().toISOString(), style_id: styleId, recipe, topic, prompt: anchorPrompt }, null, 2)}\n`);
  }
}
mark("anchor");
setStyle({ sample: { image: ANCHOR_REL } });

// ── 3. Sample clip ──────────────────────────────────────────────────────

// The anchor is the sample's first frame: image-to-video starts from it
// exactly, so that is the default shoot. Reference-to-video is used only
// when the learner supplied references of their own (a character that
// must keep its identity), and if that endpoint is down — 2026-09-02 it
// answered 504 "downstream_service_unavailable" for hours while
// text-to-video and image-to-video answered — the shoot falls back to
// image-to-video from the anchor rather than leaving the board stuck.
const wantReference = userRefs.length > 0;
const refLines = wantReference
  ? [
      "Image 1 is the course's style anchor — reproduce its palette, materials, line quality, lighting and set exactly; this shot takes place in that scene.",
      ...userRefs.map((_, i) => `Image ${i + 2} is a reference the learner provided — match its look and mood closely.`),
    ]
  : ["The first frame is the course's style anchor — keep its palette, materials, line quality, lighting and set exactly; this shot takes place in that scene."];
const narrationClause =
  narration === "on-camera"
    ? `The host (S1), framed at medium distance facing the camera, says: <d>[${langName}] ${args.hook}</d>`
    : `A clear, warm narrator says in an off-screen voiceover: <d>[${langName}] ${args.hook}</d>. No on-screen character's lips move.`;
const samplePrompt = [
  `integrated_multimodal_description: [Shot 1] One continuous shot. ${recipe} ${refLines.join(" ")} In that scene, ${action}. The action fills the ${duration} seconds and is the visual focus; the camera pushes in with small amplitude at slow speed as it unfolds. ${narrationClause} No soft dissolves or fluid morphs; do not introduce any on-screen text, labels, formulas or numbers; no garbled characters.`,
  "overall_soundscape: quiet room tone matched to the scene.",
  "non_diegetic_music: N/A",
].join("\n");

let shot;
let endpointUsed = wantReference ? "reference" : "image";
let fallbackReason = null;
{
  const base = ["--prompt", samplePrompt, "--output", join(setDir, SAMPLE_REL), "--duration", String(duration), "--resolution", args.resolution, "--expansion", "balanced", "--json"];
  const viaReference = () => {
    const argv = [...base, "--ref-image", join(setDir, ANCHOR_REL)];
    for (const f of userRefs) argv.push("--ref-image", join(setDir, f));
    return run(GENERATE_VIDEO, argv);
  };
  const viaImage = () => run(GENERATE_VIDEO, [...base, "--image", join(setDir, ANCHOR_REL)]);
  let r = wantReference ? viaReference() : viaImage();
  if (r.status !== 0 && wantReference && /HTTP 5\d\d|request failed/.test(r.stderr || "")) {
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
