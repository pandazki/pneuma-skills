import { validateCommentPreview } from "../../../core/collaboration/comment-preview.js";
import type { CollaborationReference, CollaborationReferenceSource, CollaborationResolvedReference } from "../../../core/types/collaboration-reference.js";
import { COLLABORATION_RESOURCE_CSP } from "../../../core/types/collaboration-publication.js";
import { isViewerViewState, isCollaborationJson } from "../../../core/types/viewer-collaboration.js";
import { DurableObject } from "cloudflare:workers";
import {
  canDiscussCollaboration, canManageCollaborationRoom, canWriteCollaboration, isCollaborationHost,
  type CollaborationAnchor, type CollaborationComment, type CollaborationIdentity,
  type CollaborationPresence, type CollaborationProjectState, type CollaborationRoom,
  type CollaborationRoomState, type CollaborationServerMessage,
} from "../../../core/types/collaboration.js";
import {
  LIMITS, HttpError, canonical, ensure, finite, mime, publicMember, publicPath,
  ProjectRemovedError, requireActiveProject, replayProjectRemoval, removeProject, resolveIdentity, sha256, short, validRole, validateFiles, validateView, validateRegistration, publicRoomRecord, validateProjection, collaborationLeaseDeadline, validateFrameScriptUrl, validateReferenceSource, requireReferenceDestination, validateReferenceRoom, requireReferenceQuota, retainedCollaborationRevisions, COLLABORATION_REFERENCE_LIMIT,
  COLLABORATION_HOST_OFFLINE,
  type ProjectData, type PublishedFile, type RoomRecord,
} from "./domain.js";

type Body = Record<string, unknown>;
interface SocketData {
  kind: "participant" | "publisher";
  id: string;
  credential: string;
  origin: string;
  roomId: string | null;
  presence: CollaborationPresence | null;
  closed: boolean;
  windowAt: number;
  count: number;
  lastRelayed: number;
  /** Server receipt time, preserved through hibernation; never client supplied. */
  lastSeenAt: number;
  sequence?: number;
}
interface Grant { c: string; r: string; e: number; v: number }
const COLORS = ["#f97316", "#22c55e", "#38bdf8", "#a78bfa", "#fb7185", "#facc15"];
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HOST_OFFLINE = COLLABORATION_HOST_OFFLINE;

