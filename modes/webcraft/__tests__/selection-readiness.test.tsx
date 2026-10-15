import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WebPreview from "../viewer/WebPreview.js";
import { publishedSources } from "../../../src/collaboration/published-sources.js";
import type { ViewerActionResult, ViewerSelectionContext } from "../../../core/types/viewer-contract.js";
import { buildSelectionScript } from "../../../core/iframe-selection/index.js";

let root: Root; let host: Window; let page: Window; let restore: () => void;
beforeEach(() => {
  host = new Window({ url: "http://host/viewer", settings: { disableIframePageLoading: true } });
  page = new Window({ url: "http://host/content/site/index.html" });
  page.document.write('<html><body><h1 id="heading">Selectable heading</h1></body></html>'); page.document.close();
  page.HTMLElement.prototype.scrollIntoView = () => {};
  const globals = globalThis as unknown as Record<string, unknown>; const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "MouseEvent", "ResizeObserver"]) { saved.set(key, globals[key]); globals[key] = key === "window" ? host : (host as unknown as Record<string, unknown>)[key]; }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  const element = host.document.createElement("div"); host.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); await host.happyDOM.close(); await page.happyDOM.close(); restore(); });
async function mount(opaque: boolean, navigating = false, mode: "view" | "select" | "annotate" | "edit" = "select", commentEnabled?: boolean, latched = false) {
  const arrivals: ViewerActionResult[] = [];
  const received: ViewerSelectionContext[] = [];
  const commands: Record<string, unknown>[] = [];
  const commentPicks: ViewerSelectionContext[] = [];
  const modeChanges: string[] = [];
  const projection = { schema: "webcraft-public-v1", entryAddress: { contentSet: "site", page: "index.html" }, sources: { site: { byContentSet: { site: { pages: [{ file: "index.html", title: "Home" }, { file: "second.html", title: "Second" }] } } }, files: [{ path: "site/index.html", content: "<h1>Selectable heading</h1>" }, { path: "site/second.html", content: "<h1>Second page</h1>" }] } };
  const channels = publishedSources(projection);
  const render = (currentMode: typeof mode) => <WebPreview selection={null} imageVersion={1} theme="dark" locale="en" sources={channels.sources} fileChannel={channels.fileChannel} permissions={{ editContent: currentMode === "edit", notifyAgent: currentMode === "annotate", export: false }} commenting={commentEnabled === undefined ? undefined : { enabled: commentEnabled, active: latched, onSelect: (selection) => commentPicks.push(selection) }} onPreviewModeChange={(mode) => modeChanges.push(mode)} activeContentSet="site" activeFile="index.html" mode={currentMode} navigateRequest={navigating ? { label: "Pinned heading", address: { contentSet: "site", page: "index.html", selector: "#heading" } } : undefined} onNavigateComplete={(result) => arrivals.push(result ?? { success: true })} readonly={false} editing={false} onSelect={(selection) => { if (selection) received.push(selection); }} resolveResourceUrl={(path) => `http://host/content/${path}`}/>;
  await act(async () => root.render(render(mode)));
  const frame = host.document.querySelector("iframe")!;
  const frameWindow = opaque ? { get location() { throw new Error("Opaque document"); }, postMessage: (command: Record<string, unknown>) => commands.push(command) } : page;
  if (!opaque) page.postMessage = (command) => { commands.push(command as Record<string, unknown>); };
  Object.defineProperty(frame, "contentWindow", { configurable: true, value: frameWindow });
  const send = (message: Record<string, unknown>) => host.dispatchEvent(new host.MessageEvent("message", { source: frameWindow as never, data: message }));
  const load = async (nonce: string, href = "http://host/content/site/index.html") => {
    await act(async () => frame.dispatchEvent(new host.Event("load")));
    const hello = commands.filter((command) => command.type === "hello").at(-1)!;
    await act(async () => send({ channel: "pneuma-webcraft-page", type: "ready", helloId: hello.helloId, nonce, href }));
  };
  const select = async (doc: string, intent?: string, tool?: string) => { await act(async () => send({ type: "pneuma:select", doc, intent, tool, selection: { type: "element", content: "Selectable heading", selector: "#heading", label: "Heading", tag: "h1", rect: { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 } } })); };
  return { frame, commands, received, send, load, select, arrivals, commentPicks, modeChanges, rerender: async (nextMode: typeof mode) => { await act(async () => root.render(render(nextMode))); } };
}

