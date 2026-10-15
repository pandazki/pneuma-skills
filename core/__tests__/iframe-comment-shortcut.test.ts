import { afterEach, describe, expect, test } from "bun:test";
import { Window, type HTMLElement } from "happy-dom";
import { buildSelectionScript } from "../iframe-selection/index.js";

const pages: Window[] = [];
afterEach(async () => { for (const page of pages.splice(0)) await page.happyDOM.close(); });
function fixture(enabled = true, active = false) {
  const page = new Window({ url: "http://host/page" }); pages.push(page);
  page.document.write('<html><body><h1 id="heading">Heading</h1><input><div contenteditable="true">Editable</div><a href="/next">Next</a></body></html>'); page.document.close();
  const messages: Record<string, unknown>[] = [];
  page.postMessage = (message) => messages.push(message as Record<string, unknown>);
  page.eval(buildSelectionScript().replace(/^<script>\s*/, "").replace(/<\/script>$/, ""));
  const configure = (allowed: boolean, latched = false) => page.dispatchEvent(new page.MessageEvent("message", { data: { type: "pneuma:selectMode", doc: "doc-1", enabled: false, commenting: { enabled: allowed, active: latched } } }));
  configure(enabled, active);
  const key = (name: string, type = "keydown", target: typeof page.document.body | ReturnType<typeof page.document.createElement> = page.document.body) => target.dispatchEvent(new page.KeyboardEvent(type, { key: name, ctrlKey: name !== "Control" || type === "keydown", bubbles: true, cancelable: true }));
  const target = page.document.querySelector("h1")!;
  page.document.elementFromPoint = () => target;
  const pointer = (type = "pointerdown", options = {}) => { const event = new page.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ctrlKey: true, ...options }); target.dispatchEvent(event); return event; };
  return { page, target, messages, configure, key, pointer, picks: () => messages.filter((m) => m.type === "pneuma:select") };
}

describe("opt-in Control comment picking", () => {
  test("Control activates immediately and primary pointerdown picks once, including macOS contextmenu", () => {
    const f = fixture(); f.key("Control");
    expect(f.page.document.body.style.cursor).toBe("default");
    expect(f.pointer().defaultPrevented).toBe(true);
    expect(f.pointer("contextmenu").defaultPrevented).toBe(true);
    f.pointer("click");
    expect(f.picks()).toHaveLength(1);
    expect(f.picks()[0]).toMatchObject({ doc: "doc-1", intent: "comment", selection: { selector: "h1#heading" } });
    f.key("Control", "keyup"); expect(f.page.document.body.style.cursor).toBe("");
  });
  test("denied permissions leave Control clicks and contextmenus native", () => {
    const f = fixture(false); f.key("Control");
    expect(f.pointer().defaultPrevented).toBe(false); expect(f.pointer("contextmenu").defaultPrevented).toBe(false); expect(f.picks()).toHaveLength(0);
  });
  test("editable fields, composition, and Control shortcuts retain their defaults", () => {
    const f = fixture(); const input = f.page.document.querySelector("input")!;
    f.key("Control", "keydown", input); expect(f.page.document.body.style.cursor).toBe("");
    f.key("Control"); f.key("c"); expect(f.page.document.body.style.cursor).toBe(""); expect(f.pointer().defaultPrevented).toBe(false);
    f.key("Control", "keyup");
    const composition = new f.page.KeyboardEvent("keydown", { key: "Control", ctrlKey: true, isComposing: true, bubbles: true }); input.dispatchEvent(composition);
    expect(composition.defaultPrevented).toBe(false); expect(f.picks()).toHaveLength(0);
  });
  test("Escape inhibits picking until release; blur and permission loss restore mode", () => {
    const f = fixture(); f.key("Control"); f.key("Escape"); expect(f.pointer().defaultPrevented).toBe(false);
    f.key("Control", "keyup"); f.key("Control"); expect(f.page.document.body.style.cursor).toBe("default");
    f.page.dispatchEvent(new f.page.Event("blur")); expect(f.page.document.body.style.cursor).toBe("");
    f.key("Control"); f.configure(false); expect(f.page.document.body.style.cursor).toBe(""); expect(f.pointer().defaultPrevented).toBe(false);
  });
  test("explicit comment mode still works without Control and temporary mode preserves base selection", () => {
    const f = fixture(true, true); f.pointer("pointerdown", { ctrlKey: false }); expect(f.picks()).toHaveLength(1);
    f.configure(true); f.page.dispatchEvent(new f.page.MessageEvent("message", { data: { type: "pneuma:selectMode", doc: "doc-1", enabled: true, commenting: { enabled: true, active: false } } }));
    f.key("Control"); f.key("Control", "keyup"); expect(f.page.document.body.style.cursor).toBe("crosshair");
    f.pointer("pointerdown", { ctrlKey: false }); f.pointer("click", { ctrlKey: false }); expect(f.picks().at(-1)?.intent).toBeUndefined();
  });
});

