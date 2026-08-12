/** @jsxImportSource react */
/**
 * The transport's rate control (T4) — a MENU, not a cycle.
 *
 * The ladder grew from four rungs to eight (0.75 … 16) the day judging a
 * five-minute wall stopped being worth five minutes. A forward-only cycle
 * button is a fine control over four values and a chore over eight: the
 * reader who wants to skim would click seven times to reach 16 and one
 * more to fall off the end. So the button became a menu trigger — one
 * click open, one click to any rung — and what this file pins is
 * everything that must survive that change:
 *
 *  - the button FACE still says the current rate, and its `aria-label`
 *    still carries the value (a bare "Playback rate" would override the
 *    visible text and leave a screen reader unable to tell what is set);
 *  - every rung of `RATES` is offered, exactly once, with the active one
 *    marked `aria-checked` — the menu never invents or hides a rate;
 *  - the whole control is keyboard reachable: the trigger opens on
 *    ArrowDown, focus lands on the checked rung, arrows walk the list,
 *    Escape closes and hands focus back;
 *  - the rungs where the recorded voice steps aside (above
 *    `NARRATION_MAX_RATE`) say so BEFORE they are chosen, and only on a
 *    board that actually has a voice.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { BoardTimeline } from "../engine/types.js";
import { NARRATION_MAX_RATE } from "../viewer/clock-gate.js";
import { RATES, type Rate } from "../viewer/player-core.js";
import type { BoardPlayerHandle } from "../viewer/useBoardPlayer.js";

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

const TIMELINE = {
  duration: 40,
  schedule: [],
  seek: () => {},
} as unknown as BoardTimeline;

interface Mounted {
  host: HTMLElement;
  trigger: HTMLElement;
  items(): HTMLElement[];
  rates: number[];
  press(el: Element, key: string): Promise<void>;
  click(el: Element): Promise<void>;
  unmount(): Promise<void>;
}

async function mountTransport(
  rate: Rate = 1,
  narrated = false,
): Promise<Mounted> {
  const { act } = await import("react");
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Timeline } = await import("../viewer/Timeline.js");

  const rates: number[] = [];
  const player: BoardPlayerHandle = {
    ui: { t: 0, playing: true, rate, follow: "live", duration: 40 },
    getT: () => 0,
    onFrame: (listener) => {
      listener(0, 40);
      return () => {};
    },
    onSeek: () => () => {},
    togglePlay: () => {},
    pause: () => {},
    scrubTo: () => {},
    playFrom: () => {},
    goLive: () => {},
    setRate: (next) => rates.push(next),
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(Timeline, { timeline: TIMELINE, player, narrated }),
    );
  });

  const trigger = host.querySelector<HTMLElement>('[aria-haspopup="menu"]');
  if (!trigger) throw new Error("no rate menu trigger");

  return {
    host,
    trigger,
    rates,
    items: () => [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')],
    press: async (el, key) => {
      await act(async () => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
    },
    click: async (el) => {
      await act(async () => {
        (el as HTMLElement).click();
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

describe("the rate control reads out its value", () => {
  test("the face shows the current rate and the label carries it", async () => {
    const m = await mountTransport(4);
    expect(m.trigger.textContent).toContain("4×");
    expect(m.trigger.getAttribute("aria-label")).toBe(
      "Playback rate, currently 4 times",
    );
    expect(m.trigger.getAttribute("aria-expanded")).toBe("false");
    await m.unmount();
  });
});

describe("the menu offers the whole ladder", () => {
  test("every rung, once, with the active one checked", async () => {
    const m = await mountTransport(1.5);
    expect(m.items()).toHaveLength(0); // closed until asked
    await m.click(m.trigger);
    expect(m.trigger.getAttribute("aria-expanded")).toBe("true");
    const items = m.items();
    expect(items).toHaveLength(RATES.length);
    const offered = items.map((el) => Number(el.dataset.rate));
    expect([...offered].sort((a, b) => a - b)).toEqual([...RATES]);
    const checked = items.filter(
      (el) => el.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(Number(checked[0]!.dataset.rate)).toBe(1.5);
    await m.unmount();
  });

  test("choosing a rung sets it and closes the menu", async () => {
    const m = await mountTransport(1);
    await m.click(m.trigger);
    const skim = m.items().find((el) => el.dataset.rate === "16")!;
    await m.click(skim);
    expect(m.rates).toEqual([16]);
    expect(m.items()).toHaveLength(0);
    expect(m.trigger.getAttribute("aria-expanded")).toBe("false");
    await m.unmount();
  });
});

describe("the control stays keyboard reachable", () => {
  test("ArrowDown opens onto the active rung, arrows walk, Escape hands focus back", async () => {
    const m = await mountTransport(1);
    await m.press(m.trigger, "ArrowDown");
    const items = m.items();
    expect(items).toHaveLength(RATES.length);
    const active = () => document.activeElement as HTMLElement;
    expect(active().dataset.rate).toBe("1"); // opened ON the current rate
    // The list runs fastest-first, so "down" is slower — one rung at a time.
    await m.press(active(), "ArrowDown");
    expect(active().dataset.rate).toBe("0.75");
    await m.press(active(), "ArrowUp");
    expect(active().dataset.rate).toBe("1");
    await m.press(active(), "Home");
    expect(active().dataset.rate).toBe("16");
    await m.press(active(), "End");
    expect(active().dataset.rate).toBe("0.75");
    // Enter is a plain button activation — pinned through the click path
    // above; Escape is the one that must restore focus by hand.
    await m.press(active(), "Escape");
    expect(m.items()).toHaveLength(0);
    expect(active()).toBe(m.trigger);
    await m.unmount();
  });
});

describe("the menu tells the truth about the voice before you choose", () => {
  test("on a narrated board the skim rungs are marked silent", async () => {
    const m = await mountTransport(1, true);
    await m.click(m.trigger);
    for (const item of m.items()) {
      const rate = Number(item.dataset.rate);
      const label = item.getAttribute("aria-label") ?? "";
      if (rate > NARRATION_MAX_RATE) {
        expect(item.textContent).toContain("silent");
        expect(label).toContain("narration silent");
      } else {
        expect(item.textContent).not.toContain("silent");
        expect(label).not.toContain("silent");
      }
    }
    await m.unmount();
  });

  test("a board with no voice carries no such note", async () => {
    const m = await mountTransport(1, false);
    await m.click(m.trigger);
    for (const item of m.items()) {
      expect(item.textContent).not.toContain("silent");
    }
    await m.unmount();
  });
});
