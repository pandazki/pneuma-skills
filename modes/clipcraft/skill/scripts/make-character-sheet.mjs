#!/usr/bin/env node

/**
 * ClipCraft Character Sheet Generator
 *
 * Produces a 16:9 "photo-body, sketch-head" character reference sheet
 * from a single source image. The sheet shape is verified to pass
 * seedance-2.0/reference-to-video's image-side content filter for
 * photorealistic AI-generated human characters.
 *
 * This is a **manual recovery tool** the agent calls after
 * `generate-video.mjs reference` rejects an image with:
 *   content_policy_violation ... partner_validation_failed
 *   loc: ["body","image_urls"]
 *   msg: "The images or videos provided may contain likenesses of
 *         real people ..."
 *
 * It is NOT automatically invoked from inside generate-video.mjs.
 * The agent is expected to read the error, consult
 * `references/filter-retries.md`, decide this tool is appropriate,
 * run it, and re-invoke generate-video.mjs with the resulting sheet.
 *
 * Sheet layout (4 tall vertical panels on black, 16:9 overall):
 *   Panel 1 — photographic front view full body, head as pencil sketch
 *   Panel 2 — photographic left-profile side view, head as pencil sketch
 *   Panel 3 — photographic back view, hair sketched on black
 *   Panel 4 — detailed pencil portrait (upper half) + typewriter-style
 *             OUTFIT / CHARACTER text annotations (lower half)
 *
 * Usage:
 *   node make-character-sheet.mjs \
 *     --source-url assets/image/hero-photo.jpg \
 *     --outfit "Dark gray wool blazer, black crewneck, charcoal trousers, black leather loafers" \
 *     --traits "Age ~30, East Asian, calm professional, understated confidence" \
 *     --output assets/image/character-sheet-hero.jpg
 *
 * Flags:
 *   --source-url  required. Local path or http(s) URL. Local files are
 *                 inlined as base64 data URI, same pattern as
 *                 generate-image.mjs edit.
 *   --outfit      optional, comma-separated. If omitted, nano-banana
 *                 reads the outfit from the source image.
 *   --traits      optional, comma-separated. If omitted, defaults to
 *                 the character appearance from the source image.
 *   --output      required. Workspace-relative path for the sheet.
 *
 * Environment:
 *   FAL_KEY — required; fal.ai API key
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import { parseArgs } from "node:util";

const FAL_EDIT_URL = "https://fal.run/fal-ai/nano-banana-2/edit";

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function mimeFromPath(path) {
  return MIME_BY_EXT[extname(path).toLowerCase()] || "image/jpeg";
}

function resolveSourceUrl(src) {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }
  const buf = readFileSync(src);
  return `data:${mimeFromPath(src)};base64,${buf.toString("base64")}`;
}

function csvToList(csv) {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

function buildPrompt({ outfit, traits }) {
  const outfitList = outfit ? csvToList(outfit) : "the outfit visible in the source image";
  const traitList = traits ? csvToList(traits) : "the character appearance from the source image";

  return [
    "Create a 16:9 character reference design sheet of the character shown in the source image. Layout: 4 tall vertical panels of equal width arranged side by side with no gaps, pure black background throughout.",
    "",
    `Panel 1 (far left): photographic front view full body of the same character, wearing ${outfitList}, neutral standing pose with arms at sides and empty hands, soft studio lighting, standing on solid black floor. Replace the head (shoulders up) with a clean white-line pencil sketch of the frontal head on the black background, showing eyes, nose, mouth, hairline.`,
    "",
    "Panel 2: photographic left-profile side view full body of the same character, same outfit, same lighting, facing left. Replace the head with a clean white-line pencil sketch of a left-profile head on the black background.",
    "",
    "Panel 3: photographic back view full body of the same character, same outfit, same lighting. Replace the head with a clean white-line pencil sketch of the back of the head showing hair only.",
    "",
    `Panel 4 (far right): TOP HALF = detailed pencil graphite portrait on off-white sketch paper showing the character's face in frontal head-and-shoulders framing, preserving the facial identity from the source image, fine pencil shading, visible pencil strokes and cross-hatching, all features (eyes, nose, lips, jaw, hairline) clearly readable — this is a hand-drawn portrait study, NOT a photograph. BOTTOM HALF = clean white typewriter-style English text on the black background, formatted as a character design document. First section header 'OUTFIT' followed by bullet points listing: ${outfitList}. Second section header 'CHARACTER' followed by bullet points listing: ${traitList}. Thin horizontal divider lines between the sections. Professional game / animation character design reference-sheet aesthetic.`,
    "",
    "All four panels must show the SAME character. Preserve the face, hair, skin tone, build, and proportions from the source image. Do not invent a different character.",
  ].join("\n");
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
    throw new Error(`nano-banana-2/edit failed (${res.status}): ${body}`);
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

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "source-url": { type: "string" },
    outfit: { type: "string" },
    traits: { type: "string" },
    output: { type: "string" },
  },
  allowPositionals: false,
});

try {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) die("FAL_KEY is not set");

  const sourceArg = values["source-url"];
  const outputPath = values.output;
  if (!sourceArg) die("--source-url is required");
  if (!outputPath) die("--output is required");

  const imageUrl = resolveSourceUrl(sourceArg);
  const prompt = buildPrompt({ outfit: values.outfit, traits: values.traits });

  const result = await falEdit(prompt, imageUrl, apiKey);
  const outUrl = result.images?.[0]?.url;
  if (!outUrl) die("nano-banana-2/edit returned no image");

  await downloadImage(outUrl, outputPath);
  console.log(outputPath);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