test("navigation highlight is transient and never emits selection", () => {
  const f = fixture();
  f.page.dispatchEvent(new f.page.MessageEvent("message", { data: { type: "pneuma:navigationHighlight", doc: "old-doc", selector: "#heading" } }));
  expect(f.page.document.querySelector("[data-pneuma-navigation-highlight]")).toBeNull();
  f.page.dispatchEvent(new f.page.MessageEvent("message", { data: { type: "pneuma:navigationHighlight", doc: "doc-1", selector: "#heading" } }));
  expect(f.page.document.querySelector("[data-pneuma-navigation-highlight]")).not.toBeNull(); expect(f.picks()).toHaveLength(0);
  f.page.dispatchEvent(new f.page.Event("pagehide"));
  expect(f.page.document.querySelector("[data-pneuma-navigation-highlight]")).toBeNull();
});

describe("Control state across pointer event streams", () => {
  test("an explicit Control press survives modifier-less movement and primary pointerdown until release", () => {
    const f = fixture(); f.key("Control");
    f.pointer("mousemove", { ctrlKey: false });
    expect(f.page.document.body.style.cursor).toBe("default");
    expect(f.page.document.querySelector("[data-pneuma-comment-hover]")).not.toBeNull();
    expect(f.pointer("pointerdown", { ctrlKey: false }).defaultPrevented).toBe(true);
    expect(f.picks()).toHaveLength(1);
    f.key("Control", "keyup");
    f.pointer("mousemove", { ctrlKey: false });
    expect(f.page.document.body.style.cursor).toBe("");
    expect(f.page.document.querySelector("[data-pneuma-comment-hover]")).toBeNull();
  });
  test("parent keyboard evidence survives entering the iframe without modifier flags, then parent release clears it", () => {
    const f = fixture();
    const control = (pressed: boolean) => f.page.dispatchEvent(new f.page.MessageEvent("message", { data: { type: "pneuma:commentControl", doc: "doc-1", pressed } }));
    control(true); f.pointer("mousemove", { ctrlKey: false });
    expect(f.page.document.body.style.cursor).toBe("default");
    expect(f.pointer("pointerdown", { ctrlKey: false }).defaultPrevented).toBe(true);
    control(false); expect(f.page.document.body.style.cursor).toBe("");
  });
  test("modifier-only pointer entry stays inferred and clears on an unmodified movement after repeated configuration", () => {
    const f = fixture(); f.pointer("mousemove");
    expect(f.page.document.body.style.cursor).toBe("default");
    f.configure(true); f.pointer("mousemove", { ctrlKey: false });
    expect(f.page.document.body.style.cursor).toBe("");
    expect(f.pointer("pointerdown", { ctrlKey: false }).defaultPrevented).toBe(false);
  });
  test("a modifier-less movement cannot cancel Escape inhibition or revive a keyboard chord", () => {
    const f = fixture(); f.key("Control"); f.key("Escape");
    f.pointer("mousemove", { ctrlKey: false }); f.pointer("mousemove");
    expect(f.page.document.body.style.cursor).toBe("");
    f.key("Control", "keyup"); f.key("Control"); f.key("c");
    f.pointer("mousemove", { ctrlKey: false }); f.pointer("mousemove");
    expect(f.page.document.body.style.cursor).toBe("");
    f.key("Control", "keyup"); f.key("Control"); expect(f.page.document.body.style.cursor).toBe("default");
  });
});

