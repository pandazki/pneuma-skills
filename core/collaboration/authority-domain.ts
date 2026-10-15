import type { CollaborationReference, CollaborationReferenceSource } from "../types/collaboration-reference.js";
import { canWriteCollaboration } from "../types/collaboration.js";
import type { CollaborationWorkspace } from "../types/collaboration-workspace.js";

import type {
  CollaborationChatMessage, CollaborationComment, CollaborationIdentity, CollaborationMember,
  CollaborationRole, CollaborationRoom, CollaborationView, CollaborationProjectRemovalReceipt,
} from "../types/collaboration.js";

import { isCollaborationJson } from "../types/viewer-collaboration.js";

import { COLLABORATION_CONTENT_LIMITS, COLLABORATION_ASSET_TYPES, isCollaborationPublicPath, type CollaborationViewerCompatibility, type CollaborationPublicationViewer, type CollaborationPublicationProjection, type CollaborationPublishedFile } from "../types/collaboration-publication.js";

export const LIMITS = {
  ...COLLABORATION_CONTENT_LIMITS,
  uploadBytes: 256 * 1024 * 1024, uploadedBlobs: 4096, metadataBytes: 8 * 1024 * 1024,
  guests: 500, invitations: 100, members: 100, connections: 128,
};
export type PublishedFile = CollaborationPublishedFile;
export interface MemberRecord extends CollaborationMember { tokenHash: string }
export interface Invitation { id: string; tokenHash: string; roomId: string; expiresAt: number; access: "view" | "comment" }
export interface Guest { id: string; name: string; tokenHash: string; invitationId: string }
export interface RoomRecord extends CollaborationRoom {
  fingerprint: string; removed?: boolean;
  publisherHash: string;
  grantEpoch: number;
  hostSessionActive: boolean;
  publicationError: string | null;
  frameScript?: string;
  frameScriptUrl?: string;
}
export interface ProjectData {
  project: { id: string; name: string };
  removal?: { actorId: string; opId: string; fingerprint: string; removedAt: number };
  bootstrapHash: string;
  grantKey: string;
  frameScript: string;
  frameScriptUrl?: string;
  rooms: RoomRecord[];
  workspaces: CollaborationWorkspace[];
  references: CollaborationReference[];
  members: MemberRecord[];
  invitations: Invitation[];
  guests: Guest[];
  comments: CollaborationComment[];
  messages: CollaborationChatMessage[];
}
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function ensure(value: unknown, status: number, message: string): asserts value {
  if (!value) throw new HttpError(status, message);
}
export class ProjectRemovedError extends HttpError {
  readonly code = "project_removed";
  constructor() { super(410, "Project was removed"); }
}
export function requireActiveProject(state: ProjectData): void {
  if (state.removal) throw new ProjectRemovedError();
}
export function projectRemovalReceipt(state: ProjectData): CollaborationProjectRemovalReceipt {
  return { ok: true, removed: true, projectId: state.project.id, removedAt: state.removal!.removedAt };
}
/** Only the original administrator and input can replay an accepted removal. */
export function replayProjectRemoval(state: ProjectData, actor: CollaborationIdentity | null, body: Record<string, unknown>) {
  if (!state.removal) return undefined;
  if (actor?.kind !== "member" || actor.role !== "admin" || actor.id !== state.removal.actorId
    || body.opId !== state.removal.opId || canonical(body) !== state.removal.fingerprint) throw new ProjectRemovedError();
  return projectRemovalReceipt(state);
}
export function removeProject(state: ProjectData, actor: CollaborationIdentity, body: Record<string, unknown>) {
  requireActiveProject(state);
  ensure(actor.kind === "member" && actor.role === "admin", 403, "Administrator membership required");
  state.removal = { actorId: actor.id, opId: short(body.opId, 100, "operation id"), fingerprint: canonical(body), removedAt: Date.now() };
  for (const room of state.rooms) { room.enabled = false; room.hostSessionActive = false; room.grantEpoch++; }
  return projectRemovalReceipt(state);
}

