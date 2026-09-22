/** @jsxImportSource react */
/**
 * What the stage does with a motion's pictures — the half that only shows up
 * as a number in Activity Monitor.
 *
 * The Kiki trial (2026-09-22) put a 355-frame 532x460 loop on the stage and
 * the tab stopped answering: the renderer had to be killed, and the launcher
 * logged the browser disconnecting. Two mechanisms made it, and both are
 * invisible in a screenshot, so they are pinned here instead:
 *
 *  1. The shell bumps `imageVersion` ONCE PER CHANGED FILE. One `register-run`
 *     was measured sending 355 separate updates inside a tenth of a second,
 *     and every one of them rewrites all 355 frame URLs — a viewer that reads
 *     the pictures again on each bump asks for 126,025 of them.
 *  2. A loaded `Image` holds a decoded bitmap (a megabyte per 532x460 frame)
 *     that the JS garbage collector has no reason to hurry over. Dropping the
 *     reference is not giving it back; detaching `src` is.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/** Every `Image` the hook made, in creation order, with its own bytes. */
class FakeImage {
  static all: FakeImage[] = [];
  decoding = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 8;
  naturalHeight = 8;
  #src = "";
  /** True once the hook detached this element from its bytes. */
  released = false;

  constructor() {
    FakeImage.all.push(this);
  }

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
    this.released = false;
  }

  removeAttribute(name: string): void {
    if (name !== "src") return;
    this.#src = "";
    this.released = true;
  }

  /** The browser coming back with the picture. */
  settle(): void {
    this.onload?.();
  }
}

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
  install("Image", FakeImage);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());
afterEach(() => {
  FakeImage.all = [];
});

const framesSource = (version: number, count = 3) => ({
  kind: "frames" as const,
  frames: Array.from(
    { length: count },
    (_, index) => `/content/m/frames/${index}.png?v=${version}`,
  ),
  count,
  missing: 0,
});

describe("useFrameImages gives a superseded set its bytes back", () => {
  test("the set on screen is kept until its replacement is whole, then released", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useFrameImages } = await import("../viewer/useFrameImages.js");

    let ready = false;
    function Probe({ version }: { version: number }) {
      const images = useFrameImages(framesSource(version));
      ready = images.ready;
      return <div />;
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Probe version={1} />);
    });
    const first = FakeImage.all.slice();
    expect(first.length).toBe(3);

    await act(async () => {
      for (const image of first) image.settle();
    });
    expect(ready).toBe(true);
    expect(first.every((image) => image.released)).toBe(false);

    // A `register-run` rewrote the frames: same pictures, new version.
    await act(async () => {
      root.render(<Probe version={2} />);
    });
    const second = FakeImage.all.slice(3);
    expect(second.length).toBe(3);
    // Still the old pictures on stage — releasing them now would blank it.
    expect(first.some((image) => image.released)).toBe(false);

    await act(async () => {
      for (const image of second) image.settle();
    });
    // The replacement is whole and committed, so the old set is dead weight.
    expect(first.every((image) => image.released)).toBe(true);
    expect(second.some((image) => image.released)).toBe(false);

    await act(async () => {
      root.unmount();
    });
    expect(second.every((image) => image.released)).toBe(true);
  });

  test("a set that never reached the screen is released at once", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useFrameImages } = await import("../viewer/useFrameImages.js");

    function Probe({ version }: { version: number }) {
      useFrameImages(framesSource(version));
      return <div />;
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Probe version={1} />);
    });
    const superseded = FakeImage.all.slice();

    // The next batch of file events arrives before the first load finished.
    await act(async () => {
      root.render(<Probe version={2} />);
    });
    expect(superseded.every((image) => image.released)).toBe(true);
    expect(superseded.every((image) => image.onload === null)).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});

describe("useSettledImageVersion", () => {
  test("a run's worth of file events starts ONE reload, not one each", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useSettledImageVersion } = await import("../viewer/useFrameImages.js");

    const seen: number[] = [];
    function Probe({ version }: { version: number }) {
      const settled = useSettledImageVersion(version, 20);
      if (seen.at(-1) !== settled) seen.push(settled);
      return <div />;
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    // The first version is adopted at once — opening a session must paint.
    await act(async () => {
      root.render(<Probe version={7} />);
    });
    expect(seen).toEqual([7]);

    // 355 bumps in a tenth of a second: the shape `register-run` really has.
    await act(async () => {
      for (let version = 8; version <= 362; version += 1) {
        root.render(<Probe version={version} />);
      }
    });
    expect(seen).toEqual([7]);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(seen).toEqual([7, 362]);

    await act(async () => {
      root.unmount();
    });
  });
});
