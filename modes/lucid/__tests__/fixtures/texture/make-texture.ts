/**
 * PNG fixtures for `texture.mjs`, encoded here rather than committed as
 * binaries.
 *
 * The decoder under test has to survive the whole shape of the format, not
 * just the one shape `encodePng` happens to write: every row filter, every
 * non-palette colour type, 16-bit samples, and the two forms it is supposed
 * to refuse by name. A fixture generator that only ever emitted filter 0
 * would leave four of the five filter branches unexecuted, so this encoder
 * takes the filter as a parameter and can cycle all five down one image.
 *
 * `node:zlib` only — the same budget the script itself runs on.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = -1;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** 0 none, 1 sub, 2 up, 3 average, 4 paeth; "cycle" uses `row % 5`. */
export type PngFilter = 0 | 1 | 2 | 3 | 4 | "cycle";

export type PngColorType = 0 | 2 | 4 | 6;

export const CHANNELS: Record<PngColorType, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export interface RawImage {
  width: number;
  height: number;
  colorType: PngColorType;
  bitDepth: 8 | 16;
  /** Row-major, channel-interleaved samples: 0..255 at 8 bits, 0..65535 at 16. */
  samples: number[];
}

export interface EncodeOptions {
  filter?: PngFilter;
  /** Sets the IHDR interlace byte. The IDAT stays non-interlaced — the
   *  decoder is supposed to refuse on the header, long before it looks. */
  interlace?: boolean;
}

