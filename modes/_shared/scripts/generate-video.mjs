#!/usr/bin/env node

/**
 * Shared Video Generator CLI (plotwise; MiniMax H3 Max on fal.ai)
 *
 * Plain argv CLI over the three H3 Max endpoints. H3 Max is served ONLY by
 * fal.ai — there is no vendor fallback, by design. The model generates
 * audio natively: narration written verbatim in the prompt (quoted speech
 * for a character, or explicit voiceover text) is spoken word-for-word and
 * lipsynced. Verify with transcribe.mjs (the QA gate callers are expected
 * to run).
 *
 *   text-to-video       prompt only.
 *   image-to-video      + first frame (--image), optional last frame
 *                       (--end-image) for first-to-last keyframe evolution.
 *                       Output aspect FOLLOWS the input image — crop the
 *                       image to control it; --aspect-ratio is refused here.
 *   reference-to-video  + subject/style anchors (--ref-image, --ref-video,
 *                       --ref-audio; each repeatable, ≤12 files total).
 *                       Refer to them in the prompt by modality and order:
 *                       "Image 1", "Video 1", "Audio 1". The reference
 *                       image outranks prompt wording for identity.
 *
 * The endpoint is inferred (--ref-* → reference, --image → image, else
 * text) and can be forced with --endpoint.
 *
 * Usage:
 *   node generate-video.mjs --prompt "..." --output nodes/n1/video.mp4 \
 *     [--endpoint text|image|reference] [--duration 5] [--resolution 480P] \
 *     [--aspect-ratio 16:9] [--image path-or-url] [--end-image path-or-url] \
 *     [--ref-image path-or-url]... [--ref-video ...]... [--ref-audio ...]... \
 *     [--seed N] [--expansion balanced|quality] [--json]
 *
 * Local file inputs are inlined as base64 data URIs (same pattern as
 * edit_image.mjs); anything over ~8 MB per file is refused before the paid
 * request rather than timing out inside it.
 *
 * --expansion: "balanced" (~1s, the interactive default) or "quality"
 * (up to ~30s of prompt rewriting — batch/keepsake renders only).
 *
 * Submission goes through fal's QUEUE (`queue.fal.run`), not the synchronous
 * endpoint: the job is accepted at once and polled to completion, so a render
 * that takes minutes never rides on one held-open socket. Transient failures
 * (a gateway 5xx, a 429, a dropped connection) get three bounded attempts
 * with a short back-off — no caller needs a shell loop around this script —
 * while a 4xx is the request's own fault and is reported at once. A job still
 * unfinished after 15 minutes is given up on. SIGTERM or SIGINT while the job
 * is in flight cancels it remotely (PUT `cancel_url`) and exits 130, so a
 * pruned branch stops costing money.
 *
 * Loudness: H3 Max's output loudness is wildly inconsistent — one batch
 * measured a 26 LU spread (-35.8 to -9.3 LUFS), so back-to-back segments
 * whisper and shout. Every downloaded clip is therefore normalized to
 * -16 LUFS (two-pass EBU R128 loudnorm; the video stream is copied
 * untouched). The same pass moves the MP4 index (`moov`) to the front of
 * the file: fal.ai's H3 output leaves it at the end, so a browser has to
 * request the head, abort, fetch the tail, then request the head again
 * before the first frame — every clip load and every seek paid that round
 * trip. Requires ffmpeg on PATH — skipped with a stderr warning
 * when absent or when the clip carries no audio. --no-normalize opts out.
 *
 * --json prints:
 *   { "path", "url", "file_size", "requested_duration", "seed"?,
 *     "inference_seconds"?, "expanded_prompt"?,
 *     "loudness"?: { "input_i", "normalized" } }
 * `seed` and backend timings are reported only when the endpoint returns
 * them (reference-to-video reports seed; pass --seed to make text/image
 * runs reproducible). `expanded_prompt` is the director's script the model
 * actually shot — callers should persist it in the segment's
 * generation.json for provenance and re-shoots.
 *
 * Environment:
 *   FAL_KEY — required. Read from the environment first, then from a
 *   `.env` discovered like every sibling shared script: the skill root
 *   (parent of scripts/), then walking up from cwd. Never printed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { runFalJob } from "./fal-queue.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ENDPOINTS = {
  text: {
    url: "https://fal.run/minimax/h3-max/text-to-video",
    aspects: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  },
  image: {
    url: "https://fal.run/minimax/h3-max/image-to-video",
    aspects: null, // output aspect follows the input image
  },
  reference: {
    url: "https://fal.run/minimax/h3-max/reference-to-video",
    aspects: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  },
};

const MAX_INLINE_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCE_FILES = 12;

// ---------------------------------------------------------------------------
// .env loading (same discovery as generate_image.mjs / generate-tts.mjs)
// ---------------------------------------------------------------------------

function findEnvFile() {
  const skillRoot = dirname(__dirname);
  const skillEnv = join(skillRoot, ".env");
  if (existsSync(skillEnv)) return skillEnv;

  let dir = process.cwd();
  while (true) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) return envPath;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const envPath = findEnvFile();
  if (!envPath) return null;
  const content = readFileSync(envPath, "utf-8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    if (line.slice(0, eqIdx).trim() !== "FAL_KEY") continue;
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Media inputs → URL (pass-through) or data URI (local file)
// ---------------------------------------------------------------------------

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
};

/** fal rejects a reference image whose aspect ratio is outside this range
 * (image_aspect_ratio_error, measured 2026-09-03 on a 2.78:1 three-panel
 * matplotlib figure). */