describe("Webcraft document selection readiness", () => {
  test("opaque pages stay busy and reject early selection until the native load and matching handshake", async () => {
    const f = await mount(true);
    expect(f.frame.getAttribute("aria-busy")).toBe("true"); expect(f.frame.style.pointerEvents).toBe("none");
    expect(host.document.body.textContent).toContain("Preparing page interactions");
    await f.select("early"); expect(f.received).toHaveLength(0);
    await act(async () => f.send({ channel: "pneuma-webcraft-page", type: "ready", helloId: 1, nonce: "premature", href: "http://host/content/site/index.html" }));
    expect(f.frame.getAttribute("aria-busy")).toBe("true");
    await f.load("verified-public-document");
    expect(f.frame.hasAttribute("aria-busy")).toBe(false); expect(f.frame.style.pointerEvents).toBe("auto");
    expect(f.commands.filter((command) => command.type === "pneuma:selectMode").at(-1)).toEqual({ type: "pneuma:selectMode", tool: "select", enabled: true, doc: "verified-public-document" });
    await f.select("verified-public-document"); expect(f.received).toHaveLength(1);
    expect(f.received[0]!.address).toEqual({ contentSet: "site", page: "index.html", selector: "#heading", query: "", hash: "" });
    await f.select("departed-document"); expect(f.received).toHaveLength(1);
  });
  test("same-origin selection uses its private edit document ID instead of the bridge nonce", async () => {
    const f = await mount(false); await f.load("bridge-nonce");
    const selectionCommand = f.commands.filter((command) => command.type === "pneuma:selectMode").at(-1)!;
    expect(selectionCommand.enabled).toBe(true); expect(selectionCommand.doc).toBe("1");
    await f.select("bridge-nonce"); expect(f.received).toHaveLength(0);
    await f.select("1"); expect(f.received).toHaveLength(1);
  });
  test("opaque page departure blocks interaction and rejects stale selections from the same WindowProxy", async () => {
    const f = await mount(true); await f.load("first-document"); await f.select("first-document");
    await act(async () => f.send({ channel: "pneuma-webcraft-page", type: "leaving", nonce: "first-document" }));
    expect(f.frame.getAttribute("aria-busy")).toBe("true"); expect(f.frame.style.pointerEvents).toBe("none");
    await f.select("first-document"); expect(f.received).toHaveLength(1);
    await f.load("second-document", "http://host/content/site/second.html");
    await f.select("first-document"); expect(f.received).toHaveLength(1);
    await f.select("second-document"); expect(f.received).toHaveLength(2); expect(f.received[1]!.address?.page).toBe("second.html");
  });
  test("a native opaque load retires the previous selection before its delayed departure arrives", async () => {
    const f = await mount(true); await f.load("first-document"); await f.select("first-document");
    await act(async () => f.frame.dispatchEvent(new host.Event("load")));
    const hello = f.commands.filter((command) => command.type === "hello").at(-1)!;
    expect(f.frame.getAttribute("aria-busy")).toBe("true");
    await f.select("first-document"); expect(f.received).toHaveLength(1);
    await act(async () => f.send({ channel: "pneuma-webcraft-page", type: "leaving", nonce: "first-document" }));
    await act(async () => f.send({ channel: "pneuma-webcraft-page", type: "ready", helloId: hello.helloId, nonce: "second-document", href: "http://host/content/site/index.html" }));
    expect(f.frame.hasAttribute("aria-busy")).toBe(false);
    await f.select("second-document"); expect(f.received).toHaveLength(2);
  });
  test("a pending pinned selector completes only after verified readiness and its page acknowledgement", async () => {
    const f = await mount(true, true);
    expect(f.arrivals).toHaveLength(0);
    await f.load("verified-pinned-document");
    const navigation = f.commands.find((command) => command.type === "navigate")!;
    expect(navigation.address).toEqual({ contentSet: "site", page: "index.html", selector: "#heading" });
    expect(f.arrivals).toHaveLength(0);
    await act(async () => f.send({ channel: "pneuma-webcraft-page", type: "result", nonce: "verified-pinned-document", requestId: navigation.requestId, result: { success: true } }));
    expect(f.arrivals).toEqual([{ success: true }]);
  });
  test("a known foreign page remains viewable without an interaction-loading overlay", async () => {
    const f = await mount(false, false, "view");
    page.location.href = "http://other/foreign.html";
    await act(async () => f.frame.dispatchEvent(new host.Event("load")));
    expect(f.frame.hasAttribute("aria-busy")).toBe(false); expect(f.frame.style.pointerEvents).toBe("auto");
    expect(host.document.body.textContent).not.toContain("Preparing page interactions");
    const back = [...host.document.querySelectorAll("button")].find((button) => button.textContent === "Back to index.html")!;
    expect(back).toBeDefined();
    await act(async () => back.click());
    expect(f.frame.getAttribute("aria-busy")).toBe("true"); expect(f.frame.style.pointerEvents).toBe("none");
    expect(host.document.body.textContent).toContain("Preparing page interactions");
  });
  test("an opaque ready outside the site becomes unavailable and Return to site starts a new busy generation", async () => {
    const f = await mount(true); await f.load("foreign-document", "http://outside/foreign.html");
    expect(f.frame.hasAttribute("aria-busy")).toBe(false); expect(f.frame.style.pointerEvents).toBe("none");
    expect(host.document.body.textContent).toContain("Page interactions unavailable");
    expect(host.document.body.textContent).not.toContain("Preparing page interactions");
    await f.select("foreign-document"); expect(f.received).toHaveLength(0);
    const back = [...host.document.querySelectorAll("button")].find((button) => button.textContent === "Back to index.html")!;
    await act(async () => back.click());
    expect(f.frame.getAttribute("aria-busy")).toBe("true"); expect(host.document.body.textContent).toContain("Preparing page interactions");
    expect(host.document.body.textContent).not.toContain("Page interactions unavailable");
  });
  test("shared selection scripts echo an optional document tag while legacy consumers remain usable", () => {
    const messages: Record<string, unknown>[] = []; Object.defineProperty(page, "parent", { value: { postMessage: (message: Record<string, unknown>) => messages.push(message) } });
    page.eval(buildSelectionScript().replace(/^<script>\s*/, "").replace(/<\/script>$/, ""));
    page.dispatchEvent(new page.MessageEvent("message", { data: { type: "pneuma:selectMode", enabled: true, doc: "private-document-7" } }));
    page.document.querySelector("h1")!.dispatchEvent(new page.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(messages.at(-1)?.doc).toBe("private-document-7");
    page.dispatchEvent(new page.MessageEvent("message", { data: { type: "pneuma:selectMode", enabled: true } }));
    page.document.querySelector("h1")!.dispatchEvent(new page.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(messages.at(-1)?.type).toBe("pneuma:select"); expect(messages.at(-1)?.doc).toBeNull();
  });
});


describe("Webcraft comment interaction boundary", () => {
  test("comment intent opens its dedicated draft callback without Agent selection or annotation", async () => {
    const f = await mount(true, false, "annotate", true); await f.load("comment-page");
    await f.select("comment-page", "comment");
    expect(f.commentPicks).toHaveLength(1); expect(f.received).toHaveLength(0);
    expect(f.commentPicks[0]!.address).toEqual({ contentSet: "site", page: "index.html", selector: "#heading", query: "", hash: "" });
    expect(host.document.body.textContent).not.toContain("Add annotation"); expect(f.modeChanges).toHaveLength(0);
    await f.select("old-document", "comment"); expect(f.commentPicks).toHaveLength(1);
  });
  test("denied comment capability rejects forged comment intent while ordinary selection remains usable", async () => {
    const f = await mount(true, false, "select", false); await f.load("reader-page");
    await f.select("reader-page", "comment"); expect(f.commentPicks).toHaveLength(0); expect(f.received).toHaveLength(0);
    await f.select("reader-page"); expect(f.received).toHaveLength(1);
  });
  test("Control temporarily suspends edit mode and release restores it without requesting a mode change", async () => {
    const f = await mount(false, false, "edit", true); await f.load("bridge-page");
    const key = async (name: string, type: string, ctrlKey: boolean) => { await act(async () => host.document.body.dispatchEvent(new host.KeyboardEvent(type, { key: name, ctrlKey, bubbles: true, cancelable: true }))); };
    await key("Control", "keydown", true);
    expect(f.commands.filter((c) => c.type === "pneuma:commentControl").at(-1)).toMatchObject({ doc: "1", pressed: true });
    expect(f.commands.filter((c) => c.type === "pneuma:editMode").at(-1)?.enabled).toBe(false);
    await key("Control", "keyup", false);
    expect(f.commands.filter((c) => c.type === "pneuma:editMode").at(-1)?.enabled).toBe(true);
    expect(f.modeChanges).toHaveLength(0);
  });
  test("Control shortcuts are not prevented and iframe departure clears temporary authoring suspension", async () => {
    const f = await mount(false, false, "edit", true); await f.load("bridge-page");
    await act(async () => { host.document.body.dispatchEvent(new host.KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true })); });
    const copy = new host.KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { host.document.body.dispatchEvent(copy); });
    expect(copy.defaultPrevented).toBe(false); expect(f.commands.filter((c) => c.type === "pneuma:editMode").at(-1)?.enabled).toBe(true);
    await act(async () => { host.document.body.dispatchEvent(new host.KeyboardEvent("keyup", { key: "Control", bubbles: true })); f.send({ type: "pneuma:commentShortcut", doc: "1", pressed: true }); });
    await act(async () => { f.send({ channel: "pneuma-webcraft-page", nonce: "bridge-page", type: "leaving" }); });
    await f.select("1", "comment"); expect(f.commentPicks).toHaveLength(0);
    expect(f.modeChanges).toHaveLength(0);
  });
});


