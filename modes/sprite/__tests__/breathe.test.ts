/**
 * breathe.mjs — a breathing idle from one still — and its CLI.
 *
 * Three layers:
 *   1. The port. A representative subset of aldegad/sprite-gen's
 *      `tests/effects/test_breathe.py` (@fbd1a08), on the same synthetic
 *      fixtures redrawn here, plus golden hashes of upstream's own Python bake
 *      of those fixtures: the whole-pixel mode must reproduce it bit for bit.
 *   2. The smooth mode's own invariants: the head block is the still's head
 *      moved by whole pixels, the soles never move, the height stays inside
 *      the depth's bound, anti-aliased alpha stays anti-aliased, and a
 *      straight diagonal edge does not step.
 *   3. `sprite-sheet.mjs breathe` as a process, and its frames through
 *      align → pack → gif → inspect (skipped without ffmpeg).
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BreatheError, DEFAULT_BREATHE_DEPTH, MAX_ROW_STRAIN, SMOOTH_CYCLE_FRAMES, TAPER,
  analyzeAnatomy, bakeBreathe, breathePhases, envelope, hasAppendage, partialAlphaShare, protect,
  rigidRows, rigidU, rowStrain, solidBox, wave, warpPixel, warpSmooth,
  type Anatomy, type RgbaImage,
} from "../skill/scripts/breathe.mjs";

// ---------------------------------------------------------------------------
// Fixtures — upstream's, redrawn pixel for pixel (their hashes are pinned).
// ---------------------------------------------------------------------------

type Rgba = [number, number, number, number];

function canvas(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function put(image: RgbaImage, x: number, y: number, c: Rgba) {
  image.data.set(c, (y * image.width + x) * 4);
}

function fill(image: RgbaImage, xs: [number, number], ys: [number, number], c: Rgba) {
  for (let y = ys[0]; y < ys[1]; y++) for (let x = xs[0]; x < xs[1]; x++) put(image, x, y, c);
}

const clone = (image: RgbaImage): RgbaImage => ({ ...image, data: Uint8Array.from(image.data) });
const sha = (...images: RgbaImage[]) => {
  const h = createHash("sha256");
  for (const image of images) h.update(image.data);
  return h.digest("hex");
};

/** Head + neck bottleneck + torso + a symmetric eye pair. */
function humanoid(): RgbaImage {
  const im = canvas(64, 96);
  const body: Rgba = [90, 60, 30, 255];
  fill(im, [22, 42], [8, 30], body);
  fill(im, [28, 36], [30, 36], body);
  fill(im, [18, 46], [36, 84], body);
  for (const x0 of [25, 35]) fill(im, [x0, x0 + 4], [14, 20], [10, 10, 12, 255]);
  return im;
}

/** Torso plus a thin wing reaching far sideways — the appendage path. */
function winged(): RgbaImage {
  const im = canvas(120, 96);
  const body: Rgba = [60, 40, 120, 255];
  fill(im, [50, 70], [10, 30], body);
  fill(im, [56, 64], [30, 34], body);
  fill(im, [46, 74], [34, 84], body);
  fill(im, [6, 114], [40, 56], body);
  return im;
}

/** A dome widening all the way down — no neck (a slime); optionally a face
 *  painted on the body, the hardest case for the rigid row. */
function dome(withFace = false): RgbaImage {
  const pad = 10;
  const im = canvas(80, 80 + 2 * pad);
  for (let y = 0; y < 80; y++) {
    const half = 4 + Math.trunc(34 * (y / 79) ** 0.6);
    fill(im, [40 - half, 40 + half], [y + pad, y + pad + 1], [40, 160, 90, 255]);
  }
  if (withFace) for (const x0 of [30, 44]) fill(im, [x0, x0 + 6], [44 + pad, 52 + pad], [8, 20, 14, 255]);
  return im;
}

/** Octopus-sized (26 px wide): light interior, 1 px black outline, narrow
 *  head over a wide body — where squeezed rows used to drop the outline. */
function smallOutlined(): RgbaImage {
  const pad = 4, w = 26, h = 30 + 2 * pad;
  const im = canvas(w, h);
  const cx = w >> 1;
  for (let y = 0; y < 30; y++) {
    const bw = y < 12 ? 10 : 21;
    fill(im, [cx - (bw >> 1), cx - (bw >> 1) + bw], [y + pad, y + pad + 1], [210, 185, 120, 255]);
  }
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && im.data[(y * w + x) * 4 + 3] !== 0;
  const edge: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue;
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) put(im, x, y, [0, 0, 0, 255]);
  return im;
}

const CFG = { depth: 0.06, breaths: 1, lag: 0.1 };

/** Upstream's `bake_breathe_sequence` over one still: one anatomy, one phase
 *  per frame, the input's canvas (the fixtures carry their own margin). */
function bakePixel(image: RgbaImage, { depth = CFG.depth, breaths = CFG.breaths, lag = CFG.lag, count = 12 } = {}, anat?: Anatomy) {
  const a = anat ?? analyzeAnatomy(image);
  return breathePhases(count, breaths).map((phase) => {
    const r = warpPixel(image, a, { depth, lag, phase });
    expect(r.clipped).toBe(0);
    return r.image;
  });
}

const pixelAt = (image: RgbaImage, x: number, y: number) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const rowsBytes = (image: RgbaImage, y0: number, rows: number) => image.data.subarray(y0 * image.width * 4, (y0 + rows) * image.width * 4);
const lumaOf = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

// ---------------------------------------------------------------------------
// 1. The port
// ---------------------------------------------------------------------------