/** Encode a RawImage as a real PNG with the requested row filters. */
export function encodeFixturePng(image: RawImage, { filter = 0, interlace = false }: EncodeOptions = {}): Buffer {
  const { width, height, colorType, bitDepth, samples } = image;
  const channels = CHANNELS[colorType];
  const sampleBytes = bitDepth / 8;
  const bytesPerRow = width * channels * sampleBytes;
  const bpp = channels * sampleBytes;
  if (samples.length !== width * height * channels) {
    throw new Error(`fixture: ${width}x${height} colour type ${colorType} needs ${width * height * channels} samples, got ${samples.length}`);
  }

  const rows: Buffer[] = [];
  let previous = Buffer.alloc(bytesPerRow);
  for (let y = 0; y < height; y += 1) {
    const raw = Buffer.alloc(bytesPerRow);
    for (let i = 0; i < width * channels; i += 1) {
      const value = samples[y * width * channels + i];
      if (bitDepth === 16) raw.writeUInt16BE(value & 0xffff, i * 2);
      else raw[i] = value & 0xff;
    }
    const filterType = filter === "cycle" ? y % 5 : filter;
    const encoded = Buffer.alloc(bytesPerRow + 1);
    encoded[0] = filterType;
    for (let i = 0; i < bytesPerRow; i += 1) {
      const a = i >= bpp ? raw[i - bpp] : 0;
      const b = previous[i];
      const c = i >= bpp ? previous[i - bpp] : 0;
      let value: number;
      switch (filterType) {
        case 0: value = raw[i]; break;
        case 1: value = raw[i] - a; break;
        case 2: value = raw[i] - b; break;
        case 3: value = raw[i] - ((a + b) >> 1); break;
        case 4: value = raw[i] - paeth(a, b, c); break;
        default: throw new Error(`fixture: unknown filter ${filterType}`);
      }
      encoded[i + 1] = value & 0xff;
    }
    rows.push(encoded);
    previous = raw;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = interlace ? 1 : 0;

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A colour-type-3 PNG with a real PLTE — valid, and refused by name. */
export function palettePng(width = 4, height = 4): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;

  const plte = Buffer.from([0, 0, 0, 255, 255, 255, 249, 115, 22]);
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = (x + y) % 3;
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A 4-bit greyscale PNG — valid PNG, outside this decoder's stated range. */
export function lowBitDepthPng(width = 4, height = 4): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 4;
  ihdr[9] = 0;
  const bytesPerRow = Math.ceil((width * 4) / 8);
  const raw = Buffer.alloc(height * (bytesPerRow + 1));
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Flip one byte inside the IDAT payload so its stored CRC stops matching. */
export function corruptIdat(png: Buffer): Buffer {
  const out = Buffer.from(png);
  let offset = 8;
  while (offset + 8 <= out.length) {
    const length = out.readUInt32BE(offset);
    const type = out.subarray(offset + 4, offset + 8).toString("latin1");
    if (type === "IDAT") {
      out[offset + 8] ^= 0xff;
      return out;
    }
    offset += 12 + length;
  }
  throw new Error("fixture: no IDAT to corrupt");
}

/** What the decoder must produce for this image: straight 8-bit RGBA. */
export function expectedRgba(image: RawImage): Uint8Array {
  const { width, height, colorType, bitDepth, samples } = image;
  const channels = CHANNELS[colorType];
  const shift = bitDepth === 16 ? 8 : 0;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const src = i * channels;
    const dst = i * 4;
    const s = (index: number) => (samples[src + index] >> shift) & 0xff;
    if (colorType === 0) {
      const g = s(0);
      out[dst] = g; out[dst + 1] = g; out[dst + 2] = g; out[dst + 3] = 255;
    } else if (colorType === 4) {
      const g = s(0);
      out[dst] = g; out[dst + 1] = g; out[dst + 2] = g; out[dst + 3] = s(1);
    } else if (colorType === 2) {
      out[dst] = s(0); out[dst + 1] = s(1); out[dst + 2] = s(2); out[dst + 3] = 255;
    } else {
      out[dst] = s(0); out[dst + 1] = s(1); out[dst + 2] = s(2); out[dst + 3] = s(3);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image generators — the pixel patterns the derivations are pinned against
// ---------------------------------------------------------------------------

function build(
  width: number,
  height: number,
  colorType: PngColorType,
  bitDepth: 8 | 16,
  fn: (x: number, y: number) => number[],
): RawImage {
  const channels = CHANNELS[colorType];
  const samples: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = fn(x, y);
      if (pixel.length !== channels) throw new Error(`fixture: expected ${channels} samples per pixel, got ${pixel.length}`);
      for (const value of pixel) samples.push(value);
    }
  }
  return { width, height, colorType, bitDepth, samples };
}

export function rgbaImage(width: number, height: number, fn: (x: number, y: number) => number[]): RawImage {
  return build(width, height, 6, 8, fn);
}

export function rgbImage(width: number, height: number, fn: (x: number, y: number) => number[]): RawImage {
  return build(width, height, 2, 8, fn);
}

export function greyImage(width: number, height: number, fn: (x: number, y: number) => number): RawImage {
  return build(width, height, 0, 8, (x, y) => [fn(x, y)]);
}

export function greyAlphaImage(width: number, height: number, fn: (x: number, y: number) => number[]): RawImage {
  return build(width, height, 4, 8, fn);
}

export function rgb16Image(width: number, height: number, fn: (x: number, y: number) => number[]): RawImage {
  return build(width, height, 2, 16, fn);
}

/** A pattern with no two pixels alike, so a filter bug cannot hide in it. */
export function noisyRgba(width: number, height: number): RawImage {
  return rgbaImage(width, height, (x, y) => [
    (x * 37 + y * 11) % 256,
    (x * 5 + y * 91) % 256,
    (x * 149 + y * 3) % 256,
    (x * 17 + y * 53) % 256,
  ]);
}

export function solidRgb(width: number, height: number, rgb: number[]): RawImage {
  return rgbImage(width, height, () => rgb);
}

/** Black on the left, white on the right: the sign fixture for `normal`. */
export function horizontalRampRgb(width: number, height: number): RawImage {
  return rgbImage(width, height, (x) => {
    const v = Math.round((x / (width - 1)) * 255);
    return [v, v, v];
  });
}

/** Black at the top, white at the bottom: the fixture for the green channel. */
export function verticalRampRgb(width: number, height: number): RawImage {
  return rgbImage(width, height, (_x, y) => {
    const v = Math.round((y / (height - 1)) * 255);
    return [v, v, v];
  });
}

/**
 * A sine whose period is exactly the image size on both axes — genuinely
 * seamless, and deliberately phased so the seam sits at the steepest part of
 * the wave. That is the hardest honest case for `tile-check`: the wrap step is
 * the largest step in the image, so it scores around 1.6 rather than 0.
 */
export function periodicRgb(width: number, height: number, amplitude = 60): RawImage {
  return rgbImage(width, height, (x, y) => {
    const v = Math.round(
      128 + amplitude * Math.sin((2 * Math.PI * x) / width) + amplitude * Math.sin((2 * Math.PI * y) / height),
    );
    const c = Math.max(0, Math.min(255, v));
    return [c, c, c];
  });
}

/**
 * Brick courses: `mortar` light rows at the top of every `courseHeight`, and a
 * gentle wave along x whose period is the width. When `courseHeight` divides
 * `height` the result wraps CORRECTLY on both axes — and its top/bottom step is
 * far larger than its mean interior step, which is the case `tile-check` has to
 * report as structured rather than as a broken seam.
 */
export function courseRgb(width: number, height: number, courseHeight = 16, mortar = 2): RawImage {
  return rgbImage(width, height, (x, y) => {
    const base = y % courseHeight < mortar ? 190 : 90;
    const v = Math.round(base + 8 * Math.sin((2 * Math.PI * x) / width));
    return [v, v, v];
  });
}

/** Write a PNG, creating its parent directory. Returns the path. */
export function writePngFile(path: string, bytes: Buffer): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}
