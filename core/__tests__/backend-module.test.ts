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
