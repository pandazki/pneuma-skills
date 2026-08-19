/**
 * `readOverflowParts` — the HOST half of the §9 `boardOverflow` width
 * check (the same split `readMathErrors` has: the host reads the DOM, the
 * pure classifier in board-check.ts turns it into words).
 *
 * Why the walk exists at all: `scrollWidth` counts every descendant the
 * step is the containing block for, and the W3 re-based back-reference
 * overlay is the panel's full width INSIDE its target's box by design —
 * measured live (tech-zh seed, 2026-08-19), a 565px column with a @strike
 * on it reads scrollWidth 1198 while every written word fits. The walk
 * names which child actually crosses the box's right edge, so the pure
 * verdict can tell designed bleed from writing the reader loses.
 *
 * happy-dom has no layout engine, so the offset family is stubbed per
 * instance — the geometry here is the live board's own (the 565/1198/1898
 * numbers above), not invented.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { readOverflowParts } from "../viewer/BoardCanvas.js";

const win = new Window({ url: "http://localhost/" });

/** The globals the walk touches (the collision-mark suite's pattern). */
const INSTALLED = [
  "document",
  "HTMLElement",
  "Element",
  "SVGSVGElement",
  "getComputedStyle",
] as const;
const saved: Record<string, unknown> = {};

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  for (const key of INSTALLED) {
    saved[key] = g[key];
    g[key] = w[key];
  }
});

afterAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of INSTALLED) g[key] = saved[key];
});

/** Stub the layout family on one element (happy-dom measures nothing). */
function box(
  el: unknown,
  geom: {
    offsetLeft: number;
    offsetWidth: number;
    scrollWidth?: number;
    clientWidth?: number;
    offsetParent?: unknown;
  },
): void {
  for (const [key, value] of Object.entries(geom)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }
  if (!("scrollWidth" in geom)) {
    Object.defineProperty(el, "scrollWidth", {
      value: geom.offsetWidth,
      configurable: true,
    });
  }
}

describe("readOverflowParts — which child crosses the step's right edge", () => {
  test("the live false-positive shape: overlay names itself, writing stays quiet", () => {
    const doc = win.document;
    const step = doc.createElement("div");
    step.className = "bansho-step bansho-prose";
    box(step, { offsetLeft: 44, offsetWidth: 565, clientWidth: 565, offsetParent: null });

    // The W3 re-based overlay: panel-wide, pulled left of the box.
    const overlay = doc.createElement("div");
    overlay.className = "bansho-backref";
    box(overlay, { offsetLeft: -44, offsetWidth: 1242, offsetParent: step });
    step.appendChild(overlay);

    // The writing, fitting its column exactly.
    const text = doc.createElement("div");
    text.className = "bansho-text";
    text.textContent = "慢了就加机器。这句话在小规模上几乎总是对的。";
    box(text, { offsetLeft: 0, offsetWidth: 565, offsetParent: step });
    step.appendChild(text);

    const parts = readOverflowParts(step as unknown as HTMLElement);
    expect(parts).toEqual([{ classes: "bansho-backref", right: 1198 }]);
  });

  test("the live true-positive shape: the token span carries its own text", () => {
    const doc = win.document;
    const step = doc.createElement("div");
    step.className = "bansho-step bansho-prose";
    box(step, { offsetLeft: 44, offsetWidth: 565, clientWidth: 565, offsetParent: null });

    const text = doc.createElement("div");
    text.className = "bansho-text";
    box(text, {
      offsetLeft: 0,
      offsetWidth: 565,
      scrollWidth: 1898,
      offsetParent: step,
    });
    step.appendChild(text);

    const word = doc.createElement("span");
    word.className = "bansho-w";
    word.textContent = "VeryLongConfigurationKey";
    box(word, { offsetLeft: 0, offsetWidth: 1898, offsetParent: step });
    text.appendChild(word);

    const parts = readOverflowParts(step as unknown as HTMLElement);
    expect(parts).toEqual([
      {
        classes: "bansho-text",
        right: 1898,
        text: "VeryLongConfigurationKey",
      },
      {
        classes: "bansho-w",
        right: 1898,
        text: "VeryLongConfigurationKey",
      },
    ]);
  });

  test("children inside the box are not parts — crossing is the bar", () => {
    const doc = win.document;
    const step = doc.createElement("div");
    box(step, { offsetLeft: 0, offsetWidth: 565, clientWidth: 565, offsetParent: null });
    const inside = doc.createElement("div");
    inside.textContent = "fits";
    box(inside, { offsetLeft: 0, offsetWidth: 400, offsetParent: step });
    step.appendChild(inside);
    expect(readOverflowParts(step as unknown as HTMLElement)).toEqual([]);
  });
});
