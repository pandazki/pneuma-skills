#!/usr/bin/env node

/**
 * Shared TTS Generator CLI (clipcraft + bansho)
 *
 * Plain argv CLI over TWO fal.ai voices, chosen with `--model`:
 *
 *   gemini-3.1-flash-tts  (default) — inline expressive tags ([laughing],
 *       [sigh], [whispering], [short pause]), `--style` as whole-utterance
 *       direction, 30 named voices, and the only one of the two that can
 *       return WAV.
 *   seed-speech — ByteDance Seed-Speech v2. 41 voices whose names encode
 *       the languages they carry (`*_mixed_en_zh` blends Chinese and
 *       English inside one sentence, which is what a bilingual lecture
 *       actually needs), `--style` as `voice_instruction`, plus `--speed`.
 *       **It cannot return WAV** — mp3 or opus only.
 *
 * Usage:
 *   node generate-tts.mjs --text "..." --output assets/audio/out.mp3 \
 *     [--model seed-speech] [--voice …] [--style "warm conversational"] \
 *     [--language zh] [--speed 1] [--temperature 1] [--json]
 *
 * Voice picks:
 *   gemini-3.1-flash-tts — Kore (default, strong female), Puck (upbeat
 *       male), Charon (calm male), Zephyr (bright female), Aoede (warm
 *       female). Full list: https://fal.ai/models/fal-ai/gemini-3.1-flash-tts/api
 *   seed-speech — `vienna_mixed_en_zh` (default here), the other
 *       `*_mixed_en_zh` presets, `bonnie_zh` / `felix_zh` / `celeste_zh`
 *       for Chinese only, `stokie_en` / `dacey_en` / `tim_en` for English.
 *       Full list: https://fal.ai/models/fal-ai/bytedance/seed-speech/tts/v2/api
 *
 * `--language` is spelled differently by each vendor, and each one refuses
 * the other's spelling outright, so the value is validated HERE against the
 * chosen model rather than at the far end of a paid request:
 *   gemini-3.1-flash-tts — an English display name: "Chinese Mandarin
 *       (China)", "English (US)". A BCP-47 tag is rejected with HTTP 422.
 *   seed-speech — a short code: zh, en, ja, es-mx, id, pt-br, ko, it, de,
 *       fr. Leaving it unset is usually right: unset means automatic
 *       detection, which is what lets a bilingual voice mix zh and en.
 *
 * Output format is inferred from the --output extension:
 *   .mp3 → mp3, .ogg / .opus → ogg_opus (gemini) / opus (seed-speech),
 *   .wav → 24kHz 16-bit mono PCM, gemini ONLY. Asking seed-speech for a
 *   .wav path fails loudly before the request rather than writing mp3
 *   bytes into a file named .wav.
 *
 * --json prints `{"path": "...", "seconds": N}` on success instead of the
 * bare path. `seconds` is MEASURED from the written bytes, never guessed:
 * WAV by header arithmetic, MP3 by its frame header (a Xing/Info frame
 * count when the stream carries one, otherwise the CBR bitrate over the
 * audio bytes, with ID3 tags excluded from the arithmetic). Both are exact
 * to the frame; for anything unmeasurable (ogg/opus) the field is omitted
 * rather than estimated. Bansho's narration manifest
 * (`narration/manifest.json`) copies `seconds` verbatim — which is why
 * measuring MP3 is not a nicety here: it is what let the board's voice
 * move to a vendor that has no WAV at all.
 *
 * This CLI IS the synthesis seam for bansho's narration layer (and
 * clipcraft's voice tracks): the agent runs it, the manifest records the
 * `{ file, seconds }` it reports, and nothing else in the repo talks to a
 * TTS vendor. A typed mirror (`FalVoiceSynthesizer` implementing a
 * `VoiceSynthesizer` interface) once duplicated the request flow in
 * `modes/bansho/narration/` and was dropped as a drift hazard with no
 * production caller — the interface followed it out as dead surface. If a
 * repo-side synthesis path ever becomes real, define its interface
 * against this file's request shape rather than reviving a hand-synced
 * copy.
 *
 * Text features:
 *   - Inline audio tags: "[laughing] Oh wow!", "... [sigh] ...".
 *   - Inline pacing: "Say it cheerfully: have a nice day!".
 *   - --style is prepended as style_instructions for whole-utterance
 *     direction ("Read as a dramatic newscast", "Whisper mysteriously").
 *
 * Environment:
 *   FAL_KEY — required; fal.ai API key (never printed, even on failure).
 *   Read from the environment first, then from a `.env` file discovered
 *   like every sibling shared script: the skill root (parent of scripts/,
 *   where skill-installer writes the mode's .env from envMapping), then
 *   walking up from cwd.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * The two voices, and everything that differs between them in ONE table.
 * A vendor difference spelled out at each call site is how a CLI grows a
 * silent third behaviour; here `--model` picks a row and the rest of the
 * file reads fields off it.
 *
 * `body` returns the vendor's request shape. `formats` is what the vendor
 * can actually return — the gate that turns "seed-speech into a .wav path"
 * into a refusal instead of an mp3 wearing the wrong extension.
 */
