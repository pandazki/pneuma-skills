/** @jsxImportSource react */
/**
 * The 讲稿 drawer — what a fold is allowed to cost.
 *
 * The pane used to be a permanent left column and it took roughly a quarter
 * of the row at every window size; on a 2×2 wall that is the difference
 * between reading the board and squinting at it. Folding it away is easy.
 * Folding it away WITHOUT deleting anything is what this file pins:
 *
 *  - shut by default, and the pane's DOM is genuinely gone — not clipped.
 *    Clipping would keep paying the line split (~15×/s during playback) for
 *    a pane nobody can see;
 *  - a way back that a reader can find without being told: a permanent
 *    handle carrying the visible word "Script", `aria-expanded` saying which
 *    way it is, and `aria-controls` naming what it opens;
 *  - the board's issue count survives the fold. It lived in the pane's
 *    header, so folding the pane away would have folded away the only place
 *    a reader learns something on the board could not be drawn — silent
 *    degradation by layout change;
 *  - the correlation still works when it IS open: the line the pen is on is
 *    highlighted, and it moves when the pen moves. That is the capability an
 *    exclusive third tab would have destroyed, and the reason this is a
 *    drawer at all;
 *  - the choice is remembered, so an author who opens it does not re-open it
 *    on every reload — and a storage that throws costs the drawer nothing.
 *
 * happy-dom has no layout engine, so widths here are the STYLE the drawer
 * writes (0 shut, 320 open), not measured pixels. The claim "the board
 * actually reclaims the space" is a geometry claim and is measured where
 * geometry exists — `harness/two-width.sh`, run drawer-open and
 * drawer-closed, where byte-identical captures also prove the fold cannot
 * reach the canonical lecture.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { SrcSpan } from "../engine/types.js";

/** A script with a dialect mark and several lines to move the pen between. */
const SOURCE = [
  "# 排队",
  "",
  "工作在有人动它之前先排队。",
  "",
  "==批量越大，等得越久。==",
  "",
].join("\n");

const lineSpanFor = (needle: string): SrcSpan => {
  const start = SOURCE.indexOf(needle);
  if (start < 0) throw new Error(`fixture has no line ${needle}`);
  return { start, end: start + needle.length };
};

