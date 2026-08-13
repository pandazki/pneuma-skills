/**
 * wall-map — the reader's overview, and the two properties that keep it
 * from becoming a second renderer.
 *
 * `readPanelOutline` itself needs real layout to say anything (happy-dom
 * measures nothing), so what is pinned here is the part that decides how
 * OFTEN the map redraws: `sameOutlines`. It is the compile-rate setState's
 * guard, and it has to be exact in both directions — too loose and a
 * rebuild that genuinely moved ink leaves a stale map, too tight and every
 * rebuild re-renders four boards' worth of SVG for nothing.
 *
 * The map's DOM is pinned below it, rendered with synthetic wall geometry —
 * happy-dom measures nothing, so the real host hands the component a
 * zero-width board and the component correctly declines to draw one. The
 * MOUNT gate (`panelCount > 1`, a node that does not exist on a strip)
 * lives in `stage-structure.test.tsx`, beside the rest of the stage chain.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import {
  groupDrawnAt,
  sameOutlines,
  type OutlineGroup,
  type PanelOutline,
} from "../viewer/wall-outline.js";

const bar = (x: number, y: number, w = 10, h = 4) => ({ x, y, w, h });
const stroke = (x: number, y: number, d: string[]) => ({
  x,
  y,
  w: 40,
  h: 12,
  viewBox: "0 0 40 12",
  d,
});

/** One step's marks, with the window the host resolved for them. */
const group = (
  key: string,
  bars: ReturnType<typeof bar>[],
  strokes: ReturnType<typeof stroke>[] = [],
  window: { from?: number; until?: number; run?: string | null } = {},
): OutlineGroup => ({
  key,
  run: window.run ?? null,
  bars,
  strokes,
  from: window.from ?? 0,
  until: window.until ?? Infinity,
});

const board = (
  bars: ReturnType<typeof bar>[],
  strokes: ReturnType<typeof stroke>[] = [],
): PanelOutline => ({ groups: [group("s0", bars, strokes)] });

const wall = (...groups: OutlineGroup[]): PanelOutline => ({ groups });

describe("sameOutlines — the map redraws when the wall changed, and only then", () => {
  test("two independently built descriptions of the same wall are the same", () => {
    const a = [board([bar(0, 0), bar(12, 0)], [stroke(0, 30, ["M0 0 L10 1"])])];
    const b = [board([bar(0, 0), bar(12, 0)], [stroke(0, 30, ["M0 0 L10 1"])])];
    expect(sameOutlines(a, a)).toBe(true);
    expect(sameOutlines(a, b)).toBe(true);
  });

  test("a board gained, lost or resized a word", () => {
    const base = [board([bar(0, 0), bar(12, 0)])];
    expect(sameOutlines(base, [board([bar(0, 0)])])).toBe(false);
    expect(
      sameOutlines(base, [board([bar(0, 0), bar(12, 0), bar(24, 0)])]),
    ).toBe(false);
    // A sub-pixel move is a move: the greeked bars ARE the typography, so
    // a re-wrap that shifts one word by a fraction has to redraw.
    expect(sameOutlines(base, [board([bar(0, 0), bar(12.01, 0)])])).toBe(false);
    expect(sameOutlines(base, [board([bar(0, 0), bar(12, 0, 11)])])).toBe(false);
  });

  test("an ink stroke that moved, was re-drawn, or changed its frame", () => {
    const base = [board([], [stroke(0, 0, ["M0 0 L10 1"])])];
    expect(sameOutlines(base, [board([], [stroke(1, 0, ["M0 0 L10 1"])])])).toBe(
      false,
    );
    // The same box, a different hand: the sketch jitter is seeded, so a `d`
    // that changed means the ink was rebuilt and the map is stale.
    expect(sameOutlines(base, [board([], [stroke(0, 0, ["M0 0 L10 2"])])])).toBe(
      false,
    );
    expect(
      sameOutlines(base, [board([], [stroke(0, 0, ["M0 0 L10 1", "M0 5"])])]),
    ).toBe(false);
    const reframed = { ...stroke(0, 0, ["M0 0 L10 1"]), viewBox: "0 0 80 24" };
    expect(sameOutlines(base, [board([], [reframed])])).toBe(false);
  });

  test("the same drawing on a different number of boards is a different wall", () => {
    const one = [board([bar(0, 0)])];
    expect(sameOutlines(one, [...one, board([])])).toBe(false);
    expect(sameOutlines([], [])).toBe(true);
  });

  test("two boards that swapped their contents are not the same wall", () => {
    const a = [board([bar(0, 0)]), board([bar(0, 40)])];
    const b = [board([bar(0, 40)]), board([bar(0, 0)])];
    expect(sameOutlines(a, b)).toBe(false);
  });

  test("a rebuild that moved no mark but RESCHEDULED one is a redraw", () => {
    // The windows are half the drawing now: identical geometry that
    // appears at a different moment is a different map at every playhead
    // in between, and a guard that only compared rects would leave the
    // reader looking at a stale one.
    const base = [wall(group("s1", [bar(0, 0)], [], { from: 3 }))];
    expect(
      sameOutlines(base, [wall(group("s1", [bar(0, 0)], [], { from: 4 }))]),
    ).toBe(false);
    expect(
      sameOutlines(base, [
        wall(group("s1", [bar(0, 0)], [], { from: 3, until: 9 })),
      ]),
    ).toBe(false);
    expect(
      sameOutlines(base, [wall(group("s2", [bar(0, 0)], [], { from: 3 }))]),
    ).toBe(false);
    expect(
      sameOutlines(base, [wall(group("s1", [bar(0, 0)], [], { from: 3 }))]),
    ).toBe(true);
  });
});

