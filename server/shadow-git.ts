import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SHADOW_DIR_NAME = "shadow.git";

/** Skip any single file larger than this from checkpoints (defense-in-depth). */
const MAX_CHECKPOINT_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

/** Marker lines delimiting the size-cap-managed section of `info/exclude`. */
const OVERSIZED_BEGIN = "# >>> pneuma:oversized";
const OVERSIZED_END = "# <<< pneuma:oversized";

/**
 * Base exclude rules applied in BOTH topologies (quick + project session).
 *
 * Beyond the heavy/ephemeral dirs every workspace wants gone, this includes
 * pneuma's own repo artifacts (`shadow.git`, `checkpoints.jsonl`) as bare
 * tokens. In a quick session those already live under `.pneuma` (so they are
 * redundant-but-harmless); in a project session the work-tree IS the session
 * dir, so without these the shadow repo would re-commit its own ever-growing
 * object store every turn — an O(N^2) self-referential disk blowup.
 *
 * Deliberately NOT excluded: `build` / `target` / `out` — those can be
 * legitimate mode deliverables.
 */
const BASE_EXCLUDE_RULES = [
  ".pneuma",
  "node_modules",
  ".DS_Store",
  "dist",
  ".env",
  ".env.*",
  "*.log",
  ".venv",
  "venv",
  "__pycache__",
  "*.pyc",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "shadow.git",
  "checkpoints.jsonl",
];

/**
 * Additional rules applied ONLY when the work-tree root IS the session state
 * dir (project-session topology, `resolve(stateDir) === resolve(workspace)`).
 *
 * In that topology the work-tree is pneuma's own session dir, so these session
 * bookkeeping / scaffolding paths sit at the work-tree ROOT and are never the
 * user's deliverable (deliverables live in named content subdirs). Each is
 * ROOT-ANCHORED with a leading `/` so a same-named file inside a user content
 * subdir (e.g. `deck/CLAUDE.md`) is NOT excluded.
 */
const PROJECT_ROOT_EXCLUDE_RULES = [
  "/session.json",
  "/history.json",
  "/config.json",
  "/skill-version.json",
  "/skill-dismissed.json",
  "/deploy.json",
  "/viewer-state.json",
  "/thumbnail.png",
  "/captures/",
  "/evolution/",
  "/onboard/",
  "/inbound-handoff.json",
  "/.claude/",
  "/.agents/",
  "/.kimi/",
  "/CLAUDE.md",
  "/AGENTS.md",
];

/**
 * Build the static exclude ruleset for a session given its topology. The
 * project-session root-anchored rules are appended only when the work-tree
 * root is itself the session state dir.
 */
function buildExcludeRules(resolvedStateDir: string, workspace: string): string[] {
  const rules = [...BASE_EXCLUDE_RULES];
  if (resolve(resolvedStateDir) === resolve(workspace)) {
    rules.push(...PROJECT_ROOT_EXCLUDE_RULES);
  }
  return rules;
}

/**
 * Plumbing paths to untrack (`git rm --cached`) on resume. Mirrors the static
 * exclude rules but WITHOUT the leading `/` git-anchor (the rm path is already
 * work-tree-relative and rooted). Returns paths that, if already tracked from a
 * pre-fix session, must stop being tracked so growth halts.
 */