export function short(value: unknown, length: number, field: string): string {
  ensure(typeof value === "string" && value.trim().length > 0 && value.length <= length, 400, `Invalid ${field}`);
  return value;
}
export function finite(value: unknown, max = 10_000_000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}
export function validRole(value: unknown): CollaborationRole {
  ensure(value === "reader" || value === "writer" || value === "admin", 400, "Invalid role");
  return value;
}
export const publicPath = isCollaborationPublicPath;
export function mime(path: string): string | undefined { return COLLABORATION_ASSET_TYPES["." + path.split(".").at(-1)!.toLowerCase()]; }
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function publicMember(value: CollaborationMember): CollaborationMember {
  return { id: value.id, name: value.name, role: value.role };
}
export function resolveIdentity(state: ProjectData, credential: string, now = Date.now()): CollaborationIdentity | null {
  const member = state.members.find((m) => m.tokenHash === credential);
  if (member) return { ...publicMember(member), kind: "member" };
  const guest = state.guests.find((g) => g.tokenHash === credential);
  if (!guest) return null;
  const invite = state.invitations.find((i) => i.id === guest.invitationId && i.expiresAt > now);
  if (!invite || !state.rooms.some((room) => room.id === invite.roomId && room.enabled && !room.removed)) return null;
  return { id: guest.id, name: guest.name, role: "reader", kind: "guest", roomId: invite.roomId, guestAccess: invite.access };
}
export function validateFiles(value: unknown, page: string): PublishedFile[] {
  ensure(Array.isArray(value) && value.length > 0 && value.length <= LIMITS.files, 400, "Invalid file manifest");
  let total = 0;
  const seen = new Set<string>();
  const files = value.map((raw) => {
    ensure(raw && typeof raw === "object", 400, "Invalid file manifest entry");
    const file = raw as PublishedFile;
    ensure(typeof file.path === "string" && publicPath(file.path) && !seen.has(file.path), 400, "Private, duplicate or invalid file path");
    seen.add(file.path);
    ensure(typeof file.hash === "string" && /^[a-f0-9]{64}$/.test(file.hash), 400, "Invalid file hash");
    ensure(Number.isInteger(file.size) && finite(file.size, LIMITS.fileBytes), 400, "File exceeds publication size limit");
    ensure(mime(file.path) && file.type === mime(file.path), 400, "File MIME type does not match its path");
    total += file.size;
    return { path: file.path, hash: file.hash, size: file.size, type: file.type };
  });
  ensure(total <= LIMITS.roomBytes && seen.has(page), 400, "Manifest is too large or lacks the declared entry page");
  return files;
}
export function validateView(value: unknown, room: CollaborationRoom): CollaborationView {
  const view = value as CollaborationView;
  ensure(view && typeof view === "object" && view.page === room.page
    && Number.isInteger(view.revision) && view.revision > 0 && view.revision <= room.revision, 400, "Invalid viewer state");
  for (const n of [view.scrollX, view.scrollY, view.width, view.height, view.documentWidth, view.documentHeight]) ensure(finite(n), 400, "Invalid viewport dimensions");
  return { page: view.page, revision: view.revision, scrollX: view.scrollX, scrollY: view.scrollY,
    width: view.width, height: view.height, documentWidth: view.documentWidth, documentHeight: view.documentHeight };
}

export const COLLABORATION_OWNER_LEASE_MS = 15_000;
export const COLLABORATION_PUBLISHER_LEASE_MS = 45_000;
export const COLLABORATION_HOST_OFFLINE = "The host is offline. Rejoin when the host is online.";

