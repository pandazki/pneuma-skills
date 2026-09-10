#!/usr/bin/env node
/** Generate and edit with GPT Image 2.5 via OpenRouter. Also the shared adapter for edit/storyboard. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2.5-sunburst";
export const DEFAULT_EDIT_IMAGE_MODEL = "openai/gpt-image-2.5-flare";
export const IMAGE_MODELS = [DEFAULT_IMAGE_MODEL, DEFAULT_EDIT_IMAGE_MODEL];
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"];
export const IMAGE_ASPECTS = ["auto", "21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
export const IMAGE_BACKGROUNDS = ["auto", "transparent", "opaque"];
const OUTPUT_FORMATS = ["png", "jpeg", "webp"];
/** Output formats that can carry the alpha channel `transparent` asks for. */
const ALPHA_FORMATS = ["png", "webp"];
const IMAGE_ENDPOINT = "https://openrouter.ai/api/v1/images";
const PRESET_SIZES = {
  square: "1024x1024", square_hd: "1024x1024",
  landscape_16_9: "1536x864", landscape_4_3: "1536x1152",
  portrait_16_9: "864x1536", portrait_4_3: "1152x1536",
};

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

export function loadEnvKeys() {
  const keys = {};

  // Check environment variables first
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
    if (key === "OPENROUTER_API_KEY" && value && !keys[key]) {
      keys[key] = value;
    }
  }
  return keys;
}

export function resolveImageModel(model = DEFAULT_IMAGE_MODEL) {
  const id = model.startsWith("openai/") ? model : `openai/${model}`;
  if (!IMAGE_MODELS.includes(id)) throw new Error(`Invalid --model. Choices: ${IMAGE_MODELS.join(", ")}`);
  return id;
}

