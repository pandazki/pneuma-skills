/**
 * pixel-lattice.mjs — the pixel-art lattice, pinned as a module.
 *
 * The first half is aldegad/sprite-gen's own ground-truth suite, ported
 * (tests/frames/test_pitch_ground_truth.py, test_sliver_guard.py,
 * test_pitch_runlen_crosscheck.py and curate/test_pixel_snap.py @fbd1a08).
 * The fixtures are drawn exactly as upstream draws them — CPython's Mersenne
 * Twister and Pillow's NEAREST resize, reproduced in
 * `fixtures/pixel/lattice-art.mjs` — so every assertion, including the ones
 * whose premise is "this fixture makes the detector fail", runs on the same
 * pixels it did upstream.
 *
 * Pure computation, no ffmpeg: this file runs everywhere the routine suite
 * does. The CLI half (`pixel`, `run --pixel`, align and inspect on pixel
 * frames) is at the bottom, gated on ffmpeg.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PyRandom, PALETTE, blank, crop, getPixel, logicalArt, mismatch, noiseImage, paste, setPixel,
  upscaleBy, upscaledAxes, upscaledFractional,
} from "./fixtures/pixel/lattice-art.mjs";
import {
  alphaBbox, applyPalette, bestPhase, buildSharedPalette, consensusPitch, crosscheckPitchRunlen, cropImage,
  detectPixelGrid, detectPixelPitch, dominantBlockColor, enforceOutline, estimatePixelGridRunlen, gridEdges,
  latticeCheck, latticeFrames, refineEdgesToBoundaries, resolveFramePitch, snapGrid, solidBbox, upscale,
  type RgbaImage,
} from "../skill/scripts/pixel-lattice.mjs";

/** Upstream `grid_snap_downscale(image, pitch, phase=…)`: cut at the given
 *  phase, no boundary refinement; `detail_bias` defaults to off there. */
function gridSnapDownscale(image: RgbaImage, pitch: { x: number; y: number }, phase: { x: number; y: number }, detailBias = false) {
  return snapGrid(image, pitch, phase, { refine: false, detailBias }).logical;
}

/** Upstream `tighten_components`: crop to the solid-alpha bbox. */
function tighten(image: RgbaImage) {
  const box = solidBbox(image);
  return box ? cropImage(image, box.x, box.y, box.w, box.h) : image;
}

describe("fixtures reproduce upstream's pixels", () => {
  test("PyRandom is CPython's random.Random", () => {
    // Reference values printed by CPython 3.14.
    const r = new PyRandom(7);
    expect([r.random(), r.random(), r.random()]).toEqual([0.32383276483316237, 0.15084917392450192, 0.6509344730398537]);
    expect([r.randrange(30, 220), r.randrange(30, 220), r.randrange(30, 220)]).toEqual([48, 167, 54]);
    const art = logicalArt();
    const firstRow = Array.from({ length: 24 }, (_, x) => {
      const [r0, g0, b0] = getPixel(art, x, 0);
      return PALETTE.findIndex(([r1, g1, b1]) => r0 === r1 && g0 === g1 && b0 === b1);
    });
    expect(firstRow).toEqual([3, 4, 3, 3, 4, 4, 1, 1, 4, 3, 5, 4, 1, 0, 3, 2, 1, 0, 4, 5, 5, 0, 4, 3]);
  });
});

