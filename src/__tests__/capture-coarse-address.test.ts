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
    ["lucid round", { round: 3 }],
    ["anime-series season overview", { season: "overview" }],
    ["anime-series character card (also backlot's bible character)", { character: "guang" }],
    ["anime-series group card", { group: "stickies" }],
    ["anime-series scene card (also backlot's script scene)", { scene: "office-night" }],
    ["anime-series bible card", { bible: "style" }],
    ["anime-series episode board", { episode: "ep01" }],
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

  test("lucid's view is fine — Live / Target / Split re-dress the same stage", () => {
    // `round` swaps a recorded capture onto the stage and must navigate first;
    // `view` only changes how what is already there is shown.
    expect(isCoarseAddress({ view: "split" })).toBe(false);
    expect(isCoarseAddress({ round: 2, view: "split" })).toBe(true);
  });

  test("anime-series' part, shot, time and take are fine — they move inside the open episode", () => {
    // `part` is subordinate to `episode`: it never names a place on its own.
    expect(isCoarseAddress({ part: "A" })).toBe(false);
    expect(isCoarseAddress({ shot: 5, lane: "clip" })).toBe(false);
    expect(isCoarseAddress({ time: 13.2 })).toBe(false);
    expect(isCoarseAddress({ take: "ep01-a-clip-2" })).toBe(false);
    expect(isCoarseAddress({ episode: "ep01", part: "A", shot: 5 })).toBe(true);
  });

  test("an empty or absent address shoots the current viewport", () => {
    expect(isCoarseAddress({})).toBe(false);
    expect(isCoarseAddress(undefined)).toBe(false);
  });

  test("an unknown key is not coarse — a mode that coins one must register it", () => {
    expect(isCoarseAddress({ chapter: 4 })).toBe(false);
  });
});
