/**
 * Which surface a page URL opens. The main entry renders from this, and the launcher
 * skeleton's boot script (`snapshot/launcher-skeleton.ts`) repeats the
 * `opensLauncher` decision in plain JavaScript before any bundle has loaded;
 * `snapshot/__tests__/launcher-skeleton.test.ts` keeps the two in step.
 */
export function readEntryParams(search: string) {
  const params = new URLSearchParams(search);
  // Launcher if explicitly requested OR no session/mode params (bare URL).
  const isLauncher = params.has("launcher") || (!params.has("session") && !params.has("mode"));
  const projectParam = params.get("project");
  // Empty shell — `?project=<root>` with no session/mode. Tied directly to URL
  // params (not `isLauncher`) so a manual `?launcher=1` can't drag a project
  // session URL into empty shell.
  const isEmptyShell = params.has("project") && !params.has("session") && !params.has("mode");
  return {
    isLauncher, projectParam, isEmptyShell,
    opensLauncher: isLauncher && !(isEmptyShell && !!projectParam),
    isChatWindow: params.get("surface") === "chat",
  };
}
