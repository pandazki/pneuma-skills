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

  test("useFrameExtractor exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useFrameExtractor.js");
    expect(typeof mod.useFrameExtractor).toBe("function");
  });

  test("useWaveform exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useWaveform.js");
    expect(typeof mod.useWaveform).toBe("function");
  });

  test("TrackLabel exports a function", async () => {
    const mod = await import("../viewer/timeline/TrackLabel.js");
    expect(typeof mod.TrackLabel).toBe("function");
  });

  test("ClipStrip exports a function", async () => {
    const mod = await import("../viewer/timeline/ClipStrip.js");
    expect(typeof mod.ClipStrip).toBe("function");
  });

  test("TrackRow exports a function", async () => {
    const mod = await import("../viewer/timeline/TrackRow.js");
    expect(typeof mod.TrackRow).toBe("function");
  });
});
