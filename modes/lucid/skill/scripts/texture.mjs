#!/usr/bin/env node
/**
 * texture.mjs — derive the maps an image model will not give you.
 *
 * The skill tells the agent that textures come from the image tool and never
 * from a noise function. That is right about albedo and wrong about the rest:
 * an image model returns a picture, so it returns albedo, and a PBR material
 * that has only albedo renders exactly as flat as the judge keeps saying it
 * is. The missing maps are not creative work — a normal map is a derivative,
 * a roughness map is a documented remap of luminance and local contrast, and
 * an ORM pack is three channels moved into one file. All of that is
 * arithmetic over pixels that already exist, so it belongs in a program.
 *
 * The other half of this file is the seam check. "Tileable" is the easiest
 * thing for an image model to claim and one of the harder things for it to
 * deliver; `tile-check` measures the claim against the image's own interior
 * gradient, and `make-tileable` applies the classic offset-and-cross-fade fix
 * when the claim is false.
 *
 * Zero npm dependencies and no external binary: no ffmpeg, no ImageMagick, no
 * canvas. The PNG codec is here, on top of `node:zlib`, because "decode a
 * non-interlaced PNG and write one back" is a few hundred lines and installing
 * a binary the agent's machine may not have is a worse trade than that.
 *
 * Every subcommand accepts `--json` (exactly one JSON object on stdout) and
 * `--help`. Without `--json`, stdout is a compact human report. Failures print
 * one `ERROR:` line on stderr and exit 1. Paths are resolved against the
 * current working directory; this script never changes directory.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { joinNegativeNumbers } from "./argv.mjs";
import { deflateSync, inflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Constants — every number the maps depend on, named once
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Rec. 709 luminance. The albedo's only relief signal: bright reads as high. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Sobel's positive weights sum to 4 across a 2-pixel span, so dividing the
 *  operator by 8 turns it into slope per pixel in height units. */
const SOBEL_DIVISOR = 8;

/** Largest `--blur` radius accepted. The blur is O(pixels x radius) per axis;
 *  past this the answer is a different texture, not a cleaner derivative. */
const MAX_BLUR_RADIUS = 16;

/** Roughness mix: how much of the answer comes from darkness and how much
 *  from local busyness. They sum to 1 so the result lands in 0..1. */
const ROUGHNESS_DARK_WEIGHT = 0.65;
const ROUGHNESS_DETAIL_WEIGHT = 0.35;

/** The 3x3 luminance standard deviation that already counts as fully detailed.
 *  0.25 of full range is a strong local edge; anything busier is not busier in
 *  a way a roughness map can express. */
const ROUGHNESS_DETAIL_FULL = 0.25;

const ROUGHNESS_MIN_DEFAULT = 0.35;
const ROUGHNESS_MAX_DEFAULT = 0.95;

/** A seam no worse than twice an ordinary neighbouring step reads as
 *  continuous when the texture is tiled. A perfectly periodic image scores
 *  about 1 (its seam IS an ordinary step), so the threshold has to sit above
 *  1; a ramp scores about its own width, so it has plenty of room. */
const TILEABLE_MAX_SCORE = 2;

/** Denominator floor, in 8-bit code values. Without it a flat image divides
 *  zero by zero; a quarter of a code value is below anything measurable. */
const SEAM_GRADIENT_FLOOR = 0.25;

const MAKE_TILEABLE_BLEND_DEFAULT = 0.12;

/** Below this mean deviation from 128 the derived normal map is flat enough
 *  to do nothing at all — which is worth saying out loud, because a flat
 *  normal map still looks like a normal map in the file listing. */
const RELIEF_FLOOR = 1;

const COLOR_TYPES = {
  0: { name: "greyscale", channels: 1, alpha: false },
  2: { name: "rgb", channels: 3, alpha: false },
  3: { name: "palette", channels: 1, alpha: false },
  4: { name: "greyscale-alpha", channels: 2, alpha: true },
  6: { name: "rgba", channels: 4, alpha: true },
};

const SUBCOMMANDS = ["info", "normal", "roughness", "tile-check", "make-tileable", "resize", "pack-orm"];

