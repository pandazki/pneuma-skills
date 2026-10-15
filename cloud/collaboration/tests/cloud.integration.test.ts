import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { CollaborationReference, CollaborationResolvedReference } from "../../../core/types/collaboration-reference.js";
import { canonical } from "../../../core/collaboration/authority-domain.js";
import { startCollaborationPublisher } from "../../../server/collaboration/publisher.js";
import type { CollaborationPublicationProjection } from "../../../core/types/collaboration-publication.js";
import type {
  CollaborationComment,
  CollaborationGuestLink,
  CollaborationInvite,
  CollaborationProjectState,
  CollaborationRoomState,
  CollaborationServerMessage,
} from "../../../core/types/collaboration.js";

const projectId = "cloud-integration-project";
const workerName = "cloud-integration-worker";
const roomId = "website";
const ownerToken = crypto.randomUUID() + crypto.randomUUID();
const publisherToken = crypto.randomUUID() + crypto.randomUUID();
const bootstrapSecret = crypto.randomUUID() + crypto.randomUUID();
const upgradeCompatibility = { coreVersion: "4.1.0", modeVersion: "1.0.0", viewerHash: "f".repeat(64), publicationSchema: "upgrade-v1" };
const frameScript = "window.__pneumaCloudFrame = true;";
const bootstrap = {
  project: { id: projectId, name: "Cloud collaboration acceptance" },
  owner: { id: "owner", name: "Project owner", token: ownerToken },
  publisherToken,
  room: { id: roomId, title: "Website", mode: "webcraft", ownerId: "owner", page: "index.html", enabled: true },
  frameScript,
};

interface PublishedFile { path: string; hash: string; size: number; type: string }
interface Publication { files: PublishedFile[]; fingerprint: string; bytes: Map<string, Uint8Array> }
interface PublisherState { room: { revision: number }; revision: number; fingerprint: string; hostOnline: boolean }
interface PublisherReady { type: "publisher_ready"; publisherId: string }
type Message = CollaborationServerMessage | PublisherReady;
type OfType<T extends Message["type"]> = Extract<Message, { type: T }>;

let fixture: string;
let bundlePath: string;
let runtime: Miniflare;
let origin: string;
let publisher: Connection;
let host: Connection | null = null;
let publisherLease = "";
let writer: CollaborationInvite;
let reader: CollaborationInvite;
let originalPublication: Publication;
const observers: Connection[] = [];
const normalPublishers: Awaited<ReturnType<typeof startCollaborationPublisher>>[] = [];

function digest(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function publication(html: string, css = "h1 { color: orange; }"): Publication {
  const bytes = new Map<string, Uint8Array>();
  const files = [
    { path: "assets/site.css", type: "text/css; charset=utf-8", content: css },
    { path: "index.html", type: "text/html; charset=utf-8", content: html },
  ].map(({ path, type, content }) => {
    const value = new TextEncoder().encode(content);
    const hash = digest(value);
    bytes.set(hash, value);
    return { path, hash, size: value.byteLength, type };
  });
  return { files, bytes, fingerprint: digest(JSON.stringify(files)) };
}

async function request(token: string | null, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return fetch(new URL(path, origin), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(token: string | null, path: string, method = "GET", body?: unknown, extra?: Record<string, string>): Promise<T> {
  const response = await request(token, path, method, body, extra);
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function room(token = ownerToken): Promise<CollaborationRoomState> {
  return json(token, `/api/rooms/${roomId}`);
}

function publisherState(): Promise<PublisherState> { return json(publisherToken, "/api/publisher/state"); }

function grantUrl(state: CollaborationRoomState, path?: string): URL {
  const base = new URL(state.pageUrl, origin);
  return path ? new URL(path, base) : base;
}

function grantToken(state: CollaborationRoomState): string {
  const path = grantUrl(state).pathname.split("/");
  return path[path.indexOf("revisions") + 2]!;
}

function anchor(revision: number) {
  return { address: { page: "index.html", selector: "#heading" }, revision, x: 32, y: 64, quote: "Cloud page" };
}

function comment(revision: number, text = "Please adjust this heading", opId = crypto.randomUUID()) {
  return { opId, anchor: anchor(revision), body: text };
}

async function invitation(access: "view" | "comment") {
  return json<CollaborationGuestLink>(ownerToken, `/api/rooms/${roomId}/links`, "POST", { access, expiresInSeconds: 3600 });
}

async function redeem(inviteToken: string, name = "Remote reviewer") {
  return json<{ token: string; roomId: string }>(null, "/api/invitations/redeem", "POST", { token: inviteToken, name });
}

async function upload(candidate: Publication): Promise<void> {
  for (const [hash, bytes] of candidate.bytes) {
    const response = await fetch(new URL(`/api/publisher/blobs/${hash}`, origin), {
      method: "PUT", headers: { Authorization: `Bearer ${publisherToken}` }, body: new Uint8Array(bytes).buffer,
    });
    if (!response.ok) throw new Error(`Blob upload failed: ${response.status} ${await response.text()}`);
    expect((await response.json() as { hash: string }).hash).toBe(hash);
  }
}

function commit(candidate: Publication, baseRevision: number, opId = crypto.randomUUID(), lease = publisherLease) {
  return json<{ revision: number; fingerprint: string }>(publisherToken, "/api/publisher/commit", "POST", {
    opId, baseRevision, files: candidate.files, fingerprint: candidate.fingerprint,
  }, lease ? { "X-Publisher-Id": lease } : {});
}

class Connection {
  readonly socket: WebSocket;
  readonly messages: Message[] = [];
  private readonly changed = new Set<() => void>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(token: string, path = "/ws", tracked = true) {
    const url = new URL(path, origin);
    url.protocol = "ws:";
    url.searchParams.set("token", token);
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)) as Message);
      for (const callback of this.changed) callback();
    });
    this.socket.addEventListener("close", () => this.stopHeartbeat());
    if (tracked) observers.push(this);
  }

  send(value: unknown): void { this.socket.send(JSON.stringify(value)); }

  startHeartbeat(interval: number): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.socket.readyState === WebSocket.OPEN) this.send({ type: "ping", sentAt: Date.now() });
    }, interval);
  }

  stopHeartbeat(): void { clearInterval(this.heartbeat); this.heartbeat = undefined; }

  async wait<T extends Message["type"]>(type: T, accepts: (message: OfType<T>) => boolean = () => true, timeout = 3000): Promise<OfType<T>> {
    return new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); this.changed.delete(check); };
      const check = () => {
        const index = this.messages.findIndex((message) => message.type === type && accepts(message as OfType<T>));
        if (index >= 0) {
          const [message] = this.messages.splice(index, 1);
          finish(); resolve(message as OfType<T>);
        }
      };
      const timer = setTimeout(() => {
        finish(); reject(new Error(`No ${type} message; received ${this.messages.map((message) => message.type).join(", ")}`));
      }, timeout);
      this.changed.add(check);
      check();
    });
  }

  async close(): Promise<void> {
    this.stopHeartbeat();
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500);
      this.socket.addEventListener("close", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.close();
    });
  }
}

async function connect(token: string, tracked = true): Promise<Connection> {
  const socket = new Connection(token, "/ws", tracked);
  await socket.wait("welcome");
  socket.send({ type: "join", roomId });
  await socket.wait("room");
  return socket;
}

async function connectPublisher(): Promise<void> {
  publisher = new Connection(publisherToken, "/publisher/ws", false);
  const ready = await publisher.wait("publisher_ready");
  publisherLease = ready.publisherId;
  publisher.startHeartbeat(15000);
}

async function connectHost(): Promise<void> {
  host = await connect(ownerToken, false);
  host.startHeartbeat(5000);
}

async function assertOffline(token: string, page: URL, linkToken: string, revision: number): Promise<void> {
  const requests: Array<[string, string, unknown?]> = [
    ["GET", "/api/state"],
    ["GET", `/api/rooms/${roomId}`],
    ["POST", `/api/rooms/${roomId}/comments`, comment(revision, "Blocked offline annotation")],
    ["POST", `/api/rooms/${roomId}/chat`, { opId: crypto.randomUUID(), body: "Blocked offline chat" }],
  ];
  for (const [method, path, body] of requests) expect((await request(token, path, method, body)).status).toBe(423);
  expect([403, 423]).toContain((await fetch(page)).status);
  expect((await request(null, `/ws?token=${token}`, "GET", undefined, { Upgrade: "websocket" })).status).toBe(423);
  expect((await request(null, "/api/invitations/redeem", "POST", { token: linkToken, name: "Offline visitor" })).status).toBe(423);
}

async function expectHostOffline(connection: Connection, timeout = 3000): Promise<void> {
  const closed = await connection.wait("closed", (message) => message.code === "host_offline", timeout);
  expect(closed.reason.toLowerCase()).toContain("host");
}

