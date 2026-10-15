import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollaborationReference, CollaborationResolvedReference } from "../../../core/types/collaboration-reference.js";
import { canonical } from "../../../core/collaboration/authority-domain.js";
import type { CollaborationRoomState, CollaborationProjectState, CollaborationServerMessage } from "../../../core/types/collaboration.js";
import { startCollaborationHost } from "../host.js";
import { startCollaborationPublisher } from "../publisher.js";
import { CollaborationStore } from "../store.js";
import { hash } from "../content.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const compatibility = { coreVersion: "4.0.0", modeVersion: "1.0.0", viewerHash: "a".repeat(64), publicationSchema: "webcraft-test-v1" };
const owner = "owner-token", writer = "writer-token", reader = "reader-token";

class View {
  readonly socket: WebSocket;
  private messages: CollaborationServerMessage[] = [];
  private listeners = new Set<() => void>();
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(base: string, token: string) {
    const url = new URL(`${base}/ws`); url.protocol = "ws:"; url.searchParams.set("token", token);
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => { this.messages.push(JSON.parse(String(event.data))); for (const callback of this.listeners) callback(); };
    this.heartbeat = setInterval(() => { if (this.socket.readyState === WebSocket.OPEN) this.send({ type: "ping", sentAt: Date.now() }); }, 5000);
    cleanups.push(async () => { clearInterval(this.heartbeat); this.socket.close(); });
  }
  send(value: unknown) { this.socket.send(JSON.stringify(value)); }
  wait<T extends CollaborationServerMessage["type"]>(type: T, accepts: (message: Extract<CollaborationServerMessage, { type: T }>) => boolean = () => true) {
    return new Promise<Extract<CollaborationServerMessage, { type: T }>>((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.listeners.delete(check); };
      const check = () => {
        const index = this.messages.findIndex((message) => message.type === type && accepts(message as Extract<CollaborationServerMessage, { type: T }>));
        if (index >= 0) { const [message] = this.messages.splice(index, 1); done(); resolve(message as Extract<CollaborationServerMessage, { type: T }>); }
      };
      const timer = setTimeout(() => { done(); reject(new Error(`Missing ${type}: ${JSON.stringify(this.messages)}`)); }, 3000);
      this.listeners.add(check); check();
    });
  }
  async join(roomId: string) { await this.wait("welcome"); this.send({ type: "join", roomId }); return (await this.wait("room")).state; }
}
function snapshot(content: string) {
  const bytes = new TextEncoder().encode(content), digest = hash(bytes);
  const files = [{ path: "index.html", hash: digest, size: bytes.length, type: "text/html; charset=utf-8" }];
  const projection = { schema: compatibility.publicationSchema, sources: { files: [{ path: "index.html", content }] }, entryAddress: { file: "index.html" } };
  return { files, projection, blobs: new Map([[digest, bytes]]), fingerprint: hash(canonical({ files, projection })) };
}
async function setup() {
  const fixture = await mkdtemp(join(tmpdir(), "pneuma-lan-authority-"));
  cleanups.push(() => rm(fixture, { recursive: true, force: true }));
  const options = { project: { id: "project", name: "LAN Project" }, stateDir: join(fixture, "state"), rooms: [],
    members: [{ id: "owner", name: "Owner", role: "admin" as const, token: owner }, { id: "writer", name: "Writer", role: "writer" as const, token: writer }, { id: "reader", name: "Reader", role: "reader" as const, token: reader }],
    frontendDir: fixture, frameScript: "", port: 0 };
  let authority = await startCollaborationHost(options);
  cleanups.push(() => authority.close());
  let base = `${authority.url}/projects/project`;
  const request = (token: string | null, path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T>(token: string | null, path: string, method = "GET", body?: unknown): Promise<T> => {
    const response = await request(token, path, method, body);
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  const register = async (token: string, id: string) => {
    await json(token, "/api/workspaces", "POST", { id, name: id, placement: "local" });
    return json<{ room: { id: string }; publisherToken: string }>(token, "/api/rooms", "POST", { opId: `${id}-registration`, workspaceId: id, modeInstanceId: `${id}-instance`, mode: "webcraft", title: id, page: "index.html", compatibility });
  };
  return { fixture, get base() { return base; }, request, json, register, async restart() { await authority.close(); authority = await startCollaborationHost(options); base = `${authority.url}/projects/project`; } };
}

describe("LAN authority with normal Session publication protocol", () => {
  test("zero-room authority admits distinct owners with atomic Source publications and strictly scoped capabilities", async () => {
    const service = await setup();
    expect((await service.json<CollaborationProjectState>(owner, "/api/state")).rooms).toEqual([]);
    const preflight = await fetch(`${service.base}/api/rooms`, { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
    expect(preflight.status).toBe(204); expect(preflight.headers.get("access-control-allow-origin")).toBe("*"); expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    const unauthorized = await fetch(`${service.base}/api/state`, { headers: { Origin: "http://localhost:5173" } });
    expect(unauthorized.status).toBe(401); expect(unauthorized.headers.get("access-control-allow-origin")).toBe("*");
    const first = await service.register(owner, "workspace-owner");
    const second = await service.register(writer, "workspace-writer");
    expect(await service.register(owner, "workspace-owner")).toEqual(first);
    expect((await service.request(owner, "/api/workspaces", "POST", { id: "workspace-writer", name: "Takeover", placement: "local" })).status).toBe(403);
    expect((await service.request(reader, "/api/workspaces", "POST", { id: "reader", name: "Reader", placement: "local" })).status).toBe(403);
    expect((await service.request(reader, `/api/rooms/${first.room.id}`)).status).toBe(423);
    let current = snapshot("<!doctype html><h1>Owner page</h1>");
    const one = await startCollaborationPublisher({ authorityBaseUrl: service.base, roomId: first.room.id, publisherToken: first.publisherToken, getSnapshot: () => current }); cleanups.push(() => one.stop());
    const two = await startCollaborationPublisher({ authorityBaseUrl: service.base, roomId: second.room.id, publisherToken: second.publisherToken, getSnapshot: () => snapshot("<!doctype html><h1>Writer page</h1>") }); cleanups.push(() => two.stop());
    expect((await service.request(reader, `/api/rooms/${first.room.id}`)).status).toBe(423);
    const firstHost = new View(service.base, owner); const initialOwnerRoom = await firstHost.join(first.room.id);
    expect((await fetch(new URL(initialOwnerRoom.pageUrl, service.base))).status).toBe(200);
    const secondHost = new View(service.base, writer); await secondHost.join(second.room.id);
    const peer = new View(service.base, reader); const shared = await peer.join(first.room.id);
    expect(shared.publication?.projection).toEqual(current.projection);
    expect(shared.publication?.files).toEqual(current.files);
    expect((await service.request(writer, `/api/rooms/${first.room.id}/content`, "PUT", { html: "Peer write" })).status).toBe(403);
    expect((await service.request(owner, `/api/rooms/${second.room.id}/content`, "PUT", { html: "Admin write" })).status).toBe(403);
    expect((await service.request(second.publisherToken, `/api/publisher/rooms/${first.room.id}/state`)).status).toBe(401);
    current = snapshot("<!doctype html><h1>Owner revision two</h1>"); await one.sync(); const update = await peer.wait("content");
    expect(update.publication?.revision).toBe(update.room.revision); expect(update.publication?.projection).toEqual(current.projection);
    const latest = await service.json<CollaborationRoomState>(reader, `/api/rooms/${first.room.id}`);
    expect(latest.room.revision).toBe(2); expect(latest.publication?.projection).toEqual(current.projection);
    expect((await service.json<CollaborationRoomState>(reader, `/api/rooms/${second.room.id}`)).room.revision).toBe(1);
    const sentAt = Date.now();
    peer.send({ type: "presence", view: null, revision: latest.room.revision, semanticView: { address: { file: "index.html" }, detail: { scrollY: 40 } },
      semanticPointer: { file: "index.html", x: 12, y: 20 }, cursor: null, followingId: null, sentAt, sequence: 999, memberId: "forged-owner" });
    const presence = await firstHost.wait("presence", (message) => message.sentAt === sentAt);
    expect(presence.participant.memberId).toBe("reader"); expect(presence.participant.sequence).toBe(1); expect(presence.participant.revision).toBe(latest.room.revision);
    peer.send({ type: "presence", view: null, semanticView: { address: { file: "index.html" } }, cursor: null, followingId: null, sentAt });
    expect((await peer.wait("error")).message).toContain("revision");
    const link = await service.json<{ token: string; access: string }>(owner, `/api/rooms/${first.room.id}/links`, "POST", {}); expect(link.access).toBe("view");
    expect((await service.request(link.token, "/api/state")).status).toBe(401);
    const guest = await service.json<{ token: string }>(null, "/api/invitations/redeem", "POST", { token: link.token, name: "Guest" });
    expect((await service.json<CollaborationProjectState>(guest.token, "/api/state")).rooms.map((room) => room.id)).toEqual([first.room.id]);
    expect((await service.request(guest.token, `/api/rooms/${second.room.id}`)).status).toBe(404);
    expect((await service.request(guest.token, `/api/rooms/${first.room.id}/chat`, "POST", { opId: crypto.randomUUID(), body: "Cannot chat" })).status).toBe(403);
    const commentLink = await service.json<{ token: string }>(owner, `/api/rooms/${first.room.id}/links`, "POST", { access: "comment" });
    const reviewer = await service.json<{ token: string }>(null, "/api/invitations/redeem", "POST", { token: commentLink.token, name: "Comment guest" });
    const thread = await service.json<{ id: string }>(reviewer.token, `/api/rooms/${first.room.id}/comments`, "POST", { opId: crypto.randomUUID(), body: "Guest feedback", anchor: { address: { file: "index.html" }, revision: latest.room.revision, x: 2, y: 4 } });
    expect((await service.request(reviewer.token, `/api/rooms/${first.room.id}/comments/${thread.id}`, "PATCH", { opId: crypto.randomUUID(), status: "resolved" })).status).toBe(403);
    expect((await service.request(reviewer.token, `/api/rooms/${first.room.id}/chat`, "POST", { opId: crypto.randomUUID(), body: "Guest chat" })).status).toBe(200);
    const secondPage = new URL((await service.json<CollaborationRoomState>(reader, `/api/rooms/${second.room.id}`)).pageUrl, service.base);
    const oldPage = new URL(latest.pageUrl, service.base);
    firstHost.send({ type: "leave" }); expect((await peer.wait("closed")).code).toBe("host_offline");
    expect((await fetch(oldPage)).ok).toBe(false); expect((await fetch(secondPage)).status).toBe(200);
    firstHost.send({ type: "join", roomId: first.room.id }); await firstHost.wait("room");
    expect((await fetch(oldPage)).ok).toBe(false);
    const manual = new View(service.base, reader); await manual.join(first.room.id);
    await one.stop(); expect((await manual.wait("closed")).code).toBe("host_offline");
    expect((await fetch(secondPage)).status).toBe(200);
    firstHost.send({ type: "leave" });
    expect((await service.request(reader, `/api/rooms/${first.room.id}`, "PATCH", { enabled: false })).status).toBe(403);
    expect((await service.request(writer, `/api/rooms/${first.room.id}`, "PATCH", { enabled: false })).status).toBe(403);
    expect((await service.request(owner, `/api/rooms/${first.room.id}`, "PATCH", { enabled: false })).status).toBe(200);
    expect((await service.request(owner, `/api/rooms/${first.room.id}`, "DELETE")).status).toBe(200);
    expect((await service.request(owner, `/api/rooms/${first.room.id}`)).status).toBe(404);
  }, 20000);

  test("a packaged viewer upgrade republishes a new revision while preserving identities, invitations and discussion", async () => {
    const service = await setup();
    const registration = await service.register(owner, "upgrade-workspace");
    await service.register(writer, "reference-workspace");
    const current = snapshot("<!doctype html><h1>Unchanged content</h1>");
    const first = await startCollaborationPublisher({ authorityBaseUrl: service.base, roomId: registration.room.id,
      publisherToken: registration.publisherToken, getSnapshot: () => current });
    cleanups.push(() => first.stop());
    const host = new View(service.base, owner); const before = await host.join(registration.room.id);
    const invitation = await service.json<{ token: string }>(owner, `/api/rooms/${registration.room.id}/links`, "POST", { access: "comment" });
    const guest = await service.json<{ token: string }>(null, "/api/invitations/redeem", "POST", { token: invitation.token, name: "Guest" });
    await service.json(guest.token, `/api/rooms/${registration.room.id}/comments`, "POST", { opId: "comment-before-upgrade", body: "Keep feedback", anchor: { revision: 1, address: { file: "index.html" }, x: 0, y: 0 } });
    await service.json(guest.token, `/api/rooms/${registration.room.id}/chat`, "POST", { opId: "chat-before-upgrade", body: "Keep chat" });
    const reference = await service.json<CollaborationReference>(writer, "/api/references", "POST", { opId: "pin-before-upgrade", label: "Old publication", destinationWorkspaceId: "reference-workspace",
      source: { projectId: "project", workspaceId: "upgrade-workspace", roomId: registration.room.id, publicationRevision: 1, address: { file: "index.html" } } });
    const nextCompatibility = { ...compatibility, coreVersion: "4.1.0", viewerHash: "b".repeat(64) };
    await Bun.write(join(service.fixture, "viewer-manifest.json"), JSON.stringify({ coreVersion: "4.1.0", modes: [{ mode: "webcraft", ...nextCompatibility, entry: "/viewer/new.js", styles: [] }] }));
    await first.stop();
    const second = await startCollaborationPublisher({ authorityBaseUrl: service.base, roomId: registration.room.id,
      publisherToken: registration.publisherToken, getSnapshot: () => current, viewer: { compatibility: nextCompatibility, frameScript: "// new viewer" } });
    cleanups.push(() => second.stop());
    const after = await service.json<CollaborationRoomState>(owner, `/api/rooms/${registration.room.id}`);
    expect(after.room.id).toBe(before.room.id); expect(after.room.revision).toBe(2);
    expect(after.room.compatibility).toEqual(nextCompatibility); expect(after.room.viewerRevisionStart).toBe(2);
    expect(after.comments.map((comment) => comment.messages[0]!.body)).toEqual(["Keep feedback"]);
    expect(after.messages.map((message) => message.body)).toEqual(["Keep chat"]);
    expect((await service.json<CollaborationProjectState>(guest.token, "/api/state")).self.id).toBeDefined();
    expect((await service.request(null, "/api/invitations/redeem", "POST", { token: invitation.token, name: "Another guest" })).status).toBe(200);
    expect((await service.json<{ references: CollaborationReference[] }>(writer, "/api/references")).references).toEqual([reference]);
    const unavailable = await service.request(writer, `/api/references/${reference.id}/resolve`);
    expect(unavailable.status).toBe(410); expect((await unavailable.json() as { code: string }).code).toBe("publication_viewer_unavailable");
    const oldResource = new URL(after.pageUrl, service.base); oldResource.pathname = oldResource.pathname.replace("/revisions/2/", "/revisions/1/");
    expect((await fetch(oldResource)).status).toBe(410);
    const store = new CollaborationStore(join(service.fixture, "state"));
    expect(store.manifest(registration.room.id, 1)?.projection).toEqual(current.projection); store.close();
    await second.stop();
    await expect(startCollaborationPublisher({ authorityBaseUrl: service.base, roomId: registration.room.id,
      publisherToken: registration.publisherToken, getSnapshot: () => current, viewer: { compatibility, frameScript: "// stale viewer" } })).rejects.toThrow("packaged viewer");
  }, 15000);

  test("admin removal tombstones both rooms, their sockets and every grant across restart", async () => {
    const service = await setup();
    await Bun.write(join(service.fixture, "index.html"), "<!doctype html><html><body>Public shell</body></html>");
    const registrations = [await service.register(owner, "removal-owner"), await service.register(writer, "removal-writer")];
    const publishers: WebSocket[] = [];
    for (const [index, registration] of registrations.entries()) {
      const url = new URL(`${service.base}/publisher/ws?roomId=${registration.room.id}&token=${registration.publisherToken}`); url.protocol = "ws:";
      const socket = new WebSocket(url); publishers.push(socket); cleanups.push(async () => { socket.close(); });
      const ready = await new Promise<{ publisherId: string }>((resolve) => { socket.onmessage = (event) => resolve(JSON.parse(String(event.data))); });
      const current = snapshot(`<!doctype html><h1>Room ${index}</h1>`);
      for (const [digest, bytes] of current.blobs) expect((await fetch(`${service.base}/api/publisher/rooms/${registration.room.id}/blobs/${digest}`, { method: "PUT", headers: { Authorization: `Bearer ${registration.publisherToken}` }, body: new Uint8Array(bytes).buffer })).status).toBe(200);
      expect((await fetch(`${service.base}/api/publisher/rooms/${registration.room.id}/commit`, { method: "POST", headers: { Authorization: `Bearer ${registration.publisherToken}`, "Content-Type": "application/json", "X-Publisher-Id": ready.publisherId }, body: JSON.stringify({ opId: crypto.randomUUID(), baseRevision: 0, files: current.files, projection: current.projection, fingerprint: current.fingerprint }) })).status).toBe(200);
    }
    const hosts = [new View(service.base, owner), new View(service.base, writer)];
    const states = await Promise.all(hosts.map((view, index) => view.join(registrations[index]!.room.id)));
    const peer = new View(service.base, reader); await peer.join(registrations[0]!.room.id);
    const pin = await service.json<CollaborationReference>(writer, "/api/references", "POST", { opId: crypto.randomUUID(), destinationWorkspaceId: "removal-writer", label: "Retained source pin", source: { projectId: "project", workspaceId: "removal-owner", roomId: registrations[0]!.room.id, publicationRevision: 1, address: { file: "index.html" } } });
    const privatePath = join(service.fixture, "private-work.txt"); await Bun.write(privatePath, "Owner files remain local");
    const body = { opId: crypto.randomUUID() };
    for (const token of [reader, writer]) expect((await service.request(token, "/api/project", "DELETE", body)).status).toBe(403);
    const closedPublishers = publishers.map((socket) => new Promise<CloseEvent>((resolve) => { socket.addEventListener("close", resolve, { once: true }); }));
    const removed = await service.json<{ ok: true; removed: true; projectId: string; removedAt: number }>(owner, "/api/project", "DELETE", body);
    expect(removed).toMatchObject({ ok: true, removed: true, projectId: "project" });
    for (const view of [...hosts, peer]) expect((await view.wait("closed")).reason).toBe("Project removed");
    for (const event of await Promise.all(closedPublishers)) { expect(event.code).toBe(1008); expect(event.reason).toBe("Project removed"); }
    expect(await service.json<typeof removed>(owner, "/api/project", "DELETE", body)).toEqual(removed);
    for (const state of states) {
      const page = new URL(state.pageUrl, service.base);
      for (const headers of [{}, { "X-Pneuma-Publication-Bytes": "1" }] as Record<string, string>[]) expect((await fetch(page, { headers })).status).toBe(410);
    }
    for (const token of [null, owner, writer, reader]) {
      const response = await service.request(token, "/api/state"); expect(response.status).toBe(410); expect((await response.json() as { code: string }).code).toBe("project_removed");
    }
    expect((await service.request(owner, "/api/project", "DELETE", { opId: crypto.randomUUID() })).status).toBe(410);
    const oldOrigin = new URL(service.base).origin;
    await service.restart();
    expect((await service.request(owner, "/api/state")).status).toBe(410);
    expect(await service.json<typeof removed>(owner, "/api/project", "DELETE", body)).toEqual(removed);
    for (const state of states) {
      const url = new URL(state.pageUrl, oldOrigin); url.host = new URL(service.base).host;
      expect((await fetch(url, { headers: { "X-Pneuma-Publication-Bytes": "1" } })).status).toBe(410);
    }
    expect((await service.request(owner, "/api/workspaces", "POST", { id: "resurrect", name: "No", placement: "local" })).status).toBe(410);
    expect((await service.request(null, "/api/project", "OPTIONS")).status).toBe(204);
    // The canonical trusted shell remains loadable and can explain the API tombstone.
    for (const suffix of ["", "/"]) {
      const shell = await service.request(null, suffix); expect(shell.status).toBe(200); expect(shell.headers.get("content-type")).toContain("text/html");
      expect(await shell.text()).toContain("Public shell");
      const state = await service.request(null, "/api/state"); expect(state.status).toBe(410); expect((await state.json() as { code: string }).code).toBe("project_removed");
    }
    const saved = new CollaborationStore(join(service.fixture, "state"));
    try { expect(saved.load()?.references).toEqual([pin]); } finally { saved.close(); }
    expect(await Bun.file(privatePath).text()).toBe("Owner files remain local");
  }, 15000);

  test("authority restart preserves both room heads and receipts but requires explicit owner and participant rejoin", async () => {
    const service = await setup(); const first = await service.register(owner, "first"), second = await service.register(writer, "second");
    const snapshots = [snapshot("<!doctype html><h1>First</h1>"), snapshot("<!doctype html><h1>Second</h1>")];
    const pubs = await Promise.all([first, second].map((room, index) => startCollaborationPublisher({ authorityBaseUrl: service.base, roomId: room.room.id, publisherToken: room.publisherToken, getSnapshot: () => snapshots[index]! })));
    for (const pub of pubs) cleanups.push(() => pub.stop());
    const views = [new View(service.base, owner), new View(service.base, writer)]; await Promise.all(views.map((view, index) => view.join([first, second][index]!.room.id)));
    const body = { opId: crypto.randomUUID(), body: "Durable room chat" };
    const accepted = await service.json<{ id: string }>(writer, `/api/rooms/${first.room.id}/chat`, "POST", body);
    await Promise.all(pubs.map((pub) => pub.stop())); await service.restart();
    expect((await service.request(reader, `/api/rooms/${first.room.id}`)).status).toBe(423);
    expect(await service.register(owner, "first")).toEqual(first);
    const restored = await service.json<CollaborationProjectState>(owner, "/api/state"); expect(restored.rooms.map((room) => room.revision)).toEqual([1, 1]); expect(restored.rooms.every((room) => room.hostOnline === false)).toBe(true);
    const nextPubs = await Promise.all([first, second].map((room, index) => startCollaborationPublisher({ authorityBaseUrl: service.base, roomId: room.room.id, publisherToken: room.publisherToken, getSnapshot: () => snapshots[index]! })));
    for (const pub of nextPubs) cleanups.push(() => pub.stop());
    const hosts = [new View(service.base, owner), new View(service.base, writer)]; await Promise.all(hosts.map((view, index) => view.join([first, second][index]!.room.id)));
    expect((await service.json<{ id: string }>(writer, `/api/rooms/${first.room.id}/chat`, "POST", body)).id).toBe(accepted.id);
    expect((await service.json<CollaborationRoomState>(reader, `/api/rooms/${first.room.id}`)).publication?.projection).toEqual(snapshots[0]!.projection);
  }, 20000);
  test("pins reserve immutable revisions, enforce ownership and quota, and refresh/unpin atomically", async () => {
    const service = await setup(); const originRoom = await service.register(owner, "source"); await service.register(writer, "destination");
    let current = snapshot("<!doctype html><h1>Pinned original</h1>");
    const publisher = await startCollaborationPublisher({ authorityBaseUrl: service.base, roomId: originRoom.room.id, publisherToken: originRoom.publisherToken, getSnapshot: () => current }); cleanups.push(() => publisher.stop());
    const sourceHost = new View(service.base, owner); await sourceHost.join(originRoom.room.id);
    const source = (revision: number) => ({ projectId: "project", workspaceId: "source", roomId: originRoom.room.id, publicationRevision: revision, address: { file: "index.html", selector: "h1" } });
    const requestBody = { opId: crypto.randomUUID(), destinationWorkspaceId: "destination", label: "Original reference", source: source(1) };
    expect((await service.request(owner, "/api/references", "POST", requestBody)).status).toBe(403);
    expect((await service.request(reader, "/api/references", "POST", requestBody)).status).toBe(403);
    expect((await service.request(writer, "/api/references", "POST", { ...requestBody, source: { ...source(1), projectId: "foreign-project" } })).status).toBe(400);
    expect((await service.request(writer, "/api/references", "POST", { ...requestBody, source: { ...source(1), workspaceId: "destination" } })).status).toBe(400);
    const first = await service.json<CollaborationReference>(writer, "/api/references", "POST", requestBody);
    expect(await service.json<CollaborationReference>(writer, "/api/references", "POST", requestBody)).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("Pinned original"); expect(JSON.stringify(first)).not.toContain("pageUrl");
    const duplicate = await service.json<CollaborationReference>(writer, "/api/references", "POST", { ...requestBody, opId: crypto.randomUUID(), label: "Same revision, one reservation" });
    const pins: CollaborationReference[] = [first];
    for (let revision = 2; revision <= 7; revision++) {
      current = snapshot(`<!doctype html><h1>Revision ${revision}</h1>`); await publisher.sync();
      pins.push(await service.json<CollaborationReference>(writer, "/api/references", "POST", { ...requestBody, opId: crypto.randomUUID(), source: source(revision) }));
    }
    current = snapshot("<!doctype html><h1>Revision 8</h1>"); await publisher.sync();
    const before = await service.json<{ references: CollaborationReference[] }>(reader, "/api/references?workspaceId=destination");
    expect((await service.request(writer, "/api/references", "POST", { ...requestBody, opId: crypto.randomUUID(), source: source(8) })).status).toBe(409);
    expect(await service.json<{ references: CollaborationReference[] }>(reader, "/api/references?workspaceId=destination")).toEqual(before);
    for (let revision = 9; revision <= 12; revision++) { current = snapshot(`<!doctype html><h1>Revision ${revision}</h1>`); await publisher.sync(); }
    const resolved = await service.json<CollaborationResolvedReference>(reader, `/api/references/${first.id}/resolve`);
    expect(resolved.publication.revision).toBe(1); expect(resolved.room.revision).toBe(1); expect(resolved.reference.source.publicationRevision).toBe(1);
    expect(resolved.publication.projection?.sources).toEqual(snapshot("<!doctype html><h1>Pinned original</h1>").projection.sources);
    const originalPage = new URL(resolved.pageUrl, service.base); expect(await (await fetch(originalPage)).text()).toContain("Pinned original");
    const raw = await fetch(originalPage, { headers: { "X-Pneuma-Publication-Bytes": "1" } });
    expect(raw.headers.get("content-type")).toBe("application/octet-stream"); expect(raw.headers.get("content-disposition")).toBe("attachment");
    const originalFile = resolved.publication.files.find((file) => file.path === "index.html")!;
    const originalBytes = new Uint8Array(await raw.arrayBuffer()); expect(originalBytes.length).toBe(originalFile.size); expect(hash(originalBytes)).toBe(originalFile.hash);
    expect((await service.request(owner, `/api/references/${first.id}`, "DELETE", { opId: crypto.randomUUID() })).status).toBe(403);
    expect((await service.request(reader, `/api/references/${first.id}`, "DELETE", { opId: crypto.randomUUID() })).status).toBe(403);
    const failedRefresh = { opId: crypto.randomUUID(), source: source(12) };
    expect((await service.request(writer, `/api/references/${first.id}`, "PATCH", failedRefresh)).status).toBe(409); // Another pin still reserves revision 1.
    expect((await service.json<CollaborationResolvedReference>(reader, `/api/references/${first.id}/resolve`)).publication.revision).toBe(1);
    const deletion = { opId: crypto.randomUUID() };
    await service.json(writer, `/api/references/${duplicate.id}`, "DELETE", deletion);
    expect(await service.json<{ ok: boolean; id: string }>(writer, `/api/references/${duplicate.id}`, "DELETE", deletion)).toEqual({ ok: true, id: duplicate.id });
    const refreshed = await service.json<CollaborationReference>(writer, `/api/references/${first.id}`, "PATCH", failedRefresh);
    expect(refreshed.source.publicationRevision).toBe(12);
    expect(await service.json<CollaborationReference>(writer, `/api/references/${first.id}`, "PATCH", failedRefresh)).toEqual(refreshed);
    expect((await service.json<CollaborationResolvedReference>(reader, `/api/references/${first.id}/resolve`)).publication.revision).toBe(12);
    current = snapshot("<!doctype html><h1>Revision 13</h1>"); await publisher.sync();
    expect((await fetch(originalPage)).status).toBe(404); // Released reservation becomes evictable.
    expect((await service.request(writer, "/api/references", "POST", { ...requestBody, opId: crypto.randomUUID(), source: source(1) })).status).toBe(410);
    const member = await service.json<{ member: { id: string }; token: string }>(owner, "/api/members", "POST", { name: "Revocable reader", role: "reader" });
    const memberResolved = await service.json<CollaborationResolvedReference>(member.token, `/api/references/${first.id}/resolve`);
    await service.json(owner, `/api/members/${member.member.id}`, "DELETE");
    expect((await service.request(member.token, `/api/references/${first.id}/resolve`)).status).toBe(401);
    expect((await fetch(new URL(memberResolved.pageUrl, service.base), { headers: { "X-Pneuma-Publication-Bytes": "1" } })).ok).toBe(false);
    sourceHost.send({ type: "leave" });
    expect((await service.request(reader, `/api/references/${first.id}/resolve`)).status).toBe(423);
    expect((await fetch(new URL(memberResolved.pageUrl, service.base), { headers: { "X-Pneuma-Publication-Bytes": "1" } })).ok).toBe(false);
    sourceHost.send({ type: "join", roomId: originRoom.room.id }); await sourceHost.wait("room");
    const link = await service.json<{ token: string }>(owner, `/api/rooms/${originRoom.room.id}/links`, "POST", { access: "comment" });
    const guest = await service.json<{ token: string }>(null, "/api/invitations/redeem", "POST", { token: link.token, name: "Guest" });
    expect((await service.request(guest.token, "/api/references")).status).toBe(403);
    expect((await service.request(guest.token, "/api/references", "POST", { ...requestBody, opId: crypto.randomUUID(), source: source(13) })).status).toBe(403);
    await service.json(owner, `/api/rooms/${originRoom.room.id}`, "PATCH", { enabled: false });
    expect((await service.request(reader, `/api/references/${first.id}/resolve`)).status).toBe(403);
    await service.json(owner, `/api/rooms/${originRoom.room.id}`, "DELETE");
    expect((await service.request(reader, `/api/references/${first.id}/resolve`)).status).toBe(410);
    await service.json(writer, `/api/references/${first.id}`, "DELETE", { opId: crypto.randomUUID() });
  }, 20000);

  test("pins and their original receipts survive authority restart while source hosting must return", async () => {
    const service = await setup(); const room = await service.register(owner, "source"); await service.register(writer, "destination");
    const current = snapshot("<!doctype html><h1>Durable pinned source</h1>");
    const options = { roomId: room.room.id, publisherToken: room.publisherToken, getSnapshot: () => current };
    const publisher = await startCollaborationPublisher({ authorityBaseUrl: service.base, ...options }); cleanups.push(() => publisher.stop());
    const host = new View(service.base, owner); await host.join(room.room.id);
    const body = { opId: crypto.randomUUID(), destinationWorkspaceId: "destination", label: "Persistent pin", source: { projectId: "project", workspaceId: "source", roomId: room.room.id, publicationRevision: 1, address: { file: "index.html" } } };
    const pin = await service.json<CollaborationReference>(writer, "/api/references", "POST", body);
    await publisher.stop(); await service.restart();
    expect((await service.request(reader, `/api/references/${pin.id}/resolve`)).status).toBe(423);
    expect((await service.json<{ references: CollaborationReference[] }>(reader, "/api/references")).references).toEqual([pin]);
    const nextPublisher = await startCollaborationPublisher({ authorityBaseUrl: service.base, ...options }); cleanups.push(() => nextPublisher.stop());
    const nextHost = new View(service.base, owner); await nextHost.join(room.room.id);
    expect(await service.json<CollaborationReference>(writer, "/api/references", "POST", body)).toEqual(pin);
    const resolved = await service.json<CollaborationResolvedReference>(reader, `/api/references/${pin.id}/resolve`);
    expect(resolved.publication.projection).toEqual(current.projection);
    expect(resolved.compatibility).toEqual(compatibility);
  }, 20000);

});
