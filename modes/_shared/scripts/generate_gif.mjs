#!/usr/bin/env node

/**
 * Animated GIF from GPT Image 2.6 on fal.ai.
 *
 * OpenRouter's image API refuses `output_format: "gif"`, so this is the one
 * shared script that asks GPT Image for an animation. Two endpoints per
 * model, chosen by the inputs:
 *
 *   openai/gpt-image-2.6/<model>/text-to-image   prompt only;
 *   openai/gpt-image-2.6/<model>/edit            + reference images
 *                                                (`--image-urls`, up to 16,
 *                                                in the order given).
 *
 * `<model>` is `flare` (default) or `sunburst` (`--model sunburst`).
 *
 * Usage:
 *   node generate_gif.mjs "<prompt>" --output motions/idle/gif-raw.gif \
 *     [--image-urls refs/turnaround.png]... [--model flare|sunburst] \
 *     [--frame-count 9] [--frame-duration-ms 200] [--image-size 512x512] \
 *     [--quality medium] [--background auto|transparent|opaque] [--json]
 *
 * What is checked before the paid request is what fal's published schema
 * states (fal model page llms.txt + OpenAPI, read 2026-11-05):
 *   - frame_count 2–64, frame_duration_ms 20–2000 (fal rounds it to 10 ms);
 *   - image_size is PER FRAME: both sides multiples of 16, longest edge at
 *     most 3840, aspect at most 3:1, and every frame shares the request's
 *     pixel budget, so frames × width × height ≤ 8,294,400;
 *   - at most 16 reference images; quality auto|low|medium|high;
 *     background auto|transparent|opaque; a prompt of 1–32,000 characters.
 * The per-image minimum fal states (655,360 px) is not applied per frame:
 * 512×512 frames (262,144 px) were accepted in every measured request.
 *
 * The job goes through fal's queue (`fal-queue.mjs`): a submit that provably
 * never became a job is retried there, a job that ran and failed is NOT —
 * it may be billed, and the error names its request id so it can be
 * reconciled. Measured 2026-11-05: one GIF job failed with fal's
 * `downstream_service_error` and the identical request succeeded when sent
 * again; sending it again is the caller's decision, never this script's.
 *
 * The result is checked before it is called a success: the bytes must be a
 * GIF and must hold exactly the frames asked for (counted from the file's
 * own block structure, `readGifInfo`). A GIF with another frame count is
 * kept at `--output` for inspection and reported as a FAILURE; bytes that
 * are not a GIF are kept at `<output>.received`.
 *
 * `--output` is never replaced: an existing file is refused before the
 * request, and the result is placed with no-clobber semantics
 * (`fal-queue.mjs::writeNewFile`), so a run that took the name meanwhile
 * keeps its file and this result is kept beside it. Every failure after fal
 * accepted the job names the request id and, once there is one, the result
 * URL — the job may be billed, and the result can be fetched again from
 * there without resubmitting.
 *
 * `--json` prints exactly one object on stdout:
 *   { backend, model, endpoint, requestId, files, url, frameCount,
 *     frameDurationMs, durationMs, size, background?, cost }
 * `url` is fal's CDN copy of the GIF; `frameCount`, `frameDurationMs`,
 * `durationMs` and `size` are read back out of the file, not echoed from
 * the request; `background` is present only when it was asked for. fal bills GPT Image 2.6 by tokens and returns no usage,
 * so `cost.usd` is null and stderr carries `cost: unknown (…)` with fal's
 * per-token list price — a number is never invented.
 *
 * Environment: FAL_KEY, from the environment or a `.env` discovered by
 * `fal-queue.mjs::loadFalKey`. Never printed, never an argv.
 */

import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { downloadFalFile, falMediaUrl, loadFalKey, runFalJob, writeNewFile } from "./fal-queue.mjs";

export const GIF_MODELS = ["flare", "sunburst"];
export const DEFAULT_GIF_MODEL = "flare";
export const GIF_QUALITIES = ["auto", "low", "medium", "high"];
export const GIF_BACKGROUNDS = ["auto", "transparent", "opaque"];

