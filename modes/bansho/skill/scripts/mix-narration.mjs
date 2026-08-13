#!/usr/bin/env node
/**
 * mix-narration.mjs — fuse a lecture's narration clips into ONE continuous
 * track, so the board plays a single audio element from beginning to end.
 *
 * WHY. Per-clip playback reused one <audio> element and swapped `src` at
 * every clip change, so `play()` was measured at `readyState 0` on 4 of 4
 * starts: nothing was buffered and the browser ate the opening syllable.
 * One file, one src, set once, removes the seam instead of managing it.
 *
 * THE TWO RULES THIS SCRIPT EXISTS TO KEEP
 *
 * 1. **Never concatenate encoded MP3s.** Every clip carries an encoder
 *    delay of roughly 26 ms (measured on this project: 5.256 s declared
 *    against 5.23 s decoded). Concatenating encoded segments ACCUMULATES
 *    it — about half a second adrift by the twenty-first clip, with every
 *    single step looking like it worked. So: decode everything to PCM,
 *    place by SAMPLE INDEX (never by floating-point seconds), and encode
 *    exactly once.
 * 2. **Verify the output, do not assume it.** The one encode still puts
 *    its own delay at the head of the track. This script measures that
 *    delay on the real file it just produced, corrects for it by trimming
 *    the same number of samples from the leading silence, and re-measures.
 *    A residual it cannot get under `RESIDUAL_TOLERANCE_MS` is a FAILURE,
 *    not a footnote — a track that is silently late is exactly the class
 *    of bug the whole design is trying to avoid.
 *
 * WHERE THE SCHEDULE COMES FROM. Not from here. This script is
 * schedule-blind on purpose: the board's timeline is a function of
 * MEASURED text and measured wall geometry, which only the live viewer
 * has. The `narrate` action hands over a plan naming every clip's sample
 * offset, and the viewer re-verifies that plan against the live board
 * before it plays a single sample of the result. This script's whole job
 * is to make the audio true to the plan it was given.
 *
 * USAGE
 *   node {SKILL_PATH}/scripts/mix-narration.mjs --plan <plan.json> [--json]
 *
 * The plan is what `narrate` returns under `data.track.plan`; save it to a
 * file verbatim and pass the path. Paths inside it are workspace-relative
 * (the same convention as the synthesis command's `output`), so run this
 * from the session directory.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

/**
 * How far the finished file's first word may sit from where the plan puts
 * it, after correction. Two milliseconds is roughly a tenth of one MP3
 * granule — far below anything an ear can pair with a moving pen, and far
 * above the rounding of a sample index.
 */
const RESIDUAL_TOLERANCE_MS = 2;

/**
 * How much the head delay measured at the START of the track may differ
 * from the one measured at its END before the delay is declared
 * non-uniform. A uniform delay is a constant that can be trimmed away; a
 * drifting one means something accumulated, and trimming would only hide
 * it.
 */
const UNIFORM_TOLERANCE_MS = 2;

function die(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

// ── ffmpeg seams ────────────────────────────────────────────────────────────

/**
 * Decode any audio file to mono signed 16-bit PCM at `sampleRate`.
 * Decoding is what discards each clip's own encoder delay — ffmpeg honours
 * the LAME/Xing gapless header — which is precisely why placement happens
 * in PCM and never on encoded bytes.
 */
function decodePcm(path, sampleRate) {
  const run = spawnSync(
    FFMPEG,
    [
      "-v", "error",
      "-i", path,
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-ac", "1",
      "-ar", String(sampleRate),
      "-",
    ],
    { maxBuffer: 1 << 30 },
  );
  if (run.error && run.error.code === "ENOENT") {
    die(
      `ffmpeg not found (tried "${FFMPEG}"). Install it, or set FFMPEG_PATH to its location.`,
    );
  }
  if (run.status !== 0) {
    die(`ffmpeg could not decode ${path}: ${String(run.stderr).trim()}`);
  }
  // `new Uint8Array(buffer)` copies into a fresh, 2-byte-aligned backing
  // store — a Buffer's own byteOffset carries no such promise.
  return new Int16Array(new Uint8Array(run.stdout).buffer);
}

/** Encode a PCM buffer to MP3. Called at most twice: once, then once corrected. */
function encodeMp3(pcm, sampleRate, output) {
  mkdirSync(dirname(output), { recursive: true });
  const run = spawnSync(
    FFMPEG,
    [
      "-v", "error",
      "-y",
      "-f", "s16le",
      "-ar", String(sampleRate),
      "-ac", "1",
      "-i", "-",
      "-codec:a", "libmp3lame",
      "-q:a", "4",
      output,
    ],
    { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), maxBuffer: 1 << 30 },
  );
  if (run.status !== 0) {
    die(`ffmpeg could not encode ${output}: ${String(run.stderr).trim()}`);
  }
}

