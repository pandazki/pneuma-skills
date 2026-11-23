import { Database } from "bun:sqlite";
import { createReadStream, lstatSync, realpathSync, readdirSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import { withCodex, type CodexCall } from "./test-session-codex.js";

export type Backend = "claude-code" | "codex";
export interface Candidate { backend: Backend; id: string; cwd: string }
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const scenarioNames = ["boot", "greeting", "tool-flow", "interrupt", "multi-turn", "resume"];
const temp = realpathSync(tmpdir());
const aliases = [...new Set([resolve(tmpdir()), temp])];
const claudeHome = () => resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
const codexHome = () => resolve(process.env.CODEX_HOME || join(homedir(), ".codex"));
const key = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");
const stat = (path: string) => lstatSync(path, { throwIfNoEntry: false });

function workspace(backend: Backend, cwd: string) {
  if (!isAbsolute(cwd) || resolve(cwd) !== cwd) return;
  const suite = dirname(cwd);
  if (!aliases.includes(dirname(suite))) return;
  const prefix = backend === "codex" ? "codex" : "claude";
  if (!new RegExp(`^pneuma-${prefix}-lifecycle-[a-zA-Z0-9]{6}$`).test(basename(suite))) return;
  const scenario = scenarioNames.find(name => new RegExp(`^${backend}-${name}-[a-zA-Z0-9]{6}$`).test(basename(cwd)));
  if (!scenario || stat(suite)?.isSymbolicLink() || stat(cwd)) return;
  const paths = aliases.map(root => join(root, basename(suite), basename(cwd)));
  return { paths, scenario, canonical: join(temp, basename(suite), basename(cwd)) };
}

function allowedPrompts(scenario: string, paths: string[]): string[] {
  switch (scenario) {
    case "boot": return ["Reply with the single word: ok"];
    case "greeting": return ["Reply with the single word: hi"];
    case "multi-turn": return ["Say the single word: alpha", "Say the single word: beta"];
    case "interrupt": return ["Count slowly from 1 to 50, one number per line, pausing 1 second between each."];
    case "resume": return ["Remember the magic word: paprika.", "What was the magic word I told you?"];
    case "tool-flow": return paths.map(cwd => `Use your available file-writing tools to create ${join(cwd, "hello.txt")} containing one line: hi, followed by a newline. Then stop.`);
    default: return [];
  }
}

// A Claude project key is lossy. A matching directory name alone cannot authorize any action.
function safeClaudeDir(dir: string) {
  const root = join(claudeHome(), "projects");
  return dirname(dir) === root && stat(root)?.isDirectory() && stat(dir)?.isDirectory()
    && realpathSync(dir) === join(realpathSync(claudeHome()), "projects", basename(dir));
}

async function claudeTranscript(dir: string, id: string, expected?: string) {
  if (!uuid.test(id) || !safeClaudeDir(dir)) return;
  const path = join(dir, id + ".jsonl");
  const info = stat(path);
  if (!info?.isFile() || info.nlink !== 1) return;
  let cwd: string | undefined;
  let seenPrompt = false;
  const queued = new Set<string>();
  const previews = new Set<string>();
  const input = createReadStream(path);
  try {
    for await (const line of createInterface({ input })) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (!row || typeof row !== "object" || Array.isArray(row)) return;
      if (row.sessionId !== undefined && row.sessionId !== id) return;
      if (row.cwd !== undefined) {
        if (typeof row.cwd !== "string" || (cwd && row.cwd !== cwd)) return;
        cwd = row.cwd;
      }
      if (row.type === "custom-title" || row.type === "tag") return;
      if (row.type === "queue-operation" && row.content !== undefined) {
        if (typeof row.content !== "string") return;
        queued.add(row.content);
      }
      if (row.type === "last-prompt") {
        if (typeof row.lastPrompt !== "string") return;
        previews.add(row.lastPrompt);
      }
      if (row.type !== "user") continue;
      const ws = cwd && workspace("claude-code", cwd);
      if (!ws || row.sessionId !== id || row.cwd !== cwd || row.entrypoint !== "sdk-cli") return;
      const content = row.message?.content;
      if (Array.isArray(content) && content.length && content.every(x => x?.type === "tool_result")) continue;
      if (typeof content !== "string" || !allowedPrompts(ws.scenario, ws.paths).includes(content)) return;
      seenPrompt = true;
    }
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  } finally { input.destroy(); }
  if (!cwd || !seenPrompt || key(cwd) !== basename(dir)) return;
  const ws = workspace("claude-code", cwd);
  if (!ws || (expected && !ws.paths.includes(expected))) return;
  const prompts = allowedPrompts(ws.scenario, ws.paths);
  for (const text of queued) if (!prompts.includes(text)) return;
  for (const text of previews) {
    if (!prompts.some(p => text === p || (p.length > 200 && text === p.slice(0, 200) + "…"))) return;
  }
  return { path, info, cwd: ws.canonical };
}

