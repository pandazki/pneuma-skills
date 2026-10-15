/**
 * Experimental project collaboration protocol. Public state never contains
 * agent sessions, prompts, permissions, credentials, or local filesystem paths.
 * Roles are enforced by the host for every request, including existing sockets.
 */
import type { CollaborationWorkspace } from "./collaboration-workspace.js";
import type { CollaborationPublishedFile, CollaborationPublicationProjection, CollaborationViewerCompatibility } from "./collaboration-publication.js";
import type { CollaborationJsonObject, ViewerViewState } from "./viewer-collaboration.js";
import type { ViewerAddress } from "./viewer-contract.js";

export type CollaborationRole = "reader" | "writer" | "admin";

export interface CollaborationMember {
  id: string;
  name: string;
  role: CollaborationRole;
}

export interface CollaborationIdentity extends CollaborationMember {
  kind: "member" | "guest";
  /** Guests can access exactly this room, never the project directory. */
  roomId?: string;
  /** Explicit invitation capability. Omitted remains strictly view-only. */
  guestAccess?: "view" | "comment";
}

export interface CollaborationRoom {
  id: string;
  title: string;
  mode: string;
  ownerId: string;
  /** Stable logical workspace/instance binding, independent of runtime placement. */
  workspaceId?: string;
  modeInstanceId?: string;
  compatibility?: CollaborationViewerCompatibility;
  /** Earlier revisions remain stored, but their retired viewer is unavailable. */
  viewerRevisionStart?: number;
  enabled: boolean;
  revision: number;
  page: string;
  updatedAt: number;
  /** Cloud access requires both the publisher and a joined, live owner view. */
  hostOnline?: boolean;
}

export interface CollaborationProjectState {
  project: { id: string; name: string };
  self: CollaborationIdentity;
  members: CollaborationMember[];
  workspaces?: CollaborationWorkspace[];
  rooms: CollaborationRoom[];
  /** Invitation links use the cloud origin even from the local host window. */
  publicOrigin?: string;
  authorityKind?: "lan" | "cloud";
  /** Entry points into the same Project authority. */
  access?: { lanOrigin?: string; publicOrigin?: string | null };
  capabilities?: { editSource: boolean };
}

/** Coordinates are in the page's CSS pixels, not the outer browser window. */
export interface CollaborationView {
  page: string;
  revision: number;
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  documentWidth: number;
  documentHeight: number;
}

export interface CollaborationPresence {
  /** One id per connection/view, even when a member opens multiple tabs. */
  id: string;
  memberId: string;
  name: string;
  role: CollaborationRole;
  roomId: string;
  color: string;
  view: CollaborationView | null;
  revision?: number;
  sequence?: number;
  semanticView?: ViewerViewState;
  semanticPointer?: CollaborationJsonObject | null;
  cursor: { x: number; y: number } | null;
  followingId: string | null;
  updatedAt: number;
}

/** Display context captured when pinning; the address alone controls navigation. */
export interface CollaborationCommentPreview {
  label?: string;
  file?: string;
  type?: string;
  content?: string;
  /** Bounded image data URL, rendered only through an img element. */
  thumbnail?: string;
}

export interface CollaborationAnchor {
  address: ViewerAddress;
  revision: number;
  x: number;
  y: number;
  quote?: string;
  preview?: CollaborationCommentPreview;
}

export interface CollaborationCommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface CollaborationComment {
  id: string;
  roomId: string;
  anchor: CollaborationAnchor;
  status: "open" | "resolved";
  messages: CollaborationCommentMessage[];
  resolvedBy: string | null;
  updatedAt: number;
}

export interface CollaborationChatMessage extends CollaborationCommentMessage {
  roomId: string;
}

export interface CollaborationRoomState {
  room: CollaborationRoom;
  participants: CollaborationPresence[];
  comments: CollaborationComment[];
  messages: CollaborationChatMessage[];
  /** Read-only, room-scoped asset grant. Never contains a member credential. */
  pageUrl: string;
  publication?: { revision: number; files: CollaborationPublishedFile[]; projection?: CollaborationPublicationProjection };
}

export type CollaborationClientMessage =
  | { type: "join"; roomId: string }
  | { type: "leave" }
  | { type: "ping"; sentAt: number }
  | {
      type: "presence";
      view: CollaborationView | null;
      revision?: number;
      semanticView?: ViewerViewState;
      semanticPointer?: CollaborationJsonObject | null;
      cursor: { x: number; y: number } | null;
      followingId: string | null;
      /** Echoed for transport measurements; never used for authorization. */
      sentAt: number;
    };

