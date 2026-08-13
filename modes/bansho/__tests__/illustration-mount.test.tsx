/** @jsxImportSource react */
/**
 * NOTHING MAY BE PUSHED OUT OF FRAME —— 「不能有什么东西被挤出画面」, at the
 * seam where a figure's box is actually written.
 *
 * The defect this suite exists for, measured in Chromium on 2026-08-13:
 * every figure was drawn at the FULL board width and hung off the right
 * edge by exactly its own `left`. A half-width column figure was 1242px
 * wide in a 1242px board at `left: 633px` — 633px of it, over half the
 * picture, outside the board. `illustration.test.ts` §5 pins the
 * arithmetic that decides the box; this file pins that the arithmetic
 * REACHES THE NODE, because the gap was never in the numbers: the mount
 * wrote a correct `left` and a correct `right` onto a box whose
 * `width: 100%` resolved against the containing block and dropped both.
 *
 * Pure tests could not have caught that, and neither could a screenshot —
 * a camera crops the board, so a figure that fits can look cut and a
 * figure that is cut can look fine. So this suite mounts the REAL
 * BoardCanvas with a REAL illustration source and reads the geometry back
 * off the mounted node, in the mount's own coordinates.
 *
 * happy-dom has no layout engine, so what is readable here is the STYLE
 * the mount wrote, not `offsetWidth`. That is exactly the layer the defect
 * lived at (`style.width` was never written at all), and the two axes of
 * the box are pinned as numbers in `illustration.test.ts` §5. The real
 * `offsetLeft + offsetWidth` reading is the CDP pass's job.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import { BOARD_BASE_CSS } from "../viewer/board-css.js";
import type { EnvCaps } from "../engine/types.js";
import {
  illustrationSource,
  readIllustrationManifest,
} from "../illustrations/types.js";

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

/** One synthetic box every element reports — the whole layout engine. */
const BOX_W = 1200;
const BOX_H = 44;

/** Wide, tall, square — the three shapes that actually broke. */
const ASPECTS: readonly (readonly [string, number])[] = [
  ["16:9", 16 / 9],
  ["3:4", 3 / 4],
  ["1:1", 1],
];

/**
 * The face this harness folds against. happy-dom resolves no stylesheet
 * padding, so the panel's own 36 / 44 / 64 never lands and the face is the
 * canonical board itself: 894 deep, and a band or a corner half that less
 * the region gutter. Every vertical assertion below is written as a
 * CEILING — a happy-dom that one day DOES resolve the padding makes the
 * real face shallower, which satisfies these more easily, never less.
 */
const PANEL_H = 894;
const REGION_GUTTER = 24;
const BAND_H = (PANEL_H - REGION_GUTTER) / 2;

/** The region words whose depth is the whole face rather than a band. */
const FULL_DEPTH = new Set(["full", "left", "right"]);

