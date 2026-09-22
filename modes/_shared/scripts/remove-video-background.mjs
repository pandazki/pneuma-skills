#!/usr/bin/env node

/**
 * Video background removal (matting) — VEED or Bria on fal.ai.
 *
 * One clip in, one clip WITH AN ALPHA CHANNEL out. This is the paid
 * alternative to keying a chroma plate with ffmpeg: it works on footage
 * that was never shot on a plate, and on soft edges (hair, motion blur,
 * translucent clay) where a colorkey leaves a fringe. The clip it writes
 * is what `sprite-sheet.mjs loop --key alpha` decodes.
 *
 * Usage:
 *   node remove-video-background.mjs --input clip.mp4 --output clip.webm \
 *     --model veed|bria [--person] [--no-refine] [--deadline-s 600] [--json]
 *
 * Three endpoints, deliberately all three: they disagree about what
 * "transparent video" means, and which one wins depends on the plate the
 * clip was shot on, so the choice belongs to whoever compares two crops at
 * 1:1.
 *
 *   veed → https://fal.run/veed/video-background-removal
 *     { video_url, output_codec: "vp9", refine_foreground_edges, subject_is_person }
 *     Answers `video: [File, …]` — a LIST (one entry for vp9; the h264
 *     option, not used here, returns an rgb/alpha pair). VP9 with alpha in
 *     a WebM, so `--output` must end `.webm`.
 *     $0.0225 per 30 frames with edge refinement, $0.015 without.
 *     Source: https://fal.ai/models/veed/video-background-removal
 *     MEASURED 2026-09-22 on a 640² 24 fps 121-frame clip: ≈ $0.09,
 *     17.1 s of inference, 22.6 s wall. The entry's `content_type` came
 *     back as "application/octet-stream", NOT "video/webm" — do not
 *     validate on it. The bytes are a VP9 WebM with `ALPHA_MODE=1`, which
 *     needs `ffmpeg -c:v libvpx-vp9 -i …`: the native `vp9` decoder drops
 *     the alpha plane silently.
 *
 *   bria → https://fal.run/bria/video/background-removal
 *     { video_url, background_color: "Transparent",
 *       output_container_and_codec: "mov_proresks", preserve_audio: false }
 *     Answers `video: File` — a SINGLE file. ProRes with alpha in a MOV,
 *     so `--output` must end `.mov` (and the file is large: ProRes 4444 is
 *     an intermediate codec, not a delivery one).
 *     $0.14 per second of video. Not yet run for real from this script.
 *     Source: https://fal.ai/models/bria/video/background-removal/api
 *
 * Bria documents its input limits — "Size should be less than 4000x4000
 * and duration less than 30s" — so a clip past them is measured with
 * ffprobe and refused HERE. A paid 422 teaches nothing this cannot say for
 * free. VEED documents no such ceiling, so it is not probed. When ffprobe
 * is missing, or the input is already a URL, the limits cannot be measured
 * locally and a note says so rather than the check pretending to have run.
 *
 * `subject_is_person` is sent explicitly and defaults to FALSE, which is
 * the opposite of fal's default: what this pipeline mattes is a 3D icon or
 * a stylized character, not a photographed person. `--person` puts it back.
 *
 *   veed-gs → https://fal.run/veed/video-background-removal/green-screen
 *     { video_url, output_codec: "vp9", spill_suppression_strength }
 *     Answers `video: [File, …]`, the same list shape as `veed`, and the
 *     same VP9-with-alpha WebM, so `--output` must end `.webm`.
 *     $0.015 per 30 frames — there is no edge-refinement tier to pay for.
 *     Source: https://fal.ai/models/veed/video-background-removal/green-screen
 *     MEASURED 2026-09-22 on the same 640² 24 fps 121-frame trial clip:
 *     617 KB of VP9 with `ALPHA_MODE=1`, 18.7 s of inference, 30 s wall,
 *     ≈ $0.06 — zero green pixels left, and a SOFTER edge than plain
 *     `veed` on the same frame (8535 partial-alpha pixels against 6198).
 *     It knows the plate is chroma green, so it has no subject hint and no
 *     refinement switch: `--person` and `--no-refine` are refused here,
 *     and `--spill` (its only knob) is refused on the other two.
 *
 * **Pick by the plate.** A clip shot on flat chroma green — which is what
 * this pipeline's own loop clips are — goes to `veed-gs`. Any other plate
 * goes to `veed`, which cuts on the silhouette rather than on a colour.
 * `bria` is the alternative to reach for when VEED's edge fails a subject.
 *
 * A local clip is UPLOADED to fal storage (`fal-queue.mjs::uploadFalFile`)
 * and the hosted URL is what travels in `video_url`. It is never inlined:
 * both video endpoints validate that field as a URL and reject anything
 * past 2083 characters (measured 2026-09-22 — VEED 422 `url_too_long`),
 * which every real clip is. An `http(s)` input passes through untouched;
 * a `data:` URI is refused here rather than at fal.
 *
 * The job goes through fal's queue (`fal-queue.mjs`), so an interrupt
 * cancels it remotely instead of leaving a paid render running upstream,
 * and the result is written atomically (`<output>.tmp`, then renamed) — a
 * watcher never sees a half-written clip.
 *
 * `--json` prints exactly one object:
 *   { path, url, file_size, model, endpoint, alpha: true }
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

/**
 * The two matting endpoints, each with the container its alpha output can
 * actually live in. The extension is not cosmetic: VP9-with-alpha in a
 * `.mov`, or ProRes in a `.webm`, is a file nothing downstream can open.
 */
