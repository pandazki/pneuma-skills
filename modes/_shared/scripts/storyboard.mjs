#!/usr/bin/env node
/**
 * storyboard.mjs — compose-and-slice tool for ClipCraft Path C.
 *
 * Generates a composite N-cell storyboard image via gpt-image-2,
 * then slices it into N individual panel files via ffmpeg.
 *
 * See modes/clipcraft/skill/references/storyboard-workflow.md
 * (Path C section) for the conceptual workflow.
 *
 * Zero external deps — Node.js / Bun built-in APIs only. ffmpeg
 * must be available on PATH for slicing.
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ASPECTS = ["9:16", "16:9", "1:1"];
const PANEL_COUNTS = [4, 6, 8, 9, 12, 16];
const OUTPUT_FORMATS = ["png", "jpeg", "webp"];
const QUALITIES = ["low", "medium", "high"];

const USAGE = `Usage: storyboard.mjs --aspect <9:16|16:9|1:1> --panels <4|6|8|9|12|16> (--prompt <text> | --prompt-file <path>) [options]

Required:
  --aspect <ratio>            Target video aspect: ${ASPECTS.join(", ")}
  --panels <n>                Number of storyboard panels: ${PANEL_COUNTS.join(", ")}
  --prompt <text>             Per-panel prompt body (or use --prompt-file)
  --prompt-file <path>        Read per-panel prompt body from a file

Options:
  --out-dir <path>            Output directory (default: .)
  --name <baseName>           Slice filename base (default: panel)
  --ref <url>                 Reference image URL (repeatable). Switches to gpt-image-2/edit endpoint.
                              Local file paths are NOT supported in v1 — upload first and pass the URL.
  --no-annotations            Drop the annotation color-system block from the prompt prelude
  --keep-composite            Keep the composite image after slicing (default: true)
  --quality <low|medium|high> gpt-image-2 quality (default: high)
  --output-format <fmt>       ${OUTPUT_FORMATS.join(", ")} (default: png)
  --help, -h                  Show this help

Outputs (stdout):
  JSON with composite + panel slice paths, suggestedAssets[],
  suggestedProvenance[], finalPrompt. Stderr: progress logs.`;

function printUsage() {
  console.error(USAGE);
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const GRID_TABLE = {
  4:  { rows: 2, cols: 2 },              // square
  6:  { landscape: { rows: 2, cols: 3 }, portrait: { rows: 3, cols: 2 } },
  8:  { landscape: { rows: 2, cols: 4 }, portrait: { rows: 4, cols: 2 } },
  9:  { rows: 3, cols: 3 },              // square
  12: { landscape: { rows: 3, cols: 4 }, portrait: { rows: 4, cols: 3 } },
  16: { rows: 4, cols: 4 },              // square
};

/**
 * Pick a grid layout for the requested panel count + video aspect.
 * For aspect-flexible panel counts (6, 8, 12), grid orientation matches
 * the video orientation (16:9 → wide grid, 9:16 → tall grid). For 1:1,
 * treat as landscape.
 */
export function pickGrid(panels, aspect) {
  if (!ASPECTS.includes(aspect)) {
    throw new Error(`Unsupported aspect '${aspect}'. Choices: ${ASPECTS.join(", ")}`);
  }
  const entry = GRID_TABLE[panels];
  if (!entry) {
    throw new Error(`Unsupported panel count ${panels}. Supported: ${PANEL_COUNTS.join(", ")}`);
  }
  if (entry.rows && entry.cols) return entry;
  const orientation = aspect === "9:16" ? "portrait" : "landscape";
  return entry[orientation];
}

const IMAGE_SIZES = {
  square_hd:      { preset: "square_hd",      width: 1024, height: 1024 },
  landscape_16_9: { preset: "landscape_16_9", width: 1536, height: 1024 },
  portrait_16_9:  { preset: "portrait_16_9",  width: 1024, height: 1536 },
};

/**
 * Pick the gpt-image-2 output size for a chosen grid + video aspect.
 * The composite always matches the video orientation, regardless of
 * the grid's internal aspect ratio. The cells inside the composite
 * land at exact video aspect by construction (see computeBboxes).
 */
export function pickImageSize(grid, aspect) {
  if (aspect === "9:16") return IMAGE_SIZES.portrait_16_9;
  if (aspect === "16:9") return IMAGE_SIZES.landscape_16_9;
  if (aspect === "1:1")  return IMAGE_SIZES.square_hd;
  throw new Error(`Unsupported aspect '${aspect}'`);
}

/**
 * Compute panel bounding boxes for a grid laid out inside the
 * composite image. Each cell is exact video aspect ratio. Grid is
 * centered with uniform margins absorbing any size mismatch between
 * the chosen gpt-image-2 preset and the (cols x rows) of cells.
 */
