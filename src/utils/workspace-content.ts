import { isSessionStatePath } from "../../core/session-state.js";

/** Null until Session placement is known; files alone cannot establish emptiness. */
export function countUserWorkspaceFiles(files: ReadonlyArray<{ path: string }>, stateAtWorkspaceRoot: boolean | null): number | null {
  if (stateAtWorkspaceRoot === null) return null;
  return files.filter(({ path }) => {
    if (isSessionStatePath(path, stateAtWorkspaceRoot)) return false;
    if (path === "CLAUDE.md" || path === "AGENTS.md" || path === ".gitignore") return false;
    if (path.startsWith(".claude/") || path.startsWith(".agents/") || path.startsWith(".kimi-code/")) return false;
    // Framework-managed seed bundles are resynced on boot, before the user picks a template.
    return !path.startsWith("_");
  }).length;
}
