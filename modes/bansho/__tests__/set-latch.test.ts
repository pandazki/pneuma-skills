/**
 * Content-set resolution + live-join latch (viewer/set-latch.ts).
 *
 * The scenario these pin is the mode's front door: open bansho on an empty
 * workspace, pick a demo board from the seed gallery, watch it be written.
 * `init.seedFiles` copies each seed into its OWN directory (`tech-zh/`,
 * `pitch-zh/`), which makes every seed a CONTENT SET — so that front door
 * runs through the async content-set matcher, and the matcher's
 * `null → "tech-zh"` transition arrives AFTER the board file exists.
 *
 * Treating that transition as a board switch re-judged the opening at a
 * moment when a lecture was already present, flipped the player to
 * join-at-tip, and the seeded board appeared fully written instead of
 * performing (transport read 0.0s/0.0s → 92.1s/92.1s with no intermediate
 * sample). The same bytes copied to the workspace ROOT — no content set, no
 * transition — played from 0, which is what makes it a latch bug and not a
 * timing quirk.
 */

import { describe, expect, test } from "bun:test";

import {
  hydrationJoin,
  relatchOnSelectionChange,
  resolveSetKey,
} from "../viewer/set-latch.js";

describe("resolveSetKey — one key for both the lecture and its theme", () => {
  test("an empty board resolves to nothing", () => {
    expect(resolveSetKey([], null)).toBeNull();
    expect(resolveSetKey([], "tech-zh")).toBeNull();
  });

  test("the root-shaped board resolves through the root key", () => {
    expect(resolveSetKey([""], null)).toBe("");
    expect(resolveSetKey([""], "")).toBe("");
  });

  test("an active set that exists wins", () => {
    expect(resolveSetKey(["pitch-zh", "tech-zh"], "tech-zh")).toBe("tech-zh");
  });

  test("the pre-selection window falls back to a REAL key, not the root", () => {
    // `activeContentSet` is still null (the matcher is async) while the
    // seeded board already exists. The lecture used to fall back here and
    // the theme did not — the same key has to serve both, or the board
    // renders with no theme.css.
    const key = resolveSetKey(["pitch-zh", "tech-zh"], null);
    expect(key).toBe("pitch-zh");
    expect(key).not.toBeNull();
  });

  test("an active set that no longer exists falls back like no selection", () => {
    expect(resolveSetKey(["pitch-zh"], "tech-zh")).toBe("pitch-zh");
  });

  test("the root key outranks array order when both are available", () => {
    expect(resolveSetKey(["tech-zh", ""], "nope")).toBe("");
  });

  test("the fallback is SORTED order, not insertion order", () => {
    // The caller passes Object.keys(byContentSet) — readdir + watcher
    // insertion order, which nothing guarantees. The async matcher resolves
    // through alphabetically sorted contentSets, so the fallback must sort
    // too or the transient pre-selection compile lands on a
    // filesystem-order-dependent board.
    expect(resolveSetKey(["tech-zh", "pitch-zh"], null)).toBe("pitch-zh");
    expect(resolveSetKey(["pitch-zh", "tech-zh"], null)).toBe("pitch-zh");
  });
});

describe("relatchOnSelectionChange — a resolution is not a switch", () => {
  test("no transition decides nothing", () => {
    expect(relatchOnSelectionChange("tech-zh", "tech-zh", true)).toBeNull();
    expect(relatchOnSelectionChange(null, null, false)).toBeNull();
  });

  test("REGRESSION — the seeded opening keeps the hydration latch", () => {
    // The blocker, in one assertion: the matcher resolves null → "tech-zh"
    // on a board that already has a lecture (the seed landed whole). A
    // non-null answer here re-latches the player to join-at-tip and the
    // freshly seeded board appears fully written instead of performing.
    expect(relatchOnSelectionChange(null, "tech-zh", true)).toBeNull();
  });

  test("a genuine switch to a board with content joins at its tip", () => {
    expect(relatchOnSelectionChange("tech-zh", "pitch-zh", true)).toBe(true);
  });

  test("a genuine switch to an empty board plays its first compile from 0", () => {
    expect(relatchOnSelectionChange("tech-zh", "pitch-zh", false)).toBe(false);
  });

  test("root → prefix is a real switch (the root board was a board)", () => {
    // "" is a resolved key, not "unresolved": a board sitting at the
    // workspace root that the user then switches away from is a switch.
    expect(relatchOnSelectionChange("", "tech-zh", true)).toBe(true);
  });

  test("the latch is decided on the SELECTION, never on the rendered key", () => {
    // Dropping the compiled board is the other axis, and it must follow
    // `resolveSetKey` — BoardCanvas is keyed on that, and only its remount
    // produces a new compile. Coupling the two dropped a compiled board
    // that was never rebuilt: the board rendered in full while the
    // transport sat at 0.0s/0.0s with nothing driving it. This asserts the
    // shapes stay independent — one selection transition, two rendered
    // keys, and the selection axis does not know the difference.
    const keys = ["pitch-zh", "tech-zh"];
    expect(resolveSetKey(keys, null)).toBe("pitch-zh");
    expect(resolveSetKey(keys, "tech-zh")).toBe("tech-zh");
    expect(relatchOnSelectionChange(null, "tech-zh", true)).toBeNull();
  });
});

describe("hydrationJoin — the opening verdict reads the HYDRATION SNAPSHOT, not live files", () => {
  // The third wrong path (after the two the module header documents): on
  // an empty workspace with seeds declared, the app shell shows the seed
  // gallery INSTEAD of the viewer — so the viewer's very first mount
  // happens only after seed content landed. A latch reading the live file
  // list at that moment sees board.md, judges the board pre-existing, and
  // the freshly seeded demo appears fully written in one frame, never
  // performed. The verdict must be "was this board there when the
  // WORKSPACE opened", which only the hydration snapshot can answer.
  test("not hydrated yet → no verdict (the conservative default stays tip)", () => {
    expect(hydrationJoin(null)).toBeNull();
  });

  test("empty at hydration → the first board IS the broadcast: play from 0", () => {
    expect(hydrationJoin([])).toBe(false);
    // …even when the seed landed before the viewer mounted — the snapshot
    // does not contain it, and that is the point.
    expect(hydrationJoin([".pneuma/session.json"])).toBe(false);
  });

  test("a board that existed at hydration is history: join at the tip (F22)", () => {
    expect(hydrationJoin(["board.md"])).toBe(true);
    expect(hydrationJoin(["tech-zh/board.md", "tech-zh/theme.css"])).toBe(true);
  });
});
