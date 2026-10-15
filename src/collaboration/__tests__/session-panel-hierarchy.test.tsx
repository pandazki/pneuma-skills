import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SessionCollaborationProvider, useSessionCollaboration } from "../SessionCollaboration.js";
import { useStore } from "../../store.js";
import type { SessionCollaborationStatus } from "../../../core/types/collaboration-session.js";
import type { CollaborationProjectState, CollaborationRoomState } from "../../../core/types/collaboration.js";

let win: Window;
let root: Root;
let restore: () => void;
let server: ReturnType<typeof Bun.serve>;
let context: NonNullable<ReturnType<typeof useSessionCollaboration>>;
let status: SessionCollaborationStatus;
let project: CollaborationProjectState;
let room: CollaborationRoomState;
let sendRoom: boolean;
let posts: { path: string; body: unknown }[];
const sockets = new Set<Bun.ServerWebSocket<undefined>>();
function Probe() { context = useSessionCollaboration()!; return null; }

beforeEach(() => {
  posts = [];
  sendRoom = true;
  room = { room: { id: "room", title: "Shared workspace", mode: "webcraft", ownerId: "owner", workspaceId: "workspace", modeInstanceId: "instance", enabled: true, hostOnline: true, revision: 1, page: "index.html", updatedAt: 1 }, participants: [], comments: [], messages: [], pageUrl: "http://host/revision/1/index.html" };
  project = { project: { id: "project", name: "Project" }, self: { kind: "member", id: "owner", name: "Owner", role: "admin" }, rooms: [room.room], members: [], workspaces: [] };
  server = Bun.serve<undefined>({ hostname: "127.0.0.1", port: 0, async fetch(request, instance) {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" || request.method === "DELETE") { posts.push({ path, body: await request.json().catch(() => null) }); return Response.json({}); }
    if (path === "/api/collaboration") return Response.json(status);
    if (path === "/api/state") return Response.json(project);
    if (path === "/api/references") return Response.json({ references: [] });
    if (path === "/ws" && instance.upgrade(request)) return;
    return new Response(null, { status: 404 });
  }, websocket: { open(socket) { sockets.add(socket); socket.send(JSON.stringify({ type: "welcome", state: project, connectionId: "self" })); if (sendRoom) socket.send(JSON.stringify({ type: "room", state: room })); }, message() {}, close(socket) { sockets.delete(socket); } } });
  const origin = `http://127.0.0.1:${server.port}`;
  status = { projectAvailable: true, supported: true, sharing: true, roomId: "room", publisherStatus: "Sharing", connection: { projectId: "project", workspaceId: "workspace", ownerId: "owner", authorityBaseUrl: origin, authorityKind: "lan", token: "member" }, canManageInternetAccess: true, internetAccess: { status: "active", provider: { kind: "quick" }, publicOrigin: "https://public.example", publicClients: 1, idleDeadline: null, idleTimeoutMs: 600000 } };
  win = new Window({ url: `${origin}/?session=private` });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "history", "sessionStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent"]) { saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key]; }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = globalThis.fetch; saved.set("fetch", originalFetch);
  globals.fetch = (input: string | URL | Request, init?: RequestInit) => originalFetch(typeof input === "string" ? new URL(input, origin) : input, init);
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  useStore.setState({ sessionId: "private", modeManifest: null, projectContext: null, viewerInstanceId: "private-viewer", staticPlayer: true, activeContentSet: null, previewMode: "view", viewerInstanceError: "" });
  const element = win.document.createElement("div"); win.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); for (const socket of sockets) socket.close(); await server.stop(true); await win.happyDOM.close(); restore(); });
async function until(check: () => boolean) { for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); } throw new Error("Panel fixture did not become ready"); }
async function mount(connected = true) { await act(async () => root.render(<SessionCollaborationProvider><Probe/></SessionCollaborationProvider>)); await until(() => !!context.status && (!connected || context.client.status === "connected")); await act(async () => context.setOpen(true)); }
function button(text: string) { return [...win.document.querySelectorAll("button")].find((item) => item.textContent === text); }
function disclosure(name: string) { return [...win.document.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === name)!; }
async function settings() { await act(async () => win.document.querySelector('[aria-label="Collaboration settings"]')!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }))); }
function input(label: string) { return [...win.document.querySelectorAll("label")].find((item) => item.textContent?.startsWith(label))!.querySelector("input")!; }
async function fill(element: ReturnType<typeof input>, value: string) {
  await act(async () => {
    // React imported before a browser uses its legacy input observer in happy-dom.
    Object.assign(element, { attachEvent() {}, detachEvent() {} });
    element.focus();
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new win.Event("input", { bubbles: true }));
    element.dispatchEvent(new win.KeyboardEvent("keyup", { bubbles: true, key: "r" }));
  });
}

