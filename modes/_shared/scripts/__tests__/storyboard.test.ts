import { describe, expect, test } from "bun:test";
import {
  pickGrid,
  pickImageSize,
  computeBboxes,
  assemblePrompt,
  buildStdoutJson,
} from "../storyboard.mjs";

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

describe("assemblePrompt", () => {
  test("includes grid + cell aspect + numbering instruction", () => {
    const grid = { rows: 3, cols: 2 };
    const out = assemblePrompt({
      userPrompt: "Six dance moves",
      grid,
      aspect: "9:16",
      includeAnnotations: false,
    });
    expect(out).toMatch(/3.{1,3}rows/i);
    expect(out).toMatch(/2.{1,3}col/i);
    expect(out).toMatch(/9:16/);
    expect(out).toMatch(/1.{0,5}6/); // numbering
    expect(out).toMatch(/Six dance moves/);
  });

  test("includes annotation color system when enabled", () => {
    const grid = { rows: 2, cols: 2 };
    const out = assemblePrompt({
      userPrompt: "x",
      grid,
      aspect: "1:1",
      includeAnnotations: true,
    });
    expect(out).toMatch(/red/i);
    expect(out).toMatch(/blue/i);
    expect(out).toMatch(/green/i);
    expect(out).toMatch(/orange/i);
    expect(out).toMatch(/purple/i);
    expect(out).toMatch(/black/i);
  });

  test("excludes annotations when disabled", () => {
    const grid = { rows: 2, cols: 2 };
    const out = assemblePrompt({
      userPrompt: "x",
      grid,
      aspect: "1:1",
      includeAnnotations: false,
    });
    // No "annotation color system" preamble
    expect(out).not.toMatch(/annotation color system/i);
    // But the basic grid prelude should still be there
    expect(out).toMatch(/CONSISTENCY RULE/i);
  });

  test("includes faithfulness and consistency directives by default", () => {
    const out = assemblePrompt({
      userPrompt: "x",
      grid: { rows: 2, cols: 2 },
      aspect: "1:1",
      includeAnnotations: false,
    });
    expect(out).toMatch(/CONSISTENCY RULE.*STRICT/i);
  });
});

describe("buildStdoutJson", () => {
  test("structure matches contract", () => {
    const out = buildStdoutJson({
      compositePath: "/tmp/sb/composite.png",
      compositeUrl: "https://example.com/composite.png",
      endpoint: "openai/gpt-image-2",
      grid: { rows: 2, cols: 2 },
      imageSize: { preset: "square_hd", width: 1024, height: 1024 },
      finalPrompt: "test prompt",
      panels: [
        { index: 1, row: 0, col: 0, bbox: { x: 0, y: 0, w: 512, h: 512 }, path: "/tmp/sb/panel-01.png" },
        { index: 2, row: 0, col: 1, bbox: { x: 512, y: 0, w: 512, h: 512 }, path: "/tmp/sb/panel-02.png" },
        { index: 3, row: 1, col: 0, bbox: { x: 0, y: 512, w: 512, h: 512 }, path: "/tmp/sb/panel-03.png" },
        { index: 4, row: 1, col: 1, bbox: { x: 512, y: 512, w: 512, h: 512 }, path: "/tmp/sb/panel-04.png" },
      ],
      refs: [],
      baseName: "panel",
      aspect: "1:1",
      panelCount: 4,
    });

    expect(out.composite.assetId).toBeTruthy();
    expect(out.panels).toHaveLength(4);
    expect(out.panels[0].assetId).toBeTruthy();
    expect(out.panels[0].assetId).toContain("panel-01");
    expect(out.suggestedAssets).toHaveLength(5); // 1 composite + 4 panels
    expect(out.suggestedProvenance).toHaveLength(5);

    // Composite has fromAssetId: null
    expect(out.suggestedProvenance[0].fromAssetId).toBeNull();
    // Slices have fromAssetId pointing at composite
    expect(out.suggestedProvenance[1].fromAssetId).toBe(out.composite.assetId);
    expect(out.suggestedProvenance[1].operation.type).toBe("slice");
    expect(out.suggestedProvenance[1].operation.params.bbox).toBeTruthy();

    // Final prompt is preserved
    expect(out.finalPrompt).toBe("test prompt");
  });
});
