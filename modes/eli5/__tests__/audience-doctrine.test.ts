/**
 * The audience doctrine — pinned as source text, because SKILL.md and
 * `references/audience-calibration.md` are the only places it is ever stated,
 * and the agent is the only consumer.
 *
 * The failure this suite exists to prevent is not a crash. It is a page that
 * comes back "clean and rational": typographically correct and without any
 * character, because the guidance was specific for exactly one audience (the
 * young child) and defined every other one by subtraction — "almost none",
 * "no illustration", "nothing that flashes". A row built from subtraction gets
 * executed as plain.
 *
 * So what is pinned here is *specificity*, in two dimensions:
 *
 *  - the derivation method exists and comes BEFORE the reference tables, so
 *    the tables are worked examples rather than the mechanism;
 *  - every reference row is answered on both axes — how the page looks and how
 *    it argues — with real numbers and a positively-stated decoration.
 *
 * None of this polices prose style: no assertion here names a typeface, a
 * colour, or a sentence. They check that a row said something concrete.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import eli5Manifest from "../manifest.js";

const MODE_DIR = join(import.meta.dir, "..");
const SKILL = readFileSync(join(MODE_DIR, "skill", "SKILL.md"), "utf-8");
const CALIBRATION = readFileSync(
  join(MODE_DIR, "skill", "references", "audience-calibration.md"),
  "utf-8",
);

/**
 * Rows of the first markdown table appearing after `caption`, as cell arrays.
 * Header and separator rows are dropped.
 */
