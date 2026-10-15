import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { SECTION_THUMBNAIL } from "../iframe-selection/sections/thumbnail.js";
import { COMMENT_PREVIEW_LIMITS } from "../collaboration/comment-preview.js";
import { buildSelectionScript } from "../iframe-selection/index.js";

const pages: Window[] = [];
afterEach(async () => { for (const page of pages.splice(0)) await page.happyDOM.close(); });
function fixture(tainted = false) {
  const page = new Window({ url: "https://host.test/site/index.html" }); pages.push(page);
  page.document.write('<html><body><picture><source srcset="alternate.png"><img src="photo.png" alt="Photo"></picture><h2>Heading</h2></body></html>'); page.document.close();
  const image = page.document.querySelector("img")!;
  Object.defineProperties(image, { complete: { value: true, configurable: true }, naturalWidth: { value: 1600 }, naturalHeight: { value: 900 }, currentSrc: { value: "https://host.test/site/alternate.png" } });
  image.getBoundingClientRect = () => new page.DOMRect(0, 0, 800, 450);
  const calls: { source: unknown; width: number; height: number }[] = [];
  const create = page.document.createElement.bind(page.document);
  page.document.createElement = ((tag: string) => {
    if (tag !== "canvas") return create(tag);
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (source: unknown) => { calls.push({ source, width: canvas.width, height: canvas.height }); } }), toDataURL: () => { if (tainted && calls.at(-1)?.source === image) throw new Error("Tainted canvas"); return "data:image/png;base64,aGVsbG8="; } };
    return canvas;
  }) as typeof page.document.createElement;
  const reloads: Array<{ crossOrigin: string; src: string; onload: (() => void) | null; onerror: (() => void) | null; complete: boolean; naturalWidth: number; naturalHeight: number }> = [];
  Object.defineProperty(page, "Image", { value: function() { const reload = { crossOrigin: "", src: "", onload: null, onerror: null, complete: true, naturalWidth: 1600, naturalHeight: 900 }; reloads.push(reload); return reload; } });
  page.eval(SECTION_THUMBNAIL);
  const capture = (element: unknown = image, signal?: AbortSignal): string | null | Promise<string | null> => (page as unknown as { captureElementThumbnail(el: unknown, signal?: AbortSignal): string | null | Promise<string | null> }).captureElementThumbnail(element, signal);
  return { page, image, calls, reloads, capture };
}

