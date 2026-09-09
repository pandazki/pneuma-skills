#!/usr/bin/env node
/**
 * storyboard.mjs — compose-and-slice tool for ClipCraft Path C.
 *
 * Generates a composite N-cell storyboard image via GPT Image 2.5 on OpenRouter,
 * then slices it into N individual panel files via ffmpeg.
 *
 * See modes/clipcraft/skill/references/storyboard-workflow.md
 * (Path C section) for the conceptual workflow.
 *
 * Zero external deps — Node.js / Bun built-in APIs only. ffmpeg
 * must be available on PATH for slicing.
 */

import {
  readFileSync, mkdirSync, existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { DEFAULT_IMAGE_MODEL, DEFAULT_EDIT_IMAGE_MODEL, IMAGE_QUALITIES, generateImage, loadEnvKeys, resolveImageModel } from "./generate_image.mjs";

const __filename = fileURLToPath(import.meta.url);

const ASPECTS = ["9:16", "16:9", "1:1"];
const PANEL_COUNTS = [4, 6, 8, 9, 12, 16];
const OUTPUT_FORMATS = ["png", "jpeg", "webp"];
const QUALITIES = IMAGE_QUALITIES;

const USAGE = `Usage: storyboard.mjs --aspect <9:16|16:9|1:1> --panels <4|6|8|9|12|16> (--prompt <text> | --prompt-file <path>) [options]

Required:
  --aspect <ratio>            Target video aspect: ${ASPECTS.join(", ")}
  --panels <n>                Number of storyboard panels: ${PANEL_COUNTS.join(", ")}
  --prompt <text>             Per-panel prompt body (or use --prompt-file)
  --prompt-file <path>        Read per-panel prompt body from a file

Options:
  --out-dir <path>            Output directory (default: .)
  --name <baseName>           Slice filename base (default: panel)
  --ref <source>              Reference URL, data URI, or local image path (repeatable, up to 16).
  --model <name>              Sunburst for generation, Flare with --ref (auto by default)
  --no-annotations            Drop the annotation color-system block from the prompt prelude
  --keep-composite            Keep the composite image after slicing (default: true)
  --quality <level>           auto, low, medium, high, xhigh, max (default: high)
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
 * Pick the nominal composite size for a chosen grid + video aspect.
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
 * the chosen nominal preset and the (cols x rows) of cells.
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

// All image calls share the same model selection, authentication and response decoder.
export async function generateComposite({
  apiKey, model, finalPrompt, aspect, refs, quality, outputFormat, outputDir,
}, dependencies) {
  const result = await generateImage({
    apiKey, model, prompt: finalPrompt, aspectRatio: aspect, imageUrls: refs,
    quality, outputFormat, outputDir, filenamePrefix: "composite",
  }, dependencies);
  return { compositePath: result.files[0], compositeUrl: null, endpoint: result.endpoint, model: result.model };
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

// Always slice against the actual returned pixel dimensions. Requested
// aspect and nominal planning sizes do not guarantee exact provider output.
function readImageDimensions(filePath) {
  const res = spawnSync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x",
      filePath,
    ],
    { encoding: "utf-8" },
  );
  if (res.status !== 0) {
    console.error(`ERROR: ffprobe failed for ${filePath}: ${res.stderr ?? ""}`);
    process.exit(1);
  }
  const parts = String(res.stdout).trim().split("x");
  const width = parseInt(parts[0], 10);
  const height = parseInt(parts[1], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    console.error(`ERROR: ffprobe returned bad dimensions for ${filePath}: '${res.stdout}'`);
    process.exit(1);
  }
  return { width, height };
}

function sliceComposite({ compositePath, panels, outputDir, baseName, format }) {
  const slices = [];
  for (const panel of panels) {
    const filename = `${baseName}-${String(panel.index).padStart(2, "0")}.${format}`;
    const outPath = join(outputDir, filename);
    const { x, y, w, h } = panel.bbox;
    // Pass the output path after `--` so ffmpeg never interprets a
    // leading-dash filename (e.g. from `--name "-foo"`) as a flag.
    const args = [
      "-y",
      "-i", compositePath,
      "-vf", `crop=${w}:${h}:${x}:${y}`,
      "-frames:v", "1",
      "--",
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

// ---------------------------------------------------------------------------
// Stdout JSON builder
// ---------------------------------------------------------------------------

/**
 * Build the structured JSON written to stdout. The agent reads this and
 * registers the composite + panel slices in project.json with the
 * suggested asset metadata + provenance edges. No project.json mutation
 * happens inside this script.
 */
export function buildStdoutJson({
  compositePath, compositeUrl, endpoint, grid, imageSize,
  finalPrompt, panels, refs, baseName, aspect, panelCount,
  quality = "high", model = DEFAULT_IMAGE_MODEL,
}) {
  const now = Date.now();
  const compositeAssetId = `asset-storyboard-composite-${now}`;
  const compositeAsset = {
    id: compositeAssetId,
    type: "image",
    uri: compositePath,
    name: `Storyboard composite (${grid.rows}x${grid.cols})`,
    metadata: {
      width: imageSize.width,
      height: imageSize.height,
      grid,
      panelCount,
      videoAspect: aspect,
    },
    tags: ["storyboard", "composite"],
    status: "ready",
    createdAt: now,
  };

  const compositeProvenance = {
    toAssetId: compositeAssetId,
    fromAssetId: null,
    operation: {
      type: "generate",
      actor: "agent",
      agentId: "claude-clipcraft-storyboard",
      timestamp: now,
      params: {
        model: resolveImageModel(model),
        provider: "openrouter",
        endpoint,
        prompt: finalPrompt,
        imageSize: imageSize.preset,
        imageUrls: refs ?? [],
        quality,
        videoAspect: aspect,
        grid,
        panelCount,
      },
    },
  };

  const sliceAssets = panels.map((p) => ({
    id: `asset-${baseName}-${String(p.index).padStart(2, "0")}`,
    type: "image",
    uri: p.path,
    name: `Panel ${p.index}`,
    metadata: {
      fidelity: "sketch", // default fidelity; agent can override
      width: p.bbox.w,
      height: p.bbox.h,
      panelIndex: p.index,
      row: p.row,
      col: p.col,
    },
    tags: ["storyboard", "panel"],
    status: "ready",
    createdAt: now,
  }));

  const sliceProvenance = panels.map((p, i) => ({
    toAssetId: sliceAssets[i].id,
    fromAssetId: compositeAssetId,
    operation: {
      type: "slice",
      actor: "agent",
      agentId: "claude-clipcraft-storyboard",
      timestamp: now,
      params: {
        tool: "ffmpeg",
        bbox: p.bbox,
        row: p.row,
        col: p.col,
        index: p.index,
      },
    },
  }));

  return {
    composite: { path: compositePath, url: compositeUrl, assetId: compositeAssetId },
    grid,
    imageSize: imageSize.preset,
    videoAspect: aspect,
    panelCount,
    panels: panels.map((p, i) => ({
      index: p.index,
      row: p.row,
      col: p.col,
      bbox: p.bbox,
      path: p.path,
      assetId: sliceAssets[i].id,
    })),
    finalPrompt,
    suggestedAssets: [compositeAsset, ...sliceAssets],
    suggestedProvenance: [compositeProvenance, ...sliceProvenance],
  };
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
      model:            { type: "string" },
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

  const refs = values.ref ?? [];
  const model = resolveImageModel(values.model ?? (refs.length ? DEFAULT_EDIT_IMAGE_MODEL : DEFAULT_IMAGE_MODEL));

  // ---- pipeline ----
  ensureFfmpeg();

  const keys = loadEnvKeys();
  if (!keys.OPENROUTER_API_KEY) {
    console.error("ERROR: OPENROUTER_API_KEY not found.");
    console.error("Add OPENROUTER_API_KEY=... to the skill .env or export it in the environment.");
    console.error("Get one at https://openrouter.ai/keys.");
    process.exit(1);
  }

  const grid = pickGrid(panelCount, aspect);
  const imageSize = pickImageSize(grid, aspect);
  const includeAnnotations = !values["no-annotations"];
  const finalPrompt = assemblePrompt({
    userPrompt, grid, aspect, includeAnnotations,
  });

  const outDir = resolve(values["out-dir"]);
  mkdirSync(outDir, { recursive: true });

  console.error(
    `[storyboard] grid=${grid.rows}x${grid.cols}, image=${imageSize.preset}, panels=${panelCount}, aspect=${aspect}`,
  );

  const composite = await generateComposite({
    apiKey: keys.OPENROUTER_API_KEY,
    model,
    finalPrompt,
    aspect,
    refs,
    quality: values.quality,
    outputFormat: values["output-format"],
    outputDir: outDir,
  });

  // Read the generated composite before computing any crop boxes.
  const actualImageSize = {
    preset: imageSize.preset,
    ...readImageDimensions(composite.compositePath),
  };
  console.error(
    `[storyboard] composite actual=${actualImageSize.width}x${actualImageSize.height} (preset nominal=${imageSize.width}x${imageSize.height})`,
  );

  const { panels } = computeBboxes(grid, actualImageSize, aspect);
  const slices = sliceComposite({
    compositePath: composite.compositePath,
    panels,
    outputDir: outDir,
    baseName: values.name,
    format: values["output-format"],
  });

  const out = buildStdoutJson({
    compositePath: composite.compositePath,
    compositeUrl: composite.compositeUrl,
    endpoint: composite.endpoint,
    model: composite.model,
    grid,
    imageSize: actualImageSize,
    finalPrompt,
    panels: slices,
    refs,
    baseName: values.name,
    aspect,
    panelCount,
    quality: values.quality,
  });

  // --keep-composite default is true; v1 always keeps the composite.
  // Skipping deletion intentionally (the composite is useful as a
  // reference asset registered in the provenance graph).

  console.log(JSON.stringify(out, null, 2));
}

if (isCliEntry()) {
  main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}
