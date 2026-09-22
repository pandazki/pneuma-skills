/**
 * Favorites survive a change in how a mode is distributed.
 *
 * `builtin` and `catalog` are not properties of a mode — they say how an
 * installation reaches it. A favorites file written before the split holds
 * `builtin::sprite` for a mode the launcher now composes as
 * `catalog::sprite`, so without re-bucketing an upgrade silently un-stars
 * every mode that left the package.
 *
 * The rule has to be the one `/api/registry` uses, and the two shapes below
 * are why. `modes/distribution.json` alone says "sprite is not bundled" in
 * BOTH of them — but in a repo checkout sprite's source is in the tree and
 * the registry reports it among the builtins, so re-bucketing it to
 * `catalog::` would make the star disappear in development. Only the
 * released package, where sprite has no source to run from, moves it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_FAVORITES, rebucketFirstPartyKeys } from "../favorites.js";
import { getCatalogEntry, inTreeModeDir, isCatalogMode } from "../mode-catalog.js";
import { MODE_CATALOG_FORMAT, type ModeCatalog } from "../types/mode-catalog.js";

let root: string;

/** A package root that declares `slide` bundled and leaves `sprite` out. */
function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "pneuma-favorites-pkg-"));
  mkdirSync(join(dir, "modes"), { recursive: true });
  writeFileSync(
    join(dir, "modes", "distribution.json"),
    JSON.stringify({ bundled: ["_shared", "slide"] }, null, 2),
  );
  return dir;
}

function writeModeSource(dir: string, name: string): void {
  mkdirSync(join(dir, "modes", name), { recursive: true });
  writeFileSync(join(dir, "modes", name, "manifest.ts"), "export default {};");
}

/** What the pack step leaves behind for a catalog mode: images, no source. */
function writeCatalogOnly(dir: string, name: string): void {
  mkdirSync(join(dir, "modes", name, "showcase"), { recursive: true });
  writeFileSync(join(dir, "modes", name, "showcase", "showcase.json"), "{}");
  const catalog: ModeCatalog = {
    formatVersion: MODE_CATALOG_FORMAT,
    coreVersion: "9.9.9",
    generatedAt: "2026-09-22T00:00:00.000Z",
    modes: [
      {
        name,
        version: "1.0.0",
        displayName: { en: name },
        archive: { url: `https://example.invalid/${name}.tar.gz`, size: 1, sha256: "0".repeat(64) },
        unpackedSize: 4096,
      },
    ],
  };
  writeFileSync(join(dir, "modes", "catalog.json"), JSON.stringify(catalog, null, 2));
}

beforeEach(() => {
  root = makeRoot();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("rebucketFirstPartyKeys — released package", () => {
  let env: { projectRoot: string };

  beforeEach(() => {
    writeModeSource(root, "slide");
    writeCatalogOnly(root, "sprite");
    env = { projectRoot: root };
  });

  test("the fixture is the shape the migration is about", () => {
    // Not a tautology: every assertion below depends on `sprite` having a
    // catalog entry and no source, and `slide` having source.
    expect(inTreeModeDir("slide", env)).not.toBeNull();
    expect(inTreeModeDir("sprite", env)).toBeNull();
    expect(getCatalogEntry("sprite", env)?.version).toBe("1.0.0");
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

  test("installing a catalog mode does not move its key", () => {
    // The registry keeps an installed catalog mode in the `catalog` bucket,
    // so the star has to stay there too — otherwise a download un-pins it.
    expect(rebucketFirstPartyKeys(["catalog::sprite"], env)).toEqual(["catalog::sprite"]);
  });

  test("a name this release has never heard of is left alone", () => {
    // A mode the user deleted, or one from a newer release. Renaming its
    // bucket would be a guess; the launcher already filters unknown keys.
    expect(rebucketFirstPartyKeys(["builtin::ghost"], env)).toEqual(["builtin::ghost"]);
    expect(rebucketFirstPartyKeys(["catalog::ghost"], env)).toEqual(["catalog::ghost"]);
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
});

describe("rebucketFirstPartyKeys — repo checkout", () => {
  let env: { projectRoot: string };

  beforeEach(() => {
    // Every mode's source is in the tree and no catalog is generated, so
    // `/api/registry` reports them all in `builtins` and nothing downloads.
    writeModeSource(root, "slide");
    writeModeSource(root, "sprite");
    env = { projectRoot: root };
  });

  test("the fixture is the trap: not bundled, yet reported as a builtin", () => {
    // `isCatalogMode` is true here — sprite is not in `distribution.json`.
    // Keying off that alone is what broke development stars: the mode still
    // runs from `modes/sprite/`, so the registry calls it a builtin.
    expect(isCatalogMode("sprite", env)).toBe(true);
    expect(inTreeModeDir("sprite", env)).not.toBeNull();
    expect(getCatalogEntry("sprite", env)).toBeUndefined();
  });

  test("a star on an in-tree non-bundled mode stays in the builtin bucket", () => {
    expect(rebucketFirstPartyKeys(["builtin::sprite"], env)).toEqual(["builtin::sprite"]);
  });

  test("a star written by a release comes back to builtin in a checkout", () => {
    // The user starred sprite on the packaged build (`catalog::sprite`) and
    // now runs from source; the launcher composes `builtin::sprite`.
    expect(rebucketFirstPartyKeys(["catalog::sprite"], env)).toEqual(["builtin::sprite"]);
  });

  test("a bundled mode is a builtin here as well", () => {
    expect(rebucketFirstPartyKeys(["builtin::slide"], env)).toEqual(["builtin::slide"]);
    expect(rebucketFirstPartyKeys(["catalog::slide"], env)).toEqual(["builtin::slide"]);
  });
});

describe("rebucketFirstPartyKeys — this checkout", () => {
  test("the shipped defaults are all builtins, so nothing re-buckets them", () => {
    // Pinned against the real package root rather than a fixture: this is
    // the claim `core/__tests__/mode-distribution.test.ts` makes from the
    // other side, that a first run never offers a mode that needs a download.
    expect(rebucketFirstPartyKeys([...DEFAULT_FAVORITES])).toEqual([...DEFAULT_FAVORITES]);
  });

  test("a non-bundled mode in this tree keeps its builtin star", () => {
    // The regression, pinned where it actually bit: in this repository every
    // mode directory is present, so a developer's star must not move.
    expect(rebucketFirstPartyKeys(["builtin::eli5"])).toEqual(["builtin::eli5"]);
  });
});
