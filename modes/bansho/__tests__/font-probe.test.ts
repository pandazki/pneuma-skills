/**
 * The font probes, and the CJK collision that broke all three of them
 * (2026-08-17, measured on the live board through CDP).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `engine/factories/env.ts` decided "is this face drawing?" by comparing
 * ADVANCE WIDTHS: measure the sample under `"<family>", <sentinel>` and
 * under `<sentinel>` alone, and call the family present when the numbers
 * part. For Latin that works. For CJK it cannot work at all, because Han
 * glyphs are FULL-WIDTH — exactly 1 em — in essentially every CJK face.
 * That is the script's convention, not a coincidence, so the widths do not
 * merely risk colliding: they are equal by construction.
 *
 * What that produced on a stock macOS board running `slate-cursive`:
 *
 *   ⋅ `CSS.getPlatformFontsForNode` on the real ink node → `Xingkai SC`
 *     (`STXingkaiSC-Light`), the theme's FIRST-CHOICE face, installed as an
 *     optional macOS font asset and drawing every character on the board.
 *   ⋅ `familyAvailable("Xingkai SC", "板书手写")` → `false`, so the theme
 *     picker warned "not on this machine: Xingkai SC".
 *   ⋅ `glyphsFallingBack` → all 312 Chinese characters of the lecture, so
 *     the §6.4-A chip read `handwriting font fallback: 光 ， 怎 么 …  +304`.
 *   ⋅ `probeEnvCaps` → `handwritingFontActive: false`.
 *
 * Three warnings, all false, about a board that was rendering exactly what
 * it promised. The instrument was the only thing that was wrong.
 *
 * ── THE FIX THESE TESTS PIN ─────────────────────────────────────────────────
 * Compare the RASTER, not the advance. Two faces that agree on every
 * advance still draw different ink, and the ink is the question. The fake
 * machine (`fake-font-machine.ts`) models advance and raster separately for
 * exactly this reason: every test below ties the widths on purpose and then
 * asserts the probe still gets the right answer.
 */

import { describe, expect, test } from "bun:test";

import {
  drawnFamily,
  familyAvailable,
  glyphsFallingBack,
  probeEnvCaps,
} from "../engine/factories/env.js";
import {
  type FakeMachineSpec,
  MACOS_LIKE,
  fakeFontMachine,
} from "./fake-font-machine.js";

const CJK = "板书手写";
const LATIN = "Handwriting";
const SLATE_CURSIVE = `"Chalkduster", "Xingkai SC", "Zhi Mang Xing", "HanziPen SC", cursive`;

/** The same machine with some faces uninstalled. */
const without = (...families: string[]): FakeMachineSpec => {
  const faces = { ...MACOS_LIKE.faces };
  for (const f of families) delete (faces as Record<string, unknown>)[f];
  return { ...MACOS_LIKE, faces };
};

describe("the collision itself — widths cannot tell CJK faces apart", () => {
  test("every CJK face on the fake machine measures the sample identically", () => {
    // If this ever stops being true the tests below stop testing anything:
    // they would pass on a width probe too. Han is full-width; that is the
    // premise, and it is asserted rather than assumed.
    const m = fakeFontMachine(MACOS_LIKE);
    const fallback = m.widthOf("monospace", CJK);
    for (const family of ["Xingkai SC", "Zhi Mang Xing", "PingFang SC"]) {
      expect(m.widthOf(`"${family}", monospace`, CJK)).toBe(fallback);
    }
    // …and they still draw different ink, which is what makes the raster
    // comparison a real instrument rather than the same lie twice.
    expect(m.faceFor(`"Xingkai SC", monospace`, "板")).toBe("Xingkai SC");
    expect(m.faceFor("monospace", "板")).toBe("PingFang SC");
  });
});

