#!/usr/bin/env node

/**
 * rig-3d.mjs — a character picture → a rigged, animated 3D model, on fal.ai
 * with Meshy.
 *
 * Two paid steps and one free one:
 *
 *   model    `meshy/v7.1/image-to-3d` with rigging on ($0.80). One cut-out
 *            becomes a textured mesh, a rigged copy of it, and Meshy's two
 *            basic clips (walk, run). The RIGGED GLB is the model — it is
 *            what `model.glb` holds; the unrigged mesh is kept as `mesh.glb`.
 *   animate  `fal-ai/meshy/rigging/multi-animation` ($0.08). Rigs a GLB
 *            again and renders one clip per Meshy library action, at most
 *            ten distinct actions per call, in request order.
 *   actions  offline. The curated action catalog this script resolves
 *            names against; a raw library id (0–696) is accepted too.
 *
 * What lands in `--out <dir>`:
 *
 *   model:    model.glb (rigged), mesh.glb (unrigged), thumbnail.png,
 *             anim-walk.glb, anim-run.glb
 *   animate:  anim-<id>.glb per clip (`id` is the catalog name, or
 *             `action-<n>` for a raw id outside it), model-rigged.glb when
 *             the call returned its own rigged character
 *
 * A finished job is paid for whatever happens to its downloads. Every file
 * is fetched independently; one that cannot be fetched is listed in the
 * report's `missing` with its remote URL, so it can be recovered by hand.
 * The run fails (exit 1, report still printed) only when the file the step
 * exists for is missing: `model.glb` for `model`, any requested clip for
 * `animate`. Nothing partial is ever reported as a clean success.
 *
 * Every refusal — an unknown action name, more than ten actions, a bad
 * height or polycount, a non-GLB model — happens before the key is read,
 * so a mistyped command never reaches a paid endpoint.
 *
 * Submission goes through fal's queue (`fal-queue.mjs`); SIGINT/SIGTERM
 * cancels the job remotely before this process exits 130 — an abandoned
 * model is still a paid one. `--json` prints exactly one object on stdout;
 * progress, warnings and the `cost:` line go to stderr. `cost` is fal's
 * list price per generation — an estimate, never an invoice.
 *
 * Environment: FAL_KEY, from the environment or a `.env` discovered by
 * `fal-queue.mjs::loadFalKey`. Never printed, never an argv.
 *
 * Node 22+, no dependencies.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Installed sessions keep shared scripts beside this CLI (the manifest lists
// `fal-queue.mjs` in `skill.sharedScripts`); a source checkout resolves the
// same module from `modes/_shared/scripts/`. Exported so a test can pin
// which copy it is exercising.
const installedShared = new URL("./fal-queue.mjs", import.meta.url);
export const FAL_QUEUE_URL = existsSync(installedShared)
  ? installedShared.href
  : new URL("../../../_shared/scripts/fal-queue.mjs", import.meta.url).href;

const {
  DOWNLOAD_ATTEMPTS,
  downloadFalFile,
  falMediaUrl,
  loadFalKey,
  runFalJob,
  uploadFalFile,
} = await import(FAL_QUEUE_URL);

export const MODEL_ENDPOINT = "meshy/v7.1/image-to-3d";
export const ANIMATE_ENDPOINT = "fal-ai/meshy/rigging/multi-animation";

/**
 * fal's list price per generation (fal pricing API, read 2026-10-30).
 * Check it again before quoting a user a total.
 */
export const PRICES = Object.freeze({
  model: 0.8,
  animate: 0.08,
  checked: "2026-10-30",
});

export const MODEL_TYPES = ["standard", "lowpoly"];
/** CLI spelling → fal's `pose_mode`; "none" is fal's empty string. */
export const POSES = Object.freeze({ "a-pose": "a-pose", "t-pose": "t-pose", none: "" });
export const DEFAULT_HEIGHT_M = 1.7;
export const DEFAULT_POLYCOUNT = 30_000;
export const POLYCOUNT_MIN = 100;
export const POLYCOUNT_MAX = 300_000;
/** fal's limits on `animation_action_ids`: 1..10 distinct ids in [0, 696]. */
export const MAX_ACTIONS = 10;
export const ACTION_ID_MAX = 696;
export const DEFAULT_DEADLINE_S = 1200;

