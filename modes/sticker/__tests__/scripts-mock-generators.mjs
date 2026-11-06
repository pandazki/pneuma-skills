/**
 * Stand-in generation adapters for the sticker.mjs CLI tests, loaded through
 * STICKER_GENERATORS. Nothing here touches a network.
 *
 *   GIF     a structurally complete GIF89a with the requested frame count,
 *           delay and logical screen, 1×1 image blocks (no ffmpeg needed to
 *           write it); with MOCK_REAL_MEDIA=1 a real transparent GIF drawn
 *           by ffmpeg — a box that moves and changes size, loop forever
 *   images  a 30-byte VP8X WebP header at the requested aspect (the craft
 *           prober reads it without ffprobe); with MOCK_REAL_MEDIA=1 a real
 *           PNG drawn by ffmpeg — transparent requests carry GPT Image
 *           2.6's haze (subject at alpha 254, a faint 1–15 fog)
 *
 * MOCK_LOG=<file>          append one JSON line per call (what was asked),
 *                          plus `start` / `end` lines with timestamps
 * MOCK_FAIL=gif|image      an upstream error after the job was accepted
 *                          (`requestId` "mock-request-failed")
 * MOCK_FAIL=refused        ECONNREFUSED — provably never sent
 * MOCK_FAIL_STICKER=s02    only the GIF whose output path is under stickers/s02/ fails
 * MOCK_NO_KEYS=1           report no API keys
 * MOCK_SLEEP_MS=<n>        a GIF "takes" n ms and honours the abort signal
 * MOCK_IMAGE_SLEEP_MS=<n>  an image "takes" n ms and honours the abort signal
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ASPECTS = { "1:1": [1024, 1024], "16:9": [1536, 864], "4:3": [1536, 1152], "3:4": [1152, 1536], "9:16": [864, 1536] };

function log(entry) {
  if (process.env.MOCK_LOG) appendFileSync(process.env.MOCK_LOG, `${JSON.stringify(entry)}\n`);
}

function maybeFail(kind, output = "") {
  const mode = process.env.MOCK_FAIL;
  const only = process.env.MOCK_FAIL_STICKER;
  if (only && !output.includes(`/stickers/${only}/`)) return;
  if (mode === kind || (only && kind === "gif" && !mode)) {
    const error = new Error(`mock upstream error: ${kind} job failed (downstream_service_error)`);
    error.requestId = "mock-request-failed";
    throw error;
  }
  if (mode === "refused") {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:443");
    error.code = "ECONNREFUSED";
    throw error;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

/** A structurally complete GIF89a: NETSCAPE loop forever, per frame a GCE and a 1×1 image. */
export function structuralGif(frames, { delayCs = 12, width = 512, height = 512 } = {}) {
  const parts = [];
  parts.push(...Buffer.from("GIF89a", "latin1"));
  parts.push(width & 0xff, width >> 8, height & 0xff, height >> 8, 0x80, 0, 0);
  parts.push(0, 0, 0, 255, 255, 255);
  parts.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0", "latin1"), 3, 1, 0, 0, 0);
  for (let i = 0; i < frames; i += 1) {
    parts.push(0x21, 0xf9, 4, 0x09, delayCs & 0xff, delayCs >> 8, 1, 0);
    parts.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0);
    parts.push(2, 2, 0x44, 0x01, 0);
  }
  parts.push(0x3b);
  return Buffer.from(parts);
}

/**
 * A real transparent GIF: a dark-outlined box on a clear background that
 * moves across and grows, `frames` frames at `frameMs`, loop forever.
 * Motion comes from overlay (evaluated per frame) — drawbox's x/y are
 * evaluated once (testing rules).
 */
