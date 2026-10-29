/**
 * anime-series media steps — ffmpeg / ffprobe only, Node built-ins only.
 *
 * Ports of ai-anime-series `scripts/grid.py`, `review_clip.py` and
 * `compile.py` (MIT, (c) 2026 硅基废话 / 10291124jcjc-dotcom; the licence
 * text is in LICENSE-ai-anime-series.txt beside this file), moved from
 * Pillow to ffmpeg filters:
 *   - a redrawn panel is scaled to cover its cell and overlaid on the grid;
 *   - a take is sampled per shot (several frames inside each shot's span);
 *     the overview puts the design sheets once on top of the shot rows;
 *   - scene cuts are detected with `select='gt(scene,0.3)'`;
 *   - every segment is normalised to the first one's size, one frame rate,
 *     yuv420p and stereo AAC (silence added when a clip has no audio) before
 *     a concat-demuxer join; a patch replaces [a, b) of a take. The frame
 *     rate is the first clip's own, not upstream's fixed 30 fps: Seedance
 *     renders 24, and resampling every clip to a rate none of them has adds
 *     duplicated frames to the whole episode;
 *   - title cards are a black frame with centred text, 1.5 s, with silence.
 *
 * Every function throws an Error naming the step and the tail of ffmpeg's
 * stderr; the CLI turns that into one `ERROR:` line.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const tail = (text, lines = 12) => String(text ?? "").split("\n").filter(Boolean).slice(-lines).join("\n");

/** Run ffmpeg/ffprobe; throw with the step name and stderr tail on failure. */
export function run(tool, args, { step = tool, cwd, timeoutMs = 300_000 } = {}) {
  const result = spawnSync(tool, args, { encoding: "utf-8", cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    throw new Error(result.error.code === "ENOENT" ? `${tool} is not on PATH — install ffmpeg (macOS: brew install ffmpeg)` : `${step}: ${result.error.message}`);
  }
  if (result.status !== 0) throw new Error(`${step} failed (exit ${result.status}):\n${tail(result.stderr)}`);
  return result;
}

export function hasTool(tool) {
  const result = spawnSync(tool, ["-version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

let drawtextCache = null;
/** Whether this ffmpeg was built with drawtext (libfreetype). */
export function hasDrawtext() {
  if (drawtextCache === null) {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf-8" });
    drawtextCache = !result.error && result.status === 0 && /\sdrawtext\s/.test(result.stdout ?? "");
  }
  return drawtextCache;
}

/** Fonts with CJK coverage first (titles are often Chinese), then Latin fallbacks. */
export const FONT_CANDIDATES = Object.freeze([
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
  "C:/Windows/Fonts/msyhbd.ttc",
  "C:/Windows/Fonts/msyh.ttc",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
]);

export function findFont(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`--font: ${explicit} does not exist`);
    return explicit;
  }
  return FONT_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

/** Escape a value for an ffmpeg filter option (inside single quotes). */
function filterPath(path) {
  return `'${String(path).replaceAll("\\", "/").replaceAll("'", "'\\''").replaceAll(":", "\\:")}'`;
}

/** Width, height, duration, fps and whether there is audio — or throws. */
export function probe(path) {
  const result = run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", path], { step: `ffprobe ${path}` });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error(`ffprobe returned unreadable output for ${path}`);
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === "video") ?? {};
  const [num, den] = String(video.r_frame_rate ?? "").split("/").map(Number);
  const fps = num > 0 && den > 0 ? num / den : null;
  return {
    width: Number(video.width) || null,
    height: Number(video.height) || null,
    duration: Number(parsed.format?.duration) || null,
    fps,
    audio: streams.some((s) => s.codec_type === "audio"),
  };
}

function stage(out) {
  mkdirSync(dirname(out), { recursive: true });
  const ext = out.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "";
  return `${out}.partial${ext}`;
}

function commit(staged, out) {
  renameSync(staged, out);
  return out;
}

/**
 * Overlay `panel` onto cell `rect` of `board`, covering the cell (scaled to
 * fill, centre-cropped), and write `out`. The rest of the board is untouched.
 */
export function compositePanel({ board, panel, rect, out }) {
  const staged = stage(out);
  try {
    run("ffmpeg", [
      "-v", "error", "-y", "-i", board, "-i", panel,
      "-filter_complex",
      `[1:v]scale=${rect.w}:${rect.h}:force_original_aspect_ratio=increase,crop=${rect.w}:${rect.h},setsar=1[p];[0:v][p]overlay=${rect.x}:${rect.y}:format=auto`,
      "-frames:v", "1", "-update", "1", staged,
    ], { step: "panel composite" });
    return commit(staged, out);
  } finally {
    rmSync(staged, { force: true });
  }
}

/** One frame of `clip` at `t` seconds, scaled to `height`, as an image. */
export function sampleFrame(clip, t, out, height = 180) {
  run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, t)), "-i", clip, "-frames:v", "1", "-vf", `scale=-2:${height}`, "-update", "1", out], { step: `frame at ${t}s` });
  return out;
}

