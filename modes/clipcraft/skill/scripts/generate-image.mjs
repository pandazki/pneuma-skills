#!/usr/bin/env node

/**
 * ClipCraft Image Generator CLI
 *
 * Plain argv CLI wrapping fal.ai nano-banana-2 for text->image generation
 * and nano-banana-2/edit for image->image edits. Prints the output path on
 * success (exit 0); prints errors to stderr on failure (exit 1).
 *
 * Usage:
 *   node generate-image.mjs --prompt "..." --output assets/image/out.jpg \
 *     [--width 1920] [--height 1080] [--style "cinematic"]
 *
 *   node generate-image.mjs edit --source-url "https://..." \
 *     --instructions "make it darker" --output assets/image/out.jpg
 *
 * Environment:
 *   FAL_KEY  — required; fal.ai API key
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Aspect ratio mapping (verbatim from legacy clipcraft-imagegen.mjs)
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "3:2", ratio: 3 / 2 },
];

function mapToAspectRatio(width, height) {
  if (!width || !height) return "auto";
  const target = width / height;
  let best = "auto";
  let bestDiff = Infinity;
  for (const { label, ratio } of ASPECT_RATIOS) {
    const diff = Math.abs(target - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = label;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// MIME type helper (verbatim from legacy)
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

const FAL_GENERATE_URL = "https://fal.run/fal-ai/nano-banana-2";
const FAL_EDIT_URL = "https://fal.run/fal-ai/nano-banana-2/edit";

async function falGenerate(prompt, aspectRatio, apiKey) {
  const res = await fetch(FAL_GENERATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
      output_format: "jpeg",
      resolution: "1K",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai generation failed (${res.status}): ${body}`);
  }

  return res.json(); // { images: [{ url, file_name, content_type }], description }
}

async function falEdit(prompt, imageUrl, apiKey) {
  const res = await fetch(FAL_EDIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_urls: [imageUrl],
      num_images: 1,
      output_format: "jpeg",
      resolution: "1K",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai edit failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function downloadImage(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image (${res.status})`);

  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function runGenerate(args) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) die("FAL_KEY is not set");

  const { prompt, output, width, height, style } = args;
  if (!prompt) die("--prompt is required");
  if (!output) die("--output is required");

  const fullPrompt = style ? `${prompt}, ${style} style` : prompt;
  const w = width ? Number(width) : undefined;
  const h = height ? Number(height) : undefined;
  const aspectRatio = mapToAspectRatio(w, h);

  const result = await falGenerate(fullPrompt, aspectRatio, apiKey);
  const imageUrl = result.images?.[0]?.url;
  if (!imageUrl) die("fal.ai returned no image");

  await downloadImage(imageUrl, output);
  console.log(output);
}

async function runEdit(args) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) die("FAL_KEY is not set");

  const sourceUrl = args["source-url"];
  const { instructions, output } = args;
  if (!sourceUrl) die("edit requires --source-url");
  if (!instructions) die("edit requires --instructions");
  if (!output) die("edit requires --output");

  let url = sourceUrl;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    // Local file → base64 data URI
    try {
      const buf = readFileSync(url);
      url = `data:${mimeFromExt(sourceUrl)};base64,${buf.toString("base64")}`;
    } catch (err) {
      die(`Failed to read source image: ${err.message}`);
    }
  }

  const result = await falEdit(instructions, url, apiKey);
  const outUrl = result.images?.[0]?.url;
  if (!outUrl) die("fal.ai returned no edited image");

  await downloadImage(outUrl, output);
  console.log(output);
}

const rawArgv = process.argv.slice(2);
const subcommand = rawArgv[0] === "edit" ? "edit" : "generate";
const argvForParse = subcommand === "edit" ? rawArgv.slice(1) : rawArgv;

const { values } = parseArgs({
  args: argvForParse,
  options: {
    prompt: { type: "string" },
    output: { type: "string" },
    width: { type: "string" },
    height: { type: "string" },
    style: { type: "string" },
    "source-url": { type: "string" },
    instructions: { type: "string" },
  },
  allowPositionals: false,
});

try {
  if (subcommand === "edit") {
    await runEdit(values);
  } else {
    await runGenerate(values);
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
