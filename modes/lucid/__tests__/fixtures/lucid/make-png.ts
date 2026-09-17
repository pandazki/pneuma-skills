/**
 * A real, tiny PNG, encoded here rather than committed as a binary blob.
 *
 * `lucid.mjs` checks PNG magic bytes before it copies a capture or a target,
 * so the suite needs files that are genuinely PNGs — and a few bytes that are
 * genuinely not. Both come from this file: no fixtures on disk, and the
 * images carry a colour so a copy can be proved byte-for-byte.
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

export interface PngOptions {
  width?: number;
  height?: number;
  /** RGBA, 0-255. */
  color?: [number, number, number, number];
}

/** A solid-colour RGBA PNG. */
export function pngBytes({ width = 4, height = 4, color = [249, 115, 22, 255] }: PngOptions = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // [10] compression, [11] filter, [12] interlace — all 0, the only values
  // every decoder must support.

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0; // per-row filter: none
    for (let x = 0; x < width; x += 1) {
      const p = row + 1 + x * 4;
      raw[p] = color[0];
      raw[p + 1] = color[1];
      raw[p + 2] = color[2];
      raw[p + 3] = color[3];
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Write a PNG, creating its parent directory. Returns the path. */
export function writePng(path: string, options: PngOptions = {}): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pngBytes(options));
  return path;
}
