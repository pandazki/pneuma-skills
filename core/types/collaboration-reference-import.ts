import type { CollaborationReferenceSource } from "./collaboration-reference.js";
import type { CollaborationPublishedFile } from "./collaboration-publication.js";

/** Explicitly copies the authorized pinned revision into this private Session workspace. */
export interface ImportCollaborationReference { requestId: string }

/** A completed copy is independent of subsequent reference/source revocation or refresh. */
export interface CollaborationReferenceImportReceipt {
  kind: "local-copy";
  requestId: string;
  referenceId: string;
  destinationWorkspaceId: string;
  publicationRevision: number;
  label: string;
  source: CollaborationReferenceSource;
  /** Workspace-relative directory; never a caller-selected filesystem path. */
  path: string;
  /** Workspace-relative copied files, plus the attribution file. */
  paths: string[];
  attributionPath: string;
  files: CollaborationPublishedFile[];
  importedAt: number;
}