// ── Measurement ─────────────────────────────────────────────────────────────

/**
 * First sample at or after `from` whose amplitude crosses a fraction of
 * the local peak. Both the intended buffer and the decoded file go through
 * this SAME detector, so a clip's own leading breath cancels out of the
 * difference and what remains is the codec's delay.
 */
function onset(pcm, from, to) {
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(pcm.length, Math.ceil(to));
  let peak = 0;
  for (let i = lo; i < hi; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
  }
  if (peak < 256) return -1; // nothing but silence here to time
  const threshold = Math.max(256, peak * 0.05);
  for (let i = lo; i < hi; i++) {
    if (Math.abs(pcm[i]) >= threshold) return i;
  }
  return -1;
}

/**
 * Samples the encoded round trip inserted before the audio. Measured at
 * the first clip AND at the last: a constant offset is a codec delay and
 * can be trimmed, while a growing one is accumulation and must not be.
 */
function measureDelay(intended, decoded, clips, sampleRate) {
  const window = sampleRate; // ±1 s is far wider than any codec delay
  const probes = [];
  for (const clip of [clips[0], clips[clips.length - 1]]) {
    const from = Math.max(0, clip.offset - window);
    const to = clip.offset + Math.min(clip.samples, window);
    const want = onset(intended, from, to);
    const got = onset(decoded, from, to + window);
    if (want === -1 || got === -1) return { ok: false, reason: "could not find the clip's onset in the mixed audio" };
    probes.push({ hash: clip.hash, delay: got - want });
  }
  const spread = Math.abs(probes[0].delay - probes[1].delay);
  const uniform = spread <= (UNIFORM_TOLERANCE_MS / 1000) * sampleRate;
  return { ok: true, uniform, spread, delay: probes[0].delay, probes };
}

// ── The mix ─────────────────────────────────────────────────────────────────

const planPath = arg("--plan");
if (!planPath) {
  die("usage: mix-narration.mjs --plan <plan.json> [--json]  (the plan is narrate's data.track.plan)");
}
let plan;
try {
  plan = JSON.parse(readFileSync(resolve(planPath), "utf8"));
} catch (e) {
  die(`could not read the plan at ${planPath}: ${e.message}`);
}
const { sampleRate, samples, clips, track, manifest, file } = plan;
if (!Number.isInteger(sampleRate) || sampleRate <= 0) die("plan needs a positive integer sampleRate");
if (!Number.isInteger(samples) || samples <= 0) die("plan needs a positive integer samples (the track's total length)");
if (!Array.isArray(clips) || clips.length === 0) die("plan has no clips to mix — the board has no recorded voice yet");
if (typeof track !== "string" || typeof manifest !== "string" || typeof file !== "string") {
  die('plan needs "track" and "manifest" output paths and the set-relative "file"');
}

for (const clip of clips) {
  if (!existsSync(resolve(clip.source))) {
    die(`clip ${clip.hash} is missing on disk at ${clip.source} — synthesize it before mixing`);
  }
}

// One buffer for the whole lecture, silence by default. Every clip is
// placed at its own sample index: nothing is appended to anything, so no
// error can accumulate down the sequence.
const bed = new Int16Array(samples);
const notes = [];
let placed = 0;
for (const clip of clips) {
  const pcm = decodePcm(resolve(clip.source), sampleRate);
  // A clip's DECODED length is the truth; the plan's `samples` came from
  // the manifest's declared seconds and the two differ by the encoder
  // delay the decode just removed. The plan decides WHERE, the file
  // decides HOW LONG.
  if (Math.abs(pcm.length - clip.samples) > 0.05 * sampleRate) {
    notes.push(
      `clip ${clip.hash} decodes to ${(pcm.length / sampleRate).toFixed(3)}s but the manifest declares ${(clip.samples / sampleRate).toFixed(3)}s — re-record its "seconds" from the synthesis output`,
    );
  }
  const end = Math.min(samples, clip.offset + pcm.length);
  for (let i = clip.offset, j = 0; i < end; i++, j++) {
    const sum = bed[i] + pcm[j];
    // Defensive only: the wall-time layout provably cannot overlap two
    // clips. If it ever does, both are heard and the fact is reported —
    // never one silently overwriting the other.
    if (bed[i] !== 0 && j === 0) {
      notes.push(`clip ${clip.hash} starts on top of audio that is already there`);
    }
    bed[i] = sum > 32767 ? 32767 : sum < -32768 ? -32768 : sum;
  }
  if (clip.offset + pcm.length > samples) {
    notes.push(`clip ${clip.hash} runs past the end of the track and was cut`);
  }
  placed++;
}

