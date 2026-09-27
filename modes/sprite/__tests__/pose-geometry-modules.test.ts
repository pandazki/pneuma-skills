/**
 * The pure halves of three amendments, pinned without ffmpeg:
 * `sheet-segment.mjs` (where each pose of a sheet is, by its ink — the
 * projection segmentation ported from aldegad/sprite-gen, itself from
 * gykim80/perfectpixel-studio) and `sizes.mjs` (is a character one size across
 * its motions). The CLI flows that use them are in
 * `sprite-sheet-pose-geometry.test.ts`.
 */

import { describe, expect, test } from "bun:test";

import {
  CELL_MARGIN, cutPoses, dpNCut, layoutPoses, locatePoses, segmentBoundaries, segmentProfile,
} from "../skill/scripts/sheet-segment.mjs";
import { SIZE_SPREAD_WARN, motionSize, sizeSpread, sizeWarning } from "../skill/scripts/sizes.mjs";

type Image = { width: number; height: number; data: Uint8Array };

function blank(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function fill(image: Image, x: number, y: number, w: number, h: number, rgba = [200, 60, 40, 255]) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) image.data.set(rgba, (yy * image.width + xx) * 4);
  }
}

/** A profile of `humps` [start, end, height) plateaus over `length` columns. */
function profile(length: number, humps: Array<[number, number, number]>): Float64Array {
  const out = new Float64Array(length);
  for (const [s, e, h] of humps) for (let i = s; i < e; i++) out[i] = h;
  return out;
}

/** Cell (r, c) of a grid of 64 px cells starts at (64c, 64r). */
const grid64 = { cell: { width: 64, height: 64 }, origin: (r: number, c: number) => ({ x: 64 * c, y: 64 * r }) };

describe("segmentProfile / segmentBoundaries (the ported projection segmentation)", () => {
  test("blank bands between poses give the count, and the cuts sit mid-gap", () => {
    const p = profile(400, [[20, 80, 1000], [120, 180, 900], [220, 280, 1000], [320, 380, 950]]);
    const out = segmentBoundaries(p, 4);
    expect(out.natural).toBe(4);
    expect(out.forced).toBe(false);
    // Each cut is the middle of the blank band the smoothing leaves.
    expect(out.cuts).toHaveLength(3);
    for (const [cut, gap] of [[out.cuts![0], [80, 120]], [out.cuts![1], [180, 220]], [out.cuts![2], [280, 320]]] as const) {
      expect(cut).toBeGreaterThan(gap[0]);
      expect(cut).toBeLessThan(gap[1]);
    }
  });

  test("a lunge wider than 1.45 median poses is one pose when the count already fits", () => {
    // The Kagari attack case: three poses ~60 wide, one ~95 wide (sword out).
    // Upstream reads the wide run as two fused poses, finds 5 and has to
    // force the count; the count here is right as read.
    const p = profile(420, [[20, 80, 1000], [120, 180, 900], [220, 280, 1000], [310, 405, 800]]);
    const out = segmentProfile(p, 4);
    expect(out.natural).toBe(4);
    expect(out.forced).toBe(false);
    expect(out.segments[3][1] - out.segments[3][0]).toBeGreaterThan(90);
  });

  test("two poses drawn touching are cut at the least ink between them", () => {
    // One run, two humps, a valley at 150 well under 62 % of either peak.
    const p = new Float64Array(300);
    for (let i = 40; i < 260; i++) p[i] = 200 + 800 * Math.exp(-(((i - 95) / 25) ** 2)) + 800 * Math.exp(-(((i - 205) / 25) ** 2));
    const out = segmentBoundaries(p, 2);
    expect(out.cuts).not.toBeNull();
    expect(Math.abs(out.cuts![0] - 150)).toBeLessThanOrEqual(3);
  });

  test("dpNCut places count-1 cuts on the thinnest columns", () => {
    const p = profile(90, [[0, 90, 100]]);
    p[30] = 1;
    p[61] = 1;
    expect(dpNCut(p, 0, 90, 3)).toEqual([30, 61]);
    expect(dpNCut(p, 0, 2, 3)).toBeNull();
  });
});

