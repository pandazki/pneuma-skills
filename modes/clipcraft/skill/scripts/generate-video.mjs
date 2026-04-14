#!/usr/bin/env node

/**
 * ClipCraft Video Generator CLI
 *
 * Plain argv CLI wrapping fal.ai veo3.1 for text->video and image->video
 * generation. Prints the output path on success (exit 0); prints errors to
 * stderr on failure (exit 1).
 *
 * NOTE: veo3.1 is expensive (~$0.20-0.60/second of video) and each call
 * blocks 30-120+ seconds. --duration is REQUIRED — there is no default,
 * so a missing arg cannot trigger an accidental paid generation.
 *
 * Usage:
 *   node generate-video.mjs --prompt "..." --duration 4s|6s|8s \
 *     --output assets/video/out.mp4 \
 *     [--aspect-ratio 16:9|9:16] [--resolution 720p|1080p] [--no-audio]
 *
 *   node generate-video.mjs from-image --prompt "..." --image-url <url|path> \
 *     --duration 4s|6s|8s --output assets/video/out.mp4 \
 *     [--aspect-ratio auto|16:9|9:16] [--resolution 720p|1080p] [--no-audio]
 *
 * Environment:
 *   FAL_KEY  — required; fal.ai API key
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// MIME type helper (verbatim from legacy clipcraft-videogen.mjs)
// ---------------------------------------------------------------------------

function mimeFromExt(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return map[ext] || "image/jpeg";
}

// ---------------------------------------------------------------------------
// fal.ai API helpers (verbatim from legacy, with apiKey threaded as arg)
// ---------------------------------------------------------------------------

const FAL_TEXT_TO_VIDEO_URL = "https://fal.run/fal-ai/veo3.1";
const FAL_IMAGE_TO_VIDEO_URL = "https://fal.run/fal-ai/veo3.1/image-to-video";

async function falTextToVideo(
  { prompt, duration, aspect_ratio, resolution, generate_audio },
  apiKey
) {
  const res = await fetch(FAL_TEXT_TO_VIDEO_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      duration,
      aspect_ratio: aspect_ratio || "16:9",
      resolution: resolution || "720p",
      generate_audio: generate_audio !== false,
      auto_fix: true,
      safety_tolerance: "4",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai veo3.1 text-to-video failed (${res.status}): ${body}`);
  }

  return res.json(); // { video: { url } }
}

async function falImageToVideo(
  { prompt, image_url, duration, aspect_ratio, resolution, generate_audio },
  apiKey
) {
  const res = await fetch(FAL_IMAGE_TO_VIDEO_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_url,
      duration,
      aspect_ratio: aspect_ratio || "auto",
      resolution: resolution || "720p",
      generate_audio: generate_audio !== false,
      auto_fix: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai veo3.1 image-to-video failed (${res.status}): ${body}`);
  }

  return res.json(); // { video: { url } }
}

async function downloadVideo(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download video (${res.status})`);

  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
}

/**
 * Resolve an image path/url to something usable by fal.ai.
 * If it's already an http(s) URL, return as-is. Otherwise read the local
 * file and return a base64 data URI. (Verbatim from legacy.)
 */
function resolveImageUrl(imagePath) {
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }

  try {
    const fileBuffer = readFileSync(imagePath);
    const base64 = fileBuffer.toString("base64");
    const mime = mimeFromExt(imagePath);
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    throw new Error(`Failed to read source image: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function runTextToVideo(args) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) die("FAL_KEY is not set");

  const { prompt, duration, output } = args;
  const aspectRatio = args["aspect-ratio"];
  const resolution = args.resolution;
  const noAudio = args["no-audio"] === true;

  if (!prompt) die("--prompt is required");
  if (!duration) {
    die(
      "--duration is required (e.g. 4s, 6s, 8s). veo3.1 is expensive, no default."
    );
  }
  if (!output) die("--output is required");

  const result = await falTextToVideo(
    {
      prompt,
      duration,
      aspect_ratio: aspectRatio,
      resolution,
      generate_audio: !noAudio,
    },
    apiKey
  );

  const videoUrl = result?.video?.url;
  if (!videoUrl) die("fal.ai returned no video");

  await downloadVideo(videoUrl, output);
  console.log(output);
}

async function runImageToVideo(args) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) die("FAL_KEY is not set");

  const { prompt, duration, output } = args;
  const imagePath = args["image-url"];
  const aspectRatio = args["aspect-ratio"];
  const resolution = args.resolution;
  const noAudio = args["no-audio"] === true;

  if (!imagePath) die("from-image requires --image-url");
  if (!prompt) die("from-image requires --prompt");
  if (!duration) {
    die(
      "--duration is required (e.g. 4s, 6s, 8s). veo3.1 is expensive, no default."
    );
  }
  if (!output) die("from-image requires --output");

  const imageUrl = resolveImageUrl(imagePath);

  const result = await falImageToVideo(
    {
      prompt,
      image_url: imageUrl,
      duration,
      aspect_ratio: aspectRatio,
      resolution,
      generate_audio: !noAudio,
    },
    apiKey
  );

  const videoUrl = result?.video?.url;
  if (!videoUrl) die("fal.ai returned no video");

  await downloadVideo(videoUrl, output);
  console.log(output);
}

const rawArgv = process.argv.slice(2);
const subcommand = rawArgv[0] === "from-image" ? "from-image" : "text";
const argvForParse = subcommand === "from-image" ? rawArgv.slice(1) : rawArgv;

const { values } = parseArgs({
  args: argvForParse,
  options: {
    prompt: { type: "string" },
    output: { type: "string" },
    duration: { type: "string" },
    "aspect-ratio": { type: "string" },
    resolution: { type: "string" },
    "no-audio": { type: "boolean" },
    "image-url": { type: "string" },
  },
  allowPositionals: false,
});

try {
  if (subcommand === "from-image") {
    await runImageToVideo(values);
  } else {
    await runTextToVideo(values);
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
