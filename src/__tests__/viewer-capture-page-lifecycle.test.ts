/**
 * Capturing a same-origin iframe page while that page is loading, being
 * replaced, or sitting in a background tab (`src/utils/viewer-capture.ts`).
 *
 * The 2026-09 webcraft trial saw `capture` time out after 60 s again and
 * again. Two causes, both reproduced in Chrome:
 *
 * 1. snapdom runs inside the iframe's own window. An agent edits a file and
 *    captures straight away; the edit lands a moment later, the viewer
 *    reloads the page, and the old window is discarded with snapdom's
 *    promises still pending. They never settle, so neither did the capture.
 * 2. In a background tab Chrome throttles chained timers — after five
 *    minutes hidden, to one wake-up per minute. The capture's scroll-reveal
 *    priming (a chain of 70 ms sleeps) and the snapdom injection (a 100 ms
 *    poll) took minutes there.
 *
 * Plus the ordering the webcraft page loader now relies on: an iframe marked
 * `aria-busy="true"` is still loading its page and is not shot yet.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { snapdom as outerSnapdom } from "@zumer/snapdom";

import { captureViewer, HIDDEN_TAB_NOTE } from "../utils/viewer-capture.js";
import { snapdomFor } from "../utils/iframe-snapdom.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** `pngDimensions` decodes through `new Image()`; happy-dom loads nothing. */
class StubImage {
  naturalWidth = 8;
  naturalHeight = 8;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

let win: Window;
let saved: Record<string, unknown> = {};
function install(key: string, value: unknown): void {
  const g = globalThis as unknown as Record<string, unknown>;
  saved[key] = g[key];
  g[key] = value;
}

beforeEach(() => {
  saved = {};
  win = new Window({ url: "http://localhost/" });
  const w = win as unknown as Record<string, unknown>;
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node"]) {
    install(key, w[key]);
  }
  install("Image", StubImage);
});

afterEach(async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete g[key];
    else g[key] = value;
  }
  await win.happyDOM.close();
});

type Snap = (el: Element) => Promise<{ toPng: () => Promise<{ src: string }> }>;

/** A preview holding a same-origin iframe whose window runs `snap` as its snapdom. */
function previewWithPage(snap: Snap) {
  const doc = win.document as unknown as Document;
  const preview = doc.createElement("div");
  doc.body.appendChild(preview);
  const iframe = doc.createElement("iframe") as HTMLIFrameElement;
  preview.appendChild(iframe);
  (iframe.contentWindow as unknown as { snapdom: Snap }).snapdom = snap;
  const inner = iframe.contentDocument!;
  inner.body.innerHTML = `<main><h1 class="title">Front Page</h1></main>`;
  return { preview: preview as unknown as HTMLElement, iframe, inner };
}

const png = async () => ({ toPng: async () => ({ src: `data:image/png;base64,${PNG_1PX}` }) });
const never = () => new Promise<never>(() => {});

describe("a page replaced while it is being captured", () => {
  test("is shot again instead of waiting on the discarded window forever", async () => {
    let calls = 0;
    const { preview, iframe } = previewWithPage(() => {
      calls += 1;
      if (calls === 1) {
        // The viewer reloads the page mid-shot; the first run never settles.
        setTimeout(() => iframe.dispatchEvent(new win.Event("load") as unknown as Event), 20);
        return never();
      }
      return png();
    });

    const result = await captureViewer(preview);
    expect(calls).toBe(2);
    expect(result.ok && result.method).toBe("snapdom-iframe");
  }, 3000);

  test("a region capture of a replaced page is shot again too", async () => {
    let calls = 0;
    const { preview, iframe } = previewWithPage(() => {
      calls += 1;
      if (calls === 1) {
        setTimeout(() => iframe.dispatchEvent(new win.Event("load") as unknown as Event), 20);
        return never();
      }
      return png();
    });

    const result = await captureViewer(preview, { selector: ".title" });
    expect(calls).toBe(2);
    expect(result.ok && result.method).toBe("snapdom-iframe-element");
  }, 3000);
});

