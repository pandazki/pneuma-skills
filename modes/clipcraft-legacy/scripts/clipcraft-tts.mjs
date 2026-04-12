#!/usr/bin/env node

/**
 * ClipCraft TTS MCP Server
 *
 * MCP stdio server for text-to-speech via OpenRouter (openai/gpt-audio).
 * Uses streaming mode (required by OpenRouter for audio output).
 *
 * Environment:
 *   API_KEY — OpenRouter API key
 */

import { createInterface } from "node:readline";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

let pendingWork = 0;
let stdinClosed = false;

function jsonrpc(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function jsonrpcError(id, code, message, data) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}
function send(msg) { process.stdout.write(msg + "\n"); }
function maybeExit() { if (stdinClosed && pendingWork === 0) process.exit(0); }

// ---------------------------------------------------------------------------
// Streaming helper — collects SSE chunks, concatenates audio.data base64
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
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "generate_speech",
    description: "Generate speech audio from text using OpenRouter gpt-audio. Saves as WAV.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to convert to speech" },
        voice: {
          type: "string", description: "Voice ID (default: 'alloy')",
          enum: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"], default: "alloy",
        },
        output_path: { type: "string", description: "File path for the audio (e.g. assets/audio/scene-001.wav)" },
      },
      required: ["text", "output_path"],
    },
  },
  {
    name: "list_voices",
    description: "List available TTS voices.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

const VOICES = [
  { id: "alloy", description: "Neutral and balanced" },
  { id: "echo", description: "Smooth and steady" },
  { id: "fable", description: "Expressive and dynamic" },
  { id: "onyx", description: "Deep and authoritative" },
  { id: "nova", description: "Friendly and upbeat" },
  { id: "shimmer", description: "Bright and optimistic" },
];

async function handleGenerateSpeech(args) {
  const { text, voice = "alloy", output_path } = args;
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY not set (needs OpenRouter key)");

  console.error(`[tts] Generating speech: voice=${voice}, text="${text.slice(0, 60)}..."`);

  const { audioBase64, transcript } = await streamAudioRequest({
    model: "openai/gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format: "wav" },
    messages: [{ role: "user", content: `Please read the following text aloud naturally:\n\n${text}` }],
  }, apiKey);

  if (!audioBase64) {
    throw new Error("No audio data received");
  }

  const buffer = Buffer.from(audioBase64, "base64");
  mkdirSync(dirname(output_path), { recursive: true });
  writeFileSync(output_path, buffer);
  console.error(`[tts] Saved ${buffer.length} bytes to ${output_path}`);

  return {
    content: [{ type: "text", text: JSON.stringify({ path: output_path, transcript: transcript || text, size: buffer.length }) }],
  };
}

// ---------------------------------------------------------------------------
// MCP dispatcher
// ---------------------------------------------------------------------------

async function handleRequest(request) {
  const { id, method, params } = request;
  switch (method) {
    case "initialize":
      return send(jsonrpc(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "clipcraft-tts", version: "3.0.0" } }));
    case "notifications/initialized": return;
    case "tools/list": return send(jsonrpc(id, { tools: TOOLS }));
    case "tools/call": {
      const { name, arguments: args } = params;
      pendingWork++;
      try {
        let result;
        if (name === "generate_speech") result = await handleGenerateSpeech(args);
        else if (name === "list_voices") result = { content: [{ type: "text", text: JSON.stringify({ voices: VOICES }) }] };
        else return send(jsonrpcError(id, -32601, `Unknown tool: ${name}`));
        return send(jsonrpc(id, result));
      } catch (err) {
        return send(jsonrpc(id, { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }));
      } finally { pendingWork--; maybeExit(); }
    }
    default:
      if (id !== undefined) return send(jsonrpcError(id, -32601, `Method not found: ${method}`));
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const t = line.trim();
  if (!t) return;
  try { await handleRequest(JSON.parse(t)); } catch (err) { send(jsonrpcError(null, -32700, `Parse error: ${err.message}`)); }
});
rl.on("close", () => { stdinClosed = true; maybeExit(); });
