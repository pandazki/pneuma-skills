import { describe, expect, it } from "bun:test";
import { createCore } from "@pneuma-craft/core";
import { createTimelineCore } from "@pneuma-craft/timeline";
import { createPlaybackEngine } from "@pneuma-craft/video";
import { createPneumaCraftStore } from "@pneuma-craft/react";
import { createWorkspaceAssetResolver } from "../viewer/assetResolver.js";

describe("craft package imports", () => {
  it("exposes createCore from @pneuma-craft/core with expected methods", () => {
    expect(typeof createCore).toBe("function");
    const core = createCore();
    expect(typeof core.getState).toBe("function");
    expect(typeof core.dispatch).toBe("function");
    expect(typeof core.subscribe).toBe("function");
    expect(typeof core.undo).toBe("function");
    expect(typeof core.redo).toBe("function");
    expect(typeof core.canUndo).toBe("function");
    expect(typeof core.canRedo).toBe("function");
    expect(typeof core.getEvents).toBe("function");
    // Sanity: fresh state is non-null and has the expected shape
    const state = core.getState();
    expect(state).toBeDefined();
    expect(state.registry).toBeInstanceOf(Map);
  });

  it("exposes createTimelineCore from @pneuma-craft/timeline with expected methods", () => {
    expect(typeof createTimelineCore).toBe("function");
    const tl = createTimelineCore();
    // TimelineCore uses getCoreState (NOT getState) + getComposition
    expect(typeof tl.getCoreState).toBe("function");
    expect(typeof tl.getComposition).toBe("function");
    expect(typeof tl.dispatch).toBe("function");
    expect(typeof tl.subscribe).toBe("function");
    // No composition until one is created
    expect(tl.getComposition()).toBeNull();
  });

  it("exposes createPlaybackEngine from @pneuma-craft/video", () => {
    expect(typeof createPlaybackEngine).toBe("function");
    // Don't instantiate — it needs an AudioContext + Compositor, which are
    // browser-only. This test runs under bun/node so we only check the factory.
  });

  it("exposes createPneumaCraftStore from @pneuma-craft/react", () => {
    expect(typeof createPneumaCraftStore).toBe("function");
    // createPneumaCraftStore needs an AssetResolver; pass our mode's resolver.
    const store = createPneumaCraftStore(createWorkspaceAssetResolver());
    expect(store).toBeDefined();
    expect(typeof store.getState).toBe("function");
    const state = store.getState();
    expect(state.coreState).toBeDefined();
    expect(state.composition).toBeNull(); // empty until we create one
    // Cleanup lazy playback engine if it was started
    state.destroy?.();
  });

  it("asset:set-status roundtrips through dispatch + event + projection", () => {
    const core = createCore();
    // Register an asset with an explicit generating status
    core.dispatch("human", {
      type: "asset:register",
      asset: {
        type: "image",
        uri: "",
        name: "pending",
        metadata: {},
        status: "generating",
      },
    });
    const [registered] = core.getEvents();
    const assetId = (registered.payload.asset as { id: string }).id;

    // Verify the register surfaced the status field
    expect(core.getState().registry.get(assetId)?.status).toBe("generating");

    // Now flip it to ready
    core.dispatch("human", {
      type: "asset:set-status",
      assetId,
      status: "ready",
    });

    const state = core.getState();
    const asset = state.registry.get(assetId);
    expect(asset?.status).toBe("ready");

    // Undo should put it back to generating
    core.undo();
    const afterUndo = core.getState().registry.get(assetId);
    expect(afterUndo?.status).toBe("generating");

    // Redo should set it back to ready
    core.redo();
    const afterRedo = core.getState().registry.get(assetId);
    expect(afterRedo?.status).toBe("ready");
  });
});