describe("pitch ground truth (test_pitch_ground_truth.py)", () => {
  const art = logicalArt();

  test("an integer pitch is detected exactly", () => {
    for (const k of [4, 6, 8, 10, 12, 14, 16, 17, 20, 24, 32]) {
      expect(detectPixelPitch(upscaleBy(art, k))).toBe(k);
    }
  });

  test("a divisor is not preferred over the true pitch (k=12 once returned 6)", () => {
    expect(detectPixelPitch(upscaleBy(art, 12))).toBe(12);
  });

  test("an input with no grid falls back to 1, observably", () => {
    expect(detectPixelPitch(noiseImage(200, 200, 3))).toBe(1);
  });

  for (const scale of [12.0, 14.35, 16.0, 16.2, 17.24, 20.0, 23.7]) {
    test(`a fractional pitch ${scale} round-trips to the original logical art`, () => {
      const upscaled = upscaledFractional(art, scale);
      const { pitch, phase } = detectPixelGrid(upscaled);
      const snapped = gridSnapDownscale(upscaled, pitch, phase);
      expect([snapped.width, snapped.height]).toEqual([art.width, art.height]);
      expect(Math.abs(pitch.x - scale)).toBeLessThan(0.1);
      expect(Math.abs(pitch.y - scale)).toBeLessThan(0.1);
      // Block boundaries fall mid-pixel at a fractional scale: 1 % colour slack.
      expect(mismatch(snapped, art)).toBeLessThanOrEqual(Math.floor((art.width * art.height) / 100));
    });
  }

  test("an integer pitch still snaps exactly", () => {
    for (const scale of [12, 16, 20]) {
      const upscaled = upscaledFractional(art, scale);
      const { pitch, phase } = detectPixelGrid(upscaled);
      const snapped = gridSnapDownscale(upscaled, pitch, phase);
      expect([snapped.width, snapped.height]).toEqual([art.width, art.height]);
      expect(mismatch(snapped, art)).toBe(0);
    }
  });

  for (const fringe of [1, 7, 14, 20]) {
    test(`a bbox that is not a whole number of blocks (+${fringe}px) does not stretch the grid`, () => {
      // v1.56.2: dividing the length evenly stretched every cell by 0.52 px.
      const small = logicalArt(24, 30);
      const k = 31;
      const upscaled = upscaleBy(small, k);
      const padded = blank(upscaled.width + fringe, upscaled.height, [20, 20, 20, 255]);
      paste(padded, upscaled, 0, 0);
      const { pitch, phase } = detectPixelGrid(padded);
      const edges = gridEdges(padded.width, pitch.x, phase.x);
      const widths = edges.slice(1).map((e, i) => e - edges[i]);
      for (const w of widths.slice(0, -1)) expect(Math.abs(w - k)).toBeLessThanOrEqual(1);
    });
  }

  test("the pitch is detected per axis (24 x 30)", () => {
    const small = logicalArt(20, 24);
    const { pitch } = detectPixelGrid(upscaleBy(small, 24, 30));
    expect(Math.abs(pitch.x - 24)).toBeLessThan(0.6);
    expect(Math.abs(pitch.y - 30)).toBeLessThan(0.6);
  });

  test("a non-square pitch round-trips exactly", () => {
    const small = logicalArt(20, 24);
    const upscaled = upscaleBy(small, 24, 30);
    const { pitch, phase } = detectPixelGrid(upscaled);
    const snapped = gridSnapDownscale(upscaled, pitch, phase);
    expect([snapped.width, snapped.height]).toEqual([small.width, small.height]);
    expect(mismatch(snapped, small)).toBe(0);
  });

  test("wildly disagreeing axes fall back to the axis with more edges", () => {
    // down_carry_walk: few vertical edges, the y axis read 3 for a true 9.
    const small = logicalArt(20, 30);
    const upscaled = upscaleBy(small, 12);
    paste(upscaled, blank(upscaled.width, upscaled.height / 2, [40, 90, 180, 255]), 0, upscaled.height / 2);
    const { pitch } = detectPixelGrid(upscaled);
    expect(Math.max(pitch.x, pitch.y) / Math.min(pitch.x, pitch.y)).toBeLessThanOrEqual(1.5);
  });

  test("a synthetic axis collapse is repaired", () => {
    const { pitch } = detectPixelGrid(upscaleBy(logicalArt(24, 24), 9));
    expect(Math.abs(pitch.x - pitch.y)).toBeLessThan(1.0);
    expect(pitch.x).toBeGreaterThan(5.0);
    expect(pitch.y).toBeGreaterThan(5.0);
  });

  describe("the pitch family guard (resolve_frame_pitch)", () => {
    test("a 4 % deviation keeps the frame's own pitch (down_jump frame 0)", () => {
      expect(resolveFramePitch({ x: 12.5, y: 12.5 }, { x: 13, y: 13 })).toEqual({ pitch: { x: 12.5, y: 12.5 }, outlier: false });
    });
    test("a collapsed divisor falls back to the consensus (up_run frame 2)", () => {
      expect(resolveFramePitch({ x: 3, y: 3 }, { x: 7, y: 8.86 })).toEqual({ pitch: { x: 7, y: 8.86 }, outlier: true });
    });
    test("a harmonic multiple falls back to the consensus (up_run frame 0)", () => {
      expect(resolveFramePitch({ x: 9, y: 8.7 }, { x: 7, y: 8.86 })).toEqual({ pitch: { x: 7, y: 8.86 }, outlier: true });
    });
    test("one axis outside the family is enough (up_run frame 3)", () => {
      expect(resolveFramePitch({ x: 7, y: 8 }, { x: 7, y: 8.86 })).toEqual({ pitch: { x: 7, y: 8.86 }, outlier: true });
    });
    test("an inconclusive consensus keeps the frame's own pitch", () => {
      expect(resolveFramePitch({ x: 9, y: 9 }, { x: 1, y: 1 })).toEqual({ pitch: { x: 9, y: 9 }, outlier: false });
    });
  });

  for (const offset of [3, 11]) {
    test(`the measured phase survives an offset grid (offset ${offset}) where the histogram phase does not`, () => {
      // synthetic_fixture_b down_jump frame 0: the histogram phase sat pitch/2
      // off and an eye went from 4 rows to 3.
      const k = 13;
      const upscaled = upscaleBy(art, k);
      const cropped = crop(upscaled, offset, offset, upscaled.width - offset, upscaled.height - offset);
      const { pitch } = detectPixelGrid(cropped);
      const measured = bestPhase(cropped, pitch);
      const snapped = gridSnapDownscale(cropped, pitch, measured);
      expect([snapped.width, snapped.height]).toEqual([art.width, art.height]);
      if (offset === 3) expect(mismatch(snapped, art)).toBe(0);
    });
  }

  for (const scale of [12.0, 14.35, 16.0, 17.24, 20.0]) {
    test(`the measured phase round-trips like the detected one (${scale})`, () => {
      const upscaled = upscaledFractional(art, scale);
      const { pitch } = detectPixelGrid(upscaled);
      const phase = bestPhase(upscaled, pitch);
      const snapped = gridSnapDownscale(upscaled, pitch, phase);
      expect([snapped.width, snapped.height]).toEqual([art.width, art.height]);
      expect(mismatch(snapped, art)).toBeLessThanOrEqual(Math.floor((art.width * art.height) / 100));
    });
  }
});

describe("the sliver guard (test_sliver_guard.py)", () => {
  /** Two colour boundaries 5 px apart between grid lines 52 and 65. */
  function doubleBoundary(width = 130, height = 40) {
    const im = blank(width, height, [200, 60, 60, 255]);
    for (let y = 0; y < height; y++) {
      for (let x = 56; x < 61; x++) setPixel(im, x, y, [30, 30, 30, 255]);
      for (let x = 61; x < width; x++) setPixel(im, x, y, [60, 120, 200, 255]);
    }
    return im;
  }

  test("interior cut gaps never fall below 0.6 x pitch", () => {
    const im = doubleBoundary();
    const pitch = 13.0;
    const lattice = Array.from({ length: Math.floor(im.width / 13) + 1 }, (_, i) => i * 13);
    const { xs } = refineEdgesToBoundaries(im, lattice, [0, 13, 26, im.height], { x: pitch, y: pitch });
    const gaps = xs.slice(1).map((e, i) => e - xs[i]);
    const interior = gaps.slice(1, -1);
    expect(interior.length).toBeGreaterThan(0);
    expect(Math.min(...interior)).toBeGreaterThanOrEqual(Math.round(pitch * 0.6));
  });

  test("the guard still lets a cut follow an off-grid boundary inside the window", () => {
    const im = blank(130, 40, [200, 60, 60, 255]);
    for (let y = 0; y < 40; y++) for (let x = 50; x < 130; x++) setPixel(im, x, y, [60, 120, 200, 255]);
    const lattice = Array.from({ length: 11 }, (_, i) => i * 13);
    const { xs } = refineEdgesToBoundaries(im, lattice, [0, 13, 26, 40], { x: 13, y: 13 });
    expect(xs).toContain(50);
  });

  test("below pitch 3.3 the floor stays 2 px", () => {
    const im = blank(30, 12, [200, 60, 60, 255]);
    for (let y = 0; y < 12; y++) for (let x = 15; x < 30; x++) setPixel(im, x, y, [60, 120, 200, 255]);
    const lattice = Array.from({ length: 11 }, (_, i) => i * 3);
    const { xs } = refineEdgesToBoundaries(im, lattice, [0, 3, 6, 9, 12], { x: 3, y: 3 });
    const gaps = xs.slice(1).map((e, i) => e - xs[i]);
    expect(Math.min(...(gaps.length > 2 ? gaps.slice(1, -1) : gaps))).toBeGreaterThanOrEqual(2);
  });
});