async function startRuntime(): Promise<void> {
  const options = convertV4MiniflareOptions({
    host: "127.0.0.1", port: 0, cf: false,
    workers: [
      {
        name: workerName, modules: true, scriptPath: bundlePath, modulesRoot: dirname(bundlePath), compatibilityDate: "2026-10-13",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { PROJECT_ID: projectId, BOOTSTRAP_SECRET: bootstrapSecret },
        durableObjects: { PROJECTS: { className: "ProjectCollaboration", useSQLite: true } },
        r2Buckets: ["BLOBS"], serviceBindings: { ASSETS: "test-static-assets" },
      },
      {
        name: "test-static-assets", modules: true, compatibilityDate: "2026-10-13",
        script: `export default { fetch(request) { if (new URL(request.url).pathname === "/viewer-manifest.json") return Response.json(${JSON.stringify({ coreVersion: "4.1.0", modes: [{ mode: "webcraft", ...upgradeCompatibility }] })}); return new URL(request.url).pathname === "/" ? new Response("<!doctype html><html><body>Public shell</body></html>", { headers: { "Content-Type": "text/html" } }) : new Response("Not found", { status: 404 }); } };`,
      },
    ],
  });
  // Miniflare 5 uses one persistence root; its v4 adapter omits plugin-specific paths.
  options.resourcePersistencePath = join(fixture, "resources");
  runtime = new Miniflare(options);
  origin = (await runtime.ready).origin;
}

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), "pneuma-cloud-workerd-"));
  const buildDir = join(fixture, "bundle");
  await mkdir(buildDir);
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../src/worker.ts")], outdir: buildDir,
    target: "browser", external: ["cloudflare:workers"],
  });
  if (!build.success) throw new AggregateError(build.logs, "Cloud worker did not build for integration tests");
  bundlePath = build.outputs.find((output) => output.kind === "entry-point")!.path;
  await startRuntime();
  await json(bootstrapSecret, "/internal/bootstrap", "POST", bootstrap);
  await connectPublisher();
  await connectHost();
  originalPublication = publication('<!doctype html><html><head><link rel="stylesheet" href="assets/site.css"></head><body><h1 id="heading">Cloud page</h1></body></html>');
  await upload(originalPublication);
  await commit(originalPublication, 0);
  writer = await json(ownerToken, "/api/members", "POST", { name: "Project writer", role: "writer" });
  reader = await json(ownerToken, "/api/members", "POST", { name: "Project reader", role: "reader" });
}, 20000);

beforeEach(async () => {
  if (publisher.socket.readyState !== WebSocket.OPEN) await connectPublisher();
  if (!host || host.socket.readyState !== WebSocket.OPEN) await connectHost();
});

