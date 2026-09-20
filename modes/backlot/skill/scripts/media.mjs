/**
 * media.mjs — the arithmetic and the parsing that sit around ffmpeg.
 *
 * Everything here is a PURE function over plain data: no spawning, no file
 * system, no clock. `previz.mjs` runs the tools and hands the bytes and the
 * output text to this module, so the two things that are easy to get quietly
 * wrong — frame arithmetic and reading a probe — are pinned by tests that
 * need neither ffmpeg nor a video file.
 *
 * The frame contract, stated once and obeyed everywhere:
 *
 *   frames = round(seconds x fps)      a shot of 8 s at 24 fps is 192 frames
 *   frames are numbered 1 .. frames    never 0, never frames + 1
 *   frame f starts at (f - 1) / fps    so frame 1 is t = 0 and the last
 *                                      frame starts at (frames - 1) / fps
 *
 * Blender renders `f_0001.png .. f_0192.png` and ffmpeg is fed
 * `-framerate fps -i f_%04d.png`, which puts f_0001 at t = 0. The viewer's
 * `(1 + round(t x fps)) / fps` mapping is the same statement written for a
 * glTF clip, whose sampled keys sit at `frame / fps`.
 */

/** Frames in a shot of `seconds` at `fps`. The one definition. */
export function framesForSpec({ seconds, fps }) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`seconds must be a positive number (got: ${seconds})`);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`fps must be a positive number (got: ${fps})`);
  const frames = Math.round(seconds * fps);
  if (frames < 1) throw new Error(`${seconds} s at ${fps} fps rounds to ${frames} frames — a shot needs at least one`);
  return frames;
}

/** The 1-based frame a shot time lands on, clamped into the shot. */
export function frameAtTime(t, fps, frames) {
  const raw = 1 + Math.round(Number(t) * fps);
  return Math.min(frames, Math.max(1, raw));
}

/** When a 1-based frame starts, in seconds. */
export function timeOfFrame(frame, fps) {
  return (frame - 1) / fps;
}

/**
 * A duration rounded to a whole number of frames.
 *
 * `reference --adopt-spec` uses this: a 7.93 s segment at 24 fps becomes
 * 190 frames / 7.9167 s, because a spec whose seconds x fps is not an
 * integer cannot survive `render`'s frame-count refusal.
 */
export function snapSeconds(seconds, fps) {
  const frames = Math.max(1, Math.round(seconds * fps));
  return { frames, seconds: frames / fps };
}

/** yuv420p needs even dimensions. Crop, never pad: a greybox loses at most
 *  one row of grey, where a pad would move the framing the model is shown. */
export function evenSize(width, height) {
  return { width: Math.max(2, width - (width % 2)), height: Math.max(2, height - (height % 2)) };
}

/** What `--preview` renders at: half size, rounded down to even. */
export function previewSize(width, height) {
  return evenSize(Math.max(2, Math.floor(width / 2)), Math.max(2, Math.floor(height / 2)));
}

/** ffprobe writes frame rates as "24/1" and sometimes "0/0". */
export function parseRational(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value) return null;
  const [numerator, denominator = "1"] = value.split("/");
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

/**
 * The facts a shot.json stores about a video file, out of
 * `ffprobe -show_streams -show_format -count_frames` JSON.
 *
 * `frames` comes from `nb_read_frames` (ffprobe actually decoded and counted
 * them) and falls back to `nb_frames` only when the counting pass was not
 * asked for. `seconds` is derived from the frame count and the frame rate
 * rather than copied from the container's duration, because the container
 * rounds and the frame count is what `render` has to match.
 *
 * Returns null when the file carries no video stream — a caller turns that
 * into a refusal naming the file, never into a silent zero.
 */
export function parseProbe(probeJson, { bytes = null } = {}) {
  const streams = Array.isArray(probeJson?.streams) ? probeJson.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video");
  if (!video) return null;
  const fps = parseRational(video.avg_frame_rate) ?? parseRational(video.r_frame_rate);
  const counted = Number(video.nb_read_frames);
  const declared = Number(video.nb_frames);
  const frames = Number.isFinite(counted) && counted > 0
    ? counted
    : Number.isFinite(declared) && declared > 0
      ? declared
      : null;
  const containerSeconds = Number(probeJson?.format?.duration ?? video.duration);
  const seconds = frames !== null && fps
    ? round4(frames / fps)
    : Number.isFinite(containerSeconds)
      ? round4(containerSeconds)
      : null;
  const size = bytes ?? (Number.isFinite(Number(probeJson?.format?.size)) ? Number(probeJson.format.size) : null);
  return {
    codec: video.codec_name ?? null,
    pixFmt: video.pix_fmt ?? null,
    width: Number.isFinite(Number(video.width)) ? Number(video.width) : null,
    height: Number.isFinite(Number(video.height)) ? Number(video.height) : null,
    fps: fps === null ? null : round4(fps),
    frames,
    seconds,
    bytes: size,
  };
}

/**
 * Where `render` refuses.
 *
 * The encoded file is the conditioning truth (invariant 1), so what ffprobe
 * measured has to match the spec exactly — a clip one frame short is a shot
 * whose last beat never reached the model. Returns the list of disagreements;
 * empty means the render stands.
 */