export function computeBboxes(grid, imgSize, aspect) {
  const [vw, vh] = aspect.split(":").map(Number);
  const cellAspect = vw / vh;

  const maxCellW = Math.floor(imgSize.width / grid.cols);
  const maxCellH = Math.floor(imgSize.height / grid.rows);

  // Cell must satisfy: cellW / cellH = cellAspect.
  // Try fitting by width first; if that exceeds maxCellH, fit by height.
  let cellW = maxCellW;
  let cellH = Math.floor(cellW / cellAspect);
  if (cellH > maxCellH) {
    cellH = maxCellH;
    cellW = Math.floor(cellH * cellAspect);
  }

  const totalW = cellW * grid.cols;
  const totalH = cellH * grid.rows;
  const marginX = Math.floor((imgSize.width - totalW) / 2);
  const marginY = Math.floor((imgSize.height - totalH) / 2);

  const panels = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      panels.push({
        index: row * grid.cols + col + 1,
        row,
        col,
        bbox: {
          x: marginX + col * cellW,
          y: marginY + row * cellH,
          w: cellW,
          h: cellH,
        },
      });
    }
  }

  return { cellWidth: cellW, cellHeight: cellH, marginX, marginY, panels };
}

const ANNOTATION_BLOCK = `Annotations baked into each panel use this color vocabulary:
  - RED solid arrows: body movement / posture changes
  - BLUE dashed arrows: camera movement / framing arcs
  - GREEN brackets: key framing intersections (rule of thirds)
  - ORANGE sun-ray glyphs: lighting source + shadow direction
  - PURPLE eighth-note glyphs: emotional / musical beat markers
  - BLACK typewriter margin notes: lens / technical specs
Annotations should be visually clear without obscuring the subject.`;

/**
 * Assemble the final prompt: grid prelude + (optional annotation
 * color system) + faithfulness directive + user's per-panel content.
 */
