import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { buildCollaborationFrameScript } from "../viewer/collaboration-frame.js";

const windows: Window[] = [];
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.close(); });

function setup() {
  const win = new Window({ url: "http://localhost/rooms/site/revisions/1/grant/index.html", width: 1200, height: 800 });
  windows.push(win);
  win.document.write('<!doctype html><html><body><h1 id="headline">Make room for a better idea.</h1></body></html>');
  win.document.close();
  const messages: Record<string, any>[] = [];
  const parent = { postMessage: (message: Record<string, any>) => { messages.push(message); } };
  Object.defineProperty(win, "parent", { value: parent });
  win.eval(buildCollaborationFrameScript());
  if (!win.document.querySelector("[data-pneuma-collaboration]")) win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
  const send = (data: Record<string, unknown>, source: object = parent) => {
    win.dispatchEvent(new win.MessageEvent("message", { source: source as never, data: { channel: "pneuma-collab-host", ...data } }));
  };
  return { win, messages, send, parent };
}

describe("isolated collaboration page bridge", () => {
  test("only its parent can configure commenting, and read-only browsing never creates an anchor", () => {
    const { win, messages, send } = setup();
    const headline = win.document.getElementById("headline")!;
    send({ type: "configure", page: "index.html", revision: 3, commenting: true }, {});
    headline.dispatchEvent(new win.MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }));
    expect(messages.filter((m) => m.type === "anchor")).toHaveLength(0);
    send({ type: "configure", page: "index.html", revision: 3, commenting: false });
    headline.dispatchEvent(new win.MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }));
    expect(messages.filter((m) => m.type === "anchor")).toHaveLength(0);
  });

  test("a comment captures object identity, revision, quote and coordinates within the object", () => {
    const { win, messages, send } = setup();
    const headline = win.document.getElementById("headline")!;
    headline.getBoundingClientRect = () => new win.DOMRect(10, 20, 200, 100);
    send({ type: "configure", page: "index.html", revision: 7, commenting: true });
    headline.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 60, clientY: 70 }));
    const anchor = messages.find((m) => m.type === "anchor")?.anchor;
    expect(anchor).toEqual({
      address: { page: "index.html", selector: "#headline", offsetX: .25, offsetY: .5 },
      revision: 7, x: 60, y: 70, quote: "Make room for a better idea.",
    });
  });

  test("remote participant labels are inert text and mismatched revisions do not paint cursors", async () => {
    const { win, send } = setup();
    send({ type: "configure", page: "index.html", revision: 4, commenting: false });
    const view = { page: "index.html", revision: 4, scrollX: 0, scrollY: 0, width: 1200, height: 800, documentWidth: 1200, documentHeight: 800 };
    send({ type: "overlays", participants: [
      { id: "live", name: '<img src=x onerror="alert(1)">', color: "#f97316", cursor: { x: 100, y: 100 }, view },
      { id: "stale", name: "Old view", color: "red;display:none", cursor: { x: 100, y: 100 }, view: { ...view, revision: 3 } },
    ], comments: [] });
    await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
    const shadow = win.document.querySelector("[data-pneuma-collaboration]")!.shadowRoot!;
    expect(shadow.querySelectorAll("[data-cursor]")).toHaveLength(1);
    expect(shadow.querySelector("[data-cursor=live]")!.textContent).toContain("<img");
    expect(shadow.querySelector("img")).toBeNull();
  });

  test("a visual target without text still produces a valid optional-quote anchor", () => {
    const { win, messages, send } = setup();
    const image = win.document.createElement("img");
    image.id = "hero-image";
    win.document.body.append(image);
    send({ type: "configure", page: "index.html", revision: 2, commenting: true });
    image.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 60, clientY: 70 }));
    const anchor = messages.find((m) => m.type === "anchor")?.anchor;
    expect(anchor.address.selector).toBe("#hero-image");
    expect("quote" in anchor).toBe(false);
  });

  test("canonical-width cursors retain CSS pixels on short pages with different viewport heights", async () => {
    const { win, send } = setup();
    send({ type: "configure", page: "index.html", revision: 1, commenting: false });
    send({ type: "overlays", participants: [{
      id: "peer", name: "Alex", color: "#f97316", cursor: { x: 100, y: 100 },
      view: { page: "index.html", revision: 1, scrollX: 0, scrollY: 0, width: 1200, height: 400, documentWidth: 1200, documentHeight: 400 },
    }], comments: [] });
    await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
    const cursor = win.document.querySelector("[data-pneuma-collaboration]")!.shadowRoot!.querySelector("[data-cursor=peer]")!;
    expect((cursor as unknown as HTMLElement).style.transform).toBe("translate(100px, 100px)");
  });

  test("scrolling keeps a stationary pointer at its current document coordinate", () => {
    const { win, send, messages } = setup();
    send({ type: "configure", page: "index.html", revision: 1, commenting: false });
    win.dispatchEvent(new win.PointerEvent("pointermove", { clientX: 100, clientY: 150 }));
    Object.defineProperty(win, "scrollY", { value: 400, configurable: true });
    win.dispatchEvent(new win.Event("scroll"));
    expect(messages.filter((message) => message.type === "cursor").at(-1)?.cursor).toEqual({ x: 100, y: 550 });
  });

  test("comments survive missing objects with a visible stale marker", async () => {
    const { win, send } = setup();
    send({ type: "configure", page: "index.html", revision: 4, commenting: false });
    send({ type: "overlays", participants: [], comments: [{
      id: "thread", status: "open", anchor: { address: { page: "index.html", selector: "#deleted" }, revision: 2, x: 80, y: 90 },
      messages: [{ authorName: "Alex", body: "Please keep this section." }],
    }] });
    await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
    const pin = win.document.querySelector("[data-pneuma-collaboration]")!.shadowRoot!.querySelector("[data-comment=thread]")!;
    expect(pin.getAttribute("data-stale")).toBe("true");
    expect(pin.getAttribute("title")).toContain("Original location changed");
  });

  test("presence updates retain an interactive comment pin instead of detaching it mid-click", async () => {
    const { win, send, messages } = setup();
    send({ type: "configure", page: "index.html", revision: 1, commenting: false });
    const comments = [{ id: "thread", status: "open", anchor: { address: { page: "index.html", selector: "#headline" }, revision: 1, x: 20, y: 20 }, messages: [{ authorName: "Alex", body: "Review this" }] }];
    send({ type: "overlays", participants: [], comments });
    await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
    const shadow = win.document.querySelector("[data-pneuma-collaboration]")!.shadowRoot!;
    const pin = shadow.querySelector("[data-comment=thread]")!;
    send({ type: "overlays", participants: [], comments: structuredClone(comments) });
    await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
    expect(shadow.querySelector("[data-comment=thread]")).toBe(pin);
    pin.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(messages.at(-1)).toEqual({ channel: "pneuma-collab-frame", type: "thread", commentId: "thread" });
  });

  test("following ignores a view from another page or revision", () => {
    const { win, send } = setup();
    const calls: unknown[] = [];
    win.scrollTo = ((...args: unknown[]) => { calls.push(args); }) as typeof win.scrollTo;
    send({ type: "configure", page: "index.html", revision: 4, commenting: false });
    const view = { page: "other.html", revision: 4, scrollX: 0, scrollY: 100, width: 1200, height: 800, documentWidth: 1200, documentHeight: 2000 };
    send({ type: "follow", view });
    send({ type: "follow", view: { ...view, page: "index.html", revision: 3 } });
    expect(calls).toHaveLength(0);
    send({ type: "follow", view: { ...view, page: "index.html" } });
    expect(calls).toHaveLength(1);
  });
});