test("the shared workspace opens invite actions; settings and secondary views remain reachable without writes", async () => {
  await mount();
  expect([...win.document.querySelectorAll('nav[aria-label="Collaboration panels"] button')].map((item) => item.textContent)).toEqual(["Share", "Comments", "Chat"]);
  expect(button("Create invitation")).toBeDefined();
  expect(button("Stop public access")).toBeUndefined();
  expect(button("Reconnect to Project")).toBeUndefined();
  await settings();
  expect(button("Stop public access")).toBeDefined();
  expect(disclosure("Shared workspaces").open).toBe(false);
  expect(disclosure("People in this workspace").open).toBe(false);
  await act(async () => disclosure("Shared workspaces").querySelector("summary")!.click());
  expect(disclosure("Shared workspaces").open).toBe(true);
  expect(disclosure("Shared workspaces").querySelector(".room-item")).not.toBeNull();
  await act(async () => disclosure("People in this workspace").querySelector("summary")!.click());
  expect(disclosure("People in this workspace").open).toBe(true);
  expect(button("Add comment to selection")).toBeDefined();
  await act(async () => button("Members & permissions")!.click());
  expect(button("Create invitation")).toBeDefined();
  await act(async () => button("Back to settings")!.click());
  await act(async () => button("References")!.click());
  await until(() => !!win.document.querySelector(".reference-list"));
  await act(async () => button("Back to settings")!.click());
  const advanced = [...win.document.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Advanced");
  expect(advanced?.open).toBe(false);
  await act(async () => advanced!.querySelector("summary")!.click());
  expect(advanced?.open).toBe(true);
  expect(button("Reconnect to Project")).toBeDefined();
  expect(button("Remove shared project")?.disabled).toBe(true);
  await fill(input("Type Project to confirm"), "Another project");
  expect(button("Remove shared project")?.disabled).toBe(true);
  await fill(input("Type Project to confirm"), "Project");
  expect(button("Remove shared project")?.disabled).toBe(false);
  expect(posts).toHaveLength(0);
});

test("first use starts local collaboration by default and joining stays optional", async () => {
  delete status.connection; status.sharing = false; delete status.roomId;
  await mount(false);
  expect(input("Your name")).toBeDefined();
  expect(win.document.querySelector('input[type="password"]')).toBeNull();
  const join = [...win.document.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Join with a link");
  expect(join?.open).toBe(false);
  await fill(input("Your name"), "Owner");
  await act(async () => input("Your name").closest("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })));
  await until(() => posts.length === 1);
  expect(posts[0]).toEqual({ path: "/api/collaboration/create", body: { name: "Owner" } });
});

test("custom cloud provisioning is reachable in Advanced and only submits on request", async () => {
  delete status.connection; status.sharing = false; delete status.roomId;
  await mount(false);
  await settings();
  const advanced = [...win.document.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Advanced");
  await act(async () => advanced!.querySelector("summary")!.click());
  await fill(input("Your name"), "Cloud owner");
  await fill(input("Cloud host URL"), "https://collaboration.example");
  await fill(input("Provisioning key"), "provision-key");
  expect(posts).toHaveLength(0);
  expect(button("Connect cloud host")?.disabled).toBe(false);
  await act(async () => input("Cloud host URL").closest("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })));
  await until(() => posts.length === 1);
  expect(posts[0]).toEqual({ path: "/api/collaboration/create", body: { name: "Cloud owner", authority: { kind: "cloud", origin: "https://collaboration.example" }, bootstrapKey: "provision-key" } });
});

test("sharing an unshared workspace preserves its explicit scope", async () => {
  status.sharing = false;
  useStore.setState({ activeContentSet: "site", activeFile: "site/index.html" });
  await mount();
  expect(button("Create invitation")).toBeUndefined();
  await act(async () => button("Share this workspace")!.click());
  await until(() => posts.length === 1);
  expect(posts[0]).toEqual({ path: "/api/collaboration/share", body: { title: "site", contentSet: "site", activeFile: "site/index.html" } });
});

test("readers cannot reach member administration or create guest access", async () => {
  project.self = { kind: "member", id: "reader", name: "Reader", role: "reader" };
  status.canManageInternetAccess = false;
  await mount();
  expect(button("Create invitation")).toBeUndefined();
  await settings();
  expect(button("Members & permissions")).toBeUndefined();
  expect(button("Remove shared project")).toBeUndefined();
  expect(button("References")).toBeDefined();
  expect(posts).toHaveLength(0);
});

test("host offline remains visible even when sharing is enabled", async () => {
  room.room.hostOnline = false;
  await mount();
  expect(win.document.querySelector(".collaboration-status")?.textContent).toContain("Host offline");
  expect(win.document.querySelector(".collaboration-status")?.getAttribute("data-state")).toBe("inactive");
  expect(posts).toHaveLength(0);
});

test("a connected welcome waits for its shared room before reporting successful sharing", async () => {
  sendRoom = false;
  await mount();
  expect(context.client.room).toBeNull();
  expect(win.document.querySelector(".collaboration-status")?.textContent).toContain("Opening shared workspace…");
  expect(win.document.querySelector(".collaboration-status")?.getAttribute("data-state")).toBe("inactive");
  expect(win.document.body.textContent).not.toContain("Your role can view shared work");
  expect(button("Create invitation")).toBeUndefined();
  await act(async () => { for (const socket of sockets) socket.send(JSON.stringify({ type: "room", state: room })); });
  await until(() => !!context.client.room);
  expect(win.document.querySelector(".collaboration-status")?.textContent).toContain("Workspace shared");
  expect(win.document.querySelector(".collaboration-status")?.getAttribute("data-state")).toBe("connected");
  expect(button("Create invitation")).toBeDefined();
  expect(posts).toHaveLength(0);
});

test("a disabled shared room does not appear successfully shared or offer invitations", async () => {
  room.room.enabled = false;
  await mount();
  expect(win.document.querySelector(".collaboration-status")?.textContent).toContain("Sharing off");
  expect(win.document.querySelector(".collaboration-status")?.getAttribute("data-state")).toBe("inactive");
  expect(button("Create invitation")).toBeUndefined();
  expect(posts).toHaveLength(0);
});
