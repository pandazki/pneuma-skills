import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SessionCollaborationProvider, useSessionCollaboration } from "../SessionCollaboration.js";
import { useStore } from "../../store.js";
import { referenceOperationKey, readReferenceOperation, saveReferenceOperation } from "../reference-operations.js";
import type { SessionCollaborationStatus } from "../../../core/types/collaboration-session.js";

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
let win: Window;
let root: Root;
let restore: () => void;
let context: NonNullable<ReturnType<typeof useSessionCollaboration>>;
let service: ReturnType<typeof fixture>;
let poll: () => void;
function fixture() {
  const post = deferred();
  const welcome = deferred();
  const stale = deferred();
  const sockets = new Set<Bun.ServerWebSocket<{ entry: string }>>();
  const calls: string[] = [];
  const state = { project: { id: "project", name: "Project" }, self: { id: "owner", name: "Owner", kind: "member", role: "admin" }, rooms: [{ id: "source", enabled: true, hostOnline: true }], members: [], workspaces: [] };
  const reference = { id: "pin", label: "Saved location", destinationWorkspaceId: "workspace", source: { projectId: "project", workspaceId: "source-workspace", roomId: "source", publicationRevision: 1, address: { page: "index.html" } } };
  const authority = (entry: string) => Bun.serve<{ entry: string }>({ hostname: "127.0.0.1", port: 0, fetch(request, server) {
    const path = new URL(request.url).pathname; calls.push(`${entry}${path}`);
    if (path === "/api/state") return Response.json(state);
    if (path === "/api/references") return Response.json({ references: [reference] });
    if (path === "/ws" && server.upgrade(request, { data: { entry } })) return;
    return new Response(null, { status: 404 });
  }, websocket: {
    async open(socket) { sockets.add(socket); if (entry === "new") await welcome.promise; if (sockets.has(socket)) socket.send(JSON.stringify({ type: "welcome", state, connectionId: entry })); },
    message(socket, raw) { const message = JSON.parse(String(raw)); if (message.type === "ping") socket.send(JSON.stringify({ type: "pong", sentAt: message.sentAt, serverAt: Date.now() })); },
    close(socket) { sockets.delete(socket); },
  } });
  const old = authority("old"); const next = authority("new");
  const origin = (server: { port?: number }) => `http://127.0.0.1:${server.port}`;
  const status = (authorityBaseUrl: string): SessionCollaborationStatus => ({ projectAvailable: true, supported: true, sharing: false, publisherStatus: "Not sharing", connection: { projectId: "project", workspaceId: "workspace", ownerId: "owner", authorityBaseUrl, token: "member", authorityKind: "lan" } });
  let stored = status(origin(old));
  let rejectPost = false;
  let nextOperationAuthority = "lan-key:stable-authority";
  stored.connection!.referenceOperationAuthority = nextOperationAuthority;
  let staleNext = false; let staleError = false; let staleStarted = false; let statusCalls = 0;
  const privateServer = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.method === "POST") { if (rejectPost) { await post.promise; return Response.json({ error: "Reconnect rejected" }, { status: 409 }); } stored = status(origin(next)); stored.connection!.referenceOperationAuthority = nextOperationAuthority; await post.promise; return Response.json(stored); }
    ++statusCalls;
    const captured = stored;
    if (staleNext) { staleNext = false; staleStarted = true; await stale.promise; return staleError ? Response.json({ error: "Old entry timed out" }, { status: 503 }) : Response.json(captured); }
    return Response.json(captured);
  } });
  return { calls, privateOrigin: origin(privateServer), oldOrigin: origin(old), newOrigin: origin(next), post, welcome, stale,
    staleStarted: () => staleStarted, stored: () => stored, statusCalls: () => statusCalls,
    setOperationAuthorities(first: string, next: string) { stored.connection!.referenceOperationAuthority = first; nextOperationAuthority = next; },
    rejectConnect() { rejectPost = true; },
    holdPoll(error: boolean) { staleNext = true; staleError = error; },
    async close() { post.resolve(); welcome.resolve(); stale.resolve(); for (const socket of sockets) socket.close(); await Promise.all([old.stop(true), next.stop(true), privateServer.stop(true)]); },
  };
}
function Probe() { context = useSessionCollaboration()!; return null; }
beforeEach(() => {
  service = fixture();
  win = new Window({ url: `${service.privateOrigin}/?session=private` });
  const globals = globalThis as unknown as Record<string, unknown>; const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "history", "sessionStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent"]) { saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key]; }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = globalThis.fetch; saved.set("fetch", originalFetch);
  globals.fetch = (input: string | URL | Request, init?: RequestInit) => originalFetch(typeof input === "string" ? new URL(input, service.privateOrigin) : input, init);
  const originalInterval = globalThis.setInterval; saved.set("setInterval", originalInterval);
  poll = () => { throw new Error("Provider poll was not registered"); }; let registered = false;
  globals.setInterval = (handler: () => void, timeout: number) => { if (!registered && timeout === 5000) { registered = true; poll = handler; return originalInterval(() => {}, 60_000); } return originalInterval(handler, timeout); };
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  useStore.setState({ sessionId: "private", modeManifest: null, projectContext: null, viewerInstanceId: null });
  const element = win.document.createElement("div"); win.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); await service.close(); await win.happyDOM.close(); restore(); });
