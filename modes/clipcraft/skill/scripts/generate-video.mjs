#!/usr/bin/env node

/**
 * ClipCraft Video Generator CLI
 *
 * Plain argv CLI wrapping fal.ai video models. Prints the output path
 * on success (exit 0); prints errors to stderr on failure (exit 1).
 *
 * Three subcommands, each covering a distinct use case:
 *
 *   (default / no subcommand) — text → video
 *       Default model: bytedance/seedance-2.0/reference-to-video
 *                       (called with no refs = pure t2v)
 *       Fallback:      veo3.1 via `--model veo3.1`
 *
 *   from-image   — first-frame (and optional last-frame) → video
 *       Default model: bytedance/seedance-2.0/image-to-video
 *       Fallback:      veo3.1/image-to-video via `--model veo3.1`
 *       Notes: --image-url is the START frame; --end-image-url
 *              (seedance only) is the optional END frame.
 *
 *   reference    — multi-reference → video
 *       Only model:    bytedance/seedance-2.0/reference-to-video
 *       Inputs: repeatable --image-url (≤9), --video-url (≤3),
 *               --audio-url (≤3); total ≤12. In the --prompt, refer
 *               to each as @Image1 / @Video2 / @Audio1 in the order
 *               they were passed. Audio refs require at least one
 *               image or video ref.
 *
 * Model flag:
 *   --model seedance  (default for text + from-image)
 *   --model veo3.1    (fallback for text + from-image; NOT for reference)
 *
 * Duration:
 *   Accepts `auto`, `4`, `5`, ... `15`, or legacy `"4s"` / `"6s"` / `"8s"`.
 *   Seedance accepts the full 4–15 + `auto`.
 *   veo3.1 only accepts 4 / 6 / 8 (converted to "4s" / "6s" / "8s").
 *   No default — --duration is required on every call so a missing
 *   arg cannot accidentally trigger an expensive paid generation.
 *
 * Environment:
 *   FAL_KEY  — required; fal.ai API key
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Local file → data URI resolver (for images, videos, audio passed to fal.ai)
// ---------------------------------------------------------------------------

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

function mimeFromPath(path) {
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

/**
 * Resolve a media path to something fal.ai can fetch. If the path is
 * already an http(s) URL, return as-is. Otherwise read the local file
 * and return a base64 data URI (same pattern legacy clipcraft used).
 */
function resolveMediaUrl(path) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  let buf;
  try {
    buf = readFileSync(path);
  } catch (err) {
    throw new Error(`Failed to read media file "${path}": ${err.message}`);
  }
  const mime = mimeFromPath(path);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Parameter normalization + per-model validation
// ---------------------------------------------------------------------------

/**
 * Accept `auto`, `4`, `"4"`, `"4s"`, `"4 s"` etc. Return either the
 * string `"auto"` or a number of seconds. Caller formats per model.
 */
function normalizeDuration(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "auto") return "auto";
  const n = parseInt(s.replace(/s$/, "").trim(), 10);
  if (isNaN(n) || n < 1 || n > 60) {
    throw new Error(`invalid --duration "${raw}" (expected "auto" or 1-60 seconds)`);
  }
  return n;
}

function durationForVeo(norm) {
  if (norm === "auto") {
    throw new Error("veo3.1 does not support --duration auto; use 4 / 6 / 8");
  }
  if (norm !== 4 && norm !== 6 && norm !== 8) {
    throw new Error(`veo3.1 only supports --duration 4 / 6 / 8 seconds; got ${norm}`);
  }
  return `${norm}s`;
}

function durationForSeedance(norm) {
  if (norm === "auto") return "auto";
  if (norm < 4 || norm > 15) {
    throw new Error(`seedance only supports --duration 4-15 seconds or auto; got ${norm}`);
  }
  return String(norm);
}

const SEEDANCE_ASPECT_RATIOS = new Set([
  "auto",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
]);
const VEO_ASPECT_RATIOS = new Set(["16:9", "9:16"]);