test("a parent press received while comments are denied cannot survive a later permission grant", () => {
  const f = fixture(false);
  const control = (pressed: boolean) => f.page.dispatchEvent(new f.page.MessageEvent("message", { data: { type: "pneuma:commentControl", doc: "doc-1", pressed } }));
  control(true); f.configure(true); f.pointer("mousemove", { ctrlKey: false });
  expect(f.page.document.body.style.cursor).toBe("");
  expect(f.pointer("pointerdown", { ctrlKey: false }).defaultPrevented).toBe(false);
  control(true); expect(f.page.document.body.style.cursor).toBe("default");
  control(false); f.pointer("mousemove", { ctrlKey: false }); expect(f.page.document.body.style.cursor).toBe("");
});

test("hovering a mode-generated editable heading cannot cancel Control comment picking", () => {
  const f = fixture();
  f.target.setAttribute("contenteditable", "true");
  f.target.setAttribute("data-pneuma-inline-edit", "");
  f.key("Control"); f.pointer("mousemove");
  expect(f.page.document.body.style.cursor).toBe("default");
  expect(f.page.document.querySelector("[data-pneuma-comment-hover]")).not.toBeNull();
  expect(f.pointer().defaultPrevented).toBe(true); expect(f.picks()).toHaveLength(1);
});

test("focused generated editing and authored editable regions retain their keyboard and pointer behavior", () => {
  const f = fixture();
  f.target.setAttribute("contenteditable", "true"); f.target.setAttribute("data-pneuma-inline-edit", ""); f.target.focus();
  f.key("Control", "keydown", f.target); f.pointer("mousemove");
  expect(f.page.document.body.style.cursor).toBe(""); expect(f.pointer().defaultPrevented).toBe(false);
  f.key("Control", "keyup", f.target); f.target.blur(); f.target.removeAttribute("data-pneuma-inline-edit");
  f.key("Control"); f.pointer("mousemove");
  expect(f.page.document.body.style.cursor).toBe(""); expect(f.pointer().defaultPrevented).toBe(false);
});