export const MATTE_MODELS = {
  veed: {
    url: "https://fal.run/veed/video-background-removal",
    extension: ".webm",
    label: "VEED video background removal",
    /** fal's schema: `video` is `list<File>`. */
    resultIsList: true,
  },
  "veed-gs": {
    url: "https://fal.run/veed/video-background-removal/green-screen",
    extension: ".webm",
    label: "VEED green-screen background removal",
    /** Same `list<File>` shape as its sibling. */
    resultIsList: true,
  },
  bria: {
    url: "https://fal.run/bria/video/background-removal",
    extension: ".mov",
    label: "Bria video background removal",
    /** fal's schema: `video` is a single `Video | File`. */
    resultIsList: false,
  },
};

export const DEFAULT_MATTE_MODEL = "veed";

/**
 * `spill_suppression_strength` for `veed-gs` when `--spill` is not given.
 * fal's own default for the field; the trial ran at it and left no green.
 */
export const DEFAULT_SPILL_SUPPRESSION = 0.8;

/** Bria's documented input ceiling: "duration less than 30s". */
export const BRIA_MAX_DURATION_S = 30;
/** Bria's documented input ceiling: "Size should be less than 4000x4000". */
export const BRIA_MAX_DIMENSION = 4000;

/**
 * Pixel dimensions and duration of a local clip, or null when ffprobe is
 * not on PATH or cannot read the file. Null means "not measured" — never
 * "within the limits".
 */
export function probeVideoFile(path) {
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
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  return { width: number(fields.width), height: number(fields.height), duration: number(fields.duration) };
}

/**
 * The exact request the chosen endpoint is sent, or a thrown refusal
 * naming the flag at fault. Everything checkable is checked here — the
 * container the model can write, the flags the other model does not have,
 * and (for Bria) the documented size and duration limits — and checked
 * BEFORE the clip is uploaded, so a typo never costs a transfer.
 *
 * Async because a local clip has to reach fal storage first. `probe` and
 * `upload` are injected so the whole builder runs without ffprobe and
 * without the network.
 */
