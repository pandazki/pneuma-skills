/** @jsxImportSource react */
/**
 * The board's look — one button, and what it must never become.
 *
 * The corner used to stack four unlike things at the same weight: the
 * projection switch, a parallax toggle, a theme button and the warning
 * chips. The first attempt at sorting them put a GEAR there opening a
 * "settings" popover, and the product owner killed it on sight —
 * 「你上面一个设置下面一个设置。。。是认真的吗？」. The objection is structural:
 * the Pneuma shell owns a gear thirty pixels straight up in the TopBar, it
 * means APP settings, and a second gear below it means "settings" too with
 * nothing visible separating the two scopes.
 *
 * So the control is named after what it is. Its face is the look the board
 * is WEARING —「绿板 · 行楷」— which makes the entry point a piece of visible
 * state; there is exactly one gear in the window and it is not this one.
 * Test one below is that rule, in the form that fails if anyone reaches for
 * a gear or the word "settings" again.
 *
 * Behind it, two labelled groups split by what persists and who it affects:
 * *This lecture* holds the theme picker (it writes `{set}/theme.css`; the
 * agent reads it, every reader sees it), *Your view* holds parallax
 * (ephemeral, local, nothing written). What stays OUTSIDE is equally pinned:
 * the board ↔ notes switch is the projection and the most common decision
 * here, and the warning chips are signals rather than controls — a
 * degradation you must click open to discover is a silent degradation.
 *
 * The parallax tooltips are asserted byte-for-byte against the ones the old
 * standalone button carried. They are the only place the reduced-motion
 * override is stated, and a reorganisation is exactly the kind of change
 * that quietly loses them.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/** Verbatim from the pre-reorg chrome — see the note above. */
const PARALLAX_TITLE =
  "Rock the board with the pointer. Real depth answers with parallax; a board that only looks tilted does not";
const PARALLAX_TITLE_REDUCED =
  "Your system asks for reduced motion, so the board stays still — transitions keep their existing flat glide";
const TRIGGER_TITLE =
  "The board's look — paper or slate, and the hand it is written in. Writes this lecture's own theme.css";

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

/** Stands in for the real ThemePicker — this file pins the frame, not it. */
const PICKER_TEXT = "the theme picker, with its previews";

interface Mounted {
  host: HTMLElement;
  trigger(): HTMLElement | null;
  panel(): HTMLElement | null;
  group(name: string): HTMLElement | null;
  picker(): HTMLElement | null;
  parallax(): HTMLButtonElement | null;
  opens: boolean[];
  toggles: number;
  click(el: Element): Promise<void>;
  pointerDown(target: EventTarget): Promise<void>;
  escape(): Promise<void>;
  setOpen(open: boolean): Promise<void>;
  unmount(): Promise<void>;
}

interface MountOptions {
  label?: string | null;
  open?: boolean;
  themePicker?: boolean;
  parallax?: { active?: boolean; reduceMotion?: boolean } | null;
}