const REF_ASPECT_MIN = 0.4;
const REF_ASPECT_MAX = 2.5;

function imageSize(path) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  if (r.error || r.status !== 0) return null;
  const [w, h] = String(r.stdout).trim().split(",").map(Number);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * A reference image outside fal's aspect-ratio range is letterboxed onto
 * a white canvas just inside the range (a copy beside the original,
 * reused while the original is unchanged). The figure itself is not
 * rescaled, so what the model reproduces is still the figure.
 */
function fitReference(input) {
  if (/^(https?:|data:)/.test(input) || !existsSync(input)) return input;
  const size = imageSize(input);
  if (!size) return input;
  const ratio = size.w / size.h;
  if (ratio >= REF_ASPECT_MIN && ratio <= REF_ASPECT_MAX) return input;
  const target = ratio > REF_ASPECT_MAX ? REF_ASPECT_MAX - 0.1 : REF_ASPECT_MIN + 0.02;
  const w = ratio > REF_ASPECT_MAX ? size.w : Math.ceil(size.h * target);
  const h = ratio > REF_ASPECT_MAX ? Math.ceil(size.w / target) : size.h;
  const out = `${input}.fit.png`;
  try {
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(input).mtimeMs) return out;
  } catch { /* re-render */ }
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", input, "-vf", `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white`, out], { encoding: "utf-8" });
  if (r.error || r.status !== 0 || !existsSync(out)) {
    console.error(`WARN: could not pad ${input} (${size.w}x${size.h}, ratio ${ratio.toFixed(2)}) into fal's ${REF_ASPECT_MIN}-${REF_ASPECT_MAX} range — sent as is`);
    return input;
  }
  console.error(`NOTE: ${input} is ${ratio.toFixed(2)}:1 — letterboxed to ${w}x${h} for the reference`);
  return out;
}

