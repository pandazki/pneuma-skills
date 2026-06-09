import { describe, expect, test } from "bun:test";
import { parseCustomDomains } from "../cloudflare-pages.js";

describe("parseCustomDomains", () => {
  test("splits on newlines and commas, trims, de-dupes", () => {
    expect(parseCustomDomains("deepaste.ai\nfoo.dev, bar.io\ndeepaste.ai")).toEqual([
      "deepaste.ai",
      "foo.dev",
      "bar.io",
    ]);
  });

  test("strips protocol, leading dots, trailing paths, and lowercases", () => {
    expect(parseCustomDomains("https://Deepaste.AI/some/path\n.foo.dev")).toEqual([
      "deepaste.ai",
      "foo.dev",
    ]);
  });

  test("drops blanks and the implicit pages.dev default", () => {
    expect(parseCustomDomains("\n  \npages.dev\ndeepaste.ai\n")).toEqual(["deepaste.ai"]);
  });

  test("empty input → empty list", () => {
    expect(parseCustomDomains("")).toEqual([]);
    expect(parseCustomDomains("   ")).toEqual([]);
  });
});
