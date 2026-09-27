/**
 * recolor.mjs — colourways as a baked palette swap, pinned as a module.
 *
 * The first block is aldegad/sprite-gen's own bake suite, ported
 * (tests/effects/test_recolor_bake.py @fbd1a08) onto the same 8 x 4 fixture:
 * determinism, exact and tolerance substitution, and the "nothing leaves
 * silently" report. The rest pins what this port changed or added: the
 * colourway checks, tie-breaking, the cap, merging a character's motions, the
 * draft and the swatch sheet.
 *
 * Pure computation, no ffmpeg: the CLI (`recolor`, `recolor-palette`,
 * `register-recolor`) is pinned in recolor-cli.test.ts.
 */

import { describe, expect, test } from "bun:test";

import {
  ALPHA_THRESHOLD, RECOLOR_KIND, RecolorError, UNCOVERED_CAP, checkVariant, countColors, draftRecolorMap,
  formatHex, MAX_SWATCH_PIXELS, MAX_SWATCHES, mergeTallies, newTally, offPalette, parseRecolorMap, recolorImage, sameVariant, swatchSheet,
  tallyReport, type Rgb, type RgbaImage,
} from "../skill/scripts/recolor.mjs";

// Flat art colours in upstream's fixture sheet.
const COAT: Rgb = [180, 40, 40]; // mapped by every variant
const TRIM: Rgb = [40, 80, 180]; // opaque, never mapped -> passthrough
const GLOW: Rgb = [10, 200, 90]; // opaque, never mapped -> passthrough
const NEAR_COAT: Rgb = [182, 42, 41]; // 2 away from COAT (Chebyshev) -> tolerance only

function blank(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}
function set(image: RgbaImage, x: number, y: number, [r, g, b]: Rgb, a = 255) {
  const i = (y * image.width + x) * 4;
  image.data.set([r, g, b, a], i);
}
function get(image: RgbaImage, x: number, y: number) {
  const i = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(i, i + 4));
}

/** Upstream `_build_sheet`: H=4, W=8, fully transparent but for these. */
function buildSheet(): RgbaImage {
  const image = blank(8, 4);
  for (let x = 0; x < 4; x++) set(image, x, 0, COAT);
  for (let x = 0; x < 2; x++) set(image, x, 1, TRIM);
  for (let x = 2; x < 4; x++) set(image, x, 1, GLOW);
  set(image, 0, 2, NEAR_COAT);
  set(image, 1, 2, COAT, 4); // below the alpha floor -> ignored, not recoloured
  return image;
}

/** Upstream `_spec`: two colourways over COAT, "green" optionally with a source the sheet lacks. */
function spec({ tolerance = 0, extraSource = false } = {}) {
  const greenMap: Record<string, string> = { [formatHex(COAT)]: "#14c814" };
  if (extraSource) greenMap["#010203"] = "#ffffff";
  return parseRecolorMap({
    kind: RECOLOR_KIND,
    version: 1,
    variants: [
      { name: "green", map: greenMap, ...(tolerance ? { tolerance } : {}) },
      { name: "gold", map: { [formatHex(COAT)]: "#f0c000" }, ...(tolerance ? { tolerance } : {}) },
    ],
  });
}

function bake(image: RgbaImage, variant: ReturnType<typeof spec>[number]) {
  const tally = newTally(variant);
  const out = recolorImage(image, tally);
  return { out, report: tallyReport(tally) };
}

