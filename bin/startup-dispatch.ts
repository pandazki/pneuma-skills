/**
 * Startup Dispatch (Pneuma 3.0 Projects)
 *
 * Decides whether a launch is a "quick" session (legacy 2.x: workspace-rooted
 * `.pneuma/`) or a "project" session (new: nested `.pneuma/sessions/{id}/`),
 * and resolves the canonical SessionPaths for downstream code.
 *
 * Inputs come from the CLI: workspace, optional --project root, optional
 * --session-id override. Output is a single StartupContext that hides the
 * branching behind one record.
 */

import { randomUUID } from "node:crypto";
import { detectWorkspaceKind } from "../core/project-loader.js";
import {
  resolveSessionPaths,
  type SessionPaths,
} from "../core/path-resolver-pneuma.js";

export interface StartupInput {
  mode: string;
  workspace: string;
  /** From --project flag; empty string means "auto-detect via workspace". */
  project: string;
  /** From --session-id flag; empty string means "generate new uuid". */
  sessionIdOverride: string;
}

export interface StartupContext {
  kind: "quick" | "project";
  sessionId: string;
  paths: SessionPaths;
}

export async function resolveStartupContext(
  input: StartupInput
): Promise<StartupContext> {
  let projectRoot: string | null = null;
  if (input.project) {
    projectRoot = input.project;
  } else {
    const kind = await detectWorkspaceKind(input.workspace);
    if (kind === "project") projectRoot = input.workspace;
  }

  if (projectRoot) {
    const sessionId = input.sessionIdOverride || randomUUID();
    return {
      kind: "project",
      sessionId,
      paths: resolveSessionPaths({
        kind: "project",
        projectRoot,
        sessionId,
      }),
    };
  }

  const sessionId = input.sessionIdOverride || randomUUID();
  return {
    kind: "quick",
    sessionId,
    paths: resolveSessionPaths({ kind: "quick", workspace: input.workspace }),
  };
}
