import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CollaborationJsonObject, ViewerCollaborationAdapter, ViewerCollaborationBinding, ViewerViewState } from "../../../core/types/viewer-collaboration.js";
import { projectWebcraftPoint, WebcraftCollaborationController, webcraftView } from "../viewer/collaboration.js";
import { buildWebcraftPageRuntimeScript } from "../viewer/page-runtime.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

function setup(deferViewport = false, readyTimeoutMs = 5000) {
  const unavailable: string[] = [];
  const host = new Window({ url: "http://host/viewer" });
  const page = new Window({ url: "http://resources/site/index.html?q=1#headline", width: 1200, height: 800 });
  cleanup.push(() => host.happyDOM.close(), () => page.happyDOM.close());
  const original = globalThis.window;
  globalThis.window = host as unknown as typeof globalThis.window;
  cleanup.push(() => { globalThis.window = original; });
  page.document.write('<!doctype html><html><body><h1 id="headline">Hello</h1></body></html>');
  page.document.close();
  const headline = page.document.getElementById("headline")!;
  headline.getBoundingClientRect = () => new page.DOMRect(30, 50, 100, 80);
  Object.defineProperty(page, "parent", { value: host });
  host.postMessage = (message) => host.dispatchEvent(new host.MessageEvent("message", { source: page as never, data: structuredClone(message) }));
  page.postMessage = (message) => page.dispatchEvent(new page.MessageEvent("message", { source: host as never, data: message }));
  page.eval(buildWebcraftPageRuntimeScript());
  const frame = host.document.createElement("iframe");
  Object.defineProperty(frame, "contentWindow", { value: page });
  Object.defineProperty(frame, "clientWidth", { value: 1200 });
  Object.defineProperty(frame, "clientHeight", { value: 800 });
  frame.getBoundingClientRect = () => new host.DOMRect(100, 40, 600, 400);
  const overlay = host.document.createElement("div");
  overlay.getBoundingClientRect = () => new host.DOMRect(20, 10, 1000, 900);
  const reports: { view: ViewerViewState; cause: string }[] = [];
  const pointers: (CollaborationJsonObject | null)[] = [];
  let adapter: ViewerCollaborationAdapter | undefined;
  let disposals = 0;
  const binding: ViewerCollaborationBinding = { viewerInstanceId: "instance-1",
    register: (next) => { adapter = next; return () => { disposals++; }; },
    reportView: (view, cause) => reports.push({ view, cause }), reportPointer: (pointer) => pointers.push(pointer), invalidateProjection: () => {} };
  let viewport = "full";
  const controller: WebcraftCollaborationController = new WebcraftCollaborationController({ frame: () => frame as never, overlay: () => overlay as never,
    current: () => ({ contentSet: "site", page: "index.html", viewport, pages: ["index.html"] }),
    resourceUrl: (path) => `http://resources/${path}`,
    navigate: (address, signal) => controller.navigateAnchor(address, signal, "follow"),
    show: (_address, preset) => { if (!deferViewport) viewport = preset; }, navigating: () => {}, loaded: () => {}, unavailable: (message) => unavailable.push(message),
  }, binding, readyTimeoutMs);
  cleanup.push(() => controller.dispose());
  controller.frameLoaded(true);
  return { host, page, frame, controller, reports, pointers, unavailable, adapter: adapter!, disposals: () => disposals,
    renderViewport: (value: string) => { viewport = value; controller.frameLoaded(); } };
}

const view: ViewerViewState = { address: { contentSet: "site", page: "index.html" }, detail: { query: "?q=1", hash: "#headline", viewport: "full", scroll: { x: 0, y: 120 } } };