describe("locatePoses / layoutPoses / cutPoses", () => {
  test("a pose that crosses the grid line keeps all its ink, and no neighbour takes any", () => {
    // 2x2 grid of 64 px cells. Pose 0's boots reach y = 70, six pixels into
    // the cell below; the pose below starts at y = 84.
    const sheet = blank(128, 128);
    fill(sheet, 20, 10, 24, 50);
    fill(sheet, 22, 60, 20, 11); // boots, to y = 70 inclusive
    fill(sheet, 84, 10, 24, 50);
    fill(sheet, 20, 84, 24, 40);
    fill(sheet, 84, 84, 24, 40);
    const located = locatePoses(sheet, { rows: 2, cols: 2, threshold: 16, cell: { width: 64, height: 64 } });
    expect(located.failed).toBeNull();
    expect(located.rows.natural).toBe(2);
    // The row cut is in the blank band between the boots (y 70) and row 1 (y 84).
    expect(located.rows.cuts![0]).toBeGreaterThan(70);
    expect(located.rows.cuts![0]).toBeLessThan(84);
    const pose0 = located.poses![0];
    expect(pose0.ink).toEqual({ x0: 20, y0: 10, x1: 44, y1: 71 });
    expect(pose0.cut).toBe(false);
    expect(pose0.edge).toBe(false);

    const layout = layoutPoses(located.poses!, grid64);
    // The cell grew downward just past the boots: 71 − 64 + margin.
    expect(layout.grew).toEqual({ left: 0, top: 0, right: 0, bottom: 71 - 64 + CELL_MARGIN });
    expect(layout.cell).toEqual({ width: 64, height: 64 + 71 - 64 + CELL_MARGIN });
    const cells = cutPoses(sheet, located, layout);
    const inkRows = (cell: { width: number; height: number; data: Uint8Array }) => {
      const rows: number[] = [];
      for (let y = 0; y < cell.height; y++) {
        for (let x = 0; x < cell.width; x++) if (cell.data[(y * cell.width + x) * 4 + 3]) { rows.push(y); break; }
      }
      return rows;
    };
    // Cell 00: drawn at its sheet place relative to its grid cell (y 10..70).
    expect(inkRows(cells[0])[0]).toBe(10);
    expect(inkRows(cells[0]).at(-1)).toBe(70);
    // Cell 02 (row 1, col 0): its own pose only — none of pose 0's boots.
    expect(inkRows(cells[2])[0]).toBe(84 - 64);
  });

  test("a sheet whose poses stay in their cells slices exactly as the fixed grid does", () => {
    const sheet = blank(128, 64);
    fill(sheet, 10, 12, 30, 40, [255, 0, 0, 255]);
    fill(sheet, 80, 8, 20, 50, [0, 0, 255, 255]);
    const located = locatePoses(sheet, { rows: 1, cols: 2, threshold: 16, cell: { width: 64, height: 64 } });
    const layout = layoutPoses(located.poses!, grid64);
    expect(layout.grew).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    const cells = cutPoses(sheet, located, layout);
    for (const [i, cell] of cells.entries()) {
      const fixed = new Uint8Array(64 * 64 * 4);
      for (let y = 0; y < 64; y++) fixed.set(sheet.data.subarray((y * 128 + 64 * i) * 4, (y * 128 + 64 * i + 64) * 4), y * 64 * 4);
      expect(Buffer.from(cell.data).equals(Buffer.from(fixed))).toBe(true);
    }
  });

  test("two poses drawn touching across the line are split there, and say so", () => {
    // A bar joins the two figures across x = 64: one component, half in each cell.
    const sheet = blank(128, 64);
    fill(sheet, 20, 10, 30, 44);
    fill(sheet, 78, 10, 30, 44);
    fill(sheet, 50, 30, 28, 4);
    const located = locatePoses(sheet, { rows: 1, cols: 2, threshold: 16, cell: { width: 64, height: 64 } });
    expect(located.failed).toBeNull();
    const [a, b] = located.poses!;
    // Neither pose took the whole joined blob.
    expect(a.ink!.x1).toBeLessThanOrEqual(located.cols[0].cuts![0]);
    expect(b.ink!.x0).toBeGreaterThanOrEqual(located.cols[0].cuts![0]);
    expect(a.cut || b.cut).toBe(true);
  });

  test("ink on the sheet's own edge is reported as drawn off the sheet", () => {
    const sheet = blank(128, 64);
    fill(sheet, 0, 12, 30, 40);
    fill(sheet, 80, 12, 30, 40);
    const located = locatePoses(sheet, { rows: 1, cols: 2, threshold: 16, cell: { width: 64, height: 64 } });
    expect(located.poses!.map((p) => p.edge)).toEqual([true, false]);
    // The cell still grows a margin there, so a whole pose never reads as clipped by its edge.
    expect(layoutPoses(located.poses!, grid64).grew.left).toBe(CELL_MARGIN);
  });

  test("a sheet with no ink cannot be segmented, and says what it found", () => {
    const located = locatePoses(blank(128, 128), { rows: 2, cols: 2, threshold: 16, cell: { width: 64, height: 64 } });
    expect(located.failed).toMatch(/found 0 row\(s\) of poses where 2 were asked/);
    expect(located.poses).toBeUndefined();
  });
});