export async function buildRemoveVideoBackgroundRequest(
  { input, output, model = DEFAULT_MATTE_MODEL, person = false, refine = true, spill, apiKey, signal } = {},
  { probe = probeVideoFile, upload = uploadFalFile, onNote = (message) => console.error(message) } = {},
) {
  if (typeof input !== "string" || !input.trim()) throw new Error("--input is required");
  if (typeof output !== "string" || !output.trim()) throw new Error("--output is required");

  const endpoint = MATTE_MODELS[model];
  if (!endpoint) throw new Error(`--model must be one of: ${Object.keys(MATTE_MODELS).join(", ")} (got: ${model})`);
  if (extname(output).toLowerCase() !== endpoint.extension) {
    throw new Error(`--output must be a ${endpoint.extension} path for --model ${model} (got: ${output})`);
  }

  // A flag that quietly does nothing is worse than a refused run: it makes
  // the report of what was asked for untrue. The green-screen endpoint is
  // told the plate up front, so it has neither a subject hint nor an
  // edge-refinement tier; `--spill` is the knob only it has.
  if (model !== "veed") {
    if (person) throw new Error(`--person applies to --model veed only (--model ${model} has no subject hint)`);
    if (refine === false) throw new Error(`--no-refine applies to --model veed only (--model ${model} has no edge-refinement switch)`);
  }
  if (model !== "veed-gs" && spill !== undefined) {
    throw new Error(`--spill applies to --model veed-gs only (--model ${model} does not suppress plate spill — it is not told there is a plate)`);
  }
  // Only the shape is this script's business: the range belongs to fal, and
  // refusing a value fal would have accepted is the same kind of lie as
  // sending one it will not.
  const spillStrength = spill === undefined ? DEFAULT_SPILL_SUPPRESSION : Number(spill);
  if (!Number.isFinite(spillStrength) || spillStrength < 0) {
    throw new Error(`--spill must be a number >= 0 (got: ${spill})`);
  }

  if (/^data:/.test(input)) {
    throw new Error("--input must be a file path or an http(s) URL — this endpoint rejects a data URI as `url_too_long` (2083 characters); a local clip is uploaded to fal storage instead");
  }
  const hosted = /^https?:/.test(input);
  if (!hosted && !existsSync(input)) throw new Error(`--input: file not found: ${input}`);

  if (model === "bria") assertWithinBriaLimits({ input, hosted, probe, onNote });

  const video_url = hosted ? input : await upload(input, { key: apiKey, label: "--input", signal, onNote });
  const body = model === "veed"
    ? {
        video_url,
        output_codec: "vp9",
        refine_foreground_edges: refine !== false,
        subject_is_person: person === true,
      }
    : model === "veed-gs"
      ? {
          video_url,
          output_codec: "vp9",
          spill_suppression_strength: spillStrength,
        }
      : {
          video_url,
          background_color: "Transparent",
          output_container_and_codec: "mov_proresks",
          preserve_audio: false,
        };

  return { url: endpoint.url, model, body };
}

/** Bria's documented limits, measured before the paid call rather than after. */
function assertWithinBriaLimits({ input, hosted, probe, onNote }) {
  if (hosted) {
    onNote(`NOTE: --input is a URL, so Bria's limits (< ${BRIA_MAX_DURATION_S}s, < ${BRIA_MAX_DIMENSION}x${BRIA_MAX_DIMENSION}) were not measured here — fal enforces them`);
    return;
  }
  const probed = probe(input);
  if (!probed) {
    onNote(`NOTE: ffprobe could not measure ${input}, so Bria's limits (< ${BRIA_MAX_DURATION_S}s, < ${BRIA_MAX_DIMENSION}x${BRIA_MAX_DIMENSION}) were not checked here — fal enforces them`);
    return;
  }
  const { width, height, duration } = probed;
  if (duration !== null && duration > BRIA_MAX_DURATION_S) {
    throw new Error(`--input is ${duration.toFixed(1)}s — Bria takes clips shorter than ${BRIA_MAX_DURATION_S}s. Trim it, or use --model veed.`);
  }
  if ((width !== null && width > BRIA_MAX_DIMENSION) || (height !== null && height > BRIA_MAX_DIMENSION)) {
    throw new Error(`--input is ${width}x${height} — Bria takes videos smaller than ${BRIA_MAX_DIMENSION}x${BRIA_MAX_DIMENSION}. Scale it down, or use --model veed.`);
  }
}

/**
 * The matted clip inside a finished job, per each endpoint's documented
 * shape: VEED answers `video: [File, …]`, Bria answers `video: File`.
 *
 * The other shape is accepted with a warning instead of being thrown away.
 * This code runs AFTER the render is paid for, so losing the file to a
 * schema change costs real money, while a wrong guess here is one loud
 * line on stderr.
 */
export function mattedFile(data, model, { onNote = (message) => console.error(message) } = {}) {
  const video = data?.video;
  const isList = Array.isArray(video);
  const asList = isList ? video[0] : null;
  const asSingle = isList ? null : video;
  const wantsList = MATTE_MODELS[model]?.resultIsList === true;

  const documented = wantsList ? asList : asSingle;
  if (documented?.url) return documented;

  const other = wantsList ? asSingle : asList;
  if (other?.url) {
    onNote(`WARN: ${model} answered \`video: ${isList ? "[File, …]" : "File"}\` where its schema documents \`video: ${wantsList ? "[File, …]" : "File"}\` — using it anyway`);
    return other;
  }
  return null;
}