function untrackablePlumbingPaths(resolvedStateDir: string, workspace: string): string[] {
  const paths = ["shadow.git", "checkpoints.jsonl"];
  if (resolve(resolvedStateDir) === resolve(workspace)) {
    for (const rule of PROJECT_ROOT_EXCLUDE_RULES) {
      // Strip the leading "/" anchor and any trailing "/" dir marker.
      paths.push(rule.replace(/^\//, "").replace(/\/$/, ""));
    }
  }
  return paths;
}

/**
 * Serialize the static (non-size-cap) portion of `info/exclude`. The size-cap
 * managed section, if present in the existing file, is preserved verbatim and
 * re-appended so per-file caps accumulated across turns survive a rewrite.
 */
function serializeExclude(rules: string[], existing?: string): string {
  let body = rules.join("\n") + "\n";
  const managed = existing ? extractOversizedBlock(existing) : null;
  if (managed) body += managed;
  return body;
}

/** Extract the oversized-managed block (markers inclusive) from an exclude file. */
function extractOversizedBlock(content: string): string | null {
  const begin = content.indexOf(OVERSIZED_BEGIN);
  if (begin < 0) return null;
  const end = content.indexOf(OVERSIZED_END, begin);
  if (end < 0) return null;
  return content.slice(begin, end + OVERSIZED_END.length) + "\n";
}

/** Parse the root-anchored paths already recorded in the oversized block. */
function parseOversizedPaths(content: string): Set<string> {
  const block = extractOversizedBlock(content);
  const paths = new Set<string>();
  if (!block) return paths;
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    paths.add(line.replace(/^\//, ""));
  }
  return paths;
}

/**
 * Render `info/exclude` with the oversized block replaced/created from `paths`.
 * Static rules are preserved verbatim; only the managed section is rewritten,
 * so the block is idempotent across turns (no duplicated static rules).
 */
function withOversizedBlock(content: string, paths: Set<string>): string {
  // Strip any existing managed block first.
  let base = content;
  const begin = base.indexOf(OVERSIZED_BEGIN);
  if (begin >= 0) {
    const end = base.indexOf(OVERSIZED_END, begin);
    if (end >= 0) {
      base = base.slice(0, begin) + base.slice(end + OVERSIZED_END.length);
    }
  }
  base = base.replace(/\n+$/, "") + "\n";
  if (paths.size === 0) return base;
  const sorted = [...paths].sort();
  const block = [OVERSIZED_BEGIN, ...sorted.map((p) => `/${p}`), OVERSIZED_END].join("\n");
  return base + block + "\n";
}

/**
 * State directory where `shadow.git` and `checkpoints.jsonl` live.
 *
 * - Quick session (legacy 2.x): `<workspace>/.pneuma/`
 * - Project session (3.0+): `<projectRoot>/.pneuma/sessions/<sessionId>/`
 *
 * Callers that still pass a workspace path get auto-resolved to the legacy
 * location (`join(workspace, ".pneuma")`) for byte-identical behavior.
 */
function resolveStateDir(workspace: string, stateDir?: string): string {
  return stateDir ?? join(workspace, ".pneuma");
}

// Track which workspaces have shadow git enabled. Keyed by workspace because
// runtime callers (ws-bridge*) only have workspace handy when checking
// availability; we can recover stateDir from the same map if we ever need it.
const stateDirByWorkspace = new Map<string, string>();

function gitDir(workspace: string, stateDir?: string): string {
  const resolvedStateDir = stateDir ?? stateDirByWorkspace.get(workspace) ?? resolveStateDir(workspace);
  return join(resolvedStateDir, SHADOW_DIR_NAME);
}

function shadowGit(workspace: string, args: string[], options?: { stdout?: "pipe" | "ignore" }): Bun.Subprocess {
  return Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace)}`, `--work-tree=${workspace}`, ...args],
    { cwd: workspace, stdout: options?.stdout ?? "ignore", stderr: "ignore" },
  );
}

/**
 * Initialize the shadow-git bare repo for a session.
 *
 * @param workspace - Work-tree directory whose files we track (agent CWD).
 * @param stateDir - Optional explicit state dir. Defaults to `<workspace>/.pneuma`
 *   for quick sessions; project sessions pass `<projectRoot>/.pneuma/sessions/<id>`.
 */
export async function initShadowGit(workspace: string, stateDir?: string): Promise<void> {
  const resolvedStateDir = resolveStateDir(workspace, stateDir);
  const dir = join(resolvedStateDir, SHADOW_DIR_NAME);

  // Idempotent — already initialized. We still re-apply the current ruleset so
  // sessions created before a rules change (e.g. the self-reference fix) pick up
  // the new excludes and stop tracking now-excluded plumbing. Best-effort: a
  // failure here must never disable an otherwise-healthy session.
  if (existsSync(join(dir, "HEAD"))) {
    // Register first so shadowGit()/gitDir() resolve against this stateDir.
    stateDirByWorkspace.set(workspace, resolvedStateDir);
    try {
      const excludePath = join(dir, "info", "exclude");
      const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : undefined;
      await Bun.write(excludePath, serializeExclude(buildExcludeRules(resolvedStateDir, workspace), existing));

      // Untrack any plumbing that a pre-fix session already committed. The next
      // checkpoint's `add -A` + commit finalizes the removal; ignored/untracked
      // files are never re-added.
      await shadowGit(workspace, [
        "rm", "-r", "--cached", "--ignore-unmatch",
        ...untrackablePlumbingPaths(resolvedStateDir, workspace),
      ]).exited;
    } catch (err) {
      console.warn("[shadow-git] resume re-exclude failed (continuing):", err);
    }
    return;
  }

  try {
    mkdirSync(resolvedStateDir, { recursive: true });
    await Bun.spawn(["git", "init", "--bare", dir], { stdout: "ignore", stderr: "ignore" }).exited;

    // Set git identity for commits (avoids failure on systems without global git config)
    await Bun.spawn(["git", `--git-dir=${dir}`, "config", "user.email", "pneuma@local"], { stdout: "ignore" }).exited;
    await Bun.spawn(["git", `--git-dir=${dir}`, "config", "user.name", "Pneuma Shadow"], { stdout: "ignore" }).exited;

    // Write exclude rules (topology-aware: project sessions whose work-tree IS
    // the session dir also exclude the root-anchored bookkeeping files).
    await Bun.write(join(dir, "info", "exclude"), serializeExclude(buildExcludeRules(resolvedStateDir, workspace)));

    // Register before we run the initial commit so shadowGit() resolves stateDir correctly.
    stateDirByWorkspace.set(workspace, resolvedStateDir);

    // Initial commit capturing current workspace state
    await shadowGit(workspace, ["add", "-A"]).exited;
    await shadowGit(workspace, ["commit", "-m", "initial", "--allow-empty"]).exited;
  } catch (err) {
    console.warn("[shadow-git] init failed, checkpoints disabled:", err);
    stateDirByWorkspace.delete(workspace);
  }
}

export function isShadowGitAvailable(workspace: string): boolean {
  return stateDirByWorkspace.has(workspace);
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
  if (!stateDirByWorkspace.has(workspace)) return Promise.resolve();

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
  const untracked = (await new Response(untrackedProc.stdout as ReadableStream<Uint8Array>).text()).trim();

  if (diffExit === 0 && !untracked) return;

  // Defense-in-depth: keep any single oversized file out of the snapshot. Bound
  // the work to changed paths only (new + modified-tracked), so latency stays
  // proportional to the turn's churn, not the whole work-tree.
  await enforceFileSizeCap(workspace, untracked);

  await shadowGit(workspace, ["add", "-A"]).exited;
  await shadowGit(workspace, ["commit", "-m", `turn-${turnIndex}`]).exited;

  const hashProc = shadowGit(workspace, ["rev-parse", "--short", "HEAD"], { stdout: "pipe" });
  let hash = (await new Response(hashProc.stdout as ReadableStream<Uint8Array>).text()).trim();

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

/**
 * Skip any single changed file exceeding {@link MAX_CHECKPOINT_FILE_BYTES}.
 *
 * Candidates = newly-untracked paths (passed in, already computed by the caller)
 * plus modified-tracked paths (`git diff --name-only HEAD`). Each is stat'd; any
 * over the cap is appended to the managed oversized block in `info/exclude`
 * (deduped across turns) and, if currently tracked, dropped from the index via
 * `git rm --cached`. Best-effort — a failure here must not abort the checkpoint.
 */
async function enforceFileSizeCap(workspace: string, untracked: string): Promise<void> {
  try {
    const dir = gitDir(workspace);
    const candidates = new Set<string>();
    for (const p of untracked.split("\n").map((l) => l.trim()).filter(Boolean)) candidates.add(p);

    const modifiedProc = shadowGit(workspace, ["diff", "--name-only", "HEAD"], { stdout: "pipe" });
    const modified = (await new Response(modifiedProc.stdout as ReadableStream<Uint8Array>).text()).trim();
    for (const p of modified.split("\n").map((l) => l.trim()).filter(Boolean)) candidates.add(p);

    if (candidates.size === 0) return;

    const oversized: string[] = [];
    for (const rel of candidates) {
      let size = 0;
      try {
        size = statSync(join(workspace, rel)).size;
      } catch {
        continue; // deleted/unreadable — git will reconcile via `add -A`
      }
      if (size > MAX_CHECKPOINT_FILE_BYTES) oversized.push(rel);
    }
    if (oversized.length === 0) return;

    const excludePath = join(dir, "info", "exclude");
    const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
    const recorded = parseOversizedPaths(existing);
    const fresh = oversized.filter((p) => !recorded.has(p));
    for (const p of oversized) {
      recorded.add(p);
      console.warn(`[shadow-git] skipping oversized file (> ${MAX_CHECKPOINT_FILE_BYTES} bytes): ${p}`);
    }
    await Bun.write(excludePath, withOversizedBlock(existing, recorded));

    // Drop from the index if any oversized path was already tracked.
    if (fresh.length > 0) {
      await shadowGit(workspace, ["rm", "--cached", "--ignore-unmatch", ...fresh]).exited;
    }
  } catch (err) {
    console.warn("[shadow-git] size-cap enforcement failed (continuing):", err);
  }
}

function checkpointsIndexPath(workspace: string, stateDir?: string): string {
  const resolvedStateDir = stateDir ?? stateDirByWorkspace.get(workspace) ?? resolveStateDir(workspace);
  return join(resolvedStateDir, "checkpoints.jsonl");
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

export interface TreeFileEntry {
  /** Workspace-relative path. */
  path: string;
  /** Git blob object id — content-addressed, stable across checkpoints (dedup key). */
  blob: string;
  /** Byte size of the blob. */
  size: number;
}

/**
 * List every file present at a checkpoint, with its git blob id and size.
 * Used by the web-player materializer to build a content-addressed snapshot.
 */
export async function listCheckpointTree(
  workspace: string,
  hash: string,
  stateDir?: string,
): Promise<TreeFileEntry[]> {
  const proc = Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace, stateDir)}`, "ls-tree", "-r", "-l", hash],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
  const entries: TreeFileEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    // Format: "<mode> <type> <object> <size>\t<path>"
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    const path = line.slice(tab + 1);
    if (meta[1] !== "blob") continue; // skip submodules/trees
    const blob = meta[2];
    const size = parseInt(meta[3], 10) || 0;
    entries.push({ path, blob, size });
  }
  return entries;
}

