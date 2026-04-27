#!/usr/bin/env node

/**
 * ClipCraft BGM Generator CLI
 *
 * Plain argv CLI wrapping OpenRouter's google/lyria-3-pro-preview model
 * via SSE streaming. Collects `delta.audio.data` base64 chunks, decodes
 * them, and writes an MP3 file. Prints the output path on success
 * (exit 0); prints errors to stderr on failure (exit 1).
 *
 * Usage:
 *   node generate-bgm.mjs --prompt "..." --output assets/audio/out.mp3 [--duration 30]
 *
 * Environment:
 *   OPENROUTER_API_KEY  — required
 *
 * NOTE: lyria-3-pro-preview has no official duration parameter in the
 * OpenRouter request body. When --duration is passed, we append a hint
 * to the user prompt ("... approximately N seconds long") rather than
 * silently dropping it. The legacy MCP ignored --duration entirely.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Streaming helper — verbatim from legacy clipcraft-bgm.mjs (180s timeout).
// Collects SSE chunks, concatenates delta.audio.data base64.
// ---------------------------------------------------------------------------

async function streamAudioRequest(body, apiKey, timeoutMs = 180000) {
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
      if (!trimmed || trimmed.startsWith(": ")) continue; // skip comments/heartbeats
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

async function runBgm(args) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) die("OPENROUTER_API_KEY is not set");

  const { prompt, output, duration } = args;
  if (!prompt) die("--prompt is required");
  if (!output) die("--output is required");

  // lyria-3-pro-preview has no duration field in the OpenRouter body —
  // inline the hint into the user message if the caller supplied one.
  const userContent = duration
    ? `${prompt} (approximately ${duration} seconds long)`
    : prompt;

  const { audioBase64, textContent } = await streamAudioRequest(
    {
      model: "google/lyria-3-pro-preview",
      modalities: ["text", "audio"],
      messages: [{ role: "user", content: userContent }],
    },
    apiKey
  );

  if (!audioBase64) {
    die(
      `No audio data received. Text response: ${textContent.slice(0, 300)}`
    );
  }

  const buffer = Buffer.from(audioBase64, "base64");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, buffer);
  console.log(output);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    prompt: { type: "string" },
    output: { type: "string" },
    duration: { type: "string" },
  },
  allowPositionals: false,
});

try {
  await runBgm(values);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
