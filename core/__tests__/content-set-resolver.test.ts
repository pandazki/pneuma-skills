import { describe, test, expect } from "bun:test";
import { createDirectoryContentSetResolver } from "../utils/content-set-resolver.js";
import type { ViewerFileContent } from "../types/viewer-contract.js";

function f(path: string): ViewerFileContent {
  return { path, content: "" };
}

describe("createDirectoryContentSetResolver", () => {
  const resolve = createDirectoryContentSetResolver();

  test("returns empty for files only at root (no directories)", () => {
    expect(resolve([f("README.md"), f("notes.md")])).toEqual([]);
  });

  test("returns empty for single directory (not switchable)", () => {
    expect(resolve([f("en/README.md"), f("en/notes.md")])).toEqual([]);
  });

  test("discovers two locale directories as content sets", () => {
    const result = resolve([
      f("en/README.md"),
      f("ja/README.md"),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].prefix).toBe("en");
    expect(result[0].traits.locale).toBe("en");
    expect(result[1].prefix).toBe("ja");
    expect(result[1].traits.locale).toBe("ja");
  });

  test("parses locale + theme from directory name", () => {
    const result = resolve([
      f("en-dark/README.md"),
      f("ja-light/README.md"),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ prefix: "en-dark", traits: { locale: "en", theme: "dark" } });
    expect(result[1]).toMatchObject({ prefix: "ja-light", traits: { locale: "ja", theme: "light" } });
  });

  test("handles underscore separator", () => {
    const result = resolve([
      f("en_dark/file.md"),
      f("ja_light/file.md"),
    ]);
    expect(result[0].traits).toMatchObject({ locale: "en", theme: "dark" });
    expect(result[1].traits).toMatchObject({ locale: "ja", theme: "light" });
  });

  test("generates labels from directory name parts", () => {
    const result = resolve([
      f("en-dark/file.md"),
      f("ja-light/file.md"),
    ]);
    expect(result[0].label).toBe("EN Dark");
    expect(result[1].label).toBe("JA Light");
  });

  test("sorts content sets by prefix", () => {
    const result = resolve([
      f("zh/file.md"),
      f("en/file.md"),
      f("ja/file.md"),
    ]);
    expect(result.map((v) => v.prefix)).toEqual(["en", "ja", "zh"]);
  });

  test("ignores root-level files", () => {
    const result = resolve([
      f("config.json"),
      f("en/README.md"),
      f("ja/README.md"),
    ]);
    expect(result).toHaveLength(2);
  });

  test("respects minFiles option", () => {
    const resolve3 = createDirectoryContentSetResolver({ minFiles: 3 });
    const result = resolve3([
      f("en/a.md"),
      f("en/b.md"),
      f("en/c.md"),
      f("ja/a.md"), // only 1 file
    ]);
    // ja has only 1 file (< 3), so only en qualifies, but 1 set → empty
    expect(result).toEqual([]);
  });

  test("respects dirPattern option", () => {
    const resolve = createDirectoryContentSetResolver({ dirPattern: /^(en|ja)/ });
    const result = resolve([
      f("en/file.md"),
      f("ja/file.md"),
      f("assets/img.png"),  // doesn't match pattern
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.prefix)).toEqual(["en", "ja"]);
  });

  test("custom parseName", () => {
    const resolve = createDirectoryContentSetResolver({
      parseName: (name) => {
        if (name.startsWith("v")) return { label: `Version ${name.slice(1)}` };
        return null;
      },
    });
    const result = resolve([
      f("v1/file.md"),
      f("v2/file.md"),
      f("other/file.md"),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ prefix: "v1", label: "Version 1" });
  });

  test("handles deeply nested files correctly (groups by top-level dir)", () => {
    const result = resolve([
      f("en/slides/s1.html"),
      f("en/slides/s2.html"),
      f("ja/slides/s1.html"),
      f("ja/slides/s2.html"),
    ]);
    expect(result).toHaveLength(2);
  });

  test("unknown name parts are included in label", () => {
    const result = resolve([
      f("corporate-en/file.md"),
      f("casual-ja/file.md"),
    ]);
    // Sorted alphabetically: casual-ja, corporate-en
    expect(result[0].label).toBe("Casual JA");
    expect(result[1].label).toBe("Corporate EN");
  });
});