export type CollaborationServerMessage =
  | { type: "welcome"; connectionId: string; state: CollaborationProjectState }
  | { type: "project"; state: CollaborationProjectState }
  | { type: "room"; state: CollaborationRoomState }
  | { type: "presence"; participant: CollaborationPresence; sentAt: number }
  | { type: "departed"; connectionId: string }
  | { type: "content"; room: CollaborationRoom; pageUrl: string; publication?: CollaborationRoomState["publication"] }
  | { type: "comments"; comments: CollaborationComment[] }
  | { type: "chat"; message: CollaborationChatMessage }
  | { type: "pong"; sentAt: number; serverAt: number }
  | { type: "closed"; reason: string; code?: "host_offline" }
  | { type: "error"; message: string };

export interface CollaborationInvite {
  member: CollaborationMember;
  token: string;
}

export interface CollaborationGuestLink {
  token: string;
  expiresAt: number;
  roomId: string;
  access?: "view" | "comment";
}

/** Source edits and project management never belong to a guest invitation. */
export function canWriteCollaboration(identity: CollaborationIdentity): boolean {
  return identity.kind === "member" && (identity.role === "writer" || identity.role === "admin");
}

/** Discussion-only invitations do not turn project readers into writers. */
export function canDiscussCollaboration(identity: CollaborationIdentity): boolean {
  return canWriteCollaboration(identity)
    || (identity.kind === "guest" && identity.guestAccess === "comment" && !!identity.roomId);
}

export function canManageCollaborationRoom(identity: CollaborationIdentity, room: CollaborationRoom): boolean {
  return canWriteCollaboration(identity) && (identity.role === "admin" || identity.id === room.ownerId);
}

/** Only the designated owner can keep a cloud room open for participants. */
export function isCollaborationHost(identity: CollaborationIdentity, room: CollaborationRoom): boolean {
  return canWriteCollaboration(identity) && identity.id === room.ownerId;
}

/**
 * Prototype HTTP API (Authorization: Bearer <member or guest token>):
 * GET /api/state -> CollaborationProjectState
 * GET /api/rooms/:id -> CollaborationRoomState
 * PATCH /api/rooms/:id { enabled } -> CollaborationRoom
 * DELETE /api/rooms/:id -> { ok: true } (admin; removes sharing registration,
 *   never recursively deletes source files)
 * GET /api/rooms/:id/content -> { html, revision } (writers/admin only)
 * PUT /api/rooms/:id/content { opId, baseRevision, html } -> { revision }
 * POST /api/rooms/:id/comments { opId, anchor, body } -> CollaborationComment
 * PATCH /api/rooms/:id/comments/:cid { opId, status?, body? } -> CollaborationComment
 * POST /api/rooms/:id/chat { opId, body } -> CollaborationChatMessage
 * POST /api/rooms/:id/links { expiresInSeconds, access? } -> CollaborationGuestLink
 * DELETE /api/rooms/:id/links -> { ok: true } (revoke all room guest links)
 * POST /api/members { name, role } -> CollaborationInvite (admin)
 * PATCH /api/members/:id { role } -> CollaborationMember (admin)
 * DELETE /api/members/:id -> { ok: true } (admin; protect last administrator)
 * WS /ws?token=<credential>; message types above. Reconnect obtains a fresh
 *   authorized snapshot; presence is ephemeral and is never written to disk.
 * Frame resources use a separate read-only grant and deny all private routes.
 * Cloud invitation tokens redeem through POST /api/invitations/redeem
 * { token, name } -> { token, roomId }; the returned token identifies one guest.
 * Only an explicitly discussion-enabled invitation allows guest comments/chat.
 * Pure readers and view-only invitations remain unable to mutate anything.
 * Cloud guests and non-owner members require a live host. HTTP 423 and a
 * closed/host_offline frame end access; clients clear shared content and wait
 * for an explicit rejoin. Stored publications and discussions are retained.
 */

/** A durable sharing tombstone; local workspaces and Agent state are retained. */
export interface CollaborationProjectRemovalReceipt {
  ok: true;
  removed: true;
  projectId: string;
  removedAt: number;
}
