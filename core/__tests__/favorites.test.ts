/**
 * Favorites survive a change in how a mode is distributed.
 *
 * `builtin` and `catalog` are not properties of a mode — they say where THIS
 * release ships it (`modes/distribution.json`). A favorites file written
 * before the split holds `builtin::sprite` for a mode the launcher now
 * composes as `catalog::sprite`, so without re-bucketing an upgrade silently
 * un-stars every mode that left the package.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_FAVORITES, rebucketFirstPartyKeys } from "../favorites.js";
import { bundledModeNames, isCatalogMode } from "../mode-catalog.js";

let projectRoot: string;
let env: { projectRoot: string };

/** A package root with `slide` bundled and `sprite` left to the catalog. */
beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "pneuma-favorites-pkg-"));
  env = { projectRoot };
  mkdirSync(join(projectRoot, "modes"), { recursive: true });
  writeFileSync(
    join(projectRoot, "modes", "distribution.json"),
    JSON.stringify({ bundled: ["_shared", "slide"] }, null, 2),
  );
  for (const name of ["slide", "sprite"]) {
    mkdirSync(join(projectRoot, "modes", name), { recursive: true });
    writeFileSync(join(projectRoot, "modes", name, "manifest.ts"), "export default {};");
  }
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("rebucketFirstPartyKeys", () => {
  test("the fixture is the shape the migration is about", () => {
    // Not a tautology: every assertion below depends on `sprite` being a
    // catalog mode here and `slide` not being one.
    expect(bundledModeNames(env)).toEqual(["_shared", "slide"]);
    expect(isCatalogMode("sprite", env)).toBe(true);
    expect(isCatalogMode("slide", env)).toBe(false);
  });

  test("a star on a mode that left the package moves to the catalog bucket", () => {
    expect(rebucketFirstPartyKeys(["builtin::sprite"], env)).toEqual(["catalog::sprite"]);
  });

  test("a star on a mode that moved back into the package returns to builtin", () => {
    expect(rebucketFirstPartyKeys(["catalog::slide"], env)).toEqual(["builtin::slide"]);
  });

  test("a bundled mode's star is left alone", () => {
    expect(rebucketFirstPartyKeys(["builtin::slide"], env)).toEqual(["builtin::slide"]);
  });

  test("a name this release has never heard of is left alone", () => {
    // A mode the user deleted, or one from a newer release. Renaming its
    // bucket would be a guess; the launcher already filters unknown keys.
    expect(rebucketFirstPartyKeys(["builtin::ghost"], env)).toEqual(["builtin::ghost"]);
  });

  test("local and published keys are never touched", () => {
    // Their specifier is a path or a URL — `sprite` appearing inside one is
    // not a first-party mode name.
    const keys = [
      "local::/Users/me/.pneuma/modes/sprite-evolved-abc123",
      "published::https://example.com/sprite-2.tar.gz",
    ];
    expect(rebucketFirstPartyKeys(keys, env)).toEqual(keys);
  });

  test("order is preserved, because it is the launcher's display order", () => {
    expect(
      rebucketFirstPartyKeys(["builtin::sprite", "builtin::slide", "local::/x"], env),
    ).toEqual(["catalog::sprite", "builtin::slide", "local::/x"]);
  });

  test("the shipped defaults are all bundled, so nothing re-buckets them", () => {
    // Pinned against the real package root rather than the fixture: this is
    // the claim `core/__tests__/mode-distribution.test.ts` makes from the
    // other side, that a first run never offers a mode that needs a download.
    expect(rebucketFirstPartyKeys([...DEFAULT_FAVORITES])).toEqual([...DEFAULT_FAVORITES]);
  });
});