export function probeMismatches(probe, expected) {
  const problems = [];
  if (!probe) return ["the encoded file carries no video stream"];
  if (expected.frames != null && probe.frames !== expected.frames) {
    problems.push(`frames: expected ${expected.frames}, ffprobe counted ${probe.frames ?? "none"}`);
  }
  if (expected.fps != null && probe.fps !== null && Math.abs(probe.fps - expected.fps) > 0.01) {
    problems.push(`fps: expected ${expected.fps}, ffprobe measured ${probe.fps}`);
  }
  if (expected.width != null && probe.width !== expected.width) {
    problems.push(`width: expected ${expected.width}, ffprobe measured ${probe.width ?? "none"}`);
  }
  if (expected.height != null && probe.height !== expected.height) {
    problems.push(`height: expected ${expected.height}, ffprobe measured ${probe.height ?? "none"}`);
  }
  return problems;
}

/**
 * Cut timestamps out of `select='gt(scene,T)',showinfo` on stderr.
 *
 * showinfo prints one `[Parsed_showinfo_...] n:0 pts:… pts_time:1.375 …` line
 * per frame that survived the select, so every pts_time is a frame the scene
 * score jumped at. The first frame of a clip always passes the select (there
 * is nothing before it to compare against), so a cut at t = 0 is dropped.
 */
export function parseSceneCuts(stderr, { minSeconds = 0.04 } = {}) {
  const cuts = [];
  for (const line of String(stderr ?? "").split("\n")) {
    if (!line.includes("showinfo")) continue;
    const match = /pts_time:([0-9]+(?:\.[0-9]+)?)/.exec(line);
    if (!match) continue;
    const t = Number(match[1]);
    if (!Number.isFinite(t) || t < minSeconds) continue;
    if (cuts.length && Math.abs(cuts[cuts.length - 1] - t) < 1e-6) continue;
    cuts.push(round4(t));
  }
  return cuts;
}

/** `--at 0.5,3.8,7` → [0.5, 3.8, 7]. Throws naming the flag. */
export function parseTimeList(value, label = "--at") {
  const parts = String(value)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (!parts.length) throw new Error(`${label} needs at least one timestamp in seconds`);
  return parts.map((part) => {
    const t = Number(part);
    if (!Number.isFinite(t) || t < 0) throw new Error(`${label}: "${part}" is not a timestamp in seconds`);
    return t;
  });
}

/** `--strip 0.5,3.8` → [0.5, 3.8], in order. Throws naming the flag. */
export function parseRange(value, label = "--range") {
  const parts = parseTimeList(value, label);
  if (parts.length !== 2) throw new Error(`${label} takes exactly two seconds, "from,to" (got ${parts.length})`);
  const [from, to] = parts;
  if (to < from) throw new Error(`${label}: ${from} is after ${to}`);
  return [from, to];
}

/** Evenly spaced shot times including the first and the last frame. */
export function evenlySpacedTimes({ frames, fps, count = 6 }) {
  const n = Math.max(1, Math.min(count, frames));
  if (n === 1) return [0];
  const times = [];
  for (let i = 0; i < n; i += 1) {
    const frame = 1 + Math.round((i * (frames - 1)) / (n - 1));
    times.push(round4(timeOfFrame(frame, fps)));
  }
  return times;
}

/**
 * Every consecutive frame between two shot times, as 1-based frame numbers.
 *
 * Jitter and foot slide only exist BETWEEN neighbours, so this is the sheet
 * the acceptance list is actually read from. Capped: a strip of 400 tiles is
 * a picture nobody can look at and a PNG nobody wants to open, so the range
 * is refused rather than silently thinned.
 */
export function stripFrames(from, to, fps, frames, { max = 48 } = {}) {
  const first = frameAtTime(from, fps, frames);
  const last = frameAtTime(to, fps, frames);
  const count = last - first + 1;
  if (count > max) {
    throw new Error(
      `--strip ${from},${to} is ${count} frames at ${fps} fps (limit ${max}) — ` +
        `ask for a shorter range, or a sheet with --at`,
    );
  }
  const list = [];
  for (let frame = first; frame <= last; frame += 1) list.push(frame);
  return list;
}

/**
 * The grid a sheet's tiles are laid out in.
 *
 * Wasted cells cost more than a slightly oblong grid: an empty cell is a
 * black rectangle in a picture somebody is about to judge a render by. So
 * the score is mostly "cells left over", with a lighter pull toward square,
 * and a tie goes to the wider layout because a sheet is looked at on a
 * landscape screen.
 */
export function gridFor(count, { maxCols = 6 } = {}) {
  const n = Math.max(1, count);
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= maxCols; cols += 1) {
    const rows = Math.ceil(n / cols);
    const score = (cols * rows - n) * 3 + Math.abs(cols - rows) * 1.5;
    if (score < best.score || (score === best.score && cols > best.cols)) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

/** Whether this ffmpeg build can draw the timestamp onto a tile. Some
 *  builds ship without libfreetype and therefore without drawtext. */
export function hasDrawtext(filterListing) {
  return /^\s*\S*\s+drawtext\s/m.test(String(filterListing ?? ""));
}

/** A PNG's pixel size from its IHDR, without decoding it. */
export function pngSize(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(magic)) return null;
  if (bytes.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** `mm:ss.mmm`, the label a tile carries. */
export function stamp(seconds) {
  const total = Math.max(0, Number(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