function codexCandidates(): Candidate[] {
  const dbPath = join(resolve(process.env.CODEX_SQLITE_HOME || codexHome()), "state_5.sqlite");
  if (!stat(dbPath)?.isFile()) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    // Metadata discovery only. The native read below independently checks every ID.
    const rows = db.query("SELECT id, cwd FROM threads WHERE archived = 0 AND instr(cwd, 'pneuma-codex-lifecycle-') > 0").all() as { id: string; cwd: string }[];
    return rows.filter(row => uuid.test(row.id) && workspace("codex", row.cwd)).map(row => ({ ...row, backend: "codex" }));
  } finally { db.close(); }
}

export interface CodexThread {
  id: string; cwd: string; originator: string; name?: string; parentThreadId?: string; forkedFromId?: string;
  path?: string | null; status: { type: string }; turns: { itemsView?: string; items: { type: string; content?: { type: string; text?: string }[] }[] }[];
}
function ownedCodexMetadata(thread: CodexThread | undefined, candidate: Candidate) {
  const ws = workspace("codex", candidate.cwd);
  if (ws && thread && uuid.test(candidate.id) && thread.id === candidate.id && ws.paths.includes(thread.cwd)
    && thread.originator === "pneuma-skills" && thread.status?.type === "notLoaded"
    && !thread.parentThreadId && !thread.forkedFromId && !thread.name) return ws;
}

export function matchesCodex(thread: CodexThread, candidate: Candidate, witnessed: boolean): boolean {
  const ws = ownedCodexMetadata(thread, candidate);
  if (!ws || !Array.isArray(thread.turns)) return false;
  const prompts = allowedPrompts(ws.scenario, ws.paths);
  let messages = 0;
  for (const turn of thread.turns) {
    if (turn.itemsView !== undefined && turn.itemsView !== "full") return false;
    for (const item of turn.items) {
      if (item.type !== "userMessage") continue;
      if (item.content?.length !== 1 || item.content[0].type !== "text" || !prompts.includes(item.content[0].text ?? "")) return false;
      messages++;
    }
  }
  return messages > 0 || (witnessed && ws.scenario === "boot");
}

export async function cleanTestSession(
  candidate: Candidate,
  { apply = false, observedByHarness = false }: { apply?: boolean; observedByHarness?: boolean } = {},
): Promise<boolean> {
  const { backend, cwd, id } = candidate;
  const ws = workspace(backend, cwd);
  if (!ws || !uuid.test(id)) return false;
  if (backend === "claude-code") {
    const matches = [];
    for (const alias of ws.paths) {
      const dir = join(claudeHome(), "projects", key(alias));
      const target = await claudeTranscript(dir, id, cwd);
      if (target) matches.push({ dir, ...target });
    }
    if (matches.length !== 1) return false;
    const target = matches[0];
    if (apply) {
      const now = stat(target.path);
      if (!safeClaudeDir(target.dir) || !workspace(backend, cwd) || !now?.isFile() || now.nlink !== 1 ||
          now.dev !== target.info.dev || now.ino !== target.info.ino || now.ctimeMs !== target.info.ctimeMs) return false;
      // Remove just the verified transcript. Project directories and memory can be shared.
      unlinkSync(target.path);
    }
    return true;
  }
  return withCodex(call => checkCodex(call, candidate, apply, observedByHarness));
}

function rolloutStamp(path: string | null | undefined, id: string) {
  if (!path || !isAbsolute(path)) return;
  const home = realpathSync(codexHome());
  const within = relative(home, path).split(sep);
  const file = stat(path);
  if (within.length !== 5 || within[0] !== "sessions" || !/^\d{4}$/.test(within[1]) ||
      !/^\d{2}$/.test(within[2]) || !/^\d{2}$/.test(within[3]) ||
      !within[4].startsWith("rollout-") || !within[4].endsWith("-" + id + ".jsonl") ||
      !file?.isFile() || file.nlink !== 1 || realpathSync(path) !== path) return;
  return [file.dev, file.ino, file.size, file.ctimeMs].join("/");
}

type Verification = "eligible" | "native-history-only";