describe("breathe.mjs — the whole-pixel port", () => {
  /**
   * Recorded 2026-09-27 by running upstream's own code
   * (sprite_gen.effects.breathe.bake_breathe_sequence @fbd1a08, CPython 3.14)
   * on the fixtures above as defined in its test_breathe.py: the fixture
   * bytes, the bake bytes of every frame, the anatomy it measured, and the
   * envelope's normalisation as the exact double CPython computed — a plain
   * float sum gets domeFace's wrong in the last bit, which is what the
   * compensated sum in breathe.mjs is there for.
   */
  const GOLDEN = {
    humanoid: {
      build: humanoid, depth: 0.06, breaths: 1, count: 12,
      norm: 1.1851541660560911,
      fixture: "eca07fa72ffb4dc37ee6a268c0cd00ede63370fa90f50fbb81bd1298038ac59b",
      bake: "cc0c43833127364ec4fc1c200f43269a712248f2d3b165b2197e22791ff2ea66",
      anatomy: { axisX: 13, neckRow: 23, neckSource: "bottleneck", rigidRow: 23, rigidSource: "neck", basisRow: 23, torsoHalf: 14, maxHalf: 14, face: { top: 6, bottom: 15 } },
    },
    winged: {
      build: winged, depth: 0.06, breaths: 1, count: 12,
      norm: 1.1851541660560911,
      fixture: "8a4bb6c7eb9d6684c0e15e2ded5e121f24ba5ec8c3a6d39c6fb4b6f87fe394a5",
      bake: "3161fcb909752a7dddc3eddae92c8dba9eb4f192d7709092b3dd630522891474",
      anatomy: { axisX: 53, neckRow: 21, neckSource: "bottleneck", rigidRow: 21, rigidSource: "neck", basisRow: 21, torsoHalf: 14, maxHalf: 54, face: null },
    },
    dome: {
      build: () => dome(false), depth: 0.06, breaths: 1, count: 12,
      norm: 1.1782945736434112,
      fixture: "c94e83955b75f5298a52693b64e85074240107e5996be057522f60acf2a2836a",
      bake: "62dc0e3df8018e298dd416429e698e9e3d13ca66f4889339e6c9178626a742f0",
      anatomy: { axisX: 37, neckRow: 4, neckSource: "shoulder-gradient", rigidRow: 4, rigidSource: "neck", basisRow: 4, torsoHalf: 27, maxHalf: 38, face: null },
    },
    domeFace: {
      build: () => dome(true), depth: 0.06, breaths: 1, count: 12,
      norm: 1.2155699322417512,
      fixture: "7e62059ea6d9278add9ae6209592c3e99dffe184b8cd964f145dbab5d3171904",
      bake: "a93fb2eae645a77a926191b3163c0ff4c6c51d381e94c9540514e0c17eda5ac7",
      anatomy: { axisX: 37, neckRow: 4, neckSource: "shoulder-gradient", rigidRow: 57, rigidSource: "face", basisRow: 57, torsoHalf: 35, maxHalf: 38, face: { top: 44, bottom: 56 } },
    },
    smallOutlined: {
      build: smallOutlined, depth: 0.08, breaths: 3, count: 24,
      norm: 1.2354738896873483,
      fixture: "ba3c4f39b3d94dcc1708da92f9713e3ae57d6ec73cd2588b6ef9307240fad105",
      bake: "841e25f15ab9cf34be02f3f12f7874acc64c8edecd0d80ce919e18e7aba6c8c7",
      anatomy: { axisX: 9, neckRow: 13, neckSource: "shoulder-gradient", rigidRow: 13, rigidSource: "neck", basisRow: 13, torsoHalf: 10, maxHalf: 11, face: null },
    },
  } as const;

  for (const [name, g] of Object.entries(GOLDEN)) {
    test(`${name}: fixture, anatomy, normalisation and every baked byte match upstream's Python`, () => {
      const im = g.build();
      expect(sha(im)).toBe(g.fixture);
      const a = analyzeAnatomy(im);
      expect({
        axisX: a.axisX, neckRow: a.neckRow, neckSource: a.neckSource, rigidRow: a.rigidRow, rigidSource: a.rigidSource,
        basisRow: a.basisRow, torsoHalf: a.torsoHalf, maxHalf: a.maxHalf, face: a.face,
      }).toEqual(g.anatomy as unknown as typeof a);
      expect(envelope(a).norm).toBe(g.norm);
      expect(sha(...bakePixel(im, { depth: g.depth, breaths: g.breaths, count: g.count }, a))).toBe(g.bake);
    });
  }

  test("the rigid region is bit-identical across frames", () => {
    for (const build of [humanoid, winged, () => dome(true)]) {
      const src = build();
      const a = analyzeAnatomy(src);
      const band = Math.trunc(Math.max(1.5, TAPER * a.height)) + 1;
      const rigidH = a.rigidRow - band;
      expect(rigidH).toBeGreaterThan(0);
      const frames = bakePixel(src, {}, a);
      const top = (f: RgbaImage) => solidBox(f)!.y0;
      const expected = Buffer.from(rowsBytes(frames[0], top(frames[0]), rigidH));
      for (const frame of frames.slice(1)) expect(Buffer.from(rowsBytes(frame, top(frame), rigidH)).equals(expected)).toBe(true);
    }
  });

  test("zero strain is byte-identical to the source; with a travelling wave phase 0 is not", () => {
    for (const build of [humanoid, winged, () => dome(false)]) {
      const src = build();
      const a = analyzeAnatomy(src);
      const rest = warpPixel(src, a, { depth: CFG.depth, lag: 0, phase: 0 }).image;
      expect(Buffer.from(rest.data).equals(Buffer.from(src.data))).toBe(true);
    }
    const src = humanoid();
    const moved = warpPixel(src, analyzeAnatomy(src), { depth: CFG.depth, lag: CFG.lag, phase: 0 }).image;
    expect(Buffer.from(moved.data).equals(Buffer.from(src.data))).toBe(false);
  });

  test("the side outline survives every phase of a small outlined sprite", () => {
    const src = smallOutlined();
    const a = analyzeAnatomy(src);
    const dropped: string[] = [];
    for (let i = 0; i < 24; i++) {
      const frame = warpPixel(src, a, { depth: 0.08, lag: CFG.lag, phase: i / 24 }).image;
      for (let y = 0; y < frame.height; y++) {
        for (let x = frame.width - 1; x >= 0; x--) {
          const p = pixelAt(frame, x, y);
          if (p[3] < 128) continue;
          if (lumaOf(p) >= 96) dropped.push(`${i}/24 y${y}`);
          break;
        }
      }
    }
    expect(dropped).toEqual([]);
  });

  test("no dark 1 px protrusion appears that the source did not have", () => {
    const protrusions = (frame: RgbaImage) => {
      const lo = new Map<number, number>(), hi = new Map<number, number>();
      for (let y = 0; y < frame.height; y++) {
        let l = -1, r = -1;
        for (let x = 0; x < frame.width; x++) if (pixelAt(frame, x, y)[3] >= 128) { if (l < 0) l = x; r = x; }
        if (l >= 0) { lo.set(y, l); hi.set(y, r); }
      }
      const dark = (x: number, y: number) => { const p = pixelAt(frame, x, y); return p[3] >= 128 && lumaOf(p) < 96; };
      let n = 0;
      for (const [y, m] of lo) if (lo.has(y - 1) && lo.has(y + 1) && m < lo.get(y - 1)! && m < lo.get(y + 1)! && dark(m, y)) n++;
      for (const [y, r] of hi) if (hi.has(y - 1) && hi.has(y + 1) && r > hi.get(y - 1)! && r > hi.get(y + 1)! && dark(r, y)) n++;
      return n;
    };
    const src = smallOutlined();
    const a = analyzeAnatomy(src);
    const base = protrusions(src);
    for (let i = 0; i < 24; i++) {
      expect(protrusions(warpPixel(src, a, { depth: 0.08, lag: CFG.lag, phase: i / 24 }).image)).toBeLessThanOrEqual(base);
    }
  });

  test("the body axis column stays in place and unbroken", () => {
    const src = humanoid();
    const a = analyzeAnatomy(src);
    const axisCol = a.box.x0 + a.axisX;
    for (const frame of bakePixel(src, {}, a)) {
      const b = solidBox(frame)!;
      for (let y = b.y0; y < b.y1; y++) expect(pixelAt(frame, axisCol, y)[3]).toBeGreaterThanOrEqual(128);
      expect(b.x0 <= axisCol && axisCol < b.x1).toBe(true);
    }
  });

  test("the feet stay planted, the loop keeps its length, the body really moves", () => {
    const src = humanoid();
    const baseline = solidBox(src)!.y1;
    const frames = bakePixel(src, { count: 12 });
    expect(frames).toHaveLength(12);
    for (const frame of frames) expect(solidBox(frame)!.y1).toBe(baseline);
    expect(new Set(frames.map((f) => solidBox(f)!.y1 - solidBox(f)!.y0)).size).toBeGreaterThan(1);
  });

  test("an appendage is pushed, not stretched", () => {
    const src = winged();
    const a = analyzeAnatomy(src);
    expect(hasAppendage(a)).toBe(true);
    const spans = bakePixel(src, {}, a).map((f) => solidBox(f)!.x1 - solidBox(f)!.x0);
    expect(Math.max(...spans) - Math.min(...spans)).toBeLessThanOrEqual(2 * Math.round(CFG.depth * a.height) + 2);
  });

  test("the amplitude is normalised to the neck only when the bottleneck is real", () => {
    const real = analyzeAnatomy(humanoid());
    expect(real.neckSource).toBe("bottleneck");
    expect(real.basisRow).toBe(real.neckRow);
    const slime = analyzeAnatomy(dome());
    expect(slime.neckSource).toBe("shoulder-gradient");
    expect(slime.basisRow).toBe(slime.rigidRow);
    expect(slime.warnings.some((w) => w.startsWith("neck-absent"))).toBe(true);
    expect(rowStrain(slime, CFG.depth)).toBeLessThanOrEqual(MAX_ROW_STRAIN);
  });

  test("a depth over the per-row strain cap is refused, not clamped", () => {
    const src = humanoid();
    const a = analyzeAnatomy(src);
    // Push the rigid row down until the band is short enough to overstrain.
    let rigid = a.rigidRow;
    while (rowStrain(analyzeAnatomy(src, { rigidRow: rigid }), 0.2) <= MAX_ROW_STRAIN) rigid += 4;
    expect(() => bakeBreathe(src, { frames: 12, depth: 0.2, mode: "pixel", rigidY: a.box.y0 + rigid }))
      .toThrow(/over the 0.25 cap/);
  });

  test("manual overrides replace detection, are named in the warnings, and out-of-range ones are refused", () => {
    const src = winged();
    const auto = analyzeAnatomy(src);
    const manual = analyzeAnatomy(src, { axisX: auto.axisX + 3, torsoHalf: 5, rigidRow: auto.rigidRow + 6 });
    expect(manual.axisX).toBe(auto.axisX + 3);
    expect(manual.torsoHalf).toBe(5);
    expect(manual.torsoSource).toBe("manual");
    expect(manual.rigidRow).toBe(auto.rigidRow + 6);
    expect(manual.rigidSource).toBe("manual");
    for (const prefix of ["axis-x-override", "torso-half-override", "rigid-row-override"]) {
      expect(manual.warnings.some((w) => w.startsWith(prefix))).toBe(true);
    }
    expect(() => analyzeAnatomy(src, { axisX: auto.width + 10 })).toThrow(BreatheError);
    expect(() => analyzeAnatomy(src, { torsoHalf: 0 })).toThrow(BreatheError);
    expect(() => analyzeAnatomy(src, { rigidRow: 0 })).toThrow(BreatheError);

    // A narrower torso really changes the bake.
    const wide = bakePixel(src, { depth: 0.15 });
    const narrow = bakePixel(src, { depth: 0.15 }, analyzeAnatomy(src, { torsoHalf: 4 }));
    expect(wide.some((f, i) => !Buffer.from(f.data).equals(Buffer.from(narrow[i].data)))).toBe(true);
  });

  test("a manual torso band anchors the protection to the band: outside it is pushed, not stretched", () => {
    const src = humanoid();
    const auto = analyzeAnatomy(src);
    expect(hasAppendage(auto)).toBe(false);
    const manual = analyzeAnatomy(src, { torsoHalf: 6 });
    const p = protect(manual);
    expect(p(manual.axisX)).toBe(0);
    expect(p(manual.axisX + 5)).toBe(0);
    expect(p(manual.axisX + 9)).toBe(1);
    expect(protect(auto)(auto.axisX + 9)).toBe(0);
    const swing = (a: Anatomy) => {
      const spans = bakePixel(src, { depth: 0.1 }, a).map((f) => solidBox(f)!.x1 - solidBox(f)!.x0);
      return Math.max(...spans) - Math.min(...spans);
    };
    const narrow = swing(analyzeAnatomy(src, { torsoHalf: 4 }));
    expect(narrow).toBeLessThanOrEqual(1);
    expect(narrow).toBeLessThan(swing(auto));
  });

  test("the phase pattern fits whole breaths, and equal phases are equal doubles and equal frames", () => {
    for (const [n, b] of [[12, 1], [12, 2], [10, 3], [7, 2]]) {
      const pattern = breathePhases(n, b);
      expect(pattern).toHaveLength(n);
      expect(pattern[0]).toBe(0);
      expect(pattern.every((p) => p >= 0 && p < 1)).toBe(true);
    }
    for (const [n, b] of [[18, 3], [12, 2], [12, 4], [20, 5]]) {
      const exact = new Set(Array.from({ length: n }, (_, i) => (i * b) % n));
      expect(new Set(breathePhases(n, b)).size).toBe(exact.size);
    }
    const src = humanoid();
    const phases = breathePhases(18, 3);
    const frames = bakePixel(src, { breaths: 3, count: 18 });
    const byPhase = new Map<number, string>();
    frames.forEach((f, i) => {
      const h = sha(f);
      if (byPhase.has(phases[i])) expect(byPhase.get(phases[i])).toBe(h);
      byPhase.set(phases[i], h);
    });
    expect(byPhase.size).toBe(6);
  });

  test("the wave closes the loop; the envelope is zero above the rigid boundary and at the soles", () => {
    expect(wave(0)).toBeCloseTo(wave(1), 9);
    const a = analyzeAnatomy(humanoid());
    const { env } = envelope(a);
    const band = Math.max(1.5, TAPER * a.height) / a.height;
    expect(env(Math.min(1, rigidU(a) + band + 1e-6))).toBeCloseTo(0, 12);
    expect(env(0)).toBeCloseTo(0, 12);
  });

  test("a face on the body pushes the boundary below the face, and the face holds still", () => {
    const slime = dome(true);
    const a = analyzeAnatomy(slime);
    expect(a.neckSource).toBe("shoulder-gradient");
    expect(a.face).not.toBeNull();
    expect(a.rigidRow).toBeGreaterThan(a.face!.top);
    expect(a.rigidSource).toBe("face");
    const band = Math.trunc(Math.max(1.5, TAPER * a.height)) + 1;
    const rigidH = a.rigidRow - band;
    expect(rigidH).toBeGreaterThan(51);
    const frames = bakePixel(slime, {}, a);
    const expected = Buffer.from(rowsBytes(frames[0], solidBox(frames[0])!.y0, rigidH));
    for (const f of frames.slice(1)) expect(Buffer.from(rowsBytes(f, solidBox(f)!.y0, rigidH)).equals(expected)).toBe(true);
  });

  test("face detection ignores one eye paired with a mouth on the axis", () => {
    const im = dome(true);
    fill(im, [37, 44], [66, 72], [8, 20, 14, 255]);
    const a = analyzeAnatomy(im);
    expect(a.face).not.toBeNull();
    expect(a.face!.top).toBeLessThan(56);
  });

  test("every output pixel is a source pixel: nothing is interpolated", () => {
    const src = winged();
    const palette = new Set<string>();
    for (let k = 0; k < src.data.length; k += 4) palette.add(Array.from(src.data.subarray(k, k + 4)).join(","));
    palette.add("0,0,0,0");
    for (const frame of bakePixel(src, { depth: 0.12 })) {
      for (let k = 0; k < frame.data.length; k += 4) expect(palette.has(Array.from(frame.data.subarray(k, k + 4)).join(","))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. smooth
// ---------------------------------------------------------------------------

/**
 * An anti-aliased character drawn by supersampling (4x4 per pixel): an
 * elliptical head with a darker band, a neck, a torso whose sides are
 * straight diagonals, and a hem stripe. Every edge carries partial alpha.
 */
function antialiased(): RgbaImage {
  const W = 120, H = 170;
  const im = canvas(W, H);
  const shapes: Array<{ inside: (x: number, y: number) => boolean; c: [number, number, number] }> = [
    { inside: (x, y) => ((x - 60) / 26) ** 2 + ((y - 42) / 28) ** 2 <= 1, c: [236, 222, 200] },
    { inside: (x, y) => ((x - 60) / 26) ** 2 + ((y - 42) / 28) ** 2 <= 1 && y > 38 && y < 44, c: [60, 40, 40] },
    { inside: (x, y) => x >= 53 && x <= 67 && y >= 68 && y <= 80, c: [236, 222, 200] },
    { inside: (x, y) => { const t = (y - 78) / 70; const half = 20 + 20 * t; return y >= 78 && y <= 148 && Math.abs(x - 60) <= half; }, c: [220, 200, 170] },
    { inside: (x, y) => { const t = (y - 78) / 70; const half = 20 + 20 * t; return y >= 136 && y <= 142 && Math.abs(x - 60) <= half; }, c: [150, 50, 40] },
    { inside: (x, y) => y > 148 && y <= 160 && ((x >= 44 && x <= 54) || (x >= 66 && x <= 76)), c: [90, 60, 40] },
  ];
  const S = 4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
          let hit: [number, number, number] | null = null;
          for (const s of shapes) if (s.inside(px, py)) hit = s.c;
          if (!hit) continue;
          a++; r += hit[0]; g += hit[1]; b += hit[2];
        }
      }
      if (!a) continue;
      put(im, x, y, [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((255 * a) / (S * S))]);
    }
  }
  return im;
}

/** Sub-pixel position of the left edge of row y: the transparent run left of
 *  the axis, counted in coverage. A straight edge moves linearly with y. */
function leftEdge(frame: RgbaImage, y: number, axis: number) {
  let covered = 0;
  for (let x = 0; x < axis; x++) covered += frame.data[(y * frame.width + x) * 4 + 3] / 255;
  return axis - covered;
}

describe("breathe.mjs — smooth", () => {
  const src = antialiased();
  const a = analyzeAnatomy(src);
  const depth = 0.06;

  test("the fixture is what the tests assume: anti-aliased, with a neck", () => {
    expect(partialAlphaShare(src)).toBeGreaterThan(0.02);
    expect(a.neckSource).toBe("bottleneck");
    expect(rigidRows(a)).toBeGreaterThan(40);
  });

  test("zero strain returns the still, pixel for pixel", () => {
    const rest = warpSmooth(src, a, { depth, lag: 0, phase: 0 }).image;
    expect(Buffer.from(rest.data).equals(Buffer.from(src.data))).toBe(true);
  });

  const bake = bakeBreathe(src, { frames: 16, depth, mode: "smooth" });

  test("the head block is the still's head moved by whole pixels, in every frame", () => {
    expect(bake.rigidRows).toBe(rigidRows(a));
    for (const f of bake.perFrame) {
      expect(Number.isInteger(f.headOffset)).toBe(true);
      expect(f.headDiffPx).toBe(0);
    }
    expect(new Set(bake.perFrame.map((f) => f.headOffset)).size).toBeGreaterThan(2);
  });

  test("the soles and everything below them never move", () => {
    const { grew } = bake.canvas;
    const soles = a.box.y1 - 1;
    const expected = Buffer.from(src.data.subarray(soles * src.width * 4, src.height * src.width * 4));
    for (const frame of bake.frames) {
      const got = Buffer.alloc(expected.length);
      for (let y = soles; y < src.height; y++) {
        const from = ((y + grew.top) * frame.width + grew.left) * 4;
        got.set(frame.data.subarray(from, from + src.width * 4), (y - soles) * src.width * 4);
      }
      expect(got.equals(expected)).toBe(true);
    }
  });

  test("the height stays inside the depth's bound: depth x (height - neck), plus rounding", () => {
    const bound = Math.ceil(depth * (a.height - a.basisRow)) + 1;
    for (const f of bake.perFrame) expect(Math.abs(f.height - a.height)).toBeLessThanOrEqual(bound);
    const heights = bake.perFrame.map((f) => f.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThanOrEqual(3);
  });

  test("alpha stays anti-aliased and the body stays solid", () => {
    const share = partialAlphaShare(src);
    const mass = (im: RgbaImage) => { let m = 0; for (let k = 3; k < im.data.length; k += 4) m += im.data[k]; return m; };
    const srcMass = mass(src);
    for (const frame of bake.frames) {
      // Not binarised (the share would collapse) and not a blur (it would
      // explode). It does rise: a hard edge moved by a fraction of a pixel
      // becomes a partly covered column — its sub-pixel position.
      const s = partialAlphaShare(frame);
      expect(s).toBeGreaterThan(share * 0.5);
      expect(s).toBeLessThan(share * 3);
      // Area changes by the stretch and nothing else: within 3x the peak strain.
      expect(Math.abs(mass(frame) / srcMass - 1)).toBeLessThan(3 * bake.strain);
      // No holes or seams: the axis column stays opaque from under the crown
      // to well above the hem (y 148, between the legs below it), through
      // the head, the neck taper and the whole stretched band.
      const axis = a.box.x0 + a.axisX + bake.canvas.grew.left;
      const b = solidBox(frame)!;
      for (let y = b.y0 + 1; y < 140; y++) expect(frame.data[(y * frame.width + axis) * 4 + 3]).toBe(255);
    }
  });

  test("a straight diagonal edge stays straight — pixel mode steps, smooth does not", () => {
    const phase = 0.25;
    const axis = a.box.x0 + a.axisX;
    const bumpiness = (frame: RgbaImage, headOffset: number) => {
      // The torso's diagonal sides, clear of the neck taper and the foot ramp,
      // followed where they now sit in the frame.
      const from = a.box.y0 + a.rigidRow + 12 + headOffset;
      const to = 148 - 20;
      let worst = 0;
      for (let y = from + 1; y < to - 1; y++) {
        const d2 = leftEdge(frame, y + 1, axis) - 2 * leftEdge(frame, y, axis) + leftEdge(frame, y - 1, axis);
        worst = Math.max(worst, Math.abs(d2));
      }
      return worst;
    };
    const smooth = warpSmooth(src, a, { depth, lag: 0.1, phase });
    const pixel = warpPixel(src, a, { depth, lag: 0.1, phase });
    const sourceBump = bumpiness(src, 0);
    expect(bumpiness(smooth.image, smooth.headOffset)).toBeLessThan(sourceBump + 0.1);
    expect(bumpiness(pixel.image, pixel.headOffset)).toBeGreaterThan(sourceBump + 0.15);
  });

  test("the canvas grows instead of clipping, and says by how much", () => {
    // Crop the still to its ink: no room at all above the head or beside the body.
    const ink = solidBox(src, 1)!;
    const tight = canvas(ink.x1 - ink.x0, ink.y1 - ink.y0);
    for (let y = 0; y < tight.height; y++) {
      tight.data.set(src.data.subarray(((ink.y0 + y) * src.width + ink.x0) * 4, ((ink.y0 + y) * src.width + ink.x1) * 4), y * tight.width * 4);
    }
    const grown = bakeBreathe(tight, { frames: 12, depth, mode: "smooth" });
    expect(grown.canvas.grew.top).toBeGreaterThan(0);
    expect(grown.canvas.grew.bottom).toBe(0);
    expect(grown.canvas.height).toBe(tight.height + grown.canvas.grew.top);
    for (const f of grown.perFrame) expect(f.headDiffPx).toBe(0);
    const pixel = bakeBreathe(tight, { frames: 12, depth, mode: "pixel" });
    expect(pixel.canvas.grew.top).toBeGreaterThan(0);
  });

  test("a faint speck far from the body rides with the box edge instead of being stretched off the canvas (R2-3)", () => {
    // A 1200 px wide still, the body at x 600, a speck of alpha 60 at x 5.
    // Stretched about the axis with the body, the speck moved 600·g: out of
    // the working canvas at depth 0.1 ("internal: smooth warp left the
    // working canvas"), 27 px frame to frame at 0.05.
    const wide = canvas(1200, 200);
    const paint = (x: number, y: number, c: number[]) => wide.data.set(c, (y * wide.width + x) * 4);
    for (let y = 20; y < 180; y++) {
      const hw = y < 60 ? 12 : y < 66 ? 5 : 20;
      for (let x = 600 - hw; x < 600 + hw; x++) paint(x, y, [200, 150, 100, 255]);
    }
    paint(5, 120, [255, 255, 255, 60]);
    for (const d of [0.05, 0.1, 0.2]) {
      const out = bakeBreathe(wide, { frames: 12, depth: d, mode: "smooth" });
      expect({ d, left: out.canvas.grew.left, right: out.canvas.grew.right }).toEqual({ d, left: 0, right: 0 });
      for (const frame of out.frames) {
        // The speck moves only as far as the body's edge beside it does:
        // half-width 20 × a row strain up to 0.23 at depth 0.2, plus rounding.
        let xs: number[] = [];
        for (let y = 0; y < frame.height; y++) {
          for (let x = 0; x < 100; x++) if (frame.data[(y * frame.width + x) * 4 + 3]) xs.push(x);
        }
        expect({ d, near: xs.length > 0 && Math.max(...xs.map((x) => Math.abs(x - 5))) <= Math.ceil(20 * rowStrain(analyzeAnatomy(wide), d)) + 1 }).toEqual({ d, near: true });
      }
    }
  });

  test("a breath whose lift rounds to nothing is said, with the depth where the head starts to move (R2 nit)", () => {
    // 32 px of character: at 0.02 the lift peaks at 0.44 px and every frame
    // keeps the head where it was; at 0.03 it moves.
    const tiny = canvas(24, 40);
    for (let y = 4; y < 36; y++) {
      const hw = y < 14 ? 5 : y < 16 ? 2 : 8;
      for (let x = 12 - hw; x < 12 + hw; x++) tiny.data.set([200, 100, 50, x === 12 - hw || x === 12 + hw - 1 ? 128 : 255], (y * 24 + x) * 4);
    }
    const still = bakeBreathe(tiny, { frames: 12, depth: 0.02, mode: "smooth" });
    expect(still.perFrame.every((f) => f.headOffset === 0)).toBe(true);
    expect(still.warnings.filter((w) => w.startsWith("the head never moves"))).toEqual([
      "the head never moves: at depth 0.02 this 32 px tall character lifts by 0.44 px at most, which rounds to 0 — the frames only widen and narrow. Raise --depth (the head starts to move at about 0.023) or breathe a larger still",
    ]);
    const moving = bakeBreathe(tiny, { frames: 12, depth: 0.03, mode: "smooth" });
    expect(moving.warnings.some((w) => w.startsWith("the head never moves"))).toBe(false);
  });

  test("overrides are reported in the still's pixel coordinates, the ones the CLI takes", () => {
    const { x0, y0 } = a.box;
    const baked = bakeBreathe(src, { frames: 12, depth, mode: "smooth", rigidY: y0 + a.rigidRow + 4, axisX: x0 + a.axisX + 1, torsoHalf: 12 });
    expect(baked.anatomy.rigidRow).toBe(a.rigidRow + 4);
    expect(baked.anatomy.axisX).toBe(a.axisX + 1);
    expect(baked.warnings).toContain(`rigid-row-override: detected y=${y0 + a.rigidRow} -> manual y=${y0 + a.rigidRow + 4}`);
    expect(baked.warnings).toContain(`axis-x-override: detected x=${x0 + a.axisX} -> manual x=${x0 + a.axisX + 1}`);
    expect(baked.warnings).toContain(`torso-half-override: detected ${a.torsoHalf}px -> manual 12px`);
  });

  test("pixel mode on anti-aliased art says so", () => {
    const pixel = bakeBreathe(src, { frames: 12, depth, mode: "pixel" });
    expect(pixel.warnings.some((w) => w.includes("anti-aliased") && w.includes("--mode smooth"))).toBe(true);
    expect(bake.warnings.some((w) => w.includes("anti-aliased"))).toBe(false);
  });

  test("too few frames a breath is a warning; bad inputs are refused", () => {
    const short = bakeBreathe(src, { frames: 4, depth, mode: "smooth" });
    expect(short.warnings.some((w) => w.includes(`under ${SMOOTH_CYCLE_FRAMES} a breath`))).toBe(true);
    expect(() => bakeBreathe(src, { frames: 1, depth, mode: "smooth" })).toThrow(BreatheError);
    expect(() => bakeBreathe(src, { frames: 12, depth: 0.5, mode: "smooth" })).toThrow(/depth/);
    expect(() => bakeBreathe(src, { frames: 12, depth, mode: "blur" as never })).toThrow(/mode/);
    expect(() => bakeBreathe(src, { frames: 12, depth, mode: "smooth", rigidY: 0 })).toThrow(/rigid-row/);
    expect(() => bakeBreathe(canvas(20, 20), { frames: 12, depth, mode: "smooth" })).toThrow(/no solid content/);
  });

  test("a prop beside the body that crosses the rigid row is named, with the row that keeps it whole", () => {
    const im = clone(src);
    // A lantern floating beside the head, hanging below the neck.
    fill(im, [100, 112], [50, 96], [240, 200, 120, 255]);
    const baked = bakeBreathe(im, { frames: 12, depth: DEFAULT_BREATHE_DEPTH, mode: "smooth" });
    expect(baked.straddle).not.toBeNull();
    expect(baked.straddle!.bottom).toBe(95);
    expect(baked.warnings.some((w) => w.includes("--rigid-row 96"))).toBe(true);
    const whole = bakeBreathe(im, { frames: 12, depth: DEFAULT_BREATHE_DEPTH, mode: "smooth", rigidY: 96 });
    expect(whole.straddle).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The CLI
// ---------------------------------------------------------------------------

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) modes/sprite breathe CLI — ffmpeg/ffprobe not on PATH");

function run(cwd: string, ...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function writePng(path: string, image: RgbaImage) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`,
    "-i", "-", "-frames:v", "1", "-pix_fmt", "rgba", path], { input: image.data });
  if (r.status !== 0) throw new Error(`could not write ${path}: ${r.stderr}`);
}

function readPng(path: string): RgbaImage {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  const [width, height] = String(probe.stdout).trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 28 });
  return { width, height, data: new Uint8Array(r.stdout) };
}

describe.skipIf(!HAS_FFMPEG)("sprite-sheet.mjs breathe", () => {
  const root = mkdtempSync(join(tmpdir(), "breathe-cli-"));
  const still = join(root, "still.png");
  writePng(still, antialiased());

  test("writes NN.png frames, reports the anatomy in the still's coordinates, and keeps the head", () => {
    const out = join(root, "a", "cells");
    const r = run(root, "breathe", still, "--out", out, "--mode", "smooth", "--frames", "12", "--depth", "0.04", "--json");
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(readdirSync(out).filter((n) => /^\d\d\.png$/.test(n)).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, "0")}.png`));
    const a = analyzeAnatomy(antialiased());
    expect(report.anatomy.rigidY).toBe(a.box.y0 + a.rigidRow);
    expect(report.anatomy.axisX).toBe(a.box.x0 + a.axisX);
    expect(report.anatomy.neckSource).toBe("bottleneck");
    expect(report.mode).toBe("smooth");
    expect(report.modeFrom).toBe("--mode");
    expect(report.headIdenticalFrames).toBe(12);
    expect(report.perFrame).toHaveLength(12);
    const first = readPng(join(out, "00.png"));
    expect([first.width, first.height]).toEqual([report.canvas.width, report.canvas.height]);
    // The human form names the numbers to check against the still.
    const human = run(root, "breathe", still, "--out", out, "--mode", "smooth", "--frames", "12");
    expect(human.out).toContain(`rigid y=${a.box.y0 + a.rigidRow}`);
    expect(human.out).toContain("head identical to the still in 12/12 frames");
  }, 30_000);

  test("the frames go through align, pack, gif and inspect like any other", () => {
    const motion = join(root, "chain");
    const cells = join(motion, "cells");
    const frames = join(motion, "frames");
    expect(run(root, "breathe", still, "--out", cells, "--mode", "smooth", "--frames", "12", "--json").code).toBe(0);
    expect(run(root, "align", cells, "--out", frames, "--x-from", "cell", "--json").code).toBe(0);
    expect(run(root, "pack", frames, "--out", join(motion, "sheet.png"), "--atlas", join(motion, "atlas.json"), "--name", "breathe", "--fps", "8", "--loop", "--json").code).toBe(0);
    expect(run(root, "gif", frames, "--out", join(motion, "preview.gif"), "--fps", "8", "--loop", "--json").code).toBe(0);
    const inspect = run(root, "inspect", motion, "--json");
    expect(inspect.code).toBe(0);
    const report = JSON.parse(inspect.out);
    expect(report.frameCount).toBe(12);
    expect(report.anchorDrift.y).toBe(0);
    expect(report.bodyDrift).toBeLessThan(0.5);
  }, 30_000);

  test("the head's extremes are named in the run, and the still's warnings survive a re-inspect (A2/A3, R1-5)", () => {
    const motion = join(root, "idle");
    // The still cropped hard at the top: the character touches the edge,
    // which the detector says and a re-inspect has no still to see again.
    const src = antialiased();
    const box = solidBox(src, 1)!;
    const cut = canvas(src.width, src.height - box.y0);
    cut.data.set(src.data.subarray(box.y0 * src.width * 4));
    const cropped = join(root, "cropped.png");
    writePng(cropped, cut);
    const r = run(root, "breathe", cropped, "--out", motion, "--name", "idle", "--mode", "smooth", "--frames", "12", "--depth", "0.04", "--json");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    const offsets = out.perFrame.map((f: { headOffset: number }) => f.headOffset);
    const min = Math.min(...offsets), max = Math.max(...offsets);
    const at = (v: number) => out.perFrame.filter((f: { headOffset: number }) => f.headOffset === v).map((f: { index: number }) => f.index);
    const summary = { min, max, travel: max - min, highest: at(min), lowest: at(max) };
    expect(summary.travel).toBeGreaterThan(0);
    expect(out.headOffset).toEqual(summary);
    expect(out.breathe.headOffset).toEqual(summary);
    const record = JSON.parse(readFileSync(join(motion, "cells", "breathe.json"), "utf-8"));
    expect(record.headOffset).toEqual(summary);
    expect(record.perFrame.map((f: { headOffset: number }) => f.headOffset)).toEqual(offsets);
    const edge = (w: string) => w.startsWith("the character touches the top edge of the still");
    expect(out.inspect.warnings.some(edge)).toBe(true);
    expect(record.warnings.some(edge)).toBe(true);
    const again = run(root, "inspect", motion, "--json");
    expect(again.code).toBe(0);
    expect(JSON.parse(again.out).warnings.some(edge)).toBe(true);
    // The human line says it the way it is repeated to a person.
    const human = run(root, "breathe", cropped, "--out", join(root, "idle-h", "cells"), "--mode", "smooth", "--frames", "12", "--depth", "0.04");
    expect(human.out).toContain(`(travel ${summary.travel}px: highest in frame ${summary.highest.join(", ")}, lowest in ${summary.lowest.join(", ")})`);
  }, 60_000);

  test("with no --mode, the character's style decides; with no character it is required", () => {
    const bare = run(root, "breathe", still, "--out", join(root, "bare", "cells"));
    expect(bare.code).toBe(1);
    expect(bare.err).toMatch(/ERROR: .*--mode is required/);

    for (const [style, mode] of [["Chunky 16-bit pixel art, 3px outline", "pixel"], ["Soft painted anime, no outline", "smooth"]]) {
      const character = join(root, `char-${mode}`);
      mkdirSync(join(character, "motions"), { recursive: true });
      writeFileSync(join(character, "project.json"), JSON.stringify({ sprite: { character: { name: "T", style }, motions: [] } }));
      const r = run(root, "breathe", still, "--out", join(character, "motions", "breathe", "cells"), "--frames", "12", "--json");
      expect(r.code).toBe(0);
      const report = JSON.parse(r.out);
      expect({ mode: report.mode, modeFrom: report.modeFrom, dir: report.character.dir }).toEqual({ mode, modeFrom: "character.style", dir: character });
    }
  }, 30_000);

  test("refuses a still that lives in --out, a strain past the cap, and a bad mode — with nothing destroyed", () => {
    const dir = join(root, "self");
    mkdirSync(dir, { recursive: true });
    const inside = join(dir, "00.png");
    writePng(inside, antialiased());
    const self = run(root, "breathe", inside, "--out", dir, "--mode", "smooth");
    expect(self.code).toBe(1);
    expect(self.err).toContain("rewrites");
    expect(existsSync(inside)).toBe(true);

    const a = analyzeAnatomy(antialiased());
    const low = a.box.y0 + Math.trunc(a.height * 0.85);
    const strained = run(root, "breathe", still, "--out", join(root, "strained"), "--mode", "smooth", "--depth", "0.2", "--rigid-row", String(low));
    expect(strained.code).toBe(1);
    expect(strained.err).toMatch(/ERROR: breathe: depth 0.2 strains one row/);

    const bad = run(root, "breathe", still, "--out", join(root, "bad"), "--mode", "blur");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("--mode: expected smooth or pixel");
  }, 30_000);

  test("cleanup", () => {
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });
});

