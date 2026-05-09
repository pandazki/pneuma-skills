import { describe, it, expect } from "bun:test";
import { kimiCliModule } from "../manifest.js";
import { KimiCliBackend } from "../index.js";

describe("kimi-cli BackendModule", () => {
  it("declares correct identity", () => {
    expect(kimiCliModule.type).toBe("kimi-cli");
    expect(kimiCliModule.binary).toBe("kimi");
    expect(kimiCliModule.skillsDir).toBe(".kimi/skills");
    expect(kimiCliModule.instructionsFile).toBe("AGENTS.md");
    expect(kimiCliModule.displayLabel).toBe("kimi-cli");
  });

  it("declares capabilities — no permissions or toolProgress", () => {
    const c = kimiCliModule.capabilities;
    expect(c.streaming).toBe(true);
    expect(c.resume).toBe(true);
    expect(c.permissions).toBe(false);
    expect(c.toolProgress).toBe(false);
    expect(c.modelSwitch).toBe(true);
    expect(c.scheduling).toBeFalsy();
    expect(c.costTracking).toBeFalsy();
    expect(c.contextWindow).toBeFalsy();
  });

  it("ships no defaultModels (kimi emits its own model list dynamically)", () => {
    expect(kimiCliModule.defaultModels).toBeUndefined();
  });

  it("createBridgeBackend returns a KimiBridge instance", () => {
    const b = kimiCliModule.createBackend(0) as KimiCliBackend;
    // Stub the per-session adapter map: the manifest calls
    // `backend.getAdapter(sessionId)` and we want a non-null adapter so
    // the bridge can be constructed without launching a real CLI.
    const fakeAdapter = {
      onMessage: () => {},
      onSessionId: () => {},
      onDisconnect: () => {},
      sendUserMessage: () => {},
      interrupt: () => {},
      disconnect: async () => {},
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
          state: {},
          cliIdle: true,
          messageHistory: [],
          pendingPermissions: new Map(),
          pendingMessages: [],
        }) as unknown as object,
    };

    const bridge = kimiCliModule.createBridgeBackend(deps as never, b, "test-session");
    expect(bridge).not.toBeNull();
    expect(bridge?.backendType).toBe("kimi-cli");
  });

  it("createBridgeBackend throws when adapter is missing", () => {
    const b = kimiCliModule.createBackend(0) as KimiCliBackend;
    (b as unknown as { getAdapter: (sid: string) => unknown }).getAdapter = () => undefined;
    const deps = {
      broadcastToBrowsers: () => {},
      workspace: "/tmp",
      onAgentSessionId: () => {},
      getOrCreateSession: () => ({}) as unknown as object,
    };
    expect(() =>
      kimiCliModule.createBridgeBackend(deps as never, b, "missing-session"),
    ).toThrow(/no adapter/i);
  });

  it("createBridgeBackend throws when deps.getOrCreateSession is missing", () => {
    const b = kimiCliModule.createBackend(0) as KimiCliBackend;
    const fakeAdapter = {
      onMessage: () => {},
      onSessionId: () => {},
      onDisconnect: () => {},
      sendUserMessage: () => {},
      interrupt: () => {},
      disconnect: async () => {},
    };
    (b as unknown as { getAdapter: (sid: string) => unknown }).getAdapter = () =>
      fakeAdapter;
    const deps = {
      broadcastToBrowsers: () => {},
      workspace: "/tmp",
      onAgentSessionId: () => {},
      // getOrCreateSession deliberately omitted
    };
    expect(() =>
      kimiCliModule.createBridgeBackend(deps as never, b, "test-session"),
    ).toThrow(/getOrCreateSession/i);
  });

  it("checkRequirements probes the binary", () => {
    const r = kimiCliModule.checkRequirements();
    if (r.ok) expect(r.binaryPath).toBeTruthy();
    else expect(r.reason).toMatch(/kimi/i);
  });
});
