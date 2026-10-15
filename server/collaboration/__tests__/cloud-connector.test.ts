import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollaborationProjectState, CollaborationRoom } from "../../../core/types/collaboration.js";
import { startCloudCollaborationConnector } from "../cloud-connector.js";
import { hash, type PublishedFile } from "../content.js";

const OWNER = "fixture-owner-token";
const PUBLISHER = "fixture-publisher-token";
const LEASE = "fixture-publisher-connection";
const ROOM = "website";
const PAGE = "index.html";
type Connector = Awaited<ReturnType<typeof startCloudCollaborationConnector>>;
interface Commit { opId: string; baseRevision: number; fingerprint: string; files: PublishedFile[] }
interface CommitAttempt { body: Commit; publisherId: string | null; revision: number; duplicate: boolean }
type FixtureSocket = { kind: "publisher" | "browser" };

/** A real HTTP/WS peer. It checks the connector protocol, not worker authorization. */
function startCloudFixture() {
  const blobs = new Map<string, Uint8Array>();
  const receipts = new Map<string, { input: string; revision: number; fingerprint: string }>();
  const commits: CommitAttempt[] = [];
  const events: string[] = [];
  const changed = new Set<() => void>();
  const browsers = new Set<ServerWebSocket<FixtureSocket>>();
  let publisher: ServerWebSocket<FixtureSocket> | null = null;
  let ready = false;
  let revision = 0;
  let fingerprint = "";
  let failNextCommit: "503" | "malformed-success" | null = null;
  let resolvePing: () => void = () => {};
  const initialPing = new Promise<void>((resolve) => { resolvePing = resolve; });
  const room = (): CollaborationRoom => ({ id: ROOM, title: "Website", mode: "webcraft", ownerId: "owner", enabled: true, revision, page: PAGE, updatedAt: 1, hostOnline: ready });
  const state = (): CollaborationProjectState => ({ project: { id: "fixture", name: "Fixture" }, self: { id: "owner", name: "Owner", role: "admin", kind: "member" }, rooms: [room()], members: [{ id: "owner", name: "Owner", role: "admin" }], publicOrigin: origin, capabilities: { editSource: false } });
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  const server = Bun.serve<FixtureSocket>({
    hostname: "0.0.0.0", port: 0,
    async fetch(request, runtime) {
      const url = new URL(request.url);
      if (url.pathname === "/publisher/ws" || url.pathname === "/ws") {
        const kind = url.pathname === "/publisher/ws" ? "publisher" : "browser";
        if (url.searchParams.get("token") !== (kind === "publisher" ? PUBLISHER : OWNER)) return json({ error: "Invalid fixture credential" }, 401);
        return runtime.upgrade(request, { data: { kind } }) ? undefined : json({ error: "Expected WebSocket upgrade" }, 400);
      }
      events.push(`${request.method} ${url.pathname}${ready ? "" : " BEFORE_READY"}`);
      const expected = url.pathname.startsWith("/api/publisher/") ? PUBLISHER : OWNER;
      if (request.headers.get("authorization") !== `Bearer ${expected}`) return json({ error: "Invalid fixture credential" }, 401);
      if (url.pathname === "/api/state") return json(state());
      if (url.pathname === "/api/publisher/state") return json({ room: room(), revision, fingerprint, hostOnline: ready });
      if (url.pathname === "/api/publisher/error") return json({ ok: true });
      const upload = /^\/api\/publisher\/blobs\/([a-f0-9]{64})$/.exec(url.pathname);
      if (upload && request.method === "PUT") {
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (hash(bytes) !== upload[1]) return json({ error: "Blob bytes do not match hash" }, 400);
        blobs.set(upload[1]!, bytes);
        return json({ hash: upload[1], size: bytes.length });
      }
      if (url.pathname === "/api/publisher/commit" && request.method === "POST") {
        const body = await request.json() as Commit;
        const publisherId = request.headers.get("x-publisher-id");
        if (!ready || publisherId !== LEASE) return json({ error: "Publisher lease not ready" }, 409);
        const previous = receipts.get(body.opId);
        if (previous) {
          if (previous.input !== JSON.stringify(body)) return json({ error: "Operation changed on retry" }, 409);
          commits.push({ body, publisherId, revision: previous.revision, duplicate: true });
          for (const notify of changed) notify();
          return json({ revision: previous.revision, fingerprint: previous.fingerprint });
        }
        if (body.baseRevision !== revision) return json({ error: "Stale publication" }, 409);
        for (const file of body.files) {
          if (!blobs.has(file.hash) || blobs.get(file.hash)!.length !== file.size) return json({ error: "Commit preceded resource upload" }, 409);
        }
        if (hash(JSON.stringify(body.files)) !== body.fingerprint) return json({ error: "Invalid manifest fingerprint" }, 400);
        revision++;
        fingerprint = body.fingerprint;
        receipts.set(body.opId, { input: JSON.stringify(body), revision, fingerprint });
        commits.push({ body, publisherId, revision, duplicate: false });
        for (const notify of changed) notify();
        const fault = failNextCommit;
        failNextCommit = null;
        if (fault === "503") return json({ error: "Commit applied, response delivery failed" }, 503);
        if (fault === "malformed-success") return new Response('{"revision":', { headers: { "Content-Type": "application/json" } });
        return json({ revision, fingerprint });
      }
      return json({ error: "Unknown fixture route" }, 404);
    },
    websocket: {
      open(socket) {
        if (socket.data.kind === "publisher") { publisher = socket; events.push("publisher-open"); }
        else {
          browsers.add(socket);
          socket.send(JSON.stringify({ type: "welcome", connectionId: "browser-connection", state: state() }));
        }
      },
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message.type === "ping") {
          if (socket.data.kind === "publisher") resolvePing();
          socket.send(JSON.stringify({ type: "pong", sentAt: message.sentAt, serverAt: Date.now() }));
        }
      },
      close(socket) { browsers.delete(socket); if (publisher === socket) publisher = null; },
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    origin, initialPing, events, commits, blobs,
    releasePublisher() { ready = true; events.push("publisher-ready"); publisher!.send(JSON.stringify({ type: "publisher_ready", publisherId: LEASE })); },
    failNext(mode: "503" | "malformed-success") { failNextCommit = mode; },
    revision: () => revision,
    async waitForCommit(predicate: (commit: CommitAttempt) => boolean, from = 0): Promise<CommitAttempt> {
      return new Promise((resolve, reject) => {
        const finish = () => { clearTimeout(timer); changed.delete(check); };
        const check = () => { const match = commits.slice(from).find(predicate); if (match) { finish(); resolve(match); } };
        const timer = setTimeout(() => { finish(); reject(new Error("Native file write did not publish within 4 seconds")); }, 4000);
        changed.add(check); check();
      });
    },
    async close() { publisher?.close(); for (const browser of browsers) browser.close(); await server.stop(true); },
  };
}

