/** @jsxImportSource react */
/**
 * The ladder itself — the one control the mode is about.
 *
 * The rail is the whole navigation surface: rung order IS manifest order,
 * so an index badge that disagrees with the manifest sends the agent and
 * the reader to different pages while both believe they agree. And a rung
 * whose page the agent has not written yet has to READ as unwritten —
 * silently rendering a blank iframe under a normal-looking pill is the
 * failure that gets reported as "the viewer broke".
 *
 * happy-dom has no layout engine; nothing here measures pixels. What is
 * pinned is order, state, and what a click reports — the parts that can be
 * wrong without looking wrong. (Harness shape follows
 * `modes/bansho/__tests__/mute-control.test.tsx`.)
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
  { id: "age-5", label: "Age 5", file: "pages/age-5.html" },
  { id: "manager", label: "Manager", file: "pages/manager.html" },
  { id: "engineer", label: "Engineer", file: "pages/engineer.html" },
  { id: "parents", label: "Parents", file: "" },
];

interface Mounted {
  rungs: () => HTMLElement[];
  picked: string[];
  click: (el: Element) => Promise<void>;
  unmount: () => Promise<void>;
}

async function mountRail(opts: {
  activeId?: string;
  compareId?: string | null;
  /** Rungs whose page exists in the snapshot. */
  written?: string[];
} = {}): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AudienceRail } = await import("../viewer/AudienceRail.js");

  const written = new Set(opts.written ?? ["age-5", "manager", "engineer"]);
  const picked: string[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      createElement(AudienceRail, {
        audiences: AUDIENCES,
        activeId: opts.activeId ?? "age-5",
        compareId: opts.compareId ?? null,
        hasPage: (a: AudienceEntry) => written.has(a.id),
        onPick: (id: string) => picked.push(id),
      }),
    );
  });

  return {
    rungs: () =>
      Array.from(host.querySelectorAll("[data-eli5-rung]")) as HTMLElement[],
    picked,
    click: async (el: Element) => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("the audience rail", () => {
  test("one rung per audience, numbered in manifest order", async () => {
    const rail = await mountRail();
    const rungs = rail.rungs();
    expect(rungs.map((r) => r.dataset.eli5Rung)).toEqual([
      "age-5",
      "manager",
      "engineer",
      "parents",
    ]);
    // The badge is the ladder position the agent and the reader both count
    // with — "audience 2/4" in the chat has to mean this pill.
    expect(rungs.map((r) => r.textContent)).toEqual([
      "1Age 5",
      "2Manager",
      "3Engineer",
      "4Parents",
    ]);
    await rail.unmount();
  });

  test("the rung in view says so, in the DOM and to a screen reader", async () => {
    const rail = await mountRail({ activeId: "manager" });
    const states = rail.rungs().map((r) => r.dataset.eli5State);
    expect(states).toEqual(["idle", "active", "idle", "pending"]);
    const active = rail.rungs()[1];
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(rail.rungs()[0].getAttribute("aria-current")).toBeNull();
    await rail.unmount();
  });

  test("while comparing, the ladder shows BOTH rungs on screen", async () => {
    // The whole point of compare is watching the register shift between
    // two rungs; a rail that marks only one of them makes the right-hand
    // pane look like it came from nowhere.
    const rail = await mountRail({ activeId: "age-5", compareId: "engineer" });
    expect(rail.rungs().map((r) => r.dataset.eli5State)).toEqual([
      "active",
      "idle",
      "compare",
      "pending",
    ]);
    await rail.unmount();
  });

  test("a rung with no page yet reads as unwritten — and is still reachable", async () => {
    // Reachable on purpose: pressing it is how the reader asks the agent
    // for that page (the click becomes a selection in the chat context).
    const rail = await mountRail();
    const pending = rail.rungs()[3];
    expect(pending.dataset.eli5State).toBe("pending");
    expect(pending.getAttribute("title")).toContain("No page");
    await rail.click(pending);
    expect(rail.picked).toEqual(["parents"]);
    await rail.unmount();
  });

  test("a written page whose file has not arrived in the snapshot is pending too", async () => {
    // Mid-write the manifest names a page the file watcher has not
    // delivered; the rung is honestly not renderable yet.
    const rail = await mountRail({ written: ["age-5"] });
    expect(rail.rungs().map((r) => r.dataset.eli5State)).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
    ]);
    await rail.unmount();
  });

  test("clicking a rung reports its id, once", async () => {
    const rail = await mountRail();
    await rail.click(rail.rungs()[2]);
    expect(rail.picked).toEqual(["engineer"]);
    await rail.unmount();
  });
});