describe("tightening and the shared palette (curate/test_pixel_snap.py)", () => {
  test("a padded component grows no ghost bottom row once tightened", () => {
    // 2026-07-14: a 4 px pad plus phase noise (lead 4 measured as 2.8, snapped
    // to 0) pushed the grid up and a fringe row became a pixel under the feet.
    const pitch = 13.213;
    const blocksW = 8, blocksH = 6, pad = 4;
    const solidH = Math.round(blocksH * pitch) - 1;
    const width = Math.round(blocksW * pitch);
    const comp = blank(width + pad * 2, solidH + 1 + pad * 2);
    for (let y = 0; y < solidH; y++) for (let x = 0; x < width; x++) setPixel(comp, pad + x, pad + y, [60, 90, 180, 255]);
    for (let x = 0; x < width; x++) setPixel(comp, pad + x, pad + solidH, [60, 90, 180, 134]);
    const noisy = { x: 2.8, y: 2.8 };

    const buggy = gridSnapDownscale(comp, { x: pitch, y: pitch }, noisy, true);
    const buggyBox = alphaBbox(buggy, 1)!;
    expect(buggyBox.y + buggyBox.h).toBeGreaterThan(blocksH);

    const tight = tighten(comp);
    expect([tight.width, tight.height]).toEqual([width, solidH + 1]);
    const fixed = gridSnapDownscale(tight, { x: pitch, y: pitch }, noisy, true);
    expect(alphaBbox(fixed, 1)!.h).toBe(blocksH);
  });

  test("a sub-128 fringe does not inflate the grid", () => {
    // 2026-07-17: an any-alpha crop kept the fringe; 141 of 150 frames grew.
    const pitch = 12, blocksW = 12, blocksH = 10;
    const lut = [[200, 60, 60], [60, 200, 60], [60, 60, 200], [220, 160, 40], [240, 230, 210], [90, 50, 20], [20, 20, 20], [120, 160, 220]];
    const blockColor = (bx: number, by: number) => lut[(bx * 7 + by * 3) % lut.length];
    const solidW = blocksW * pitch, solidH = blocksH * pitch;
    const comp = blank(7 + solidW, 5 + solidH);
    for (let y = 0; y < solidH; y++) for (let x = 0; x < solidW; x++) setPixel(comp, 7 + x, 5 + y, [...blockColor(Math.floor(x / pitch), Math.floor(y / pitch)), 255]);
    for (let y = 0; y < comp.height; y++) for (let x = 0; x < comp.width; x++) if (getPixel(comp, x, y)[3] === 0) setPixel(comp, x, y, [30, 30, 30, 90]);

    const snap = (image: RgbaImage) => {
      const { pitch: p, phase } = detectPixelGrid(image);
      return gridSnapDownscale(image, p, phase, true);
    };
    const exact = (out: RgbaImage) => out.width === blocksW && out.height === blocksH
      && Array.from({ length: blocksH }, (_, by) => Array.from({ length: blocksW }, (_, bx) => by * 0 + bx))
        .every((row, by) => row.every((bx) => getPixel(out, bx, by).slice(0, 3).join() === blockColor(bx, by).join()));

    const anyAlpha = alphaBbox(comp, 1)!;
    expect(exact(snap(cropImage(comp, anyAlpha.x, anyAlpha.y, anyAlpha.w, anyAlpha.h)))).toBe(false);
    const tight = tighten(comp);
    expect([tight.width, tight.height]).toEqual([solidW, solidH]);
    expect(exact(snap(tight))).toBe(true);
  });

  test("the default 48-colour palette keeps a rare saturated accent that 24 starves", () => {
    // 2026-07-17: a 0.2 % gold hair tie vanished at 24 colours.
    const frame = blank(128, 75);
    const clusters = Array.from({ length: 30 }, (_, k) => [(k * 53) % 200, (k * 97) % 200, (k * 151) % 200]);
    let i = 0;
    for (let y = 0; y < 75; y++) {
      for (let x = 0; x < 128; x++) {
        const c = clusters[Math.min(29, Math.floor(y / 15) * 6 + Math.floor(x / 22))];
        const j = ((i * 31) % 17) - 8;
        setPixel(frame, x, y, [...c.map((v) => Math.max(0, Math.min(255, v + j))), 255]);
        i++;
      }
    }
    const gold = [240, 158, 45];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setPixel(frame, x, y, [...gold, 255]);
    const nearest = (palette: number[][]) => Math.min(...palette.map((e) => Math.hypot(e[0] - gold[0], e[1] - gold[1], e[2] - gold[2])));
    expect(nearest(buildSharedPalette([frame], 24))).toBeGreaterThan(30);
    expect(nearest(buildSharedPalette([frame], 48))).toBeLessThanOrEqual(8);
  });
});