test("same-origin fine navigation highlights its addressed element without selecting it", async () => {
  const f = await mount(false, true, "view"); await f.load("same-origin-page");
  expect(f.arrivals).toEqual([{ success: true }]);
  expect(f.commands.find((command) => command.type === "pneuma:navigationHighlight")).toMatchObject({ doc: "1", selector: "#heading" });
  expect(f.received).toHaveLength(0);
});

test("focus entering the viewer iframe does not queue a stale Control release, while real window blur does", async () => {
  const f = await mount(false, false, "edit", true); await f.load("bridge-page");
  let focused = true;
  host.document.hasFocus = () => focused;
  await act(async () => host.document.body.dispatchEvent(new host.KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true })));
  const controlsBefore = f.commands.filter((command) => command.type === "pneuma:commentControl").length;
  await act(async () => { f.frame.focus(); host.dispatchEvent(new host.Event("blur")); });
  expect(host.document.activeElement).toBe(f.frame);
  expect(f.commands.filter((command) => command.type === "pneuma:commentControl")).toHaveLength(controlsBefore);
  // The child's next keydown is newer than the parent focus transfer. There
  // must be no queued parent:false message that can overwrite that press.
  await act(async () => f.send({ type: "pneuma:commentShortcut", doc: "1", pressed: true }));
  expect(f.commands.filter((command) => command.type === "pneuma:editMode").at(-1)?.enabled).toBe(false);
  focused = false;
  await act(async () => host.dispatchEvent(new host.Event("blur")));
  expect(f.commands.filter((command) => command.type === "pneuma:commentControl").at(-1)).toMatchObject({ doc: "1", pressed: false });
  expect(f.commands.filter((command) => command.type === "pneuma:editMode").at(-1)?.enabled).toBe(true);
  expect(f.modeChanges).toHaveLength(0);
});


