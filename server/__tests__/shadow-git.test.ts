import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, isShadowGitAvailable, enqueueCheckpoint, listCheckpoints, createBundle, exportCheckpointFiles } from "../shadow-git.js";

describe("shadow-git", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "shadow-git-test-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  describe("initShadowGit", () => {
    test("creates bare repo at .pneuma/shadow.git", async () => {
      await initShadowGit(workspace);
      expect(existsSync(join(workspace, ".pneuma", "shadow.git", "HEAD"))).toBe(true);
      expect(isShadowGitAvailable(workspace)).toBe(true);
    });

    test("is idempotent — second call is a no-op", async () => {
      await initShadowGit(workspace);
      await initShadowGit(workspace); // should not throw
      expect(isShadowGitAvailable(workspace)).toBe(true);
    });

    test("creates initial commit", async () => {
      // Write a file before init so the initial commit captures it
      await Bun.write(join(workspace, "index.html"), "<h1>hello</h1>");
      await initShadowGit(workspace);

      const proc = Bun.spawn(
        ["git", `--git-dir=${join(workspace, ".pneuma", "shadow.git")}`, "log", "--oneline"],
        { stdout: "pipe" }
      );
      const log = await new Response(proc.stdout).text();
      expect(log).toContain("initial");
    });

    test("excludes .pneuma and node_modules", async () => {
      const excludePath = join(workspace, ".pneuma", "shadow.git", "info", "exclude");
      await initShadowGit(workspace);
      const content = await Bun.file(excludePath).text();
      expect(content).toContain(".pneuma");
      expect(content).toContain("node_modules");
    });
  });

  describe("enqueueCheckpoint", () => {
    test("captures file changes as a checkpoint", async () => {
      await initShadowGit(workspace);
      await Bun.write(join(workspace, "style.css"), "body { color: red; }");
      await enqueueCheckpoint(workspace, 1);

      const checkpoints = await listCheckpoints(workspace);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].turn).toBe(1);
      expect(checkpoints[0].hash).toMatch(/^[0-9a-f]{7,}/);
    });

    test("skips checkpoint when no files changed", async () => {
      await initShadowGit(workspace);
      await enqueueCheckpoint(workspace, 1);

      const checkpoints = await listCheckpoints(workspace);
      expect(checkpoints).toHaveLength(0);
    });

    test("captures multiple checkpoints sequentially", async () => {
      await initShadowGit(workspace);

      await Bun.write(join(workspace, "a.txt"), "first");
      await enqueueCheckpoint(workspace, 1);

      await Bun.write(join(workspace, "b.txt"), "second");
      await enqueueCheckpoint(workspace, 2);

      const checkpoints = await listCheckpoints(workspace);
      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].turn).toBe(1);
      expect(checkpoints[1].turn).toBe(2);
    });

    test("is a no-op when shadow git is not available", async () => {
      await enqueueCheckpoint(workspace, 1);
      // should not throw, no checkpoints created
    });
  });

  describe("createBundle", () => {
    test("creates a git bundle file containing all checkpoints", async () => {
      await initShadowGit(workspace);
      await Bun.write(join(workspace, "a.txt"), "hello");
      await enqueueCheckpoint(workspace, 1);

      const bundlePath = join(workspace, "test.bundle");
      await createBundle(workspace, bundlePath);
      expect(existsSync(bundlePath)).toBe(true);

      const verify = Bun.spawn(["git", "bundle", "verify", bundlePath], { stdout: "ignore", stderr: "ignore" });
      expect(await verify.exited).toBe(0);
    });
  });

  describe("exportCheckpointFiles", () => {
    test("exports the file tree at a specific checkpoint", async () => {
      await initShadowGit(workspace);

      await Bun.write(join(workspace, "a.txt"), "version-1");
      await enqueueCheckpoint(workspace, 1);

      await Bun.write(join(workspace, "a.txt"), "version-2");
      await Bun.write(join(workspace, "b.txt"), "new-file");
      await enqueueCheckpoint(workspace, 2);

      const checkpoints = await listCheckpoints(workspace);
      const outDir = mkdtempSync(join(tmpdir(), "export-test-"));

      await exportCheckpointFiles(workspace, checkpoints[0].hash, outDir);
      expect(await Bun.file(join(outDir, "a.txt")).text()).toBe("version-1");
      expect(existsSync(join(outDir, "b.txt"))).toBe(false);

      rmSync(outDir, { recursive: true, force: true });
    });
  });
});
