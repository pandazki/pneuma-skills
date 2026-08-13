#!/usr/bin/env node

/**
 * Shared TTS Generator CLI (clipcraft + bansho)
 *
 * Plain argv CLI wrapping fal.ai's gemini-3.1-flash-tts. Supports
 * expressive audio tags directly inline in the text — [laughing],
 * [sigh], [whispering], [short pause], etc. — plus natural-language
 * style instructions via --style for consistent tone across the whole
 * utterance. 30 named voices; defaults to "Kore".
 *
 * Usage:
 *   node generate-tts.mjs --text "..." --output assets/audio/out.mp3 \
 *     [--voice Kore] [--style "warm conversational"] \
 *     [--language "English (US)"] [--temperature 1] [--json]
 *
 * Voice picks (30 total; popular ones):
 *   Kore     — strong, firm female (default)
 *   Puck     — upbeat, lively male
 *   Charon   — calm, professional male
 *   Zephyr   — bright, clear female
 *   Aoede    — warm, melodic female
 *   Full list: https://fal.ai/models/fal-ai/gemini-3.1-flash-tts/api
 *
 * Output format is inferred from the --output extension:
 *   .mp3 → mp3 (recommended for clips), .wav → 24kHz 16-bit mono PCM
 *   (recommended when the caller needs the exact audio length — see
 *   --json), .ogg / .opus → ogg_opus. Unknown extensions default to mp3.
 *
 * --json prints `{"path": "...", "seconds": N}` on success instead of the
 * bare path. `seconds` is measured from the written bytes (WAV header
 * arithmetic — exact); for formats this script cannot measure (mp3/ogg)
 * the field is omitted rather than guessed. Bansho's narration manifest
 * (`narration/manifest.json`) copies `seconds` verbatim, which is why its
 * SKILL.md mandates `.wav` clips.
 *
 * This CLI IS the synthesis seam for bansho's narration layer (and
 * clipcraft's voice tracks): the agent runs it, the manifest records the
 * `{ file, seconds }` it reports, and nothing else in the repo talks to a
 * TTS vendor. A typed mirror (`FalVoiceSynthesizer` implementing a
 * `VoiceSynthesizer` interface) once duplicated the request flow in
 * `modes/bansho/narration/` and was dropped as a drift hazard with no
 * production caller — the interface followed it out as dead surface. If a
 * repo-side synthesis path ever becomes real, define its interface
 * against this file's request shape rather than reviving a hand-synced
 * copy.
 *
 * Text features:
 *   - Inline audio tags: "[laughing] Oh wow!", "... [sigh] ...".
 *   - Inline pacing: "Say it cheerfully: have a nice day!".
 *   - --style is prepended as style_instructions for whole-utterance
 *     direction ("Read as a dramatic newscast", "Whisper mysteriously").
 *
 * Environment:
 *   FAL_KEY — required; fal.ai API key (never printed, even on failure).
 *   Read from the environment first, then from a `.env` file discovered
 *   like every sibling shared script: the skill root (parent of scripts/,
 *   where skill-installer writes the mode's .env from envMapping), then
 *   walking up from cwd.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FAL_URL = "https://fal.run/fal-ai/gemini-3.1-flash-tts";

// ---------------------------------------------------------------------------
// .env loading (same discovery as generate_image.mjs / edit_image.mjs /
// storyboard.mjs — the shared-script contract skill-installer documents)
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

function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const envPath = findEnvFile();
  if (!envPath) return null;
  const content = readFileSync(envPath, "utf-8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    if (line.slice(0, eqIdx).trim() !== "FAL_KEY") continue;
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return null;
}

export function formatFromPath(p) {
  const ext = extname(p).toLowerCase();
  if (ext === ".wav") return "wav";
  if (ext === ".ogg" || ext === ".opus") return "ogg_opus";
  return "mp3";
}

/**
 * Exact audio length of a RIFF/WAVE byte buffer: data-chunk bytes over the
 * fmt chunk's byte rate. Returns null (never throws) when the bytes are
 * not a readable WAV — the --json contract omits `seconds` instead of
 * printing a guess.
 */
export function wavDurationSeconds(bytes) {
  try {
    if (bytes.length < 44) return null;
    const ascii = (off, len) =>
      String.fromCharCode(...bytes.subarray(off, off + len));
    if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let byteRate = null;
    let dataSize = null;
    while (offset + 8 <= bytes.length) {
      const id = ascii(offset, 4);
      const size = view.getUint32(offset + 4, true);
      if (id === "fmt " && offset + 16 + 4 <= bytes.length) {
        byteRate = view.getUint32(offset + 16, true);
      } else if (id === "data") {
        dataSize = size;
      }
      offset += 8 + size + (size % 2); // chunks are word-aligned
    }
    if (!byteRate || dataSize === null) return null;
    return dataSize / byteRate;
  } catch {
    return null;
  }
}

/** The --json stdout line: path always, `seconds` only when measured. */
export function buildResultJson(path, seconds) {
  return JSON.stringify(
    seconds !== null && Number.isFinite(seconds) ? { path, seconds } : { path },
  );
}

async function falTts(body, apiKey, fetchImpl) {
  const res = await fetchImpl(FAL_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal-ai/gemini-3.1-flash-tts failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function downloadAudio(url, outputPath, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Failed to download audio (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return bytes;
}

/**
 * The network half of the CLI, one exported seam with an injectable fetch
 * (tests pin every failure branch without touching fal.ai): call fal,
 * insist on an audio URL, download it to `outputPath`, return the written
 * bytes. Throws — never exits — so main()'s top-level catch owns die().
 */
export async function synthesizeToFile(
  body,
  apiKey,
  outputPath,
  fetchImpl = fetch,
) {
  const result = await falTts(body, apiKey, fetchImpl);
  const audioUrl = result.audio?.url;
  if (!audioUrl) throw new Error("fal.ai returned no audio URL");
  return downloadAudio(audioUrl, outputPath, fetchImpl);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function isMain() {
  // Bun: import.meta.main is true when the file is the entrypoint.
  if (typeof import.meta.main === "boolean") return import.meta.main;
  // Node: compare the resolved entry script with this module's path.
  const entry = process.argv[1] ? resolve(process.argv[1]) : null;
  return entry !== null && import.meta.url === `file://${entry}`;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      text: { type: "string" },
      output: { type: "string" },
      voice: { type: "string" },
      style: { type: "string" },
      language: { type: "string" },
      temperature: { type: "string" },
      json: { type: "boolean" },
    },
    allowPositionals: false,
  });

  const apiKey = loadFalKey();
  if (!apiKey) die("FAL_KEY is not set");

  const text = values.text;
  const output = values.output;
  if (!text) die("--text is required");
  if (!output) die("--output is required");

  const body = {
    prompt: text,
    voice: values.voice || "Kore",
    output_format: formatFromPath(output),
  };
  if (values.style) body.style_instructions = values.style;
  if (values.language) body.language_code = values.language;
  if (values.temperature != null) {
    const n = Number(values.temperature);
    if (isNaN(n) || n < 0 || n > 2) {
      die(`invalid --temperature "${values.temperature}" (must be 0-2)`);
    }
    body.temperature = n;
  }

  const bytes = await synthesizeToFile(body, apiKey, output);
  if (values.json) {
    console.log(buildResultJson(output, wavDurationSeconds(bytes)));
  } else {
    console.log(output);
  }
}

if (isMain()) {
  try {
    await main();
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
}