let temporary: string;
let root: string;
let connector: Connector;
let cloud: ReturnType<typeof startCloudFixture>;
const local = () => `http://127.0.0.1:${connector.port}`;
const sourcePath = `/api/rooms/${ROOM}/content`;
function request(path: string, init: RequestInit = {}, token = OWNER) {
  return fetch(`${local()}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...Object.fromEntries(new Headers(init.headers)) } });
}
async function source() {
  const response = await request(sourcePath);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ html: string; revision: number }>;
}
function save(body: { opId: string; baseRevision: number; html: string }) {
  return request(sourcePath, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "pneuma-cloud-connector-"));
  root = join(temporary, "workspace");
  const frontendDir = join(temporary, "frontend");
  await mkdir(root); await mkdir(frontendDir);
  await writeFile(join(root, PAGE), "<!doctype html><h1>Initial publication</h1>");
  await writeFile(join(root, "style.css"), "h1 { color: orange; }");
  await writeFile(join(frontendDir, "index.html"), "<!doctype html><title>Host window</title>");
  cloud = startCloudFixture();
  const starting = startCloudCollaborationConnector({ cloudOrigin: cloud.origin, root, page: PAGE, roomId: ROOM, ownerId: "owner", ownerToken: OWNER, publisherToken: PUBLISHER, frontendDir, port: 0 });
  await cloud.initialPing;
  cloud.releasePublisher();
  connector = await starting;
}, 10_000);

afterAll(async () => {
  if (connector) await connector.close();
  if (cloud) await cloud.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

describe("local cloud collaboration connector", () => {
  test("waits for publisher_ready, sends its lease, and uploads every blob before commit", () => {
    expect(cloud.events.some((event) => event.includes("BEFORE_READY"))).toBe(false);
    expect(cloud.events.indexOf("publisher-ready")).toBeLessThan(cloud.events.indexOf("POST /api/publisher/commit"));
    const first = cloud.commits[0]!;
    expect(first.publisherId).toBe(LEASE);
    expect(first.revision).toBe(1);
    expect(first.body.files.map((file) => file.path)).toEqual([PAGE, "style.css"]);
    for (const file of first.body.files) {
      expect(cloud.events.indexOf(`PUT /api/publisher/blobs/${file.hash}`)).toBeLessThan(cloud.events.indexOf("POST /api/publisher/commit"));
      expect(cloud.blobs.get(file.hash)?.length).toBe(file.size);
    }
  });

  test("adds local source capability over HTTP and WebSocket without changing cloud state", async () => {
    const remote = await fetch(`${cloud.origin}/api/state`, { headers: { Authorization: `Bearer ${OWNER}` } });
    expect((await remote.json()).capabilities.editSource).toBe(false);
    const localState = await (await request("/api/state")).json();
    expect(localState.capabilities.editSource).toBe(true);
    expect(localState.publicOrigin).toBe(cloud.origin);
    const socket = new WebSocket(`${local().replace("http:", "ws:")}/ws?token=${OWNER}`);
    try {
      const welcome = await new Promise<{ state: CollaborationProjectState }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("No bridged welcome")), 1500);
        socket.addEventListener("message", (event) => { clearTimeout(timer); resolve(JSON.parse(String(event.data))); }, { once: true });
        socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Bridge socket failed")); }, { once: true });
      });
      expect(welcome.state.capabilities?.editSource).toBe(true);
    } finally { socket.close(); }
  });

  test("refuses incorrect credentials and cross-origin calls before forwarding", async () => {
    const before = cloud.events.length;
    expect((await request("/api/state", {}, "wrong-token")).status).toBe(401);
    expect((await request("/ws?token=wrong-token")).status).toBe(401);
    expect((await request("/api/state", { headers: { Origin: "https://untrusted.test" } })).status).toBe(403);
    expect((await request("/ws?token=" + OWNER, { headers: { Origin: "https://untrusted.test" } })).status).toBe(403);
    expect(cloud.events.length).toBe(before);
  });

  test("native file writes publish and make old source revisions fail without overwriting", async () => {
    const before = await source();
    const html = "<!doctype html><h1>Changed by a native file tool</h1>";
    const from = cloud.commits.length;
    await writeFile(join(root, PAGE), html);
    const publication = await cloud.waitForCommit((commit) => commit.body.files.some((file) => file.path === PAGE && file.hash === hash(html)), from);
    expect(publication.revision).toBeGreaterThan(before.revision);
    const stale = await save({ opId: "stale-save", baseRevision: before.revision, html: "<!doctype html><h1>Stale browser draft</h1>" });
    expect(stale.status).toBe(409);
    expect(await readFile(join(root, PAGE), "utf8")).toBe(html);
  });

  test("same source operation returns its original receipt without overwriting later changes", async () => {
    const current = await source();
    const body = { opId: "idempotent-save", baseRevision: current.revision, html: "<!doctype html><h1>Saved once</h1>" };
    const first = await save(body);
    expect(first.status).toBe(200);
    const receipt = await first.json();
    const subsequent = "<!doctype html><h1>Later native change</h1>";
    await writeFile(join(root, PAGE), subsequent);
    await connector.sync();
    const revision = cloud.revision();
    const retry = await save(body);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(receipt);
    expect(cloud.revision()).toBe(revision);
    expect(await readFile(join(root, PAGE), "utf8")).toBe(subsequent);
    expect((await save({ ...body, html: "different input" })).status).toBe(409);
  });

  test("an applied commit with a failed response recovers using its original publication opId", async () => {
    const current = await source();
    const from = cloud.commits.length;
    const body = { opId: "uncertain-save", baseRevision: current.revision, html: "<!doctype html><h1>Uncertain cloud response</h1>" };
    cloud.failNext("503");
    const first = await save(body);
    expect(first.status).toBe(502);
    expect(await readFile(join(root, PAGE), "utf8")).toBe(body.html);
    const applied = cloud.commits.slice(from).find((commit) => !commit.duplicate)!;
    const retry = await save(body);
    expect(retry.status).toBe(200);
    expect((await retry.json()).revision).toBe(applied.revision);
    const attempts = cloud.commits.slice(from);
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(attempts.map((commit) => commit.body.opId)).size).toBe(1);
    expect(attempts.filter((commit) => !commit.duplicate)).toHaveLength(1);
  });

  test("a truncated successful commit response stays uncertain until the same operation is acknowledged", async () => {
    const current = await source();
    const from = cloud.commits.length;
    const body = { opId: "truncated-save", baseRevision: current.revision, html: "<!doctype html><h1>Truncated response</h1>" };
    cloud.failNext("malformed-success");
    const first = await save(body);
    expect(first.status).toBe(502);
    const applied = cloud.commits.slice(from).find((commit) => !commit.duplicate)!;
    const retry = await save(body);
    expect(retry.status).toBe(200);
    expect((await retry.json()).revision).toBe(applied.revision);
    const attempts = cloud.commits.slice(from);
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(attempts.map((commit) => commit.body.opId)).size).toBe(1);
  });
});
