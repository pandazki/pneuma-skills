/** @jsxImportSource react */
/**
 * A theme flip is a font change, so the board must re-measure.
 *
 * The light and dark `--hand` stacks name different faces (board-css.ts),
 * and every ink overlay, back-reference anchor and aligned column on the
 * board is a MEASUREMENT of the text as laid out in the current face. So a
 * theme toggle has to invalidate all of them — but reconcile cannot see it
 * on its own: the bytes did not change, every content hash still matches,
 * and the plan is a no-op. The board would keep the nodes it measured
 * against the old face while the text re-flows underneath them.
 *
 * That is exactly the defect the T8 English screenshots caught (a closing
 * circle landing on the paragraph's first two words, a stray arc left on a
 * heading rule), so it gets an assertion rather than a README paragraph.
 *
 * What is asserted is node IDENTITY: after the flip every step node is a
 * freshly built one, which is the only externally visible fact that means
 * "the geometry was measured again". Bun has no layout engine, so the
 * pixels themselves stay the screenshot's job.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import type { EnvCaps } from "../engine/types.js";

const SOURCE = [
  "# Board",
  "",
  "The ceiling is set by the ((serial fraction)).",
  "",
  "- Parallel work: thinner slices",
  "- Serial work: unmoved",
  "",
].join("\n");

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

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
  // happy-dom ships no ResizeObserver; the width watcher only needs the
  // shape (a real resize is a different path, tested by the screenshots).
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

describe("BoardCanvas — a theme flip re-measures the board", () => {
  test("every step node is rebuilt when the theme changes", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

    const lecture = parseLecture(SOURCE, "theme-remeasure");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    const props = {
      lecture,
      view: "board" as const,
      fontsReady: true,
      env: ENV,
      getPlayheadT: () => 999,
      onCompiled: () => {},
      activeIndex: 0,
      playing: false,
      follow: "live" as const,
      onSeek: () => () => {},
      onFrame: () => () => {},
      selectedRef: null,
    };

    await act(async () => {
      root.render(<BoardCanvas {...props} theme="light" />);
    });

    const nodesOf = (): Element[] =>
      Array.from(host.querySelectorAll("[data-bansho-ref]"));
    const before = nodesOf();
    expect(before.length).toBeGreaterThan(0);

    // Same bytes, same width — only the face changes. Reconcile alone
    // would keep every node (all hashes match); the invalidation is what
    // makes the board measure itself again.
    await act(async () => {
      root.render(<BoardCanvas {...props} theme="dark" />);
    });
    const after = nodesOf();

    expect(after.length).toBe(before.length);
    for (const node of after) {
      expect(before.includes(node)).toBe(false);
    }

    // A re-render that changes nothing measurable must NOT churn the board
    // — the rebuild is invalidation-driven, not "on every render".
    await act(async () => {
      root.render(<BoardCanvas {...props} theme="dark" />);
    });
    expect(nodesOf()).toEqual(after);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
