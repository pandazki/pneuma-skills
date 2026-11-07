/**
 * The pure halves of sticker-media.mjs: container readers and patchers,
 * pixel measurements, timelines and geometry. No ffmpeg — the encoders
 * that use these run in exporters-media.test.ts (media tier).
 */

import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";

import { readGifInfo } from "../../_shared/scripts/generate_gif.mjs";
import { crc32 } from "../../_shared/scripts/zip.mjs";
import * as M from "../skill/scripts/sticker-media.mjs";
import { structuralGif } from "./scripts-mock-generators.mjs";

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A 1×1 RGBA APNG of `frames` frames, each `delayNum/delayDen` s, playing `plays` times. */
function apng(frames: number, { delayNum = 12, delayDen = 100, plays = 2 } = {}) {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames, 0);
  actl.writeUInt32BE(plays, 4);
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("acTL", actl)];
  let seq = 0;
  for (let i = 0; i < frames; i += 1) {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(1, 4);
    fctl.writeUInt32BE(1, 8);
    fctl.writeUInt16BE(delayNum, 20);
    fctl.writeUInt16BE(delayDen, 22);
    parts.push(chunk("fcTL", fctl));
    const pixels = deflateSync(Buffer.from([0, i * 40, 0, 0, 255]));
    if (i === 0) parts.push(chunk("IDAT", pixels));
    else {
      const s = Buffer.alloc(4);
      s.writeUInt32BE(seq++, 0);
      parts.push(chunk("fdAT", Buffer.concat([s, pixels])));
    }
  }
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** RGBA frames of `w×h`: a square of `size` at (x, y), the rest transparent white (GPT Image's GIF background). */
function frame(w: number, h: number, box?: { x: number; y: number; size: number; rgb?: [number, number, number] }) {
  const f = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) f.set([255, 255, 255, 0], i * 4);
  if (box) {
    for (let y = box.y; y < box.y + box.size; y += 1) {
      for (let x = box.x; x < box.x + box.size; x += 1) f.set([...(box.rgb ?? [40, 60, 200]), 255], (y * w + x) * 4);
    }
  }
  return f;
}

describe("GIF structure", () => {
  test("reads the loop block and agrees with the shared reader on frames and delays", () => {
    const bytes = structuralGif(16, { delayCs: 12, width: 512, height: 512 });
    const s = M.gifStructure(bytes);
    const shared = readGifInfo(bytes);
    expect(s).toMatchObject({ width: 512, height: 512, frames: 16, loopCount: 0 });
    expect(s.delaysMs).toEqual(shared.delaysMs);
    expect(s.frames).toBe(shared.frames);
  });

  test("no NETSCAPE block reads as plays once (null)", () => {
    const bytes = structuralGif(3);
    const without = Buffer.concat([bytes.subarray(0, 19), bytes.subarray(19 + 19)]);
    expect(M.gifStructure(without).loopCount).toBe(null);
    expect(M.gifStructure(without).frames).toBe(3);
  });

  test("setGifDelays writes each frame's delay exactly; the shared reader reads them back", () => {
    const bytes = structuralGif(4, { delayCs: 12 });
    const patched = M.setGifDelays(bytes, [120, 240, 120, 360]);
    expect(readGifInfo(patched).delaysMs).toEqual([120, 240, 120, 360]);
    expect(patched.length).toBe(bytes.length);
    expect(() => M.setGifDelays(bytes, [100])).toThrow("1 delays for 4 frames");
    expect(() => M.gifStructure(Buffer.from("PNG"))).toThrow("not a GIF");
  });

  test("delays of 10 ms or less play as 100 ms, as browsers and ffmpeg show them", () => {
    expect(M.effectiveDelays([0, 10, 20, 120])).toEqual([100, 100, 20, 120]);
  });
});

describe("APNG structure", () => {
  test("reads frames, plays and delays; a still PNG is one frame", () => {
    const info = M.apngInfo(apng(5, { delayNum: 3, delayDen: 25, plays: 2 }));
    expect(info).toMatchObject({ width: 1, height: 1, animated: true, frames: 5, plays: 2, delaysMs: [120, 120, 120, 120, 120] });
    const still = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", Buffer.from([0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0])), chunk("IEND", Buffer.alloc(0))]);
    expect(M.apngInfo(still)).toMatchObject({ width: 2, height: 3, animated: false, frames: 1 });
  });

  test("setApngDelays rewrites each fcTL in ms and keeps every CRC valid", () => {
    const patched = M.setApngDelays(apng(3), [100, 333, 1500]);
    expect(M.apngInfo(patched).delaysMs).toEqual([100, 333, 1500]);
    // Every chunk's CRC still matches its type and data.
    for (let p = 8; p < patched.length;) {
      const length = patched.readUInt32BE(p);
      const crc = patched.readUInt32BE(p + 8 + length);
      expect(crc32(patched.subarray(p + 4, p + 8 + length))).toBe(crc);
      p += 12 + length;
    }
  });
});