const USAGE = `Usage: texture.mjs <subcommand> [options]

Derive the maps an image model does not produce. An image tool returns a
picture, so it returns albedo; a PBR material also needs a normal map, a
roughness map and an ORM pack, and it needs the albedo to actually tile.
Everything here is deterministic arithmetic over pixels that already exist --
no noise functions, no network, no external binary (no ffmpeg, no
ImageMagick). Node built-ins only; the PNG codec is part of this file.

Every subcommand accepts --json (exactly one JSON object on stdout) and
--help. Without --json, stdout is a compact human report. Failures print one
ERROR: line on stderr and exit 1. Paths are resolved against the current
working directory; this script never changes directory.

PNG support: 8-bit greyscale / greyscale+alpha / RGB / RGBA, and 16-bit of
the same down-converted to 8 (the high byte), non-interlaced, all five row
filters. Palette and interlaced files are refused by name -- re-save them as
truecolour. Output is always 8-bit with filter 0, RGB unless the map carries
alpha.

  info <png> [--json]
      width, height, bitDepth, colorType, whether alpha is present, bytes on
      disk, and the whole tile-check estimate (seamScore / tileable /
      worstEdge / structured, plus the per-axis numbers) in the same call.

  normal <albedo.png> <out.png> [--strength 2] [--blur 1] [--invert-y] [--json]
      Tangent-space normal map from the albedo's luminance (Rec. 709), which
      is the only relief signal an albedo carries: bright reads as high. The
      height field is box-blurred by --blur pixels (0 disables) so that
      compression speckle does not become relief, then differentiated with a
      3x3 Sobel scaled by 1/${SOBEL_DIVISOR}, which makes the gradient a per-pixel slope in
      height units. The normal is
      normalize(-dH/dx * strength, +dH/drow * strength, 1), encoded as
      (n * 0.5 + 0.5) * 255 into 8-bit RGB, same size as the input.

      Neighbours are sampled with WRAP, not clamp, so a seamless albedo gives
      a seamless normal map. Run tile-check first if you are not sure.

      The signs, so the output can be read: a flat image is exactly
      (128, 128, 255). An albedo that brightens to the right is a slope
      rising to the right, so the normal tilts left and R falls below 128.
      An albedo that brightens downward puts G above 128 -- the OpenGL and
      glTF +Y-up convention. --invert-y flips G to the DirectX -Y convention.

      --strength scales the slope before normalizing, so it is not a
      brightness knob: 1 is the literal derivative, 2 (the default) is the
      usual starting point at 1024px, and past about 8 the surface reads as
      crumpled foil. The report carries 'relief', the mean distance of R and
      G from 128; under ${RELIEF_FLOOR} the albedo has no usable relief and this map will
      change nothing on screen.

      A NEGATIVE --strength inverts the relief, and you will need it more
      often than it sounds. "Bright is high" is only a guess about the
      surface, and it is the wrong guess whenever the recessed part is the
      light one: pale mortar between dark bricks, white grout around tile,
      a light plaster channel in dark stucco. Derived straight, such a wall
      comes out with its grooves standing proud of the bricks. Look at the
      map before you ship it; if the grooves read as ridges, re-run with
      --strength -2 (or --strength=-2; both parse).

  roughness <albedo.png> <out.png> [--min ${ROUGHNESS_MIN_DEFAULT}] [--max ${ROUGHNESS_MAX_DEFAULT}] [--invert] [--json]
      Roughness from the albedo by the two cues an albedo actually carries: a
      darker pixel and a busier neighbourhood are both rougher.

        L      = Rec. 709 luminance, 0..1
        detail = min(1, sigma3x3(L) / ${ROUGHNESS_DETAIL_FULL})       local 3x3 std deviation
        d      = ${ROUGHNESS_DARK_WEIGHT} * (1 - L) + ${ROUGHNESS_DETAIL_WEIGHT} * detail   clamped to 0..1
        r      = min + (max - min) * (invert ? 1 - d : d)

      So white and flat lands on --min, black and busy lands on --max.
      --invert is for the surfaces where the cue runs backwards (polished
      dark stone, wet asphalt). The output is a greyscale map written as RGB
      with equal channels, ready for pack-orm. --min and --max are the real
      point of the subcommand: a map that reaches 0 or 1 is a mirror or a
      chalkboard, and neither of those is outdoors.

  tile-check <png> [--json]
      Does this texture wrap? Compares the two columns that meet when the
      image is tiled (x = 0 against x = width-1) and the two rows (y = 0
      against y = height-1) against the mean absolute difference between
      NEIGHBOURING interior columns and rows:

        seamScore = meanAbsDiff(edge pair) / meanAbsDiff(interior neighbours)

      0 is a perfect wrap (the edges are identical), 1 means the seam is an
      ordinary one-pixel step -- what a genuinely periodic texture scores --
      and a ramp scores roughly its own width. tileable is
      seamScore <= ${TILEABLE_MAX_SCORE}. worstEdge names the worse pair: "left-right",
      "top-bottom", or "none". Alpha is ignored; the comparison is over RGB.

      One case needs your eyes, and the report flags it as 'structured': a
      texture built from sparse strong boundaries -- brick courses, plank
      edges, tile grout -- is nearly flat between them, so the mean is small
      and a CORRECT wrap can score high. Measured on a 512px brick wall whose
      courses divide the height exactly: top/bottom step 79.1, mean interior
      step 9.9, score 8.0 -- and the strongest boundary inside that same
      texture is 83.2, which is what 'structured' compares against. The
      threshold stays strict, because over-reporting costs you one look at the
      picture and under-reporting ships the seam. When structured is true,
      look before you run make-tileable: on a bond pattern it is the wrong
      repair.

  make-tileable <in.png> <out.png> [--blend ${MAKE_TILEABLE_BLEND_DEFAULT}] [--json]
      The classic wrap fix, for the "tileable" texture that is not. Offsets
      the image by half its width and half its height with wrap-around, which
      makes the border continuous by construction (the two columns that now
      meet were neighbours in the original) and moves the old seam into the
      middle of the picture; then cross-fades that interior seam over
      --blend x size pixels by mixing each pixel with its mirror across the
      seam, at weight 0.5 on the seam itself falling linearly to 0 at the
      edge of the band. --blend 0 does the offset only. The report carries
      the tile-check score before and after, so the claim is a number.

      What this cannot do is invent content: a large feature crossing the old
      seam becomes a soft mirror of itself there. When the blend shows, ask
      the image tool for a better albedo instead. And when the source is
      'structured' (see tile-check) the report says so, because a half-width
      offset cuts a brick or plank pattern in half -- the very texture whose
      wrap was probably already correct.

  resize <in.png> <out.png> --size 1024 [--json]
      Box-filter (area average) downscale of the LONG edge to --size, aspect
      preserved. Downscale only -- a --size larger than the current long edge
      is refused, because upscaling invents detail that no judge will credit.
      A non-power-of-two --size is reported as a warning, not an error: mips
      are cleanest at 1024 / 512 / 256.

  pack-orm <ao.png|-> <roughness.png> <metallic.png|-> <out.png> [--json]
      Pack three single-channel maps into the glTF metallicRoughness layout:
      R = ambient occlusion, G = roughness, B = metallic. The red channel of
      each input is read, because these are greyscale maps. '-' substitutes
      the glTF default instead of a file: 255 for AO (no occlusion) and 0 for
      metallic (dielectric). Every input given must have the same size as the
      roughness map, and the output is 8-bit RGB.

Exit code 0 on success, 1 on failure with a one-line ERROR: on stderr.`;

const COMMON_OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

const OPTIONS = {
  info: {},
  normal: { strength: { type: "string" }, blur: { type: "string" }, "invert-y": { type: "boolean" } },
  roughness: { min: { type: "string" }, max: { type: "string" }, invert: { type: "boolean" } },
  "tile-check": {},
  "make-tileable": { blend: { type: "string" } },
  resize: { size: { type: "string" } },
  "pack-orm": {},
};

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

/** A refusal this script knows how to phrase, as opposed to a crash. */
class TextureError extends Error {}

function fail(message) {
  throw new TextureError(message);
}

function requirePositional(positionals, index, label) {
  const value = positionals[index];
  if (value === undefined || value === "") fail(`missing ${label}`);
  return value;
}

function requireFlag(value, label) {
  if (value === undefined || value === "") fail(`missing ${label}`);
  return value;
}

