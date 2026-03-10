import { describe, expect, test } from "bun:test";
import { createBackend, getBackendCapabilities, getBackendDescriptors, getDefaultBackendType, getImplementedBackends } from "../../backends/index.js";

describe("backend registry", () => {
  test("declares Claude Code as the default backend", () => {
    expect(getDefaultBackendType()).toBe("claude-code");
  });

  test("lists both declared backends with implementation flags", () => {
    expect(getBackendDescriptors()).toEqual([
      {
        type: "claude-code",
        label: "Claude Code",
        description: "Anthropic Claude Code CLI via --sdk-url WebSocket transport.",
        implemented: true,
      },
      {
        type: "codex",
        label: "Codex",
        description: "OpenAI Codex CLI via app-server transport.",
        implemented: false,
      },
    ]);
  });

  test("implemented backends only include Claude Code for now", () => {
    expect(getImplementedBackends().map((backend) => backend.type)).toEqual(["claude-code"]);
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
      streaming: false,
      resume: false,
      permissions: false,
      toolProgress: false,
      modelSwitch: false,
    });
  });

  test("createBackend instantiates Claude Code backend", () => {
    const backend = createBackend("claude-code", 17007);
    expect(backend.name).toBe("claude-code");
    expect(backend.capabilities.streaming).toBe(true);
  });

  test("createBackend rejects unimplemented Codex backend", () => {
    expect(() => createBackend("codex", 17007)).toThrow("Codex backend is not implemented yet.");
  });
});
