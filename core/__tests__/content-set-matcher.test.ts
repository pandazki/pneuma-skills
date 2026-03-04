import { describe, test, expect } from "bun:test";
import { selectBestContentSet } from "../utils/content-set-matcher.js";
import type { ContentSet } from "../types/viewer-contract.js";

function cs(prefix: string, locale?: string, theme?: "light" | "dark"): ContentSet {
  return { prefix, label: prefix, traits: { locale, theme } };
}

const defaultPrefs = { theme: "dark" as const, locale: "en", locales: ["en", "ja"] };

describe("selectBestContentSet", () => {
  test("returns null for empty array", () => {
    expect(selectBestContentSet([], defaultPrefs)).toBeNull();
  });

  test("returns single content set without scoring", () => {
    const set = cs("en-dark", "en", "dark");
    expect(selectBestContentSet([set], defaultPrefs)).toBe(set);
  });

  test("prefers exact locale match", () => {
    const result = selectBestContentSet(
      [cs("ja", "ja"), cs("en", "en")],
      { theme: "dark", locale: "en", locales: ["en"] },
    );
    expect(result!.prefix).toBe("en");
  });

  test("locale match outweighs theme match", () => {
    // ja-dark matches theme but not locale
    // en-light matches locale but not theme
    const result = selectBestContentSet(
      [cs("ja-dark", "ja", "dark"), cs("en-light", "en", "light")],
      { theme: "dark", locale: "en", locales: ["en"] },
    );
    expect(result!.prefix).toBe("en-light");
  });

  test("prefers locale + theme over locale only", () => {
    const result = selectBestContentSet(
      [cs("en-light", "en", "light"), cs("en-dark", "en", "dark")],
      { theme: "dark", locale: "en", locales: ["en"] },
    );
    expect(result!.prefix).toBe("en-dark");
  });

  test("language-family matching (en matches en-gb)", () => {
    const result = selectBestContentSet(
      [cs("ja", "ja"), cs("en-gb", "en-gb")],
      { theme: "dark", locale: "en", locales: ["en"] },
    );
    expect(result!.prefix).toBe("en-gb");
  });

  test("uses fallback locale list", () => {
    const result = selectBestContentSet(
      [cs("fr", "fr"), cs("ja", "ja")],
      { theme: "dark", locale: "en", locales: ["en", "ja", "fr"] },
    );
    // ja is index 1 in locales → +20, fr is index 2 → +15
    expect(result!.prefix).toBe("ja");
  });

  test("neutral content set (no locale/theme) gets small score", () => {
    // Set with no traits gets score 7 (2+5)
    // Set with wrong locale gets 0+5=5
    const result = selectBestContentSet(
      [cs("default"), cs("ja", "ja")],
      { theme: "dark", locale: "en", locales: ["en"] },
    );
    expect(result!.prefix).toBe("default");
  });

  test("content set with matching theme beats neutral when no locale matches", () => {
    const result = selectBestContentSet(
      [cs("light", undefined, "light"), cs("dark", undefined, "dark")],
      { theme: "dark", locale: "en", locales: ["en"] },
    );
    expect(result!.prefix).toBe("dark");
  });

  test("full match (locale + theme) gets highest score", () => {
    const result = selectBestContentSet(
      [
        cs("en-dark", "en", "dark"),
        cs("en-light", "en", "light"),
        cs("ja-dark", "ja", "dark"),
        cs("ja-light", "ja", "light"),
      ],
      { theme: "dark", locale: "ja", locales: ["ja", "en"] },
    );
    expect(result!.prefix).toBe("ja-dark");
  });
});
