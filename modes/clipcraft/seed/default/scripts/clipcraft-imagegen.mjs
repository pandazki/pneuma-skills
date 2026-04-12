#!/usr/bin/env node

/**
 * ClipCraft Image Generation MCP Server
 *
 * MCP stdio server for AI image generation via fal.ai (nano-banana-2 model).
 * Communicates over stdin/stdout using JSON-RPC 2.0.
 *
 * Environment:
 *   API_KEY  — the fal.ai API key
 */

import { createInterface } from "node:readline";
import { writeFileSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
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
    name: "generate_image",
    description:
      "Generate an image from a text prompt using fal.ai nano-banana-2 model. Saves the result to the specified output path.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text prompt describing the image to generate" },
        width: { type: "number", description: "Approximate image width in pixels (mapped to closest aspect_ratio)" },
        height: { type: "number", description: "Approximate image height in pixels (mapped to closest aspect_ratio)" },
        style: { type: "string", description: "Optional style modifier (e.g. 'cinematic', 'anime', 'photorealistic')" },
        output_path: { type: "string", description: "File path where the generated image will be saved" },
      },
      required: ["prompt", "output_path"],
    },
  },
  {
    name: "edit_image",
    description:
      "Edit an existing image based on text instructions using fal.ai nano-banana-2/edit. The source image must be accessible via a public URL, or a local file (will be sent as base64 data URI).",
    inputSchema: {
      type: "object",
      properties: {
        source_path: { type: "string", description: "Path or URL to the source image to edit" },
        instructions: { type: "string", description: "Text instructions describing the desired edits" },
        output_path: { type: "string", description: "File path where the edited image will be saved" },
      },
      required: ["source_path", "instructions", "output_path"],
    },
  },
];

// ---------------------------------------------------------------------------
// Aspect ratio mapping
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "3:2", ratio: 3 / 2 },
];

function mapToAspectRatio(width, height) {
  if (!width || !height) return "auto";
  const target = width / height;
  let best = "auto";
  let bestDiff = Infinity;
  for (const { label, ratio } of ASPECT_RATIOS) {
    const diff = Math.abs(target - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = label;
    }
  }
  return best;
}

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

const FAL_GENERATE_URL = "https://fal.run/fal-ai/nano-banana-2";
const FAL_EDIT_URL = "https://fal.run/fal-ai/nano-banana-2/edit";

async function falGenerate(prompt, aspectRatio) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY environment variable is not set");

  const res = await fetch(FAL_GENERATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
      output_format: "jpeg",
      resolution: "1K",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai generation failed (${res.status}): ${body}`);
  }

  return res.json(); // { images: [{ url, file_name, content_type }], description }
}

async function falEdit(prompt, imageUrl) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY environment variable is not set");

  const res = await fetch(FAL_EDIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_urls: [imageUrl],
      num_images: 1,
      output_format: "jpeg",
      resolution: "1K",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai edit failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function downloadImage(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image (${res.status})`);

  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleGenerateImage(args) {
  const { prompt, width, height, style, output_path } = args;

  const fullPrompt = style ? `${prompt}, ${style} style` : prompt;
  const aspectRatio = mapToAspectRatio(width, height);

  const result = await falGenerate(fullPrompt, aspectRatio);

  if (!result.images || result.images.length === 0) {
    throw new Error("fal.ai returned no images");
  }

  const imageUrl = result.images[0].url;

  // Download and save the image
  await downloadImage(imageUrl, output_path);

  // Generate a thumbnail (copy of full-size for now)
  const dir = dirname(output_path);
  const baseName = output_path.split("/").pop();
  const thumbnailPath = `${dir}/thumb_${baseName}`;
  copyFileSync(output_path, thumbnailPath);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          path: output_path,
          thumbnail_path: thumbnailPath,
        }),
      },
    ],
  };
}

async function handleEditImage(args) {
  const { source_path, instructions, output_path } = args;

  // Determine image URL: if it's already a URL use it directly, otherwise base64-encode the local file
  let imageUrl;
  if (source_path.startsWith("http://") || source_path.startsWith("https://")) {
    imageUrl = source_path;
  } else {
    try {
      const fileBuffer = readFileSync(source_path);
      const base64 = fileBuffer.toString("base64");
      const mime = mimeFromExt(source_path);
      imageUrl = `data:${mime};base64,${base64}`;
    } catch (err) {
      throw new Error(`Failed to read source image: ${err.message}`);
    }
  }

  const result = await falEdit(instructions, imageUrl);

  if (!result.images || result.images.length === 0) {
    throw new Error("fal.ai returned no images from edit");
  }

  const resultUrl = result.images[0].url;
  await downloadImage(resultUrl, output_path);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          path: output_path,
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
            name: "clipcraft-imagegen",
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
          case "generate_image":
            result = await handleGenerateImage(args);
            break;
          case "edit_image":
            result = await handleEditImage(args);
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
