import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SHADOW_DIR_NAME = "shadow.git";
const EXCLUDE_RULES = `.pneuma
node_modules
.DS_Store
dist
.env
.env.*
*.log
`;

// Track which workspaces have shadow git enabled
const availableWorkspaces = new Set<string>();

function gitDir(workspace: string): string {
  return join(workspace, ".pneuma", SHADOW_DIR_NAME);
}

function shadowGit(workspace: string, args: string[], options?: { stdout?: "pipe" | "ignore" }): Bun.Subprocess {
  return Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace)}`, `--work-tree=${workspace}`, ...args],
    { cwd: workspace, stdout: options?.stdout ?? "ignore", stderr: "ignore" },
  );
}

export async function initShadowGit(workspace: string): Promise<void> {
  const dir = gitDir(workspace);

  // Idempotent — skip if already initialized
  if (existsSync(join(dir, "HEAD"))) {
    availableWorkspaces.add(workspace);
    return;
  }

  try {
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
    await Bun.spawn(["git", "init", "--bare", dir], { stdout: "ignore", stderr: "ignore" }).exited;

    // Set git identity for commits (avoids failure on systems without global git config)
    await Bun.spawn(["git", `--git-dir=${dir}`, "config", "user.email", "pneuma@local"], { stdout: "ignore" }).exited;
    await Bun.spawn(["git", `--git-dir=${dir}`, "config", "user.name", "Pneuma Shadow"], { stdout: "ignore" }).exited;

    // Write exclude rules
    await Bun.write(join(dir, "info", "exclude"), EXCLUDE_RULES);

    // Initial commit capturing current workspace state
    await shadowGit(workspace, ["add", "-A"]).exited;
    await shadowGit(workspace, ["commit", "-m", "initial", "--allow-empty"]).exited;

    availableWorkspaces.add(workspace);
  } catch (err) {
    console.warn("[shadow-git] init failed, checkpoints disabled:", err);
  }
}

export function isShadowGitAvailable(workspace: string): boolean {
  return availableWorkspaces.has(workspace);
}

// --- Per-workspace turn counter (for backends without num_turns) ---
const turnCounters = new Map<string, number>();

export function nextTurnIndex(workspace: string): number {
  const current = turnCounters.get(workspace) ?? 0;
  const next = current + 1;
  turnCounters.set(workspace, next);
  return next;
}

// --- Checkpoint serial queue ---
const queues = new Map<string, Promise<void>>();

export function enqueueCheckpoint(workspace: string, turnIndex: number): Promise<void> {
  if (!availableWorkspaces.has(workspace)) return Promise.resolve();

  const prev = queues.get(workspace) ?? Promise.resolve();
  const next = prev
    .then(() => captureCheckpointInner(workspace, turnIndex))
    .catch((err) => console.warn("[shadow-git] checkpoint failed:", err));
  queues.set(workspace, next);
  return next;
}

async function captureCheckpointInner(workspace: string, turnIndex: number): Promise<void> {
  const diffProc = shadowGit(workspace, ["diff", "HEAD", "--quiet"]);
  const diffExit = await diffProc.exited;

  const untrackedProc = shadowGit(workspace, ["ls-files", "--others", "--exclude-standard"], { stdout: "pipe" });
  const untracked = (await new Response(untrackedProc.stdout).text()).trim();

  if (diffExit === 0 && !untracked) return;

  await shadowGit(workspace, ["add", "-A"]).exited;
  await shadowGit(workspace, ["commit", "-m", `turn-${turnIndex}`]).exited;

  const hashProc = shadowGit(workspace, ["rev-parse", "--short", "HEAD"], { stdout: "pipe" });
  let hash = (await new Response(hashProc.stdout).text()).trim();

  // Fallback: read hash directly from git ref file if spawn stdout was empty
  if (!hash) {
    try {
      const headRef = readFileSync(join(gitDir(workspace), "HEAD"), "utf-8").trim();
      if (headRef.startsWith("ref: ")) {
        const refPath = join(gitDir(workspace), headRef.slice(5));
        hash = readFileSync(refPath, "utf-8").trim().slice(0, 7);
      } else {
        hash = headRef.slice(0, 7);
      }
    } catch {
      // Last resort — still write entry without hash
    }
  }

  const entry = JSON.stringify({ turn: turnIndex, ts: Date.now(), hash }) + "\n";
  appendFileSync(checkpointsIndexPath(workspace), entry);
}

function checkpointsIndexPath(workspace: string): string {
  return join(workspace, ".pneuma", "checkpoints.jsonl");
}

// --- Checkpoint listing ---
export interface CheckpointEntry {
  turn: number;
  ts: number;
  hash: string;
}

export async function createBundle(workspace: string, outPath: string): Promise<void> {
  const proc = Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace)}`, "bundle", "create", outPath, "--all"],
    { stdout: "ignore", stderr: "ignore" },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`git bundle create failed with exit code ${exitCode}`);
}

export async function exportCheckpointFiles(workspace: string, hash: string, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const archive = Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace)}`, "archive", hash],
    { stdout: "pipe", stderr: "ignore" },
  );
  const extract = Bun.spawn(
    ["tar", "x", "-C", outDir],
    { stdin: archive.stdout, stdout: "ignore", stderr: "ignore" },
  );
  await extract.exited;
}

export async function listCheckpoints(workspace: string): Promise<CheckpointEntry[]> {
  const indexPath = checkpointsIndexPath(workspace);
  if (!existsSync(indexPath)) return [];

  const content = await Bun.file(indexPath).text();
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CheckpointEntry);
}

/** Get the hash of the latest checkpoint (last line of checkpoints.jsonl) */
export async function getLatestCheckpointHash(workspace: string): Promise<string | null> {
  const entries = await listCheckpoints(workspace);
  if (entries.length === 0) return null;
  return entries[entries.length - 1].hash;
}
