#!/usr/bin/env node
/**
 * image-to-3d.mjs — turn cut-out images into GLB models through fal's
 * queue, one resumable job file at a time.
 *
 * The job-file design ported here — `check` / `submit` / `collect` over a
 * single JSON plan that survives every interruption — comes from
 * `achimala/dream-loop` (MIT), `scripts/fal-batch.mjs`. See NOTICE.md.
 * Its transport is re-expressed through this repository's one fal client,
 * `_shared/scripts/fal-queue.mjs`: `loadFalKey` for the credential,
 * `falMediaUrl` for the payload, `toQueueUrl` for the endpoint,
 * `neverReached` for the one failure that is safe to retry, and
 * `downloadFalFile` for the artifact.
 *
 * Why a job file at all. A submission is paid and fal has no idempotency
 * key, so "did this job already leave?" cannot be answered by trying
 * again — it has to be answered by something on disk. This script writes
 * `state: "submitting"` and saves BEFORE the POST, keeps whatever the
 * queue hands back verbatim, and refuses to resubmit anything that has a
 * `request_id`, is `submitting`, or is `submission-uncertain`. A job that
 * left and lost its answer is reported, never repeated.
 *
 * The commands:
 *
 *   check    offline, no key. Validates the plan and reports a per-job
 *            state. Never touches the file.
 *   submit   posts every ready job; skips images that have not landed yet,
 *            so it can be re-run as cut-outs appear.
 *   collect  one status / result / download pass. Re-run it; errors are
 *            staged (`result-error`, `download-error`) so a failed
 *            download never means "generate the model again".
 *   recipe   offline. Prints one of the three presets as a pasteable job.
 *
 * A job carries one cut-out in `image`, or — on the multiview endpoint —
 * two to four views in `images`, ordered front, left, back, right. What
 * lands is a GLB, unless the job asked H3.1 for `quad` topology: that comes
 * back as FBX, is written with a `.fbx` extension, and is reported as
 * `format: "fbx"` so nothing downstream mistakes it for a GLB.
 *
 * One deliberate difference from upstream: which submit failures are
 * retryable is decided by fal-queue's `neverReached`, not by a local code
 * list. That list is narrower — a connect timeout
 * (`UND_ERR_CONNECT_TIMEOUT`) now records `submission-uncertain` rather
 * than `not-submitted`. The cost is a manual reconcile on a failure that
 * probably created no job; the alternative cost is a second paid job.
 * One authority for "did the request reach fal" is worth the trade.
 *
 * Node 22+, no dependencies.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { joinNegativeNumbers } from "./argv.mjs";

// Installed sessions keep shared scripts beside this CLI (the manifest lists
// `fal-queue.mjs` in `skill.sharedScripts`); a source checkout resolves the
// same module from `modes/_shared/scripts/`. Exported so a test can pin
// which copy it is exercising.
const installedShared = new URL("./fal-queue.mjs", import.meta.url);
export const FAL_QUEUE_URL = existsSync(installedShared)
  ? installedShared.href
  : new URL("../../../_shared/scripts/fal-queue.mjs", import.meta.url).href;

const { downloadFalFile, falMediaUrl, loadFalKey, neverReached, toQueueUrl } = await import(FAL_QUEUE_URL);

/** The only host this script will ever call for queue operations. */
const QUEUE_HOST = "queue.fal.run";

/** The three image-to-3D endpoints this mode uses. */
const H3_ENDPOINT = "tripo3d/h3.1/image-to-3d";
const H3_MULTIVIEW_ENDPOINT = "tripo3d/h3.1/multiview-to-3d";
const TRELLIS_ENDPOINT = "fal-ai/trellis";
const H3_ENDPOINTS = [H3_ENDPOINT, H3_MULTIVIEW_ENDPOINT];

/** The fixed order of a multiview turnaround; the front is required. */
const MULTIVIEW_ORDER = ["front", "left", "back", "right"];

/**
 * Every option each model accepts, with the rule that decides whether a
 * value is one. Written down once because it answers three questions that
 * used to be answered in three places: what may be sent, what a wrong value
 * looks like, and what the help text should offer. Anything not listed here
 * is refused before a paid call — fal would accept the request and quietly
 * ignore the misspelled key.
 *
 * Checked against the fal model pages on 2026-09-16.
 */