export function responseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Publisher-Id", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra };
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: responseHeaders() });
}
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function unbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}
async function bodyBytes(request: Request, limit: number): Promise<Uint8Array> {
  ensure(Number(request.headers.get("content-length") || 0) <= limit, 413, "Request is too large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, "Request is too large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
async function bodyJson(request: Request, limit = 128 * 1024): Promise<Body> {
  const bytes = await bodyBytes(request, limit);
  try {
    const value = JSON.parse(decoder.decode(bytes));
    ensure(value && typeof value === "object" && !Array.isArray(value), 400, "Expected a JSON object");
    return value as Body;
  } catch { throw new HttpError(400, "Invalid JSON request"); }
}

/** One bounded project is the authority for memberships, discussions and published revisions. */
export class ProjectCollaboration extends DurableObject<Env> {
  private data: ProjectData | null = null;
  private readonly rates = new Map<string, { at: number; count: number }>();
  private readonly pendingPresence = new Map<WebSocket, { participant: CollaborationPresence; sentAt: number }>();
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts (actor TEXT NOT NULL, op_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,op_id));
        CREATE TABLE IF NOT EXISTS manifests (revision INTEGER PRIMARY KEY, files TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS room_manifests (room_id TEXT NOT NULL, revision INTEGER NOT NULL, files TEXT NOT NULL, projection TEXT, PRIMARY KEY(room_id,revision));
        CREATE TABLE IF NOT EXISTS uploads (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0);
      `);
      const row = ctx.storage.sql.exec<{ value: string }>("SELECT value FROM project WHERE id=1").toArray()[0];
      this.data = row ? JSON.parse(row.value) as ProjectData : null;
      const columns = ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(room_manifests)").toArray();
      if (!columns.some((column) => column.name === "projection")) ctx.storage.sql.exec("ALTER TABLE room_manifests ADD COLUMN projection TEXT");
      if (this.data && !this.data.references) this.data.references = [];
      if (this.data && !this.data.workspaces) this.data.workspaces = [];
      // Upgrade the isolated one-room prototype without changing accepted ACLs or receipts.
      if (this.data && !this.data.rooms) {
        const legacy = this.data as ProjectData & { room: RoomRecord; publisherHash: string; grantEpoch: number; hostSessionActive?: boolean; publicationError: string | null };
        legacy.rooms = [{ ...legacy.room, publisherHash: legacy.publisherHash, grantEpoch: legacy.grantEpoch,
          hostSessionActive: !!legacy.hostSessionActive, publicationError: legacy.publicationError }];
        ctx.storage.sql.exec("INSERT OR IGNORE INTO room_manifests(room_id,revision,files) SELECT ?,revision,files FROM manifests", legacy.room.id);
        this.save(legacy);
      }
    });
  }

  private state(): ProjectData { ensure(this.data, 503, "Project is not initialized"); return this.data; }
  private socketData(socket: WebSocket): SocketData { return socket.deserializeAttachment() as SocketData; }
  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => !this.socketData(socket)?.closed);
  }
  private participants(): WebSocket[] { return this.sockets().filter((s) => this.socketData(s).kind === "participant"); }
  private recordRoom(id?: string): RoomRecord {
    const room = this.state().rooms.find((entry) => entry.id === (id ?? this.state().rooms[0]?.id));
    ensure(room && !room.removed, 404, "Room not found"); return room;
  }
  private publisher(roomId: string): WebSocket | undefined {
    return this.sockets().find((s) => this.socketData(s).kind === "publisher" && this.socketData(s).roomId === roomId);
  }
  private identity(credential: string): CollaborationIdentity | null {
    return this.data ? resolveIdentity(this.data, credential) : null;
  }
  private requireIdentity(credential: string): CollaborationIdentity {
    requireActiveProject(this.state());
    const actor = this.identity(credential); ensure(actor, 401, "Credential is invalid or expired"); return actor;
  }
  private isHost(actor: CollaborationIdentity, roomId: string): boolean {
    const room = this.state().rooms.find((room) => room.id === roomId && !room.removed);
    return !!room && isCollaborationHost(actor, room);
  }
  private leaseDeadline(data: SocketData): number | null {
    if (data.kind === "publisher") return collaborationLeaseDeadline(data.lastSeenAt, "publisher");
    const actor = this.identity(data.credential);
    return actor && data.roomId && this.isHost(actor, data.roomId) ? collaborationLeaseDeadline(data.lastSeenAt, "owner") : null;
  }
  private hostOnline(roomId: string): boolean {
    const now = Date.now();
    const publisher = this.publisher(roomId);
    if (!publisher || (this.leaseDeadline(this.socketData(publisher)) ?? 0) <= now) return false;
    return this.participants().some((socket) => {
      const data = this.socketData(socket);
      return data.roomId === roomId && (this.leaseDeadline(data) ?? 0) > now;
    });
  }
  private requireHost(actor: CollaborationIdentity | undefined, roomId: string): void {
    ensure(actor && this.isHost(actor, roomId) || this.hostOnline(roomId), 423, HOST_OFFLINE);
  }
  private reconcileHosting(): void {
    if (this.data?.removal) return;
    const now = Date.now();
    for (const socket of this.sockets()) {
      const deadline = this.leaseDeadline(this.socketData(socket));
      if (deadline !== null && deadline <= now) this.close(socket, "Host connection timed out");
    }
    let changed = false;
    for (const room of this.state().rooms.filter((room) => !room.removed)) {
      const online = this.hostOnline(room.id);
      if (!!room.hostSessionActive !== online) {
        changed = true;
        this.mutate((next) => { const target = next.rooms.find((entry) => entry.id === room.id)!;
          target.hostSessionActive = online; target.grantEpoch++; });
      }
      if (!online) for (const socket of this.participants()) {
        const data = this.socketData(socket);
        const actor = this.identity(data.credential);
        if (data.roomId === room.id && (!actor || !this.isHost(actor, room.id))) this.close(socket, HOST_OFFLINE, "host_offline");
      }
    }
    if (changed) this.broadcastProject();
  }
  private room(actor: CollaborationIdentity, id?: string, enabled = true, hosted = true): RoomRecord {
    const room = this.recordRoom(id);
    ensure(actor.kind === "member" || actor.roomId === room.id, 404, "Room not found");
    if (hosted) this.requireHost(actor, room.id);
    if (enabled) ensure(room.enabled, 403, "Room sharing is disabled");
    return room;
  }
  private publicRoom(roomId?: string): CollaborationRoom {
    const room = this.recordRoom(roomId);
    return publicRoomRecord(room, this.hostOnline(room.id));
  }
  private projectState(actor: CollaborationIdentity, origin: string): CollaborationProjectState {
    return { project: this.state().project, self: actor, publicOrigin: origin, authorityKind: "cloud", capabilities: { editSource: false },
      members: actor.kind === "member" ? this.state().members.map(publicMember) : [],
      workspaces: actor.kind === "member" ? this.state().workspaces : [],
      rooms: this.state().rooms.filter((room) => !room.removed
        && (actor.kind === "guest" ? actor.roomId === room.id && room.enabled
          : room.enabled || actor.role === "admin" || actor.id === room.ownerId)).map((room) => this.publicRoom(room.id)),
    };
  }

  private save(next: ProjectData): void {
    if (this.data?.removal) throw new ProjectRemovedError();
    const value = JSON.stringify(next);
    ensure(encoder.encode(value).byteLength <= LIMITS.metadataBytes, 409, "Project metadata capacity reached");
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO project(id,value) VALUES(1,?)", value);
  }
  private mutate<T>(change: (next: ProjectData) => T): T {
    const next = structuredClone(this.state());
    const result = change(next);
    this.ctx.storage.transactionSync(() => this.save(next));
    this.data = next;
    return result;
  }
  private receipt(actor: string, opId: string, fingerprint: string): unknown | undefined {
    const row = this.ctx.storage.sql.exec<{ fingerprint: string; result: string }>(
      "SELECT fingerprint,result FROM receipts WHERE actor=? AND op_id=?", actor, opId,
    ).toArray()[0];
    if (!row) return undefined;
    ensure(row.fingerprint === fingerprint, 409, "Operation id was used for different input");
    return JSON.parse(row.result);
  }
  private record(actor: string, opId: string, fingerprint: string, result: unknown): void {
    const count = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM receipts").one().count;
    ensure(count < 100_000, 409, "Operation receipt capacity reached");
    this.ctx.storage.sql.exec("INSERT INTO receipts(actor,op_id,fingerprint,result) VALUES(?,?,?,?)", actor, opId, fingerprint, JSON.stringify(result));
  }
  private operation<T>(actor: CollaborationIdentity, path: string, body: Body, change: (next: ProjectData) => T, afterSave?: (next: ProjectData) => void): { result: T; replay: boolean } {
    const opId = short(body.opId, 100, "operation id");
    const fingerprint = `${path}\n${canonical(body)}`;
    const prior = this.receipt(actor.id, opId, fingerprint);
    if (prior !== undefined) return { result: prior as T, replay: true };
    const next = structuredClone(this.state());
    const result = change(next);
    this.ctx.storage.transactionSync(() => { this.save(next); afterSave?.(next); this.record(actor.id, opId, fingerprint, result); });
    this.data = next;
    return { result, replay: false };
  }

  private rate(key: string, maximum = 60): void {
    const now = Date.now();
    const previous = this.rates.get(key);
    const bucket = previous && now - previous.at < 1000 ? previous : { at: now, count: 0 };
    this.rates.set(key, bucket);
    ensure(++bucket.count <= maximum, 429, "Request rate exceeded");
    if (this.rates.size > 1024) for (const [entry, value] of this.rates) if (now - value.at >= 1000) this.rates.delete(entry);
  }
  private async bearer(request: Request): Promise<string> {
    const token = /^Bearer ([^\s]{1,256})$/.exec(request.headers.get("authorization") || "")?.[1];
    ensure(token, 401, "Bearer credential required"); return sha256(token);
  }
  private requirePublisher(credential: string, roomId?: string): RoomRecord {
    requireActiveProject(this.state());
    const room = this.state().rooms.find((room) => !room.removed && room.publisherHash === credential && (!roomId || room.id === roomId));
    ensure(room, 401, "Publisher credential required for this room");
    ensure(this.state().members.some((member) => member.id === room.ownerId && (member.role === "writer" || member.role === "admin")), 403, "Room owner no longer has publishing access");
    return room;
  }
  private requireLease(request: Request, credential: string, roomId: string): string {
    this.requirePublisher(credential, roomId);
    this.reconcileHosting();
    const socket = this.publisher(roomId);
    const id = socket && this.socketData(socket).id;
    ensure(id && request.headers.get("x-publisher-id") === id, 409, "Publisher connection changed; reconnect before publishing");
    return id;
  }

  private async grantKey(): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", encoder.encode(this.state().grantKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  }
  private async grantToken(credential: string, roomId: string): Promise<string> {
    const room = this.recordRoom(roomId);
    const grant: Grant = { c: credential, r: room.id, e: Math.ceil(Date.now() / 3600_000) * 3600_000 + 3600_000, v: room.grantEpoch };
    const payload = encoder.encode(JSON.stringify(grant));
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await this.grantKey(), payload));
    return `${base64(payload)}.${base64(signature)}`;
  }
  private pageUrl(token: string, roomId: string, revision = this.recordRoom(roomId).revision): string {
    const room = this.recordRoom(roomId);
    return `/projects/${this.state().project.id}/rooms/${room.id}/revisions/${revision}/${token}/${room.page.split("/").map(encodeURIComponent).join("/")}`;
  }
  private async parseGrant(token: string, roomId: string): Promise<Grant> {
    ensure(token.length <= 1000, 403, "Invalid asset grant");
    try {
      const [encoded, signature, extra] = token.split(".");
      ensure(encoded && signature && !extra, 403, "Invalid asset grant");
      const payload = unbase64(encoded);
      ensure(await crypto.subtle.verify("HMAC", await this.grantKey(), unbase64(signature), payload), 403, "Invalid asset grant");
      const grant = JSON.parse(decoder.decode(payload)) as Grant;
      ensure(grant.r === roomId && grant.v === this.recordRoom(roomId).grantEpoch && /^[a-f0-9]{64}$/.test(grant.c) && finite(grant.e, Number.MAX_SAFE_INTEGER)
        && grant.e > Date.now(), 403, "Asset grant expired or has the wrong room");
      this.room(this.requireIdentity(grant.c), roomId);
      return grant;
    } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(403, "Invalid asset grant"); }
  }
  private async roomState(credential: string, roomId: string): Promise<CollaborationRoomState> {
    const token = await this.grantToken(credential, roomId);
    const actor = this.requireIdentity(credential);
    this.room(actor, roomId);
    const participants = this.participants().flatMap((socket) => {
      const data = this.socketData(socket);
      const member = this.identity(data.credential);
      return member && data.presence && data.roomId === roomId
        ? [{ ...data.presence, role: member.role, name: member.name }] : [];
    });
    const manifest = this.ctx.storage.sql.exec<{ files: string; projection: string | null }>("SELECT files,projection FROM room_manifests WHERE room_id=? AND revision=?", roomId, this.recordRoom(roomId).revision).toArray()[0];
    return { ...(manifest ? { publication: { revision: this.recordRoom(roomId).revision, files: JSON.parse(manifest.files),
      ...(manifest.projection ? { projection: JSON.parse(manifest.projection) } : {}) } } : {}), room: this.publicRoom(roomId), participants, comments: this.state().comments.filter((comment) => comment.roomId === roomId),
      messages: actor.kind === "member" || actor.guestAccess === "comment" ? this.state().messages.filter((message) => message.roomId === roomId) : [], pageUrl: this.pageUrl(token, roomId) };
  }

  private send(socket: WebSocket, message: CollaborationServerMessage): void {
    const data = this.socketData(socket);
    if (data.closed || data.kind !== "participant") return;
    const actor = this.identity(data.credential);
    if (!actor) { this.close(socket, "Access revoked"); return; }
    if (data.roomId && !this.isHost(actor, data.roomId) && !this.hostOnline(data.roomId)) return;
    if (!["welcome", "project", "closed", "error", "pong"].includes(message.type)
      && (!data.roomId || !this.state().rooms.some((room) => room.id === data.roomId && room.enabled && !room.removed))) return;
    // No application-level unbounded send queue. The runtime closes sockets on send-buffer failure.
    try { socket.send(JSON.stringify(message)); } catch { this.close(socket, "Reconnect for a fresh snapshot"); }
  }
  private broadcast(message: CollaborationServerMessage, roomId: string, discussion = false): void {
    for (const socket of this.participants()) {
      const data = this.socketData(socket);
      const actor = this.identity(data.credential);
      if (data.roomId !== roomId || !actor || discussion && actor.kind === "guest" && actor.guestAccess !== "comment") continue;
      this.send(socket, message);
    }
  }
  private broadcastProject(): void {
    for (const socket of this.participants()) {
      const data = this.socketData(socket);
      const actor = this.identity(data.credential);
      if (actor) this.send(socket, { type: "project", state: this.projectState(actor, data.origin) });
    }
  }
  private prune(roomId: string, next: ProjectData): void {
    const revisions = this.ctx.storage.sql.exec<{ revision: number }>("SELECT revision FROM room_manifests WHERE room_id=? ORDER BY revision DESC", roomId).toArray().map((row) => row.revision);
    const retained = retainedCollaborationRevisions(revisions, next.references, roomId);
    for (const revision of revisions) if (!retained.has(revision)) this.ctx.storage.sql.exec("DELETE FROM room_manifests WHERE room_id=? AND revision=?", roomId, revision);
  }
  private publication(roomId: string, revision: number): CollaborationRoomState["publication"] {
    const manifest = this.ctx.storage.sql.exec<{ files: string; projection: string | null }>("SELECT files,projection FROM room_manifests WHERE room_id=? AND revision=?", roomId, revision).toArray()[0];
    return manifest ? { revision, files: JSON.parse(manifest.files), ...(manifest.projection ? { projection: JSON.parse(manifest.projection) } : {}) } : undefined;
  }
  private async broadcastContent(roomId: string): Promise<void> {
    await Promise.all(this.participants().map(async (socket) => {
      const data = this.socketData(socket);
      if (data.roomId !== roomId || !this.identity(data.credential) || !this.recordRoom(roomId).enabled) return;
      const token = await this.grantToken(data.credential, roomId);
      const room = this.publicRoom(roomId);
      this.send(socket, { type: "content", room, pageUrl: this.pageUrl(token, roomId), publication: this.publication(roomId, room.revision) });
    }));
    this.broadcastProject();
  }
  private leave(socket: WebSocket): void {
    const data = this.socketData(socket);
    const wasJoined = data.roomId;
    data.roomId = null; data.presence = null;
    socket.serializeAttachment(data); this.pendingPresence.delete(socket);
    if (wasJoined) this.broadcast({ type: "departed", connectionId: data.id }, wasJoined);
  }
  private close(socket: WebSocket, reason: string, code?: "host_offline"): void {
    const data = this.socketData(socket);
    if (data.closed) return;
    data.closed = true; socket.serializeAttachment(data);
    if (data.kind === "participant") {
      try { socket.send(JSON.stringify({ type: "closed", reason, ...(code ? { code } : {}) })); } catch { /* Closing socket. */ }
      this.leave(socket);
    }
    const next = this.socketData(socket); next.closed = true; socket.serializeAttachment(next);
    this.pendingPresence.delete(socket);
    try { socket.close(1008, reason); } catch { /* Already closed. */ }
  }
  private reconcileAccess(): void {
    for (const socket of this.participants()) {
      const data = this.socketData(socket);
      const actor = this.identity(data.credential);
      if (!actor) { this.close(socket, "Access revoked or invitation expired"); continue; }
      if (data.roomId && !this.state().rooms.some((room) => room.id === data.roomId && room.enabled && !room.removed)) {
        if (!this.isHost(actor, data.roomId)) this.close(socket, HOST_OFFLINE, "host_offline");
        else this.leave(socket);
      }
      else if (data.presence) {
        data.presence.role = actor.role; socket.serializeAttachment(data);
        this.broadcast({ type: "presence", participant: data.presence, sentAt: 0 }, data.presence.roomId);
      }
    }
    for (const socket of this.sockets().filter((socket) => this.socketData(socket).kind === "publisher")) {
      const data = this.socketData(socket);
      if (!this.state().rooms.some((room) => !room.removed && room.id === data.roomId && room.publisherHash === data.credential)) this.close(socket, "Publishing access revoked");
    }
    this.reconcileHosting();
    this.broadcastProject();
  }

  private async scheduleExpiry(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    const deadlines = [
      ...this.state().invitations.filter((i) => i.expiresAt > Date.now()).map((i) => i.expiresAt),
      ...this.sockets().flatMap((socket) => { const deadline = this.leaseDeadline(this.socketData(socket)); return deadline === null ? [] : [deadline]; }),
    ];
    const next = deadlines.length ? Math.max(Date.now() + 1, Math.min(...deadlines)) : null;
    // Heartbeats extend attachments, not alarms. An earlier alarm rechecks the
    // current leases and schedules the next deadline without per-ping writes.
    if (next !== null && (current === null || current > next)) await this.ctx.storage.setAlarm(next);
    else if (next === null && current !== null) await this.ctx.storage.deleteAlarm();
  }
  async alarm(): Promise<void> { if (this.data) { this.reconcileHosting(); this.reconcileAccess(); await this.scheduleExpiry(); } }

  private anchor(value: unknown, roomId: string): CollaborationAnchor {
    ensure(value && typeof value === "object" && !Array.isArray(value), 400, "Invalid comment anchor");
    const anchor = value as CollaborationAnchor;
    ensure(anchor.address && typeof anchor.address === "object" && !Array.isArray(anchor.address)
      && JSON.stringify(anchor.address).length <= 4096, 400, "Invalid viewer address");
    ensure(Number.isInteger(anchor.revision) && anchor.revision > 0 && anchor.revision <= this.recordRoom(roomId).revision
      && finite(anchor.x) && finite(anchor.y), 400, "Invalid anchor coordinates or revision");
    if (anchor.quote !== undefined) short(anchor.quote, 1000, "anchor quote");
    let preview: CollaborationAnchor["preview"];
    try { preview = validateCommentPreview(anchor.preview); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid comment preview"); }
    return { address: anchor.address, revision: anchor.revision, x: anchor.x, y: anchor.y,
      ...(anchor.quote !== undefined ? { quote: anchor.quote } : {}), ...(preview ? { preview } : {}) };
  }

  private async bootstrap(request: Request): Promise<Response> {
    const credential = await this.bearer(request);
    ensure(this.env.BOOTSTRAP_SECRET && credential === await sha256(this.env.BOOTSTRAP_SECRET), 401, "Bootstrap authorization required");
    const body = await bodyJson(request, 512 * 1024);
    const project = body.project as { id: string; name: string };
    const owner = body.owner as { id: string; name: string; token: string };
    const room = body.room as CollaborationRoom | undefined;
    ensure(project && /^[a-zA-Z0-9_-]{1,100}$/.test(project.id) && project.id === request.headers.get("x-collaboration-project"), 400, "Project id does not match this authority");
    short(project.name, 160, "project name");
    ensure(owner, 400, "Owner is required");
    short(owner.id, 100, "owner id"); short(owner.name, 100, "owner name"); short(owner.token, 256, "owner token");
    if (room) {
      ensure(/^[a-zA-Z0-9_-]{1,100}$/.test(room.id) && room.ownerId === owner.id, 400, "Invalid room owner or id");
      short(room.title, 160, "room title"); short(room.mode, 80, "mode");
      ensure(typeof room.page === "string" && publicPath(room.page) && /\.html?$/.test(room.page), 400, "Room requires a public HTML page");
      ensure(typeof room.enabled === "boolean", 400, "Room enabled flag is required");
    }
    const publisherToken = room ? short(body.publisherToken, 256, "publisher token") : "";
    ensure(!room || publisherToken !== owner.token, 400, "Publisher credential must differ from owner credential");
    const frameScript = body.frameScript ?? "";
    ensure(typeof frameScript === "string" && encoder.encode(frameScript).length <= 256 * 1024, 400, "Invalid frame instrumentation");
    const frameScriptUrl = body.frameScriptUrl;
    if (frameScriptUrl !== undefined) {
      ensure(typeof frameScriptUrl === "string" && frameScriptUrl.length <= 500
        && frameScriptUrl.startsWith("/viewer/") && !frameScriptUrl.includes("?") && !frameScriptUrl.includes("#")
        && publicPath(frameScriptUrl.slice(1)) && new URL(frameScriptUrl, request.url).pathname === frameScriptUrl,
      400, "Frame instrumentation URL must be a versioned /viewer/ asset");
    }
    ensure(!room || frameScriptUrl || frameScript, 400, "Frame instrumentation is required");
    const bootstrapHash = await sha256(canonical(body));
    if (this.data) { requireActiveProject(this.data); ensure(this.data.bootstrapHash === bootstrapHash, 409, "Project is already initialized with different configuration"); return json({ ok: true, existing: true }); }
    const [ownerHash, publisherHash] = await Promise.all([sha256(owner.token), sha256(publisherToken)]);
    // Hashing awaits can interleave with another bootstrap; recheck before the create-once transaction.
    const initializedDuringHash = this.data as ProjectData | null;
    if (initializedDuringHash) { requireActiveProject(initializedDuringHash); ensure(initializedDuringHash.bootstrapHash === bootstrapHash, 409, "Project is already initialized"); return json({ ok: true, existing: true }); }
    const next: ProjectData = {
      project: { id: project.id, name: project.name }, bootstrapHash,
      grantKey: crypto.randomUUID() + crypto.randomUUID(), frameScript,
      ...(typeof frameScriptUrl === "string" ? { frameScriptUrl } : {}),
      rooms: room ? [{ ...room, id: room.id, title: room.title, mode: room.mode, ownerId: room.ownerId, page: room.page,
        enabled: room.enabled, revision: 0, updatedAt: Date.now(), fingerprint: "", publisherHash, grantEpoch: 0, hostSessionActive: false, publicationError: null }] : [],
      members: [{ id: owner.id, name: owner.name, role: "admin", tokenHash: ownerHash }],
      workspaces: [], references: [], invitations: [], guests: [], comments: [], messages: [],
    };
    this.ctx.storage.transactionSync(() => this.save(next)); this.data = next;
    return json({ ok: true, existing: false });
  }

  private async registerRoom(credential: string, body: Body): Promise<Response> {
    const actor = this.requireIdentity(credential);
    ensure(canWriteCollaboration(actor), 403, "Writing membership required");
    const registration = validateRegistration(body, actor.id);
    ensure(this.state().workspaces.some((workspace) => workspace.id === registration.workspaceId && workspace.ownerId === actor.id), 403, "Register your own workspace before sharing a room");
    if (body.frameScript !== undefined) {
      ensure(typeof body.frameScript === "string" && encoder.encode(body.frameScript).length <= 256 * 1024, 400, "Invalid frame instrumentation");
      registration.frameScript = body.frameScript;
    }
    if (body.frameScriptUrl !== undefined) registration.frameScriptUrl = validateFrameScriptUrl(body.frameScriptUrl);
    const opId = body.opId === undefined ? undefined : short(body.opId, 100, "operation id");
    const operationActor = `room-registration:${actor.id}`;
    const fingerprint = canonical(body);
    if (opId) { const receipt = this.receipt(operationActor, opId, fingerprint); if (receipt !== undefined) return json(receipt); }
    const existing = this.state().rooms.find((room) => !room.removed && room.workspaceId === registration.workspaceId && room.modeInstanceId === registration.modeInstanceId);
    if (existing) {
      ensure(existing.ownerId === actor.id && existing.mode === registration.mode
        && canonical(existing.compatibility) === canonical(registration.compatibility), 409, "Room binding already exists with different ownership or compatibility");
      return json({ room: this.publicRoom(existing.id), existing: true });
    }
    const publisherToken = crypto.randomUUID() + crypto.randomUUID();
    const publisherHash = await sha256(publisherToken);
    const current = this.requireIdentity(credential); ensure(current.id === actor.id && canWriteCollaboration(current), 403, "Writing membership required");
    if (opId) { const receipt = this.receipt(operationActor, opId, fingerprint); if (receipt !== undefined) return json(receipt); }
    const next = structuredClone(this.state());
    ensure(next.rooms.filter((room) => !room.removed).length < 16, 409, "Room limit reached");
    ensure(!next.rooms.some((room) => !room.removed && room.workspaceId === registration.workspaceId && room.modeInstanceId === registration.modeInstanceId), 409, "Room was registered concurrently; reload registration");
    ensure(!next.rooms.some((room) => !room.removed && room.workspaceId === registration.workspaceId && room.ownerId !== actor.id), 409, "Workspace belongs to another member");
    next.rooms.push({ ...registration, publisherHash });
    const result = { room: publicRoomRecord(next.rooms.at(-1)!, false), publisherToken };
    this.ctx.storage.transactionSync(() => { this.save(next); if (opId) this.record(operationActor, opId, fingerprint, result); });
    this.data = next;
    this.broadcastProject(); return json(result, 201);
  }

  private async publisherRequest(request: Request, url: URL): Promise<Response> {
    const credential = await this.bearer(request);
    const scoped = /^\/api\/publisher\/rooms\/([^/]+)\/(.+)$/.exec(url.pathname);
    const room = this.requirePublisher(credential, scoped?.[1]);
    if (scoped) url.pathname = `/api/publisher/${scoped[2]}`;
    const roomId = room.id;
    this.rate(`publisher:${roomId}`, 100);
    if (url.pathname === "/api/publisher/state" && request.method === "GET") {
      return json({ room: this.publicRoom(roomId), revision: room.revision,
        fingerprint: room.fingerprint, hostOnline: this.hostOnline(roomId) });
    }
    const upload = /^\/api\/publisher\/blobs\/([a-f0-9]{64})$/.exec(url.pathname);
    if (upload && request.method === "PUT") {
      const bytes = await bodyBytes(request, LIMITS.fileBytes);
      const digest = await sha256(bytes);
      this.requirePublisher(credential, roomId);
      ensure(digest === upload[1], 400, "Blob hash does not match its bytes");
      const previous = this.ctx.storage.sql.exec<{ size: number; ready: number }>("SELECT size,ready FROM uploads WHERE hash=?", digest).toArray()[0];
      if (previous?.ready) { ensure(previous.size === bytes.length, 409, "Blob size mismatch"); return json({ hash: digest, size: bytes.length }); }
      if (!previous) {
        const total = this.ctx.storage.sql.exec<{ count: number; size: number }>("SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS size FROM uploads").one();
        ensure(total.count < LIMITS.uploadedBlobs && total.size + bytes.length <= LIMITS.uploadBytes, 409, "Project upload capacity reached");
        this.ctx.storage.sql.exec("INSERT INTO uploads(hash,size,ready) VALUES(?,?,0)", digest, bytes.length);
      }
      await this.env.BLOBS.put(`${this.state().project.id}/${digest}`, bytes, { customMetadata: { sha256: digest }, sha256: digest });
      this.requirePublisher(credential, roomId);
      this.ctx.storage.sql.exec("UPDATE uploads SET ready=1 WHERE hash=?", digest);
      return json({ hash: digest, size: bytes.length });
    }
    if (url.pathname === "/api/publisher/commit" && request.method === "POST") {
      this.requireLease(request, credential, roomId);
      const body = await bodyJson(request, LIMITS.projectionBytes + 128 * 1024);
      const opId = short(body.opId, 100, "operation id");
      const requestFingerprint = canonical(body);
      this.requireLease(request, credential, roomId);
      const prior = this.receipt(`publisher:${roomId}`, opId, requestFingerprint);
      if (prior !== undefined) return json(prior);
      ensure(!this.recordRoom(roomId).removed, 409, "Room registration was removed");
      const files = validateFiles(body.files, this.recordRoom(roomId).page);
      const projection = validateProjection(body.projection, room);
      const fingerprint = await sha256(projection ? canonical({ files, projection }) : JSON.stringify(files));
      ensure(fingerprint === body.fingerprint, 400, "Manifest fingerprint does not match its files");
      // Only a successful, checksum-validated private R2 upload may satisfy a manifest.
      for (const file of files) {
        const uploaded = this.ctx.storage.sql.exec<{ size: number; ready: number }>("SELECT size,ready FROM uploads WHERE hash=?", file.hash).toArray()[0];
        ensure(uploaded?.ready && uploaded.size === file.size, 409, "Manifest references an unconfirmed resource");
      }
      // Verify existence immediately before publication; no destructive R2 GC races with commits.
      const unique = [...new Set(files.map((file) => file.hash))];
      for (let start = 0; start < unique.length; start += 8) {
        const batch = unique.slice(start, start + 8);
        const objects = await Promise.all(batch.map((digest) => this.env.BLOBS.head(`${this.state().project.id}/${digest}`)));
        for (let i = 0; i < batch.length; i++) {
          const object = objects[i]; const expected = files.find((file) => file.hash === batch[i])!;
          ensure(object && object.size === expected.size && object.customMetadata?.sha256 === expected.hash, 409, "Published resource is missing or mismatched");
        }
      }
      this.requireLease(request, credential, roomId);
      const raced = this.receipt(`publisher:${roomId}`, opId, requestFingerprint);
      if (raced !== undefined) return json(raced);
      ensure(Number.isInteger(body.baseRevision) && body.baseRevision === this.recordRoom(roomId).revision, 409, "Published revision changed; reload before committing");
      const next = structuredClone(this.state());
      const target = next.rooms.find((entry) => entry.id === roomId)!;
      const changed = target.fingerprint !== fingerprint;
      if (changed) { target.revision++; target.updatedAt = Date.now(); target.fingerprint = fingerprint; }
      target.publicationError = null;
      const result = { revision: target.revision, fingerprint };
      this.ctx.storage.transactionSync(() => {
        if (changed) {
          this.ctx.storage.sql.exec("INSERT INTO room_manifests(room_id,revision,files,projection) VALUES(?,?,?,?)", roomId, target.revision, JSON.stringify(files), projection ? JSON.stringify(projection) : null);
          this.prune(roomId, next);
        }
        this.save(next); this.record(`publisher:${roomId}`, opId, requestFingerprint, result);
      });
      this.data = next;
      await this.broadcastContent(roomId);
      return json(result);
    }
    if (url.pathname === "/api/publisher/error" && request.method === "POST") {
      this.requireLease(request, credential, roomId);
      const body = await bodyJson(request);
      ensure(typeof body.message === "string" && body.message.length <= 1000, 400, "Invalid publication error");
      this.requireLease(request, credential, roomId);
      this.mutate((next) => { next.rooms.find((entry) => entry.id === roomId)!.publicationError = body.message as string || null; });
      if (body.message) this.broadcast({ type: "error", message: `Publication update failed: ${body.message}` }, roomId);
      else await this.broadcastContent(roomId);
      return json({ ok: true });
    }
    throw new HttpError(404, "Not found");
  }

  private async redeem(request: Request): Promise<Response> {
    const body = await bodyJson(request, 2048);
    const tokenHash = await sha256(short(body.token, 256, "invitation token"));
    const name = short(body.name, 100, "display name").trim();
    this.rate(`invitation:${tokenHash}`, 10);
    const invite = this.state().invitations.find((entry) => entry.tokenHash === tokenHash && entry.expiresAt > Date.now());
    ensure(invite && this.state().rooms.some((room) => room.id === invite.roomId && room.enabled && !room.removed), 401, "Invitation is invalid or expired");
    const roomId = invite.roomId;
    this.requireHost(undefined, roomId);
    const token = crypto.randomUUID() + crypto.randomUUID();
    const sessionHash = await sha256(token);
    ensure(this.state().invitations.some((entry) => entry.id === invite.id && entry.expiresAt > Date.now())
      && this.recordRoom(roomId).enabled && !this.recordRoom(roomId).removed, 401, "Invitation was revoked");
    this.requireHost(undefined, roomId);
    this.mutate((next) => {
      next.guests = next.guests.filter((guest) => next.invitations.some((i) => i.id === guest.invitationId && i.expiresAt > Date.now()));
      ensure(next.guests.length < LIMITS.guests, 409, "Guest session capacity reached");
      next.guests.push({ id: `guest-${crypto.randomUUID()}`, name, tokenHash: sessionHash, invitationId: invite.id });
    });
    return json({ token, roomId: invite.roomId });
  }

  private referenceSource(actor: CollaborationIdentity, value: unknown) {
    const source = validateReferenceSource(value, this.state().project.id);
    const room = validateReferenceRoom(this.state(), actor, source);
    ensure(this.hostOnline(room.id), 423, HOST_OFFLINE);
    const publication = this.publication(room.id, source.publicationRevision);
    ensure(publication, 410, "The pinned source publication is unavailable");
    return { source, room, publication };
  }
  private async referenceRequest(credential: string, url: URL, method: string, body: Body): Promise<Response> {
    const actor = this.requireIdentity(credential);
    ensure(actor.kind === "member", 403, "Project membership required for references");
    const path = url.pathname;
    if (path === "/api/references" && method === "GET") {
      const workspaceId = url.searchParams.get("workspaceId");
      if (workspaceId) ensure(this.state().workspaces.some((workspace) => workspace.id === workspaceId), 404, "Workspace not found");
      return json({ references: this.state().references.filter((reference) => !workspaceId || reference.destinationWorkspaceId === workspaceId) });
    }
    const match = /^\/api\/references\/([a-zA-Z0-9_-]+)(\/resolve)?$/.exec(path);
    if (match?.[2] && method === "GET") {
      const reference = this.state().references.find((reference) => reference.id === match[1]);
      ensure(reference, 410, "The reference was removed or is unavailable");
      this.referenceSource(actor, reference.source);
      const token = await this.grantToken(credential, reference.source.roomId);
      await this.parseGrant(token, reference.source.roomId);
      // Grant signing may interleave with revocation, source removal or refresh.
      const currentActor = this.requireIdentity(credential);
      ensure(currentActor.kind === "member", 403, "Project membership required");
      const current = this.state().references.find((record) => record.id === reference.id);
      ensure(current, 410, "The reference was removed or is unavailable");
      ensure(canonical(current) === canonical(reference), 409, "Reference changed; resolve the explicit refreshed reference");
      const source = this.referenceSource(currentActor, current.source);
      const result: CollaborationResolvedReference = { reference: current, compatibility: current.compatibility,
        room: { ...this.publicRoom(source.room.id), revision: current.source.publicationRevision }, publication: source.publication,
        pageUrl: this.pageUrl(token, source.room.id, current.source.publicationRevision) };
      return json(result);
    }
    ensure(canWriteCollaboration(actor), 403, "Writing membership required");
    if (path === "/api/references" && method === "POST") {
      requireReferenceDestination(this.state(), actor, body.destinationWorkspaceId);
      const label = short(body.label, 160, "reference label");
      const operation = this.operation(actor, path, body, (next) => {
        const source = this.referenceSource(actor, body.source);
        ensure(next.references.length < COLLABORATION_REFERENCE_LIMIT, 409, "Reference capacity reached");
        requireReferenceQuota(next.references, source.source);
        const now = Date.now();
        const reference: CollaborationReference = { id: crypto.randomUUID(), ownerId: actor.id,
          destinationWorkspaceId: String(body.destinationWorkspaceId), label, source: source.source,
          compatibility: { ...source.room.compatibility! }, createdAt: now, updatedAt: now };
        next.references.push(reference); return reference;
      });
      return json(operation.result, 201);
    }
    ensure(match && !match[2], 404, "Reference endpoint not found");
    if (method === "PATCH") {
      let updatedRoomId = "";
      const label = body.label === undefined ? undefined : short(body.label, 160, "reference label");
      let previousRoomId = "";
      const operation = this.operation(actor, path, body, (next) => {
        const reference = next.references.find((reference) => reference.id === match[1]);
        ensure(reference, 410, "The reference was removed or is unavailable");
        ensure(reference.ownerId === actor.id, 403, "Only the destination workspace owner can refresh a reference");
        requireReferenceDestination(next, actor, reference.destinationWorkspaceId);
        const source = this.referenceSource(actor, body.source); updatedRoomId = source.room.id;
        requireReferenceQuota(next.references, source.source, reference.id);
        previousRoomId = reference.source.roomId;
        reference.source = source.source; reference.compatibility = { ...source.room.compatibility! };
        if (label !== undefined) reference.label = label;
        reference.updatedAt = Date.now(); return reference;
      }, (next) => { this.prune(previousRoomId, next); this.prune(updatedRoomId, next); });
      return json(operation.result);
    }
    if (method === "DELETE") {
      let previousRoomId = "";
      const operation = this.operation(actor, path, body, (next) => {
        const reference = next.references.find((reference) => reference.id === match[1]);
        ensure(reference, 410, "The reference was removed or is unavailable");
        ensure(reference.ownerId === actor.id, 403, "Only the destination workspace owner can remove a reference");
        requireReferenceDestination(next, actor, reference.destinationWorkspaceId);
        previousRoomId = reference.source.roomId;
        next.references = next.references.filter((record) => record.id !== reference.id);
        return { ok: true, id: reference.id };
      }, (next) => this.prune(previousRoomId, next));
      return json(operation.result);
    }
    throw new HttpError(405, "Method not allowed");
  }

  private async deleteProject(request: Request): Promise<Response> {
    const credential = await this.bearer(request);
    const body = await bodyJson(request);
    const actor = this.identity(credential);
    const prior = replayProjectRemoval(this.state(), actor, body);
    if (prior) return json(prior);
    ensure(actor, 401, "Credential is invalid or expired");
    ensure(actor.kind === "member" && actor.role === "admin", 403, "Administrator membership required");
    const operation = this.operation(actor, "/api/project", body, (next) => removeProject(next, actor, body));
    for (const socket of this.sockets()) this.close(socket, "Project removed");
    await this.ctx.storage.deleteAlarm();
    return json(operation.result);
  }

  private async actorRequest(request: Request, url: URL): Promise<Response> {
    const credential = await this.bearer(request);
    this.requireIdentity(credential); this.rate(credential);
    const method = request.method;
    const body = method === "GET" || method === "DELETE" && !url.pathname.startsWith("/api/references/") ? {} : await bodyJson(request);
    const actor = this.requireIdentity(credential);
    const path = url.pathname;
    if (path === "/api/state" && method === "GET") {
      if (actor.kind === "guest") this.requireHost(actor, actor.roomId!);
      else if (request.headers.get("x-collaboration-scoped") !== "true" && this.state().rooms[0] && !this.state().rooms[0]!.compatibility) this.requireHost(actor, this.state().rooms[0]!.id);
      return json(this.projectState(actor, url.origin));
    }
    if (path.startsWith("/api/references")) return await this.referenceRequest(credential, url, method, body);
    if (path === "/api/workspaces" && method === "POST") {
      ensure(canWriteCollaboration(actor), 403, "Writing membership required");
      const id = short(body.id, 100, "workspace id");
      ensure(/^[a-zA-Z0-9_-]{1,100}$/.test(id) && body.placement === "local", 400, "Invalid workspace id or placement");
      const name = short(body.name, 160, "workspace name");
      const existing = this.state().workspaces.find((workspace) => workspace.id === id);
      if (existing) { ensure(existing.ownerId === actor.id, 403, "Workspace belongs to another member"); return json(existing); }
      const workspace = { id, projectId: this.state().project.id, ownerId: actor.id, name, placement: "local" as const };
      this.mutate((next) => { ensure(next.workspaces.length < 100, 409, "Workspace capacity reached"); next.workspaces.push(workspace); });
      this.broadcastProject(); return json(workspace, 201);
    }
    const memberMatch = /^\/api\/members(?:\/([^/]+))?$/.exec(path);
    if (memberMatch) {
      ensure(actor.kind === "member" && actor.role === "admin", 403, "Administrator required");
      const id = memberMatch[1];
      if (method === "POST" && !id) {
        const name = short(body.name, 100, "member name").trim(); const role = validRole(body.role);
        const token = crypto.randomUUID() + crypto.randomUUID(); const tokenHash = await sha256(token);
        const currentActor = this.requireIdentity(credential);
        ensure(currentActor.role === "admin", 403, "Administrator required");
        const member = { id: crypto.randomUUID(), name, role };
        this.mutate((next) => { ensure(next.members.length < LIMITS.members, 409, "Member limit reached"); next.members.push({ ...member, tokenHash }); });
        this.reconcileAccess(); return json({ member, token });
      }
      ensure(method === "PATCH" || method === "DELETE", 405, "Method not allowed");
      const target = this.state().members.find((entry) => entry.id === id); ensure(target, 404, "Member not found");
      const role = method === "PATCH" ? validRole(body.role) : undefined;
      ensure(!this.state().rooms.some((room) => !room.removed && room.ownerId === target.id) || role === "writer" || role === "admin",
        409, "Cannot remove or demote the designated host while the room exists");
      ensure(!(target.role === "admin" && role !== "admin" && this.state().members.filter((m) => m.role === "admin").length === 1), 409, "Cannot remove the last administrator");
      const result = this.mutate((next) => {
        if (method === "DELETE") { next.members = next.members.filter((m) => m.id !== id); return { ok: true }; }
        const member = next.members.find((m) => m.id === id)!; member.role = role!; return publicMember(member);
      });
      this.reconcileAccess(); return json(result);
    }
    if (path === "/api/rooms" && method === "POST") return await this.registerRoom(credential, body);
    const match = /^\/api\/rooms\/([a-zA-Z0-9_-]+)(?:\/(content|comments|chat|links)(?:\/([^/]+))?)?$/.exec(path);
    ensure(match, 404, "Not found");
    const [, id, action, commentId] = match;
    const room = this.room(actor, id, !!action || method === "GET", !!action || method === "GET");
    const roomId = room.id;
    if (!action) {
      if (method === "GET") return json(await this.roomState(credential, roomId));
      ensure(canManageCollaborationRoom(actor, room), 403, "Room owner or administrator required");
      if (method === "PATCH") {
        ensure(typeof body.enabled === "boolean", 400, "Expected enabled boolean");
        this.mutate((next) => { const target = next.rooms.find((entry) => entry.id === roomId)!; if (target.enabled !== body.enabled) target.grantEpoch++; target.enabled = body.enabled as boolean; target.updatedAt = Date.now(); });
        this.reconcileAccess(); return json(this.publicRoom(roomId));
      }
      if (method === "DELETE") {
        this.mutate((next) => { const target = next.rooms.find((entry) => entry.id === roomId)!; target.removed = true; target.grantEpoch++; next.invitations = next.invitations.filter((invite) => invite.roomId !== roomId); next.guests = next.guests.filter((guest) => next.invitations.some((invite) => invite.id === guest.invitationId)); });
        this.reconcileAccess(); return json({ ok: true });
      }
    }
    if (action === "content") throw new HttpError(403, "Source editing is available only on the local host");
    if (action === "comments") {
      ensure(canDiscussCollaboration(actor), 403, "Discussion permission required");
      if (method === "POST" && !commentId) {
        const operation = this.operation(actor, path, body, (next) => {
          ensure(next.comments.filter((comment) => comment.roomId === roomId).length < 1000, 409, "Comment limit reached");
          const now = Date.now();
          const comment: CollaborationComment = { id: crypto.randomUUID(), roomId: room.id, anchor: this.anchor(body.anchor, roomId), status: "open",
            messages: [{ id: crypto.randomUUID(), authorId: actor.id, authorName: actor.name, body: short(body.body, 8000, "comment"), createdAt: now }],
            resolvedBy: null, updatedAt: now };
          next.comments.push(comment); return comment;
        });
        if (!operation.replay) this.broadcast({ type: "comments", comments: this.state().comments.filter((comment) => comment.roomId === roomId) }, roomId);
        return json(operation.result);
      }
      if (method === "PATCH" && commentId) {
        if (body.status !== undefined) ensure(canWriteCollaboration(actor), 403, "Only project writers can resolve comments");
        const operation = this.operation(actor, path, body, (next) => {
          const comment = next.comments.find((c) => c.id === commentId && c.roomId === roomId); ensure(comment, 404, "Comment not found");
          ensure(body.status !== undefined || body.body !== undefined, 400, "No comment change supplied");
          if (body.status !== undefined) { ensure(body.status === "open" || body.status === "resolved", 400, "Invalid comment status"); comment.status = body.status; comment.resolvedBy = body.status === "resolved" ? actor.id : null; }
          if (body.body !== undefined) {
            ensure(comment.messages.length < 200, 409, "Reply limit reached");
            comment.messages.push({ id: crypto.randomUUID(), authorId: actor.id, authorName: actor.name, body: short(body.body, 8000, "reply"), createdAt: Date.now() });
          }
          comment.updatedAt = Date.now(); return comment;
        });
        if (!operation.replay) this.broadcast({ type: "comments", comments: this.state().comments.filter((comment) => comment.roomId === roomId) }, roomId);
        return json(operation.result);
      }
    }
    if (action === "chat" && method === "POST") {
      ensure(canDiscussCollaboration(actor), 403, "Discussion permission required");
      const operation = this.operation(actor, path, body, (next) => {
        ensure(next.messages.filter((message) => message.roomId === roomId).length < 1000, 409, "Chat limit reached");
        const message = { id: crypto.randomUUID(), roomId: room.id, authorId: actor.id, authorName: actor.name, body: short(body.body, 8000, "chat message"), createdAt: Date.now() };
        next.messages.push(message); return message;
      });
      if (!operation.replay) this.broadcast({ type: "chat", message: operation.result }, roomId, true);
      return json(operation.result);
    }
    if (action === "links") {
      ensure(canManageCollaborationRoom(actor, room), 403, "Room owner or administrator required");
      if (method === "POST") {
        const seconds = body.expiresInSeconds ?? 3600; const access = body.access ?? "view";
        ensure(Number.isInteger(seconds) && Number(seconds) >= 60 && Number(seconds) <= 7 * 86400, 400, "Guest expiry must be 60 seconds to seven days");
        ensure(access === "view" || access === "comment", 400, "Invalid invitation access");
        const token = crypto.randomUUID() + crypto.randomUUID(); const tokenHash = await sha256(token);
        const currentActor = this.requireIdentity(credential); ensure(canManageCollaborationRoom(currentActor, this.room(currentActor, roomId)), 403, "Room owner or administrator required");
        const expiresAt = Date.now() + Number(seconds) * 1000;
        this.mutate((next) => {
          next.invitations = next.invitations.filter((i) => i.expiresAt > Date.now());
          ensure(next.invitations.length < LIMITS.invitations, 409, "Invitation limit reached");
          next.invitations.push({ id: crypto.randomUUID(), tokenHash, roomId: room.id, expiresAt, access });
        });
        await this.scheduleExpiry(); return json({ token, expiresAt, roomId: room.id, access });
      }
      if (method === "DELETE") {
        this.mutate((next) => { next.invitations = next.invitations.filter((invite) => invite.roomId !== roomId); next.guests = next.guests.filter((guest) => next.invitations.some((invite) => invite.id === guest.invitationId)); });
        this.reconcileAccess(); await this.scheduleExpiry(); return json({ ok: true });
      }
    }
    throw new HttpError(405, "Method not allowed");
  }

  private async asset(request: Request, url: URL): Promise<Response> {
    ensure(request.method === "GET" || request.method === "HEAD", 405, "Read-only assets");
    const match = /^\/rooms\/([a-zA-Z0-9_-]+)\/revisions\/(\d+)\/([^/]+)\/(.+)$/.exec(url.pathname);
    ensure(match, 404, "Not found");
    const [, roomId, revision, token, rawPath] = match;
    const grant = await this.parseGrant(token!, roomId!);
    let path: string;
    try { path = decodeURIComponent(rawPath!); } catch { throw new HttpError(400, "Invalid resource path"); }
    ensure(publicPath(path), 403, "Private resource");
    const manifest = this.ctx.storage.sql.exec<{ files: string }>("SELECT files FROM room_manifests WHERE room_id=? AND revision=?", roomId!, Number(revision)).toArray()[0];
    ensure(manifest, 404, "Resource revision is unavailable");
    const file = (JSON.parse(manifest.files) as PublishedFile[]).find((entry) => entry.path === path);
    ensure(file, 404, "Resource is unavailable");
    const object = await this.env.BLOBS.get(`${this.state().project.id}/${file.hash}`);
    this.room(this.requireIdentity(grant.c), roomId);
    ensure(grant.v === this.recordRoom(roomId).grantEpoch && grant.e > Date.now(), 403, "Asset grant expired");
    ensure(object && object.size === file.size, 404, "Resource is unavailable");
    const base = `/projects/${this.state().project.id}/rooms/${roomId}/revisions/${revision}/${token}/`;
    const originalBytes = request.headers.get("X-Pneuma-Publication-Bytes") === "1";
    let body: BodyInit | null = object.body;
    if (!originalBytes && /\.html?$/i.test(path)) {
      let html = await object.text();
      html = html.replace(/\b(src|href|poster)=(['"])\/(?!\/)/gi, `$1=$2${base}`)
        .replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${base}`);
      const frameScriptUrl = this.recordRoom(roomId).frameScriptUrl ?? this.state().frameScriptUrl;
      const frameScript = this.recordRoom(roomId).frameScript ?? this.state().frameScript;
      const script = frameScriptUrl
        ? `<script src="${frameScriptUrl!.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></script>`
        : `<script>${frameScript.replace(/<\/script/gi, "<\\/script")}</script>`;
      body = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${script}</body>`) : html + script;
    } else if (!originalBytes && /\.css$/i.test(path)) body = (await object.text()).replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${base}`);
    this.room(this.requireIdentity(grant.c), roomId);
    ensure(grant.v === this.recordRoom(roomId).grantEpoch && grant.e > Date.now(), 403, "Asset grant expired");
    return new Response(request.method === "HEAD" ? null : body, { headers: responseHeaders({
      "Content-Type": originalBytes ? "application/octet-stream" : file.type,
      ...(originalBytes ? { "Content-Disposition": "attachment" } : {}), "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": COLLABORATION_RESOURCE_CSP,
    }) });
  }

  private async upgrade(request: Request, url: URL, publisher: boolean): Promise<Response> {
    ensure(request.headers.get("upgrade")?.toLowerCase() === "websocket", 426, "WebSocket upgrade required");
    // Canonical project sockets authenticate explicit bearer credentials, never cookies.
    ensure(request.headers.get("x-collaboration-scoped") === "true" || !request.headers.get("origin")
      || request.headers.get("origin") === url.origin, 403, "Cross-origin legacy socket refused");
    const credential = await sha256(short(url.searchParams.get("token"), 256, "credential"));
    const roomId = publisher ? this.requirePublisher(credential, url.searchParams.get("roomId") ?? undefined).id : null;
    if (publisher) ensure(!this.publisher(roomId!), 409, "Another publisher is connected for this room");
    else { const actor = this.requireIdentity(credential);
      if (actor.kind === "guest") this.requireHost(actor, actor.roomId!);
      else if (request.headers.get("x-collaboration-scoped") !== "true" && this.state().rooms[0] && !this.state().rooms[0]!.compatibility) this.requireHost(actor, this.state().rooms[0]!.id);
    }
    ensure(this.sockets().length < LIMITS.connections
      && this.sockets().filter((s) => this.socketData(s).credential === credential).length < 8, 429, "Connection limit reached");
    const pair = new WebSocketPair();
    const socket = pair[1];
    const data: SocketData = { kind: publisher ? "publisher" : "participant", id: crypto.randomUUID(), credential,
      origin: url.origin, roomId, presence: null, closed: false, windowAt: Date.now(), count: 0, lastRelayed: 0, lastSeenAt: Date.now() };
    this.ctx.acceptWebSocket(socket, [data.kind]); socket.serializeAttachment(data);
    if (publisher) {
      socket.send(JSON.stringify({ type: "publisher_ready", publisherId: data.id,
        roomId, revision: this.recordRoom(roomId!).revision, fingerprint: this.recordRoom(roomId!).fingerprint }));
      this.broadcastProject();
    } else this.send(socket, { type: "welcome", connectionId: data.id, state: this.projectState(this.requireIdentity(credential), url.origin) });
    this.reconcileHosting();
    await this.scheduleExpiry();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS" && url.pathname === "/api/project") return new Response(null, { status: 204, headers: responseHeaders() });
      if (url.pathname === "/api/project" && request.method === "DELETE") return await this.deleteProject(request);
      if (this.data) requireActiveProject(this.data);
      if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: responseHeaders() });
      if (url.pathname === "/internal/bootstrap" && request.method === "POST") return await this.bootstrap(request);
      this.state();
      if (url.pathname === "/api/identity" && request.method === "GET") {
        return json({ version: 1, kind: "cloud", projectId: this.state().project.id, origin: url.origin });
      }
      this.reconcileHosting();
      if (url.pathname === "/ws" && request.method === "GET") return await this.upgrade(request, url, false);
      if (url.pathname === "/publisher/ws" && request.method === "GET") return await this.upgrade(request, url, true);
      if (url.pathname.startsWith("/api/publisher/")) return await this.publisherRequest(request, url);
      if (url.pathname === "/api/invitations/redeem" && request.method === "POST") return await this.redeem(request);
      if (url.pathname.startsWith("/api/")) return await this.actorRequest(request, url);
      if (url.pathname.startsWith("/rooms/")) return await this.asset(request, url);
      throw new HttpError(404, "Not found");
    } catch (error) {
      if (this.data?.removal) return json({ error: "Project was removed", code: "project_removed" }, 410);
      if (error instanceof HttpError) return json({ error: error.message, ...(error instanceof ProjectRemovedError ? { code: error.code } : {}) }, error.status);
      console.error(JSON.stringify({ event: "collaboration_request_failed", error: error instanceof Error ? error.name : "UnknownError" }));
      return json({ error: "Collaboration request failed" }, 500);
    }
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      requireActiveProject(this.state());
      // Expired leases cannot be revived by a late heartbeat racing the alarm.
      this.reconcileHosting();
      const data = this.socketData(socket);
      ensure(!data.closed, 401, "Connection is closed");
      const now = Date.now();
      if (now - data.windowAt >= 1000) { data.windowAt = now; data.count = 0; }
      ensure(++data.count <= 120, 429, "Socket rate exceeded");
      ensure(typeof raw === "string" && encoder.encode(raw).length <= 16 * 1024, 413, "Invalid socket payload");
      const message = JSON.parse(raw) as Body;
      socket.serializeAttachment(data);
      if (data.kind === "publisher") {
        this.requirePublisher(data.credential, data.roomId!);
        ensure(message.type === "ping" && finite(message.sentAt, Number.MAX_SAFE_INTEGER), 400, "Publisher sockets only accept ping");
        data.lastSeenAt = now; socket.serializeAttachment(data);
        socket.send(JSON.stringify({ type: "pong", sentAt: message.sentAt, serverAt: now })); return;
      }
      const actor = this.requireIdentity(data.credential);
      if (message.type === "ping") {
        ensure(finite(message.sentAt, Number.MAX_SAFE_INTEGER), 400, "Invalid ping");
        data.lastSeenAt = now; socket.serializeAttachment(data);
        this.send(socket, { type: "pong", sentAt: message.sentAt, serverAt: now }); return;
      }
      if (message.type === "leave") { this.leave(socket); this.reconcileHosting(); await this.scheduleExpiry(); return; }
      if (message.type === "join") {
        const room = this.room(actor, short(message.roomId, 100, "room id"));
        this.leave(socket);
        const next = this.socketData(socket); next.roomId = room.id; next.lastSeenAt = now;
        next.presence = { id: next.id, memberId: actor.id, name: actor.name, role: actor.role, roomId: room.id,
          color: COLORS[parseInt(data.credential.slice(0, 4), 16) % COLORS.length]!, view: null, cursor: null, followingId: null, updatedAt: now };
        socket.serializeAttachment(next);
        this.reconcileHosting();
        await this.scheduleExpiry();
        const state = await this.roomState(data.credential, room.id);
        this.send(socket, { type: "room", state });
        const current = this.socketData(socket);
        if (current.presence) this.broadcast({ type: "presence", participant: current.presence, sentAt: 0 }, room.id);
        if (room.publicationError) this.send(socket, { type: "error", message: `Publication update failed: ${room.publicationError}` });
        return;
      }
      ensure(message.type === "presence", 400, "Unsupported socket message");
      ensure(data.roomId && data.presence, 400, "Join a room first");
      const room = this.room(actor, data.roomId!);
      const semanticView = message.semanticView;
      const semanticPointer = message.semanticPointer;
      ensure(semanticView === undefined || isViewerViewState(semanticView), 400, "Invalid semantic viewer state");
      ensure(semanticPointer === undefined || semanticPointer === null || isCollaborationJson(semanticPointer) && typeof semanticPointer === "object" && !Array.isArray(semanticPointer), 400, "Invalid semantic pointer");
      const semantic = semanticView !== undefined || semanticPointer !== undefined;
      ensure(!semantic || Number.isInteger(message.revision) && Number(message.revision) > 0 && Number(message.revision) <= room.revision, 400, "Semantic presence requires a publication revision");
      ensure(message.view !== null || semantic, 400, "Viewer state required");
      const view = message.view === null ? null : validateView(message.view, room);
      const cursor = message.cursor as { x: number; y: number } | null;
      ensure(cursor === null || cursor && finite(cursor.x) && finite(cursor.y), 400, "Invalid cursor");
      const followingId = message.followingId;
      ensure(followingId === null || typeof followingId === "string" && followingId !== data.id
        && this.participants().some((other) => { const candidate = this.socketData(other); return candidate.id === followingId && candidate.roomId === room.id; }), 400, "Invalid follow target");
      ensure(finite(message.sentAt, Number.MAX_SAFE_INTEGER), 400, "Invalid measurement timestamp");
      data.lastSeenAt = now;
      data.sequence = (data.sequence ?? 0) + 1;
      data.presence = { ...data.presence, role: actor.role, view,
        revision: semantic ? Number(message.revision) : view?.revision, sequence: data.sequence,
        ...(semanticView !== undefined ? { semanticView: semanticView as NonNullable<CollaborationPresence["semanticView"]> } : {}),
        ...(semanticPointer !== undefined ? { semanticPointer: semanticPointer as CollaborationPresence["semanticPointer"] } : {}),
        cursor: cursor ? { x: cursor.x, y: cursor.y } : null, followingId, updatedAt: now };
      const update = { participant: data.presence, sentAt: message.sentAt };
      if (now - data.lastRelayed >= 16) {
        data.lastRelayed = now; this.pendingPresence.delete(socket); this.broadcast({ type: "presence", ...update }, room.id);
      } else {
        this.pendingPresence.set(socket, update);
        if (!this.presenceTimer) this.presenceTimer = setTimeout(() => {
          this.presenceTimer = null;
          for (const [connection, latest] of this.pendingPresence) {
            const current = this.socketData(connection);
            if (!current.closed && current.roomId && this.identity(current.credential)) {
              current.lastRelayed = Date.now(); connection.serializeAttachment(current);
              this.broadcast({ type: "presence", ...latest }, current.roomId);
            }
          }
          this.pendingPresence.clear();
        }, 16);
      }
      socket.serializeAttachment(data);
    } catch (error) {
      if (error instanceof HttpError && [401, 423, 429].includes(error.status)) {
        this.close(socket, error.message, error.status === 423 ? "host_offline" : undefined);
        this.reconcileHosting(); await this.scheduleExpiry(); return;
      }
      const data = this.socketData(socket);
      if (data.kind === "participant") this.send(socket, { type: "error", message: error instanceof HttpError ? error.message : "Invalid socket message" });
      else socket.send(JSON.stringify({ type: "error", message: "Invalid publisher message" }));
    }
  }
  async webSocketClose(socket: WebSocket): Promise<void> {
    const data = this.socketData(socket);
    if (!data.closed && data.kind === "participant") this.leave(socket);
    const current = this.socketData(socket); current.closed = true; socket.serializeAttachment(current);
    this.pendingPresence.delete(socket);
    try { socket.close(1000, "Connection closed"); } catch { /* Runtime already closed it. */ }
    this.reconcileHosting();
    await this.scheduleExpiry();
    if (data.kind === "publisher") this.broadcastProject();
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    this.close(socket, "Connection failed"); this.reconcileHosting(); await this.scheduleExpiry(); this.broadcastProject();
  }
}
