/**
 * sticker media steps — ffmpeg / ffprobe and Node built-ins only.
 *
 * Everything after a take lands: measuring it, the contact sheet `inspect`
 * shows, and the per-platform exporters. The rules each exporter meets are
 * data in `sticker-state.mjs` (PLATFORM_PROFILES); this file only turns them
 * into ffmpeg runs and measures what came out.
 *
 * Frames. A GIF is a list of pictures, each with its own delay — not a video
 * with a frame rate (`r_frame_rate` on a GIF is a guess; sprite measured it
 * reading 12 × 90 ms as 89/4 fps). Frames are decoded once per packet
 * (`-fps_mode passthrough`) and their count must equal the shared GIF
 * reader's (`generate_gif.mjs::readGifInfo`, the one generation verifies
 * against); the delays come from that reader.
 *
 * Exporter recipe, per deliverable: frames → optional keepFrames → scale
 * with lanczos on premultiplied alpha (the GIF's transparent pixels are
 * white; straight-alpha scaling bleeds that white into the outline) →
 * alpha threshold → encode (GIF: one palette for all frames, reserved
 * transparency; WebM: VP9 yuva420p; APNG: palettegen/paletteuse) → size-fit
 * loop (colours or CRF, then frame decimation) → measure. Frames reach
 * ffmpeg as raw RGBA on stdin at a constant rate; non-uniform delays are
 * then written into the container exactly (`setGifDelays`, `setApngDelays`)
 * and read back. Every run is `-fflags +bitexact`, so the same inputs give
 * the same bytes (the matroska muxer otherwise writes a random segment id).
 *
 * Every function throws an Error naming the step; the CLI prints one line.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PLATFORM_PROFILES, keptIndices } from "./sticker-state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Shared scripts: installed beside this file, or the source checkout
// ---------------------------------------------------------------------------

/**
 * An installed skill keeps shared scripts beside this file (the manifest
 * lists them in `skill.sharedScripts`); a source checkout resolves them from
 * `modes/_shared/scripts/`. Null when neither has it.
 */
export function sharedScriptUrl(name) {
  const installed = join(HERE, name);
  if (existsSync(installed)) return pathToFileURL(installed).href;
  const source = join(HERE, "..", "..", "..", "_shared", "scripts", name);
  if (existsSync(source)) return pathToFileURL(source).href;
  return null;
}

/** Import a shared script or throw naming the whitelist it is missing from. */
export async function importShared(name, why) {
  const url = sharedScriptUrl(name);
  if (!url) throw new Error(`${name} is not installed beside this skill and is not in the source checkout — ${why} needs it (add it to the mode's skill.sharedScripts)`);
  return import(url);
}

const { readGifInfo } = await importShared("generate_gif.mjs", "reading GIF frames");
const { crc32, zipStore } = await importShared("zip.mjs", "the upload archives");

export { keptIndices, readGifInfo, zipStore };

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

const tail = (text, lines = 10) => String(text ?? "").split("\n").filter(Boolean).slice(-lines).join("\n");

/** Run ffmpeg/ffprobe; throw with the step name and stderr tail on failure. */
export function run(tool, args, { step = tool, input, timeoutMs = 300_000 } = {}) {
  const result = spawnSync(tool, args, { input, timeout: timeoutMs, maxBuffer: 1 << 30 });
  if (result.error) {
    throw new Error(result.error.code === "ENOENT" ? `${tool} is not on PATH — install ffmpeg (macOS: brew install ffmpeg · Windows: winget install Gyan.FFmpeg · Debian/Ubuntu: sudo apt install ffmpeg)` : `${step}: ${result.error.message}`);
  }
  if (result.status !== 0) throw new Error(`${step} failed (exit ${result.status}):\n${tail(result.stderr?.toString())}`);
  return result;
}