function interactionFixture() {
  const f = fixture(true);
  const messages: Array<{ type: string; doc?: string; intent?: string; tool?: string; selection?: { selector: string; thumbnail: string | null } }> = [];
  f.page.postMessage = (message) => messages.push(message as typeof messages[number]);
  f.page.eval(buildSelectionScript().replace(/^<script>\s*/, "").replace(/<\/script>$/, ""));
  const configure = (allowed = true, doc = "current", base = false, latched = false, tool?: string) => f.page.dispatchEvent(new f.page.MessageEvent("message", { data: { type: "pneuma:selectMode", doc, enabled: base, tool, commenting: { enabled: allowed, active: latched } } }));
  configure();
  const pick = (target = f.image) => target.dispatchEvent(new f.page.MouseEvent("pointerdown", { ctrlKey: true, button: 0, bubbles: true, cancelable: true }));
  const key = (name: string, type = "keydown") => f.page.document.body.dispatchEvent(new f.page.KeyboardEvent(type, { key: name, ctrlKey: type === "keydown", bubbles: true }));
  const picks = () => messages.filter((message) => message.type === "pneuma:select");
  return { ...f, configure, pick, key, picks };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("shared selected-image thumbnails", () => {
  test("loaded images and picture wrappers produce self-contained bounded raster data", () => {
    const f = fixture();
    expect(f.capture()).toBe("data:image/png;base64,aGVsbG8=");
    expect(f.calls[0]).toMatchObject({ width: 320, height: 180 });
    expect(f.capture(f.page.document.querySelector("picture"))).toBe("data:image/png;base64,aGVsbG8=");
    expect(f.reloads).toHaveLength(0);
  });
  test("opaque images retry the exact displayed source anonymously and settle once with raster pixels", async () => {
    const f = fixture(true);
    const result = f.capture();
    expect(typeof (result as Promise<string | null>)?.then).toBe("function");
    expect(f.reloads[0]?.crossOrigin).toBe("anonymous");
    expect(f.reloads[0]?.src).toBe("https://host.test/site/alternate.png");
    f.reloads[0]!.onload!();
    expect(await result).toBe("data:image/png;base64,aGVsbG8=");
    expect(f.reloads[0]!.onload).toBeNull();
    expect(f.reloads[0]!.onerror).toBeNull();
  });
  test("unloaded, denied and aborted captures return no misleading SVG image", async () => {
    const unloaded = fixture(); Object.defineProperty(unloaded.image, "complete", { value: false });
    expect(unloaded.capture()).toBeNull();
    expect(unloaded.reloads).toHaveLength(0);
    const denied = fixture(true); const failure = denied.capture(); denied.reloads[0]!.onerror!();
    expect(await failure).toBeNull();
    const aborted = fixture(true); const controller = new AbortController(); const result = aborted.capture(aborted.image, controller.signal); controller.abort();
    expect(await result).toBeNull(); expect(aborted.reloads[0]!.onload).toBeNull(); expect(aborted.reloads[0]!.src).toBe("");
  });
  test("image encodings that remain too large are omitted and text keeps its SVG path", async () => {
    const f = fixture(); const create = f.page.document.createElement.bind(f.page.document);
    f.page.document.createElement = ((tag: string) => tag !== "canvas" ? create(tag) : { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64," + "a".repeat(COMMENT_PREVIEW_LIMITS.thumbnail) }) as typeof f.page.document.createElement;
    const result = f.capture(); if (result && typeof result !== "string") f.reloads[0]!.onload!();
    expect(await result).toBeNull();
    const heading = f.page.document.querySelector("h2")!; heading.getBoundingClientRect = () => new f.page.DOMRect(0, 0, 200, 30);
    expect(f.capture(heading)).toStartWith("data:image/svg+xml;charset=utf-8,");
  });
  test("a CORS deadline settles without a preview and releases the pending image", async () => {
    const f = fixture(true);
    let expire: (() => void) | undefined;
    const setTimer = f.page.setTimeout.bind(f.page);
    f.page.setTimeout = ((callback: () => void, delay: number) => { if (delay === 2500) { expire = callback; return 1; } return setTimer(callback, delay); }) as typeof f.page.setTimeout;
    const result = f.capture();
    expect(expire).toBeDefined(); expire!();
    expect(await result).toBeNull(); expect(f.reloads[0]!.onload).toBeNull(); expect(f.reloads[0]!.src).toBe("");
  });
});

describe("asynchronous image selection lifecycle", () => {
  test("a completed Control click survives ordinary release and emits exactly once after readback", async () => {
    const f = interactionFixture(); f.key("Control"); f.pick();
    expect(f.picks()).toHaveLength(0);
    f.key("Control", "keyup");
    f.reloads[0]!.onload!(); await settle();
    expect(f.picks()).toHaveLength(1);
    expect(f.picks()[0]).toMatchObject({ doc: "current", intent: "comment", selection: { thumbnail: "data:image/png;base64,aGVsbG8=" } });
  });
  test("a later synchronous pick supersedes an image and cannot be replaced by late completion", async () => {
    const f = interactionFixture(); f.pick(); const late = f.reloads[0]!.onload!;
    f.pick(f.page.document.querySelector("h2") as typeof f.image); late(); await settle();
    expect(f.picks()).toHaveLength(1); expect(f.picks()[0]?.selection?.selector).toBe("h2");
    expect(f.reloads[0]!.src).toBe("");
  });
  test("Escape, revoked permission, changed document, explicit cancellation and departure discard pending captures", async () => {
    const cancel = [
      (f: ReturnType<typeof interactionFixture>) => f.key("Escape"),
      (f: ReturnType<typeof interactionFixture>) => f.configure(false),
      (f: ReturnType<typeof interactionFixture>) => f.configure(true, "replacement"),
      (f: ReturnType<typeof interactionFixture>) => f.page.dispatchEvent(new f.page.MessageEvent("message", { data: { type: "pneuma:clearHighlight" } })),
      (f: ReturnType<typeof interactionFixture>) => f.page.dispatchEvent(new f.page.Event("pagehide")),
    ];
    for (const perform of cancel) {
      const f = interactionFixture(); f.pick(); const late = f.reloads[0]!.onload!; perform(f); late(); await settle();
      expect(f.picks()).toHaveLength(0); expect(f.reloads[0]!.onload).toBeNull();
    }
    const latched = interactionFixture(); latched.configure(true, "current", false, true); latched.pick(); const late = latched.reloads[0]!.onload!; latched.configure(); late(); await settle(); expect(latched.picks()).toHaveLength(0);
  });
  test("a failed readback still emits its referenced selection without an image", async () => {
    const f = interactionFixture(); f.pick(); f.reloads[0]!.onerror!(); await settle();
    expect(f.picks()).toHaveLength(1); expect(f.picks()[0]?.selection?.thumbnail).toBeNull();
  });
});


for (const [before, after] of [["select", "annotate"], ["annotate", "select"]]) test(`delayed ordinary image capture cannot cross ${before} to ${after}`, async () => {
  const f = interactionFixture(); f.configure(true, "current", true, false, before);
  f.image.dispatchEvent(new f.page.MouseEvent("click", { bubbles: true, cancelable: true }));
  const late = f.reloads[0]!.onload!;
  expect(f.picks()).toHaveLength(0);
  const selected = f.page.document.querySelector('[data-pneuma-overlay]');
  expect(selected).not.toBeNull();
  f.configure(true, "current", true, false, after);
  late(); await settle();
  expect(f.picks()).toHaveLength(0);
  expect(f.page.document.querySelector('[data-pneuma-overlay]')).toBe(selected);
  f.page.document.querySelector("h2")!.dispatchEvent(new f.page.MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(f.picks()).toHaveLength(1); expect(f.picks()[0]?.selection?.selector).toBe("h2");
});


test("an ordinary delayed image reply carries the initiating tool identity", async () => {
  const f = interactionFixture(); f.configure(true, "current", true, false, "select");
  f.image.dispatchEvent(new f.page.MouseEvent("click", { bubbles: true, cancelable: true }));
  f.reloads[0]!.onload!(); await settle();
  expect(f.picks()).toHaveLength(1); expect(f.picks()[0]?.tool).toBe("select");
});
