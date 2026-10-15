import type { ViewerAddress } from "./viewer-contract.js";
import type { CollaborationViewerCompatibility } from "./collaboration-publication.js";
import type { CollaborationRoomState } from "./collaboration.js";

/** A deliberate relationship, containing neither copied bytes nor an access grant. */
export interface CollaborationReferenceSource {
  projectId: string;
  workspaceId: string;
  roomId: string;
  publicationRevision: number;
  address: ViewerAddress;
}
export interface CollaborationReference {
  id: string;
  ownerId: string;
  destinationWorkspaceId: string;
  label: string;
  source: CollaborationReferenceSource;
  /** Captured viewer compatibility belongs to the pinned revision. */
  compatibility: CollaborationViewerCompatibility;
  createdAt: number;
  updatedAt: number;
}
export interface CollaborationResolvedReference {
  reference: CollaborationReference;
  compatibility: CollaborationViewerCompatibility;
  room: CollaborationRoomState["room"];
  publication: NonNullable<CollaborationRoomState["publication"]>;
  /** Read-only pinned-revision resource grant, rechecked against current access. */
  pageUrl: string;
}
