import { describe, expect, test } from "bun:test";
import type { ViewerCollaborationDeclaration, ViewerViewState } from "../../../core/types/viewer-collaboration.js";
import { ViewerCollaborationRuntime, type ViewerPeer, type ViewerPresenceReport } from "../viewer-runtime.js";
import { publishedSources, publicResourceResolver } from "../published-sources.js";
import { matchViewerAsset } from "../viewer-assets.js";
import { readCredentials, shareUrl } from "../client-state.js";

const declaration: ViewerCollaborationDeclaration = { viewing: true, pointers: true, follow: true, addressAnchors: true, publication: { module: "publication.ts", schema: "site-v1" } };
const view = (page: string): ViewerViewState => ({ address: { page } });
const peer = (revision: number, page = "index.html"): ViewerPeer => ({ id: "peer", revision, view: view(page), pointer: { selector: "#headline" }, followingId: null });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  const reports: ViewerPresenceReport[] = [];
  const applications: Array<{ state: ViewerViewState; signal: AbortSignal; finish: () => void }> = [];
  const runtime = new ViewerCollaborationRuntime("mount", declaration, view("index.html"), (report) => reports.push(report));
  runtime.binding.register({
    applyView: (state, signal) => new Promise((resolve) => { applications.push({ state, signal, finish: () => resolve({ success: true }) }); }),
    projectPointer: () => ({ status: "visible", x: 10, y: 20 }),
    projectAnchor: () => ({ status: "visible", x: 30, y: 40 }),
  });
  runtime.update(2, true, [peer(2)], []);
  return { runtime, reports, applications };
}

