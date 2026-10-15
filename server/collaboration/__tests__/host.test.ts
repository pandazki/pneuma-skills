import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CollaborationComment,
  CollaborationGuestLink,
  CollaborationInvite,
  CollaborationProjectState,
  CollaborationRoomState,
  CollaborationServerMessage,
  CollaborationView,
} from "../../../core/types/collaboration.js";
import { ViewerCollaborationRuntime } from "../../../src/collaboration/viewer-runtime.js";
import { startCollaborationHost, type CollaborationHostOptions } from "../host.js";

const admin = "test-admin-credential";
const writer = "test-writer-credential";
const otherWriter = "test-other-writer-credential";
const reader = "test-reader-credential";
const secret = "PRIVATE_AGENT_PROMPT_MUST_NOT_LEAVE_THE_HOST";
const roomId = "website";
const otherRoomId = "research";
const page = "index.html";

type Host = Awaited<ReturnType<typeof startCollaborationHost>>;
type MessageOf<T extends CollaborationServerMessage["type"]> = Extract<CollaborationServerMessage, { type: T }>;

let fixture: string;
let roomRoot: string;
let host: Host;
let options: CollaborationHostOptions;
const connections: TestConnection[] = [];
const databases: Database[] = [];
let hostingViews: TestConnection[] = [];
const hostingHeartbeats: ReturnType<typeof setInterval>[] = [];

function request(token: string, path: string, method = "GET", body?: unknown): Promise<Response> {
  return fetch(new URL(path, host.url), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await request(token, path, method, body);
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function roomState(token = writer, id = roomId): Promise<CollaborationRoomState> {
  return json(token, `/api/rooms/${id}`);
}

async function invite(name: string, role: "reader" | "writer" | "admin" = "writer"): Promise<CollaborationInvite> {
  return json(admin, "/api/members", "POST", { name, role });
}

function guestLink(id = roomId): Promise<CollaborationGuestLink> {
  return json(admin, `/api/rooms/${id}/links`, "POST", { expiresInSeconds: 3600 });
}

function frameUrl(state: CollaborationRoomState, relative?: string): URL {
  const url = new URL(state.pageUrl, host.url);
  return relative ? new URL(relative, url) : url;
}

function view(revision: number): CollaborationView {
  return { page, revision, scrollX: 0, scrollY: 80, width: 1024, height: 700, documentWidth: 1024, documentHeight: 2200 };
}

function commentBody(revision: number, body = "Please refine this heading", opId = crypto.randomUUID()) {
  return { opId, body, anchor: { address: { file: page }, revision, x: 72, y: 125, quote: "Heading" } };
}

class TestConnection {
  readonly socket: WebSocket;
  readonly inbox: CollaborationServerMessage[] = [];
  private changed = new Set<() => void>();

  constructor(token: string) {
    const url = new URL("/ws", host.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      this.inbox.push(JSON.parse(String(event.data)) as CollaborationServerMessage);
      for (const notify of this.changed) notify();
    });
    this.socket.addEventListener("close", () => {
      for (const notify of this.changed) notify();
    });
    connections.push(this);
  }

  send(message: unknown): void { this.socket.send(JSON.stringify(message)); }

  async wait<T extends CollaborationServerMessage["type"]>(
    type: T,
    predicate: (message: MessageOf<T>) => boolean = () => true,
    timeout = 3000,
  ): Promise<MessageOf<T>> {
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.changed.delete(check);
      };
      const check = () => {
        const index = this.inbox.findIndex((message) => message.type === type && predicate(message as MessageOf<T>));
        if (index >= 0) {
          const [message] = this.inbox.splice(index, 1);
          finish();
          resolve(message as MessageOf<T>);
        }
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error(`Timed out waiting for ${type}; received ${this.inbox.map((message) => message.type).join(", ")}`));
      }, timeout);
      this.changed.add(check);
      check();
    });
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500);
      this.socket.addEventListener("close", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.close();
    });
  }
}

