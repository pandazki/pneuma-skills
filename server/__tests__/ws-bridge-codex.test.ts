import { describe, expect, test, mock } from "bun:test";
import { WsBridge } from "../ws-bridge.js";

describe("WsBridge Codex integration", () => {
  test("isCodexSession returns false by default", () => {
    const bridge = new WsBridge();
    expect(bridge.isCodexSession("unknown")).toBe(false);
  });

  test("getOrCreateSession with codex backend sets correct capabilities", () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("codex-1", "codex");

    expect(session.state.backend_type).toBe("codex");
    expect(session.state.agent_capabilities.streaming).toBe(true);
    expect(session.state.agent_capabilities.resume).toBe(true);
    expect(session.state.agent_capabilities.permissions).toBe(true);
    expect(session.state.agent_capabilities.modelSwitch).toBe(true);
    expect(session.state.agent_capabilities.toolProgress).toBe(false);
  });

  test("closeSession cleans up Codex adapter resources", () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("session-cleanup", "codex");

    // Should not throw even without an adapter attached
    bridge.closeSession("session-cleanup");
    expect(bridge.getSession("session-cleanup")).toBeUndefined();
  });
});