let win: Window;
let restore: (() => void) | undefined;

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const install = (key: string, value: unknown): void => {
    saved[key] = g[key];
    g[key] = value;
  };
  const w = win as unknown as Record<string, unknown>;
  for (const key of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);

  // happy-dom has no layout, so `scrollIntoView` is absent on the prototype
  // — the pane calls it to keep the performed line in view.
  const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
  const hadScroll = Object.getOwnPropertyDescriptor(proto, "scrollIntoView");
  if (!hadScroll) proto.scrollIntoView = () => {};

  restore = () => {
    if (!hadScroll) delete proto.scrollIntoView;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterEach(() => {
  window.localStorage.clear();
});

afterAll(() => restore?.());

interface Mounted {
  host: HTMLElement;
  /** The handle — the whole of "there is something here". */
  handle(): HTMLElement;
  /** The clip that carries the drawer's width, open or shut. */
  clip(): HTMLElement;
  /** `true` when the pane's own DOM is mounted (not merely clipped). */
  paneMounted(): boolean;
  /** The script text the pane renders, if any. */
  scriptText(): string;
  /** The text of every highlighted (`now`) run — the pen's line. */
  litText(): string;
  /** The issue count as the collapsed handle reports it, or `null`. */
  handleIssues(): string | null;
  click(): Promise<void>;
  /** Re-render with a different performed span — the pen moving. */
  setSpan(span: SrcSpan | null): Promise<void>;
  unmount(): Promise<void>;
}

async function mount(
  opts: { issueCount?: number; span?: SrcSpan | null; reduceMotion?: boolean } = {},
): Promise<Mounted> {
  const react = await import("react");
  const { act, createElement, useState } = react;
  const { createRoot } = await import("react-dom/client");
  const { default: ScriptDrawer } = await import("../viewer/ScriptDrawer.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  let setSpanExternal: ((span: SrcSpan | null) => void) | null = null;
  function Host(): React.ReactElement {
    const [span, setSpan] = useState<SrcSpan | null>(opts.span ?? null);
    setSpanExternal = setSpan;
    return createElement(ScriptDrawer, {
      source: SOURCE,
      activeSpan: span,
      issueCount: opts.issueCount ?? 0,
      reduceMotion: opts.reduceMotion ?? true,
    });
  }

  await act(async () => {
    root.render(createElement(Host));
  });

  const handle = (): HTMLElement => {
    const node = host.querySelector<HTMLElement>(
      '[data-testid="bansho-script-toggle"]',
    );
    if (!node) throw new Error("the drawer has no handle — there is no way back in");
    return node;
  };

  return {
    host,
    handle,
    clip: () => {
      const id = handle().getAttribute("aria-controls");
      const node = id
        ? (document.getElementById(id) as HTMLElement | null)
        : null;
      if (!node) throw new Error("aria-controls names nothing in the document");
      return node;
    },
    paneMounted: () => host.textContent?.includes("what the agent wrote") ?? false,
    scriptText: () =>
      Array.from(host.querySelectorAll(".overflow-y-auto span"))
        .map((n) => n.textContent ?? "")
        .join(""),
    litText: () =>
      Array.from(host.querySelectorAll('[class*="bg-cc-primary/20"]'))
        .map((n) => n.textContent ?? "")
        .join(""),
    handleIssues: () =>
      handle().querySelector('[data-testid="bansho-script-issues"]')?.textContent ??
      null,
    async click() {
      await act(async () => {
        handle().dispatchEvent(
          new win.MouseEvent("click", { bubbles: true }) as unknown as Event,
        );
      });
    },
    async setSpan(span) {
      await act(async () => {
        setSpanExternal?.(span);
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("the script drawer — shut by default, and findable", () => {
  test("first visit: the pane is GONE, not clipped, and the wall has the row", async () => {
    const m = await mount();
    expect(m.handle().getAttribute("aria-expanded")).toBe("false");
    expect(m.clip().style.width).toBe("0px");
    // Not merely hidden: nothing of the pane is mounted, so its per-line
    // re-split never runs for a reader who never opens it.
    expect(m.paneMounted()).toBe(false);
    expect(m.scriptText()).toBe("");
    await m.unmount();
  });

  test("the handle says what it is in visible words, and what it controls", async () => {
    const m = await mount();
    const handle = m.handle();
    // The accessible name is the VISIBLE word — an aria-label saying
    // something else would override the only thing on screen.
    expect(handle.textContent).toContain("Script");
    expect(handle.getAttribute("aria-label")).toBeNull();
    // aria-controls has to name a node that actually exists (the clip
    // getter throws otherwise) — pinned by calling it.
    expect(m.clip()).not.toBeNull();
    expect(handle.getAttribute("title")).toBeTruthy();
    // Focus styling goes through `ring`, never `outline`: `src/index.css`
    // kills outlines globally with un-layered CSS (frontend rules).
    expect(handle.className).toContain("focus-visible:ring-");
    expect(handle.className).not.toContain("focus-visible:outline-");
    await m.unmount();
  });

  test("one click opens it, one closes it — and the pane comes with it", async () => {
    const m = await mount();
    await m.click();
    expect(m.handle().getAttribute("aria-expanded")).toBe("true");
    expect(m.clip().style.width).toBe("320px");
    expect(m.paneMounted()).toBe(true);
    expect(m.scriptText()).toBe(SOURCE);

    await m.click();
    expect(m.handle().getAttribute("aria-expanded")).toBe("false");
    expect(m.clip().style.width).toBe("0px");
    expect(m.paneMounted()).toBe(false);
    await m.unmount();
  });
});

describe("what the fold must not take with it", () => {
  test("the issue count survives on the handle while the pane is shut", async () => {
    // The count lived in the pane's header. Shut, that header does not
    // exist — and a reader who is never told a formula failed to render
    // reads a broken board as a finished one.
    const m = await mount({ issueCount: 3 });
    expect(m.handleIssues()).toBe("3");
    await m.unmount();
  });

  test("no issues, no badge — the spine does not invent a warning", async () => {
    const m = await mount({ issueCount: 0 });
    expect(m.handleIssues()).toBeNull();
    await m.unmount();
  });

  test("open, the count moves into the pane's header and is not said twice", async () => {
    const m = await mount({ issueCount: 2 });
    await m.click();
    expect(m.handleIssues()).toBeNull();
    expect(m.host.textContent).toContain("2 issues");
    await m.unmount();
  });

  test("open, the pen's line is lit — and the highlight follows the pen", async () => {
    // THE reason this is a drawer and not a third tab: script-sync
    // correlates the script with the board in real time, and an exclusive
    // tab would make seeing both impossible by construction.
    const first = lineSpanFor("工作在有人动它之前先排队。");
    const m = await mount({ span: first });
    await m.click();
    expect(m.litText()).toContain("工作在有人动它之前先排队。");

    const second = lineSpanFor("==批量越大，等得越久。==");
    await m.setSpan(second);
    expect(m.litText()).toContain("批量越大，等得越久。");
    expect(m.litText()).not.toContain("工作在有人动它");

    // …and nothing is lost from the script itself while a line is lit.
    expect(m.scriptText()).toBe(SOURCE);
    await m.unmount();
  });
});

describe("the author's choice is remembered", () => {
  test("opened once, a fresh mount comes up open", async () => {
    const first = await mount();
    await first.click();
    await first.unmount();

    const second = await mount();
    expect(second.handle().getAttribute("aria-expanded")).toBe("true");
    expect(second.paneMounted()).toBe(true);
    await second.unmount();
  });

  test("closed again, a fresh mount comes up shut", async () => {
    const first = await mount();
    await first.click();
    await first.click();
    await first.unmount();

    const second = await mount();
    expect(second.handle().getAttribute("aria-expanded")).toBe("false");
    await second.unmount();
  });

  test("a storage that throws costs the memory, never the drawer", async () => {
    const { readScriptOpen, writeScriptOpen } = await import(
      "../viewer/ScriptDrawer.js"
    );
    const storage = window.localStorage;
    const hostile = {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {
        throw new Error("storage disabled");
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: hostile,
      configurable: true,
    });
    try {
      expect(readScriptOpen()).toBe(false);
      expect(() => writeScriptOpen(true)).not.toThrow();
      const m = await mount();
      expect(m.handle().getAttribute("aria-expanded")).toBe("false");
      await m.click();
      expect(m.handle().getAttribute("aria-expanded")).toBe("true");
      await m.unmount();
    } finally {
      Object.defineProperty(window, "localStorage", {
        value: storage,
        configurable: true,
      });
    }
  });
});

describe("motion", () => {
  test("reduced motion gets no slide at all", async () => {
    const m = await mount({ reduceMotion: true });
    expect(m.clip().style.transitionProperty).toBe("none");
    await m.unmount();
  });

  test("otherwise the width is what slides — and only the width", async () => {
    const m = await mount({ reduceMotion: false });
    expect(m.clip().style.transitionProperty).toBe("width");
    await m.unmount();
  });
});