async function connect(token: string, id = roomId): Promise<TestConnection> {
  const connection = new TestConnection(token);
  await connection.wait("welcome");
  connection.send({ type: "join", roomId: id });
  await connection.wait("room");
  return connection;
}

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), "pneuma-collaboration-host-"));
  roomRoot = join(fixture, "website");
  const otherRoot = join(fixture, "research");
  const frontendDir = join(fixture, "frontend");
  await Promise.all([
    mkdir(join(roomRoot, "assets"), { recursive: true }),
    mkdir(join(roomRoot, ".pneuma"), { recursive: true }),
    mkdir(otherRoot), mkdir(frontendDir),
  ]);
  await Promise.all([
    writeFile(join(roomRoot, page), '<!doctype html><html><head><link rel="stylesheet" href="assets/style.css"></head><body><h1>Heading</h1></body></html>'),
    writeFile(join(roomRoot, "assets/style.css"), "h1 { color: orange; }"),
    writeFile(join(roomRoot, ".pneuma/history.json"), secret),
    writeFile(join(roomRoot, ".env"), secret),
    writeFile(join(fixture, "private-agent.json"), secret),
    writeFile(join(otherRoot, page), "<!doctype html><h1>Other workspace</h1>"),
    writeFile(join(frontendDir, "index.html"), "<!doctype html><h1>Collaboration shell</h1>"),
  ]);
  await symlink(join(fixture, "private-agent.json"), join(roomRoot, "outside.json"));
  options = {
    project: { id: "project-acceptance", name: "Shared project" },
    stateDir: join(fixture, "state"),
    rooms: [
      { id: roomId, title: "Website", mode: "webcraft", ownerId: "writer", root: roomRoot, page },
      { id: otherRoomId, title: "Research", mode: "webcraft", ownerId: "other-writer", root: otherRoot, page },
    ],
    members: [
      { id: "admin", name: "Owner", role: "admin", token: admin },
      { id: "writer", name: "Writer", role: "writer", token: writer },
      { id: "other-writer", name: "Researcher", role: "writer", token: otherWriter },
      { id: "reader", name: "Observer", role: "reader", token: reader },
    ],
    frontendDir,
    frameScript: "window.__collaborationFrameLoaded = true;",
    port: 0,
    hostname: "0.0.0.0",
  };
  host = await startCollaborationHost(options);
}, 10000);

beforeEach(async () => {
  hostingViews = [await connect(writer)];
  if (host.getState(otherWriter)?.rooms.some((room) => room.id === otherRoomId)) hostingViews.push(await connect(otherWriter, otherRoomId));
  for (const view of hostingViews) hostingHeartbeats.push(setInterval(() => {
    if (view.socket.readyState === WebSocket.OPEN) view.send({ type: "ping", sentAt: Date.now() });
  }, 5000));
});

afterEach(async () => {
  for (const timer of hostingHeartbeats.splice(0)) clearInterval(timer);
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  for (const database of databases.splice(0)) database.close();
});