describe("sizes.mjs", () => {
  test("a loop stands at its median, a one-shot at its first frame, both times the atlas scale", () => {
    expect(motionSize([492, 495, 495, 494], { scale: 0.5, loop: true })).toMatchObject({
      standing: 494.5, from: "median", shipped: 247.25, min: 492, max: 495, first: 492,
    });
    // Kagari's attack: lunges drag its median to 458.5, its rest pose is 492.
    const attack = motionSize([492, 457, 518, 449, 434, 426, 383, 367, 491, 492], { scale: 0.5, loop: false });
    expect(attack).toMatchObject({ standing: 492, from: "first", shipped: 246 });
    expect(motionSize([null, null])).toBeNull();
  });

  test("the spread is tallest over shortest; over the bar it is said, with the image to look at", () => {
    const sizes = [
      { id: "walk-front", size: motionSize([481, 480, 479], { loop: true }) },
      { id: "walk-right", size: motionSize([456, 457, 456], { loop: true }) },
    ];
    const comparison = sizeSpread(sizes)!;
    expect(comparison.tallest).toBe("walk-front");
    expect(comparison.shortest).toBe("walk-right");
    expect(comparison.spread).toBeCloseTo((480 - 456) / 456, 4);
    expect(comparison.scaleToMatch["walk-front"]).toBeLessThan(1);
    const warning = sizeWarning(sizes, comparison, { picture: "/x/sizes.png" });
    expect(warning).toContain("walk-front stands 480 px");
    expect(warning).toContain("/x/sizes.png");
    // A set within the bar says nothing.
    const close = [
      { id: "idle", size: motionSize([247], { loop: true }) },
      { id: "walk", size: motionSize([246], { loop: true }) },
    ];
    expect(sizeWarning(close, sizeSpread(close))).toBeNull();
    expect(SIZE_SPREAD_WARN).toBeGreaterThan(0.033);
    expect(SIZE_SPREAD_WARN).toBeLessThan(0.048);
  });

  test("pixel art within two logical pixels is as close as its lattice can say", () => {
    const slime = [
      { id: "idle", size: motionSize([27, 26, 24, 29, 29, 31, 26, 25], { loop: true }) },
      { id: "jump", size: motionSize([25, 20, 32, 33], { loop: false }) },
    ];
    const comparison = sizeSpread(slime)!;
    expect(comparison.spread).toBeGreaterThan(SIZE_SPREAD_WARN);
    expect(sizeWarning(slime, comparison, { block: 1 })).toBeNull();
    expect(sizeWarning(slime, comparison, { block: 0 })).not.toBeNull();
  });
});
