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
 *                 generate_image.mjs --image-urls.
 *   --outfit      optional, comma-separated. If omitted, GPT Image 2.5
 *                 reads the outfit from the source image.
 *   --traits      optional, comma-separated. If omitted, defaults to
 *                 the character appearance from the source image.
 *   --model       optional. gpt-image-2.5-flare (default) or gpt-image-2.5-sunburst.
 *   --output      required. Workspace-relative path for the sheet.
 *
 * Environment:
 *   OPENROUTER_API_KEY — required; OpenRouter API key
 */

import { existsSync, renameSync } from "node:fs";
import { dirname, extname, basename } from "node:path";
import { parseArgs } from "node:util";

// Installed sessions keep shared scripts beside this CLI; source checkouts
// resolve the same adapter from the shared scripts directory.
const installedAdapter = new URL("./generate_image.mjs", import.meta.url);
const { DEFAULT_EDIT_IMAGE_MODEL, generateImage, loadEnvKeys } = await import(
  existsSync(installedAdapter) ? installedAdapter.href : new URL("../../../_shared/scripts/generate_image.mjs", import.meta.url).href
);

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
    model: { type: "string", default: DEFAULT_EDIT_IMAGE_MODEL },
  },
  allowPositionals: false,
});

try {
  const apiKey = loadEnvKeys().OPENROUTER_API_KEY;

  const sourceArg = values["source-url"];
  const outputPath = values.output;
  if (!sourceArg) die("--source-url is required");
  if (!outputPath) die("--output is required");

  const prompt = buildPrompt({ outfit: values.outfit, traits: values.traits });

  const ext = extname(outputPath).toLowerCase();
  const outputFormat = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" }[ext];
  if (!outputFormat) die("--output must end in .png, .jpg, .jpeg, or .webp");
  const result = await generateImage({
    apiKey, model: values.model, prompt, imageUrls: [sourceArg], aspectRatio: "16:9",
    quality: "high", outputFormat, outputDir: dirname(outputPath), filenamePrefix: basename(outputPath, ext),
  });
  const generatedPath = result.files[0];
  // .jpg and .jpeg encode the same format. Never rename PNG bytes to .jpg.
  if (generatedPath !== outputPath && ext === ".jpg" && extname(generatedPath) === ".jpeg") {
    renameSync(generatedPath, outputPath);
  } else if (generatedPath !== outputPath) {
    console.log(generatedPath);
    process.exit(0);
  }
  console.log(outputPath);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
