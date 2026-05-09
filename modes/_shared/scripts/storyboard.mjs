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