describe("groupDrawnAt — what is written RIGHT NOW, and nothing later", () => {
  test("a step's marks appear when its own reveal starts", () => {
    const g = group("s3", [bar(0, 0)], [], { from: 5 });
    expect(groupDrawnAt(g, 4)).toBe(false);
    // The leading edge sits ON the pen: the map is a locator, and a group
    // that waited for its step to finish would leave the reader's own
    // rectangle hovering over blank map for the length of every step.
    expect(groupDrawnAt(g, 5)).toBe(true);
    expect(groupDrawnAt(g, 50)).toBe(true);
  });

  test("marks inside an erased run leave when its sweep begins", () => {
    const g = group("s3", [bar(0, 0)], [], { from: 2, until: 7, run: "r0" });
    expect(groupDrawnAt(g, 6)).toBe(true);
    expect(groupDrawnAt(g, 7)).toBe(false);
    // Which is what retires the old "a board with two erased runs shows
    // the union of everything that ever stood there" limitation: each run
    // owns a window, so only the run standing at this playhead is drawn.
    const later = group("s9", [bar(0, 0)], [], { from: 7 });
    expect(groupDrawnAt(later, 7)).toBe(true);
  });

  test("a step that performs nothing is on the board from the first frame", () => {
    // An image / a placeholder has no reveal unit, so the BOARD shows it
    // at t = 0 — and the map says what the board says, including at the
    // pre-roll index of -1.
    const g = group("s0", [bar(0, 0)], [], { from: -1 });
    expect(groupDrawnAt(g, -1)).toBe(true);
    // …while a step that does perform is absent before the lecture starts.
    expect(groupDrawnAt(group("s1", [bar(0, 0)], [], { from: 0 }), -1)).toBe(
      false,
    );
  });
});


// ────────────────────────────────────────────────────────────────────────────
// The map's DOM
// ────────────────────────────────────────────────────────────────────────────

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