/**
 * The curated slice of Meshy's animation library a game sprite usually
 * wants. `action` is the library id, `meshy` its name there
 * (docs.meshy.ai/en/api/animation-library, read 2026-10-30).
 */
export const ACTIONS = Object.freeze(
  [
    ["idle", "Idle", 0, "Idle"],
    ["idle-2", "Idle 2", 11, "Idle_02"],
    ["combat-stance", "Combat stance", 89, "Combat_Stance"],
    ["walk", "Walk", 30, "Casual_Walk"],
    ["walk-woman", "Walk (woman)", 1, "Walking_Woman"],
    ["run", "Run", 14, "Run_02"],
    ["run-fast", "Run fast", 16, "RunFast"],
    ["jump", "Jump", 466, "Regular_Jump"],
    ["attack", "Attack", 4, "Attack"],
    ["slash-left", "Slash left", 97, "Left_Slash"],
    ["sword-slash", "Sword slash", 219, "Right_Hand_Sword_Slash"],
    ["thrust", "Thrust", 240, "Thrust_Slash"],
    ["combo", "Combo attack", 92, "Double_Combo_Attack"],
    ["hammer", "Hammer swing", 128, "Heavy_Hammer_Swing"],
    ["archery", "Archery shot", 224, "Archery_Shot"],
    ["punch", "Punch combo", 198, "Punch_Combo"],
    ["kick", "Kick", 103, "Simple_Kick"],
    ["roundhouse", "Roundhouse kick", 207, "Roundhouse_Kick"],
    ["block", "Block", 147, "Sword_Parry"],
    ["roll", "Roll", 158, "Roll_Dodge"],
    ["dodge", "Dodge", 156, "Stand_Dodge"],
    ["hit", "Hit", 178, "Hit_Reaction"],
    ["death", "Death", 8, "Dead"],
    ["knockdown", "Knockdown", 187, "Knock_Down"],
    ["victory", "Victory", 59, "Victory_Cheer"],
    ["cheer", "Cheer", 298, "Cheer_with_Both_Hands_Up"],
    ["dance", "Dance", 22, "FunnyDancing_01"],
    ["cast", "Spell cast (charged)", 125, "Charged_Spell_Cast"],
    ["spell", "Spell cast", 129, "mage_soell_cast"],
  ].map(([id, label, action, meshy]) => Object.freeze({ id, label, action, meshy })),
);

const byName = new Map(ACTIONS.map((entry) => [entry.id, entry]));
const byAction = new Map(ACTIONS.map((entry) => [entry.action, entry]));

/** One action as the rest of the script carries it. */
function actionFor(actionId) {
  const known = byAction.get(actionId);
  return known
    ? { id: known.id, label: known.label, action: actionId }
    : { id: `action-${actionId}`, label: `Action ${actionId}`, action: actionId };
}

/**
 * Names and/or raw library ids → `[{ id, label, action }]`, in the order
 * given. Accepts an array or a comma-separated string; names are matched
 * case-insensitively, `action-<n>` (this script's own spelling of a raw id)
 * is read back as `<n>`, and a raw id that is in the catalog takes the
 * catalog's name. A repeated action is kept once — fal would de-duplicate
 * it anyway, and the clip would only be written twice.
 *
 * Throws — naming every offender at once — for an unknown name, an id
 * outside [0, 696], an empty list, or more than ten distinct actions.
 */
