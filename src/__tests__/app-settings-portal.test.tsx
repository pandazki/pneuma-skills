/** @jsxImportSource react */
/**
 * The App Settings popover has to leave the TopBar to be seen at all.
 *
 * Measured cause of the bug this pins (2026-08-17): the TopBar root is
 * `relative z-20` (`TopBar.tsx`), which makes it a stacking context, and the
 * panel used to be a `position: absolute; z-index: 10000` child of it. A
 * z-index is only ever compared against SIBLINGS inside its own context, so
 * that 10000 resolved as "somewhere inside the layer painted at z=20" — and
 * a viewer's own chrome, painted later at z=30 (bansho's board buttons), cut
 * straight through the panel. Raising the number does nothing; raising the
 * TopBar's z only fixes it against the viewers whose z you happened to see.
 *
 * So the panel is portaled to `<body>` and positioned `fixed` against the
 * gear's rect — the same escape `ShareDropdown` makes in the same file, for
 * the same reason. What is pinned here is exactly that escape:
 *
 *  - the rendered panel is NOT a descendant of the trigger's container, so
 *    no ancestor stacking context can seal it;
 *  - it is `position: fixed` and tracks the anchor's rect (an absolute panel
 *    portaled to body would be positioned against the document, not the
 *    gear);
 *  - it still dismisses — outside click and Escape — and clicking the gear
 *    ITSELF is a close, not a close-then-reopen.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

let win: Window;
let restore: (() => void) | undefined;

beforeAll(async () => {
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
    "location",
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
    install(key, key === "window" ? win : w[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  // The panel loads persisted settings on mount; the network is not what is
  // under test, and a real request would be a slow, flaky dependency.
  install("fetch", async () => ({ ok: true, json: async () => ({}) }));
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
  // The app's own `src/i18n/index.ts` cannot be imported here — it reads its
  // resources through Vite's `import.meta.glob`, which does not exist outside
  // the bundler. Initialise the one namespace this panel reads, from the same
  // catalogue file the app ships, so the labels resolve instead of rendering
  // as raw keys.
  const [{ default: i18n }, { initReactI18next }, { default: appSettings }] =
    await Promise.all([
      import("i18next"),
      import("react-i18next"),
      import("../i18n/locales/en/app-settings.json"),
    ]);
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { "app-settings": appSettings } },
    interpolation: { escapeValue: false },
  });
});

afterAll(() => restore?.());

interface Mounted {
  /** Stands in for the TopBar: a positioned, z-indexed stacking context. */
  host: HTMLElement;
  anchor: HTMLButtonElement;
  panel(): HTMLElement | null;
  closes: number;
  mouseDown(target: EventTarget): Promise<void>;
  escape(): Promise<void>;
  unmount(): Promise<void>;
}

const ANCHOR_RECT = { top: 12, bottom: 36, left: 900, right: 930, width: 30, height: 24, x: 900, y: 12 };

async function mountPanel(): Promise<Mounted> {
  const { act, createElement, createRef } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AppSettings } = await import("../components/AppSettings.js");

  const host = document.createElement("div");
  host.style.position = "relative";
  host.style.zIndex = "20";
  document.body.appendChild(host);

  const anchor = document.createElement("button");
  anchor.getBoundingClientRect = () => ({
    ...ANCHOR_RECT,
    toJSON: () => ANCHOR_RECT,
  }) as DOMRect;
  host.appendChild(anchor);

  const anchorRef = createRef<HTMLElement>();
  (anchorRef as { current: HTMLElement | null }).current = anchor;

  const state = { closes: 0 };
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(AppSettings, {
        anchorRef,
        onClose: () => {
          state.closes += 1;
        },
      }),
    );
  });

  return {
    host,
    anchor,
    get closes() {
      return state.closes;
    },
    panel: () =>
      [...document.body.children].find(
        (el) => el.getAttribute("data-app-settings") !== null,
      ) as HTMLElement | null,
    mouseDown: async (target) => {
      await act(async () => {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
    },
    escape: async () => {
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("the panel escapes the TopBar's stacking context", () => {
  test("it is portaled to <body>, not nested under the trigger's container", async () => {
    mounted = await mountPanel();
    const panel = mounted.panel();
    expect(panel).not.toBeNull();
    // The whole bug in one assertion: while the panel lives inside the
    // TopBar, no z-index it carries can outrank a viewer's chrome outside.
    expect(mounted.host.contains(panel!)).toBe(false);
    expect(panel!.parentElement).toBe(document.body);
  });

  test("it is fixed to the viewport and anchored under the gear", async () => {
    mounted = await mountPanel();
    const panel = mounted.panel()!;
    // `absolute` in a body portal would be positioned against the document,
    // which drifts away from the gear the moment the page scrolls.
    expect(panel.style.position).toBe("fixed");
    expect(panel.style.top).toBe(`${ANCHOR_RECT.bottom + 6}px`);
    expect(panel.style.right).toBe(
      `${win.innerWidth - ANCHOR_RECT.right}px`,
    );
    expect(Number(panel.style.zIndex)).toBeGreaterThan(0);
  });
});

describe("the panel still dismisses", () => {
  test("a click outside closes it", async () => {
    mounted = await mountPanel();
    await mounted.mouseDown(document.body);
    expect(mounted.closes).toBe(1);
  });

  test("a click inside does not", async () => {
    mounted = await mountPanel();
    await mounted.mouseDown(mounted.panel()!);
    expect(mounted.closes).toBe(0);
  });

  test("Escape closes it", async () => {
    mounted = await mountPanel();
    await mounted.escape();
    expect(mounted.closes).toBe(1);
  });

  test("the gear is a toggle: its own click is not an outside click", async () => {
    // Otherwise mousedown closes the panel and the button's own click
    // re-opens it — a gear that can only ever open.
    mounted = await mountPanel();
    await mounted.mouseDown(mounted.anchor);
    expect(mounted.closes).toBe(0);
  });
});