describe("familyAvailable — an installed CJK face is PRESENT", () => {
  test("Xingkai SC, installed and drawing, is not reported missing", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    expect(familyAvailable(m.document, "Xingkai SC", CJK)).toBe(true);
  });

  test("a face that really is absent is still reported absent", () => {
    const m = fakeFontMachine(without("Xingkai SC"));
    expect(familyAvailable(m.document, "Xingkai SC", CJK)).toBe(false);
  });

  test("a Latin-only hand cannot answer for CJK", () => {
    // Chalkduster is installed and leads the slate stack, but it covers no
    // Han — asking it about a CJK sample must say "not this one".
    const m = fakeFontMachine(MACOS_LIKE);
    expect(familyAvailable(m.document, "Chalkduster", CJK)).toBe(false);
    expect(familyAvailable(m.document, "Chalkduster", LATIN)).toBe(true);
  });

  test("a host that draws nothing says 'unknown', never 'missing'", () => {
    const m = fakeFontMachine({ ...MACOS_LIKE, blank: true });
    expect(familyAvailable(m.document, "Xingkai SC", CJK)).toBe(null);
  });

  test("a canvas that answers differently twice is not an instrument", () => {
    // Fingerprint-defence noise would otherwise read as "every family on
    // earth is installed" — the wrong failure direction for a warning.
    const m = fakeFontMachine({ ...MACOS_LIKE, randomised: true });
    expect(familyAvailable(m.document, "No Such Face", CJK)).toBe(null);
  });

  test("no canvas at all is unknown too", () => {
    const doc = {
      createElement: () => ({ getContext: () => null }),
    } as unknown as Document;
    expect(familyAvailable(doc, "Xingkai SC", CJK)).toBe(null);
  });
});

describe("glyphsFallingBack — a board drawn by its own face names nothing", () => {
  test("slate-cursive on a machine WITH Xingkai SC names no character", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    expect(
      glyphsFallingBack(m.document, "板书手写字", { stacks: [SLATE_CURSIVE] }),
    ).toEqual([]);
  });

  test("the bundled face carries the board when Xingkai SC is absent", () => {
    const m = fakeFontMachine(without("Xingkai SC"));
    expect(
      glyphsFallingBack(m.document, "板书手写字", { stacks: [SLATE_CURSIVE] }),
    ).toEqual([]);
  });

  test("a stack with no CJK face at all names every Chinese character", () => {
    const m = fakeFontMachine(without("Xingkai SC", "Zhi Mang Xing", "HanziPen SC"));
    expect(
      glyphsFallingBack(m.document, "板书", { stacks: [SLATE_CURSIVE] }),
    ).toEqual(["板", "书"]);
  });
});

describe("probeEnvCaps — the same instrument, the same answer", () => {
  test("a board drawing its declared hand is ACTIVE", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    expect(
      probeEnvCaps(m.document, { stacks: [SLATE_CURSIVE] }).handwritingFontActive,
    ).toBe(true);
  });

  test("a stack that collapses into the system face is not", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    expect(
      probeEnvCaps(m.document, { stacks: [`"PingFang SC", sans-serif`] })
        .handwritingFontActive,
    ).toBe(false);
  });
});

describe("drawnFamily — which face is REALLY drawing this stack", () => {
  const NAMED = ["Chalkduster", "Xingkai SC", "Zhi Mang Xing", "HanziPen SC"];

  test("names the first-choice face when the machine has it", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    expect(drawnFamily(m.document, SLATE_CURSIVE, CJK, NAMED)).toBe("Xingkai SC");
  });

  test("names the BUNDLED face when the optional one is missing", () => {
    // This is the sentence the picker has to be able to write: not "it will
    // fall back", but "Zhi Mang Xing draws it".
    const m = fakeFontMachine(without("Xingkai SC"));
    expect(drawnFamily(m.document, SLATE_CURSIVE, CJK, NAMED)).toBe(
      "Zhi Mang Xing",
    );
  });

  test("walks past every missing face to the one that draws", () => {
    const m = fakeFontMachine(without("Xingkai SC", "Zhi Mang Xing"));
    expect(drawnFamily(m.document, SLATE_CURSIVE, CJK, NAMED)).toBe(
      "HanziPen SC",
    );
  });

  test("names nothing when no declared face draws it — the generic won", () => {
    const m = fakeFontMachine(
      without("Xingkai SC", "Zhi Mang Xing", "HanziPen SC"),
    );
    expect(drawnFamily(m.document, SLATE_CURSIVE, CJK, NAMED)).toBe(null);
  });

  test("an absent family is never named, even when its solo raster matches", () => {
    // A family nobody has renders in the platform's own face when named
    // alone. If the stack ALSO ended up in that face, comparing rasters
    // alone would credit the missing family with the drawing — so
    // availability gates the answer.
    const m = fakeFontMachine(
      without("Xingkai SC", "Zhi Mang Xing", "HanziPen SC"),
    );
    expect(drawnFamily(m.document, `"Xingkai SC", sans-serif`, CJK, NAMED)).toBe(
      null,
    );
  });

  test("no instrument → no claim", () => {
    const m = fakeFontMachine({ ...MACOS_LIKE, blank: true });
    expect(drawnFamily(m.document, SLATE_CURSIVE, CJK, NAMED)).toBe(null);
  });
});
