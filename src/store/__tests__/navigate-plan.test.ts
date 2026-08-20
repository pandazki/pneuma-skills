/**
 * What a locator click decides before anything moves.
 *
 * The bar: the address's `contentSet` is the ONE framework coordinate, and
 * every way it can be wrong must end somewhere a person can see. The bug
 * this file was written against (2026-08-20): an address naming a board the
 * workspace does not have skipped the switch and dispatched the REST of the
 * address anyway, so the click landed on whichever board was open — a wrong
 * move dressed as a right one, silent in both directions.
 */

import { describe, expect, test } from "bun:test";

import { planNavigate } from "../navigate-plan.js";

const SETS = [{ prefix: "tech-zh" }, { prefix: "pitch-zh" }];

describe("planNavigate — the board half of the address", () => {
  test("another board: switch first, then hand over the rest — delayed", () => {
    const plan = planNavigate(
      { contentSet: "pitch-zh", section: 2, step: 1 },
      "tech-zh",
      SETS,
    );
    expect(plan).toEqual({
      kind: "dispatch",
      address: { section: 2, step: 1 },
      switchTo: "pitch-zh",
      delayed: true,
    });
  });

  test("the board already open: hand over at once, no switch, no wait", () => {
    const plan = planNavigate(
      { contentSet: "tech-zh", section: 2, step: 1 },
      "tech-zh",
      SETS,
    );
    expect(plan).toEqual({
      kind: "dispatch",
      address: { section: 2, step: 1 },
      delayed: false,
    });
  });

  test("a board this workspace does not have is REFUSED, not redirected", () => {
    // The whole point. Dispatching `{section:2, step:1}` here would move the
    // open board and report nothing — the failure that reads as success.
    const plan = planNavigate(
      { contentSet: "pitch-en", section: 2, step: 1 },
      "tech-zh",
      SETS,
    );
    expect(plan).toEqual({
      kind: "refuse",
      code: "unknownContentSet",
      contentSet: "pitch-en",
    });
  });

  test("a trailing slash is forgiven — it is the shape a seed catalogue writes", () => {
    const plan = planNavigate({ contentSet: "pitch-zh/", section: 1 }, "tech-zh", SETS);
    expect(plan).toEqual({
      kind: "dispatch",
      address: { section: 1 },
      switchTo: "pitch-zh",
      delayed: true,
    });
  });

  test("a workspace with no boards at all still dispatches — nothing to check against", () => {
    // Content at the workspace root. Refusing here would break every
    // address an agent writes out of habit, for no gain.
    expect(planNavigate({ contentSet: "whatever", section: 1 }, null, [])).toEqual({
      kind: "dispatch",
      address: { section: 1 },
      delayed: false,
    });
  });

  test("a board and nothing inside it: switch, then stop", () => {
    expect(planNavigate({ contentSet: "pitch-zh" }, "tech-zh", SETS)).toEqual({
      kind: "switch",
      switchTo: "pitch-zh",
    });
  });

  test("the board already open and nothing inside it is a no-op, not a failure", () => {
    // An empty address handed to a viewer resolves nothing and comes back
    // as an error; arriving where you already are is not an error.
    expect(planNavigate({ contentSet: "tech-zh" }, "tech-zh", SETS)).toEqual({
      kind: "noop",
    });
  });
});

describe("planNavigate — a file path carrying its board as a prefix", () => {
  test("the prefix picks the board and is stripped off the path", () => {
    expect(planNavigate({ file: "pitch-zh/deck.md", anchor: "x" }, "tech-zh", SETS)).toEqual({
      kind: "dispatch",
      address: { file: "deck.md", anchor: "x" },
      switchTo: "pitch-zh",
      delayed: true,
    });
  });

  test("an explicit contentSet strips its own prefix off the file too", () => {
    expect(
      planNavigate({ contentSet: "tech-zh", file: "tech-zh/board.md" }, "tech-zh", SETS),
    ).toEqual({
      kind: "dispatch",
      address: { file: "board.md" },
      delayed: false,
    });
  });

  test("a path under no known board is handed over untouched", () => {
    expect(planNavigate({ file: "notes.md" }, "tech-zh", SETS)).toEqual({
      kind: "dispatch",
      address: { file: "notes.md" },
      delayed: false,
    });
  });

  test("a mode-defined address with no board coordinate at all passes through", () => {
    expect(planNavigate({ nodeId: "n7" }, "tech-zh", SETS)).toEqual({
      kind: "dispatch",
      address: { nodeId: "n7" },
      delayed: false,
    });
  });
});
