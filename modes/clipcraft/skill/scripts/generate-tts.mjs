#!/usr/bin/env node

/**
 * ClipCraft TTS Generator CLI
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
 *     [--language "English (US)"] [--temperature 1]
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
 *   .mp3 → mp3 (recommended), .wav → 24kHz 16-bit mono PCM,
 *   .ogg / .opus → ogg_opus. Unknown extensions default to mp3.
 *
 * Text features:
 *   - Inline audio tags: "[laughing] Oh wow!", "... [sigh] ...".
 *   - Inline pacing: "Say it cheerfully: have a nice day!".
 *   - --style is prepended as style_instructions for whole-utterance
 *     direction ("Read as a dramatic newscast", "Whisper mysteriously").
 *
 * Environment:
 *   FAL_KEY — required; fal.ai API key
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import { parseArgs } from "node:util";

const FAL_URL = "https://fal.run/fal-ai/gemini-3.1-flash-tts";

function formatFromPath(p) {
  const ext = extname(p).toLowerCase();
  if (ext === ".wav") return "wav";
  if (ext === ".ogg" || ext === ".opus") return "ogg_opus";
  return "mp3";
}

async function falTts(body, apiKey) {
  const res = await fetch(FAL_URL, {
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

async function downloadAudio(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download audio (${res.status})`);
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
    text: { type: "string" },
    output: { type: "string" },
    voice: { type: "string" },
    style: { type: "string" },
    language: { type: "string" },
    temperature: { type: "string" },
  },
  allowPositionals: false,
});

try {
  const apiKey = process.env.FAL_KEY;
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

  const result = await falTts(body, apiKey);
  const audioUrl = result.audio?.url;
  if (!audioUrl) die("fal.ai returned no audio URL");

  await downloadAudio(audioUrl, output);
  console.log(output);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