describe("pixels", () => {
  test("still-art alpha: near-opaque → opaque, faint fog → clear, the edge kept", () => {
    const rgba = Buffer.from([10, 20, 30, 254, 10, 20, 30, 8, 10, 20, 30, 128, 10, 20, 30, 0, 10, 20, 30, 240, 10, 20, 30, 15]);
    const { rgba: out, cleared, raised } = M.cleanStillAlpha(rgba);
    expect([...out].filter((_, i) => i % 4 === 3)).toEqual([255, 0, 128, 0, 255, 0]);
    expect([...out.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect({ cleared, raised }).toEqual({ cleared: 2, raised: 2 });
  });

  test("alpha stats, coverage, box and margin", () => {
    const w = 20;
    const f = frame(w, w, { x: 5, y: 6, size: 8 });
    expect(M.coverage(f)).toBeCloseTo(64 / 400, 6);
    expect(M.alphaBox(f, w, w)).toEqual({ x: 5, y: 6, width: 8, height: 8 });
    expect(M.alphaBox(frame(w, w), w, w)).toBe(null);
    expect(M.unionBox([{ x: 5, y: 6, width: 8, height: 8 }, null, { x: 2, y: 10, width: 4, height: 9 }])).toEqual({ x: 2, y: 6, width: 11, height: 13 });
    const a = M.alphaStats([f], w, w);
    expect(a).toMatchObject({ channel: true, semi: 0, cornersClear: true, edgeWhite: 0 });
    expect(a.clear).toBeCloseTo(336 / 400, 4);
    const white = frame(w, w, { x: 5, y: 6, size: 8, rgb: [250, 250, 250] });
    expect(M.alphaStats([white], w, w).edgeWhite).toBe(1);
    expect(M.nearWhiteFraction(white)).toBe(1);
  });

  test("motion: steps, the loop seam, ground and size drift, empty frames", () => {
    const w = 32;
    const frames = [0, 2, 4, 6].map((x) => frame(w, w, { x, y: 10, size: 10 }));
    const m = M.motionStats(frames, w, w);
    expect(m.steps).toHaveLength(3);
    expect(m.seam).toBeGreaterThan(m.steps[0]);
    expect(m.seamRatio).toBeGreaterThan(1);
    expect(m.groundDrift).toBe(0);
    expect(m.sizeDrift).toBe(0);
    const bouncing = [frame(w, w, { x: 4, y: 10, size: 10 }), frame(w, w, { x: 4, y: 14, size: 10 }), frame(w, w)];
    const b = M.motionStats(bouncing, w, w);
    expect(b.groundDrift).toBe(4);
    expect(b.emptyFrames).toEqual([2]);
    expect(M.allIdentical([frames[0], Buffer.from(frames[0])])).toBe(true);
    expect(M.allIdentical(frames)).toBe(false);
  });
});

describe("timelines", () => {
  test("keepFrames selects, and names an index past the take", () => {
    expect(M.keptIndices(4, null)).toEqual([0, 1, 2, 3]);
    expect(M.keptIndices(16, [0, 3, 5])).toEqual([0, 3, 5]);
    expect(() => M.keptIndices(12, [0, 12])).toThrow("names frame 12, but the take has 12 frames (0–11)");
  });

  test("decimation keeps the loop's length", () => {
    const d = M.decimate([0, 1, 2, 3, 4], [120, 120, 120, 120, 120], 2);
    expect(d).toEqual({ indices: [0, 2, 4], delaysMs: [240, 240, 120] });
  });

  test("LINE: ≤ 20 frames, ≥ 5 frames, a loop ≤ 4 s, 1–4 plays within 4 s", () => {
    const sixteen = M.lineTiming([...Array(16).keys()], Array(16).fill(120));
    expect(sixteen).toMatchObject({ step: 1, repeats: 1, speed: 1, plays: 2, loopMs: 1920 });
    const many = M.lineTiming([...Array(24).keys()], Array(24).fill(120));
    expect(many.indices.length).toBe(12);
    expect(many.loopMs).toBe(2880);
    expect(many.plays).toBe(1);
    const few = M.lineTiming([0, 1, 2], [200, 200, 200]);
    expect(few.indices).toEqual([0, 1, 2, 0, 1, 2]);
    expect(few).toMatchObject({ repeats: 2, loopMs: 1200, plays: 3 });
    const slow = M.lineTiming([...Array(10).keys()], Array(10).fill(500));
    expect(slow.speed).toBe(0.8);
    expect(slow.loopMs).toBeLessThanOrEqual(4000);
    expect(slow.plays).toBe(1);
    // The size fit's extra decimation never goes under five frames.
    expect(M.lineTiming([...Array(8).keys()], Array(8).fill(120), { extraStep: 2 }).indices.length).toBe(8);
    expect(M.lineTiming([...Array(16).keys()], Array(16).fill(120), { extraStep: 2 }).indices.length).toBe(8);
    for (const t of [sixteen, many, few, slow]) {
      expect(t.indices.length).toBeGreaterThanOrEqual(5);
      expect(t.indices.length).toBeLessThanOrEqual(20);
      expect(t.plays * t.loopMs).toBeLessThanOrEqual(4000);
    }
  });

  test("Telegram: constant 30 fps by time, played faster past 3 s", () => {
    const t = M.constantRateTimeline([0, 1, 2, 3], [120, 120, 120, 120], { fps: 30, maxMs: 3000 });
    expect(t.frames).toBe(14);
    expect(t.speed).toBe(1);
    // Frame k shows the source frame on screen at k / 30 s.
    expect(t.order.slice(0, 5)).toEqual([0, 0, 0, 0, 1]);
    expect(t.order.at(-1)).toBe(3);
    // 120 ms does not divide 1000/30: no frame is dropped or doubled out of order.
    expect([...new Set(t.order)]).toEqual([0, 1, 2, 3]);
    const long = M.constantRateTimeline([...Array(40).keys()], Array(40).fill(100), { fps: 30, maxMs: 3000 });
    expect(long.frames).toBe(90);
    expect(long.durationMs).toBe(3000);
    expect(long.speed).toBe(0.75);
    expect(long.order.at(-1)).toBe(39);
  });
});

describe("geometry", () => {
  test("fit inside keeps the aspect, the limiting side exact", () => {
    expect(M.fitInside(512, 512, 240, 240)).toEqual({ width: 240, height: 240 });
    expect(M.fitInside(400, 480, 320, 270)).toEqual({ width: 225, height: 270 });
    expect(M.fitInside(480, 300, 320, 270)).toEqual({ width: 320, height: 200 });
  });

  test("each deliverable's chain lands on its canvas", () => {
    expect(M.geometryChain({ width: 512, height: 512 }, { kind: "pad", width: 96, height: 74 })).toMatchObject({ width: 96, height: 74 });
    expect(M.geometryChain({ width: 512, height: 512 }, { kind: "pad", width: 96, height: 74 }).chain).toContain("pad=96:74:11:0");
    const line = M.geometryChain({ width: 512, height: 512 }, { kind: "crop-fit", crop: { x: 40, y: 30, width: 400, height: 480 }, maxWidth: 320, maxHeight: 270 });
    expect(line).toMatchObject({ width: 225, height: 270 });
    expect(line.chain).toStartWith("crop=400:480:40:30,");
    expect(M.geometryChain({ width: 512, height: 512 }, { kind: "edge", edge: 512 })).toMatchObject({ width: 512, height: 512 });
    expect(M.geometryChain({ width: 600, height: 451 }, { kind: "edge", edge: 512 })).toMatchObject({ width: 512, height: 384 });
    expect(M.geometryChain({ width: 1536, height: 864 }, { kind: "cover", width: 750, height: 400 })).toMatchObject({ width: 750, height: 400 });
    // Every scale is premultiplied: GPT Image's GIFs keep white under their clear pixels.
    expect(M.geometryChain({ width: 512, height: 512 }, { kind: "pad", width: 240, height: 240 }).chain).toContain("premultiply=inplace=1,scale=240:240:flags=lanczos,unpremultiply=inplace=1");
  });
});

describe("contact layout", () => {
  test("two plate blocks (light, dark), up to eight frames a row, a label per frame", () => {
    const frames = Array.from({ length: 12 }, () => frame(10, 10, { x: 2, y: 2, size: 4 }));
    const layout = M.contactLayout(frames, 10, 10, { gap: 2 });
    expect(layout.width).toBe(8 * 10 + 9 * 2);
    expect(layout.height).toBe(2 * (2 * 10 + 3 * 2));
    expect(layout.labels).toHaveLength(24);
    expect(layout.rgb.length).toBe(layout.width * layout.height * 3);
    // A clear pixel shows the plate: light #EDEDED on top, dark #111111 below.
    expect([...layout.rgb.subarray(0, 3)]).toEqual([0xed, 0xed, 0xed]);
    const darkRow = (layout.height / 2) * layout.width * 3;
    expect([...layout.rgb.subarray(darkRow, darkRow + 3)]).toEqual([0x11, 0x11, 0x11]);
    expect(layout.labels.slice(0, 3).map((l) => l.text)).toEqual(["0", "1", "2"]);
  });

  test("a trimmed take is laid out with the take's own frame numbers, so the sheet and keepFrames speak the same numbers", () => {
    const frames = Array.from({ length: 3 }, () => frame(10, 10, { x: 2, y: 2, size: 4 }));
    const layout = M.contactLayout(frames, 10, 10, { gap: 2, numbers: [7, 9, 15] });
    expect(layout.labels.map((l) => l.text)).toEqual(["7", "9", "15", "7", "9", "15"]);
    expect(() => M.contactLayout(frames, 10, 10, { numbers: [1, 2] })).toThrow("3 frames but 2 numbers");
  });
});

describe("archive", () => {
  test("byte-identical for the same entries", () => {
    const entries = [{ name: "01.png", data: Buffer.from("a") }, { name: "main.png", data: Buffer.from("b") }];
    expect(M.archive(entries).equals(M.archive(entries))).toBe(true);
  });
});
