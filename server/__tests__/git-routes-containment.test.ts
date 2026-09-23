/**
 * Git routes stay inside the session workspace (finding 22 of the round-4
 * review).
 *
 * The session workspace here is a SUBDIRECTORY of a Git repository, the way a
 * project session or a workspace inside a checkout is. A tracked sibling of
 * the workspace has an uncommitted change. `isContained` approves the literal
 * string `:(top)outside/git-sentinel.txt` — it names a file that does not
 * exist beneath the workspace — but Git reads it as pathspec magic relative
 * to the repository root, and `--` does not disable magic. Every git call
 * that takes a request-derived path now runs with `--literal-pathspecs` and
 * receives the normalized, checked workspace-relative path.
 *
 * Also pinned here: request-controlled object names (`/api/replay/checkout/
 * :hash`) are validated as object ids before they reach `git archive`, whose
 * options include `--output` and `--remote/--exec`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../index.js";
import { isGitObjectId } from "../utils.js";

const hasGit = Bun.which("git") !== null;
const PORT = 19800 + Math.floor(Math.random() * 60);
const SECRET = "OUTSIDE-GIT-SECRET";

let base: string;
let ws: string;
let server: Awaited<ReturnType<typeof startServer>> | undefined;

const api = (path: string, init?: RequestInit) => fetch(`http://localhost:${PORT}${path}`, init);
const diffOf = async (path: string) => {
  const res = await api(`/api/git/diff?path=${encodeURIComponent(path)}`);
  return { status: res.status, body: await res.text() };
};

beforeAll(async () => {
  if (!hasGit) return;
  base = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-git-containment-")));
  ws = join(base, "ws");
  mkdirSync(join(base, "outside"), { recursive: true });
  mkdirSync(ws, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: base, stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(base, "outside", "git-sentinel.txt"), "baseline\n");
  writeFileSync(join(ws, "tracked.txt"), "before\n");
  writeFileSync(join(ws, "other.txt"), "other before\n");
  writeFileSync(join(ws, "[ab].txt"), "bracket before\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  writeFileSync(join(base, "outside", "git-sentinel.txt"), `${SECRET}\n`);
  writeFileSync(join(ws, "tracked.txt"), "after\n");
  writeFileSync(join(ws, "other.txt"), "other after\n");
  writeFileSync(join(ws, "[ab].txt"), "bracket after\n");
  writeFileSync(join(ws, "a.txt"), "decoy\n"); // untracked; `[ab].txt` as a glob would match it
  writeFileSync(join(ws, "untracked.md"), "fresh line\n");
  server = await startServer({ port: PORT, workspace: ws, stateDir: join(ws, ".pneuma") });
});

afterAll(() => {
  (server as { server?: { stop?: (force?: boolean) => void } } | undefined)?.server?.stop?.(true);
  if (base) rmSync(base, { recursive: true, force: true });
});

describe.skipIf(!hasGit)("GET /api/git/diff in a workspace nested inside a repository", () => {
  test("pathspec magic cannot reach a tracked file outside the workspace", async () => {
    for (const path of [
      ":(top)outside/git-sentinel.txt",
      ":/outside/git-sentinel.txt",
      ":(top,literal)outside/git-sentinel.txt",
      ":(glob)../outside/*",
      "../outside/git-sentinel.txt",
    ]) {
      const { status, body } = await diffOf(path);
      expect(body).not.toContain(SECRET);
      expect(status === 403 || status === 200).toBe(true);
      if (status === 200) expect(JSON.parse(body).diff).toBe("");
    }
  });

  test("wildcard characters in a path are literal filenames, not globs", async () => {
    // `*.txt` names no file: no diff, rather than every changed .txt file.
    const star = JSON.parse((await diffOf("*.txt")).body).diff as string;
    expect(star).not.toContain("after");
    // `[ab].txt` is a real tracked file: its own diff, not a.txt/b.txt.
    const bracket = JSON.parse((await diffOf("[ab].txt")).body).diff as string;
    expect(bracket).toContain("+bracket after");
    expect(bracket).not.toContain("decoy");
  });

  test("ordinary tracked and untracked diffs still work", async () => {
    const tracked = JSON.parse((await diffOf("tracked.txt")).body).diff as string;
    expect(tracked).toContain("-before");
    expect(tracked).toContain("+after");
    expect(tracked).not.toContain("other after");
    const untracked = JSON.parse((await diffOf("untracked.md")).body).diff as string;
    expect(untracked).toContain("+fresh line");
  });

  test("status lists only workspace files, keyed by workspace-relative path", async () => {
    const { statuses } = (await (await api("/api/git/status")).json()) as { statuses: Record<string, string> };
    expect(statuses["tracked.txt"]).toBe("M");
    expect(statuses["untracked.md"]).toBe("A");
    expect(Object.keys(statuses).some((p) => p.includes("git-sentinel") || p.startsWith("ws/"))).toBe(false);
  });

  test("changed-files lists only workspace files", async () => {
    const res = await api("/api/git/changed-files");
    const { files } = (await res.json()) as { files: { path: string }[] };
    const paths = files.map((f) => f.path);
    expect(paths).toContain("tracked.txt");
    expect(paths.some((p) => p.includes("git-sentinel"))).toBe(false);
  });
});

describe.skipIf(!hasGit)("request-controlled object names", () => {
  test("isGitObjectId accepts hex object ids only", () => {
    expect(isGitObjectId("a1b2c3d")).toBe(true);
    expect(isGitObjectId("0123456789abcdef0123456789abcdef01234567")).toBe(true);
    expect(isGitObjectId("--output=/tmp/x")).toBe(false);
    expect(isGitObjectId("--remote=x --exec=touch")).toBe(false);
    expect(isGitObjectId("HEAD")).toBe(false);
    expect(isGitObjectId("abc")).toBe(false);
  });

  test("/api/replay/checkout refuses an option-shaped hash before git runs", async () => {
    // A loaded replay package, so the route reaches `git archive`.
    const src = join(base, "replay-src");
    const pkg = join(base, "replay-pkg");
    mkdirSync(src, { recursive: true });
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(src, "notes.md"), "# notes");
    const g = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: src, stdio: "pipe" });
    g("init", "-q");
    g("add", "-A");
    g("commit", "-q", "-m", "c1");
    const hash = g("rev-parse", "HEAD").toString().trim();
    g("bundle", "create", join(pkg, "repo.bundle"), "--all");
    writeFileSync(join(pkg, "manifest.json"), JSON.stringify({ metadata: { mode: "doc", totalTurns: 1 }, checkpoints: [{ hash }], summary: {} }));
    writeFileSync(join(pkg, "messages.jsonl"), "");
    const load = await api("/api/replay/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: pkg }) });
    expect(load.status).toBe(200);

    const marker = join(base, "archive-output.tar");
    const res = await api(`/api/replay/checkout/${encodeURIComponent(`--output=${marker}`)}`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(existsSync(marker)).toBe(false);

    const ok = await api(`/api/replay/checkout/${hash}`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { files: { path: string }[] }).files.map((f) => f.path)).toEqual(["notes.md"]);
  });
});