function toMediaUrl(input, flagName) {
  if (/^(https?:|data:)/.test(input)) return input;
  if (!existsSync(input)) {
    fail(`${flagName}: file not found: ${input}`);
  }
  const size = statSync(input).size;
  if (size > MAX_INLINE_BYTES) {
    fail(
      `${flagName}: ${input} is ${(size / 1024 / 1024).toFixed(1)} MB — too large to inline as a data URI (limit ${MAX_INLINE_BYTES / 1024 / 1024} MB). Host it and pass a URL.`,
    );
  }
  const mime = MIME[extname(input).toLowerCase()];
  if (!mime) fail(`${flagName}: unsupported file extension: ${input}`);
  return `data:${mime};base64,${readFileSync(input).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const { values: args } = parseArgs({
  options: {
    prompt: { type: "string" },
    output: { type: "string" },
    endpoint: { type: "string" },
    duration: { type: "string", default: "5" },
    resolution: { type: "string", default: "480P" },
    "aspect-ratio": { type: "string" },
    image: { type: "string" },
    "end-image": { type: "string" },
    "ref-image": { type: "string", multiple: true },
    "ref-video": { type: "string", multiple: true },
    "ref-audio": { type: "string", multiple: true },
    seed: { type: "string" },
    expansion: { type: "string", default: "balanced" },
    "no-normalize": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    /** Give up on a fal job after this many seconds (queue wait included). */
    "deadline-s": { type: "string", default: "900" },
  },
});

if (!args.prompt) fail("--prompt is required");
if (!args.output) fail("--output is required");

const refImages = args["ref-image"] ?? [];
const refVideos = args["ref-video"] ?? [];
const refAudios = args["ref-audio"] ?? [];
const hasRefs = refImages.length + refVideos.length + refAudios.length > 0;

let endpointName = args.endpoint;
if (endpointName) {
  // Accept both short and full endpoint spellings.
  endpointName = endpointName.replace(/-to-video$/, "");
  if (!ENDPOINTS[endpointName]) {
    fail(`--endpoint must be text, image, or reference (got: ${args.endpoint})`);
  }
} else {
  endpointName = hasRefs ? "reference" : args.image ? "image" : "text";
}
const endpoint = ENDPOINTS[endpointName];

if (hasRefs && endpointName !== "reference") {
  fail(`--ref-* inputs require the reference endpoint (inferred/forced: ${endpointName})`);
}
if (args.image && endpointName === "text") {
  fail("--image requires the image endpoint (drop --endpoint text)");
}
if (endpointName === "reference" && refImages.length + refVideos.length === 0) {
  fail("reference endpoint needs at least one --ref-image or --ref-video (audio cannot be the only reference)");
}
if (refImages.length + refVideos.length + refAudios.length > MAX_REFERENCE_FILES) {
  fail(`at most ${MAX_REFERENCE_FILES} reference files in total`);
}

const duration = Number(args.duration);
if (!Number.isInteger(duration) || duration < 5 || duration > 15) {
  fail(`--duration must be an integer between 5 and 15 (got: ${args.duration})`);
}

const resolution = args.resolution.toUpperCase();
if (resolution !== "480P" && resolution !== "768P") {
  fail(`--resolution must be 480P or 768P (got: ${args.resolution})`);
}

if (args.expansion !== "balanced" && args.expansion !== "quality") {
  fail(`--expansion must be balanced or quality (got: ${args.expansion})`);
}

let aspectRatio = args["aspect-ratio"];
if (aspectRatio != null) {
  if (!endpoint.aspects) {
    fail("image-to-video output aspect follows the input image — crop the image instead of passing --aspect-ratio");
  }
  if (!endpoint.aspects.includes(aspectRatio)) {
    fail(`--aspect-ratio for ${endpointName} must be one of: ${endpoint.aspects.join(", ")}`);
  }
}

const body = {
  prompt: args.prompt,
  prompt_expansion_mode: args.expansion,
  duration,
  resolution,
};
if (aspectRatio) body.aspect_ratio = aspectRatio;
if (args.seed != null) {
  const seed = Number(args.seed);
  if (!Number.isInteger(seed)) fail(`--seed must be an integer (got: ${args.seed})`);
  body.seed = seed;
}
if (endpointName === "image") {
  if (args.image) body.image_url = toMediaUrl(args.image, "--image");
  if (args["end-image"]) body.end_image_url = toMediaUrl(args["end-image"], "--end-image");
}
if (endpointName === "reference") {
  if (refImages.length > 0)
    body.reference_image_urls = refImages.map((p) => toMediaUrl(fitReference(p), "--ref-image"));
  if (refVideos.length > 0)
    body.reference_video_urls = refVideos.map((p) => toMediaUrl(p, "--ref-video"));
  if (refAudios.length > 0)
    body.reference_audio_urls = refAudios.map((p) => toMediaUrl(p, "--ref-audio"));
}

const falKey = loadFalKey();
if (!falKey) {
  fail("No API key found. Set FAL_KEY in the environment or a .env file.");
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

// The bounded retries live HERE, in the script, so no caller has to
// improvise a shell loop around it: `runFalJob` gives a gateway 5xx, a 429
// or a dropped connection three attempts with a short back-off, and reports
// a 4xx at once. When the model's backend itself is down (fal's
// "downstream_service_unavailable", seen as a 504 on one endpoint while the
// others answered), the retries end quickly and the caller decides — the
// sampler falls back to another endpoint.
//
// Going through the queue is what makes interruption honest as well: an
// in-flight job is cancelled remotely before this process leaves, instead of
// being abandoned mid-render on someone else's meter.
const INTERRUPTS = ["SIGTERM", "SIGINT"];
const controller = new AbortController();
const interruptHandlers = new Map();
let interruptedBy = null;
for (const name of INTERRUPTS) {
  const handler = () => {
    // A second interrupt leaves at once: installing a handler disables
    // Node's default kill, and nobody should have to wait out the cancel.
    if (interruptedBy) process.exit(130);
    interruptedBy = name;
    controller.abort(new DOMException(`received ${name}`, "AbortError"));
  };
  interruptHandlers.set(name, handler);
  process.on(name, handler);
}

function exitInterrupted() {
  console.error(`ERROR: ${interruptedBy ?? "interrupted"} — the fal.ai job was cancelled`);
  process.exit(130);
}

let job;
try {
  job = await runFalJob({
    url: endpoint.url,
    body,
    key: falKey,
    signal: controller.signal,
    label: "H3 Max video generation",
    deadlineMs: Math.max(30, Number(args["deadline-s"]) || 900) * 1000,
    onRetry: ({ attempt, attempts: total, delayMs, reason }) => {
      console.error(
        `WARN: ${reason.slice(0, 160)} — retrying in ${delayMs / 1000}s (attempt ${attempt} of ${total})`,
      );
    },
  });
} catch (e) {
  if (e?.name === "AbortError") exitInterrupted();
  fail(e?.message ?? String(e));
}

const attempts = job.attempts;
const result = job.data;
const videoUrl = result?.video?.url;
if (!videoUrl) {
  fail(`response carried no video URL: ${JSON.stringify(result).slice(0, 500)}`);
}

/**
 * The clip comes from fal's CDN in one request. That request gets its
 * own clock and its own retries: a stalled connection once held three
 * shots for twenty-one minutes under no timeout at all, and a dropped
 * one ("terminated") failed the scene outright (2026-09-03). The clock
 * is an IDLE clock — a slow link that keeps delivering is allowed to
 * finish (the same CDN measured 6 KB/s that night, an 11 MB shot in
 * half an hour); only a stream that stops moving for a minute is given
 * up on.
 */
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_IDLE_MS = 60_000;
async function downloadClip(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    const idle = new AbortController();
    let idleTimer = null;
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idle.abort(), DOWNLOAD_IDLE_MS);
    };
    const started = Date.now();
    try {
      touch();
      const resp = await fetch(url, { signal: AbortSignal.any([controller.signal, idle.signal]) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const chunks = [];
      let received = 0;
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        touch();
      }
      const seconds = (Date.now() - started) / 1000;
      if (seconds > 30) console.error(`NOTE: clip downloaded in ${seconds.toFixed(0)}s (${(received / 1024 / 1024).toFixed(1)} MB, ${(received / 1024 / seconds).toFixed(0)} KB/s)`);
      return Buffer.concat(chunks);
    } catch (e) {
      if (controller.signal.aborted) throw e;
      lastError = idle.signal.aborted ? new Error(`no bytes for ${DOWNLOAD_IDLE_MS / 1000}s`) : e;
      if (attempt < DOWNLOAD_ATTEMPTS) {
        console.error(`WARN: downloading the clip failed (${lastError?.message ?? lastError}) — retrying (attempt ${attempt} of ${DOWNLOAD_ATTEMPTS})`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  }
  throw lastError ?? new Error("download failed");
}

let bytes;
try {
  bytes = await downloadClip(videoUrl);
} catch (e) {
  if (e?.name === "AbortError" && controller.signal.aborted) exitInterrupted();
  fail(`downloading the clip failed: ${e?.message ?? e}`);
}

// The bytes are in hand and the remote job is finished — nothing left to
// cancel, so an interrupt from here on goes back to being the shell's.
for (const [name, handler] of interruptHandlers) process.off(name, handler);

mkdirSync(dirname(args.output), { recursive: true });
writeFileSync(args.output, bytes);

// ---------------------------------------------------------------------------
// Loudness normalization (see the header note)
// ---------------------------------------------------------------------------

const TARGET_LUFS = -16;

function normalizeLoudness(path) {
  const measure = spawnSync(
    "ffmpeg",
    ["-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  if (measure.error) {
    console.error("WARN: ffmpeg not found — clip loudness left as generated");
    return null;
  }
  const match = (measure.stderr ?? "").match(/\{[^{}]*"input_i"[^{}]*\}/s);
  if (!match) {
    console.error("WARN: loudness measurement failed (no audio track?) — clip left as generated");
    return null;
  }
  const m = JSON.parse(match[0]);
  const inputI = Number(m.input_i);
  const withinTolerance = !Number.isFinite(inputI) || Math.abs(inputI - TARGET_LUFS) < 1.5;
  // Every clip leaves with ONE audio format — AAC, 48 kHz, stereo —
  // whether or not its loudness needed correcting. loudnorm resamples on
  // its way through (a corrected clip came out at 96 kHz beside untouched
  // 32 kHz ones), and a scene concatenated from shots of mixed sample
  // rates played with a wrong duration (47 s of shots → a 141 s file,
  // 2026-09-03). The video stream is still copied; the file also gets its
  // front-loaded index here.
  const AUDIO_OUT = ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"];
  const audioArgs = withinTolerance
    ? AUDIO_OUT
    : [
        "-af",
        `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
        ...AUDIO_OUT,
      ];
  const tmp = `${path}.norm.mp4`;
  const apply = spawnSync(
    "ffmpeg",
    ["-y", "-i", path, ...audioArgs, "-c:v", "copy", "-movflags", "+faststart", tmp],
    { encoding: "utf-8" },
  );
  if (apply.status !== 0 || !existsSync(tmp)) {
    console.error("WARN: loudness normalization pass failed — clip left as generated");
    try { unlinkSync(tmp); } catch { /* not created */ }
    return { input_i: inputI, normalized: false };
  }
  renameSync(tmp, path);
  return { input_i: inputI, normalized: !withinTolerance };
}

const loudness = args["no-normalize"] ? null : normalizeLoudness(args.output);

if (args.json) {
  const out = {
    path: args.output,
    url: videoUrl,
    file_size: bytes.length,
    requested_duration: duration,
    attempts,
  };
  if (result.seed != null) out.seed = result.seed;
  if (typeof job.inferenceSeconds === "number") {
    out.inference_seconds = job.inferenceSeconds;
  }
  if (result.expanded_prompt) out.expanded_prompt = result.expanded_prompt;
  if (loudness) out.loudness = loudness;
  console.log(JSON.stringify(out));
} else {
  console.log(args.output);
}
