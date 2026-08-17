/** @jsxImportSource react */
/**
 * The board's settings popover — and the axis it is organised along.
 *
 * The corner used to be a stack of four unlike things: the projection
 * switch, a parallax toggle, a theme button and the warning chips, all the
 * same size, all equally loud. The product owner asked for the obvious
 * question to be answered by the layout itself:「哪些是设置，哪些是常用功能
 * 的开关」. The answer this file pins is not "fewer buttons" — it is WHAT
 * PERSISTS, AND WHO IT AFFECTS:
 *
 *  - **This lecture** — the theme. It writes `theme.css`, the agent reads
 *    that file, and everyone who ever opens this lecture sees the result.
 *  - **Your view** — parallax. Ephemeral, local, this reader only; nothing
 *    is written and nobody else is affected.
 *
 * Two facts follow, and both are pinned here. A control that changes the
 * lecture and a control that changes your own screen are not the same kind
 * of decision, so they are labelled separately rather than merged into one
 * list. And the popover holds SETTINGS only: the projection switch
 * (board ↔ notes) is the most common decision on the board and stays out in
 * the open, while the warning chips are signals rather than controls and
 * must never be one click away from being seen. Neither can even be handed
 * to this component — it has no input for them — and the panel's inventory
 * is asserted below so nothing drifts in later.
 *
 * The tooltips are asserted byte-for-byte against the ones the buttons
 * carried before the move. They are the only place the reduced-motion
 * override and the "this writes a file" warning are stated to the reader,
 * and a reorganisation is exactly the kind of change that quietly loses
 * them.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/** Verbatim from the pre-reorg chrome — see the note above. */
const THEME_TITLE =
  "The board's look — paper or slate, and the hand it is written in. Writes this lecture's own theme.css";
const PARALLAX_TITLE =
  "Rock the board with the pointer. Real depth answers with parallax; a board that only looks tilted does not";
const PARALLAX_TITLE_REDUCED =
  "Your system asks for reduced motion, so the board stays still — transitions keep their existing flat glide";

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
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "PointerEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

interface Opened {
  picks: number;
  toggles: number;
}

interface Mounted {
  host: HTMLElement;
  gear(): HTMLElement | null;
  panel(): HTMLElement | null;
  group(name: string): HTMLElement | null;
  theme(): HTMLElement | null;
  parallax(): HTMLElement | null;
  seen: Opened;
  click(el: Element): Promise<void>;
  pointerDown(target: EventTarget): Promise<void>;
  escape(): Promise<void>;
  unmount(): Promise<void>;
}

interface MountOptions {
  theme?: { installedLabel?: string | null; pickerOpen?: boolean } | null;
  parallax?: { active?: boolean; reduceMotion?: boolean } | null;
}

