/** @jsxImportSource react */
/**
 * C1′ — the board is grabbable. The camera arithmetic and the slop policy
 * are pure and pinned in camera.test.ts; what this file pins is the WIRING,
 * because every objection C1 raised against drag-panning lives in the
 * wiring rather than in the arithmetic:
 *
 *  - a press that travels pans the stage, and the board follows the hand;
 *  - a press that does NOT travel is still T6's click and still reports the
 *    step it landed on — the whole mode's core interaction;
 *  - the click that ends a pan is swallowed (letting go of the board is not
 *    pointing at it);
 *  - a finger gets the wider slop, so ordinary taps keep pointing;
 *  - alt+drag is inert here, which is what leaves the native text selection
 *    intact as the copy path.
 *
 * happy-dom has no layout engine, so the viewbox is stubbed onto the two
 * elements the camera actually reads (`liveViewbox`: the panel's offset
 * size, the viewport's client size). That is the minimum fiction needed to
 * make a clamped pan observable; the pixels themselves stay G7's job.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import type { EnvCaps } from "../engine/types.js";
import type { StepRef } from "../engine/types.js";
import { GESTURE_GIVE } from "../viewer/camera.js";

const SOURCE = [
  "# Grab",
  "",
  "The board is a canvas you can take in your hand.",
  "",
  "- One line",
  "- Another line",
  "",
].join("\n");

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

/** The stubbed stage: a tall board inside a short viewport. */
const PANEL_W = 800;
const PANEL_H = 3000;
const VIEW_W = 800;
const VIEW_H = 600;

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
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

/** Give an element a layout reading happy-dom will never compute. */
function stubSize(el: Element, props: Record<string, number>): void {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }
}

/** happy-dom's PointerEvent drops the Mouse/Pointer init fields — patch. */
function pointerEvent(
  type: string,
  fields: Record<string, unknown>,
): Event {
  const event = new win.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
  }) as unknown as Record<string, unknown>;
  const all = {
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    altKey: false,
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) {
    Object.defineProperty(event, key, { value, configurable: true });
  }
  return event as unknown as Event;
}

interface Mounted {
  host: HTMLElement;
  viewport: HTMLElement;
  stage: HTMLElement;
  panel: HTMLElement;
  surface: HTMLElement;
  grabs: number[];
  points: (StepRef | null)[];
  /** Re-render with fresh lecture bytes — the agent appending a line. It
   *  runs the compile effect, and with it the post-rebuild camera re-clamp. */
  append(source: string): Promise<void>;
  unmount(): Promise<void>;
}

