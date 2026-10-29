/** @jsxImportSource react */
/**
 * The series viewer mounted whole on the shipped seed (happy-dom), for what
 * the 2026-10-29 e2e found wrong on screen and in the action replies:
 *
 * - `play` answered `playing: false` before the clip had started, and the
 *   agent told the user to press Play while it was playing.
 * - "Made from" on a re-shot shot priced the take, not the re-shoot.
 * - A failed take's reason lived only in a hover title, and a call whose
 *   billing is unknown was nowhere in the spend.
 * - Overlays sat inside the scrolling page, so one opened from far down
 *   opened above the viewport.
 *
 * happy-dom has no decoder: `HTMLMediaElement.play` is replaced per test
 * with a promise the test settles, which is exactly the boundary the action
 * has to wait on. (Harness shape follows `modes/brand/__tests__/viewer.test.tsx`.)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { MemorySource } from "../../../core/sources/memory.js";
import type { ViewerActionRequest, ViewerActionResult, ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { loadSeries, type Series } from "../domain.js";
import manifest from "../manifest.js";
import { readSeriesFiles, SEED_DIR, withFailedTake } from "./series-workspace.js";

let win: Window;
let restore: () => void;

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLMediaElement",
    "Element",
    "Node",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "ResizeObserver",
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

afterAll(() => restore());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Mounted {
  host: HTMLElement;
  results: Array<{ id: string; result: ViewerActionResult }>;
  request: (req: ViewerActionRequest) => Promise<void>;
  click: (el: Element | null | undefined) => Promise<void>;
  /** Let timers and frames run (inside `act`), after doing `fn`. */
  wait: (ms: number, fn?: () => void) => Promise<void>;
  text: (selector: string, startsWith: string) => string;
  unmount: () => Promise<void>;
}

async function mount(series: Series): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Preview } = await import("../viewer/AnimeSeriesPreview.js");
  const source = new MemorySource<Series>({ initial: series });
  const host = document.createElement("div");
  host.style.height = "900px";
  document.body.appendChild(host);
  const root = createRoot(host);
  const results: Mounted["results"] = [];
  const props: ViewerPreviewProps = {
    sources: { series: source },
    fileChannel: {} as ViewerPreviewProps["fileChannel"],
    selection: null,
    onSelect: () => {},
    mode: "view",
    imageVersion: 0,
    editing: false,
    readonly: true,
    theme: "dark",
    locale: "en",
    commands: manifest.viewerApi!.commands,
    onActionResult: (id, result) => results.push({ id, result }),
  };
  await act(async () => {
    root.render(createElement(Preview, props));
    await sleep(0);
  });
  return {
    host,
    results,
    request: async (actionRequest) => {
      await act(async () => {
        root.render(createElement(Preview, { ...props, actionRequest }));
        await sleep(0);
      });
    },
    click: async (el) => {
      expect(el).toBeTruthy();
      await act(async () => {
        (el as HTMLElement).click();
        await sleep(0);
      });
    },
    wait: async (ms, fn) => {
      await act(async () => {
        fn?.();
        await sleep(ms);
      });
    },
    text: (selector, startsWith) =>
      Array.from(host.querySelectorAll(selector)).find((e) => e.textContent?.trim().startsWith(startsWith))?.textContent ?? "",
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
      source.destroy();
    },
  };
}

/** Replace `play()` on every media element with one the test settles. */
function holdPlay() {
  const proto = (win as unknown as { HTMLMediaElement: { prototype: HTMLMediaElement } }).HTMLMediaElement.prototype;
  const original = proto.play;
  let settle: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  let calls = 0;
  proto.play = function (this: HTMLMediaElement) {
    calls += 1;
    return new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
  };
  return {
    calls: () => calls,
    resolve: () => settle?.resolve(),
    reject: (e: unknown) => settle?.reject(e),
    restore: () => {
      proto.play = original;
    },
  };
}

const seed = () => loadSeries(readSeriesFiles(SEED_DIR));
const madeFrom = (m: Mounted) => m.text("div", "Made from");