export function validateViewerCompatibility(value: unknown): CollaborationViewerCompatibility {
  const compatibility = value as Record<string, unknown>;
  ensure(compatibility && typeof compatibility === "object" && !Array.isArray(compatibility), 400, "Viewer compatibility is required");
  const fields = { coreVersion: short(compatibility.coreVersion, 100, "core version"),
    modeVersion: short(compatibility.modeVersion, 100, "mode version"),
    viewerHash: short(compatibility.viewerHash, 200, "viewer hash"),
    publicationSchema: short(compatibility.publicationSchema, 100, "publication schema") };
  ensure(/^[a-f0-9]{64}$/.test(fields.viewerHash), 400, "Viewer hash must identify a built artifact");
  return fields;
}

/** Registration binds logical ownership; a runtime endpoint never owns a room. */
export function validateRegistration(value: Record<string, unknown>, ownerId: string): Omit<RoomRecord, "publisherHash"> {
  const fields = validateViewerCompatibility(value.compatibility);
  ensure(value.enabled === undefined || typeof value.enabled === "boolean", 400, "Room sharing flag must be boolean");
  const page = short(value.page, 500, "entry page");
  ensure(publicPath(page), 400, "Room requires a public entry resource");
  ensure(typeof value.workspaceId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value.workspaceId)
    && typeof value.modeInstanceId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value.modeInstanceId), 400, "Invalid workspace or mode instance id");
  return { id: crypto.randomUUID(), ownerId,
    workspaceId: short(value.workspaceId, 100, "workspace id"),
    modeInstanceId: short(value.modeInstanceId, 100, "mode instance id"),
    mode: short(value.mode, 80, "mode"), title: short(value.title, 160, "room title"), page,
    compatibility: fields, enabled: value.enabled === undefined ? true : value.enabled === true,
    revision: 0, updatedAt: Date.now(), fingerprint: "", grantEpoch: 0,
    hostSessionActive: false, publicationError: null };
}

export function publicRoomRecord(room: RoomRecord, hostOnline: boolean): CollaborationRoom {
  return { id: room.id, title: room.title, mode: room.mode, ownerId: room.ownerId,
    enabled: room.enabled, revision: room.revision, page: room.page, updatedAt: room.updatedAt, hostOnline,
    ...(room.workspaceId ? { workspaceId: room.workspaceId } : {}),
    ...(room.modeInstanceId ? { modeInstanceId: room.modeInstanceId } : {}),
    ...(room.compatibility ? { compatibility: { ...room.compatibility } } : {}),
    ...(room.viewerRevisionStart ? { viewerRevisionStart: room.viewerRevisionStart } : {}) };
}