describe("the run-length second opinion (test_pitch_runlen_crosscheck.py)", () => {
  test("an integer pitch is estimated exactly", () => {
    const art = logicalArt(24, 40);
    for (const k of [8, 12, 16, 24]) {
      const e = estimatePixelGridRunlen(upscaleBy(art, k));
      expect(Math.abs(e.x - k)).toBeLessThan(0.01);
      expect(Math.abs(e.y - k)).toBeLessThan(0.01);
    }
  });

  test("a fractional per-axis pitch is recovered from the run mix", () => {
    const e = estimatePixelGridRunlen(upscaledAxes(logicalArt(24, 44), 29.5, 30.6));
    expect(Math.abs(e.x - 29.5)).toBeLessThan(0.2);
    expect(Math.abs(e.y - 30.6)).toBeLessThan(0.2);
  });

  test("noise and small images are inconclusive", () => {
    expect(estimatePixelGridRunlen(noiseImage(200, 200, 3))).toEqual({ x: 1, y: 1 });
    expect(estimatePixelGridRunlen(logicalArt(24, 24))).toEqual({ x: 1, y: 1 });
  });

  test("the crosscheck is quiet when the estimators agree", () => {
    const upscaled = upscaledAxes(logicalArt(18, 30), 29.5, 30.6);
    const { pitch } = detectPixelGrid(upscaled);
    expect(Math.abs(pitch.x - 29.5)).toBeLessThan(0.4);
    expect(Math.abs(pitch.y - 30.6)).toBeLessThan(0.4);
    expect(crosscheckPitchRunlen(pitch, estimatePixelGridRunlen(upscaled))).toEqual([]);
  });

  test("the crosscheck is quiet on integer scales", () => {
    const art = logicalArt(24, 40);
    for (const k of [8, 12, 16, 24]) {
      const upscaled = upscaleBy(art, k);
      expect(crosscheckPitchRunlen(detectPixelGrid(upscaled).pitch, estimatePixelGridRunlen(upscaled))).toEqual([]);
    }
  });

  test("the crosscheck skips unconfident estimates", () => {
    expect(crosscheckPitchRunlen({ x: 1, y: 1 }, { x: 30, y: 30 })).toEqual([]);
    expect(crosscheckPitchRunlen({ x: 30, y: 30 }, { x: 1, y: 1 })).toEqual([]);
    expect(crosscheckPitchRunlen({ x: 30, y: 31 }, { x: 29.2, y: 30.4 })).toEqual([]);
  });

  test("the crosscheck flags a divisor misdetection on both axes", () => {
    const upscaled = upscaledAxes(logicalArt(20, 36, 11), 29.5, 30.6);
    const { pitch } = detectPixelGrid(upscaled);
    // Premise, as upstream states it: the detector halves both axes here.
    expect(pitch.x).toBeLessThan(20);
    expect(pitch.y).toBeLessThan(20);
    const runlen = estimatePixelGridRunlen(upscaled);
    expect(Math.abs(runlen.x - 29.5)).toBeLessThan(0.2);
    expect(Math.abs(runlen.y - 30.6)).toBeLessThan(0.2);
    const divisor = crosscheckPitchRunlen(pitch, runlen).filter((n) => n.includes("divisor"));
    expect(divisor).toHaveLength(2);
    expect(divisor.some((n) => n.includes("x="))).toBe(true);
    expect(divisor.some((n) => n.includes("y="))).toBe(true);
  });

  test("the crosscheck flags a y axis collapsed onto x", () => {
    const upscaled = upscaledAxes(logicalArt(28, 60, 5), 29.0, 30.3);
    const { pitch } = detectPixelGrid(upscaled);
    expect(Math.abs(pitch.x - 29.0)).toBeLessThan(0.6);
    expect(Math.abs(pitch.y - pitch.x)).toBeLessThan(1.0);
    expect(Math.abs(pitch.y - 30.3)).toBeGreaterThan(0.4);
    const runlen = estimatePixelGridRunlen(upscaled);
    expect(Math.abs(runlen.y - 30.3)).toBeLessThan(0.2);
    expect(crosscheckPitchRunlen(pitch, runlen).some((n) => n.includes("axis ratio"))).toBe(true);
  });
});

