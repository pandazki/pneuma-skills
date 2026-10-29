/**
 * The viewer speaks the user's Pneuma language: `props.locale` is the
 * language saved in Pneuma's settings, else the browser's, reduced to
 * "en" / "zh" / … by the shell. Both tables must say everything, so a
 * Chinese user never meets an English word the Chinese table forgot.
 */

import { describe, expect, test } from "bun:test";

import { resolveLocale, seriesStrings } from "../viewer/strings.js";

const SAMPLE_ARGS: unknown[] = [3, 2, "ep01", 1.5];

function render(value: unknown): string {
  if (typeof value === "function") return String((value as (...a: unknown[]) => unknown)(...SAMPLE_ARGS));
  return String(value);
}

describe("viewer strings", () => {
  test("Chinese users get the Chinese table; everything else falls back to English", () => {
    for (const locale of ["zh", "zh-CN", "zh-TW", "zh-Hans"]) expect(resolveLocale(locale)).toBe("zh-CN");
    for (const locale of ["en", "en-US", "ja", undefined]) expect(resolveLocale(locale)).toBe("en");
    expect(seriesStrings("zh").wallTitle).toBe("设定墙");
    expect(seriesStrings(undefined).wallTitle).toBe("The wall");
  });

  test("both tables define every key, and every entry renders text", () => {
    const en = seriesStrings("en") as unknown as Record<string, unknown>;
    const zh = seriesStrings("zh-CN") as unknown as Record<string, unknown>;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(typeof zh[key]).toBe(typeof en[key]);
      if (key === "stage" || key === "kindLabel") continue; // keyed by an enum, covered below
      for (const table of [en, zh]) {
        const text = render(table[key]);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toContain("undefined");
      }
    }
    for (const kind of ["character", "group", "scene"] as const) {
      expect(seriesStrings("en").kindLabel(kind).length).toBeGreaterThan(0);
      expect(seriesStrings("zh-CN").kindLabel(kind)).toMatch(/[一-鿿]/);
    }
    for (const stage of ["draft", "planned", "boarded", "shot", "reviewed", "done"] as const) {
      for (const busy of [false, true]) {
        expect(seriesStrings("en").stage(stage, busy).length).toBeGreaterThan(0);
        expect(seriesStrings("zh-CN").stage(stage, busy)).toMatch(/[一-鿿]/);
      }
    }
  });
});
