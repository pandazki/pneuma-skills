import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicKey, verify } from "node:crypto";
import { canonical } from "../../../core/collaboration/authority-domain.js";
import { collaborationIdentityChallenge, type CollaborationAuthorityIdentity } from "../../../core/types/collaboration-workspace.js";
import type { CollaborationProjectState, CollaborationRoomState, CollaborationServerMessage } from "../../../core/types/collaboration.js";
import type { CollaborationReference, CollaborationResolvedReference } from "../../../core/types/collaboration-reference.js";
import { startCollaborationHost } from "../host.js";
import { createInternetAccessController } from "../internet-access.js";
import { startCollaborationPublisher } from "../publisher.js";
import { hash } from "../content.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const owner = "owner-token", writer = "writer-token";
const compatibility = { coreVersion: "4.0.0", modeVersion: "1.0.0", viewerHash: "a".repeat(64), publicationSchema: "webcraft-test-v1" };
class View {
  readonly socket: WebSocket;
  private inbox: CollaborationServerMessage[] = [];
  private listeners = new Set<() => void>();
  constructor(base: string, token: string) {
    const url = new URL(`${base}/ws?token=${encodeURIComponent(token)}`); url.protocol = "ws:";
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => { this.inbox.push(JSON.parse(String(event.data))); for (const notify of this.listeners) notify(); };
    cleanups.push(async () => { this.socket.close(); });
  }
  send(message: unknown) { this.socket.send(JSON.stringify(message)); }
  wait<T extends CollaborationServerMessage["type"]>(type: T) {
    return new Promise<Extract<CollaborationServerMessage, { type: T }>>((resolve, reject) => {
      const check = () => { const index = this.inbox.findIndex((message) => message.type === type); if (index < 0) return;
        const [message] = this.inbox.splice(index, 1); clearTimeout(timer); this.listeners.delete(check); resolve(message as Extract<CollaborationServerMessage, { type: T }>); };
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error(`Missing ${type}`)); }, 2000);
      this.listeners.add(check); check();
    });
  }
  async join(id: string) { await this.wait("welcome"); this.send({ type: "join", roomId: id }); return (await this.wait("room")).state; }
}
function snapshot(content: string) {
  const bytes = new TextEncoder().encode(content), digest = hash(bytes);
  const files = [{ path: "index.html", hash: digest, size: bytes.length, type: "text/html; charset=utf-8" }];
  const projection = { schema: compatibility.publicationSchema, sources: { files: [{ path: "index.html", content }] }, entryAddress: { file: "index.html" } };
  return { files, projection, blobs: new Map([[digest, bytes]]), fingerprint: hash(canonical({ files, projection })) };
}
async function setup(settings: { publicPublisher?: boolean; now?: () => number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pneuma-dual-ingress-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const options = { project: { id: "project", name: "Project" }, stateDir: join(root, "state"), rooms: [], frontendDir: root, frameScript: "",
    members: [{ id: "owner", name: "Owner", role: "admin" as const, token: owner }, { id: "writer", name: "Writer", role: "writer" as const, token: writer }] };
  const host = await startCollaborationHost(options); cleanups.push(() => host.close());
  const lan = `${host.url}/projects/project`;
  let publicTarget = "", stopped = 0;
  const access = createInternetAccessController({ host, now: settings.now, startTunnel: async ({ targetUrl }) => { publicTarget = targetUrl; return { origin: "https://project.example.test", pid: 123, async stop() { stopped++; } }; } });
  cleanups.push(() => access.close());
  await access.change({ enabled: true });
  const internet = `${publicTarget}/projects/project`;
  const request = (base: string, token: string | null, path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T>(base: string, token: string | null, path: string, method = "GET", body?: unknown): Promise<T> => {
    const response = await request(base, token, path, method, body); if (!response.ok) throw new Error(`${response.status} ${await response.text()}`); return response.json() as Promise<T>;
  };
  await json(lan, owner, "/api/workspaces", "POST", { id: "source", name: "Source", placement: "local" });
  await json(internet, writer, "/api/workspaces", "POST", { id: "destination", name: "Destination", placement: "local" });
  const registration = await json<{ room: { id: string }; publisherToken: string }>(lan, owner, "/api/rooms", "POST", {
    opId: "room-register", workspaceId: "source", modeInstanceId: "instance", mode: "webcraft", title: "Source", page: "index.html", compatibility });
  // Remote private workspaces may publish through the public entry; publishers never lease it.
  let current = snapshot("<!doctype html><h1>Shared publication</h1>");
  const publisher = await startCollaborationPublisher({ authorityBaseUrl: settings.publicPublisher === false ? lan : internet, roomId: registration.room.id, publisherToken: registration.publisherToken, getSnapshot: () => current });
  cleanups.push(() => publisher.stop());
  const ownerView = new View(lan, owner); await ownerView.join(registration.room.id);
  return { root, options, host, lan, internet, access, request, json, registration, ownerView, publisher,
    update(content: string) { current = snapshot(content); }, get stops() { return stopped; } };
}

test("two real Bun listeners share publications, comments, chat, presence and pinned references; public disable preserves LAN", async () => {
  const service = await setup(); const id = service.registration.room.id;
  expect(service.access.read().publicClients).toBe(0); // LAN owner + public publisher do not count.
  expect((await service.request(service.internet, null, "/api/state")).status).toBe(401);
  expect((await service.request(service.internet, owner, "/internal/internet-access")).status).toBe(404);
  const lanState = await service.json<CollaborationProjectState>(service.lan, owner, "/api/state");
  const publicState = await service.json<CollaborationProjectState>(service.internet, writer, "/api/state");
  expect(lanState.project).toEqual(publicState.project); expect(lanState.authorityKind).toBe("lan");
  expect(lanState.publicOrigin).toBe(service.host.url); expect(publicState.publicOrigin).toBe("https://project.example.test");
  expect(lanState.access?.publicOrigin).toBe("https://project.example.test");
  const peer = new View(service.internet, writer); const room = await peer.join(id); expect(service.access.read().publicClients).toBe(1);
  const lanRoom = await service.json<CollaborationRoomState>(service.lan, owner, `/api/rooms/${id}`);
  expect(room.publication).toEqual(lanRoom.publication);
  const publicAsset = new URL(room.pageUrl, service.internet); expect((await fetch(publicAsset)).status).toBe(200);
  const wrongEntry = new URL(room.pageUrl, service.lan); expect((await fetch(wrongEntry)).status).toBe(403);
  const chat = await service.json<{ id: string }>(service.internet, writer, `/api/rooms/${id}/chat`, "POST", { opId: "chat-one", body: "Mixed entry chat" });
  expect((await service.ownerView.wait("chat")).message.id).toBe(chat.id);
  await service.json(service.internet, writer, `/api/rooms/${id}/comments`, "POST", { opId: "comment-one", body: "Mixed comment", anchor: { address: { file: "index.html" }, revision: room.room.revision, x: 2, y: 4 } });
  expect((await service.ownerView.wait("comments")).comments[0]?.messages[0]?.body).toBe("Mixed comment");
  const pin = await service.json<CollaborationReference>(service.internet, writer, "/api/references", "POST", { opId: "pin-one", destinationWorkspaceId: "destination", label: "Shared reference",
    source: { projectId: "project", workspaceId: "source", roomId: id, publicationRevision: room.room.revision, address: { file: "index.html" } } });
  const resolved = await service.json<CollaborationResolvedReference>(service.internet, writer, `/api/references/${pin.id}/resolve`);
  expect((await fetch(new URL(resolved.pageUrl, service.internet))).status).toBe(200);
  expect((await service.json<{ references: CollaborationReference[] }>(service.lan, owner, "/api/references?workspaceId=destination")).references[0]?.id).toBe(pin.id);
  service.update("<!doctype html><h1>Next revision</h1>"); await service.publisher.sync();
  expect((await peer.wait("content")).room.revision).toBe(2); expect((await service.ownerView.wait("content")).room.revision).toBe(2);
  peer.send({ type: "presence", view: null, revision: 2, semanticView: { address: { file: "index.html" }, detail: { scrollY: 20 } }, cursor: null, followingId: null, sentAt: 1 });
  let presence = await service.ownerView.wait("presence"); while (presence.sentAt !== 1) presence = await service.ownerView.wait("presence"); expect(presence.participant.memberId).toBe("writer");
  await service.access.change({ enabled: false }); expect(service.stops).toBe(1);
  expect((await service.json<CollaborationProjectState>(service.lan, owner, "/api/state")).access?.publicOrigin).toBe(null);
  const latest = await service.json<CollaborationRoomState>(service.lan, owner, `/api/rooms/${id}`); expect(latest.room.revision).toBe(2); expect(latest.room.hostOnline).toBe(false); expect(latest.comments.length).toBe(1); expect(latest.messages.length).toBe(1);
  expect((await fetch(new URL(latest.pageUrl, service.lan))).status).toBe(200);
  await expect(fetch(publicAsset)).rejects.toThrow();
});

test("authority identity survives restart and signs controlled ingress origins, never supplied Host headers", async () => {
  const service = await setup(); const nonce = "0123456789abcdef0123456789abcdef";
  const lan = await service.json<CollaborationAuthorityIdentity>(service.lan, null, `/api/identity?nonce=${nonce}`);
  const internet = await (await fetch(`${service.internet}/api/identity?nonce=${nonce}`, { headers: { Host: "attacker.example" } })).json() as CollaborationAuthorityIdentity;
  expect(lan.origin).toBe(service.host.url); expect(internet.origin).toBe("https://project.example.test"); expect(internet.publicKey).toBe(lan.publicKey);
  const key = createPublicKey({ key: Buffer.from(lan.publicKey!, "base64"), format: "der", type: "spki" });
  expect(verify(null, Buffer.from(collaborationIdentityChallenge("project", internet.origin, nonce)), key, Buffer.from(internet.signature!, "base64"))).toBe(true);
  expect(verify(null, Buffer.from(collaborationIdentityChallenge("project", "https://attacker.example", nonce)), key, Buffer.from(internet.signature!, "base64"))).toBe(false);
  await service.access.close(); await service.host.close();
  const restarted = await startCollaborationHost(service.options); cleanups.push(() => restarted.close());
  const identity = await (await fetch(`${restarted.url}/projects/project/api/identity`)).json() as CollaborationAuthorityIdentity;
  expect(identity.publicKey).toBe(lan.publicKey); expect(identity.publicOrigin).toBe(null);
  expect((await fetch(`${restarted.url}/projects/project/api/identity?nonce=short`)).status).toBe(400);
});


test("the service-owned idle deadline stops public listener/provider once while LAN owner and publisher remain live", async () => {
  let now = Date.now(); const service = await setup({ publicPublisher: false, now: () => now });
  for (let index = 0; index < 3; index++) {
    expect((await service.request(service.internet, owner, "/api/state")).status).toBe(200);
    expect((await fetch(`${service.internet}/api/identity`)).status).toBe(200);
  }
  expect(service.access.read().publicClients).toBe(0);
  now += 600_000; service.access.check(); await Bun.sleep(1);
  expect(service.access.read().status).toBe("idleexpired"); expect(service.stops).toBe(1);
  const room = await service.json<CollaborationRoomState>(service.lan, owner, `/api/rooms/${service.registration.room.id}`);
  expect(room.room.hostOnline).toBe(true); expect((await fetch(new URL(room.pageUrl, service.lan))).status).toBe(200);
  service.access.check(); await Bun.sleep(1); expect(service.stops).toBe(1);
});

test("an authenticated public participant counts until its heartbeat lease expires, then sleep overdue cleanup runs before a request", async () => {
  let now = Date.now(); const service = await setup({ publicPublisher: false, now: () => now });
  const peer = new View(service.internet, writer); await peer.join(service.registration.room.id);
  expect(service.access.read().publicClients).toBe(1); expect(service.access.read().idleDeadline).toBe(null);
  now += 60_000 + 600_000 + 100;
  const lateResponse = await service.request(service.internet, owner, "/api/state").catch(() => null);
  expect(lateResponse?.ok ?? false).toBe(false); await Bun.sleep(1);
  expect(service.access.read().status).toBe("idleexpired"); expect(service.stops).toBe(1);
  expect((await service.json<CollaborationRoomState>(service.lan, owner, `/api/rooms/${service.registration.room.id}`)).room.hostOnline).toBe(true);
});

test("removed Projects reject identity discovery just like every other project API", async () => {
  const service = await setup();
  expect((await service.request(service.lan, owner, "/api/project", "DELETE", { opId: "remove-project" })).status).toBe(200);
  const response = await fetch(`${service.internet}/api/identity`); expect(response.status).toBe(410);
  expect((await response.json()).code).toBe("project_removed");
});


test("a pending named provider rejects HTTP and identity admission until its known public origin is active", async () => {
  const service = await setup({ publicPublisher: false }); await service.access.close();
  let target = "";
  let resolve!: (handle: { origin: string; pid: number; stop(): Promise<void> }) => void;
  const pending = createInternetAccessController({ host: service.host, startTunnel: async ({ targetUrl }) => {
    target = targetUrl; return new Promise((done) => { resolve = done; });
  } });
  cleanups.push(() => pending.close());
  const provider = { kind: "named" as const, tunnelId: "b28e6772-20c8-4463-8b7f-2adf40908e24", credentialsFile: "/private/tunnel.json", publicOrigin: "https://named.example.test" };
  const enabling = pending.change({ enabled: true, provider }); await Bun.sleep(1);
  const base = `${target}/projects/project`;
  expect((await service.request(base, owner, "/api/state")).status).toBe(503);
  expect((await service.request(base, null, "/api/identity")).status).toBe(503);
  expect(pending.read().idleDeadline).toBe(null);
  resolve({ origin: provider.publicOrigin, pid: 1, async stop() {} }); await enabling;
  expect((await service.json<CollaborationProjectState>(base, owner, "/api/state")).publicOrigin).toBe(provider.publicOrigin);
});
