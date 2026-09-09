#!/usr/bin/env node

/**
 * Background removal — BiRefNet v2 on fal.ai.
 *
 * One image in, one RGBA PNG out. Used where a generated image arrived
 * opaque and the pipeline downstream needs a real alpha channel (a sprite
 * sheet that has to be sliced, a cut-out that has to be composited).
 *
 * Usage:
 *   node remove-background.mjs --input sheet-raw.png --output sheet-alpha.png \
 *     [--model light|light-2k|heavy|matting|portrait|dynamic] \
 *     [--resolution 1024|2048|2304] [--no-refine] [--json]
 *
 * The models are fal's own enum, behind short aliases — the display names
 * ("General Use (Light 2K)") are quoted strings with spaces and brackets
 * that no caller should have to spell into a shell. `--model` takes the
 * alias only; the display name itself is refused, so a typo cannot travel
 * as an unknown value into a paid request.
 *
 * The job goes through fal's queue (`fal-queue.mjs`), so an interrupt
 * cancels it remotely instead of leaving it running upstream, and the
 * result is written atomically (`<output>.tmp`, then renamed) — a watcher
 * never sees a half-written PNG.
 *
 * `--json` prints exactly one object: { path, url, width, height, model }.
 * Progress and warnings go to stderr; exit 1 on failure, 130 on interrupt.
 *
 * Environment: FAL_KEY, from the environment or a `.env` discovered by
 * `fal-queue.mjs::loadFalKey`. Never printed, never an argv.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { downloadFalFile, falMediaUrl, loadFalKey, runFalJob } from "./fal-queue.mjs";

export const BIREFNET_URL = "https://fal.run/fal-ai/birefnet/v2";

/** Short alias → the exact string fal's `model` enum accepts. */
export const MODEL_ALIASES = {
  light: "General Use (Light)",
  "light-2k": "General Use (Light 2K)",
  heavy: "General Use (Heavy)",
  matting: "Matting",
  portrait: "Portrait",
  dynamic: "General Use (Dynamic)",
};

/** Square operating resolutions fal offers, keyed by the short form. */
export const RESOLUTIONS = {
  1024: "1024x1024",
  2048: "2048x2048",
  2304: "2304x2304",
};

export const DEFAULT_MODEL = "heavy";
export const DEFAULT_RESOLUTION = "2048";

/**
 * The exact request BiRefNet is sent, or a thrown refusal naming the flag
 * at fault. Everything checkable is checked here: a paid 422 teaches
 * nothing that this cannot say for free.
 */