async function mountLook(opts: MountOptions = {}): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BoardLook } = await import("../viewer/BoardLook.js");

  const state = { opens: [] as boolean[], toggles: 0 };
  const parallaxOpt = opts.parallax === undefined ? {} : opts.parallax;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const render = async (open: boolean): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(BoardLook, {
          label: opts.label === undefined ? "绿板 · 行楷" : opts.label,
          open,
          onOpenChange: (next: boolean) => {
            state.opens.push(next);
            void render(next);
          },
          themePicker:
            opts.themePicker === false
              ? null
              : createElement(
                  "div",
                  { "data-fake-picker": "" },
                  PICKER_TEXT,
                ),
          parallax: parallaxOpt
            ? {
                active: parallaxOpt.active ?? false,
                reduceMotion: parallaxOpt.reduceMotion ?? false,
                onToggle: () => {
                  state.toggles += 1;
                },
              }
            : null,
        }),
      );
    });
  };

  await render(opts.open ?? false);

  const q = <T extends HTMLElement>(sel: string): T | null =>
    host.querySelector<T>(sel);

  return {
    host,
    get opens() {
      return state.opens;
    },
    get toggles() {
      return state.toggles;
    },
    trigger: () => q("[data-bansho-look-trigger]"),
    panel: () => q("[data-bansho-look-panel]"),
    group: (name) => q(`[data-bansho-look-group="${name}"]`),
    picker: () => q("[data-fake-picker]"),
    parallax: () => q<HTMLButtonElement>("[data-bansho-setting='parallax']"),
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
    setOpen: render,
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

describe("the entry point is the look itself, never a second gear", () => {
  test("its face is the name of the look the board is wearing", async () => {
    m = await mountLook({ label: "绿板 · 行楷" });
    expect(m.trigger()!.textContent).toContain("绿板 · 行楷");
  });

  test("it is not a gear, and it does not say settings", async () => {
    // The shell's TopBar owns the only gear in this window, thirty pixels
    // straight up. A second one here means "settings" too, and the scope
    // that distinguishes them is invisible.
    m = await mountLook();
    const face = m.trigger()!.textContent ?? "";
    expect(face.trim().length).toBeGreaterThan(0);
    expect(face.toLowerCase()).not.toContain("setting");
    expect(face).not.toContain("设置");
  });

  test("with no preset installed it still reads as the board's look", async () => {
    m = await mountLook({ label: null });
    const face = (m.trigger()!.textContent ?? "").toLowerCase();
    expect(face).toContain("look");
    expect(face).not.toContain("setting");
  });

  test("it keeps the tooltip that says a theme is written to a file", async () => {
    m = await mountLook();
    expect(m.trigger()!.getAttribute("title")).toBe(TRIGGER_TITLE);
  });

  test("nothing to show and nothing to change: no button at all", async () => {
    m = await mountLook({ themePicker: false, parallax: null });
    expect(m.trigger()).toBeNull();
    expect(m.host.textContent?.trim()).toBe("");
  });
});

describe("one panel, opened and closed on purpose", () => {
  test("closed until asked, and it says so", async () => {
    m = await mountLook();
    expect(m.trigger()!.getAttribute("aria-expanded")).toBe("false");
    expect(m.panel()).toBeNull();
    await m.click(m.trigger()!);
    expect(m.panel()).not.toBeNull();
    expect(m.trigger()!.getAttribute("aria-expanded")).toBe("true");
  });

  test("a second click closes it", async () => {
    m = await mountLook({ open: true });
    await m.click(m.trigger()!);
    expect(m.opens.at(-1)).toBe(false);
    expect(m.panel()).toBeNull();
  });

  test("Escape closes it", async () => {
    m = await mountLook({ open: true });
    await m.escape();
    expect(m.opens.at(-1)).toBe(false);
  });

  test("a press on the board closes it", async () => {
    m = await mountLook({ open: true });
    await m.pointerDown(document.body);
    expect(m.opens.at(-1)).toBe(false);
  });

  test("a press inside the panel does not", async () => {
    m = await mountLook({ open: true });
    await m.pointerDown(m.panel()!);
    expect(m.opens).toEqual([]);
  });
});

describe("two groups, split by what persists and who it affects", () => {
  test("the picker is the lecture's; parallax is only this reader's", async () => {
    m = await mountLook({ open: true });
    const lecture = m.group("lecture")!;
    const view = m.group("view")!;
    expect(lecture.textContent).toContain("This lecture");
    expect(view.textContent).toContain("Your view");
    // Membership, not adjacency: the theme lands in a file every reader of
    // this lecture will see, parallax dies with this tab.
    expect(lecture.contains(m.picker()!)).toBe(true);
    expect(view.contains(m.parallax()!)).toBe(true);
    expect(lecture.contains(m.parallax()!)).toBe(false);
    expect(view.contains(m.picker()!)).toBe(false);
  });

  test("each group states the consequence, not just a name", async () => {
    m = await mountLook({ open: true });
    expect(m.group("lecture")!.textContent).toContain("everyone who opens it");
    expect(m.group("view")!.textContent).toContain("nothing is written");
  });

  test("a lecture nobody can restyle shows no theme group", async () => {
    m = await mountLook({ open: true, themePicker: false });
    expect(m.group("lecture")).toBeNull();
    expect(m.group("view")).not.toBeNull();
  });

  test("the notes projection has no depth to rock, so no view group", async () => {
    m = await mountLook({ open: true, parallax: null });
    expect(m.group("view")).toBeNull();
    expect(m.group("lecture")).not.toBeNull();
  });

  test("controls only — the projection switch and the chips stay outside", async () => {
    // The panel's whole inventory of its OWN controls. A chip or a
    // board/notes segment folded in here would be one click away from
    // being seen, and this is what fails when somebody tries.
    m = await mountLook({ open: true });
    const own = [...m.panel()!.querySelectorAll("button")].filter(
      (el) => !m!.picker()!.contains(el),
    );
    expect(own).toHaveLength(1);
    expect(own[0]!.dataset.banshoSetting).toBe("parallax");
  });
});

describe("parallax is still a switch, and still obeys reduced motion", () => {
  test("it reads its own state out loud and toggles", async () => {
    m = await mountLook({ open: true, parallax: { active: false } });
    expect(m.parallax()!.getAttribute("aria-pressed")).toBe("false");
    expect(m.parallax()!.getAttribute("title")).toBe(PARALLAX_TITLE);
    await m.click(m.parallax()!);
    expect(m.toggles).toBe(1);
    // A viewing pose is not a projection choice: flipping it must not close
    // the panel the reader is still adjusting.
    expect(m.panel()).not.toBeNull();
  });

  test("an active pose says so", async () => {
    m = await mountLook({ open: true, parallax: { active: true } });
    expect(m.parallax()!.getAttribute("aria-pressed")).toBe("true");
  });

  test("reduced motion disables it, and says why on screen and in the tooltip", async () => {
    m = await mountLook({ open: true, parallax: { reduceMotion: true } });
    const el = m.parallax()!;
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("title")).toBe(PARALLAX_TITLE_REDUCED);
    expect(el.textContent).toContain("reduced motion");
    await m.click(el);
    expect(m.toggles).toBe(0);
  });
});
