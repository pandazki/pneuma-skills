/**
 * A GIF's frames as ffprobe reads its packets: one packet per frame, each
 * carrying how long that frame is shown.
 *
 * The one rule both readers of a GIF apply — `sprite-project.mjs set-gif`
 * when it lands a take (the frame count it records and checks against
 * generate_gif.mjs's report) and `sprite-sheet.mjs from-gif` when it cuts
 * one — so they always count the same frames in the same file. Every packet
 * is a frame, whether or not its delay can be read: a delay ffprobe reports
 * as N/A, zero or garbage takes the median of the readable ones, and its
 * index is returned so the caller can say so. Landing used to drop such a
 * frame while cutting kept it, so a file that cut into 12 frames was landed
 * as 11 and refused.
 */

import { spawnSync } from "node:child_process";

import { medianOf } from "./sizes.mjs";

/**
 * ffprobe's `-show_entries packet=duration_time -of csv=p=0` output → one
 * delay per frame, in ms. Pure: the rule without the process.
 *
 * @param {string} stdout
 * @returns {{ delaysMs: number[], unreadable: number[], fallbackMs: number | null }}
 */
export function gifDelaysFromProbe(stdout) {
  const packets = String(stdout ?? "").split("\n").map((line) => line.trim().replace(/,$/, "")).filter(Boolean);
  const read = packets.map((value) => Math.round(Number(value) * 1000));
  const readable = (ms) => Number.isFinite(ms) && ms > 0;
  const known = read.filter(readable);
  if (packets.length && !known.length) throw new Error("it carries no frame delay ffprobe can read");
  const fallbackMs = known.length ? medianOf(known) : null;
  const unreadable = [];
  const delaysMs = read.map((ms, index) => {
    if (readable(ms)) return ms;
    unreadable.push(index);
    return fallbackMs;
  });
  return { delaysMs, unreadable, fallbackMs };
}

/**
 * Probe `path` and apply the rule. Throws when ffprobe cannot read it or
 * no delay in it is readable; the frame-count limits are the caller's.
 *
 * @param {string} path
 */
export function probeGifDelays(path) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=duration_time", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  if (r.error || r.status !== 0) {
    const detail = String(r.stderr ?? "").trim() || r.error?.message;
    throw new Error(`ffprobe could not read the frames of ${path}${detail ? `: ${detail}` : ""}`);
  }
  try {
    return gifDelaysFromProbe(r.stdout);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}
