#!/usr/bin/env node

/**
 * ClipCraft Video Generation MCP Server
 *
 * MCP stdio server for AI video generation via fal.ai (veo3.1 model).
 * Communicates over stdin/stdout using JSON-RPC 2.0.
 *
 * Environment:
 *   API_KEY  — the fal.ai API key
 *
 * Note: veo3.1 is expensive (~$0.20-0.60/second of video). The synchronous
 * fal.run endpoints block until the result is ready (30-120+ seconds).
 */

import { createInterface } from "node:readline";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";

// ---------------------------------------------------------------------------
// MCP protocol helpers
// ---------------------------------------------------------------------------

function jsonrpc(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function jsonrpcError(id, code, message, data) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

function send(msg) {
  process.stdout.write(msg + "\n");
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "generate_video_from_text",
    description:
      "Generate a video clip from a text prompt using fal.ai veo3.1. This is an expensive operation (~$0.20-0.60/second). The call blocks until the video is ready (30-120+ seconds).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text prompt describing the video to generate" },
        duration: {
          type: "string",
          description: "Video duration: '4s', '6s', or '8s' (default: '8s')",
          enum: ["4s", "6s", "8s"],
        },
        aspect_ratio: {
          type: "string",
          description: "Aspect ratio: '16:9' or '9:16' (default: '16:9')",
          enum: ["16:9", "9:16"],
        },
        resolution: {
          type: "string",
          description: "Video resolution: '720p' or '1080p' (default: '720p')",
          enum: ["720p", "1080p"],
        },
        generate_audio: {
          type: "boolean",
          description: "Whether to generate audio (default: true)",
        },
        output_path: { type: "string", description: "File path where the video will be saved" },
      },
      required: ["prompt", "output_path"],
    },
  },
  {
    name: "generate_video_from_image",
    description:
      "Generate a video clip from a source image using fal.ai veo3.1 image-to-video. If image_path is a local file, it will be base64-encoded and sent as a data URI. This is an expensive operation (~$0.20-0.60/second).",
    inputSchema: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "Path or URL to the source image. Local files are base64-encoded automatically.",
        },
        prompt: { type: "string", description: "Text prompt to guide the video generation" },
        duration: {
          type: "string",
          description: "Video duration: '4s', '6s', or '8s' (default: '8s')",
          enum: ["4s", "6s", "8s"],
        },
        aspect_ratio: {
          type: "string",
          description: "Aspect ratio (default: 'auto')",
        },
        resolution: {
          type: "string",
          description: "Video resolution: '720p' or '1080p' (default: '720p')",
          enum: ["720p", "1080p"],
        },
        generate_audio: {
          type: "boolean",
          description: "Whether to generate audio (default: true)",
        },
        output_path: { type: "string", description: "File path where the video will be saved" },
      },
      required: ["image_path", "prompt", "output_path"],
    },
  },
];

// ---------------------------------------------------------------------------
// MIME type helper
// ---------------------------------------------------------------------------

function mimeFromExt(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return map[ext] || "image/jpeg";
}

// ---------------------------------------------------------------------------
// fal.ai API helpers
// ---------------------------------------------------------------------------

const FAL_TEXT_TO_VIDEO_URL = "https://fal.run/fal-ai/veo3.1";
const FAL_IMAGE_TO_VIDEO_URL = "https://fal.run/fal-ai/veo3.1/image-to-video";

async function falTextToVideo({ prompt, duration, aspect_ratio, resolution, generate_audio }) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY environment variable is not set");

  const res = await fetch(FAL_TEXT_TO_VIDEO_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      duration: duration || "8s",
      aspect_ratio: aspect_ratio || "16:9",
      resolution: resolution || "720p",
      generate_audio: generate_audio !== false,
      auto_fix: true,
      safety_tolerance: "4",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai veo3.1 text-to-video failed (${res.status}): ${body}`);
  }

  return res.json(); // { video: { url } }
}

async function falImageToVideo({ prompt, image_url, duration, aspect_ratio, resolution, generate_audio }) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY environment variable is not set");

  const res = await fetch(FAL_IMAGE_TO_VIDEO_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_url,
      duration: duration || "8s",
      aspect_ratio: aspect_ratio || "auto",
      resolution: resolution || "720p",
      generate_audio: generate_audio !== false,
      auto_fix: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai veo3.1 image-to-video failed (${res.status}): ${body}`);
  }

  return res.json(); // { video: { url } }
}

async function downloadVideo(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download video (${res.status})`);

  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
}

/**
 * Resolve an image_path to a URL suitable for the fal.ai API.
 * If it's already an HTTP(S) URL, return as-is.
 * Otherwise read the local file and return a data URI.
 */
function resolveImageUrl(imagePath) {
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }

  try {
    const fileBuffer = readFileSync(imagePath);
    const base64 = fileBuffer.toString("base64");
    const mime = mimeFromExt(imagePath);
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    throw new Error(`Failed to read source image: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleGenerateVideoFromText(args) {
  const { prompt, duration, aspect_ratio, resolution, generate_audio, output_path } = args;

  const result = await falTextToVideo({
    prompt,
    duration,
    aspect_ratio,
    resolution,
    generate_audio,
  });

  if (!result.video || !result.video.url) {
    throw new Error("fal.ai returned no video");
  }

  await downloadVideo(result.video.url, output_path);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          path: output_path,
          duration: duration || "8s",
        }),
      },
    ],
  };
}

async function handleGenerateVideoFromImage(args) {
  const { image_path, prompt, duration, aspect_ratio, resolution, generate_audio, output_path } = args;

  const imageUrl = resolveImageUrl(image_path);

  const result = await falImageToVideo({
    prompt,
    image_url: imageUrl,
    duration,
    aspect_ratio,
    resolution,
    generate_audio,
  });

  if (!result.video || !result.video.url) {
    throw new Error("fal.ai returned no video");
  }

  await downloadVideo(result.video.url, output_path);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          path: output_path,
          duration: duration || "8s",
        }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------

async function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return send(
        jsonrpc(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "clipcraft-videogen",
            version: "2.0.0",
          },
        })
      );

    case "notifications/initialized":
      return;

    case "tools/list":
      return send(jsonrpc(id, { tools: TOOLS }));

    case "tools/call": {
      const { name, arguments: args } = params;
      try {
        let result;
        switch (name) {
          case "generate_video_from_text":
            result = await handleGenerateVideoFromText(args);
            break;
          case "generate_video_from_image":
            result = await handleGenerateVideoFromImage(args);
            break;
          default:
            return send(jsonrpcError(id, -32601, `Unknown tool: ${name}`));
        }
        return send(jsonrpc(id, result));
      } catch (err) {
        return send(
          jsonrpc(id, {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          })
        );
      }
    }

    default:
      if (id !== undefined) {
        return send(jsonrpcError(id, -32601, `Method not found: ${method}`));
      }
  }
}

// ---------------------------------------------------------------------------
// stdin reader
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin });

let pendingWork = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pendingWork === 0) process.exit(0);
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const request = JSON.parse(trimmed);
    pendingWork++;
    handleRequest(request)
      .catch((err) => send(jsonrpcError(null, -32603, `Internal error: ${err.message}`)))
      .finally(() => { pendingWork--; maybeExit(); });
  } catch (err) {
    send(jsonrpcError(null, -32700, `Parse error: ${err.message}`));
  }
});

rl.on("close", () => {
  stdinClosed = true;
  maybeExit();
});
