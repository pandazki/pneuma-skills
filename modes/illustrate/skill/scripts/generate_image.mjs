#!/usr/bin/env node
/**
 * Generate images using Gemini 3 Pro Image Preview via fal.ai or OpenRouter.
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
    if ((key === "FAL_KEY" || key === "OPENROUTER_API_KEY") && value) {
      keys[key] = value;
    }
  }
  return keys;
}

function detectBackend(keys) {
  if (keys.OPENROUTER_API_KEY) return "openrouter";
  if (keys.FAL_KEY) return "fal";
  return "none";
}

// ---------------------------------------------------------------------------
// OpenRouter backend
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
  let imageInstruction = "";
  if (numImages > 1)
    imageInstruction = ` Generate ${numImages} different variations.`;

  const body = {
    model: "google/gemini-3-pro-image-preview",
    messages: [{ role: "user", content: `${prompt}${imageInstruction}` }],
    modalities: ["image", "text"],
  };

  const imageConfig = {};
  if (aspectRatio && aspectRatio !== "auto")
    imageConfig.aspect_ratio = aspectRatio;
  if (resolution) imageConfig.image_size = resolution;
  if (Object.keys(imageConfig).length) body.image_config = imageConfig;

  console.error("[openrouter] Sending request...");
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
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

  // Extract image data
  let imagesData = [];

  // Format 1: message.images[]
  if (message.images) {
    for (const img of message.images) {
      const url = img.image_url?.url ?? "";
      if (url) imagesData.push(url);
    }
  }
  // Format 2: message.content as array with image parts
  else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "image_url") {
        const url = part.image_url?.url ?? "";
        if (url) imagesData.push(url);
      }
    }
  }

  // Cap to requested number of images (model may return more)
  imagesData = imagesData.slice(0, numImages);

  for (let i = 0; i < imagesData.length; i++) {
    const imageUrl = imagesData[i];
    const suffix = imagesData.length > 1 ? `_${i + 1}` : "";
    const filename = `${filenamePrefix}${suffix}.${outputFormat}`;
    const filepath = join(outputDir, filename);

    if (imageUrl.startsWith("data:")) {
      // base64 data URL: data:image/png;base64,xxxxx
      const b64data = imageUrl.split(",")[1];
      writeFileSync(filepath, Buffer.from(b64data, "base64"));
    } else {
      // Remote URL
      const imgResp = await fetch(imageUrl);
      writeFileSync(filepath, Buffer.from(await imgResp.arrayBuffer()));
      urls.push(imageUrl);
    }

    savedFiles.push(filepath);
    console.error(`[openrouter] Saved: ${filepath}`);
  }

  // Extract text description if present
  let description = "";
  if (typeof message.content === "string") {
    description = message.content;
  } else if (Array.isArray(message.content)) {
    description = message.content
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  }

  return { backend: "openrouter", files: savedFiles, urls, description };
}

// ---------------------------------------------------------------------------
// fal.ai backend (direct REST API, no SDK needed)
// ---------------------------------------------------------------------------

async function generateViaFal({
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
  const appId = "fal-ai/gemini-3-pro-image-preview";
  const baseUrl = `https://queue.fal.run/${appId}`;

  const payload = {
    prompt,
    num_images: numImages,
    aspect_ratio: aspectRatio,
    output_format: outputFormat,
    safety_tolerance: safetyTolerance,
    resolution,
  };
  if (seed != null) payload.seed = seed;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Key ${apiKey}`,
  };

  // Submit to queue
  console.error("[fal] Sending request...");
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

  // Poll for completion
  const statusUrl = `${baseUrl}/requests/${request_id}/status`;
  while (true) {
    const statusResp = await fetch(`${statusUrl}?logs=1`, { headers });
    const status = await statusResp.json();

    if (status.status === "COMPLETED") break;
    if (status.status === "FAILED") {
      console.error(
        `ERROR: fal.ai generation failed: ${status.error ?? "unknown"}`,
      );
      process.exit(1);
    }

    if (status.logs?.length) {
      for (const log of status.logs) {
        console.error(`  [log] ${log.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Fetch result
  const resultResp = await fetch(`${baseUrl}/requests/${request_id}`, {
    headers,
  });
  const result = await resultResp.json();

  mkdirSync(outputDir, { recursive: true });
  const savedFiles = [];

  for (let i = 0; i < (result.images ?? []).length; i++) {
    const url = result.images[i].url;
    const suffix = numImages > 1 ? `_${i + 1}` : "";
    const filename = `${filenamePrefix}${suffix}.${outputFormat}`;
    const filepath = join(outputDir, filename);

    const imgResp = await fetch(url);
    writeFileSync(filepath, Buffer.from(await imgResp.arrayBuffer()));
    savedFiles.push(filepath);
    console.error(`[fal] Saved: ${filepath}`);
  }

  return {
    backend: "fal",
    files: savedFiles,
    urls: (result.images ?? []).map((img) => img.url),
    description: result.description ?? "",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  "auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16",
];
const OUTPUT_FORMATS = ["jpeg", "png", "webp"];
const RESOLUTIONS = ["1K", "2K", "4K"];

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "num-images":       { type: "string", default: "1" },
    "aspect-ratio":     { type: "string", default: "1:1" },
    "output-format":    { type: "string", default: "png" },
    resolution:         { type: "string", default: "1K" },
    "safety-tolerance": { type: "string", default: "4" },
    seed:               { type: "string" },
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

Options:
  --num-images <1-4>          Number of images (default: 1)
  --aspect-ratio <ratio>      ${ASPECT_RATIOS.join(", ")} (default: 1:1)
  --output-format <fmt>       ${OUTPUT_FORMATS.join(", ")} (default: png)
  --resolution <res>          ${RESOLUTIONS.join(", ")} (default: 1K)
  --safety-tolerance <1-6>    fal.ai only (default: 4)
  --seed <int>                fal.ai only
  --output-dir <path>         Output directory (default: .)
  --filename-prefix <prefix>  Filename prefix (default: illustration)
  --backend <fal|openrouter>  Force backend (default: auto-detect)`,
  );
  process.exit(positionals.length === 0 ? 1 : 0);
}

const prompt = positionals[0];
const numImages = parseInt(values["num-images"], 10);
const aspectRatio = values["aspect-ratio"];
const outputFormat = values["output-format"];
const resolution = values.resolution;
const safetyTolerance = values["safety-tolerance"];
const seed = values.seed != null ? parseInt(values.seed, 10) : null;
const outputDir = values["output-dir"];
const filenamePrefix = values["filename-prefix"];

// Validate
if (numImages < 1 || numImages > 4) {
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

const keys = loadEnvKeys();
const backend = values.backend ?? detectBackend(keys);

if (backend === "none") {
  console.error("ERROR: No API key found in .env file.");
  console.error("Please add one of the following to the .env file in the skill directory:");
  console.error("  OPENROUTER_API_KEY=your_openrouter_key   (https://openrouter.ai/keys)");
  console.error("  FAL_KEY=your_fal_key                     (https://fal.ai/dashboard/keys)");
  process.exit(1);
}

console.error(`[router] Using backend: ${backend}`);

let result;
if (backend === "openrouter") {
  result = await generateViaOpenrouter({
    apiKey: keys.OPENROUTER_API_KEY,
    prompt, numImages, aspectRatio, resolution, outputFormat, outputDir, filenamePrefix,
  });
} else if (backend === "fal") {
  result = await generateViaFal({
    apiKey: keys.FAL_KEY,
    prompt, numImages, aspectRatio, outputFormat, resolution, safetyTolerance, seed, outputDir, filenamePrefix,
  });
} else {
  console.error(`ERROR: Unknown backend '${backend}'`);
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
