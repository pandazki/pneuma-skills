#!/usr/bin/env node

/**
 * Frame interpolation (and optional upscaling) — Topaz Video AI or RIFE on
 * fal.ai.
 *
 * One clip in, one clip at a higher frame rate out. A 24 fps loop retimed
 * to 60 fps stops stepping in a UI. There are three ways to get there and
 * the user picks one; two of them are here, and the third is free:
 * `sprite-sheet.mjs loop --fps 60` does it with ffmpeg's `minterpolate`
 * (block motion compensation, loop-wrapped) at no cost. Both endpoints here
 * invent the in-between frames with a model instead.
 *
 * Interpolation runs BEFORE matting: an alpha channel does not survive a
 * codec that has none, and the in-betweens should be invented from the
 * plate, not from a half-transparent edge.
 *
 * Usage:
 *   node interpolate-video.mjs --input clip.mp4 --output clip-60.mp4 \
 *     [--model proteus|gaia-2|rife] \
 *     [--target-fps 60] [--upscale 1]              # Topaz only
 *     [--between 1] [--loop] [--scene-detect] [--fps N]   # RIFE only
 *     [--deadline-s 900] [--json]
 *
 * The two endpoints do not mean the same thing by a frame rate, which is
 * why their flags are exclusive and each is refused on the other:
 *
 *   topaz (`--model proteus` | `gaia-2`, the default)
 *     https://fal.run/fal-ai/topaz/upscale/video
 *     { video_url, model, upscale_factor, target_fps, H264_output: true }
 *     Answers `video: File`. It is TOLD the rate it must hit, so it can put
 *     a clip at exactly 60 fps. `H264_output: true` is sent because the
 *     default is H265, which ffmpeg builds and browsers handle less
 *     uniformly; the container is MP4 either way, so `--output` must end
 *     `.mp4`. Sharpest in-betweens measured, and the most expensive.
 *     It interpolates the clip AS A CLIP: the one pair a loop cares about
 *     most — the last frame against the first — is the pair it never sees.
 *
 *   rife (`--model rife`)
 *     https://fal.run/fal-ai/rife/video
 *     { video_url, num_frames, use_scene_detection, use_calculated_fps,
 *       loop, fps? }
 *     Answers `video: File` — a single object, the same shape as Topaz.
 *     It MULTIPLIES the rate: `num_frames: 1` turns 24 fps into 48, `2`
 *     into 72, so there is no target rate to name and `--target-fps` is
 *     refused. $0.0013 per compute second.
 *     `loop: true` is documented by fal as "the final frame will be looped
 *     back to the first frame to create a seamless loop" — RIFE
 *     interpolates the WRAP, which is exactly the pair Topaz misses.
 *     MEASURED 2026-09-22 on the 640² 24 fps 121-frame trial clip with
 *     `{ num_frames: 1, use_scene_detection: false, use_calculated_fps:
 *     true, loop: true }`: out came 640² h264 **48 fps, 243 frames**,
 *     5.06 s, 570 KB; **21.0 s of inference but 231 s wall** on a cold
 *     queue, ≈ **$0.03**. Its silhouette profile: median step 0.0275 (half
 *     the 24 fps clip's 0.046, as expected) and a seam of **0.0107** —
 *     under half a step, so `loop: true` really does close the wrap, where
 *     Topaz's wrap came back at 6.5× its own step.
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
 * request. Two of Topaz's nineteen documented values are wired: `proteus`
 * (fal's own default, "fits most footage") and `gaia-2` ("animation and
 * motion graphics at 2x", and half price). The rest are denoise and
 * generative-restoration families this pipeline has no use for; they are
 * listed at the source URL above. `rife` names the other endpoint rather
 * than a Topaz model, because from a caller's side the question is one
 * question — who invents the in-between frames.
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
 * `--json` prints exactly one object, shaped by the endpoint that ran —
 * each reports what it was really given, and nothing it was not:
 *   topaz: { path, url, file_size, target_fps, upscale_factor, model }
 *           `model` is fal's own spelling, as sent ("Proteus").
 *   rife:  { path, url, file_size, model: "rife", between, loop, fps? }
 *           `fps` only when `--fps` pinned one.
 * Both also carry `cost`, an ESTIMATE at fal's list price — Topaz on the
 * seconds and frame size ffprobe reads off the retimed clip, RIFE on the
 * job's inference time (wall time as an upper bound when fal reports none)
 * — never an invoice. The same figure goes to stderr as one `cost:` line.
 * Progress and warnings go to stderr; exit 1 on failure, 130 on interrupt.
 *
 * Environment: FAL_KEY, from the environment or a `.env` discovered by
 * `fal-queue.mjs::loadFalKey`. Never printed, never an argv.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DOWNLOAD_ATTEMPTS, downloadFalFile, loadFalKey, runFalJob, uploadFalFile } from "./fal-queue.mjs";

export const TOPAZ_URL = "https://fal.run/fal-ai/topaz/upscale/video";
export const RIFE_URL = "https://fal.run/fal-ai/rife/video";

/** Topaz model alias → the exact string fal's `model` enum accepts. */
export const MODEL_ALIASES = {
  proteus: "Proteus",
  "gaia-2": "Gaia 2",
};

