#!/usr/bin/env node

/**
 * Motion transfer on fal.ai — a character image performs the movement of a
 * driving (reference) video.
 *
 * One still of the character and one clip of a performer in; one MP4 of the
 * character doing what the performer did out. Three models, chosen by name:
 *
 *   kling-mc     → fal-ai/kling-video/v3/standard/motion-control
 *   kling-mc-pro → fal-ai/kling-video/v3/pro/motion-control
 *     { image_url, video_url, character_orientation, prompt?,
 *       keep_original_sound: false }
 *     Answers `{ video: File }`. `character_orientation` is required:
 *     "image" keeps the facing of the character image and takes a driving
 *     clip of at most 10 s; "video" follows the performer's facing and takes
 *     up to 30 s. Kling wants a REALISTIC performer with the whole body or
 *     the upper body in frame — nothing here can check that, so the help
 *     text says it. `keep_original_sound` defaults to true at fal; it is
 *     always sent false here, because the driving clip's audio track (a
 *     phone recording, a stock clip's music) is never what a character
 *     animation should carry.
 *     Measured 2026-10-30: one Kling run took 287 s queue + render.
 *
 *   wan-animate  → fal-ai/wan/v2.2-14b/animate/move
 *     { image_url, video_url, resolution, seed? }
 *     Answers `{ video: File, prompt, seed }`. `resolution` is 480p, 580p
 *     or 720p (fal's default 480p, kept here). Its other knobs (steps,
 *     turbo, quality, shift, guidance) are left at fal's defaults — no
 *     caller has needed them yet. One measured run spent more than 20 min
 *     in queue + render, which is what the 25-minute deadline is sized for.
 *
 * Prices are fal's pricing API (`GET api.fal.ai/v1/models/pricing`), read
 * 2026-10-30, all per OUTPUT second: kling-mc $0.126, kling-mc-pro $0.168,
 * wan-animate $0.08. Check them again before quoting a user a total.
 *
 * Usage:
 *   node motion-transfer.mjs --image hero.png --video dance.mp4 --output out.mp4 \
 *     [--model kling-mc|kling-mc-pro|wan-animate] [--orientation image|video] \
 *     [--prompt "..."] [--resolution 480p|580p|720p] [--seed N] \
 *     [--deadline-s 1500] [--json]
 *
 * A flag the chosen model does not have is REFUSED by name rather than
 * dropped: --orientation and --prompt are Kling's, --resolution and --seed
 * are Wan's. A flag that quietly does nothing makes the record of what was
 * asked for untrue.
 *
 * The local image is inlined as a data URI (`falMediaUrl`). The local video
 * is UPLOADED to fal storage (`uploadFalFile`): fal validates `video_url` as
 * a URL and rejects anything past 2083 characters, which every real clip's
 * data URI is. A `data:` video is refused here; an http(s) one is passed
 * through. The driving clip's duration is measured with ffprobe and checked
 * against the model's ceiling BEFORE the upload and before the paid submit;
 * when ffprobe is missing or the clip is a URL, a note says the check did
 * not run rather than pretending it passed.
 *
 * Submission goes through fal's QUEUE (`fal-queue.mjs::runFalJob`), so
 * SIGINT/SIGTERM cancels the job remotely before this exits 130 — an
 * abandoned render is still a paid one. The clip is written atomically
 * (`<output>.tmp`, remuxed with `-c copy -movflags +faststart` when ffmpeg
 * is on PATH, then renamed).
 *
 * `--json` prints exactly one object:
 *   { path, url, file_size, model, endpoint, duration, width, height,
 *     orientation?, resolution?, seed?, request_id?, cost }
 * `cost` is an ESTIMATE (`transferCost`): fal's per-second price times the
 * delivered clip's duration as ffprobe measures it — never an invoice. The
 * same figure goes to stderr as one `cost:` line. Everything else —
 * progress, warnings, help — goes to stderr; exit 1 on failure, 130 on
 * interrupt.
 *
 * Environment: FAL_KEY, from the environment or a `.env` discovered by
 * `fal-queue.mjs::loadFalKey`. Never printed, never an argv.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DOWNLOAD_ATTEMPTS, downloadFalFile, falMediaUrl, loadFalKey, runFalJob, uploadFalFile } from "./fal-queue.mjs";

/** The date the prices below were read off fal's pricing API. */
export const PRICES_CHECKED = "2026-10-30";

