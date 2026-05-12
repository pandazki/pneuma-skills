/**
 * Running-session registry — `~/.pneuma/running/`, a directory of small
 * pid-files, one per live `pneuma <mode>` process.
 *
 * Why a separate file-backed registry: "which sessions are running" is
 * genuinely distributed — each session is its own `bun bin/pneuma.ts` process
 * with its own HTTP server. The launcher only tracks the children *it* spawned
 * (`childProcesses` map), so a session that switched modes internally (a Smart
 * Handoff target, or a project-onboard "apply task" target) — spawned by a
 * different session server — is invisible to it. Each session process writes
 * its own entry here on startup and removes it on exit; any reader (the
 * launcher, another session server) gets the system-wide picture, with each
 * entry carrying that process's *current* mode.
 *
 * Liveness: readers prune entries whose PID is no longer alive (covers crashes
 * / SIGKILL where the exit handler didn't run); a fresh `pneuma` startup also
 * prunes before writing its own. PID reuse is an accepted (tiny) risk in a
 * single-user local context — worst case the launcher briefly shows a stale
 * card; the next session startup re-prunes.
 *
 * Filenames must be FS-safe, so the registry `id` (which contains `/` and `:`)
 * is `encodeURIComponent`-encoded.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RUNNING_DIR = join(homedir(), ".pneuma", "running");

export interface RunningSession {
  /** Same id scheme as sessions.json: `workspace::mode` (quick) / `projectRoot::sessionId` (project). */
  id: string;
  kind: "quick" | "project";
  mode: string;
  displayName: string;
  /** quick: the workspace dir; project: the project root (the user-facing root). */
  workspace: string;
  /** project sessions only */
  projectRoot?: string;
  /** project sessions only — the per-session directory name */
  sessionId?: string;
  sessionDir: string;
  backendType: string;
  /** Browser URL to (re)open / focus this session. */
  url: string;
  pid: number;
  /** ms epoch when this process registered. */
  startedAt: number;
}

function fileFor(id: string): string {
  return join(RUNNING_DIR, encodeURIComponent(id) + ".json");
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but we can't signal it (different user) — alive.
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/** Register (or refresh) this process's running entry. Best-effort — never throws. */
export function recordRunning(entry: RunningSession): void {
  try {
    mkdirSync(RUNNING_DIR, { recursive: true });
    writeFileSync(fileFor(entry.id), JSON.stringify(entry, null, 2));
  } catch {
    /* non-fatal */
  }
}

/** Remove this process's running entry. Best-effort; safe to call repeatedly. */
export function removeRunning(id: string): void {
  try {
    rmSync(fileFor(id), { force: true });
  } catch {
    /* non-fatal */
  }
}

/**
 * Read all live running sessions, pruning stale entries (dead PID, unparseable,
 * or workspace gone) as a side effect. Most-recent first.
 */
export function readRunning(): RunningSession[] {
  let names: string[];
  try {
    names = readdirSync(RUNNING_DIR);
  } catch {
    return [];
  }
  const out: RunningSession[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(RUNNING_DIR, name);
    let entry: RunningSession | null = null;
    try {
      entry = JSON.parse(readFileSync(path, "utf-8")) as RunningSession;
    } catch {
      try { rmSync(path, { force: true }); } catch { /* ignore */ }
      continue;
    }
    if (
      !entry ||
      typeof entry.pid !== "number" ||
      !pidAlive(entry.pid) ||
      typeof entry.workspace !== "string" ||
      !existsSync(entry.workspace)
    ) {
      try { rmSync(path, { force: true }); } catch { /* ignore */ }
      continue;
    }
    out.push(entry);
  }
  out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return out;
}
