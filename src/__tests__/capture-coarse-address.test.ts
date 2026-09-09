/**
 * Pins the coarse/fine split that decides whether `capture` navigates before
 * it screenshots (`src/hooks/useCaptureAction.ts::isCoarseAddress`).
 *
 * A missing coarse key does not fail loudly at runtime — the framework simply
 * shoots whatever is already on screen, and the agent gets a plausible
 * picture of the wrong object. That silence is why the registry is pinned
 * here: adding a mode's coarse key is a protocol act, not a detail.
 */

import { describe, test, expect } from "bun:test";
import { isCoarseAddress } from "../hooks/useCaptureAction.js";

describe("isCoarseAddress — coarse keys drive a navigation first", () => {
  const coarse: Array<[string, Record<string, unknown>]> = [
    ["doc / webcraft page", { page: 2 }],
    ["file-addressed modes", { file: "index.html" }],
    ["slide", { slide: 3 }],
    ["framework content set", { contentSet: "lumi" }],
    ["diagram node", { nodeId: "n4" }],
    ["draw element", { elementId: "e7" }],
    ["illustrate image", { image: "hero.png" }],
    ["bansho section", { section: "intro" }],
    ["bansho step", { step: 12 }],
    ["eli5 audience rung", { audience: "child" }],
    ["sprite motion", { motion: "attack" }],
    ["sprite reference", { ref: "turnaround" }],
  ];

  for (const [label, address] of coarse) {
    test(`${label} is coarse`, () => {
      expect(isCoarseAddress(address)).toBe(true);
    });
  }

  test("a coarse key still counts when it rides along with a fine one", () => {
    expect(isCoarseAddress({ motion: "attack", frame: 7 })).toBe(true);
    expect(isCoarseAddress({ slide: 3, selector: ".title" })).toBe(true);
  });
});

describe("isCoarseAddress — fine keys resolve in place", () => {
  test("selector and anchor never trigger a navigation", () => {
    expect(isCoarseAddress({ selector: ".hero h1" })).toBe(false);
    expect(isCoarseAddress({ anchor: "why-it-matters" })).toBe(false);
  });

  test("sprite's frame is fine — seeking inside the open motion is in-place", () => {
    expect(isCoarseAddress({ frame: 7 })).toBe(false);
  });

  test("an empty or absent address shoots the current viewport", () => {
    expect(isCoarseAddress({})).toBe(false);
    expect(isCoarseAddress(undefined)).toBe(false);
  });

  test("an unknown key is not coarse — a mode that coins one must register it", () => {
    expect(isCoarseAddress({ chapter: 4 })).toBe(false);
  });
});
