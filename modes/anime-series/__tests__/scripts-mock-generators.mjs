/**
 * Stand-in generation adapters for the series.mjs CLI tests, loaded through
 * ANIME_SERIES_GENERATORS. Nothing here touches a network.
 *
 *   images  a 30-byte VP8X WebP header at the requested aspect — enough for
 *           craft-project-io's probe (it reads WebP headers without ffprobe);
 *           with MOCK_REAL_MEDIA=1 a real PNG drawn by ffmpeg instead
 *   video   placeholder bytes (ffprobe cannot read them: the CLI must still
 *           land the take with a warning); with MOCK_REAL_MEDIA=1 a real
 *           MP4 of the requested duration with a tone
 *
 * MOCK_LOG=<file>        append one JSON line per call (what was asked)
 * MOCK_FAIL=image|video  throw an upstream-style error
 * MOCK_FAIL=timeout      a render fal accepted, then the wait gave up: the
 *                        error carries `requestId` "mock-request-1" (fal-queue)
 * MOCK_FAIL=refused      throw an ECONNREFUSED (provably never sent)
 * MOCK_RESUME_FAIL=1     resumeSeedanceVideo finds the recorded request failed upstream
 * MOCK_NO_KEYS=1         report no API keys (the no-key path)
 * MOCK_SLEEP_MS=<n>      a video render "takes" n ms, and honours the abort signal
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SIZES = { "1:1": [1024, 1024], "16:9": [1536, 864], "9:16": [864, 1536], "4:3": [1536, 1152], "3:4": [1152, 1536], "3:2": [1536, 1024], "2:3": [1024, 1536], "21:9": [1792, 768] };

function log(entry) {
  if (process.env.MOCK_LOG) appendFileSync(process.env.MOCK_LOG, `${JSON.stringify(entry)}\n`);
}

function maybeFail(kind) {
  const mode = process.env.MOCK_FAIL;
  if (mode === kind) throw new Error(`mock upstream error: ${kind} provider returned 500`);
  if (mode === "timeout" && kind === "video") {
    const error = new Error("Seedance 2.5 video generation exceeded 1800s");
    error.requestId = "mock-request-1";
    throw error;
  }
  if (mode === "refused") {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:443");
    error.code = "ECONNREFUSED";
    throw error;
  }
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

export const imageKey = () => (process.env.MOCK_NO_KEYS === "1" ? null : "mock-openrouter-key");
export const falKey = () => (process.env.MOCK_NO_KEYS === "1" ? null : "mock-fal-key");

export async function generateImage({ prompt, model, aspectRatio, imageUrls = [], outputDir, filenamePrefix }) {
  log({ kind: "image", prompt, model, aspectRatio, imageUrls, filenamePrefix });
  maybeFail("image");
  const [width, height] = SIZES[aspectRatio] ?? [1024, 1024];
  mkdirSync(outputDir, { recursive: true });
  let file;
  if (process.env.MOCK_REAL_MEDIA === "1") {
    file = join(outputDir, `${filenamePrefix}.png`);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x808080:s=${width}x${height}`, "-frames:v", "1", file]);
    if (r.status !== 0) throw new Error("mock: ffmpeg could not draw the image");
  } else {
    file = join(outputDir, `${filenamePrefix}.webp`);
    writeFileSync(file, webpHeader(width, height));
  }
  return { backend: "mock", model, files: [file], usage: { cost: 0.05 } };
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

function writeClip({ output, duration, resolution, requestId }) {
  mkdirSync(join(output, ".."), { recursive: true });
  const seconds = Number(duration);
  if (process.env.MOCK_REAL_MEDIA === "1") {
    const r = spawnSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", `testsrc=size=320x180:rate=24:duration=${seconds}`,
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", output,
    ]);
    if (r.status !== 0) throw new Error("mock: ffmpeg could not render the clip");
  } else {
    writeFileSync(output, Buffer.from("mock clip — not a real mp4\n"));
  }
  return {
    path: output, url: "https://example.invalid/clip.mp4", model: "bytedance/seedance-2.5", endpoint: "reference",
    requested_duration: seconds, resolution, request_id: requestId,
    cost: { usd: 0.4242, estimate: true, basis: "formula-on-delivered-clip", width: 854, height: 480, duration: seconds, tokens: 1, usdPer1000Tokens: 0.0214 },
  };
}

export async function generateSeedanceVideo({ prompt, output, duration, resolution, aspectRatio, refImages = [], signal }) {
  log({ kind: "video", prompt, duration, resolution, aspectRatio, refImages, output });
  maybeFail("video");
  if (process.env.MOCK_SLEEP_MS) await sleep(Number(process.env.MOCK_SLEEP_MS), signal);
  return writeClip({ output, duration, resolution, requestId: "mock-request-1" });
}

/** Land a render fal already accepted: no new render is "sent", the recorded request is asked about. */
export async function resumeSeedanceVideo({ requestId, prompt, output, duration, resolution, refImages = [] }) {
  log({ kind: "resume", requestId, prompt, duration, resolution, refImages, output });
  if (process.env.MOCK_RESUME_FAIL === "1") {
    const error = new Error("content policy");
    error.requestId = requestId;
    throw error;
  }
  return writeClip({ output, duration, resolution, requestId });
}
