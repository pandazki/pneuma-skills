/**
 * The three shipped board themes, the chalk seam, and the bundled font.
 *
 * These were chosen with the product owner in front of real renders, so the
 * values are pinned byte-for-byte rather than described: a preset that
 * drifts is a look nobody approved. The rest of the file guards the three
 * things about a theme that fail SILENTLY — a palette that loses to the base
 * sheet's dark rule, a face swap that never invalidates the geometry
 * measured against the old face, and an OFL font shipped without its licence.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadBoard } from "../domain.js";
import { drawnFamily, familyAvailable } from "../engine/factories/env.js";
import { BOARD_BASE_CSS } from "../viewer/board-css.js";
import {
  BUNDLED_FACES,
  BUNDLED_FONT_FACE_CSS,
  familiesIn,
} from "../viewer/board-fonts.js";
import {
  BOARD_THEMES,
  fontFingerprint,
  handFamiliesIn,
  markerFor,
  presetCss,
  presetIdOf,
  themeById,
  themePathFor,
} from "../viewer/themes.js";
import { MACOS_LIKE, fakeFontMachine } from "./fake-font-machine.js";

/** A CJK probe string every Chinese face on the fake machine covers. */
const CJK_PROBE = "板书手写";

const byId = (id: string) => {
  const preset = themeById(id);
  if (!preset) throw new Error(`missing preset ${id}`);
  return preset;
};

describe("the three shipped themes are exactly what was chosen", () => {
  test("ids, in order", () => {
    expect(BOARD_THEMES.map((t) => t.id)).toEqual([
      "parchment",
      "slate-cursive",
      "kawaii-cream",
    ]);
  });

  test("parchment — 牛皮纸, Bradley Hand + HanziPen SC, no chalk", () => {
    const t = byId("parchment");
    expect(t.labelZh).toBe("牛皮纸");
    expect(t.tokens["--board"]).toBe("#f3ece0");
    expect(t.tokens["--board-fg"]).toBe("#1c1b19");
    expect(t.tokens["--accent"]).toBe("#c2571e");
    expect(t.tokens["--hl"]).toBe("#ffe072");
    expect(t.chalk).toBe(0);
    expect(t.faces.map((f) => f.family)).toEqual([
      "Bradley Hand",
      "HanziPen SC",
    ]);
  });

  test("slate-cursive — 绿板 · 行楷, Chalkduster + Xingkai SC, chalk", () => {
    const t = byId("slate-cursive");
    expect(t.labelZh).toBe("绿板 · 行楷");
    expect(t.tokens["--board"]).toBe("#22302a");
    expect(t.tokens["--board-fg"]).toBe("#f2efe6");
    expect(t.tokens["--accent"]).toBe("#e8894b");
    expect(t.tokens["--hl"]).toBe("#e8c24a");
    expect(t.chalk).toBe(1);
    // `Zhi Mang Xing` is the third because Xingkai SC is an OPTIONAL macOS
    // download: this theme was chosen on a machine that had it, and a stock
    // install falls through. The bundled 行书 is what a stock install then
    // sees — so it is a promised face, not a softener, and it is measured
    // and reported like the other two.
    expect(t.faces.map((f) => f.family)).toEqual([
      "Chalkduster",
      "Xingkai SC",
      "Zhi Mang Xing",
    ]);
    expect(t.faces.find((f) => f.family === "Zhi Mang Xing")?.bundled).toBe(
      true,
    );
  });

  test("kawaii-cream — 可爱 · 奶油, one bundled family, no chalk", () => {
    const t = byId("kawaii-cream");
    expect(t.labelZh).toBe("可爱 · 奶油");
    expect(t.tokens["--board"]).toBe("#faf3e6");
    expect(t.tokens["--board-fg"]).toBe("#3a332b");
    expect(t.tokens["--accent"]).toBe("#e0714a");
    expect(t.tokens["--hl"]).toBe("#ffd98e");
    expect(t.chalk).toBe(0);
    expect(t.faces).toHaveLength(1);
    expect(t.faces[0]!.family).toBe("ZCOOL KuaiLe");
    // The theme that must not degrade off macOS is the one whose face
    // travels with the mode.
    expect(t.faces[0]!.bundled).toBe(true);
  });

  test("every stack ends in a generic so a bare platform still writes by hand", () => {
    for (const t of BOARD_THEMES) {
      expect(t.handStack.trim().endsWith("cursive")).toBe(true);
    }
  });

  test("slate-cursive takes the DARK companions, the paper boards the light ones", () => {
    // Not decoration: `--hl-a` / `--s1` / `--s2` / `--wall` have different
    // defaults per theme variant, so a preset that left them alone would
    // have them flip with the app chrome while the board did not — the
    // slate would draw the light board's dark-green series on its own
    // dark-green surface.
    expect(byId("slate-cursive").tokens["--hl-a"]).toBe("0.32");
    expect(byId("slate-cursive").tokens["--s1"]).toBe("#6fd98d");
    expect(byId("parchment").tokens["--hl-a"]).toBe("0.62");
    expect(byId("kawaii-cream").tokens["--s1"]).toBe("#2e9e4f");
  });

  test("no preset pins the 瑕疵 knob — that is the author's, not the look's", () => {
    for (const t of BOARD_THEMES) {
      expect(Object.keys(t.tokens)).not.toContain("--bansho-flaw");
    }
  });
});