export function resolveActions(list) {
  const tokens = (Array.isArray(list) ? list : [list])
    .flatMap((item) => (typeof item === "number" ? [String(item)] : String(item ?? "").split(",")))
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error("--actions needs at least one action (see: rig-3d.mjs actions)");

  const unknown = [];
  const outOfRange = [];
  const resolved = [];
  const seen = new Set();
  for (const token of tokens) {
    const lowered = token.toLowerCase();
    const numeric = /^\d+$/.test(lowered) ? lowered : /^action-(\d+)$/.exec(lowered)?.[1];
    let actionId;
    if (numeric !== undefined) {
      actionId = Number(numeric);
      if (actionId > ACTION_ID_MAX) {
        outOfRange.push(token);
        continue;
      }
    } else if (byName.has(lowered)) {
      actionId = byName.get(lowered).action;
    } else {
      unknown.push(token);
      continue;
    }
    if (seen.has(actionId)) continue;
    seen.add(actionId);
    resolved.push(actionFor(actionId));
  }

  const problems = [];
  if (unknown.length) problems.push(`unknown action${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")} (see: rig-3d.mjs actions)`);
  if (outOfRange.length) problems.push(`library ids must be 0–${ACTION_ID_MAX} (got: ${outOfRange.join(", ")})`);
  if (problems.length) throw new Error(problems.join("; "));
  if (resolved.length > MAX_ACTIONS) {
    throw new Error(`at most ${MAX_ACTIONS} distinct actions per call (got ${resolved.length}: ${resolved.map((a) => a.id).join(", ")}) — split them over two runs`);
  }
  return resolved;
}

function parseHeight(height) {
  const value = Number(height ?? DEFAULT_HEIGHT_M);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--height must be a positive number of meters (got: ${height})`);
  return value;
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

/**
 * The exact `meshy/v7.1/image-to-3d` request, or a thrown refusal naming
 * the flag at fault. Rigging is always on: a rigged character is what this
 * step is for. Texturing is sent explicitly so the result does not move
 * with fal's defaults. A local image is inlined as a data URI.
 */
export function buildModelBody({
  image,
  height = DEFAULT_HEIGHT_M,
  polycount = DEFAULT_POLYCOUNT,
  modelType = "standard",
  pose = "a-pose",
} = {}) {
  if (typeof image !== "string" || !image.trim()) throw new Error("--image is required (a cut-out character PNG works best)");
  if (!/^(https?:|data:)/.test(image) && !IMAGE_EXTENSIONS.includes(extname(image).toLowerCase())) {
    throw new Error(`--image must be ${IMAGE_EXTENSIONS.join(", ")} (got: ${image})`);
  }
  const rigHeight = parseHeight(height);
  const targetPolycount = Number(polycount);
  if (!Number.isInteger(targetPolycount) || targetPolycount < POLYCOUNT_MIN || targetPolycount > POLYCOUNT_MAX) {
    throw new Error(`--polycount must be a whole number from ${POLYCOUNT_MIN} to ${POLYCOUNT_MAX} (got: ${polycount})`);
  }
  if (!MODEL_TYPES.includes(modelType)) throw new Error(`--model-type must be one of: ${MODEL_TYPES.join(", ")} (got: ${modelType})`);
  if (!Object.hasOwn(POSES, pose)) throw new Error(`--pose must be one of: ${Object.keys(POSES).join(", ")} (got: ${pose})`);

  return {
    image_url: falMediaUrl(image, { label: "--image" }),
    enable_rigging: true,
    rigging_height_meters: rigHeight,
    pose_mode: POSES[pose],
    should_texture: true,
    enable_pbr: false,
    target_polycount: targetPolycount,
    model_type: modelType,
  };
}

/**
 * The exact `fal-ai/meshy/rigging/multi-animation` request. `actions` is
 * anything `resolveActions` takes, or its result.
 */
export function buildAnimateBody({ modelUrl, actions, height = DEFAULT_HEIGHT_M } = {}) {
  if (typeof modelUrl !== "string" || !/^https?:\/\//.test(modelUrl)) {
    throw new Error(`the model must be an http(s) URL by now (got: ${modelUrl})`);
  }
  const resolved = Array.isArray(actions) && actions.every((a) => a && typeof a === "object" && Number.isInteger(a.action))
    ? resolveActions(actions.map((a) => a.action))
    : resolveActions(actions);
  return {
    model_url: modelUrl,
    animation_action_ids: resolved.map((a) => a.action),
    height_meters: parseHeight(height),
  };
}

const urlOf = (file) => (file && typeof file.url === "string" && file.url ? file.url : null);

/**
 * A result object → the files to save, `[{ role, name, url, required,
 * animation? }]`. `url` is null when the response did not carry the file;
 * the caller reports it missing rather than skipping it quietly.
 *
 * A `model` result (it has `model_glb`) maps to the rigged model, the
 * unrigged mesh, the thumbnail and the two basic clips. An `animate`
 * result maps every requested action to its clip by `action_id` — a clip
 * the response left out is still listed, with no URL — plus the call's own
 * rigged character when it returned one. Without `actions`, the clips in
 * the response are taken as they come.
 */
export function outputFiles(data, { actions } = {}) {
  if (!data || typeof data !== "object") throw new Error(`the response was not an object: ${JSON.stringify(data ?? null).slice(0, 300)}`);
  const basic = data.basic_animations ?? {};

  if ("model_glb" in data) {
    return [
      { role: "model", name: "model.glb", url: urlOf(data.rigged_character_glb), required: true },
      { role: "mesh", name: "mesh.glb", url: urlOf(data.model_glb) ?? urlOf(data.model_urls?.glb), required: false },
      { role: "thumbnail", name: "thumbnail.png", url: urlOf(data.thumbnail), required: false },
      { role: "animation", name: "anim-walk.glb", url: urlOf(basic.walking_glb), required: false, animation: { id: "walk", label: "Walk" } },
      { role: "animation", name: "anim-run.glb", url: urlOf(basic.running_glb), required: false, animation: { id: "run", label: "Run" } },
    ];
  }

  if (!Array.isArray(data.animations)) {
    throw new Error(`the response carried neither model_glb nor animations: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const clips = new Map();
  for (const clip of data.animations) {
    if (clip && Number.isInteger(clip.action_id) && !clips.has(clip.action_id)) clips.set(clip.action_id, clip);
  }
  const wanted = actions ? resolveActions(actions.map((a) => (typeof a === "object" ? a.action : a))) : [...clips.keys()].map(actionFor);
  const files = [];
  const rigged = urlOf(data.rigged_character_glb);
  if (rigged) files.push({ role: "model", name: "model-rigged.glb", url: rigged, required: false });
  for (const animation of wanted) {
    files.push({
      role: "animation",
      name: `anim-${animation.id}.glb`,
      url: urlOf(clips.get(animation.action)?.animation_glb),
      required: true,
      animation,
    });
  }
  return files;
}

