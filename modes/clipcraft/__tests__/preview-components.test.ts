import { describe, test, expect } from "bun:test";

describe("preview component module imports", () => {
  test("VideoPreview exports a function", async () => {
    const mod = await import("../viewer/preview/VideoPreview.js");
    expect(typeof mod.VideoPreview).toBe("function");
  });

  test("createSubtitleRenderer exports a function", async () => {
    const mod = await import("../viewer/preview/subtitleRenderer.js");
    expect(typeof mod.createSubtitleRenderer).toBe("function");
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

  test("TrackToggle exports a function", async () => {
    const mod = await import("../viewer/overview/TrackToggle.js");
    expect(typeof mod.TrackToggle).toBe("function");
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

  test("Track3D exports a function", async () => {
    const mod = await import("../viewer/overview/Track3D.js");
    expect(typeof mod.Track3D).toBe("function");
  });

  test("TimelineOverview3D exports a function", async () => {
    const mod = await import("../viewer/overview/TimelineOverview3D.js");
    expect(typeof mod.TimelineOverview3D).toBe("function");
  });

  test("exploded WaveformBars exports a function", async () => {
    const mod = await import("../viewer/exploded/WaveformBars.js");
    expect(typeof mod.WaveformBars).toBe("function");
  });

  test("ExplodedTrack exports a function", async () => {
    const mod = await import("../viewer/exploded/ExplodedTrack.js");
    expect(typeof mod.ExplodedTrack).toBe("function");
    expect(Array.isArray(mod.LAYER_ORDER)).toBe(true);
  });

  test("ExplodedView exports a function", async () => {
    const mod = await import("../viewer/exploded/ExplodedView.js");
    expect(typeof mod.ExplodedView).toBe("function");
  });

  test("ExplodedVideoFrame exports a function", async () => {
    const mod = await import("../viewer/exploded/ExplodedVideoFrame.js");
    expect(typeof mod.ExplodedVideoFrame).toBe("function");
  });

  test("useVariantPointer exports VariantPointerProvider and hook", async () => {
    const mod = await import("../viewer/dive/useVariantPointer.js");
    expect(typeof mod.VariantPointerProvider).toBe("function");
    expect(typeof mod.useVariantPointer).toBe("function");
  });

  test("useTreeLayout exports a function", async () => {
    const mod = await import("../viewer/dive/useTreeLayout.js");
    expect(typeof mod.useTreeLayout).toBe("function");
  });

  test("NodeShell exports a function", async () => {
    const mod = await import("../viewer/dive/nodes/NodeShell.js");
    expect(typeof mod.NodeShell).toBe("function");
  });

  test("VisualNode exports a function", async () => {
    const mod = await import("../viewer/dive/nodes/VisualNode.js");
    expect(typeof mod.VisualNode).toBe("function");
  });

  test("AudioNode exports a function", async () => {
    const mod = await import("../viewer/dive/nodes/AudioNode.js");
    expect(typeof mod.AudioNode).toBe("function");
  });

  test("TextNode exports a function", async () => {
    const mod = await import("../viewer/dive/nodes/TextNode.js");
    expect(typeof mod.TextNode).toBe("function");
  });

  test("DiveHeader exports a function", async () => {
    const mod = await import("../viewer/dive/DiveHeader.js");
    expect(typeof mod.DiveHeader).toBe("function");
  });

  test("DiveCanvas exports a function", async () => {
    const mod = await import("../viewer/dive/DiveCanvas.js");
    expect(typeof mod.DiveCanvas).toBe("function");
  });

  test("dragEngine exports pure helpers", async () => {
    const mod = await import("../viewer/timeline/dragEngine.js");
    expect(typeof mod.computeRipplePreview).toBe("function");
    expect(typeof mod.snapDraggedStart).toBe("function");
  });

  test("useTrackDragEngine exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useTrackDragEngine.js");
    expect(typeof mod.useTrackDragEngine).toBe("function");
  });

  test("useClipResize exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useClipResize.js");
    expect(typeof mod.useClipResize).toBe("function");
  });

  test("useTimelineShortcuts exports a function", async () => {
    const mod = await import("../viewer/timeline/hooks/useTimelineShortcuts.js");
    expect(typeof mod.useTimelineShortcuts).toBe("function");
  });

  test("EditToolbar exports a function", async () => {
    const mod = await import("../viewer/timeline/toolbar/EditToolbar.js");
    expect(typeof mod.EditToolbar).toBe("function");
  });

  test("collapseGaps exports a function", async () => {
    const mod = await import("../viewer/timeline/toolbar/collapseGaps.js");
    expect(typeof mod.buildCollapseGapsCommands).toBe("function");
  });

  test("TransportBar exports a function", async () => {
    const mod = await import("../viewer/timeline/transport/TransportBar.js");
    expect(typeof mod.TransportBar).toBe("function");
  });

  test("rippleDelete exports a function", async () => {
    const mod = await import("../viewer/timeline/toolbar/rippleDelete.js");
    expect(typeof mod.buildRippleDeleteCommands).toBe("function");
  });

  test("useClipProvenance exports a function + formatter", async () => {
    const mod = await import("../viewer/timeline/hooks/useClipProvenance.js");
    expect(typeof mod.useClipProvenance).toBe("function");
    expect(typeof mod.formatOperation).toBe("function");
  });

  test("ClipInspector exports a function", async () => {
    const mod = await import("../viewer/timeline/inspector/ClipInspector.js");
    expect(typeof mod.ClipInspector).toBe("function");
  });

  test("VariantSwitcher exports a function", async () => {
    const mod = await import("../viewer/timeline/inspector/VariantSwitcher.js");
    expect(typeof mod.VariantSwitcher).toBe("function");
  });
});
