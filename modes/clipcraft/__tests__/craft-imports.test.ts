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
});
