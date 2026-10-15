import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CollaborationReference } from "../../../core/types/collaboration-reference.js";
import { PinRoomButton, ReferencesPanel } from "../ReferencesPanel.js";
import type { CollaborationRoom } from "../../../core/types/collaboration.js";
import { useStore } from "../../store.js";
import ChatInput from "../../components/ChatInput.js";
import type { useCollaboration } from "../use-collaboration.js";

let root: Root;
let win: Window;
let restore: () => void;
let server: ReturnType<typeof Bun.serve>;
let denyResolve = false;
let pinBodies: unknown[];
let importBodies: unknown[];
let dedupePins = false;
let committedPins: Map<string, CollaborationReference>;
const reference = { id: "pin-a", destinationWorkspaceId: "mine", ownerId: "me", label: "Peer website",
  source: { projectId: "project", workspaceId: "peer", roomId: "peer-room", publicationRevision: 4, address: { contentSet: "website", page: "index.html", selector: "#hero" } },
  compatibility: { coreVersion: "3.57.3", modeVersion: "1.9.0", viewerHash: "a".repeat(64), publicationSchema: "webcraft-public-v1" }, createdAt: 1, updatedAt: 1 } satisfies CollaborationReference;

beforeEach(() => {
  denyResolve = false;
  dedupePins = false; committedPins = new Map();
  pinBodies = [];
  importBodies = [];
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/collaboration/references/pin-a/import") {
      importBodies.push(await request.json());
      return importBodies.length === 1 ? Response.json({ error: "Uncertain import reply" }, { status: 503 }) : Response.json({ kind: "local-copy", path: "imports/pin-a-r4", publicationRevision: 4 });
    }
    if (url.pathname === "/api/references" && request.method === "POST") {
      const body = await request.json() as { opId: string };
      pinBodies.push(body);
      if (dedupePins) { if (!committedPins.has(body.opId)) committedPins.set(body.opId, { ...reference, id: `committed-${committedPins.size}` }); return pinBodies.length === 1 ? Response.json({ error: "Uncertain pin reply" }, { status: 503 }) : Response.json(committedPins.get(body.opId), { status: 201 }); }
      return pinBodies.length === 1 ? Response.json({ error: "Uncertain pin reply" }, { status: 503 }) : Response.json(reference, { status: 201 });
    }
    if (url.pathname === "/api/rooms/peer-room") return Response.json({ room: { id: "peer-room", workspaceId: "peer", revision: 4 }, publication: { revision: 4, projection: { entryAddress: reference.source.address } } });
    if (url.pathname === "/api/references") return Response.json({ references: [reference] });
    if (url.pathname === "/api/references/pin-a/resolve") return denyResolve ? Response.json({ error: "Source access revoked" }, { status: 403 }) : Response.json({ reference, compatibility: reference.compatibility, pageUrl: "/secret-resource-grant", token: "never-context", publication: { revision: 4 }, room: { id: "peer-room", revision: 4, mode: "webcraft", compatibility: reference.compatibility } });
    return Response.json({ error: "Unexpected test request" }, { status: 404 });
  } });
  win = new Window({ url: `http://127.0.0.1:${server.port}/?session=mine` });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "history", "sessionStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent"]) {
    saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = globalThis.fetch;
  saved.set("fetch", originalFetch);
  globals.fetch = (input: string | URL | Request, init?: RequestInit) => originalFetch(typeof input === "string" ? new URL(input, win.location.origin) : input, init);
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  useStore.setState({ editing: false, composerInsertion: null, messages: [], pendingMessages: [], pendingSteerIds: new Set(), annotations: [], selection: null, cliConnected: false, turnInProgress: false, promptSuggestions: [], modeManifest: null, session: null });
  const element = win.document.createElement("div"); win.document.body.append(element);
  root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); await server.stop(true); await win.happyDOM.close(); restore(); useStore.getState().setComposerInsertion(null); });
