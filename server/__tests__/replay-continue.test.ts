import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareWorkspaceForContinue } from "../replay-continue.js";

describe("prepareWorkspaceForContinue", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = join(tmpdir(), `replay-continue-test-${Date.now()}`);
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("clears replay state and writes resumed context", async () => {
    // Setup
    writeFileSync(join(workspace, ".pneuma", "checkpoints.jsonl"), '{"turn":1}\n');
    writeFileSync(join(workspace, ".pneuma", "history.json"), '[{"type":"user_message"}]');
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "replay-123",
      mode: "doc",
      backendType: "claude-code",
      createdAt: Date.now(),
    }));

    await prepareWorkspaceForContinue(workspace, {
      originalMode: "doc",
      summary: {
        overview: "Created a documentation site",
        keyDecisions: ["Used markdown format", "Added table of contents"],
        workspaceFiles: [
          { path: "index.md", lines: 50 },
          { path: "guide.md", lines: 120 },
        ],
        recentConversation: "[user] Add a FAQ section\n[assistant] I added a FAQ section...",
      },
    });

    // Verify checkpoints cleared
    expect(readFileSync(join(workspace, ".pneuma", "checkpoints.jsonl"), "utf-8")).toBe("");
    // Verify history cleared
    expect(readFileSync(join(workspace, ".pneuma", "history.json"), "utf-8")).toBe("[]");
    // Verify session has resumedFrom
    const session = JSON.parse(readFileSync(join(workspace, ".pneuma", "session.json"), "utf-8"));
    expect(session.resumedFrom).toBeTruthy();
    expect(session.resumedFrom.originalMode).toBe("doc");
    expect(session.agentSessionId).toBeUndefined();
    // Verify resumed-context.xml exists and contains expected content
    const context = readFileSync(join(workspace, ".pneuma", "resumed-context.xml"), "utf-8");
    expect(context).toContain("resumed-session");
    expect(context).toContain("Created a documentation site");
    expect(context).toContain("Used markdown format");
    expect(context).toContain("Add a FAQ section");
  });

  test("cleans up replay temp directories", async () => {
    mkdirSync(join(workspace, ".pneuma", "replay-checkout"), { recursive: true });
    mkdirSync(join(workspace, ".pneuma", "replay"), { recursive: true });
    writeFileSync(join(workspace, ".pneuma", "replay-checkout", "test.txt"), "test");
    writeFileSync(join(workspace, ".pneuma", "replay", "test.txt"), "test");

    await prepareWorkspaceForContinue(workspace, {
      originalMode: "doc",
      summary: { overview: "", keyDecisions: [], workspaceFiles: [], recentConversation: "" },
    });

    expect(existsSync(join(workspace, ".pneuma", "replay-checkout"))).toBe(false);
    expect(existsSync(join(workspace, ".pneuma", "replay"))).toBe(false);
  });
});
