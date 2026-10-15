import type { CollaborationReference, CollaborationReferenceSource } from "../../core/types/collaboration-reference.js";
import type { CollaborationAnchor, CollaborationRoomState } from "../../core/types/collaboration.js";
import type { ViewerAddress } from "../../core/types/viewer-contract.js";

export function referenceLocation(address: ViewerAddress): string {
  const page = typeof address.page === "string" && address.page ? address.page : "Published entry";
  const query = typeof address.query === "string" && address.query ? (address.query.startsWith("?") ? address.query : `?${address.query}`) : "";
  const hash = typeof address.hash === "string" && address.hash ? (address.hash.startsWith("#") ? address.hash : `#${address.hash}`) : "";
  const selector = typeof address.selector === "string" && address.selector ? ` · ${address.selector}` : "";
  return `${page}${query}${hash}${selector}`;
}

export function selectedReferenceSource(reference: CollaborationReference, anchor: CollaborationAnchor): CollaborationReferenceSource {
  if (anchor.revision !== reference.source.publicationRevision) throw new Error("Select a location in this reference's pinned revision before saving.");
  return { ...reference.source, address: structuredClone(anchor.address) };
}

export function currentReferenceSource(projectId: string, state: CollaborationRoomState): CollaborationReferenceSource {
  const publication = state.publication;
  if (!state.room.workspaceId || !publication?.projection || publication.revision !== state.room.revision) throw new Error("This room does not have a complete published entry to pin.");
  return { projectId, workspaceId: state.room.workspaceId, roomId: state.room.id,
    publicationRevision: publication.revision, address: structuredClone(publication.projection.entryAddress) };
}

/** Identity only: resource grants, credentials and copied bytes never enter Agent context. */
export function referenceAgentDraft(reference: CollaborationReference): string {
  const source = reference.source;
  return `Shared reference (this reference contains identity only):\n${JSON.stringify({
    referenceId: reference.id, label: reference.label,
    source: { projectId: source.projectId, workspaceId: source.workspaceId, roomId: source.roomId,
      publicationRevision: source.publicationRevision, address: source.address },
  }, null, 2)}\n\nThis address belongs to the shared publication, not the current local viewer. Do not substitute a local capture for the pinned revision.\n\nUse this reference as context. Ask me to import a local copy if you need its source files.`;
}
