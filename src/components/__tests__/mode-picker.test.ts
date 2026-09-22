/**
 * The project picker's list, assembled from `/api/registry`.
 *
 * The rule worth pinning is the field rename: the registry reports a catalog
 * mode's install state as `state`, and every renderer reads `installState`.
 * A wrong mapping type-checks, and then offers a download for a mode that is
 * already on disk.
 */

import { describe, expect, test } from "bun:test";

import {
  mergeRegistryModes,
  needsDownload,
  type RegistryPayload,
} from "../../utils/mode-picker.js";

describe("mergeRegistryModes", () => {
  test("carries the registry's `state` across as `installState`", () => {
    const merged = mergeRegistryModes({
      catalog: [{ name: "sprite", state: "installed", unpackedSize: 1234 }],
    });
    expect(merged).toEqual([
      {
        name: "sprite",
        displayName: undefined,
        description: undefined,
        icon: undefined,
        source: "catalog",
        installState: "installed",
        unpackedSize: 1234,
      },
    ]);
  });

  test("an installed catalog mode is opened, not downloaded again", () => {
    const [mode] = mergeRegistryModes({ catalog: [{ name: "sprite", state: "installed" }] });
    expect(needsDownload(mode!)).toBe(false);
  });

  test("a not-installed or stale catalog mode downloads first", () => {
    const merged = mergeRegistryModes({
      catalog: [
        { name: "sprite", state: "not-installed" },
        { name: "lucid", state: "stale" },
      ],
    });
    expect(merged.map(needsDownload)).toEqual([true, true]);
  });

  test("a builtin never asks for a download", () => {
    const [mode] = mergeRegistryModes({ builtins: [{ name: "slide" }] });
    expect(needsDownload(mode!)).toBe(false);
  });

  test("catalog modes follow the builtins and precede local copies", () => {
    // One first-party list in one order: the user does not care which of
    // them happens to be inside the package.
    const reg: RegistryPayload = {
      builtins: [{ name: "slide" }],
      catalog: [{ name: "sprite", state: "not-installed" }],
      local: [{ name: "my-mode", path: "/Users/me/.pneuma/modes/my-mode" }],
    };
    expect(mergeRegistryModes(reg).map((m) => [m.name, m.source])).toEqual([
      ["slide", "builtin"],
      ["sprite", "catalog"],
      ["my-mode", "local"],
    ]);
  });

  test("a name in two buckets appears once, in the earlier bucket", () => {
    // A repo checkout reports every mode as a builtin; a local fork keeps
    // its parent's name. Neither may produce two tiles for one name.
    const reg: RegistryPayload = {
      builtins: [{ name: "sprite" }],
      catalog: [{ name: "sprite", state: "not-installed" }],
      local: [{ name: "sprite", path: "/Users/me/.pneuma/modes/sprite-fork" }],
    };
    const merged = mergeRegistryModes(reg);
    expect(merged.map((m) => m.source)).toEqual(["builtin"]);
    expect(needsDownload(merged[0]!)).toBe(false);
  });

  test("an empty registry is an empty list, not a crash", () => {
    expect(mergeRegistryModes({})).toEqual([]);
  });
});
