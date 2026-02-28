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
}
