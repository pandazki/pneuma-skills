import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InvitationJoin } from "../Entry.js";
import { useCollaboration } from "../use-collaboration.js";
import { CollaborationApp } from "../App.js";

let win: Window;
let root: Root;
let element: HTMLElement;
let restore: () => void;
let service: ReturnType<typeof fixture>;
let client: ReturnType<typeof useCollaboration> & { hostOffline?: boolean };

function fixture() {
  let online = true;
  let owner = false;
  let member = false;
  let removed = false;
  const calls: Array<{ path: string; authorization: string | null }> = [];
  const sockets = new Set<ServerWebSocket<undefined>>();
  let connections = 0;
  const joined: string[] = [];
  const room = () => ({ id: "room", title: "Website", mode: "webcraft", ownerId: "owner", enabled: true, revision: 1, page: "index.html", updatedAt: 1, hostOnline: online });
  const state = () => ({ project: { id: "project", name: "Shared project" }, self: owner ? { id: "owner", name: "Host", kind: "member", role: "admin" } : member ? { id: "visitor", name: "Alex", kind: "member", role: "writer" } : { id: "visitor", name: "Alex", kind: "guest", role: "reader", guestAccess: "comment", roomId: "room" }, rooms: [room(), ...(member ? [{ ...room(), id: "healthy", hostOnline: true }] : [])], members: [] });
  const roomState = () => ({ room: room(), pageUrl: "/frame", participants: [{ id: "host-tab", memberId: "owner", name: "Host", role: "admin", roomId: "room", color: "#f97316", view: null, cursor: null, followingId: null, updatedAt: 1 }], comments: [{ id: "thread", roomId: "room", anchor: { address: {}, revision: 1, x: 0, y: 0 }, status: "open", resolvedBy: null, updatedAt: 1, messages: [{ id: "comment", authorId: "owner", authorName: "Host", body: "Visible comment", createdAt: 1 }] }], messages: [{ id: "chat", roomId: "room", authorId: "owner", authorName: "Host", body: "Visible chat", createdAt: 1 }] });
  const server = Bun.serve<undefined>({
    hostname: "0.0.0.0", port: 0,
    async fetch(request, runtime) {
      const url = new URL(request.url);
      calls.push({ path: url.pathname, authorization: request.headers.get("authorization") });
      if (removed) return Response.json({ error: "Project was removed", code: "project_removed" }, { status: 410 });
      if (url.pathname === "/api/references/missing/resolve") return Response.json({ error: "The reference was removed or is unavailable" }, { status: 410 });
      if (url.pathname.startsWith("/api/references/")) return Response.json({ error: "The source host is offline.", code: "host_offline" }, { status: 423 });
      if (url.pathname === "/api/state") return !online && !owner && !member ? Response.json({ error: "The host is offline. Rejoin when the host is online.", code: "host_offline" }, { status: 423 }) : Response.json(state());
      if (url.pathname === "/api/invitations/redeem") return !online ? Response.json({ error: "The host is offline.", code: "host_offline" }, { status: 423 }) : Response.json({ token: "redeemed-visitor", roomId: "room" });
      if (url.pathname === "/ws") return runtime.upgrade(request, { data: undefined }) ? undefined : new Response(null, { status: 400 });
      return new Response("Fixture", { headers: { "Content-Type": "text/html" } });
    },
    websocket: {
      open(socket) { sockets.add(socket); connections++; socket.send(JSON.stringify({ type: "welcome", connectionId: "visitor-tab", state: state() })); },
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message.type === "join") {
          joined.push(message.roomId);
          socket.send(JSON.stringify({ type: "room", state: message.roomId === "healthy" ? { ...roomState(), room: { ...room(), id: "healthy", hostOnline: true }, comments: [], messages: [] } : roomState() }));
        }
        if (message.type === "ping") socket.send(JSON.stringify({ type: "pong", sentAt: message.sentAt, serverAt: Date.now() }));
      },
      close(socket) { sockets.delete(socket); },
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`, calls,
    joined,
    setOnline(value: boolean) { online = value; },
    setOwner(value: boolean) { owner = value; },
    setMember(value: boolean) { member = value; },
    removeProject(sendFrame = false) { removed = true; for (const socket of sockets) { if (sendFrame) socket.send(JSON.stringify({ type: "closed", reason: "Project removed" })); socket.close(1008, "Project removed"); } },
    connections: () => connections,
    eject() {
      online = false;
      for (const socket of sockets) {
        socket.send(JSON.stringify({ type: "closed", code: "host_offline", reason: "The host is offline. Rejoin when the host is online." }));
        // An already queued snapshot must not repopulate an ejected viewer.
        socket.send(JSON.stringify({ type: "room", state: roomState() }));
        socket.close();
      }
    },
    networkDrop() { for (const socket of sockets) socket.close(1012, "Network interrupted"); },
    async close() { for (const socket of sockets) socket.close(); await server.stop(true); },
  };
}

function Probe() {
  client = useCollaboration("existing-visitor", "room");
  return <div><span>{client.status}</span>{client.room && <><iframe title="Shared page" src={client.room.pageUrl}/><p>{client.room.comments[0]?.messages[0]?.body}</p><p>{client.room.messages[0]?.body}</p><p>{client.room.participants[0]?.name}</p></>}<button onClick={client.reconnect}>Rejoin</button></div>;
}

function DirectoryProbe({ room = "" }: { room?: string }) {
  client = useCollaboration("existing-member", room, { selectDefault: false, updateHash: false });
  return <span>{client.status}</span>;
}

async function until(condition: () => boolean, timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Client did not reach expected state; current status=${client?.status}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

beforeEach(() => {
  service = fixture();
  win = new Window({ url: service.origin, settings: { disableIframePageLoading: true } });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  const install = (key: string, value: unknown) => { saved.set(key, globals[key]); globals[key] = value; };
  for (const key of ["window", "document", "navigator", "location", "history", "sessionStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent", "ResizeObserver", "IntersectionObserver"]) install(key, key === "window" ? win : (win as unknown as Record<string, unknown>)[key]);
  install("requestAnimationFrame", win.requestAnimationFrame.bind(win));
  install("cancelAnimationFrame", win.cancelAnimationFrame.bind(win));
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const originalFetch = globalThis.fetch;
  install("fetch", (input: string | URL | Request, init?: RequestInit) => originalFetch(typeof input === "string" ? new URL(input, service.origin) : input, init));
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  const container = win.document.createElement("div");
  win.document.body.append(container);
  element = container as unknown as HTMLElement;
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  await service.close();
  await win.happyDOM.close();
  restore();
});

describe("host-offline access lifecycle", () => {
  test("public removed-project UI is terminal after the actual closed frame and offers no invitation or reconnect recovery", async () => {
    service.setMember(true);
    await act(async () => root.render(<CollaborationApp token="existing-member" initialRoom="room"/>));
    await until(() => element.textContent!.includes("Website") && service.joined.includes("room"));
    const before = service.connections();
    await act(async () => service.removeProject(true));
    await until(() => element.querySelector("h1")?.textContent === "Shared project removed");
    expect(element.textContent).toContain("Shared access to this Project has ended");
    expect(element.textContent).toContain("Local files and private Agent sessions remain");
    expect(element.querySelector("button")).toBeNull();
    expect(element.querySelector("iframe")).toBeNull();
    for (const misleading of ["Choose a workspace", "Ask the owner for a new invitation", "Reconnect", "Try again", "Rejoin"]) expect(element.textContent).not.toContain(misleading);
    expect(service.connections()).toBe(before);
  });
  test("a removed-project frame followed by1008 is terminal while an unavailable reference leaves healthy work connected", async () => {
    service.setMember(true);
    await act(async () => root.render(<Probe/>));
    await until(() => !!client.room);
    await expect(client.request("/api/references/missing/resolve")).rejects.toThrow("reference was removed");
    expect(client.projectRemoved).toBe(false); expect(client.room?.room.id).toBe("room");
    const before = service.connections();
    await act(async () => service.removeProject(true));
    await until(() => client.projectRemoved);
    expect(client.status).toBe("closed"); expect(client.room).toBeNull();
    expect(client.project?.project.id).toBe("project"); expect(client.project?.rooms).toHaveLength(0);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(service.connections()).toBe(before);
  });
  test("HTTP project_removed410 clears public snapshots and stops retries", async () => {
    service.setMember(true); service.removeProject();
    await act(async () => root.render(<Probe/>));
    await until(() => client.projectRemoved);
    expect(client.status).toBe("closed"); expect(client.room).toBeNull();
    const calls = service.calls.length;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(service.calls).toHaveLength(calls);
  });
  test("an offline reference source does not eject the viewer's healthy current room", async () => {
    service.setMember(true);
    await act(async () => root.render(<Probe/>));
    await until(() => !!client.room);
    await expect(client.request("/api/references/pin/resolve")).rejects.toThrow("host is offline");
    expect(client.hostOffline).toBe(false);
    expect(client.room?.room.id).toBe("room");
    expect(client.status).toBe("connected");
  });
  test("normal Session directory does not autojoin a peer room; explicit sharing joins only its own room", async () => {
    service.setMember(true);
    await act(async () => root.render(<DirectoryProbe/>));
    await until(() => client.status === "connected");
    expect(client.project?.rooms).toHaveLength(2);
    expect(client.room).toBeNull(); expect(service.joined).toEqual([]);
    await act(async () => root.render(<DirectoryProbe room="room"/>));
    await until(() => !!client.room);
    expect(service.joined).toEqual(["room"]);
    expect(win.location.hash).toBe("");
  });
  test("members keep the authorized directory after ejection and explicitly choose a healthy room", async () => {
    service.setMember(true);
    await act(async () => { root.render(<Probe/>); });
    await until(() => !!client.room);
    await act(async () => service.eject());
    await until(() => client.hostOffline === true);
    expect(client.project?.rooms.map((room) => room.id)).toEqual(["room", "healthy"]);
    expect(client.room).toBeNull();
    await act(async () => client.selectRoom("healthy"));
    await until(() => client.room?.room.id === "healthy");
    expect(client.hostOffline).toBe(false);
    expect(client.status).toBe("connected");
  });
  test("terminal ejection removes shared state, ignores late frames, and only explicitly rejoins", async () => {
    await act(async () => { root.render(<Probe/>); });
    await until(() => !!client.room);
    expect(element.textContent).toContain("Visible chat");
    await act(async () => { service.eject(); });
    await until(() => client.status === "closed");
    expect(client.hostOffline).toBe(true);
    expect(client.room).toBeNull();
    expect(client.project).toBeNull();
    expect(element.querySelector("iframe")).toBeNull();
    expect(element.textContent).not.toContain("Visible comment");
    expect(element.textContent).not.toContain("Visible chat");
    const requests = service.calls.length;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(service.calls.length).toBe(requests);
    expect(service.connections()).toBe(1);
    service.setOnline(true);
    await act(async () => { (element.querySelector("button") as HTMLButtonElement).click(); });
    await until(() => client.status === "connected" && !!client.room);
    expect(client.hostOffline).toBe(false);
    expect(service.calls.filter((call) => call.path === "/api/state").every((call) => call.authorization === "Bearer existing-visitor")).toBe(true);
  });

  test("initial HTTP 423 is terminal rather than an automatic polling loop", async () => {
    service.setOnline(false);
    await act(async () => { root.render(<Probe/>); });
    await until(() => client.status !== "connecting");
    expect(client.status).toBe("closed");
    expect(client.hostOffline).toBe(true);
    expect(client.error).toContain("host is offline");
    const requests = service.calls.length;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(service.calls.length).toBe(requests);
    expect(service.connections()).toBe(0);
  });

  test("ordinary network loss retains a snapshot and reconnects automatically", async () => {
    await act(async () => { root.render(<Probe/>); });
    await until(() => !!client.room);
    await act(async () => { service.networkDrop(); });
    await until(() => client.status === "reconnecting");
    expect(client.room?.messages[0]?.body).toBe("Visible chat");
    expect(client.hostOffline).toBe(false);
    await until(() => service.connections() === 2 && client.status === "connected" && !!client.room);
  });

  test("owner can connect while hostOnline is false", async () => {
    service.setOwner(true); service.setOnline(false);
    await act(async () => { root.render(<Probe/>); });
    await until(() => !!client.room);
    expect(client.status).toBe("connected");
    expect(client.room?.room.hostOnline).toBe(false);
    expect(client.hostOffline).toBe(false);
  });

  test("offline invitation preserves the display name and waits for an explicit retry", async () => {
    service.setOnline(false);
    win.sessionStorage.setItem("pneuma-collaboration-visitor-name", "Alex");
    let joined = "";
    await act(async () => { root.render(<InvitationJoin inviteToken="still-valid-invitation" onJoin={(token) => { joined = token; }}/>); });
    expect((element.querySelector("input") as HTMLInputElement).value).toBe("Alex");
    await act(async () => { element.querySelector("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event); });
    await until(() => !!element.querySelector('[role="alert"]'));
    expect(element.textContent).toContain("The host is offline");
    expect((element.querySelector("input") as HTMLInputElement).value).toBe("Alex");
    expect(element.querySelector("button")?.textContent).toBe("Try again");
    expect(joined).toBe("");
    service.setOnline(true);
    await act(async () => { element.querySelector("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event); });
    await until(() => !!joined);
    expect(joined).toBe("redeemed-visitor");
  });
});
