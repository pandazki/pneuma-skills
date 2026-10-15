import { validateCommentPreview } from "../../core/collaboration/comment-preview.js";
import type { CollaborationReference, CollaborationReferenceSource, CollaborationResolvedReference } from "../../core/types/collaboration-reference.js";
import { COLLABORATION_RESOURCE_CSP } from "../../core/types/collaboration-publication.js";
import { lstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { writePrivateJson } from "./local-state.js";
import { collaborationIdentityChallenge, type CollaborationAuthorityIdentity } from "../../core/types/collaboration-workspace.js";
import { extname, join, resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import {
  canDiscussCollaboration, canManageCollaborationRoom, canWriteCollaboration, isCollaborationHost,
  type CollaborationAnchor, type CollaborationComment, type CollaborationIdentity,
  type CollaborationMember, type CollaborationPresence, type CollaborationProjectState,
  type CollaborationRole, type CollaborationRoom, type CollaborationRoomState,
  type CollaborationServerMessage, type CollaborationView,
} from "../../core/types/collaboration.js";
import { HttpError, ensure, short, finite, validRole as role, publicMember, canonical,
  ProjectRemovedError, requireActiveProject, replayProjectRemoval, removeProject, resolveIdentity, validateRegistration, publicRoomRecord, validateFiles, validateProjection, validateView, collaborationLeaseIsLive, validateFrameScriptUrl, validateReferenceSource, requireReferenceDestination, validateReferenceRoom, requireReferenceQuota, COLLABORATION_REFERENCE_LIMIT,
  COLLABORATION_OWNER_LEASE_MS, COLLABORATION_PUBLISHER_LEASE_MS, COLLABORATION_HOST_OFFLINE, LIMITS,
} from "../../core/collaboration/authority-domain.js";
import { isCollaborationJson, isViewerViewState } from "../../core/types/viewer-collaboration.js";
import { createWorkspaceWatcher, type WorkspaceWatcher } from "../watch/index.js";
import { isContained } from "../utils.js";
import {
  CONTENT_LIMITS, contentPath, hash, publicPath, readContentSnapshot, writePage,
  type ContentSnapshot,
} from "./content.js";
import { CollaborationStore, type DurableState, type RoomRecord } from "./store.js";

export interface CollaborationHostOptions {
  project: { id: string; name: string };
  stateDir: string;
  rooms: Array<{
    id: string; title: string; mode: string; ownerId: string; root: string; page: string; enabled?: boolean;
  }>;
  members: Array<CollaborationMember & { token: string }>;
  port?: number;
  hostname?: string;
  /** Advertised LAN hostname or IP; binding and identity remain separate. */
  publicHostname?: string;
  frontendDir: string;
  /** Trusted instrumentation source, injected into the isolated static page. */
  frameScript: string;
}

type Ingress = "lan" | "public";

export interface CollaborationPublicIngressOptions {
  beforeActivity(): boolean;
  onConnectionsChanged(): void;
}

interface Connection {
  ingress: Ingress;
  id: string;
  kind: "participant" | "publisher";
  credential: string;
  roomId: string | null;
  presence: CollaborationPresence | null;
  latest: { participant: CollaborationPresence; sentAt: number } | null;
  windowAt: number;
  count: number;
  lastSeen: number;
  lastRelayed: number;
  sequence: number;
}

interface AssetGrant { ingress: Ingress; credential: string; roomId: string; expiresAt: number; epoch: number }
type Socket = ServerWebSocket<Connection>;
type Body = Record<string, unknown>;
const COLORS = ["#f97316", "#22c55e", "#38bdf8", "#a78bfa", "#fb7185", "#facc15"];
const MAX_REQUEST_BYTES = 4 * 1024 * 1024 + 128 * 1024;
const MAX_CONNECTIONS = 128;

/**
 * Dedicated static collaboration host. It never mounts session, agent, terminal,
 * proxy or arbitrary filesystem routes from the normal Pneuma runtime.
 */
export async function startCollaborationHost(options: CollaborationHostOptions) {
  short(options.project.id, 100, "project id");
  ensure(options.publicHostname === undefined || /^[a-zA-Z0-9.-]{1,253}$/.test(options.publicHostname), 400, "Invalid public hostname");
  short(options.project.name, 160, "project name");
  ensure(options.rooms.length <= 16, 400, "Provide up to 16 publication roots");
  ensure(options.members.length > 0 && options.members.length <= 100, 400, "Provide 1–100 members");
  const roomConfigs = new Map(options.rooms.map((room) => [room.id, { ...room, root: resolve(room.root) }]));
  ensure(roomConfigs.size === options.rooms.length, 400, "Duplicate room id");
  for (const room of roomConfigs.values()) {
    ensure(/^[a-zA-Z0-9_-]{1,100}$/.test(room.id), 400, "Invalid room id");
    short(room.title, 160, "room title");
    short(room.mode, 80, "mode");
    short(room.ownerId, 100, "owner id");
    ensure(publicPath(room.page) && /\.html?$/.test(room.page), 400, "Room page must be a public HTML file");
    ensure(lstatSync(room.root).isDirectory() && !lstatSync(room.root).isSymbolicLink(), 400, "Publication root must be a real directory");
    ensure(!isContained(resolve(options.stateDir), room.root), 400, "State directory must be outside publication roots");
    contentPath(room.root, room.page);
  }
  ensure(new Set(options.members.map((m) => m.id)).size === options.members.length, 400, "Duplicate member id");
  ensure(new Set(options.members.map((m) => m.token)).size === options.members.length, 400, "Duplicate member credential");
  for (const member of options.members) {
    short(member.id, 100, "member id"); short(member.name, 100, "member name");
    short(member.token, 256, "member credential"); role(member.role);
  }
  ensure(options.members.some((m) => m.role === "admin"), 400, "At least one administrator is required");

  const store = new CollaborationStore(options.stateDir);
  let state = store.load();
  if (!state) {
    state = {
      project: options.project, bootstrapHash: "local-bootstrap", grantKey: crypto.randomUUID(), frameScript: options.frameScript, workspaces: [], references: [],
      members: options.members.map(({ token, ...member }) => ({ ...member, tokenHash: hash(token) })),
      rooms: options.rooms.map(({ root: _root, ...room }) => ({
        ...room, enabled: room.enabled ?? true, revision: 0, updatedAt: Date.now(), fingerprint: "",
        publisherHash: hash(crypto.randomUUID()), grantEpoch: 0, hostSessionActive: false, publicationError: null,
      })),
      guests: [], invitations: [], comments: [], messages: [],
    };
    store.save(state);
  }
  // Bootstrap credentials only initialize a new database; restart cannot resurrect revoked users.
  if (!state.references) { state.references = []; store.save(state); }
  if (!state.project) {
    const legacy = state as DurableState & { projectId: string };
    state.project = { id: legacy.projectId, name: options.project.name };
    state.bootstrapHash = "local-bootstrap"; state.grantKey = crypto.randomUUID(); state.frameScript = options.frameScript;
    state.workspaces = []; state.invitations = [];
    state.guests = [];
    state.rooms = state.rooms.map((room) => ({ ...room, publisherHash: room.publisherHash || hash(crypto.randomUUID()),
      grantEpoch: room.grantEpoch ?? 0, hostSessionActive: false, publicationError: null }));
    store.save(state);
  }
  if (state.project.id !== options.project.id) { store.close(); throw new Error("State belongs to a different project"); }
  const activeState: () => DurableState = () => state!;
  const identityPath = join(options.stateDir, "authority-identity.json");
  let identityKeys: { privateKey: string; publicKey: string };
  try { identityKeys = JSON.parse(await readFile(identityPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") { store.close(); throw error; }
    const pair = generateKeyPairSync("ed25519");
    identityKeys = { privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
    await writePrivateJson(identityPath, identityKeys);
  }
  const signingKey = createPrivateKey(identityKeys.privateKey);
  ensure(createPublicKey(signingKey).export({ type: "spki", format: "der" }).toString("base64") === identityKeys.publicKey, 500, "Invalid authority identity");
  const sockets = new Set<Socket>();
  const publishers = new Set<Socket>();
  const internalPublisherSeen = new Map(options.rooms.map((room) => [room.id, Date.now()]));
  const grants = new Map<string, AssetGrant>();
  const rate = new Map<string, { at: number; count: number }>();
  const watchers: WorkspaceWatcher[] = [];
  const publicationErrors = new Set<string>();
  let closed = false;
  let publicServer: ReturnType<typeof Bun.serve<Connection>> | null = null;
  let publicOrigin: string | null = null;
  let publicAdmission = false;
  let publicHooks: CollaborationPublicIngressOptions | null = null;
  function publicChanged(): void { publicHooks?.onConnectionsChanged(); }
  function publicAllowed(): boolean { return publicAdmission && !!publicHooks?.beforeActivity(); }


  function identity(credential: string): CollaborationIdentity | null {
    return resolveIdentity(activeState(), credential);
  }

  function hostOnline(roomId: string): boolean {
    const now = Date.now();
    const publisher = [...publishers].find((socket) => socket.data.roomId === roomId && collaborationLeaseIsLive(socket.data.lastSeen, "publisher", now));
    const internal = collaborationLeaseIsLive(internalPublisherSeen.get(roomId), "publisher", now);
    if (!publisher && !internal) return false;
    const room = activeState().rooms.find((room) => room.id === roomId && !room.removed);
    return !!room && [...sockets].some((socket) => socket.data.roomId === roomId
      && collaborationLeaseIsLive(socket.data.lastSeen, "owner", now)
      && !!identity(socket.data.credential) && isCollaborationHost(identity(socket.data.credential)!, room));
  }
  function publicRoom(room: RoomRecord): CollaborationRoom { return publicRoomRecord(room, hostOnline(room.id)); }
  function requireHost(room: RoomRecord, actor?: CollaborationIdentity): void {
    ensure(actor && isCollaborationHost(actor, room) || hostOnline(room.id), 423, COLLABORATION_HOST_OFFLINE);
  }
  function closeParticipant(socket: Socket, reason: string, hostOffline = false): void {
    if (!sockets.has(socket)) return;
    try { socket.send(JSON.stringify({ type: "closed", reason, ...(hostOffline ? { code: "host_offline" } : {}) })); } catch { /* Closing transport. */ }
    sockets.delete(socket); leave(socket); socket.close(1008, reason); publicChanged();
  }
  function reconcileHosting(): void {
    if (activeState().removal) return;
    const now = Date.now();
    for (const socket of publishers) if (!collaborationLeaseIsLive(socket.data.lastSeen, "publisher", now)) {
      publishers.delete(socket); socket.close(1008, "Publisher lease expired");
    }
    for (const socket of sockets) {
      const room = activeState().rooms.find((room) => room.id === socket.data.roomId);
      const actor = identity(socket.data.credential);
      if (room && actor && isCollaborationHost(actor, room) && !collaborationLeaseIsLive(socket.data.lastSeen, "owner", now))
        closeParticipant(socket, "Owner view lease expired", true);
    }
    let changed = false;
    for (const room of activeState().rooms.filter((room) => !room.removed)) {
      const online = hostOnline(room.id);
      if (room.hostSessionActive !== online) {
        changed = true; mutate((next) => { const target = next.rooms.find((entry) => entry.id === room.id)!;
          target.hostSessionActive = online; target.grantEpoch++; });
      }
      if (!online) for (const socket of sockets) {
        const actor = identity(socket.data.credential);
        if (socket.data.roomId === room.id && (!actor || !isCollaborationHost(actor, room))) closeParticipant(socket, COLLABORATION_HOST_OFFLINE, true);
      }
    }
    for (const [key, grant] of grants) {
      const room = activeState().rooms.find((room) => room.id === grant.roomId);
      if (!room || room.grantEpoch !== grant.epoch) grants.delete(key);
    }
    if (changed) for (const socket of sockets) {
      const actor = identity(socket.data.credential);
      if (actor) send(socket, { type: "project", state: projectState(actor, socket.data.ingress) });
    }
  }

  function requireIdentity(credential: string): CollaborationIdentity {
    requireActiveProject(activeState());
    const actor = identity(credential);
    ensure(actor, 401, "Credential is invalid or expired");
    return actor;
  }

  function getRoom(id: string, actor: CollaborationIdentity, requireEnabled = true): RoomRecord {
    ensure(actor.kind === "member" || actor.roomId === id, 404, "Room not found");
    const room = activeState().rooms.find((entry) => entry.id === id && !entry.removed);
    ensure(room, 404, "Room not found");
    if (requireEnabled) requireHost(room, actor);
    if (requireEnabled) ensure(room.enabled, 403, "Room sharing is disabled");
    return room;
  }

  function projectState(actor: CollaborationIdentity, ingress: Ingress = "lan"): CollaborationProjectState {
    return {
      project: { ...options.project }, self: actor,
      members: actor.kind === "member" ? activeState().members.map(publicMember) : [],
      workspaces: actor.kind === "member" ? activeState().workspaces.map((workspace) => ({ ...workspace })) : [], publicOrigin: ingress === "public" ? publicOrigin ?? authorityOrigin : authorityOrigin, authorityKind: "lan", access: { lanOrigin: authorityOrigin, publicOrigin }, capabilities: { editSource: false },
      rooms: activeState().rooms.filter((room) => !room.removed
        && (actor.kind === "guest" ? actor.roomId === room.id && room.enabled
          : room.enabled || actor.role === "admin" || actor.id === room.ownerId)).map(publicRoom),
    };
  }

  function pageUrl(room: RoomRecord, credential: string, revision = room.revision, ingress: Ingress = "lan"): string {
    let grant = [...grants.entries()].find(([, value]) =>
      value.ingress === ingress && value.credential === credential && value.roomId === room.id && value.epoch === room.grantEpoch && value.expiresAt > Date.now() + 60_000)?.[0];
    if (!grant) {
      ensure(grants.size < 4096, 503, "Asset grant capacity reached");
      grant = crypto.randomUUID();
      grants.set(grant, { ingress, credential, roomId: room.id, expiresAt: Date.now() + 60 * 60_000, epoch: room.grantEpoch });
    }
    return `/projects/${options.project.id}/rooms/${room.id}/revisions/${revision}/${grant}/${room.page.split("/").map(encodeURIComponent).join("/")}`;
  }

  function roomState(room: RoomRecord, credential: string, actor: CollaborationIdentity, ingress: Ingress = "lan"): CollaborationRoomState {
    const publication = store.manifest(room.id, room.revision);
    return {
      ...(publication ? { publication: { revision: room.revision, ...publication } } : {}),
      room: publicRoom(room),
      participants: [...sockets].flatMap((socket) => socket.data.roomId === room.id && socket.data.presence ? [socket.data.presence] : []),
      comments: activeState().comments.filter((comment) => comment.roomId === room.id),
      messages: actor.kind === "guest" && actor.guestAccess !== "comment" ? [] : activeState().messages.filter((message) => message.roomId === room.id),
      pageUrl: pageUrl(room, credential, room.revision, ingress),
    };
  }

  function send(socket: Socket, message: CollaborationServerMessage, ephemeral = false): void {
    const actor = identity(socket.data.credential);
    if (!actor) { socket.close(1008, "Access revoked"); return; }
    const room = activeState().rooms.find((room) => room.id === socket.data.roomId && !room.removed);
    if (room && !isCollaborationHost(actor, room) && !hostOnline(room.id)) return;
    if (socket.getBufferedAmount() > 256 * 1024) {
      if (!ephemeral) socket.close(1013, "Reconnect for a fresh snapshot");
      return;
    }
    try { socket.send(JSON.stringify(message)); } catch { socket.close(); }
  }

  function broadcastRoom(roomId: string, message: CollaborationServerMessage, ephemeral = false, membersOnly = false): void {
    for (const socket of sockets) {
      if (socket.data.roomId !== roomId) continue;
      const actor = identity(socket.data.credential);
      if (!actor || membersOnly && actor.kind === "guest" && actor.guestAccess !== "comment") continue;
      send(socket, message, ephemeral);
    }
  }

  function leave(socket: Socket): void {
    if (socket.data.kind === "publisher") return;
    const roomId = socket.data.roomId;
    socket.data.roomId = null; socket.data.presence = null; socket.data.latest = null;
    if (roomId) broadcastRoom(roomId, { type: "departed", connectionId: socket.data.id });
  }

  function reconcileAccess(): void {
    for (const [key, grant] of grants) {
      if (grant.expiresAt <= Date.now() || !identity(grant.credential)
        || !activeState().rooms.some((room) => room.id === grant.roomId && room.enabled && !room.removed)) grants.delete(key);
    }
    for (const socket of sockets) {
      const actor = identity(socket.data.credential);
      const room = socket.data.roomId && activeState().rooms.find((entry) => entry.id === socket.data.roomId && !entry.removed && entry.enabled);
      if (!actor) {
        // Send directly because send() intentionally refuses revoked identities.
        socket.send(JSON.stringify({ type: "closed", reason: "Access revoked or room sharing disabled" }));
        leave(socket); socket.close(1008, "Access revoked"); continue;
      }
      // A project member keeps their directory connection when one room closes.
      // Owners/admins need that live connection to turn sharing back on.
      if (socket.data.roomId && !room) {
        const registered = activeState().rooms.find((room) => room.id === socket.data.roomId);
        if (!registered || !isCollaborationHost(actor, registered)) closeParticipant(socket, COLLABORATION_HOST_OFFLINE, true);
        else leave(socket);
      }
      if (socket.data.presence) {
        socket.data.presence.role = actor.role;
        broadcastRoom(socket.data.presence.roomId, { type: "presence", participant: socket.data.presence, sentAt: 0 }, true);
      }
      send(socket, { type: "project", state: projectState(actor, socket.data.ingress) });
    }
    for (const socket of publishers) if (!activeState().rooms.some((room) => !room.removed && room.publisherHash === socket.data.credential)) { publishers.delete(socket); socket.close(1008, "Publishing revoked"); }
    reconcileHosting();
  }

  function publishSnapshot(room: RoomRecord, snapshot: ContentSnapshot): RoomRecord {
    if (activeState().removal) return room;
    if (room.fingerprint === snapshot.fingerprint) return room;
    const next = structuredClone(activeState());
    const updated = next.rooms.find((entry) => entry.id === room.id)!;
    updated.revision++; updated.updatedAt = Date.now(); updated.fingerprint = snapshot.fingerprint;
    store.db.transaction(() => { store.snapshot(room.id, updated.revision, snapshot); store.save(next); })();
    state = next;
    for (const socket of sockets) {
      const actor = identity(socket.data.credential);
      if (socket.data.roomId === room.id && actor && updated.enabled) {
        send(socket, { type: "content", room: publicRoom(updated), pageUrl: pageUrl(updated, socket.data.credential, updated.revision, socket.data.ingress), publication: { revision: updated.revision, ...store.manifest(updated.id, updated.revision)! } });
      }
      if (actor && (actor.kind === "member" || actor.roomId === room.id)) {
        send(socket, { type: "project", state: projectState(actor, socket.data.ingress) });
      }
    }
    return updated;
  }

  function refresh(room: RoomRecord): RoomRecord {
    const config = roomConfigs.get(room.id)!;
    const snapshot = readContentSnapshot(config.root);
    ensure(snapshot.files.some((file) => file.path === room.page), 503,
      "Room page is missing; restore it on the host to resume publication");
    const recovered = publicationErrors.delete(room.id);
    const updated = publishSnapshot(room, snapshot);
    // Restoring identical bytes still acknowledges recovery without inventing a new revision.
    if (recovered && room.fingerprint === snapshot.fingerprint) {
      for (const socket of sockets) {
        if (socket.data.roomId === room.id && identity(socket.data.credential)) {
          send(socket, { type: "content", room: publicRoom(updated), pageUrl: pageUrl(updated, socket.data.credential, updated.revision, socket.data.ingress), publication: { revision: updated.revision, ...store.manifest(updated.id, updated.revision)! } });
        }
      }
    }
    return updated;
  }

  function mutate<T>(change: (next: DurableState) => T): T {
    requireActiveProject(activeState());
    const next = structuredClone(activeState());
    const result = change(next);
    store.db.transaction(() => store.save(next))();
    state = next;
    return result;
  }

  function operation<T>(actor: CollaborationIdentity, path: string, body: Body, change: (next: DurableState) => T, afterSave?: (next: DurableState) => void): T {
    const opId = short(body.opId, 100, "operation id");
    const fingerprint = hash(`${path}\n${canonical(body)}`);
    const prior = store.receipt(actor.id, opId);
    if (prior) {
      ensure(prior.fingerprint === fingerprint, 409, "Operation id was used for different input");
      return prior.result as T;
    }
    ensure(store.receiptCount() < 100_000, 503, "Experiment operation capacity reached");
    const next = structuredClone(activeState());
    const result = change(next);
    store.db.transaction(() => { store.save(next); afterSave?.(next); store.record(actor.id, opId, fingerprint, result); })();
    state = next;
    return result;
  }

  function validateAnchor(value: unknown, room: RoomRecord): CollaborationAnchor {
    ensure(value && typeof value === "object" && !Array.isArray(value), 400, "Invalid comment anchor");
    const anchor = value as CollaborationAnchor;
    ensure(anchor.address && typeof anchor.address === "object" && !Array.isArray(anchor.address)
      && JSON.stringify(anchor.address).length <= 4096, 400, "Invalid viewer address");
    ensure(Number.isInteger(anchor.revision) && anchor.revision > 0 && anchor.revision <= room.revision
      && finite(anchor.x) && finite(anchor.y), 400, "Invalid comment coordinates or revision");
    if (anchor.quote !== undefined) short(anchor.quote, 1000, "anchor quote");
    let preview: CollaborationAnchor["preview"];
    try { preview = validateCommentPreview(anchor.preview); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid comment preview"); }
    return { address: anchor.address, revision: anchor.revision, x: anchor.x, y: anchor.y,
      ...(anchor.quote !== undefined ? { quote: anchor.quote } : {}), ...(preview ? { preview } : {}) };
  }

  function checkRate(credential: string): void {
    const now = Date.now();
    const prior = rate.get(credential);
    const window = prior && now - prior.at < 1000 ? prior : { at: now, count: 0 };
    rate.set(credential, window);
    ensure(++window.count <= 60, 429, "Request rate exceeded");
  }

  async function readBody(request: Request): Promise<Body> {
    if (!request.body) return {};
    ensure(Number(request.headers.get("content-length") || 0) <= MAX_REQUEST_BYTES, 413, "Request is too large");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new HttpError(413, "Request is too large"); }
      chunks.push(value);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      ensure(body && typeof body === "object" && !Array.isArray(body), 400, "Expected a JSON object");
      return body as Body;
    } catch { throw new HttpError(400, "Invalid JSON request"); }
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Publisher-Id", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra };
  }
  function json(value: unknown, status = 200): Response {
    return Response.json(value, { status, headers: headers() });
  }

  function asset(url: URL, request: Request, ingress: Ingress): Response | null {
    const match = /^\/rooms\/([a-zA-Z0-9_-]+)\/revisions\/(\d+)\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (!match) return null;
    ensure(request.method === "GET" || request.method === "HEAD", 405, "Read-only assets");
    const roomId = match[1]!;
    const revisionString = match[2]!;
    const token = match[3]!;
    const rawPath = match[4]!;
    const grant = grants.get(token);
    ensure(grant && grant.ingress === ingress && grant.roomId === roomId && grant.expiresAt > Date.now(), 403, "Asset grant is invalid or expired");
    const actor = requireIdentity(grant.credential);
    const room = getRoom(roomId, actor);
    ensure(grant.epoch === room.grantEpoch, 403, "Asset grant was invalidated");
    let path: string;
    try { path = decodeURIComponent(rawPath); } catch { throw new HttpError(400, "Invalid resource path"); }
    ensure(publicPath(path), 403, "Private resource");
    const found = store.file(roomId, Number(revisionString), path);
    ensure(found, 404, "Resource revision is unavailable");
    const originalBytes = request.headers.get("X-Pneuma-Publication-Bytes") === "1";
    let bytes: Uint8Array | string = found.bytes;
    const assetBase = `/projects/${options.project.id}/rooms/${roomId}/revisions/${revisionString}/${token}/`;
    if (!originalBytes && /\.html?$/i.test(path)) {
      let html = new TextDecoder().decode(bytes);
      // Keep origin-relative static references inside the read-only grant.
      html = html.replace(/\b(src|href|poster)=(['"])\/(?!\/)/gi, `$1=$2${assetBase}`);
      html = html.replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${assetBase}`);
      const instrumentation = room.frameScriptUrl
        ? `<script src="${room.frameScriptUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></script>`
        : `<script>${(room.frameScript ?? options.frameScript).replace(/<\/script/gi, "<\\/script")}</script>`;
      html = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, `${instrumentation}</head>`) : instrumentation + html;
      bytes = html;
    } else if (!originalBytes && extname(path).toLowerCase() === ".css") {
      bytes = new TextDecoder().decode(bytes).replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${assetBase}`);
    }
    return new Response(request.method === "HEAD" ? null : bytes as BodyInit, {
      headers: headers({
        "Content-Type": originalBytes ? "application/octet-stream" : found.file.type,
        ...(originalBytes ? { "Content-Disposition": "attachment" } : {}),
        "Access-Control-Allow-Origin": "*",
        // Opaque origin also enforced here; a caller omitting iframe sandbox cannot expose the host UI.
        "Content-Security-Policy": COLLABORATION_RESOURCE_CSP,
      }),
    });
  }

  function staticFrontend(url: URL, request: Request): Response {
    ensure(request.method === "GET" || request.method === "HEAD", 405, "Method not allowed");
    let path: string;
    try { path = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1)); }
    catch { throw new HttpError(400, "Invalid frontend path"); }
    ensure(publicPath(path), 404, "Not found");
    const absolute = contentPath(resolve(options.frontendDir), path);
    try {
      ensure(lstatSync(absolute).isFile(), 404, "Not found");
      return new Response(request.method === "HEAD" ? null : Bun.file(absolute), {
        headers: headers({ "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Not found");
      throw error;
    }
  }

  function registerWorkspace(actor: CollaborationIdentity, body: Body): Response {
    ensure(canWriteCollaboration(actor), 403, "Writing membership required");
    const id = short(body.id, 100, "workspace id");
    ensure(/^[a-zA-Z0-9_-]{1,100}$/.test(id) && body.placement === "local", 400, "Invalid workspace id or placement");
    const name = short(body.name, 160, "workspace name");
    const existing = activeState().workspaces.find((workspace) => workspace.id === id);
    if (existing) { ensure(existing.ownerId === actor.id, 403, "Workspace belongs to another member"); return json(existing); }
    const workspace = { id, projectId: options.project.id, ownerId: actor.id, name, placement: "local" as const };
    mutate((next) => { ensure(next.workspaces.length < 100, 409, "Workspace capacity reached"); next.workspaces.push(workspace); });
    reconcileAccess(); return json(workspace, 201);
  }
  function registerRoom(actor: CollaborationIdentity, body: Body): Response {
    ensure(canWriteCollaboration(actor), 403, "Writing membership required");
    const registration = validateRegistration(body, actor.id);
    ensure(activeState().workspaces.some((workspace) => workspace.id === registration.workspaceId && workspace.ownerId === actor.id), 403, "Register your own workspace before sharing a room");
    if (body.frameScript !== undefined) {
      ensure(typeof body.frameScript === "string" && Buffer.byteLength(body.frameScript) <= 256 * 1024, 400, "Invalid frame instrumentation");
      registration.frameScript = body.frameScript;
    }
    if (body.frameScriptUrl !== undefined) registration.frameScriptUrl = validateFrameScriptUrl(body.frameScriptUrl);
    const opId = body.opId === undefined ? undefined : short(body.opId, 100, "operation id");
    const operationActor = `room-registration:${actor.id}`;
    const fingerprint = canonical(body);
    if (opId) { const receipt = store.receipt(operationActor, opId); if (receipt) {
      ensure(receipt.fingerprint === fingerprint, 409, "Operation id was used for different input"); return json(receipt.result);
    } }
    const existing = activeState().rooms.find((room) => !room.removed && room.workspaceId === registration.workspaceId && room.modeInstanceId === registration.modeInstanceId);
    if (existing) {
      ensure(existing.ownerId === actor.id && existing.mode === registration.mode && canonical(existing.compatibility) === canonical(registration.compatibility), 409, "Room binding already exists with different ownership or compatibility");
      return json({ room: publicRoom(existing), existing: true });
    }
    const publisherToken = crypto.randomUUID() + crypto.randomUUID();
    const next = structuredClone(activeState());
    ensure(next.rooms.filter((room) => !room.removed).length < 16, 409, "Room limit reached");
    next.rooms.push({ ...registration, publisherHash: hash(publisherToken) });
    const result = { room: publicRoomRecord(next.rooms.at(-1)!, false), publisherToken };
    store.db.transaction(() => { store.save(next); if (opId) store.record(operationActor, opId, fingerprint, result); })();
    state = next;
    reconcileAccess(); return json(result, 201);
  }
  function requirePublisher(credential: string, roomId?: string): RoomRecord {
    requireActiveProject(activeState());
    const room = activeState().rooms.find((room) => !room.removed && room.publisherHash === credential && (!roomId || room.id === roomId));
    ensure(room, 401, "Publisher credential required for this room");
    ensure(activeState().members.some((member) => member.id === room.ownerId && (member.role === "writer" || member.role === "admin")), 403, "Room owner no longer has publishing access");
    return room;
  }
  function requirePublisherLease(request: Request, credential: string, roomId: string): RoomRecord {
    reconcileHosting();
    const room = requirePublisher(credential, roomId);
    const publisher = [...publishers].find((socket) => socket.data.roomId === roomId);
    ensure(publisher && publisher.data.id === request.headers.get("x-publisher-id"), 409, "Publisher connection changed; reconnect before publishing");
    return room;
  }
  async function binaryBody(request: Request, limit: number): Promise<Uint8Array> {
    ensure(Number(request.headers.get("content-length") || 0) <= limit, 413, "Request is too large");
    const chunks: Uint8Array[] = []; let length = 0;
    const reader = request.body?.getReader();
    if (reader) while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new HttpError(413, "Request is too large"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
  async function redeem(request: Request): Promise<Response> {
    const body = await readBody(request);
    const tokenHash = hash(short(body.token, 256, "invitation token"));
    const name = short(body.name, 100, "display name");
    const invitation = activeState().invitations.find((invite) => invite.tokenHash === tokenHash && invite.expiresAt > Date.now());
    ensure(invitation, 401, "Invitation is invalid or expired");
    const room = activeState().rooms.find((room) => room.id === invitation.roomId && room.enabled && !room.removed);
    ensure(room, 401, "Invitation is invalid or expired"); requireHost(room);
    const token = crypto.randomUUID() + crypto.randomUUID();
    mutate((next) => {
      next.guests = next.guests.filter((guest) => next.invitations.some((invite) => invite.id === guest.invitationId && invite.expiresAt > Date.now()));
      ensure(next.guests.length < LIMITS.guests, 409, "Guest session capacity reached");
      next.guests.push({ id: `guest-${crypto.randomUUID()}`, name, tokenHash: hash(token), invitationId: invitation.id });
    });
    return json({ token, roomId: room.id });
  }
  async function publisherRequest(request: Request, url: URL): Promise<Response> {
    const token = /^Bearer ([^\s]{1,256})$/.exec(request.headers.get("authorization") || "")?.[1];
    ensure(token, 401, "Bearer credential required"); const credential = hash(token);
    const scoped = /^\/api\/publisher\/rooms\/([^/]+)\/(.+)$/.exec(url.pathname);
    let room = requirePublisher(credential, scoped?.[1]);
    const path = scoped ? `/api/publisher/${scoped[2]}` : url.pathname;
    checkRate(credential);
    if (path === "/api/publisher/state" && request.method === "GET") return json({ room: publicRoom(room), revision: room.revision, fingerprint: room.fingerprint, hostOnline: hostOnline(room.id) });
    const upload = /^\/api\/publisher\/blobs\/([a-f0-9]{64})$/.exec(path);
    if (upload && request.method === "PUT") {
      const bytes = await binaryBody(request, CONTENT_LIMITS.fileBytes);
      requirePublisher(credential, room.id);
      ensure(hash(bytes) === upload[1], 400, "Blob hash does not match its bytes");
      const previous = store.uploaded(upload[1]!);
      if (previous) { ensure(previous.length === bytes.length, 409, "Blob size mismatch"); return json({ hash: upload[1], size: bytes.length }); }
      const usage = store.uploadUsage();
      ensure(usage.count < LIMITS.uploadedBlobs && usage.size + bytes.length <= LIMITS.uploadBytes, 409, "Project upload capacity reached");
      store.upload(upload[1]!, bytes); return json({ hash: upload[1], size: bytes.length });
    }
    if (path === "/api/publisher/commit" && request.method === "POST") {
      requirePublisherLease(request, credential, room.id);
      const body = await readBody(request);
      room = requirePublisherLease(request, credential, room.id);
      const opId = short(body.opId, 100, "operation id"); const fingerprint = canonical(body);
      const actor = `publisher:${room.id}`;
      const prior = store.receipt(actor, opId);
      if (prior) { ensure(prior.fingerprint === fingerprint, 409, "Operation id was used for different input"); return json(prior.result); }
      const files = validateFiles(body.files, room.page);
      const projection = validateProjection(body.projection, room);
      const digest = hash(projection ? canonical({ files, projection }) : JSON.stringify(files));
      ensure(digest === body.fingerprint, 400, "Manifest fingerprint does not match its files");
      const blobs = new Map<string, Uint8Array>();
      for (const file of files) {
        const bytes = store.uploaded(file.hash); ensure(bytes && bytes.length === file.size, 409, "Manifest references an unconfirmed resource");
        blobs.set(file.hash, bytes);
      }
      ensure(Number.isInteger(body.baseRevision) && body.baseRevision === room.revision, 409, "Published revision changed; reload before committing");
      ensure(store.receiptCount() < 100_000, 409, "Operation receipt capacity reached");
      const next = structuredClone(activeState()); const target = next.rooms.find((entry) => entry.id === room.id)!;
      const changed = target.fingerprint !== digest;
      if (changed) { target.revision++; target.fingerprint = digest; target.updatedAt = Date.now(); }
      target.publicationError = null;
      const result = { revision: target.revision, fingerprint: digest };
      store.db.transaction(() => {
        if (changed) store.snapshot(room.id, target.revision, { files, blobs, fingerprint: digest }, projection);
        store.save(next); store.record(actor, opId, fingerprint, result);
      })();
      state = next;
      broadcastContent(room.id); reconcileAccess(); return json(result);
    }
    if (path === "/api/publisher/error" && request.method === "POST") {
      requirePublisherLease(request, credential, room.id);
      const body = await readBody(request); requirePublisherLease(request, credential, room.id);
      ensure(typeof body.message === "string" && body.message.length <= 1000, 400, "Invalid publication error");
      mutate((next) => { next.rooms.find((entry) => entry.id === room.id)!.publicationError = body.message as string || null; });
      if (body.message) broadcastRoom(room.id, { type: "error", message: `Publication update failed: ${body.message}` });
      else broadcastContent(room.id);
      return json({ ok: true });
    }
    throw new HttpError(404, "Not found");
  }
  function broadcastContent(roomId: string): void {
    const room = activeState().rooms.find((room) => room.id === roomId)!;
    for (const socket of sockets) {
      if (socket.data.roomId !== roomId || !identity(socket.data.credential) || !room.enabled) continue;
      send(socket, { type: "content", room: publicRoom(room), pageUrl: pageUrl(room, socket.data.credential, room.revision, socket.data.ingress), publication: { revision: room.revision, ...store.manifest(room.id, room.revision)! } });
    }
  }

  function referenceSource(actor: CollaborationIdentity, value: unknown) {
    const source = validateReferenceSource(value, options.project.id);
    const room = validateReferenceRoom(activeState(), actor, source);
    ensure(hostOnline(room.id), 423, COLLABORATION_HOST_OFFLINE);
    const publication = store.manifest(room.id, source.publicationRevision);
    ensure(publication, 410, "The pinned source publication is unavailable");
    return { source, room, publication };
  }
  function referenceRequest(actor: CollaborationIdentity, credential: string, path: string, query: URLSearchParams, method: string, body: Body, ingress: Ingress): Response {
    ensure(actor.kind === "member", 403, "Project membership required for references");
    if (path === "/api/references" && method === "GET") {
      const workspaceId = query.get("workspaceId");
      if (workspaceId) ensure(activeState().workspaces.some((workspace) => workspace.id === workspaceId), 404, "Workspace not found");
      return json({ references: activeState().references.filter((reference) => !workspaceId || reference.destinationWorkspaceId === workspaceId) });
    }
    const match = /^\/api\/references\/([a-zA-Z0-9_-]+)(\/resolve)?$/.exec(path);
    if (match?.[2] && method === "GET") {
      const reference = activeState().references.find((reference) => reference.id === match[1]);
      ensure(reference, 410, "The reference was removed or is unavailable");
      const source = referenceSource(actor, reference.source);
      const result: CollaborationResolvedReference = { reference, compatibility: reference.compatibility,
        room: { ...publicRoom(source.room), revision: reference.source.publicationRevision },
        publication: { revision: reference.source.publicationRevision, ...source.publication },
        pageUrl: pageUrl(source.room, credential, reference.source.publicationRevision, ingress) };
      return json(result);
    }
    ensure(canWriteCollaboration(actor), 403, "Writing membership required");
    if (path === "/api/references" && method === "POST") {
      requireReferenceDestination(activeState(), actor, body.destinationWorkspaceId);
      const label = short(body.label, 160, "reference label");
      const reference = operation(actor, path, body, (next) => {
        const source = referenceSource(actor, body.source);
        ensure(next.references.length < COLLABORATION_REFERENCE_LIMIT, 409, "Reference capacity reached");
        requireReferenceQuota(next.references, source.source);
        const now = Date.now();
        const record: CollaborationReference = { id: crypto.randomUUID(), ownerId: actor.id,
          destinationWorkspaceId: String(body.destinationWorkspaceId), label, source: source.source,
          compatibility: { ...source.room.compatibility! }, createdAt: now, updatedAt: now };
        next.references.push(record); return record;
      });
      return json(reference, 201);
    }
    ensure(match && !match[2], 404, "Reference endpoint not found");
    if (method === "PATCH") {
      let updatedRoomId = "";
      const label = body.label === undefined ? undefined : short(body.label, 160, "reference label");
      let previousRoomId = "";
      const reference = operation(actor, path, body, (next) => {
        const record = next.references.find((reference) => reference.id === match[1]);
        ensure(record, 410, "The reference was removed or is unavailable");
        ensure(record.ownerId === actor.id, 403, "Only the destination workspace owner can refresh a reference");
        requireReferenceDestination(next, actor, record.destinationWorkspaceId);
        const source = referenceSource(actor, body.source); updatedRoomId = source.room.id;
        requireReferenceQuota(next.references, source.source, record.id);
        previousRoomId = record.source.roomId;
        record.source = source.source; record.compatibility = { ...source.room.compatibility! };
        if (label !== undefined) record.label = label;
        record.updatedAt = Date.now(); return record;
      }, (next) => {
        store.prune(previousRoomId, next.references); store.prune(updatedRoomId, next.references);
      });
      return json(reference);
    }
    if (method === "DELETE") {
      let previousRoomId = "";
      const result = operation(actor, path, body, (next) => {
        const reference = next.references.find((reference) => reference.id === match[1]);
        ensure(reference, 410, "The reference was removed or is unavailable");
        ensure(reference.ownerId === actor.id, 403, "Only the destination workspace owner can remove a reference");
        requireReferenceDestination(next, actor, reference.destinationWorkspaceId);
        previousRoomId = reference.source.roomId;
        next.references = next.references.filter((record) => record.id !== reference.id);
        return { ok: true, id: reference.id };
      }, (next) => store.prune(previousRoomId, next.references));
      return json(result);
    }
    throw new HttpError(405, "Method not allowed");
  }

  async function deleteProject(request: Request): Promise<Response> {
    const bearer = /^Bearer ([^\s]{1,256})$/.exec(request.headers.get("authorization") || "");
    if (activeState().removal && !bearer) throw new ProjectRemovedError();
    ensure(bearer, 401, "Bearer credential required");
    const credential = hash(bearer[1]!);
    const body = await readBody(request);
    const actor = identity(credential);
    const prior = replayProjectRemoval(activeState(), actor, body);
    if (prior) return json(prior);
    ensure(actor, 401, "Credential is invalid or expired");
    ensure(actor.kind === "member" && actor.role === "admin", 403, "Administrator membership required");
    const result = operation(actor, "/api/project", body, (next) => removeProject(next, actor, body));
    grants.clear(); internalPublisherSeen.clear();
    for (const socket of [...sockets]) closeParticipant(socket, "Project removed");
    for (const socket of [...publishers]) { publishers.delete(socket); socket.close(1008, "Project removed"); }
    return json(result);
  }

  async function api(request: Request, url: URL, ingress: Ingress): Promise<Response> {
    const bearer = /^Bearer ([^\s]{1,256})$/.exec(request.headers.get("authorization") || "");
    ensure(bearer, 401, "Bearer credential required");
    const credential = hash(bearer[1]!);
    requireIdentity(credential);
    checkRate(credential);
    const method = request.method;
    const body = method === "GET" || method === "DELETE" && !url.pathname.startsWith("/api/references/") ? {} : await readBody(request);
    // Authorization is resolved after every await, so in-flight requests cannot retain an old role.
    const actor = requireIdentity(credential);
    const discussion = /\/rooms\/[^/]+\/(comments|chat)(?:\/|$)/.test(url.pathname);
    if (method !== "GET") ensure(discussion ? canDiscussCollaboration(actor) : canWriteCollaboration(actor), 403, "Read-only membership");
    const path = url.pathname;
    if (path === "/api/state" && method === "GET") {
      if (actor.kind === "guest") requireHost(getRoom(actor.roomId!, actor), actor);
      return json(projectState(actor, ingress));
    }

    const memberMatch = /^\/api\/members(?:\/([^/]+))?$/.exec(path);
    if (memberMatch) {
      ensure(actor.kind === "member" && actor.role === "admin", 403, "Administrator required");
      const memberId = memberMatch[1];
      if (!memberId && method === "POST") {
        ensure(activeState().members.length < 100, 409, "Member limit reached");
        const token = crypto.randomUUID() + crypto.randomUUID();
        const member: CollaborationMember = { id: crypto.randomUUID(), name: short(body.name, 100, "member name").trim(), role: role(body.role) };
        mutate((next) => next.members.push({ ...member, tokenHash: hash(token) }));
        reconcileAccess();
        return json({ member, token });
      }
      const member = activeState().members.find((entry) => entry.id === memberId);
      ensure(member, 404, "Member not found");
      const newRole = method === "PATCH" ? role(body.role) : undefined;
      ensure(!activeState().rooms.some((room) => !room.removed && room.ownerId === member.id) || newRole === "writer" || newRole === "admin", 409, "Cannot remove or demote a registered room owner");
      ensure(!(member.role === "admin" && newRole !== "admin" && activeState().members.filter((m) => m.role === "admin").length === 1), 409, "Cannot remove the last administrator");
      if (method === "PATCH") {
        const result = mutate((next) => { const target = next.members.find((m) => m.id === memberId)!; target.role = newRole!; return publicMember(target); });
        reconcileAccess(); return json(result);
      }
      if (method === "DELETE") {
        mutate((next) => { next.members = next.members.filter((m) => m.id !== memberId); });
        reconcileAccess(); return json({ ok: true });
      }
      throw new HttpError(405, "Method not allowed");
    }

    if (path.startsWith("/api/references")) return referenceRequest(actor, credential, path, url.searchParams, method, body, ingress);
    if (path === "/api/workspaces" && method === "POST") return registerWorkspace(actor, body);
    if (path === "/api/rooms" && method === "POST") return registerRoom(actor, body);
    const match = /^\/api\/rooms\/([a-zA-Z0-9_-]+)(?:\/(content|comments|chat|links)(?:\/([^/]+))?)?$/.exec(path);
    ensure(match, 404, "Not found");
    const [, roomId, action, commentId] = match;
    let room = getRoom(roomId!, actor, !(action === undefined && (method === "PATCH" || method === "DELETE")));
    if (!action) {
      if (method === "GET") return json(roomState(room, credential, actor, ingress));
      if (method === "PATCH") {
        ensure(canManageCollaborationRoom(actor, room), 403, "Room owner or administrator required");
        ensure(typeof body.enabled === "boolean", 400, "Expected enabled boolean");
        const result = mutate((next) => { const target = next.rooms.find((r) => r.id === room.id)!; if (target.enabled !== body.enabled) target.grantEpoch++; target.enabled = body.enabled as boolean; target.updatedAt = Date.now(); return publicRoom(target); });
        reconcileAccess(); return json(result);
      }
      if (method === "DELETE") {
        ensure(canManageCollaborationRoom(actor, room), 403, "Room owner or administrator required");
        mutate((next) => { const target = next.rooms.find((r) => r.id === room.id)!; target.removed = true; target.grantEpoch++; next.invitations = next.invitations.filter((invite) => invite.roomId !== room.id); next.guests = next.guests.filter((guest) => next.invitations.some((invite) => invite.id === guest.invitationId)); });
        reconcileAccess(); return json({ ok: true });
      }
    }
    if (action === "content") {
      ensure(canWriteCollaboration(actor) && actor.id === room.ownerId && roomConfigs.has(room.id), 403, "Content source belongs to the local workspace owner");
      if (method === "GET") {
        room = refresh(room);
        const file = store.file(room.id, room.revision, room.page);
        ensure(file, 404, "Room page is unavailable");
        return json({ html: new TextDecoder().decode(file.bytes), revision: room.revision });
      }
      if (method === "PUT") {
        const opId = short(body.opId, 100, "operation id");
        const fingerprint = hash(`${path}\n${canonical(body)}`);
        const prior = store.receipt(actor.id, opId);
        if (prior) { ensure(prior.fingerprint === fingerprint, 409, "Operation id was used for different input"); return json(prior.result); }
        ensure(store.receiptCount() < 100_000, 503, "Experiment operation capacity reached");
        ensure(typeof body.html === "string" && Buffer.byteLength(body.html) <= 1024 * 1024, 400, "HTML must be at most 1 MiB");
        // Observe disk before CAS: a native edit need not have reached the watcher yet.
        room = refresh(room);
        ensure(Number.isInteger(body.baseRevision) && body.baseRevision === room.revision, 409, "Content changed; reload before saving");
        const config = roomConfigs.get(room.id)!;
        writePage(config.root, room.page, body.html);
        const snapshot = readContentSnapshot(config.root);
        const next = structuredClone(activeState());
        const updated = next.rooms.find((entry) => entry.id === room.id)!;
        const changed = updated.fingerprint !== snapshot.fingerprint;
        if (changed) { updated.revision++; updated.updatedAt = Date.now(); updated.fingerprint = snapshot.fingerprint; }
        const result = { revision: updated.revision };
        store.db.transaction(() => {
          if (changed) store.snapshot(room.id, updated.revision, snapshot);
          store.save(next); store.record(actor.id, opId, fingerprint, result);
        })();
        state = next;
        if (changed) for (const socket of sockets) {
          const observer = identity(socket.data.credential);
          if (socket.data.roomId === room.id && observer) send(socket, { type: "content", room: publicRoom(updated), pageUrl: pageUrl(updated, socket.data.credential, updated.revision, socket.data.ingress), publication: { revision: updated.revision, ...store.manifest(updated.id, updated.revision)! } });
          if (observer && (observer.kind === "member" || observer.roomId === room.id)) {
            send(socket, { type: "project", state: projectState(observer, socket.data.ingress) });
          }
        }
        return json(result);
      }
    }
    if (action === "comments") {
      if (method === "POST" && !commentId) {
        const comment = operation(actor, path, body, (next) => {
          ensure(next.comments.filter((c) => c.roomId === room.id).length < 1000, 409, "Comment limit reached");
          const now = Date.now();
          const result: CollaborationComment = {
            id: crypto.randomUUID(), roomId: room.id, anchor: validateAnchor(body.anchor, room), status: "open",
            messages: [{ id: crypto.randomUUID(), authorId: actor.id, authorName: actor.name, body: short(body.body, 8000, "comment"), createdAt: now }],
            resolvedBy: null, updatedAt: now,
          };
          next.comments.push(result); return result;
        });
        broadcastRoom(room.id, { type: "comments", comments: activeState().comments.filter((c) => c.roomId === room.id) });
        return json(comment);
      }
      if (method === "PATCH" && commentId) {
        if (body.status !== undefined) ensure(canWriteCollaboration(actor), 403, "Only project writers can resolve comments");
        const comment = operation(actor, path, body, (next) => {
          const target = next.comments.find((entry) => entry.id === commentId && entry.roomId === room.id);
          ensure(target, 404, "Comment not found");
          ensure(body.status !== undefined || body.body !== undefined, 400, "No comment change supplied");
          if (body.status !== undefined) {
            ensure(body.status === "open" || body.status === "resolved", 400, "Invalid comment status");
            target.status = body.status; target.resolvedBy = body.status === "resolved" ? actor.id : null;
          }
          if (body.body !== undefined) {
            ensure(target.messages.length < 200, 409, "Reply limit reached");
            target.messages.push({ id: crypto.randomUUID(), authorId: actor.id, authorName: actor.name, body: short(body.body, 8000, "reply"), createdAt: Date.now() });
          }
          target.updatedAt = Date.now(); return target;
        });
        broadcastRoom(room.id, { type: "comments", comments: activeState().comments.filter((c) => c.roomId === room.id) });
        return json(comment);
      }
    }
    if (action === "chat" && method === "POST") {
      const result = operation(actor, path, body, (next) => {
        ensure(next.messages.filter((m) => m.roomId === room.id).length < 1000, 409, "Chat limit reached");
        const message = { id: crypto.randomUUID(), roomId: room.id, authorId: actor.id, authorName: actor.name, body: short(body.body, 8000, "chat message"), createdAt: Date.now() };
        next.messages.push(message); return message;
      });
      broadcastRoom(room.id, { type: "chat", message: result }, false, true);
      return json(result);
    }
    if (action === "links") {
      ensure(canManageCollaborationRoom(actor, room), 403, "Room owner or administrator required");
      if (method === "POST") {
        const seconds = body.expiresInSeconds ?? 3600;
        const access = body.access ?? "view";
        ensure(Number.isInteger(seconds) && Number(seconds) >= 60 && Number(seconds) <= 7 * 86400, 400, "Guest expiry must be 60 seconds to seven days");
        ensure(access === "view" || access === "comment", 400, "Invalid invitation access");
        const token = crypto.randomUUID() + crypto.randomUUID(); const tokenHash = hash(token);
        const expiresAt = Date.now() + Number(seconds) * 1000;
        mutate((next) => {
          next.invitations = next.invitations.filter((invite) => invite.expiresAt > Date.now());
          ensure(next.invitations.length < LIMITS.invitations, 409, "Invitation capacity reached");
          const invitation = { id: crypto.randomUUID(), roomId: room.id, tokenHash, expiresAt, access: access as "view" | "comment" };
          next.invitations.push(invitation);
          // Old rooted lab links remain directly usable, strictly view-only.
          if (roomConfigs.has(room.id)) next.guests.push({ id: `guest-${crypto.randomUUID()}`, name: "Guest", tokenHash, invitationId: invitation.id });
        });
        return json({ token, expiresAt, roomId: room.id, access });
      }
      if (method === "DELETE") {
        mutate((next) => { next.invitations = next.invitations.filter((invite) => invite.roomId !== room.id);
          next.guests = next.guests.filter((guest) => next.invitations.some((invite) => invite.id === guest.invitationId)); });
        reconcileAccess(); return json({ ok: true });
      }
    }
    throw new HttpError(405, "Method not allowed");
  }

  // Subscribe before startup snapshots, then reconcile once watchers are ready.
  try {
    const byRoot = new Map<string, string[]>();
    for (const config of roomConfigs.values()) {
      const ids = byRoot.get(config.root) ?? []; ids.push(config.id); byRoot.set(config.root, ids);
    }
    for (const [root, ids] of byRoot) {
      const watcher = createWorkspaceWatcher({ root, ignore: (path) => !publicPath(path) });
      watcher.subscribe(() => true, () => {
        if (closed || activeState().removal) return;
        for (const id of ids) {
          const room = activeState().rooms.find((entry) => entry.id === id && !entry.removed);
          if (!room) continue;
          try { refresh(room); }
          catch (error) {
            publicationErrors.add(id);
            console.warn("[collaboration] publication snapshot failed", error);
            broadcastRoom(id, { type: "error", message: error instanceof HttpError
              ? `Publication update failed: ${error.message}; showing the last accepted revision`
              : "Publication update failed; showing the last accepted revision" });
          }
        }
      });
      watchers.push(watcher);
    }
    await Promise.all(watchers.map((watcher) => watcher.ready));
    for (const room of activeState().rooms) if (!activeState().removal && !room.removed && roomConfigs.has(room.id)) refresh(room);
  } catch (error) {
    closed = true; await Promise.all(watchers.map((watcher) => watcher.close())); store.close(); throw error;
  }

  let authorityOrigin = "";
  let server: ReturnType<typeof Bun.serve<Connection>>;
  function listen(ingress: Ingress, port: number, hostname: string) {
    return Bun.serve<Connection>({
      port, hostname,
      maxRequestBodySize: MAX_REQUEST_BYTES,
      async fetch(request, runtime) {
        try {
          ensure(!closed, 503, "Host is closing");
          ensure(ingress !== "public" || publicAllowed(), 503, "Public access is disabled");
          const url = new URL(request.url);
          const scope = /^\/projects\/([a-zA-Z0-9_-]{1,100})(\/.*)?$/.exec(url.pathname);
          if (scope) { ensure(scope[1] === options.project.id, 404, "Project not found"); url.pathname = scope[2] || "/"; }
          if (url.pathname === "/api/identity" && request.method === "GET") {
            requireActiveProject(activeState());
            const nonce = url.searchParams.get("nonce");
            ensure(nonce === null || /^[a-zA-Z0-9_-]{16,256}$/.test(nonce), 400, "Invalid authority challenge");
            const origin = ingress === "public" ? publicOrigin : authorityOrigin;
            ensure(origin, 503, "Public origin is not ready");
            return json({ version: 1, kind: "lan", projectId: options.project.id, origin, publicKey: identityKeys.publicKey, lanOrigin: authorityOrigin, publicOrigin,
              ...(nonce ? { nonce, signature: sign(null, Buffer.from(collaborationIdentityChallenge(options.project.id, origin, nonce)), signingKey).toString("base64") } : {}) } satisfies CollaborationAuthorityIdentity);
          }
          ensure(ingress !== "public" || !url.pathname.startsWith("/internal/"), 404, "Not found");
          if (request.method === "OPTIONS" && url.pathname === "/api/project") return new Response(null, { status: 204, headers: headers() });
          if (url.pathname === "/api/project" && request.method === "DELETE") return await deleteProject(request);
          if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/internal/") || url.pathname.startsWith("/rooms/")
            || url.pathname === "/ws" || url.pathname === "/publisher/ws") requireActiveProject(activeState());
          reconcileHosting();
          if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: headers() });
          if (url.pathname === "/api/invitations/redeem" && request.method === "POST") return await redeem(request);
          if (url.pathname.startsWith("/api/publisher/")) return await publisherRequest(request, url);
          if (url.pathname === "/ws" || url.pathname === "/publisher/ws") {
            ensure(request.method === "GET", 405, "Method not allowed");
            const token = short(url.searchParams.get("token"), 256, "credential");
            const credential = hash(token);
            const publishing = url.pathname === "/publisher/ws";
            const room = publishing ? requirePublisher(credential, url.searchParams.get("roomId") ?? undefined) : null;
            if (publishing) ensure(![...publishers].some((socket) => socket.data.roomId === room!.id), 409, "Another publisher is connected for this room");
            else { const actor = requireIdentity(credential); if (actor.kind === "guest") getRoom(actor.roomId!, actor); }
            ensure(sockets.size < MAX_CONNECTIONS && [...sockets].filter((s) => s.data.credential === credential).length < 8, 429, "Connection limit reached");
            ensure(scope || !request.headers.get("origin") || request.headers.get("origin") === url.origin, 403, "Cross-origin legacy socket refused");
            const upgraded = runtime.upgrade(request, { data: {
              ingress, id: crypto.randomUUID(), kind: publishing ? "publisher" : "participant", credential, roomId: room?.id ?? null, presence: null, latest: null,
              windowAt: Date.now(), count: 0, lastSeen: Date.now(), lastRelayed: 0, sequence: 0,
            } });
            if (upgraded) return undefined;
            return json({ error: "WebSocket upgrade failed" }, 400);
          }
          if (url.pathname.startsWith("/api/")) return await api(request, url, ingress);
          if (url.pathname.startsWith("/rooms/")) return asset(url, request, ingress) ?? json({ error: "Not found" }, 404);
          return staticFrontend(url, request);
        } catch (error) {
          if (activeState().removal && request.method === "DELETE" && new URL(request.url).pathname.endsWith("/api/project")) return json({ error: "Project was removed", code: "project_removed" }, 410);
          if (error instanceof HttpError) return json({ error: error.message, ...(error instanceof ProjectRemovedError ? { code: error.code } : {}) }, error.status);
          console.warn("[collaboration] request failed", error);
          return json({ error: "Collaboration request failed" }, 500);
        }
      },
      websocket: {
        maxPayloadLength: 16 * 1024,
        idleTimeout: 60,
        open(socket) {
          if (socket.data.ingress === "public" && !publicAllowed()) { socket.close(1008, "Public access disabled"); return; }
          if (activeState().removal) { socket.close(1008, "Project removed"); return; }
          if (socket.data.kind === "publisher") {
            const room = requirePublisher(socket.data.credential, socket.data.roomId!); publishers.add(socket);
            socket.send(JSON.stringify({ type: "publisher_ready", publisherId: socket.data.id, roomId: room.id, revision: room.revision, fingerprint: room.fingerprint }));
            reconcileHosting(); return;
          }
          sockets.add(socket);
          const actor = identity(socket.data.credential);
          publicChanged();
          if (!actor) { socket.close(1008, "Access revoked"); return; }
          send(socket, { type: "welcome", connectionId: socket.data.id, state: projectState(actor, socket.data.ingress) });
        },
        message(socket, raw) {
          try {
            ensure(socket.data.ingress !== "public" || publicAllowed(), 401, "Public access disabled");
            requireActiveProject(activeState());
            reconcileHosting();
            const now = Date.now();
            const data = socket.data;
            if (now - data.windowAt >= 1000) { data.windowAt = now; data.count = 0; }
            ensure(++data.count <= 120, 429, "Socket rate exceeded");
            ensure(raw.length <= 16 * 1024, 413, "Socket message is too large");
            const message = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as Body;
            if (data.kind === "publisher") {
              ensure(publishers.has(socket), 401, "Publisher connection expired");
              requirePublisher(data.credential, data.roomId!);
              ensure(message.type === "ping" && finite(message.sentAt, Number.MAX_SAFE_INTEGER), 400, "Publisher sockets only accept ping");
              data.lastSeen = now; socket.send(JSON.stringify({ type: "pong", sentAt: message.sentAt, serverAt: now })); return;
            }
            ensure(sockets.has(socket), 401, "Connection expired");
            const actor = requireIdentity(data.credential);
            if (message.type === "ping") {
              ensure(finite(message.sentAt, Number.MAX_SAFE_INTEGER), 400, "Invalid ping");
              data.lastSeen = now;
              send(socket, { type: "pong", sentAt: message.sentAt, serverAt: now }); return;
            }
            if (message.type === "leave") { leave(socket); reconcileHosting(); return; }
            if (message.type === "join") {
              const room = getRoom(short(message.roomId, 100, "room id"), actor);
              leave(socket);
              data.roomId = room.id; data.lastSeen = now;
              data.presence = { id: data.id, memberId: actor.id, name: actor.name, role: actor.role, roomId: room.id,
                color: COLORS[parseInt(hash(actor.id).slice(0, 4), 16) % COLORS.length]!, view: null, cursor: null, followingId: null, updatedAt: now };
              reconcileHosting();
              const joinedRoom = activeState().rooms.find((entry) => entry.id === room.id)!;
              send(socket, { type: "room", state: roomState(joinedRoom, data.credential, actor, data.ingress) });
              broadcastRoom(room.id, { type: "presence", participant: data.presence, sentAt: 0 }, true); return;
            }
            ensure(message.type === "presence", 400, "Unsupported socket message");
            ensure(data.roomId && data.presence, 400, "Join a room first");
            const room = getRoom(data.roomId, actor);
            ensure(message.semanticView === undefined || isViewerViewState(message.semanticView), 400, "Invalid semantic view");
            ensure(message.semanticPointer === undefined || message.semanticPointer === null || isCollaborationJson(message.semanticPointer)
              && typeof message.semanticPointer === "object" && !Array.isArray(message.semanticPointer), 400, "Invalid semantic pointer");
            const semantic = message.semanticView !== undefined || message.semanticPointer !== undefined;
            ensure(!semantic || Number.isInteger(message.revision) && Number(message.revision) > 0 && Number(message.revision) <= room.revision, 400, "Semantic presence requires a publication revision");
            ensure(message.view !== null || semantic, 400, "Viewer state required");
            const view = message.view === null ? null : validateView(message.view, room);
            const cursor = message.cursor as { x: number; y: number } | null;
            ensure(cursor === null || cursor && finite(cursor.x) && finite(cursor.y), 400, "Invalid cursor");
            const followingId = message.followingId;
            ensure(followingId === null || typeof followingId === "string" && followingId !== data.id
              && [...sockets].some((other) => other.data.id === followingId && other.data.roomId === room.id), 400, "Invalid follow target");
            ensure(finite(message.sentAt, Number.MAX_SAFE_INTEGER), 400, "Invalid measurement timestamp");
            data.lastSeen = now;
            data.sequence++;
            data.presence = { ...data.presence, role: actor.role, view,
              revision: semantic ? Number(message.revision) : view?.revision, sequence: data.sequence,
              ...(message.semanticView !== undefined ? { semanticView: message.semanticView as NonNullable<CollaborationPresence["semanticView"]> } : {}),
              ...(message.semanticPointer !== undefined ? { semanticPointer: message.semanticPointer as CollaborationPresence["semanticPointer"] } : {}),
              cursor: cursor ? { x: cursor.x, y: cursor.y } : null, followingId, updatedAt: now };
            const update = { participant: data.presence, sentAt: message.sentAt };
            if (now - data.lastRelayed >= 16) {
              data.lastRelayed = now; data.latest = null;
              broadcastRoom(room.id, { type: "presence", ...update }, true);
            } else data.latest = update;
          } catch (error) {
            if (error instanceof HttpError && (error.status === 401 || error.status === 429)) { socket.close(1008, error.message); return; }
            send(socket, { type: "error", message: error instanceof HttpError ? error.message : "Invalid socket message" });
          }
        },
        close(socket) { publishers.delete(socket); sockets.delete(socket); leave(socket); reconcileHosting(); publicChanged(); },
      },
    });
  }
  try { server = listen("lan", options.port ?? 0, options.hostname ?? "127.0.0.1"); } catch (error) {
    closed = true; await Promise.all(watchers.map((watcher) => watcher.close())); store.close(); throw error;
  }

  const presenceTimer = setInterval(() => {
    for (const socket of sockets) {
      const latest = socket.data.latest;
      socket.data.latest = null;
      if (latest) {
        socket.data.lastRelayed = Date.now();
        broadcastRoom(latest.participant.roomId, { type: "presence", ...latest }, true);
      }
    }
  }, 16);
  const internalHeartbeat = setInterval(() => { for (const id of internalPublisherSeen.keys()) internalPublisherSeen.set(id, Date.now()); }, 15_000);
  const cleanupTimer = setInterval(() => {
    reconcileHosting();
    for (const socket of sockets) {
      if (!identity(socket.data.credential) || Date.now() - socket.data.lastSeen > 60_000) { closeParticipant(socket, "Presence expired"); }
    }
    for (const [key, grant] of grants) if (grant.expiresAt <= Date.now()) grants.delete(key);
    for (const [key, bucket] of rate) if (Date.now() - bucket.at > 60_000) rate.delete(key);
  }, 1000);
  const address = options.hostname === "0.0.0.0" ? "127.0.0.1" : options.hostname ?? "127.0.0.1";
  authorityOrigin = `http://${options.publicHostname ?? address}:${server.port}`;
  return {
    canManageInternetAccess(token: string): boolean {
      const actor = identity(hash(token)); return !activeState().removal && actor?.kind === "member" && actor.role === "admin";
    },
    publicLeaseDeadline(): number | null {
      const publicSockets = [...sockets].filter((socket) => socket.data.ingress === "public" && !!identity(socket.data.credential));
      return publicSockets.length ? Math.max(...publicSockets.map((socket) => socket.data.lastSeen + 60_000)) : null;
    },
    publicConnections(now = Date.now()): number {
      for (const socket of [...sockets]) if (socket.data.ingress === "public" && (!identity(socket.data.credential) || now - socket.data.lastSeen > 60_000)) closeParticipant(socket, "Public participant lease expired");
      return [...sockets].filter((socket) => socket.data.ingress === "public" && !!identity(socket.data.credential)).length;
    },
    startPublicIngress(hooks: CollaborationPublicIngressOptions): string {
      ensure(!closed && !publicServer, 409, "Public ingress is already running or host is closed");
      publicHooks = hooks; publicAdmission = true;
      try { publicServer = listen("public", 0, "127.0.0.1"); }
      catch (error) { publicAdmission = false; publicHooks = null; throw error; }
      return `http://127.0.0.1:${publicServer.port}`;
    },
    setPublicOrigin(origin: string): void {
      publicOrigin = new URL(origin).origin;
      for (const socket of sockets) { const actor = identity(socket.data.credential); if (actor) send(socket, { type: "project", state: projectState(actor, socket.data.ingress) }); }
    },
    async stopPublicIngress(): Promise<void> {
      if (!publicServer && !publicAdmission && !publicOrigin) return;
      publicAdmission = false; publicOrigin = null;
      for (const socket of [...sockets]) if (socket.data.ingress === "public") closeParticipant(socket, "Public access disabled");
      for (const socket of [...publishers]) if (socket.data.ingress === "public") { publishers.delete(socket); socket.close(1001, "Public access disabled"); }
      reconcileHosting();
      for (const [key, grant] of grants) if (grant.ingress === "public") grants.delete(key);
      const ingressServer = publicServer;
      if (ingressServer) { await ingressServer.stop(true); publicServer = null; }
      publicHooks = null;
      for (const socket of sockets) { const actor = identity(socket.data.credential); if (actor) send(socket, { type: "project", state: projectState(actor, socket.data.ingress) }); }
    },
    port: server.port!, url: `http://${address}:${server.port}`,
    getState(token: string): CollaborationProjectState | null {
      const actor = identity(hash(token)); return actor ? projectState(actor) : null;
    },
    async close(): Promise<void> {
      if (closed) return;
      await this.stopPublicIngress();
      closed = true; clearInterval(presenceTimer); clearInterval(cleanupTimer); clearInterval(internalHeartbeat);
      for (const socket of [...sockets, ...publishers]) socket.close(1001, "Host closing");
      sockets.clear(); publishers.clear(); grants.clear();
      await Promise.all(watchers.map((watcher) => watcher.close()));
      await server.stop(true); store.close();
    },
  };
}