/**
 * The three models. `family` decides the request shape and which flags
 * apply; `usdPerSecond` is fal's unit price per output second.
 */
export const MODELS = Object.freeze({
  "kling-mc": Object.freeze({
    endpoint: "fal-ai/kling-video/v3/standard/motion-control",
    family: "kling",
    usdPerSecond: 0.126,
    label: "Kling v3 Standard motion control",
  }),
  "kling-mc-pro": Object.freeze({
    endpoint: "fal-ai/kling-video/v3/pro/motion-control",
    family: "kling",
    usdPerSecond: 0.168,
    label: "Kling v3 Pro motion control",
  }),
  "wan-animate": Object.freeze({
    endpoint: "fal-ai/wan/v2.2-14b/animate/move",
    family: "wan",
    usdPerSecond: 0.08,
    label: "Wan 2.2 Animate move",
  }),
});

export const DEFAULT_MODEL = "kling-mc";
export const ORIENTATIONS = ["image", "video"];
export const DEFAULT_ORIENTATION = "image";
export const WAN_RESOLUTIONS = ["480p", "580p", "720p"];
export const DEFAULT_WAN_RESOLUTION = "480p";
/** Queue + render; Wan 2.2 Animate was measured past 20 minutes. */
export const DEFAULT_DEADLINE_S = 1500;

/**
 * The longest driving clip each model takes, in seconds: Kling with
 * `character_orientation: "image"` takes 10 s, every other combination 30 s.
 */
export function maxDrivingSeconds(model, orientation = DEFAULT_ORIENTATION) {
  return MODELS[model]?.family === "kling" && orientation === "image" ? 10 : 30;
}

/** The synchronous fal URL for a model; `runFalJob` moves it onto the queue host. */
export function endpointUrl(model) {
  return `https://fal.run/${MODELS[model].endpoint}`;
}

/**
 * Every flag checked against the chosen model, before a key is read or a
 * byte is uploaded. Returns the normalized options (defaults filled in for
 * the model's own flags, the others absent); throws a refusal naming the
 * flag at fault.
 */
export function validateOptions(options = {}) {
  const { image, video, output, model = DEFAULT_MODEL, orientation, prompt, resolution, seed } = options;
  if (typeof image !== "string" || !image.trim()) throw new Error("--image is required");
  if (typeof video !== "string" || !video.trim()) throw new Error("--video is required");
  if (typeof output !== "string" || !output.trim()) throw new Error("--output is required");
  if (extname(output).toLowerCase() !== ".mp4") throw new Error(`--output must be an .mp4 path (got: ${output})`);

  const spec = MODELS[model];
  if (!spec) throw new Error(`--model must be one of: ${Object.keys(MODELS).join(", ")} (got: ${model})`);

  if (spec.family === "kling") {
    if (resolution != null) throw new Error(`--resolution applies to --model wan-animate only (--model ${model} has no resolution setting)`);
    if (seed != null) throw new Error(`--seed applies to --model wan-animate only (--model ${model} takes no seed)`);
    const facing = orientation ?? DEFAULT_ORIENTATION;
    if (!ORIENTATIONS.includes(facing)) throw new Error(`--orientation must be one of: ${ORIENTATIONS.join(", ")} (got: ${orientation})`);
    if (prompt != null && (typeof prompt !== "string" || !prompt.trim())) throw new Error("--prompt must not be empty");
    return { image, video, output, model, orientation: facing, ...(prompt != null ? { prompt } : {}) };
  }

  if (orientation != null) throw new Error(`--orientation applies to the Kling models only (--model ${model} has no orientation setting)`);
  if (prompt != null) throw new Error(`--prompt applies to the Kling models only (--model ${model} takes no prompt)`);
  const tier = resolution ?? DEFAULT_WAN_RESOLUTION;
  if (!WAN_RESOLUTIONS.includes(tier)) throw new Error(`--resolution must be one of: ${WAN_RESOLUTIONS.join(", ")} (got: ${resolution})`);
  const normalized = { image, video, output, model, resolution: tier };
  if (seed != null && seed !== "") {
    const value = Number(seed);
    if (!Number.isInteger(value)) throw new Error(`--seed must be an integer (got: ${seed})`);
    normalized.seed = value;
  }
  return normalized;
}

/**
 * Refuse a driving clip past the model's ceiling. `duration` null means
 * "not measured", which is not "within the limit": the caller is told so,
 * and the check returns false.
 */
