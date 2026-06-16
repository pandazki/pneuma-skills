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

  describe("stateDir override (project sessions)", () => {
    test("initShadowGit honors stateDir parameter for per-session location", async () => {
      // Simulate a project session: workspace is the project root, stateDir is
      // the per-session sibling under .pneuma/sessions/<id>.
      const stateDir = join(workspace, ".pneuma", "sessions", "s1");
      // Workspace itself is the work-tree (project root acts as homeRoot in projects).
      await initShadowGit(workspace, stateDir);

      // shadow.git lives under the explicit stateDir, NOT at workspace/.pneuma.
      expect(existsSync(join(stateDir, "shadow.git", "HEAD"))).toBe(true);
      expect(existsSync(join(workspace, ".pneuma", "shadow.git"))).toBe(false);
      expect(isShadowGitAvailable(workspace)).toBe(true);
    });

    test("checkpoints.jsonl writes under stateDir, not workspace/.pneuma", async () => {
      const stateDir = join(workspace, ".pneuma", "sessions", "s2");
      await initShadowGit(workspace, stateDir);

      await Bun.write(join(workspace, "page.html"), "<p>x</p>");
      await enqueueCheckpoint(workspace, 1);

      // Index is under stateDir
      expect(existsSync(join(stateDir, "checkpoints.jsonl"))).toBe(true);
      // Legacy location must remain empty
      expect(existsSync(join(workspace, ".pneuma", "checkpoints.jsonl"))).toBe(false);

      const entries = await listCheckpoints(workspace);
      expect(entries).toHaveLength(1);
      expect(entries[0].turn).toBe(1);
    });
  });

  // --- Helpers for the self-reference / topology tests below ---

  /** Read the HEAD tree as a set of workspace-relative paths. */
  async function treePaths(gitDir: string): Promise<string[]> {
    const proc = Bun.spawn(
      ["git", `--git-dir=${gitDir}`, "ls-tree", "-r", "--name-only", "HEAD"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const out = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  describe("project topology (workspace === stateDir)", () => {
    // Real disk topology: in a project session resolveSessionPaths sets
    // sessionDir === stateDir and bin/pneuma sets workspace = sessionDir, so the
    // work-tree IS the session state dir — it physically contains shadow.git/,
    // session.json, .claude/, CLAUDE.md, etc. Calling initShadowGit(dir, dir)
    // reproduces that; passing stateDir as a *deeper* subdir (as the legacy test
    // above does) does NOT, which is why the 27GB self-reference bug slipped through.

    test("does not self-reference shadow.git or track session plumbing", async () => {
      const sessionDir = workspace; // workspace === stateDir
      await initShadowGit(sessionDir, sessionDir);
      const gitDir = join(sessionDir, "shadow.git");

      // User deliverable content (lives in a named content subdir).
      await Bun.write(join(sessionDir, "deck", "slide.md"), "# Slide 1");
      // Session bookkeeping / plumbing injected by pneuma at the work-tree root.
      await Bun.write(join(sessionDir, "session.json"), `{"sessionId":"s1"}`);
      await Bun.write(join(sessionDir, "history.json"), `[]`);
      await Bun.write(join(sessionDir, "CLAUDE.md"), "# instructions");
      await Bun.write(join(sessionDir, ".claude", "skills", "x", "SKILL.md"), "# skill");

      await enqueueCheckpoint(sessionDir, 1);
      await Bun.write(join(sessionDir, "deck", "slide.md"), "# Slide 1 edited");
      await enqueueCheckpoint(sessionDir, 2);

      const tree = await treePaths(gitDir);

      // Deliverable is tracked.
      expect(tree).toContain("deck/slide.md");
      // The shadow repo never re-commits its own object store.
      expect(tree.some((p) => p.startsWith("shadow.git/"))).toBe(false);
      // Root-anchored session plumbing is excluded.
      expect(tree).not.toContain("session.json");
      expect(tree).not.toContain("history.json");
      expect(tree).not.toContain("CLAUDE.md");
      expect(tree.some((p) => p.startsWith(".claude/"))).toBe(false);
      expect(tree).not.toContain("checkpoints.jsonl");
    });
  });

  describe("quick topology (stateDir = workspace/.pneuma)", () => {
    // In a quick session the work-tree is the user's workspace and state lives
    // under `.pneuma` — so root files like CLAUDE.md ARE the user's content and
    // must stay tracked. Root-anchored project-only rules MUST NOT apply here.

    test("tracks root user files but excludes .venv and .pneuma", async () => {
      await initShadowGit(workspace);
      const gitDir = join(workspace, ".pneuma", "shadow.git");

      await Bun.write(join(workspace, "index.html"), "<h1>hi</h1>");
      // A real user file at workspace root — must be tracked in quick topology
      // (the /CLAUDE.md anchored rule only applies to project sessions).
      await Bun.write(join(workspace, "CLAUDE.md"), "# user notes");
      await Bun.write(join(workspace, ".venv", "lib", "x.so"), "binary");

      await enqueueCheckpoint(workspace, 1);

      const tree = await treePaths(gitDir);
      expect(tree).toContain("index.html");
      expect(tree).toContain("CLAUDE.md");
      expect(tree.some((p) => p.startsWith(".venv/"))).toBe(false);
      // The base rules still hide .pneuma in quick sessions.
      expect(tree.some((p) => p.startsWith(".pneuma/"))).toBe(false);
    });
  });

  describe("resume of a legacy broken session", () => {
    // Existing sessions created before this fix have info/exclude WITHOUT
    // shadow.git and may already track shadow.git/ blobs. On resume the
    // idempotent init branch must (a) rewrite info/exclude with the current
    // rules and (b) untrack the now-excluded plumbing, so growth halts.

    test("rewrites info/exclude and untracks already-tracked shadow.git", async () => {
      const sessionDir = workspace; // project topology
      await initShadowGit(sessionDir, sessionDir);
      const gitDir = join(sessionDir, "shadow.git");
      const excludePath = join(gitDir, "info", "exclude");

      // Simulate the legacy state: overwrite info/exclude with ONLY the old
      // rules (no shadow.git), then force-add a fake tracked pack blob.
      await Bun.write(excludePath, ".pneuma\nnode_modules\n.DS_Store\ndist\n.env\n.env.*\n*.log\n");
      await Bun.write(join(sessionDir, "shadow.git", "objects", "pack", "fake.pack"), "PACKDATA");
      await Bun.spawn(
        ["git", `--git-dir=${gitDir}`, `--work-tree=${sessionDir}`, "add", "shadow.git/objects/pack/fake.pack"],
        { stdout: "ignore", stderr: "ignore" },
      ).exited;
      await Bun.spawn(
        ["git", `--git-dir=${gitDir}`, `--work-tree=${sessionDir}`, "commit", "-m", "legacy bloat"],
        { cwd: sessionDir, stdout: "ignore", stderr: "ignore" },
      ).exited;

      // Sanity: the fake pack is tracked at HEAD before the fix runs.
      expect(await treePaths(gitDir)).toContain("shadow.git/objects/pack/fake.pack");

      // Resume — idempotent branch must rewrite exclude + untrack plumbing.
      await initShadowGit(sessionDir, sessionDir);

      const excludeContent = await Bun.file(excludePath).text();
      expect(excludeContent).toContain("shadow.git");

      // A checkpoint after touching content finalizes the removal.
      await Bun.write(join(sessionDir, "deck", "slide.md"), "# content");
      await enqueueCheckpoint(sessionDir, 1);

      const tree = await treePaths(gitDir);
      expect(tree).toContain("deck/slide.md");
      expect(tree.some((p) => p.startsWith("shadow.git/"))).toBe(false);
    });
  });

  describe("per-file size cap", () => {
    test("skips files larger than 100MB but tracks small files", async () => {
      const fs = await import("node:fs");
      const sessionDir = workspace; // project topology
      await initShadowGit(sessionDir, sessionDir);
      const gitDir = join(sessionDir, "shadow.git");

      // A small deliverable plus a huge (sparse) file that must be skipped.
      await Bun.write(join(sessionDir, "deck", "small.md"), "# small");
      const bigPath = join(sessionDir, "deck", "huge.bin");
      await Bun.write(bigPath, "seed");
      fs.truncateSync(bigPath, 101 * 1024 * 1024); // sparse, ~cheap

      await enqueueCheckpoint(sessionDir, 1);

      const tree = await treePaths(gitDir);
      expect(tree).toContain("deck/small.md");
      expect(tree).not.toContain("deck/huge.bin");

      // The oversized path is recorded in a managed exclude block, so subsequent
      // turns don't re-stat it and it never sneaks back in.
      const exclude = await Bun.file(join(gitDir, "info", "exclude")).text();
      expect(exclude).toContain("deck/huge.bin");
    });
  });
});