export const MODELS = {
  "gemini-3.1-flash-tts": {
    url: "https://fal.run/fal-ai/gemini-3.1-flash-tts",
    defaultVoice: "Kore",
    formats: ["mp3", "wav", "ogg_opus"],
    // A display name — a BCP-47 tag is refused with HTTP 422 and writes no
    // audio. Open set (the vendor owns it), so the shape is checked, not a
    // copied enum: "Language (Region)".
    language: { kind: "display-name", check: /^[A-Z][A-Za-z]*(?: [A-Za-z]+)*\([A-Za-z ]+\)$|^[A-Z][A-Za-z ]+\([A-Za-z ]+\)$/ },
    supports: { temperature: true, speed: false },
    body: (o) => {
      const b = { prompt: o.text, voice: o.voice, output_format: o.format };
      if (o.style) b.style_instructions = o.style;
      if (o.language) b.language_code = o.language;
      if (o.temperature != null) b.temperature = o.temperature;
      return b;
    },
  },
  "seed-speech": {
    url: "https://fal.run/fal-ai/bytedance/seed-speech/tts/v2",
    // Bilingual by default: a board says 「阿姆达尔定律」 and "NVIDIA" in one
    // breath, and a single-language voice reads one of them as gibberish.
    defaultVoice: "vienna_mixed_en_zh",
    formats: ["mp3", "opus"],
    // A closed enum the vendor publishes — so it is checked exactly, and a
    // wrong code costs nothing instead of a round trip.
    language: {
      kind: "code",
      values: ["zh", "en", "ja", "es-mx", "id", "pt-br", "ko", "it", "de", "fr"],
    },
    supports: { temperature: false, speed: true },
    body: (o) => {
      const b = { text: o.text, voice: o.voice, output_format: o.format };
      if (o.style) b.voice_instruction = o.style;
      if (o.language) b.language = o.language;
      if (o.speed != null) b.speed = o.speed;
      return b;
    },
  },
};

export const DEFAULT_MODEL = "gemini-3.1-flash-tts";

// ---------------------------------------------------------------------------
// .env loading (same discovery as generate_image.mjs / edit_image.mjs /
// storyboard.mjs — the shared-script contract skill-installer documents)
// ---------------------------------------------------------------------------

function findEnvFile() {
  // 1. Check skill root directory (parent of scripts/)
  const skillRoot = dirname(__dirname);
  const skillEnv = join(skillRoot, ".env");
  if (existsSync(skillEnv)) return skillEnv;

  // 2. Fallback: search from cwd upward
  let dir = process.cwd();
  while (true) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) return envPath;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const envPath = findEnvFile();
  if (!envPath) return null;
  const content = readFileSync(envPath, "utf-8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    if (line.slice(0, eqIdx).trim() !== "FAL_KEY") continue;
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return null;
}

export function formatFromPath(p) {
  const ext = extname(p).toLowerCase();
  if (ext === ".wav") return "wav";
  if (ext === ".ogg" || ext === ".opus") return "ogg_opus";
  return "mp3";
}

/**
 * The format this model will actually return for that output path — or a
 * thrown refusal naming the mismatch.
 *
 * The refusal is the point. Seed-Speech has no WAV, and the silent version
 * of this ("just send mp3 anyway") writes MPEG bytes into a file called
 * `.wav`, where the WAV reader returns null, the `--json` line quietly
 * drops `seconds`, and bansho's manifest records a clip it cannot pace.
 * Every step of that chain looks like it worked.
 */
export function resolveFormat(model, outputPath) {
  const wanted = formatFromPath(outputPath);
  if (model.formats.includes(wanted)) return wanted;
  // ogg_opus and opus are the same ask, spelled differently per vendor.
  if (wanted === "ogg_opus" && model.formats.includes("opus")) return "opus";
  throw new Error(
    `this voice cannot return ${wanted} (it returns ${model.formats.join(" or ")}) — ` +
      `ask for an output path with a matching extension, or pick a --model that can`,
  );
}

