import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCodex, cleanTestSession, matchesCodex, type CodexThread } from "../cleanup-test-sessions.js";

test("Claude deletes only the verified, finished test transcript in a private fixture", async () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  const home = mkdtempSync(join(tmpdir(), "pneuma-cleanup-fixture-"));
  const suite = mkdtempSync(join(realpathSync(tmpdir()), "pneuma-claude-lifecycle-"));
  try {
    process.env.CLAUDE_CONFIG_DIR = home;
    const cwd = mkdtempSync(join(suite, "claude-code-greeting-"));
    const dir = join(home, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(dir, { recursive: true });
    const make = (content: string, location = cwd) => {
      const id = crypto.randomUUID();
      const path = join(dir, id + ".jsonl");
      const line = JSON.stringify({ type: "user", entrypoint: "sdk-cli", cwd: location, sessionId: id, message: { content } });
      writeFileSync(path, line + "\n");
      return { candidate: { backend: "claude-code" as const, id, cwd }, path, line };
    };
    const prompt = "Reply with the single word: hi";
    const owned = make(prompt);
    const personal = make("Continue my own project");
    const otherWorkspace = make(prompt, home);
    const mixed = make(prompt);
    writeFileSync(mixed.path, mixed.line + "\n" + mixed.line.replace(prompt, "my own follow-up") + "\n");
    const queued = make(prompt);
    writeFileSync(queued.path, queued.line + "\n" + JSON.stringify({
      type: "queue-operation", sessionId: queued.candidate.id, content: "my pending follow-up",
    }) + "\n");
    const linkedId = crypto.randomUUID();
    symlinkSync(personal.path, join(dir, linkedId + ".jsonl"));
    expect(await cleanTestSession(owned.candidate, { apply: true })).toBe(false);
    rmSync(cwd, { recursive: true });
    for (const item of [personal, otherWorkspace, mixed, queued]) expect(await cleanTestSession(item.candidate, { apply: true })).toBe(false);
    expect(await cleanTestSession({ ...owned.candidate, id: linkedId }, { apply: true })).toBe(false);
    expect(await cleanTestSession(owned.candidate)).toBe(true);
    expect(await Bun.file(owned.path).exists()).toBe(true);
    expect(await cleanTestSession(owned.candidate, { apply: true })).toBe(true);
    expect(await cleanTestSession(owned.candidate, { apply: true })).toBe(false);
    expect(await Bun.file(owned.path).exists()).toBe(false);
    expect(readFileSync(personal.path, "utf8")).toBe(personal.line + "\n");
    expect(await Bun.file(mixed.path).exists()).toBe(true);
    expect(await Bun.file(otherWorkspace.path).exists()).toBe(true);
  } finally {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
    rmSync(home, { recursive: true, force: true });
    rmSync(suite, { recursive: true, force: true });
  }
});

test("Codex refuses personal turns, reused workspaces, active threads, partial histories and different IDs", () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "pneuma-codex-lifecycle-"));
  try {
    const cwd = join(dir, "codex-greeting-A1b2C3");
    const id = crypto.randomUUID();
    const candidate = { backend: "codex" as const, id, cwd };
    const turn = (text: string) => ({ items: [{ type: "userMessage", content: [{ type: "text", text }] }] });
    const thread: CodexThread = { id, cwd, originator: "pneuma-skills", status: { type: "notLoaded" }, turns: [turn("Reply with the single word: hi")] };
    expect(matchesCodex(thread, candidate, false)).toBe(true);
    for (const differences of [
      { id: crypto.randomUUID() }, { cwd: tmpdir() }, { name: "Personal" }, { parentThreadId: "parent" },
      { originator: "codex_cli_rs" }, { status: { type: "active" } }, { turns: [] },
      { turns: [...thread.turns, turn("my own follow-up")] },
      { turns: [{ ...thread.turns[0], itemsView: "summary" }] },
    ]) expect(matchesCodex({ ...thread, ...differences }, candidate, false)).toBe(false);
    mkdirSync(cwd);
    expect(matchesCodex(thread, candidate, true)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Codex sends one native deletion and refuses a rollout modified during verification", async () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "pneuma-cleanup-fixture-"));
  const suite = mkdtempSync(join(realpathSync(tmpdir()), "pneuma-codex-lifecycle-"));
  const saved = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = home;
    const id = crypto.randomUUID();
    const cwd = join(suite, "codex-greeting-A1b2C3");
    const candidate = { backend: "codex" as const, cwd, id };
    const dir = join(home, "sessions", "2026", "11", "23");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "rollout-fixture-" + id + ".jsonl");
    writeFileSync(path, "fixture");
    const thread = { id, path, cwd, originator: "pneuma-skills", status: { type: "notLoaded" }, turns: [
      { items: [{ type: "userMessage", content: [{ type: "text", text: "Reply with the single word: hi" }] }] },
    ] };
    const deleted: string[] = [];
    let changeDuringRead = false;
    const call = async (method: string, params: object) => {
      if (method === "thread/delete") {
        deleted.push((params as { threadId: string }).threadId);
        return {};
      }
      if (changeDuringRead && "includeTurns" in params && params.includeTurns === true) writeFileSync(path, "changed");
      return { thread };
    };
    expect(await checkCodex(call, candidate, false)).toBe(true);
    expect(deleted).toEqual([]);
    changeDuringRead = true;
    expect(await checkCodex(call, candidate, true)).toBe(false);
    expect(deleted).toEqual([]);
    changeDuringRead = false;
    expect(await checkCodex(call, candidate, true)).toBe(true);
    expect(deleted).toEqual([id]);
    rmSync(path);
    expect(await checkCodex(call, candidate, true)).toBe(false);
    expect(deleted).toEqual([id]);
  } finally {
    if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
    rmSync(home, { recursive: true, force: true });
    rmSync(suite, { recursive: true, force: true });
  }
});


test("the command refuses a deletion without one backend and UUID", async () => {
  for (const flags of [["--apply"], ["--apply", "--backend", "codex"], ["--apply", "--id", crypto.randomUUID()]]) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cleanup-test-sessions.ts"), ...flags], {
      stdout: "pipe", stderr: "pipe",
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("one exact --id");
  }
});
