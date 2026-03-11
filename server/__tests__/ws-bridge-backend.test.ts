import { describe, expect, test } from "bun:test";
import { WsBridge } from "../ws-bridge.js";

describe("WsBridge backend identity", () => {
  test("seeds a new session with the selected backend type", () => {
    const bridge = new WsBridge();

    const session = bridge.getOrCreateSession("session-1", "codex");

    expect(session.state.backend_type).toBe("codex");
    expect(session.state.agent_capabilities.modelSwitch).toBe(false);
  });

  test("updates an existing session when backend type is provided later", () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("session-2");

    const session = bridge.getOrCreateSession("session-2", "codex");

    expect(session.state.backend_type).toBe("codex");
    expect(session.state.agent_capabilities.permissions).toBe(true);
    expect(session.state.agent_capabilities.modelSwitch).toBe(false);
  });
});
