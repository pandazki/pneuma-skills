import { describe, expect, it } from "bun:test";
import {
  getAllBackendModules,
  getBackendCapabilities,
  getBackendDescriptors,
  getBackendModule,
  detectBackendAvailability,
} from "../index.js";
import type { AgentBackendType } from "../../core/types/agent-backend.js";

describe("kimi-cli backend registration", () => {
  it("appears in BACKEND_DESCRIPTORS as implemented", () => {
    const desc = getBackendDescriptors().find((d) => d.type === "kimi-cli");
    expect(desc).toBeDefined();
    expect(desc!.implemented).toBe(true);
    expect(desc!.label).toBe("Kimi");
  });

  it("declares capabilities", () => {
    const caps = getBackendCapabilities("kimi-cli");
    expect(caps).toEqual({
      streaming: true,
      resume: true,
      // ACP delivers a first-class permission round trip and tool progress.
      permissions: true,
      toolProgress: true,
      modelSwitch: true,
    });
  });

  it("declares its binary as 'kimi'", () => {
    const probes = detectBackendAvailability();
    const kimi = probes.find((p) => p.type === "kimi-cli");
    expect(kimi).toBeDefined();
    // We don't assert .available because PATH varies across CI
    if (!kimi!.available) {
      expect(kimi!.reason).toContain("kimi");
    }
  });
});

describe("module registry", () => {
  it("aggregates all three backend modules", () => {
    const modules = getAllBackendModules();
    expect(modules).toHaveLength(3);
    const types = modules.map((m) => m.type).sort();
    expect(types).toEqual(["claude-code", "codex", "kimi-cli"]);
  });

  it("returns the same module reference for getBackendModule and getAllBackendModules", () => {
    const all = getAllBackendModules();
    for (const m of all) {
      expect(getBackendModule(m.type)).toBe(m);
    }
  });

  it("each module satisfies the BackendModule shape", () => {
    const types: AgentBackendType[] = ["claude-code", "codex", "kimi-cli"];
    for (const type of types) {
      const m = getBackendModule(type);
      expect(m.type).toBe(type);
      expect(typeof m.label).toBe("string");
      expect(typeof m.description).toBe("string");
      expect(typeof m.displayLabel).toBe("string");
      expect(typeof m.binary).toBe("string");
      expect(typeof m.installHint).toBe("string");
      expect(typeof m.skillsDir).toBe("string");
      expect(typeof m.instructionsFile).toBe("string");
      expect(m.capabilities).toBeDefined();
      expect(typeof m.createBackend).toBe("function");
      expect(typeof m.createBridgeBackend).toBe("function");
      expect(typeof m.checkRequirements).toBe("function");
    }
  });

  it("exposes file-layout conventions per backend", () => {
    expect(getBackendModule("claude-code").skillsDir).toBe(".claude/skills");
    expect(getBackendModule("claude-code").instructionsFile).toBe("CLAUDE.md");

    expect(getBackendModule("codex").skillsDir).toBe(".agents/skills");
    expect(getBackendModule("codex").instructionsFile).toBe("AGENTS.md");

    expect(getBackendModule("kimi-cli").skillsDir).toBe(".kimi-code/skills");
    expect(getBackendModule("kimi-cli").instructionsFile).toBe("AGENTS.md");
  });

  it("exposes a session-scoped commandsDir only for backends that surface project command files", () => {
    // Claude Code reads `<cwd>/.claude/commands/*.md` and reports them as
    // native slash_commands — that's the seam the /borrow command rides on.
    expect(getBackendModule("claude-code").commandsDir).toBe(".claude/commands");

    // Codex maps its *skills* to slash_commands (not project command files);
    // Kimi doesn't populate slash_commands at all. Both leave commandsDir
    // undefined so the installer skips the session-command step for them.
    expect(getBackendModule("codex").commandsDir).toBeUndefined();
    expect(getBackendModule("kimi-cli").commandsDir).toBeUndefined();
  });

  it("claude-code's createBridgeBackend returns null (legacy stdio path)", () => {
    const m = getBackendModule("claude-code");
    const result = m.createBridgeBackend(
      // deps + backend args are unused on the claude-code path
      {
        broadcastToBrowsers: () => {},
        workspace: "/tmp",
        prepareIncomingUserMessage: (_s, msg) => ({
          textContent: msg.content,
          inlineImages: [],
        }),
      },
      m.createBackend(17007),
      "test-session",
    );
    expect(result).toBeNull();
  });
});
