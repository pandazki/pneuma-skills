import { describe, it, expect } from "bun:test";
import { claudeCodeModule } from "../manifest.js";

describe("claude-code BackendModule", () => {
  it("declares correct identity", () => {
    expect(claudeCodeModule.type).toBe("claude-code");
    expect(claudeCodeModule.binary).toBe("claude");
    expect(claudeCodeModule.skillsDir).toBe(".claude/skills");
    expect(claudeCodeModule.instructionsFile).toBe("CLAUDE.md");
    expect(claudeCodeModule.displayLabel).toBe("claude-code");
  });

  it("declares full capabilities including scheduling + costTracking", () => {
    const c = claudeCodeModule.capabilities;
    expect(c.streaming).toBe(true);
    expect(c.resume).toBe(true);
    expect(c.permissions).toBe(true);
    expect(c.toolProgress).toBe(true);
    expect(c.modelSwitch).toBe(true);
    expect(c.scheduling).toBe(true);
    expect(c.costTracking).toBe(true);
    expect(c.contextWindow).toBe(true);
  });

  it("ships a fallback model list of aliases, not pinned model ids", () => {
    const models = claudeCodeModule.defaultModels;
    expect(models?.length).toBeGreaterThanOrEqual(3);
    // The live list comes from the CLI's `initialize` control response; this
    // static list is only a fallback for CLIs too old to answer it. Pinned ids
    // (`claude-opus-4-7`) go stale on every model release — aliases don't.
    for (const m of models ?? []) {
      expect(m.id).not.toMatch(/^claude-/);
      expect(m.id).toMatch(/^[a-z]+$/);
    }
  });

  it("createBridgeBackend returns null (legacy stdio path)", () => {
    const b = claudeCodeModule.createBackend(0);
    const result = claudeCodeModule.createBridgeBackend({} as any, b, "test-session");
    expect(result).toBeNull();
  });

  it("checkRequirements returns ok or actionable reason", () => {
    const r = claudeCodeModule.checkRequirements();
    if (r.ok) expect(r.binaryPath).toBeTruthy();
    else expect(r.reason).toMatch(/claude/i);
  });
});
