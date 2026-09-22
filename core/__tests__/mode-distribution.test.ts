/**
 * `modes/distribution.json` is the one authority for which modes ship inside
 * the package. Everything else — the builtin registry, the launcher's order,
 * `package.json`'s `files`, the desktop installer's filter, the pack script —
 * is derived from it or checked against it. These tests pin the invariants a
 * derivation is allowed to assume.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_FAVORITES } from "../favorites.js";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const MODES_DIR = join(PROJECT_ROOT, "modes");

const distribution = JSON.parse(
  readFileSync(join(MODES_DIR, "distribution.json"), "utf-8"),
) as { bundled: string[] };

/** Every directory under `modes/` that is a mode (has a manifest). */
function modeDirs(): string[] {
  return readdirSync(MODES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(MODES_DIR, e.name, "manifest.ts")))
    .map((e) => e.name)
    .sort();
}

function isHidden(name: string): boolean {
  return /\bhidden:\s*true\b/.test(readFileSync(join(MODES_DIR, name, "manifest.ts"), "utf-8"));
}

describe("modes/distribution.json", () => {
  it("lists real directories, sorted and unique", () => {
    const { bundled } = distribution;
    expect(bundled.length).toBeGreaterThan(0);
    expect([...new Set(bundled)]).toEqual(bundled);
    expect([...bundled].sort()).toEqual(bundled);
    for (const name of bundled) {
      expect(existsSync(join(MODES_DIR, name))).toBe(true);
    }
  });

  it("bundles the shared assets every mode's skill install depends on", () => {
    // `modes/_shared/scripts` is resolved from the package, not from the mode,
    // so it has to be in the package for a downloaded mode to install its skill.
    expect(distribution.bundled).toContain("_shared");
  });

  it("bundles every mode the framework launches by itself", () => {
    // Hidden modes are started by UI affordances or by Pneuma; there is no
    // moment at which a user could be asked to wait for a download.
    for (const name of modeDirs().filter(isHidden)) {
      expect(distribution.bundled).toContain(name);
    }
  });

  it("bundles every mode a first run offers in Quick Start", () => {
    // A default favorite that needed a download would put an install prompt in
    // front of a user who has not chosen anything yet.
    for (const key of DEFAULT_FAVORITES) {
      const [source, name] = key.split("::");
      expect(source).toBe("builtin");
      expect(distribution.bundled).toContain(name!);
    }
  });

  it("leaves the rest as catalog modes", () => {
    const catalog = modeDirs().filter((n) => !distribution.bundled.includes(n));
    // Guard against a future edit that bundles everything again and quietly
    // undoes the split.
    expect(catalog.length).toBeGreaterThan(0);
    for (const name of catalog) {
      expect(existsSync(join(MODES_DIR, name, "showcase"))).toBe(true);
    }
  });
});
