/**
 * The player's build list must equal the player's whitelist.
 *
 * `core/player-support.ts` decides which modes a share link may render
 * (semantic, shared with the exporter); `src/player/player-modes.ts` decides
 * which viewers Vite compiles into `dist-player/` (build). Drift in either
 * direction is silent and only shows up on the deployed player: a whitelisted
 * mode with no entry hard-errors a share link, an entry outside the whitelist
 * ships megabytes nobody can reach.
 *
 * This is also the reason the player does not use `core/mode-loader.ts`'s
 * builtin registry — that one carries the BUNDLED set only, and most playable
 * modes (doc, draw, bansho, wordtaste, sprite, eli5) are catalog modes.
 */

import { describe, expect, test } from "bun:test";

import { PLAYER_MODE_NAMES, hasPlayerMode } from "../player-modes.js";
import { WEB_PLAYER_SUPPORTED_MODES } from "../../../core/player-support.js";
import { listBuiltinModes } from "../../../core/mode-loader.js";

describe("player mode registry", () => {
  test("carries exactly the web-playable modes", () => {
    expect([...PLAYER_MODE_NAMES].sort()).toEqual([...WEB_PLAYER_SUPPORTED_MODES].sort());
  });

  test("covers catalog modes the app bundle does not carry", () => {
    // The point of a separate registry: these are playable but not bundled.
    const builtins = listBuiltinModes();
    const catalogPlayables = PLAYER_MODE_NAMES.filter((n) => !builtins.includes(n));
    expect(catalogPlayables.length).toBeGreaterThan(0);
    expect(catalogPlayables).toContain("doc");
    expect(catalogPlayables).toContain("sprite");
  });

  test("hasPlayerMode answers for unknown and empty names", () => {
    expect(hasPlayerMode("slide")).toBe(true);
    expect(hasPlayerMode("clipcraft")).toBe(false);
    expect(hasPlayerMode(undefined)).toBe(false);
  });
});
