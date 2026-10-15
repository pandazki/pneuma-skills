/** Runtime-owned entries relative to SessionPaths.stateDir, not publication exclusions. */
export const SESSION_STATE_FILES = [
  "session.json", "history.json", "config.json", "skill-version.json",
  "skill-dismissed.json", "checkpoints.jsonl", "thumbnail.png", "viewer-state.json",
  "deploy.json", "resumed-context.xml", "app-settings.json", "inbound-handoff.json",
  "borrow-result.json", "collaboration-room.json", "collaboration-registration.json",
] as const;

export const SESSION_STATE_DIRECTORIES = [
  "shadow.git", "replay-checkout", "evolution", "captures", "onboard", "collaboration-imports",
] as const;

const files = new Set<string>(SESSION_STATE_FILES);
const directories = new Set<string>(SESSION_STATE_DIRECTORIES);

/**
 * Classify workspace-relative runtime state using the resolved Session placement.
 * Quick Session state is nested under .pneuma; Project Session state is flat at
 * the workspace root. Same-named files in user content directories stay content.
 */
export function isSessionStatePath(path: string, stateAtWorkspaceRoot: boolean): boolean {
  if (path === ".pneuma" || path.startsWith(".pneuma/")) return true;
  if (!stateAtWorkspaceRoot) return false;
  const [root, ...rest] = path.split("/");
  return directories.has(root!) || (rest.length === 0 && files.has(root!));
}
