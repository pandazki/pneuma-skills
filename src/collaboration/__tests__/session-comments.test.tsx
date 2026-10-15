import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SessionCollaborationProvider, useSessionCollaboration } from "../SessionCollaboration.js";
import { useStore } from "../../store.js";
import type { SessionCollaborationStatus } from "../../../core/types/collaboration-session.js";
import type { CollaborationRoomState } from "../../../core/types/collaboration.js";

let win: Window; let root: Root; let restore: () => void;
let server: ReturnType<typeof Bun.serve>;
let context: NonNullable<ReturnType<typeof useSessionCollaboration>>;
const sockets = new Set<Bun.ServerWebSocket<undefined>>();
let posted: unknown[];
let state: { project: { id: string; name: string }; self: { kind: "member"; id: string; name: string; role: "admin" | "reader" }; rooms: CollaborationRoomState["room"][]; members: []; workspaces: [] };
let room: CollaborationRoomState;
function Probe() { context = useSessionCollaboration()!; return null; }
beforeEach(() => {
  posted = [];
  room = { room: { id: "room", title: "Shared site", mode: "webcraft", ownerId: "owner", workspaceId: "workspace", modeInstanceId: "instance", enabled: true, revision: 3, page: "index.html", updatedAt: 1 }, participants: [],
    comments: [{ id: "comment", roomId: "room", status: "open", anchor: { address: { contentSet: "site", page: "index.html", selector: "#heading" }, quote: "Heading", x: 0, y: 0, revision: 3 }, messages: [{ id: "message", authorId: "peer", authorName: "Peer", body: "Make the title clearer", createdAt: 1 }], resolvedBy: null, updatedAt: 1 }],
    messages: [{ id: "chat", roomId: "room", authorId: "peer", authorName: "Peer", body: "Check the heading", createdAt: 1 }], pageUrl: "http://host/site" };
  state = { project: { id: "project", name: "Project" }, self: { id: "owner", name: "Owner", kind: "member", role: "admin" }, rooms: [room.room], members: [], workspaces: [] };
  server = Bun.serve<undefined>({ hostname: "127.0.0.1", port: 0, async fetch(request, server) {
    const path = new URL(request.url).pathname;
    if (path === "/api/collaboration") return Response.json({ projectAvailable: true, supported: true, sharing: true, sharedContentSet: "site", roomId: "room", publisherStatus: "Sharing", connection: { projectId: "project", workspaceId: "workspace", ownerId: "owner", authorityBaseUrl: `http://127.0.0.1:${server.port}`, token: "member", authorityKind: "lan" } } satisfies SessionCollaborationStatus);
    if (path === "/api/state") return Response.json(state);
    if (path === "/ws" && server.upgrade(request)) return;
    if (request.method === "POST") { posted.push(await request.json()); return Response.json({}); }
    return new Response(null, { status: 404 });
  }, websocket: { open(socket) { sockets.add(socket); socket.send(JSON.stringify({ type: "welcome", state, connectionId: "self" })); socket.send(JSON.stringify({ type: "room", state: room })); }, message() {}, close(socket) { sockets.delete(socket); } } });
  win = new Window({ url: `http://127.0.0.1:${server.port}/?session=private` });
  const globals = globalThis as unknown as Record<string, unknown>; const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "history", "sessionStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent"]) { saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key]; }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = globalThis.fetch; saved.set("fetch", originalFetch); globals.fetch = (input: string | URL | Request, init?: RequestInit) => originalFetch(typeof input === "string" ? new URL(input, win.location.origin) : input, init);
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  useStore.setState({ sessionId: "private", activeContentSet: "site", modeManifest: null, projectContext: null, viewerInstanceId: null, previewMode: "annotate", selection: null, collaborationFeedback: [], pendingMessages: [], messages: [], tornOff: false, surfaceForm: "collapsed" });
  const element = win.document.createElement("div"); win.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); for (const socket of sockets) socket.close(); await server.stop(true); await win.happyDOM.close(); restore(); });
async function until(check: () => boolean) { for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); } throw new Error("Session comment fixture did not become ready"); }
async function mount() { await act(async () => root.render(<SessionCollaborationProvider><Probe/></SessionCollaborationProvider>)); await until(() => context.client.status === "connected" && !!context.client.room); }
function button(text: string) { return [...win.document.querySelectorAll("button")].find((button) => button.textContent === text); }

test("private toolbar and shortcut selection open a bounded comment draft without changing the current tool or posting", async () => {
  await mount(); expect(context.canComment).toBe(true);
  await act(async () => context.startComment());
  expect(context.commenting).toBe(true); expect(useStore.getState().previewMode).toBe("annotate");
  const selection = { type: "heading", label: "Heading", content: "The actual heading", file: "index.html", address: { contentSet: "site", page: "index.html", selector: "#heading" } };
  await act(async () => context.selection(selection));
  expect(context.commenting).toBe(false); expect(context.draft).toMatchObject({ address: selection.address, revision: 3, preview: { content: selection.content } });
  expect(win.document.querySelector('[aria-label="Post comment"]')).not.toBeNull(); expect(button("Post comment")?.disabled).toBe(true);
  expect(posted).toHaveLength(0); expect(useStore.getState().previewMode).toBe("annotate"); expect(useStore.getState().selection).toBeNull();
  await act(async () => { context.clearDraft(); context.selection(selection); });
  expect(context.draft?.address).toEqual(selection.address); expect(posted).toHaveLength(0);
});

test("private host can stage comment and chat snapshots into its current AI composer without sending", async () => {
  await mount(); await act(async () => { context.setOpen(true); context.setTab("comments"); useStore.setState({ tornOff: true }); });
  expect(button("Send to AI")).toBeDefined();
  await act(async () => button("Send to AI")!.click());
  expect(useStore.getState().collaborationFeedback).toHaveLength(1); expect(useStore.getState().collaborationFeedback[0]?.kind).toBe("comment");
  expect(useStore.getState().tornOff).toBe(false); expect(useStore.getState().surfaceForm).toBe("docked"); expect(context.open).toBe(false);
  await act(async () => { context.setOpen(true); context.setTab("chat"); });
  await act(async () => button("Send to AI")!.click());
  expect(useStore.getState().collaborationFeedback).toHaveLength(2); expect(useStore.getState().collaborationFeedback[1]?.kind).toBe("chat");
  expect(useStore.getState().pendingMessages).toHaveLength(0); expect(useStore.getState().messages).toHaveLength(0); expect(posted).toHaveLength(0);
});

test("an administrator in another host's room cannot forward into this private Agent", async () => {
  room.room.ownerId = "other-owner"; await mount();
  await act(async () => { context.setOpen(true); context.setTab("comments"); });
  expect(button("Send to AI")).toBeUndefined();
});

test("a private unshared view and a reader cannot start comment picking", async () => {
  state.self.role = "reader"; await mount(); expect(context.canComment).toBe(false);
  await act(async () => { context.startComment(); context.selection({ type: "heading", content: "Heading", address: { page: "index.html" } }); });
  expect(context.draft).toBeNull(); expect(context.commenting).toBe(false);
  await act(async () => { useStore.setState({ activeContentSet: "private-site" }); });
  expect(context.canComment).toBe(false);
});