describe("visible comment pointer indicator", () => {
  const marker = (f: ReturnType<typeof fixture>) => f.page.document.querySelector("[data-pneuma-comment-cursor]") as HTMLElement | null;
  test("the circle follows consecutive client coordinates and remains fixed while scrolling", () => {
    const f = fixture(); f.key("Control");
    for (const [x, y] of [[80, 100], [125, 145], [160, 170]]) {
      f.pointer("mousemove", { clientX: x, clientY: y });
      expect(marker(f)?.style.left).toBe(`${x + 7.5}px`); expect(marker(f)?.style.top).toBe(`${y + 7.5}px`);
      expect(marker(f)?.style.position).toBe("fixed"); expect(marker(f)?.style.pointerEvents).toBe("none");
      expect(marker(f)?.getAttribute("aria-hidden")).toBe("true");
      expect(f.page.document.querySelectorAll("[data-pneuma-comment-cursor]")).toHaveLength(1);
    }
    f.page.dispatchEvent(new f.page.Event("scroll"));
    expect(marker(f)?.style.left).toBe("167.5px"); expect(marker(f)?.style.top).toBe("177.5px");
    expect(f.page.document.body.style.cursor).toBe("default");
    expect(f.pointer("pointerdown", { clientX: 160, clientY: 170 }).defaultPrevented).toBe(true);
    expect(f.picks()).toHaveLength(1);
  });
  test("the badge flips each axis at viewport edges while clicks keep the original pointer target", () => {
    const f = fixture(); f.key("Control");
    const width = f.page.innerWidth, height = f.page.innerHeight;
    for (const [x, y, left, top] of [[width - 5, 100, width - 37.5, 107.5], [100, height - 5, 107.5, height - 37.5], [width - 5, height - 5, width - 37.5, height - 37.5]]) {
      f.pointer("mousemove", { clientX: x, clientY: y });
      expect(marker(f)?.style.left).toBe(`${left}px`); expect(marker(f)?.style.top).toBe(`${top}px`);
    }
    expect(f.pointer("pointerdown", { clientX: width - 5, clientY: height - 5 }).defaultPrevented).toBe(true);
    expect(f.picks()[0]?.selection).toHaveProperty("selector", "h1#heading");
  });
  test("leaving the iframe hides the marker and re-entry while still held restores it", () => {
    const f = fixture(); f.key("Control"); f.pointer("mousemove", { clientX: 80, clientY: 100 });
    f.pointer("mouseout", { relatedTarget: null }); expect(marker(f)).toBeNull();
    f.pointer("mouseover", { clientX: 90, clientY: 110 }); expect(marker(f)?.style.left).toBe("97.5px");
    f.key("Control", "keyup"); expect(marker(f)).toBeNull();
  });
  for (const boundary of ["Escape", "blur", "hidden", "pagehide", "document", "permission"] as const) test(`${boundary} clears the visible marker`, () => {
    const f = fixture(); f.key("Control"); f.pointer("mousemove", { clientX: 80, clientY: 100 }); expect(marker(f)).not.toBeNull();
    if (boundary === "Escape") f.key("Escape");
    else if (boundary === "blur" || boundary === "pagehide") f.page.dispatchEvent(new f.page.Event(boundary));
    else if (boundary === "hidden") { Object.defineProperty(f.page.document, "hidden", { value: true }); f.page.document.dispatchEvent(new f.page.Event("visibilitychange")); }
    else if (boundary === "document") f.page.dispatchEvent(new f.page.MessageEvent("message", { data: { type: "pneuma:selectMode", doc: "next", enabled: false, commenting: { enabled: true, active: false } } }));
    else f.configure(false);
    expect(marker(f)).toBeNull();
  });
  test("denied and authored editable targets cannot show a marker", () => {
    const f = fixture(false); f.key("Control"); f.pointer("mousemove", { clientX: 80, clientY: 100 }); expect(marker(f)).toBeNull();
    f.configure(true); f.key("Control"); f.target.setAttribute("contenteditable", "true");
    f.pointer("mousemove", { clientX: 80, clientY: 100 }); expect(marker(f)).toBeNull();
  });
  test("an earlier view-mode pointer leave cannot place a marker outside the iframe", () => {
    const f = fixture(); f.pointer("mousemove", { ctrlKey: false, clientX: 80, clientY: 100 });
    f.pointer("mouseout", { ctrlKey: false, relatedTarget: null }); f.key("Control");
    expect(marker(f)).toBeNull();
  });
  test("the marker stays outside selected content and its serialized thumbnail", () => {
    const f = fixture(); f.target.getBoundingClientRect = () => new f.page.DOMRect(20, 30, 200, 40);
    f.key("Control"); f.pointer("mousemove", { clientX: 80, clientY: 50 });
    expect(marker(f)?.parentElement).toBe(f.page.document.documentElement);
    expect(f.page.document.body.contains(marker(f)!)).toBe(false);
    f.pointer("pointerdown", { clientX: 80, clientY: 50 });
    const thumbnail = (f.picks()[0]?.selection as { thumbnail?: string })?.thumbnail;
    expect(thumbnail).toStartWith("data:image/svg+xml;charset=utf-8,");
    expect(decodeURIComponent(thumbnail!)).not.toContain("data-pneuma-comment-cursor");
    expect(decodeURIComponent(thumbnail!)).not.toContain("M8.5 12.5h8m-4-4v8");
  });
});
