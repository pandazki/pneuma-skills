export interface ContinueSessionLike {
  workspace: string;
  mode: string;
  layout?: "editor" | "app";
  editing?: boolean;
}

export interface ContinueProcessLike {
  pid?: number;
  specifier: string;
  workspace: string;
  projectRoot?: string;
}

export interface ContinueItem<S extends ContinueSessionLike, P extends ContinueProcessLike> {
  type: "running" | "recent";
  key: string;
  session?: S;
  process?: P;
  modeName: string;
}

export function buildContinueItems<S extends ContinueSessionLike, P extends ContinueProcessLike>(
  sessions: S[],
  running: P[],
): Array<ContinueItem<S, P>> {
  const appWorkspaces = new Set(
    sessions
      .filter((session) => session.layout === "app" && session.editing === false)
      .map((session) => session.workspace),
  );
  const independentRunning = running.filter((process) => !process.projectRoot);
  const runningWorkspaces = new Set(independentRunning.map((process) => process.workspace));

  return [
    ...independentRunning
      .filter((process) => !appWorkspaces.has(process.workspace))
      .map((process) => ({
        type: "running" as const,
        key: process.pid ? `running:${process.pid}` : `running:${process.workspace}:${process.specifier}`,
        process,
        session: sessions.find((session) => session.workspace === process.workspace),
        modeName: process.specifier.split("/").pop() || process.specifier,
      })),
    ...sessions
      .filter((session) => !runningWorkspaces.has(session.workspace) && !appWorkspaces.has(session.workspace))
      .map((session) => ({
        type: "recent" as const,
        key: session.workspace,
        session,
        process: undefined,
        modeName: session.mode,
      })),
  ];
}
