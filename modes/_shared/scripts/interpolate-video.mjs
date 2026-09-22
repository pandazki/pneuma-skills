#!/usr/bin/env node

/**
 * Frame interpolation (and optional upscaling) — Topaz Video AI on fal.ai.
 *
 * One clip in, one clip at a higher frame rate out. A 24 fps loop retimed
 * to 60 fps stops stepping in a UI; `sprite-sheet.mjs loop --fps 60` does
 * the same thing for free with ffmpeg's `minterpolate`, and this is the
 * paid comparison — Topaz generates the in-between frames with a model
 * (Apollo v8) instead of block motion compensation.
 *
 * Interpolation runs BEFORE matting: an alpha channel does not survive a
 * codec that has none, and the in-betweens should be invented from the
 * plate, not from a half-transparent edge.
 *
 * Usage:
 *   node interpolate-video.mjs --input clip.mp4 --output clip-60.mp4 \
 *     [--target-fps 60] [--upscale 1] [--model proteus|gaia-2] \
 *     [--deadline-s 900] [--json]
 *
 * Endpoint: https://fal.run/fal-ai/topaz/upscale/video
 *   { video_url, model, upscale_factor, target_fps, H264_output: true }
 *   Answers `video: File`. `H264_output: true` is sent because the default
 *   is H265, which ffmpeg builds and browsers handle less uniformly; the
 *   container is MP4 either way, so `--output` must end `.mp4`.
 *
 * Price: $0.01 per second of output up to 720p, $0.02 for 720p–1080p,
 * $0.08 above 1080p — DOUBLED for 60 fps output. Gaia 2 costs half.
 * Source: https://fal.ai/models/fal-ai/topaz/upscale/video
 * MEASURED 2026-09-22 with { model: "Proteus", upscale_factor: 1,
 * target_fps: 60, H264_output: true } on a 640² 24 fps 121-frame clip:
 * ≈ $0.10, 43.2 s of inference, 49 s wall, out came 640² h264 60 fps,
 * 300 frames, 5.0 s (`content_type: "video/mp4"`).
 *
 * `--upscale 1` (this script's default) asks for retiming with no change
 * of size, which is what a loop wants. fal documents `upscale_factor` with
 * a default of 2 and support up to 8x, and does not document a minimum —
 * the run above CONFIRMED that 1 is accepted and does keep the source
 * size. It is passed through exactly as given and never quietly coerced:
 * a silent doubling would quadruple the pixels and double the bill.
 *
 * `--target-fps` accepts 16–60. fal itself documents up to 120 fps output;
 * the narrower range is this script's own, because a UI loop past 60 fps
 * pays for frames no display shows.
 *
 * `--model` takes a short alias only — fal's enum strings have spaces and
 * digits ("Gaia 2"), which no caller should have to spell into a shell,
 * and an unknown alias is refused here rather than travelling into a paid
 * request. Two of the endpoint's nineteen documented values are wired:
 * `proteus` (fal's own default, "fits most footage") and `gaia-2`
 * ("animation and motion graphics at 2x", and half price). The rest are
 * denoise and generative-restoration families this pipeline has no use
 * for; they are listed at the source URL above.
 *
 * A local clip is UPLOADED to fal storage (`fal-queue.mjs::uploadFalFile`)
 * and the hosted URL is what travels in `video_url`. It is never inlined:
 * this endpoint answers 400 `Failed to download the assets: Invalid URL:
 * URL too long` to a data URI (measured 2026-09-22), which every real clip
 * would be. An `http(s)` input passes through untouched; a `data:` URI is
 * refused here rather than at fal.
 *
 * The job goes through fal's queue (`fal-queue.mjs`), so an interrupt
 * cancels it remotely instead of leaving a paid render running upstream,
 * and the result is written atomically (`<output>.tmp`, then renamed).
 * There is no faststart remux here (unlike `seedance-video.mjs`): this MP4
 * is an intermediate that ffmpeg reads whole, and the loop exports are
 * what a browser ever plays.
 *
 * `--json` prints exactly one object:
 *   { path, url, file_size, target_fps, upscale_factor, model }
 * `model` is fal's own spelling, as sent. Progress and warnings go to
 * stderr; exit 1 on failure, 130 on interrupt.
 *
 * Environment: FAL_KEY, from the environment or a `.env` discovered by
 * `fal-queue.mjs::loadFalKey`. Never printed, never an argv.
 */

