import { describe, it, expect } from "bun:test";
import kamiManifest from "../manifest.js";

const derive = kamiManifest.init!.deriveParams!;

describe("kami deriveParams", () => {
  it("derives A4 portrait", () => {
    const d = derive({ paperSize: "A4", orientation: "Portrait" });
    expect(d.pageWidthMm).toBe(210);
    expect(d.pageHeightMm).toBe(297);
  });
  it("derives A4 landscape", () => {
    const d = derive({ paperSize: "A4", orientation: "Landscape" });
    expect(d.pageWidthMm).toBe(297);
    expect(d.pageHeightMm).toBe(210);
  });
  it("derives Letter portrait", () => {
    const d = derive({ paperSize: "Letter", orientation: "Portrait" });
    expect(d.pageWidthMm).toBe(216);
    expect(d.pageHeightMm).toBe(279);
  });
  it("derives A5 landscape", () => {
    const d = derive({ paperSize: "A5", orientation: "Landscape" });
    expect(d.pageWidthMm).toBe(210);
    expect(d.pageHeightMm).toBe(148);
  });
  it("throws on unknown paper size", () => {
    expect(() => derive({ paperSize: "Letter2", orientation: "Portrait" })).toThrow();
  });
  it("preserves original params alongside derived fields", () => {
    const d = derive({ paperSize: "A4", orientation: "Portrait" });
    expect(d.paperSize).toBe("A4");
    expect(d.orientation).toBe("Portrait");
  });
});