async function reviewCodex(call: CodexCall, candidate: Candidate, witnessed: boolean): Promise<Verification | undefined> {
  const threadId = candidate.id;
  const metadata = await call("thread/read", { threadId, includeTurns: false }) as { thread: CodexThread };
  if (!ownedCodexMetadata(metadata.thread, candidate)) return;
  const before = rolloutStamp(metadata.thread.path, threadId);
  const { thread } = await call("thread/read", { threadId, includeTurns: true }) as { thread: CodexThread };
  if (!thread || !matchesCodex(thread, candidate, witnessed) || thread.path !== metadata.thread.path) return;
  const after = rolloutStamp(thread.path, threadId);
  if (before !== after) return;
  // Migrated histories can still be visible through the native API even when
  // the old local rollout is absent. They may be previewed, never deleted.
  return before ? "eligible" : "native-history-only";
}

export async function checkCodex(call: CodexCall, candidate: Candidate, apply: boolean, witnessed = false) {
  if (await reviewCodex(call, candidate, witnessed) !== "eligible") return false;
  if (apply) await call("thread/delete", { threadId: candidate.id });
  return true;
}

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: "boolean", short: "h" }, backend: { type: "string" }, id: { type: "string" }, apply: { type: "boolean" }, limit: { type: "string", default: "10" },
  } });
  if (values.help) {
    console.log("bun run test:cleanup-sessions [--backend claude-code|codex] [--limit N] [--id UUID]\n" +
      "Preview up to N verified, closed test sessions (default 10).\n" +
      "To delete one verified session, pass --apply --backend BACKEND --id UUID.");
    return;
  }
  if (values.backend && !["claude-code","codex"].includes(values.backend)) throw new Error("Unknown backend");
  if (values.id && !uuid.test(values.id)) throw new Error("Invalid session ID");
  if (values.apply && (!values.id || !values.backend)) throw new Error("--apply requires both --backend and one exact --id");
  const limit = Number(values.limit);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid --limit");
  let matched = 0;
  let unreadable = 0;
  let historyOnly = 0;
  const selected: Candidate[] = [];
  function report(candidate: Candidate, verification: Verification = "eligible") {
    if (values.apply) {
      if (verification === "eligible") selected.push(candidate);
      return;
    }
    if (verification === "native-history-only") historyOnly++;
    console.log(JSON.stringify({ ...candidate, action: "preview", verification }));
    matched++;
  }
  if (values.backend !== "codex") {
    const root = join(claudeHome(), "projects");
    const prefixes = aliases.map(p => key(join(p, "pneuma-claude-lifecycle-")));
    if (stat(root)?.isDirectory()) for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (matched >= limit) break;
      if (!dir.isDirectory() || !prefixes.some(prefix => dir.name.startsWith(prefix))) continue;
      const full = join(root, dir.name);
      const ids = values.id ? [values.id] : readdirSync(full).filter(name => name.endsWith(".jsonl")).map(name => name.slice(0, -6));
      for (const id of ids) {
        if (matched >= limit) break;
        const transcript = await claudeTranscript(full, id);
        if (!transcript) continue;
        const candidate: Candidate = { backend: "claude-code", cwd: transcript.cwd, id };
        report(candidate);
      }
    }
  }
  if (values.backend !== "claude-code" && matched < limit) {
    const candidates = codexCandidates().filter(candidate => !values.id || values.id === candidate.id);
    if (candidates.length) await withCodex(async call => {
      for (const candidate of candidates) {
        if (matched >= limit) break;
        try {
          const verification = await reviewCodex(call, candidate, false);
          if (verification) report(candidate, verification);
        } catch (error) {
          // An old index can reference an absent rollout. Never infer ownership from the index.
          if (values.apply || !/no rollout|not found|not materialized/i.test(String(error))) throw error;
          unreadable++;
        }
      }
    });
  }
  if (historyOnly) console.error(`${historyOnly} native histories are preview-only; no independently verified rollout file.`);
  if (unreadable) console.error(`Skipped ${unreadable} missing Codex rollout(s).`);
  if (values.apply) {
    if (selected.length !== 1) throw new Error("Expected exactly one verified session; nothing deleted.");
    if (!await cleanTestSession(selected[0], { apply: true })) throw new Error("Session changed since preview; nothing deleted.");
    console.log(JSON.stringify({ ...selected[0], action: "deleted" }));
    matched = 1;
  }
  console.log(`${matched} verified session(s) ${values.apply ? "deleted" : "previewed"}.`);
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