describe("the bake (test_recolor_bake.py)", () => {
  test("is byte-deterministic", () => {
    for (const variant of spec()) {
      const a = bake(buildSheet(), variant).out;
      const b = bake(buildSheet(), variant).out;
      expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    }
  });

  test("an exact swap hits only the exact colour and keeps the geometry", () => {
    const base = buildSheet();
    const before = new Uint8Array(base.data);
    const { out } = bake(base, spec()[0]);
    expect(get(out, 0, 0)).toEqual([0x14, 0xc8, 0x14, 255]);
    expect(get(out, 0, 1).slice(0, 3)).toEqual(TRIM);
    expect(get(out, 2, 1).slice(0, 3)).toEqual(GLOW);
    expect(get(out, 0, 2).slice(0, 3)).toEqual(NEAR_COAT);
    // The sub-threshold COAT pixel keeps its RGB.
    expect(get(out, 1, 2)).toEqual([...COAT, 4]);
    // Alpha is the base's, byte for byte; the input was not touched.
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(base.data[i]);
    expect(Buffer.from(base.data).equals(Buffer.from(before))).toBe(true);
  });

  test("the report names substitutions, what passed through and what never matched", () => {
    const { report } = bake(buildSheet(), spec({ extraSource: true })[0]);
    expect(report.substitutions.find((s) => s.from === formatHex(COAT))!.pixels).toBe(4);
    expect(report.substituted).toBe(4);
    expect(report.unmatched).toEqual([{ from: "#010203", to: "#ffffff" }]);
    const passed = Object.fromEntries(report.uncovered.top.map((c) => [c.hex, c.pixels]));
    expect(passed[formatHex(TRIM)]).toBe(2);
    expect(passed[formatHex(GLOW)]).toBe(2);
    expect(passed[formatHex(NEAR_COAT)]).toBe(1);
    expect(report.uncovered.pixels).toBe(5);
    expect(report.uncovered.colors).toBe(3);
    expect(report.uncovered.truncated).toBeUndefined();
    // Sorted as upstream sorts: by source, and uncovered by count then hex.
    expect(report.substitutions.map((s) => s.from)).toEqual(["#010203", formatHex(COAT)]);
    expect(report.uncovered.top.map((c) => c.hex)).toEqual([formatHex(GLOW), formatHex(TRIM), formatHex(NEAR_COAT)]);
  });

  test("a tolerance takes the near colour too, nearest source winning", () => {
    const { out, report } = bake(buildSheet(), spec({ tolerance: 3 })[0]);
    expect(get(out, 0, 2).slice(0, 3)).toEqual([0x14, 0xc8, 0x14]);
    expect(report.substitutions.find((s) => s.from === formatHex(COAT))!.pixels).toBe(5);
    expect(report.tolerance).toBe(3);
  });
});

