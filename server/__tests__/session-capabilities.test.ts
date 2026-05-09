/**
 * Lock-in test for the manifest → server `session_init` capability bridge.
 *
 * Task 7 of the backend-architecture refactor: the frontend reads
 * `session.agent_capabilities.{scheduling,costTracking,contextWindow,extras}`
 * to drive UI gating without hardcoding backend names. That contract lives
 * across three layers (manifest declaration → registry helper → bridge
 * `session_init` payload) — these tests pin each layer so a future change
 * that drops one of the new optional fields fails loudly instead of
 * silently disabling a UI feature.
 */

import { describe, it, expect } from "bun:test";
import { getBackendModule } from "../../backends/index.js";
import { makeDefaultState } from "../ws-bridge-types.js";
import { WsBridge } from "../ws-bridge.js";

describe("session capabilities propagation", () => {
  it.each(["claude-code", "codex", "kimi-cli"] as const)(
    "%s module exposes capabilities consumable by frontend",
    (type) => {
      const caps = getBackendModule(type).capabilities;
      expect(typeof caps.streaming).toBe("boolean");
      expect(typeof caps.modelSwitch).toBe("boolean");
      // optional fields just need to be undefined or boolean
      if (caps.scheduling !== undefined) expect(typeof caps.scheduling).toBe("boolean");
      if (caps.costTracking !== undefined) expect(typeof caps.costTracking).toBe("boolean");
    },
  );

  it("only claude-code declares scheduling = true", () => {
    expect(getBackendModule("claude-code").capabilities.scheduling).toBe(true);
    expect(getBackendModule("codex").capabilities.scheduling).toBeFalsy();
    expect(getBackendModule("kimi-cli").capabilities.scheduling).toBeFalsy();
  });

  it("only claude-code declares costTracking = true", () => {
    expect(getBackendModule("claude-code").capabilities.costTracking).toBe(true);
    expect(getBackendModule("codex").capabilities.costTracking).toBeFalsy();
    expect(getBackendModule("kimi-cli").capabilities.costTracking).toBeFalsy();
  });

  it("only claude-code declares contextWindow = true", () => {
    expect(getBackendModule("claude-code").capabilities.contextWindow).toBe(true);
    expect(getBackendModule("codex").capabilities.contextWindow).toBeFalsy();
    expect(getBackendModule("kimi-cli").capabilities.contextWindow).toBeFalsy();
  });

  it("WsBridge session_init payload carries the full capability set for claude-code", () => {
    // `makeDefaultState` is the chokepoint where capabilities enter session
    // state — both `getOrCreateSession` and the natural-path / synthesised
    // `session_init` broadcasts spread `session.state` (which carries
    // `agent_capabilities`), so verifying the default-state shape covers
    // every emission path.
    const defaultState = makeDefaultState("session-7", "claude-code");
    const caps = defaultState.agent_capabilities;
    expect(caps).toEqual({
      streaming: true,
      resume: true,
      permissions: true,
      toolProgress: true,
      modelSwitch: true,
      scheduling: true,
      costTracking: true,
      contextWindow: true,
    });

    // Round-trip through the bridge to mirror what a browser would receive
    // on `handleBrowserOpen`: the snapshot path spreads `session.state` and
    // adds `cli_busy`. The capability fields must survive that spread.
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("session-7", "claude-code");
    const snapshotCaps = { ...session.state, cli_busy: false }.agent_capabilities;
    expect(snapshotCaps.scheduling).toBe(true);
    expect(snapshotCaps.costTracking).toBe(true);
    expect(snapshotCaps.contextWindow).toBe(true);
    expect(Object.keys(snapshotCaps).sort()).toEqual([
      "contextWindow",
      "costTracking",
      "modelSwitch",
      "permissions",
      "resume",
      "scheduling",
      "streaming",
      "toolProgress",
    ]);
  });
});