/**
 * One frame of `clip` at `t` seconds at its own size, as a high-quality
 * JPEG. With `crop` (`{ x, y, w, h }` in pixels) only that box is kept and
 * enlarged to `size` (`{ w, h }`); enlarging shows pixels bigger, it adds no
 * detail. Written atomically: `out` exists only once the frame is complete.
 */
export function grabFrame(clip, t, out, { crop = null, size = null } = {}) {
  const filters = crop ? [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, ...(size ? [`scale=${size.w}:${size.h}:flags=lanczos`] : [])] : [];
  const staged = stage(out);
  try {
    run("ffmpeg", [
      "-v", "error", "-y", "-ss", String(Math.max(0, t)), "-i", clip, "-frames:v", "1",
      ...(filters.length ? ["-vf", filters.join(",")] : []),
      "-q:v", "2", "-update", "1", staged,
    ], { step: `frame at ${t}s` });
    return commit(staged, out);
  } finally {
    rmSync(staged, { force: true });
  }
}

/**
 * Lay `images` out left to right, each fitted into a `tileW` × `tileH` box
 * (letterboxed on `pad` colour), with an optional label per tile. Equal
 * boxes keep every strip of a review the same width, so strips stack.
 */
export function tileRow({ images, labels = [], out, tileW, tileH, pad = "white", font = null }) {
  if (!images.length) throw new Error("tileRow needs at least one image");
  const wantLabels = font !== false && labels.some(Boolean) && hasDrawtext();
  if (!wantLabels) return tileRowOnce({ images, labels, out, tileW, tileH, pad, font, drawtext: false });
  try {
    return tileRowOnce({ images, labels, out, tileW, tileH, pad, font, drawtext: true });
  } catch (error) {
    // drawtext can still fail at run time (no fontconfig, an unreadable font):
    // the frames matter more than their captions, so draw them without.
    process.stderr.write(`WARN: labels left off ${out}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n`);
    return tileRowOnce({ images, labels, out, tileW, tileH, pad, font, drawtext: false });
  }
}

