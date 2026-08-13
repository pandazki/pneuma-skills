/** @jsxImportSource react */
/**
 * The transport's voice control (`Timeline.tsx`) and the preference it
 * remembers (`voice-output.ts`).
 *
 * The control exists because a narrated lecture had no off switch: the
 * only way to stop the voice was to stop the board. What this file pins is
 * everything that keeps it from becoming a second problem:
 *
 *  - it appears ONLY where it can do something — a silent board grows no
 *    dead control, and neither does a host that owns no voice output;
 *  - it reads its own state out loud (`aria-pressed` plus a label that
 *    says which way pressing it goes), because a speaker glyph with a
 *    slash through it is invisible to a screen reader;
 *  - it is a button in the transport, next to the rate control, and it
 *    carries no warning colour: the user's own silence is a control state,
 *    not a degradation. (The browser's autoplay refusal is the
 *    degradation, and it keeps its own warning chip — different fact,
 *    different surface.)
 *  - the choice survives a reload, and survives storage that throws.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { BoardTimeline } from "../engine/types.js";
import type { BoardPlayerHandle } from "../viewer/useBoardPlayer.js";
import {
  VOICE_MUTED_LS_KEY,
  readVoiceMuted,
  writeVoiceMuted,
} from "../viewer/voice-output.js";

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
beforeEach(() => window.localStorage.clear());

const TIMELINE = {
  duration: 40,
  schedule: [],
  seek: () => {},
} as unknown as BoardTimeline;

/** The control's stable handle — how the viewer finds it, and the test. */
const MUTE_SELECTOR = '[data-voice-toggle]';

interface Mounted {
  host: HTMLElement;
  button(): HTMLElement | null;
  toggles: boolean[];
  click(el: Element): Promise<void>;
  unmount(): Promise<void>;
}

async function mountTransport(opts: {
  narrated?: boolean;
  muted?: boolean;
  /** Omitted = a host with no voice output to drive. */
  withHandler?: boolean;
} = {}): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Timeline } = await import("../viewer/Timeline.js");

  const toggles: boolean[] = [];
  const player: BoardPlayerHandle = {
    ui: { t: 0, playing: true, rate: 1, follow: "live", duration: 40 },
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
    setRate: () => {},
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(Timeline, {
        timeline: TIMELINE,
        player,
        narrated: opts.narrated ?? true,
        muted: opts.muted ?? false,
        onToggleMute:
          (opts.withHandler ?? true)
            ? () => toggles.push(!(opts.muted ?? false))
            : undefined,
      }),
    );
  });

  return {
    host,
    toggles,
    button: () => host.querySelector<HTMLElement>(MUTE_SELECTOR),
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

describe("the control appears only where it can do something", () => {
  test("a narrated board gets it", async () => {
    const m = await mountTransport({ narrated: true });
    expect(m.button()).not.toBeNull();
    await m.unmount();
  });

  test("a board with no voice at all grows no dead control", async () => {
    const m = await mountTransport({ narrated: false });
    expect(m.button()).toBeNull();
    await m.unmount();
  });

  test("no voice output to drive, no button", async () => {
    // A host that hands no handler owns no conductor to mute; a button
    // whose press does nothing is exactly the dead control above.
    const m = await mountTransport({ narrated: true, withHandler: false });
    expect(m.button()).toBeNull();
    await m.unmount();
  });
});

describe("the control says which state it is in", () => {
  test("unmuted: not pressed, and the label offers to mute", async () => {
    const m = await mountTransport({ muted: false });
    const el = m.button()!;
    expect(el.getAttribute("aria-pressed")).toBe("false");
    expect(el.getAttribute("aria-label")).toBe("Mute the narration");
    // No emoji anywhere in the transport (project rule) — the glyph is an
    // inline SVG, so the button carries no text node of its own.
    expect(el.querySelector("svg")).not.toBeNull();
    await m.unmount();
  });

  test("muted: pressed, and the label offers to bring the voice back", async () => {
    const m = await mountTransport({ muted: true });
    const el = m.button()!;
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("Unmute the narration");
    await m.unmount();
  });

  test("the two states do not look the same", async () => {
    // Colour alone would not do it: the state has to survive a reader who
    // cannot tell orange from grey, so the muted face is a different
    // glyph, not the same speaker in a different tint.
    const loud = await mountTransport({ muted: false });
    const loudGlyph = loud.button()!.querySelector("svg")!.innerHTML;
    await loud.unmount();
    const quiet = await mountTransport({ muted: true });
    const quietGlyph = quiet.button()!.querySelector("svg")!.innerHTML;
    await quiet.unmount();
    expect(quietGlyph).not.toBe(loudGlyph);
  });

  test("the title explains that muting does not change the lecture", async () => {
    const m = await mountTransport({ muted: false });
    expect(m.button()!.getAttribute("title")).toContain("pacing");
    await m.unmount();
  });
});

describe("pressing it asks the host to flip the voice", () => {
  test("a click calls the handler", async () => {
    const m = await mountTransport({ muted: false });
    await m.click(m.button()!);
    expect(m.toggles).toEqual([true]);
    await m.unmount();
  });

  test("pressing it while muted asks to unmute", async () => {
    const m = await mountTransport({ muted: true });
    await m.click(m.button()!);
    expect(m.toggles).toEqual([false]);
    await m.unmount();
  });
});

describe("the choice is remembered at the browser level", () => {
  test("nothing stored reads as sound on — a board never opens silent by accident", () => {
    expect(readVoiceMuted()).toBe(false);
  });

  test("a round trip through storage", () => {
    writeVoiceMuted(true);
    expect(window.localStorage.getItem(VOICE_MUTED_LS_KEY)).toBe("1");
    expect(readVoiceMuted()).toBe(true);
    writeVoiceMuted(false);
    expect(readVoiceMuted()).toBe(false);
  });

  test("any value other than the stored truth reads as unmuted", () => {
    window.localStorage.setItem(VOICE_MUTED_LS_KEY, "yes");
    expect(readVoiceMuted()).toBe(false);
  });

  test("storage that throws costs the preference, never the control", () => {
    const storage = window.localStorage;
    const throwing = {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {
        throw new Error("storage disabled");
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: throwing,
      configurable: true,
    });
    try {
      expect(readVoiceMuted()).toBe(false);
      expect(() => writeVoiceMuted(true)).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", {
        value: storage,
        configurable: true,
      });
    }
  });
});