describe("the play action", () => {
  test("answers once the clip has started, and says it is playing", async () => {
    const held = holdPlay();
    const m = await mount(seed());
    try {
      await m.request({ requestId: "p1", actionId: "play", params: { episode: "ep01", from: 0, to: 2 } });
      await m.wait(60);
      expect(held.calls()).toBe(1);
      // play() has not settled: no answer yet — the old viewer replied here, `playing: false`.
      expect(m.results).toEqual([]);
      await m.wait(20, held.resolve);
      expect(m.results).toHaveLength(1);
      expect(m.results[0].id).toBe("p1");
      expect(m.results[0].result.success).toBe(true);
      expect(m.results[0].result.data).toMatchObject({ episode: "ep01", lane: "clip", playing: true });
    } finally {
      held.restore();
      await m.unmount();
    }
  });

  test("a refused start is reported as not playing, with the browser's reason, and the clock stops", async () => {
    const held = holdPlay();
    const m = await mount(seed());
    try {
      await m.request({ requestId: "p2", actionId: "play", params: { episode: "ep01" } });
      await m.wait(60);
      await m.wait(20, () => held.reject(new Error("play() can only be initiated by a user gesture")));
      expect(m.results).toHaveLength(1);
      const { result } = m.results[0];
      expect(result.success).toBe(false);
      expect(result.message).toContain("user gesture");
      expect(result.data).toMatchObject({ playing: false });
      // The view state agrees afterwards: nothing is left "playing" over a frozen frame.
      await m.request({ requestId: "s1", actionId: "get-view-state" });
      expect(m.results[1].result.data).toMatchObject({ playing: false });
    } finally {
      held.restore();
      await m.unmount();
    }
  });
});

describe("the selected shot's stamps", () => {
  test("a re-shot shot is made from its re-shoot — its price and length — in the cut and when opened", async () => {
    const m = await mount(seed());
    try {
      await m.click(m.host.querySelector('button[aria-label="Shot 7"]'));
      expect(madeFrom(m)).toContain("$6.19 / 30.1s");
      await m.click(m.host.querySelector('button[aria-label="Shot 8"]'));
      expect(madeFrom(m)).toContain("$1.25 / 6.1s");
      expect(madeFrom(m)).not.toContain("$6.19");
      const reshoot = Array.from(m.host.querySelectorAll("div.cursor-pointer")).find((d) => d.textContent?.includes("Re-shoot 8"));
      await m.click(reshoot);
      expect(madeFrom(m)).toContain("$1.25 / 6.1s");
      // The shot header names the shot and its seconds — not the raw address.
      const header = m.text("h3", "Shot 8");
      expect(header).toContain("24.0–27.0s");
      expect(header).not.toContain("{");
    } finally {
      await m.unmount();
    }
  });
});

describe("a take that failed after it was sent", () => {
  test("shows its reason and billing in the Takes list, and the spend names it as uncertain", async () => {
    const m = await mount(loadSeries(withFailedTake(readSeriesFiles(SEED_DIR), "provider disconnected after submission")));
    try {
      const takes = m.text("div.rounded-\\[10px\\]", "Takes");
      expect(takes).toContain("Take 2");
      expect(takes).toContain("provider disconnected after submission · billing unknown, counted");
      const spend = m.text("div.rounded-\\[10px\\]", "This episode's spend");
      expect(spend).toContain("Billing uncertain · 1 call");
      expect(spend).toContain("Take 2");
      expect(spend).toContain("$13.77");
    } finally {
      await m.unmount();
    }
  });
});

describe("overlays", () => {
  test("open on the viewer's frame, not inside the scrolling page", async () => {
    const m = await mount(seed());
    try {
      const page = m.host.querySelector("[data-series-scroll]");
      expect(page).toBeTruthy();
      const grid = Array.from(m.host.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Whole grid"));
      await m.click(grid);
      const overlay = Array.from(m.host.querySelectorAll("div")).find((d) => d.className.includes("absolute inset-0 z-40"));
      expect(overlay).toBeTruthy();
      expect(page!.contains(overlay!)).toBe(false);
      expect(overlay!.parentElement).toBe(page!.parentElement);
    } finally {
      await m.unmount();
    }
  });
});