function validateAspectRatio(ar, model) {
  if (!ar) return null;
  const allowed = model === "veo3.1" ? VEO_ASPECT_RATIOS : SEEDANCE_ASPECT_RATIOS;
  if (!allowed.has(ar)) {
    throw new Error(
      `${model} does not support --aspect-ratio "${ar}"; allowed: ${[...allowed].join(", ")}`,
    );
  }
  return ar;
}

const SEEDANCE_RESOLUTIONS = new Set(["480p", "720p"]);
const VEO_RESOLUTIONS = new Set(["720p", "1080p"]);

function validateResolution(res, model) {
  if (!res) return null;
  const allowed = model === "veo3.1" ? VEO_RESOLUTIONS : SEEDANCE_RESOLUTIONS;
  if (!allowed.has(res)) {
    throw new Error(
      `${model} does not support --resolution "${res}"; allowed: ${[...allowed].join(", ")}`,
    );
  }
  return res;
}

function parseSeed(raw) {
  if (raw == null) return null;
  const n = parseInt(String(raw), 10);
  if (isNaN(n)) throw new Error(`invalid --seed "${raw}"`);
  return n;
}

// ---------------------------------------------------------------------------
// fal.ai client functions
// ---------------------------------------------------------------------------

const FAL_VEO_TEXT_TO_VIDEO_URL = "https://fal.run/fal-ai/veo3.1";
const FAL_VEO_IMAGE_TO_VIDEO_URL = "https://fal.run/fal-ai/veo3.1/image-to-video";
const FAL_SEEDANCE_I2V_URL = "https://fal.run/bytedance/seedance-2.0/image-to-video";
const FAL_SEEDANCE_R2V_URL = "https://fal.run/bytedance/seedance-2.0/reference-to-video";

async function postFal(url, body, apiKey, labelForErrors) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${labelForErrors} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function veoTextToVideo({ prompt, duration, aspect_ratio, resolution, generate_audio }, apiKey) {
  return postFal(
    FAL_VEO_TEXT_TO_VIDEO_URL,
    {
      prompt,
      duration,
      aspect_ratio: aspect_ratio || "16:9",
      resolution: resolution || "720p",
      generate_audio: generate_audio !== false,
      auto_fix: true,
      safety_tolerance: "4",
    },
    apiKey,
    "fal-ai/veo3.1 text-to-video",
  );
}

async function veoImageToVideo(
  { prompt, image_url, duration, aspect_ratio, resolution, generate_audio },
  apiKey,
) {
  return postFal(
    FAL_VEO_IMAGE_TO_VIDEO_URL,
    {
      prompt,
      image_url,
      duration,
      aspect_ratio: aspect_ratio || "auto",
      resolution: resolution || "720p",
      generate_audio: generate_audio !== false,
      auto_fix: true,
    },
    apiKey,
    "fal-ai/veo3.1 image-to-video",
  );
}

async function seedanceImageToVideo(
  {
    prompt,
    image_url,
    end_image_url,
    duration,
    aspect_ratio,
    resolution,
    generate_audio,
    seed,
  },
  apiKey,
) {
  const body = {
    prompt,
    image_url,
    resolution: resolution || "720p",
    duration: duration ?? "auto",
    aspect_ratio: aspect_ratio || "auto",
    generate_audio: generate_audio !== false,
  };
  if (end_image_url) body.end_image_url = end_image_url;
  if (seed != null) body.seed = seed;
  return postFal(
    FAL_SEEDANCE_I2V_URL,
    body,
    apiKey,
    "bytedance/seedance-2.0 image-to-video",
  );
}

