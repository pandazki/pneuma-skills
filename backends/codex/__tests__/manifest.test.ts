import { describe, it, expect } from "bun:test";
import { codexModule } from "../manifest.js";
import { CodexBackend } from "../index.js";

describe("codex BackendModule", () => {
  it("declares correct identity", () => {
    expect(codexModule.type).toBe("codex");
    expect(codexModule.binary).toBe("codex");
    expect(codexModule.skillsDir).toBe(".agents/skills");
    expect(codexModule.instructionsFile).toBe("AGENTS.md");
    expect(codexModule.displayLabel).toBe("codex");
  });

  it("declares capabilities matching the registry", () => {
    const c = codexModule.capabilities;
    expect(c.streaming).toBe(true);
    expect(c.resume).toBe(true);
    expect(c.permissions).toBe(true);
    expect(c.toolProgress).toBe(false);
    expect(c.modelSwitch).toBe(true);
    expect(c.scheduling).toBeFalsy();
    expect(c.costTracking).toBeFalsy();
    expect(c.contextWindow).toBeFalsy();
  });

  it("ships no defaultModels (codex emits available_models dynamically)", () => {
    expect(codexModule.defaultModels).toBeUndefined();
  });

  it("createBridgeBackend returns a CodexBridge instance", () => {
    const b = codexModule.createBackend(0) as CodexBackend;
    // Stub the per-session adapter map: the manifest calls
    // `backend.getAdapter(sessionId)` and we want a non-null adapter so
    // the bridge can be constructed without launching a real CLI.
    const fakeAdapter = {
      onBrowserMessage: () => {},
      onSessionMeta: () => {},
      onDisconnect: () => {},
      sendBrowserMessage: () => {},
    };
    (b as unknown as { getAdapter: (sid: string) => unknown }).getAdapter = () =>
      fakeAdapter;

    // Stub deps: the manifest's createBridgeBackend uses
    // `deps.getOrCreateSession` to obtain the bridge's per-session state.
    const deps = {
      broadcastToBrowsers: () => {},
      workspace: "/tmp",
      onAgentSessionId: () => {},
      getOrCreateSession: () =>
        ({
          id: "test-session",
          pendingPermissions: new Map(),
          pendingMessages: [],
        }) as unknown as object,
    };

    const bridge = codexModule.createBridgeBackend(deps as never, b, "test-session");
    expect(bridge).not.toBeNull();
    expect(bridge?.backendType).toBe("codex");
  });

  it("createBridgeBackend throws when adapter is missing", () => {
    const b = codexModule.createBackend(0) as CodexBackend;
    (b as unknown as { getAdapter: (sid: string) => unknown }).getAdapter = () => undefined;
    const deps = {
      broadcastToBrowsers: () => {},
      workspace: "/tmp",
      onAgentSessionId: () => {},
      getOrCreateSession: () => ({}) as unknown as object,
    };
    expect(() =>
      codexModule.createBridgeBackend(deps as never, b, "missing-session"),
    ).toThrow(/no adapter/i);
  });

  it("checkRequirements probes the binary", () => {
    const r = codexModule.checkRequirements();
    if (r.ok) expect(r.binaryPath).toBeTruthy();
    else expect(r.reason).toMatch(/codex/i);
  });
});
