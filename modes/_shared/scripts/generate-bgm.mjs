#!/usr/bin/env node

/**
 * Shared BGM Generator CLI — Lyria 3 Pro on OpenRouter.
 *
 * Plain argv CLI wrapping `google/lyria-3-pro-preview` over SSE streaming:
 * collects the `delta.audio.data` base64 chunks, decodes them, and writes an
 * MP3. Prints the output path on success (exit 0); prints the reason on
 * stderr and exits 1 on failure.
 *
 * Usage:
 *   node generate-bgm.mjs --prompt "..." --output sound/music.mp3 [--duration 30]
 *
 * Environment:
 *   OPENROUTER_API_KEY — required. Read from the environment first, then
 *   from a `.env` discovered the way every sibling shared script does it
 *   (the skill root — the parent of scripts/, where skill-installer writes
 *   the mode's .env from `envMapping` — then walking up from cwd). Never
 *   printed, not even on failure.
 *
 * NOTE: lyria-3-pro-preview has no duration parameter in the OpenRouter
 * request body. `--duration` is appended to the user prompt as a hint
 * ("... approximately N seconds long") rather than silently dropped; what
 * comes back has to be measured, and a caller that needs an exact length
 * trims it (backlot's `cut` does).
 *
 * PROVENANCE: copied from `modes/clipcraft/skill/scripts/generate-bgm.mjs`
 * (2026-09-20) when backlot needed a music bed. Clipcraft still carries its
 * own copy and is unchanged by that move; it can adopt this one in its own
 * release. The two differ only in what is around the request: this copy
 * resolves the key like the other shared scripts, and exports
 * `generateBgm()` so a script can call it without a subprocess.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const BGM_MODEL = "google/lyria-3-pro-preview";
export const BGM_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
/** Lyria takes its time; the legacy MCP used the same ceiling. */
export const BGM_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// The key — the same discovery every sibling shared script documents
// ---------------------------------------------------------------------------

function findEnvFile() {
  // 1. The skill root (parent of scripts/), where skill-installer writes the
  //    mode's .env from its envMapping.
  const skillEnv = join(dirname(__dirname), ".env");
  if (existsSync(skillEnv)) return skillEnv;

  // 2. Fallback: walk up from cwd.
  let dir = process.cwd();
  for (;;) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) return envPath;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `OPENROUTER_API_KEY` from the environment, then from the discovered
 *  `.env`. Returns null when there is none — the caller decides whether that
 *  is a refusal or a closed stage. */
export function loadOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = findEnvFile();
  if (!envPath) return null;
  const content = readFileSync(envPath, "utf-8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    if (line.slice(0, eqIdx).trim() !== "OPENROUTER_API_KEY") continue;
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** The body one brief is sent as. Exported so a test can pin the duration
 *  hint without a network call. */
export function buildBgmRequest({ prompt, duration, model = BGM_MODEL }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("--prompt is required");
  // Lyria has no duration field on OpenRouter; the ask goes into the prompt
  // rather than being silently dropped.
  const content = duration ? `${prompt} (approximately ${duration} seconds long)` : prompt;
  return { model, modalities: ["text", "audio"], messages: [{ role: "user", content }] };
}

/**
 * Stream one chat completion and collect what it sent back.
 *
 * The audio arrives as base64 in `delta.audio.data` across many SSE events;
 * an unparseable line is skipped rather than aborting a response that is
 * mostly good. Text and transcript are collected too — when no audio
 * arrives, what the model SAID instead is the only explanation available.
 */
export async function streamAudioRequest(body, apiKey, { timeoutMs = BGM_TIMEOUT_MS, fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(BGM_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API failed (${response.status}): ${text}`);
  }

  let audioBase64 = "";
  let textContent = "";
  let transcript = "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(": ")) continue; // comments / heartbeats
      if (trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const chunk = JSON.parse(trimmed.slice(6));
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) textContent += delta.content;
        if (delta.audio?.data) audioBase64 += delta.audio.data;
        if (delta.audio?.transcript) transcript += delta.audio.transcript;
      } catch {
        // One unparseable event is not a reason to lose the rest.
      }
    }
  }

  return { audioBase64, textContent, transcript };
}

/**
 * Generate one music bed and write it to `output`.
 *
 * Throws — never exits — so a caller in the same process owns the failure.
 * The file appears atomically: the bytes go to `<output>.tmp` and take the
 * real name only once they are all there, so a watcher never sees half an
 * MP3. Returns `{ path, bytes, model }`.
 */
export async function generateBgm(
  { prompt, output, seconds, duration, model = BGM_MODEL, apiKey, timeoutMs = BGM_TIMEOUT_MS, signal } = {},
  { fetchImpl = fetch } = {},
) {
  if (typeof output !== "string" || !output.trim()) throw new Error("--output is required");
  const key = apiKey ?? loadOpenRouterKey();
  if (!key) throw new Error("No API key found. Set OPENROUTER_API_KEY in the environment or a .env file.");

  const body = buildBgmRequest({ prompt, duration: duration ?? seconds, model });
  const { audioBase64, textContent } = await streamAudioRequest(body, key, { timeoutMs, fetchImpl, signal });
  if (!audioBase64) {
    throw new Error(`No audio data received from ${model}. Text response: ${textContent.slice(0, 300)}`);
  }

  const buffer = Buffer.from(audioBase64, "base64");
  if (!buffer.length) throw new Error(`${model} returned empty audio data`);
  mkdirSync(dirname(resolve(output)), { recursive: true });
  const staged = `${output}.tmp`;
  writeFileSync(staged, buffer);
  renameSync(staged, output);
  return { path: output, bytes: buffer.length, model };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const HELP = `Usage: generate-bgm.mjs --prompt "..." --output <path.mp3> [options]

  --prompt <text>      The music brief: instruments, tempo, what the scene
                       feels like (required)
  --output <path>      Where the MP3 is written (required)
  --duration <n>       Seconds, as a HINT in the prompt — ${BGM_MODEL}
                       has no duration parameter; measure what comes back
  --model <id>         Default: ${BGM_MODEL}
  --help, -h           This text

Requires OPENROUTER_API_KEY (environment or .env). The path is printed on
stdout; everything else goes to stderr.`;

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      prompt: { type: "string" },
      output: { type: "string" },
      duration: { type: "string" },
      model: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.error(HELP);
    return 0;
  }
  if (!values.prompt) throw new Error("--prompt is required");
  if (!values.output) throw new Error("--output is required");

  const result = await generateBgm({
    prompt: values.prompt,
    output: values.output,
    duration: values.duration,
    model: values.model,
  });
  console.log(result.path);
  return 0;
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