describe("presetCss — the stylesheet a picked theme writes", () => {
  test("the palette is stated on BOTH theme selectors", () => {
    // The base sheet declares the dark palette at (0,2,0). A preset that
    // wrote only `.bansho-board-surface { … }` (0,1,0) would be overridden
    // outright under dark chrome, whatever the injection order — parchment
    // would silently become the stock green slate.
    const css = presetCss(byId("parchment"));
    expect(css).toContain(".bansho-board-surface {");
    expect(css).toContain('.bansho-board-surface[data-bansho-theme="dark"] {');
    const boards = [...css.matchAll(/--board:\s*#f3ece0;/g)];
    expect(boards).toHaveLength(2);
  });

  test("--hand is stated ONCE, on the base selector", () => {
    // board-css.ts puts the dark hand behind `:where(…)` precisely so one
    // unscoped rule rethemes both boards. Writing it twice would work and
    // would quietly retire the seam the docs teach.
    const css = presetCss(byId("kawaii-cream"));
    expect([...css.matchAll(/--hand:/g)]).toHaveLength(1);
    const handAt = css.indexOf("--hand:");
    const darkAt = css.indexOf('[data-bansho-theme="dark"]');
    expect(handAt).toBeLessThan(darkAt);
  });

  test("--bansho-chalk rides both selectors, at the preset's value", () => {
    expect([...presetCss(byId("slate-cursive")).matchAll(/--bansho-chalk: 1;/g)])
      .toHaveLength(2);
    expect([...presetCss(byId("parchment")).matchAll(/--bansho-chalk: 0;/g)])
      .toHaveLength(2);
  });

  test("every rule is scoped under .bansho-board-surface", () => {
    // The sheet is injected into the app document verbatim; a bare selector
    // would restyle the chat, the transport and the shell.
    for (const t of BOARD_THEMES) {
      for (const selector of presetCss(t).split("{").slice(0, -1)) {
        const last = selector.split("}").pop()!.trim();
        if (last.length === 0 || last.startsWith("/*")) continue;
        expect(last).toContain(".bansho-board-surface");
      }
    }
  });

  test("the scoped form prefixes every selector and keeps the dark attribute", () => {
    // `.scope .bansho-board-surface[data-bansho-theme="dark"]` is (0,3,0)
    // against the base and live sheets' (0,2,0), so a preview wins on
    // specificity alone and never depends on which <style> landed last.
    const css = presetCss(byId("slate-cursive"), ".bansho-theme-preview");
    expect(css).toContain(".bansho-theme-preview .bansho-board-surface {");
    expect(css).toContain(
      '.bansho-theme-preview .bansho-board-surface[data-bansho-theme="dark"] {',
    );
    expect(css).not.toMatch(/\n\.bansho-board-surface/);
  });

  test("the marker names the preset, and a hand-written sheet has none", () => {
    for (const t of BOARD_THEMES) {
      expect(presetCss(t).startsWith(markerFor(t.id))).toBe(true);
      expect(presetIdOf(presetCss(t))).toBe(t.id);
    }
    expect(presetIdOf(".bansho-board-surface { --hand: cursive; }")).toBe(null);
    expect(presetIdOf(undefined)).toBe(null);
  });
});

describe("themePathFor — the seam the picker writes through", () => {
  test("it lands where loadBoard looks for it", () => {
    const files = [
      { path: "board.md", content: "# Root" },
      { path: themePathFor(""), content: "/* root */" },
      { path: "zh/board.md", content: "# 中文" },
      { path: themePathFor("zh"), content: "/* zh */" },
    ];
    const board = loadBoard(files);
    expect(board?.themeCss[""]).toBe("/* root */");
    expect(board?.themeCss["zh"]).toBe("/* zh */");
  });
});

describe("fontFingerprint — a repaint is not a re-measure", () => {
  const base = presetCss(byId("parchment"));

  test("a different hand is a different fingerprint", () => {
    expect(fontFingerprint(presetCss(byId("kawaii-cream")))).not.toBe(
      fontFingerprint(base),
    );
  });

  test("a colour edit is not", () => {
    const recoloured = base.replace("#c2571e", "#123456");
    expect(recoloured).not.toBe(base);
    expect(fontFingerprint(recoloured)).toBe(fontFingerprint(base));
  });

  test("the 瑕疵 knob is not — a knob edit must never re-fold the board", () => {
    const knob = `${base}\n.bansho-board-surface { --bansho-flaw: 2; }`;
    expect(fontFingerprint(knob)).toBe(fontFingerprint(base));
  });

  test("a webfont whose src moved is", () => {
    const one = '@font-face { font-family: "X"; src: url("a.ttf"); }';
    const two = '@font-face { font-family: "X"; src: url("b.ttf"); }';
    expect(fontFingerprint(one)).not.toBe(fontFingerprint(two));
  });

  test("whitespace alone is not", () => {
    expect(fontFingerprint(base.replace(/\n/g, "\n  "))).toBe(
      fontFingerprint(base),
    );
  });

  test("no stylesheet is a stable empty fingerprint", () => {
    expect(fontFingerprint(undefined)).toBe("");
  });
});

describe("handFamiliesIn / familiesIn — what to preload before measuring", () => {
  test("real families only; generics name a platform choice, not a face", () => {
    expect(familiesIn('"Bradley Hand", "HanziPen SC", cursive')).toEqual([
      "Bradley Hand",
      "HanziPen SC",
    ]);
  });

  test("the winning --hand declaration is the last one", () => {
    const css = [
      '.bansho-board-surface { --hand: "A", cursive; }',
      '.bansho-board-surface { --hand: "B", cursive; }',
    ].join("\n");
    expect(handFamiliesIn(css)).toEqual(["B"]);
  });

  test("the faces a preset REPORTS on lead the stack it writes", () => {
    // `faces` is what the picker measures and warns about — the faces whose
    // absence changes what the reader sees. The stack carries further
    // fallbacks behind them (Chalkboard SE, Segoe Print), which are there
    // to soften a degradation, not to be promised.
    for (const t of BOARD_THEMES) {
      const preloaded = handFamiliesIn(presetCss(t));
      expect(preloaded.slice(0, t.faces.length)).toEqual(
        t.faces.map((f) => f.family),
      );
    }
  });
});

describe("the bundled font", () => {
  const fontDir = fileURLToPath(new URL("../assets/fonts/", import.meta.url));

  test("ZCOOL KuaiLe ships in the repo", () => {
    const ttf = `${fontDir}ZCOOLKuaiLe-Regular.ttf`;
    expect(existsSync(ttf)).toBe(true);
    expect(statSync(ttf).size).toBe(1_514_968);
  });

  test("its OFL licence text sits beside it", () => {
    // SIL OFL 1.1 requires the notice and licence to travel with the font in
    // any distribution. Shipping the .ttf without OFL.txt is a licence
    // violation, not a lint warning — hence an assertion.
    expect(existsSync(`${fontDir}OFL.txt`)).toBe(true);
    expect(BUNDLED_FACES[0]!.licence).toBe("SIL OFL 1.1");
  });

  test("the @font-face points at the shipped file and blocks rather than swaps", () => {
    expect(BUNDLED_FONT_FACE_CSS).toContain('font-family: "ZCOOL KuaiLe"');
    expect(BUNDLED_FONT_FACE_CSS).toContain("ZCOOLKuaiLe-Regular.ttf");
    // `swap` would let the board measure the fallback and then reflow
    // underneath its own overlays — the T8 defect through another door.
    expect(BUNDLED_FONT_FACE_CSS).toContain("font-display: block");
  });

  test("the mode's files are carried by package.json's files list", () => {
    // `files` wins over .npmignore, and only `modes/*/harness/` is excluded
    // — so a font under modes/bansho/assets/ ships. A change to either side
    // of that would make kawaii-cream a broken theme on every install.
    const pkg = require(
      fileURLToPath(new URL("../../../package.json", import.meta.url)),
    ) as { files: string[] };
    expect(pkg.files).toContain("modes/");
    expect(pkg.files.filter((f) => f.startsWith("!modes/"))).toEqual([
      "!modes/*/harness/",
    ]);
  });
});

describe("the chalk seam", () => {
  test("the base sheet defines --bansho-chalk, defaulting to paper", () => {
    expect(BOARD_BASE_CSS).toContain("--bansho-chalk: 0;");
  });

  test("nothing in the base sheet implements an effect from it", () => {
    // The theme half defines the token; the effects half reads it. A
    // placeholder here would be the second channel the seam forbids.
    expect(BOARD_BASE_CSS).not.toMatch(/var\(--bansho-chalk/);
  });

  test("exactly one shipped theme claims to be chalk on slate", () => {
    expect(BOARD_THEMES.filter((t) => t.chalk === 1).map((t) => t.id)).toEqual([
      "slate-cursive",
    ]);
  });
});

/**
 * The picker's promise, on the machine the themes were CHOSEN on.
 *
 * The instrument itself is pinned in `font-probe.test.ts`; what belongs here
 * is what the shipped presets claim about a real machine — because on
 * 2026-08-17 the picker told a reader that `slate-cursive`'s first-choice
 * face was missing while `CSS.getPlatformFontsForNode` named that very face
 * on the ink node. Every face a preset declares has to be judged correctly
 * on a machine that has it, and the substitute named for one that is absent
 * has to be the face that really draws.
 */
describe("what the picker will say about the shipped themes", () => {
  const macos = (): Document => fakeFontMachine(MACOS_LIKE).document;
  /** The same machine without the optional macOS download. */
  const withoutXingkai = (): Document => {
    const faces = { ...MACOS_LIKE.faces };
    delete (faces as Record<string, unknown>)["Xingkai SC"];
    return fakeFontMachine({ ...MACOS_LIKE, faces }).document;
  };

  test("every face of every shipped preset is judged present on macOS", () => {
    const doc = macos();
    for (const preset of BOARD_THEMES) {
      for (const face of preset.faces) {
        expect([preset.id, face.family, familyAvailable(doc, face.family, face.sample)])
          .toEqual([preset.id, face.family, true]);
      }
    }
  });

  test("slate-cursive's optional face is not called missing when it is there", () => {
    // The defect verbatim: `Xingkai SC` is full-width like the system CJK
    // face, so every width comparison tied and the picker warned about a
    // font the reader could see on their own board.
    const slate = BOARD_THEMES.find((t) => t.id === "slate-cursive")!;
    const xingkai = slate.faces.find((f) => f.family === "Xingkai SC")!;
    expect(familyAvailable(macos(), xingkai.family, xingkai.sample)).toBe(true);
  });

  test("when it really is absent, the bundled face is the one that draws", () => {
    // This is the answer to 「用什么替代了？」 — measured, not inferred from
    // the declared order.
    const slate = BOARD_THEMES.find((t) => t.id === "slate-cursive")!;
    const doc = withoutXingkai();
    expect(familyAvailable(doc, "Xingkai SC", CJK_PROBE)).toBe(false);
    expect(
      drawnFamily(doc, slate.handStack, CJK_PROBE, familiesIn(slate.handStack)),
    ).toBe("Zhi Mang Xing");
  });

  test("an instrument-less host answers 'unknown', not 'missing'", () => {
    // `false` here would be an invention, and the picker would tell the
    // reader a font is absent on no evidence at all.
    const doc = {
      createElement: () => ({ getContext: () => null }),
    } as unknown as Document;
    expect(familyAvailable(doc, "Bradley Hand", "Handwriting")).toBe(null);
  });

  test("a host that draws nothing is instrument-less too", () => {
    const doc = fakeFontMachine({ ...MACOS_LIKE, blank: true }).document;
    expect(familyAvailable(doc, "Bradley Hand", "Handwriting")).toBe(null);
  });

  test("a face nobody has is still reported absent — the fonts.check lie", () => {
    expect(familyAvailable(macos(), "Hannotate SC", CJK_PROBE)).toBe(false);
  });
});