export function imageReference(source) {
  if (/^https?:\/\//.test(source) || /^data:image\//.test(source)) return source;
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[extname(source).toLowerCase()];
  if (!mime) throw new Error(`Unsupported reference image format: ${source}`);
  return `data:${mime};base64,${readFileSync(source).toString("base64")}`;
}

export function buildImageRequest({
  prompt, model, numImages = 1, aspectRatio,
  imageSize, quality = "high", outputFormat = "png", imageUrls = [], maskUrl, background,
}) {
  if (!prompt?.trim()) throw new Error("A nonempty prompt is required");
  if (!Number.isInteger(numImages) || numImages < 1 || numImages > 10) throw new Error("--num-images must be an integer from 1 to 10");
  if (!IMAGE_QUALITIES.includes(quality)) throw new Error(`Invalid --quality. Choices: ${IMAGE_QUALITIES.join(", ")}`);
  if (!OUTPUT_FORMATS.includes(outputFormat)) throw new Error(`Invalid --output-format. Choices: ${OUTPUT_FORMATS.join(", ")}`);
  if (background != null) {
    if (!IMAGE_BACKGROUNDS.includes(background)) throw new Error(`Invalid --background. Choices: ${IMAGE_BACKGROUNDS.join(", ")}`);
    // A transparent render into a format without an alpha channel is paid
    // for and comes back opaque — refuse it here, not at the far end.
    if (background === "transparent" && !ALPHA_FORMATS.includes(outputFormat)) {
      throw new Error(`--background transparent needs --output-format ${ALPHA_FORMATS.join(" or ")} (${outputFormat} has no alpha channel)`);
    }
  }
  if (maskUrl) throw new Error("GPT Image 2.5 on OpenRouter does not expose mask edits. Use --image-urls with edit instructions, or --annotation for a visual guide.");
  if (imageUrls.length > 16) throw new Error("At most 16 reference images are supported");
  const body = { model: resolveImageModel(model ?? (imageUrls.length ? DEFAULT_EDIT_IMAGE_MODEL : DEFAULT_IMAGE_MODEL)), prompt, n: numImages, quality, output_format: outputFormat };
  // Omitted unless asked for: every caller that predates the flag keeps
  // sending byte-identical requests.
  if (background != null) body.background = background;
  if (imageSize) {
    const size = PRESET_SIZES[imageSize] ?? imageSize.toLowerCase();
    if (!/^[1-9]\d*x[1-9]\d*$/.test(size)) throw new Error("Invalid --image-size: expected WxH or a supported preset");
    // Explicit pixels are authoritative; a competing aspect/resolution causes a 400.
    body.size = size;
  } else {
    aspectRatio ??= imageUrls.length ? "auto" : "1:1";
    if (!IMAGE_ASPECTS.includes(aspectRatio)) throw new Error(`Invalid --aspect-ratio. Choices: ${IMAGE_ASPECTS.join(", ")}`);
    body.aspect_ratio = aspectRatio;
  }
  if (imageUrls.length) body.input_references = imageUrls.map((source) => ({ type: "image_url", image_url: { url: imageReference(source) } }));
  return body;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Whether these image bytes can carry transparency — read out of the
 * container's own header, with no decoder and no ffmpeg:
 *
 *   PNG   colour type 4 (grey+alpha) or 6 (RGBA), or a `tRNS` chunk ahead
 *         of the pixel data (a palette image with a transparent index);
 *   WebP  the VP8X alpha flag, or the `alpha_is_used` bit of a VP8L header;
 *   JPEG  never — it has no alpha channel at all.
 *
 * Unknown or truncated bytes answer `false`: this reports what is proven,
 * never what is hoped for.
 */
export function hasAlphaChannel(image) {
  if (!image?.length) return false;
  const bytes = Buffer.isBuffer(image)
    ? image
    : ArrayBuffer.isView(image)
      ? Buffer.from(image.buffer, image.byteOffset, image.byteLength)
      : Buffer.from(image);

  if (bytes.length >= 26 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const colorType = bytes[25];
    if (colorType === 4 || colorType === 6) return true;
    for (let offset = 8; offset + 8 <= bytes.length; ) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (type === "tRNS") return true;
      // tRNS must precede the pixel data; past IDAT there is nothing to find.
      if (type === "IDAT" || type === "IEND") return false;
      offset += 12 + length;
    }
    return false;
  }

  if (bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X") return bytes.length > 20 && (bytes[20] & 0x10) !== 0;
    // VP8L: a 0x2f signature, then 14 bits width, 14 height, then alpha_is_used.
    if (chunk === "VP8L") return bytes.length >= 25 && bytes[20] === 0x2f && ((bytes.readUInt32LE(21) >>> 28) & 1) === 1;
    return false; // VP8 (lossy, no alpha) or a container we cannot read.
  }

  return false;
}

/** One request only: a lost response may still have incurred a generation charge. */
export async function generateImage(options, { fetchImpl = fetch } = {}) {
  const { apiKey, outputDir = ".", filenamePrefix = "illustration", signal } = options;
  const body = buildImageRequest(options);
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not found. Add it to the skill .env or environment for GPT Image 2.5.");
  console.error(`[openrouter:${body.model}] Sending request...`);
  const response = await fetchImpl(IMAGE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600_000)]) : AbortSignal.timeout(600_000),
  });
  if (!response.ok) throw new Error(`OpenRouter Images API returned ${response.status}: ${await response.text()}`);
  const result = await response.json();
  if (result.error) throw new Error(`OpenRouter image generation failed: ${result.error.message ?? JSON.stringify(result.error)}`);
  const images = result.data;
  if (!Array.isArray(images) || !images.length) throw new Error("No image returned from OpenRouter Images API");
  const decoded = images.slice(0, body.n).map((img) => {
    if (typeof img.b64_json !== "string" || !img.b64_json.length) throw new Error("OpenRouter returned an image without base64 data");
    const bytes = Buffer.from(img.b64_json, "base64");
    if (!bytes.length) throw new Error("OpenRouter returned empty image data");
    // Name files by the actual response format, even if a provider ignores output_format.
    const detected = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
      : bytes[0] === 255 && bytes[1] === 216 ? "jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
    const format = detected ?? { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" }[img.media_type];
    if (!format) throw new Error("OpenRouter returned an unsupported or unrecognized image format");
    return { bytes, format };
  });
  mkdirSync(outputDir, { recursive: true });
  const files = decoded.map(({ bytes, format }, i) => {
    const suffix = decoded.length > 1 ? `_${i + 1}` : "";
    const filepath = join(outputDir, `${filenamePrefix}${suffix}.${format}`);
    writeFileSync(filepath, bytes);
    console.error(`[openrouter] Saved: ${filepath}`);
    return filepath;
  });
  const output = { backend: "openrouter", model: body.model, endpoint: IMAGE_ENDPOINT, files, urls: [], description: "", usage: result.usage };
  if (body.background === "transparent") {
    // The provider may ignore the request and hand back a flat background.
    // Whoever cuts these frames up needs to know which one they got.
    const opaque = decoded.flatMap(({ bytes }, i) => (hasAlphaChannel(bytes) ? [] : [files[i]]));
    output.hasAlpha = opaque.length === 0;
    if (opaque.length) console.error(`WARN: --background transparent was requested but ${opaque.join(", ")} came back without an alpha channel`);
  }
  return output;
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, options: {
    model: { type: "string" },
    "num-images": { type: "string", default: "1" },
    "aspect-ratio": { type: "string" },
    "output-format": { type: "string", default: "png" },
    background: { type: "string" },
    quality: { type: "string" },
    "image-size": { type: "string" },
    "image-urls": { type: "string", multiple: true },
    "mask-url": { type: "string" },
    style: { type: "string", default: "photo" },
    "output-dir": { type: "string", default: "." },
    "filename-prefix": { type: "string", default: "illustration" },
    backend: { type: "string" },
    help: { type: "boolean", short: "h" },
  }, allowPositionals: true });
  if (values.help) {
    console.error(`Usage: generate_image.mjs <prompt> [options]

  --model <name>             ${IMAGE_MODELS.join(", ")}
                             Default: Sunburst for generation, Flare with references; openai/ prefix optional
  --num-images <1-10>        Number of images (default: 1)
  --aspect-ratio <ratio>     ${IMAGE_ASPECTS.join(", ")} (default: 1:1; auto for edits)
  --image-size <preset|WxH>  Explicit size; overrides --aspect-ratio
  --quality <level>         ${IMAGE_QUALITIES.join(", ")} (default: high)
  --output-format <fmt>     png, jpeg, webp (default: png)
  --background <mode>       ${IMAGE_BACKGROUNDS.join(", ")} (omitted unless passed)
                            transparent requires --output-format png or webp; the
                            JSON result then reports hasAlpha for what actually arrived
  --image-urls <source>     Reference URL, data URI, or local path (repeatable, up to 16)
  --style <sketch|photo>    sketch appends line-art direction; defaults quality to low
  --output-dir <path>       Output directory (default: .)
  --filename-prefix <name>  Filename prefix (default: illustration)
  --backend openrouter     Optional explicit backend (OpenRouter only)

Requires OPENROUTER_API_KEY. Generate and edit both use /api/v1/images.
Mask edits, Gemini resolution tiers, seed and safety-tolerance are not supported.
JSON stdout reports the actual model and saved file paths; progress goes to stderr.`);
    return;
  }
  if (positionals.length !== 1) throw new Error("Usage: generate_image.mjs <prompt> [options] (prompt is positional)");
  if (values.backend && values.backend !== "openrouter") throw new Error("GPT Image 2.5 uses --backend openrouter and OPENROUTER_API_KEY");
  if (!["photo", "sketch"].includes(values.style)) throw new Error("Invalid --style: expected sketch or photo");
  const sketch = values.style === "sketch";
  const prompt = sketch ? `${positionals[0]} in clean black-and-white pencil sketch style, line art, no shading, white background` : positionals[0];
  const result = await generateImage({
    apiKey: loadEnvKeys().OPENROUTER_API_KEY,
    prompt, model: values.model, numImages: Number(values["num-images"]),
    aspectRatio: values["aspect-ratio"], imageSize: values["image-size"],
    quality: values.quality ?? (sketch ? "low" : "high"), outputFormat: values["output-format"], background: values.background,
    imageUrls: values["image-urls"] ?? [], maskUrl: values["mask-url"],
    outputDir: values["output-dir"], filenamePrefix: values["filename-prefix"],
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main ?? (process.argv[1] && resolve(process.argv[1]) === __filename)) {
  main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}
