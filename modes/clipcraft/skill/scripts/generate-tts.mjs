#!/usr/bin/env node

/**
 * ClipCraft TTS Generator CLI
 *
 * Plain argv CLI wrapping OpenRouter's openai/gpt-audio model via SSE
 * streaming. Collects `delta.audio.data` base64 chunks, decodes them,
 * and writes a PCM16 WAV file. Prints the output path on success
 * (exit 0); prints errors to stderr on failure (exit 1).
 *
 * Usage:
 *   node generate-tts.mjs --text "..." --output assets/audio/out.wav [--voice alloy]
 *
 * Voices: alloy (default), echo, fable, onyx, nova, shimmer.
 *
 * Environment:
 *   OPENROUTER_API_KEY  — required
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Streaming helper — verbatim from legacy clipcraft-tts.mjs
// Collects SSE chunks, concatenates delta.audio.data base64.
// ---------------------------------------------------------------------------

async function streamAudioRequest(body, apiKey, timeoutMs = 60000) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API failed (${res.status}): ${text}`);
  }

  let audioBase64 = "";
  let textContent = "";
  let transcript = "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(": ")) continue;
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
        // Skip unparseable lines
      }
    }
  }

  return { audioBase64, textContent, transcript };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function runTts(args) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) die("OPENROUTER_API_KEY is not set");

  const { text, output, voice = "alloy" } = args;
  if (!text) die("--text is required");
  if (!output) die("--output is required");

  const { audioBase64 } = await streamAudioRequest(
    {
      model: "openai/gpt-audio",
      modalities: ["text", "audio"],
      audio: { voice, format: "wav" },
      messages: [
        {
          role: "user",
          content: `Please read the following text aloud naturally:\n\n${text}`,
        },
      ],
    },
    apiKey
  );

  if (!audioBase64) die("No audio data received");

  const buffer = Buffer.from(audioBase64, "base64");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, buffer);
  console.log(output);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    text: { type: "string" },
    output: { type: "string" },
    voice: { type: "string" },
  },
  allowPositionals: false,
});

try {
  await runTts(values);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