async function until(check: () => boolean) { for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); } throw new Error("Reconnect fixture did not reach expected state"); }
async function mount() { await act(async () => root.render(<SessionCollaborationProvider><Probe/></SessionCollaborationProvider>)); await until(() => context.client.status === "connected"); }

test("References waits for reconnect completion and the new Project welcome before using the new entry", async () => {
  await mount();
  let command!: Promise<void>;
  await act(async () => { command = context.command("connect", { url: `${service.newOrigin}/projects/project` }); context.setOpen(true); context.setTab("references"); });
  await until(() => service.stored().connection?.authorityBaseUrl === service.newOrigin);
  expect(context.pending).toBe(true); expect(context.client.baseUrl).toBe(service.oldOrigin);
  expect(win.document.body.textContent).toContain("Updating Project connection");
  expect(service.calls.some((path) => path.endsWith("/api/references"))).toBe(false);
  await act(async () => { poll(); service.post.resolve(); await command; });
  expect(context.client.baseUrl).toBe(service.newOrigin); expect(context.client.status).toBe("connecting");
  expect(win.document.body.textContent).toContain("Connecting to Project");
  expect(service.calls.some((path) => path.endsWith("/api/references"))).toBe(false);
  await act(async () => service.welcome.resolve());
  await until(() => !!win.document.querySelector(".reference-item"));
  expect(service.calls.filter((path) => path.endsWith("/api/references"))).toEqual(["new/api/references"]);
  expect([...win.document.querySelectorAll("button")].find((button) => button.textContent === "Open pinned view")!.disabled).toBe(false);
});
for (const error of [false, true]) test(`a pre-command poll cannot apply its stale ${error ? "failure" : "status"} after accepted reconnect`, async () => {
  await mount(); service.holdPoll(error);
  await act(async () => poll()); await until(() => service.staleStarted());
  let command!: Promise<void>; await act(async () => { command = context.command("connect", { url: `${service.newOrigin}/projects/project` }); });
  await until(() => service.stored().connection?.authorityBaseUrl === service.newOrigin);
  await act(async () => { service.post.resolve(); await command; service.welcome.resolve(); });
  await until(() => context.client.status === "connected" && context.client.baseUrl === service.newOrigin);
  await act(async () => { service.stale.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(context.client.baseUrl).toBe(service.newOrigin); expect(context.error).toBe(""); expect(context.pending).toBe(false);
});

test("a slow background poll coalesces interval ticks and can still update status", async () => {
  await mount();
  service.stored().publisherStatus = "Latest publication status";
  service.holdPoll(false);
  await act(async () => poll()); await until(() => service.staleStarted());
  const requests = service.statusCalls();
  await act(async () => { poll(); poll(); poll(); });
  expect(service.statusCalls()).toBe(requests);
  await act(async () => service.stale.resolve());
  await until(() => context.status?.publisherStatus === "Latest publication status");
  expect(context.status?.publisherStatus).toBe("Latest publication status");
});

test("a failed reconnect stays visible after a successful background status poll", async () => {
  await mount(); service.rejectConnect();
  let command!: Promise<void>;
  await act(async () => { command = context.command("connect", { url: `${service.newOrigin}/projects/project` }).catch(() => undefined); service.post.resolve(); await command; });
  expect(context.error).toBe("Reconnect rejected");
  expect(context.client.baseUrl).toBe(service.oldOrigin);
  await act(async () => poll());
  await until(() => service.statusCalls() >= 3);
  expect(context.error).toBe("Reconnect rejected");
});

test("private adoption migrates unmounted operations through legacy trusted entry pinning", async () => {
  const fallback = `lan-origin:${service.oldOrigin}`;
  const canonical = "lan-key:verified-authority";
  service.setOperationAuthorities(fallback, canonical);
  const operation = { opId: "original-location-request", label: "Original object" };
  const scope = { authorityBaseUrl: service.oldOrigin, projectId: "project", workspaceId: "workspace", targetId: "pin", action: "selected-location", revision: 1 };
  saveReferenceOperation(referenceOperationKey(scope), operation);
  await mount();
  expect(readReferenceOperation(referenceOperationKey({ ...scope, authorityScope: fallback }))).toEqual(operation);
  let command!: Promise<void>;
  await act(async () => { command = context.command("connect", { url: `${service.newOrigin}/projects/project` }); });
  await until(() => service.stored().connection?.authorityBaseUrl === service.newOrigin);
  await act(async () => { service.post.resolve(); await command; service.welcome.resolve(); });
  await until(() => context.client.status === "connected");
  expect(readReferenceOperation(referenceOperationKey({ ...scope, authorityBaseUrl: service.newOrigin, authorityScope: canonical }))).toEqual(operation);
  expect(win.sessionStorage.getItem(referenceOperationKey({ ...scope, authorityScope: fallback }))).toBeNull();
});
test("reference storage failure preserves public Stop controls while reference actions stay blocked", async () => {
  service.stored().canManageInternetAccess = true;
  service.stored().internetAccess = { status: "active", provider: { kind: "quick" }, publicOrigin: "https://public.example", publicClients: 0, idleDeadline: null, idleTimeoutMs: 600000 };
  const key = referenceOperationKey({ authorityBaseUrl: service.oldOrigin, projectId: "project", workspaceId: "workspace", targetId: "pin", action: "pin" });
  win.sessionStorage.setItem(key, "corrupt recovery record");
  await mount();
  await act(async () => context.setOpen(true));
  expect(context.status?.internetAccess?.status).toBe("active");
  expect(context.referenceRecoveryError).toContain("recovered safely");
  expect([...win.document.querySelectorAll("button")].find((button) => button.textContent === "Stop public access")!.disabled).toBe(false);
  await act(async () => context.setTab("references"));
  expect(win.document.body.textContent).toContain("recovered safely");
  expect(win.document.querySelector(".reference-item")).toBeNull();
  expect(service.calls.some((path) => path.endsWith("/api/references"))).toBe(false);
});

test("restoring storage after failed migration retains the previous binding's recovery source", async () => {
  service.setOperationAuthorities(`lan-origin:${service.oldOrigin}`, "lan-key:verified");
  const scope = { authorityBaseUrl: service.oldOrigin, projectId: "project", workspaceId: "workspace", targetId: "pin", action: "pin" };
  const key = referenceOperationKey(scope);
  win.sessionStorage.setItem(key, "corrupt record");
  await mount();
  let command!: Promise<void>;
  await act(async () => { command = context.command("connect", { url: `${service.newOrigin}/projects/project` }); });
  await until(() => service.stored().connection?.authorityBaseUrl === service.newOrigin);
  await act(async () => { service.post.resolve(); await command; service.welcome.resolve(); });
  await until(() => context.client.status === "connected");
  expect(context.client.baseUrl).toBe(service.newOrigin);
  expect(context.referenceRecoveryError).toContain("recovered safely");
  saveReferenceOperation(key, { opId: "restored-original-operation" });
  await act(async () => poll());
  await until(() => !context.referenceRecoveryError);
  expect(readReferenceOperation(referenceOperationKey({ ...scope, authorityBaseUrl: service.newOrigin, authorityScope: "lan-key:verified" }))?.opId).toBe("restored-original-operation");
  expect(win.sessionStorage.getItem(key)).toBeNull();
});

test("Project Pin waits during pending reconnect without discarding its recovery record", async () => {
  await mount();
  const scope = { authorityBaseUrl: service.oldOrigin, authorityScope: "lan-key:stable-authority", projectId: "project", workspaceId: "workspace", targetId: "source", action: "pin" };
  saveReferenceOperation(referenceOperationKey(scope), { opId: "original-pin-request" });
  await act(async () => { context.setOpen(true); context.setTab("project"); });
  const pin = () => [...win.document.querySelectorAll("button")].find((button) => button.textContent === "Retry pin");
  expect(pin()?.disabled).toBe(false);
  let command!: Promise<void>;
  await act(async () => { command = context.command("connect", { url: `${service.newOrigin}/projects/project` }); });
  await until(() => service.stored().connection?.authorityBaseUrl === service.newOrigin);
  expect(context.pending).toBe(true);
  expect(pin()).toBeUndefined();
  expect(service.calls.some((path) => path === "old/api/rooms/source")).toBe(false);
  expect(readReferenceOperation(referenceOperationKey(scope))?.opId).toBe("original-pin-request");
  await act(async () => { service.post.resolve(); await command; });
  expect(pin()?.disabled).toBe(true); // The new entry has not received its Project welcome yet.
  await act(async () => service.welcome.resolve());
  await until(() => pin()?.disabled === false);
  expect(readReferenceOperation(referenceOperationKey({ ...scope, authorityBaseUrl: service.newOrigin }))?.opId).toBe("original-pin-request");
  expect(service.calls.some((path) => path === "old/api/rooms/source")).toBe(false);
});
