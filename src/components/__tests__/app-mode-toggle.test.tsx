/** @jsxImportSource react */
/**
 * The viewing-mode escape hatch must not be a hit target while it is
 * invisible, and must not draw below the shell's own line.
 *
 * Measured cause of the bug this pins (2026-08-19, `--viewing` bansho session
 * at 1440px): `AppModeToggle` rendered a fully transparent
 * `position: fixed; top/left/right: 0; height: 48px; z-index: 9999;
 * pointer-events: auto` bar holding the "Edit dashboard" button. Bansho's
 * board control row draws at y 20-46.5 — entirely inside that strip — so
 * `document.elementFromPoint` over the centre and the bottom edge of Board,
 * Notes and the look control returned the overlay every time. A real trusted
 * click on the most inviting control on the board fired Edit dashboard: the
 * session flipped viewing -> editing and the shell spawned an agent inside a
 * session the user had asked only to watch, defeating `--viewing` entirely.
 *
 * Making the strip untouchable was not enough on its own. The button's own
 * box (x 1371.2-1428, y 10-36) overlapped bansho's look control
 * (x 1330.7-1420, y 20-46.5) in board view, and its Notes toggle
 * (centre 1395.2, 33.3) in notes view — so an armed-on-proximity button would
 * have stolen the same clicks while visible. The shell's control is therefore
 * held above `SHELL_EDGE_PX`, which is the same line that triggers the
 * reveal: the shell owns the top edge, everything below belongs to the viewer.
 *
 * happy-dom has no layout and no hit testing, so what is pinned here is the
 * mechanism that decides hit testing — who is `pointer-events: auto`, when,
 * and how far down the shell is allowed to draw. The hit test itself is
 * evidence from a real browser (CDP `elementFromPoint` +
 * `Input.dispatchMouseEvent`), which is the only place it can honestly be
 * taken.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/** The centre of bansho's look control, measured in the session above. */
const LOOK_CENTRE = { x: 1375.3, y: 33.3 };
/** `cc-primary` — the accent the button wears once it is actually engaged. */
const ACCENT = "#f97316";

let win: Window;
let restore: (() => void) | undefined;
let posted: Array<{ url: string; body: unknown }> = [];
/** Swappable per test — see the in-flight case, which never resolves. */
let respond: (() => Promise<{ ok: boolean; json: () => Promise<unknown> }>) | null = null;

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
    "PointerEvent",
    "FocusEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  // The switch POSTs to the session; the network is not what is under test,
  // and a real request would be a slow, flaky dependency.
  install("fetch", (url: string, init?: { body?: string }) => {
    posted.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    if (respond) return respond();
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
  // `src/i18n/index.ts` cannot be imported here — it reads its resources
  // through Vite's `import.meta.glob`, which does not exist outside the
  // bundler. Initialise the one namespace this component reads, from the same
  // catalogue file the app ships, so labels resolve instead of raw keys.
  const [{ default: i18n }, { initReactI18next }, { default: appModeToggle }] =
    await Promise.all([
      import("i18next"),
      import("react-i18next"),
      import("../../i18n/locales/en/app-mode-toggle.json"),
    ]);
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {},
      interpolation: { escapeValue: false },
    });
  }
  i18n.addResourceBundle("en", "app-mode-toggle", appModeToggle, true, true);
});

afterAll(() => restore?.());

interface Mounted {
  container: HTMLElement;
  button: HTMLButtonElement;
  /** Trusted-input stand-in: move the pointer to a viewport point. */
  pointerTo(x: number, y: number): Promise<void>;
  enterButton(): Promise<void>;
  leaveWindow(): Promise<void>;
  focusButton(): Promise<void>;
  blurButton(): Promise<void>;
  click(): Promise<void>;
  unmount(): Promise<void>;
}

async function mount(): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AppModeToggle } = await import("../AppModeToggle.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(AppModeToggle));
  });

  const container = host.firstElementChild as HTMLElement;
  const button = container.querySelector("button") as HTMLButtonElement;

  const dispatch = async (target: EventTarget, type: string, x: number, y: number): Promise<void> => {
    await act(async () => {
      const ev = new win.window.Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
      ev.clientX = x;
      ev.clientY = y;
      target.dispatchEvent(ev as unknown as Event);
    });
  };

  return {
    container,
    button,
    pointerTo: (x, y) => dispatch(window, "pointermove", x, y),
    enterButton: () => dispatch(button, "mouseover", 0, 0),
    leaveWindow: async () => {
      await act(async () => {
        document.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
      });
    },
    focusButton: () => dispatch(button, "focusin", 0, 0),
    blurButton: () => dispatch(button, "focusout", 0, 0),
    click: async () => {
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      // Let the POST's microtasks settle so `switching` comes back down.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
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
  posted = [];
  respond = null;
});