async function seedanceReferenceToVideo(
  {
    prompt,
    image_urls,
    video_urls,
    audio_urls,
    duration,
    aspect_ratio,
    resolution,
    generate_audio,
    seed,
  },
  apiKey,
) {
  const body = {
    prompt,
    resolution: resolution || "720p",
    duration: duration ?? "auto",
    aspect_ratio: aspect_ratio || "auto",
    generate_audio: generate_audio !== false,
  };
  if (image_urls?.length) body.image_urls = image_urls;
  if (video_urls?.length) body.video_urls = video_urls;
  if (audio_urls?.length) body.audio_urls = audio_urls;
  if (seed != null) body.seed = seed;
  return postFal(
    FAL_SEEDANCE_R2V_URL,
    body,
    apiKey,
    "bytedance/seedance-2.0 reference-to-video",
  );
}

// ---------------------------------------------------------------------------
// Common download + save
// ---------------------------------------------------------------------------

async function downloadVideo(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download video (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function requireCommonArgs(args) {
  if (!args.prompt) die("--prompt is required");
  if (!args.duration) die("--duration is required (4-15 seconds or 'auto')");
  if (!args.output) die("--output is required");
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) die("FAL_KEY is not set");
  return apiKey;
}

function pickModelForText(raw) {
  const m = (raw ?? "seedance").toLowerCase();
  if (m === "seedance" || m === "seedance-2.0") return "seedance";
  if (m === "veo3.1" || m === "veo" || m === "veo3") return "veo3.1";
  throw new Error(`unknown --model "${raw}" (expected seedance | veo3.1)`);
}

function pickModelForFromImage(raw) {
  return pickModelForText(raw); // same allowlist
}

async function runTextToVideo(args) {
  const apiKey = requireCommonArgs(args);
  const model = pickModelForText(args.model);
  const norm = normalizeDuration(args.duration);
  const generateAudio = args["no-audio"] !== true;
  const seed = parseSeed(args.seed);

  let result;
  if (model === "veo3.1") {
    result = await veoTextToVideo(
      {
        prompt: args.prompt,
        duration: durationForVeo(norm),
        aspect_ratio: validateAspectRatio(args["aspect-ratio"], "veo3.1"),
        resolution: validateResolution(args.resolution, "veo3.1"),
        generate_audio: generateAudio,
      },
      apiKey,
    );
  } else {
    // seedance reference-to-video called with no refs = pure text-to-video
    result = await seedanceReferenceToVideo(
      {
        prompt: args.prompt,
        duration: durationForSeedance(norm),
        aspect_ratio: validateAspectRatio(args["aspect-ratio"], "seedance"),
        resolution: validateResolution(args.resolution, "seedance"),
        generate_audio: generateAudio,
        seed,
      },
      apiKey,
    );
  }

  const videoUrl = result?.video?.url;
  if (!videoUrl) die(`${model} returned no video url`);
  await downloadVideo(videoUrl, args.output);
  console.log(args.output);
}

async function runFromImage(args) {
  const apiKey = requireCommonArgs(args);
  const model = pickModelForFromImage(args.model);
  const norm = normalizeDuration(args.duration);
  const generateAudio = args["no-audio"] !== true;
  const seed = parseSeed(args.seed);

  const images = args["image-url"] ?? [];
  if (images.length === 0) die("from-image requires --image-url (start frame)");
  if (images.length > 1) {
    die(
      "from-image accepts exactly one --image-url (the start frame). For multi-reference generation, use the `reference` subcommand.",
    );
  }
  const imageUrl = resolveMediaUrl(images[0]);
  const endImagePath = args["end-image-url"];
  const endImageUrl = endImagePath ? resolveMediaUrl(endImagePath) : undefined;

  let result;
  if (model === "veo3.1") {
    if (endImageUrl) {
      die("veo3.1 does not support --end-image-url; use seedance (default).");
    }
    result = await veoImageToVideo(
      {
        prompt: args.prompt,
        image_url: imageUrl,
        duration: durationForVeo(norm),
        aspect_ratio: validateAspectRatio(args["aspect-ratio"], "veo3.1"),
        resolution: validateResolution(args.resolution, "veo3.1"),
        generate_audio: generateAudio,
      },
      apiKey,
    );
  } else {
    result = await seedanceImageToVideo(
      {
        prompt: args.prompt,
        image_url: imageUrl,
        end_image_url: endImageUrl,
        duration: durationForSeedance(norm),
        aspect_ratio: validateAspectRatio(args["aspect-ratio"], "seedance"),
        resolution: validateResolution(args.resolution, "seedance"),
        generate_audio: generateAudio,
        seed,
      },
      apiKey,
    );
  }

  const videoUrl = result?.video?.url;
  if (!videoUrl) die(`${model} returned no video url`);
  await downloadVideo(videoUrl, args.output);
  console.log(args.output);
}

async function runReference(args) {
  if (args.model && args.model !== "seedance" && args.model !== "seedance-2.0") {
    die(`reference-to-video only runs on seedance; got --model "${args.model}"`);
  }
  const apiKey = requireCommonArgs(args);
  const norm = normalizeDuration(args.duration);
  const generateAudio = args["no-audio"] !== true;
  const seed = parseSeed(args.seed);

  const imagePaths = args["image-url"] ?? [];
  const videoPaths = args["video-url"] ?? [];
  const audioPaths = args["audio-url"] ?? [];

  if (imagePaths.length > 9) die("reference accepts at most 9 --image-url");
  if (videoPaths.length > 3) die("reference accepts at most 3 --video-url");
  if (audioPaths.length > 3) die("reference accepts at most 3 --audio-url");
  if (imagePaths.length + videoPaths.length + audioPaths.length > 12) {
    die("reference accepts at most 12 total reference files across all modalities");
  }
  if (audioPaths.length > 0 && imagePaths.length === 0 && videoPaths.length === 0) {
    die("reference requires at least one --image-url or --video-url when --audio-url is set");
  }

  const image_urls = imagePaths.map(resolveMediaUrl);
  const video_urls = videoPaths.map(resolveMediaUrl);
  const audio_urls = audioPaths.map(resolveMediaUrl);

  const result = await seedanceReferenceToVideo(
    {
      prompt: args.prompt,
      image_urls: image_urls.length ? image_urls : undefined,
      video_urls: video_urls.length ? video_urls : undefined,
      audio_urls: audio_urls.length ? audio_urls : undefined,
      duration: durationForSeedance(norm),
      aspect_ratio: validateAspectRatio(args["aspect-ratio"], "seedance"),
      resolution: validateResolution(args.resolution, "seedance"),
      generate_audio: generateAudio,
      seed,
    },
    apiKey,
  );

  const videoUrl = result?.video?.url;
  if (!videoUrl) die("seedance reference-to-video returned no video url");
  await downloadVideo(videoUrl, args.output);
  console.log(args.output);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const SUBCOMMANDS = new Set(["from-image", "reference"]);
const rawArgv = process.argv.slice(2);
const maybeSub = rawArgv[0];
const subcommand = SUBCOMMANDS.has(maybeSub) ? maybeSub : "text";
const argvForParse = subcommand === "text" ? rawArgv : rawArgv.slice(1);

const { values } = parseArgs({
  args: argvForParse,
  options: {
    prompt: { type: "string" },
    output: { type: "string" },
    duration: { type: "string" },
    "aspect-ratio": { type: "string" },
    resolution: { type: "string" },
    "no-audio": { type: "boolean" },
    "image-url": { type: "string", multiple: true },
    "end-image-url": { type: "string" },
    "video-url": { type: "string", multiple: true },
    "audio-url": { type: "string", multiple: true },
    model: { type: "string" },
    seed: { type: "string" },
  },
  allowPositionals: false,
});

try {
  if (subcommand === "from-image") {
    await runFromImage(values);
  } else if (subcommand === "reference") {
    await runReference(values);
  } else {
    await runTextToVideo(values);
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