const trackPath = resolve(track);
encodeMp3(bed, sampleRate, trackPath);

// ── The self-check: decode what we just wrote ───────────────────────────────
let decoded = decodePcm(trackPath, sampleRate);
let measured = measureDelay(bed, decoded, clips, sampleRate);
if (!measured.ok) die(`the mixed track could not be verified: ${measured.reason}`);

let correction = 0;
if (Math.abs(measured.delay) > (RESIDUAL_TOLERANCE_MS / 1000) * sampleRate) {
  if (!measured.uniform) {
    die(
      `the encode's delay is not uniform (${(measured.probes[0].delay / sampleRate * 1000).toFixed(1)}ms at the first clip, ${(measured.probes[1].delay / sampleRate * 1000).toFixed(1)}ms at the last) — something accumulated, and trimming would only hide it`,
    );
  }
  correction = measured.delay;
  if (correction > 0 && correction >= clips[0].offset) {
    die(
      `the encode delays the audio by ${(correction / sampleRate * 1000).toFixed(1)}ms but the first clip starts at ${(clips[0].offset / sampleRate * 1000).toFixed(1)}ms — there is not enough leading silence to trim it away`,
    );
  }
  // Shift the whole bed against the delay and encode ONCE more. The
  // sacrificed samples are leading silence; every clip then lands where
  // the plan — and therefore the viewer — says it does.
  const shifted = new Int16Array(samples);
  if (correction > 0) shifted.set(bed.subarray(correction), 0);
  else shifted.set(bed.subarray(0, samples + correction), -correction);
  encodeMp3(shifted, sampleRate, trackPath);
  decoded = decodePcm(trackPath, sampleRate);
  const after = measureDelay(shifted, decoded, clips, sampleRate);
  if (!after.ok) die(`the corrected track could not be verified: ${after.reason}`);
  const residual = after.delay - correction;
  if (Math.abs(residual) > (RESIDUAL_TOLERANCE_MS / 1000) * sampleRate) {
    die(
      `the track is still ${(residual / sampleRate * 1000).toFixed(1)}ms off after correction — refusing to ship audio that is silently late`,
    );
  }
  measured = { ...after, delay: residual };
}

// The layout sidecar. It is the IDEAL layout, unchanged by the correction
// above — the file was moved to match the plan, never the plan to match
// the file — so the viewer can verify it against the live board directly.
const sidecar = {
  file,
  sampleRate,
  samples,
  clips: clips.map((c) => ({
    hash: c.hash,
    offset: c.offset,
    samples: c.samples,
    start: c.start,
    holdAt: c.holdAt ?? null,
  })),
};
const manifestPath = resolve(manifest);
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(sidecar, null, 1)}\n`);

const report = {
  track,
  manifest,
  clips: placed,
  seconds: Number((samples / sampleRate).toFixed(3)),
  decodedSeconds: Number((decoded.length / sampleRate).toFixed(3)),
  headDelayMs: Number(((measured.delay / sampleRate) * 1000).toFixed(2)),
  correctedMs: Number(((correction / sampleRate) * 1000).toFixed(2)),
  notes,
};
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  process.stdout.write(
    `Mixed ${placed} clip(s) into ${track} (${report.seconds}s intended, ${report.decodedSeconds}s decoded).\n` +
      `Head delay after correction: ${report.headDelayMs}ms (corrected ${report.correctedMs}ms).\n` +
      `Layout written to ${manifest}.\n` +
      notes.map((n) => `  note: ${n}\n`).join(""),
  );
}