describe("mounted collaboration binding", () => {
  test("view and pointer bursts publish bounded latest-state presence", async () => {
    const { runtime, reports } = fixture();
    const initialCount = reports.length;
    for (let index = 0; index < 200; index++) {
      runtime.binding.reportView({ address: { page: "index.html" }, detail: { scroll: { x: 0, y: index } } }, "local-input");
      runtime.binding.reportPointer({ x: 20, y: index });
    }
    expect(reports.length - initialCount).toBeLessThanOrEqual(1);
    await Bun.sleep(60);
    expect(reports.length - initialCount).toBeLessThanOrEqual(2);
    expect(reports.at(-1)?.semanticView.detail).toEqual({ scroll: { x: 0, y: 199 } });
    expect(reports.at(-1)?.semanticPointer).toEqual({ x: 20, y: 199 });
    runtime.dispose();
  });
  test.each(["disconnect", "unregister", "dispose"] as const)("%s cancels pending presence from that lifecycle", async (end) => {
    const { runtime, reports } = fixture();
    const unregister = runtime.binding.register({ applyView: async () => ({ success: true }), projectPointer: () => ({ status: "unresolved" }), projectAnchor: () => ({ status: "unresolved" }) });
    runtime.binding.reportView(view("pending.html"), "local-input");
    const before = reports.length;
    if (end === "disconnect") runtime.update(2, false, [], []);
    else if (end === "unregister") unregister();
    else runtime.dispose();
    await Bun.sleep(60);
    expect(reports).toHaveLength(before);
    runtime.dispose();
  });
  test("revision changes and reconnect publish the latest complete state in the current scope", async () => {
    const { runtime, reports } = fixture();
    runtime.binding.reportView(view("superseded.html"), "local-input");
    runtime.update(3, false, [], []);
    runtime.binding.reportView(view("current.html"), "content-refresh");
    runtime.binding.reportPointer({ x: 7, y: 8 });
    await Bun.sleep(60);
    expect(reports).toHaveLength(1);
    runtime.update(3, true, [], []);
    expect(reports.at(-1)).toEqual({ revision: 3, semanticView: view("current.html"), semanticPointer: { x: 7, y: 8 }, followingId: null });
    await Bun.sleep(60);
    expect(reports).toHaveLength(2);
    runtime.dispose();
  });
  test("follow reports retain the actual applied view without echo; stop and pointer publication use it", async () => {
    const { runtime, reports, applications } = fixture();
    runtime.update(2, true, [peer(2, "leader.html")], []);
    runtime.setFollowing("peer");
    const before = reports.length;
    const actual: ViewerViewState = { address: { page: "leader.html", selector: "#section" }, detail: { scroll: { x: 0, y: 420 } } };
    runtime.binding.reportView(actual, "follow");
    expect(reports).toHaveLength(before);
    applications[0]!.finish(); await tick();
    expect(reports).toHaveLength(before);
    runtime.binding.reportPointer({ selector: "#section" });
    await Bun.sleep(60);
    expect(reports.at(-1)?.semanticView).toEqual(actual);
    expect(reports.at(-1)?.followingId).toBe("peer");
    runtime.setFollowing(null);
    await Bun.sleep(60);
    expect(reports.at(-1)?.semanticView).toEqual(actual);
    expect(reports.at(-1)?.followingId).toBeNull(); runtime.dispose();
  });
  test("successful apply can track the leader when an adapter has no more detailed follow report", async () => {
    const { runtime, reports, applications } = fixture();
    runtime.update(2, true, [peer(2, "leader.html")], []);
    runtime.setFollowing("peer"); applications[0]!.finish(); await tick(); runtime.setFollowing(null); await Bun.sleep(60);
    expect(reports.at(-1)?.semanticView.address.page).toBe("leader.html"); runtime.dispose();
  });
  test("matching revisions follow; local input aborts follow and follow reports never echo", async () => {
    const { runtime, reports, applications } = fixture();
    runtime.setFollowing("peer");
    expect(applications).toHaveLength(1);
    const count = reports.length;
    runtime.binding.reportView(view("index.html"), "follow");
    expect(reports).toHaveLength(count);
    runtime.binding.reportView(view("about.html"), "local-input");
    expect(applications[0]!.signal.aborted).toBe(true);
    expect(runtime.current().followingId).toBeNull();
    await Bun.sleep(60);
    expect(reports.at(-1)?.semanticView.address.page).toBe("about.html");
    applications[0]!.finish(); await tick();
    expect(runtime.current().followingId).toBeNull(); runtime.dispose();
  });
  test("a peer on another publication cannot move the viewer", () => {
    const { runtime, applications } = fixture();
    runtime.update(2, true, [peer(1)], []); runtime.setFollowing("peer");
    expect(applications).toHaveLength(0);
    expect(runtime.current().error).toContain("published revision"); runtime.dispose();
  });
  test("new peer state and unregister cancel the previous mount generation", async () => {
    const { runtime, applications } = fixture();
    runtime.setFollowing("peer");
    runtime.update(2, true, [peer(2, "about.html")], []);
    expect(applications[0]!.signal.aborted).toBe(true);
    expect(applications).toHaveLength(2);
    const unbind = runtime.binding.register({ applyView: async () => ({ success: true }), projectPointer: () => ({ status: "unresolved" }), projectAnchor: () => ({ status: "unresolved" }) });
    expect(applications[1]!.signal.aborted).toBe(true); unbind();
    applications[1]!.finish(); await tick();
    expect(runtime.current().ready).toBe(false); runtime.dispose();
  });
  test("missing declared hooks are visibly unavailable", () => {
    const { runtime } = fixture(); runtime.binding.register({});
    expect(runtime.current().ready).toBe(false);
    expect(runtime.current().error).toContain("applyView"); runtime.dispose();
  });
  test("projection invalidation aborts stale asynchronous coordinates", async () => {
    const { runtime } = fixture();
    const pending: Array<{ signal?: AbortSignal; resolve: (value: { status: "visible"; x: number; y: number }) => void }> = [];
    runtime.binding.register({ applyView: async () => ({ success: true }), projectAnchor: () => ({ status: "unresolved" }), projectPointer: (_point, signal) => new Promise((resolve) => pending.push({ signal, resolve })) });
    runtime.binding.invalidateProjection();
    expect(pending[0]!.signal?.aborted).toBe(true);
    pending[1]!.resolve({ status: "visible", x: 100, y: 200 }); await tick();
    pending[0]!.resolve({ status: "visible", x: 1, y: 2 }); await tick();
    expect(runtime.current().pointers.peer).toEqual({ status: "visible", x: 100, y: 200 }); runtime.dispose();
  });
  test("a stale comment fails without calling navigation", async () => {
    const { runtime, applications } = fixture();
    const result = await runtime.navigateAnchor({ revision: 1, address: { selector: "#headline" }, x: 0, y: 0 });
    expect(result.success).toBe(false); expect(applications).toHaveLength(0); runtime.dispose();
  });
  test("private bindings cannot follow, locate or publish a different content set", async () => {
    const reports: ViewerPresenceReport[] = [];
    const applied: ViewerViewState[] = [];
    const runtime = new ViewerCollaborationRuntime("private-mount", declaration, { address: { contentSet: "shared", page: "index.html" } }, (report) => reports.push(report), { contentSet: "shared" });
    runtime.binding.register({ applyView: async (view) => { applied.push(view); return { success: true }; }, projectPointer: () => ({ status: "unresolved" }), projectAnchor: () => ({ status: "unresolved" }) });
    runtime.update(2, true, [{ ...peer(2), view: { address: { contentSet: "private", page: "index.html" } } }], []);
    const count = reports.length;
    runtime.binding.reportView({ address: { contentSet: "private", page: "index.html" } }, "local-input");
    expect(reports).toHaveLength(count);
    runtime.setFollowing("peer");
    expect(applied).toHaveLength(0);
    expect(runtime.current().error).toContain("outside the published");
    expect((await runtime.navigateAnchor({ revision: 2, address: { contentSet: "private", page: "index.html" }, x: 0, y: 0 })).success).toBe(false);
    expect(applied).toHaveLength(0); runtime.dispose();
  });
});