describe("what this port changed or added", () => {
  test("a tie goes to the earlier map entry, and the nearest one wins inside the window", () => {
    const image = blank(3, 1);
    set(image, 0, 0, [100, 100, 100]);
    set(image, 1, 0, [104, 100, 100]);
    set(image, 2, 0, [96, 100, 100]);
    // #666464 (102) and #626464 (98) are both 2 from the middle grey: the
    // first listed takes it; each side's own grey goes to its nearer source.
    const [variant] = parseRecolorMap({
      kind: RECOLOR_KIND,
      variants: [{ name: "tie", tolerance: 8, map: { "#666464": "#ff0000", "#626464": "#0000ff" } }],
    });
    const { out, report } = bake(image, variant);
    expect(get(out, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
    expect(get(out, 1, 0).slice(0, 3)).toEqual([255, 0, 0]);
    expect(get(out, 2, 0).slice(0, 3)).toEqual([0, 0, 255]);
    expect(report.substitutions).toEqual([
      { from: "#626464", to: "#0000ff", pixels: 1 },
      { from: "#666464", to: "#ff0000", pixels: 2 },
    ]);
    // Reversed order, reversed winner of the tie — and so not the same swap.
    const [reversed] = parseRecolorMap({
      kind: RECOLOR_KIND,
      variants: [{ name: "tie", tolerance: 8, map: { "#626464": "#0000ff", "#666464": "#ff0000" } }],
    });
    expect(get(bake(image, reversed).out, 0, 0).slice(0, 3)).toEqual([0, 0, 255]);
    expect(sameVariant(variant, reversed)).toBe(false);
    // The window is Chebyshev: 104 is 2 from #666464 and inside a tolerance
    // of 2; 96 is 6 from it and stays.
    const [one] = parseRecolorMap({ kind: RECOLOR_KIND, variants: [{ name: "one", tolerance: 2, map: { "#666464": "#00ff00" } }] });
    const r = bake(image, one);
    expect(get(r.out, 1, 0).slice(0, 3)).toEqual([0, 255, 0]);
    expect(get(r.out, 2, 0).slice(0, 3)).toEqual([96, 100, 100]);
    expect(r.report.uncovered.top).toEqual([{ hex: "#606464", pixels: 1 }]);
  });

  test("colourways are checked whole, and every refusal says what to write", () => {
    const refuse = (raw: unknown) => {
      try {
        checkVariant(raw, "v");
      } catch (error) {
        expect(error).toBeInstanceOf(RecolorError);
        return (error as Error).message;
      }
      throw new Error("expected a refusal");
    };
    expect(refuse({ name: "Red Team", map: { "#000000": "#ffffff" } })).toContain("not a name files can carry");
    expect(refuse({ name: "red", map: {} })).toContain("empty map");
    expect(refuse({ name: "red", map: { "000000": "#ffffff" } })).toContain("'000000' is not a #rrggbb colour");
    expect(refuse({ name: "red", map: { "#000000": "red" } })).toContain("not a #rrggbb colour");
    expect(refuse({ name: "red", map: { "#AABBCC": "#000000", "#aabbcc": "#111111" } })).toContain("#aabbcc is mapped twice");
    expect(refuse({ name: "red", map: { "#000000": "#ffffff" }, tolerance: 2.5 })).toContain("whole number from 0");
    expect(refuse({ name: "red", map: { "#000000": "#ffffff" }, tolerance: 300 })).toContain("whole number from 0");
    // Upper case is read and written lower; a 0 tolerance is exact and not written.
    expect(checkVariant({ name: "red", map: { "#AABBCC": "#FF0000" }, tolerance: 0 })).toEqual({ name: "red", map: { "#aabbcc": "#ff0000" } });
    expect(() => parseRecolorMap({ kind: "sprite-gen-recolor", variants: [] })).toThrow("not a recolor map");
    expect(() => parseRecolorMap({ kind: RECOLOR_KIND, variants: [] })).toThrow("has no colourways");
    expect(() => parseRecolorMap({
      kind: RECOLOR_KIND,
      variants: [{ name: "a", map: { "#000000": "#111111" } }, { name: "a", map: { "#000000": "#222222" } }],
    })).toThrow("two colourways are named 'a'");
    // The draft's scaffolding is ignored.
    expect(parseRecolorMap({ kind: RECOLOR_KIND, colors: [1, 2], help: "x", variants: [{ name: "a", map: { "#000000": "#111111" } }] }))
      .toEqual([{ name: "a", map: { "#000000": "#111111" } }]);
  });

  test("the uncovered list stops at the cap and says how many it left out", () => {
    const image = blank(UNCOVERED_CAP + 6, 1);
    for (let x = 0; x < image.width; x++) set(image, x, 0, [x, 1, 2]);
    const [variant] = parseRecolorMap({ kind: RECOLOR_KIND, variants: [{ name: "a", map: { "#000102": "#ffffff" } }] });
    const { report } = bake(image, variant);
    expect(report.uncovered.colors).toBe(UNCOVERED_CAP + 5);
    expect(report.uncovered.top.length).toBe(UNCOVERED_CAP);
    expect(report.uncovered.truncated).toBe(5);
  });

  test("a character's motions merge into one report: an entry is unmatched only when no motion used it", () => {
    const [variant] = spec({ extraSource: true });
    const a = newTally(variant);
    recolorImage(buildSheet(), a);
    const plain = blank(2, 1);
    set(plain, 0, 0, [1, 2, 3]);
    set(plain, 1, 0, TRIM);
    const b = newTally(variant);
    recolorImage(plain, b);
    // Each motion alone misses one entry…
    expect(tallyReport(a).unmatched.map((u) => u.from)).toEqual(["#010203"]);
    expect(tallyReport(b).unmatched.map((u) => u.from)).toEqual([formatHex(COAT)]);
    const merged = tallyReport(mergeTallies([a, b]));
    expect(merged.unmatched).toEqual([]);
    expect(merged.substituted).toBe(5);
    expect(merged.uncovered.top.find((c) => c.hex === formatHex(TRIM))!.pixels).toBe(3);
    expect(() => mergeTallies([a, newTally(spec()[1])])).toThrow("two different colourways");
  });

  test("the draft lists what the frames use, most used first, and the palette's unused colours last", () => {
    const counts = countColors([buildSheet()]);
    expect(counts.get((180 << 16) | (40 << 8) | 40)).toBe(4); // the sub-threshold pixel is not counted
    const palette: Rgb[] = [COAT, TRIM, GLOW, [0, 0, 0]];
    expect(offPalette(counts, palette)).toEqual({ colors: 1, pixels: 1 });
    const draft = draftRecolorMap({ palette: "knight-palette", paletteColors: palette, counts, character: "Knight" });
    expect(draft.kind).toBe(RECOLOR_KIND);
    expect(draft.colors).toEqual([
      { hex: formatHex(COAT), pixels: 4, share: 0.4444, swatch: 1 },
      { hex: formatHex(GLOW), pixels: 2, share: 0.2222, swatch: 2 },
      { hex: formatHex(TRIM), pixels: 2, share: 0.2222, swatch: 3 },
      { hex: formatHex(NEAR_COAT), pixels: 1, share: 0.1111, inPalette: false, swatch: 4 },
      { hex: "#000000", pixels: 0 },
    ]);
    // Its one colourway is a template: recolor refuses it until it names a colour.
    expect(() => parseRecolorMap(draft)).toThrow("empty map");
  });

  test("the swatch sheet marks each colour's pixels in a colour none of them is near", () => {
    const sheet = buildSheet();
    const entries = [COAT, GLOW].map((rgb) => ({ rgb, image: sheet }));
    const { image, mark, scale, cell } = swatchSheet(entries, { cellHeight: 30, cols: 8 });
    expect(scale).toBe(8); // a 3-row sprite, scaled by the most a cell allows
    expect(image.width).toBe(2 * cell.width);
    expect(image.height).toBe(cell.height);
    const markRgb = [parseInt(mark.slice(1, 3), 16), parseInt(mark.slice(3, 5), 16), parseInt(mark.slice(5, 7), 16)];
    // Every mark pixel of cell 1 sits where COAT is; cell 2's where GLOW is.
    const count = (x0: number) => {
      let n = 0;
      for (let y = 0; y < image.height; y++) {
        for (let x = x0; x < x0 + cell.width; x++) {
          const [r, g, b] = get(image, x, y);
          if (r === markRgb[0] && g === markRgb[1] && b === markRgb[2]) n++;
        }
      }
      return n;
    };
    expect(count(0)).toBe(4 * scale * scale);
    expect(count(cell.width)).toBe(2 * scale * scale);
    // Its alpha is opaque everywhere: a picture to look at, not a sprite.
    for (let i = 3; i < image.data.length; i += 4) expect(image.data[i]).toBe(255);
    expect(ALPHA_THRESHOLD).toBe(8);
  });

  test("a sheet of more colours than a palette holds, or of more pixels than a budget, is refused before it is drawn (R2-4)", () => {
    const sheet = buildSheet();
    const many = Array.from({ length: MAX_SWATCHES + 1 }, (_, i) => ({ rgb: [i % 256, (i >> 8) * 40, 7] as [number, number, number], image: sheet }));
    expect(() => swatchSheet(many)).toThrow(/257 colours in use — a swatch sheet draws at most 256.*--pixel/);
    // 256 cells of an unfitted 1024 px frame drawn at 1x: ~270 MP.
    const huge = { width: 1024, height: 1024, data: new Uint8Array(1024 * 1024 * 4).fill(255) };
    const wide = Array.from({ length: 256 }, (_, i) => ({ rgb: [i, 0, 0] as [number, number, number], image: huge }));
    expect(() => swatchSheet(wide)).toThrow(/over 32 MP/);
    expect(MAX_SWATCH_PIXELS).toBe(32_000_000);
  });
});
