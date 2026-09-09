#!/usr/bin/env node

/**
 * Shared Video Generator CLI — Seedance 2.5 on fal.ai.
 *
 * Same argv grammar as `generate-video.mjs` (MiniMax H3 Max) on purpose, so
 * a skill can describe both with one sentence and swap the model by
 * swapping the script name. Three endpoints, one inferred from the inputs:
 *
 *   text-to-video       prompt only.
 *   image-to-video      + first frame (--image), optional last frame
 *                       (--end-image). The output aspect FOLLOWS the input
 *                       image, so --aspect-ratio is refused here.
 *   reference-to-video  + subject/style anchors (--ref-image up to 30,
 *                       --ref-video and --ref-audio up to 10 each).
 *                       Address them in the prompt by modality and order:
 *                       "@Image1", "@Video1", "@Audio1".
 *
 * Usage:
 *   node seedance-video.mjs --prompt "..." --output motions/walk/clip.mp4 \
 *     [--endpoint text|image|reference] [--duration auto|4-30] \
 *     [--resolution 480p|720p|1080p] [--aspect-ratio 16:9] \
 *     [--image path-or-url] [--end-image path-or-url] \
 *     [--ref-image ...]... [--ref-video ...]... [--ref-audio ...]... \
 *     [--no-audio] [--bitrate standard|high] [--seed N] [--json]
 *
 * Local inputs are inlined as base64 data URIs; anything over 30 MB is
 * refused before the paid request rather than timing out inside it.
 *
 * Submission goes through fal's QUEUE (`fal-queue.mjs`): the job is
 * accepted at once and polled, transient submit failures get a bounded
 * back-off, and SIGINT/SIGTERM cancels the job remotely (PUT `cancel_url`)
 * before this process exits 130 — an abandoned render is still a paid one.
 *
 * After download the clip is remuxed with `-c copy -movflags +faststart`
 * when ffmpeg is on PATH: fal leaves the MP4 index at the end of the file,
 * which costs a browser an extra round trip on every load and every seek.
 * Without ffmpeg the clip is kept as delivered and a note says so.
 *
 * `--json` prints exactly one object:
 *   { path, url, file_size, model, endpoint, requested_duration,
 *     resolution, seed? }
 * Everything else — progress, warnings, help — goes to stderr.
 *
 * Environment: FAL_KEY, from the environment or a `.env` discovered by
 * `fal-queue.mjs::loadFalKey`. Never printed, never an argv.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { downloadFalFile, falMediaUrl, loadFalKey, runFalJob } from "./fal-queue.mjs";

export const SEEDANCE_MODEL = "bytedance/seedance-2.5";

/** The three endpoints, and whether each can be told an aspect ratio. */
export const ENDPOINTS = {
  text: { url: `https://fal.run/${SEEDANCE_MODEL}/text-to-video`, aspectRatio: true },
  image: { url: `https://fal.run/${SEEDANCE_MODEL}/image-to-video`, aspectRatio: false },
  reference: { url: `https://fal.run/${SEEDANCE_MODEL}/reference-to-video`, aspectRatio: true },
};

export const RESOLUTIONS = ["480p", "720p", "1080p"];
export const ASPECT_RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export const BITRATE_MODES = ["standard", "high"];
export const DURATION_MIN_S = 4;
export const DURATION_MAX_S = 30;
const MAX_REF_IMAGES = 30;
const MAX_REF_VIDEOS = 10;
const MAX_REF_AUDIOS = 10;

/**
 * Which endpoint a run belongs to: `--endpoint` when given (long or short
 * spelling), otherwise inferred from the inputs. Every combination that
 * cannot be honoured is refused here, before a key is even read.
 */
export function resolveEndpointName({ endpoint, image, endImage, refImages = [], refVideos = [], refAudios = [] } = {}) {
  const refCount = refImages.length + refVideos.length + refAudios.length;
  let name;
  if (endpoint) {
    name = String(endpoint).replace(/-to-video$/, "");
    if (!ENDPOINTS[name]) throw new Error(`--endpoint must be text, image, or reference (got: ${endpoint})`);
  } else {
    name = refCount ? "reference" : image ? "image" : "text";
  }
  if (refCount && name !== "reference") throw new Error(`--ref-* inputs require the reference endpoint (inferred/forced: ${name})`);
  if (image && name !== "image") throw new Error(`--image requires the image endpoint (inferred/forced: ${name})`);
  if (endImage && name !== "image") throw new Error(`--end-image requires the image endpoint (inferred/forced: ${name})`);
  if (name === "reference" && refImages.length + refVideos.length === 0) {
    throw new Error("reference endpoint needs at least one --ref-image or --ref-video (audio cannot be the only reference)");
  }
  if (refImages.length > MAX_REF_IMAGES) throw new Error(`at most ${MAX_REF_IMAGES} --ref-image inputs`);
  if (refVideos.length > MAX_REF_VIDEOS) throw new Error(`at most ${MAX_REF_VIDEOS} --ref-video inputs`);
  if (refAudios.length > MAX_REF_AUDIOS) throw new Error(`at most ${MAX_REF_AUDIOS} --ref-audio inputs`);
  return name;
}