describe("public viewer boundaries", () => {
  test("remote Sources and FileChannel refuse writes, deletes and object mutation", async () => {
    const { sources, fileChannel } = publishedSources({ schema: "site-v1", sources: { site: { title: "Published" }, files: [{ path: "index.html", content: "Public only" }] }, entryAddress: { page: "index.html" } });
    expect(Object.isFrozen(sources.site!.current())).toBe(true);
    expect(fileChannel.snapshot()).toEqual([{ path: "index.html", content: "Public only" }]);
    await expect(sources.site!.write({ title: "Changed" })).rejects.toThrow("read only");
    await expect(fileChannel.write("index.html", "Changed")).rejects.toThrow("cannot write");
    await expect(fileChannel.delete("index.html")).rejects.toThrow("cannot delete");
  });
  test("resource URLs encode raw filenames, preserve directories and refuse grant escape", () => {
    const resolve = publicResourceResolver("/projects/p/rooms/r/revisions/2/grant/site/index.html", "site/index.html", "https://host.test/projects/p");
    expect(resolve("site/")).toBe("https://host.test/projects/p/rooms/r/revisions/2/grant/site/");
    expect(resolve("site/about#2026?draft%.html")).toBe("https://host.test/projects/p/rooms/r/revisions/2/grant/site/about%232026%3Fdraft%25.html");
    expect(resolve("site/image assets/")).toBe("https://host.test/projects/p/rooms/r/revisions/2/grant/site/image%20assets/");
    expect(() => resolve("../private/history.json")).toThrow("outside");
    expect(new URL(resolve("https://attacker.test/site")).origin).toBe("https://host.test");
  });
  test("publication updates commit every Source before notifying a subscriber", () => {
    const channels = publishedSources({ schema: "site-v1", sources: { site: { title: "Old" }, files: [{ path: "old.html", content: "" }] }, entryAddress: {} });
    let observed: unknown;
    channels.sources.site!.subscribe(() => { observed = { site: channels.sources.site!.current(), files: channels.fileChannel.snapshot() }; });
    channels.update({ schema: "site-v1", sources: { site: { title: "New" }, files: [{ path: "new.html", content: "" }] }, entryAddress: {} });
    expect(observed).toEqual({ site: { title: "New" }, files: [{ path: "new.html", content: "" }] });
  });
  test("viewer build matching rejects every incompatible stamp", () => {
    const compatibility = { coreVersion: "3.57.3", modeVersion: "1.9.0", viewerHash: "sha", publicationSchema: "site-v1" };
    const room = { id: "r", title: "Site", mode: "webcraft", ownerId: "owner", enabled: true, revision: 1, page: "index.html", updatedAt: 1, compatibility };
    const asset = { mode: "webcraft", ...compatibility, entry: "/viewer/module.js", styles: [] };
    expect(matchViewerAsset(room, { coreVersion: "3.57.3", modes: [asset] })).toEqual(asset);
    for (const key of ["coreVersion", "modeVersion", "viewerHash", "publicationSchema"] as const) expect(() => matchViewerAsset({ ...room, compatibility: { ...compatibility, [key]: "wrong" } }, { coreVersion: "3.57.3", modes: [asset] })).toThrow();
  });
  test("Project paths isolate credentials and survive member/guest links", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const first = readCredentials("https://host.test/projects/one/#token=member-one", storage);
    expect(first.baseUrl).toBe("https://host.test/projects/one");
    expect(readCredentials("https://host.test/projects/two/", storage).token).toBe("");
    expect(readCredentials(first.cleanUrl, storage).token).toBe("member-one");
    expect(shareUrl("guest", "room", { publicOrigin: "https://host.test/projects/one", invitation: true })).toContain("/projects/one#invite=guest&room=room");
  });
});
