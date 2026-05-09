import { describe, expect, test } from "bun:test";
import { computePanelStatus } from "../storyboardPanelStatus.js";

const A = (id: string, uri: string) => ({ id, uri });
const PF = (id: string, trackId: string, time: number, assetId: string) => ({
  id,
  trackId,
  time,
  assetId,
});

describe("computePanelStatus", () => {
  test("registered + on timeline → 'placed' with seek time", () => {
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-01.png",
      panelAssetId: "asset-bug-01",
      assets: [A("asset-bug-01", "storyboard/the-bug/panel-01.png")],
      previewFrames: [PF("pf-1", "track-1", 1.5, "asset-bug-01")],
    });
    expect(status).toEqual({
      kind: "placed",
      assetId: "asset-bug-01",
      trackId: "track-1",
      time: 1.5,
    });
  });

  test("registered but not on timeline → 'registered'", () => {
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-02.png",
      panelAssetId: "asset-bug-02",
      assets: [A("asset-bug-02", "storyboard/the-bug/panel-02.png")],
      previewFrames: [],
    });
    expect(status).toEqual({ kind: "registered", assetId: "asset-bug-02" });
  });

  test("unregistered (asset not in registry) → 'unregistered'", () => {
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-03.png",
      panelAssetId: "asset-bug-03",
      assets: [],
      previewFrames: [],
    });
    expect(status).toEqual({
      kind: "unregistered",
      panelPath: "storyboard/the-bug/panel-03.png",
    });
  });

  test("matches by URI when assetId hint absent", () => {
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-04.png",
      panelAssetId: undefined,
      assets: [A("some-other-id", "storyboard/the-bug/panel-04.png")],
      previewFrames: [PF("pf-2", "track-1", 2.0, "some-other-id")],
    });
    expect(status.kind).toBe("placed");
    expect((status as any).assetId).toBe("some-other-id");
    expect((status as any).time).toBe(2.0);
  });

  test("hinted assetId missing from registry falls back to URI match", () => {
    // The agent registered the panel under a different id than the
    // stdout.json hint. URI-match still finds it.
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-05.png",
      panelAssetId: "asset-stale-hint",
      assets: [A("asset-renamed", "storyboard/the-bug/panel-05.png")],
      previewFrames: [],
    });
    expect(status).toEqual({ kind: "registered", assetId: "asset-renamed" });
  });
});
