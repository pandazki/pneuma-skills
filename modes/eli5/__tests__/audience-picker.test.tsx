/** @jsxImportSource react */
/**
 * The per-pane audience picker — the compare header's rung chooser.
 *
 * It exists because the thing it replaced was a native `<select>`: OS
 * widgetry in the middle of the Ethereal Tech chrome, with a popup no
 * stylesheet can reach. So the first assertion here is a structural one —
 * no native form control renders anywhere in this component — and the rest
 * pin the behaviour the `<select>` used to give for free, which a custom
 * widget has to earn: every rung listed in manifest order (unwritten ones
 * included — picking one is how a reader asks for that page), the current
 * rung marked, one report per pick, and a keyboard that can open, walk,
 * choose and escape.
 *
 * The menu is portalled to `document.body` (a `backdrop-filter` ancestor
 * would otherwise seal its z-index inside the pane), so every menu query
 * below goes through `document`, never the mount host.
 *
 * happy-dom has no layout engine — every rect is zero — so nothing here
 * measures geometry. (Harness shape follows `rail.test.tsx`.)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { AudienceEntry } from "../domain.js";

let win: Window;
let restore: (() => void) | undefined;

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const w = win as unknown as Record<string, unknown>;
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    saved[key] = g[key];
    g[key] = key === "window" ? win : w[key];
  }
  saved.IS_REACT_ACT_ENVIRONMENT = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

const AUDIENCES: AudienceEntry[] = [
  { id: "age-5", label: "Age 5", file: "pages/age-5.html", tone: "picture-book" },
  { id: "manager", label: "Manager", file: "pages/manager.html" },
  { id: "engineer", label: "Engineer", file: "pages/engineer.html" },
  // No page written yet — still a rung, still pickable.
  { id: "parents", label: "Parents", file: "" },
];

interface Mounted {
  trigger: () => HTMLElement;
  menu: () => HTMLElement | null;
  options: () => HTMLElement[];
  picked: string[];
  click: (el: Element) => Promise<void>;
  key: (el: Element, key: string) => Promise<void>;
  mouseDown: (el: Element) => Promise<void>;
  /** What the parent window sees when a click lands inside an iframe. */
  blurWindow: () => Promise<void>;
  unmount: () => Promise<void>;
}

