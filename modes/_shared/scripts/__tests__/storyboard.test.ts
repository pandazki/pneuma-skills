import { describe, expect, test } from "bun:test";
import { pickGrid, pickImageSize, computeBboxes } from "../storyboard.mjs";

describe("pickGrid", () => {
  test("4 panels → 2x2 regardless of aspect", () => {
    expect(pickGrid(4, "16:9")).toEqual({ rows: 2, cols: 2 });
    expect(pickGrid(4, "9:16")).toEqual({ rows: 2, cols: 2 });
    expect(pickGrid(4, "1:1")).toEqual({ rows: 2, cols: 2 });
  });

  test("6 panels → 3x2 for landscape, 2x3 for portrait", () => {
    expect(pickGrid(6, "16:9")).toEqual({ rows: 2, cols: 3 });
    expect(pickGrid(6, "9:16")).toEqual({ rows: 3, cols: 2 });
    expect(pickGrid(6, "1:1")).toEqual({ rows: 2, cols: 3 });
  });

  test("8 panels → 4x2 for landscape, 2x4 for portrait", () => {
    expect(pickGrid(8, "16:9")).toEqual({ rows: 2, cols: 4 });
    expect(pickGrid(8, "9:16")).toEqual({ rows: 4, cols: 2 });
  });

  test("9 panels → 3x3 always", () => {
    expect(pickGrid(9, "16:9")).toEqual({ rows: 3, cols: 3 });
    expect(pickGrid(9, "9:16")).toEqual({ rows: 3, cols: 3 });
  });

  test("12 panels → 4x3 for landscape, 3x4 for portrait", () => {
    expect(pickGrid(12, "16:9")).toEqual({ rows: 3, cols: 4 });
    expect(pickGrid(12, "9:16")).toEqual({ rows: 4, cols: 3 });
  });

  test("16 panels → 4x4 always", () => {
    expect(pickGrid(16, "16:9")).toEqual({ rows: 4, cols: 4 });
    expect(pickGrid(16, "9:16")).toEqual({ rows: 4, cols: 4 });
  });

  test("rejects unsupported panel counts", () => {
    expect(() => pickGrid(5, "16:9")).toThrow(/panel count/i);
    expect(() => pickGrid(7, "16:9")).toThrow(/panel count/i);
    expect(() => pickGrid(10, "16:9")).toThrow(/panel count/i);
    expect(() => pickGrid(13, "16:9")).toThrow(/panel count/i);
  });

  test("rejects unknown aspect", () => {
    expect(() => pickGrid(4, "21:9")).toThrow(/aspect/i);
  });
});

describe("pickImageSize", () => {
  test("portrait 9:16 video chooses 1024x1536", () => {
    expect(pickImageSize({ rows: 4, cols: 2 }, "9:16")).toEqual({
      preset: "portrait_16_9",
      width: 1024,
      height: 1536,
    });
  });

  test("landscape 16:9 video chooses 1536x1024", () => {
    expect(pickImageSize({ rows: 2, cols: 4 }, "16:9")).toEqual({
      preset: "landscape_16_9",
      width: 1536,
      height: 1024,
    });
  });

  test("1:1 video with square grid chooses 1024x1024", () => {
    expect(pickImageSize({ rows: 2, cols: 2 }, "1:1")).toEqual({
      preset: "square_hd",
      width: 1024,
      height: 1024,
    });
  });

  test("9:16 with 3x3 grid still chooses portrait", () => {
    // square grid + portrait aspect → portrait composite
    expect(pickImageSize({ rows: 3, cols: 3 }, "9:16")).toEqual({
      preset: "portrait_16_9",
      width: 1024,
      height: 1536,
    });
  });
});

describe("computeBboxes", () => {
  test("4 panels in 2x2 grid on 1024x1024 (1:1) video", () => {
    const grid = { rows: 2, cols: 2 };
    const imgSize = { width: 1024, height: 1024 };
    const result = computeBboxes(grid, imgSize, "1:1");
    expect(result.cellWidth).toBe(result.cellHeight); // 1:1
    expect(result.panels).toHaveLength(4);
    // All cells should be the same size
    const cellW = result.panels[0].bbox.w;
    const cellH = result.panels[0].bbox.h;
    for (const p of result.panels) {
      expect(p.bbox.w).toBe(cellW);
      expect(p.bbox.h).toBe(cellH);
    }
    // panels numbered left-to-right top-to-bottom
    expect(result.panels[0].row).toBe(0);
    expect(result.panels[0].col).toBe(0);
    expect(result.panels[1].row).toBe(0);
    expect(result.panels[1].col).toBe(1);
    expect(result.panels[2].row).toBe(1);
    expect(result.panels[2].col).toBe(0);
    expect(result.panels[3].row).toBe(1);
    expect(result.panels[3].col).toBe(1);
  });

  test("6 panels in 3x2 grid on 1024x1024 (16:9 video)", () => {
    // 3 cols x 2 rows, each cell is 16:9
    const grid = { rows: 2, cols: 3 };
    const imgSize = { width: 1024, height: 1024 };
    const result = computeBboxes(grid, imgSize, "16:9");
    // Each cell aspect = 16:9 = 1.778
    for (const p of result.panels) {
      const ratio = p.bbox.w / p.bbox.h;
      expect(ratio).toBeCloseTo(16 / 9, 1);
    }
  });

  test("9:16 cells in portrait composite 1024x1536", () => {
    const grid = { rows: 4, cols: 3 };
    const imgSize = { width: 1024, height: 1536 };
    const result = computeBboxes(grid, imgSize, "9:16");
    expect(result.panels).toHaveLength(12);
    for (const p of result.panels) {
      const ratio = p.bbox.w / p.bbox.h;
      expect(ratio).toBeCloseTo(9 / 16, 1);
    }
  });

  test("panels indexed 1..N in numbering order", () => {
    const grid = { rows: 2, cols: 2 };
    const imgSize = { width: 1024, height: 1024 };
    const result = computeBboxes(grid, imgSize, "1:1");
    expect(result.panels.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  test("bbox coordinates are non-negative integers within image", () => {
    const grid = { rows: 3, cols: 2 };
    const imgSize = { width: 1024, height: 1536 };
    const result = computeBboxes(grid, imgSize, "9:16");
    for (const p of result.panels) {
      expect(Number.isInteger(p.bbox.x)).toBe(true);
      expect(Number.isInteger(p.bbox.y)).toBe(true);
      expect(p.bbox.x).toBeGreaterThanOrEqual(0);
      expect(p.bbox.y).toBeGreaterThanOrEqual(0);
      expect(p.bbox.x + p.bbox.w).toBeLessThanOrEqual(imgSize.width);
      expect(p.bbox.y + p.bbox.h).toBeLessThanOrEqual(imgSize.height);
    }
  });
});