/** fal's published GIF limits, read 2026-11-05. */
export const GIF_LIMITS = Object.freeze({
  minFrames: 2,
  maxFrames: 64,
  minFrameDurationMs: 20,
  maxFrameDurationMs: 2000,
  sizeMultiple: 16,
  maxEdge: 3840,
  maxAspect: 3,
  /** Every frame of the request shares this many pixels. */
  pixelBudget: 8_294_400,
  maxReferences: 16,
  maxPromptLength: 32_000,
});

/**
 * The waits between attempts to download a finished GIF: six attempts over
 * 90 s. A GIF is under ~1.3 MB and downloading it again is free, while the
 * job behind it may already be billed. Measured on the sticker trials of
 * 2026-11-07: every real run saw `fetch failed` on the first downloads
 * after the jobs finished; in trial B the CDN (v3b.fal.media) refused TLS
 * connections — curl too — from about 20 s to 42 s after submit, and four
 * finished GIFs spent the default three attempts (3 s + 6 s of waiting)
 * inside that gap, while the four that finished after it downloaded. The
 * failures were the host, not this process's parallel fetches.
 */
export const GIF_DOWNLOAD_RETRY_DELAYS_MS = Object.freeze([3000, 6000, 12000, 24000, 45000]);

export const DEFAULT_FRAME_COUNT = 9;
export const DEFAULT_FRAME_DURATION_MS = 200;
export const DEFAULT_GIF_SIZE = "512x512";
/** Every measured sprite GIF (2026-11-05) used medium; fal's own default is high. */
export const DEFAULT_GIF_QUALITY = "medium";

/**
 * fal's list price for GPT Image 2.6 (both models, both endpoints), per
 * million tokens, from the model pages (read 2026-11-05). fal's pricing API
 * answers "1 unit" for these endpoints, and the result carries no token
 * counts, so these prices cannot be turned into a figure for one request.
 */
export const GPT_IMAGE_26_FAL_PRICE = Object.freeze({
  imageOutputPer1M: 30,
  imageInputPer1M: 8,
  textInputPer1M: 5,
  checked: "2026-11-05",
});

/** The model id recorded for a fal model alias — the same id OpenRouter uses. */
export function gifModelId(model) {
  return `openai/gpt-image-2.6-${model}`;
}

/** `https://fal.run/openai/gpt-image-2.6/<model>/<text-to-image|edit>`. */
export function gifEndpoint(model, hasReferences) {
  return `https://fal.run/openai/gpt-image-2.6/${model}/${hasReferences ? "edit" : "text-to-image"}`;
}

function integerIn(value, low, high, flag) {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(n) || n < low || n > high) {
    throw new Error(`${flag} must be an integer from ${low} to ${high} (got: ${value})`);
  }
  return n;
}