/**
 * Exact audio length of a RIFF/WAVE byte buffer: data-chunk bytes over the
 * fmt chunk's byte rate. Returns null (never throws) when the bytes are
 * not a readable WAV — the --json contract omits `seconds` instead of
 * printing a guess.
 */
export function wavDurationSeconds(bytes) {
  try {
    if (bytes.length < 44) return null;
    const ascii = (off, len) =>
      String.fromCharCode(...bytes.subarray(off, off + len));
    if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let byteRate = null;
    let dataSize = null;
    while (offset + 8 <= bytes.length) {
      const id = ascii(offset, 4);
      const size = view.getUint32(offset + 4, true);
      if (id === "fmt " && offset + 16 + 4 <= bytes.length) {
        byteRate = view.getUint32(offset + 16, true);
      } else if (id === "data") {
        dataSize = size;
      }
      offset += 8 + size + (size % 2); // chunks are word-aligned
    }
    if (!byteRate || dataSize === null) return null;
    return dataSize / byteRate;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// MP3 length, measured — the frame header is the only honest source
// ---------------------------------------------------------------------------

/** Layer III only: every TTS vendor here returns Layer III, and guessing
 *  past what we can actually decode is what `null` exists to prevent. */
const MP3_BITRATES = {
  // MPEG Version 1, Layer III
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  // MPEG Version 2 / 2.5, Layer III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const MP3_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

/** The first MPEG audio frame header at or after `from`, decoded. */
function readMp3Frame(bytes, from, limit) {
  for (let i = from; i + 4 <= Math.min(bytes.length, from + limit); i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (bytes[i + 1] >> 3) & 0x03;
    const layerBits = (bytes[i + 1] >> 1) & 0x03;
    if (verBits === 1 || layerBits !== 0x01) continue; // reserved version / not Layer III
    const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 2.5;
    const bitrateIdx = (bytes[i + 2] >> 4) & 0x0f;
    const rateIdx = (bytes[i + 2] >> 2) & 0x03;
    if (bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) continue; // free/bad
    const bitrate = MP3_BITRATES[version === 1 ? 1 : 2][bitrateIdx] * 1000;
    const sampleRate = MP3_RATES[version][rateIdx];
    if (!bitrate || !sampleRate) continue;
    return {
      at: i,
      version,
      bitrate,
      sampleRate,
      mono: ((bytes[i + 3] >> 6) & 0x03) === 0x03,
      // MPEG-1 Layer III carries 1152 samples per frame; MPEG-2 and 2.5
      // carry 576. A 24 kHz clip is MPEG-2, and using 1152 there reports
      // exactly double the real length — the kind of wrong that still
      // looks plausible in a manifest.
      samplesPerFrame: version === 1 ? 1152 : 576,
    };
  }
  return null;
}

/**
 * Exact audio length of an MP3 byte buffer, or null when the bytes cannot
 * be decoded (never throws, never estimates).
 *
 * ID3v2 at the head and ID3v1 at the tail are excluded from the arithmetic
 * — they are bytes that are not audio, and counting them inflates a CBR
 * measurement. A Xing/Info frame (what a VBR encoder writes) carries the
 * real frame count and is preferred whenever present.
 */
export function mp3DurationSeconds(bytes) {
  try {
    if (!bytes || bytes.length < 16) return null;
    const ascii = (off, len) => String.fromCharCode(...bytes.subarray(off, off + len));

    let start = 0;
    if (ascii(0, 3) === "ID3") {
      const size =
        ((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f);
      start = 10 + size + (bytes[5] & 0x10 ? 10 : 0); // + footer, when flagged
    }
    let end = bytes.length;
    if (end >= 128 && ascii(end - 128, 3) === "TAG") end -= 128;
    if (start >= end) return null;

    const frame = readMp3Frame(bytes, start, end - start);
    if (!frame) return null;

    // Xing / Info sits after the frame header and the side info block.
    const sideInfo =
      frame.version === 1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
    const tagAt = frame.at + 4 + sideInfo;
    if (tagAt + 12 <= end) {
      const tag = ascii(tagAt, 4);
      if (tag === "Xing" || tag === "Info") {
        const flags = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          .getUint32(tagAt + 4, false);
        if (flags & 0x01) {
          const frames = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            .getUint32(tagAt + 8, false);
          if (frames > 0) return (frames * frame.samplesPerFrame) / frame.sampleRate;
        }
      }
    }
    // Constant bitrate: the audio bytes over the bitrate. Exact for CBR,
    // which is what both of these vendors return.
    return ((end - frame.at) * 8) / frame.bitrate;
  } catch {
    return null;
  }
}

/** The length of whatever was written, by whichever reader can read it. */
export function audioDurationSeconds(bytes) {
  return wavDurationSeconds(bytes) ?? mp3DurationSeconds(bytes);
}

/** The --json stdout line: path always, `seconds` only when measured. */
export function buildResultJson(path, seconds) {
  return JSON.stringify(
    seconds !== null && Number.isFinite(seconds) ? { path, seconds } : { path },
  );
}

async function falTts(model, body, apiKey, fetchImpl) {
  const res = await fetchImpl(model.url, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${model.url} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function downloadAudio(url, outputPath, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Failed to download audio (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return bytes;
}

/**
 * The network half of the CLI, one exported seam with an injectable fetch
 * (tests pin every failure branch without touching fal.ai): call fal,
 * insist on an audio URL, download it to `outputPath`, return the written
 * bytes. Throws — never exits — so main()'s top-level catch owns die().
 */
export async function synthesizeToFile(
  model,
  body,
  apiKey,
  outputPath,
  fetchImpl = fetch,
) {
  const result = await falTts(model, body, apiKey, fetchImpl);
  const audioUrl = result.audio?.url;
  if (!audioUrl) throw new Error("fal.ai returned no audio URL");
  return downloadAudio(audioUrl, outputPath, fetchImpl);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function isMain() {
  // Bun: import.meta.main is true when the file is the entrypoint.
  if (typeof import.meta.main === "boolean") return import.meta.main;
  // Node: compare the resolved entry script with this module's path.
  const entry = process.argv[1] ? resolve(process.argv[1]) : null;
  return entry !== null && import.meta.url === `file://${entry}`;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      model: { type: "string" },
      text: { type: "string" },
      output: { type: "string" },
      voice: { type: "string" },
      style: { type: "string" },
      language: { type: "string" },
      temperature: { type: "string" },
      speed: { type: "string" },
      json: { type: "boolean" },
    },
    allowPositionals: false,
  });

  const modelName = values.model || DEFAULT_MODEL;
  const model = MODELS[modelName];
  if (!model) {
    die(`unknown --model "${modelName}" (choices: ${Object.keys(MODELS).join(", ")})`);
  }

  const apiKey = loadFalKey();
  if (!apiKey) die("FAL_KEY is not set");

  const text = values.text;
  const output = values.output;
  if (!text) die("--text is required");
  if (!output) die("--output is required");

  let format;
  try {
    format = resolveFormat(model, output);
  } catch (err) {
    die(`${modelName}: ${err.message}`);
  }

  // Each vendor refuses the other's spelling of a language, so the value is
  // checked here — a paid request that comes back 422 teaches nothing.
  if (values.language) {
    const spec = model.language;
    const ok =
      spec.kind === "code"
        ? spec.values.includes(values.language)
        : spec.check.test(values.language);
    if (!ok) {
      die(
        spec.kind === "code"
          ? `${modelName}: invalid --language "${values.language}" (choices: ${spec.values.join(", ")})`
          : `${modelName}: --language takes an English display name like "Chinese Mandarin (China)", not "${values.language}"`,
      );
    }
  }

  let temperature = null;
  if (values.temperature != null) {
    if (!model.supports.temperature) die(`${modelName} has no --temperature`);
    const n = Number(values.temperature);
    if (isNaN(n) || n < 0 || n > 2) {
      die(`invalid --temperature "${values.temperature}" (must be 0-2)`);
    }
    temperature = n;
  }

  let speed = null;
  if (values.speed != null) {
    if (!model.supports.speed) die(`${modelName} has no --speed`);
    const n = Number(values.speed);
    if (isNaN(n) || n < 0.5 || n > 2) {
      die(`invalid --speed "${values.speed}" (must be 0.5-2)`);
    }
    speed = n;
  }

  const body = model.body({
    text,
    voice: values.voice || model.defaultVoice,
    format,
    style: values.style,
    language: values.language,
    temperature,
    speed,
  });

  const bytes = await synthesizeToFile(model, body, apiKey, output);
  if (values.json) {
    console.log(buildResultJson(output, audioDurationSeconds(bytes)));
  } else {
    console.log(output);
  }
}

if (isMain()) {
  try {
    await main();
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
}
