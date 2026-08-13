/** @jsxImportSource react */
/**
 * The back-reference measure/draw seam, end to end through the HOST.
 *
 * `@strike` / `@circle` / `@highlight` / `@underline` are the mode's
 * signature move — write a claim, refute it later by striking it WHERE IT
 * STANDS. The gesture is one factory (`backRefFactory`) fed by one host
 * seam (`BoardCanvas::measureBackRef`), and `reveal.test.ts` already pins
 * the factory against a synthetic seam. What was never pinned is the seam
 * itself: whether the host consents to measure at all.
 *
 * It has to say no exactly once — P1-1: ink aimed at a board an erase had
 * ALREADY taken away has no face to land on (the erase's declared target
 * set and the DOM subtree it hides must stay the same set). That verdict
 * belongs to the fold, which walks the document IN ORDER and publishes it
 * as `BoardLayout.orphaned`. Re-deriving it in the viewer from the
 * document-FINAL `eraseOps` list drops the ordering and turns "erased
 * before" into "erased ever" — so a claim struck while it stood, on a
 * board wiped ten steps later, silently drew nothing (2026-08-11).
 *
 * Hence the shape of this file: one case per relationship between the
 * annotation and the erase that eventually takes its target away —
 * BEFORE (refuse, and say so out loud), AFTER (ink), NEVER (ink) — plus
 * the cross-panel geometry the annotation is measured in.
 *
 * happy-dom has no layout engine, so the `.bansho-w` segment spans are
 * given synthetic client rects here (see `stubRects`). That is enough:
 * everything downstream of the seam — row grouping, shape generation,
 * path emission — is pure, and the question this file asks is binary
 * (did the host measure, or refuse?).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import type { EnvCaps, StepRef } from "../engine/types.js";
import type { CompiledBoard } from "../viewer/BoardCanvas.js";

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

const CLAIM = "我大概有 99% 的可能，是真的病了";

/** Row assignment for the synthetic span rects — swapped per test. */
let rowOfSpan: (index: number) => number = () => 0;
/** Stable per-element index, in the order the seam measures them. */
let spanIndex: WeakMap<object, number>;
let spanCount = 0;

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

  // Synthetic layout. `.bansho-w` spans (the offset→DOM vocabulary the
  // seam maps character ranges onto) get a real box; everything else —
  // notably the measurement BASE, the panel — sits at the origin, so the
  // funnel's origin subtraction is identity and the numbers below are the
  // span rects themselves.
  //
  // happy-dom Window instances share ONE Element class from the module
  // cache, so this patch is global to the process. Two rules follow, both
  // paid for by reveal.test.ts's own synthetic-layout suite: patch
  // `Element.prototype` (where the method actually lives — assigning onto
  // `HTMLElement.prototype` mints an own property that SHADOWS Element's
  // for good, and the next suite's stub silently never fires), and
  // restore through the original descriptor rather than by assignment.
  const proto = (window as unknown as { Element: { prototype: object } }).Element
    .prototype as { getBoundingClientRect: () => unknown };
  const originalRect = Object.getOwnPropertyDescriptor(
    proto,
    "getBoundingClientRect",
  );
  const box = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
  proto.getBoundingClientRect = function (this: { classList?: DOMTokenList }) {
    if (!this.classList?.contains("bansho-w")) return box(0, 0, 1000, 800);
    let i = spanIndex.get(this as object);
    if (i === undefined) {
      i = spanCount++;
      spanIndex.set(this as object, i);
    }
    const top = 200 + rowOfSpan(i) * 60;
    return box(100 + i * 30, top, 100 + i * 30 + 28, top + 40);
  };

  restore = () => {
    if (originalRect) {
      Object.defineProperty(proto, "getBoundingClientRect", originalRect);
    } else {
      delete (proto as { getBoundingClientRect?: unknown })
        .getBoundingClientRect;
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

beforeEach(() => {
  rowOfSpan = () => 0;
  spanIndex = new WeakMap();
  spanCount = 0;
});

interface Mounted {
  host: HTMLElement;
  compiled: CompiledBoard | null;
  unmount(): Promise<void>;
}

/** Mount BoardCanvas on `source` with the playhead parked at the end. */
async function mount(source: string): Promise<Mounted> {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

  const lecture = parseLecture(source, "backref-ink");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let compiled: CompiledBoard | null = null;

  await act(async () => {
    root.render(
      <BoardCanvas
        lecture={lecture}
        view="board"
        theme="light"
        fontsReady
        env={ENV}
        getPlayheadT={() => 1e9}
        onCompiled={(next) => {
          compiled = next;
        }}
        activeIndex={0}
        playing={false}
        follow="live"
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
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** The one back-reference node on the board, with its two overlays. */
function theAnnotation(host: HTMLElement): {
  node: HTMLElement;
  /** Strokes: circles / strikes / underlines (z-index 2). */
  over: Element[];
  /** Bands: the highlighter's filled shapes (z-index 0, plus its defs). */
  under: Element[];
  panelIndex: number;
} {
  const nodes = host.querySelectorAll(".bansho-backref");
  expect(nodes.length).toBe(1);
  const node = nodes[0] as unknown as HTMLElement;
  const panels = Array.from(host.querySelectorAll(".bansho-panel"));
  return {
    node,
    over: Array.from(node.querySelectorAll(".bansho-backref-over path")),
    under: Array.from(node.querySelectorAll(".bansho-backref-under path")),
    panelIndex: panels.findIndex((p) => p.contains(node)),
  };
}

const refsOf = (refs: StepRef[]): string[] =>
  refs.map((r) => `${r.section}:${r.step}`);

describe("back-reference ink — the target stood when the pen turned back", () => {
  /**
   * The reported defect, in the shape it was reported: the pen has walked
   * to another board, turns back to strike a claim standing on the first
   * one, and only LATER is that first board wiped. Nothing about the
   * strike is orphaned — the fold assigns it, `check-board` finds
   * nothing — so it must draw.
   */
  test("a strike whose target board is erased LATER still lands", async () => {
    const m = await mount(
      [
        "@board 2",
        "",
        "# 板书回指",
        "",
        `${CLAIM}。`,
        "",
        "@turn",
        "",
        "现在笔走到了第二块板。",
        "",
        `@strike "${CLAIM}"`,
        "",
        "删除线应该落在第一块板那句话上。",
        "",
        `@erase "${CLAIM}"`,
        "",
        "第一块板擦干净了，接着写。",
      ].join("\n"),
    );
    const ink = theAnnotation(m.host);

    expect(ink.over.length).toBeGreaterThan(0);
    // The fold homed the ink onto its target's board — the pen turned
    // BACK across the gap, it did not annotate where it was standing.
    expect(ink.panelIndex).toBe(0);
    // Nothing orphaned: the erase happens after the ink, so the two are
    // members of one run and get wiped together (P1-1's set equality).
    expect(refsOf(m.compiled?.inkAfterErase ?? [])).toEqual([]);

    await m.unmount();
  });

  /** The same defect at its smallest: one long strip, one later erase. */
  test("on the single strip, an erase further down does not veto the ink", async () => {
    const m = await mount(
      [
        "# 板书回指",
        "",
        `${CLAIM}。`,
        "",
        `@strike "${CLAIM}"`,
        "",
        "删除线应该落在上面那句话上。",
        "",
        "@erase",
        "",
        "擦掉之后，新的一段写在干净的板上。",
      ].join("\n"),
    );
    const ink = theAnnotation(m.host);

    expect(ink.over.length).toBeGreaterThan(0);
    expect(refsOf(m.compiled?.inkAfterErase ?? [])).toEqual([]);

    await m.unmount();
  });

  /** No erase anywhere — the baseline that was never broken. */
  test("a plain cross-board strike lands on its target's board", async () => {
    const m = await mount(
      [
        "@board 2",
        "",
        "# 板书回指",
        "",
        `${CLAIM}。`,
        "",
        "@turn",
        "",
        "现在笔走到了第二块板。",
        "",
        `@strike "${CLAIM}"`,
      ].join("\n"),
    );
    const ink = theAnnotation(m.host);

    expect(ink.over.length).toBeGreaterThan(0);
    expect(ink.panelIndex).toBe(0);

    await m.unmount();
  });

  /**
   * G8-B through the real seam: a target that wraps onto two rendered
   * lines is two strokes, never one giant box across both.
   */
  test("a target spanning two lines draws one stroke per line", async () => {
    rowOfSpan = (i) => i % 2;
    const m = await mount(
      [
        "# 板书回指",
        "",
        `${CLAIM}。`,
        "",
        `@strike "${CLAIM}"`,
        "",
        "@erase",
        "",
        "擦掉之后的新一段。",
      ].join("\n"),
    );
    const ink = theAnnotation(m.host);

    expect(ink.over.length).toBe(2);
    expect(ink.over[0]!.getAttribute("d")).not.toBe(
      ink.over[1]!.getAttribute("d"),
    );

    await m.unmount();
  });
});

describe("back-reference ink — every gesture shares the one seam", () => {
  const cases = [
    { verb: "strike", layer: "over" as const },
    { verb: "circle", layer: "over" as const },
    { verb: "underline", layer: "over" as const },
    // The highlighter is a filled band revealed through a clip window
    // (G8-I), so it lands UNDER the writing, not over it.
    { verb: "highlight", layer: "under" as const },
  ];

  for (const { verb, layer } of cases) {
    test(`@${verb} draws when its target board is erased later`, async () => {
      const m = await mount(
        [
          "# 板书回指",
          "",
          `${CLAIM}。`,
          "",
          `@${verb} "${CLAIM}"`,
          "",
          "@erase",
          "",
          "擦掉之后的新一段。",
        ].join("\n"),
      );
      const ink = theAnnotation(m.host);

      expect(ink[layer].length).toBeGreaterThan(0);

      await m.unmount();
    });
  }
});

describe("back-reference ink — P1-1: an erase swallows nothing it did not erase", () => {
  /**
   * The inverse case, and the reason the seam has a veto at all: the
   * board carrying the target was wiped BEFORE the pen turned back. There
   * is no face to draw on, so the gesture degrades inert — and says so,
   * loudly, through the same finding channel an unmatched quote uses.
   * Silent invisibility is the one wrong answer.
   */
  test("ink aimed at an already-erased board draws nothing and is reported", async () => {
    const m = await mount(
      [
        "# 板书回指",
        "",
        `${CLAIM}。`,
        "",
        "@erase",
        "",
        "板擦干净了，先前那句话已经不在了。",
        "",
        `@strike "${CLAIM}"`,
      ].join("\n"),
    );
    const ink = theAnnotation(m.host);

    expect(ink.over.length).toBe(0);
    expect(ink.under.length).toBe(0);
    expect(refsOf(m.compiled?.inkAfterErase ?? []).length).toBe(1);

    await m.unmount();
  });

  /**
   * The erased-later board and the erased-before board in ONE document:
   * the fold's ordering — not a global "was this run ever erased" scan —
   * is what tells them apart.
   */
  test("two erases, one document: only the one that came first vetoes", async () => {
    const m = await mount(
      [
        "@board 2",
        "",
        "# 板书回指",
        "",
        `${CLAIM}。`,
        "",
        "@turn",
        "",
        "第二块板的第一句。",
        "",
        `@strike "${CLAIM}"`,
        "",
        `@erase "${CLAIM}"`,
        "",
        "第一块板重新开张。",
      ].join("\n"),
    );

    expect(theAnnotation(m.host).over.length).toBeGreaterThan(0);
    expect(refsOf(m.compiled?.inkAfterErase ?? [])).toEqual([]);

    await m.unmount();
  });
});