async function mountBoard(name: string): Promise<Mounted> {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const grabs: number[] = [];
  const points: (StepRef | null)[] = [];

  const paint = async (source: string): Promise<void> => {
    await act(async () => {
      root.render(
        <BoardCanvas
          lecture={parseLecture(source, name)}
          view="board"
          theme="light"
          fontsReady={true}
          env={ENV}
          getPlayheadT={() => 999}
          onCompiled={() => {}}
          activeIndex={0}
          playing={false}
          follow="detached"
          onSeek={() => () => {}}
          onFrame={() => () => {}}
          selectedRef={null}
          onSelectStep={(ref) => points.push(ref)}
          onGrab={() => grabs.push(1)}
        />,
      );
    });
  };
  await paint(SOURCE);

  const surface = host.querySelector(".bansho-board-surface") as HTMLElement;
  const viewport = host.querySelector(".bansho-viewport") as HTMLElement;
  const stage = host.querySelector(".bansho-stage") as HTMLElement;
  const panel = host.querySelector(".bansho-panel") as HTMLElement;
  stubSize(panel, { offsetWidth: PANEL_W, offsetHeight: PANEL_H });
  stubSize(viewport, { clientWidth: VIEW_W, clientHeight: VIEW_H });

  return {
    host,
    viewport,
    stage,
    panel,
    surface,
    grabs,
    points,
    async append(source: string) {
      await paint(source);
      // The stubs live on the element objects; re-stub in case the rebuild
      // handed React a fresh node, so a lost fiction can never masquerade
      // as a moved camera.
      stubSize(
        host.querySelector(".bansho-panel") as HTMLElement,
        { offsetWidth: PANEL_W, offsetHeight: PANEL_H },
      );
      stubSize(
        host.querySelector(".bansho-viewport") as HTMLElement,
        { clientWidth: VIEW_W, clientHeight: VIEW_H },
      );
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Press, move through the given points, release — one whole gesture. */
async function drag(
  m: Mounted,
  from: { x: number; y: number },
  moves: { x: number; y: number }[],
  options: { pointerType?: string; altKey?: boolean; button?: number } = {},
): Promise<void> {
  const { act } = await import("react");
  const base = {
    pointerType: options.pointerType ?? "mouse",
    altKey: options.altKey ?? false,
    button: options.button ?? 0,
  };
  await act(async () => {
    m.viewport.dispatchEvent(
      pointerEvent("pointerdown", { ...base, clientX: from.x, clientY: from.y }),
    );
    for (const move of moves) {
      window.dispatchEvent(
        pointerEvent("pointermove", {
          ...base,
          clientX: move.x,
          clientY: move.y,
        }),
      );
    }
    const last = moves[moves.length - 1] ?? from;
    window.dispatchEvent(
      pointerEvent("pointerup", { ...base, clientX: last.x, clientY: last.y }),
    );
  });
}

/** The click the browser fires after a press+release on the same node. */
async function clickStep(m: Mounted): Promise<void> {
  const { act } = await import("react");
  const step = m.panel.querySelector("[data-bansho-ref]")!;
  await act(async () => {
    step.dispatchEvent(
      new win.MouseEvent("click", { bubbles: true }) as unknown as Event,
    );
  });
}

/** The camera z the stage transform is currently showing. */
function cameraZ(stage: HTMLElement): number {
  const match = /scale\(([\d.]+)\)/.exec(stage.style.transform);
  return match ? Number(match[1]) : 1;
}

/** The camera y the stage transform is currently showing. */
function cameraY(stage: HTMLElement): number {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(
    stage.style.transform,
  );
  if (!match) return 0;
  // translate is -y*z, so y = -translateY / z. `+ 0` normalizes the -0 a
  // negated zero produces, which is a real value and a fake failure.
  return -Number(match[2]) / Number(match[3]) + 0;
}

describe("the grab (C1′) — dragging the board pans it", () => {
  test("a press that travels pans, pauses the performance, and the board follows the hand", async () => {
    const m = await mountBoard("grab-pan");
    // Start halfway down the board so the drag has room in both directions.
    await drag(m, { x: 400, y: 400 }, [
      // The first move clears the 4px slop AND pans by its whole travel.
      { x: 400, y: 300 },
      { x: 400, y: 200 },
    ]);
    // Dragging UP by 200px walks the camera 200 board px forward — the
    // content travelled with the hand.
    expect(cameraY(m.stage)).toBe(200);
    // Exactly one grab was reported for one gesture, not one per move.
    expect(m.grabs.length).toBe(1);
    // Dragging back DOWN returns it — and stops one GIVE past the top edge
    // (2026-08-17), not dead on it. Wiring, not arithmetic: what this pins
    // is that the hand on the board reaches the gesture clamp at all.
    await drag(m, { x: 400, y: 200 }, [{ x: 400, y: 500 }]);
    expect(cameraY(m.stage)).toBe(-GESTURE_GIVE * VIEW_H);
    expect(m.grabs.length).toBe(2);
    await m.unmount();
  });

  test("the pose a hand let go of survives the agent appending a line", async () => {
    // THE half of the give that is wiring and could not be a pure test:
    // "it stays" is only true if nothing downstream repairs it, and the
    // board's own rebuild re-clamps the camera after every compile (a
    // reflow that shortened the board must not leave the view staring past
    // its end). Held to the STRICT clamp, that step would yank a leaning
    // reader back by a give the next time the agent wrote a line — the
    // gesture undone by somebody else's keystroke.
    const m = await mountBoard("grab-append");
    await drag(m, { x: 400, y: 400 }, [
      { x: 400, y: 500 },
      { x: 400, y: 800 },
    ]);
    const leaning = cameraY(m.stage);
    expect(leaning).toBe(-GESTURE_GIVE * VIEW_H);
    await m.append(`${SOURCE}- A line the agent just wrote\n`);
    expect(cameraY(m.stage)).toBe(leaning);
    await m.unmount();
  });

  test("the click that ends a pan does not point at a step", async () => {
    const m = await mountBoard("grab-click");
    await drag(m, { x: 400, y: 400 }, [{ x: 400, y: 250 }]);
    await clickStep(m);
    // Letting go of the board is not pointing at it.
    expect(m.points).toEqual([]);
    await m.unmount();
  });

  test("a press that does not travel is still T6's click", async () => {
    const m = await mountBoard("grab-click-through");
    // 3px of hand tremor: under the slop, so nothing about the camera or
    // the transport moves and the click reaches the agent.
    await drag(m, { x: 400, y: 400 }, [{ x: 402, y: 402 }]);
    expect(cameraY(m.stage)).toBe(0);
    expect(m.grabs).toEqual([]);
    await clickStep(m);
    expect(m.points.length).toBe(1);
    expect(m.points[0]).not.toBeNull();
    await m.unmount();
  });

  test("a pan's suppression is spent by the next press, never sticky", async () => {
    const m = await mountBoard("grab-suppression");
    await drag(m, { x: 400, y: 400 }, [{ x: 400, y: 250 }]);
    await clickStep(m);
    expect(m.points).toEqual([]);
    // A plain click AFTER the pan points again — the suppression covered
    // exactly the one click that ended the pan.
    await drag(m, { x: 400, y: 400 }, []);
    await clickStep(m);
    expect(m.points.length).toBe(1);
    await m.unmount();
  });

  test("a finger gets the wider slop — an ordinary tap still points", async () => {
    const m = await mountBoard("grab-touch");
    // 6px of finger wander: a grab for a mouse, a tap for a finger.
    await drag(m, { x: 400, y: 400 }, [{ x: 400, y: 394 }], {
      pointerType: "touch",
    });
    expect(cameraY(m.stage)).toBe(0);
    expect(m.grabs).toEqual([]);
    // ...and past the touch slop the same finger pans, which is what
    // closes C1's open "no native touch panning" gap.
    await drag(m, { x: 400, y: 400 }, [{ x: 400, y: 300 }], {
      pointerType: "touch",
    });
    expect(cameraY(m.stage)).toBe(100);
    expect(m.grabs.length).toBe(1);
    await m.unmount();
  });

  test("alt+drag never grabs — that is the text-selection escape hatch", async () => {
    const m = await mountBoard("grab-alt");
    await drag(m, { x: 400, y: 400 }, [{ x: 400, y: 200 }], { altKey: true });
    expect(cameraY(m.stage)).toBe(0);
    expect(m.grabs).toEqual([]);
    await m.unmount();
  });

  test("a secondary button never grabs", async () => {
    const m = await mountBoard("grab-secondary");
    const { act } = await import("react");
    await act(async () => {
      m.viewport.dispatchEvent(
        pointerEvent("pointerdown", { button: 2, clientX: 400, clientY: 400 }),
      );
      window.dispatchEvent(
        pointerEvent("pointermove", { button: 2, clientX: 400, clientY: 200 }),
      );
    });
    expect(cameraY(m.stage)).toBe(0);
    expect(m.grabs).toEqual([]);
    await m.unmount();
  });

  test("the MIDDLE button pans too — the same grab, by the other hand", async () => {
    // W4a-2: xyflow's pan button. It rides the identical slop machinery,
    // so a middle press that travels is a pan and a middle press that does
    // not is nothing at all — no pause, no camera write.
    const m = await mountBoard("grab-middle");
    await drag(
      m,
      { x: 400, y: 400 },
      [
        { x: 400, y: 300 },
        { x: 400, y: 200 },
      ],
      { button: 1 },
    );
    expect(cameraY(m.stage)).toBe(200);
    expect(m.grabs.length).toBe(1);
    await m.unmount();
  });

  test("the browser's own middle-click behaviours are neutralised", async () => {
    // Windows autoscroll is armed by `mousedown`, X11's paste rides
    // `auxclick`; both are the browser's default action and both would
    // happen ON the board. The LEFT press must keep its defaults (focus,
    // double-click word selection), so this is button-1 only.
    const m = await mountBoard("grab-middle-defaults");
    const fire = (type: string, button: number): boolean => {
      const event = new win.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
      }) as unknown as Record<string, unknown>;
      Object.defineProperty(event, "button", { value: button });
      m.viewport.dispatchEvent(event as unknown as Event);
      return (event as unknown as Event).defaultPrevented;
    };
    expect(fire("mousedown", 1)).toBe(true);
    expect(fire("auxclick", 1)).toBe(true);
    expect(fire("mousedown", 0)).toBe(false);
    await m.unmount();
  });

  test("the wheel ZOOMS at the cursor and stops the performance", async () => {
    // W4a-2, the owner's ruling: 「滚轮就直接作为放大」. No modifier, and no
    // page scrolling — the board is not a page, so the event is always
    // cancelled. And like the hand, the wheel stops the show: defect
    // W4a-3a's first cause was a lecture that kept walking the wall behind
    // a camera the reader had taken with a single wheel notch.
    const m = await mountBoard("wheel-zoom");
    const { act } = await import("react");
    const wheel = async (fields: Record<string, unknown>): Promise<boolean> => {
      const event = new win.WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
      }) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries({
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        clientX: 400,
        clientY: 300,
        ctrlKey: false,
        shiftKey: false,
        ...fields,
      })) {
        Object.defineProperty(event, key, { value, configurable: true });
      }
      await act(async () => {
        m.viewport.dispatchEvent(event as unknown as Event);
      });
      return (event as unknown as Event).defaultPrevented;
    };
    expect(await wheel({ deltaY: -120 })).toBe(true);
    const zoomed = cameraZ(m.stage);
    expect(zoomed).toBeGreaterThan(1);
    expect(m.grabs.length).toBe(1);
    // …and back out again: a notch is a ratio, so it round-trips.
    await wheel({ deltaY: 120 });
    expect(cameraZ(m.stage)).toBeCloseTo(1, 9);
    // shift is not a second gesture any more — it is the same zoom.
    await wheel({ deltaY: -120, shiftKey: true });
    expect(cameraZ(m.stage)).toBeCloseTo(zoomed, 9);
    await m.unmount();
  });

  test("the grabbing affordance is worn only for the duration of the grab", async () => {
    const m = await mountBoard("grab-affordance");
    const { act } = await import("react");
    expect(m.surface.hasAttribute("data-bansho-grabbing")).toBe(false);
    await act(async () => {
      m.viewport.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 400, clientY: 400 }),
      );
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 400, clientY: 300 }),
      );
    });
    expect(m.surface.hasAttribute("data-bansho-grabbing")).toBe(true);
    await act(async () => {
      window.dispatchEvent(
        pointerEvent("pointerup", { clientX: 400, clientY: 300 }),
      );
    });
    expect(m.surface.hasAttribute("data-bansho-grabbing")).toBe(false);
    await m.unmount();
  });

  test("a cancelled pointer ends the grab (the OS took the gesture)", async () => {
    const m = await mountBoard("grab-cancel");
    const { act } = await import("react");
    await act(async () => {
      m.viewport.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 400, clientY: 400 }),
      );
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 400, clientY: 300 }),
      );
      window.dispatchEvent(
        pointerEvent("pointercancel", { clientX: 400, clientY: 300 }),
      );
      // Anything after the cancel is not this gesture any more.
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 400, clientY: 100 }),
      );
    });
    expect(cameraY(m.stage)).toBe(100);
    expect(m.surface.hasAttribute("data-bansho-grabbing")).toBe(false);
    await m.unmount();
  });

  test("unmounting mid-drag leaves no window listener behind", async () => {
    const m = await mountBoard("grab-unmount");
    const { act } = await import("react");
    await act(async () => {
      m.viewport.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 400, clientY: 400 }),
      );
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 400, clientY: 300 }),
      );
    });
    const parked = cameraY(m.stage);
    await m.unmount();
    // A move after unmount must reach nothing at all (the detached stage
    // is the only thing that could still be written).
    await act(async () => {
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 400, clientY: 0 }),
      );
    });
    expect(cameraY(m.stage)).toBe(parked);
  });
});
