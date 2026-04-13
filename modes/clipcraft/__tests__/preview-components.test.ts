import { describe, test, expect } from "bun:test";

describe("preview component module imports", () => {
  test("PreviewCanvas exports a function", async () => {
    const mod = await import("../viewer/PreviewCanvas.js");
    expect(typeof mod.PreviewCanvas).toBe("function");
  });

  test("PlaybackControls exports a function", async () => {
    const mod = await import("../viewer/PlaybackControls.js");
    expect(typeof mod.PlaybackControls).toBe("function");
  });
});