/**
 * Run one matting job and write the transparent clip to `output`.
 *
 * The uploader, job runner and downloader are injected so the whole path
 * can be exercised without touching fal. The file appears atomically:
 * bytes go to `<output>.tmp` and only then take the real name.
 */
export async function removeVideoBackground(
  options,
  { runJob = runFalJob, download = downloadFalFile, upload = uploadFalFile, probe = probeVideoFile } = {},
) {
  const { output, apiKey, signal, deadlineMs = 600_000 } = options;
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const { url, model, body } = await buildRemoveVideoBackgroundRequest(options, { probe, upload });

  const job = await runJob({
    url,
    body,
    key: apiKey,
    signal,
    label: MATTE_MODELS[model].label,
    deadlineMs,
    onRetry: ({ attempt, attempts, delayMs, reason }) => {
      console.error(`WARN: ${String(reason).slice(0, 160)} — retrying in ${delayMs / 1000}s (attempt ${attempt} of ${attempts})`);
    },
  });

  const file = mattedFile(job?.data, model);
  if (!file?.url) throw new Error(`response carried no video URL: ${JSON.stringify(job?.data ?? null).slice(0, 500)}`);

  // The matte is paid for and finished upstream; a failure from here on is
  // the download's own, and says which phase lost it.
  let bytes;
  try {
    bytes = await download(file.url, { signal, attempts: DOWNLOAD_ATTEMPTS });
  } catch (error) {
    if (error?.name === "AbortError") throw error; // an interrupt stays an interrupt
    throw new Error(`matte download failed after ${DOWNLOAD_ATTEMPTS} attempts: ${error instanceof Error ? error.message : String(error)}`);
  }

  mkdirSync(dirname(output), { recursive: true });
  const staged = `${output}.tmp`;
  writeFileSync(staged, bytes);
  renameSync(staged, output);

  return {
    path: output,
    url: file.url,
    file_size: statSync(output).size,
    model,
    endpoint: url,
    // Both endpoints are configured for a real alpha channel here (VP9
    // with alpha / ProRes with a Transparent background), which is what
    // `sprite-sheet.mjs loop --key alpha` relies on.
    alpha: true,
  };
}

const HELP = `Usage: remove-video-background.mjs --input <clip> --output <path> --model <name> [options]

  --input <path|url>     Source clip (required)
  --output <path>        Where the transparent clip is written (required)
                         .webm for --model veed, .mov for --model bria
  --model <name>         ${Object.keys(MATTE_MODELS).join(", ")} (default: ${DEFAULT_MATTE_MODEL})
                         veed: VP9+alpha WebM, $0.0225 / 30 frames refined ($0.015 without)
                         veed-gs: VP9+alpha WebM, $0.015 / 30 frames — for a clip
                                  shot on flat chroma green; softest edge measured
                         bria: ProRes+alpha MOV, $0.14 / second; input < ${BRIA_MAX_DURATION_S}s and < ${BRIA_MAX_DIMENSION}x${BRIA_MAX_DIMENSION}
  --person               The subject is a person (veed only; default: not a person)
  --no-refine            Skip edge refinement (veed only; cheaper, softer edges)
  --spill <n>            Plate spill suppression (veed-gs only; default: ${DEFAULT_SPILL_SUPPRESSION})
  --json                 Print one JSON object on stdout
  --deadline-s <n>       Give up on the job after this many seconds (default: 600)
  --help, -h             This text

A local clip is uploaded to fal storage first (an http(s) URL is used as
given; a data URI is refused — these endpoints cap video_url at 2083
characters). Bria's documented input limits are measured with ffprobe
before the paid call. Requires FAL_KEY (environment or .env). Progress goes
to stderr; with --json, stdout carries exactly one object.`;

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      model: { type: "string", default: DEFAULT_MATTE_MODEL },
      person: { type: "boolean", default: false },
      "no-refine": { type: "boolean", default: false },
      spill: { type: "string" },
      json: { type: "boolean", default: false },
      "deadline-s": { type: "string", default: "600" },
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
    const result = await removeVideoBackground({
      input: values.input,
      output: values.output,
      model: values.model,
      person: values.person,
      refine: !values["no-refine"],
      spill: values.spill,
      apiKey,
      signal: controller.signal,
      deadlineMs: Math.max(30, Number(values["deadline-s"]) || 600) * 1000,
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
