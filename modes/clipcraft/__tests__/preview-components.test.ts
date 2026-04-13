import { describe, test, expect } from "bun:test";

describe("preview component module imports", () => {
  test("VideoPreview exports a function", async () => {
    const mod = await import("../viewer/preview/VideoPreview.js");
    expect(typeof mod.VideoPreview).toBe("function");
  });

  test("CaptionOverlay exports a function", async () => {
    const mod = await import("../viewer/preview/CaptionOverlay.js");
    expect(typeof mod.CaptionOverlay).toBe("function");
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

  test("VideoTrack exports a function", async () => {
    const mod = await import("../viewer/timeline/VideoTrack.js");
    expect(typeof mod.VideoTrack).toBe("function");
  });

  test("AudioTrack exports a function", async () => {
    const mod = await import("../viewer/timeline/AudioTrack.js");
    expect(typeof mod.AudioTrack).toBe("function");
  });

  test("SubtitleTrack exports a function", async () => {
    const mod = await import("../viewer/timeline/SubtitleTrack.js");
    expect(typeof mod.SubtitleTrack).toBe("function");
  });

  test("WaveformBars exports a function", async () => {
    const mod = await import("../viewer/timeline/WaveformBars.js");
    expect(typeof mod.WaveformBars).toBe("function");
  });

  test("Timeline exports a function", async () => {
    const mod = await import("../viewer/timeline/Timeline.js");
    expect(typeof mod.Timeline).toBe("function");
  });

  test("AssetPanel exports a function", async () => {
    const mod = await import("../viewer/assets/AssetPanel.js");
    expect(typeof mod.AssetPanel).toBe("function");
  });

  test("AssetThumbnail exports a function", async () => {
    const mod = await import("../viewer/assets/AssetThumbnail.js");
    expect(typeof mod.AssetThumbnail).toBe("function");
  });

  test("ScriptTab exports a function", async () => {
    const mod = await import("../viewer/assets/ScriptTab.js");
    expect(typeof mod.ScriptTab).toBe("function");
  });

  test("useAssetActions exports a function", async () => {
    const mod = await import("../viewer/assets/useAssetActions.js");
    expect(typeof mod.useAssetActions).toBe("function");
  });
});
