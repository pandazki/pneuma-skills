/** @jsxImportSource react */
/**
 * T6, the whole seam: THE BOARD AND THE CHAT NAME THE SAME THING.
 *
 * Pointing is single-selection by contract — `selectedRef: StepRef | null`,
 * one step or none. The chat's context chip is a pure function of that
 * value (`selectionForStep`), so the chip cannot lie. The board's outline
 * is not: it lives on the DOM node (the step nodes are factory-built and
 * managed imperatively, which is what makes the zero-replay rebuild
 * structural), so it is only as true as the sweep that clears it.
 *
 * What this file pins is the AGREEMENT between the two, not the sweep. It
 * was a wall that broke them apart: the clear queried `boardRef`, which is
 * panel 0 — an alias that reads like "the board" and means "the first
 * board". On a `@board 4` lecture every outline set on panels 1–3 stayed
 * on, so a handful of clicks left the board claiming six selections while
 * the chip named one, and clearing the chip left six standing with none of
 * them current. Asserting "the clear reaches every panel" would pin the
 * fix; asserting "the marks name what the chat names" pins the PROPERTY,
 * and would have caught it through any other mechanism too.
 *
 * happy-dom has no layout engine, so geometry is stubbed at the prototype
 * (collision-mark.test.tsx's device — every element reports the same
 * synthetic box). Panel assignment does not depend on it: `@board` and
 * `@turn` are stage directions, so which board a step stands on is
 * decided by the source, not by the pixels. The guard below proves the
 * fixture really did spread across boards, because a fixture that quietly
 * collapsed to one panel would pass this suite WITHOUT the fix.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import type { EnvCaps, StepRef } from "../engine/types.js";
import { parseStepKey } from "../viewer/address.js";
import { selectionForStep } from "../viewer/context.js";

/** Four boards, two named regions each — the shape of a real lecture. */
const WALL = [
  "@board 4",
  "",
  "@at left",
  "",
  "## Queue length",
  "",
  "Work waits in line before anyone touches it.",
  "",
  "@at right",
  "",
  "## Batch size",
  "",
  "A big batch waits for its slowest member.",
  "",
  "@turn",
  "",
  "@at left",
  "",
  "## Utilization",
  "",
  "A fully booked team is a slow team.",
  "",
  "@at right",
  "",
  "## Handoffs",
  "",
  "Every interface between two teams is a queue.",
  "",
  "@turn",
  "",
  "@at left",
  "",
  "## Lead time",
  "",
  "Count from the day it entered the queue.",
  "",
  "@at right",
  "",
  "## Touch time",
  "",
  "Count the days a hand was actually on it.",
  "",
  "@turn",
  "",
  "@at left",
  "",
  "## Three numbers",
  "",
  "Chain length, queue fill, work in flight.",
  "",
  "@at right",
  "",
  "## The answer",
  "",
  "To make a team faster, first make it idler.",
  "",
].join("\n");

/** One more passage — the streaming append the rebuild has to survive. */
const WALL_APPENDED = [WALL, "One more line arrives while you are pointing.", ""].join(
  "\n",
);

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