afterEach(async () => { await Promise.all(normalPublishers.splice(0).map((publisher) => publisher.stop())); await Promise.all(observers.splice(0).map((socket) => socket.close())); });
afterAll(async () => {
  if (host) await host.close();
  if (publisher) await publisher.close();
  if (runtime) await runtime.dispose();
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

describe("cloud project collaboration with real workerd and R2", () => {
  test("retains bounded comment previews in replies and room snapshots and rejects malformed metadata", async () => {
    const observer = await connect(reader.token);
    const state = await room();
    const preview = { label: 'h1 "Heading"', file: "index.html", type: "heading", content: "Selected heading", thumbnail: "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>Heading</text></svg>') };
    const body = { ...comment(state.room.revision), anchor: { ...comment(state.room.revision).anchor, preview } };
    const created = await json<CollaborationComment>(writer.token, `/api/rooms/${roomId}/comments`, "POST", body);
    expect(created.anchor.preview).toEqual(preview);
    const update = await observer.wait("comments", (message) => message.comments.some((entry) => entry.id === created.id));
    expect(update.comments.find((entry) => entry.id === created.id)?.anchor.preview).toEqual(preview);
    expect((await room()).comments.find((entry) => entry.id === created.id)?.anchor.preview).toEqual(preview);
    for (const invalid of [null, { label: 42 }, { label: "x".repeat(201) }, { thumbnail: "https://example.test/image.png" }, { thumbnail: "data:image/png;base64," + "a".repeat(48 * 1024) }]) {
      expect((await request(writer.token, `/api/rooms/${roomId}/comments`, "POST", { ...body, opId: crypto.randomUUID(), anchor: { ...body.anchor, preview: invalid } })).status).toBe(400);
    }
  });

  test("cloud identity explicitly declares placement without requesting a member credential", async () => {
    const response = await request(null, `/projects/${projectId}/api/identity?nonce=public-discovery`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, kind: "cloud", projectId, origin });
    const state = await json<CollaborationProjectState>(ownerToken, "/api/state");
    expect(state.authorityKind).toBe("cloud");
  });
  test("bootstrap is privileged and shared state omits secrets and private runtime routes", async () => {
    expect((await request(null, "/internal/bootstrap", "POST", bootstrap)).status).toBe(401);
    expect((await request("wrong-secret", "/internal/bootstrap", "POST", bootstrap)).status).toBe(401);
    const state = await json<CollaborationProjectState>(reader.token, "/api/state");
    expect(state.project.id).toBe(projectId);
    expect(state.capabilities?.editSource).toBe(false);
    expect(state.publicOrigin).toBe(origin);
    const serialized = JSON.stringify(state);
    for (const value of [ownerToken, publisherToken, bootstrapSecret, reader.token, writer.token, fixture, frameScript]) expect(serialized).not.toContain(value);
    for (const path of ["/api/session", "/api/agent", "/api/terminal", "/api/files", "/.pneuma/history.json"]) {
      expect((await request(ownerToken, path)).status).toBe(404);
    }
  });

  test("archived public viewer assets remain available without exposing private project blobs", async () => {
    const bucket = await runtime.getR2Bucket("BLOBS", workerName);
    await bucket.put("public-viewer/viewer/previous-frame.js", "window.archivedFrame = true;", { httpMetadata: { contentType: "application/javascript" } });
    await bucket.put("public-viewer/assets/previous-shell.css", "body { color: orange; }", { httpMetadata: { contentType: "text/css" } });
    await bucket.put("public-viewer/viewer/.private.js", "Never served");
    for (const path of ["/viewer/previous-frame.js", "/assets/previous-shell.css"]) {
      const response = await request(null, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect((await response.text()).length).toBeGreaterThan(0);
      const head = await request(null, path, "HEAD");
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    }
    for (const path of ["/viewer/.private.js", "/viewer/%2eprivate.js", "/viewer/%2e%2e%2fprivate.js", "/viewer/" + "a".repeat(501), "/public-viewer/viewer/previous-frame.js"]) {
      expect((await request(null, path)).status).toBe(404);
    }
    expect((await request(null, "/viewer/previous-frame.js", "PUT", { overwrite: true })).status).toBe(405);
  });

  test("strict readers and view guests cannot perform any durable operation", async () => {
    const link = await invitation("view");
    const guest = await redeem(link.token, "Read-only guest");
    const revision = (await room()).room.revision;
    const existing = await json<CollaborationComment>(writer.token, `/api/rooms/${roomId}/comments`, "POST", comment(revision));
    const mutations: Array<[string, string, unknown?]> = [
      ["POST", `/api/rooms/${roomId}/comments`, comment(revision)],
      ["PATCH", `/api/rooms/${roomId}/comments/${existing.id}`, { opId: crypto.randomUUID(), body: "Forbidden reply" }],
      ["PATCH", `/api/rooms/${roomId}/comments/${existing.id}`, { opId: crypto.randomUUID(), status: "resolved" }],
      ["POST", `/api/rooms/${roomId}/chat`, { opId: crypto.randomUUID(), body: "Forbidden chat" }],
      ["PUT", `/api/rooms/${roomId}/content`, { opId: crypto.randomUUID(), baseRevision: revision, html: "Forbidden source" }],
      ["PATCH", `/api/rooms/${roomId}`, { enabled: false }],
      ["DELETE", `/api/rooms/${roomId}`],
      ["POST", `/api/rooms/${roomId}/links`, { access: "comment", expiresInSeconds: 3600 }],
      ["DELETE", `/api/rooms/${roomId}/links`],
      ["POST", "/api/members", { name: "Escalated", role: "admin" }],
      ["PATCH", `/api/members/${reader.member.id}`, { role: "admin" }],
      ["DELETE", `/api/members/${writer.member.id}`],
    ];
    for (const token of [reader.token, guest.token]) {
      for (const [method, path, body] of mutations) expect((await request(token, path, method, body)).status).toBe(403);
    }
    expect((await room()).room.revision).toBe(revision);
  });

  test("comment invitations redeem into distinct room guests with discussion-only capabilities", async () => {
    const link = await invitation("comment");
    expect((await request(link.token, "/api/state")).status).toBe(401);
    const first = await redeem(link.token, "Reviewer one");
    const second = await redeem(link.token, "Reviewer two");
    expect(first.token).not.toBe(second.token);
    const firstState = await json<CollaborationProjectState>(first.token, "/api/state");
    const secondState = await json<CollaborationProjectState>(second.token, "/api/state");
    expect(firstState.self.id).not.toBe(secondState.self.id);
    expect(firstState.self.kind).toBe("guest");
    expect(firstState.self.role).toBe("reader");
    expect(firstState.self.guestAccess).toBe("comment");
    expect(firstState.members).toEqual([]);
    expect(firstState.rooms.map((entry) => entry.id)).toEqual([roomId]);
    expect([403, 404]).toContain((await request(first.token, "/api/rooms/other-project-room")).status);
    const state = await room(first.token);
    const created = await json<CollaborationComment>(first.token, `/api/rooms/${roomId}/comments`, "POST", comment(state.room.revision, "Guest annotation"));
    expect(created.messages[0]!.authorId).toBe(firstState.self.id);
    const replied = await json<CollaborationComment>(second.token, `/api/rooms/${roomId}/comments/${created.id}`, "PATCH", { opId: crypto.randomUUID(), body: "Guest reply" });
    expect(replied.messages.at(-1)!.authorId).toBe(secondState.self.id);
    const chat = await json<{ id: string }>(first.token, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "Guest room chat" });
    expect((await room(second.token)).messages.some((entry) => entry.id === chat.id)).toBe(true);
    for (const status of ["resolved", "open"]) {
      expect((await request(first.token, `/api/rooms/${roomId}/comments/${created.id}`, "PATCH", { opId: crypto.randomUUID(), status })).status).toBe(403);
    }
    expect((await request(first.token, `/api/rooms/${roomId}/content`)).status).toBe(403);
    expect((await request(first.token, `/api/rooms/${roomId}/content`, "PUT", { opId: crypto.randomUUID(), baseRevision: state.room.revision, html: "Forbidden" })).status).toBe(403);
    expect((await request(first.token, `/api/rooms/${roomId}/links`, "POST", { expiresInSeconds: 3600 })).status).toBe(403);
    expect((await request(first.token, "/api/members", "POST", { name: "Escalated", role: "admin" })).status).toBe(403);
  });

  test("cloud actors cannot mutate source and publisher credentials have no actor privileges", async () => {
    const state = await room();
    for (const token of [ownerToken, writer.token]) {
      expect((await request(token, `/api/rooms/${roomId}/content`)).status).toBe(403);
      expect((await request(token, `/api/rooms/${roomId}/content`, "PUT", { opId: crypto.randomUUID(), baseRevision: state.room.revision, html: "Cloud-only edit" })).status).toBe(403);
    }
    expect((await request(publisherToken, "/api/state")).status).toBe(401);
    expect((await request(publisherToken, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "Publisher impersonation" })).status).toBe(401);
    const grant = grantToken(state);
    for (const token of [ownerToken, writer.token, reader.token, grant]) {
      expect((await request(token, "/api/publisher/state")).status).toBe(401);
      expect((await request(token, "/api/publisher/commit", "POST", { opId: crypto.randomUUID(), baseRevision: state.room.revision, files: originalPublication.files, fingerprint: originalPublication.fingerprint })).status).toBe(401);
    }
  });

  test("private resources remain grant-scoped, sandboxed, and independent of actor credentials", async () => {
    const link = await invitation("comment");
    const guest = await redeem(link.token);
    const state = await room(guest.token);
    const response = await fetch(grantUrl(state));
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    const html = await response.text();
    expect(html).toContain("__pneumaCloudFrame");
    for (const credential of [ownerToken, publisherToken, bootstrapSecret, guest.token, link.token]) expect(html).not.toContain(credential);
    expect(await (await fetch(grantUrl(state, "assets/site.css"))).text()).toContain("color: orange");
    expect((await request(grantToken(state), "/api/state")).status).toBe(401);
    for (const path of [".env", ".pneuma/history.json", "../secret.json", "%2e%2e%2fsecret.json"]) expect((await fetch(grantUrl(state, path))).ok).toBe(false);
    const rawHash = originalPublication.files[0]!.hash;
    for (const path of [`/blobs/${rawHash}`, `/r2/${projectId}/${rawHash}`, `/api/publisher/blobs/${rawHash}`]) expect((await request(null, path)).ok).toBe(false);
    const otherRoom = grantUrl(state);
    otherRoom.pathname = otherRoom.pathname.replace(`/${roomId}/`, "/another-room/");
    expect((await fetch(otherRoom)).ok).toBe(false);
  });

  test("publication rejects incomplete, corrupted, or private manifests without changing the accepted head", async () => {
    const state = await publisherState();
    const missing = publication("<!doctype html><h1>Not uploaded</h1>");
    const deniedCommit = async (files: PublishedFile[], fingerprint = digest(JSON.stringify(files))) => {
      const response = await request(publisherToken, "/api/publisher/commit", "POST", { opId: crypto.randomUUID(), baseRevision: state.revision, files, fingerprint }, { "X-Publisher-Id": publisherLease });
      expect([400, 409]).toContain(response.status);
      expect((await publisherState()).revision).toBe(state.revision);
    };
    await deniedCommit(missing.files);
    await deniedCommit(originalPublication.files, "0".repeat(64));
    await deniedCommit(originalPublication.files.map((file) => ({ ...file, size: file.size + 1 })));
    await deniedCommit(originalPublication.files.filter((file) => file.path !== "index.html"));
    await deniedCommit([...originalPublication.files, originalPublication.files[0]!]);
    for (const path of ["../private.html", ".env", ".pneuma/history.json", "session.json"]) {
      await deniedCommit([...originalPublication.files, { ...originalPublication.files[0]!, path }]);
    }
    const wrongBytes = new TextEncoder().encode("Incorrect bytes for this digest");
    const corrupt = await fetch(new URL(`/api/publisher/blobs/${originalPublication.files[0]!.hash}`, origin), {
      method: "PUT", headers: { Authorization: `Bearer ${publisherToken}` }, body: wrongBytes,
    });
    expect(corrupt.status).toBe(400);
    expect((await publisherState()).revision).toBe(state.revision);
  });

  test("published resources are immutable and commit retries cannot overwrite a newer accepted revision", async () => {
    const oldState = await room();
    const observer = await connect(reader.token);
    const next = publication("<!doctype html><h1>Published revision two</h1>", "h1 { color: blue; }");
    await upload(next);
    const opId = crypto.randomUUID();
    const accepted = await commit(next, oldState.room.revision, opId);
    await observer.wait("content", (message) => message.room.revision === accepted.revision);
    expect(await (await fetch(grantUrl(oldState, "assets/site.css"))).text()).toContain("color: orange");
    expect(await (await fetch(grantUrl(await room(), "assets/site.css"))).text()).toContain("color: blue");
    const newest = publication("<!doctype html><h1>Latest accepted page</h1>", "h1 { color: green; }");
    await upload(newest);
    const newestResult = await commit(newest, accepted.revision);
    expect(await commit(next, oldState.room.revision, opId)).toEqual(accepted);
    expect((await publisherState()).revision).toBe(newestResult.revision);
    expect((await request(publisherToken, "/api/publisher/commit", "POST", { opId: crypto.randomUUID(), baseRevision: oldState.room.revision, files: next.files, fingerprint: next.fingerprint }, { "X-Publisher-Id": publisherLease })).status).toBe(409);
  });

  test("concurrent commits preserve compare-and-swap and exactly-once receipts", async () => {
    const state = await publisherState();
    const first = publication("<!doctype html><h1>Concurrent first</h1>");
    const second = publication("<!doctype html><h1>Concurrent second</h1>");
    await upload(first); await upload(second);
    const responses = await Promise.all([first, second].map((candidate) => request(publisherToken, "/api/publisher/commit", "POST", {
      opId: crypto.randomUUID(), baseRevision: state.revision, files: candidate.files, fingerprint: candidate.fingerprint,
    }, { "X-Publisher-Id": publisherLease })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const accepted = await publisherState();
    expect(accepted.revision).toBe(state.revision + 1);
    const retry = publication("<!doctype html><h1>Concurrent retry</h1>");
    await upload(retry);
    const opId = crypto.randomUUID();
    const receipts = await Promise.all([commit(retry, accepted.revision, opId), commit(retry, accepted.revision, opId)]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect((await publisherState()).revision).toBe(accepted.revision + 1);
    expect((await commit(retry, receipts[0]!.revision)).revision).toBe(receipts[0]!.revision);
  });

  test("publisher leases exclude duplicate connections and report recoverable publication failures", async () => {
    const observer = await connect(reader.token);
    const state = await publisherState();
    const duplicate = await request(null, `/publisher/ws?token=${publisherToken}`, "GET", undefined, { Upgrade: "websocket", Connection: "close" });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json() as { error: string }).error).toContain("publisher");
    const unleasedCommit = await request(publisherToken, "/api/publisher/commit", "POST", {
      opId: crypto.randomUUID(), baseRevision: state.revision, files: originalPublication.files, fingerprint: originalPublication.fingerprint,
    });
    expect(unleasedCommit.status).toBe(409);
    expect((await unleasedCommit.json() as { error: string }).error).toContain("Publisher connection changed");
    const wrongLease = await request(publisherToken, "/api/publisher/error", "POST", { message: "Wrong lease" }, { "X-Publisher-Id": "outdated" });
    expect(wrongLease.status).toBe(409);
    expect((await wrongLease.json() as { error: string }).error).toContain("Publisher connection changed");
    await json(publisherToken, "/api/publisher/error", "POST", { message: "Resource upload interrupted" }, { "X-Publisher-Id": publisherLease });
    await observer.wait("error", (message) => message.message.includes("Resource upload interrupted"));
    const late = await connect(reader.token);
    await late.wait("error", (message) => message.message.includes("Resource upload interrupted"));
    expect((await publisherState()).revision).toBe(state.revision);
    expect((await fetch(grantUrl(await room()))).status).toBe(200);
    await json(publisherToken, "/api/publisher/error", "POST", { message: "" }, { "X-Publisher-Id": publisherLease });
    await observer.wait("content", (message) => message.room.revision === state.revision);
    expect((await publisherState()).revision).toBe(state.revision);
  });

  test("invitation revocation invalidates all redeemed guests, sockets, and prior resource grants", async () => {
    const link = await invitation("comment");
    const first = await redeem(link.token, "Revoked one");
    const second = await redeem(link.token, "Revoked two");
    const socket = await connect(first.token);
    const page = grantUrl(await room(first.token));
    await json(ownerToken, `/api/rooms/${roomId}/links`, "DELETE");
    await socket.wait("closed");
    for (const token of [first.token, second.token]) {
      expect((await request(token, "/api/state")).status).toBe(401);
      expect((await request(token, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "After revoke" })).status).toBe(401);
    }
    expect((await request(null, "/api/invitations/redeem", "POST", { token: link.token, name: "Late visitor" })).ok).toBe(false);
    expect((await fetch(page)).ok).toBe(false);
  });

  test("current project ACL applies to connected sockets and last-administrator protection", async () => {
    const temporary = await json<CollaborationInvite>(ownerToken, "/api/members", "POST", { name: "Temporary writer", role: "writer" });
    const socket = await connect(temporary.token);
    await json(ownerToken, `/api/members/${temporary.member.id}`, "PATCH", { role: "reader" });
    await socket.wait("project", (message) => message.state.self.role === "reader");
    expect((await request(temporary.token, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "Stale writer role" })).status).toBe(403);
    const page = grantUrl(await room(temporary.token));
    await json(ownerToken, `/api/members/${temporary.member.id}`, "DELETE");
    await socket.wait("closed");
    expect((await fetch(page)).ok).toBe(false);
    expect((await request(ownerToken, "/api/members/owner", "DELETE")).status).toBe(409);
    expect((await request(ownerToken, "/api/members/owner", "PATCH", { role: "reader" })).status).toBe(409);
  });

  test("turning sharing off revokes old grants permanently and allows fresh grants after re-enabling", async () => {
    const observer = await connect(reader.token);
    const before = await room();
    const oldPage = grantUrl(before);
    await json(ownerToken, `/api/rooms/${roomId}`, "PATCH", { enabled: false });
    await expectHostOffline(observer);
    expect((await fetch(oldPage)).ok).toBe(false);
    expect((await request(reader.token, `/api/rooms/${roomId}`)).status).toBe(423);
    await json(ownerToken, `/api/rooms/${roomId}`, "PATCH", { enabled: true });
    host!.send({ type: "join", roomId });
    await host!.wait("room");
    expect((await fetch(oldPage)).ok).toBe(false);
    const restored = await room(reader.token);
    expect(restored.room.revision).toBe(before.room.revision);
    expect((await fetch(grantUrl(restored))).status).toBe(200);
    await connect(reader.token);
  });

  test("publisher loss locks collaborators and old grants until both publisher and owner return", async () => {
    const link = await invitation("comment");
    const reviewer = await redeem(link.token);
    const observer = await connect(reviewer.token);
    const retryBase = (await publisherState()).revision;
    const retryOperation = crypto.randomUUID();
    const retryReceipt = await commit(originalPublication, retryBase, retryOperation);
    const before = await room(reviewer.token);
    const page = grantUrl(before);
    const oldLease = publisherLease;
    await publisher.close();
    await expectHostOffline(observer);
    expect((await room()).room.hostOnline).toBe(false);
    await assertOffline(reviewer.token, page, link.token, before.room.revision);
    expect((await request(publisherToken, "/api/publisher/commit", "POST", {
      opId: crypto.randomUUID(), baseRevision: before.room.revision, files: originalPublication.files, fingerprint: originalPublication.fingerprint,
    }, { "X-Publisher-Id": oldLease })).status).toBe(409);
    await connectPublisher();
    expect(publisherLease).not.toBe(oldLease);
    expect(await commit(originalPublication, retryBase, retryOperation)).toEqual(retryReceipt);
    expect((await room()).room.hostOnline).toBe(true);
    expect((await fetch(page)).ok).toBe(false);
    const restored = await room(reviewer.token);
    expect((await fetch(grantUrl(restored))).status).toBe(200);
    await connect(reviewer.token);
    expect((await request(publisherToken, "/api/publisher/commit", "POST", {
      opId: crypto.randomUUID(), baseRevision: before.room.revision, files: originalPublication.files, fingerprint: originalPublication.fingerprint,
    }, { "X-Publisher-Id": oldLease })).status).toBe(409);
  });

  test("the last owner departure ejects collaborators and an unjoined owner socket cannot reopen access", async () => {
    const link = await invitation("comment");
    const reviewer = await redeem(link.token);
    const guestSocket = await connect(reviewer.token);
    const memberSocket = await connect(writer.token);
    const before = await room(reviewer.token);
    const saved = await json<CollaborationComment>(reviewer.token, `/api/rooms/${roomId}/comments`, "POST", comment(before.room.revision, "Preserved through owner departure"));
    const page = grantUrl(before);
    await host!.close(); host = null;
    await Promise.all([expectHostOffline(guestSocket), expectHostOffline(memberSocket)]);
    expect((await publisherState()).hostOnline).toBe(false);
    expect((await room()).room.hostOnline).toBe(false);
    await json<CollaborationProjectState>(ownerToken, "/api/state");
    for (const token of [reviewer.token, writer.token, reader.token]) await assertOffline(token, page, link.token, before.room.revision);
    const unjoined = new Connection(ownerToken);
    await unjoined.wait("welcome");
    expect((await publisherState()).hostOnline).toBe(false);
    await unjoined.close();
    await connectHost();
    const recovered = await room(reviewer.token);
    expect(recovered.room.hostOnline).toBe(true);
    expect(recovered.room.revision).toBe(before.room.revision);
    expect(recovered.comments.some((entry) => entry.id === saved.id)).toBe(true);
    expect((await fetch(page)).ok).toBe(false);
    expect((await fetch(grantUrl(recovered))).status).toBe(200);
    await connect(reviewer.token);
  });

  test("multiple owner tabs maintain access until the last tab leaves its room", async () => {
    const reviewer = await redeem((await invitation("comment")).token);
    const guest = await connect(reviewer.token);
    const otherOwner = await connect(ownerToken);
    const page = grantUrl(await room(reviewer.token));
    await host!.close(); host = null;
    expect((await room(reviewer.token)).room.hostOnline).toBe(true);
    const sentAt = Date.now();
    guest.send({ type: "ping", sentAt });
    await guest.wait("pong", (message) => message.sentAt === sentAt);
    expect((await fetch(page)).status).toBe(200);
    expect(guest.messages.some((message) => message.type === "closed")).toBe(false);
    otherOwner.send({ type: "leave" });
    await expectHostOffline(guest);
    expect((await publisherState()).hostOnline).toBe(false);
    otherOwner.send({ type: "join", roomId });
    await otherOwner.wait("room");
    expect((await room(reviewer.token)).room.hostOnline).toBe(true);
    expect((await fetch(page)).ok).toBe(false);
    await connectHost();
  });

  test("a registered room owner cannot be removed or reduced below writer even when another admin exists", async () => {
    const admin = await json<CollaborationInvite>(ownerToken, "/api/members", "POST", { name: "Recovery administrator", role: "admin" });
    expect((await request(admin.token, "/api/members/owner", "PATCH", { role: "reader" })).status).toBe(409);
    expect((await request(admin.token, "/api/members/owner", "DELETE")).status).toBe(409);
    expect((await room()).room.hostOnline).toBe(true);
    await json(ownerToken, `/api/members/${admin.member.id}`, "DELETE");
  });

  test("an owner heartbeat deadline ejects guests through a persisted alarm after hibernation", async () => {
    const link = await invitation("comment");
    const reviewer = await redeem(link.token);
    const guest = await connect(reviewer.token);
    const before = await room(reviewer.token);
    const page = grantUrl(before);
    host!.stopHeartbeat();
    publisher.stopHeartbeat();
    const sentAt = Date.now();
    host!.send({ type: "ping", sentAt });
    await host!.wait("pong", (message) => message.sentAt === sentAt);
    await runtime.unsafeEvictDurableObject(workerName, "ProjectCollaboration", { name: projectId, webSockets: "hibernate" });
    await expectHostOffline(guest, 22000);
    publisher.startHeartbeat(15000);
    await assertOffline(reviewer.token, page, link.token, before.room.revision);
    expect((await room()).room.hostOnline).toBe(false);
    await host!.close(); host = null;
    await connectHost();
    expect((await room(reviewer.token)).room.hostOnline).toBe(true);
    expect((await fetch(page)).ok).toBe(false);
  }, 25000);

  test("a silent publisher expires even while owner heartbeats remain healthy", async () => {
    const link = await invitation("comment");
    const reviewer = await redeem(link.token);
    const guest = await connect(reviewer.token);
    const before = await room(reviewer.token);
    const page = grantUrl(before);
    publisher.stopHeartbeat();
    const sentAt = Date.now();
    publisher.send({ type: "ping", sentAt });
    await publisher.wait("pong", (message) => message.sentAt === sentAt);
    await expectHostOffline(guest, 52000);
    await assertOffline(reviewer.token, page, link.token, before.room.revision);
    expect((await room()).room.hostOnline).toBe(false);
    await publisher.close();
    await connectPublisher();
    expect((await room(reviewer.token)).room.hostOnline).toBe(true);
    expect((await fetch(page)).ok).toBe(false);
  }, 55000);

  test("the same sockets and grants survive real Durable Object hibernation", async () => {
    const visitor = await redeem((await invitation("comment")).token, "Hibernation reviewer");
    const socket = await connect(visitor.token);
    const before = await room(visitor.token);
    const view = { page: "index.html", revision: before.room.revision, scrollX: 0, scrollY: 125,
      width: 900, height: 700, documentWidth: 900, documentHeight: 1900 };
    const presenceSentAt = Date.now();
    socket.send({ type: "presence", view, cursor: { x: 30, y: 70 }, followingId: null, sentAt: presenceSentAt });
    await socket.wait("presence", (message) => message.sentAt === presenceSentAt);
    const page = grantUrl(before);
    await runtime.unsafeEvictDurableObject(workerName, "ProjectCollaboration", { name: projectId, webSockets: "hibernate" });
    const sentAt = Date.now();
    socket.send({ type: "ping", sentAt });
    await socket.wait("pong", (message) => message.sentAt === sentAt);
    expect((await fetch(page)).status).toBe(200);
    const restored = await room(visitor.token);
    expect(restored.room.hostOnline).toBe(true);
    expect(restored.participants.find((participant) => participant.name === "Hibernation reviewer")?.view).toEqual(view);
    publisher.send({ type: "ping", sentAt });
    await publisher.wait("pong", (message) => message.sentAt === sentAt);
    const created = await json<CollaborationComment>(visitor.token, `/api/rooms/${roomId}/comments`, "POST", comment(before.room.revision, "Accepted after wake"));
    expect(created.messages[0]!.authorName).toBe("Hibernation reviewer");
    await json(ownerToken, `/api/rooms/${roomId}/links`, "DELETE");
    await socket.wait("closed");
    expect((await fetch(page)).ok).toBe(false);
  }, 10000);

  test("immediate browser join and ping preserve both participants through presence, follow, and hibernation", async () => {
    const visitor = await redeem((await invitation("comment")).token, "Immediate join reviewer");
    const revision = (await publisherState()).revision;
    const view = { page: "index.html", revision, scrollX: 0, scrollY: 125,
      width: 900, height: 700, documentWidth: 900, documentHeight: 1900 };
    const joinImmediately = async (token: string) => {
      const connection = new Connection(token);
      const welcome = await connection.wait("welcome");
      const sentAt = Date.now();
      connection.send({ type: "join", roomId });
      connection.send({ type: "ping", sentAt });
      await Promise.all([connection.wait("room"), connection.wait("pong", (message) => message.sentAt === sentAt)]);
      return { connection, id: welcome.connectionId };
    };
    await host!.close(); host = null;
    for (let round = 0; round < 24; round++) {
      const host = await joinImmediately(ownerToken);
      const guest = await joinImmediately(visitor.token);
      const checkParticipants = async () => {
        const participants = (await room()).participants;
        expect(participants.map((participant) => participant.id).sort()).toEqual([host.id, guest.id].sort());
        expect(participants.find((participant) => participant.id === guest.id)?.followingId).toBe(host.id);
      };
      const update = async (offset: number) => {
        const sentAt = round * 10 + offset;
        host.connection.send({ type: "presence", view: { ...view, scrollY: sentAt }, cursor: { x: 40, y: 80 }, followingId: null, sentAt });
        await guest.connection.wait("presence", (message) => message.participant.id === host.id && message.sentAt === sentAt);
        guest.connection.send({ type: "presence", view: { ...view, scrollY: sentAt }, cursor: { x: 20, y: 30 }, followingId: host.id, sentAt });
        await host.connection.wait("presence", (message) => message.participant.id === guest.id && message.sentAt === sentAt);
      };
      await update(1);
      await checkParticipants();
      await runtime.unsafeEvictDurableObject(workerName, "ProjectCollaboration", { name: projectId, webSockets: "hibernate" });
      const sentAt = Date.now();
      host.connection.send({ type: "ping", sentAt });
      guest.connection.send({ type: "ping", sentAt });
      await Promise.all([
        host.connection.wait("pong", (message) => message.sentAt === sentAt),
        guest.connection.wait("pong", (message) => message.sentAt === sentAt),
      ]);
      await checkParticipants();
      await update(2);
      await checkParticipants();
      await Promise.all([host.connection.close(), guest.connection.close()]);
    }
    await connectHost();
  }, 15000);

  test("a current cloud viewer rebuild creates a new revision and fences retired pinned publications", async () => {
    const base = `/projects/${projectId}`;
    const workspaceId = `upgrade-${crypto.randomUUID()}`;
    await json(ownerToken, `${base}/api/workspaces`, "POST", { id: workspaceId, name: workspaceId, placement: "local" });
    const compatibility = { ...upgradeCompatibility, coreVersion: "4.0.0", viewerHash: "e".repeat(64) };
    const registration = await json<{ room: { id: string }; publisherToken: string }>(ownerToken, `${base}/api/rooms`, "POST", { opId: crypto.randomUUID(), workspaceId, modeInstanceId: crypto.randomUUID(), mode: "webcraft", title: "Upgrade", page: "index.html", compatibility, frameScript });
    const candidate = publication("<!doctype html><h1>Same complete content</h1>");
    const projection: CollaborationPublicationProjection = { schema: "upgrade-v1", sources: { files: [{ path: "index.html", content: "Same complete content" }] }, entryAddress: { file: "index.html" } };
    const snapshot = { ...candidate, blobs: candidate.bytes, projection, fingerprint: digest(canonical({ files: candidate.files, projection })) };
    const options = { authorityBaseUrl: `${origin}${base}`, roomId: registration.room.id, publisherToken: registration.publisherToken, getSnapshot: () => snapshot };
    const first = await startCollaborationPublisher(options); normalPublishers.push(first);
    const ownerView = new Connection(ownerToken, `${base}/ws`); await ownerView.wait("welcome"); ownerView.send({ type: "join", roomId: registration.room.id }); await ownerView.wait("room"); ownerView.startHeartbeat(5000);
    const pin = await json<CollaborationReference>(ownerToken, `${base}/api/references`, "POST", { opId: crypto.randomUUID(), destinationWorkspaceId: workspaceId, label: "Keep old reference", source: { projectId, workspaceId, roomId: registration.room.id, publicationRevision: 1, address: { file: "index.html" } } });
    await first.stop();
    const second = await startCollaborationPublisher({ ...options, viewer: { compatibility: upgradeCompatibility, frameScript } }); normalPublishers.push(second);
    const current = await json<CollaborationRoomState>(ownerToken, `${base}/api/rooms/${registration.room.id}`);
    expect(current.room.revision).toBe(2); expect(current.room.compatibility).toEqual(upgradeCompatibility); expect(current.room.viewerRevisionStart).toBe(2);
    expect(current.publication?.projection).toEqual(projection);
    const pinned = await request(ownerToken, `${base}/api/references/${pin.id}/resolve`);
    expect(pinned.status).toBe(410); expect((await pinned.json() as { code: string }).code).toBe("publication_viewer_unavailable");
    const oldResource = new URL(current.pageUrl, origin); oldResource.pathname = oldResource.pathname.replace("/revisions/2/", "/revisions/1/");
    expect((await fetch(oldResource)).status).toBe(410);
    await second.stop();
    await expect(startCollaborationPublisher({ ...options, viewer: { compatibility, frameScript } })).rejects.toThrow("packaged viewer");
  }, 15000);

  test("formal multi-room publishers preserve workspace ownership, room leases and atomic Source revisions", async () => {
    const base = `/projects/${projectId}`;
    const preflight = await request(null, `${base}/api/rooms`, "OPTIONS", undefined, { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" });
    expect(preflight.status).toBe(204); expect(preflight.headers.get("access-control-allow-origin")).toBe("*"); expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    const unauthorized = await request(null, `${base}/api/state`, "GET", undefined, { Origin: "http://localhost:5173" });
    expect(unauthorized.status).toBe(401); expect(unauthorized.headers.get("access-control-allow-origin")).toBe("*");
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    expect((await request(reader.token, `${base}/api/workspaces`, "POST", { id: workspaceId, name: "Reader work", placement: "local" })).status).toBe(403);
    await json(writer.token, `${base}/api/workspaces`, "POST", { id: workspaceId, name: "Writer work", placement: "local" });
    expect((await request(ownerToken, `${base}/api/workspaces`, "POST", { id: workspaceId, name: "Admin takeover", placement: "local" })).status).toBe(403);
    const registration = { opId: crypto.randomUUID(), workspaceId, modeInstanceId: crypto.randomUUID(), mode: "webcraft", title: "Writer page", page: "index.html",
      compatibility: { coreVersion: "4.0.0", modeVersion: "1.0.0", viewerHash: "a".repeat(64), publicationSchema: "webcraft-public-v1" }, frameScript };
    expect((await request(ownerToken, `${base}/api/rooms`, "POST", registration)).status).toBe(403);
    const second = await json<{ room: { id: string }; publisherToken: string }>(writer.token, `${base}/api/rooms`, "POST", registration);
    expect(await json(writer.token, `${base}/api/rooms`, "POST", registration)).toEqual(second);
    expect((await request(writer.token, `${base}/api/rooms`, "POST", { ...registration, title: "Different operation input" })).status).toBe(409);
    const secondId = second.room.id;
    expect((await request(reader.token, `${base}/api/rooms`, "POST", registration)).status).toBe(403);
    const candidate = publication("<!doctype html><h1>Second owner</h1>");
    const projection: CollaborationPublicationProjection = { schema: "webcraft-public-v1", sources: { files: [{ path: "index.html", content: "Second owner" }] }, entryAddress: { file: "index.html" } };
    let snapshot = { ...candidate, blobs: candidate.bytes, projection, fingerprint: digest(canonical({ files: candidate.files, projection })) };
    const secondPublisher = await startCollaborationPublisher({ authorityBaseUrl: `${origin}${base}`, roomId: secondId, publisherToken: second.publisherToken, getSnapshot: () => snapshot });
    normalPublishers.push(secondPublisher);
    const secondHost = new Connection(writer.token, `${base}/ws`);
    await secondHost.wait("welcome"); secondHost.send({ type: "join", roomId: secondId }); await secondHost.wait("room"); secondHost.startHeartbeat(5000);
    const firstPage = grantUrl(await room(reader.token));
    const secondViewer = new Connection(reader.token, `${base}/ws`);
    await secondViewer.wait("welcome"); secondViewer.send({ type: "join", roomId: secondId }); const secondState = (await secondViewer.wait("room")).state;
    expect(secondState.publication?.projection).toEqual(projection);
    expect(secondState.publication?.files).toEqual(candidate.files);
    expect(secondState.room.revision).toBe(1);
    const acceptedSnapshot = snapshot;
    snapshot = { ...snapshot, projection: { ...projection, schema: "wrong-schema" } };
    snapshot.fingerprint = digest(canonical({ files: snapshot.files, projection: snapshot.projection }));
    await expect(secondPublisher.sync()).rejects.toThrow("schema");
    expect((await json<CollaborationRoomState>(reader.token, `${base}/api/rooms/${secondId}`)).publication?.projection).toEqual(projection);
    snapshot = acceptedSnapshot; await secondPublisher.sync();
    const secondPage = new URL(secondState.pageUrl, origin);
    expect(await (await fetch(secondPage)).text()).toContain("Second owner");
    expect((await request(publisherToken, `${base}/api/publisher/rooms/${secondId}/state`)).status).toBe(401);
    expect((await request(second.publisherToken, `${base}/api/publisher/rooms/${roomId}/state`)).status).toBe(401);
    expect((await request(ownerToken, `${base}/api/rooms/${secondId}/content`, "PUT", { html: "Admin takeover" })).status).toBe(403);
    const firstThread = await json<CollaborationComment>(writer.token, `${base}/api/rooms/${roomId}/comments`, "POST", comment((await room()).room.revision, "First room only"));
    expect((await request(writer.token, `${base}/api/rooms/${secondId}/comments/${firstThread.id}`, "PATCH", { opId: crypto.randomUUID(), body: "Wrong room" })).status).toBe(404);
    const secondThread = await json<CollaborationComment>(writer.token, `${base}/api/rooms/${secondId}/comments`, "POST", comment(1, "Second room only"));
    expect((await room()).comments.some((entry) => entry.id === secondThread.id)).toBe(false);
    const guestLink = await json<CollaborationGuestLink>(writer.token, `${base}/api/rooms/${secondId}/links`, "POST", {});
    expect(guestLink.access).toBe("view");
    const guest = await json<{ token: string }>(null, `${base}/api/invitations/redeem`, "POST", { token: guestLink.token, name: "Second-room guest" });
    const guestState = await json<CollaborationProjectState>(guest.token, `${base}/api/state`);
    expect(guestState.rooms.map((room) => room.id)).toEqual([secondId]); expect(guestState.workspaces).toEqual([]);
    expect((await request(guest.token, `${base}/api/rooms/${roomId}`)).status).toBe(404);
    secondHost.send({ type: "leave" }); await expectHostOffline(secondViewer);
    expect((await fetch(secondPage)).ok).toBe(false); expect((await fetch(firstPage)).status).toBe(200);
    expect((await request(reader.token, `${base}/api/state`)).status).toBe(200);
    expect((await request(reader.token, `${base}/api/rooms/${secondId}`)).status).toBe(423);
    secondHost.send({ type: "join", roomId: secondId }); await secondHost.wait("room");
    expect((await fetch(secondPage)).ok).toBe(false);
    const manual = new Connection(reader.token, `${base}/ws`); await manual.wait("welcome"); manual.send({ type: "join", roomId: secondId }); await manual.wait("room");
    await secondPublisher.stop(); await expectHostOffline(manual);
    expect((await fetch(firstPage)).status).toBe(200);
    secondHost.send({ type: "leave" });
    expect((await request(reader.token, `${base}/api/rooms/${secondId}`, "PATCH", { enabled: false })).status).toBe(403);
    expect((await request(ownerToken, `${base}/api/rooms/${secondId}`, "PATCH", { enabled: false })).status).toBe(200);
    expect((await request(writer.token, `${base}/api/rooms/${secondId}`, "DELETE")).status).toBe(200);
    expect((await request(writer.token, `${base}/api/rooms/${secondId}`)).status).toBe(404);
  }, 20000);

  test("one deployment routes independent stable projects without borrowing credentials or publications", async () => {
    const secondProject = `project-${crypto.randomUUID()}`; const base = `/projects/${secondProject}`;
    const token = crypto.randomUUID();
    const config = { project: { id: secondProject, name: "Another project" }, owner: { id: "owner", name: "Separate owner", token } };
    const unauthorized = await request(ownerToken, `${base}/internal/bootstrap`, "POST", config);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Bootstrap authorization required" });
    await json(bootstrapSecret, `${base}/internal/bootstrap`, "POST", config);
    const state = await json<CollaborationProjectState>(token, `${base}/api/state`);
    expect(state.project.id).toBe(secondProject); expect(state.rooms).toEqual([]); expect(state.workspaces).toEqual([]);
    expect((await request(ownerToken, `${base}/api/state`)).status).toBe(401);
    expect((await request(token, `/projects/${projectId}/api/state`)).status).toBe(401);
    expect((await request(token, `${base}/api/rooms/${roomId}`)).status).toBe(404);
  });

  test("pinned references retain immutable revisions with atomic quota, refresh, revocation and restart semantics", async () => {
    const base = `/projects/${projectId}`, sourceWorkspace = `source-${crypto.randomUUID()}`, destinationWorkspace = `destination-${crypto.randomUUID()}`;
    await json(ownerToken, `${base}/api/workspaces`, "POST", { id: sourceWorkspace, name: "Source", placement: "local" });
    await json(writer.token, `${base}/api/workspaces`, "POST", { id: destinationWorkspace, name: "Destination", placement: "local" });
    const compatibility = { coreVersion: "4.0.0", modeVersion: "1.0.0", viewerHash: "b".repeat(64), publicationSchema: "pins-v1" };
    const registration = await json<{ room: { id: string }; publisherToken: string }>(ownerToken, `${base}/api/rooms`, "POST", { opId: crypto.randomUUID(), workspaceId: sourceWorkspace, modeInstanceId: crypto.randomUUID(), mode: "webcraft", title: "Pinned source", page: "index.html", compatibility, frameScript });
    const sourceRoomId = registration.room.id;
    const makeSnapshot = (revision: number) => {
      const content = `<!doctype html><h1>Immutable pin revision ${revision}</h1>`;
      const candidate = publication(content);
      const projection = { schema: compatibility.publicationSchema, sources: { files: [{ path: "index.html", content }] }, entryAddress: { file: "index.html" } };
      return { ...candidate, blobs: candidate.bytes, projection, fingerprint: digest(canonical({ files: candidate.files, projection })) };
    };
    let current = makeSnapshot(1);
    const publisherOptions = { roomId: sourceRoomId, publisherToken: registration.publisherToken, getSnapshot: () => current };
    const sourcePublisher = await startCollaborationPublisher({ authorityBaseUrl: `${origin}${base}`, ...publisherOptions }); normalPublishers.push(sourcePublisher);
    const sourceHost = new Connection(ownerToken, `${base}/ws`); await sourceHost.wait("welcome"); sourceHost.send({ type: "join", roomId: sourceRoomId }); await sourceHost.wait("room"); sourceHost.startHeartbeat(5000);
    const source = (revision: number) => ({ projectId, workspaceId: sourceWorkspace, roomId: sourceRoomId, publicationRevision: revision, address: { file: "index.html", selector: "h1" } });
    const body = { opId: crypto.randomUUID(), destinationWorkspaceId: destinationWorkspace, label: "Pinned original", source: source(1) };
    expect((await request(ownerToken, `${base}/api/references`, "POST", body)).status).toBe(403);
    expect((await request(reader.token, `${base}/api/references`, "POST", body)).status).toBe(403);
    expect((await request(writer.token, `${base}/api/references`, "POST", { ...body, source: { ...source(1), projectId: "another-project" } })).status).toBe(400);
    expect((await request(writer.token, `${base}/api/references`, "POST", { ...body, source: { ...source(1), workspaceId: destinationWorkspace } })).status).toBe(400);
    const pin = await json<CollaborationReference>(writer.token, `${base}/api/references`, "POST", body);
    expect(await json(writer.token, `${base}/api/references`, "POST", body)).toEqual(pin);
    expect(JSON.stringify(pin)).not.toContain("Immutable pin revision"); expect(JSON.stringify(pin)).not.toContain("pageUrl");
    const duplicate = await json<CollaborationReference>(writer.token, `${base}/api/references`, "POST", { ...body, opId: crypto.randomUUID() });
    for (let revision = 2; revision <= 7; revision++) {
      current = makeSnapshot(revision); await sourcePublisher.sync();
      await json(writer.token, `${base}/api/references`, "POST", { ...body, opId: crypto.randomUUID(), source: source(revision) });
    }
    current = makeSnapshot(8); await sourcePublisher.sync();
    const before = await json(reader.token, `${base}/api/references?workspaceId=${destinationWorkspace}`);
    expect((await request(writer.token, `${base}/api/references`, "POST", { ...body, opId: crypto.randomUUID(), source: source(8) })).status).toBe(409);
    expect(await json(reader.token, `${base}/api/references?workspaceId=${destinationWorkspace}`)).toEqual(before);
    for (let revision = 9; revision <= 12; revision++) { current = makeSnapshot(revision); await sourcePublisher.sync(); }
    const pinned = await json<CollaborationResolvedReference>(reader.token, `${base}/api/references/${pin.id}/resolve`);
    expect(pinned.publication.revision).toBe(1); expect(pinned.room.revision).toBe(1); expect(pinned.compatibility).toEqual(compatibility);
    expect(pinned.publication.projection).toEqual(makeSnapshot(1).projection);
    const oldPage = new URL(pinned.pageUrl, origin); expect(await (await fetch(oldPage)).text()).toContain("Immutable pin revision 1");
    for (const file of pinned.publication.files) {
      const response = await fetch(new URL(file.path, oldPage), { headers: { "X-Pneuma-Publication-Bytes": "1" } });
      expect(response.headers.get("content-type")).toBe("application/octet-stream"); expect(response.headers.get("content-disposition")).toBe("attachment");
      const bytes = new Uint8Array(await response.arrayBuffer()); expect(bytes.length).toBe(file.size); expect(digest(bytes)).toBe(file.hash);
    }
    expect((await request(ownerToken, `${base}/api/references/${pin.id}`, "DELETE", { opId: crypto.randomUUID() })).status).toBe(403);
    expect((await request(reader.token, `${base}/api/references/${pin.id}`, "PATCH", { opId: crypto.randomUUID(), source: source(12) })).status).toBe(403);
    const refreshBody = { opId: crypto.randomUUID(), source: source(12) };
    expect((await request(writer.token, `${base}/api/references/${pin.id}`, "PATCH", refreshBody)).status).toBe(409);
    expect((await json<CollaborationResolvedReference>(reader.token, `${base}/api/references/${pin.id}/resolve`)).publication.revision).toBe(1);
    const removeBody = { opId: crypto.randomUUID() };
    await json(writer.token, `${base}/api/references/${duplicate.id}`, "DELETE", removeBody);
    expect(await json(writer.token, `${base}/api/references/${duplicate.id}`, "DELETE", removeBody)).toEqual({ ok: true, id: duplicate.id });
    const refreshed = await json<CollaborationReference>(writer.token, `${base}/api/references/${pin.id}`, "PATCH", refreshBody);
    expect(refreshed.source.publicationRevision).toBe(12);
    expect(await json(writer.token, `${base}/api/references/${pin.id}`, "PATCH", refreshBody)).toEqual(refreshed);
    current = makeSnapshot(13); await sourcePublisher.sync();
    expect((await fetch(oldPage)).status).toBe(404);
    expect((await request(writer.token, `${base}/api/references`, "POST", { ...body, opId: crypto.randomUUID(), source: source(1) })).status).toBe(410);
    const revocable = await json<CollaborationInvite>(ownerToken, `${base}/api/members`, "POST", { name: "Pin reader", role: "reader" });
    const revocableResolved = await json<CollaborationResolvedReference>(revocable.token, `${base}/api/references/${pin.id}/resolve`);
    await json(ownerToken, `${base}/api/members/${revocable.member.id}`, "DELETE");
    expect((await request(revocable.token, `${base}/api/references/${pin.id}/resolve`)).status).toBe(401);
    expect((await fetch(new URL(revocableResolved.pageUrl, origin), { headers: { "X-Pneuma-Publication-Bytes": "1" } })).ok).toBe(false);
    const link = await json<CollaborationGuestLink>(ownerToken, `${base}/api/rooms/${sourceRoomId}/links`, "POST", { access: "comment" });
    const guest = await json<{ token: string }>(null, `${base}/api/invitations/redeem`, "POST", { token: link.token, name: "Guest" });
    expect((await request(guest.token, `${base}/api/references`)).status).toBe(403);
    expect((await request(guest.token, `${base}/api/references`, "POST", { ...body, opId: crypto.randomUUID(), source: source(13) })).status).toBe(403);
    sourceHost.send({ type: "leave" });
    expect((await request(reader.token, `${base}/api/references/${pin.id}/resolve`)).status).toBe(423);
    expect((await fetch(new URL(pinned.pageUrl, origin), { headers: { "X-Pneuma-Publication-Bytes": "1" } })).ok).toBe(false);
    await sourcePublisher.stop(); await sourceHost.close(); await host!.close(); host = null; await publisher.close(); await runtime.dispose(); await startRuntime();
    expect((await request(reader.token, `${base}/api/references/${pin.id}/resolve`)).status).toBe(423);
    expect((await json<{ references: CollaborationReference[] }>(reader.token, `${base}/api/references?workspaceId=${destinationWorkspace}`)).references.find((record) => record.id === pin.id)).toEqual(refreshed);
    await connectPublisher(); await connectHost();
    const restoredPublisher = await startCollaborationPublisher({ authorityBaseUrl: `${origin}${base}`, ...publisherOptions }); normalPublishers.push(restoredPublisher);
    const restoredHost = new Connection(ownerToken, `${base}/ws`); await restoredHost.wait("welcome"); restoredHost.send({ type: "join", roomId: sourceRoomId }); await restoredHost.wait("room"); restoredHost.startHeartbeat(5000);
    expect(await json(writer.token, `${base}/api/references`, "POST", body)).toEqual(pin); // Receipt survives even after explicit refresh/old reservation eviction.
    expect(await json(writer.token, `${base}/api/references/${pin.id}`, "PATCH", refreshBody)).toEqual(refreshed);
    expect((await json<CollaborationResolvedReference>(reader.token, `${base}/api/references/${pin.id}/resolve`)).publication.projection).toEqual(makeSnapshot(12).projection);
    await json(ownerToken, `${base}/api/rooms/${sourceRoomId}`, "PATCH", { enabled: false });
    expect((await request(reader.token, `${base}/api/references/${pin.id}/resolve`)).status).toBe(403);
    await json(ownerToken, `${base}/api/rooms/${sourceRoomId}`, "DELETE");
    expect((await request(reader.token, `${base}/api/references/${pin.id}/resolve`)).status).toBe(410);
    await json(writer.token, `${base}/api/references/${pin.id}`, "DELETE", { opId: crypto.randomUUID() });
  }, 30000);

  test("durable receipts, ACL, and comments survive restart without bootstrap resetting them", async () => {
    const state = await room();
    const opId = crypto.randomUUID();
    const originalBody = comment(state.room.revision, "Restart-safe comment", opId);
    const body = { ...originalBody, anchor: { ...originalBody.anchor, preview: { label: "Persistent heading", thumbnail: "data:image/png;base64,aGVsbG8=" } } };
    const accepted = await json<CollaborationComment>(writer.token, `/api/rooms/${roomId}/comments`, "POST", body);
    expect((await json<CollaborationComment>(writer.token, `/api/rooms/${roomId}/comments`, "POST", body)).id).toBe(accepted.id);
    expect((await request(writer.token, `/api/rooms/${roomId}/comments`, "POST", { ...body, body: "Different retry" })).status).toBe(409);
    const otherActor = await json<CollaborationComment>(ownerToken, `/api/rooms/${roomId}/comments`, "POST", body);
    expect(otherActor.id).not.toBe(accepted.id);
    const removed = await json<CollaborationInvite>(ownerToken, "/api/members", "POST", { name: "Removed before restart", role: "writer" });
    await json(ownerToken, `/api/members/${removed.member.id}`, "DELETE");
    await host!.close(); host = null;
    await publisher.close();
    await runtime.dispose();
    await startRuntime();
    await json(bootstrapSecret, "/internal/bootstrap", "POST", bootstrap);
    const restored = await room();
    expect(restored.room.revision).toBe(state.room.revision);
    expect(restored.comments.some((entry) => entry.id === accepted.id)).toBe(true);
    expect(restored.comments.find((entry) => entry.id === accepted.id)?.anchor.preview).toEqual(body.anchor.preview);
    expect(restored.room.hostOnline).toBe(false);
    expect((await request(removed.token, "/api/state")).status).toBe(401);
    await connectPublisher();
    await connectHost();
    expect((await json<CollaborationComment>(writer.token, `/api/rooms/${roomId}/comments`, "POST", body)).id).toBe(accepted.id);
    expect((await fetch(grantUrl(await room()))).status).toBe(200);
  }, 15000);
  test("two formal room heads and registration receipts survive workerd restart with explicit rejoin", async () => {
    const id = `restart-${crypto.randomUUID()}`, base = `/projects/${id}`, owner = crypto.randomUUID();
    const config = { project: { id, name: "Multi-room restart" }, owner: { id: "owner", name: "Owner", token: owner } };
    await json(bootstrapSecret, `${base}/internal/bootstrap`, "POST", config);
    const writer = await json<CollaborationInvite>(owner, `${base}/api/members`, "POST", { name: "Writer", role: "writer" });
    const reader = await json<CollaborationInvite>(owner, `${base}/api/members`, "POST", { name: "Reader", role: "reader" });
    const registrations = [];
    for (const [index, token] of [owner, writer.token].entries()) {
      const workspaceId = `restart-workspace-${index}`;
      await json(token, `${base}/api/workspaces`, "POST", { id: workspaceId, name: workspaceId, placement: "local" });
      const body = { opId: crypto.randomUUID(), workspaceId, modeInstanceId: crypto.randomUUID(), mode: "webcraft", title: workspaceId, page: "index.html", compatibility: { coreVersion: "4.0.0", modeVersion: "1.0.0", viewerHash: "d".repeat(64), publicationSchema: "restart-v1" }, frameScript };
      const accepted = await json<{ room: { id: string }; publisherToken: string }>(token, `${base}/api/rooms`, "POST", body);
      const candidate = publication(`<!doctype html><h1>Restart room ${index}</h1>`);
      const projection = { schema: "restart-v1", sources: { files: [{ path: "index.html", content: `Room ${index}` }] }, entryAddress: { file: "index.html" } };
      registrations.push({ token, body, accepted, snapshot: { files: candidate.files, blobs: candidate.bytes, projection, fingerprint: digest(canonical({ files: candidate.files, projection })) } });
    }
    const launch = async () => {
      const publishers = await Promise.all(registrations.map((registration) => startCollaborationPublisher({ authorityBaseUrl: `${origin}${base}`, roomId: registration.accepted.room.id, publisherToken: registration.accepted.publisherToken, getSnapshot: () => registration.snapshot })));
      normalPublishers.push(...publishers);
      const hosts = [];
      for (const registration of registrations) {
        const socket = new Connection(registration.token, `${base}/ws`); hosts.push(socket);
        await socket.wait("welcome"); socket.send({ type: "join", roomId: registration.accepted.room.id }); await socket.wait("room");
      }
      return { publishers, hosts };
    };
    const first = await launch();
    const firstStates = await Promise.all(registrations.map((registration) => json<CollaborationRoomState>(reader.token, `${base}/api/rooms/${registration.accepted.room.id}`)));
    const chatBody = { opId: crypto.randomUUID(), body: "Durable first-room discussion" };
    const chatPath = `${base}/api/rooms/${registrations[0]!.accepted.room.id}/chat`;
    const chat = await json<{ id: string }>(writer.token, chatPath, "POST", chatBody);
    await Promise.all(first.publishers.map((publisher) => publisher.stop())); await Promise.all(first.hosts.map((host) => host.close()));
    await runtime.dispose(); await startRuntime();
    expect((await request(bootstrapSecret, `${base}/internal/bootstrap`, "POST", config)).status).toBe(200);
    const state = await json<CollaborationProjectState>(owner, `${base}/api/state`);
    expect(state.rooms.map((room) => room.revision)).toEqual([1, 1]); expect(state.rooms.every((room) => room.hostOnline === false)).toBe(true);
    for (const registration of registrations) {
      expect(await json(registration.token, `${base}/api/rooms`, "POST", registration.body)).toEqual(registration.accepted);
      expect((await request(reader.token, `${base}/api/rooms/${registration.accepted.room.id}`)).status).toBe(423);
    }
    await launch();
    expect(await json(writer.token, chatPath, "POST", chatBody)).toEqual(chat);
    for (const [index, registration] of registrations.entries()) {
      const current = await json<CollaborationRoomState>(reader.token, `${base}/api/rooms/${registration.accepted.room.id}`);
      expect(current.room.revision).toBe(1); expect(current.publication?.projection).toEqual(registration.snapshot.projection);
      expect((await fetch(new URL(current.pageUrl, origin))).status).toBe(200);
      const old = new URL(firstStates[index]!.pageUrl, origin); old.host = new URL(origin).host;
      expect((await fetch(old)).ok).toBe(false);
    }
  }, 20000);

  test("admin Project removal fences both rooms through workerd restart and rejects bootstrap resurrection", async () => {
    const removedId = `removed-${crypto.randomUUID()}`, base = `/projects/${removedId}`, token = crypto.randomUUID();
    const config = { project: { id: removedId, name: "Removal fixture" }, owner: { id: "owner", name: "Administrator", token } };
    await json(bootstrapSecret, `${base}/internal/bootstrap`, "POST", config);
    const peerWriter = await json<CollaborationInvite>(token, `${base}/api/members`, "POST", { name: "Writer", role: "writer" });
    const peerReader = await json<CollaborationInvite>(token, `${base}/api/members`, "POST", { name: "Reader", role: "reader" });
    const registrations: Array<{ room: { id: string }; publisherToken: string }> = [];
    const publishers: Connection[] = [], hosts: Connection[] = [], pages: URL[] = [];
    for (const [index, owner] of [token, peerWriter.token].entries()) {
      const workspaceId = `removal-${index}`;
      await json(owner, `${base}/api/workspaces`, "POST", { id: workspaceId, name: workspaceId, placement: "local" });
      const registration = await json<{ room: { id: string }; publisherToken: string }>(owner, `${base}/api/rooms`, "POST", { opId: crypto.randomUUID(), workspaceId, modeInstanceId: crypto.randomUUID(), mode: "webcraft", title: workspaceId, page: "index.html", compatibility: { coreVersion: "4.0.0", modeVersion: "1.0.0", viewerHash: "c".repeat(64), publicationSchema: "removal-v1" }, frameScript });
      registrations.push(registration);
      const publisher = new Connection(registration.publisherToken, `${base}/publisher/ws?roomId=${registration.room.id}`); publishers.push(publisher);
      const ready = await publisher.wait("publisher_ready");
      const current = publication(`<!doctype html><h1>Removed room ${index}</h1>`);
      const projection = { schema: "removal-v1", sources: { files: [{ path: "index.html", content: `Room ${index}` }] }, entryAddress: { file: "index.html" } };
      for (const [hash, bytes] of current.bytes) expect((await fetch(`${origin}${base}/api/publisher/rooms/${registration.room.id}/blobs/${hash}`, { method: "PUT", headers: { Authorization: `Bearer ${registration.publisherToken}` }, body: new Uint8Array(bytes).buffer })).status).toBe(200);
      await json(registration.publisherToken, `${base}/api/publisher/rooms/${registration.room.id}/commit`, "POST", { opId: crypto.randomUUID(), baseRevision: 0, files: current.files, projection, fingerprint: digest(canonical({ files: current.files, projection })) }, { "X-Publisher-Id": ready.publisherId });
      const host = new Connection(owner, `${base}/ws`); hosts.push(host); await host.wait("welcome"); host.send({ type: "join", roomId: registration.room.id });
      pages.push(new URL((await host.wait("room")).state.pageUrl, origin));
    }
    const guest = new Connection(peerReader.token, `${base}/ws`); await guest.wait("welcome"); guest.send({ type: "join", roomId: registrations[0]!.room.id }); await guest.wait("room");
    const body = { opId: crypto.randomUUID() };
    for (const credential of [peerWriter.token, peerReader.token]) expect((await request(credential, `${base}/api/project`, "DELETE", body)).status).toBe(403);
    const closes = publishers.map((connection) => new Promise<CloseEvent>((resolve) => connection.socket.addEventListener("close", resolve, { once: true })));
    const removed = await json<{ ok: true; removed: true; projectId: string; removedAt: number }>(token, `${base}/api/project`, "DELETE", body);
    expect(removed).toMatchObject({ ok: true, removed: true, projectId: removedId });
    for (const connection of [...hosts, guest]) expect((await connection.wait("closed")).reason).toBe("Project removed");
    for (const event of await Promise.all(closes)) { expect(event.code).toBe(1008); expect(event.reason).toBe("Project removed"); }
    expect(await json<typeof removed>(token, `${base}/api/project`, "DELETE", body)).toEqual(removed);
    for (const page of pages) for (const headers of [{}, { "X-Pneuma-Publication-Bytes": "1" }] as Record<string, string>[]) expect((await fetch(page, { headers })).status).toBe(410);
    for (const credential of [null, token, peerWriter.token, peerReader.token]) {
      const response = await request(credential, `${base}/api/state`); expect(response.status).toBe(410); expect((await response.json() as { code: string }).code).toBe("project_removed");
    }
    for (const registration of registrations) expect((await request(registration.publisherToken, `${base}/api/publisher/rooms/${registration.room.id}/state`)).status).toBe(410);
    expect((await request(bootstrapSecret, `${base}/internal/bootstrap`, "POST", config)).status).toBe(410);
    expect((await request(token, `${base}/api/project`, "DELETE", { opId: crypto.randomUUID() })).status).toBe(410);
    await runtime.dispose(); await startRuntime();
    expect((await request(token, `${base}/api/state`)).status).toBe(410);
    expect(await json<typeof removed>(token, `${base}/api/project`, "DELETE", body)).toEqual(removed);
    expect((await request(bootstrapSecret, `${base}/internal/bootstrap`, "POST", config)).status).toBe(410);
    for (const page of pages) { page.host = new URL(origin).host; expect((await fetch(page, { headers: { "X-Pneuma-Publication-Bytes": "1" } })).status).toBe(410); }
    expect((await request(token, `${base}/api/workspaces`, "POST", { id: "resurrect", name: "No", placement: "local" })).status).toBe(410);
    for (const suffix of ["", "/"]) {
      const shell = await request(null, `${base}${suffix}`); expect(shell.status).toBe(200); expect(shell.headers.get("content-type")).toContain("text/html"); expect(await shell.text()).toContain("Public shell");
      const state = await request(null, `${base}/api/state`); expect(state.status).toBe(410); expect((await state.json() as { code: string }).code).toBe("project_removed");
    }
    expect((await request(ownerToken, `/projects/${projectId}/api/state`)).status).toBe(200);
  }, 20000);

});