/** A viewer change is accepted only alongside a complete publication, never by relabeling a room. */
export function validatePublicationViewer(value: unknown, room: RoomRecord): CollaborationPublicationViewer | undefined {
  if (value === undefined) {
    ensure(!room.viewerRevisionStart, 409, "This room requires a current packaged viewer. Update and reopen its publishing Session.");
    return undefined;
  }
  ensure(value && typeof value === "object" && !Array.isArray(value), 400, "Invalid publication viewer");
  const body = value as Record<string, unknown>;
  const compatibility = validateViewerCompatibility(body.compatibility);
  ensure(body.frameScript === undefined || typeof body.frameScript === "string" && new TextEncoder().encode(body.frameScript).length <= 256 * 1024, 400, "Invalid frame instrumentation");
  return { compatibility,
    ...(typeof body.frameScript === "string" ? { frameScript: body.frameScript } : {}),
    ...(body.frameScriptUrl !== undefined ? { frameScriptUrl: validateFrameScriptUrl(body.frameScriptUrl) } : {}) };
}
/** Authorities accept only a viewer actually present in their installed public catalog. */
export function requirePackagedPublicationViewer(viewer: CollaborationPublicationViewer, mode: string, catalog: unknown): void {
  const built = catalog as { coreVersion?: string; modes?: Array<{ mode: string; frameScriptUrl?: string } & CollaborationPublicationViewer["compatibility"]> } | null;
  ensure(built && Array.isArray(built.modes) && built.coreVersion === viewer.compatibility.coreVersion
    && built.modes.some((asset) => asset.mode === mode && asset.frameScriptUrl === viewer.frameScriptUrl
      && canonical({ coreVersion: asset.coreVersion, modeVersion: asset.modeVersion, viewerHash: asset.viewerHash, publicationSchema: asset.publicationSchema }) === canonical(viewer.compatibility)),
  409, "Publication requires the current packaged viewer. Update and reopen the publishing Session and authority together.");
}
export function registeredPublicationViewer(room: RoomRecord): CollaborationPublicationViewer | undefined {
  return room.compatibility ? { compatibility: room.compatibility,
    ...(room.frameScript !== undefined ? { frameScript: room.frameScript } : {}),
    ...(room.frameScriptUrl !== undefined ? { frameScriptUrl: room.frameScriptUrl } : {}) } : undefined;
}
export function publicationViewerChanged(room: RoomRecord, viewer: CollaborationPublicationViewer | undefined): boolean {
  return !!viewer && canonical(registeredPublicationViewer(room)) !== canonical(viewer);
}
export function applyPublicationViewer(room: RoomRecord, viewer: CollaborationPublicationViewer | undefined): void {
  if (!viewer) return;
  if (publicationViewerChanged(room, viewer)) {
    room.viewerRevisionStart = room.revision;
    room.grantEpoch++;
  }
  room.compatibility = viewer.compatibility;
  room.frameScript = viewer.frameScript;
  room.frameScriptUrl = viewer.frameScriptUrl;
}
export class PublicationViewerUnavailableError extends HttpError {
  readonly code = "publication_viewer_unavailable";
  constructor() { super(410, "This publication used a retired viewer build and is unavailable. Its history is retained; refresh the reference explicitly to use the current publication."); }
}
export function requirePublicationViewer(room: RoomRecord, revision: number): void {
  if (room.viewerRevisionStart && revision < room.viewerRevisionStart) throw new PublicationViewerUnavailableError();
}

export function validateProjection(value: unknown, room: CollaborationRoom): CollaborationPublicationProjection | undefined {
  if (value === undefined) { ensure(!room.compatibility, 400, "Formal rooms require a public Source projection"); return undefined; }
  ensure(isCollaborationJson(value, LIMITS.projectionBytes ?? 4 * 1024 * 1024) && value && typeof value === "object" && !Array.isArray(value), 400, "Invalid or unbounded public Source projection");
  const projection = value as unknown as CollaborationPublicationProjection;
  ensure(typeof projection.schema === "string" && projection.schema.length > 0 && projection.schema.length <= 100
    && (!room.compatibility || projection.schema === room.compatibility.publicationSchema), 400, "Publication schema does not match the registered viewer");
  ensure(projection.sources && typeof projection.sources === "object" && !Array.isArray(projection.sources)
    && Object.keys(projection.sources).length <= 32, 400, "Invalid public Source values");
  ensure(projection.entryAddress && typeof projection.entryAddress === "object" && !Array.isArray(projection.entryAddress), 400, "Publication entry address required");
  if (projection.initParams !== undefined) ensure(projection.initParams && typeof projection.initParams === "object" && !Array.isArray(projection.initParams)
    && Object.entries(projection.initParams).length <= 100 && Object.values(projection.initParams).every((value) => typeof value === "string" || typeof value === "number"), 400, "Invalid public init parameters");
  return { schema: projection.schema, sources: projection.sources, entryAddress: projection.entryAddress,
    ...(projection.initParams ? { initParams: projection.initParams } : {}) };
}

/** Deadline checks use receipt time; late packets cannot revive expired leases. */
export function collaborationLeaseDeadline(lastSeen: unknown, kind: "owner" | "publisher"): number {
  const timestamp = finite(lastSeen, Number.MAX_SAFE_INTEGER) ? lastSeen : 0;
  return timestamp + (kind === "owner" ? COLLABORATION_OWNER_LEASE_MS : COLLABORATION_PUBLISHER_LEASE_MS);
}
export function collaborationLeaseIsLive(lastSeen: unknown, kind: "owner" | "publisher", now = Date.now()): boolean {
  return collaborationLeaseDeadline(lastSeen, kind) > now;
}

