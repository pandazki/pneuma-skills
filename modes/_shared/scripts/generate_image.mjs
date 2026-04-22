#!/usr/bin/env node
/**
 * Generate images via fal.ai or OpenRouter.
 *
 * Supported models:
 *   - gpt-image-2   : OpenAI GPT-Image-2 via fal.ai (default; text-to-image and edit)
 *   - gemini-3-pro  : Gemini 3 Pro Image Preview (fal.ai or OpenRouter)
 *
 * Zero external dependencies — uses only Node.js / Bun built-in APIs.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// .env loading
// ---------------------------------------------------------------------------

function findEnvFile() {
  // 1. Check skill root directory (parent of scripts/)
  const skillRoot = dirname(__dirname);
  const skillEnv = join(skillRoot, ".env");
  if (existsSync(skillEnv)) return skillEnv;

  // 2. Fallback: search from cwd upward
  let dir = process.cwd();
  while (true) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) return envPath;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadEnvKeys() {
  const keys = {};

  // Check environment variables first
  for (const name of ["FAL_KEY", "OPENROUTER_API_KEY"]) {
    if (process.env[name]) keys[name] = process.env[name];
  }

  const envPath = findEnvFile();
  if (!envPath) return keys;

  const content = readFileSync(envPath, "utf-8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if ((key === "FAL_KEY" || key === "OPENROUTER_API_KEY") && value && !keys[key]) {
      keys[key] = value;
    }
  }
  return keys;
}

function detectBackend(keys) {
  // Prefer fal.ai — it's the only backend that can run the default gpt-image-2.
  if (keys.FAL_KEY) return "fal";
  if (keys.OPENROUTER_API_KEY) return "openrouter";
  return "none";
}

// ---------------------------------------------------------------------------
// GPT-Image-2 image_size resolution
// ---------------------------------------------------------------------------

const GPT2_ASPECT_TO_SIZE = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "4:3": "landscape_4_3",
  "3:2": "landscape_4_3",
  "5:4": "square_hd",
  "4:5": "portrait_4_3",
  "3:4": "portrait_4_3",
  "2:3": "portrait_4_3",
  "9:16": "portrait_16_9",
  "21:9": "landscape_16_9",
  auto: "landscape_4_3",
};

function resolveGpt2ImageSize(imageSize, aspectRatio) {
  if (imageSize) {
    if (imageSize.toLowerCase().includes("x")) {
      const [w, h] = imageSize.toLowerCase().split("x", 2);
      const width = parseInt(w, 10);
      const height = parseInt(h, 10);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        console.error(`ERROR: invalid --image-size '${imageSize}', expected WxH or preset name`);
        process.exit(1);
      }
      return { width, height };
    }
    return imageSize;
  }
  return GPT2_ASPECT_TO_SIZE[aspectRatio] ?? "landscape_4_3";
}

// ---------------------------------------------------------------------------
// fal.ai queue helper (no SDK — direct REST)
// ---------------------------------------------------------------------------

async function falSubscribe({ apiKey, appId, payload, tag }) {
  const baseUrl = `https://queue.fal.run/${appId}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Key ${apiKey}`,
  };

  console.error(`[${tag}] Sending request...`);
  const submitResp = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!submitResp.ok) {
    const text = await submitResp.text();
    console.error(`ERROR: fal.ai submit returned ${submitResp.status}: ${text}`);
    process.exit(1);
  }

  const { request_id } = await submitResp.json();
  const statusUrl = `${baseUrl}/requests/${request_id}/status`;
  const seenLogs = new Set();

  while (true) {
    const statusResp = await fetch(`${statusUrl}?logs=1`, { headers });
    if (!statusResp.ok) {
      const text = await statusResp.text();
      console.error(`ERROR: fal.ai status returned ${statusResp.status}: ${text}`);
      process.exit(1);
    }
    const status = await statusResp.json();
    if (Array.isArray(status.logs)) {
      for (const log of status.logs) {
        const key = `${log.timestamp ?? ""}|${log.message ?? ""}`;
        if (!seenLogs.has(key)) {
          seenLogs.add(key);
          console.error(`  [log] ${log.message}`);
        }
      }
    }
    if (status.status === "COMPLETED") break;
    if (status.status === "FAILED") {
      console.error(`ERROR: fal.ai generation failed: ${status.error ?? "unknown"}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const resultResp = await fetch(`${baseUrl}/requests/${request_id}`, { headers });
  if (!resultResp.ok) {
    const text = await resultResp.text();
    console.error(`ERROR: fal.ai result returned ${resultResp.status}: ${text}`);
    process.exit(1);
  }
  return await resultResp.json();
}

async function downloadFalImages(result, outputFormat, numImages, outputDir, filenamePrefix, tag) {
  mkdirSync(outputDir, { recursive: true });
  const savedFiles = [];
  const urls = [];
  const images = Array.isArray(result.images) ? result.images : [];
  for (let i = 0; i < images.length; i++) {
    const url = images[i].url;
    urls.push(url);
    const suffix = numImages > 1 ? `_${i + 1}` : "";
    const filename = `${filenamePrefix}${suffix}.${outputFormat}`;
    const filepath = join(outputDir, filename);
    const imgResp = await fetch(url);
    if (!imgResp.ok) {
      console.error(`ERROR: download failed ${imgResp.status} for ${url}`);
      process.exit(1);
    }
    writeFileSync(filepath, Buffer.from(await imgResp.arrayBuffer()));
    savedFiles.push(filepath);
    console.error(`[${tag}] Saved: ${filepath}`);
  }
  return { savedFiles, urls };
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

async function generateViaOpenrouter({
  apiKey,
  prompt,
  numImages,
  aspectRatio,
  resolution,
  outputFormat,
  outputDir,
  filenamePrefix,
}) {
  const imageInstruction = numImages > 1 ? ` Generate ${numImages} different variations.` : "";
  const body = {
    model: "google/gemini-3-pro-image-preview",
    messages: [{ role: "user", content: `${prompt}${imageInstruction}` }],
    modalities: ["image", "text"],
  };

  const imageConfig = {};
  if (aspectRatio && aspectRatio !== "auto") imageConfig.aspect_ratio = aspectRatio;
  if (resolution) imageConfig.image_size = resolution;
  if (Object.keys(imageConfig).length) body.image_config = imageConfig;

  console.error("[openrouter:gemini-3-pro] Sending request...");
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`ERROR: OpenRouter API returned ${resp.status}: ${text}`);
    process.exit(1);
  }

  const result = await resp.json();
  mkdirSync(outputDir, { recursive: true });

  const savedFiles = [];
  const urls = [];
  const message = result.choices?.[0]?.message ?? {};

  let imagesData = [];
  if (message.images) {
    for (const img of message.images) {
      const url = img.image_url?.url ?? "";
      if (url) imagesData.push(url);
    }
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "image_url") {
        const url = part.image_url?.url ?? "";
        if (url) imagesData.push(url);
      }
    }
  }

  imagesData = imagesData.slice(0, numImages);

  for (let i = 0; i < imagesData.length; i++) {
    const imageUrl = imagesData[i];
    const suffix = imagesData.length > 1 ? `_${i + 1}` : "";
    const filename = `${filenamePrefix}${suffix}.${outputFormat}`;
    const filepath = join(outputDir, filename);

    if (imageUrl.startsWith("data:")) {
      const b64data = imageUrl.split(",")[1];
      writeFileSync(filepath, Buffer.from(b64data, "base64"));
    } else {
      const imgResp = await fetch(imageUrl);
      writeFileSync(filepath, Buffer.from(await imgResp.arrayBuffer()));
      urls.push(imageUrl);
    }

    savedFiles.push(filepath);
    console.error(`[openrouter:gemini-3-pro] Saved: ${filepath}`);
  }

  let description = "";
  if (typeof message.content === "string") {
    description = message.content;
  } else if (Array.isArray(message.content)) {
    description = message.content
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  }

  return {
    backend: "openrouter",
    model: "gemini-3-pro",
    files: savedFiles,
    urls,
    description,
  };
}

async function generateViaFalGemini({
  apiKey,
  prompt,
  numImages,
  aspectRatio,
  outputFormat,
  resolution,
  safetyTolerance,
  seed,
  outputDir,
  filenamePrefix,
}) {
  const payload = {
    prompt,
    num_images: numImages,
    aspect_ratio: aspectRatio,
    output_format: outputFormat,
    safety_tolerance: safetyTolerance,
    resolution,
  };
  if (seed != null) payload.seed = seed;

  const result = await falSubscribe({
    apiKey,
    appId: "fal-ai/gemini-3-pro-image-preview",
    payload,
    tag: "fal:gemini-3-pro",
  });

  const { savedFiles, urls } = await downloadFalImages(
    result,
    outputFormat,
    numImages,
    outputDir,
    filenamePrefix,
    "fal:gemini-3-pro",
  );

  return {
    backend: "fal",
    model: "gemini-3-pro",
    files: savedFiles,
    urls,
    description: result.description ?? "",
  };
}

async function generateViaFalGptImage2({
  apiKey,
  prompt,
  numImages,
  aspectRatio,
  imageSize,
  quality,
  outputFormat,
  imageUrls,
  maskUrl,
  outputDir,
  filenamePrefix,
}) {
  const isEdit = Array.isArray(imageUrls) && imageUrls.length > 0;
  const appId = isEdit ? "openai/gpt-image-2/edit" : "openai/gpt-image-2";
  const tag = isEdit ? "fal:gpt-image-2/edit" : "fal:gpt-image-2";

  const payload = {
    prompt,
    num_images: numImages,
    quality,
    output_format: outputFormat,
  };

  if (isEdit) {
    payload.image_urls = imageUrls;
    if (maskUrl) payload.mask_url = maskUrl;
    // Edit endpoint defaults image_size to 'auto'; only set when user opts in.
    if (imageSize) payload.image_size = resolveGpt2ImageSize(imageSize, aspectRatio);
  } else {
    payload.image_size = resolveGpt2ImageSize(imageSize, aspectRatio);
  }

  const result = await falSubscribe({ apiKey, appId, payload, tag });

  const { savedFiles, urls } = await downloadFalImages(
    result,
    outputFormat,
    numImages,
    outputDir,
    filenamePrefix,
    tag,
  );

  return {
    backend: "fal",
    model: "gpt-image-2",
    endpoint: appId,
    files: savedFiles,
    urls,
    description: result.description ?? "",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const MODELS = ["gpt-image-2", "gemini-3-pro"];
const ASPECT_RATIOS = [
  "auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16",
];
const OUTPUT_FORMATS = ["jpeg", "png", "webp"];
const RESOLUTIONS = ["1K", "2K", "4K"];
const QUALITIES = ["low", "medium", "high"];
const SAFETY_TOLERANCES = ["1", "2", "3", "4", "5", "6"];

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model:              { type: "string", default: "gpt-image-2" },
    "num-images":       { type: "string", default: "1" },
    "aspect-ratio":     { type: "string", default: "1:1" },
    "output-format":    { type: "string", default: "png" },
    // Gemini-only
    resolution:         { type: "string", default: "1K" },
    "safety-tolerance": { type: "string", default: "4" },
    seed:               { type: "string" },
    // GPT-Image-2 only
    quality:            { type: "string", default: "high" },
    "image-size":       { type: "string" },
    "image-urls":       { type: "string", multiple: true },
    "mask-url":         { type: "string" },
    // Common
    "output-dir":       { type: "string", default: "." },
    "filename-prefix":  { type: "string", default: "illustration" },
    backend:            { type: "string" },
    help:               { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.error(
    `Usage: generate_image.mjs <prompt> [options]

Models:
  --model <name>             ${MODELS.join(", ")} (default: gpt-image-2)

Common options:
  --num-images <1-4>         Number of images (default: 1)
  --aspect-ratio <ratio>     ${ASPECT_RATIOS.join(", ")} (default: 1:1)
  --output-format <fmt>      ${OUTPUT_FORMATS.join(", ")} (default: png)
  --output-dir <path>        Output directory (default: .)
  --filename-prefix <str>    Filename prefix (default: illustration)
  --backend <fal|openrouter> Force backend (default: auto-detect from env)

GPT-Image-2 only:
  --quality <low|medium|high>  Affects cost (default: high)
  --image-size <preset|WxH>    e.g. 'landscape_4_3' or '1024x1024'. Overrides --aspect-ratio.
  --image-urls <url> [...]     Switch to edit endpoint; one or more reference image URLs
  --mask-url <url>             Optional mask URL (edit endpoint only)

Gemini 3 Pro only:
  --resolution <res>         ${RESOLUTIONS.join(", ")} (default: 1K)
  --safety-tolerance <1-6>   fal.ai only (default: 4)
  --seed <int>               fal.ai only

Notes:
  - gpt-image-2 is fal.ai only — requires FAL_KEY.
  - gemini-3-pro works on both fal.ai (FAL_KEY) and OpenRouter (OPENROUTER_API_KEY).
  - Prefer gpt-image-2 unless you specifically want Gemini's aesthetic or only have OpenRouter.`,
  );
  process.exit(positionals.length === 0 ? 1 : 0);
}

const prompt = positionals[0];
const model = values.model;
const numImages = parseInt(values["num-images"], 10);
const aspectRatio = values["aspect-ratio"];
const outputFormat = values["output-format"];
const resolution = values.resolution;
const safetyTolerance = values["safety-tolerance"];
const seed = values.seed != null ? parseInt(values.seed, 10) : null;
const quality = values.quality;
const imageSize = values["image-size"] ?? null;
const imageUrls = values["image-urls"] ?? null;
const maskUrl = values["mask-url"] ?? null;
const outputDir = values["output-dir"];
const filenamePrefix = values["filename-prefix"];

// Validate
if (!MODELS.includes(model)) {
  console.error(`ERROR: invalid --model. Choices: ${MODELS.join(", ")}`);
  process.exit(1);
}
if (!Number.isFinite(numImages) || numImages < 1 || numImages > 4) {
  console.error("ERROR: --num-images must be 1-4");
  process.exit(1);
}
if (!ASPECT_RATIOS.includes(aspectRatio)) {
  console.error(`ERROR: invalid --aspect-ratio. Choices: ${ASPECT_RATIOS.join(", ")}`);
  process.exit(1);
}
if (!OUTPUT_FORMATS.includes(outputFormat)) {
  console.error(`ERROR: invalid --output-format. Choices: ${OUTPUT_FORMATS.join(", ")}`);
  process.exit(1);
}
if (!RESOLUTIONS.includes(resolution)) {
  console.error(`ERROR: invalid --resolution. Choices: ${RESOLUTIONS.join(", ")}`);
  process.exit(1);
}
if (!QUALITIES.includes(quality)) {
  console.error(`ERROR: invalid --quality. Choices: ${QUALITIES.join(", ")}`);
  process.exit(1);
}
if (!SAFETY_TOLERANCES.includes(safetyTolerance)) {
  console.error(`ERROR: invalid --safety-tolerance. Choices: ${SAFETY_TOLERANCES.join(", ")}`);
  process.exit(1);
}

const keys = loadEnvKeys();
let backend = values.backend ?? detectBackend(keys);

// gpt-image-2 is fal.ai-only. Route correctly or bail out.
if (model === "gpt-image-2") {
  if (!keys.FAL_KEY) {
    console.error("ERROR: --model gpt-image-2 requires FAL_KEY (not available on OpenRouter).");
    console.error("Get one at https://fal.ai/dashboard/keys, or pick --model gemini-3-pro.");
    process.exit(1);
  }
  if (backend !== "fal") {
    console.error("[router] gpt-image-2 is fal.ai-only — switching backend to fal.");
    backend = "fal";
  }
}

if (backend === "none") {
  console.error("ERROR: No API key found in .env file.");
  console.error("Please add one of the following to the .env file in the skill directory:");
  console.error("  FAL_KEY=your_fal_key                     (https://fal.ai/dashboard/keys)");
  console.error("  OPENROUTER_API_KEY=your_openrouter_key   (https://openrouter.ai/keys)");
  process.exit(1);
}

console.error(`[router] model=${model} backend=${backend}`);

let result;
if (model === "gpt-image-2") {
  result = await generateViaFalGptImage2({
    apiKey: keys.FAL_KEY,
    prompt,
    numImages,
    aspectRatio,
    imageSize,
    quality,
    outputFormat,
    imageUrls,
    maskUrl,
    outputDir,
    filenamePrefix,
  });
} else if (backend === "openrouter") {
  result = await generateViaOpenrouter({
    apiKey: keys.OPENROUTER_API_KEY,
    prompt,
    numImages,
    aspectRatio,
    resolution,
    outputFormat,
    outputDir,
    filenamePrefix,
  });
} else if (backend === "fal") {
  result = await generateViaFalGemini({
    apiKey: keys.FAL_KEY,
    prompt,
    numImages,
    aspectRatio,
    outputFormat,
    resolution,
    safetyTolerance,
    seed,
    outputDir,
    filenamePrefix,
  });
} else {
  console.error(`ERROR: Unknown backend '${backend}'`);
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