describe("one generation's frames", () => {
  /** A generation: the same art drawn at slightly different pitches, on
   *  transparent cells, like a sliced and keyed sheet. */
  function generation(pitches: number[], { art = logicalArt(20, 28, 11), cell = 420 } = {}) {
    return pitches.map((p) => {
      const sprite = upscaledFractional(art, p);
      const frame = blank(cell, cell);
      paste(frame, sprite, 30, 20);
      return frame;
    });
  }

  test("a collapsed reading is dropped from the consensus and the frame is snapped at it", () => {
    const art = logicalArt(20, 28, 11);
    const frames = generation([13.1, 13.2, 13.0, 13.3], { art });
    // Frame 2 carries detail at twice the logical resolution (a different,
    // finer drawing), so it reads half the pitch — a collapse, as far as the
    // generation is concerned.
    const fine = blank(420, 420);
    paste(fine, upscaledFractional(logicalArt(40, 56, 3), 6.6), 30, 20);
    frames[2] = fine;
    const result = latticeFrames(frames);
    expect(result.consensus.x).toBeGreaterThan(12.5);
    expect(result.frames[2].source).toBe("outlier");
    expect(result.warnings.some((w) => w.includes("collapsed per-frame x pitch"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("frame 02: own pitch"))).toBe(true);
    for (const f of [0, 1, 3].map((i) => result.frames[i])) expect([f.logical!.width, f.logical!.height]).toEqual([20, 28]);
    // Cut at the consensus (13.x), the fine frame comes out near the coarse size.
    expect(Math.abs(result.frames[2].logical!.width - 20)).toBeLessThanOrEqual(1);
  });

  test("frames keep their own pitch inside the family", () => {
    const result = latticeFrames(generation([13.1, 13.4, 12.9, 13.3]));
    expect(result.frames.map((f) => f.source)).toEqual(["own", "own", "own", "own"]);
    for (const f of result.frames) expect(mismatch(f.logical!, logicalArt(20, 28, 11))).toBeLessThanOrEqual(6);
  });

  test("an empty frame stays empty, and no grid at all comes back as consensus 1", () => {
    const frames = generation([13, 13]);
    frames.push(blank(420, 420));
    expect(latticeFrames(frames).frames[2].source).toBe("empty");
    const noise = latticeFrames([noiseImage(120, 120, 5), noiseImage(120, 120, 6)]);
    expect(noise.consensus).toEqual({ x: 1, y: 1 });
    expect(noise.frames.every((f) => f.source === "none")).toBe(true);
  });

  test("--pitch-hint stands in when no frame reads a grid, and says so", () => {
    const result = latticeFrames([noiseImage(120, 120, 5)], { pitchHint: 10 });
    expect(result.consensus).toEqual({ x: 10, y: 10 });
    expect(result.frames[0].source).toBe("consensus");
    expect(result.warnings).toContain("frame 00: pitch detection inconclusive — snapped at --pitch-hint 10");
  });

  test("--pitch-hint is the family centre: a frame's own reading counts only near it", () => {
    // A real GPT-Image walk (2026-09-27): one frame read 4.00 for 8 px blocks,
    // the rest nothing. Under upstream's fallback-only hint that 4.00 was the
    // consensus. Here the lone divisor is an outlier of the hint.
    const art = logicalArt(20, 28, 11);
    const frames = [13.1, 13.3].map((p) => {
      const frame = blank(420, 420);
      paste(frame, upscaledFractional(art, p), 30, 20);
      return frame;
    });
    const hinted = latticeFrames(frames, { pitchHint: 26 });
    expect(hinted.consensus).toEqual({ x: 26, y: 26 });
    expect(hinted.frames.map((f) => f.source)).toEqual(["outlier", "outlier"]);
    expect(hinted.warnings.some((w) => w.startsWith("--pitch-hint 26 overrides the measured consensus 13."))).toBe(true);
    const near = latticeFrames(frames, { pitchHint: 13 });
    expect(near.frames.map((f) => f.source)).toEqual(["own", "own"]);
    expect(near.frames[1].pitch!.x).toBeCloseTo(13.3, 0);
  });

  test("the generation reports how many frames read a grid, and a pooled suggestion when too few did", () => {
    const art = logicalArt(20, 28, 11);
    const frame = blank(420, 420);
    paste(frame, upscaledFractional(art, 13.2), 30, 20);
    const result = latticeFrames([frame, noiseImage(160, 160, 5), noiseImage(160, 160, 6)]);
    expect([result.confident, result.nonEmpty]).toEqual([1, 3]);
    expect(result.pooled).not.toBeNull();
    const enough = latticeFrames([frame, frame, noiseImage(160, 160, 5)]);
    expect(enough.pooled).toBeNull();
  });

  test("consensusPitch is upstream's upper median of the uncollapsed readings", () => {
    // Half the frames collapsed to 3 (upstream's down_carry_run): they are
    // dropped, and the upper median of [8.9, 9, 9.1] is 9.
    expect(consensusPitch([9, 9.1, 3, 3, 3, 8.9])).toEqual({ value: 9, dropped: 3, floor: 9.1 * 0.6, harmonics: 0 });
    expect(consensusPitch([1, 1])).toEqual({ value: 1, dropped: 0, floor: null, harmonics: 0 });
  });

  test("one harmonic reading cannot become the ceiling that drops every true one", () => {
    // Synthetic 7.35 px generation (2026-09-27): one frame read 38.94.
    // Upstream's max-anchored floor (23.4) dropped all fifteen true readings.
    const readings = [7.42, 7.33, 7.36, 7.32, 7.42, 7.3, 7.5, 7.44, 7.4, 7.38, 7.35, 7.29, 7.46, 38.94, 7.3, 7.37];
    const result = consensusPitch(readings);
    expect(result.value).toBeCloseTo(7.37, 2);
    expect(result.harmonics).toBe(1);
    expect(result.dropped).toBe(0);
    // Two frames are too few to ceiling a generation of three or more only
    // when a quarter of it is more — with four votes, two agreeing frames
    // are enough, which keeps upstream's half-collapsed rule intact.
    expect(consensusPitch([3, 3, 9, 9]).value).toBe(9);
    // Under three votes the largest reading is the ceiling, as upstream.
    expect(consensusPitch([7, 36]).value).toBe(36);
  });

  test("a majority of divisor readings does not win against the run length (R2-2)", () => {
    // Without the runs, the majority decides — upstream's rule, kept.
    expect(consensusPitch([3, 3, 3, 3, 3, 9]).value).toBe(3);
    expect(consensusPitch([4, 4, 4, 4, 4, 4, 4, 8]).value).toBe(4);
    // Runs of ~9 (and ~8) say 3 (and 4) are divisors: the larger reading the
    // majority divides, and the runs back, is taken.
    expect(consensusPitch([3, 3, 3, 3, 3, 9], 9.2)).toMatchObject({ value: 9, rescuedFrom: 3 });
    expect(consensusPitch([4, 4, 4, 4, 4, 4, 4, 8], 7.6)).toMatchObject({ value: 8, rescuedFrom: 4 });
    // The route-G slime idle's x readings against its runs of 12.79.
    expect(consensusPitch([3, 7, 4, 3, 13, 3, 4, 3], 12.79)).toMatchObject({ value: 13, rescuedFrom: 3 });
    // Its y readings: 14 is the only multiple, and runs of 10.78 do not back
    // it (1.3x) — the consensus stands, marked for the caller to refuse.
    const y = consensusPitch([3, 7, 6, 3, 14, 3, 3, 3], 10.78);
    expect(y).toMatchObject({ value: 3, divisorSuspect: true });
    expect(y.rescuedFrom).toBeUndefined();
    // Runs within 1.5x of the consensus leave it alone.
    expect(consensusPitch([3, 3, 3, 9], 4.4)).toEqual(consensusPitch([3, 3, 3, 9]));
  });
});

describe("colour decisions", () => {
  test("detail bias lets a near-black 45 % minority win the block", () => {
    const pixels: number[] = [];
    for (let i = 0; i < 55; i++) pixels.push(230, 200, 170);
    for (let i = 0; i < 45; i++) pixels.push(20, 18, 30);
    expect(dominantBlockColor(pixels, false)).toEqual([230, 200, 170]);
    expect(dominantBlockColor(pixels, true)).toEqual([20, 18, 30]);
  });

  test("a palette maps every solid pixel onto itself and clears the rest", () => {
    const img = blank(3, 1);
    setPixel(img, 0, 0, [250, 10, 10, 255]);
    setPixel(img, 1, 0, [12, 12, 240, 200]);
    setPixel(img, 2, 0, [90, 90, 90, 40]);
    applyPalette(img, [[255, 0, 0], [0, 0, 255]]);
    expect([getPixel(img, 0, 0), getPixel(img, 1, 0), getPixel(img, 2, 0)]).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0]]);
  });

  test("the outline darkens only silhouette-edge pixels", () => {
    const img = blank(5, 5);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) setPixel(img, x, y, [200, 100, 50, 255]);
    enforceOutline(img, 0.5);
    expect(getPixel(img, 2, 2)).toEqual([200, 100, 50, 255]);
    expect(getPixel(img, 1, 1)).toEqual([100, 50, 25, 255]);
    expect(getPixel(img, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe("placement and checks", () => {
  test("an integer upscale keeps every block whole", () => {
    const art = logicalArt(6, 5);
    const big = upscale(art, 3);
    expect([big.width, big.height]).toEqual([18, 15]);
    expect(latticeCheck(big, 3)).toMatchObject({ softAlpha: 0, offGrid: 0 });
  });

  test("latticeCheck names soft alpha, off-grid blocks and off-palette colours", () => {
    const art = logicalArt(6, 5);
    const big = upscale(art, 2);
    setPixel(big, 1, 0, [1, 2, 3, 255]);
    setPixel(big, 4, 4, [0, 0, 0, 90]);
    const check = latticeCheck(big, 2, PALETTE);
    expect(check.softAlpha).toBe(1);
    expect(check.offGrid).toBe(2);
    expect(check.offPalette).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The CLI: `pixel`, `run --pixel`, and align / inspect on pixel frames
// ---------------------------------------------------------------------------

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) modes/sprite pixel CLI suite — ffmpeg/ffprobe not on PATH");

function sheetCmd(...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}
function sheetJson(...argv: string[]) {
  const r = sheetCmd(...argv, "--json");
  if (r.code !== 0) throw new Error(`sprite-sheet ${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}
function writePng(path: string, image: RgbaImage) {
  mkdirSync(join(path, ".."), { recursive: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`, "-i", "-", "-frames:v", "1", path], { input: image.data });
  if (r.status !== 0) throw new Error(String(r.stderr));
}
function readPng(path: string): RgbaImage {
  const p = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  const [width, height] = String(p.stdout).trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 28 });
  return { width, height, data: new Uint8Array(r.stdout.subarray(0, width * height * 4)) };
}
function softAlpha(image: RgbaImage) {
  let n = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 0 && image.data[i] !== 255) n++;
  return n;
}
const ART = logicalArt(20, 28, 11);
/** A keyed-looking cell: the art at a fractional pitch with an anti-aliased
 *  rim of alpha 100 around it, on transparency. */
function cellOf(pitch: number, { art = ART, size = 420, at = [27, 21] } = {}) {
  const sprite = upscaledFractional(art, pitch);
  const frame = blank(size, size);
  paste(frame, sprite, at[0], at[1]);
  for (let x = at[0]; x < at[0] + sprite.width; x++) setPixel(frame, x, at[1] + sprite.height, [40, 40, 40, 100]);
  return frame;
}
/** Each CLI case spawns ffmpeg a few dozen times. */
const CLI_TIMEOUT = 60_000;
function workspace() {
  return mkdtempSync(join(tmpdir(), "sprite-pixel-"));
}

describe.skipIf(!HAS_FFMPEG)("pixel <framesDir>", () => {
  test("snaps a generation to native logical pixels with binary alpha and pins one palette", () => {
    const dir = workspace();
    try {
      [13.1, 13.3, 12.9, 13.2].forEach((p, i) => writePng(join(dir, "cells", `0${i}.png`), cellOf(p)));
      const out = sheetJson("pixel", join(dir, "cells"), "--out", join(dir, "px"));
      expect(out.pitch.x).toBeGreaterThan(12.5);
      expect(out.pitch.x).toBeLessThan(13.6);
      expect(out.perFrame.map((f: { source: string }) => f.source)).toEqual(["own", "own", "own", "own"]);
      expect(out.palette).toMatchObject({ pinned: false, file: join(dir, "px", "palette.json") });
      for (const f of out.perFrame) expect(f.logical).toEqual({ width: 20, height: 28 });
      for (const path of out.frames as string[]) {
        const img = readPng(path);
        expect([img.width, img.height]).toEqual([out.logicalCell.width, out.logicalCell.height]);
        expect(softAlpha(img)).toBe(0);
      }
      const record = JSON.parse(readFileSync(join(dir, "px", "pixel.json"), "utf-8"));
      expect(record).toMatchObject({ kind: "pneuma-sprite-pixel", scale: 1, palette: { pinned: false } });
      // The art's own six colours are all in the palette, exactly.
      const pinned = JSON.parse(readFileSync(join(dir, "px", "palette.json"), "utf-8"));
      const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      for (const colour of PALETTE.map(hex)) expect(pinned.colors).toContain(colour);
      expect(pinned.colors.length).toBe(out.palette.colors);
      expect(pinned.colors.length).toBeLessThanOrEqual(48);

      // A re-run reads the pinned file and leaves it byte for byte.
      const before = readFileSync(join(dir, "px", "palette.json"), "utf-8");
      const again = sheetJson("pixel", join(dir, "cells"), "--out", join(dir, "px"));
      expect(again.palette.pinned).toBe(true);
      expect(readFileSync(join(dir, "px", "palette.json"), "utf-8")).toBe(before);
      // Another motion names the same file and gets the same colours.
      const other = sheetJson("pixel", join(dir, "cells"), "--out", join(dir, "px2"), "--palette", join(dir, "px", "palette.json"));
      expect(other.palette).toMatchObject({ pinned: true, file: join(dir, "px", "palette.json") });
      expect(existsSync(join(dir, "px2", "palette.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("a pinned palette pinned for other art is said, and --repalette rebuilds it", () => {
    const dir = workspace();
    try {
      [13.1, 13.3].forEach((p, i) => writePng(join(dir, "cells", `0${i}.png`), cellOf(p)));
      writeFileSync(join(dir, "pal.json"), JSON.stringify({ colors: ["#ff00ff", "#00ff00"] }));
      const far = sheetJson("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--palette", join(dir, "pal.json"));
      expect(far.palette).toMatchObject({ pinned: true, colors: 2 });
      expect(far.warnings.some((w: string) => w.includes("more than 48 from every colour of the pinned palette"))).toBe(true);
      const rebuilt = sheetJson("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--palette", join(dir, "pal.json"), "--repalette");
      expect(rebuilt.palette.pinned).toBe(false);
      expect(rebuilt.palette.colors).toBeGreaterThanOrEqual(PALETTE.length);
      expect(rebuilt.warnings.some((w: string) => w.includes("pinned palette"))).toBe(false);
      writeFileSync(join(dir, "pal.json"), "{ not json");
      const broken = sheetCmd("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--palette", join(dir, "pal.json"));
      expect(broken.code).toBe(1);
      expect(broken.err).toContain("is not valid JSON");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("refuses thin evidence, and --pitch-hint carries it through", () => {
    const dir = workspace();
    try {
      writePng(join(dir, "cells", "00.png"), cellOf(13.2));
      writePng(join(dir, "cells", "01.png"), noiseImage(160, 160, 5));
      writePng(join(dir, "cells", "02.png"), noiseImage(160, 160, 6));
      const refused = sheetCmd("pixel", join(dir, "cells"), "--out", join(dir, "px"));
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("only 1 of 3 frames");
      expect(refused.err).toContain("pass --pitch-hint N");
      const hinted = sheetJson("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--pitch-hint", "13");
      expect(hinted.perFrame.map((f: { source: string }) => f.source)).toEqual(["own", "consensus", "consensus"]);
      expect(sheetCmd("pixel", join(dir, "cells"), "--out", join(dir, "cells")).err).toContain("is the input directory");
      expect(sheetCmd("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--scale", "1.5").err).toContain("whole number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("an offset true phase keeps every logical cell through the CLI (test_snap_phase_policy.py)", () => {
    // Upstream pins the policy through its extract script, because a helper
    // test cannot see the snap loop go back to the histogram phase: at pitch
    // 13 cut 11 px into the first block, that phase lost a row and a column.
    const dir = workspace();
    try {
      const art = logicalArt(24, 40, 11, PALETTE.slice(0, 5));
      for (const left of [6, 14]) for (const x of [left, left + 1]) for (let y = 12; y < 16; y++) setPixel(art, x, y, [10, 8, 6, 255]);
      const up = upscaleBy(art, 13);
      const cropped = crop(up, 11, 11, up.width - 11, up.height - 11);
      for (const i of [0, 1]) {
        const frame = blank(cropped.width + 40, cropped.height + 40);
        paste(frame, cropped, 20, 20);
        writePng(join(dir, "cells", `0${i}.png`), frame);
      }
      const out = sheetJson("pixel", join(dir, "cells"), "--out", join(dir, "px"));
      for (const f of out.perFrame) expect(f.logical).toEqual({ width: art.width, height: art.height });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("align keeps an N x upscale on its grid, and inspect says whether the lattice held", () => {
    const dir = workspace();
    try {
      [13.1, 13.3, 12.9].forEach((p, i) => writePng(join(dir, "cells", `0${i}.png`), cellOf(p, { at: [27 + 5 * i, 21 + 3 * i] })));
      sheetJson("pixel", join(dir, "cells"), "--out", join(dir, "pixel"), "--scale", "3");
      const aligned = sheetJson("align", join(dir, "pixel"), "--out", join(dir, "motion", "frames"), "--pad", "8");
      expect(aligned.pixel).toMatchObject({ scale: 3 });
      expect(aligned.pad).toBe(9);
      expect(aligned.cell.width % 6).toBe(0);
      expect(aligned.cell.height % 3).toBe(0);
      for (const f of aligned.frames) {
        expect(f.offset.x % 3).toBe(0);
        expect(f.offset.y % 3).toBe(0);
      }
      const record = JSON.parse(readFileSync(join(dir, "motion", "frames", "align.json"), "utf-8"));
      expect(record.pixel).toMatchObject({ scale: 3 });

      const held = sheetJson("inspect", join(dir, "motion"));
      expect(held.pixel).toMatchObject({ scale: 3, held: true, paletteChecked: true });
      expect(held.warnings.filter((w: string) => w.startsWith("pixel lattice"))).toEqual([]);

      // Resample one frame the way a later step might: soft alpha, off-grid.
      const path = join(dir, "motion", "frames", "01.png");
      const img = readPng(path);
      const box = alphaBbox(img, 255)!;
      setPixel(img, box.x + 1, box.y + 1, [1, 2, 3, 128]);
      writePng(path, img);
      const broken = sheetJson("inspect", join(dir, "motion"));
      expect(broken.pixel).toMatchObject({ held: false, softAlphaFrames: [1], offGridFrames: [1], offPaletteFrames: [1] });
      expect(broken.warnings.some((w: string) => w.startsWith("pixel lattice broken: frame(s) 01 have soft alpha"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);
});

describe.skipIf(!HAS_FFMPEG)("run --pixel", () => {
  /** A 2 x 2 sheet already carrying alpha (so run keys nothing). */
  function sheet(dir: string) {
    const cells = [13.1, 13.3, 12.9, 13.2].map((p) => cellOf(p));
    const img = blank(840, 840);
    cells.forEach((c, i) => paste(img, c, (i % 2) * 420, Math.floor(i / 2) * 420));
    const path = join(dir, "sheet.png");
    writePng(path, img);
    return path;
  }

  test("runs cells -> pixel -> align -> pack -> gif -> inspect and pins the palette in the motion", () => {
    const dir = workspace();
    try {
      const src = sheet(dir);
      const motion = join(dir, "char", "motions", "walk");
      const out = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop", "--pixel", "--no-webp");
      expect(out.pixel).toMatchObject({ dir: join(motion, "pixel"), scale: 1, palette: { pinned: false, file: join(motion, "palette.json") } });
      expect(out.inspect.pixel).toMatchObject({ held: true, scale: 1 });
      for (const path of out.frames as string[]) expect(softAlpha(readPng(path))).toBe(0);
      const atlas = JSON.parse(readFileSync(join(motion, "atlas.json"), "utf-8"));
      expect(atlas.meta.scale).toBe(1);
      expect(atlas.frames.walk_00.frame.w).toBe(out.cell.width);
      // Native resolution: a 20 x 28 sprite in a cell of a few dozen pixels.
      expect(out.cell.height).toBeLessThan(60);

      const again = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop", "--pixel", "--no-webp", "--scale", "2");
      expect(again.pixel).toMatchObject({ scale: 2, palette: { pinned: true } });
      expect(again.inspect.pixel).toMatchObject({ held: true, scale: 2 });
      expect(again.cell.width % 4).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  /** Every file under `dir` with its bytes' hash, for "nothing changed". */
  function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const path = join(d, name);
        if (statSync(path).isDirectory()) walk(path);
        else out[path.slice(dir.length)] = new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
      }
    };
    walk(dir);
    return out;
  }

  test("a declared height 1.5x off the snap is refused before the previous run is touched (P4, R1-3)", () => {
    const dir = workspace();
    try {
      const src = sheet(dir);
      const motion = join(dir, "char", "motions", "walk");
      const first = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop",
        "--pixel", "--logical-height", "28", "--no-webp");
      expect(first.pixel.logicalHeight).toMatchObject({ declared: 28, measured: 28, honoured: true, pitchFrom: "measured" });
      const before = snapshot(motion);
      expect(Object.keys(before).some((k) => k.startsWith("/pixel/"))).toBe(true);

      // Another sheet (forced over the first), declared half as tall: cut at
      // the pitch its frames read it is 28 blocks, 2x the declared 14, and
      // nothing the frames read backs 26 px blocks — refused, nothing moved.
      const other = join(dir, "other.png");
      const img = blank(840, 840);
      [13.0, 13.2, 13.1, 13.3].forEach((p, i) => paste(img, cellOf(p, { at: [40, 30] }), (i % 2) * 420, Math.floor(i / 2) * 420));
      writePng(other, img);
      const refused = sheetCmd("run", other, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop",
        "--pixel", "--logical-height", "14", "--no-webp", "--force");
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("2.0x the declared 14");
      expect(refused.err).toContain("Nothing was written");
      expect(snapshot(motion)).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("the anchor sits on a block boundary at an even scale (R1-2)", () => {
    const dir = workspace();
    try {
      // 21 logical px wide: at 2x, 42 px plus the pad each side is 58 — a
      // cell rounded to one block put the anchor at 29, inside a block.
      const art = logicalArt(21, 28, 11);
      const img = blank(840, 840);
      [13.1, 13.3, 12.9, 13.2].forEach((p, i) => paste(img, cellOf(p, { art }), (i % 2) * 420, Math.floor(i / 2) * 420));
      const src = join(dir, "sheet21.png");
      writePng(src, img);
      for (const scale of [2, 3]) {
        const motion = join(dir, "char", "motions", `walk${scale}`);
        const out = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop",
          "--pixel", "--scale", String(scale), "--x-from", "bbox", "--no-webp");
        const record = JSON.parse(readFileSync(join(motion, "frames", "align.json"), "utf-8"));
        expect({ scale, x: record.anchorPoint.x % scale, y: record.anchorPoint.y % scale }).toEqual({ scale, x: 0, y: 0 });
        expect(out.cell.width % (2 * scale)).toBe(0);
        expect(out.inspect.pixel).toMatchObject({ held: true, scale });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("a run without --pixel clears what an earlier pixel run left (R1-6)", () => {
    const dir = workspace();
    try {
      const src = sheet(dir);
      const motion = join(dir, "char", "motions", "walk");
      sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop", "--pixel", "--no-webp");
      expect(existsSync(join(motion, "pixel"))).toBe(true);
      expect(existsSync(join(motion, "palette.json"))).toBe(true);
      const plain = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop", "--no-webp");
      expect(existsSync(join(motion, "pixel"))).toBe(false);
      expect(existsSync(join(motion, "palette.json"))).toBe(false);
      expect(plain.warnings).toContain("not a pixel run: removed pixel/ and palette.json an earlier run --pixel left in this motion");
      expect(plain.inspect.pixel).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("the palette size comes from character.pixel.colors; --repalette never rebuilds the pinned file in place (R3)", () => {
    const dir = workspace();
    try {
      const src = sheet(dir);
      const char = join(dir, "char");
      const motion = join(char, "motions", "walk");
      const doc = (pixel: Record<string, unknown>, assets: unknown[] = []) =>
        writeFileSync(join(char, "project.json"), JSON.stringify({ assets, sprite: { character: { pixel }, motions: [] } }));
      mkdirSync(char, { recursive: true });
      doc({ logicalHeight: 28, colors: 4 });
      const four = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop", "--pixel", "--no-webp");
      expect(four.pixel.palette).toMatchObject({ colors: 4, pinned: false, file: join(motion, "palette.json") });
      // --palette-size still wins over the declaration.
      const six = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop", "--pixel",
        "--repalette", "--palette-size", "6", "--no-webp");
      expect(six.pixel.palette.colors).toBe(6);

      // This motion's palette.json pinned for the character: --repalette
      // builds beside it, and the pinned file keeps its bytes.
      doc({ logicalHeight: 28, colors: 4, palette: "char-palette" }, [{ id: "char-palette", type: "text", uri: "motions/walk/palette.json" }]);
      const pinnedBytes = readFileSync(join(motion, "palette.json"), "utf-8");
      const rebuilt = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop", "--pixel",
        "--repalette", "--no-webp");
      expect(rebuilt.pixel.palette).toMatchObject({ file: join(motion, "palette-rebuilt.json"), pinned: false });
      expect(readFileSync(join(motion, "palette.json"), "utf-8")).toBe(pinnedBytes);
      expect(rebuilt.warnings.some((w: string) => w.startsWith("--repalette: palette.json here is the palette pinned for the character (char-palette)"))).toBe(true);
      // Without --repalette the pinned palette is what the run quantises to.
      const again = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--loop", "--pixel", "--no-webp");
      expect(again.pixel.palette).toMatchObject({ file: join(motion, "palette.json"), pinned: true, from: "character" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 2 * CLI_TIMEOUT);

  test("lattice flags need --pixel, and a pixel-art character without it gets a suggestion", () => {
    const dir = workspace();
    try {
      const src = sheet(dir);
      const motion = join(dir, "char", "motions", "walk");
      const stray = sheetCmd("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--palette", "x.json");
      expect(stray.code).toBe(1);
      expect(stray.err).toContain("--palette belongs to the pixel lattice — add --pixel");
      const fractional = sheetCmd("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--pixel", "--scale", "0.5");
      expect(fractional.err).toContain("whole number");

      mkdirSync(join(dir, "char"), { recursive: true });
      writeFileSync(join(dir, "char", "project.json"), JSON.stringify({ sprite: { character: { style: "16-bit pixel art" }, motions: [] } }));
      const plain = sheetJson("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8", "--no-webp", "--force");
      expect(plain.warnings.some((w: string) => w.startsWith("character.style says pixel art"))).toBe(true);
      expect(plain.inspect.pixel).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);
});
