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
    expect(result.warnings.some((w) => w.includes("--pitch-hint 10"))).toBe(true);
  });

  test("consensusPitch is upstream's upper median of the uncollapsed readings", () => {
    // Half the frames collapsed to 3 (upstream's down_carry_run): they are
    // dropped, and the upper median of [8.9, 9, 9.1] is 9.
    expect(consensusPitch([9, 9.1, 3, 3, 3, 8.9])).toEqual({ value: 9, dropped: 3, floor: 9.1 * 0.6 });
    expect(consensusPitch([1, 1])).toEqual({ value: 1, dropped: 0, floor: null });
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