describe("WallMap — what a reader can point at", () => {
  const GEOM = { panelW: 1200, panelH: 864, gap: 32 };

  const render = async (
    panelCount: number,
    geom = GEOM,
    outlines: PanelOutline[] = [],
    revealIndex = Number.MAX_SAFE_INTEGER,
  ) => {
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: WallMap } = await import("../viewer/WallMap.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const jumped: number[] = [];
    await act(async () => {
      root.render(
        createElement(WallMap, {
          panelCount,
          geom,
          outlines,
          revealIndex,
          registerBoard: () => {},
          registerViewRect: () => {},
          onJump: (p: number) => jumped.push(p),
          onPanBoard: () => {},
        }),
      );
    });
    return {
      host,
      jumped,
      async unmount() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  };

  test("one clickable board per board, plus the reader's own rectangle", async () => {
    const m = await render(4);
    const map = m.host.querySelector('[data-testid="bansho-wall-map"]')!;
    expect(map).not.toBeNull();
    expect(map.querySelectorAll(".bansho-map-board").length).toBe(4);
    // Exactly one viewport rectangle — the ONE element the camera writes.
    expect(map.querySelectorAll(".bansho-map-viewport").length).toBe(1);
    await m.unmount();
  });

  test("the map's viewBox is the WALL, in board px — no scale arithmetic", async () => {
    const m = await render(4);
    const svg = m.host.querySelector("svg[role=group]")!;
    // 2x2: two boards and one gap on each axis.
    expect(svg.getAttribute("viewBox")).toBe("0 0 2432 1760");
    await m.unmount();
  });

  test("the boards sit at their wallSlot, in reading order", async () => {
    const m = await render(4);
    const groups = [...m.host.querySelectorAll("svg[role=group] > g")];
    expect(groups.map((g) => g.getAttribute("transform"))).toEqual([
      "translate(0 0)",
      "translate(1232 0)",
      "translate(0 896)",
      "translate(1232 896)",
    ]);
    await m.unmount();
  });

  test("clicking a board asks the host to stand in front of it", async () => {
    const m = await render(3);
    const boards = m.host.querySelectorAll(".bansho-map-board");
    boards[2]!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(m.jumped).toEqual([2]);
    await m.unmount();
  });

  test("real ink is drawn as itself — the strokes keep their own d strings", async () => {
    const m = await render(2, GEOM, [
      board([bar(10, 20)], [stroke(4, 40, ["M0 0 L30 2"])]),
      board([]),
    ]);
    const ink = m.host.querySelector(".bansho-map-ink")!;
    expect(ink.querySelectorAll("rect").length).toBe(1);
    const path = ink.querySelector("path")!;
    expect(path.getAttribute("d")).toBe("M0 0 L30 2");
    // The overlay rides in a nested <svg> carrying its OWN viewBox, so the
    // board's coordinates and the ink's coordinates never have to be
    // reconciled by hand.
    expect(path.parentElement!.getAttribute("viewBox")).toBe("0 0 40 12");
    await m.unmount();
  });

  test("the map draws the playhead's board, not the end of the lecture", async () => {
    // Defect W4a-1: scrubbing changed nothing on the map, so a reader
    // looking at it to find where they are was shown the future. Three
    // steps on one board, read at three playheads.
    const outlines = [
      wall(
        group("a", [bar(0, 0)], [], { from: 0 }),
        group("b", [bar(0, 40)], [], { from: 4 }),
        group("c", [bar(0, 80)], [], { from: 9 }),
      ),
      wall(),
    ];
    const drawn = (host: Element) =>
      [...host.querySelectorAll(".bansho-map-ink > g")].filter(
        (g) => (g as HTMLElement).style.display !== "none",
      ).length;

    const early = await render(2, GEOM, outlines, 0);
    expect(drawn(early.host)).toBe(1);
    await early.unmount();

    const mid = await render(2, GEOM, outlines, 5);
    expect(drawn(mid.host)).toBe(2);
    await mid.unmount();

    const end = await render(2, GEOM, outlines, 9);
    expect(drawn(end.host)).toBe(3);
    // Hidden, not unmounted: a step change must not tear down and rebuild
    // the whole wall's SVG.
    expect(end.host.querySelectorAll(".bansho-map-ink > g").length).toBe(3);
    await end.unmount();
  });

  test("a board nobody has measured yet draws no map at all (no empty flash)", async () => {
    const m = await render(4, { panelW: 0, panelH: 0, gap: 32 });
    expect(m.host.querySelector('[data-testid="bansho-wall-map"]')).toBeNull();
    await m.unmount();
  });
});
