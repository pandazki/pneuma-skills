/**
 * BackendModule type tests
 *
 * Verifies the new single-source-of-truth backend descriptor compiles with all
 * required fields, that AgentCapabilities accepts the optional extras
 * (scheduling/costTracking/contextWindow/extras), and that backends without the
 * extras still type-check.
 */

import { describe, it, expect } from "bun:test";
import type { BackendModule, AgentCapabilities } from "../types/agent-backend.js";
import { claudeCodeModule } from "../../backends/claude-code/manifest.js";
import { codexModule } from "../../backends/codex/manifest.js";
import { kimiCliModule } from "../../backends/kimi-cli/manifest.js";

describe("BackendModule type", () => {
  it("compiles with all required fields and capabilities extras", () => {
    const fake: BackendModule = {
      type: "claude-code",
      label: "Claude Code",
      description: "test",
      displayLabel: "claude-code",
      binary: "claude",
      installHint: "Install: ...",
      skillsDir: ".claude/skills",
      instructionsFile: "CLAUDE.md",
      capabilities: {
        streaming: true,
        resume: true,
        permissions: true,
        toolProgress: true,
        modelSwitch: true,
        scheduling: true,
        costTracking: true,
      },
      defaultModels: [{ id: "claude-opus-4-7", label: "Opus", icon: "O" }],
      createBackend: () => ({ /* type-only */ } as any),
      createBridgeBackend: () => null,
      checkRequirements: () => ({ ok: true }),
    };
    expect(fake.type).toBe("claude-code");
    expect(fake.capabilities.scheduling).toBe(true);
    expect(fake.defaultModels?.length).toBe(1);
  });

  it("AgentCapabilities allows partial capability declaration via optional fields", () => {
    const minimal: AgentCapabilities = {
      streaming: true,
      resume: false,
      permissions: false,
      toolProgress: false,
      modelSwitch: false,
    };
    expect(minimal.scheduling).toBeUndefined();
    expect(minimal.costTracking).toBeUndefined();
  });
});

describe("BackendModule.toolFileRef", () => {
  it("claude-code resolves an Edit call to a file ref", () => {
    expect(claudeCodeModule.toolFileRef?.("Edit", { file_path: "/w/a.ts" })).toEqual({ path: "/w/a.ts", kind: "edit" });
    expect(claudeCodeModule.toolFileRef?.("Read", { file_path: "/w/a.png" })).toEqual({ path: "/w/a.png", kind: "read" });
  });
  it("codex resolves an Edit call to a file ref", () => {
    expect(codexModule.toolFileRef?.("Edit", { file_path: "/w/main.ts" })).toEqual({ path: "/w/main.ts", kind: "edit" });
  });
  it("returns undefined for non-file tools", () => {
    expect(claudeCodeModule.toolFileRef?.("Bash", { command: "ls" })).toBeUndefined();
  });
});

describe("kimi-cli toolFileRef", () => {
  it("resolves Claude-shaped names via the default", () => {
    expect(kimiCliModule.toolFileRef?.("Read", { file_path: "/w/a.png" })).toEqual({ path: "/w/a.png", kind: "read" });
  });
  it("resolves a generic `path` key to kind=edit", () => {
    expect(kimiCliModule.toolFileRef?.("view_file", { path: "/w/a.ts" })).toEqual({ path: "/w/a.ts", kind: "edit" });
  });
  it("resolves a generic `file_path` key on an unknown tool to kind=edit", () => {
    expect(kimiCliModule.toolFileRef?.("str_replace", { file_path: "/w/a.ts" })).toEqual({ path: "/w/a.ts", kind: "edit" });
  });
  it("returns undefined when there's no usable path", () => {
    expect(kimiCliModule.toolFileRef?.("run_shell", { command: "ls" })).toBeUndefined();
  });
});