/** Every region word a bounded board admits. */
const REGIONS = [
  "full",
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

const MANIFEST = (aspect: number) =>
  readIllustrationManifest(
    JSON.stringify({ figures: { "illustrations/fig.png": { aspect } } }),
  ).manifest;

/**
 * A two-board lecture — `@board 2` is what gives the face a BOTTOM (a
 * single board is the strip, whose depth is unbounded and on which the
 * vertical half of this floor has no referent).
 */
const lectureFor = (region: string): string =>
  [
    "@board 2",
    "",
    "# 眼睛",
    "",
    ...(region === "full" ? [] : [`@at ${region}`, ""]),
    "![横切面](illustrations/fig.png)",
    "",
  ].join("\n");

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

  const proto = window.HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
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

interface Placed {
  /** The inline geometry the mount wrote, in board-padding-box px. */
  left: number;
  right: number;
  width: number;
  /** The aspect the factory declared on the same node. */
  aspect: number;
  unmount(): Promise<void>;
}

async function place(region: string, aspect: number): Promise<Placed> {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

  const lecture = parseLecture(lectureFor(region), "board.md");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      <BoardCanvas
        lecture={lecture}
        view="board"
        theme="dark"
        fontsReady={true}
        env={ENV}
        illustrations={illustrationSource(
          MANIFEST(aspect),
          "",
          (path) => `/api/file?path=${encodeURIComponent(path)}`,
        )}
        getPlayheadT={() => 9999}
        onCompiled={() => {}}
        activeIndex={0}
        playing={false}
        follow="detached"
        onSeek={() => () => {}}
        onFrame={() => () => {}}
        selectedRef={null}
      />,
    );
  });

  const figure = host.querySelector(".bansho-illustration") as HTMLElement | null;
  if (!figure) throw new Error(`no figure was drawn for @at ${region}`);
  const px = (value: string): number => Number.parseFloat(value);
  return {
    left: px(figure.style.left),
    right: px(figure.style.right),
    width: px(figure.style.width),
    aspect: px(figure.style.aspectRatio),
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("a figure's box is written explicitly, and it fits", () => {
  for (const region of REGIONS) {
    for (const [label, aspect] of ASPECTS) {
      test(`@at ${region} × ${label}: the box has a width, and it stays inside`, async () => {
        const placed = await place(region, aspect);
        try {
          // THE DEFECT, at the layer it lived at: no explicit width, so
          // the browser sized the box from the containing block and the
          // insets were dropped. `NaN` here is the 1242-instead-of-565.
          expect(Number.isFinite(placed.width)).toBe(true);
          expect(placed.width).toBeGreaterThan(0);

          // Its own region — the axis the measurement caught at 633px.
          // `right` is the inset from the board's right edge, so the
          // region's right edge is `BOX_W - right`.
          const regionW = BOX_W - placed.left - placed.right;
          expect(placed.width).toBeLessThanOrEqual(regionW + 0.5);
          expect(placed.left + placed.width).toBeLessThanOrEqual(
            BOX_W - placed.right + 0.5,
          );

          // …and the board, which is the floor itself.
          expect(placed.left).toBeGreaterThanOrEqual(0);
          expect(placed.left + placed.width).toBeLessThanOrEqual(BOX_W + 0.5);

          // THE OTHER AXIS — the half that a 1:1 figure broke by hanging
          // 384px off the bottom. Height is not readable in happy-dom, but
          // it is not a measurement either: it is this width through the
          // declared aspect, which is the whole reason the box has to be
          // sized rather than inset.
          const height = placed.width / placed.aspect;
          expect(height).toBeLessThanOrEqual(
            (FULL_DEPTH.has(region) ? PANEL_H : BAND_H) + 0.5,
          );

          // The shape is still the DECLARED one — never squashed to fit.
          expect(placed.aspect).toBeCloseTo(aspect, 6);
        } finally {
          await placed.unmount();
        }
      });
    }
  }

  test("the numbers themselves: a column's width, and a band's depth", async () => {
    // Not just "it fits" — the two bindings, each at its own number, so a
    // clamp that quietly collapsed every figure to something tiny would
    // fail here rather than pass the inequalities above.
    const column = await place("right", 16 / 9);
    try {
      // The region IS the box: a half-face column of the 1200px harness
      // face. Before the fix this read NaN — no width was written at all,
      // and the browser used the containing block's full 1200.
      expect(column.width).toBeCloseTo(BOX_W - column.left, 6);
      expect(column.width).toBeCloseTo(588, 6);
    } finally {
      await column.unmount();
    }

    // A band is half a face deep, so a square figure is bound by the
    // DEPTH and comes out narrower than the face it could have filled.
    const band = await place("top", 1);
    try {
      expect(band.width).toBeCloseTo(BAND_H, 6);
      expect(band.width).toBeLessThan(BOX_W);
    } finally {
      await band.unmount();
    }
  });

  test("a figure narrower than its region is CENTRED in it, not flushed left", () => {
    // The same convention display math already uses on this board
    // (`.bansho-math-block`'s auto margins): a teacher pins a picture in
    // the middle of the column it belongs to. With `left`, `right` and
    // `width` all set, auto inline margins are what splits the leftover.
    const rule = /\.bansho-illustration\s*\{[^}]*\}/.exec(BOARD_BASE_CSS)?.[0] ?? "";
    expect(rule).toMatch(/margin:\s*0\s+auto\s/);
    // …and the percentage width that made the insets moot is gone.
    expect(rule).not.toMatch(/width:\s*100%/);
  });
});
