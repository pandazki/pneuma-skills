/**
 * On-disk schema for `<projectRoot>/.pneuma/project.json`.
 *
 * `version` enables forward-compatible migrations.
 * A project is a user directory containing multiple sessions (possibly different modes)
 * and shared preferences/handoffs. ProjectManifest marks the root with metadata.
 */

/**
 * ProjectManifest — on-disk representation of a project
 *
 * Persisted at `<projectRoot>/.pneuma/project.json`.
 * Required fields: `version`, `name`, `displayName`, `createdAt`.
 * Optional: `description`, `founderSessionId`.
 */
export interface ProjectManifest {
  /** Schema version for forward-compatible migrations */
  version: 1;
  /** Unique identifier for the project (slug-like, used in paths/URIs) */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Optional project description */
  description?: string;
  /** Timestamp (ms) when project was created */
  createdAt: number;
  /** Optional: ID of the session that created this project */
  founderSessionId?: string;
}

/**
 * ProjectSummary — in-memory summary for UI listing and quick access
 *
 * Augments ProjectManifest with runtime metadata (root path, access time, session count).
 * Used by launcher "Recent Projects" and project picker.
 */
export interface ProjectSummary {
  /** Absolute path to project root directory */
  root: string;
  /** Unique identifier (from manifest) */
  name: string;
  /** Human-readable display name (from manifest) */
  displayName: string;
  /** Optional description (from manifest) */
  description?: string;
  /** Creation timestamp (ms) — from manifest if available */
  createdAt?: number;
  /** Last access time (ms) — updated on every session activity */
  lastAccessed: number;
  /** Number of sessions in this project */
  sessionCount: number;
}

/**
 * Runtime guard: validate an unknown value against ProjectManifest schema
 *
 * Checks required fields and their types. Optional fields are tolerated.
 *
 * @param value — value to validate
 * @returns true if value conforms to ProjectManifest, false otherwise
 */
export function isProjectManifest(value: unknown): value is ProjectManifest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.name === "string" &&
    typeof v.displayName === "string" &&
    typeof v.createdAt === "number"
  );
}