export function validateFrameScriptUrl(value: unknown): string {
  ensure(typeof value === "string" && value.length <= 500 && value.startsWith("/viewer/")
    && !value.includes("?") && !value.includes("#") && publicPath(value.slice(1))
    && new URL(value, "https://public.invalid").pathname === value, 400, "Frame instrumentation must use a versioned public viewer asset");
  return value;
}

export const COLLABORATION_REFERENCE_LIMIT = 1000;
export const COLLABORATION_PINNED_REVISION_LIMIT = COLLABORATION_CONTENT_LIMITS.revisions - 1;

export function validateReferenceSource(value: unknown, projectId: string): CollaborationReferenceSource {
  ensure(isCollaborationJson(value, 8192) && value && typeof value === "object" && !Array.isArray(value), 400, "Invalid source reference");
  const source = value as unknown as CollaborationReferenceSource;
  ensure(source.projectId === projectId, 400, "References must use the selected Project authority");
  for (const [field, id] of [["workspace id", source.workspaceId], ["room id", source.roomId]] as const)
    ensure(typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id), 400, `Invalid source ${field}`);
  ensure(Number.isInteger(source.publicationRevision) && source.publicationRevision > 0, 400, "Invalid pinned publication revision");
  ensure(isCollaborationJson(source.address, 4096) && source.address && typeof source.address === "object" && !Array.isArray(source.address), 400, "Invalid reference ViewerAddress");
  return { projectId, workspaceId: source.workspaceId, roomId: source.roomId,
    publicationRevision: source.publicationRevision, address: structuredClone(source.address) };
}

export function requireReferenceDestination(state: ProjectData, actor: CollaborationIdentity, workspaceId: unknown): CollaborationWorkspace {
  ensure(canWriteCollaboration(actor), 403, "Writing membership required");
  const id = short(workspaceId, 100, "destination workspace id");
  const workspace = state.workspaces.find((workspace) => workspace.id === id);
  ensure(workspace && workspace.ownerId === actor.id, 403, "References belong to your own destination workspace");
  return workspace;
}

export function validateReferenceRoom(state: ProjectData, actor: CollaborationIdentity, source: CollaborationReferenceSource): RoomRecord {
  ensure(actor.kind === "member", 403, "Project membership required");
  const room = state.rooms.find((room) => room.id === source.roomId);
  ensure(room && !room.removed, 410, "The source room was removed or is unavailable");
  ensure(room.workspaceId === source.workspaceId && room.compatibility, 400, "Source workspace and formal room binding do not match");
  ensure(room.enabled, 403, "Source room sharing is disabled");
  ensure(source.publicationRevision <= room.revision, 410, "The pinned source publication is unavailable");
  return room;
}

export function requireReferenceQuota(references: CollaborationReference[], source: CollaborationReferenceSource, replacingId?: string): void {
  const revisions = new Set(references.filter((reference) => reference.id !== replacingId && reference.source.roomId === source.roomId)
    .map((reference) => reference.source.publicationRevision));
  revisions.add(source.publicationRevision);
  ensure(revisions.size <= COLLABORATION_PINNED_REVISION_LIMIT, 409, "Pinned revision capacity reached; unpin or refresh an existing reference first");
}

/** Retain reservations and the newest remaining revisions within one room budget. */
export function retainedCollaborationRevisions(revisions: readonly number[], references: readonly CollaborationReference[], roomId: string): Set<number> {
  const retained = new Set(references.filter((reference) => reference.source.roomId === roomId).map((reference) => reference.source.publicationRevision));
  for (const revision of [...revisions].sort((a, b) => b - a)) {
    if (retained.size >= COLLABORATION_CONTENT_LIMITS.revisions) break;
    retained.add(revision);
  }
  return retained;
}
