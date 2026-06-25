import { describe, it, expect } from "bun:test";
import {
  FONTS,
  THEMES,
  DEFAULT_FONT_ID,
  DEFAULT_FONT_BY_SCRIPT,
  DEFAULT_THEME_ID,
  LEGACY_SKIN_MAP,
  fontById,
  themeById,
  detectScript,
  resolveFont,
  resolveTheme,
  fontCssVars,
  themeCssVars,
  surfaceCssVars,
  type ReadingFont,
  type ColorTheme,
} from "../viewer/font-theme.js";

// ── The font axis ─────────────────────────────────────────────────────────────

describe("the font registry — one preferred face per script", () => {
  it("ships at least one cjk face and one latin face", () => {
    const scripts = new Set(FONTS.map((f) => f.script));
    expect(scripts.has("cjk")).toBe(true);
    expect(scripts.has("latin")).toBe(true);
  });

  it("makes 霞鹭文楷 / LXGW WenKai the cjk default", () => {
    const cjkDefault = fontById(DEFAULT_FONT_BY_SCRIPT.cjk);
    expect(cjkDefault).toBeDefined();
    expect(cjkDefault!.script).toBe("cjk");
    expect(cjkDefault!.fontFamily).toContain("LXGW WenKai");
  });

  it("makes a soft literary serif the latin default", () => {
    const latinDefault = fontById(DEFAULT_FONT_BY_SCRIPT.latin);
    expect(latinDefault).toBeDefined();
    expect(latinDefault!.script).toBe("latin");
    // A serif reading face ends its stack in `serif` (not `sans-serif`).
    expect(/[^-]serif\s*$/i.test(latinDefault!.fontFamily)).toBe(true);
    expect(/sans-serif\s*$/i.test(latinDefault!.fontFamily)).toBe(false);
  });

  it("every font has a unique id, a label, a stack, and reading geometry", () => {
    const ids = new Set<string>();
    for (const f of FONTS) {
      expect(f.id.length).toBeGreaterThan(0);
      expect(ids.has(f.id)).toBe(false);
      ids.add(f.id);
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.fontFamily.length).toBeGreaterThan(0);
      expect(f.measure.length).toBeGreaterThan(0);
      expect(f.lineHeight).toBeGreaterThan(1);
    }
  });

  it("the overall default font id resolves to a real face", () => {
    expect(fontById(DEFAULT_FONT_ID)).toBeDefined();
  });
});

// ── The color-theme axis ──────────────────────────────────────────────────────

describe("the color-theme registry — day + night, font-free", () => {
  it("ships day and night options", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(4);
    const modes = new Set(THEMES.map((t) => t.mode));
    expect(modes.has("day")).toBe(true);
    expect(modes.has("night")).toBe(true);
  });

  it("every theme has a unique id, a label, and a full palette — and no font binding", () => {
    const ids = new Set<string>();
    for (const t of THEMES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.palette.bg.length).toBeGreaterThan(0);
      expect(t.palette.fg.length).toBeGreaterThan(0);
      expect(t.palette.accent.length).toBeGreaterThan(0);
      // The theme is purely a color axis — it carries no font field.
      expect("fontFamily" in t).toBe(false);
    }
  });

  it("the default theme id resolves to a real theme", () => {
    expect(themeById(DEFAULT_THEME_ID)).toBeDefined();
  });
});

// ── Content-language detection (drives font auto-pick) ───────────────────────

describe("detectScript — CJK vs Latin from the draft", () => {
  it("calls a Chinese essay cjk even with Latin proper nouns mixed in", () => {
    const zh = "改革开放四十年来，中国经济高速增长，GPT 与 AI 这些英文缩写也随处可见。";
    expect(detectScript(zh)).toBe("cjk");
  });

  it("calls an English essay latin", () => {
    const en = "The model knows it is a model. The metaphor sits wrong on the page.";
    expect(detectScript(en)).toBe("latin");
  });

  it("treats a stray CJK glyph in mostly-English prose as latin", () => {
    const mostlyEn =
      "This is a long English paragraph with one stray ideograph 中 buried inside an otherwise " +
      "entirely Latin sentence that goes on for a while to dilute the single character.";
    expect(detectScript(mostlyEn)).toBe("latin");
  });

  it("defaults empty / symbol-only content to latin", () => {
    expect(detectScript("")).toBe("latin");
    expect(detectScript(null)).toBe("latin");
    expect(detectScript("— · — 123 !?")).toBe("latin");
  });
});

// ── resolveFont — user > agent > legacy > auto-pick > default ─────────────────

describe("resolveFont — explicit choice wins, else auto-pick by content script", () => {
  it("uses the user's explicit font over everything", () => {
    expect(resolveFont("英文 mostly chinese 中文中文中文", { font: "dm-sans" }).id).toBe("dm-sans");
  });

  it("uses the agent suggestion when the user has not chosen", () => {
    expect(resolveFont("plain english", { fontSuggested: "source-serif" }).id).toBe("source-serif");
  });

  it("auto-picks WenKai for Chinese content when nothing is chosen", () => {
    const zh = "这是一段中文的草稿，用来测试自动选择阅读字体的逻辑。";
    expect(resolveFont(zh, {}).id).toBe(DEFAULT_FONT_BY_SCRIPT.cjk);
    expect(resolveFont(zh, null).id).toBe(DEFAULT_FONT_BY_SCRIPT.cjk);
  });

  it("auto-picks the literary serif for English content when nothing is chosen", () => {
    expect(resolveFont("A purely English literary draft.", {}).id).toBe(
      DEFAULT_FONT_BY_SCRIPT.latin,
    );
  });

  it("ignores an unknown font id and degrades to the next source", () => {
    expect(resolveFont("中文中文中文中文中文", { font: "nope" }).id).toBe(DEFAULT_FONT_BY_SCRIPT.cjk);
  });
});

