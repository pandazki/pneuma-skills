// core/__tests__/player-support.test.ts
//
// Pins the hosted player's mode whitelist and the package-vs-player support
// decision. The whitelist is consumed on BOTH sides of the export seam:
// `server/play-export.ts` stamps `PlayPackageIndex.supported` at export time,
// and the player shell decides whether to mount the viewer. A package's stamp
// is frozen at export — `isPackagePlayable` is what lets a newer player render
// a package exported before its mode landed in the whitelist.

import { describe, expect, test } from "bun:test";
import {
  WEB_PLAYER_SUPPORTED_MODES,
  isModeWebPlayable,
  isPackagePlayable,
} from "../player-support.js";

describe("WEB_PLAYER_SUPPORTED_MODES", () => {
  test("carries the verified playable tier", () => {
    for (const mode of [
      "draw",
      "doc",
      "illustrate",
      "slide",
      "webcraft",
      "kami",
      "diagram",
      "remotion",
      "cosmos",
      "bansho",
      "wordtaste",
    ]) {
      expect(WEB_PLAYER_SUPPORTED_MODES).toContain(mode);
    }
  });

  test("keeps the intentionally-not-playable modes out", () => {
    // gridboard / clipcraft are a standing decision (see the module header);
    // mode-maker and the hidden internal modes are never shared surfaces.
    for (const mode of [
      "gridboard",
      "clipcraft",
      "mode-maker",
      "evolve",
      "project-evolve",
      "project-onboard",
      "project-tidy",
    ]) {
      expect(WEB_PLAYER_SUPPORTED_MODES).not.toContain(mode);
    }
  });
});

describe("isModeWebPlayable", () => {
  test("answers for listed and unlisted modes", () => {
    expect(isModeWebPlayable("bansho")).toBe(true);
    expect(isModeWebPlayable("wordtaste")).toBe(true);
    expect(isModeWebPlayable("clipcraft")).toBe(false);
    expect(isModeWebPlayable("gridboard")).toBe(false);
  });

  test("refuses empty input", () => {
    expect(isModeWebPlayable("")).toBe(false);
    expect(isModeWebPlayable(null)).toBe(false);
    expect(isModeWebPlayable(undefined)).toBe(false);
  });
});

describe("isPackagePlayable", () => {
  test("a stale negative stamp is widened when the live whitelist knows better", () => {
    // The user-facing case this exists for: a bansho package exported before
    // bansho entered the whitelist carries supported: false forever. The
    // player build that CAN render it must not bounce it to the fallback.
    expect(isPackagePlayable("bansho", false)).toBe(true);
    expect(isPackagePlayable("wordtaste", false)).toBe(true);
  });

  test("a positive stamp is always trusted", () => {
    // A package stamped supported by a future exporter (a mode this player
    // build predates) still gets its chance — loadMode decides from there.
    expect(isPackagePlayable("some-future-mode", true)).toBe(true);
    expect(isPackagePlayable("webcraft", true)).toBe(true);
  });

  test("false on both legs stays false", () => {
    expect(isPackagePlayable("clipcraft", false)).toBe(false);
    expect(isPackagePlayable("gridboard", false)).toBe(false);
    expect(isPackagePlayable("some-custom-mode", false)).toBe(false);
    expect(isPackagePlayable(undefined, false)).toBe(false);
    expect(isPackagePlayable(null, undefined)).toBe(false);
  });
});