function tableAfter(source: string, caption: string): string[][] {
  const start = source.indexOf(caption);
  expect([caption, start]).not.toEqual([caption, -1]);

  const lines = source.slice(start + caption.length).split("\n");
  const rows: string[][] = [];
  let seen = false;
  for (const line of lines) {
    const isRow = line.trimStart().startsWith("|");
    if (!isRow) {
      if (seen) break;
      continue;
    }
    seen = true;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows.slice(1); // drop the header row
}

const LOOKS = tableAfter(SKILL, "**How the page looks**");
const ARGUES = tableAfter(SKILL, "**How the page argues**");

// ── the method, not the table, is the mechanism ─────────────────────────────

describe("the derivation method", () => {
  test("SKILL.md teaches deriving a page from the reader's own printed world", () => {
    expect(SKILL).toContain("### Designing the page for its reader");
    // The page's ancestor is a real object the reader already trusts. Without
    // this move, an audience nobody tabulated has nowhere to get a look from.
    expect(SKILL).toMatch(/printed world|printed matter/);
  });

  test("it comes before the reference tables — the tables are examples, not the mechanism", () => {
    const method = SKILL.indexOf("### Designing the page for its reader");
    const looks = SKILL.indexOf("**How the page looks**");
    expect(method).toBeGreaterThan(-1);
    expect(looks).toBeGreaterThan(method);
    // And the tables are framed as starting positions rather than uniforms.
    expect(SKILL).toContain("#### Reference points");
  });

  test("the visual half names the five things a page has to decide concretely", () => {
    // Specificity is what the young-child row had and the others lacked, so
    // the method has to ask for it by name.
    const method = SKILL.slice(
      SKILL.indexOf("### Designing the page for its reader"),
      SKILL.indexOf("#### Reference points"),
    );
    expect(method).toContain("the type pairing");
    expect(method).toContain("the measure and the leading");
    expect(method).toContain("the palette and its ground");
    expect(method).toContain("the one expressive gesture");
    expect(method).toContain("what the decoration is made of");
  });

  test("the epistemic half names what the page must contain to convince this reader", () => {
    const method = SKILL.slice(
      SKILL.indexOf("### Designing the page for its reader"),
      SKILL.indexOf("#### Reference points"),
    );
    expect(method).toContain("what convinces them");
    expect(method).toContain("the shape the reasoning takes");
    expect(method).toContain("how concrete, and how often");
    expect(method).toContain("what the figures are for");
    expect(method).toContain('where the "so what" lands');
  });

  test("restraint is stated as a means with a purpose, never as an identity", () => {
    expect(SKILL).toContain("**Restraint is a means, never an identity.**");
    // The load-bearing sentence: a quiet page has to be able to say what the
    // quiet buys, or it is simply undesigned.
    expect(SKILL).toMatch(/what the saved space is \*for\*|what the restraint buys/);
  });
});

// ── the reference rows are answered on both axes ────────────────────────────

describe("the reference rows", () => {
  test("both tables exist and cover the same audiences in the same order", () => {
    expect(LOOKS.length).toBeGreaterThanOrEqual(8);
    expect(ARGUES.map((r) => r[0])).toEqual(LOOKS.map((r) => r[0]));
  });

  test("every row names its printed ancestor, its type, palette and decoration", () => {
    for (const row of LOOKS) {
      expect([row[0], row.length]).toEqual([row[0], 5]);
      for (const cell of row.slice(1)) expect([row[0], cell.length > 30]).toEqual([row[0], true]);
    }
  });

  test("every row's type cell carries real numbers — no row may be vague", () => {
    // "Warm serif, generous line-height" is the shape of the old guidance and
    // the reason a page came back characterless. A size in px is the cheapest
    // proof that somebody actually decided.
    for (const [audience, , type] of LOOKS) {
      expect([audience, /\d+(\.\d+)?\s*(–|-|to )?\s*\d*\s*px/.test(type)]).toEqual([audience, true]);
    }
  });

  test("no row defines its decoration only by what it omits", () => {
    // The subtraction rows — "Almost none.", "No illustration." — are what a
    // designer cannot execute. A decoration cell has to say what the page has.
    for (const row of LOOKS) {
      const decoration = row[4];
      expect([row[0], /^\s*(almost none|none|no\b|nothing\b|minimal\b)/i.test(decoration)]).toEqual([
        row[0],
        false,
      ]);
      expect([row[0], decoration.length > 60]).toEqual([row[0], true]);
    }
  });

  test("every row states what convinces that reader and where its so-what lands", () => {
    for (const row of ARGUES) {
      expect([row[0], row.length]).toEqual([row[0], 5]);
      for (const cell of row.slice(1)) expect([row[0], cell.length > 40]).toEqual([row[0], true]);
    }
  });

  test("the arts / humanities reader and the practitioner both have rows", () => {
    // The reported gap: a page for a humanities-educated reader had no row at
    // all, so it was assembled from the restraint rows and landed plain.
    const audiences = LOOKS.map((r) => r[0].toLowerCase()).join(" ");
    expect(audiences).toContain("humanities");
    expect(audiences).toContain("practitioner");
  });

  test("the humanities and technical rows disagree about how concrete a page should be", () => {
    // The doctrine is two-dimensional or it is nothing: if both rows ask for
    // the same evidence, only the typography ever changes.
    const rowFor = (needle: string) =>
      ARGUES.find((r) => r[0].toLowerCase().includes(needle))!.join(" ").toLowerCase();
    expect(rowFor("humanities")).toContain("worked");
    expect(rowFor("technical")).toMatch(/one precise|one exact|exactness/);
  });
});

// ── the two documents say the same thing ────────────────────────────────────

describe("SKILL.md and the calibration reference agree", () => {
  test("the calibration file points at the derivation method rather than at itself", () => {
    expect(CALIBRATION).toContain("Designing the page\nfor its reader");
  });

  test("an unlisted audience is derived, not borrowed from the nearest row", () => {
    // The old recipe ended "then pick the closest visual register row and
    // adjust" — which is exactly how a musician's page inherited a restraint
    // row and came back without character.
    expect(CALIBRATION).not.toContain("pick the\n  closest visual register row");
    expect(CALIBRATION).not.toContain("pick the closest visual register row");
    const recipe = CALIBRATION.slice(CALIBRATION.indexOf("**An audience with no row here**"));
    expect(recipe).toContain("derive the row");
  });

  test("every taxonomy table carries the epistemic column too", () => {
    // Four tables — ages, education, roles, relationships. A page's evidence
    // is calibrated in all of them or in none of them.
    const headers = CALIBRATION.split("\n").filter((l) => l.startsWith("| Audience |"));
    expect(headers.length).toBe(4);
    for (const header of headers) expect(header).toContain("What lands as understanding");
  });

  test("both formations the tables lacked are written out in full", () => {
    expect(CALIBRATION).toContain("## Formations");
    expect(CALIBRATION).toMatch(/### Arts \/ humanities-educated/);
    expect(CALIBRATION).toMatch(/### Practitioner/);
  });

  test("the quality check asks about evidence, not only about looks", () => {
    const check = CALIBRATION.slice(CALIBRATION.indexOf("## Quality check"));
    expect(check).toContain("convinces");
    expect(check).toMatch(/type pairing/);
  });
});

// ── the skill ships as a new version ────────────────────────────────────────

describe("skill version", () => {
  test("the doctrine change is a version bump with a changelog", () => {
    // Resume compares `skill-version.json` against this; without the bump the
    // installed skill silently stays the old one.
    expect(eli5Manifest.version).not.toBe("0.1.0");
    expect(eli5Manifest.changelog?.[eli5Manifest.version]).toBeDefined();
    expect(eli5Manifest.changelog![eli5Manifest.version]!.length).toBeGreaterThanOrEqual(3);
  });
});