export function hasTool(tool) {
  const result = spawnSync(tool, ["-version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

let drawtextCache = null;
/** Whether this ffmpeg has drawtext (libfreetype) for contact-sheet labels. */
export function hasDrawtext() {
  if (drawtextCache === null) {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf-8" });
    drawtextCache = !result.error && result.status === 0 && /\sdrawtext\s/.test(result.stdout ?? "");
  }
  return drawtextCache;
}

function ffprobeJson(path, entries, extra = []) {
  const r = run("ffprobe", ["-v", "error", ...extra, "-show_entries", entries, "-of", "json", path], { step: `ffprobe ${path}` });
  return JSON.parse(r.stdout.toString() || "{}");
}

/** Write `bytes` through a scratch file and a rename: no reader sees a torn file. */
export function writeAtomic(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const scratch = `${path}.${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(scratch, bytes);
    renameSync(scratch, path);
  } finally {
    rmSync(scratch, { force: true });
  }
}

function scratchDir() {
  return mkdtempSync(join(tmpdir(), "sticker-media-"));
}

// ---------------------------------------------------------------------------
// GIF and APNG containers (pure)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * A GIF's block structure: logical screen, one entry per image descriptor
 * with its Graphic Control Extension's delay (and that field's byte offset,
 * for `setGifDelays`), and the NETSCAPE2.0 loop count — 0 plays forever,
 * null means the block is absent (the GIF plays once). Throws for anything
 * that is not a complete GIF.
 */
export function gifStructure(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const signature = b.length >= 6 ? b.toString("latin1", 0, 6) : "";
  if (signature !== "GIF89a" && signature !== "GIF87a") throw new Error("not a GIF");
  if (b.length < 13) throw new Error("truncated GIF");
  const width = b.readUInt16LE(6);
  const height = b.readUInt16LE(8);
  let p = 13;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
  const need = (n) => {
    if (p + n > b.length) throw new Error("truncated GIF");
  };
  const skipSubBlocks = () => {
    for (;;) {
      need(1);
      const size = b[p];
      p += 1;
      if (size === 0) return;
      need(size);
      p += size;
    }
  };
  const delaysMs = [];
  const delayOffsets = [];
  let loopCount = null;
  let pending = null;
  for (;;) {
    need(1);
    const introducer = b[p];
    p += 1;
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      need(1);
      const label = b[p];
      p += 1;
      if (label === 0xf9) {
        need(6);
        pending = { delay: b.readUInt16LE(p + 2) * 10, offset: p + 2 };
        p += 1 + b[p];
        skipSubBlocks();
      } else if (label === 0xff) {
        need(1);
        const size = b[p];
        need(1 + size);
        const app = b.toString("latin1", p + 1, p + 1 + size);
        p += 1 + size;
        if ((app === "NETSCAPE2.0" || app === "ANIMEXTS1.0") && p + 4 <= b.length && b[p] === 3 && b[p + 1] === 1) loopCount = b.readUInt16LE(p + 2);
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
      continue;
    }
    if (introducer === 0x2c) {
      need(9);
      const flags = b[p + 8];
      p += 9;
      if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
      need(1);
      p += 1;
      skipSubBlocks();
      delaysMs.push(pending?.delay ?? 0);
      delayOffsets.push(pending?.offset ?? -1);
      pending = null;
      continue;
    }
    throw new Error(`malformed GIF: unexpected block 0x${introducer.toString(16)} at byte ${p - 1}`);
  }
  if (!delaysMs.length) throw new Error("the GIF holds no frames");
  return { width, height, frames: delaysMs.length, delaysMs, delayOffsets, loopCount };
}

/** A copy of `bytes` with each frame's delay set (rounded to the GIF's 10 ms unit). */
export function setGifDelays(bytes, delaysMs) {
  const info = gifStructure(bytes);
  if (delaysMs.length !== info.frames) throw new Error(`setGifDelays: ${delaysMs.length} delays for ${info.frames} frames`);
  const out = Buffer.from(bytes);
  info.delayOffsets.forEach((offset, i) => {
    if (offset < 0) throw new Error(`setGifDelays: frame ${i} has no graphic control extension`);
    out.writeUInt16LE(Math.max(1, Math.round(delaysMs[i] / 10)), offset);
  });
  return out;
}

/** PNG chunks: `{ type, offset, length }` (offset of the length field). */
function pngChunks(b) {
  if (b.length < 8 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  const out = [];
  for (let p = 8; p + 12 <= b.length;) {
    const length = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    if (p + 12 + length > b.length) throw new Error(`truncated PNG chunk ${type}`);
    out.push({ type, offset: p, length });
    p += 12 + length;
    if (type === "IEND") break;
  }
  return out;
}

/**
 * A PNG's size and, when it is animated, its frames: `num_plays` (0 =
 * forever) and every fcTL's delay in ms. A plain PNG reads as one frame.
 */
export function apngInfo(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const chunks = pngChunks(b);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("PNG without IHDR");
  const width = b.readUInt32BE(ihdr.offset + 8);
  const height = b.readUInt32BE(ihdr.offset + 12);
  const actl = chunks.find((c) => c.type === "acTL");
  if (!actl) return { width, height, animated: false, frames: 1, plays: null, delaysMs: [], fctl: [] };
  const declared = b.readUInt32BE(actl.offset + 8);
  const plays = b.readUInt32BE(actl.offset + 12);
  const fctl = chunks.filter((c) => c.type === "fcTL");
  const delaysMs = fctl.map((c) => {
    const num = b.readUInt16BE(c.offset + 8 + 20);
    const den = b.readUInt16BE(c.offset + 8 + 22) || 100;
    return Math.round((num / den) * 1000);
  });
  if (declared !== fctl.length) throw new Error(`APNG declares ${declared} frames but holds ${fctl.length}`);
  return { width, height, animated: true, frames: fctl.length, plays, delaysMs, fctl };
}

/** A copy of an APNG with each frame's delay set to `delaysMs[i]` / 1000 s (CRCs rewritten). */
export function setApngDelays(bytes, delaysMs) {
  const info = apngInfo(bytes);
  if (!info.animated) throw new Error("setApngDelays: not an animated PNG");
  if (delaysMs.length !== info.frames) throw new Error(`setApngDelays: ${delaysMs.length} delays for ${info.frames} frames`);
  const out = Buffer.from(bytes);
  info.fctl.forEach((c, i) => {
    const ms = Math.round(delaysMs[i]);
    if (ms < 0 || ms > 65535) throw new Error(`setApngDelays: ${ms} ms does not fit an fcTL delay`);
    out.writeUInt16BE(ms, c.offset + 8 + 20);
    out.writeUInt16BE(1000, c.offset + 8 + 22);
    out.writeUInt32BE(crc32(out.subarray(c.offset + 4, c.offset + 8 + c.length)), c.offset + 8 + c.length);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Pixels (pure, over RGBA buffers)
// ---------------------------------------------------------------------------

/** Browsers and ffmpeg show a GIF delay of 10 ms or less as 100 ms. */
export function effectiveDelays(delaysMs) {
  return delaysMs.map((d) => (d <= 10 ? 100 : d));
}

/**
 * The still-art alpha step: OpenRouter's GPT Image 2.6 "transparent" PNGs
 * hold the subject at alpha 253–254 (52% of the flat reference) plus a
 * faint 1–15 fog (2026-11-06). Near-opaque becomes opaque, faint becomes
 * clear (RGB zeroed); the anti-aliased edge in between is kept.
 */
export const STILL_ALPHA = Object.freeze({ clearAtOrBelow: 15, opaqueAtOrAbove: 240 });

export function cleanStillAlpha(rgba, { clearAtOrBelow = STILL_ALPHA.clearAtOrBelow, opaqueAtOrAbove = STILL_ALPHA.opaqueAtOrAbove } = {}) {
  const out = Buffer.from(rgba);
  let cleared = 0;
  let raised = 0;
  for (let i = 3; i < out.length; i += 4) {
    const a = out[i];
    if (a === 0) continue;
    if (a <= clearAtOrBelow) {
      out[i - 3] = 0; out[i - 2] = 0; out[i - 1] = 0; out[i] = 0;
      cleared += 1;
    } else if (a >= opaqueAtOrAbove && a < 255) {
      out[i] = 255;
      raised += 1;
    }
  }
  return { rgba: out, cleared, raised };
}

/** Fraction of pixels whose alpha is ≥ threshold. */
export function coverage(frame, threshold = 128) {
  let n = 0;
  for (let i = 3; i < frame.length; i += 4) if (frame[i] >= threshold) n += 1;
  return n / (frame.length / 4);
}

/** The box around alpha ≥ threshold, or null for an empty frame. */
export function alphaBox(frame, width, height, threshold = 128) {
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (frame[row + x * 4 + 3] >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function unionBox(boxes) {
  const present = boxes.filter(Boolean);
  if (!present.length) return null;
  const x = Math.min(...present.map((b) => b.x));
  const y = Math.min(...present.map((b) => b.y));
  const right = Math.max(...present.map((b) => b.x + b.width));
  const bottom = Math.max(...present.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Mean |Δ premultiplied luma| / 255 between two frames, on a 4-px grid. */
export function frameDiff(a, b, width, height) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      const la = ((a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114) * a[i + 3]) / 255;
      const lb = ((b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114) * b[i + 3]) / 255;
      sum += Math.abs(la - lb);
      n += 1;
    }
  }
  return n ? sum / n / 255 : 0;
}

const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round4 = (x) => Math.round(x * 10000) / 10000;

/**
 * Alpha over a whole animation: `clear` / `semi` are fractions of every
 * pixel of every frame; `cornersClear`: the four corners of every frame
 * are transparent; `edgeWhite`: on frame 0, the share of outline pixels
 * (opaque with a clear neighbour) that are near-white.
 */
export function alphaStats(frames, width, height) {
  let clear = 0;
  let semi = 0;
  let total = 0;
  let cornersClear = true;
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((p) => p * 4 + 3);
  for (const f of frames) {
    for (let i = 3; i < f.length; i += 4) {
      const a = f[i];
      if (a === 0) clear += 1;
      else if (a < 255) semi += 1;
    }
    total += f.length / 4;
    if (corners.some((c) => f[c] !== 0)) cornersClear = false;
  }
  let edge = 0;
  let white = 0;
  const f0 = frames[0];
  if (f0) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const p = (y * width + x) * 4;
        if (f0[p + 3] < 128) continue;
        if (![p - 4, p + 4, p - width * 4, p + width * 4].some((q) => f0[q + 3] < 128)) continue;
        edge += 1;
        if (f0[p] >= 225 && f0[p + 1] >= 225 && f0[p + 2] >= 225) white += 1;
      }
    }
  }
  return { channel: true, clear: round4(clear / total), semi: round4(semi / total), cornersClear, edgeWhite: edge ? round4(white / edge) : 0 };
}

/** Share of near-white pixels (each channel ≥ 235) of an opaque frame. */
export function nearWhiteFraction(frame) {
  let n = 0;
  for (let i = 0; i < frame.length; i += 4) if (frame[i] >= 235 && frame[i + 1] >= 235 && frame[i + 2] >= 235) n += 1;
  return round4(n / (frame.length / 4));
}

/**
 * Motion numbers for `inspect` and the take record: adjacent-frame diffs,
 * the loop seam (last → first) against their median, how far the bottom of
 * the figure moves (`groundDrift`, px) and how much its height varies
 * (`sizeDrift`, fraction of the median height).
 */
export function motionStats(frames, width, height) {
  const steps = [];
  for (let i = 1; i < frames.length; i += 1) steps.push(frameDiff(frames[i - 1], frames[i], width, height));
  const seam = frames.length > 1 ? frameDiff(frames[frames.length - 1], frames[0], width, height) : 0;
  const med = median(steps);
  const boxes = frames.map((f) => alphaBox(f, width, height));
  const present = boxes.filter(Boolean);
  const bottoms = present.map((b) => b.y + b.height);
  const heights = present.map((b) => b.height);
  const medHeight = median(heights);
  return {
    steps: steps.map(round4),
    mean: round4(steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : 0),
    seam: round4(seam),
    seamRatio: med > 0 ? round4(seam / med) : null,
    groundDrift: bottoms.length ? Math.max(...bottoms) - Math.min(...bottoms) : 0,
    sizeDrift: medHeight ? round4((Math.max(...heights) - Math.min(...heights)) / medHeight) : 0,
    emptyFrames: boxes.map((b, i) => (b ? null : i)).filter((i) => i !== null),
  };
}

export function allIdentical(frames) {
  return frames.length > 0 && frames.every((f) => f.equals(frames[0]));
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

function splitFrames(raw, width, height) {
  const size = width * height * 4;
  if (raw.length % size) throw new Error(`decoded ${raw.length} bytes, not a whole number of ${width}×${height} frames`);
  const frames = [];
  for (let i = 0; i < raw.length; i += size) frames.push(raw.subarray(i, i + size));
  return frames;
}

/** Premultiplied lanczos resize, the one scaling every step uses. */
function scaleChain(width, height) {
  return `format=rgba,premultiply=inplace=1,scale=${width}:${height}:flags=lanczos,unpremultiply=inplace=1`;
}

/**
 * Every frame of a GIF / APNG / WebM as RGBA, one per packet
 * (`-fps_mode passthrough`), optionally resized. WebM is decoded with
 * libvpx so its alpha survives (ffmpeg's own vp9 decoder drops it).
 */
export function decodeFrames(path, { width, height, codec, scaleTo } = {}) {
  const pre = codec ? ["-c:v", codec] : [];
  const vf = scaleTo ? ["-vf", scaleChain(scaleTo.width, scaleTo.height)] : [];
  const r = run("ffmpeg", ["-v", "error", ...pre, "-i", path, "-fps_mode", "passthrough", ...vf, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { step: `decoding ${path}` });
  const w = scaleTo?.width ?? width;
  const h = scaleTo?.height ?? height;
  return splitFrames(r.stdout, w, h);
}

/**
 * A GIF's frames and the delays they are shown for. The frame count is the
 * shared reader's (`readGifInfo`); ffmpeg must decode exactly that many.
 */
export function readGifFrames(path, { scaleTo } = {}) {
  const bytes = readFileSync(path);
  const info = readGifInfo(bytes);
  const frames = decodeFrames(path, { width: info.width, height: info.height, scaleTo });
  if (frames.length !== info.frames) throw new Error(`${path}: the GIF holds ${info.frames} frames but ffmpeg decoded ${frames.length}`);
  return { width: scaleTo?.width ?? info.width, height: scaleTo?.height ?? info.height, frames, delaysMs: effectiveDelays(info.delaysMs), info };
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/**
 * A take as it landed: structure from the bytes alone (no ffmpeg), pixel
 * numbers when ffmpeg is there (`pixels: false` skips them; a missing
 * ffmpeg leaves `pixels: null` and a note, never a failure — the paid file
 * is recorded regardless).
 *
 * With `keepFrames`, the numbers are the trimmed loop's — the frames every
 * export plays: their count, delays and length, and alpha and motion over
 * them, the seam running from the last kept frame back to the first.
 * `kept` and `framesInTake` say so; bytes, size and loop stay the file's.
 */
export function measureTake(path, { pixels = true, keepFrames = null } = {}) {
  const bytes = readFileSync(path);
  const info = readGifInfo(bytes);
  const loop = gifStructure(bytes).loopCount;
  const kept = keepFrames ? keptIndices(info.frames, keepFrames) : null;
  const allDelays = effectiveDelays(info.delaysMs);
  const delaysMs = kept ? kept.map((i) => allDelays[i]) : allDelays;
  const measure = {
    format: "gif",
    bytes: bytes.length,
    width: info.width,
    height: info.height,
    frames: delaysMs.length,
    delaysMs,
    durationMs: delaysMs.reduce((a, b) => a + b, 0),
    loopCount: loop,
    ...(kept ? { kept, framesInTake: info.frames } : {}),
  };
  if (!pixels) return { measure, note: null };
  if (!hasTool("ffmpeg")) return { measure: { ...measure, pixels: null }, note: "ffmpeg is not installed — the take's alpha and motion numbers were not measured (sticker.mjs inspect measures them later)" };
  const { frames, width, height } = readGifFrames(path);
  return { measure: { ...measure, ...pixelMeasure(kept ? kept.map((i) => frames[i]) : frames, width, height) }, note: null };
}

function pixelMeasure(frames, width, height) {
  const cov = frames.map((f) => coverage(f));
  const med = median(cov);
  return {
    alpha: alphaStats(frames, width, height),
    identical: allIdentical(frames),
    firstFrameCoverage: med > 0 ? round4(cov[0] / med) : 0,
    motion: motionStats(frames, width, height),
  };
}

function marginOf(frames, width, height) {
  const box = unionBox(frames.map((f) => alphaBox(f, width, height)));
  if (!box) return null;
  return Math.min(box.x, box.y, width - box.x - box.width, height - box.y - box.height);
}

/** Measure an exported animation (GIF, APNG or WebM) from its file. */
export function measureAnimation(path, format) {
  const bytes = readFileSync(path);
  if (format === "gif") {
    const s = gifStructure(bytes);
    const info = readGifInfo(bytes);
    const frames = decodeFrames(path, { width: info.width, height: info.height });
    if (frames.length !== info.frames) throw new Error(`${path}: ${info.frames} frames in the file, ${frames.length} decoded`);
    const delaysMs = effectiveDelays(info.delaysMs);
    return { format, bytes: bytes.length, width: info.width, height: info.height, frames: info.frames, delaysMs, durationMs: delaysMs.reduce((a, b) => a + b, 0), loopCount: s.loopCount, ...pixelMeasure(frames, info.width, info.height), margin: marginOf(frames, info.width, info.height) };
  }
  if (format === "apng") {
    const info = apngInfo(bytes);
    if (!info.animated) throw new Error(`${path} is not an animated PNG`);
    const frames = decodeFrames(path, { width: info.width, height: info.height });
    if (frames.length !== info.frames) throw new Error(`${path}: ${info.frames} frames in the file, ${frames.length} decoded`);
    return { format, bytes: bytes.length, width: info.width, height: info.height, frames: info.frames, delaysMs: info.delaysMs, durationMs: info.delaysMs.reduce((a, b) => a + b, 0), loopCount: info.plays, ...pixelMeasure(frames, info.width, info.height), margin: marginOf(frames, info.width, info.height) };
  }
  if (format === "webm") {
    const probe = ffprobeJson(path, "stream=index,codec_type,codec_name,width,height,r_frame_rate:stream_tags=alpha_mode");
    const video = (probe.streams ?? []).find((s) => s.codec_type === "video");
    if (!video) throw new Error(`${path} has no video stream`);
    const [num, den] = String(video.r_frame_rate ?? "0/1").split("/").map(Number);
    const fps = den ? Math.round((num / den) * 1000) / 1000 : 0;
    const frames = decodeFrames(path, { width: video.width, height: video.height, codec: "libvpx-vp9" });
    const alphaTag = video.tags?.alpha_mode ?? video.tags?.ALPHA_MODE;
    const pixels = pixelMeasure(frames, video.width, video.height);
    return {
      format, bytes: bytes.length, width: video.width, height: video.height, codec: video.codec_name,
      frames: frames.length, fps, durationMs: fps ? Math.round((frames.length / fps) * 1000) : 0, loopCount: null,
      hasAudio: (probe.streams ?? []).some((s) => s.codec_type === "audio"),
      ...pixels,
      alpha: { ...pixels.alpha, channel: String(alphaTag) === "1" },
    };
  }
  throw new Error(`cannot measure format '${format}'`);
}

/** Measure an exported (or landed) still: PNG or JPEG. */
export function measureStill(path) {
  const bytes = readFileSync(path);
  const isPng = bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  const probe = ffprobeJson(path, "stream=width,height,pix_fmt");
  const s = (probe.streams ?? [])[0];
  if (!s?.width) throw new Error(`ffprobe could not read ${path}`);
  const [frame] = decodeFrames(path, { width: s.width, height: s.height });
  const pixFmt = String(s.pix_fmt ?? "");
  const hasAlpha = isPng && (/^(rgba|bgra|argb|abgr|ya8|ya16|rgba64)/.test(pixFmt) || (pixFmt === "pal8" && pngChunks(bytes).some((c) => c.type === "tRNS")));
  const alpha = alphaStats([frame], s.width, s.height);
  return {
    format: isPng ? "png" : "jpg",
    bytes: bytes.length,
    width: s.width,
    height: s.height,
    alpha: { ...alpha, channel: hasAlpha },
    nearWhite: nearWhiteFraction(frame),
  };
}

// ---------------------------------------------------------------------------
// Timelines (pure)
// ---------------------------------------------------------------------------


/**
 * Drop frames to every `step`-th, each kept frame absorbing the delays of
 * the frames it stands for — the loop keeps its length.
 */
export function decimate(indices, delaysMs, step) {
  if (step <= 1) return { indices: [...indices], delaysMs: [...delaysMs] };
  const outI = [];
  const outD = [];
  for (let i = 0; i < indices.length; i += step) {
    outI.push(indices[i]);
    outD.push(delaysMs.slice(i, i + step).reduce((a, b) => a + b, 0));
  }
  return { indices: outI, delaysMs: outD };
}

/**
 * LINE's timing: 5–20 frames, one loop ≤ 4 s, 1–4 plays within 4 s.
 * Too many frames → decimate (`extraStep` decimates further for the
 * size fit, never below 5 frames); too few → the loop repeats inside the
 * file; a loop over 4 s → played faster (delays scaled down, `speed`).
 */
export function lineTiming(indices, delaysMs, { extraStep = 1 } = {}) {
  const rules = PLATFORM_PROFILES.line.sticker;
  const base = Math.max(1, Math.ceil(indices.length / rules.maxFrames));
  // The size fit's extra decimation never takes a loop under the minimum.
  const step = Math.ceil(indices.length / (base * extraStep)) >= rules.minFrames ? base * extraStep : base;
  let { indices: idx, delaysMs: del } = decimate(indices, delaysMs, step);
  let repeats = 1;
  if (idx.length < rules.minFrames) {
    repeats = Math.ceil(rules.minFrames / idx.length);
    idx = Array.from({ length: repeats }, () => idx).flat();
    del = Array.from({ length: repeats }, () => del).flat();
  }
  const loop = del.reduce((a, b) => a + b, 0);
  let speed = 1;
  if (loop > rules.maxLoopMs) {
    speed = rules.maxLoopMs / loop;
    del = del.map((d) => Math.max(1, Math.floor(d * speed)));
  }
  const loopMs = del.reduce((a, b) => a + b, 0);
  const plays = Math.max(rules.minPlays, Math.min(rules.maxPlays, Math.floor(rules.maxTotalMs / loopMs)));
  return { indices: idx, delaysMs: del, plays, step, repeats, speed: round4(speed), loopMs };
}

/**
 * Telegram's timeline: a constant `fps`, by time — output frame k shows the
 * source frame on screen at k / fps — with the loop played faster when it
 * is longer than `maxMs`.
 */
export function constantRateTimeline(indices, delaysMs, { fps, maxMs }) {
  const total = delaysMs.reduce((a, b) => a + b, 0);
  const speed = total > maxMs ? maxMs / total : 1;
  const count = Math.max(1, Math.min(Math.floor((maxMs * fps) / 1000), Math.round((total * speed * fps) / 1000)));
  const starts = [];
  let t = 0;
  for (const d of delaysMs) {
    starts.push(t * speed);
    t += d;
  }
  const order = [];
  for (let k = 0; k < count; k += 1) {
    const at = (k * 1000) / fps;
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= at + 1e-9) i += 1;
    order.push(indices[i]);
  }
  return { order, frames: count, durationMs: Math.round((count * 1000) / fps), speed: round4(speed) };
}

// ---------------------------------------------------------------------------
// Geometry (pure)
// ---------------------------------------------------------------------------

/** Fit `w×h` inside `W×H`, keeping the aspect; the longer fit side is exact. */
export function fitInside(w, h, W, H) {
  const s = Math.min(W / w, H / h);
  const tw = Math.min(W, Math.max(1, s === W / w ? W : Math.round(w * s)));
  const th = Math.min(H, Math.max(1, s === H / h ? H : Math.round(h * s)));
  return { width: tw, height: th };
}

/** The ffmpeg chain from a source frame to a deliverable's canvas. */
export function geometryChain(src, target) {
  if (target.kind === "pad") {
    const fit = fitInside(src.width, src.height, target.width, target.height);
    const x = Math.floor((target.width - fit.width) / 2);
    const y = Math.floor((target.height - fit.height) / 2);
    return { chain: `${scaleChain(fit.width, fit.height)},pad=${target.width}:${target.height}:${x}:${y}:color=0x00000000`, width: target.width, height: target.height };
  }
  if (target.kind === "crop-fit") {
    const { x, y, width, height } = target.crop;
    const fit = fitInside(width, height, target.maxWidth, target.maxHeight);
    return { chain: `crop=${width}:${height}:${x}:${y},${scaleChain(fit.width, fit.height)}`, width: fit.width, height: fit.height };
  }
  if (target.kind === "edge") {
    const fit = fitInside(src.width, src.height, target.edge, target.edge);
    // yuva420p needs even sides; the long side stays exactly `edge`.
    const even = (n, exact) => (n === exact ? n : n - (n % 2));
    const width = even(fit.width, target.edge);
    const height = even(fit.height, target.edge);
    return { chain: scaleChain(width, height), width, height };
  }
  if (target.kind === "cover") {
    const s = Math.max(target.width / src.width, target.height / src.height);
    const sw = Math.max(target.width, Math.round(src.width * s));
    const sh = Math.max(target.height, Math.round(src.height * s));
    return { chain: `scale=${sw}:${sh}:flags=lanczos,crop=${target.width}:${target.height}:${Math.floor((sw - target.width) / 2)}:${Math.floor((sh - target.height) / 2)}`, width: target.width, height: target.height };
  }
  throw new Error(`unknown geometry '${target.kind}'`);
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

const BITEXACT = ["-fflags", "+bitexact", "-flags:v", "+bitexact"];
const PALETTE_COLORS = Object.freeze([256, 128, 96, 64, 48, 32]);
const WEBM_CRF = Object.freeze([30, 34, 38, 42, 46, 50, 56, 63]);

function rawInput(width, height, rate) {
  return ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-framerate", rate, "-i", "pipe:0"];
}

function uniform(delaysMs) {
  return delaysMs.every((d) => d === delaysMs[0]);
}

/** A frame rate ffmpeg takes for a delay in ms ("1000/120"). */
function rateFor(delaysMs) {
  return `1000/${Math.max(1, Math.round(median(delaysMs)))}`;
}

function paletteGraph(chain, colors) {
  return `[0:v]${chain},split[a][b];[a]palettegen=max_colors=${colors}:reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=none:alpha_threshold=128`;
}

/** Encode frames as a looping GIF with exact per-frame delays. */
export function encodeGif({ frames, width, height, delaysMs, chain, colors }) {
  const dir = scratchDir();
  try {
    const out = join(dir, "out.gif");
    run("ffmpeg", ["-v", "error", "-y", ...rawInput(width, height, rateFor(delaysMs)), "-filter_complex", paletteGraph(chain, colors), ...BITEXACT, "-loop", "0", "-f", "gif", out], { step: "GIF encode", input: Buffer.concat(frames) });
    let bytes = readFileSync(out);
    if (!uniform(delaysMs) || gifStructure(bytes).delaysMs.some((d, i) => d !== Math.round(delaysMs[i] / 10) * 10)) bytes = setGifDelays(bytes, delaysMs);
    return bytes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Encode frames as an APNG (palette, reserved transparency) playing `plays` times. */
export function encodeApng({ frames, width, height, delaysMs, chain, colors, plays }) {
  const dir = scratchDir();
  try {
    const out = join(dir, "out.png");
    run("ffmpeg", ["-v", "error", "-y", ...rawInput(width, height, rateFor(delaysMs)), "-filter_complex", paletteGraph(chain, colors), ...BITEXACT, "-plays", String(plays), "-f", "apng", out], { step: "APNG encode", input: Buffer.concat(frames) });
    let bytes = readFileSync(out);
    const info = apngInfo(bytes);
    if (info.frames !== frames.length) throw new Error(`APNG encode: ${frames.length} frames in, ${info.frames} out`);
    if (info.delaysMs.some((d, i) => d !== delaysMs[i])) bytes = setApngDelays(bytes, delaysMs);
    return bytes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Encode a constant-rate frame list as VP9 + alpha WebM, no audio. */
export function encodeWebm({ frames, width, height, chain, fps, crf }) {
  const dir = scratchDir();
  try {
    const out = join(dir, "out.webm");
    run("ffmpeg", ["-v", "error", "-y", ...rawInput(width, height, String(fps)), "-vf", chain, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", String(crf), "-deadline", "good", "-cpu-used", "1", "-row-mt", "0", "-threads", "1", "-an", ...BITEXACT, "-f", "webm", out], { step: "WebM encode", input: Buffer.concat(frames), timeoutMs: 600_000 });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Encode one RGBA frame as PNG (rgba, or rgb24 when opaque) or JPEG. */
export function encodeStill({ frame, width, height, chain, format, colors, quality }) {
  const dir = scratchDir();
  try {
    const out = join(dir, format === "jpg" ? "out.jpg" : "out.png");
    const args = ["-v", "error", "-y", ...rawInput(width, height, "1")];
    if (format === "png-palette") args.push("-filter_complex", paletteGraph(chain, colors));
    else args.push("-vf", chain);
    if (format === "png") args.push("-pix_fmt", "rgba");
    if (format === "png-opaque") args.push("-pix_fmt", "rgb24");
    if (format === "jpg") args.push("-pix_fmt", "yuvj444p", "-q:v", String(quality ?? 2));
    args.push(...BITEXACT, "-frames:v", "1", "-update", "1", out);
    run("ffmpeg", args, { step: `${format} encode`, input: frame });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Exporters (size-fit loops)
// ---------------------------------------------------------------------------

function measureBytes(bytes, ext, format) {
  const dir = scratchDir();
  try {
    const file = join(dir, `m.${ext}`);
    writeFileSync(file, bytes);
    return format === "png" || format === "jpg" ? measureStill(file) : measureAnimation(file, format);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One sticker for one platform, from its take's frames (`source` from
 * `readGifFrames`) and keepFrames. Returns `{ bytes, ext, measure }`;
 * `measure.fit` records what the size fit settled on, and `fit.ok` is
 * false when no setting met the byte limit (the best attempt is returned so
 * it can be looked at; the check fails it).
 */
export function exportSticker(platform, source, keepFrames) {
  const rules = PLATFORM_PROFILES[platform].sticker;
  const kept = keptIndices(source.frames.length, keepFrames);
  const keptDelays = kept.map((i) => source.delaysMs[i]);
  const src = { width: source.width, height: source.height };
  let last = null;

  if (platform === "wechat") {
    const geo = geometryChain(src, { kind: "pad", width: rules.width, height: rules.height });
    for (const step of [1, 2, 3]) {
      const { indices, delaysMs } = decimate(kept, keptDelays, step);
      if (indices.length < 2) break;
      for (const colors of PALETTE_COLORS) {
        const bytes = encodeGif({ frames: indices.map((i) => source.frames[i]), width: src.width, height: src.height, delaysMs, chain: geo.chain, colors });
        last = { bytes, fit: { colors, step } };
        if (bytes.length <= rules.maxBytes) return finish(last, "gif", "gif", true);
      }
    }
    return finish(last, "gif", "gif", false);
  }

  if (platform === "telegram") {
    const geo = geometryChain(src, { kind: "edge", edge: rules.edge });
    const timeline = constantRateTimeline(kept, keptDelays, { fps: rules.fps, maxMs: rules.maxDurationMs });
    const frames = timeline.order.map((i) => source.frames[i]);
    for (const crf of WEBM_CRF) {
      const bytes = encodeWebm({ frames, width: src.width, height: src.height, chain: geo.chain, fps: rules.fps, crf });
      last = { bytes, fit: { crf, speed: timeline.speed } };
      if (bytes.length <= rules.maxBytes) return finish(last, "webm", "webm", true);
    }
    return finish(last, "webm", "webm", false);
  }

  if (platform === "line") {
    const box = unionBox(kept.map((i) => alphaBox(source.frames[i], src.width, src.height))) ?? { x: 0, y: 0, ...src };
    const geo = geometryChain(src, { kind: "crop-fit", crop: box, maxWidth: rules.maxWidth, maxHeight: rules.maxHeight });
    for (const extraStep of [1, 2]) {
      const timing = lineTiming(kept, keptDelays, { extraStep });
      if (extraStep > 1 && timing.indices.length === lineTiming(kept, keptDelays).indices.length) break;
      for (const colors of PALETTE_COLORS) {
        const bytes = encodeApng({ frames: timing.indices.map((i) => source.frames[i]), width: src.width, height: src.height, delaysMs: timing.delaysMs, chain: geo.chain, colors, plays: timing.plays });
        last = { bytes, fit: { colors, step: timing.step, repeats: timing.repeats, speed: timing.speed, plays: timing.plays } };
        if (bytes.length <= rules.maxBytes) return finish(last, "png", "apng", true);
      }
    }
    return finish(last, "png", "apng", false);
  }
  throw new Error(`unknown platform '${platform}'`);
}

function finish(last, ext, format, ok) {
  if (!last) throw new Error("nothing was encoded");
  const measure = measureBytes(last.bytes, ext, format);
  return { bytes: last.bytes, ext, measure: { ...measure, fit: { ...last.fit, ok } } };
}

/** LINE's main image: an APNG at exactly 240×240 from a sticker's take. */
export function exportLineMain(source, keepFrames) {
  const spec = PLATFORM_PROFILES.line.deliverables.main;
  const kept = keptIndices(source.frames.length, keepFrames);
  const keptDelays = kept.map((i) => source.delaysMs[i]);
  const geo = geometryChain({ width: source.width, height: source.height }, { kind: "pad", width: spec.width, height: spec.height });
  let last = null;
  for (const extraStep of [1, 2]) {
    const timing = lineTiming(kept, keptDelays, { extraStep });
    for (const colors of PALETTE_COLORS) {
      const bytes = encodeApng({ frames: timing.indices.map((i) => source.frames[i]), width: source.width, height: source.height, delaysMs: timing.delaysMs, chain: geo.chain, colors, plays: timing.plays });
      last = { bytes, fit: { colors, step: timing.step, repeats: timing.repeats, speed: timing.speed, plays: timing.plays } };
      if (bytes.length <= spec.maxBytes) return finish(last, "png", "apng", true);
    }
  }
  return finish(last, "png", "apng", false);
}

/**
 * A still deliverable from a piece of art — or, with `frame`, from that
 * frame (0-based) of a sticker's take (Telegram's thumbnail when no portrait
 * art is picked). Transparent kinds get the alpha step (`cleanStillAlpha`)
 * and stay RGBA PNG (palette PNG when over the limit); opaque kinds are PNG,
 * then JPEG where the platform allows it.
 */
export function exportStill(spec, artPath, { frame: index = 0 } = {}) {
  const probe = ffprobeJson(artPath, "stream=width,height");
  const s = (probe.streams ?? [])[0];
  if (!s?.width) throw new Error(`ffprobe could not read ${artPath}`);
  const frames = decodeFrames(artPath, { width: s.width, height: s.height });
  if (!Number.isInteger(index) || index < 0 || index >= frames.length) throw new Error(`${artPath} has ${frames.length} frame(s); there is no frame ${index}`);
  const frame = frames[index];
  const src = { width: s.width, height: s.height };
  const attempts = [];
  if (spec.alpha === "transparent") {
    // The alpha step runs twice: on the art (its haze), then on the resized
    // frame (lanczos rings a 1–4 alpha a few px outside the outline).
    const geo = geometryChain(src, { kind: spec.fit, width: spec.width, height: spec.height });
    const resized = resizeRgba(cleanStillAlpha(frame).rgba, src, geo);
    const sized = cleanStillAlpha(resized).rgba;
    attempts.push({ format: "png", ext: "png" });
    for (const colors of PALETTE_COLORS) attempts.push({ format: "png-palette", ext: "png", colors });
    return fitStill(attempts, (a) => encodeStill({ frame: sized, width: geo.width, height: geo.height, chain: "format=rgba", format: a.format, colors: a.colors }), spec);
  }
  const geo = geometryChain(src, { kind: "cover", width: spec.width, height: spec.height });
  const chain = `format=rgba,${geo.chain},format=rgb24`;
  attempts.push({ format: "png-opaque", ext: "png" });
  if (spec.formats.includes("jpg")) for (const quality of [2, 4, 6, 8, 12]) attempts.push({ format: "jpg", ext: "jpg", quality });
  return fitStill(attempts, (a) => encodeStill({ frame, width: src.width, height: src.height, chain, format: a.format, quality: a.quality }), spec);
}

/** One RGBA frame through a geometry chain, back as RGBA at the chain's size. */
function resizeRgba(frame, src, geo) {
  const r = run("ffmpeg", ["-v", "error", ...rawInput(src.width, src.height, "1"), "-vf", geo.chain, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { step: "resize", input: frame });
  if (r.stdout.length !== geo.width * geo.height * 4) throw new Error(`resize: expected ${geo.width}×${geo.height} RGBA, got ${r.stdout.length} bytes`);
  return r.stdout;
}

function fitStill(attempts, encode, spec) {
  let last = null;
  for (const a of attempts) {
    const bytes = encode(a);
    last = { bytes, a };
    if (bytes.length <= spec.maxBytes) break;
  }
  const measure = measureBytes(last.bytes, last.a.ext, last.a.ext === "jpg" ? "jpg" : "png");
  return { bytes: last.bytes, ext: last.a.ext, measure: { ...measure, fit: { format: last.a.format, ...(last.a.colors ? { colors: last.a.colors } : {}), ...(last.a.quality ? { quality: last.a.quality } : {}), ok: last.bytes.length <= spec.maxBytes } } };
}

/** The store-only archive, byte-identical for the same entries. */
export const ARCHIVE_DATE = new Date(1980, 0, 1, 0, 0, 0);
export function archive(entries) {
  return zipStore(entries, { date: ARCHIVE_DATE });
}

// ---------------------------------------------------------------------------
// Contact sheet
// ---------------------------------------------------------------------------

export const PLATES = Object.freeze({ light: [0xed, 0xed, 0xed], dark: [0x11, 0x11, 0x11] });

/**
 * Every frame on the light and the dark chat plate: one block per plate,
 * up to 8 frames a row, frame numbers drawn when ffmpeg has drawtext.
 * `numbers` labels each frame with its number in the take (a trimmed loop
 * shows 7, 8, … 15, the numbers keepFrames uses); by default 0, 1, ….
 * Pure layout over RGBA frames already at `cell` size; returns RGB24.
 */
export function contactLayout(frames, cellW, cellH = cellW, { gap = 8, numbers = null } = {}) {
  if (numbers && numbers.length !== frames.length) throw new Error(`contactLayout: ${frames.length} frames but ${numbers.length} numbers`);
  const cols = Math.min(8, frames.length);
  const rows = Math.ceil(frames.length / cols);
  const blockH = rows * cellH + (rows + 1) * gap;
  const width = cols * cellW + (cols + 1) * gap;
  const height = blockH * 2;
  const out = Buffer.alloc(width * height * 3);
  const labels = [];
  ["light", "dark"].forEach((plate, b) => {
    const [pr, pg, pb] = PLATES[plate];
    for (let y = b * blockH; y < (b + 1) * blockH; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 3;
        out[o] = pr; out[o + 1] = pg; out[o + 2] = pb;
      }
    }
    frames.forEach((f, i) => {
      const cx = gap + (i % cols) * (cellW + gap);
      const cy = b * blockH + gap + Math.floor(i / cols) * (cellH + gap);
      for (let y = 0; y < cellH; y += 1) {
        for (let x = 0; x < cellW; x += 1) {
          const s = (y * cellW + x) * 4;
          const a = f[s + 3] / 255;
          const o = ((cy + y) * width + cx + x) * 3;
          out[o] = Math.round(f[s] * a + pr * (1 - a));
          out[o + 1] = Math.round(f[s + 1] * a + pg * (1 - a));
          out[o + 2] = Math.round(f[s + 2] * a + pb * (1 - a));
        }
      }
      labels.push({ text: String(numbers ? numbers[i] : i), x: cx + 4, y: cy + 4, dark: plate === "light" });
    });
  });
  return { rgb: out, width, height, labels };
}

/**
 * Write the contact sheet PNG of a GIF at `out` — every frame, or with
 * `keepFrames` only the kept ones, each labelled with its number in the
 * take. Returns its layout facts (`labels`: the frame numbers shown).
 */
export function contactSheet(gifPath, out, { cell = 160, keepFrames = null } = {}) {
  const info = readGifInfo(readFileSync(gifPath));
  const scale = Math.min(1, cell / Math.max(info.width, info.height));
  const cw = Math.max(1, Math.round(info.width * scale));
  const ch = Math.max(1, Math.round(info.height * scale));
  const { frames: all } = readGifFrames(gifPath, { scaleTo: { width: cw, height: ch } });
  const numbers = keptIndices(all.length, keepFrames);
  const frames = numbers.map((i) => all[i]);
  const layout = contactLayout(frames, cw, ch, { numbers });
  const draw = hasDrawtext()
    ? layout.labels.map((l) => `drawtext=text='${l.text}':x=${l.x}:y=${l.y}:fontsize=14:fontcolor=${l.dark ? "0x222222" : "0xdddddd"}`).join(",")
    : null;
  mkdirSync(dirname(out), { recursive: true });
  const args = (vf) => ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${layout.width}x${layout.height}`, "-i", "pipe:0", ...(vf ? ["-vf", vf] : []), ...BITEXACT, "-frames:v", "1", "-update", "1", out];
  try {
    run("ffmpeg", args(draw), { step: "contact sheet", input: layout.rgb });
  } catch (error) {
    if (!draw) throw error;
    // drawtext without a usable default font: the sheet without numbers.
    run("ffmpeg", args(null), { step: "contact sheet", input: layout.rgb });
  }
  return { width: layout.width, height: layout.height, frames: frames.length, labels: numbers, cell: { width: cw, height: ch }, labelled: Boolean(draw) };
}

export function fileSize(path) {
  return statSync(path).size;
}
