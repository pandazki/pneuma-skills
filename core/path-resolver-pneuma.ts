/**
 * Session Path Resolver (Pneuma 3.0 Projects)
 *
 * Single source of truth for path policy: given inputs (workspace OR projectRoot+sessionId),
 * returns a SessionPaths record with all canonical paths downstream code uses.
 *
 * Two session shapes:
 * - Quick session (2.x preserved): state at workspace/.pneuma/, agent CWD = workspace
 * - Project session (new): state flat at projectRoot/.pneuma/sessions/{id}/, agent CWD = same
 *
 * No I/O, no fs access — purely path string composition.
 */

import { join } from "node:path";

export type SessionPathKind = "quick" | "project";

export interface QuickSessionInput {
  kind: "quick";
  workspace: string;
}

export interface ProjectSessionInput {
  kind: "project";
  projectRoot: string;
  sessionId: string;
}

export type SessionPathInput = QuickSessionInput | ProjectSessionInput;

export interface SessionPaths {
  /** Session kind: quick or project */
  kind: SessionPathKind;
  /** Agent working directory (same as homeRoot) */
  sessionDir: string;
  /** State directory (pneuma metadata lives here) */
  stateDir: string;
  /** Root directory for agent workspace (workspace or projectRoot) */
  homeRoot: string;
  /** Project root if project session, null if quick session */
  projectRoot: string | null;
  /** Shared preferences directory at projectRoot/.pneuma/preferences; null for quick */
  projectPreferencesDir: string | null;
  /** Shared handoffs directory at projectRoot/.pneuma/handoffs; null for quick */
  projectHandoffsDir: string | null;
  /** Project manifest path at projectRoot/.pneuma/project.json; null for quick */
  projectManifestPath: string | null;
}

/**
 * Resolve session paths from either a quick (workspace) or project (root + id) input.
 *
 * @param input — Quick or project session input
 * @returns SessionPaths record with all canonical paths
 */
export function resolveSessionPaths(input: SessionPathInput): SessionPaths {
  if (input.kind === "quick") {
    return {
      kind: "quick",
      sessionDir: input.workspace,
      stateDir: join(input.workspace, ".pneuma"),
      homeRoot: input.workspace,
      projectRoot: null,
      projectPreferencesDir: null,
      projectHandoffsDir: null,
      projectManifestPath: null,
    };
  }

  const sessionDir = join(input.projectRoot, ".pneuma", "sessions", input.sessionId);
  return {
    kind: "project",
    sessionDir,
    stateDir: sessionDir,
    homeRoot: input.projectRoot,
    projectRoot: input.projectRoot,
    projectPreferencesDir: join(input.projectRoot, ".pneuma", "preferences"),
    projectHandoffsDir: join(input.projectRoot, ".pneuma", "handoffs"),
    projectManifestPath: join(input.projectRoot, ".pneuma", "project.json"),
  };
}
