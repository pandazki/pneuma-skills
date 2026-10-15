import type { CollaborationInternetAccessState } from "./collaboration-access.js";
import type { CollaborationAuthority } from "./collaboration-workspace.js";

/** Private Session response. Never returned by the public collaboration authority. */
export interface SessionCollaborationStatus {
  projectAvailable: boolean;
  supported: boolean;
  connection?: {
    projectId: string;
    workspaceId: string;
    ownerId: string;
    authorityBaseUrl: string;
    token: string;
    authorityKind: "lan" | "cloud";
    /** Opaque, non-secret private identity for pending reference operation recovery. */
    referenceOperationAuthority?: string;
  };
  /** Public access controls are available only to this machine's owning administrator. */
  internetAccess?: CollaborationInternetAccessState;
  canManageInternetAccess?: boolean;
  /** Current entry URLs share the same authority and permission credentials. */
  entries?: { kind: "lan" | "public" | "cloud"; baseUrl: string }[];
  roomId?: string;
  /** The explicit public content-set scope of the running instance. */
  sharedContentSet?: string | null;
  sharing: boolean;
  publisherStatus: string;
  error?: string;
  /** Shared access was removed; the private placement remains intact. */
  projectRemoved?: boolean;
}

export interface CreateSessionCollaboration {
  /** Self-reported member label for this provisioned local identity. */
  name: string;
  authority?: CollaborationAuthority;
  /** Self-hosted cloud provisioning credential, used only by the local runtime. */
  bootstrapKey?: string;
}

export interface ShareSessionCollaboration {
  title: string;
  contentSet: string | null;
  activeFile: string | null;
}

/** Public metadata identifying the exact mode build accepted by the hosted shell. */
export interface CollaborationViewerAsset {
  mode: string;
  coreVersion: string;
  modeVersion: string;
  viewerHash: string;
  publicationSchema: string;
  entry: string;
  styles: string[];
  /** Mode-owned opaque-page runtime, served as an immutable public asset. */
  frameScriptUrl?: string;
}

export interface CollaborationViewerCatalog {
  coreVersion: string;
  modes: CollaborationViewerAsset[];
}
