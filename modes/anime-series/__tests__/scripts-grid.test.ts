/**
 * grid.mjs — panel rectangles, panel aspect, and the pre-flight clip size.
 */

import { describe, expect, test } from "bun:test";

import { IMAGE_ASPECTS, REFERENCE_ASPECT, assumedVideoSize, cellRect, gridCells, nearestAspect, panelAspect, ratioValue, referenceAspectOutside } from "../skill/scripts/grid.mjs";

describe("cell rectangles", () => {
  test("cells tile the image exactly, with no gap and no overlap", () => {
    for (const [w, h, n] of [[1536, 864, 9], [1537, 865, 6], [1000, 1000, 12], [1920, 1080, 7]] as const) {
      const cells = gridCells(w, h, n);
      expect(cells).toHaveLength(n);
      const area = cells.reduce((sum, c) => sum + c.w * c.h, 0);
      const full = (Math.max(...cells.map((c) => c.x + c.w)) * Math.max(...cells.map((c) => c.y + c.h)));
      // Every row is complete except possibly the last for an untidy count.
      if (n === 9 || n === 6 || n === 12) expect(area).toBe(full);
      expect(Math.max(...cells.map((c) => c.x + c.w))).toBe(w);
      for (const c of cells) expect(c.w > 0 && c.h > 0).toBe(true);
    }
  });

  test("row-major numbering", () => {
    expect(cellRect(1536, 864, 3, 3, 1)).toEqual({ x: 0, y: 0, w: 512, h: 288, row: 1, col: 1 });
    expect(cellRect(1536, 864, 3, 3, 6)).toEqual({ x: 1024, y: 288, w: 512, h: 288, row: 2, col: 3 });
    expect(cellRect(1536, 864, 2, 3, 4)).toEqual({ x: 0, y: 432, w: 512, h: 432, row: 2, col: 1 });
  });

  test("rounding follows the edges, not the cell size", () => {
    const a = cellRect(1000, 100, 1, 3, 1);
    const b = cellRect(1000, 100, 1, 3, 2);
    const c = cellRect(1000, 100, 1, 3, 3);
    expect([a.w, b.w, c.w]).toEqual([333, 334, 333]);
    expect(a.x + a.w).toBe(b.x);
    expect(b.x + b.w).toBe(c.x);
  });

  test("out-of-range panels are refused", () => {
    expect(() => cellRect(100, 100, 3, 3, 0)).toThrow();
    expect(() => cellRect(100, 100, 3, 3, 10)).toThrow();
  });
});

describe("aspects", () => {
  test("ratio strings parse; garbage is refused", () => {
    expect(ratioValue("16:9")).toBeCloseTo(16 / 9);
    expect(() => ratioValue("wide")).toThrow(/16:9/);
  });

  test("a 3×3 grid of 16:9 frames has 16:9 panels; a 2×3 grid has near-square ones", () => {
    expect(panelAspect("16:9", 9)).toBe("16:9");
    expect(panelAspect("16:9", 6)).toBe("4:3");
    expect(panelAspect("9:16", 9)).toBe("9:16");
  });

  test("nearest aspect on a log scale", () => {
    expect(nearestAspect(1920, 1080)).toBe("16:9");
    expect(nearestAspect(1000, 1000)).toBe("1:1");
    expect(nearestAspect(2400, 1000)).toBe("21:9");
  });
});

describe("reference images", () => {
  test("a reference outside 0.4–2.5 wide to 1 high is named; everything this mode draws is inside", () => {
    expect(REFERENCE_ASPECT).toEqual({ min: 0.4, max: 2.5 });
    // A four-view turnaround laid out in one row.
    expect(referenceAspectOutside(3200, 800)).toBe(4);
    expect(referenceAspectOutside(399, 1000)).toBeCloseTo(0.399);
    expect(referenceAspectOutside(2500, 1000)).toBeNull();
    expect(referenceAspectOutside(400, 1000)).toBeNull();
    for (const ratio of IMAGE_ASPECTS) {
      const [w, h] = ratio.split(":").map(Number);
      expect(referenceAspectOutside(w, h)).toBeNull();
    }
    // An unknown size is not a finding.
    expect(referenceAspectOutside(0, 864)).toBeNull();
    expect(referenceAspectOutside(Number.NaN, 864)).toBeNull();
  });
});

describe("pre-flight clip size", () => {
  test("keeps the tier's pixel area at the series ratio", () => {
    expect(assumedVideoSize("480p", "16:9")).toEqual({ width: 854, height: 480 });
    expect(assumedVideoSize("480p", "9:16")).toEqual({ width: 480, height: 854 });
    expect(assumedVideoSize("480p", "1:1")).toEqual({ width: 640, height: 640 });
    expect(assumedVideoSize("720p", "16:9")).toEqual({ width: 1280, height: 720 });
    expect(() => assumedVideoSize("4k", "16:9")).toThrow(/480p/);
  });
});