/** One synthetic box every element reports — the whole layout engine. */
const BOX_W = 1200;
const BOX_H = 44;

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
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  install("IS_REACT_ACT_ENVIRONMENT", true);

  // Installed on the PROTOTYPE so it is in force from the first render —
  // the fold runs inside the mount effect, before a test could reach an
  // individual element.
  const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
  const stubbed: [string, PropertyDescriptor | undefined][] = [];
  const defineOn = (key: string, descriptor: PropertyDescriptor): void => {
    stubbed.push([key, Object.getOwnPropertyDescriptor(proto, key)]);
    Object.defineProperty(proto, key, { configurable: true, ...descriptor });
  };
  for (const key of ["offsetWidth", "clientWidth", "scrollWidth"]) {
    defineOn(key, { get: () => BOX_W });
  }
  for (const key of ["offsetHeight", "clientHeight", "scrollHeight"]) {
    defineOn(key, { get: () => BOX_H });
  }
  defineOn("getBoundingClientRect", {
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: BOX_W,
      bottom: BOX_H,
      width: BOX_W,
      height: BOX_H,
      toJSON: () => ({}),
    }),
    writable: true,
  });

  restore = () => {
    for (const [key, descriptor] of stubbed) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else delete proto[key];
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

interface Mounted {
  host: HTMLElement;
  /** The board's claim: every outline standing on the wall, as a label. */
  boardSays(): string[];
  /** The chat's claim: the context chip built from `selectedRef`. */
  chatSays(): string | null;
  /**
   * Which board each CLICKABLE step stands on — the fixture's own vacuity
   * guard, and the click targets. `.bansho-step` is the filter a user's
   * finger applies for free: the stage directions (`@board`, `@turn`) also
   * carry a ref, but they mount as `display: none` spans on panel 0 and no
   * click can ever land on one.
   */
  refsByPanel(): string[][];
  click(ref: string): Promise<void>;
  clickBareBoard(): Promise<void>;
  /** Re-render with a longer source — the streaming rebuild. */
  append(source: string): Promise<void>;
  unmount(): Promise<void>;
}

/**
 * The real BoardCanvas under a host that holds selection exactly the way
 * BanshoPreview does: `onSelectStep` → state → back down as `selectedRef`,
 * and the chip read off that same state. Mounting the preview itself would
 * drag in the player, the sources and the ask bar without making the
 * assertion any truer — the chip is `selectionForStep(lecture, selected)`
 * wherever it is rendered.
 */
async function mountWall(source: string, name: string): Promise<Mounted> {
  const react = await import("react");
  const { act, useCallback, useState, createElement } = react;
  const { createRoot } = await import("react-dom/client");
  const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  // What the host currently believes is selected — the single value both
  // surfaces are supposed to be reporting.
  let selected: StepRef | null = null;
  let lecture = parseLecture(source, name);

  function Host({ text }: { text: string }): React.ReactElement {
    lecture = parseLecture(text, name);
    const [ref, setRef] = useState<StepRef | null>(null);
    selected = ref;
    const onSelectStep = useCallback((next: StepRef | null): void => {
      // BanshoPreview's `handleSelectStep` verbatim: a click only points
      // at something the chat could actually describe.
      const picked = next ? selectionForStep(parseLecture(text, name), next) : null;
      setRef(picked ? next : null);
    }, [text]);
    return createElement(BoardCanvas, {
      lecture,
      view: "board",
      theme: "dark",
      fontsReady: true,
      env: ENV,
      getPlayheadT: () => 99999,
      onCompiled: () => {},
      activeIndex: 0,
      playing: false,
      follow: "detached",
      onSeek: () => () => {},
      onFrame: () => () => {},
      selectedRef: ref,
      onSelectStep,
    });
  }

  const render = async (text: string): Promise<void> => {
    await act(async () => {
      root.render(createElement(Host, { text }));
    });
  };
  await render(source);

  const stepNode = (ref: string): Element => {
    const node = host.querySelector(`[data-bansho-ref="${ref}"]`);
    if (!node) throw new Error(`no step node for ${ref}`);
    return node;
  };
  const labelOf = (ref: StepRef | null): string | null =>
    ref ? (selectionForStep(lecture, ref)?.label ?? null) : null;

  return {
    host,
    boardSays: () =>
      Array.from(host.querySelectorAll("[data-bansho-selected]")).map((node) => {
        const ref = parseStepKey(node.getAttribute("data-bansho-ref"));
        return labelOf(ref) ?? `unnamed(${node.getAttribute("data-bansho-ref")})`;
      }),
    chatSays: () => labelOf(selected),
    refsByPanel: () =>
      Array.from(host.querySelectorAll(".bansho-panel")).map((panel) =>
        Array.from(panel.querySelectorAll(".bansho-step[data-bansho-ref]")).map(
          (node) => node.getAttribute("data-bansho-ref") ?? "",
        ),
      ),
    async click(ref) {
      await act(async () => {
        stepNode(ref).dispatchEvent(
          new win.MouseEvent("click", { bubbles: true }) as unknown as Event,
        );
      });
    },
    async clickBareBoard() {
      const panel = host.querySelector(".bansho-panel");
      if (!panel) throw new Error("no panel to click");
      await act(async () => {
        panel.dispatchEvent(
          new win.MouseEvent("click", { bubbles: true }) as unknown as Event,
        );
      });
    },
    append: render,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

/** One step from each board — the walk a user makes across a wall. */
function oneRefPerPanel(byPanel: string[][]): string[] {
  return byPanel.map((refs) => {
    const ref = refs[0];
    if (!ref) throw new Error("a board with nothing on it");
    return ref;
  });
}

describe("pointing (T6) — the board and the chat name the same thing", () => {
  test("four clicks across four boards leave exactly one outline, and it is the one the chat names", async () => {
    const m = await mountWall(WALL, "pointing-wall");
    try {
      // VACUITY GUARD. This whole suite is about marks on boards the
      // clear used to miss; a fixture that landed every step on panel 0
      // would go green against the very bug it exists to catch.
      const byPanel = m.refsByPanel();
      expect(byPanel.length).toBe(4);
      for (const refs of byPanel) expect(refs.length).toBeGreaterThan(0);

      // Nothing is pointed at yet, and the board agrees.
      expect(m.chatSays()).toBe(null);
      expect(m.boardSays()).toEqual([]);

      for (const ref of oneRefPerPanel(byPanel)) {
        await m.click(ref);
        const chat = m.chatSays();
        // The click landed on something the chat can describe — otherwise
        // the agreement below is the trivial "both say nothing".
        expect(chat).not.toBe(null);
        // THE INVARIANT: the wall wears exactly the chat's one claim.
        expect(m.boardSays()).toEqual([chat as string]);
      }
    } finally {
      await m.unmount();
    }
  });

  test("clearing the selection takes every outline off the wall, not just the first board's", async () => {
    const m = await mountWall(WALL, "pointing-clear");
    try {
      const byPanel = m.refsByPanel();
      const [first, , third] = oneRefPerPanel(byPanel);
      // Point at a step on a LATER board — the case the old sweep could
      // not reach — then at one on the first, so a clear that only swept
      // panel 0 would look right there and leave the other standing.
      await m.click(third!);
      await m.click(first!);
      expect(m.boardSays()).toEqual([m.chatSays() as string]);

      // The user sends the message and the chip goes away (BanshoPreview
      // drops `selectedRef` with it). This is the end state the board was
      // caught lying in: outlines standing for a selection that is gone.
      await m.clickBareBoard();
      expect(m.chatSays()).toBe(null);
      expect(m.boardSays()).toEqual([]);
    } finally {
      await m.unmount();
    }
  });

  test("a rebuild while pointing keeps the one outline, and keeps it on the same step", async () => {
    const m = await mountWall(WALL, "pointing-rebuild");
    try {
      const byPanel = m.refsByPanel();
      const target = oneRefPerPanel(byPanel)[3]!;
      await m.click(target);
      const before = m.chatSays();
      expect(before).not.toBe(null);
      expect(m.boardSays()).toEqual([before as string]);

      // The agent writes another line while the user is pointing. R1's
      // rebuild re-applies the mark; what must NOT happen is a second one.
      await m.append(WALL_APPENDED);
      expect(m.chatSays()).toBe(before);
      expect(m.boardSays()).toEqual([before as string]);

      // And pointing somewhere else afterwards still moves the ONE
      // outline — a rebuild must not leave a mark the next clear cannot
      // find. Board 1, so the move crosses boards in the other direction.
      await m.click(oneRefPerPanel(m.refsByPanel())[0]!);
      const after = m.chatSays();
      expect(after).not.toBe(before);
      expect(m.boardSays()).toEqual([after as string]);
    } finally {
      await m.unmount();
    }
  });
});
