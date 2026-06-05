/**
 * Snapshot feature type definitions.
 */

export interface SnapshotMetadata {
  mode: string;
  version: string;
  createdAt: string;
  workspace: string;
  includeSkills?: boolean;
}

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  /**
   * Base URL of the hosted player site (CF Pages). When set, sharing a session
   * returns a `${playerBaseUrl}/s/<id>` link. When absent, sharing falls back
   * to the raw history-package URL (local-client only).
   */
  playerBaseUrl?: string;
}

export interface ModeRegistryEntry {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  publishedAt: string;
  archiveUrl: string;
}

export interface ModeRegistryIndex {
  version: number;
  updatedAt: string;
  modes: ModeRegistryEntry[];
}
