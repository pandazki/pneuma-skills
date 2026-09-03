/** @jsxImportSource react */
/**
 * The stage's double buffer — two stacked <video> layers so a segment
 * switch never flashes — pinned at the one property that went wrong in
 * the first live course: only ONE layer may ever hold a clip once a
 * switch has settled. Both layers carrying the same clip a few seconds
 * apart is an echo the learner hears, not a state anyone sees.
 *
 * happy-dom's media elements are stateful enough for this (play/pause
 * flip `paused`, `currentSrc` mirrors `src`, `load()` fires `emptied`)
 * and have no decoder — nothing here depends on timing inside a clip.
 * (Harness shape follows `modes/eli5/__tests__/rail.test.tsx`.)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

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

interface Mounted {
  layers: () => [HTMLVideoElement, HTMLVideoElement];
  onStage: () => HTMLVideoElement;
  transport: (label: "Play" | "Pause") => HTMLButtonElement | undefined;
  update: (src: string) => Promise<void>;
  fire: (el: Element, type: string) => Promise<void>;
  unmount: () => Promise<void>;
}

async function mountStage(src: string): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: VideoStage } = await import("../viewer/VideoStage.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (s: string) => root.render(createElement(VideoStage, { src: s }));
  await act(async () => render(src));

  const layers = () =>
    [
      host.querySelector('video[data-plotwise-layer="0"]'),
      host.querySelector('video[data-plotwise-layer="1"]'),
    ] as [HTMLVideoElement, HTMLVideoElement];

  return {
    layers,
    onStage: () => layers().find((v) => v.className.includes("opacity-100"))!,
    transport: (label) =>
      (host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null) ?? undefined,
    update: async (s) => {
      await act(async () => render(s));
    },
    fire: async (el, type) => {
      await act(async () => {
        el.dispatchEvent(new Event(type, { bubbles: false }));
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const A = "/content/c/nodes/n1/video.mp4";
const B = "/content/c/nodes/n2/video.mp4";

describe("VideoStage double buffer", () => {
  test("the first clip lands on layer 0 and plays there", async () => {
    const m = await mountStage(A);
    const [l0, l1] = m.layers();
    expect(l0.getAttribute("src")).toBe(A);
    expect(l0.paused).toBe(false);
    expect(l1.getAttribute("src")).toBeNull();
    expect(m.onStage()).toBe(l0);
    expect(m.transport("Pause")).toBeDefined();
    await m.unmount();
  });

  test("a switch moves the picture to the other layer and empties the one it left", async () => {
    const m = await mountStage(A);
    const [l0, l1] = m.layers();
    await m.update(B);
    // The incoming clip is on stage and audible; the outgoing layer holds
    // nothing at all — an empty layer cannot sound.
    expect(l1.getAttribute("src")).toBe(B);
    expect(l1.paused).toBe(false);
    expect(m.onStage()).toBe(l1);
    expect(l0.getAttribute("src")).toBeNull();
    expect(l0.paused).toBe(true);
    // And the transport knows the stage is playing.
    expect(m.transport("Pause")).toBeDefined();
    expect(m.transport("Play")).toBeUndefined();

    // Back the other way: the roles swap again, the invariant holds.
    await m.update(A);
    expect(l0.getAttribute("src")).toBe(A);
    expect(l0.paused).toBe(false);
    expect(m.onStage()).toBe(l0);
    expect(l1.getAttribute("src")).toBeNull();
    expect(l1.paused).toBe(true);
    await m.unmount();
  });

  test("a retry scheduled on a layer that has since left the stage does nothing", async () => {
    const m = await mountStage(A);
    const [l0, l1] = m.layers();
    // The active layer fails once: a retry is booked 1.2s out.
    await m.fire(l0, "error");
    // Before it fires, the learner moves on.
    await m.update(B);
    expect(m.onStage()).toBe(l1);
    await new Promise((r) => setTimeout(r, 1400));
    // The retry must not have revived the layer it was booked on.
    expect(l0.getAttribute("src")).toBeNull();
    expect(l0.paused).toBe(true);
    expect(l1.paused).toBe(false);
    await m.unmount();
  });

  test("the same clip again is a no-op: no reload, nothing moves", async () => {
    const m = await mountStage(A);
    const [l0, l1] = m.layers();
    await m.update(A);
    expect(l0.getAttribute("src")).toBe(A);
    expect(l0.paused).toBe(false);
    expect(l1.getAttribute("src")).toBeNull();
    expect(m.onStage()).toBe(l0);
    await m.unmount();
  });
});
