// server/__tests__/history-export.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../shadow-git.js";
import { exportHistory } from "../history-export.js";

describe("exportHistory", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "history-export-test-"));
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("creates a tar.gz package with manifest and messages", async () => {
    await initShadowGit(workspace);
    await Bun.write(join(workspace, "index.html"), "<h1>Hello</h1>");
    await enqueueCheckpoint(workspace, 1);

    const history = [
      { type: "user_message", content: "Create a page", timestamp: 1000, id: "u1" },
      { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "Done" }], model: "test", stop_reason: "end_turn", role: "assistant" }, parent_tool_use_id: null, timestamp: 1500 },
      { type: "result", data: { num_turns: 1, total_cost_usd: 0.01, duration_ms: 500 } },
    ];
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify(history));
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "test-session", mode: "webcraft", backendType: "claude-code", createdAt: 900,
    }));

    const outPath = join(workspace, "export.tar.gz");
    const result = await exportHistory(workspace, { output: outPath, title: "Test Export" });

    expect(existsSync(outPath)).toBe(true);
    expect(result.checkpointCount).toBe(1);
    expect(result.messageCount).toBe(3);

    // Verify package contents
    const extractDir = mkdtempSync(join(tmpdir(), "extract-test-"));
    await Bun.spawn(["tar", "xzf", outPath, "-C", extractDir]).exited;

    expect(existsSync(join(extractDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(extractDir, "messages.jsonl"))).toBe(true);
    expect(existsSync(join(extractDir, "repo.bundle"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(extractDir, "manifest.json"), "utf-8"));
    expect(manifest.version).toBe(1);
    expect(manifest.metadata.title).toBe("Test Export");
    expect(manifest.metadata.mode).toBe("webcraft");
    expect(manifest.checkpoints).toHaveLength(1);

    rmSync(extractDir, { recursive: true, force: true });
  });

  test("works without checkpoints (no shadow git)", async () => {
    const history = [
      { type: "user_message", content: "Hello", timestamp: 1000, id: "u1" },
    ];
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify(history));
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "test", mode: "webcraft", backendType: "claude-code", createdAt: 900,
    }));

    const outPath = join(workspace, "export.tar.gz");
    const result = await exportHistory(workspace, { output: outPath });

    expect(existsSync(outPath)).toBe(true);
    expect(result.checkpointCount).toBe(0);
    expect(result.messageCount).toBe(1);
  });
});
