/**
 * The Rive preview loads its file once per `src`, however often the panel
 * around it renders.
 *
 * The panel rebuilds the registered file's record (`RiveMachineRecord`) on
 * every render, and the stage beside it renders on every frame it plays. When
 * the load effect depended on that record's identity, each of those renders
 * tore the runtime down and started it again — fetching and decoding an
 * 85 MB `.riv` over and over — so the preview never finished loading
 * (2026-09-24, tanka-connect: the page hung on "Loading the Rive file…").
 * An equal record is the same file's record; only a new `src` or a retry
 * loads again. A record whose content changed re-reads the controls in place.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

import type { RiveMachineRecord } from "../viewer/rive-preview.js";

/** Every runtime instance the preview made, in order. */
const made: FakeRive[] = [];
let fetches = 0;

class FakeRive {
  cleaned = 0;
  stateMachineNames = ["State Machine 1"];
  #inputs = [
    { name: "motion", type: 56, value: 0, fire() {} },
    { name: "play_wave", type: 58, value: 0, fire() {} },
  ];
  constructor(readonly options: { onLoad?: () => void; onStateChange?: (event: { data: unknown }) => void }) {
    made.push(this);
    queueMicrotask(() => options.onLoad?.());
  }
  resizeDrawingSurfaceToCanvas() {}
  stateMachineInputs() {
    return this.#inputs;
  }
  play() {}
  pause() {}
  cleanup() {
    this.cleaned += 1;
  }
}

const fakeRuntime = {
  Rive: FakeRive,
  Layout: class {
    constructor(_: unknown) {}
  },
  Fit: { Contain: "contain" },
  Alignment: { Center: "center" },
};

mock.module("../viewer/rive-runtime.js", () => ({
  loadRiveRuntime: async () => fakeRuntime,
}));

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
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "getComputedStyle"]) {
    install(key, key === "window" ? win : w[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("fetch", async () => {
    fetches += 1;
    return new Response(new Uint8Array(4));
  });
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

/** A fresh object each call, as `exportRows` builds one on every render. */
const record = (hub = "idle"): RiveMachineRecord => ({
  name: "State Machine 1",
  hub,
  number: {
    name: "motion",
    default: 0,
    values: [
      { value: 0, motion: "idle" },
      { value: 1, motion: "coffee" },
    ],
  },
  triggers: [{ name: "play_wave", motion: "wave" }],
});

describe("RivePreview", () => {
  test("a new but equal record does not load the file again", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { RivePreview } = await import("../viewer/RivePreview.js");
    const { spriteStrings } = await import("../viewer/strings.js");
    const t = spriteStrings("en");
    const labels = new Map([
      ["idle", "idle"],
      ["coffee", "coffee"],
      ["wave", "wave"],
    ]);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = async (machine: RiveMachineRecord, src = "/content/a.riv?v=1") => {
      await act(async () => {
        root.render(<RivePreview src={src} machine={machine} labels={labels} t={t} onClose={() => {}} />);
      });
    };

    await render(record());
    expect(made.length).toBe(1);
    expect(fetches).toBe(1);
    // The loops read as buttons, not as a stepper.
    expect(host.querySelectorAll("button[aria-pressed]").length).toBe(2);

    // The panel renders again, and again: the file stays loaded.
    for (let i = 0; i < 5; i++) await render(record());
    expect(made.length).toBe(1);
    expect(fetches).toBe(1);
    expect(made[0].cleaned).toBe(0);
    expect(host.textContent).not.toContain("Loading");

    // A record that says something new re-reads the controls, in place.
    await render({ ...record(), number: null });
    expect(made.length).toBe(1);
    expect(host.querySelectorAll("button[aria-pressed]").length).toBe(0);

    // A new registration is a new file.
    await render(record(), "/content/a.riv?v=2");
    expect(made.length).toBe(2);
    expect(made[0].cleaned).toBe(1);

    await act(async () => root.unmount());
    expect(made[1].cleaned).toBe(1);
  });

  test("the state the machine is in now stands apart from the trail before it", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { RivePreview } = await import("../viewer/RivePreview.js");
    const { spriteStrings } = await import("../viewer/strings.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<RivePreview src="/content/b.riv" machine={record()} labels={new Map()} t={spriteStrings("zh-CN")} onClose={() => {}} />);
    });
    const rive = made.at(-1)!;
    // The runtime reports a route through the hub, one advance at a time.
    for (const data of [["idle"], ["idle-to-coffee"], ["coffee"]]) {
      await act(async () => rive.options.onStateChange?.({ data }));
    }
    const line = host.querySelector("[data-rive-state]")!;
    expect(line.getAttribute("data-rive-state")).toBe("coffee");
    expect(line.getAttribute("title")).toBe("idle → idle-to-coffee → coffee");
    // Only the earlier states may be cut short; the current one is its own element.
    expect(line.lastElementChild?.textContent).toBe("coffee");
    expect(line.lastElementChild?.className).toContain("shrink-0");
    expect(line.textContent).toBe("当前状态：idle → idle-to-coffee →coffee");
    await act(async () => root.unmount());
  });
});
