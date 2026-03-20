// server/__tests__/history-import.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../shadow-git.js";
import { exportHistory } from "../history-export.js";
import { importHistory } from "../history-import.js";

describe("history-import", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "history-import-test-"));
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("round-trip: export then import recovers manifest and messages", async () => {
    await initShadowGit(workspace);
    await Bun.write(join(workspace, "index.html"), "<h1>Test</h1>");
    await enqueueCheckpoint(workspace, 1);

    const history = [
      { type: "user_message", content: "Hello", timestamp: 1000, id: "u1" },
      { type: "result", data: { num_turns: 1 } },
    ];
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify(history));
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "s1", mode: "webcraft", backendType: "claude-code", createdAt: 500,
    }));

    const tarPath = join(workspace, "export.tar.gz");
    await exportHistory(workspace, { output: tarPath, title: "Round Trip" });

    const importDir = mkdtempSync(join(tmpdir(), "import-test-"));
    const pkg = await importHistory(tarPath, importDir);

    expect(pkg.manifest.version).toBe(1);
    expect(pkg.manifest.metadata.title).toBe("Round Trip");
    expect(pkg.manifest.metadata.mode).toBe("webcraft");
    expect(pkg.messages).toHaveLength(2);
    expect(pkg.messages[0].type).toBe("user_message");
    expect(pkg.hasBundle).toBe(true);

    rmSync(importDir, { recursive: true, force: true });
  });

  test("extractCheckpointFiles restores file tree from bundle", async () => {
    await initShadowGit(workspace);
    await Bun.write(join(workspace, "page.html"), "<p>content</p>");
    await enqueueCheckpoint(workspace, 1);

    const history = [{ type: "user_message", content: "x", timestamp: 1, id: "1" }];
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify(history));
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "s", mode: "doc", backendType: "claude-code", createdAt: 0,
    }));

    const tarPath = join(workspace, "export.tar.gz");
    await exportHistory(workspace, { output: tarPath });

    const importDir = mkdtempSync(join(tmpdir(), "import-cp-"));
    const pkg = await importHistory(tarPath, importDir);

    const cpDir = mkdtempSync(join(tmpdir(), "cp-files-"));
    await pkg.extractCheckpointFiles(pkg.manifest.checkpoints[0].hash, cpDir);

    expect(await Bun.file(join(cpDir, "page.html")).text()).toBe("<p>content</p>");

    rmSync(importDir, { recursive: true, force: true });
    rmSync(cpDir, { recursive: true, force: true });
  });
});
