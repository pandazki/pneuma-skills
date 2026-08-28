import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import kamiManifest from "../manifest.js";

const derive = kamiManifest.init!.deriveParams!;
const DIAGRAMS_DIR = join(import.meta.dir, "..", "seed", "_shared", "assets", "diagrams");

// The 18-type catalog synced from upstream tw93/kami V1.13.0:
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
  it("is at the upstream-V1.13.0 sync version", () => {
    expect(kamiManifest.version).toBe("1.6.0");
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

describe("kami diagram catalog (upstream V1.13.0)", () => {
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

  // Upstream V1.13.0 stopped letting SVG labels inherit their typeface. The
  // point is portability: SKILL.md tells the agent to lift the <svg> block out
  // of these files and drop it into a content set, and an inherited stack would
  // then resolve against whatever that page happens to set. A Latin-first stack
  // is the specific failure — it hands each ideograph off separately, so one
  // Chinese label can come back drawn in two faces.
  it("no diagram label inherits its typeface", () => {
    for (const name of DIAGRAM_FILES) {
      const html = readFileSync(join(DIAGRAMS_DIR, `${name}.html`), "utf8");
      expect(html).not.toInclude('font-family="inherit"');
    }
  });

  // Upstream normalised every prose label to a CJK-first stack and deliberately
  // left two files alone: candlestick and waterfall label their axes with
  // numbers, so a Latin serif is the right face there. That exception is worth
  // pinning rather than assuming — a *new* Latin-first stack in any other
  // template is the regression, and it is invisible until someone types
  // Chinese into it.
  const LATIN_LABEL_DIAGRAMS = new Set(["candlestick", "waterfall"]);

  it("every prose-label stack leads with a CJK family", () => {
    // Matches `font-family: ...;` in CSS and `font-family="..."` on SVG nodes.
    const DECL = /font-family\s*[:=]\s*(?:"([^"]*)"|([^;{}\n]+))/g;
    const CJK_FIRST = /^(TsangerJinKai02|Source Han Serif|Noto Serif|Songti|STSong|SimSun)/;
    const offenders: string[] = [];
    for (const name of DIAGRAM_FILES) {
      if (LATIN_LABEL_DIAGRAMS.has(name)) continue;
      const html = readFileSync(join(DIAGRAMS_DIR, `${name}.html`), "utf8");
      for (const match of html.matchAll(DECL)) {
        const stack = (match[1] ?? match[2] ?? "").trim();
        const first = stack.split(",")[0]!.replace(/['"]/g, "").trim();
        // Mono stacks legitimately lead with JetBrains Mono; they carry their
        // own CJK fallback further down and are not the split-word risk.
        if (first === "" || /mono|consolas|monaco|var\(/i.test(first)) continue;
        if (!CJK_FIRST.test(first)) offenders.push(`${name}.html leads with "${first}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the two numeric-axis charts are the only Latin-first exceptions", () => {
    const stillLatin = DIAGRAM_FILES.filter((name) =>
      readFileSync(join(DIAGRAMS_DIR, `${name}.html`), "utf8").includes('font-family="Charter'),
    );
    expect(new Set(stillLatin)).toEqual(LATIN_LABEL_DIAGRAMS);
  });
});

describe("kami shared stylesheet tokens", () => {
  const SHARED_CSS = join(import.meta.dir, "..", "seed", "_shared", "styles.css");

  // design.md §1 states these two are the only brand tints and that both are
  // declared here; diagrams.md names --brand-tint as the focal-node fill. A
  // token the docs promise but the stylesheet omits resolves to nothing and
  // fails silently — the fill just disappears.
  it("declares the two brand tints the references point at", () => {
    const css = readFileSync(SHARED_CSS, "utf8");
    expect(css).toMatch(/--tag-bg:\s*#E4ECF5;/i);
    expect(css).toMatch(/--brand-tint:\s*#EEF2F7;/i);
  });

  it("leads the CJK families in --serif, with the Latin faces trailing", () => {
    const css = readFileSync(SHARED_CSS, "utf8");
    const serif = /--serif:\s*([^;]+);/.exec(css)?.[1] ?? "";
    expect(serif).toInclude("TsangerJinKai02");
    // Alternate family names the same fonts register under on other systems.
    expect(serif).toInclude("Source Han Serif CN");
    expect(serif).toInclude("Noto Serif SC");
    const families = serif.split(",").map((f) => f.replace(/['"]/g, "").trim());
    expect(families.indexOf("TsangerJinKai02")).toBe(0);
    expect(families.indexOf("Songti SC")).toBeLessThan(families.indexOf("Charter"));
  });
});

describe("kami skill references are reachable", () => {
  const SKILL_DIR = join(import.meta.dir, "..", "skill");

  // The 1.4.0 sync had to retrofit links for two references that shipped
  // undiscoverable. A reference the agent is never told to open is dead weight
  // in the package, so every one of them must be named somewhere in SKILL.md.
  it("SKILL.md names every file in references/", () => {
    const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    const refs = readdirSync(join(SKILL_DIR, "references")).filter((f) => f.endsWith(".md"));
    expect(refs.length).toBeGreaterThan(0);
    const unreachable = refs.filter((ref) => !skill.includes(`references/${ref}`));
    expect(unreachable).toEqual([]);
  });

  it("ships the deck pre-flight reference adopted from upstream V1.13.0", () => {
    expect(existsSync(join(SKILL_DIR, "references", "deck-preflight.md"))).toBe(true);
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
