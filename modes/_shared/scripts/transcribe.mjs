#!/usr/bin/env node

/**
 * Shared Transcription CLI (plotwise QA gate; Whisper v3 "wizper" on fal.ai)
 *
 * Transcribes the audio track of a local media file (or a URL) so a caller
 * can compare what a generated clip actually SAYS against the verbatim
 * narration script it was supposed to say. This is the cheap half of the
 * plotwise narration QA gate: generate → transcribe → compare → re-shoot
 * on mismatch. A transcription costs ~a cent; an unnoticed misquoted fact
 * costs the mode its whole premise.
 *
 * Usage:
 *   node transcribe.mjs --input nodes/n1/video.mp4 [--language zh] [--json]
 *   node transcribe.mjs --input https://.../clip.mp4 --json
 *
 * Local files are inlined as base64 data URIs (≤8 MB — a 5-15s 480P clip
 * is 1-5 MB; for anything bigger pass the fal CDN URL the generator
 * printed instead).
 *
 * Prints the transcript text; --json prints the full
 * `{ "text", "chunks": [{ "timestamp": [start, end], "text" }] }` payload,
 * which callers use for word-level timing.
 *
 * Environment:
 *   FAL_KEY — required. Environment first, then `.env` discovered like
 *   every sibling shared script (skill root, then walking up from cwd).
 *   Never printed.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WIZPER_URL = "https://fal.run/fal-ai/wizper";
const MAX_INLINE_BYTES = 8 * 1024 * 1024;

const MIME = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
};

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

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const { values: args } = parseArgs({
  options: {
    input: { type: "string" },
    language: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

if (!args.input) fail("--input is required (a local media file or URL)");

let audioUrl;
if (/^https?:/.test(args.input)) {
  audioUrl = args.input;
} else {
  if (!existsSync(args.input)) fail(`file not found: ${args.input}`);
  const size = statSync(args.input).size;
  if (size > MAX_INLINE_BYTES) {
    fail(
      `${args.input} is ${(size / 1024 / 1024).toFixed(1)} MB — too large to inline (limit ${MAX_INLINE_BYTES / 1024 / 1024} MB). Pass the clip's CDN URL instead.`,
    );
  }
  const mime = MIME[extname(args.input).toLowerCase()];
  if (!mime) fail(`unsupported file extension: ${args.input}`);
  audioUrl = `data:${mime};base64,${readFileSync(args.input).toString("base64")}`;
}

const falKey = loadFalKey();
if (!falKey) {
  fail("No API key found. Set FAL_KEY in the environment or a .env file.");
}

const body = { audio_url: audioUrl, task: "transcribe" };
if (args.language) body.language = args.language;

const resp = await fetch(WIZPER_URL, {
  method: "POST",
  headers: {
    Authorization: `Key ${falKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

if (!resp.ok) {
  const text = await resp.text().catch(() => "");
  fail(`fal.ai returned HTTP ${resp.status}: ${text.slice(0, 500)}`);
}

const result = await resp.json();
if (typeof result?.text !== "string") {
  fail(`response carried no transcript: ${JSON.stringify(result).slice(0, 300)}`);
}

if (args.json) {
  console.log(JSON.stringify({ text: result.text, chunks: result.chunks ?? [] }));
} else {
  console.log(result.text);
}