export function assemblePrompt({ userPrompt, grid, aspect, includeAnnotations }) {
  const N = grid.rows * grid.cols;
  const orientation =
    aspect === "9:16" ? "portrait"
    : aspect === "16:9" ? "landscape"
    : "square";

  const lines = [
    `A clean storyboard sheet, ${grid.rows} rows by ${grid.cols} columns of numbered panels (${N} total).`,
    `Each cell is exactly ${aspect} aspect ratio (the target video aspect ratio). Composite orientation: ${orientation}.`,
    `Panels numbered 1 through ${N}, left-to-right top-to-bottom. Thin gutter between cells, neutral background.`,
    "",
  ];

  if (includeAnnotations) {
    lines.push(ANNOTATION_BLOCK, "");
  }

  lines.push(
    "CONSISTENCY RULE (STRICT): Character look, wardrobe, palette, and lighting language remain identical across all panels. No reinterpretation panel-to-panel.",
    "",
    "Per-panel content:",
    "",
    userPrompt,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// .env loading (copied verbatim from generate_image.mjs; see that file
// for the canonical version. Kept self-contained to match the
// "each script is self-contained" pattern of _shared/scripts/.)
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

// ---------------------------------------------------------------------------
// fal.ai queue helper (no SDK — direct REST). Copied verbatim from
// generate_image.mjs.
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

  const submitJson = await submitResp.json();
  const { request_id } = submitJson;
  // Use the URLs fal returns in the submit response — for some endpoints
  // (e.g. `openai/gpt-image-2/edit`) requests are queued under a parent
  // path (`openai/gpt-image-2`), so building from appId 404s.
  const statusUrl = submitJson.status_url ?? `${baseUrl}/requests/${request_id}/status`;
  const responseUrl = submitJson.response_url ?? `${baseUrl}/requests/${request_id}`;
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

  const resultResp = await fetch(responseUrl, { headers });
  if (!resultResp.ok) {
    const text = await resultResp.text();
    console.error(`ERROR: fal.ai result returned ${resultResp.status}: ${text}`);
    process.exit(1);
  }
  return await resultResp.json();
}

// ---------------------------------------------------------------------------
// Composite generation
// ---------------------------------------------------------------------------

async function downloadComposite(result, outputFormat, outputDir, tag) {
  mkdirSync(outputDir, { recursive: true });
  const images = Array.isArray(result.images) ? result.images : [];
  if (images.length === 0) {
    console.error(`ERROR: fal.ai returned no images for ${tag}`);
    process.exit(1);
  }
  const url = images[0].url;
  const filepath = join(outputDir, `composite.${outputFormat}`);
  const imgResp = await fetch(url);
  if (!imgResp.ok) {
    console.error(`ERROR: download failed ${imgResp.status} for ${url}`);
    process.exit(1);
  }
  writeFileSync(filepath, Buffer.from(await imgResp.arrayBuffer()));
  console.error(`[${tag}] composite saved: ${filepath}`);
  return { filepath, url };
}

async function generateComposite({
  apiKey, finalPrompt, imageSize, refs, quality, outputFormat, outputDir,
}) {
  const isEdit = Array.isArray(refs) && refs.length > 0;
  const appId = isEdit ? "openai/gpt-image-2/edit" : "openai/gpt-image-2";
  const tag = isEdit ? "fal:gpt-image-2/edit" : "fal:gpt-image-2";

  const payload = {
    prompt: finalPrompt,
    num_images: 1,
    quality,
    output_format: outputFormat,
    image_size: imageSize.preset,
  };
  if (isEdit) {
    payload.image_urls = refs;
  }

  const result = await falSubscribe({ apiKey, appId, payload, tag });
  const { filepath, url } = await downloadComposite(result, outputFormat, outputDir, tag);
  return { compositePath: filepath, compositeUrl: url, endpoint: appId };
}

// ---------------------------------------------------------------------------
// ffmpeg slicing
// ---------------------------------------------------------------------------

function ensureFfmpeg() {
  const res = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (res.status !== 0) {
    console.error("ERROR: ffmpeg not found on PATH. Install ffmpeg.");
    process.exit(1);
  }
}

function sliceComposite({ compositePath, panels, outputDir, baseName, format }) {
  const slices = [];
  for (const panel of panels) {
    const filename = `${baseName}-${String(panel.index).padStart(2, "0")}.${format}`;
    const outPath = join(outputDir, filename);
    const { x, y, w, h } = panel.bbox;
    const args = [
      "-y",
      "-i", compositePath,
      "-vf", `crop=${w}:${h}:${x}:${y}`,
      "-frames:v", "1",
      outPath,
    ];
    const res = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    if (res.status !== 0) {
      const stderr = res.stderr ? res.stderr.toString() : "";
      console.error(`ERROR: ffmpeg crop failed for panel ${panel.index}:\n${stderr}`);
      process.exit(1);
    }
    console.error(`[slice] panel ${panel.index} → ${outPath}`);
    slices.push({ ...panel, path: outPath });
  }
  return slices;
}

// Reject local file paths in --ref. The fal.ai edit endpoint requires
// remote URLs (or data: URLs) for image_urls; for v1 we don't auto-upload.
function validateRefs(refs) {
  if (!Array.isArray(refs)) return;
  for (const ref of refs) {
    if (!ref) continue;
    const isHttp = ref.startsWith("http://") || ref.startsWith("https://");
    const isData = ref.startsWith("data:");
    if (!isHttp && !isData) {
      console.error(
        `ERROR: --ref '${ref}' must be an http(s) URL or data: URI. Local file paths are not supported in v1 — upload first and pass the URL.`,
      );
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry detection — guard so test imports don't trigger side effects.
// ---------------------------------------------------------------------------

function isCliEntry() {
  // Bun: import.meta.main is true when the file is the entrypoint.
  if (typeof import.meta.main === "boolean") return import.meta.main;
  // Node: compare argv[1] to this module's resolved path.
  const entry = process.argv[1] ? resolve(process.argv[1]) : null;
  return entry === __filename;
}

// ---------------------------------------------------------------------------
// CLI body — only runs as the script entrypoint.
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  printUsage();
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      aspect:           { type: "string" },
      panels:           { type: "string" },
      prompt:           { type: "string" },
      "prompt-file":    { type: "string" },
      "out-dir":        { type: "string", default: "." },
      name:             { type: "string", default: "panel" },
      ref:              { type: "string", multiple: true },
      "no-annotations": { type: "boolean", default: false },
      "keep-composite": { type: "boolean", default: true },
      quality:          { type: "string", default: "high" },
      "output-format":  { type: "string", default: "png" },
      help:             { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const aspect = values.aspect;
  if (!aspect) fail("--aspect is required");
  if (!ASPECTS.includes(aspect)) {
    fail(`invalid --aspect '${aspect}'. Choices: ${ASPECTS.join(", ")}`);
  }

  const panelsRaw = values.panels;
  if (!panelsRaw) fail("--panels is required");
  const panelCount = Number.parseInt(panelsRaw, 10);
  if (!Number.isFinite(panelCount) || !PANEL_COUNTS.includes(panelCount)) {
    fail(`invalid --panels '${panelsRaw}'. Supported: ${PANEL_COUNTS.join(", ")}`);
  }

  if (!values.prompt && !values["prompt-file"]) {
    fail("either --prompt or --prompt-file is required");
  }
  if (values.prompt && values["prompt-file"]) {
    fail("--prompt and --prompt-file are mutually exclusive");
  }

  let userPrompt;
  if (values["prompt-file"]) {
    const promptPath = resolve(values["prompt-file"]);
    if (!existsSync(promptPath)) fail(`--prompt-file not found: ${promptPath}`);
    userPrompt = readFileSync(promptPath, "utf-8");
  } else {
    userPrompt = values.prompt;
  }
  if (!userPrompt || !userPrompt.trim()) {
    fail("prompt body is empty");
  }

  if (!QUALITIES.includes(values.quality)) {
    fail(`invalid --quality '${values.quality}'. Choices: ${QUALITIES.join(", ")}`);
  }
  if (!OUTPUT_FORMATS.includes(values["output-format"])) {
    fail(`invalid --output-format '${values["output-format"]}'. Choices: ${OUTPUT_FORMATS.join(", ")}`);
  }

  // The remaining pipeline (env loading, fal.ai call, ffmpeg slicing,
  // stdout JSON) is added in subsequent tasks.
}

if (isCliEntry()) {
  await main();
}