/**
 * Every `--model` value, and which ENDPOINT it names.
 *
 * Two families behind one flag, because from the caller's side the question
 * is one question — "who invents the in-between frames" — and the answer
 * decides the rest of the command line. They do not take the same arguments
 * and they do not even mean the same thing by a frame rate: Topaz is told
 * the rate it must hit (`target_fps`), while RIFE MULTIPLIES the rate it is
 * given (`num_frames: 1` turns 24 fps into 48, `2` into 72). So `--target-fps`
 * belongs to Topaz alone and `--between` to RIFE alone, and each is refused
 * on the other rather than silently ignored.
 */
export const INTERPOLATORS = {
  proteus: "topaz",
  "gaia-2": "topaz",
  rife: "rife",
};

export const DEFAULT_MODEL = "proteus";
export const DEFAULT_TARGET_FPS = 60;
/** No resize by default: a loop is retimed, not enlarged. */
export const DEFAULT_UPSCALE = 1;
/** RIFE's own default: one invented frame between each pair — 24 fps → 48. */
export const DEFAULT_BETWEEN = 1;

/** This script's own range; fal documents output up to 120 fps. */
export const TARGET_FPS_MIN = 16;
export const TARGET_FPS_MAX = 60;
/** fal: "Supports up to 8x upscaling". */
export const MAX_UPSCALE = 8;

/**
 * fal's list prices, as each endpoint's model page states them (read
 * 2026-09-28, the same figures the sprite skill's `video-preview.md`
 * quotes): Topaz bills per second of OUTPUT by its resolution — $0.01 up to
 * 720p, $0.02 from 720p to 1080p, $0.08 above — "doubles for 60fps output",
 * and "for Gaia 2 output costs half"; RIFE bills $0.0013 per compute second.
 * The resolution tier is read off the output's shorter side (720p is
 * 1280×720). Check again before quoting a user a total.
 */
export const INTERPOLATE_PRICES = Object.freeze({
  topaz: Object.freeze({
    tiers: Object.freeze([
      Object.freeze({ maxShortSide: 720, usd: 0.01, label: "≤ 720p" }),
      Object.freeze({ maxShortSide: 1080, usd: 0.02, label: "720p–1080p" }),
      Object.freeze({ maxShortSide: Infinity, usd: 0.08, label: "above 1080p" }),
    ]),
    per: "second of output",
    highFpsFactor: 2,
    gaia2Factor: 0.5,
    checked: "2026-09-28",
  }),
  rife: Object.freeze({ usd: 0.0013, per: "compute second", checked: "2026-09-28" }),
});

const roundTo = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** Width, height and seconds of a local clip, or null without ffprobe. */
export function measureClip(path) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
      "-of", "default=noprint_wrappers=1", path],
    { encoding: "utf-8" },
  );
  if (result.error || result.status !== 0) return null;
  const fields = {};
  for (const line of String(result.stdout).trim().split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  const positive = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  return { width: positive(fields.width), height: positive(fields.height), duration: positive(fields.duration) };
}

/**
 * What one Topaz job cost at fal's list price, from the clip that landed.
 * The page names 60 fps as the doubled rate and says nothing of 31–59, so a
 * rate in between is priced doubled and the estimate says it is an upper
 * bound. `usd` is null when the clip could not be measured.
 */
export function topazCost({ width, height, duration, targetFps, model } = {}) {
  const price = INTERPOLATE_PRICES.topaz;
  const gaia = model === "gaia-2" || model === "Gaia 2";
  const common = { estimate: true, unit: price.per, checked: price.checked };
  if (!(width > 0 && height > 0 && duration > 0)) {
    return { usd: null, ...common, basis: "unknown", note: "ffprobe could not read the retimed clip's size and length" };
  }
  const shortSide = Math.min(width, height);
  const tier = price.tiers.find((t) => shortSide <= t.maxShortSide);
  const fps = Number(targetFps);
  const fpsDoubled = fps > 30;
  const factor = (fpsDoubled ? price.highFpsFactor : 1) * (gaia ? price.gaia2Factor : 1);
  const notes = [];
  if (fpsDoubled && fps < 60) notes.push(`fal's page doubles the price at 60 fps and names no rate between; ${fps} fps is priced doubled, an upper bound`);
  return {
    usd: roundTo(duration * tier.usd * factor, 4),
    ...common,
    basis: "seconds-of-delivered-clip",
    seconds: roundTo(duration, 3),
    tier: tier.label,
    shortSide,
    unitPriceUsd: tier.usd,
    fpsDoubled,
    gaiaHalved: gaia,
    ...(notes.length ? { note: notes.join("; ") } : {}),
  };
}