export function checkDrivingDuration({ model, orientation, duration, source = "--video", onNote = (m) => console.error(m) }) {
  const limit = maxDrivingSeconds(model, orientation);
  const which = MODELS[model]?.family === "kling" ? `${model} with --orientation ${orientation ?? DEFAULT_ORIENTATION}` : model;
  if (!(duration > 0)) {
    onNote(`NOTE: ${source}'s duration could not be measured here, so ${which}'s ${limit} s limit was not checked — fal enforces it`);
    return false;
  }
  if (duration > limit) {
    const hint = MODELS[model]?.family === "kling" && orientation === "image"
      ? " Trim it, or pass --orientation video (follows the performer's facing, up to 30 s)."
      : " Trim it.";
    throw new Error(`--video is ${duration.toFixed(1)} s — ${which} takes a driving clip of at most ${limit} s.${hint}`);
  }
  return true;
}

/**
 * The exact request body for one model, from inputs that are already URLs
 * (data or hosted). Field names are fal's.
 */
export function buildRequestBody(model, { imageUrl, videoUrl, orientation = DEFAULT_ORIENTATION, prompt, resolution = DEFAULT_WAN_RESOLUTION, seed } = {}) {
  const spec = MODELS[model];
  if (!spec) throw new Error(`--model must be one of: ${Object.keys(MODELS).join(", ")} (got: ${model})`);
  if (spec.family === "kling") {
    const body = { image_url: imageUrl, video_url: videoUrl, character_orientation: orientation };
    if (prompt != null) body.prompt = prompt;
    // fal's default is true; the driving clip's sound is never the character's.
    body.keep_original_sound = false;
    return body;
  }
  const body = { image_url: imageUrl, video_url: videoUrl, resolution };
  if (seed != null) body.seed = seed;
  return body;
}

/**
 * Width, height and duration of a local clip; each null when unreadable, or
 * null overall when ffprobe is not on PATH or cannot read the file. Null
 * means "not measured" — never "within the limits".
 */
export function probeVideo(path) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration", "-of", "json", path,
  ], { encoding: "utf-8" });
  if (result.error || result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const positive = (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const stream = parsed.streams?.[0] ?? {};
    const probed = { width: positive(stream.width), height: positive(stream.height), duration: positive(parsed.format?.duration) };
    return probed.width === null && probed.height === null && probed.duration === null ? null : probed;
  } catch {
    return null;
  }
}

/**
 * Validate, measure, then turn the inputs into URLs: the image inlined, the
 * video uploaded. Every refusal happens before the upload, so a typo never
 * costs a transfer. `probe` and `upload` are injected for tests.
 */
export async function prepareRequest(options = {}, { probe = probeVideo, upload = uploadFalFile, onNote = (m) => console.error(m) } = {}) {
  const valid = validateOptions(options);
  const { model, video } = valid;

  if (/^data:/.test(video)) {
    throw new Error("--video must be a file path or an http(s) URL — fal rejects a data URI in video_url as too long (2083 characters); a local clip is uploaded to fal storage instead");
  }
  const hosted = /^https?:/.test(video);
  if (!hosted && !existsSync(video)) throw new Error(`--video: file not found: ${video}`);

  const imageUrl = falMediaUrl(valid.image, { label: "--image", onNote });

  if (hosted) {
    checkDrivingDuration({ model, orientation: valid.orientation, duration: null, source: "--video (a URL)", onNote });
  } else {
    checkDrivingDuration({ model, orientation: valid.orientation, duration: probe(video)?.duration ?? null, onNote });
  }

  const videoUrl = hosted ? video : await upload(video, { key: options.apiKey, label: "--video", signal: options.signal, onNote });
  const body = buildRequestBody(model, { ...valid, imageUrl, videoUrl });
  return { model, endpoint: MODELS[model].endpoint, url: endpointUrl(model), body, options: valid };
}

const roundTo = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * What one transfer cost at fal's per-second price, from the duration of
 * the clip that landed. Always an estimate; `usd` is null when the clip
 * could not be measured, with the reason in `note`.
 */
export function transferCost({ model, duration } = {}) {
  const spec = MODELS[model];
  if (!spec) return { usd: null, estimate: true, basis: "unknown", note: `no price is known for --model ${model}` };
  const common = { estimate: true, usdPerSecond: spec.usdPerSecond, checked: PRICES_CHECKED };
  if (!(duration > 0)) {
    return { usd: null, ...common, basis: "unknown", note: "the delivered clip's duration could not be measured (ffprobe)" };
  }
  return {
    usd: roundTo(duration * spec.usdPerSecond, 4),
    ...common,
    duration: roundTo(duration, 3),
    basis: "seconds-of-delivered-clip",
  };
}