/**
 * The exact request Seedance 2.5 is sent, or a thrown refusal naming the
 * flag at fault. `duration` travels as fal spells it — the string "auto"
 * or the string form of a whole number of seconds — so one field can carry
 * both.
 */
export function buildSeedanceRequest(options = {}) {
  const {
    prompt,
    image,
    endImage,
    refImages = [],
    refVideos = [],
    refAudios = [],
    duration = "auto",
    resolution = "480p",
    aspectRatio,
    audio = true,
    bitrate,
    seed,
  } = options;

  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("--prompt is required");
  const endpointName = resolveEndpointName(options);
  const endpoint = ENDPOINTS[endpointName];

  const wantedDuration = String(duration);
  if (wantedDuration !== "auto") {
    const seconds = Number(wantedDuration);
    if (!Number.isInteger(seconds) || seconds < DURATION_MIN_S || seconds > DURATION_MAX_S) {
      throw new Error(`--duration must be auto or a whole number of seconds from ${DURATION_MIN_S} to ${DURATION_MAX_S} (got: ${duration})`);
    }
  }
  if (!RESOLUTIONS.includes(resolution)) throw new Error(`--resolution must be one of: ${RESOLUTIONS.join(", ")} (got: ${resolution})`);
  if (aspectRatio != null) {
    if (!endpoint.aspectRatio) {
      throw new Error("image-to-video output aspect follows the input image — crop the image instead of passing --aspect-ratio");
    }
    if (!ASPECT_RATIOS.includes(aspectRatio)) throw new Error(`--aspect-ratio must be one of: ${ASPECT_RATIOS.join(", ")} (got: ${aspectRatio})`);
  }
  if (bitrate != null && !BITRATE_MODES.includes(bitrate)) {
    throw new Error(`--bitrate must be one of: ${BITRATE_MODES.join(", ")} (got: ${bitrate})`);
  }

  const body = { prompt };
  if (endpointName === "image") {
    if (image) body.image_url = falMediaUrl(image, { label: "--image" });
    if (endImage) body.end_image_url = falMediaUrl(endImage, { label: "--end-image" });
  }
  if (endpointName === "reference") {
    if (refImages.length) body.image_urls = refImages.map((source) => falMediaUrl(source, { label: "--ref-image" }));
    if (refVideos.length) body.video_urls = refVideos.map((source) => falMediaUrl(source, { label: "--ref-video" }));
    if (refAudios.length) body.audio_urls = refAudios.map((source) => falMediaUrl(source, { label: "--ref-audio" }));
  }
  body.resolution = resolution;
  body.duration = wantedDuration;
  if (aspectRatio != null) body.aspect_ratio = aspectRatio;
  // Sent explicitly rather than left to fal's default, so what the clip
  // carries is decided here and stays decided.
  body.generate_audio = audio !== false;
  if (bitrate != null) body.bitrate_mode = bitrate;
  if (seed != null && seed !== "") {
    const value = Number(seed);
    if (!Number.isInteger(value)) throw new Error(`--seed must be an integer (got: ${seed})`);
    body.seed = value;
  }

  return { endpoint: endpointName, url: endpoint.url, body };
}

/**
 * Move the MP4 index to the front so a browser can seek without an extra
 * round trip. Best effort: a missing ffmpeg or a failed pass leaves the
 * clip exactly as delivered and says so on stderr.
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
 * Run one Seedance job and write its clip to `output`.
 *
 * The job runner and the downloader are injected so the whole path can be
 * exercised without touching fal. The file appears atomically: bytes go to
 * `<output>.tmp`, are remuxed there, and only then take the real name — a
 * watcher never sees a half-written clip.
 */