/**
 * What one RIFE job cost: fal bills compute seconds, and the nearest number
 * the queue reports is the job's inference time. Without it, the wall time
 * from submit to result — queue wait included — bounds it from above.
 */
export function rifeCost({ inferenceSeconds, apiMs } = {}) {
  const price = INTERPOLATE_PRICES.rife;
  const common = { estimate: true, unitPriceUsd: price.usd, unit: price.per, checked: price.checked };
  const priced = (seconds, basis) => ({ usd: roundTo(seconds * price.usd, 6), ...common, basis, seconds: roundTo(seconds, 3) });
  if (Number.isFinite(inferenceSeconds) && inferenceSeconds >= 0) return priced(inferenceSeconds, "inference-time");
  if (Number.isFinite(apiMs) && apiMs >= 0) return priced(apiMs / 1000, "wall-time-upper-bound");
  return { usd: null, ...common, basis: "unknown", note: "fal reported no timing for the job" };
}

/** `$0.00001`, `$0.1000` — enough digits to be non-zero under a cent. */
function formatUsd(usd) {
  if (!Number.isFinite(usd)) return "unknown";
  return `$${usd < 0.01 ? usd.toFixed(5) : usd.toFixed(4)}`;
}

/** The one stderr line a `cost` object is said in. */
export function costLine(cost, family) {
  const read = `fal's list price, model page read ${cost?.checked ?? INTERPOLATE_PRICES[family]?.checked ?? "?"}`;
  if (family === "rife") {
    if (!cost || cost.usd === null) {
      return `cost: unknown (${cost?.note ?? "no measurement"}; fal lists ${formatUsd(INTERPOLATE_PRICES.rife.usd)} per compute second for RIFE)`;
    }
    const what = cost.basis === "inference-time"
      ? `${cost.seconds} s of inference`
      : `${cost.seconds} s wall time, queue included — an upper bound`;
    return `cost: ≈ ${formatUsd(cost.usd)} (estimate: ${what} × ${formatUsd(cost.unitPriceUsd)} per compute second, RIFE at ${read})`;
  }
  if (!cost || cost.usd === null) {
    return `cost: unknown (${cost?.note ?? "no measurement"}; fal lists Topaz at $0.01 per second of output up to 720p, $0.02 to 1080p, $0.08 above, doubled at 60 fps, half for Gaia 2)`;
  }
  const parts = [`${cost.seconds} s × ${formatUsd(cost.unitPriceUsd)} per second at ${cost.tier} (short side ${cost.shortSide} px)`];
  if (cost.fpsDoubled) parts.push("× 2 for 60 fps output");
  if (cost.gaiaHalved) parts.push("× 0.5 for Gaia 2");
  return `cost: ≈ ${formatUsd(cost.usd)} (estimate: ${parts.join(", ")}, Topaz at ${read}${cost.note ? `; ${cost.note}` : ""})`;
}

/** Flags that belong to exactly one endpoint, by the option name a caller
 *  types. A flag the chosen endpoint does not have is refused by name: one
 *  that travels as a no-op makes the report of what was asked for untrue. */
const TOPAZ_ONLY = [["--target-fps", "targetFps"], ["--upscale", "upscale"]];
const RIFE_ONLY = [
  ["--between", "between"],
  ["--loop", "loop"],
  ["--scene-detect", "sceneDetect"],
  ["--fps", "fps"],
];

/**
 * The exact request Topaz is sent, or a thrown refusal naming the flag at
 * fault. Everything checkable is checked here, and checked BEFORE the clip
 * is uploaded: a paid 422 teaches nothing that this can say for free, and
 * a typo should not cost a transfer either.
 *
 * Async because a local clip has to reach fal storage first; `upload` is
 * injected so the builder runs without the network.
 */