/** `$0.6300` — dollars to four places, or "unknown". */
function formatUsd(usd) {
  return Number.isFinite(usd) ? `$${usd.toFixed(4)}` : "unknown";
}

/** The one stderr line a `cost` object is said in. */
export function costLine(cost, model) {
  const listed = cost?.usdPerSecond === undefined ? "" : `; fal lists $${cost.usdPerSecond} per output second for ${model}`;
  if (!cost || cost.usd === null) return `cost: unknown (${cost?.note ?? "no measurement"}${listed})`;
  return `cost: ≈ ${formatUsd(cost.usd)} (estimate: ${cost.duration} s × $${cost.usdPerSecond} per second, ${model} at fal's list price, pricing API read ${cost.checked})`;
}

/**
 * Move the MP4 index to the front so a browser can seek without an extra
 * round trip. Best effort: a missing ffmpeg or a failed pass leaves the
 * clip exactly as delivered and says so on stderr. The same pass as
 * `seedance-video.mjs`, kept local so this script's only shared dependency
 * is `fal-queue.mjs` (a mode's `sharedScripts` whitelist is transitive).
 */
export function remuxFaststart(path, { onNote = (m) => console.error(m) } = {}) {
  const staged = `${path}.faststart.mp4`;
  const result = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", path, "-c", "copy", "-movflags", "+faststart", staged], { encoding: "utf-8" });
  if (result.error || result.status !== 0 || !existsSync(staged)) {
    onNote(result.error ? "NOTE: ffmpeg not found — the clip keeps fal's trailing MP4 index (slower to seek in a browser)" : "WARN: faststart remux failed — clip left as delivered");
    try { unlinkSync(staged); } catch { /* never created */ }
    return false;
  }
  renameSync(staged, path);
  return true;
}

/**
 * Run one motion-transfer job and write its clip to `output`.
 *
 * The uploader, job runner, downloader, remux and probe are injected so the
 * whole path runs without fal or ffmpeg. The file appears atomically: bytes
 * go to `<output>.tmp`, are remuxed there, and only then take the real name.
 */