const BOOLEAN = { kind: "boolean", describe: "true or false" };
const INTEGER = { kind: "integer", describe: "an integer" };
const enumOf = (...values) => {
  const literals = values.map((value) => JSON.stringify(value));
  const describe = literals.length > 2 ? `${literals.slice(0, -1).join(", ")}, or ${literals.at(-1)}` : literals.join(" or ");
  return { kind: "enum", values, describe };
};

const H3_OPTIONS = {
  texture: BOOLEAN,
  pbr: BOOLEAN,
  face_limit: { kind: "positive-integer", describe: "a positive integer" },
  model_seed: INTEGER,
  texture_seed: INTEGER,
  texture_quality: enumOf("standard", "detailed"),
  geometry_quality: enumOf("standard", "detailed"),
  texture_alignment: enumOf("original_image", "geometry"),
  orientation: enumOf("default", "align_image"),
  auto_size: BOOLEAN,
  quad: BOOLEAN,
};

const TRELLIS_OPTIONS = {
  mesh_simplify: { kind: "unit-fraction", describe: "a number above 0 and at most 1" },
  texture_size: enumOf(512, 1024, 2048),
};

const H3_ONLY_FIELDS = Object.keys(H3_OPTIONS);
const TRELLIS_ONLY_FIELDS = Object.keys(TRELLIS_OPTIONS);

/**
 * The three presets the skill quotes. They are the script's own authority
 * for "what should I send": `--help` prints them, `recipe <name>` prints a
 * pasteable job, and the tests submit them through the same validation a
 * hand-written job meets.
 */
export const RECIPES = {
  hero: {
    summary: "Architecture, characters, hero props — one cut-out",
    endpoint: H3_ENDPOINT,
    input: {
      texture: true,
      pbr: true,
      auto_size: true,
      orientation: "align_image",
      geometry_quality: "detailed",
      texture_quality: "detailed",
    },
  },
  "hero-multiview": {
    summary: "The same asset from 2-4 views — front first, then left, back, right",
    endpoint: H3_MULTIVIEW_ENDPOINT,
    multiview: true,
    input: {
      texture: true,
      pbr: true,
      auto_size: true,
      orientation: "align_image",
      geometry_quality: "detailed",
      texture_quality: "detailed",
    },
  },
  prop: {
    summary: "Small props and set dressing — cheap and fast",
    endpoint: TRELLIS_ENDPOINT,
    input: { mesh_simplify: 0.95, texture_size: 1024 },
  },
};

/**
 * One preset as a job the caller can paste into the job file. Placeholders
 * are angle-bracketed so an unedited skeleton fails `check` loudly instead
 * of submitting a job named after the recipe.
 *
 * @param {string} name
 * @returns {object} A job object, ready for the `jobs` array.
 */
export function recipeJob(name) {
  const recipe = Object.hasOwn(RECIPES, name) ? RECIPES[name] : undefined;
  if (!recipe) {
    const lead = name ? `Unknown recipe: ${name}.` : "A recipe name is required.";
    throw new Error(`${lead} Use ${Object.keys(RECIPES).join(", ")}.`);
  }
  return {
    id: "<asset-id>",
    endpoint: recipe.endpoint,
    ...(recipe.multiview
      ? { images: MULTIVIEW_ORDER.map((view) => `<asset-id>-${view}.png`) }
      : { image: "<asset-id>.png" }),
    output: "../scene/models/<asset-id>.glb",
    input: { ...recipe.input },
  };
}

/** Answers that mean fal refused the request itself — fix it and resubmit. */
const REJECTED_STATUSES = new Set([400, 401, 403, 404, 405, 422]);

/** Ceiling on one queue call. The download has its own idle clock. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Messages that carry no payload and are safe to keep verbatim. */
const SAFE_MESSAGE = /^fal\.ai HTTP \d+$|^model download HTTP \d+$/;

const COMMANDS = ["check", "submit", "collect"];

/** JSON whose continuation lines line up under the first one. */
function indentJson(value, pad) {
  return JSON.stringify(value, null, 2).split("\n").join(`\n${" ".repeat(pad)}`);
}