for (const [before, after] of [["select", "annotate"], ["annotate", "select"]] as const) test(`ordinary ${before} to ${after} sends a fresh selection tool identity`, async () => {
  const f = await mount(false, false, before); await f.load("bridge-page");
  const count = f.commands.filter((command) => command.type === "pneuma:selectMode").length;
  await f.rerender(after);
  const configurations = f.commands.filter((command) => command.type === "pneuma:selectMode");
  expect(configurations.length).toBeGreaterThan(count);
  expect(configurations.at(-1)).toMatchObject({ enabled: true, doc: "1", tool: after });
  expect(f.modeChanges).toHaveLength(0);
});


for (const [before, after] of [["select", "annotate"], ["annotate", "select"]] as const) test(`an already posted ${before} reply cannot be consumed after switching to ${after}`, async () => {
  const f = await mount(false, false, before); await f.load("bridge-page");
  await f.rerender(after);
  // The old document may have posted this before it saw the tool update.
  await f.select("1", undefined, before);
  expect(f.received).toHaveLength(0);
  expect(host.document.querySelector('input[placeholder="Add comment (optional)..."]')).toBeNull();
  await f.select("1", undefined, after);
  if (after === "select") expect(f.received).toHaveLength(1);
  else expect(host.document.querySelector('input[placeholder="Add comment (optional)..."]')).not.toBeNull();
});