export function drawGif(output, { frames, frameMs, width, height }) {
  const box = Math.round(width * 0.4);
  // Finite sources: palettegen waits for the end of its input.
  const d = ((frames * frameMs) / 1000).toFixed(3);
  const graph = [
    `color=c=0x00000000:s=${width}x${height}:r=1000/${frameMs}:d=${d},format=rgba[bg]`,
    `color=c=0x222222:s=${box}x${box}:r=1000/${frameMs}:d=${d},format=rgba,drawbox=x=8:y=8:w=${box - 16}:h=${box - 16}:color=0x6a8fd8:t=fill[fig]`,
    `[bg][fig]overlay=x='${Math.round(width * 0.1)}+n*${Math.max(1, Math.round(width * 0.3 / frames))}':y='${Math.round(height * 0.3)}+mod(n\\,4)*${Math.max(1, Math.round(height / 64))}':eval=frame,split[a][b]`,
    "[a]palettegen=reserve_transparent=1:stats_mode=full[p]",
    "[b][p]paletteuse=dither=none:alpha_threshold=128",
  ].join(";");
  mkdirSync(dirname(output), { recursive: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-filter_complex", graph, "-frames:v", String(frames), "-loop", "0", "-fflags", "+bitexact", output]);
  if (r.status !== 0) throw new Error(`mock: ffmpeg could not draw the GIF: ${r.stderr}`);
}

/** A real PNG; transparent ones carry the 2.6 haze the exporter must clean. */
export function drawPng(output, { width, height, transparent }) {
  mkdirSync(dirname(output), { recursive: true });
  const vf = transparent
    // Subject at alpha 254 inside, a faint alpha-8 fog around it, clear beyond.
    ? `color=c=0x00000000:s=${width}x${height},format=rgba,geq=r='if(lt(hypot(X-W/2,Y-H/2),W*0.3),90,200)':g='if(lt(hypot(X-W/2,Y-H/2),W*0.3),120,200)':b='if(lt(hypot(X-W/2,Y-H/2),W*0.3),200,200)':a='if(lt(hypot(X-W/2,Y-H/2),W*0.3),254,if(lt(hypot(X-W/2,Y-H/2),W*0.36),8,0))'`
    : `color=c=0x3a6ea5:s=${width}x${height},format=rgb24,drawbox=x=iw/4:y=ih/4:w=iw/2:h=ih/2:color=0xf2c14e:t=fill`;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", vf, "-frames:v", "1", "-update", "1", output]);
  if (r.status !== 0) throw new Error(`mock: ffmpeg could not draw the PNG: ${r.stderr}`);
}

function webpHeader(width, height) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "latin1");
  b.write("VP8X", 12, "latin1");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

export const falKey = () => (process.env.MOCK_NO_KEYS === "1" ? null : "mock-fal-key");
export const imageKey = () => (process.env.MOCK_NO_KEYS === "1" ? null : "mock-openrouter-key");

let calls = 0;

export async function generateGif({ prompt, output, imageUrls = [], frameCount, frameDurationMs, imageSize, quality, background, model, signal }) {
  calls += 1;
  const requestId = `mock-request-${process.pid}-${calls}`;
  log({ kind: "gif", prompt, output, imageUrls, frameCount, frameDurationMs, imageSize, quality, background, model });
  log({ kind: "start", output, at: Date.now() });
  try {
    if (process.env.MOCK_SLEEP_MS) await sleep(Number(process.env.MOCK_SLEEP_MS), signal);
    maybeFail("gif", output);
    if (existsSync(output)) throw new Error(`--output ${output} already exists`);
    const [width, height] = String(imageSize).split("x").map(Number);
    const frames = Number(frameCount);
    const frameMs = Number(frameDurationMs);
    if (process.env.MOCK_REAL_MEDIA === "1") drawGif(output, { frames, frameMs, width, height });
    else {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, structuralGif(frames, { delayCs: Math.round(frameMs / 10), width, height }), { flag: "wx" });
    }
    return { backend: "mock", model: `openai/gpt-image-2.6-${model ?? "flare"}`, requestId, files: [output], frameCount: frames, frameDurationMs: frameMs, size: { width, height } };
  } finally {
    log({ kind: "end", output, at: Date.now() });
  }
}

export async function generateImage({ prompt, model, aspectRatio, imageUrls = [], outputDir, filenamePrefix, background, signal }) {
  log({ kind: "image", prompt, model, aspectRatio, imageUrls, background });
  if (process.env.MOCK_IMAGE_SLEEP_MS) await sleep(Number(process.env.MOCK_IMAGE_SLEEP_MS), signal);
  maybeFail("image");
  const [width, height] = ASPECTS[aspectRatio] ?? [1024, 1024];
  mkdirSync(outputDir, { recursive: true });
  let file;
  if (process.env.MOCK_REAL_MEDIA === "1") {
    file = join(outputDir, `${filenamePrefix}.png`);
    drawPng(file, { width, height, transparent: background === "transparent" });
  } else {
    file = join(outputDir, `${filenamePrefix}.webp`);
    writeFileSync(file, webpHeader(width, height));
  }
  return { backend: "mock", model, files: [file], usage: { cost: 0.0421 }, ...(background === "transparent" ? { hasAlpha: true } : {}) };
}