const RECIPE_HELP = Object.entries(RECIPES)
  .map(([name, recipe]) => {
    const lines = [`  ${name.padEnd(14)}  ${recipe.summary}`, `    endpoint    ${recipe.endpoint}`];
    if (recipe.multiview) {
      lines.push(`    images      [${MULTIVIEW_ORDER.map((view) => `"${view}.png"`).join(", ")}]  <- front first, 2 to 4`);
    }
    lines.push(`    input       ${indentJson(recipe.input, 16)}`);
    return lines.join("\n");
  })
  .join("\n\n");

const JOB_FILE_EXAMPLE = {
  jobs: [
    { ...recipeJob("hero"), id: "arch", image: "arch.png", output: "../scene/models/arch.glb" },
    {
      ...recipeJob("hero-multiview"),
      id: "idol",
      images: ["idol-front.png", "idol-left.png", "idol-back.png", "idol-right.png"],
      output: "../scene/models/idol.glb",
    },
    { ...recipeJob("prop"), id: "rubble", image: "rubble.png", output: "../scene/models/rubble.glb" },
  ],
};

const HELP = `Usage: node image-to-3d.mjs check|submit|collect <jobs.json> [--concurrency 4]
       node image-to-3d.mjs recipe ${Object.keys(RECIPES).join("|")}

  check    Offline. No API key, no network, no writes. Validates the plan
           and reports each job's state.
  submit   Posts every ready job to the fal queue and records its
           request_id. Images that have not landed yet are skipped, so run
           it again as cut-outs appear.
  collect  One status / result / download pass over the submitted jobs.
           Re-run it after doing other work.
  recipe   Prints one preset as a JSON job to paste into the job file.

Paths inside the job file are relative to the job file itself. The file is
always left resumable: a job that has reached fal is never sent twice, and
a failed download never regenerates an accepted model.

Recipes (checked against the model schemas on 2026-09-16):

${RECIPE_HELP}

H3.1 options — both H3.1 endpoints take the same ones:

  texture, pbr        booleans. Leave both on unless you want bare geometry.
  orientation         "align_image" points the model the way the cut-out
                      faces, so there is less yaw to fix in the scene;
                      "default" is the model's own guess.
  auto_size           true asks for real-world metres — a hint, not a
                      guarantee (props have come back unit-normalised).
                      collect echoes auto_size back; blender.mjs prep by
                      one dimension is what sets the size that counts.
  geometry_quality    "standard" | "detailed"
  texture_quality     "standard" | "detailed"
  texture_alignment   "original_image" keeps the texture on the cut-out's
                      framing; "geometry" wraps it to the mesh.
  face_limit          a positive integer. H3.1's own count can be very
                      dense; pick for screen size and instance count.
  model_seed          integers. The same seed reproduces the same model
  texture_seed        and the same texture.
  quad                true asks for quad topology, and the result is an FBX,
                      not a GLB. collect writes <output>.fbx and reports
                      format "fbx"; turn it into a GLB with
                      \`blender.mjs convert <file>.fbx <file>.glb\`.

Multiview (${H3_MULTIVIEW_ENDPOINT}) takes 2 to 4 cut-outs of
the same object in "images", in the order front, left, back, right. The
front is required. One image belongs on ${H3_ENDPOINT}.

Trellis (${TRELLIS_ENDPOINT} — no /image-to-3d suffix) takes only
mesh_simplify (above 0, at most 1) and texture_size (512, 1024 or 2048).

The models take different inputs. Do not copy one model's input wholesale
to the other, and do not invent option names: an unknown key is refused
here, because fal would accept the request and ignore it. Never put
image_url or image_urls in input — this script builds them from the local
files.

Job file:
${JSON.stringify(JOB_FILE_EXAMPLE, null, 2)}`;

/** Whether a job carries a multiview turnaround rather than one cut-out. */
function isMultiview(job) {
  return job.images !== undefined;
}

/**
 * The local image paths of a job, in the order the model wants them.
 * Structural only: existence is `check`'s and `submit`'s business, and
 * which endpoint may take how many is `validatePlan`'s.
 */
