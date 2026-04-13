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

  test("layerTypes exports tracksForLayer", async () => {
    const mod = await import("../viewer/overview/layerTypes.js");
    expect(typeof mod.tracksForLayer).toBe("function");
    expect(Array.isArray(mod.LAYER_PRIORITY)).toBe(true);
  });

  test("useOverviewCamera exports a function", async () => {
    const mod = await import("../viewer/overview/useOverviewCamera.js");
    expect(typeof mod.useOverviewCamera).toBe("function");
  });

  test("OverviewControls exports a function", async () => {
    const mod = await import("../viewer/overview/OverviewControls.js");
    expect(typeof mod.OverviewControls).toBe("function");
  });

  test("LayerToggle exports a function", async () => {
    const mod = await import("../viewer/overview/LayerToggle.js");
    expect(typeof mod.LayerToggle).toBe("function");
  });

  test("FakeWaveform exports a function", async () => {
    const mod = await import("../viewer/overview/FakeWaveform.js");
    expect(typeof mod.FakeWaveform).toBe("function");
  });

  test("VideoLayerContent exports a function", async () => {
    const mod = await import("../viewer/overview/VideoLayerContent.js");
    expect(typeof mod.VideoLayerContent).toBe("function");
  });

  test("CaptionLayerContent exports a function", async () => {
    const mod = await import("../viewer/overview/CaptionLayerContent.js");
    expect(typeof mod.CaptionLayerContent).toBe("function");
  });

  test("AudioLayerContent exports a function", async () => {
    const mod = await import("../viewer/overview/AudioLayerContent.js");
    expect(typeof mod.AudioLayerContent).toBe("function");
  });

  test("Layer3D exports a function", async () => {
    const mod = await import("../viewer/overview/Layer3D.js");
    expect(typeof mod.Layer3D).toBe("function");
  });

  test("TimelineOverview3D exports a function", async () => {
    const mod = await import("../viewer/overview/TimelineOverview3D.js");
    expect(typeof mod.TimelineOverview3D).toBe("function");
  });

  test("useCurrentFrame exports a function", async () => {
    const mod = await import("../viewer/exploded/useCurrentFrame.js");
    expect(typeof mod.useCurrentFrame).toBe("function");
  });

  test("useActiveSceneAtTime exports a function", async () => {
    const mod = await import("../viewer/exploded/useActiveSceneAtTime.js");
    expect(typeof mod.useActiveSceneAtTime).toBe("function");
  });

  test("exploded WaveformBars exports a function", async () => {
    const mod = await import("../viewer/exploded/WaveformBars.js");
    expect(typeof mod.WaveformBars).toBe("function");
  });

  test("ExplodedLayer exports a function", async () => {
    const mod = await import("../viewer/exploded/ExplodedLayer.js");
    expect(typeof mod.ExplodedLayer).toBe("function");
    expect(Array.isArray(mod.LAYER_ORDER)).toBe(true);
  });

  test("ExplodedView exports a function", async () => {
    const mod = await import("../viewer/exploded/ExplodedView.js");
    expect(typeof mod.ExplodedView).toBe("function");
  });
});