export async function generateSeedanceVideo(options, { runJob = runFalJob, download = downloadFalFile } = {}) {
  const { output, apiKey, signal, deadlineMs = 900_000, remux = true } = options;
  if (typeof output !== "string" || !output.trim()) throw new Error("--output is required");
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const { endpoint, url, body } = buildSeedanceRequest(options);

  const job = await runJob({
    url,
    body,
    key: apiKey,
    signal,
    label: "Seedance 2.5 video generation",
    deadlineMs,
    onRetry: ({ attempt, attempts, delayMs, reason }) => {
      console.error(`WARN: ${String(reason).slice(0, 160)} — retrying in ${delayMs / 1000}s (attempt ${attempt} of ${attempts})`);
    },
  });

  const videoUrl = job?.data?.video?.url;
  if (!videoUrl) throw new Error(`response carried no video URL: ${JSON.stringify(job?.data ?? null).slice(0, 500)}`);

  const bytes = await download(videoUrl, { signal });

  mkdirSync(dirname(output), { recursive: true });
  const staged = `${output}.tmp`;
  writeFileSync(staged, bytes);
  if (remux) remuxFaststart(staged);
  renameSync(staged, output);

  const result = {
    path: output,
    url: videoUrl,
    file_size: bytes.length,
    model: SEEDANCE_MODEL,
    endpoint,
    requested_duration: body.duration === "auto" ? "auto" : Number(body.duration),
    resolution: body.resolution,
  };
  if (job?.data?.seed != null) result.seed = job.data.seed;
  return result;
}

const HELP = `Usage: seedance-video.mjs --prompt "..." --output <path.mp4> [options]

  --prompt <text>            What to shoot (required)
  --output <path>            Where the clip is written (required)
  --endpoint <name>          text | image | reference
                             (inferred: --ref-* → reference, --image → image, else text)
  --image <path|url>         First frame (image endpoint)
  --end-image <path|url>     Last frame (image endpoint)
  --ref-image <path|url>     Subject/style anchor, repeatable, up to ${MAX_REF_IMAGES}
  --ref-video <path|url>     Motion anchor, repeatable, up to ${MAX_REF_VIDEOS}
  --ref-audio <path|url>     Voice anchor, repeatable, up to ${MAX_REF_AUDIOS}
  --duration <auto|${DURATION_MIN_S}-${DURATION_MAX_S}>    Seconds (default: auto)
  --resolution <tier>        ${RESOLUTIONS.join(", ")} (default: 480p — the cheap tier for previews)
  --aspect-ratio <ratio>     ${ASPECT_RATIOS.join(", ")}
                             Refused on the image endpoint: its aspect follows the input image
  --no-audio                 Render silent (default: fal generates audio)
  --bitrate <mode>           ${BITRATE_MODES.join(", ")}
  --seed <n>                 Integer seed for a reproducible take
  --json                     Print one JSON object on stdout
  --deadline-s <n>           Give up on the job after this many seconds (default: 900)
  --help, -h                 This text

References are addressed in the prompt by modality and order: @Image1,
@Image2, @Video1, @Audio1. Local files are inlined as data URIs (30 MB max);
host anything larger and pass its URL.

Requires FAL_KEY (environment or .env). Progress goes to stderr; with
--json, stdout carries exactly one object.`;

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      prompt: { type: "string" },
      output: { type: "string" },
      endpoint: { type: "string" },
      duration: { type: "string", default: "auto" },
      resolution: { type: "string", default: "480p" },
      "aspect-ratio": { type: "string" },
      image: { type: "string" },
      "end-image": { type: "string" },
      "ref-image": { type: "string", multiple: true },
      "ref-video": { type: "string", multiple: true },
      "ref-audio": { type: "string", multiple: true },
      "no-audio": { type: "boolean", default: false },
      bitrate: { type: "string" },
      seed: { type: "string" },
      json: { type: "boolean", default: false },
      "deadline-s": { type: "string", default: "900" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.error(HELP);
    return 0;
  }
  if (!values.prompt) throw new Error("--prompt is required");
  if (!values.output) throw new Error("--output is required");

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
    const result = await generateSeedanceVideo({
      prompt: values.prompt,
      output: values.output,
      apiKey,
      endpoint: values.endpoint,
      image: values.image,
      endImage: values["end-image"],
      refImages: values["ref-image"] ?? [],
      refVideos: values["ref-video"] ?? [],
      refAudios: values["ref-audio"] ?? [],
      duration: values.duration,
      resolution: values.resolution,
      aspectRatio: values["aspect-ratio"],
      audio: !values["no-audio"],
      bitrate: values.bitrate,
      seed: values.seed,
      signal: controller.signal,
      deadlineMs: Math.max(30, Number(values["deadline-s"]) || 900) * 1000,
    });
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
