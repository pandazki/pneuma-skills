/** @jsxImportSource react */
/**
 * The collision HOST seam (design §5.3) — a collision the board detects
 * has to become something a HUMAN can see on the board.
 *
 * Why this file exists at all: `regions.test.ts` and `board-check.test.ts`
 * already pin the predicate and the finding to the bone, and both were
 * green on a running app where a colliding board showed nothing but
 * overlapping glyphs. Every §5.3 channel that was actually wired
 * (`check-board`, the `boardCollision` push) speaks to the AGENT; the one
 * human surface — the issue chip — did not count collisions, and the board
 * carried no mark. Pure tests could not have caught that, because the gap
 * was between "the host computed the collisions" and "the host rendered
 * them". So this suite mounts the REAL BoardCanvas, lets the REAL fold
 * produce the overlap, and asks the mounted DOM.
 *
 * happy-dom has no layout engine, so geometry is stubbed at the prototype
 * (every element measures the same synthetic box) — enough for the fold to
 * charge non-zero heights and for `standingBoxes` to have rectangles to
 * intersect. The pixels themselves stay the screenshots' job; what is
 * pinned here is the SEAM: collisions in, marks out — and, on a board
 * whose placements do not overlap, nothing added.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import type { EnvCaps } from "../engine/types.js";
import type { CompiledBoard } from "../viewer/BoardCanvas.js";
import { BURST_MARK_NOTE } from "../viewer/board-check.js";

/** A `full` title and lead-in, then two columns — place-test's shape. */
const COLLIDING = [
  "@board 2",
  "",
  "# Two notations, one sound",
  "",
  "Put the two things being compared side by side first.",
  "",
  "@at left",
  "",
  "## What the waveform says",
  "",
  "Time across, pressure up.",
  "",
  "@at right",
  "",
  "## What the spectrum says",
  "",
  "Frequency across, how much of it up.",
  "",
].join("\n");

/** The same lecture, placed so nothing stands on anything — place-test-fixed. */
const CLEAR = [
  "@board 2",
  "",
  "@at top",
  "",
  "# Two notations, one sound",
  "",
  "Put the two things being compared side by side first.",
  "",
  "@at bottom-left",
  "",
  "## What the waveform says",
  "",
  "Time across, pressure up.",
  "",
  "@at bottom-right",
  "",
  "## What the spectrum says",
  "",
  "Frequency across, how much of it up.",
  "",
].join("\n");

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

/** One synthetic box every element reports — the whole layout engine. */
const BOX_W = 1200;
const BOX_H = 44;

let restore: (() => void) | undefined;

