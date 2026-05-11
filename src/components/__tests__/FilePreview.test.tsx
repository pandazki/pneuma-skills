import { describe, it, expect } from "bun:test";
import { isInlinePreviewable } from "../FilePreview.js";

describe("isInlinePreviewable", () => {
  it("true for image extensions, case-insensitive", () => {
    for (const p of ["/w/a.png", "/w/a.JPG", "/w/a.jpeg", "/w/a.gif", "/w/a.WEBP", "/w/a.svg"]) {
      expect(isInlinePreviewable(p)).toBe(true);
    }
  });
  it("false for non-image files, extensionless paths, and double-extensions", () => {
    for (const p of ["/w/a.ts", "/w/a.md", "/w/a.json", "/w/README", "/w/a.png.bak"]) {
      expect(isInlinePreviewable(p)).toBe(false);
    }
  });
  it("module exports the named FilePreview component", async () => {
    const mod = await import("../FilePreview.js");
    expect(typeof mod.FilePreview).toBe("function");
  });
});