function client(role = "writer") {
  return { baseUrl: win.location.origin, project: { project: { id: "project" }, self: { id: "me", kind: "member", role }, rooms: [{ id: "peer-room", enabled: true, hostOnline: true, revision: 9 }], workspaces: [] }, status: "connected",
    request: async (path: string, options: { signal?: AbortSignal; method?: string; body?: unknown } = {}) => {
      const response = await fetch(new URL(path, win.location.origin), { signal: options.signal, method: options.method, headers: options.body ? { "Content-Type": "application/json" } : {}, body: options.body ? JSON.stringify(options.body) : undefined }); const value = await response.json();
      if (!response.ok) throw new Error(value.error); return value;
    } } as unknown as ReturnType<typeof useCollaboration>;
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
  throw new Error("Reference panel did not reach the expected state");
}
function button(text: string) { return [...win.document.querySelectorAll("button")].find((button) => button.textContent === text)!; }
function referenceOperationKeys() { return Array.from({ length: win.sessionStorage.length }, (_, index) => win.sessionStorage.key(index)).filter((key) => key?.startsWith("pneuma-reference-operation:")); }

describe("private References panel", () => {
  test("closing and reopening the panel retains an unresolved import's request ID and clears it after receipt", async () => {
    const viewerKey = "pneuma:viewer-state:unrelated";
    const viewerState = JSON.stringify({ contentSet: "website", file: "index.html" });
    win.sessionStorage.setItem(viewerKey, viewerState);
    const live = client();
    await act(async () => root.render(<ReferencesPanel client={live} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Import a local copy"));
    await act(async () => button("Import a local copy").click());
    await until(() => win.document.body.textContent!.includes("Uncertain import reply"));
    expect(referenceOperationKeys()).toHaveLength(1);
    await act(async () => root.render(null));
    await act(async () => root.render(<ReferencesPanel client={live} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Import a local copy"));
    await act(async () => button("Import a local copy").click());
    await until(() => win.document.body.textContent!.includes("Local copy imported"));
    expect(importBodies).toHaveLength(2); expect(importBodies[1]).toEqual(importBodies[0]);
    expect(referenceOperationKeys()).toHaveLength(0);
    expect(win.sessionStorage.getItem(viewerKey)).toBe(viewerState);
  });
  test("an uncertain import can recover its receipt after the source host goes offline", async () => {
    const live = client();
    await act(async () => root.render(<ReferencesPanel client={live} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Import a local copy"));
    await act(async () => button("Import a local copy").click());
    await until(() => win.document.body.textContent!.includes("Uncertain import reply"));
    const offline = { ...live, project: { ...live.project!, rooms: [{ ...live.project!.rooms[0]!, hostOnline: false }] } };
    await act(async () => root.render(<ReferencesPanel client={offline} destinationWorkspaceId="mine"/>));
    expect(button("Import a local copy").disabled).toBe(false);
    expect(button("Open pinned view").disabled).toBe(true);
    await act(async () => button("Import a local copy").click());
    await until(() => win.document.body.textContent!.includes("Local copy imported"));
    expect(importBodies).toHaveLength(2); expect(importBodies[1]).toEqual(importBodies[0]);
    expect(referenceOperationKeys()).toHaveLength(0);
  });
  test("a remounted pin retries its stored full body even when the source title changes", async () => {
    const live = client();
    const room = { id: "peer-room", title: "Original title", enabled: true, hostOnline: true } as CollaborationRoom;
    let pinned = 0;
    await act(async () => root.render(<PinRoomButton client={live} destinationWorkspaceId="mine" room={room} onPinned={() => pinned++}/>));
    await act(async () => button("Pin to my workspace").click());
    await until(() => win.document.body.textContent!.includes("Uncertain pin reply"));
    await act(async () => root.render(null));
    await act(async () => root.render(<PinRoomButton client={live} destinationWorkspaceId="mine" room={{ ...room, title: "Renamed title" }} onPinned={() => pinned++}/>));
    await act(async () => button("Retry pin").click());
    await until(() => pinned === 1);
    expect(pinBodies).toHaveLength(2); expect(pinBodies[1]).toEqual(pinBodies[0]);
    expect(pinBodies[1]).toMatchObject({ label: "Original title", destinationWorkspaceId: "mine" });
    expect(referenceOperationKeys()).toHaveLength(0);
  });
  test("an uncertain committed pin retries the same operation after a verified same-authority entry changes", async () => {
    dedupePins = true;
    const live = client();
    const room = { id: "peer-room", title: "Original title", enabled: true, hostOnline: true } as CollaborationRoom;
    const authority = "lan-key:verified-same-authority";
    let pinned = 0;
    await act(async () => root.render(<PinRoomButton client={live} operationAuthority={authority} destinationWorkspaceId="mine" room={room} onPinned={() => pinned++}/>));
    await act(async () => button("Pin to my workspace").click());
    await until(() => win.document.body.textContent!.includes("Uncertain pin reply"));
    await act(async () => root.render(null));
    const next = { ...live, baseUrl: "https://new-public-entry.example/projects/project" };
    await act(async () => root.render(<PinRoomButton client={next} operationAuthority={authority} destinationWorkspaceId="mine" room={{ ...room, title: "Renamed source" }} onPinned={() => pinned++}/>));
    expect(button("Retry pin")).toBeDefined();
    await act(async () => button("Retry pin").click());
    await until(() => pinned === 1);
    expect(pinBodies).toHaveLength(2); expect(pinBodies[1]).toEqual(pinBodies[0]);
    expect(committedPins.size).toBe(1); expect(referenceOperationKeys()).toHaveLength(0);
  });
  test("a newer source head keeps a pinned view, but offline/disabled/missing source metadata immediately unmounts it", async () => {
    for (const unavailable of ["offline", "disabled", "removed", "access-closed"] as const) {
      const live = client();
      await act(async () => root.render(<ReferencesPanel key={unavailable} client={live} destinationWorkspaceId="mine"/>));
      await until(() => !!button("Open pinned view"));
      await act(async () => button("Open pinned view").click());
      await until(() => !!win.document.querySelector('[role="dialog"]'));
      expect(live.project?.rooms[0]?.revision).toBe(9); // Pinned revision4 remains readable.
      const changed = { ...live, status: unavailable === "access-closed" ? "closed" : "connected", project: { ...live.project!, rooms: unavailable === "removed" ? [] : [{ ...live.project!.rooms[0]!, enabled: unavailable !== "disabled", hostOnline: unavailable !== "offline" }] } } as ReturnType<typeof useCollaboration>;
      await act(async () => root.render(<ReferencesPanel key={unavailable} client={changed} destinationWorkspaceId="mine"/>));
      expect(win.document.querySelector('[role="dialog"]')).toBeNull();
      expect(win.document.body.textContent).toContain("Peer website");
      expect(win.document.body.textContent).toContain("unavailable");
      await act(async () => root.render(<ReferencesPanel key={unavailable} client={live} destinationWorkspaceId="mine"/>));
      expect(win.document.querySelector('[role="dialog"]')).toBeNull();
    }
  });
  test("rechecks source access before an identity-only draft and never sends or starts the Agent", async () => {
    await act(async () => root.render(<ReferencesPanel client={client()} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Send reference to my Agent"));
    denyResolve = true;
    await act(async () => button("Send reference to my Agent").click());
    await until(() => win.document.body.textContent!.includes("Source access revoked"));
    expect(useStore.getState().composerInsertion).toBeNull();
    denyResolve = false;
    await act(async () => button("Send reference to my Agent").click());
    await until(() => !!useStore.getState().composerInsertion);
    const state = useStore.getState();
    expect(state.composerInsertion!.text).toContain('"publicationRevision": 4');
    expect(state.composerInsertion!.text).not.toContain("secret-resource-grant");
    expect(state.composerInsertion!.text).not.toContain("never-context");
    expect(state.messages).toHaveLength(0); expect(state.pendingMessages).toHaveLength(0); expect(state.editing).toBe(false);
  });
  test("reader controls deny reference mutations and imports", async () => {
    await act(async () => root.render(<ReferencesPanel client={client("reader")} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Open pinned view"));
    for (const label of ["Refresh to current entry", "Remove", "Import a local copy"]) expect(button(label).disabled).toBe(true);
    expect(button("Open pinned view").disabled).toBe(false);
    const card = win.document.querySelector(".reference-item")!;
    expect(card.querySelector("pre")).toBeNull();
    expect(card.textContent).toContain("index.html · #hero");
    expect(card.textContent).not.toContain("peer-room");
    expect(card.textContent).not.toContain('"selector"');
  });
  test("waits for the Project connection before loading or opening references", async () => {
    const live = client();
    const requests: string[] = [];
    const request = live.request;
    live.request = async (path, options) => { requests.push(path); return request(path, options); };
    const connecting = { ...live, status: "connecting" } as ReturnType<typeof useCollaboration>;
    await act(async () => root.render(<ReferencesPanel client={connecting} destinationWorkspaceId="mine"/>));
    expect(win.document.body.textContent).toContain("Connecting to Project");
    expect(requests).toHaveLength(0);
    await act(async () => root.render(<ReferencesPanel client={live} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Open pinned view"));
    expect(button("Open pinned view").disabled).toBe(false);
    await act(async () => root.render(<ReferencesPanel client={connecting} destinationWorkspaceId="mine"/>));
    expect(button("Open pinned view").disabled).toBe(true);
    expect(button("Send reference to my Agent").disabled).toBe(true);
    await act(async () => button("Open pinned view").click());
    expect(requests.some((path) => path.endsWith("/resolve"))).toBe(false);
    await act(async () => root.render(<ReferencesPanel client={live} destinationWorkspaceId="mine"/>));
    await until(() => !button("Open pinned view").disabled);
    await act(async () => button("Open pinned view").click());
    await until(() => !!win.document.querySelector('[role="dialog"]'));
    expect(requests.filter((path) => path.endsWith("/resolve"))).toHaveLength(1);
  });
  test("a late resolve from a previous entry cannot reopen its pinned view", async () => {
    const live = client();
    const request = live.request;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let resolving = false;
    live.request = async (path, options) => {
      if (path.endsWith("/resolve")) { resolving = true; await gate; }
      return request(path, options);
    };
    await act(async () => root.render(<ReferencesPanel client={live} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Open pinned view"));
    await act(async () => button("Open pinned view").click());
    expect(resolving).toBe(true);
    const next = { ...client(), baseUrl: "https://new-entry.example/projects/project" };
    await act(async () => root.render(<ReferencesPanel client={next} destinationWorkspaceId="mine"/>));
    await until(() => !button("Open pinned view").disabled);
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(win.document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => button("Open pinned view").click());
    await until(() => !!win.document.querySelector('[role="dialog"]'));
  });
  test("an old mutation reload cannot replace the new entry's reference list", async () => {
    const live = client();
    const request = live.request;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let lists = 0; let reloading = false;
    live.request = async <T,>(path: string, options: { method?: string; signal?: AbortSignal } = {}) => {
      if (options.method === "DELETE") return {} as T;
      if (path.startsWith("/api/references?") && ++lists === 2) { reloading = true; await gate; return { references: [reference] } as T; }
      return request<T>(path, options);
    };
    await act(async () => root.render(<ReferencesPanel client={live} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Remove"));
    await act(async () => button("Remove").click());
    await until(() => reloading);
    const next = { ...client(), baseUrl: "https://new-entry.example/projects/project", request: async <T,>() => ({ references: [{ ...reference, label: "New entry reference" }] } as T) };
    await act(async () => root.render(<ReferencesPanel client={next} destinationWorkspaceId="mine"/>));
    await until(() => win.document.body.textContent!.includes("New entry reference"));
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(win.document.body.textContent).toContain("New entry reference");
    expect(win.document.body.textContent).not.toContain("Peer website");
  });
  test("source availability gates opening without blocking removal of an offline reference", async () => {
    const live = client();
    live.project!.rooms[0]!.hostOnline = false;
    await act(async () => root.render(<ReferencesPanel client={live} destinationWorkspaceId="mine"/>));
    await until(() => !!button("Open pinned view"));
    expect(button("Open pinned view").disabled).toBe(true);
    expect(button("Remove").disabled).toBe(false);
    expect(win.document.body.textContent).toContain("source workspace must be online");
  });
  test("composer consumes an insertion once and preserves the editable draft on a second insertion", async () => {
    useStore.getState().setComposerInsertion({ id: "first", text: "Existing editable draft" });
    await act(async () => root.render(<StrictMode><ChatInput/></StrictMode>));
    expect(win.document.querySelector("textarea")!.value).toBe("Existing editable draft");
    expect(useStore.getState().composerInsertion).toBeNull();
    await act(async () => useStore.getState().setComposerInsertion({ id: "second", text: "Reference identity" }));
    expect(win.document.querySelector("textarea")!.value).toBe("Existing editable draft\n\nReference identity");
    expect(useStore.getState().messages).toHaveLength(0); expect(useStore.getState().pendingMessages).toHaveLength(0);
  });
});
