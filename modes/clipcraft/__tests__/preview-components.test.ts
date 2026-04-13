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

  test("PreviewPanel exports a function", async () => {
    const mod = await import("../viewer/PreviewPanel.js");
    expect(typeof mod.PreviewPanel).toBe("function");
  });

  test("useTimelineZoom exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useTimelineZoom.js");
    expect(typeof mod.useTimelineZoom).toBe("function");
  });

  test("TimeRuler exports a function", async () => {
    const mod = await import("../viewer/timeline/TimeRuler.js");
    expect(typeof mod.TimeRuler).toBe("function");
  });

  test("Playhead exports a function", async () => {
    const mod = await import("../viewer/timeline/Playhead.js");
    expect(typeof mod.Playhead).toBe("function");
  });
});