function jobImages(job) {
  const relative = (value, label) => {
    if (typeof value !== "string" || !value) throw new Error(`${job.id}: ${label} must be a path relative to the job file.`);
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      throw new Error(`${job.id}: ${label} must be a path relative to the job file, not a URL.`);
    }
    return value;
  };

  if (!isMultiview(job)) return [relative(job.image, "image")];
  if (job.image !== undefined) throw new Error(`${job.id}: give either image or images, not both.`);
  if (!Array.isArray(job.images) || job.images.length < 2 || job.images.length > 4) {
    throw new Error(`${job.id}: images takes 2 to 4 files, in the order ${MULTIVIEW_ORDER.join(", ")}.`);
  }
  if (typeof job.images[0] !== "string" || !job.images[0]) {
    throw new Error(`${job.id}: the first entry of images is the front view, and it is required.`);
  }
  return job.images.map((value, index) => relative(value, `images[${index}] (${MULTIVIEW_ORDER[index]})`));
}

/** The label a payload error carries, so it names the view that is wrong. */
function imageLabel(job, index, total) {
  return total > 1 ? `${job.id} ${MULTIVIEW_ORDER[index]}` : job.id;
}

/**
 * One job's `input` against the model's own option table. Three refusals,
 * in the order that produces the most useful message: an option belonging
 * to the other model, an option belonging to no model, then a value the
 * option cannot take.
 */
function validateInput(job, input) {
  const trellis = job.endpoint === TRELLIS_ENDPOINT;
  const options = trellis ? TRELLIS_OPTIONS : H3_OPTIONS;
  const foreign = trellis ? H3_ONLY_FIELDS : TRELLIS_ONLY_FIELDS;
  const [foreignName, ownName] = trellis ? ["an H3.1", "a Trellis"] : ["a Trellis", "an H3.1"];

  for (const field of foreign) {
    if (field in input) throw new Error(`${job.id}: ${field} is ${foreignName} option, not ${ownName} option.`);
  }
  for (const [field, value] of Object.entries(input)) {
    const spec = options[field];
    if (!spec) {
      throw new Error(`${job.id}: ${field} is not an option of ${job.endpoint}. It takes ${Object.keys(options).join(", ")}.`);
    }
    const ok =
      spec.kind === "boolean"
        ? typeof value === "boolean"
        : spec.kind === "integer"
          ? Number.isInteger(value)
          : spec.kind === "positive-integer"
            ? Number.isInteger(value) && value > 0
            : spec.kind === "unit-fraction"
              ? typeof value === "number" && value > 0 && value <= 1
              : spec.values.includes(value);
    if (!ok) throw new Error(`${job.id}: ${field} must be ${spec.describe}.`);
  }
}

/**
 * Structural validation, run before any paid call. `inputChecks` is off for
 * `collect`: a job that fal already accepted must stay collectable through
 * its returned URLs even when its inputs turn out to have been wrong.
 */
function validatePlan(data, { inputChecks = true } = {}) {
  if (!data || typeof data !== "object") throw new Error("The job file must be a JSON object.");
  if (!Array.isArray(data.jobs) || !data.jobs.length) throw new Error("jobs must be a nonempty array.");
  const ids = new Set();
  for (const job of data.jobs) {
    if (!job || typeof job !== "object") throw new Error("Each job must be an object.");
    if (!job.id || typeof job.id !== "string" || ids.has(job.id)) throw new Error("Each job needs a unique id.");
    ids.add(job.id);
    if (typeof job.endpoint !== "string" || !/^[\w.-]+\/[\w./-]+$/.test(job.endpoint) || job.endpoint.includes("..")) {
      throw new Error(`Invalid endpoint: ${job.id}`);
    }
    if (typeof job.output !== "string" || !job.output) throw new Error(`Missing image/output: ${job.id}`);
    // Throws on a malformed image / images field, whichever the job carries.
    jobImages(job);
    if (!inputChecks || job.request_id) continue;

    if (job.endpoint === `${TRELLIS_ENDPOINT}/image-to-3d`) {
      throw new Error(`${job.id}: single-image Trellis uses ${TRELLIS_ENDPOINT} (no /image-to-3d suffix).`);
    }
    if (isMultiview(job) && job.endpoint !== H3_MULTIVIEW_ENDPOINT) {
      throw new Error(`${job.id}: images is only for ${H3_MULTIVIEW_ENDPOINT}; ${job.endpoint} takes a single image.`);
    }
    if (!isMultiview(job) && job.endpoint === H3_MULTIVIEW_ENDPOINT) {
      throw new Error(
        `${job.id}: ${H3_MULTIVIEW_ENDPOINT} needs 2 to 4 views in images (${MULTIVIEW_ORDER.join(", ")}). One image goes to ${H3_ENDPOINT}.`,
      );
    }
    const input = job.input ?? {};
    if (typeof input !== "object" || Array.isArray(input)) throw new Error(`${job.id}: input must be an object.`);
    for (const field of ["image_url", "image_urls"]) {
      if (field in input) throw new Error(`${job.id}: use the local image field; the helper supplies ${field}.`);
    }
    if (job.endpoint === TRELLIS_ENDPOINT || H3_ENDPOINTS.includes(job.endpoint)) validateInput(job, input);
  }
}