describe("normal Webcraft collaboration semantics", () => {
  test("layout cannot initiate readiness for a departing document, and native hello silence has an unavailable outcome", async () => {
    const f = setup(false, 20); const commands: Record<string, unknown>[] = [];
    f.page.postMessage = (message) => commands.push(message as Record<string, unknown>);
    f.controller.frameLeaving(); f.controller.frameLoaded();
    expect(commands).toHaveLength(0);
    f.controller.frameLoaded(true);
    expect(commands[0]?.type).toBe("hello"); expect(f.controller.pageHref).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.unavailable).toHaveLength(1); expect(f.unavailable[0]).toContain("interaction bridge");
    f.controller.frameLoaded(); expect(commands).toHaveLength(1);
  });
  test("a matching ready for a page outside the site fails visibly without enabling its identity", () => {
    const f = setup(); const commands: Record<string, unknown>[] = [];
    f.page.postMessage = (message) => commands.push(message as Record<string, unknown>);
    f.controller.frameLoaded(true);
    f.host.dispatchEvent(new f.host.MessageEvent("message", { source: f.page as never, data: { channel: "pneuma-webcraft-page", type: "ready", helloId: commands[0]!.helloId, nonce: "foreign-document", href: "http://outside/foreign.html" } }));
    expect(f.unavailable).toHaveLength(1); expect(f.unavailable[0]).toContain("outside the published site"); expect(f.controller.pageHref).toBeNull();
  });
  test("keeps query/hash and applies scroll only as follow, without private callbacks", async () => {
    const fixture = setup();
    fixture.reports.length = 0;
    const result = await fixture.adapter.applyView!(view, new AbortController().signal);
    expect(result.success).toBe(true);
    expect(fixture.page.scrollY).toBe(120);
    expect(fixture.page.location.search).toBe("?q=1");
    expect(fixture.page.location.hash).toBe("#headline");
    expect(fixture.reports.filter((report) => report.cause === "local-input")).toHaveLength(0);
    expect(fixture.reports.some((report) => report.cause === "follow")).toBe(true);
  });

  test("projects semantic selectors through scaled iframe and viewer overlay coordinates", async () => {
    const fixture = setup();
    expect(await fixture.adapter.projectAnchor!({ contentSet: "site", page: "index.html", selector: "#headline" })).toEqual({ status: "visible", x: 120, y: 75 });
    expect(await fixture.adapter.projectPointer!({ address: { contentSet: "site", page: "index.html", selector: "#headline" }, offsetX: 1, offsetY: 0 })).toEqual({ status: "visible", x: 145, y: 55 });
    expect(await fixture.adapter.projectAnchor!({ contentSet: "site", page: "index.html", selector: "#missing" })).toEqual({ status: "unresolved" });
    expect(await fixture.adapter.projectAnchor!({ contentSet: "other", page: "index.html", selector: "#headline" })).toEqual({ status: "unresolved" });
  });

  test("local input exits follow and disposal cancels a waiting load without a late acknowledgement", async () => {
    const fixture = setup();
    fixture.page.dispatchEvent(new fixture.page.WheelEvent("wheel"));
    expect(fixture.reports.at(-1)?.cause).toBe("local-input");
    const pending = fixture.adapter.applyView!({ ...view, detail: { ...view.detail, query: "?next=1" } }, new AbortController().signal);
    fixture.controller.dispose();
    expect((await pending).success).toBe(false);
    expect(fixture.disposals()).toBe(1);
    fixture.controller.dispose();
    expect(fixture.disposals()).toBe(1);
  });

  test("abort cancels one apply; malformed and unsupported semantic views fail visibly", async () => {
    const fixture = setup();
    const signal = new AbortController();
    const pending = fixture.adapter.applyView!({ ...view, detail: { ...view.detail, query: "?next=1" } }, signal.signal);
    signal.abort();
    expect((await pending).success).toBe(false);
    expect(webcraftView({ ...view, address: { page: "../private.html" } })).toBeNull();
    expect(webcraftView({ ...view, detail: { ...view.detail, viewport: "unknown" } })).toBeNull();
    expect(projectWebcraftPoint({ status: "visible", x: 2, y: 3 }, { clientWidth: 0, clientHeight: 10, getBoundingClientRect: () => fixture.frame.getBoundingClientRect() } as never, fixture.frame as never)).toEqual({ status: "unresolved" });
  });

  test("a preset change cannot acknowledge the previous iframe layout", async () => {
    const fixture = setup(true);
    let settled = false;
    const pending = fixture.adapter.applyView!({ ...view, detail: { ...view.detail, viewport: "mobile" } }, new AbortController().signal).then((result) => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    fixture.renderViewport("mobile");
    expect((await pending).success).toBe(true);
    expect(fixture.reports.at(-1)?.view.detail?.viewport).toBe("mobile");
  });

  test("selector navigation reports a missing object and preserves query and fragment", async () => {
    const fixture = setup();
    expect((await fixture.controller.navigateAnchor({ contentSet: "site", page: "index.html", selector: "#headline" })).success).toBe(true);
    expect((await fixture.controller.navigateAnchor({ contentSet: "site", page: "index.html", selector: "#missing" })).success).toBe(false);
    expect(fixture.page.location.search).toBe("?q=1");
    expect(fixture.page.location.hash).toBe("#headline");
  });

  test("address-only apply locates comment selectors and reports an unresolved object without follow echo", async () => {
    const fixture = setup();
    fixture.reports.length = 0;
    expect((await fixture.adapter.applyView!({ address: { contentSet: "site", page: "index.html", selector: "#headline" } }, new AbortController().signal)).success).toBe(true);
    expect((await fixture.adapter.applyView!({ address: { contentSet: "site", page: "index.html", selector: "#missing" } }, new AbortController().signal)).success).toBe(false);
    expect(fixture.reports.some((report) => report.cause === "local-input")).toBe(false);
  });

  test("the mode retains verified opaque URL query and hash changes for address-only navigation", async () => {
    const fixture = setup();
    fixture.page.location.hash = "#card";
    fixture.page.dispatchEvent(new fixture.page.Event("hashchange"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fixture.controller.pageHref).toBe("http://resources/site/index.html?q=1#card");
  });

  test("anchor and pointer projections reject another query while matching navigation's URL normalization", async () => {
    const fixture = setup();
    const address = { contentSet: "site", page: "index.html", selector: "#headline" };
    expect(await fixture.adapter.projectAnchor!({ ...address, query: "?q=2" })).toEqual({ status: "unresolved" });
    expect(await fixture.adapter.projectPointer!({ address: { ...address, query: "?q=2" }, offsetX: .5, offsetY: .5 })).toEqual({ status: "unresolved" });
    expect((await fixture.adapter.projectAnchor!({ ...address, query: "q=1", hash: "#other-fragment" })).status).toBe("visible");
    expect((await fixture.adapter.projectAnchor!({ ...address, query: "?q=1" })).status).toBe("visible");
    expect(await fixture.adapter.projectAnchor!({ ...address, query: "" })).toEqual({ status: "unresolved" });
    expect(await fixture.adapter.projectAnchor!({ ...address, query: 7 })).toEqual({ status: "unresolved" });
    fixture.page.history.replaceState(null, "", "?q=hello%20world#headline");
    expect((await fixture.adapter.projectAnchor!({ ...address, query: "q=hello world" })).status).toBe("visible");
  });

  test("semantic pointers retain the shown page's query and hash alongside its element selector", async () => {
    const fixture = setup();
    fixture.page.document.getElementById("headline")!.dispatchEvent(new fixture.page.MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 60 }));
    expect(fixture.pointers.at(-1)?.address).toEqual({ contentSet: "site", page: "index.html", selector: "#headline", query: "?q=1", hash: "#headline" });
  });
});
