/**
 * Direct unit tests for `core/utils/manifest-parser.ts::parseManifestTs`.
 *
 * This is the regex-based metadata reader that `loadModeManifest`,
 * `local-modes`, `library-registry`, and the launcher depend on to surface
 * mode metadata WITHOUT evaluating the TypeScript. It previously had only
 * indirect coverage via `local-modes.test.ts`; these tests pin its behavior
 * directly so the regexes can be refactored without silent drift.
 *
 * Fixtures are inline TypeScript source strings shaped like real
 * `modes/<name>/manifest.ts` files. The parser reads source text, so the
 * fixtures are the contract under test — not evaluated objects.
 */

import { describe, test, expect } from "bun:test";

import { parseManifestTs, type ParsedManifest } from "../utils/manifest-parser.js";

/**
 * A canonical, fully-populated single-locale manifest source. Mirrors the
 * shape of a real builtin manifest (top-level scalars + nested `viewer` and
 * `skill` blocks) so extraction is exercised against realistic nesting, not
 * a stripped happy-path object.
 */
const FULL_MANIFEST = `import type { ModeManifest } from "../../core/types/mode-manifest.js";

const manifest: ModeManifest = {
  name: "webcraft",
  version: "2.4.1",
  pneumaVersion: "^3.8.0",
  type: "single-file",
  layout: "split",
  displayName: "Webcraft",
  description: "Craft single-file web pages",
  icon: \`<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>\`,
  skill: {
    sourceDir: "skill",
    installName: "pneuma-webcraft",
  },
  viewer: {
    watchPatterns: ["**/index.html", "**/styles.css", "**/script.js"],
    ignorePatterns: [],
    serveDir: ".",
  },
};

export default manifest;`;

describe("parseManifestTs — scalar field extraction", () => {
  test("extracts the top-level name", () => {
    expect(parseManifestTs(FULL_MANIFEST).name).toBe("webcraft");
  });

  test("extracts the top-level version", () => {
    expect(parseManifestTs(FULL_MANIFEST).version).toBe("2.4.1");
  });

  test("extracts pneumaVersion as a distinct field from version", () => {
    const parsed = parseManifestTs(FULL_MANIFEST);
    expect(parsed.pneumaVersion).toBe("^3.8.0");
    // Regression guard: pins that the two extractions stay independent of
    // declaration order (the declared-first case below covers the inverse).
    expect(parsed.version).toBe("2.4.1");
  });

  test("does not confuse version with pneumaVersion when pneumaVersion is declared first", () => {
    const src = `const m = {
  name: "alpha",
  pneumaVersion: "^3.8.0",
  version: "1.2.0",
};`;
    const parsed = parseManifestTs(src);
    expect(parsed.version).toBe("1.2.0");
    expect(parsed.pneumaVersion).toBe("^3.8.0");
  });

  test("extracts installName from the nested skill block", () => {
    expect(parseManifestTs(FULL_MANIFEST).installName).toBe("pneuma-webcraft");
  });

  test("maps workspaceType from the `type` field", () => {
    expect(parseManifestTs(FULL_MANIFEST).workspaceType).toBe("single-file");
  });

  test("extracts layout", () => {
    expect(parseManifestTs(FULL_MANIFEST).layout).toBe("split");
  });

  test("accepts single-quoted scalar values, not only double-quoted", () => {
    const src = `const m = { name: 'doc', version: '0.9.0' };`;
    const parsed = parseManifestTs(src);
    expect(parsed.name).toBe("doc");
    expect(parsed.version).toBe("0.9.0");
  });
});

describe("parseManifestTs — icon extraction (quoted vs backtick)", () => {
  test("extracts an icon declared as a quoted string", () => {
    const src = `const m = { name: "doc", icon: "data:image/svg+xml,abc" };`;
    expect(parseManifestTs(src).icon).toBe("data:image/svg+xml,abc");
  });

  test("extracts an icon declared as a backtick template string", () => {
    const src = `const m = {
  name: "slide",
  icon: \`<svg viewBox="0 0 24 24" fill="none"><path d="M3 3" /></svg>\`,
};`;
    expect(parseManifestTs(src).icon).toBe(
      `<svg viewBox="0 0 24 24" fill="none"><path d="M3 3" /></svg>`,
    );
  });

  test("prefers the backtick form when both extraction paths could match", () => {
    // A backtick icon that contains nested double-quotes (the common SVG
    // case) must be returned whole — the quoted-string fallback would only
    // capture up to the first inner quote, so the backtick path must win.
    const src = `const m = {
  name: "slide",
  icon: \`<svg fill="none"><path /></svg>\`,
};`;
    const icon = parseManifestTs(src).icon;
    expect(icon).toBe(`<svg fill="none"><path /></svg>`);
    // What the quoted-string fallback would have wrongly produced:
    expect(icon).not.toBe(`<svg fill=`);
  });
});