import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DOWNLOAD_ATTEMPTS, downloadFalFile, loadFalKey, runFalJob, uploadFalFile } from "./fal-queue.mjs";

export const TOPAZ_URL = "https://fal.run/fal-ai/topaz/upscale/video";

/** Short alias → the exact string fal's `model` enum accepts. */
export const MODEL_ALIASES = {
  proteus: "Proteus",
  "gaia-2": "Gaia 2",
};

export const DEFAULT_MODEL = "proteus";
export const DEFAULT_TARGET_FPS = 60;
/** No resize by default: a loop is retimed, not enlarged. */
export const DEFAULT_UPSCALE = 1;

/** This script's own range; fal documents output up to 120 fps. */
export const TARGET_FPS_MIN = 16;
export const TARGET_FPS_MAX = 60;
/** fal: "Supports up to 8x upscaling". */
export const MAX_UPSCALE = 8;

/**
 * The exact request Topaz is sent, or a thrown refusal naming the flag at
 * fault. Everything checkable is checked here, and checked BEFORE the clip
 * is uploaded: a paid 422 teaches nothing that this can say for free, and
 * a typo should not cost a transfer either.
 *
 * Async because a local clip has to reach fal storage first; `upload` is
 * injected so the builder runs without the network.
 */
export async function buildInterpolateRequest(
  {
    input,
    output,
    targetFps = DEFAULT_TARGET_FPS,
    upscale = DEFAULT_UPSCALE,
    model = DEFAULT_MODEL,
    apiKey,
    signal,
  } = {},
  { upload = uploadFalFile, onNote = (message) => console.error(message) } = {},
) {
  if (typeof input !== "string" || !input.trim()) throw new Error("--input is required");
  if (typeof output !== "string" || !output.trim()) throw new Error("--output is required");
  // `H264_output: true` makes this an H.264 MP4; a path called .webm or
  // .mov would be a lie on disk, and ffmpeg downstream trusts the name.
  if (extname(output).toLowerCase() !== ".mp4") throw new Error(`--output must be a .mp4 path (got: ${output})`);

  const falModel = MODEL_ALIASES[model];
  if (!falModel) throw new Error(`--model must be one of: ${Object.keys(MODEL_ALIASES).join(", ")} (got: ${model})`);

  const fps = Number(targetFps);
  if (!Number.isInteger(fps) || fps < TARGET_FPS_MIN || fps > TARGET_FPS_MAX) {
    throw new Error(`--target-fps must be a whole number from ${TARGET_FPS_MIN} to ${TARGET_FPS_MAX} (got: ${targetFps})`);
  }

  const factor = Number(upscale);
  if (!Number.isFinite(factor) || factor <= 0 || factor > MAX_UPSCALE) {
    throw new Error(`--upscale must be a number greater than 0 and at most ${MAX_UPSCALE} (got: ${upscale})`);
  }

  if (/^data:/.test(input)) {
    throw new Error("--input must be a file path or an http(s) URL — this endpoint answers `Invalid URL: URL too long` to a data URI; a local clip is uploaded to fal storage instead");
  }
  const hosted = /^https?:/.test(input);
  if (!hosted && !existsSync(input)) throw new Error(`--input: file not found: ${input}`);

  return {
    url: TOPAZ_URL,
    model,
    body: {
      video_url: hosted ? input : await upload(input, { key: apiKey, label: "--input", signal, onNote }),
      model: falModel,
      upscale_factor: factor,
      target_fps: fps,
      H264_output: true,
    },
  };
}

