import { describe, it, expect } from "bun:test";
import {
  FONTS,
  THEMES,
  DEFAULT_FONT_ID,
  DEFAULT_FONT_BY_SCRIPT,
  DEFAULT_THEME_ID,
  DEFAULT_SKIN,
  DEFAULT_THEME_BY_SKIN,
  SURFACE_SKINS,
  LEGACY_SKIN_MAP,
  fontById,
  themeById,
  detectScript,
  isSurfaceSkin,
  otherSkin,
  readStoredSkin,
  resolveFont,
  resolveSkin,
  resolveSurfaceTheme,
  resolveTheme,
  skinStorageKey,
  writeStoredSkin,
  fontCssVars,
  themeCssVars,
  surfaceCssVars,
  type ColorTheme,
  type ReadingFont,
  type SkinStore,
  type SurfaceSkin,
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

// ── The skin axis — which surface the whole studio reads on ──────────────────

/** A Storage-shaped double that keeps its writes in memory. */
function fakeStore(seed: Record<string, string> = {}): SkinStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

/** The Storage a browser hands out in private mode / over quota. */
const throwingStore: SkinStore = {
  getItem() {
    throw new DOMException("SecurityError");
  },
  setItem() {
    throw new DOMException("QuotaExceededError");
  },
};

describe("the skin axis — the surface the whole studio reads on", () => {
  it("offers exactly two surfaces and defaults to the dark one", () => {
    expect([...SURFACE_SKINS].sort()).toEqual(["dark", "light"]);
    expect(DEFAULT_SKIN).toBe("dark");
  });

  it("names a real theme as each skin's article palette", () => {
    for (const skin of SURFACE_SKINS) {
      const theme = themeById(DEFAULT_THEME_BY_SKIN[skin]);
      expect(theme, `theme for skin ${skin}`).toBeDefined();
      // A light surface reads on a day palette, a dark one on a night palette —
      // otherwise the page and the desk it sits on disagree.
      expect(theme!.mode).toBe(skin === "light" ? "day" : "night");
    }
  });

  it("recognises only the two known skin ids", () => {
    expect(isSurfaceSkin("light")).toBe(true);
    expect(isSurfaceSkin("dark")).toBe(true);
    expect(isSurfaceSkin("banana")).toBe(false);
    expect(isSurfaceSkin("")).toBe(false);
    expect(isSurfaceSkin(null)).toBe(false);
    expect(isSurfaceSkin(undefined)).toBe(false);
    expect(isSurfaceSkin(1)).toBe(false);
  });

  it("flips to the other surface", () => {
    expect(otherSkin("dark")).toBe("light");
    expect(otherSkin("light")).toBe("dark");
  });
});

describe("resolveSkin — the user's toggle wins, the file is the default", () => {
  it("defaults to dark when neither the user nor the file says anything", () => {
    expect(resolveSkin({}, null)).toBe("dark");
    expect(resolveSkin(null, null)).toBe("dark");
    expect(resolveSkin(undefined, undefined)).toBe("dark");
  });

  it("takes the stored choice over whatever the file says", () => {
    expect(resolveSkin({ theme: "midnight" }, "light")).toBe("light");
    expect(resolveSkin({ theme: "parchment" }, "dark")).toBe("dark");
  });

  it("reads the file default off the theme axis — a day palette means a light surface", () => {
    expect(resolveSkin({ theme: "parchment" }, null)).toBe("light");
    expect(resolveSkin({ theme: "quartz" }, null)).toBe("light");
    expect(resolveSkin({ theme: "dusk" }, null)).toBe("dark");
  });

  it("honours an agent's themeSuggested the same way", () => {
    expect(resolveSkin({ themeSuggested: "ivory" }, null)).toBe("light");
    expect(resolveSkin({ themeSuggested: "midnight" }, null)).toBe("dark");
  });

  it("maps a pre-split legacy `skin` id through to a surface", () => {
    // The legacy vocabulary is not a second theme mechanism: it resolves to a
    // theme first, and the theme's day/night mood is what names the surface.
    expect(resolveSkin({ skin: "parchment" }, null)).toBe("light");
    expect(resolveSkin({ skin: "dusk" }, null)).toBe("dark");
    expect(resolveSkin({ skinSuggested: "ivory" }, null)).toBe("light");
  });

  it("ignores a stored value that names no known skin", () => {
    expect(resolveSkin({ theme: "midnight" }, "banana")).toBe("dark");
    expect(resolveSkin({ theme: "parchment" }, "")).toBe("light");
    expect(resolveSkin({}, 7)).toBe("dark");
  });

  it("ignores an unknown theme id and lands on the default surface", () => {
    expect(resolveSkin({ theme: "ghost" }, null)).toBe("dark");
  });
});

describe("resolveSurfaceTheme — the article palette agrees with the surface", () => {
  it("leaves the resolved theme alone when it already matches the surface", () => {
    expect(resolveSurfaceTheme({ theme: "dusk" }, "dark").id).toBe("dusk");
    expect(resolveSurfaceTheme({ theme: "quartz" }, "light").id).toBe("quartz");
  });

  it("substitutes the surface's own palette when the two disagree", () => {
    // Toggling to light must not leave a night page on a paper desk.
    expect(resolveSurfaceTheme({ theme: "midnight" }, "light").id).toBe(
      DEFAULT_THEME_BY_SKIN.light,
    );
    expect(resolveSurfaceTheme({ theme: "parchment" }, "dark").id).toBe(
      DEFAULT_THEME_BY_SKIN.dark,
    );
  });

  it("returns a day palette for light and a night palette for dark, always", () => {
    for (const theme of THEMES) {
      expect(resolveSurfaceTheme({ theme: theme.id }, "light").mode).toBe("day");
      expect(resolveSurfaceTheme({ theme: theme.id }, "dark").mode).toBe("night");
    }
  });

  it("comes back to the file's own theme when the user toggles away and back", () => {
    const cfg = { theme: "dusk" };
    const away = resolveSurfaceTheme(cfg, "light");
    expect(away.id).toBe(DEFAULT_THEME_BY_SKIN.light);
    // Nothing about the file changed, so returning to dark returns to dusk.
    expect(resolveSurfaceTheme(cfg, "dark").id).toBe("dusk");
  });

  it("changes nothing for a user who never toggles — the invariant this ships on", () => {
    // For every config the file can express, the untoggled surface theme is
    // exactly what resolveTheme already produced before the skin axis existed.
    const configs: Array<Record<string, unknown>> = [
      {},
      { theme: "ghost" },
      ...THEMES.map((t) => ({ theme: t.id })),
      ...THEMES.map((t) => ({ themeSuggested: t.id })),
      ...Object.keys(LEGACY_SKIN_MAP).map((id) => ({ skin: id })),
      ...Object.keys(LEGACY_SKIN_MAP).map((id) => ({ skinSuggested: id })),
    ];
    for (const cfg of configs) {
      const skin = resolveSkin(cfg, null);
      expect(resolveSurfaceTheme(cfg, skin).id, JSON.stringify(cfg)).toBe(
        resolveTheme(cfg).id,
      );
    }
  });
});

describe("skin persistence — one remembered choice per session", () => {
  it("keys the choice by session so two sessions can differ", () => {
    const a = skinStorageKey("session-a");
    const b = skinStorageKey("session-b");
    expect(a).not.toBe(b);
    expect(a).toContain("wordtaste");
    // A viewer that has not learned its session id yet still has somewhere to
    // write, and it must not collide with a real session.
    const anonymous = skinStorageKey(null);
    expect(anonymous.length).toBeGreaterThan(0);
    expect(anonymous).not.toBe(a);
    expect(skinStorageKey(undefined)).toBe(anonymous);
  });

  it("round-trips a choice through a store", () => {
    const store = fakeStore();
    const key = skinStorageKey("s1");
    expect(readStoredSkin(key, store)).toBe(null);
    writeStoredSkin(key, "light", store);
    expect(readStoredSkin(key, store)).toBe("light");
    writeStoredSkin(key, "dark", store);
    expect(readStoredSkin(key, store)).toBe("dark");
  });

  it("reads nothing for a session that never toggled", () => {
    const store = fakeStore({ [skinStorageKey("s1")]: "light" });
    expect(readStoredSkin(skinStorageKey("s2"), store)).toBe(null);
  });

  it("discards a stored value that names no known skin", () => {
    const key = skinStorageKey("s1");
    expect(readStoredSkin(key, fakeStore({ [key]: "banana" }))).toBe(null);
    expect(readStoredSkin(key, fakeStore({ [key]: "" }))).toBe(null);
  });

  it("survives a Storage that throws on read and on write", () => {
    // Private mode, a disabled-storage policy, or a full quota must degrade to
    // "the habit is not remembered", never to a broken viewer.
    const key = skinStorageKey("s1");
    expect(readStoredSkin(key, throwingStore)).toBe(null);
    expect(() => writeStoredSkin(key, "light", throwingStore)).not.toThrow();
  });

  it("survives having no Storage at all", () => {
    const key = skinStorageKey("s1");
    expect(readStoredSkin(key, null)).toBe(null);
    expect(() => writeStoredSkin(key, "light", null)).not.toThrow();
  });

  it("feeds resolveSkin directly — stored choice, then file, then dark", () => {
    const key = skinStorageKey("s1");
    const store = fakeStore();
    const cfg = { theme: "midnight" };
    expect(resolveSkin(cfg, readStoredSkin(key, store))).toBe("dark");
    writeStoredSkin(key, "light", store);
    expect(resolveSkin(cfg, readStoredSkin(key, store))).toBe("light");
  });
});

describe("skin typing", () => {
  it("narrows an unknown value to a SurfaceSkin", () => {
    const raw: unknown = "light";
    if (isSurfaceSkin(raw)) {
      const skin: SurfaceSkin = raw;
      expect(skin).toBe("light");
    } else {
      throw new Error("expected 'light' to narrow");
    }
  });
});