describe("parseManifestTs — watchPatterns string-array extraction", () => {
  test("extracts watchPatterns into a string array", () => {
    expect(parseManifestTs(FULL_MANIFEST).watchPatterns).toEqual([
      "**/index.html",
      "**/styles.css",
      "**/script.js",
    ]);
  });

  test("returns undefined when watchPatterns is absent", () => {
    const src = `const m = { name: "doc" };`;
    expect(parseManifestTs(src).watchPatterns).toBeUndefined();
  });

  test("returns undefined for an empty watchPatterns array", () => {
    const src = `const m = {
  name: "doc",
  viewer: { watchPatterns: [], ignorePatterns: [] },
};`;
    expect(parseManifestTs(src).watchPatterns).toBeUndefined();
  });
});

describe("parseManifestTs — hidden boolean", () => {
  test("reads hidden: true", () => {
    const src = `const m = { name: "evolve", hidden: true };`;
    expect(parseManifestTs(src).hidden).toBe(true);
  });

  test("reads an explicit hidden: false as false, not undefined", () => {
    const src = `const m = { name: "webcraft", hidden: false };`;
    expect(parseManifestTs(src).hidden).toBe(false);
  });

  test("returns undefined when hidden is absent (distinct from false)", () => {
    const src = `const m = { name: "webcraft" };`;
    expect(parseManifestTs(src).hidden).toBeUndefined();
  });
});

describe("parseManifestTs — result shape for absent fields", () => {
  test("every unset field comes back undefined for a minimal manifest", () => {
    const src = `const m = { name: "minimal" };`;
    const parsed = parseManifestTs(src);
    // The result shape is pinned exhaustively: only `name` is populated; the
    // rest of the ParsedManifest surface must be explicitly undefined so
    // consumers can rely on undefined === "not declared".
    const expected: ParsedManifest = {
      name: "minimal",
      version: undefined,
      pneumaVersion: undefined,
      displayName: undefined,
      description: undefined,
      icon: undefined,
      watchPatterns: undefined,
      installName: undefined,
      workspaceType: undefined,
      layout: undefined,
      inspiredBy: undefined,
      hidden: undefined,
    };
    expect(parsed).toEqual(expected);
  });
});