async function mountPicker(
  opts: { valueId?: string | null; caption?: string } = {},
): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AudiencePicker } = await import("../viewer/AudiencePicker.js");

  const picked: string[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      createElement(AudiencePicker, {
        caption: opts.caption ?? "In view",
        audiences: AUDIENCES,
        valueId: opts.valueId === undefined ? "manager" : opts.valueId,
        onChange: (id: string) => picked.push(id),
      }),
    );
  });

  const menu = () =>
    document.querySelector("[data-eli5-picker-menu]") as HTMLElement | null;

  return {
    trigger: () => host.querySelector("[data-eli5-picker]") as HTMLElement,
    menu,
    options: () =>
      Array.from(menu()?.querySelectorAll("[data-eli5-option]") ?? []) as HTMLElement[],
    picked,
    click: async (el: Element) => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
    key: async (el: Element, key: string) => {
      await act(async () => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    },
    mouseDown: async (el: Element) => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
    },
    blurWindow: async () => {
      await act(async () => {
        window.dispatchEvent(new Event("blur"));
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("the audience picker", () => {
  test("renders no native form control — the reason it exists", async () => {
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    // Open, with the whole menu in the document: still not one piece of OS
    // widgetry. A `<select>` here is a defect, not a polish item.
    expect(picker.menu()).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
    expect(document.querySelector("option")).toBeNull();
    expect(document.querySelector("input")).toBeNull();
    await picker.unmount();
  });

  test("the trigger names the rung in view, numbered like the rail", async () => {
    const picker = await mountPicker({ valueId: "engineer" });
    const trigger = picker.trigger();
    expect(trigger.textContent).toContain("3");
    expect(trigger.textContent).toContain("Engineer");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Closed means closed: nothing of the menu is in the document.
    expect(picker.menu()).toBeNull();
    await picker.unmount();
  });

  test("a pane standing on no rung still offers the ladder", async () => {
    const picker = await mountPicker({ valueId: null });
    await picker.click(picker.trigger());
    expect(picker.options()).toHaveLength(AUDIENCES.length);
    expect(
      picker.options().some((o) => o.getAttribute("aria-selected") === "true"),
    ).toBe(false);
    await picker.unmount();
  });

  test("opening lists every rung in manifest order, unwritten ones included", async () => {
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    expect(picker.trigger().getAttribute("aria-expanded")).toBe("true");
    const options = picker.options();
    expect(options.map((o) => o.dataset.eli5Option)).toEqual([
      "age-5",
      "manager",
      "engineer",
      "parents",
    ]);
    // Numbering is the ladder position the rail and the agent both count
    // with — "audience 2/4" has to mean the same rung everywhere.
    expect(options.map((o) => o.textContent)).toEqual([
      "1Age 5",
      "2Manager",
      "3Engineer",
      "4Parents",
    ]);
    await picker.unmount();
  });

  test("the rung in view is the one marked, to a screen reader too", async () => {
    const picker = await mountPicker({ valueId: "engineer" });
    await picker.click(picker.trigger());
    expect(picker.options().map((o) => o.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(picker.menu()?.getAttribute("role")).toBe("listbox");
    await picker.unmount();
  });

  test("picking a rung reports its id once, then closes", async () => {
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    await picker.click(picker.options()[2]);
    expect(picker.picked).toEqual(["engineer"]);
    expect(picker.menu()).toBeNull();
    expect(picker.trigger().getAttribute("aria-expanded")).toBe("false");
    await picker.unmount();
  });

  test("a rung with no page yet is pickable — that is how a reader asks for it", async () => {
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    const pending = picker.options()[3];
    expect(pending.hasAttribute("disabled")).toBe(false);
    await picker.click(pending);
    expect(picker.picked).toEqual(["parents"]);
    await picker.unmount();
  });

  test("Escape closes it, picks nothing, and hands focus back", async () => {
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    await picker.key(picker.options()[0], "Escape");
    expect(picker.menu()).toBeNull();
    expect(picker.picked).toEqual([]);
    expect(document.activeElement).toBe(picker.trigger());
    await picker.unmount();
  });

  test("a mousedown anywhere else closes it", async () => {
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    expect(picker.menu()).not.toBeNull();
    await picker.mouseDown(document.body);
    expect(picker.menu()).toBeNull();
    expect(picker.picked).toEqual([]);
    await picker.unmount();
  });

  test("clicking into the page — an iframe — closes it too", async () => {
    // Most of this viewer is an iframe, and a mousedown inside one never
    // reaches this document. What the parent sees instead is a window
    // blur, and that has to count as clicking outside: otherwise the
    // commonest dismissal a reader performs leaves the menu hanging over
    // the page they just clicked.
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    await picker.blurWindow();
    expect(picker.menu()).toBeNull();
    expect(picker.picked).toEqual([]);
    // Focus is NOT yanked back to the trigger — it belongs to whatever
    // the reader just clicked into.
    expect(document.activeElement).not.toBe(picker.trigger());
    await picker.unmount();
  });

  test("the trigger toggles: a second press closes what the first opened", async () => {
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    await picker.click(picker.trigger());
    expect(picker.menu()).toBeNull();
    await picker.unmount();
  });

  test("opening lands the keyboard on the rung in view", async () => {
    const picker = await mountPicker({ valueId: "engineer" });
    await picker.key(picker.trigger(), "ArrowDown");
    expect(picker.menu()).not.toBeNull();
    expect(document.activeElement).toBe(picker.options()[2]);
    await picker.unmount();
  });

  test("arrows walk the ladder and stop at its ends", async () => {
    const picker = await mountPicker({ valueId: "age-5" });
    await picker.click(picker.trigger());
    const at = () => picker.options().indexOf(document.activeElement as HTMLElement);
    expect(at()).toBe(0);
    // Up from the first rung stays put — a clamp, not a wrap, so the
    // reader never lands on the far end of the ladder by accident.
    await picker.key(picker.options()[0], "ArrowUp");
    expect(at()).toBe(0);
    await picker.key(picker.options()[0], "ArrowDown");
    expect(at()).toBe(1);
    await picker.key(picker.options()[1], "End");
    expect(at()).toBe(3);
    await picker.key(picker.options()[3], "ArrowDown");
    expect(at()).toBe(3);
    await picker.key(picker.options()[3], "Home");
    expect(at()).toBe(0);
    await picker.unmount();
  });

  test("unmounting while open leaves nothing behind in the body", async () => {
    // The menu lives outside the component's own host, so an unmount that
    // forgets it would leave a floating panel over the next viewer.
    const picker = await mountPicker();
    await picker.click(picker.trigger());
    expect(picker.menu()).not.toBeNull();
    await picker.unmount();
    expect(document.querySelector("[data-eli5-picker-menu]")).toBeNull();
  });
});