async function mountSettings(opts: MountOptions = {}): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BoardSettings } = await import("../viewer/BoardSettings.js");

  const seen: Opened = { picks: 0, toggles: 0 };
  const themeOpt = opts.theme === undefined ? {} : opts.theme;
  const parallaxOpt = opts.parallax === undefined ? {} : opts.parallax;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(BoardSettings, {
        theme: themeOpt
          ? {
              installedLabel: themeOpt.installedLabel ?? null,
              pickerOpen: themeOpt.pickerOpen ?? false,
              onOpenPicker: () => {
                seen.picks += 1;
              },
            }
          : null,
        parallax: parallaxOpt
          ? {
              active: parallaxOpt.active ?? false,
              reduceMotion: parallaxOpt.reduceMotion ?? false,
              onToggle: () => {
                seen.toggles += 1;
              },
            }
          : null,
      }),
    );
  });

  const q = <T extends HTMLElement>(sel: string): T | null =>
    host.querySelector<T>(sel);

  return {
    host,
    seen,
    gear: () => q("[data-bansho-settings-trigger]"),
    panel: () => q("[data-bansho-settings-panel]"),
    group: (name) => q(`[data-bansho-settings-group="${name}"]`),
    theme: () => q("[data-bansho-setting='theme']"),
    parallax: () => q("[data-bansho-setting='parallax']"),
    click: async (el) => {
      await act(async () => {
        (el as HTMLElement).click();
      });
    },
    pointerDown: async (target) => {
      await act(async () => {
        target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
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

let m: Mounted | null = null;

afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe("one gear, opened on purpose", () => {
  test("closed until asked, and it says so", async () => {
    m = await mountSettings();
    expect(m.gear()).not.toBeNull();
    expect(m.gear()!.getAttribute("aria-expanded")).toBe("false");
    expect(m.panel()).toBeNull();
    await m.click(m.gear()!);
    expect(m.panel()).not.toBeNull();
    expect(m.gear()!.getAttribute("aria-expanded")).toBe("true");
  });

  test("the gear is an icon, never a word or an emoji", async () => {
    m = await mountSettings();
    const gear = m.gear()!;
    expect(gear.querySelector("svg")).not.toBeNull();
    expect(gear.textContent?.trim()).toBe("");
  });

  test("no settings to offer, no gear — never an empty panel", async () => {
    m = await mountSettings({ theme: null, parallax: null });
    expect(m.gear()).toBeNull();
    expect(m.host.textContent?.trim()).toBe("");
  });

  test("a second click closes it, and so does Escape", async () => {
    m = await mountSettings();
    await m.click(m.gear()!);
    await m.click(m.gear()!);
    expect(m.panel()).toBeNull();
    await m.click(m.gear()!);
    await m.escape();
    expect(m.panel()).toBeNull();
  });

  test("a click on the board closes it", async () => {
    m = await mountSettings();
    await m.click(m.gear()!);
    await m.pointerDown(document.body);
    expect(m.panel()).toBeNull();
  });
});

describe("two groups, split by what persists and who it affects", () => {
  test("the theme is the lecture's; parallax is only this reader's", async () => {
    m = await mountSettings();
    await m.click(m.gear()!);
    const lecture = m.group("lecture");
    const view = m.group("view");
    expect(lecture).not.toBeNull();
    expect(view).not.toBeNull();
    expect(lecture!.textContent).toContain("This lecture");
    expect(view!.textContent).toContain("Your view");
    // Membership, not adjacency: the theme lands in a file every reader of
    // this lecture will see, parallax dies with this tab.
    expect(lecture!.contains(m.theme()!)).toBe(true);
    expect(view!.contains(m.parallax()!)).toBe(true);
    expect(lecture!.contains(m.parallax()!)).toBe(false);
    expect(view!.contains(m.theme()!)).toBe(false);
  });

  test("a group with nothing in it does not appear", async () => {
    m = await mountSettings({ parallax: null });
    await m.click(m.gear()!);
    expect(m.group("lecture")).not.toBeNull();
    expect(m.group("view")).toBeNull();
    expect(m.parallax()).toBeNull();
  });

  test("settings only — the projection switch and the chips stay outside", async () => {
    // The panel's whole inventory. A chip or a board/notes segment folded
    // in here would be one click away from being seen, and this is what
    // fails when somebody tries.
    m = await mountSettings();
    await m.click(m.gear()!);
    const controls = [...m.panel()!.querySelectorAll("button")];
    expect(controls).toHaveLength(2);
    expect(new Set(controls.map((el) => el.dataset.banshoSetting))).toEqual(
      new Set(["theme", "parallax"]),
    );
  });
});

describe("the theme row still says what it writes", () => {
  test("the tooltip survived the move, word for word", async () => {
    m = await mountSettings();
    await m.click(m.gear()!);
    expect(m.theme()!.getAttribute("title")).toBe(THEME_TITLE);
  });

  test("it names the look this lecture is wearing", async () => {
    m = await mountSettings({ theme: { installedLabel: "松烟" } });
    await m.click(m.gear()!);
    expect(m.theme()!.textContent).toContain("松烟");
  });

  test("a hand-written theme is not given an invented name", async () => {
    m = await mountSettings({ theme: { installedLabel: null } });
    await m.click(m.gear()!);
    expect(m.theme()!.textContent?.trim()).toBe("Theme");
  });

  test("opening the picker closes the popover — one panel at a time", async () => {
    m = await mountSettings();
    await m.click(m.gear()!);
    await m.click(m.theme()!);
    expect(m.seen.picks).toBe(1);
    expect(m.panel()).toBeNull();
  });

  test("it reports the picker's state while the picker is open", async () => {
    m = await mountSettings({ theme: { pickerOpen: true } });
    await m.click(m.gear()!);
    expect(m.theme()!.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("parallax is still a switch, and still obeys reduced motion", () => {
  test("it reads its own state out loud and toggles", async () => {
    m = await mountSettings({ parallax: { active: false } });
    await m.click(m.gear()!);
    expect(m.parallax()!.getAttribute("aria-pressed")).toBe("false");
    expect(m.parallax()!.getAttribute("title")).toBe(PARALLAX_TITLE);
    await m.click(m.parallax()!);
    expect(m.seen.toggles).toBe(1);
    // A viewing pose is not a projection choice: flipping it must not
    // close the panel the reader is still adjusting.
    expect(m.panel()).not.toBeNull();
  });

  test("an active pose says so", async () => {
    m = await mountSettings({ parallax: { active: true } });
    await m.click(m.gear()!);
    expect(m.parallax()!.getAttribute("aria-pressed")).toBe("true");
  });

  test("reduced motion disables it, and the tooltip explains why", async () => {
    m = await mountSettings({ parallax: { reduceMotion: true } });
    await m.click(m.gear()!);
    const el = m.parallax() as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("title")).toBe(PARALLAX_TITLE_REDUCED);
    await m.click(el);
    expect(m.seen.toggles).toBe(0);
  });
});