function num(value, label, { min = -Infinity, max = Infinity, integer = false, fallback } = {}) {
  if (value === undefined) {
    if (fallback === undefined) fail(`missing ${label}`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${label} must be a number, got '${value}'`);
  if (integer && !Number.isInteger(parsed)) fail(`${label} must be a whole number, got '${value}'`);
  if (parsed < min || parsed > max) fail(`${label} must be between ${min} and ${max}, got ${parsed}`);
  return parsed;
}

function existingFile(pathArg, label) {
  const abs = resolve(pathArg);
  if (!existsSync(abs)) fail(`${label} does not exist: ${pathArg}`);
  if (!statSync(abs).isFile()) fail(`${label} is not a file: ${pathArg}`);
  return abs;
}

function emit(values, payload, humanLines) {
  if (values.json) console.log(JSON.stringify(payload));
  else console.log(humanLines.join("\n"));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// PNG codec
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Paeth predictor, PNG spec 9.4. a = left, b = above, c = above-left. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Undo the per-row filters. `raw` is the inflated stream: one filter-type byte
 * followed by `bytesPerRow` bytes, `height` times. `bpp` is the filter's
 * distance to the left neighbour in bytes, which is bytes-per-pixel rounded
 * up, not the channel count.
 */
function unfilterRows(raw, height, bytesPerRow, bpp, label) {
  const out = Buffer.alloc(height * bytesPerRow);
  let prevStart = -1;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[y * (bytesPerRow + 1)];
    const srcStart = y * (bytesPerRow + 1) + 1;
    const dstStart = y * bytesPerRow;
    for (let i = 0; i < bytesPerRow; i += 1) {
      const x = raw[srcStart + i];
      const a = i >= bpp ? out[dstStart + i - bpp] : 0;
      const b = prevStart >= 0 ? out[prevStart + i] : 0;
      const c = prevStart >= 0 && i >= bpp ? out[prevStart + i - bpp] : 0;
      let value;
      switch (filterType) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: value = x + paeth(a, b, c); break;
        default:
          fail(`${label} uses row filter ${filterType} on row ${y}; PNG defines only 0-4 (none/sub/up/average/paeth)`);
      }
      out[dstStart + i] = value & 0xff;
    }
    prevStart = dstStart;
  }
  return out;
}

/**
 * Decode a PNG into straight 8-bit RGBA.
 *
 * Everything downstream works in RGBA regardless of what the file held, so
 * the colour-type fan-out happens exactly once, here. The source's bit depth,
 * colour type and alpha are kept on the result because `info` reports them
 * and because the encoder decides RGB vs RGBA from them.
 */
function decodePng(buffer, label = "<png>") {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      fail(`${label} is a JPEG, not a PNG. Re-save the texture as PNG; this script reads PNG only.`);
    }
    const head = bytes.subarray(0, 4).toString("latin1");
    fail(`${label} does not start with the PNG signature (found ${JSON.stringify(head)})`);
  }

  let header = null;
  const idat = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail(`${label} is truncated inside its '${type}' chunk`);
    const declaredCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    if (declaredCrc !== actualCrc) {
      fail(`${label} has a corrupt '${type}' chunk: CRC ${actualCrc} does not match the stored ${declaredCrc}`);
    }
    if (type === "IHDR") {
      if (length !== 13) fail(`${label} has a ${length}-byte IHDR; PNG requires 13`);
      header = {
        width: bytes.readUInt32BE(dataStart),
        height: bytes.readUInt32BE(dataStart + 4),
        bitDepth: bytes[dataStart + 8],
        colorType: bytes[dataStart + 9],
        compression: bytes[dataStart + 10],
        filter: bytes[dataStart + 11],
        interlace: bytes[dataStart + 12],
      };
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!header) fail(`${label} has no IHDR chunk`);
  const { width, height, bitDepth, colorType, compression, filter, interlace } = header;
  if (!width || !height) fail(`${label} declares a ${width}x${height} image`);
  if (compression !== 0) fail(`${label} declares compression method ${compression}; PNG defines only 0 (deflate)`);
  if (filter !== 0) fail(`${label} declares filter method ${filter}; PNG defines only 0`);
  if (interlace !== 0) {
    fail(`${label} is interlaced (Adam7). This decoder reads non-interlaced PNG only — re-save it without interlacing.`);
  }
  if (colorType === 3) {
    fail(`${label} is a palette PNG (colour type 3). This decoder reads greyscale/RGB/RGBA only — re-save it as truecolour.`);
  }
  const spec = COLOR_TYPES[colorType];
  if (!spec) fail(`${label} declares colour type ${colorType}; PNG defines 0, 2, 3, 4 and 6`);
  if (bitDepth !== 8 && bitDepth !== 16) {
    fail(`${label} is ${bitDepth}-bit ${spec.name}. This decoder reads 8- and 16-bit samples only — re-save it at 8 bits per channel.`);
  }
  if (!idat.length) fail(`${label} has no IDAT chunk`);

  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (error) {
    fail(`${label} has an IDAT stream that will not inflate: ${error?.message ?? error}`);
  }

  const sampleBytes = bitDepth / 8;
  const bytesPerRow = width * spec.channels * sampleBytes;
  const expected = height * (bytesPerRow + 1);
  if (raw.length < expected) {
    fail(`${label} decompresses to ${raw.length} bytes but a ${width}x${height} ${spec.name} image needs ${expected} — the image data is truncated`);
  }
  const pixels = unfilterRows(raw, height, bytesPerRow, Math.max(1, spec.channels * sampleBytes), label);

  // 16-bit is big-endian, so the high byte is the first of the pair; taking it
  // is the down-conversion, and it is exact for anything authored at 8 bits.
  const stride = spec.channels * sampleBytes;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const src = i * stride;
    const dst = i * 4;
    const s = (index) => pixels[src + index * sampleBytes];
    switch (colorType) {
      case 0: {
        const g = s(0);
        data[dst] = g; data[dst + 1] = g; data[dst + 2] = g; data[dst + 3] = 255;
        break;
      }
      case 2:
        data[dst] = s(0); data[dst + 1] = s(1); data[dst + 2] = s(2); data[dst + 3] = 255;
        break;
      case 4: {
        const g = s(0);
        data[dst] = g; data[dst + 1] = g; data[dst + 2] = g; data[dst + 3] = s(1);
        break;
      }
      default:
        data[dst] = s(0); data[dst + 1] = s(1); data[dst + 2] = s(2); data[dst + 3] = s(3);
        break;
    }
  }

  return {
    width,
    height,
    data,
    bitDepth,
    colorType,
    colorTypeName: spec.name,
    hasAlpha: spec.alpha,
  };
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode 8-bit RGB (colour type 2) or RGBA (colour type 6) with filter 0 on
 * every row. Filter 0 costs a few percent of file size against an adaptive
 * filter and removes a whole class of bug from a codec that has to be right
 * the first time; these are intermediate maps, not shipped payload.
 */
function encodePng({ width, height, data, alpha = false }) {
  if (!width || !height) fail(`cannot encode a ${width}x${height} image`);
  if (data.length !== width * height * 4) {
    fail(`cannot encode: ${width}x${height} needs ${width * height * 4} RGBA bytes, got ${data.length}`);
  }
  const channels = alpha ? 4 : 3;
  const bytesPerRow = width * channels;
  const raw = Buffer.alloc(height * (bytesPerRow + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (bytesPerRow + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = rowStart + 1 + x * channels;
      raw[dst] = data[src];
      raw[dst + 1] = data[src + 1];
      raw[dst + 2] = data[src + 2];
      if (alpha) raw[dst + 3] = data[src + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  // [10] compression, [11] filter, [12] interlace — 0, the only values every
  // decoder is required to support.
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function readPng(pathArg, label) {
  return decodePng(readFileSync(existingFile(pathArg, label)), label);
}

function writePng(pathArg, image) {
  const abs = resolve(pathArg);
  mkdirSync(dirname(abs), { recursive: true });
  const bytes = encodePng(image);
  writeFileSync(abs, bytes);
  return { path: abs, bytes: bytes.length };
}

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

function wrapIndex(value, size) {
  const m = value % size;
  return m < 0 ? m + size : m;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function toByte(value) {
  return clamp(Math.round(value), 0, 255);
}

/** Rec. 709 luminance in 0..1, one value per pixel. Alpha is ignored. */
function luminanceField(image) {
  const { width, height, data } = image;
  const field = new Float64Array(width * height);
  for (let i = 0; i < field.length; i += 1) {
    const p = i * 4;
    field[i] = (LUMA_R * data[p] + LUMA_G * data[p + 1] + LUMA_B * data[p + 2]) / 255;
  }
  return field;
}

/** Separable box blur with wrap-around, matching the wrap used for slopes. */
function boxBlur(field, width, height, radius) {
  if (radius <= 0) return Float64Array.from(field);
  const span = radius * 2 + 1;
  const horizontal = new Float64Array(field.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += field[row + wrapIndex(x + k, width)];
      horizontal[row + x] = sum / span;
    }
  }
  const out = new Float64Array(field.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += horizontal[wrapIndex(y + k, height) * width + x];
      out[y * width + x] = sum / span;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// normal
// ---------------------------------------------------------------------------

/**
 * Height-from-luminance -> Sobel -> tangent-space normal.
 *
 * Sign convention, stated once so the rest of the file and the help text can
 * point at it: x runs right, `row` runs DOWN the image, and the tangent-space
 * +Y axis runs UP the image (OpenGL / glTF). A surface whose height rises to
 * the right has its normal leaning left, hence the minus on dH/dx; and
 * dH/d(up) = -dH/d(row), so the minus cancels on the green channel.
 */
function normalMap(image, { strength = 2, blur = 1, invertY = false } = {}) {
  const { width, height } = image;
  const heights = boxBlur(luminanceField(image), width, height, blur);
  const data = new Uint8Array(width * height * 4);
  let reliefSum = 0;

  const at = (x, y) => heights[wrapIndex(y, height) * width + wrapIndex(x, width)];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tl = at(x - 1, y - 1); const tc = at(x, y - 1); const tr = at(x + 1, y - 1);
      const ml = at(x - 1, y); const mr = at(x + 1, y);
      const bl = at(x - 1, y + 1); const bc = at(x, y + 1); const br = at(x + 1, y + 1);

      const gx = (tr + 2 * mr + br - (tl + 2 * ml + bl)) / SOBEL_DIVISOR;
      const gRow = (bl + 2 * bc + br - (tl + 2 * tc + tr)) / SOBEL_DIVISOR;

      const nx = -gx * strength;
      const ny = (invertY ? -gRow : gRow) * strength;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);

      const r = toByte((nx / length) * 0.5 * 255 + 127.5);
      const g = toByte((ny / length) * 0.5 * 255 + 127.5);
      const b = toByte((nz / length) * 0.5 * 255 + 127.5);

      const p = (y * width + x) * 4;
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
      reliefSum += Math.abs(r - 128) + Math.abs(g - 128);
    }
  }

  return {
    image: { width, height, data, hasAlpha: false },
    relief: reliefSum / (width * height * 2),
  };
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------

/** Roughness from darkness and local busyness; see USAGE for the mapping. */
function roughnessMap(image, { min = ROUGHNESS_MIN_DEFAULT, max = ROUGHNESS_MAX_DEFAULT, invert = false } = {}) {
  const { width, height } = image;
  const luminance = luminanceField(image);
  const data = new Uint8Array(width * height * 4);
  let lowest = Infinity;
  let highest = -Infinity;
  let total = 0;

  const at = (x, y) => luminance[wrapIndex(y, height) * width + wrapIndex(x, width)];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let sumSquares = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const v = at(x + dx, y + dy);
          sum += v;
          sumSquares += v * v;
        }
      }
      const mean = sum / 9;
      const variance = Math.max(0, sumSquares / 9 - mean * mean);
      const detail = Math.min(1, Math.sqrt(variance) / ROUGHNESS_DETAIL_FULL);
      const l = at(x, y);
      const d = clamp(ROUGHNESS_DARK_WEIGHT * (1 - l) + ROUGHNESS_DETAIL_WEIGHT * detail, 0, 1);
      const rough = min + (max - min) * (invert ? 1 - d : d);

      const byte = toByte(rough * 255);
      const p = (y * width + x) * 4;
      data[p] = byte; data[p + 1] = byte; data[p + 2] = byte; data[p + 3] = 255;

      const stored = byte / 255;
      if (stored < lowest) lowest = stored;
      if (stored > highest) highest = stored;
      total += stored;
    }
  }

  return {
    image: { width, height, data, hasAlpha: false },
    stats: { min: lowest, max: highest, mean: total / (width * height) },
  };
}

// ---------------------------------------------------------------------------
// tile-check
// ---------------------------------------------------------------------------

function meanAbsDiffColumns(image, xa, xb) {
  const { width, data } = image;
  let sum = 0;
  for (let y = 0; y < image.height; y += 1) {
    const a = (y * width + xa) * 4;
    const b = (y * width + xb) * 4;
    sum += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
  }
  return sum / (image.height * 3);
}

function meanAbsDiffRows(image, ya, yb) {
  const { width, data } = image;
  let sum = 0;
  for (let x = 0; x < width; x += 1) {
    const a = (ya * width + x) * 4;
    const b = (yb * width + x) * 4;
    sum += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
  }
  return sum / (width * 3);
}

/** Mean and largest step between neighbouring interior columns. */
function interiorStepsX(image) {
  if (image.width < 2) return { mean: 0, max: 0 };
  let sum = 0;
  let largest = 0;
  for (let x = 0; x < image.width - 1; x += 1) {
    const step = meanAbsDiffColumns(image, x, x + 1);
    sum += step;
    if (step > largest) largest = step;
  }
  return { mean: sum / (image.width - 1), max: largest };
}

/** The same between neighbouring interior rows. */
function interiorStepsY(image) {
  if (image.height < 2) return { mean: 0, max: 0 };
  let sum = 0;
  let largest = 0;
  for (let y = 0; y < image.height - 1; y += 1) {
    const step = meanAbsDiffRows(image, y, y + 1);
    sum += step;
    if (step > largest) largest = step;
  }
  return { mean: sum / (image.height - 1), max: largest };
}

/**
 * How badly the image fails to wrap, in units of its own detail.
 *
 * The edge difference alone is meaningless — 6 code values is a broken seam on
 * a smooth gradient and invisible on gravel — so it is divided by the mean
 * step between neighbouring interior columns/rows. That makes 1 the score of a
 * seam indistinguishable from any other pixel boundary, which is what a truly
 * periodic texture produces, and it makes the threshold portable across
 * textures.
 *
 * The mean has one failure mode, and it is a common one, so it is measured
 * rather than left to bite: a texture built from sparse strong boundaries —
 * brick courses, plank edges, tile grout — spends most of its interior nearly
 * flat, which drags the mean down until a perfectly correct wrap scores high.
 * Measured on a 512² brick wall whose courses divide the height exactly: the
 * top/bottom step is 79.1 against a mean interior step of 9.9 (score 8.0, over
 * the threshold) while the strongest boundary inside the same texture is 83.2.
 * So `interiorMax` and `withinStructure` are reported next to the score: a
 * failing seam that is no larger than a boundary the texture already contains
 * is the signature of that case, and `make-tileable` is the wrong answer to it
 * — offsetting by half a width cuts the bond pattern. The threshold itself is
 * left strict on purpose. Over-reporting costs the agent a look at the
 * picture; under-reporting ships the seam.
 */
function seamReport(image) {
  const { width, height } = image;
  const hDiff = width >= 2 ? meanAbsDiffColumns(image, 0, width - 1) : 0;
  const vDiff = height >= 2 ? meanAbsDiffRows(image, 0, height - 1) : 0;
  const hSteps = interiorStepsX(image);
  const vSteps = interiorStepsY(image);
  const hScore = hDiff / Math.max(hSteps.mean, SEAM_GRADIENT_FLOOR);
  const vScore = vDiff / Math.max(vSteps.mean, SEAM_GRADIENT_FLOOR);
  const seamScore = Math.max(hScore, vScore);
  let worstEdge = "none";
  if (seamScore > 0) worstEdge = hScore >= vScore ? "left-right" : "top-bottom";
  const horizontal = {
    edgeDiff: hDiff,
    interiorGradient: hSteps.mean,
    interiorMax: hSteps.max,
    score: hScore,
    withinStructure: hDiff <= hSteps.max,
  };
  const vertical = {
    edgeDiff: vDiff,
    interiorGradient: vSteps.mean,
    interiorMax: vSteps.max,
    score: vScore,
    withinStructure: vDiff <= vSteps.max,
  };
  const worst = worstEdge === "top-bottom" ? vertical : horizontal;
  const tileable = seamScore <= TILEABLE_MAX_SCORE;
  return {
    seamScore,
    tileable,
    threshold: TILEABLE_MAX_SCORE,
    worstEdge,
    // Only meaningful as a qualifier on a failure: "flagged, and here is the
    // reason the flag may be the estimator's known false alarm". On a texture
    // that already passes it would be noise. The raw measurement stays
    // available per axis as `withinStructure`.
    structured: !tileable && worstEdge !== "none" && worst.withinStructure,
    horizontal,
    vertical,
  };
}

// ---------------------------------------------------------------------------
// make-tileable
// ---------------------------------------------------------------------------

/** Wrap-offset by (dx, dy): out(x, y) = in((x + dx) mod w, (y + dy) mod h). */
function offsetWrapped(image, dx, dy) {
  const { width, height, data } = image;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    const srcRow = wrapIndex(y + dy, height) * width;
    const dstRow = y * width;
    for (let x = 0; x < width; x += 1) {
      const src = (srcRow + wrapIndex(x + dx, width)) * 4;
      const dst = (dstRow + x) * 4;
      out[dst] = data[src]; out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2]; out[dst + 3] = data[src + 3];
    }
  }
  return { width, height, data: out, hasAlpha: image.hasAlpha };
}

/**
 * Cross-fade weight for a pixel `d` steps from a seam (d = 1 is the pixel
 * touching it). 0.5 at the seam closes the discontinuity exactly — both sides
 * become the same average — and it falls linearly to 0 at the band edge so the
 * band itself does not introduce a new step.
 */
function seamBlendWeight(d, band) {
  if (d < 1 || d > band) return 0;
  if (band < 2) return 0.5;
  return 0.5 * ((band - d) / (band - 1));
}

/** Mix each pixel in the band with its mirror across a vertical seam at `cs`. */
function blendVerticalSeam(image, cs, band) {
  if (band < 1) return image;
  const { width, height, data } = image;
  const out = Uint8Array.from(data);
  for (let x = cs - band; x <= cs + band - 1; x += 1) {
    if (x < 0 || x >= width) continue;
    const d = x < cs ? cs - x : x - cs + 1;
    const weight = seamBlendWeight(d, band);
    if (weight <= 0) continue;
    const mirror = 2 * cs - 1 - x;
    if (mirror < 0 || mirror >= width) continue;
    for (let y = 0; y < height; y += 1) {
      const a = (y * width + x) * 4;
      const b = (y * width + mirror) * 4;
      for (let c = 0; c < 4; c += 1) out[a + c] = toByte(data[a + c] * (1 - weight) + data[b + c] * weight);
    }
  }
  return { width, height, data: out, hasAlpha: image.hasAlpha };
}

/** The same across a horizontal seam at row `rs`. */
function blendHorizontalSeam(image, rs, band) {
  if (band < 1) return image;
  const { width, height, data } = image;
  const out = Uint8Array.from(data);
  for (let y = rs - band; y <= rs + band - 1; y += 1) {
    if (y < 0 || y >= height) continue;
    const d = y < rs ? rs - y : y - rs + 1;
    const weight = seamBlendWeight(d, band);
    if (weight <= 0) continue;
    const mirror = 2 * rs - 1 - y;
    if (mirror < 0 || mirror >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const a = (y * width + x) * 4;
      const b = (mirror * width + x) * 4;
      for (let c = 0; c < 4; c += 1) out[a + c] = toByte(data[a + c] * (1 - weight) + data[b + c] * weight);
    }
  }
  return { width, height, data: out, hasAlpha: image.hasAlpha };
}

function makeTileable(image, blend = MAKE_TILEABLE_BLEND_DEFAULT) {
  const { width, height } = image;
  const dx = Math.floor(width / 2);
  const dy = Math.floor(height / 2);
  let out = offsetWrapped(image, dx, dy);

  // After the offset the old border sits between these two indices.
  const seamX = width - dx;
  const seamY = height - dy;
  const bandX = blend > 0 ? Math.min(Math.floor(width / 2), Math.max(1, Math.round((blend * width) / 2))) : 0;
  const bandY = blend > 0 ? Math.min(Math.floor(height / 2), Math.max(1, Math.round((blend * height) / 2))) : 0;

  if (width >= 2) out = blendVerticalSeam(out, seamX, bandX);
  if (height >= 2) out = blendHorizontalSeam(out, seamY, bandY);
  return { image: out, offset: { x: dx, y: dy }, seam: { x: seamX, y: seamY }, band: { x: bandX, y: bandY } };
}

// ---------------------------------------------------------------------------
// resize
// ---------------------------------------------------------------------------

/** Area-average box filter. Every source pixel contributes its overlap, so a
 *  non-integer ratio is handled without resampling artefacts of its own. */
function boxResize(image, outWidth, outHeight) {
  const { width, height, data } = image;
  const out = new Uint8Array(outWidth * outHeight * 4);
  const sx = width / outWidth;
  const sy = height / outHeight;
  for (let oy = 0; oy < outHeight; oy += 1) {
    const y0 = oy * sy;
    const y1 = (oy + 1) * sy;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(height, Math.ceil(y1));
    for (let ox = 0; ox < outWidth; ox += 1) {
      const x0 = ox * sx;
      const x1 = (ox + 1) * sx;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(width, Math.ceil(x1));
      let r = 0; let g = 0; let b = 0; let a = 0; let total = 0;
      for (let y = iy0; y < iy1; y += 1) {
        const cy = Math.min(y1, y + 1) - Math.max(y0, y);
        if (cy <= 0) continue;
        for (let x = ix0; x < ix1; x += 1) {
          const cx = Math.min(x1, x + 1) - Math.max(x0, x);
          if (cx <= 0) continue;
          const weight = cx * cy;
          const p = (y * width + x) * 4;
          r += data[p] * weight; g += data[p + 1] * weight;
          b += data[p + 2] * weight; a += data[p + 3] * weight;
          total += weight;
        }
      }
      const dst = (oy * outWidth + ox) * 4;
      if (total <= 0) {
        const p = (Math.min(height - 1, iy0) * width + Math.min(width - 1, ix0)) * 4;
        out[dst] = data[p]; out[dst + 1] = data[p + 1]; out[dst + 2] = data[p + 2]; out[dst + 3] = data[p + 3];
      } else {
        out[dst] = toByte(r / total); out[dst + 1] = toByte(g / total);
        out[dst + 2] = toByte(b / total); out[dst + 3] = toByte(a / total);
      }
    }
  }
  return { width: outWidth, height: outHeight, data: out, hasAlpha: image.hasAlpha };
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

// ---------------------------------------------------------------------------
// pack-orm
// ---------------------------------------------------------------------------

/** R = AO, G = roughness, B = metallic — the glTF metallicRoughness layout. */
function packOrm({ ao, roughness, metallic, aoDefault = 255, metallicDefault = 0 }) {
  const { width, height } = roughness;
  for (const [label, map] of [["ao", ao], ["metallic", metallic]]) {
    if (!map) continue;
    if (map.width !== width || map.height !== height) {
      fail(`<${label}> is ${map.width}x${map.height} but <roughness> is ${width}x${height}; all ORM inputs must be the same size`);
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const p = i * 4;
    data[p] = ao ? ao.data[p] : aoDefault;
    data[p + 1] = roughness.data[p];
    data[p + 2] = metallic ? metallic.data[p] : metallicDefault;
    data[p + 3] = 255;
  }
  return { width, height, data, hasAlpha: false };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function axisPayload(axis) {
  return {
    edgeDiff: round3(axis.edgeDiff),
    interiorGradient: round3(axis.interiorGradient),
    interiorMax: round3(axis.interiorMax),
    score: round3(axis.score),
    withinStructure: axis.withinStructure,
  };
}

function seamPayload(report) {
  return {
    seamScore: round3(report.seamScore),
    tileable: report.tileable,
    threshold: report.threshold,
    worstEdge: report.worstEdge,
    structured: report.structured,
    horizontal: axisPayload(report.horizontal),
    vertical: axisPayload(report.vertical),
  };
}

/**
 * The two ways this repair is the wrong repair. Neither refuses the work —
 * the caller may know something the numbers do not — but both are loud,
 * because a half-width offset is not visible in a file listing.
 */
function makeTileableWarnings(before, inPath, outPath) {
  if (before.tileable) {
    return [`${inPath} already tiles (seamScore ${round3(before.seamScore)}, threshold ${TILEABLE_MAX_SCORE}). Offsetting it repairs nothing and moves every feature by half the image; use the original unless you wanted the offset for its own sake.`];
  }
  if (before.structured) {
    const worst = before.worstEdge === "top-bottom" ? before.vertical : before.horizontal;
    return [`the source is a structured texture: its ${before.worstEdge} seam (${round3(worst.edgeDiff)}) is no larger than a boundary it already contains (${round3(worst.interiorMax)}), so its wrap may have been correct to begin with. Compare ${outPath} against ${inPath} before using it — a half-width offset cuts a brick or plank pattern.`];
  }
  return [];
}

/** What to do about this seam, in one sentence the agent can act on. */
function seamAdvice(report, inPath) {
  if (report.tileable) return "the seam is within an ordinary pixel step — tile it";
  const worst = report.worstEdge === "top-bottom" ? report.vertical : report.horizontal;
  if (report.structured) {
    return `the ${report.worstEdge} seam is ${round3(worst.edgeDiff)} against a mean interior step of ${round3(worst.interiorGradient)}, but this texture already contains boundaries as strong (up to ${round3(worst.interiorMax)}) — a brick course, a plank edge, a grout line. A repeating structure whose period divides the image size wraps correctly at a step like that, so LOOK at the picture before doing anything: 'make-tileable' would offset by half and mirror the seam, which cuts the pattern`;
  }
  return `run 'make-tileable ${inPath} <out.png>' or regenerate the albedo; the ${report.worstEdge} pair is the visible one`;
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return 0;
  }
  const command = argv[0];
  if (!SUBCOMMANDS.includes(command)) {
    console.error(`ERROR: unknown subcommand '${command}'. Expected one of: ${SUBCOMMANDS.join(", ")}`);
    console.error(USAGE);
    return 1;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: joinNegativeNumbers(argv.slice(1)),
      options: { ...COMMON_OPTIONS, ...OPTIONS[command] },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    fail(`${command}: ${error.message}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case "info": {
      const inPath = requirePositional(positionals, 0, "<png>");
      const image = readPng(inPath, "<png>");
      const seam = seamReport(image);
      const payload = {
        ok: true,
        command: "info",
        path: inPath,
        bytes: statSync(resolve(inPath)).size,
        width: image.width,
        height: image.height,
        bitDepth: image.bitDepth,
        colorType: image.colorType,
        colorTypeName: image.colorTypeName,
        hasAlpha: image.hasAlpha,
        ...seamPayload(seam),
      };
      emit(values, payload, [
        `${inPath}: ${image.width}x${image.height} ${image.colorTypeName} ${image.bitDepth}-bit${image.hasAlpha ? " +alpha" : ""}, ${payload.bytes} bytes`,
        `  seam     score ${payload.seamScore} (threshold ${TILEABLE_MAX_SCORE}) — ${seam.tileable ? "tiles" : `does NOT tile, worst at ${seam.worstEdge}${seam.structured ? " (structured — run tile-check and read the advice)" : ""}`}`,
      ]);
      break;
    }

    case "normal": {
      const inPath = requirePositional(positionals, 0, "<albedo.png>");
      const outPath = requirePositional(positionals, 1, "<out.png>");
      // Negative is allowed on purpose: it is the only way to say "the bright
      // part of this albedo is the recessed one", which is the truth for every
      // wall with pale mortar or white grout. See USAGE.
      const strength = num(values.strength, "--strength", { min: -64, max: 64, fallback: 2 });
      const blur = num(values.blur, "--blur", { integer: true, min: 0, max: MAX_BLUR_RADIUS, fallback: 1 });
      const invertY = Boolean(values["invert-y"]);
      const source = readPng(inPath, "<albedo.png>");
      const { image, relief } = normalMap(source, { strength, blur, invertY });
      const written = writePng(outPath, image);
      const flat = relief < RELIEF_FLOOR;
      const payload = {
        ok: true,
        command: "normal",
        input: inPath,
        output: outPath,
        width: image.width,
        height: image.height,
        strength,
        blur,
        convention: invertY ? "directx" : "opengl",
        bytes: written.bytes,
        relief: round3(relief),
        warnings: flat
          ? [`relief ${round3(relief)} is under ${RELIEF_FLOOR}: this albedo is flat, so the normal map will change nothing. Ask the image tool for a texture with visible surface structure.`]
          : [],
      };
      emit(values, payload, [
        `normal --strength ${strength} --blur ${blur} (${payload.convention}): ${outPath}`,
        `  ${image.width}x${image.height}, ${written.bytes} bytes, relief ${payload.relief}`,
        ...payload.warnings.map((warning) => `  ! ${warning}`),
      ]);
      break;
    }

    case "roughness": {
      const inPath = requirePositional(positionals, 0, "<albedo.png>");
      const outPath = requirePositional(positionals, 1, "<out.png>");
      const min = num(values.min, "--min", { min: 0, max: 1, fallback: ROUGHNESS_MIN_DEFAULT });
      const max = num(values.max, "--max", { min: 0, max: 1, fallback: ROUGHNESS_MAX_DEFAULT });
      if (min >= max) fail(`--min ${min} must be below --max ${max}`);
      const invert = Boolean(values.invert);
      const source = readPng(inPath, "<albedo.png>");
      const { image, stats } = roughnessMap(source, { min, max, invert });
      const written = writePng(outPath, image);
      const payload = {
        ok: true,
        command: "roughness",
        input: inPath,
        output: outPath,
        width: image.width,
        height: image.height,
        min,
        max,
        invert,
        bytes: written.bytes,
        mapping: `${ROUGHNESS_DARK_WEIGHT} * (1 - luminance) + ${ROUGHNESS_DETAIL_WEIGHT} * min(1, sigma3x3 / ${ROUGHNESS_DETAIL_FULL}), remapped into [min, max]${invert ? ", inverted" : ""}`,
        stats: { min: round3(stats.min), max: round3(stats.max), mean: round3(stats.mean) },
      };
      emit(values, payload, [
        `roughness --min ${min} --max ${max}${invert ? " --invert" : ""}: ${outPath}`,
        `  ${image.width}x${image.height}, ${written.bytes} bytes`,
        `  range    ${payload.stats.min} .. ${payload.stats.max} (mean ${payload.stats.mean})`,
      ]);
      break;
    }

    case "tile-check": {
      const inPath = requirePositional(positionals, 0, "<png>");
      const image = readPng(inPath, "<png>");
      const seam = seamReport(image);
      const payload = {
        ok: true,
        command: "tile-check",
        path: inPath,
        width: image.width,
        height: image.height,
        ...seamPayload(seam),
        advice: seamAdvice(seam, inPath),
      };
      emit(values, payload, [
        `tile-check ${inPath}: ${image.width}x${image.height}`,
        `  seamScore ${payload.seamScore} (threshold ${TILEABLE_MAX_SCORE}) -> ${seam.tileable ? "tileable" : "NOT tileable"}${seam.structured ? ", but structured — read the advice" : ""}`,
        `  left-right ${payload.horizontal.score} (edge ${payload.horizontal.edgeDiff} vs interior mean ${payload.horizontal.interiorGradient}, max ${payload.horizontal.interiorMax})`,
        `  top-bottom ${payload.vertical.score} (edge ${payload.vertical.edgeDiff} vs interior mean ${payload.vertical.interiorGradient}, max ${payload.vertical.interiorMax})`,
        `  ${payload.advice}`,
      ]);
      break;
    }

    case "make-tileable": {
      const inPath = requirePositional(positionals, 0, "<in.png>");
      const outPath = requirePositional(positionals, 1, "<out.png>");
      const blend = num(values.blend, "--blend", { min: 0, max: 0.5, fallback: MAKE_TILEABLE_BLEND_DEFAULT });
      const source = readPng(inPath, "<in.png>");
      const before = seamReport(source);
      const result = makeTileable(source, blend);
      const after = seamReport(result.image);
      const written = writePng(outPath, { ...result.image, alpha: source.hasAlpha });
      const payload = {
        ok: true,
        command: "make-tileable",
        input: inPath,
        output: outPath,
        width: result.image.width,
        height: result.image.height,
        blend,
        offset: result.offset,
        seam: result.seam,
        blendPixels: result.band,
        bytes: written.bytes,
        before: { seamScore: round3(before.seamScore), tileable: before.tileable, worstEdge: before.worstEdge, structured: before.structured },
        after: { seamScore: round3(after.seamScore), tileable: after.tileable, worstEdge: after.worstEdge, structured: after.structured },
        // Written even though the file is already on disk: this operation is
        // cheap to redo and the alternative is a smeared brick wall shipped
        // without anyone reading a number.
        warnings: makeTileableWarnings(before, inPath, outPath),
      };
      emit(values, payload, [
        `make-tileable --blend ${blend}: ${outPath}`,
        `  offset    ${result.offset.x},${result.offset.y}; cross-fade band ${result.band.x}px x ${result.band.y}px`,
        `  seamScore ${payload.before.seamScore} -> ${payload.after.seamScore} (${payload.after.tileable ? "tileable" : "still NOT tileable"})`,
        ...payload.warnings.map((warning) => `  ! ${warning}`),
      ]);
      break;
    }

    case "resize": {
      const inPath = requirePositional(positionals, 0, "<in.png>");
      const outPath = requirePositional(positionals, 1, "<out.png>");
      const size = num(requireFlag(values.size, "--size"), "--size", { integer: true, min: 1, max: 16384 });
      const source = readPng(inPath, "<in.png>");
      const longEdge = Math.max(source.width, source.height);
      if (size > longEdge) {
        fail(`refusing to upscale: ${inPath} is ${source.width}x${source.height} (long edge ${longEdge}) and --size is ${size}. Upscaling invents detail — generate the texture at the size you need instead.`);
      }
      const scale = size / longEdge;
      const outWidth = Math.max(1, Math.round(source.width * scale));
      const outHeight = Math.max(1, Math.round(source.height * scale));
      const resized = scale === 1 ? source : boxResize(source, outWidth, outHeight);
      const written = writePng(outPath, { ...resized, alpha: source.hasAlpha });
      const warnings = [];
      if (!isPowerOfTwo(size)) {
        warnings.push(`--size ${size} is not a power of two; GPUs mip cleanest at 1024 / 512 / 256 and a texture this close to one of them samples the same`);
      }
      const payload = {
        ok: true,
        command: "resize",
        input: inPath,
        output: outPath,
        size,
        from: { width: source.width, height: source.height },
        to: { width: resized.width, height: resized.height },
        bytes: { before: statSync(resolve(inPath)).size, after: written.bytes },
        warnings,
      };
      emit(values, payload, [
        `resize --size ${size}: ${outPath}`,
        `  pixels ${source.width}x${source.height} -> ${resized.width}x${resized.height}`,
        `  bytes  ${payload.bytes.before} -> ${payload.bytes.after}`,
        ...warnings.map((warning) => `  ! ${warning}`),
      ]);
      break;
    }

    case "pack-orm": {
      const aoArg = requirePositional(positionals, 0, "<ao.png|->");
      const roughnessArg = requirePositional(positionals, 1, "<roughness.png>");
      const metallicArg = requirePositional(positionals, 2, "<metallic.png|->");
      const outPath = requirePositional(positionals, 3, "<out.png>");
      if (roughnessArg === "-") fail("<roughness.png> cannot be '-': the roughness map is what an ORM pack exists to carry");
      const ao = aoArg === "-" ? null : readPng(aoArg, "<ao.png>");
      const roughness = readPng(roughnessArg, "<roughness.png>");
      const metallic = metallicArg === "-" ? null : readPng(metallicArg, "<metallic.png>");
      const packed = packOrm({ ao, roughness, metallic });
      const written = writePng(outPath, packed);
      const payload = {
        ok: true,
        command: "pack-orm",
        ao: aoArg === "-" ? null : aoArg,
        roughness: roughnessArg,
        metallic: metallicArg === "-" ? null : metallicArg,
        output: outPath,
        width: packed.width,
        height: packed.height,
        bytes: written.bytes,
        channels: {
          r: ao ? `ao (${aoArg})` : "ao (constant 255 — no occlusion)",
          g: `roughness (${roughnessArg})`,
          b: metallic ? `metallic (${metallicArg})` : "metallic (constant 0 — dielectric)",
        },
      };
      emit(values, payload, [
        `pack-orm: ${outPath}`,
        `  ${packed.width}x${packed.height}, ${written.bytes} bytes`,
        `  R ${payload.channels.r}`,
        `  G ${payload.channels.g}`,
        `  B ${payload.channels.b}`,
      ]);
      break;
    }

    default:
      fail(`unhandled subcommand '${command}'`);
  }
  return 0;
}

/** Node 22 has no `import.meta.main`, so the entry check is by path. Without
 *  it, importing this module (the test suite does, for the codec) would run
 *  the CLI. */
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    process.exitCode = main();
  } catch (error) {
    if (error instanceof TextureError) {
      console.error(`ERROR: ${error.message}`);
    } else {
      console.error(`ERROR: unexpected failure: ${error?.message ?? error}`);
      if (error?.stack) console.error(error.stack);
    }
    process.exitCode = 1;
  }
}

export {
  boxResize,
  decodePng,
  encodePng,
  luminanceField,
  makeTileable,
  normalMap,
  packOrm,
  roughnessMap,
  seamReport,
  TextureError,
  TILEABLE_MAX_SCORE,
};
