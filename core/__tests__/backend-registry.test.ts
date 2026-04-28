import { describe, expect, test } from "bun:test";
import { createBackend, getBackendCapabilities, getBackendDescriptors, getDefaultBackendType, getImplementedBackends } from "../../backends/index.js";

describe("backend registry", () => {
  test("declares Claude Code as the default backend", () => {
    // Reverted back to claude-code now that the stdio stream-json transport
    // works on every public CC version (the previous --sdk-url disable was
    // dropped along with the host-whitelist breakage it gated).
    expect(getDefaultBackendType()).toBe("claude-code");
  });

  test("lists both declared backends with implementation flags", () => {
    expect(getBackendDescriptors()).toEqual([
      {
        type: "claude-code",
        label: "Claude Code",
        description: "Anthropic Claude Code CLI via stdio stream-json transport.",
        implemented: true,
      },
      {
        type: "codex",
        label: "Codex",
        description: "OpenAI Codex CLI via app-server transport.",
        implemented: true,
      },
    ]);
  });

  test("implemented backends include both Claude Code and Codex", () => {
    expect(getImplementedBackends().map((backend) => backend.type)).toEqual(["claude-code", "codex"]);
  });

  test("exposes capability defaults per backend type", () => {
    expect(getBackendCapabilities("claude-code")).toEqual({
      streaming: true,
      resume: true,
      permissions: true,
      toolProgress: true,
      modelSwitch: true,
    });

    expect(getBackendCapabilities("codex")).toEqual({
      streaming: true,
      resume: true,
      permissions: true,
      toolProgress: false,
      modelSwitch: true,
    });
  });

  test("createBackend instantiates Claude Code backend", () => {
    const backend = createBackend("claude-code", 17007);
    expect(backend.name).toBe("claude-code");
    expect(backend.capabilities.streaming).toBe(true);
  });

  test("createBackend instantiates Codex backend", () => {
    const backend = createBackend("codex", 17007);
    expect(backend.name).toBe("codex");
    expect(backend.capabilities.streaming).toBe(true);
    expect(backend.capabilities.modelSwitch).toBe(true);
    expect(backend.capabilities.toolProgress).toBe(false);
  });
});
