import { expect, test } from "bun:test";
import { isPublishedMode } from "../types/mode-registry.js";

test("published mode records require the fields used to display and install them", () => {
  const mode = { name: "demo", displayName: "Demo", version: "1", publishedAt: "2026-11-02", archiveUrl: "https://example.com/demo.tgz" };
  expect(isPublishedMode(mode)).toBe(true);
  expect(isPublishedMode({ ...mode, icon: "data:image/svg+xml,..." })).toBe(true);
  expect(isPublishedMode({ ...mode, archiveUrl: undefined })).toBe(false);
  expect(isPublishedMode({ ...mode, description: 42 })).toBe(false);
  expect(isPublishedMode(null)).toBe(false);
});