afterAll(async () => {
  if (host) await host.close();
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

describe("project collaboration host boundary", () => {
  test("exposes project outputs without private sessions, credentials, or host paths", async () => {
    const state = await json<CollaborationProjectState>(reader, "/api/state");
    expect(state.rooms.map((room) => room.id).sort()).toEqual([otherRoomId, roomId].sort());
    const publicState = JSON.stringify(state);
    for (const sensitive of [admin, writer, otherWriter, reader, fixture, secret]) {
      expect(publicState).not.toContain(sensitive);
    }
    expect((await request("invalid-token", "/api/state")).status).toBe(401);
    for (const path of ["/api/session", "/api/sessions", "/api/files", "/api/agent", "/api/permissions", "/api/terminal", "/.pneuma/history.json"]) {
      const response = await request(admin, path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(secret);
    }
  });

  test("readers and guests cannot forge any durable write class", async () => {
    const state = await roomState();
    const comment = await json<CollaborationComment>(writer, `/api/rooms/${roomId}/comments`, "POST", commentBody(state.room.revision));
    const guest = await guestLink();
    const writes: Array<[string, string, unknown?]> = [
      ["PUT", `/api/rooms/${roomId}/content`, { opId: crypto.randomUUID(), baseRevision: state.room.revision, html: "changed" }],
      ["POST", `/api/rooms/${roomId}/comments`, commentBody(state.room.revision)],
      ["PATCH", `/api/rooms/${roomId}/comments/${comment.id}`, { opId: crypto.randomUUID(), status: "resolved" }],
      ["PATCH", `/api/rooms/${roomId}/comments/${comment.id}`, { opId: crypto.randomUUID(), body: "forged reply" }],
      ["POST", `/api/rooms/${roomId}/chat`, { opId: crypto.randomUUID(), body: "forged chat" }],
      ["PATCH", `/api/rooms/${roomId}`, { enabled: false }],
      ["DELETE", `/api/rooms/${roomId}`],
      ["POST", `/api/rooms/${roomId}/links`, { expiresInSeconds: 600 }],
      ["DELETE", `/api/rooms/${roomId}/links`],
      ["POST", "/api/members", { name: "Intruder", role: "admin" }],
      ["PATCH", "/api/members/reader", { role: "admin" }],
      ["DELETE", "/api/members/other-writer"],
    ];
    for (const token of [reader, guest.token]) {
      for (const [method, path, body] of writes) expect((await request(token, path, method, body)).status).toBe(403);
      expect((await request(token, `/api/rooms/${roomId}/content`)).status).toBe(403);
    }
    expect((await roomState()).room.enabled).toBe(true);
    expect((await roomState()).comments.find((entry) => entry.id === comment.id)?.status).toBe("open");
  });

  test("guest scope excludes the project roster, other rooms, chat, and private files", async () => {
    await json(writer, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "Members only discussion" });
    const guest = await guestLink();
    const state = await json<CollaborationProjectState>(guest.token, "/api/state");
    expect(state.self.kind).toBe("guest");
    expect(state.members).toEqual([]);
    expect(state.rooms.map((room) => room.id)).toEqual([roomId]);
    expect([403, 404]).toContain((await request(guest.token, `/api/rooms/${otherRoomId}`)).status);
    const room = await roomState(guest.token);
    expect(room.messages).toEqual([]);
    expect((await fetch(frameUrl(room))).status).toBe(200);
    expect(await (await fetch(frameUrl(room, "assets/style.css"))).text()).toContain("color: orange");
    expect(room.pageUrl).not.toContain(guest.token);
    for (const relative of [".env", ".pneuma/history.json", "outside.json", "../private-agent.json", "%2e%2e%2fprivate-agent.json"]) {
      const response = await fetch(frameUrl(room, relative));
      expect(response.ok).toBe(false);
      expect(await response.text()).not.toContain(secret);
    }
    const crossed = frameUrl(room);
    crossed.pathname = crossed.pathname.replace(`/${roomId}/`, `/${otherRoomId}/`);
    expect((await fetch(crossed)).ok).toBe(false);
    const socket = await connect(guest.token);
    const memberChat = await json<{ id: string }>(writer, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "Still members only" });
    const fence = Date.now();
    socket.send({ type: "ping", sentAt: fence });
    await socket.wait("pong", (message) => message.sentAt === fence);
    expect(socket.inbox.some((message) => message.type === "chat" && message.message.id === memberChat.id)).toBe(false);
    socket.send({ type: "join", roomId: otherRoomId });
    await socket.wait("error");
  });

  test("asset grants never authorize private API or WebSocket state", async () => {
    const state = await roomState();
    const url = frameUrl(state);
    const body = await (await fetch(url)).text();
    expect(body).toContain("__collaborationFrameLoaded");
    for (const token of [admin, writer, otherWriter, reader]) expect(body).not.toContain(token);
    expect((await fetch(url)).headers.get("referrer-policy")).toBe("no-referrer");
    const parts = url.pathname.split("/").filter(Boolean);
    const grant = parts[parts.indexOf("revisions") + 2]!;
    expect((await request(grant, "/api/state")).status).toBe(401);
    expect((await request(grant, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "from frame" })).status).toBe(401);
    const wsUrl = new URL("/ws", host.url);
    wsUrl.searchParams.set("token", grant);
    const response = await fetch(wsUrl, { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(401);
  });

  test("ordinary owner scroll and pointer bursts keep a view-only guest connected", async () => {
    const guest = await guestLink();
    const observer = await connect(guest.token);
    const owner = hostingViews[0]!;
    const initial = await roomState();
    const participantIds = initial.participants.map((participant) => participant.id).sort();
    const runtime = new ViewerCollaborationRuntime("scrolling-owner", { viewing: true, pointers: true, follow: true,
      publication: { module: "publication.ts", schema: "scroll-probe" } }, { address: { page } }, (report) => {
      if (owner.socket.readyState === WebSocket.OPEN) owner.send({ type: "presence", view: null, cursor: null, ...report, sentAt: Date.now() });
    });
    try {
      runtime.binding.register({ applyView: async () => ({ success: true }), projectPointer: () => ({ status: "unresolved" }) });
      runtime.update(initial.room.revision, true, [], []);
      // The page reports wheel intent, the resulting scroll and pointer position.
      // Each local view also interrupts following before reporting its new state.
      for (let index = 0; index < 65; index++) {
        const view = { address: { page }, detail: { scroll: { x: 0, y: index } } };
        runtime.binding.reportView(view, "local-input");
        runtime.binding.reportView(view, "local-input");
        runtime.binding.reportPointer({ x: 20, y: index });
        await Bun.sleep(16);
      }
      expect(owner.socket.readyState).toBe(WebSocket.OPEN);
      expect(observer.socket.readyState).toBe(WebSocket.OPEN);
      const latest = await observer.wait("presence", (message) => message.participant.semanticPointer?.y === 64);
      expect(latest.participant.semanticView?.detail).toEqual({ scroll: { x: 0, y: 64 } });
      const sentAt = Date.now(); observer.send({ type: "ping", sentAt });
      await observer.wait("pong", (message) => message.sentAt === sentAt);
      expect(observer.inbox.some((message) => message.type === "closed")).toBe(false);
      const after = await roomState(guest.token);
      expect(after.room.revision).toBe(initial.room.revision);
      expect(after.participants.map((participant) => participant.id).sort()).toEqual(participantIds);
      const applied: unknown[] = [];
      const guestRuntime = new ViewerCollaborationRuntime("following-guest", { viewing: true, follow: true,
        publication: { module: "publication.ts", schema: "scroll-probe" } }, { address: { page } }, () => {});
      try {
        guestRuntime.binding.register({ applyView: async (view) => { applied.push(view); return { success: true }; } });
        guestRuntime.update(initial.room.revision, true, [{ id: latest.participant.id, revision: latest.participant.revision!, view: latest.participant.semanticView!, pointer: latest.participant.semanticPointer ?? null, followingId: null }], []);
        guestRuntime.setFollowing(latest.participant.id);
        expect(applied).toEqual([latest.participant.semanticView]);
      } finally { guestRuntime.dispose(); }
    } finally { runtime.dispose(); }
  });

  test("presence is connection-scoped and readers can follow without durable writes", async () => {
    const first = await connect(reader);
    const second = await connect(reader);
    const observer = await connect(writer);
    const snapshot = await roomState(reader);
    const tabs = snapshot.participants.filter((participant) => participant.memberId === "reader");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.id).not.toBe(tabs[1]!.id);
    const database = new Database(join(options.stateDir, "collaboration.sqlite"), { readonly: true });
    databases.push(database);
    const version = () => database.query<{ data_version: number }, []>("PRAGMA data_version").get()!.data_version;
    const originalVersion = version();
    const sentAt = Date.now();
    first.send({ type: "presence", memberId: "admin", role: "admin", view: view(snapshot.room.revision), cursor: { x: 92, y: 180 }, followingId: tabs[1]!.id, sentAt });
    const update = await observer.wait("presence", (message) => message.sentAt === sentAt);
    expect(update.participant.memberId).toBe("reader");
    expect(update.participant.role).toBe("reader");
    expect(update.participant.cursor).toEqual({ x: 92, y: 180 });
    expect(update.participant.followingId).toBe(tabs[1]!.id);
    first.send({ type: "ping", sentAt });
    expect((await first.wait("pong")).sentAt).toBe(sentAt);
    await second.close();
    await observer.wait("departed", (message) => tabs.some((tab) => tab.id === message.connectionId));
    const after = await roomState(reader);
    expect(after.comments).toEqual(snapshot.comments);
    expect(after.messages).toEqual(snapshot.messages);
    expect(after.room.revision).toBe(snapshot.room.revision);
    expect(version()).toBe(originalVersion);
  });

  test("downgrading a connected writer takes effect without reconnecting", async () => {
    const member = await invite("Temporary writer");
    const socket = await connect(member.token);
    const observer = await connect(admin);
    await json(admin, `/api/members/${member.member.id}`, "PATCH", { role: "reader" });
    await socket.wait("project", (message) => message.state.self.role === "reader");
    expect((await request(member.token, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "stale role" })).status).toBe(403);
    const state = await roomState(member.token);
    const sentAt = Date.now();
    socket.send({ type: "presence", view: view(state.room.revision), cursor: null, followingId: null, sentAt });
    expect((await observer.wait("presence", (message) => message.sentAt === sentAt)).participant.role).toBe("reader");
  });

  test("member removal and link revocation invalidate existing sockets and asset grants", async () => {
    const member = await invite("Removable member");
    const memberSocket = await connect(member.token);
    const memberPage = frameUrl(await roomState(member.token));
    await json(admin, `/api/members/${member.member.id}`, "DELETE");
    await memberSocket.wait("closed");
    expect((await request(member.token, "/api/state")).status).toBe(401);
    expect((await fetch(memberPage)).ok).toBe(false);
    const guest = await guestLink();
    const guestSocket = await connect(guest.token);
    const guestPage = frameUrl(await roomState(guest.token));
    await json(admin, `/api/rooms/${roomId}/links`, "DELETE");
    await guestSocket.wait("closed");
    expect((await request(guest.token, "/api/state")).status).toBe(401);
    expect((await fetch(guestPage)).ok).toBe(false);
  });

  test("closing a room immediately blocks its guests and assets, and only owner/admin can reopen", async () => {
    const administrator = await connect(admin);
    const oldAdministratorPage = frameUrl(await roomState(admin));
    const guest = await guestLink();
    const socket = await connect(guest.token);
    const url = frameUrl(await roomState(guest.token));
    expect((await request(otherWriter, `/api/rooms/${roomId}`, "PATCH", { enabled: false })).status).toBe(403);
    await json(writer, `/api/rooms/${roomId}`, "PATCH", { enabled: false });
    await socket.wait("closed");
    await administrator.wait("closed", (message) => message.code === "host_offline");
    expect((await request(guest.token, `/api/rooms/${roomId}`)).ok).toBe(false);
    expect((await fetch(url)).ok).toBe(false);
    expect((await fetch(oldAdministratorPage)).ok).toBe(false);
    await json(writer, `/api/rooms/${roomId}`, "PATCH", { enabled: true });
    hostingViews[0]!.send({ type: "join", roomId });
    await hostingViews[0]!.wait("room");
    const rejoined = new TestConnection(admin);
    await rejoined.wait("welcome");
    rejoined.send({ type: "join", roomId });
    const resumed = await rejoined.wait("room");
    expect((await fetch(frameUrl(resumed.state))).status).toBe(200);
    expect((await roomState()).room.enabled).toBe(true);
  });

  test("protects the last administrator and rejects writer roster management", async () => {
    expect((await request(writer, "/api/members", "POST", { name: "Escalated", role: "admin" })).status).toBe(403);
    expect((await request(admin, "/api/members/admin", "PATCH", { role: "reader" })).status).toBe(409);
    expect((await request(admin, "/api/members/admin", "DELETE")).status).toBe(409);
    expect((await json<CollaborationProjectState>(admin, "/api/state")).self.role).toBe("admin");
  });

  test("retains bounded comment previews in replies and room snapshots and rejects malformed metadata", async () => {
    const observer = await connect(reader);
    const state = await roomState();
    const preview = { label: 'h1 "Heading"', file: "index.html", type: "heading", content: "Selected heading", thumbnail: "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>Heading</text></svg>') };
    const body = { ...commentBody(state.room.revision), anchor: { ...commentBody(state.room.revision).anchor, preview } };
    const created = await json<CollaborationComment>(writer, `/api/rooms/${roomId}/comments`, "POST", body);
    expect(created.anchor.preview).toEqual(preview);
    const update = await observer.wait("comments", (message) => message.comments.some((entry) => entry.id === created.id));
    expect(update.comments.find((entry) => entry.id === created.id)?.anchor.preview).toEqual(preview);
    expect((await roomState()).comments.find((entry) => entry.id === created.id)?.anchor.preview).toEqual(preview);
    for (const invalid of [null, { label: 42 }, { label: "x".repeat(201) }, { thumbnail: "https://example.test/image.png" }, { thumbnail: "data:image/png;base64," + "a".repeat(48 * 1024) }]) {
      expect((await request(writer, `/api/rooms/${roomId}/comments`, "POST", { ...body, opId: crypto.randomUUID(), anchor: { ...body.anchor, preview: invalid } })).status).toBe(400);
    }
  });

  test("validates finite presence coordinates, comment anchors, and bounded messages", async () => {
    const state = await roomState();
    const socket = await connect(writer);
    socket.send({ type: "presence", view: { ...view(state.room.revision), scrollY: "not-a-number" }, cursor: null, followingId: null, sentAt: Date.now() });
    await socket.wait("error");
    const body = commentBody(state.room.revision);
    expect((await request(writer, `/api/rooms/${roomId}/comments`, "POST", { ...body, anchor: { ...body.anchor, x: null } })).status).toBe(400);
    expect((await request(writer, `/api/rooms/${roomId}/comments`, "POST", { ...body, anchor: { ...body.anchor, x: 1e300 } })).status).toBe(400);
    expect((await request(writer, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "x".repeat(100_000) })).status).toBe(400);
  });

  test("native edits advance revision and direct saves reject stale snapshots, including the watcher gap", async () => {
    const socket = await connect(reader);
    const initial = await roomState();
    const html = `<!doctype html><h1>Native update ${crypto.randomUUID()}</h1>`;
    await writeFile(join(roomRoot, page), html);
    const update = await socket.wait("content", (message) => message.room.revision > initial.room.revision, 5000);
    expect(await (await fetch(new URL(update.pageUrl, host.url))).text()).toContain("Native update");
    expect((await request(writer, `/api/rooms/${roomId}/content`, "PUT", { opId: crypto.randomUUID(), baseRevision: initial.room.revision, html: "stale" })).status).toBe(409);
    const latest = await roomState();
    const direct = await json<{ revision: number }>(writer, `/api/rooms/${roomId}/content`, "PUT", { opId: crypto.randomUUID(), baseRevision: latest.room.revision, html: "<!doctype html><h1>Direct save</h1>" });
    expect(direct.revision).toBeGreaterThan(latest.room.revision);
    await socket.wait("content", (message) => message.room.revision === direct.revision);
    const nativeBeforeWatcher = "<!doctype html><h1>Concurrent native edit must survive</h1>";
    await writeFile(join(roomRoot, page), nativeBeforeWatcher);
    expect((await request(writer, `/api/rooms/${roomId}/content`, "PUT", { opId: crypto.randomUUID(), baseRevision: direct.revision, html: "lost native edit" })).status).toBe(409);
    expect(await readFile(join(roomRoot, page), "utf8")).toBe(nativeBeforeWatcher);
  }, 10000);

  test("published revisions retain their original asset bytes and source-save retries do not overwrite newer work", async () => {
    const initial = await roomState();
    const oldAsset = frameUrl(initial, "assets/style.css");
    expect(await (await fetch(oldAsset)).text()).toContain("color: orange");
    const observer = await connect(reader);
    await writeFile(join(roomRoot, "assets/style.css"), "h1 { color: blue; }");
    const updated = await observer.wait("content", (message) => message.room.revision > initial.room.revision, 5000);
    expect(await (await fetch(oldAsset)).text()).toContain("color: orange");
    const newAsset = new URL("assets/style.css", new URL(updated.pageUrl, host.url));
    expect(await (await fetch(newAsset)).text()).toContain("color: blue");
    const original = { opId: crypto.randomUUID(), baseRevision: updated.room.revision, html: "<!doctype html><h1>First accepted save</h1>" };
    const accepted = await json<{ revision: number }>(writer, `/api/rooms/${roomId}/content`, "PUT", original);
    const newest = "<!doctype html><h1>Newer accepted save</h1>";
    await json(writer, `/api/rooms/${roomId}/content`, "PUT", { opId: crypto.randomUUID(), baseRevision: accepted.revision, html: newest });
    const retried = await json<{ revision: number }>(writer, `/api/rooms/${roomId}/content`, "PUT", original);
    expect(retried).toEqual(accepted);
    expect(await readFile(join(roomRoot, page), "utf8")).toBe(newest);
  }, 10000);

  test("a missing entry page reports a publication failure and retains the last usable revision", async () => {
    const original = await readFile(join(roomRoot, page), "utf8");
    const initial = await roomState();
    const published = await (await fetch(frameUrl(initial))).text();
    const observer = await connect(reader);
    try {
      await unlink(join(roomRoot, page));
      await observer.wait("error", (message) => message.message.includes("Publication"));
      expect((await roomState()).room.revision).toBe(initial.room.revision);
      expect(await (await fetch(frameUrl(initial))).text()).toBe(published);
    } finally {
      await writeFile(join(roomRoot, page), original);
    }
    const restored = await observer.wait("content", (message) => message.room.revision === initial.room.revision, 5000);
    expect(await (await fetch(new URL(restored.pageUrl, host.url))).text()).toBe(published);
  }, 10000);

  test("deduplicates per principal and operation payload, preserving comments, chat, ACL, and retries across restart", async () => {
    const state = await roomState();
    const opId = crypto.randomUUID();
    const originalBody = commentBody(state.room.revision, "Persistent comment", opId);
    const body = { ...originalBody, anchor: { ...originalBody.anchor, preview: { label: "Persistent heading", thumbnail: "data:image/png;base64,aGVsbG8=" } } };
    const created = await json<CollaborationComment>(writer, `/api/rooms/${roomId}/comments`, "POST", body);
    const duplicate = await json<CollaborationComment>(writer, `/api/rooms/${roomId}/comments`, "POST", body);
    expect(duplicate.id).toBe(created.id);
    expect((await request(writer, `/api/rooms/${roomId}/comments`, "POST", { ...body, body: "Different payload" })).status).toBe(409);
    const differentPrincipal = await json<CollaborationComment>(otherWriter, `/api/rooms/${roomId}/comments`, "POST", body);
    expect(differentPrincipal.id).not.toBe(created.id);
    await json(writer, `/api/rooms/${roomId}/comments/${created.id}`, "PATCH", { opId: crypto.randomUUID(), status: "resolved" });
    const chatBody = { opId: crypto.randomUUID(), body: "Persistent team discussion" };
    const chat = await json<{ id: string }>(writer, `/api/rooms/${roomId}/chat`, "POST", chatBody);
    const demoted = await invite("Persistent reader");
    await json(admin, `/api/members/${demoted.member.id}`, "PATCH", { role: "reader" });
    expect((await request(admin, "/api/members/other-writer", "PATCH", { role: "reader" })).status).toBe(409);
    await json(admin, `/api/rooms/${otherRoomId}`, "DELETE");
    await json(admin, "/api/members/other-writer", "PATCH", { role: "reader" });
    expect((await request(admin, `/api/rooms/${otherRoomId}`)).status).toBe(404);
    expect(await readFile(join(fixture, "research", page), "utf8")).toContain("Other workspace");
    const oldRevision = (await roomState()).room.revision;
    await host.close();
    host = await startCollaborationHost(options);
    const restored = await roomState();
    expect(restored.room.revision).toBeGreaterThanOrEqual(oldRevision);
    expect(restored.comments.find((entry) => entry.id === created.id)?.status).toBe("resolved");
    expect(restored.comments.find((entry) => entry.id === created.id)?.anchor.preview).toEqual(body.anchor.preview);
    expect(restored.messages.find((entry) => entry.id === chat.id)?.body).toBe(chatBody.body);
    expect(restored.participants).toEqual([]);
    expect((await json<CollaborationProjectState>(admin, "/api/state")).rooms.some((room) => room.id === otherRoomId)).toBe(false);
    expect((await json<CollaborationComment>(writer, `/api/rooms/${roomId}/comments`, "POST", body)).id).toBe(created.id);
    expect((await json<{ id: string }>(writer, `/api/rooms/${roomId}/chat`, "POST", chatBody)).id).toBe(chat.id);
    for (const token of [demoted.token, otherWriter]) {
      expect((await json<CollaborationProjectState>(token, "/api/state")).self.role).toBe("reader");
      expect((await request(token, `/api/rooms/${roomId}/chat`, "POST", { opId: crypto.randomUUID(), body: "Role resurrected" })).status).toBe(403);
    }
  }, 10000);

  test("startup rejects an absent entry page without reporting a usable room", async () => {
    const emptyRoot = join(fixture, "empty-publication");
    await mkdir(emptyRoot);
    await expect(startCollaborationHost({
      ...options,
      stateDir: join(fixture, "empty-state"),
      rooms: [{ ...options.rooms[0]!, root: emptyRoot }],
    })).rejects.toThrow("Room page is missing");
  });
});