describe("a page the viewer is still loading", () => {
  test("is not shot until the iframe stops being aria-busy", async () => {
    const seen: { busyAtShot?: boolean } = {};
    const { preview, iframe } = previewWithPage(async () => {
      seen.busyAtShot = iframe.getAttribute("aria-busy") === "true";
      return png();
    });
    iframe.setAttribute("aria-busy", "true");
    setTimeout(() => iframe.removeAttribute("aria-busy"), 60);

    const result = await captureViewer(preview);
    expect(result.ok).toBe(true);
    expect(seen.busyAtShot).toBe(false);
  }, 3000);
});

describe("a page in a background tab", () => {
  test("is captured without a chain of timers, and says what it could not do", async () => {
    const { preview, inner, iframe } = previewWithPage(png);
    // A tall page: in a visible tab the capture scrolls through it so
    // IntersectionObserver reveals fire. Hidden, they cannot fire at all.
    Object.defineProperty(inner, "visibilityState", { value: "hidden", configurable: true });
    Object.defineProperty(inner.documentElement, "scrollHeight", { value: 6000, configurable: true });
    Object.defineProperty(iframe.contentWindow!, "innerHeight", { value: 800, configurable: true });

    const realSetTimeout = globalThis.setTimeout;
    let scheduled = 0;
    install("setTimeout", ((fn: () => void, ms?: number) => {
      scheduled += 1;
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);

    const result = await captureViewer(preview);
    expect(result.ok).toBe(true);
    expect(result.ok && result.note).toBe(HIDDEN_TAB_NOTE);
    // A bound or two, not one sleep per screen of the page.
    expect(scheduled).toBeLessThanOrEqual(3);
  }, 3000);
});

describe("snapdomFor", () => {
  test("a snapdom script that fails to load falls back at once, not after a 5 s poll", async () => {
    const doc = win.document as unknown as Document;
    const iframe = doc.createElement("iframe") as HTMLIFrameElement;
    doc.body.appendChild(iframe);
    const inner = iframe.contentDocument!;
    const head = inner.head;
    const append = head.appendChild.bind(head);
    head.appendChild = (<T extends Node>(node: T): T => {
      append(node);
      queueMicrotask(() => node.dispatchEvent(new win.Event("error") as unknown as Event));
      return node;
    }) as typeof head.appendChild;

    const started = Date.now();
    const fn = await snapdomFor(inner.body);
    expect(fn).toBe(outerSnapdom);
    expect(Date.now() - started).toBeLessThan(1000);
  }, 3000);
});

describe("the page's language reaches the rasterized clone", () => {
  // snapdom clones the captured root, not <html>, so `<html lang>` was lost
  // and `hyphens: auto` could not hyphenate: justified columns came out with
  // longer lines than the page and printed over the next paragraph (the
  // Gazette's "overlapping lines"). Measured against a native screenshot of
  // the same page at 1280 px: 78,794 differing pixels without the language,
  // 21,697 with it, the column overlap gone.
  test("the captured root carries the inherited lang during the shot, and only then", async () => {
    const seen: { lang?: string | null } = {};
    const { preview, inner } = previewWithPage(async (el) => {
      seen.lang = el.getAttribute("lang");
      return png();
    });
    inner.documentElement.setAttribute("lang", "en");

    const result = await captureViewer(preview);
    expect(result.ok).toBe(true);
    expect(seen.lang).toBe("en");
    expect(inner.body.hasAttribute("lang")).toBe(false);
  }, 3000);

  test("an element that declares its own lang keeps it", async () => {
    const seen: { lang?: string | null } = {};
    const { preview, inner } = previewWithPage(async (el) => {
      seen.lang = el.getAttribute("lang");
      return png();
    });
    inner.documentElement.setAttribute("lang", "en");
    inner.body.setAttribute("lang", "de");

    await captureViewer(preview);
    expect(seen.lang).toBe("de");
    expect(inner.body.getAttribute("lang")).toBe("de");
  }, 3000);
});
