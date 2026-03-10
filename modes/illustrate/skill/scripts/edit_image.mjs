#!/usr/bin/env node
/**
 * Edit/modify an existing image using Gemini vision + image generation via OpenRouter.
 * Sends the original image (+ optional highlighter annotation) with modification instructions.
 * Zero external dependencies — uses only Node.js / Bun built-in APIs.
 *
 * Usage:
 *   node edit_image.mjs "Make the background darker" \
 *     --input image.png \
 *     --annotation annotation-crop.png \   # optional: highlighter region
 *     --output-dir ./images \
 *     --filename-prefix edited-v1
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// .env loading (shared logic with generate_image.mjs)
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

function loadEnvKeys() {
  const keys = {};
  for (const name of ["OPENROUTER_API_KEY"]) {
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
    if (key === "OPENROUTER_API_KEY" && value) {
      keys[key] = value;
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Image encoding
// ---------------------------------------------------------------------------

function imageToBase64DataUrl(filepath) {
  const ext = extname(filepath).toLowerCase().replace(".", "");
  const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const mime = mimeMap[ext] || "image/png";
  const data = readFileSync(filepath);
  const b64 = data.toString("base64");
  return `data:${mime};base64,${b64}`;
}

// ---------------------------------------------------------------------------
// OpenRouter image edit
// ---------------------------------------------------------------------------

async function editViaOpenrouter({
  apiKey,
  prompt,
  inputPath,
  annotationPath,
  aspectRatio,
  resolution,
  outputFormat,
  outputDir,
  filenamePrefix,
}) {
  // Build message content parts
  const contentParts = [];

  // Text prompt first (as recommended by OpenRouter docs)
  contentParts.push({ type: "text", text: prompt });

  // Original image
  const inputDataUrl = imageToBase64DataUrl(inputPath);
  contentParts.push({
    type: "image_url",
    image_url: { url: inputDataUrl },
  });

  // Annotation/highlighter region (if provided)
  if (annotationPath) {
    const annotationDataUrl = imageToBase64DataUrl(annotationPath);
    contentParts.push({
      type: "image_url",
      image_url: { url: annotationDataUrl },
    });
  }

  const body = {
    model: "google/gemini-3.1-flash-image-preview",
    messages: [{ role: "user", content: contentParts }],
    modalities: ["image", "text"],
  };

  const imageConfig = {};
  if (aspectRatio && aspectRatio !== "auto") imageConfig.aspect_ratio = aspectRatio;
  if (resolution) imageConfig.image_size = resolution;
  if (Object.keys(imageConfig).length) body.image_config = imageConfig;

  console.error("[edit] Sending request to OpenRouter...");
  console.error(`[edit] Input: ${inputPath}`);
  if (annotationPath) console.error(`[edit] Annotation: ${annotationPath}`);
  console.error(`[edit] Prompt: ${prompt}`);

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

  // Extract image data (same as generate_image.mjs)
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

  if (imagesData.length === 0) {
    console.error("ERROR: No image returned from model.");
    console.error("Model response:", JSON.stringify(message, null, 2).slice(0, 500));
    process.exit(1);
  }

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
    console.error(`[edit] Saved: ${filepath}`);
  }

  // Extract text description
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
// Main
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  "auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16",
  "1:4", "4:1", "1:8", "8:1",
];
const OUTPUT_FORMATS = ["jpeg", "png", "webp"];
const RESOLUTIONS = ["0.5K", "1K", "2K", "4K"];

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    input:              { type: "string", short: "i" },
    annotation:         { type: "string", short: "a" },
    "aspect-ratio":     { type: "string", default: "auto" },
    "output-format":    { type: "string", default: "png" },
    resolution:         { type: "string", default: "1K" },
    "output-dir":       { type: "string", default: "." },
    "filename-prefix":  { type: "string", default: "edited" },
    help:               { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0 || !values.input) {
  console.error(
    `Usage: edit_image.mjs <modification prompt> --input <image> [options]

Arguments:
  <prompt>                            Modification instructions

Required:
  --input, -i <path>                  Original image to modify

Options:
  --annotation, -a <path>             Highlighter region crop (sent as 2nd image)
  --aspect-ratio <ratio>              ${ASPECT_RATIOS.join(", ")} (default: auto)
  --output-format <fmt>               ${OUTPUT_FORMATS.join(", ")} (default: png)
  --resolution <res>                  ${RESOLUTIONS.join(", ")} (default: 1K)
  --output-dir <path>                 Output directory (default: .)
  --filename-prefix <prefix>          Filename prefix (default: edited)

Examples:
  # Simple edit
  edit_image.mjs "Make the background darker" -i logo.png

  # Edit with highlighter annotation (region circled by user)
  edit_image.mjs "Fix the highlighted area — make it sharper" \\
    -i logo.png -a region-crop.png

  # With format options
  edit_image.mjs "Change colors to blue palette" \\
    -i logo.png --aspect-ratio 1:1 --resolution 2K`
  );
  process.exit(positionals.length === 0 ? 1 : 0);
}

const prompt = positionals[0];
const inputPath = values.input;
const annotationPath = values.annotation || null;
const aspectRatio = values["aspect-ratio"];
const outputFormat = values["output-format"];
const resolution = values.resolution;
const outputDir = values["output-dir"];
const filenamePrefix = values["filename-prefix"];

// Validate
if (!existsSync(inputPath)) {
  console.error(`ERROR: Input image not found: ${inputPath}`);
  process.exit(1);
}
if (annotationPath && !existsSync(annotationPath)) {
  console.error(`ERROR: Annotation image not found: ${annotationPath}`);
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
if (!keys.OPENROUTER_API_KEY) {
  console.error("ERROR: OPENROUTER_API_KEY not found.");
  console.error("Image editing requires OpenRouter. Add OPENROUTER_API_KEY to .env.");
  process.exit(1);
}

const result = await editViaOpenrouter({
  apiKey: keys.OPENROUTER_API_KEY,
  prompt,
  inputPath,
  annotationPath,
  aspectRatio,
  resolution,
  outputFormat,
  outputDir,
  filenamePrefix,
});

console.log(JSON.stringify(result, null, 2));