/**
 * Read the raw bytes of a git blob (binary-safe) from the shadow repo.
 */
export async function readCheckpointBlob(
  workspace: string,
  blobSha: string,
  stateDir?: string,
): Promise<Uint8Array> {
  const proc = Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace, stateDir)}`, "cat-file", "blob", blobSha],
    { stdout: "pipe", stderr: "ignore" },
  );
  const buf = await new Response(proc.stdout as ReadableStream<Uint8Array>).arrayBuffer();
  return new Uint8Array(buf);
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

/**
 * List checkpoints recorded for a workspace.
 *
 * @param workspace - Work-tree path (used as map key for runtime state).
 * @param stateDir - Optional explicit state dir. When omitted, the registered
 *   stateDir from initShadowGit is used; if shadow git was never initialized,
 *   falls back to the legacy `<workspace>/.pneuma` location for read-only
 *   inspection (e.g. launcher scanning a non-active workspace).
 */
export async function listCheckpoints(workspace: string, stateDir?: string): Promise<CheckpointEntry[]> {
  const indexPath = checkpointsIndexPath(workspace, stateDir);
  if (!existsSync(indexPath)) return [];

  const content = await Bun.file(indexPath).text();
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CheckpointEntry);
}

/** Get the hash of the latest checkpoint (last line of checkpoints.jsonl) */
export async function getLatestCheckpointHash(workspace: string, stateDir?: string): Promise<string | null> {
  const entries = await listCheckpoints(workspace, stateDir);
  if (entries.length === 0) return null;
  return entries[entries.length - 1].hash;
}