/** What one step costs at fal's list price. Always an estimate. */
export function stepCost(step) {
  return { usd: PRICES[step], estimate: true, basis: "fal list price per generation", checked: PRICES.checked };
}

/** The one stderr line a `cost` object is said in. */
export function costLine(cost, endpoint) {
  return `cost: ≈ $${cost.usd.toFixed(2)} (fal list price per generation for ${endpoint}, checked ${cost.checked}; an estimate, not an invoice)`;
}

/** Upload a local GLB to fal storage and return its URL. */
export async function uploadGlb(path, { key, fetchImpl = fetch, signal, onNote = (m) => console.error(m) } = {}) {
  if (!key) throw new Error("uploading a model needs a fal API key");
  return uploadFalFile(path, { key, label: "--model", fetchImpl, onNote, signal });
}

/** `--model` must be a URL or an existing local `.glb`; checked before paying. */
export function checkModelInput(model) {
  if (typeof model !== "string" || !model.trim()) throw new Error("--model is required (a .glb path or URL — model.glb from the model step)");
  if (/^https?:\/\//.test(model)) return "url";
  if (extname(model).toLowerCase() !== ".glb") throw new Error(`--model must be a .glb file or an http(s) URL (got: ${model})`);
  if (!existsSync(model)) throw new Error(`--model: file not found: ${model}`);
  return "file";
}

/**
 * Fetch every file independently into `out`, atomically (`.tmp`, then
 * rename). Returns the saved ones and the missing ones; an interrupt is
 * rethrown, never recorded as a missing file.
 */
async function saveFiles(files, out, { download, signal }) {
  mkdirSync(out, { recursive: true });
  const saved = [];
  const missing = [];
  for (const file of files) {
    const path = join(out, file.name);
    if (!file.url) {
      missing.push({ role: file.role, file: path, url: null, reason: "not in the response", ...(file.animation ? { id: file.animation.id } : {}) });
      continue;
    }
    try {
      const bytes = await download(file.url, { signal, attempts: DOWNLOAD_ATTEMPTS });
      writeFileSync(`${path}.tmp`, bytes);
      renameSync(`${path}.tmp`, path);
      saved.push({ ...file, path });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      const reason = `download failed after ${DOWNLOAD_ATTEMPTS} attempts: ${error instanceof Error ? error.message : String(error)}`;
      missing.push({ role: file.role, file: path, url: file.url, reason, ...(file.animation ? { id: file.animation.id } : {}) });
    }
  }
  return { saved, missing };
}

function jobOptions({ url, body, apiKey, signal, deadlineMs, label }) {
  return {
    url,
    body,
    key: apiKey,
    signal,
    label,
    deadlineMs,
    onStatus: ({ status, queue_position }) => {
      console.error(`status: ${status}${queue_position != null ? ` (queue position ${queue_position})` : ""}`);
    },
    onRetry: ({ attempt, attempts, delayMs, reason }) => {
      console.error(`WARN: ${String(reason).slice(0, 160)} — retrying in ${delayMs / 1000}s (attempt ${attempt} of ${attempts})`);
    },
  };
}

/** Paths of the missing files that make a run a failure. */
const requiredMissing = (files, missing) => {
  const required = new Set(files.filter((f) => f.required).map((f) => f.name));
  return missing.filter((m) => required.has(basename(m.file)));
};

/**
 * The `model` step: one image-to-3d job, its files saved into `out`.
 * Returns `{ report, failed }` — `failed` when `model.glb` did not land.
 * The job runner and the downloader are injected so the whole path runs in
 * a test without fal.
 */
export async function rigModel(options, { runJob = runFalJob, download = downloadFalFile } = {}) {
  const { image, out, apiKey, signal, deadlineMs = DEFAULT_DEADLINE_S * 1000 } = options;
  if (typeof out !== "string" || !out.trim()) throw new Error("--out is required");
  const body = buildModelBody(options);
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  console.error(`NOTE: ${MODEL_ENDPOINT} with rigging usually takes 3–4 minutes`);
  const job = await runJob(jobOptions({ url: `https://fal.run/${MODEL_ENDPOINT}`, body, apiKey, signal, deadlineMs, label: "Meshy image-to-3D" }));
  const data = job?.data;
  const files = outputFiles(data);
  const { saved, missing } = await saveFiles(files, out, { download, signal });
  const pathOf = (role) => saved.find((f) => f.role === role)?.path ?? null;

  const report = {
    step: "model",
    provider: "meshy-7.1",
    endpoint: MODEL_ENDPOINT,
    image,
    files: {
      model: pathOf("model"),
      mesh: pathOf("mesh"),
      thumbnail: pathOf("thumbnail"),
      animations: saved.filter((f) => f.role === "animation").map((f) => ({ ...f.animation, file: f.path })),
    },
    remote: {
      model_url: urlOf(data?.rigged_character_glb),
      rig_task_id: data?.rig_task_id ?? null,
    },
    missing,
    cost: stepCost("model"),
  };
  if (typeof job?.requestId === "string" && job.requestId) report.request_id = job.requestId;
  return { report, failed: requiredMissing(files, missing).length > 0 };
}

/**
 * The `animate` step: one multi-animation job over `model` (a URL, or a
 * local GLB uploaded first). Returns `{ report, failed }` — `failed` when
 * any requested clip did not land.
 */
export async function animateModel(options, { runJob = runFalJob, download = downloadFalFile, upload = uploadGlb } = {}) {
  const { model, out, apiKey, signal, height, deadlineMs = DEFAULT_DEADLINE_S * 1000 } = options;
  if (typeof out !== "string" || !out.trim()) throw new Error("--out is required");
  const actions = resolveActions(options.actions);
  const kind = checkModelInput(model);
  parseHeight(height);
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const modelUrl = kind === "url" ? model : await upload(model, { key: apiKey, signal });
  const body = buildAnimateBody({ modelUrl, actions, height });
  console.error(`NOTE: ${ANIMATE_ENDPOINT}: ${actions.map((a) => `${a.id} (${a.action})`).join(", ")}`);
  const job = await runJob(jobOptions({ url: `https://fal.run/${ANIMATE_ENDPOINT}`, body, apiKey, signal, deadlineMs, label: "Meshy multi-animation" }));
  const data = job?.data;
  const files = outputFiles(data, { actions });
  const { saved, missing } = await saveFiles(files, out, { download, signal });

  const report = {
    step: "animate",
    provider: "meshy",
    endpoint: ANIMATE_ENDPOINT,
    model,
    files: {
      model: saved.find((f) => f.role === "model")?.path ?? null,
      animations: saved.filter((f) => f.role === "animation").map((f) => ({ ...f.animation, file: f.path })),
    },
    remote: { model_url: modelUrl, rig_task_id: data?.rig_task_id ?? null },
    missing,
    cost: stepCost("animate"),
  };
  if (typeof job?.requestId === "string" && job.requestId) report.request_id = job.requestId;
  return { report, failed: requiredMissing(files, missing).length > 0 };
}

const HELP = `Usage:
  rig-3d.mjs model   --image <png|url> --out <dir> [options]     $${PRICES.model.toFixed(2)} per run
  rig-3d.mjs animate --model <model.glb|url> --actions <list> --out <dir> [options]
                                                                 $${PRICES.animate.toFixed(2)} per run
  rig-3d.mjs actions [--json]                                    offline, free

model — ${MODEL_ENDPOINT} with rigging (takes 3–4 minutes):
  --image <path|url>      The character, ideally a cut-out PNG (required)
  --out <dir>             Writes model.glb (rigged), mesh.glb (unrigged),
                          thumbnail.png, anim-walk.glb, anim-run.glb (required)
  --height <m>            Character height in meters (default: ${DEFAULT_HEIGHT_M})
  --polycount <n>         Target polycount, ${POLYCOUNT_MIN}–${POLYCOUNT_MAX} (default: ${DEFAULT_POLYCOUNT})
  --model-type <type>     ${MODEL_TYPES.join(" | ")} (default: standard)
  --pose <pose>           ${Object.keys(POSES).join(" | ")} (default: a-pose)

animate — ${ANIMATE_ENDPOINT}:
  --model <path|url>      A rigged or unrigged humanoid GLB. A local file is
                          uploaded; pass the model step's remote.model_url to skip that
  --actions <list>        Comma-separated catalog names and/or library ids
                          (0–${ACTION_ID_MAX}), at most ${MAX_ACTIONS} distinct, e.g. idle,walk,sword-slash,178
  --out <dir>             Writes anim-<id>.glb per clip (+ model-rigged.glb)
  --height <m>            Character height in meters (default: ${DEFAULT_HEIGHT_M})

Common:
  --json                  Print one JSON object on stdout
  --deadline-s <n>        Give up on (and cancel) the job after n seconds (default: ${DEFAULT_DEADLINE_S})
  --help, -h              This text

A file that could not be fetched is listed in the report's "missing" with
its remote URL. Exit 1 (report still printed) when the step's own output is
missing: model.glb for model, any requested clip for animate.

Requires FAL_KEY (environment or .env). Progress goes to stderr; so does one
cost: line with fal's list price. Ctrl-C cancels the remote job.`;

function printActions(json) {
  if (json) {
    console.log(JSON.stringify({ actions: ACTIONS, max_per_call: MAX_ACTIONS, library_id_max: ACTION_ID_MAX }));
    return;
  }
  const width = Math.max(...ACTIONS.map((a) => a.id.length));
  for (const a of ACTIONS) console.log(`${a.id.padEnd(width)}  ${String(a.action).padStart(3)}  ${a.label} (${a.meshy})`);
  console.error(`Any Meshy library id 0–${ACTION_ID_MAX} works too: docs.meshy.ai/en/api/animation-library`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.error(HELP);
    return command ? 0 : 1;
  }
  if (!["model", "animate", "actions"].includes(command)) throw new Error(`unknown command: ${command} (model | animate | actions)`);

  const { values } = parseArgs({
    args: rest,
    options: {
      image: { type: "string" },
      model: { type: "string" },
      actions: { type: "string", multiple: true },
      out: { type: "string" },
      height: { type: "string" },
      polycount: { type: "string" },
      "model-type": { type: "string" },
      pose: { type: "string" },
      json: { type: "boolean", default: false },
      "deadline-s": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.error(HELP);
    return 0;
  }
  if (command === "actions") {
    printActions(values.json);
    return 0;
  }

  // Each flag belongs to one command; a stray one is a typo, not a no-op.
  const foreign = command === "model" ? ["model", "actions"] : ["image", "polycount", "model-type", "pose"];
  const stray = foreign.filter((name) => values[name] !== undefined);
  if (stray.length) throw new Error(`${command} does not take ${stray.map((n) => `--${n}`).join(", ")}`);
  if (!values.out) throw new Error("--out is required");

  const deadlineS = values["deadline-s"] === undefined ? DEFAULT_DEADLINE_S : Number(values["deadline-s"]);
  if (!Number.isFinite(deadlineS) || deadlineS < 30) throw new Error(`--deadline-s must be a number of seconds, at least 30 (got: ${values["deadline-s"]})`);

  const common = { out: values.out, height: values.height ?? DEFAULT_HEIGHT_M, deadlineMs: deadlineS * 1000 };
  // Everything that can be refused is refused here, before the key is read.
  if (command === "model") {
    buildModelBody({
      image: values.image,
      height: common.height,
      polycount: values.polycount ?? DEFAULT_POLYCOUNT,
      modelType: values["model-type"] ?? "standard",
      pose: values.pose ?? "a-pose",
    });
  } else {
    const tokens = (values.actions ?? []).flatMap((v) => v.split(",")).map((t) => t.trim()).filter(Boolean);
    const resolved = resolveActions(tokens);
    if (resolved.length < tokens.length) console.error(`NOTE: ${tokens.length - resolved.length} repeated action(s) dropped`);
    checkModelInput(values.model);
    parseHeight(common.height);
  }

  const apiKey = loadFalKey();
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  // An interrupt has to reach fal, not just this process: a job abandoned
  // mid-run keeps running on someone else's meter.
  const controller = new AbortController();
  const handlers = new Map();
  let interruptedBy = null;
  for (const name of ["SIGTERM", "SIGINT"]) {
    const handler = () => {
      if (interruptedBy) process.exit(130); // a second one leaves at once
      interruptedBy = name;
      controller.abort(new DOMException(`received ${name}`, "AbortError"));
    };
    handlers.set(name, handler);
    process.on(name, handler);
  }

  try {
    const { report, failed } = command === "model"
      ? await rigModel({
        ...common,
        apiKey,
        signal: controller.signal,
        image: values.image,
        polycount: values.polycount ?? DEFAULT_POLYCOUNT,
        modelType: values["model-type"] ?? "standard",
        pose: values.pose ?? "a-pose",
      })
      : await animateModel({ ...common, apiKey, signal: controller.signal, model: values.model, actions: values.actions });

    console.error(costLine(report.cost, report.endpoint));
    for (const m of report.missing) console.error(`WARN: missing ${m.file} — ${m.reason}${m.url ? ` (${m.url})` : ""}`);
    if (values.json) {
      console.log(JSON.stringify(report));
    } else {
      const paths = [report.files.model, report.files.mesh, report.files.thumbnail, ...report.files.animations.map((a) => a.file)];
      for (const path of paths) if (path) console.log(path);
    }
    if (failed) {
      console.error(`ERROR: the job finished (and is paid for) but ${command === "model" ? "model.glb" : "a requested clip"} did not land — see "missing"${report.request_id ? ` (fal request ${report.request_id})` : ""}`);
      return 1;
    }
    return 0;
  } catch (error) {
    if (interruptedBy || error?.name === "AbortError") {
      console.error(`ERROR: ${interruptedBy ?? "interrupted"} — the fal.ai job was cancelled`);
      return 130;
    }
    if (error?.requestId) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} (fal request ${error.requestId} — it may already be billed)`);
    }
    throw error;
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler);
  }
}

function isMain() {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  const entry = process.argv[1] ? resolve(process.argv[1]) : null;
  return entry !== null && fileURLToPath(import.meta.url) === entry;
}

if (isMain()) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