beforeAll(() => {
  const window = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const install = (key: string, value: unknown): void => {
    saved[key] = g[key];
    g[key] = value;
  };
  const w = window as unknown as Record<string, unknown>;
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
    install(key, key === "window" ? window : w[key]);
  }
  install(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  install("IS_REACT_ACT_ENVIRONMENT", true);

  // The layout engine happy-dom does not have. Installed on the PROTOTYPE
  // so it is in force from the first render (the fold runs inside the
  // mount effect, before a test could stub individual elements); an own
  // property still shadows it where a test wants a different reading.
  const proto = window.HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  const stubbed: [string, PropertyDescriptor | undefined][] = [];
  const defineOn = (key: string, descriptor: PropertyDescriptor): void => {
    stubbed.push([key, Object.getOwnPropertyDescriptor(proto, key)]);
    Object.defineProperty(proto, key, { configurable: true, ...descriptor });
  };
  for (const key of [
    "offsetWidth",
    "clientWidth",
    "scrollWidth",
  ]) {
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
  compiled: CompiledBoard | null;
  unmount(): Promise<void>;
}

async function mount(source: string, name: string): Promise<Mounted> {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

  const lecture = parseLecture(source, name);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let compiled: CompiledBoard | null = null;

  await act(async () => {
    root.render(
      <BoardCanvas
        lecture={lecture}
        view="board"
        theme="dark"
        fontsReady={true}
        env={ENV}
        getPlayheadT={() => 9999}
        onCompiled={(next) => {
          compiled = next;
        }}
        activeIndex={0}
        playing={false}
        follow="detached"
        onSeek={() => () => {}}
        onFrame={() => () => {}}
        selectedRef={null}
      />,
    );
  });

  return {
    host,
    get compiled() {
      return compiled;
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("BoardCanvas — a collision the fold found is a collision the board wears", () => {
  test("overlapping placements put a mark on the board naming both regions", async () => {
    const board = await mount(COLLIDING, "collision-mark");
    try {
      // Guard against a VACUOUS pass: if the geometry stub ever stops
      // producing measurable boxes there is no collision to render, and
      // an assertion about an absent mark would go quietly green.
      const collisions = board.compiled?.collisions ?? [];
      expect(collisions.length).toBeGreaterThan(0);

      const marks = board.host.querySelectorAll("[data-bansho-collision]");
      expect(marks.length).toBe(collisions.length);

      // The mark is not a decoration: it names the two region words, so a
      // reader who lands on the board cold learns this overlap is a
      // diagnosed condition rather than a broken renderer.
      const words = new Set(
        [...marks].map((m) => m.getAttribute("data-bansho-collision")),
      );
      expect(words.has("full×left")).toBe(true);
      expect(words.has("full×right")).toBe(true);
      // Both pairs, and after W2 for a SHARPER reason than before. The
      // room's flow fills this face in columns now, so the opening PROSE
      // stands in the left column and is genuinely not in the right half's
      // way (`layout.test.ts` pins that it no longer collides with it).
      // What reaches `right` here is the board's `#` TITLE — a centrepiece,
      // written across the whole face — and a named region opening at the
      // face's top really does land on it. That is design §3.2's ACCEPTED
      // expressive gap (a banner across the top with two columns beneath
      // it), reported rather than prevented.

      const labels = [...board.host.querySelectorAll(".bansho-collision-label")];
      expect(labels.length).toBe(words.size); // one per PAIR, not per box
      const text = labels.map((l) => l.textContent ?? "").join(" | ");
      expect(text).toContain("full");
      expect(text).toContain("left");
      expect(text.toLowerCase()).toContain("overlap");

      // §5.3: nothing is moved, nothing is hidden. The mark never eats a
      // click meant for the writing underneath it.
      for (const mark of marks) {
        expect((mark as HTMLElement).style.pointerEvents).toBe("none");
      }
    } finally {
      await board.unmount();
    }
  });

  test("a board whose placements do not overlap gets nothing added", async () => {
    const board = await mount(CLEAR, "collision-clear");
    try {
      expect(board.compiled?.collisions ?? []).toEqual([]);
      expect(board.host.querySelectorAll("[data-bansho-collision]").length).toBe(
        0,
      );
      expect(board.host.querySelectorAll(".bansho-collision-label").length).toBe(
        0,
      );
      expect(board.host.querySelectorAll("[data-bansho-collisions]").length).toBe(
        0,
      );
    } finally {
      await board.unmount();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// W8 — the same seam for the BURST, and for the same reason
// ────────────────────────────────────────────────────────────────────────────

/**
 * A column with more writing than the board is tall. The fold gives it its
 * frame and never moves it; the panel's edge takes the rest.
 */
const BURSTING = [
  "@board 2",
  "",
  "@at left",
  "",
  ...Array.from({ length: 24 }, (_, i) => [
    `Line number ${i + 1} of a column that will not fit.`,
    "",
  ]).flat(),
].join("\n");

describe("BoardCanvas — a burst the board's edge cuts is a burst the board wears", () => {
  test("the cut wears a line and a caption saying how much is below it", async () => {
    const board = await mount(BURSTING, "burst-mark");
    try {
      // Vacuity guard, the same one the collision suite carries: if the
      // stub ever stops producing measurable boxes there is no burst to
      // draw, and every assertion below would pass on an empty board.
      const cut = (board.compiled?.bursts ?? []).filter((b) => b.cut > 0);
      expect(cut.length).toBeGreaterThan(0);

      const marks = board.host.querySelectorAll("[data-bansho-burst]");
      expect(marks.length).toBe(cut.length);
      expect(marks[0]!.getAttribute("data-bansho-burst")).toBe("left");

      // The caption is the whole point: a clipped board looks EXACTLY like
      // a board that ended, and `capture` hands the agent that same clean
      // edge. The number is what turns the picture back into a fact.
      const label = board.host.querySelector(".bansho-burst-label");
      expect(label?.textContent ?? "").toContain("below the board's edge");
      expect(label?.textContent ?? "").toContain(BURST_MARK_NOTE);

      // It reports; it never intercepts. Same posture as the collision mark.
      for (const mark of marks) {
        expect((mark as HTMLElement).style.pointerEvents).toBe("none");
      }
    } finally {
      await board.unmount();
    }
  });

  test("a board nothing runs off gets nothing added", async () => {
    const board = await mount(CLEAR, "burst-clear");
    try {
      expect((board.compiled?.bursts ?? []).filter((b) => b.cut > 0)).toEqual(
        [],
      );
      expect(board.host.querySelectorAll("[data-bansho-burst]").length).toBe(0);
      expect(board.host.querySelectorAll("[data-bansho-bursts]").length).toBe(0);
    } finally {
      await board.unmount();
    }
  });
});
