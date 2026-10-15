import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ModeDefinition } from "../../../core/types/mode-definition.js";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import type { ViewerViewState } from "../../../core/types/viewer-collaboration.js";
import type { CollaborationRoomState } from "../../../core/types/collaboration.js";
import { PublishedMount } from "../PublishedViewer.js";
import type { ViewerCollaborationRuntime } from "../viewer-runtime.js";
import type { useCollaboration } from "../use-collaboration.js";

let root: Root; let win: Window; let restore: () => void;
let latest: ViewerPreviewProps;
let applications: ViewerViewState[];
beforeEach(() => {
  applications = [];
  win = new Window({ url: "http://localhost/" });
  const globals = globalThis as unknown as Record<string, unknown>; const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "HTMLElement", "Element", "Node", "Event", "MouseEvent"]) { saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key]; }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  const element = win.document.createElement("div"); win.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); await win.happyDOM.close(); restore(); });
function Preview(props: ViewerPreviewProps) {
  latest = props;
  const source = props.sources!.site!;
  const [value, setValue] = useState(source.current());
  useEffect(() => source.subscribe((event) => { if (event.kind === "value") setValue(event.value); }), [source]);
  useEffect(() => props.collaboration!.register({
    applyView: async (view, signal) => { if (signal.aborted) return { success: false }; applications.push(view); props.collaboration!.reportView(view, "follow"); return { success: true }; },
    projectPointer: () => ({ status: "visible", x: 20, y: 30 }),
    projectAnchor: () => ({ status: "visible", x: 40, y: 50 }),
  }), [props.collaboration]);
  return <output>{JSON.stringify(value)}</output>;
}
const definition = { manifest: { name: "test", viewerApi: { collaboration: { viewing: true, pointers: true, follow: true, addressAnchors: true, publication: { module: "publication.ts", schema: "test-v1" } } } }, viewer: { PreviewComponent: Preview } } as unknown as ModeDefinition;
function room(revision = 1, title = "published") {
  return { room: { id: "room", revision, page: "index.html" }, publication: { revision, files: [], projection: { schema: "test-v1", entryAddress: { page: "index.html" }, sources: { site: { title } } } }, pageUrl: "http://localhost/projects/project/rooms/room/revisions/1/grant/index.html",
    participants: [{ id: "peer", revision, semanticView: { address: { page: "second.html" }, detail: { scroll: { x: 0, y: 300 } } }, semanticPointer: { selector: "#peer" }, followingId: null, name: "Peer", color: "orange" }],
    comments: [{ id: "comment", anchor: { revision, address: { page: "index.html", selector: "#comment" }, x: 0, y: 0 }, messages: [{ body: "Comment" }] }], messages: [] } as unknown as CollaborationRoomState;
}

test("StrictMode generations keep live Sources, initial anchor, following and projections after replay", async () => {
  const runtimeRef = { current: null as ViewerCollaborationRuntime | null };
  const reports: unknown[] = [];
  const client = { status: "connected", baseUrl: "http://localhost", connectionId: "self", send: (report: unknown) => { reports.push(report); return true; } } as unknown as ReturnType<typeof useCollaboration>;
  const initialAnchor = { address: { page: "index.html", selector: "#initial" }, revision: 1, x: 0, y: 0 };
  const render = (state: CollaborationRoomState) => <StrictMode><PublishedMount definition={definition} room={state} client={client} commenting={false} followingId={null} onFollowingChange={() => {}} onSelect={() => {}} onComment={() => {}} runtimeRef={runtimeRef} initialAnchor={initialAnchor}/></StrictMode>;
  await act(async () => { root.render(render(room())); });
  expect(runtimeRef.current?.current().ready).toBe(true);
  expect(win.document.querySelector("output")!.textContent).toBe('{"title":"published"}');
  expect(latest.sources!.site!.current()).toEqual({ title: "published" });
  expect(applications.some((view) => view.address.selector === "#initial")).toBe(true);
  expect(runtimeRef.current!.current().pointers.peer).toMatchObject({ status: "visible", x: 20 });
  expect(runtimeRef.current!.current().anchors.comment).toMatchObject({ status: "visible", x: 40 });
  expect(latest.permissions).toEqual({ editContent: false, notifyAgent: false, export: false });
  await act(async () => { runtimeRef.current!.setFollowing("peer"); });
  expect(applications.at(-1)?.address.page).toBe("second.html");
  await act(async () => { runtimeRef.current!.setFollowing(null); await Bun.sleep(60); });
  expect(reports.at(-1)).toMatchObject({ semanticView: { address: { page: "second.html" } }, followingId: null });
  const runtime = runtimeRef.current!;
  await act(async () => root.render(render(room(2, "updated atomically"))));
  expect(runtimeRef.current).toBe(runtime);
  expect(latest.sources!.site!.current()).toEqual({ title: "updated atomically" });
  expect(win.document.querySelector("output")!.textContent).toBe('{"title":"updated atomically"}');
  await expect(latest.fileChannel!.write("index.html", "private mutation")).rejects.toThrow("cannot write");
});

for (const allowed of [true, false]) test(`published comment picking honors discussion permission (${allowed}) independently of authoring`, async () => {
  const runtimeRef = { current: null as ViewerCollaborationRuntime | null };
  const client = { status: "connected", baseUrl: "http://localhost", connectionId: "self", project: { self: { kind: "guest", roomId: "room", guestAccess: allowed ? "comment" : "view" } }, send: () => true } as unknown as ReturnType<typeof useCollaboration>;
  const state = room(); state.room.enabled = true;
  const anchors: unknown[] = [];
  const render = (selectingLocation = false) => <PublishedMount definition={definition} room={state} client={client} commenting={true} selectingLocation={selectingLocation} followingId={null} onFollowingChange={() => {}} onSelect={(anchor) => anchors.push(anchor)} onComment={() => {}} runtimeRef={runtimeRef}/>;
  await act(async () => root.render(render()));
  expect(latest.commenting?.enabled).toBe(allowed); expect(latest.mode).toBe("view");
  const selection = { type: "heading", content: "The actual heading text", label: "Heading", file: "index.html", address: { page: "index.html", selector: "#heading" } };
  await act(async () => latest.commenting?.onSelect(selection));
  expect(anchors).toHaveLength(allowed ? 1 : 0);
  if (allowed) expect(anchors[0]).toMatchObject({ address: selection.address, quote: selection.label, preview: { label: selection.label, content: selection.content } });
  await act(async () => root.render(render(true)));
  expect(latest.commenting).toBeUndefined(); expect(latest.mode).toBe("select");
  await act(async () => latest.onSelect(selection));
  expect(anchors).toHaveLength(allowed ? 2 : 1);
});