// ── resolveTheme — user > agent > default; NEVER content-derived ─────────────

describe("resolveTheme — user color choice, independent of content", () => {
  it("uses the user's explicit theme over the agent suggestion", () => {
    expect(resolveTheme({ theme: "parchment", themeSuggested: "dusk" }).id).toBe("parchment");
  });

  it("uses the agent suggestion when the user has not chosen", () => {
    expect(resolveTheme({ themeSuggested: "quartz" }).id).toBe("quartz");
  });

  it("falls back to the default when neither is set", () => {
    expect(resolveTheme({}).id).toBe(DEFAULT_THEME_ID);
    expect(resolveTheme(null).id).toBe(DEFAULT_THEME_ID);
  });

  it("ignores an unknown theme id and degrades to the default", () => {
    expect(resolveTheme({ theme: "ghost", themeSuggested: "phantom" }).id).toBe(DEFAULT_THEME_ID);
  });
});

// ── Back-compat: a pre-split `skin`/`skinSuggested` config still resolves ────

describe("legacy skin fallback — an old single-id config maps to a font + theme pair", () => {
  it("maps every legacy skin id to a real font and a real theme", () => {
    for (const [skinId, pair] of Object.entries(LEGACY_SKIN_MAP)) {
      expect(fontById(pair.font), `font for legacy ${skinId}`).toBeDefined();
      expect(themeById(pair.theme), `theme for legacy ${skinId}`).toBeDefined();
    }
  });

  it("derives both axes from a legacy `skin` when the split keys are absent", () => {
    // The old 'parchment' skin was a warm serif day page.
    const cfg = { skin: "parchment" };
    expect(resolveTheme(cfg).id).toBe("parchment");
    const font = resolveFont("english draft", cfg);
    expect(font.script).toBe("latin");
  });

  it("derives both axes from a legacy `skinSuggested` agent hint", () => {
    const cfg = { skinSuggested: "ivory" };
    // ivory was a clean sans skin → its font is the sans face.
    expect(resolveFont("english", cfg).id).toBe(LEGACY_SKIN_MAP.ivory.font);
    expect(resolveTheme(cfg).id).toBe("ivory");
  });

  it("new split keys win over a stale legacy skin id", () => {
    const cfg = { skin: "parchment", font: "wenkai", theme: "midnight" };
    expect(resolveFont("english", cfg).id).toBe("wenkai");
    expect(resolveTheme(cfg).id).toBe("midnight");
  });
});

// ── CSS projection — two independent var groups ──────────────────────────────

describe("CSS vars — font and theme project into separate, composable groups", () => {
  const font: ReadingFont = fontById(DEFAULT_FONT_BY_SCRIPT.cjk)!;
  const theme: ColorTheme = THEMES.find((t) => t.mode === "day")!;

  it("fontCssVars emits only --wordtaste-font-* properties", () => {
    const vars = fontCssVars(font);
    expect(vars["--wordtaste-font-family"]).toBe(font.fontFamily);
    expect(vars["--wordtaste-font-measure"]).toBe(font.measure);
    expect(vars["--wordtaste-font-line"]).toBe(String(font.lineHeight));
    expect(Object.keys(vars).every((k) => k.startsWith("--wordtaste-font-"))).toBe(true);
  });

  it("themeCssVars emits only --wordtaste-theme-* properties", () => {
    const vars = themeCssVars(theme);
    expect(vars["--wordtaste-theme-bg"]).toBe(theme.palette.bg);
    expect(vars["--wordtaste-theme-fg"]).toBe(theme.palette.fg);
    expect(vars["--wordtaste-theme-accent"]).toBe(theme.palette.accent);
    expect(Object.keys(vars).every((k) => k.startsWith("--wordtaste-theme-"))).toBe(true);
  });

  it("a night theme emits night mode and a day theme day mode (font-independent)", () => {
    const night = THEMES.find((t) => t.mode === "night")!;
    const day = THEMES.find((t) => t.mode === "day")!;
    expect(themeCssVars(night)["--wordtaste-theme-mode"]).toBe("night");
    expect(themeCssVars(day)["--wordtaste-theme-mode"]).toBe("day");
  });

  it("surfaceCssVars composes the two axes freely — WenKai on a light theme", () => {
    const wenkai = fontById("wenkai")!;
    const parchment = themeById("parchment")!;
    const vars = surfaceCssVars(wenkai, parchment);
    // Font axis follows the chosen face...
    expect(vars["--wordtaste-font-family"]).toContain("LXGW WenKai");
    // ...while the color axis independently follows the chosen theme.
    expect(vars["--wordtaste-theme-bg"]).toBe(parchment.palette.bg);
    expect(vars["--wordtaste-theme-mode"]).toBe("day");
  });

  it("the same font composes onto a night theme just as cleanly", () => {
    const wenkai = fontById("wenkai")!;
    const midnight = themeById("midnight")!;
    const vars = surfaceCssVars(wenkai, midnight);
    expect(vars["--wordtaste-font-family"]).toContain("LXGW WenKai");
    expect(vars["--wordtaste-theme-mode"]).toBe("night");
  });
});