describe("the strip never stands in front of a viewer's chrome", () => {
  test("the container takes no clicks at all", async () => {
    mounted = await mount();
    // The whole defect in one assertion: an always-on `pointer-events: auto`
    // layer here is a hit target the size of whatever width it claims.
    expect(mounted.container.style.pointerEvents).toBe("none");
  });

  test("the container claims no width it does not draw in", async () => {
    mounted = await mount();
    const s = mounted.container.style;
    expect(s.position).toBe("fixed");
    // `left: 0` + `right: 0` + a 48px height is a window-wide bar; the
    // affordance is a button in a corner and should be shaped like one.
    expect(s.left).toBe("");
    expect(s.height).toBe("");
    expect(s.right).toBe("0px");
    expect(s.top).toBe("0px");
  });

  test("the shell draws nothing below its own line", async () => {
    const { SHELL_EDGE_PX } = await import("../AppModeToggle.js");
    mounted = await mount();
    const offset = parseFloat(mounted.container.style.paddingTop || "0");
    const height = parseFloat(mounted.button.style.height || "0");
    expect(height).toBeGreaterThan(0);
    // Binding in both directions: the line that arms the button is also the
    // line it may not draw past. Everything below it is the viewer's.
    expect(offset + height).toBeLessThanOrEqual(SHELL_EDGE_PX);
  });

  test("the button is inert while it is invisible", async () => {
    mounted = await mount();
    expect(mounted.button.style.pointerEvents).toBe("none");
    expect(mounted.button.style.color).toBe("transparent");
  });

  test("reaching for a viewer control does not arm it", async () => {
    mounted = await mount();
    // The exact coordinate that used to fire "Edit dashboard": the centre of
    // bansho's look control, which sat inside the old Edit button's own box.
    await mounted.pointerTo(LOOK_CENTRE.x, LOOK_CENTRE.y);
    expect(mounted.button.style.pointerEvents).toBe("none");
    expect(mounted.button.style.color).toBe("transparent");
  });
});

describe("the top edge still reveals it", () => {
  test("brushing the top edge shows and arms the button", async () => {
    mounted = await mount();
    await mounted.pointerTo(1400, 4);
    expect(mounted.button.style.pointerEvents).toBe("auto");
    expect(mounted.button.style.color).not.toBe("transparent");
  });

  test("the band covers the button and stops right after it", async () => {
    const { SHELL_EDGE_PX } = await import("../AppModeToggle.js");
    mounted = await mount();
    // The button lives inside the band, so the pointer never has to leave the
    // trigger to reach the thing it triggered.
    await mounted.pointerTo(1400, SHELL_EDGE_PX);
    expect(mounted.button.style.pointerEvents).toBe("auto");
    await mounted.pointerTo(1400, SHELL_EDGE_PX + 1);
    expect(mounted.button.style.pointerEvents).toBe("none");
  });

  test("the accent follows the pointer onto the button", async () => {
    mounted = await mount();
    await mounted.pointerTo(1400, 4);
    expect(mounted.button.style.color).not.toBe(ACCENT);
    await mounted.enterButton();
    expect(mounted.button.style.color).toBe(ACCENT);
  });

  test("dropping below the line puts it away, accent and all", async () => {
    mounted = await mount();
    await mounted.pointerTo(1400, 4);
    await mounted.enterButton();
    await mounted.pointerTo(1400, 200);
    expect(mounted.button.style.pointerEvents).toBe("none");
    expect(mounted.button.style.color).toBe("transparent");
  });

  test("leaving the window puts it away", async () => {
    mounted = await mount();
    await mounted.pointerTo(1400, 4);
    await mounted.leaveWindow();
    expect(mounted.button.style.pointerEvents).toBe("none");
  });

  test("keyboard focus reveals it before it can be activated", async () => {
    mounted = await mount();
    // A tab-stop that is invisible AND armed is the same trap by keyboard.
    await mounted.focusButton();
    expect(mounted.button.style.pointerEvents).toBe("auto");
    expect(mounted.button.style.color).toBe(ACCENT);
    await mounted.blurButton();
    expect(mounted.button.style.pointerEvents).toBe("none");
  });
});

describe("a pointer that cannot hover gets the button drawn", () => {
  test("under `hover: none` it is permanently visible and armed", async () => {
    const w = window as unknown as Record<string, unknown>;
    const savedMatchMedia = w.matchMedia;
    w.matchMedia = () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    try {
      mounted = await mount();
      // There is no reveal on a touch screen, so an unrevealed button is not
      // a safer button — it is no way back to editing at all.
      expect(mounted.button.style.pointerEvents).toBe("auto");
      expect(mounted.button.style.color).not.toBe("transparent");
      // And it obeys the same line as the quiet one.
      const { SHELL_EDGE_PX } = await import("../AppModeToggle.js");
      const offset = parseFloat(mounted.container.style.paddingTop || "0");
      expect(offset + parseFloat(mounted.button.style.height)).toBeLessThanOrEqual(SHELL_EDGE_PX);
    } finally {
      w.matchMedia = savedMatchMedia;
    }
  });

  test("a pointer that can hover keeps the quiet affordance", async () => {
    const w = window as unknown as Record<string, unknown>;
    const savedMatchMedia = w.matchMedia;
    w.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    try {
      mounted = await mount();
      expect(mounted.button.style.pointerEvents).toBe("none");
      expect(mounted.button.style.color).toBe("transparent");
    } finally {
      w.matchMedia = savedMatchMedia;
    }
  });
});

describe("the switch itself still works", () => {
  test("clicking it asks the session to start editing", async () => {
    mounted = await mount();
    await mounted.pointerTo(1400, 4);
    await mounted.click();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toContain("/api/session/editing");
    expect(posted[0]!.body).toEqual({ editing: true });
    const { useStore } = await import("../../store/index.js");
    expect(useStore.getState().editing).toBe(true);
  });

  test("a switch in flight keeps the button on screen", async () => {
    mounted = await mount();
    await mounted.pointerTo(1400, 4);
    // Never resolve: this pins the in-flight state, where the pointer is free
    // to drift away while the agent starts.
    respond = () => new Promise(() => {});
    const { act } = await import("react");
    await act(async () => {
      mounted!.button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await mounted.pointerTo(700, 400);
    expect(mounted.button.style.pointerEvents).toBe("auto");
    expect(mounted.button.style.color).not.toBe("transparent");
  });
});
