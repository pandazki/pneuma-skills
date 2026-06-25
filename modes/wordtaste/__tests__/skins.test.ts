import { describe, it, expect } from "bun:test";
import {
  SKINS,
  DEFAULT_SKIN_ID,
  resolveSkin,
  skinById,
  skinCssVars,
  type Skin,
} from "../viewer/skins.js";

describe("the curated skin set", () => {
  it("ships a reading-optimized set with day and night options", () => {
    expect(SKINS.length).toBeGreaterThanOrEqual(4);
    expect(SKINS.length).toBeLessThanOrEqual(6);
    const modes = new Set(SKINS.map((s) => s.mode));
    expect(modes.has("day")).toBe(true);
    expect(modes.has("night")).toBe(true);
  });

  it("includes at least one warm serif day skin and one clean sans day skin", () => {
    // A serif reading face ends its stack in `serif` (not `sans-serif`); a sans
    // face ends in `sans-serif`. Test the terminal generic family, which is the
    // real register signal.
    const isSans = (f: string) => /sans-serif\s*$/i.test(f);
    const isSerif = (f: string) => /[^-]serif\s*$/i.test(f) && !isSans(f);
    const serifDay = SKINS.find((s) => s.mode === "day" && isSerif(s.fontFamily));
    const sansDay = SKINS.find((s) => s.mode === "day" && isSans(s.fontFamily));
    expect(serifDay).toBeDefined();
    expect(sansDay).toBeDefined();
  });

  it("every skin has a unique id, a label, a palette, and reading geometry", () => {
    const ids = new Set<string>();
    for (const s of SKINS) {
      expect(s.id.length).toBeGreaterThan(0);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.palette.bg.length).toBeGreaterThan(0);
      expect(s.palette.fg.length).toBeGreaterThan(0);
      expect(s.measure.length).toBeGreaterThan(0);
      expect(s.lineHeight).toBeGreaterThan(1);
    }
  });

  it("the default skin id resolves to a real skin", () => {
    expect(skinById(DEFAULT_SKIN_ID)).toBeDefined();
  });
});

describe("resolveSkin — skin (user) wins, then skinSuggested (agent), then default", () => {
  const valid = SKINS[0].id;
  const suggested = SKINS[1].id;

  it("uses the user's explicit skin over the agent suggestion", () => {
    expect(resolveSkin({ skin: valid, skinSuggested: suggested }).id).toBe(valid);
  });

  it("falls back to the agent suggestion when the user has not chosen", () => {
    expect(resolveSkin({ skinSuggested: suggested }).id).toBe(suggested);
  });

  it("falls back to the default when neither is set", () => {
    expect(resolveSkin({}).id).toBe(DEFAULT_SKIN_ID);
    expect(resolveSkin(null).id).toBe(DEFAULT_SKIN_ID);
  });

  it("ignores an unknown skin id and degrades to the next source", () => {
    // Unknown user skin → fall through to a valid suggestion.
    expect(resolveSkin({ skin: "does-not-exist", skinSuggested: suggested }).id).toBe(suggested);
    // Unknown user + unknown suggestion → default.
    expect(resolveSkin({ skin: "nope", skinSuggested: "also-nope" }).id).toBe(DEFAULT_SKIN_ID);
  });
});

describe("skinCssVars — the reading surface is driven by data, not hardcoded CSS", () => {
  const skin: Skin = SKINS[0];

  it("emits the palette + geometry as CSS custom properties", () => {
    const vars = skinCssVars(skin);
    expect(vars["--wordtaste-skin-bg"]).toBe(skin.palette.bg);
    expect(vars["--wordtaste-skin-fg"]).toBe(skin.palette.fg);
    expect(vars["--wordtaste-skin-font"]).toBe(skin.fontFamily);
    expect(vars["--wordtaste-skin-measure"]).toBe(skin.measure);
    expect(vars["--wordtaste-skin-line"]).toBe(String(skin.lineHeight));
  });

  it("a night skin emits a dark background and a day skin a light one", () => {
    const night = SKINS.find((s) => s.mode === "night")!;
    const day = SKINS.find((s) => s.mode === "day")!;
    expect(skinCssVars(night)["--wordtaste-skin-mode"]).toBe("night");
    expect(skinCssVars(day)["--wordtaste-skin-mode"]).toBe("day");
  });
});