describe("parseManifestTs — LocalizedString (displayName / description)", () => {
  /**
   * Multi-locale fixture mirroring the 7-locale object form of
   * `modes/slide/manifest.ts` (en + zh-CN/zh-TW + ja/ko/es/de).
   */
  const SEVEN_LOCALE_MANIFEST = `const manifest = {
  name: "slide",
  version: "1.2.0",
  displayName: {
    en: "Slide",
    "zh-CN": "幻灯片",
    "zh-TW": "投影片",
    ja: "スライド",
    ko: "슬라이드",
    es: "Diapositivas",
    de: "Folien",
  },
  description: {
    en: "HTML presentations",
    "zh-CN": "HTML 演示文稿",
    "zh-TW": "HTML 投影片",
    ja: "HTML プレゼン",
    ko: "HTML 프레젠테이션",
    es: "Presentaciones HTML",
    de: "HTML-Präsentationen",
  },
};`;

  test("returns the requested locale when present (quoted key, zh-CN)", () => {
    expect(parseManifestTs(SEVEN_LOCALE_MANIFEST, "zh-CN").displayName).toBe("幻灯片");
  });

  test("returns the requested locale when present (bare key, ja)", () => {
    expect(parseManifestTs(SEVEN_LOCALE_MANIFEST, "ja").displayName).toBe("スライド");
  });

  test("applies the same locale selection to description, not just displayName", () => {
    expect(parseManifestTs(SEVEN_LOCALE_MANIFEST, "de").description).toBe(
      "HTML-Präsentationen",
    );
  });

  test("defaults to the en value when no locale is passed", () => {
    expect(parseManifestTs(SEVEN_LOCALE_MANIFEST).displayName).toBe("Slide");
  });

  test("falls back to en when the requested locale is missing", () => {
    // `fr` is not in the locale map; en must be used.
    expect(parseManifestTs(SEVEN_LOCALE_MANIFEST, "fr").displayName).toBe("Slide");
  });

  test("falls back to the first non-empty value when en is also missing", () => {
    const src = `const m = {
  name: "alpha",
  displayName: {
    "zh-CN": "",
    ja: "フィールド",
  },
};`;
    // Neither the requested locale (ko) nor en exists, and the first value is
    // EMPTY — the non-empty qualifier must skip it rather than return "".
    expect(parseManifestTs(src, "ko").displayName).toBe("フィールド");
  });

  test("treats a plain string displayName as that value for any requested locale", () => {
    // LocalizedString extraction anchors to the canonical top-level form
    // (own line, two-space indent), the way every real manifest is
    // formatted, so the field is matched regardless of locale.
    const src = `const m = {
  name: "doc",
  displayName: "Doc",
};`;
    expect(parseManifestTs(src, "zh-CN").displayName).toBe("Doc");
    expect(parseManifestTs(src, "en").displayName).toBe("Doc");
  });

  test("does not leak a nested same-name field into the top-level displayName", () => {
    // `init.params[].description` is a common nested `description:` that the
    // top-level extraction must NOT pick up.
    const src = `const m = {
  name: "webcraft",
  description: "Craft web pages",
  init: {
    params: [
      { key: "falApiKey", description: "Your fal.ai key" },
    ],
  },
};`;
    expect(parseManifestTs(src).description).toBe("Craft web pages");
  });
});

describe("parseManifestTs — inspiredBy object extraction", () => {
  test("extracts name and url from the inspiredBy object", () => {
    const src = `const m = {
  name: "slide",
  inspiredBy: { name: "Reveal.js", url: "https://revealjs.com" },
};`;
    expect(parseManifestTs(src).inspiredBy).toEqual({
      name: "Reveal.js",
      url: "https://revealjs.com",
    });
  });

  test("returns undefined when inspiredBy is absent", () => {
    const src = `const m = { name: "doc" };`;
    expect(parseManifestTs(src).inspiredBy).toBeUndefined();
  });

  test("returns undefined when inspiredBy is missing its url", () => {
    // Both name AND url are required; a partial object is not surfaced.
    const src = `const m = {
  name: "slide",
  inspiredBy: { name: "Reveal.js" },
};`;
    expect(parseManifestTs(src).inspiredBy).toBeUndefined();
  });
});

describe("parseManifestTs — malformed / partial input does not throw", () => {
  test("returns an empty (all-undefined) ParsedManifest for non-manifest text", () => {
    const parsed = parseManifestTs("not really typescript {{}}");
    expect(parsed.name).toBeUndefined();
    expect(parsed.version).toBeUndefined();
    expect(parsed.displayName).toBeUndefined();
  });

  test("returns a partial result from source truncated mid-object", () => {
    // The closing brace of the manifest object never arrives. Scalar fields
    // declared before the cut must still extract; nothing should throw.
    const truncated = `const manifest = {
  name: "webcraft",
  version: "2.4.1",
  displayName: {
    en: "Webcraft",`;
    const parsed = parseManifestTs(truncated);
    expect(parsed.name).toBe("webcraft");
    expect(parsed.version).toBe("2.4.1");
    // The half-open localized block: the brace-walker hits EOF at depth 1,
    // so displayName must come back undefined rather than garbage.
    expect(parsed.displayName).toBeUndefined();
  });

  test("does not throw on an unterminated string literal", () => {
    const broken = `const m = { name: "webcraft`;
    expect(() => parseManifestTs(broken)).not.toThrow();
    expect(parseManifestTs(broken).name).toBeUndefined();
  });

  test("does not throw on the empty string and yields no fields", () => {
    const parsed = parseManifestTs("");
    expect(parsed.name).toBeUndefined();
    expect(parsed.hidden).toBeUndefined();
  });
});