function tileRowOnce({ images, labels, out, tileW, tileH, pad, font, drawtext }) {
  const work = mkdtempSync(join(tmpdir(), "anime-series-row-"));
  const staged = stage(out);
  try {
    const chains = images.map((_, i) => {
      let chain = `[${i}:v]scale=${tileW}:${tileH}:force_original_aspect_ratio=decrease,pad=${tileW}:${tileH}:(ow-iw)/2:(oh-ih)/2:color=${pad},setsar=1`;
      if (drawtext && labels[i]) {
        writeFileSync(join(work, `label-${i}.txt`), labels[i]);
        const fontArg = font ? `fontfile=${filterPath(font)}:` : "";
        chain += `,drawtext=${fontArg}textfile=label-${i}.txt:x=6:y=6:fontsize=${Math.max(12, Math.round(tileH / 9))}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`;
      }
      return `${chain}[t${i}]`;
    });
    const stack = images.length === 1 ? `[t0]copy[out]` : `${images.map((_, i) => `[t${i}]`).join("")}hstack=inputs=${images.length}[out]`;
    run("ffmpeg", [
      "-v", "error", "-y",
      ...images.flatMap((image) => ["-i", image]),
      "-filter_complex", `${chains.join(";")};${stack}`,
      "-map", "[out]", "-frames:v", "1", "-update", "1", staged,
    ], { step: "contact strip", cwd: work });
    return { file: commit(staged, out), labelled: drawtext };
  } finally {
    rmSync(staged, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Stack images top to bottom, left-aligned; a narrower row is padded on the
 * right with `pad` to the widest one (vstack needs equal widths).
 */
export function stackRows(images, out, { pad = "white" } = {}) {
  const staged = stage(out);
  try {
    if (images.length === 1) {
      run("ffmpeg", ["-v", "error", "-y", "-i", images[0], "-frames:v", "1", "-update", "1", staged], { step: "contact sheet" });
    } else {
      const widths = images.map((image) => probe(image).width ?? 0);
      const width = Math.max(...widths);
      const chains = images.map((_, i) => (widths[i] === width ? `[${i}:v]setsar=1[r${i}]` : `[${i}:v]pad=${width}:ih:0:0:color=${pad},setsar=1[r${i}]`));
      run("ffmpeg", [
        "-v", "error", "-y", ...images.flatMap((image) => ["-i", image]),
        "-filter_complex", `${chains.join(";")};${images.map((_, i) => `[r${i}]`).join("")}vstack=inputs=${images.length}[out]`,
        "-map", "[out]", "-frames:v", "1", "-update", "1", staged,
      ], { step: "contact sheet" });
    }
    return commit(staged, out);
  } finally {
    rmSync(staged, { force: true });
  }
}

/** Scene-cut times in a clip (ffmpeg's scene score above `threshold`). */
export function sceneCuts(clip, threshold = 0.3) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", clip, "-vf", `select='gt(scene,${threshold})',metadata=print`, "-an", "-f", "null", "-"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`scene-cut detection failed:\n${tail(result.stderr)}`);
  return [...String(result.stderr).matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
}

/**
 * Re-encode [start, start + dur) of `src` at `width` × `height` and `fps`,
 * yuv420p, stereo AAC 44.1 kHz; silence is added when `src` has no audio.
 */
export function normalizeSegment(src, dst, { width, height, fps, start = null, dur = null }) {
  const info = probe(src);
  const args = ["-v", "error", "-y"];
  if (start !== null) args.push("-ss", String(start));
  if (dur !== null) args.push("-t", String(dur));
  args.push("-i", src);
  // Silence long enough for the segment; -shortest trims it to the video.
  if (!info.audio) args.push("-f", "lavfi", "-t", String(dur ?? info.duration ?? 60), "-i", "anullsrc=r=44100:cl=stereo");
  args.push(
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1,format=yuv420p`,
    "-map", "0:v:0", "-map", info.audio ? "0:a:0" : "1:a:0",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", dst,
  );
  run("ffmpeg", args, { step: `normalise ${src}` });
  return dst;
}

/** A 1.5 s black card with `text` centred, plus silence. */
export function titleCard(text, dst, { width, height, fps, font, seconds = 1.5 }) {
  if (!hasDrawtext()) throw new Error("this ffmpeg has no drawtext filter (built without libfreetype) — run compile-season without --titles");
  const work = mkdtempSync(join(tmpdir(), "anime-series-title-"));
  try {
    writeFileSync(join(work, "title.txt"), text);
    const fontArg = font ? `fontfile=${filterPath(font)}:` : "";
    run("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-t", String(seconds), "-i", `color=c=black:s=${width}x${height}:r=${fps}`,
      "-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=44100:cl=stereo",
      "-vf", `drawtext=${fontArg}textfile=title.txt:fontcolor=white:fontsize=${Math.round(height / 12)}:x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p`,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", dst,
    ], { step: "title card", cwd: work });
    return dst;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Join already-normalised segments with the concat demuxer (stream copy). */
export function concatSegments(segments, out) {
  const work = mkdtempSync(join(tmpdir(), "anime-series-concat-"));
  const staged = stage(out);
  try {
    const list = join(work, "list.txt");
    writeFileSync(list, segments.map((s) => `file '${s.replaceAll("\\", "/").replaceAll("'", "'\\''")}'\n`).join(""));
    run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", staged], { step: "concat" });
    return commit(staged, out);
  } finally {
    rmSync(staged, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Build one episode cut. `parts` is `[{ file, edits: [{ start, end, patch,
 * offset, length }] }]` in order; each part's edits replace [start, end) of
 * its take with [offset, offset + length) of the patch clip (length defaults
 * to end - start). Everything is normalised to the first take's size and
 * frame rate.
 */
export function assembleCut(parts, out, { fps: wantFps = null } = {}) {
  const first = probe(parts[0].file);
  if (!first.width || !first.height) throw new Error(`cannot read the size of ${parts[0].file}`);
  const width = first.width;
  const height = first.height;
  const fps = wantFps ?? Math.round(first.fps ?? 24);
  const work = mkdtempSync(join(tmpdir(), "anime-series-cut-"));
  try {
    const segments = [];
    let k = 0;
    const push = (src, start, dur) => {
      if (dur !== null && dur <= 0.0005) return;
      const dst = join(work, `${String(k++).padStart(3, "0")}.mp4`);
      normalizeSegment(src, dst, { width, height, fps, start, dur });
      segments.push(dst);
    };
    for (const part of parts) {
      const edits = [...(part.edits ?? [])].sort((a, b) => a.start - b.start);
      let cursor = 0;
      for (const edit of edits) {
        push(part.file, cursor, edit.start - cursor);
        push(edit.patch, edit.offset ?? 0, edit.length ?? edit.end - edit.start);
        cursor = edit.end;
      }
      push(part.file, cursor, null);
    }
    concatSegments(segments, out);
    return { file: out, width, height, fps };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Concatenate finished episodes, optionally each behind a title card. */
export function compileEpisodes(files, out, { titles = [], font = null } = {}) {
  const first = probe(files[0]);
  if (!first.width || !first.height) throw new Error(`cannot read the size of ${files[0]}`);
  const fps = Math.round(first.fps ?? 24);
  const work = mkdtempSync(join(tmpdir(), "anime-series-season-"));
  try {
    const segments = [];
    files.forEach((file, i) => {
      if (titles[i]) segments.push(titleCard(titles[i], join(work, `t${i}.mp4`), { width: first.width, height: first.height, fps, font }));
      segments.push(normalizeSegment(file, join(work, `e${i}.mp4`), { width: first.width, height: first.height, fps }));
    });
    concatSegments(segments, out);
    return { file: out, width: first.width, height: first.height, fps };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