/**
 * Run one Topaz job and write the retimed clip to `output`.
 *
 * The uploader, job runner and downloader are injected so the whole path
 * can be exercised without touching fal. The file appears atomically:
 * bytes go to `<output>.tmp` and only then take the real name.
 */
export async function interpolateVideo(options, { runJob = runFalJob, download = downloadFalFile, upload = uploadFalFile } = {}) {
  const { output, apiKey, signal, deadlineMs = 900_000 } = options;
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const { url, body } = await buildInterpolateRequest(options, { upload });

  const job = await runJob({
    url,
    body,
    key: apiKey,
    signal,
    label: "Topaz video upscale/interpolation",
    deadlineMs,
    onRetry: ({ attempt, attempts, delayMs, reason }) => {
      console.error(`WARN: ${String(reason).slice(0, 160)} — retrying in ${delayMs / 1000}s (attempt ${attempt} of ${attempts})`);
    },
  });

  // fal documents `video: File`; a list is unwrapped rather than lost,
  // because this runs after the render has been paid for.
  const video = job?.data?.video;
  const file = Array.isArray(video) ? video[0] : video;
  if (!file?.url) throw new Error(`response carried no video URL: ${JSON.stringify(job?.data ?? null).slice(0, 500)}`);

  let bytes;
  try {
    bytes = await download(file.url, { signal, attempts: DOWNLOAD_ATTEMPTS });
  } catch (error) {
    if (error?.name === "AbortError") throw error; // an interrupt stays an interrupt
    throw new Error(`clip download failed after ${DOWNLOAD_ATTEMPTS} attempts: ${error instanceof Error ? error.message : String(error)}`);
  }

  mkdirSync(dirname(output), { recursive: true });
  const staged = `${output}.tmp`;
  writeFileSync(staged, bytes);
  renameSync(staged, output);

  return {
    path: output,
    url: file.url,
    file_size: statSync(output).size,
    target_fps: body.target_fps,
    upscale_factor: body.upscale_factor,
    model: body.model,
  };
}

const HELP = `Usage: interpolate-video.mjs --input <clip> --output <path.mp4> [options]

  --input <path|url>     Source clip (required)
  --output <path.mp4>    Where the retimed clip is written (required)
  --target-fps <n>       ${TARGET_FPS_MIN}-${TARGET_FPS_MAX} (default: ${DEFAULT_TARGET_FPS})
  --upscale <n>          Resize factor, up to ${MAX_UPSCALE} (default: ${DEFAULT_UPSCALE} — retime only, unverified against fal)
  --model <alias>        ${Object.keys(MODEL_ALIASES).join(", ")} (default: ${DEFAULT_MODEL})
                         → ${Object.values(MODEL_ALIASES).join(", ")}
                         gaia-2 targets animation and bills at half price, at 2x
  --json                 Print one JSON object on stdout
  --deadline-s <n>       Give up on the job after this many seconds (default: 900)
  --help, -h             This text

Price: $0.01 per second of output up to 720p, $0.02 for 720p-1080p, doubled
for 60 fps output. Interpolate BEFORE matting — alpha does not survive a
codec without it. A local clip is uploaded to fal storage first (an http(s)
URL is used as given; a data URI is refused — this endpoint caps the length
of video_url). Requires FAL_KEY (environment or .env). Progress goes to
stderr; with --json, stdout carries exactly one object.`;

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      "target-fps": { type: "string", default: String(DEFAULT_TARGET_FPS) },
      upscale: { type: "string", default: String(DEFAULT_UPSCALE) },
      model: { type: "string", default: DEFAULT_MODEL },
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
  if (!values.input) throw new Error("--input is required");
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
    const result = await interpolateVideo({
      input: values.input,
      output: values.output,
      targetFps: values["target-fps"],
      upscale: values.upscale,
      model: values.model,
      apiKey,
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