export function buildRemoveBackgroundRequest({
  input,
  output,
  model = DEFAULT_MODEL,
  resolution = DEFAULT_RESOLUTION,
  refine = true,
} = {}) {
  if (typeof input !== "string" || !input.trim()) throw new Error("--input is required");
  if (typeof output !== "string" || !output.trim()) throw new Error("--output is required");
  // The cut-out is always a PNG — the only format here that carries alpha.
  // Writing those bytes into a path called `.jpg` would be a lie on disk.
  if (extname(output).toLowerCase() !== ".png") throw new Error(`--output must be a .png path (got: ${output})`);

  const falModel = MODEL_ALIASES[model];
  if (!falModel) throw new Error(`--model must be one of: ${Object.keys(MODEL_ALIASES).join(", ")} (got: ${model})`);
  const operatingResolution = RESOLUTIONS[String(resolution)];
  if (!operatingResolution) throw new Error(`--resolution must be one of: ${Object.keys(RESOLUTIONS).join(", ")} (got: ${resolution})`);

  return {
    url: BIREFNET_URL,
    model,
    body: {
      image_url: falMediaUrl(input, { label: "--input" }),
      model: falModel,
      operating_resolution: operatingResolution,
      output_format: "png",
      refine_foreground: refine !== false,
    },
  };
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Width and height straight out of a PNG's IHDR, or null if unreadable. */
export function pngSize(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Run one BiRefNet job and write the cut-out to `output`.
 *
 * The job runner and downloader are injected so the whole path can be
 * exercised without touching fal. Dimensions come from fal when it reports
 * them and are read back out of the PNG header when it does not — the
 * caller's `atlas.json` needs a number either way.
 */
export async function removeBackground(options, { runJob = runFalJob, download = downloadFalFile } = {}) {
  const { output, apiKey, signal, deadlineMs = 300_000 } = options;
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const { url, body } = buildRemoveBackgroundRequest(options);

  const job = await runJob({
    url,
    body,
    key: apiKey,
    signal,
    label: "BiRefNet background removal",
    deadlineMs,
    onRetry: ({ attempt, attempts, delayMs, reason }) => {
      console.error(`WARN: ${String(reason).slice(0, 160)} — retrying in ${delayMs / 1000}s (attempt ${attempt} of ${attempts})`);
    },
  });

  const image = job?.data?.image;
  if (!image?.url) throw new Error(`response carried no image URL: ${JSON.stringify(job?.data ?? null).slice(0, 500)}`);

  const bytes = await download(image.url, { signal });
  mkdirSync(dirname(output), { recursive: true });
  const staged = `${output}.tmp`;
  writeFileSync(staged, bytes);
  renameSync(staged, output);

  const measured = pngSize(bytes);
  return {
    path: output,
    url: image.url,
    width: typeof image.width === "number" ? image.width : (measured?.width ?? null),
    height: typeof image.height === "number" ? image.height : (measured?.height ?? null),
    model: body.model,
  };
}

const HELP = `Usage: remove-background.mjs --input <image> --output <path.png> [options]

  --input <path|url>     Source image: png, jpg or webp (required)
  --output <path.png>    Where the RGBA cut-out is written (required)
  --model <alias>        ${Object.keys(MODEL_ALIASES).join(", ")} (default: ${DEFAULT_MODEL})
                         → ${Object.values(MODEL_ALIASES).join(", ")}
  --resolution <n>       ${Object.keys(RESOLUTIONS).join(", ")} (default: ${DEFAULT_RESOLUTION})
  --no-refine            Skip foreground refinement (faster, softer edges)
  --json                 Print one JSON object on stdout
  --deadline-s <n>       Give up on the job after this many seconds (default: 300)
  --help, -h             This text

Local inputs are inlined as data URIs (30 MB max); host anything larger and
pass its URL. Requires FAL_KEY (environment or .env). Progress goes to
stderr; with --json, stdout carries exactly one object.`;

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      model: { type: "string", default: DEFAULT_MODEL },
      resolution: { type: "string", default: DEFAULT_RESOLUTION },
      "no-refine": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "deadline-s": { type: "string", default: "300" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.error(HELP);
    return 0;
  }
  if (!values.input) throw new Error("--input is required");
  if (!values.output) throw new Error("--output is required");

  const apiKey = loadFalKey();
  if (!apiKey) throw new Error("No API key found. Set FAL_KEY in the environment or a .env file.");

  const controller = new AbortController();
  const handlers = new Map();
  let interruptedBy = null;
  for (const name of ["SIGTERM", "SIGINT"]) {
    const handler = () => {
      if (interruptedBy) process.exit(130);
      interruptedBy = name;
      controller.abort(new DOMException(`received ${name}`, "AbortError"));
    };
    handlers.set(name, handler);
    process.on(name, handler);
  }

  try {
    const result = await removeBackground({
      input: values.input,
      output: values.output,
      model: values.model,
      resolution: values.resolution,
      refine: !values["no-refine"],
      apiKey,
      signal: controller.signal,
      deadlineMs: Math.max(30, Number(values["deadline-s"]) || 300) * 1000,
    });
    console.log(values.json ? JSON.stringify(result) : result.path);
    return 0;
  } catch (error) {
    if (interruptedBy || error?.name === "AbortError") {
      console.error(`ERROR: ${interruptedBy ?? "interrupted"} — the fal.ai job was cancelled`);
      return 130;
    }
    throw error;
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler);
  }
}

function isMain() {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  const entry = process.argv[1] ? resolve(process.argv[1]) : null;
  return entry !== null && fileURLToPath(import.meta.url) === entry;
}

if (isMain()) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