export async function buildInterpolateRequest(options = {}, { upload = uploadFalFile, onNote = (message) => console.error(message) } = {}) {
  const { input, output, model = DEFAULT_MODEL, apiKey, signal } = options;
  if (typeof input !== "string" || !input.trim()) throw new Error("--input is required");
  if (typeof output !== "string" || !output.trim()) throw new Error("--output is required");
  // Both endpoints write H.264 MP4 (`H264_output: true` for Topaz, MP4 by
  // construction for RIFE); a path called .webm or .mov would be a lie on
  // disk, and ffmpeg downstream trusts the name.
  if (extname(output).toLowerCase() !== ".mp4") throw new Error(`--output must be a .mp4 path (got: ${output})`);

  const family = INTERPOLATORS[model];
  if (!family) throw new Error(`--model must be one of: ${Object.keys(INTERPOLATORS).join(", ")} (got: ${model})`);

  // Every flag is checked against the endpoint that will receive it, and
  // checked BEFORE the clip is uploaded: a paid 422 teaches nothing this can
  // say for free, and a typo should not cost a transfer either.
  const wrongFlags = family === "topaz" ? RIFE_ONLY : TOPAZ_ONLY;
  const owner = family === "topaz" ? "rife" : Object.keys(MODEL_ALIASES).join(" / ");
  for (const [flag, key] of wrongFlags) {
    if (options[key] !== undefined) {
      throw new Error(`${flag} applies to --model ${owner} only (--model ${model} has no such parameter)`);
    }
  }

  // `model` is passed separately: it carries the DEFAULT, which `options`
  // does not, and a Topaz body built from a missing alias would send
  // `model: undefined` to a paid endpoint.
  const body = family === "topaz" ? topazBody(options, model) : rifeBody(options);

  if (/^data:/.test(input)) {
    throw new Error("--input must be a file path or an http(s) URL — this endpoint answers `Invalid URL: URL too long` to a data URI; a local clip is uploaded to fal storage instead");
  }
  const hosted = /^https?:/.test(input);
  if (!hosted && !existsSync(input)) throw new Error(`--input: file not found: ${input}`);

  const video_url = hosted ? input : await upload(input, { key: apiKey, label: "--input", signal, onNote });
  return {
    url: family === "topaz" ? TOPAZ_URL : RIFE_URL,
    model,
    family,
    body: { video_url, ...body },
  };
}

/** Topaz: told the rate it must hit, and optionally a resize factor. */
function topazBody({ targetFps = DEFAULT_TARGET_FPS, upscale = DEFAULT_UPSCALE }, model) {
  const fps = Number(targetFps);
  if (!Number.isInteger(fps) || fps < TARGET_FPS_MIN || fps > TARGET_FPS_MAX) {
    throw new Error(`--target-fps must be a whole number from ${TARGET_FPS_MIN} to ${TARGET_FPS_MAX} (got: ${targetFps})`);
  }
  const factor = Number(upscale);
  if (!Number.isFinite(factor) || factor <= 0 || factor > MAX_UPSCALE) {
    throw new Error(`--upscale must be a number greater than 0 and at most ${MAX_UPSCALE} (got: ${upscale})`);
  }
  return { model: MODEL_ALIASES[model], upscale_factor: factor, target_fps: fps, H264_output: true };
}

/**
 * RIFE: told how many frames to invent BETWEEN each pair, which multiplies
 * the rate rather than setting it. `use_calculated_fps` is how fal spells
 * "work the output rate out from the multiplier"; it is only turned off when
 * the caller pins `--fps`, and `fps` is sent only then — sending it beside
 * `use_calculated_fps: true` would be a number nothing reads.
 *
 * `loop: true` is the reason this endpoint is here at all: fal documents it
 * as "the final frame will be looped back to the first frame to create a
 * seamless loop", so RIFE interpolates the WRAP, which Topaz never sees.
 */
function rifeBody({ between = DEFAULT_BETWEEN, sceneDetect = false, loop = false, fps }) {
  const num = Number(between);
  if (!Number.isInteger(num) || num < 1) {
    throw new Error(`--between must be a whole number >= 1 (got: ${between})`);
  }
  const body = {
    num_frames: num,
    use_scene_detection: sceneDetect === true,
    use_calculated_fps: fps === undefined,
    loop: loop === true,
  };
  if (fps !== undefined) {
    const pinned = Number(fps);
    if (!Number.isInteger(pinned) || pinned < TARGET_FPS_MIN || pinned > TARGET_FPS_MAX) {
      throw new Error(`--fps must be a whole number from ${TARGET_FPS_MIN} to ${TARGET_FPS_MAX} (got: ${fps})`);
    }
    body.fps = pinned;
  }
  return body;
}

/**
 * Run one Topaz job and write the retimed clip to `output`.
 *
 * The uploader, job runner and downloader are injected so the whole path
 * can be exercised without touching fal. The file appears atomically:
 * bytes go to `<output>.tmp` and only then take the real name.
 */
