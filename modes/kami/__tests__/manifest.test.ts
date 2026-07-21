import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import kamiManifest from "../manifest.js";

const derive = kamiManifest.init!.deriveParams!;
const DIAGRAMS_DIR = join(import.meta.dir, "..", "seed", "_shared", "assets", "diagrams");

// The 18-type catalog synced from upstream tw93/kami V1.10.0:
// 14 hand-drawn originals + architecture-board + 3 Mermaid-sourced statics.
const DIAGRAM_FILES = [
  "architecture",
  "architecture-board",
  "bar-chart",
  "candlestick",
  "class",
  "donut-chart",
  "er",
  "flowchart",
  "layer-stack",
  "line-chart",
  "quadrant",
  "sequence",
  "state-machine",
  "swimlane",
  "timeline",
  "tree",
  "venn",
  "waterfall",
];

describe("kami version + changelog contract", () => {
  it("is at the upstream-V1.10.0 sync version", () => {
    expect(kamiManifest.version).toBe("1.5.0");
  });

  it("carries a changelog entry for the current version", () => {
    const entries = kamiManifest.changelog?.[kamiManifest.version];
    expect(entries).toBeDefined();
    expect(entries!.length).toBeGreaterThan(0);
    expect(entries!.length).toBeLessThanOrEqual(6);
  });

  it("changelog bullets are single-line, markdown-free, no trailing period", () => {
    for (const entry of kamiManifest.changelog?.[kamiManifest.version] ?? []) {
      expect(entry).not.toInclude("\n");
      expect(entry).not.toMatch(/[*_`#]|\]\(/);
      expect(entry).not.toMatch(/[.。]$/);
    }
  });
});

describe("kami diagram catalog (upstream V1.10.0)", () => {
  it("ships all 18 diagram templates", () => {
    for (const name of DIAGRAM_FILES) {
      expect(existsSync(join(DIAGRAMS_DIR, `${name}.html`))).toBe(true);
    }
  });

  it("every diagram is self-contained — inline SVG, no live scripts", () => {
    for (const name of DIAGRAM_FILES) {
      const html = readFileSync(join(DIAGRAMS_DIR, `${name}.html`), "utf8");
      expect(html).toInclude("<svg");
      expect(html).not.toInclude("<script");
    }
  });
});

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
