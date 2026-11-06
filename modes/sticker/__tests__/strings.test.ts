/**
 * The viewer speaks the user's Pneuma language (`props.locale`): Chinese,
 * Japanese, else English. Every table must say everything, so a Chinese
 * user never meets an English word the Chinese table forgot.
 */

import { describe, expect, test } from "bun:test";

import { resolveLocale, stickerStrings, STICKER_STRING_TABLES } from "../viewer/strings.js";

const SAMPLE: unknown[] = [3, 2, "1 min"];

function render(key: string, value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    if (key === "nextStep") {
      return ["rights", "anchor", "character", "stickers", "generate", "generating", "pick", "reroll", "export", "check", "done"].map((id) =>
        String((value as (s: unknown) => string)({ id, line: "", stickers: ["s01", "s02"] })),
      );
    }
    if (key === "status") return ["empty", "generating", "failed", "pick", "ready", "stale"].map((s) => String((value as (...a: unknown[]) => string)(s, 2, "3 s")));
    if (key === "artKind") return ["portrait", "head", "banner", "reward-guide", "reward-thanks"].map((k) => String((value as (k: string) => string)(k)));
    if (key === "archiveState") return ["current", "stale", "missing", "blocked"].map((k) => String((value as (k: string) => string)(k)));
    if (key === "exportSummary") return [String((value as (c: unknown) => string)({ current: 1, stale: 1, missing: 1, blocked: 1 }))];
    if (key === "rightsBasis") return ["original", "own-pet", "self", "consenting-adult", "client"].map((k) => String((value as (k: string) => string)(k)));
    if (key === "rowLabel") return ["rights", "count", "words", "zip"].map((k) => String((value as (k: string, f: string) => string)(k, "fallback")));
    return [String((value as (...a: unknown[]) => unknown)(...SAMPLE))];
  }
  return Object.values(value as Record<string, string>);
}

describe("viewer strings", () => {
  test("Chinese and Japanese users get their tables; everything else falls back to English", () => {
    for (const locale of ["zh", "zh-CN", "zh-TW"]) expect(resolveLocale(locale)).toBe("zh-CN");
    for (const locale of ["ja", "ja-JP"]) expect(resolveLocale(locale)).toBe("ja");
    for (const locale of ["en", "en-US", "fr", undefined]) expect(resolveLocale(locale)).toBe("en");
    expect(stickerStrings("zh").makeMissing).toBe("补齐没出图的表情");
    expect(stickerStrings("ja").view.submit).toBe("申請");
  });

  test("every table defines every key, and every entry renders text", () => {
    const en = STICKER_STRING_TABLES.en as unknown as Record<string, unknown>;
    for (const locale of ["zh-CN", "ja"] as const) {
      const table = STICKER_STRING_TABLES[locale] as unknown as Record<string, unknown>;
      expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        expect(typeof table[key]).toBe(typeof en[key]);
        for (const text of render(key, table[key])) {
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toContain("undefined");
        }
      }
    }
    for (const key of Object.keys(en)) for (const text of render(key, en[key])) expect(text).not.toContain("undefined");
  });

  test("the Chinese and Japanese chrome is in Chinese and Japanese", () => {
    const zh = stickerStrings("zh-CN");
    const ja = stickerStrings("ja");
    for (const s of ["empty", "generating", "failed", "pick", "ready", "stale"] as const) {
      expect(zh.status(s, 2, "3 秒")).toMatch(/[一-鿿]/);
      expect(ja.status(s, 2, "3 秒")).toMatch(/[぀-ヿ一-鿿]/);
    }
    expect(zh.noPackBody).toMatch(/[一-鿿]/);
    expect(ja.noPackBody).toMatch(/[぀-ヿ]/);
  });
});