export async function interpolateVideo(
  options,
  { runJob = runFalJob, download = downloadFalFile, upload = uploadFalFile, measure = measureClip } = {},
) {
  const { output, apiKey, signal, deadlineMs = 900_000 } = options;
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const { url, model, family, body } = await buildInterpolateRequest(options, { upload });

  const job = await runJob({
    url,
    body,
    key: apiKey,
    signal,
    label: family === "topaz" ? "Topaz video upscale/interpolation" : "RIFE frame interpolation",
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

  // The two families report what they were actually asked for. Topaz was
  // given a rate and a resize factor; RIFE was given a multiplier and a wrap
  // flag, and has no target rate at all unless one was pinned. Printing a
  // `target_fps` for a RIFE run would be a number nobody set.
  //
  // `cost` is additive: every earlier key is as it was.
  const common = { path: output, url: file.url, file_size: statSync(output).size };
  return family === "topaz"
    ? {
      ...common,
      target_fps: body.target_fps,
      upscale_factor: body.upscale_factor,
      model: body.model,
      cost: topazCost({ ...(measure(output) ?? {}), targetFps: body.target_fps, model }),
    }
    : {
      ...common,
      model,
      between: body.num_frames,
      loop: body.loop,
      ...(body.fps === undefined ? {} : { fps: body.fps }),
      cost: rifeCost({ inferenceSeconds: job?.inferenceSeconds ?? job?.data?.timings?.inference, apiMs: job?.apiMs }),
    };
}

const HELP = `Usage: interpolate-video.mjs --input <clip> --output <path.mp4> [options]

  --input <path|url>     Source clip (required)
  --output <path.mp4>    Where the retimed clip is written (required)
  --model <alias>        ${Object.keys(INTERPOLATORS).join(", ")} (default: ${DEFAULT_MODEL})
                         proteus / gaia-2 → Topaz (${Object.values(MODEL_ALIASES).join(" / ")});
                         gaia-2 targets animation and bills at half price, at 2x
                         rife → fal-ai/rife/video

  Topaz only:
  --target-fps <n>       ${TARGET_FPS_MIN}-${TARGET_FPS_MAX} (default: ${DEFAULT_TARGET_FPS})
  --upscale <n>          Resize factor, up to ${MAX_UPSCALE} (default: ${DEFAULT_UPSCALE} — retime only, accepted by fal)

  RIFE only (it MULTIPLIES the rate; there is no target to name):
  --between <n>          Frames invented between each pair (default: ${DEFAULT_BETWEEN} — 24 fps becomes 48)
  --loop                 Interpolate the WRAP too, so the last frame leads back into the first
  --scene-detect         Do not interpolate across a cut
  --fps <n>              Pin the output rate instead of calculating it

  --json                 Print one JSON object on stdout
  --deadline-s <n>       Give up on the job after this many seconds (default: 900)
  --help, -h             This text

Price: Topaz $0.01 per second of output up to 720p, $0.02 for 720p-1080p,
doubled for 60 fps output (≈ $0.10 for a 5 s clip at 60 fps). RIFE $0.0013
per compute second (≈ $0.03 for the same clip). Interpolate BEFORE matting —
alpha does not survive a codec without it. A local clip is uploaded to fal
storage first (an http(s) URL is used as given; a data URI is refused — both
endpoints cap the length of video_url). Requires FAL_KEY (environment or
.env). Progress goes to stderr; with --json, stdout carries exactly one
object. What the job cost — an estimate at fal's list price (model pages
read ${INTERPOLATE_PRICES.topaz.checked}): Topaz on the seconds and size of
the retimed clip, RIFE on its inference time — is printed on stderr as a
cost: line and returned as the object's cost.`;

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      // No `default:` on the per-endpoint flags: the builder has to be able
      // to tell "not given" from "given", or a default would trip the
      // other endpoint's refusal on every run. The defaults live in the
      // builder, where the endpoint is known.
      "target-fps": { type: "string" },
      upscale: { type: "string" },
      between: { type: "string" },
      loop: { type: "boolean" },
      "scene-detect": { type: "boolean" },
      fps: { type: "string" },
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
      between: values.between,
      loop: values.loop,
      sceneDetect: values["scene-detect"],
      fps: values.fps,
      model: values.model,
      apiKey,
      signal: controller.signal,
      deadlineMs: Math.max(30, Number(values["deadline-s"]) || 900) * 1000,
    });
    // The price first, on stderr: stdout stays one object (or one path).
    console.error(costLine(result.cost, INTERPOLATORS[values.model]));
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