/**
 * The image's real type, read from its first bytes. The extension is a
 * claim; this is the evidence, and it is what keeps an empty or truncated
 * file out of a paid request.
 */
function imageMime(bytes, label) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  // Labelled, because in a turnaround only one of four views is the bad one.
  throw new Error(`${label}: the image must be a nonempty PNG, JPEG, or WebP.`);
}

/**
 * One image as the request body wants it. `falMediaUrl` owns the data URI
 * and the size ceiling; the magic-byte check owns the truth about the
 * file's type, and the two have to agree — a `.png` holding a JPEG would
 * otherwise be announced to fal as something it is not.
 */
function imagePayload(file, label, onNote) {
  const actual = imageMime(readFileSync(file), label);
  const uri = falMediaUrl(file, { label, ...(onNote ? { onNote } : {}) });
  const declared = uri.slice("data:".length, uri.indexOf(";"));
  if (declared !== actual) {
    throw new Error(`${label}: the file is ${actual} but its name declares ${declared}; rename it so the two agree.`);
  }
  return uri;
}

/**
 * Text with everything that could carry a payload removed: the credential,
 * data URIs, URLs, and any long opaque blob. Everything recorded in the job
 * file or printed passes through here, because a 422 about an image arrives
 * with the image in it.
 */
function redact(value, key) {
  let text = String(value);
  // An empty key would split on every character; only a real one is masked.
  if (key) text = text.split(key).join("[redacted]");
  return text
    .replace(/data:[^\s"']+/gi, "[image redacted]")
    .replace(/https?:\/\/[^\s"']+/gi, "[URL redacted]")
    .replace(/[A-Za-z0-9+/_=-]{80,}/g, "[payload redacted]")
    .slice(0, 400);
}

/**
 * The human-readable part of a fal error body: the validation messages and
 * the fields they name, and nothing else. An echoed input is never kept.
 */
function errorDetail(body, key) {
  const clean = (value) => redact(value, key);
  const detail = body?.detail;
  if (Array.isArray(detail)) {
    return detail
      .slice(0, 5)
      .map((item) => {
        const loc = Array.isArray(item?.loc) ? item.loc.map(clean).join(".").slice(0, 160) : "";
        return [loc, clean(item?.msg || item?.type || "Validation failed")].filter(Boolean).join(": ");
      })
      .join("; ");
  }
  for (const value of [detail, body?.message, body?.error]) if (typeof value === "string") return clean(value);
  return undefined;
}

/** The recorded `error`: our own wording verbatim, anything else sanitized. */
function safeMessage(message, key) {
  const text = String(message ?? "");
  if (SAFE_MESSAGE.test(text)) return text;
  return redact(text, key) || "Request failed.";
}

/**
 * The first transport-level code in the cause chain, for diagnosis only —
 * whether a retry is safe is `neverReached`'s call, not this one's.
 * `DOMException.code` is a number, hence the string test.
 */
function connectionCode(error) {
  for (let e = error, depth = 0; e && depth < 5; depth++, e = e.cause) {
    if (typeof e.code === "string") return e.code;
    const nested = Array.isArray(e.errors) ? e.errors : [];
    const inner = nested.find((item) => typeof item?.code === "string");
    if (inner) return inner.code;
  }
  return undefined;
}

/** A complete GLB 2.0: magic, version, and a declared length that matches. */
function assertCompleteGlb(bytes) {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "glTF" ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  ) {
    throw new Error("Output is not a complete GLB 2.0 file.");
  }
}

/** The first bytes of every binary FBX: the magic, its terminator and marker. */
const FBX_MAGIC = Buffer.from("Kaydara FBX Binary  \0\u001a\0", "latin1");

/** A binary FBX header, plus the version word that has to follow it. */
function assertBinaryFbx(bytes) {
  if (bytes.length < FBX_MAGIC.length + 4 || !bytes.subarray(0, FBX_MAGIC.length).equals(FBX_MAGIC)) {
    throw new Error("Output is not a binary FBX file.");
  }
}

/**
 * Which file a completed result offers, and what it is. `quad: true` asks
 * H3.1 for quad topology, and quad topology comes back as FBX — so the
 * named `model_urls` entries decide the format when they are there, and the
 * job's own `quad` flag decides what the unnamed `model_mesh` must be.
 */
function chooseModelFile(result, quad) {
  const urls = result?.model_urls ?? {};
  if (urls.glb?.url) return { file: urls.glb, format: "glb" };
  if (urls.fbx?.url) return { file: urls.fbx, format: "fbx" };
  if (result?.model_mesh?.url) return { file: result.model_mesh, format: quad ? "fbx" : "glb" };
  throw new Error("Completed result has no model file URL.");
}

/** The requested output path carrying the extension the file actually has. */
function outputFor(output, format) {
  const wanted = `.${format}`;
  const current = /\.[^./\\]*$/.exec(output)?.[0];
  if (current?.toLowerCase() === wanted) return output;
  return `${current ? output.slice(0, -current.length) : output}${wanted}`;
}

function clearError(job) {
  delete job.error;
  delete job.error_detail;
  delete job.error_stage;
  delete job.connection_error;
}

/**
 * The compact row this script reports, in a stable field order.
 *
 * `output` is the path that was written once one was — a quad job asked for
 * a GLB and received an FBX, and the caller has to be told which file to
 * open. `format` and `auto_size` answer the two questions that decide what
 * happens next: whether the file needs converting, and whether its units
 * are already metres.
 */
function compactRow(job) {
  const { id, state, request_id, bytes, error, error_stage, error_detail, connection_error } = job;
  const input = job.input && typeof job.input === "object" ? job.input : {};
  return {
    id,
    state,
    format: job.format,
    auto_size: typeof input.auto_size === "boolean" ? input.auto_size : undefined,
    output: job.output_written ?? job.output,
    request_id,
    bytes,
    error,
    error_stage,
    error_detail,
    connection_error,
  };
}

function readPlan(absolute) {
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    throw new Error(`Cannot read the job file ${absolute}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`The job file is not valid JSON: ${error.message}`);
  }
}

/**
 * Run one command over one job file.
 *
 * @param {"check"|"submit"|"collect"} command
 * @param {string} filename                Path to the job file.
 * @param {object} [options]
 * @param {number} [options.concurrency]   Independent jobs in flight (default 4).
 * @param {typeof fetch} [options.fetchFn] Injected for tests; nothing else reaches the network.
 * @param {string} [options.key]           fal API key; discovered through `loadFalKey` when omitted.
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleep]
 *        Back-off between download attempts; injected so a test does not spend it.
 * @param {(message: string) => void} [options.onNote]
 *        Side notes that are not job state — an oversized payload, an FBX that
 *        still needs converting. Goes to stderr; stdout stays the rows.
 * @returns {Promise<Array<object>>} One compact row per job.
 */
export async function runBatch(
  command,
  filename,
  { concurrency = 4, fetchFn = fetch, key, sleep, onNote = (message) => console.error(message) } = {},
) {
  if (!COMMANDS.includes(command)) throw new Error("Use check, submit or collect.");
  if (typeof filename !== "string" || !filename) throw new Error("A job file path is required.");
  const absolute = resolve(filename);
  const base = dirname(absolute);

  if (command === "check") {
    const data = readPlan(absolute);
    validatePlan(data);
    return data.jobs.map((job) => {
      const checked = (state, error) => ({ id: job.id, state, request_id: job.request_id, error });
      const images = jobImages(job);
      try {
        if (!job.request_id && (job.status_url || job.response_url || job.cancel_url)) {
          return checked("missing-request-id", "Recover the original request_id before proceeding.");
        }
        if (job.state === "submitting" || job.state === "submission-uncertain") return checked(job.state);
        // Every view has to be there: a turnaround submitted without its
        // back is a paid job that answers a different question.
        const files = images.map((image) => resolve(base, image));
        if (files.some((file) => !existsSync(file))) return checked("waiting-for-image");
        // Exactly what `submit` would build, so a file that cannot become a
        // payload is found here rather than one command later.
        files.forEach((file, index) => imagePayload(file, imageLabel(job, index, files.length), onNote));
        return checked(job.request_id ? "already-submitted" : "ready");
      } catch (error) {
        return checked("invalid-image", error.message);
      }
    });
  }

  const apiKey = key ?? loadFalKey() ?? process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("Set FAL_KEY or FAL_API_KEY in the environment.");

  // One writer per job file. Two overlapping runs would each hold a stale
  // copy of the plan and the later save would erase the other's request ids.
  const lockPath = `${absolute}.lock`;
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `${lockPath} exists — another run is using this job file. Wait for it to finish; delete the lock only if you are sure no run is active.`,
      );
    }
    throw error;
  }

  try {
    writeSync(fd, `${JSON.stringify({ pid: process.pid, command, at: new Date().toISOString() })}\n`);
    const data = readPlan(absolute);
    validatePlan(data, { inputChecks: command !== "collect" });

    const save = () => {
      writeFileSync(`${absolute}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
      renameSync(`${absolute}.tmp`, absolute);
    };

    /** One queue call. Nothing but `https://queue.fal.run` is ever called here. */
    const request = async (url, payload) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== QUEUE_HOST || parsed.username || parsed.password) {
        throw new Error("Unexpected fal queue URL.");
      }
      const response = await fetchFn(url, {
        method: payload ? "POST" : "GET",
        redirect: "error",
        headers: { Authorization: `Key ${apiKey}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = new Error(`fal.ai HTTP ${response.status}`);
        error.status = response.status;
        try {
          error.detail = errorDetail(await response.json(), apiKey);
        } catch {
          // An HTML error page or a truncated body carries nothing worth
          // keeping, and everything worth leaking.
        }
        throw error;
      }
      return response.json();
    };

    const work = async (job) => {
      let stage = command;
      try {
        if (command === "submit") {
          // A paid submission is never automatically repeated.
          if (job.request_id || job.state === "submitting" || job.state === "submission-uncertain") return;
          if (job.status_url || job.response_url || job.cancel_url) {
            throw new Error("Existing queue URLs have no request_id. Recover the original record; do not submit it again.");
          }
          const files = jobImages(job).map((image) => resolve(base, image));
          if (files.some((file) => !existsSync(file))) {
            job.state = "waiting-for-image";
            save();
            return;
          }
          // Each view is inlined on its own, so `falMediaUrl`'s size ceiling
          // applies per image and the error names the view that broke it.
          const urls = files.map((file, index) => imagePayload(file, imageLabel(job, index, files.length), onNote));

          // On disk before the POST: if this process dies mid-request, the
          // next run sees `submitting` and refuses to pay twice.
          job.state = "submitting";
          job.submitted_at = new Date().toISOString();
          clearError(job);
          save();

          const result = await request(toQueueUrl(`https://fal.run/${job.endpoint}`), {
            ...job.input,
            // The multiview model reads the turnaround positionally: the
            // order in the job file is the order it is sent.
            ...(isMultiview(job) ? { image_urls: urls } : { image_url: urls[0] }),
          });
          // Whatever came back is kept verbatim, and kept first: an
          // incomplete envelope still identifies a job we must not repeat.
          for (const field of ["request_id", "status_url", "response_url", "cancel_url"]) {
            if (result[field]) job[field] = result[field];
          }
          save();
          if (!result.request_id || !result.status_url || !result.response_url) {
            throw new Error("Submission omitted its request id or queue URLs.");
          }
          job.state = result.status || "IN_QUEUE";
        } else {
          if (!job.request_id || job.state === "downloaded") return;
          if (!job.status_url || !job.response_url) {
            throw new Error("This job has a request id but no queue URLs. Recover the original record before collecting it.");
          }
          stage = "status";
          const status = await request(job.status_url);
          if (typeof status.status !== "string") throw new Error("Status response carried no status.");
          job.state = status.status;
          job.checked_at = new Date().toISOString();
          clearError(job);
          save();
          if (status.status !== "COMPLETED") return;

          stage = "result";
          const result = await request(job.response_url);
          const quad = job.input && typeof job.input === "object" && job.input.quad === true;
          const { file, format } = chooseModelFile(result, quad);
          const target = new URL(file.url);
          if (target.protocol !== "https:" || target.username || target.password) {
            throw new Error("Unexpected model download URL.");
          }

          stage = "download";
          // The artifact host is not fal's queue: it gets no credential.
          // `downloadFalFile` gives a slow CDN an idle clock rather than a
          // wall clock, and retries a failed attempt — a download costs
          // nothing, unlike the generation it is fetching.
          let bytes;
          try {
            bytes = await downloadFalFile(file.url, { fetchImpl: fetchFn, ...(sleep ? { sleep } : {}) });
          } catch (error) {
            const message = String(error?.message ?? error);
            throw new Error(
              /^HTTP \d+$/.test(message) ? `model download ${message}` : `model download failed: ${message}`,
              { cause: error },
            );
          }
          if (format === "fbx") assertBinaryFbx(bytes);
          else assertCompleteGlb(bytes);
          // A GLB is written exactly where it was asked for. An FBX cannot
          // be: the extension has to tell the truth about the container, so
          // a quad job that asked for a .glb gets the .fbx beside it.
          const written = format === "glb" ? job.output : outputFor(job.output, format);
          const output = resolve(base, written);
          mkdirSync(dirname(output), { recursive: true });
          const part = `${output}.part`;
          try {
            writeFileSync(part, bytes);
            renameSync(part, output);
          } catch (error) {
            rmSync(part, { force: true });
            throw error;
          }
          Object.assign(job, {
            state: "downloaded",
            format,
            output_written: written,
            bytes: bytes.length,
            downloaded_at: new Date().toISOString(),
          });
          if (format === "fbx") {
            onNote(
              `${job.id}: this result is an FBX, not a GLB — wrote ${written}. Convert it with: blender.mjs convert ${written} ${outputFor(written, "glb")}`,
            );
          }
        }
      } catch (error) {
        const code = connectionCode(error);
        if (job.state === "submitting") {
          // Only a connection that never opened proves no job exists.
          job.state = neverReached(error)
            ? "not-submitted"
            : REJECTED_STATUSES.has(error.status)
              ? "rejected"
              : "submission-uncertain";
        }
        if (stage === "result" || stage === "download") job.state = `${stage}-error`;
        job.error_stage = stage;
        if (error.detail) job.error_detail = error.detail;
        if (code) job.connection_error = code;
        job.error = safeMessage(error.message, apiKey);
      }
      save();
    };

    const pending = [...data.jobs];
    const workers = Math.max(1, Math.min(Math.floor(Number(concurrency)) || 1, pending.length));
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (pending.length) await work(pending.shift());
      }),
    );
    return data.jobs.map(compactRow);
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fail = (message) => {
    console.error(`${message}\n\n${HELP}`);
    process.exitCode = 1;
  };
  let parsed = null;
  try {
    parsed = parseArgs({
      args: joinNegativeNumbers(process.argv.slice(2)),
      options: { concurrency: { type: "string" }, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    });
  } catch (error) {
    fail(error.message);
  }

  if (parsed) {
    const { values, positionals } = parsed;
    const [command, file] = positionals;
    const concurrency = values.concurrency === undefined ? 4 : Number(values.concurrency);

    if (values.help) {
      console.log(HELP);
    } else if (command === "recipe") {
      // Prints a job, not a run: no key, no file, nothing to resume.
      try {
        console.log(JSON.stringify(recipeJob(file), null, 2));
      } catch (error) {
        fail(error.message);
      }
    } else if (!command || !file) {
      fail(!command ? "A command is required: check, submit, collect or recipe." : "A job file path is required.");
    } else if (!Number.isInteger(concurrency) || concurrency < 1) {
      fail("--concurrency must be a positive integer.");
    } else {
      try {
        const rows = await runBatch(command, file, { concurrency });
        console.log(JSON.stringify(rows, null, 2));
        if (rows.some((row) => row.error)) process.exitCode = 1;
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  }
}