test("inline editing identifies its generated fields and preserves authored editability on restoration", async () => {
  page.document.body.insertAdjacentHTML("beforeend", '<p id="authored" contenteditable="true">Authored editor</p><div contenteditable="true"><p id="authored-child">Nested editor</p></div><p id="locked" contenteditable="false">Locked text</p>');
  const f = await mount(false, false, "edit", true); await f.load("bridge-page");
  // Happy DOM does not run the dynamically injected preview scripts. Execute
  // the actual instrumented selection script before delivering its commands.
  const script = [...page.document.querySelectorAll("script[data-pneuma-preview]")].find((node) => node.textContent.includes("var editSaved"));
  expect(script).toBeDefined();
  page.eval(script!.textContent);
  const command = (enabled: boolean) => page.dispatchEvent(new page.MessageEvent("message", { data: { type: "pneuma:editMode", enabled } }));
  command(true);
  expect(page.document.getElementById("heading")!.getAttribute("data-pneuma-inline-edit")).toBe("");
  expect(page.document.getElementById("heading")!.getAttribute("contenteditable")).toBe("true");
  expect(page.document.getElementById("authored")!.hasAttribute("data-pneuma-inline-edit")).toBe(false);
  expect(page.document.getElementById("authored-child")!.hasAttribute("contenteditable")).toBe(false);
  expect(page.document.getElementById("locked")!.getAttribute("contenteditable")).toBe("false");
  command(false);
  expect(page.document.getElementById("heading")!.hasAttribute("data-pneuma-inline-edit")).toBe(false);
  expect(page.document.getElementById("heading")!.hasAttribute("contenteditable")).toBe(false);
  expect(page.document.getElementById("authored")!.getAttribute("contenteditable")).toBe("true");
  expect(page.document.getElementById("locked")!.getAttribute("contenteditable")).toBe("false");
});