/** `512x512` → `{ width: 512, height: 512 }`, checked against fal's frame rules. */
export function parseFrameSize(raw) {
  const m = /^([1-9]\d*)x([1-9]\d*)$/.exec(String(raw ?? "").trim().toLowerCase());
  if (!m) throw new Error(`--image-size must be WxH in pixels, per frame (got: ${raw})`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  const { sizeMultiple, maxEdge, maxAspect } = GIF_LIMITS;
  if (width % sizeMultiple || height % sizeMultiple) {
    throw new Error(`--image-size ${width}x${height}: both sides must be multiples of ${sizeMultiple}`);
  }
  if (Math.max(width, height) > maxEdge) throw new Error(`--image-size ${width}x${height}: the longest edge is at most ${maxEdge}`);
  if (Math.max(width, height) / Math.min(width, height) > maxAspect) {
    throw new Error(`--image-size ${width}x${height}: the aspect ratio is at most ${maxAspect}:1`);
  }
  return { width, height };
}

/**
 * The exact request fal is sent, or a thrown refusal naming the flag at
 * fault. Nothing here touches the network; local references are inlined as
 * data URIs (`falMediaUrl`), in the order given.
 */
export function buildGifRequest({
  prompt,
  output,
  model = DEFAULT_GIF_MODEL,
  imageUrls = [],
  frameCount = DEFAULT_FRAME_COUNT,
  frameDurationMs = DEFAULT_FRAME_DURATION_MS,
  imageSize = DEFAULT_GIF_SIZE,
  quality = DEFAULT_GIF_QUALITY,
  background,
} = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("A nonempty prompt is required (positional)");
  if (prompt.length > GIF_LIMITS.maxPromptLength) {
    throw new Error(`the prompt is ${prompt.length} characters; fal accepts at most ${GIF_LIMITS.maxPromptLength}`);
  }
  if (typeof output !== "string" || !output.trim()) throw new Error("--output is required");
  if (extname(output).toLowerCase() !== ".gif") throw new Error(`--output must be a .gif path (got: ${output})`);
  // A paid GIF never replaces a file — an earlier take may be the only copy
  // of something already paid for. Checked here, before any request, and
  // again when the result is placed (`writeNewFile`), for a run that took
  // the name meanwhile.
  if (existsSync(output)) throw new Error(`--output ${output} already exists — a generated GIF never replaces a file; choose a new path (gif-prompt prints a free one)`);
  if (!GIF_MODELS.includes(model)) throw new Error(`--model must be one of: ${GIF_MODELS.join(", ")} (got: ${model})`);
  if (!GIF_QUALITIES.includes(quality)) throw new Error(`--quality must be one of: ${GIF_QUALITIES.join(", ")} (got: ${quality})`);
  if (background !== undefined && background !== null && !GIF_BACKGROUNDS.includes(background)) {
    throw new Error(`--background must be one of: ${GIF_BACKGROUNDS.join(", ")} (got: ${background})`);
  }
  const frames = integerIn(frameCount, GIF_LIMITS.minFrames, GIF_LIMITS.maxFrames, "--frame-count");
  const duration = integerIn(frameDurationMs, GIF_LIMITS.minFrameDurationMs, GIF_LIMITS.maxFrameDurationMs, "--frame-duration-ms");
  const size = parseFrameSize(imageSize);
  const pixels = frames * size.width * size.height;
  if (pixels > GIF_LIMITS.pixelBudget) {
    const fit = Math.floor(GIF_LIMITS.pixelBudget / (size.width * size.height));
    throw new Error(`${frames} frames of ${size.width}x${size.height} are ${pixels.toLocaleString("en-US")} px — over fal's ${GIF_LIMITS.pixelBudget.toLocaleString("en-US")} px budget for one GIF; ${fit >= GIF_LIMITS.minFrames ? `at most ${fit} frames at this size, or ` : ""}smaller frames`);
  }
  const refs = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  if (refs.length > GIF_LIMITS.maxReferences) {
    throw new Error(`--image-urls: at most ${GIF_LIMITS.maxReferences} reference images (got ${refs.length})`);
  }

  const body = {
    prompt,
    output_format: "gif",
    frame_count: frames,
    frame_duration_ms: duration,
    image_size: size,
    quality,
  };
  // Omitted unless asked for, so fal's own default applies untouched.
  if (background) body.background = background;
  if (refs.length) body.image_urls = refs.map((ref, i) => falMediaUrl(ref, { label: `--image-urls #${i + 1}` }));

  return {
    url: gifEndpoint(model, refs.length > 0),
    model: gifModelId(model),
    body,
  };
}

/**
 * Frame count, delays and canvas of a GIF, read from its block structure —
 * the Graphic Control Extension before each image carries its delay, and
 * every Image Descriptor is one frame. No pixel is decoded, so this needs no
 * ffmpeg; it is a structural reading, and it refuses anything that is not a
 * complete GIF (a wrong signature, a truncated block, no trailer).
 *
 * Returns `{ width, height, frames, delaysMs }`.
 */
export function readGifInfo(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  const signature = b.length >= 6 ? b.toString("latin1", 0, 6) : "";
  if (signature !== "GIF89a" && signature !== "GIF87a") {
    throw new Error(`not a GIF (the file starts with ${JSON.stringify(b.subarray(0, 6).toString("latin1"))})`);
  }
  if (b.length < 13) throw new Error("truncated GIF: no logical screen descriptor");
  const width = b.readUInt16LE(6);
  const height = b.readUInt16LE(8);
  let p = 13;
  const screenFlags = b[10];
  if (screenFlags & 0x80) p += 3 * (1 << ((screenFlags & 7) + 1));

  const need = (n, what) => {
    if (p + n > b.length) throw new Error(`truncated GIF: ${what} runs past the end of the file`);
  };
  /** Skip a chain of data sub-blocks, ending on its zero terminator. */
  const skipSubBlocks = (what) => {
    for (;;) {
      need(1, what);
      const size = b[p];
      p += 1;
      if (size === 0) return;
      need(size, what);
      p += size;
    }
  };

  const delaysMs = [];
  let pendingDelay = null;
  for (;;) {
    need(1, "a block");
    const introducer = b[p];
    p += 1;
    if (introducer === 0x3b) break; // trailer
    if (introducer === 0x21) {
      need(1, "an extension");
      const label = b[p];
      p += 1;
      if (label === 0xf9) {
        need(6, "a graphic control extension");
        pendingDelay = b.readUInt16LE(p + 2) * 10;
        p += 1 + b[p];
        skipSubBlocks("a graphic control extension");
      } else {
        skipSubBlocks("an extension");
      }
      continue;
    }
    if (introducer === 0x2c) {
      need(9, "an image descriptor");
      const flags = b[p + 8];
      p += 9;
      if (flags & 0x80) {
        const table = 3 * (1 << ((flags & 7) + 1));
        need(table, "a local colour table");
        p += table;
      }
      need(1, "image data");
      p += 1; // LZW minimum code size
      skipSubBlocks("image data");
      delaysMs.push(pendingDelay ?? 0);
      pendingDelay = null;
      continue;
    }
    throw new Error(`malformed GIF: unexpected block 0x${introducer.toString(16).padStart(2, "0")} at byte ${p - 1}`);
  }
  if (!delaysMs.length) throw new Error("the GIF holds no frames");
  return { width, height, frames: delaysMs.length, delaysMs };
}

/** What one request is known to have cost: never a number fal did not report. */
export function gifCost() {
  return {
    usd: null,
    basis: "unknown",
    note: "fal bills GPT Image 2.6 by tokens and returns no token counts for a request",
    listPrice: { ...GPT_IMAGE_26_FAL_PRICE },
  };
}

/** The one stderr line a cost is said in. */
export function costLine(cost = gifCost()) {
  const p = cost.listPrice ?? GPT_IMAGE_26_FAL_PRICE;
  return `cost: unknown (${cost.note}; fal list price per 1M tokens: image output $${p.imageOutputPer1M}, image input $${p.imageInputPer1M}, text input $${p.textInputPer1M})`;
}

/** `fal request <id>` when the failure carries one — the id a billed job is reconciled by. */
function withRequest(message, requestId) {
  return requestId ? `${message} (fal request ${requestId})` : message;
}

/**
 * A failure after fal accepted the job: the job ran and may have been
 * billed, so the error carries what reconciles it — `requestId`, the
 * result's `url` when there is one, and `path` when bytes were kept — and
 * says not to send it again.
 */
function paidFailure(message, { requestId, url, path } = {}) {
  const where = !url ? "" : path ? `; the result is also at ${url}` : `; fetch it from ${url}`;
  const error = new Error(withRequest(`${message} — the job ran and may have been billed${where}; do not resubmit`, requestId));
  if (requestId) error.requestId = requestId;
  if (url) error.url = url;
  if (path) error.path = path;
  return error;
}

/**
 * Run one GIF job and write the animation to `output`.
 *
 * The job runner and downloader are injected so the whole path runs without
 * fal. One job, never more: a failure is thrown with its request id
 * (`error.requestId`) and nothing is sent again. A failure after the job
 * finished also carries the result URL (`error.url`) and, when bytes were
 * kept on disk, their path (`error.path`).
 */
export async function generateGif(options, { runJob = runFalJob, download = downloadFalFile } = {}) {
  const { output, apiKey, signal, deadlineMs = 600_000, onStatus } = options;
  const { url, model, body } = buildGifRequest(options);
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  let job;
  try {
    job = await runJob({
      url,
      body,
      key: apiKey,
      signal,
      deadlineMs,
      label: `GPT Image 2.6 GIF (${model})`,
      onStatus,
      onRetry: ({ attempt, attempts, delayMs, reason }) => {
        console.error(`WARN: ${String(reason).slice(0, 160)} — no job was created; submitting again in ${delayMs / 1000}s (attempt ${attempt} of ${attempts})`);
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const requestId = error?.requestId;
    const wrapped = new Error(withRequest(
      `${error instanceof Error ? error.message : String(error)}${requestId ? " — the job ran and failed; it was not sent again because it may have been billed" : ""}`,
      requestId,
    ));
    if (requestId) wrapped.requestId = requestId;
    throw wrapped;
  }
  const requestId = job?.requestId;

  const image = (job?.data?.images ?? [])[0];
  if (!image?.url) {
    throw paidFailure(`the result carried no GIF URL: ${JSON.stringify(job?.data ?? null).slice(0, 300)}`, { requestId });
  }
  const resultUrl = image.url;

  let bytes;
  try {
    bytes = Buffer.from(await download(resultUrl, { signal, retryDelaysMs: [...GIF_DOWNLOAD_RETRY_DELAYS_MS] }));
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) {
      // The job finished; only the download was interrupted.
      if (error && typeof error === "object") Object.assign(error, { requestId, url: resultUrl });
      throw error;
    }
    const tried = `${GIF_DOWNLOAD_RETRY_DELAYS_MS.length + 1} attempts over ${Math.round(GIF_DOWNLOAD_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) / 1000)} s`;
    throw paidFailure(`the GIF was generated but its download failed after ${tried} (${error instanceof Error ? error.message : String(error)})`, { requestId, url: resultUrl });
  }

  let info;
  try {
    info = readGifInfo(bytes);
  } catch (error) {
    // Whatever these bytes are, they are what was paid for: keep them, but
    // not at --output, which holds a GIF or nothing.
    let kept = null;
    try {
      kept = writeNewFile(`${output}.received`, bytes);
    } catch (keepError) {
      kept = keepError?.keptAt ?? null;
    }
    throw paidFailure(`the result is not a usable GIF — ${error.message}; ${kept ? `the bytes received are kept at ${kept}` : "the bytes received could not be kept"}`, { requestId, url: resultUrl, path: kept ?? undefined });
  }

  try {
    writeNewFile(output, bytes);
  } catch (error) {
    throw paidFailure(`the GIF was generated but not saved: ${error instanceof Error ? error.message : String(error)}`, { requestId, url: resultUrl, path: error?.keptAt });
  }

  if (info.frames !== body.frame_count) {
    throw paidFailure(`asked for ${body.frame_count} frames but the GIF holds ${info.frames} — kept at ${output} for inspection, not reported as a success`, { requestId, url: resultUrl, path: output });
  }

  const uniform = info.delaysMs.every((d) => d === info.delaysMs[0]);
  const durationMs = info.delaysMs.reduce((a, d) => a + d, 0);
  if (!uniform) console.error(`WARN: the frames do not share one delay: ${info.delaysMs.join(", ")} ms`);
  if (info.width !== body.image_size.width || info.height !== body.image_size.height) {
    console.error(`WARN: asked for ${body.image_size.width}x${body.image_size.height} frames, the GIF is ${info.width}x${info.height}`);
  }

  return {
    backend: "fal",
    model,
    endpoint: url,
    ...(requestId ? { requestId } : {}),
    files: [output],
    url: resultUrl,
    frameCount: info.frames,
    frameDurationMs: uniform ? info.delaysMs[0] : Math.round(durationMs / info.frames),
    durationMs,
    size: { width: info.width, height: info.height },
    ...(body.background ? { background: body.background } : {}),
    cost: gifCost(),
  };
}

const HELP = `Usage: generate_gif.mjs <prompt> --output <path.gif> [options]

  <prompt>                    The animation, in words (positional)
  --output <path.gif>         Where the GIF is written (required)
  --image-urls <path|url>     Reference image, repeatable, up to ${GIF_LIMITS.maxReferences}, in order;
                              any reference switches to the edit endpoint
  --model <name>              ${GIF_MODELS.join(", ")} (default: ${DEFAULT_GIF_MODEL})
  --frame-count <n>           ${GIF_LIMITS.minFrames}-${GIF_LIMITS.maxFrames} (default: ${DEFAULT_FRAME_COUNT})
  --frame-duration-ms <n>     ${GIF_LIMITS.minFrameDurationMs}-${GIF_LIMITS.maxFrameDurationMs}, rounded to 10 ms by fal (default: ${DEFAULT_FRAME_DURATION_MS})
  --image-size <WxH>          Per frame, multiples of ${GIF_LIMITS.sizeMultiple} (default: ${DEFAULT_GIF_SIZE});
                              frames x W x H must stay within ${GIF_LIMITS.pixelBudget.toLocaleString("en-US")} px
  --quality <level>           ${GIF_QUALITIES.join(", ")} (default: ${DEFAULT_GIF_QUALITY})
  --background <mode>         ${GIF_BACKGROUNDS.join(", ")} (omitted unless passed; GIF alpha is 1-bit)
  --deadline-s <n>            Cancel the job after this many seconds (default: 600)
  --json                      Print one JSON object on stdout
  --help, -h                  This text

One fal job per run. A job that fails is reported with its request id and
never sent again — it may have been billed. The GIF is checked: a file that
is not a GIF, or holds another number of frames than asked, is a failure.
fal bills by tokens and reports none, so the cost: line says unknown and
quotes the list price. Requires FAL_KEY (environment or .env).`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      output: { type: "string" },
      "image-urls": { type: "string", multiple: true },
      model: { type: "string", default: DEFAULT_GIF_MODEL },
      "frame-count": { type: "string", default: String(DEFAULT_FRAME_COUNT) },
      "frame-duration-ms": { type: "string", default: String(DEFAULT_FRAME_DURATION_MS) },
      "image-size": { type: "string", default: DEFAULT_GIF_SIZE },
      quality: { type: "string", default: DEFAULT_GIF_QUALITY },
      background: { type: "string" },
      "deadline-s": { type: "string", default: "600" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.error(HELP);
    return 0;
  }
  if (positionals.length !== 1) throw new Error("Usage: generate_gif.mjs <prompt> --output <path.gif> [options] (the prompt is positional)");

  const options = {
    prompt: positionals[0],
    output: values.output,
    model: values.model,
    imageUrls: values["image-urls"] ?? [],
    frameCount: values["frame-count"],
    frameDurationMs: values["frame-duration-ms"],
    imageSize: values["image-size"],
    quality: values.quality,
    background: values.background,
  };
  // Every refusal that needs no key and no network comes first.
  buildGifRequest(options);

  const apiKey = loadFalKey();
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const controller = new AbortController();
  const handlers = new Map();
  let interruptedBy = null;
  for (const name of ["SIGTERM", "SIGINT"]) {
    const handler = () => {
      if (interruptedBy) process.exit(130);
      interruptedBy = name;
      controller.abort(new DOMException(`received ${name}`, "AbortError"));
    };
    handlers.set(name, handler);
    process.on(name, handler);
  }

  const started = Date.now();
  try {
    const result = await generateGif({
      ...options,
      apiKey,
      signal: controller.signal,
      deadlineMs: Math.max(30, Number(values["deadline-s"]) || 600) * 1000,
      onStatus: ({ status }) => console.error(`[fal:${status}]`),
    });
    console.error(`[fal] ${result.frameCount} frames of ${result.size.width}x${result.size.height} in ${((Date.now() - started) / 1000).toFixed(1)}s → ${result.files[0]}`);
    // The price first, on stderr: stdout stays one object (or one path).
    console.error(costLine(result.cost));
    console.log(values.json ? JSON.stringify(result) : result.files[0]);
    return 0;
  } catch (error) {
    if (interruptedBy || error?.name === "AbortError") {
      console.error(error?.url
        ? `ERROR: ${interruptedBy ?? "interrupted"} while downloading the finished GIF (fal request ${error.requestId}) — the job ran and may have been billed; fetch it from ${error.url}; do not resubmit`
        : `ERROR: ${interruptedBy ?? "interrupted"} — the fal.ai job was cancelled${error?.requestId ? ` (fal request ${error.requestId}); whether it had already been billed is not knowable from here` : ""}`);
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
