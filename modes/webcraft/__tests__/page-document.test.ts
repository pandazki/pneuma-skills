/**
 * Where a webcraft preview page is (`pagePath`, `pageFromUrl`), what the
 * viewer adds to it (`instrumentPage`), and which files it shows
 * (`referencedContentPaths`).
 *
 * The invariant: the preview iframe shows the page at its real content URL,
 * so the page reads its own query, fragment and path, resolves its links and
 * assets against that URL, and — in the hosted player — every request it
 * makes goes through the service worker. The browser half of that is verified
 * in Chrome (dev, production server, hosted player); here the mappings and
 * the instrumentation contract are pinned.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  INSTRUMENTED_MARK,
  LEAVE_SCRIPT,
  PREVIEW_MARK,
  elementBody,
  instrumentPage,
  pageFromUrl,
  pagePath,
  referencedContentPaths,
  contentRequests,
  staleAfterLoad,
} from "../viewer/page-document.js";

describe("pagePath", () => {
  test("a page of a content set", () => {
    expect(pagePath("gazette", "index.html")).toBe("/content/gazette/index.html");
  });
  test("a workspace without content sets", () => {
    expect(pagePath(null, "index.html")).toBe("/content/index.html");
  });
  test("the content-set root", () => {
    expect(pagePath("carbon-park", "")).toBe("/content/carbon-park/");
  });
  test("encodes like location.pathname, and never lets a file name start a query", () => {
    expect(pagePath("site", "my page.html")).toBe("/content/site/my%20page.html");
    expect(pagePath("site", "a?b#c.html")).toBe("/content/site/a%3Fb%23c.html");
  });
});

describe("pageFromUrl", () => {
  const root = "http://localhost:17996/content/carbon-park/";

  test("the page a URL shows, whatever its query and fragment", () => {
    expect(pageFromUrl(`${root}index.html?mode=webcraft#rows`, root)).toBe("index.html");
    expect(pageFromUrl(`${root}settings.html#budget`, root)).toBe("settings.html");
  });

  test("a nested page keeps its directory", () => {
    expect(pageFromUrl(`${root}sub/page.html`, root)).toBe("sub/page.html");
  });

  test("a directory means its index.html", () => {
    expect(pageFromUrl(root, root)).toBe("index.html");
    expect(pageFromUrl(`${root}sub/`, root)).toBe("sub/index.html");
  });

  test("decodes percent-encoded file names", () => {
    expect(pageFromUrl(`${root}my%20page.html`, root)).toBe("my page.html");
  });

  test("anything outside this content set is not one of its pages", () => {
    expect(pageFromUrl("https://example.com/content/carbon-park/index.html", root)).toBeNull();
    expect(pageFromUrl("http://localhost:17996/content/other/index.html", root)).toBeNull();
    expect(pageFromUrl("about:blank", root)).toBeNull();
  });
});

describe("elementBody", () => {
  test("strips the wrapping tag of a script or style string", () => {
    expect(elementBody("<script>\nvar a = 1;\n</script>")).toBe("\nvar a = 1;\n");
    expect(elementBody('<style data-x="1">a{b:c}</style>')).toBe("a{b:c}");
  });
});

let open: Window[] = [];
afterEach(async () => {
  for (const w of open) await w.happyDOM.close();
  open = [];
});

function page(html: string, url = "http://localhost/content/site/index.html"): Window {
  const win = new Window({ url });
  open.push(win);
  win.document.write(html);
  win.document.close();
  return win;
}

describe("instrumentPage", () => {
  test("adds the viewer's scripts and styles, every node marked", () => {
    const win = page(`<!DOCTYPE html><html><head><title>t</title></head><body><script src="main.js"></script><h1>Hi</h1></body></html>`);
    const doc = win.document as unknown as Document;
    expect(instrumentPage(doc, { scripts: ["var x = 1;"], styles: ["a{color:red}"] })).toBe(true);
    const added = Array.from(doc.querySelectorAll(`[${PREVIEW_MARK}]`));
    expect(added.map((el) => el.tagName.toLowerCase()).sort()).toEqual(["script", "style"]);
    // The page's own script is untouched and unmarked.
    const own = doc.querySelector('script[src="main.js"]')!;
    expect(own.hasAttribute(PREVIEW_MARK)).toBe(false);
  });

  test("no authored element is inside a marked node — edit mode skips exactly the viewer's own", () => {
    // Edit mode makes every element editable except `closest(PREVIEW_MARK)`;
    // marking <html> itself once left the whole page uneditable.
    const win = page(`<!DOCTYPE html><html><head></head><body><h1>Hi</h1><p>Text</p></body></html>`);
    const doc = win.document as unknown as Document;
    instrumentPage(doc, { scripts: ["1"], styles: ["a{}"] });
    expect(doc.querySelector("h1")!.closest(`[${PREVIEW_MARK}]`)).toBeNull();
    expect(doc.querySelector("p")!.closest(`[${PREVIEW_MARK}]`)).toBeNull();
    expect(doc.documentElement.hasAttribute(INSTRUMENTED_MARK)).toBe(true);
  });

  test("is idempotent per document — a second load handler adds nothing", () => {
    const win = page(`<!DOCTYPE html><html><head></head><body></body></html>`);
    const doc = win.document as unknown as Document;
    instrumentPage(doc, { scripts: ["1"], styles: [] });
    expect(instrumentPage(doc, { scripts: ["1"], styles: [] })).toBe(false);
    expect(doc.querySelectorAll(`script[${PREVIEW_MARK}]`).length).toBe(1);
  });

  test("works on a fragment page without <head>", () => {
    const win = page(`<h1>Just a fragment</h1>`);
    const doc = win.document as unknown as Document;
    expect(instrumentPage(doc, { scripts: ["1"], styles: ["a{}"] })).toBe(true);
    expect(doc.querySelectorAll(`[${PREVIEW_MARK}]`).length).toBe(2);
  });
});

describe("LEAVE_SCRIPT", () => {
  test("marks the iframe busy when the page starts to leave", () => {
    const attrs: Record<string, string> = {};
    const listeners: Record<string, () => void> = {};
    const fake = {
      addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; },
      frameElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } },
    };
    new Function("addEventListener", "frameElement", LEAVE_SCRIPT)(fake.addEventListener, fake.frameElement);
    listeners.pagehide?.();
    expect(attrs["aria-busy"]).toBe("true");
  });
});

describe("referencedContentPaths", () => {
  const win = (names: string[]) =>
    ({
      location: { origin: "http://localhost:17996" },
      performance: { getEntriesByType: (type: string) => (type === "resource" ? names.map((name) => ({ name, startTime: 0 })) : []) },
    }) as unknown as Parameters<typeof referencedContentPaths>[0];

  test("the content files the page requested, as workspace paths", () => {
    const refs = referencedContentPaths(win([
      "http://localhost:17996/content/carbon-park/assets/app.css",
      "http://localhost:17996/content/carbon-park/assets/sessions.js?v=3",
      "http://localhost:17996/content/carbon-park/assets/my%20photo.jpg",
      "https://fonts.googleapis.com/css2?family=X",
      "http://localhost:17996/vendor/snapdom.js",
    ]));
    expect(refs).toEqual(new Set(["carbon-park/assets/app.css", "carbon-park/assets/sessions.js", "carbon-park/assets/my photo.jpg"]));
  });

  test("a full Resource Timing buffer means the list may be incomplete", () => {
    const names = Array.from({ length: 250 }, (_, i) => `http://localhost:17996/content/s/${i}.png`);
    expect(referencedContentPaths(win(names))).toBe("all");
  });
});

describe("contentRequests", () => {
  test("the document and its resources, at the epoch time their first request started", () => {
    const win = {
      location: { origin: "http://localhost:17996" },
      performance: {
        timeOrigin: 1_000_000,
        getEntriesByType: (type: string) =>
          type === "navigation"
            ? [{ name: "http://localhost:17996/content/site/sub/?x=1#y", startTime: 0 }]
            : [
                { name: "http://localhost:17996/content/site/busy.css", startTime: 40 },
                { name: "http://localhost:17996/content/site/busy.css", startTime: 900 },
                { name: "http://localhost:17996/content/site/big.png", startTime: 60 },
              ],
      },
    } as unknown as Parameters<typeof contentRequests>[0];
    const { started, complete } = contentRequests(win);
    expect(complete).toBe(true);
    expect(Object.fromEntries(started)).toEqual({
      "site/sub/index.html": 1_000_000,
      "site/busy.css": 1_000_040,
      "site/big.png": 1_000_060,
    });
  });
});

describe("staleAfterLoad — changes that arrived while the page was loading", () => {
  const requests = (started: Record<string, number>, complete = true) => ({ started: new Map(Object.entries(started)), complete });

  test("a stylesheet requested before its change was seen is stale (the review's busy.css case)", () => {
    // busy.css loaded at t=100; the change was seen at t=500 while a slow image kept the page loading.
    expect(staleAfterLoad(new Map([["site/busy.css", 500]]), requests({ "site/index.html": 0, "site/busy.css": 100 }), "site/")).toEqual(["site/busy.css"]);
  });

  test("the page's own HTML changed after its navigation started", () => {
    expect(staleAfterLoad(new Map([["site/index.html", 300]]), requests({ "site/index.html": 0 }), "site/")).toEqual(["site/index.html"]);
  });

  test("a file requested after the change was seen is fresh", () => {
    expect(staleAfterLoad(new Map([["site/lazy.png", 300]]), requests({ "site/lazy.png": 800 }), "site/")).toEqual([]);
  });

  test("a file the page never requested is not its concern — unless its request list is incomplete", () => {
    const changed = new Map([["site/other.css", 300], ["elsewhere/x.css", 300]]);
    expect(staleAfterLoad(changed, requests({}), "site/")).toEqual([]);
    expect(staleAfterLoad(changed, requests({}, false), "site/")).toEqual(["site/other.css"]);
  });
});