export async function transferMotion(
  options,
  { runJob = runFalJob, download = downloadFalFile, upload = uploadFalFile, probe = probeVideo, remuxFile = remuxFaststart, onNote = (m) => console.error(m) } = {},
) {
  const { apiKey, signal, deadlineMs = DEFAULT_DEADLINE_S * 1000, remux = true } = options;
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const { model, endpoint, url, body, options: valid } = await prepareRequest(options, { probe, upload, onNote });

  const job = await runJob({
    url,
    body,
    key: apiKey,
    signal,
    label: MODELS[model].label,
    deadlineMs,
    onRetry: ({ attempt, attempts, delayMs, reason }) => {
      onNote(`WARN: ${String(reason).slice(0, 160)} — retrying in ${delayMs / 1000}s (attempt ${attempt} of ${attempts})`);
    },
  });

  const videoUrl = job?.data?.video?.url;
  if (!videoUrl) throw new Error(`response carried no video URL: ${JSON.stringify(job?.data ?? null).slice(0, 500)}`);

  // The render is paid for and finished upstream; a failure from here on
  // is the download's own, and says which phase lost it.
  let bytes;
  try {
    bytes = await download(videoUrl, { signal, attempts: DOWNLOAD_ATTEMPTS });
  } catch (error) {
    if (error?.name === "AbortError") throw error; // an interrupt stays an interrupt
    const id = typeof job?.requestId === "string" && job.requestId ? ` (fal request ${job.requestId})` : "";
    throw new Error(`clip download failed after ${DOWNLOAD_ATTEMPTS} attempts${id}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const output = valid.output;
  mkdirSync(dirname(output), { recursive: true });
  const staged = `${output}.tmp`;
  writeFileSync(staged, bytes);
  if (remux) remuxFile(staged, { onNote });
  renameSync(staged, output);

  const measured = probe(output) ?? {};
  const result = {
    path: output,
    url: videoUrl,
    // The file on disk, after the faststart pass rewrote the container.
    file_size: statSync(output).size,
    model,
    endpoint,
    duration: measured.duration != null ? roundTo(measured.duration, 3) : null,
    width: measured.width ?? null,
    height: measured.height ?? null,
  };
  if (body.character_orientation) result.orientation = body.character_orientation;
  if (body.resolution) result.resolution = body.resolution;
  const seed = job?.data?.seed ?? body.seed;
  if (seed != null) result.seed = seed;
  // fal's queue id: the only handle on a finished render once this exits.
  if (typeof job?.requestId === "string" && job.requestId) result.request_id = job.requestId;
  result.cost = transferCost({ model, duration: measured.duration });
  return result;
}

const HELP = `Usage: motion-transfer.mjs --image <path|url> --video <path|url> --output <file.mp4> [options]

A character image performs the movement of a driving video, on fal.ai.

  --image <path|url>       The character (required). Local files are inlined.
  --video <path|url>       The driving clip — the movement to copy (required).
                           Local files are uploaded to fal storage.
  --output <file.mp4>      Where the clip is written (required)
  --model <name>           ${Object.keys(MODELS).join(", ")} (default: ${DEFAULT_MODEL})
                             kling-mc      $${MODELS["kling-mc"].usdPerSecond}/s  Kling v3 Standard motion control
                             kling-mc-pro  $${MODELS["kling-mc-pro"].usdPerSecond}/s  Kling v3 Pro motion control
                             wan-animate   $${MODELS["wan-animate"].usdPerSecond}/s   Wan 2.2 Animate (move)
  --orientation <facing>   Kling only: image | video (default: image)
                             image  keep the character image's facing; driving clip ≤ 10 s
                             video  follow the performer's facing; driving clip ≤ 30 s
  --prompt <text>          Kling only: optional text guidance
  --resolution <tier>      Wan only: ${WAN_RESOLUTIONS.join(", ")} (default: ${DEFAULT_WAN_RESOLUTION})
  --seed <n>               Wan only: integer seed for a reproducible take
  --json                   Print one JSON object on stdout
  --deadline-s <n>         Give up on the job after this many seconds (default: ${DEFAULT_DEADLINE_S})
  --help, -h               This text

Kling wants a REALISTIC performer in the driving clip, with the whole body or
the upper body visible; this cannot be checked here. wan-animate takes a
driving clip of at most 30 s. A flag the chosen model does not have is
refused, not ignored. The driving clip's length is measured with ffprobe
before anything is uploaded or paid for (a URL, or a machine without
ffprobe, leaves that check to fal). The driving clip's audio is never kept.

Requires FAL_KEY (environment or .env). Progress goes to stderr; with --json,
stdout carries exactly one object. What the clip cost — an estimate: fal's
per-second price (pricing API read ${PRICES_CHECKED}) × the delivered clip's
duration — is printed on stderr as a cost: line and returned as the object's
cost. Runs take minutes (Kling ≈ 5 min, Wan can exceed 20 min); an interrupt
cancels the fal job.`;

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      image: { type: "string" },
      video: { type: "string" },
      output: { type: "string" },
      model: { type: "string", default: DEFAULT_MODEL },
      orientation: { type: "string" },
      prompt: { type: "string" },
      resolution: { type: "string" },
      seed: { type: "string" },
      json: { type: "boolean", default: false },
      "deadline-s": { type: "string", default: String(DEFAULT_DEADLINE_S) },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.error(HELP);
    return 0;
  }
  const options = {
    image: values.image,
    video: values.video,
    output: values.output,
    model: values.model,
    orientation: values.orientation,
    prompt: values.prompt,
    resolution: values.resolution,
    seed: values.seed,
  };
  // Every flag refusal before the key is even read.
  validateOptions(options);

  const apiKey = loadFalKey();
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  // An interrupt has to reach fal, not just this process: a job abandoned
  // mid-render keeps running on someone else's meter.
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
    const result = await transferMotion({
      ...options,
      apiKey,
      signal: controller.signal,
      deadlineMs: Math.max(30, Number(values["deadline-s"]) || DEFAULT_DEADLINE_S) * 1000,
    });
    // The price first, on stderr: stdout stays one object (or one path).
    console.error(costLine(result.cost, result.model));
    console.log(values.json ? JSON.stringify(result) : result.path);
    return 0;
  } catch (error) {
    if (interruptedBy || error?.name === "AbortError") {
      console.error(`ERROR: ${interruptedBy ?? "interrupted"} — the fal.ai job was cancelled`);
      return 130;
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
