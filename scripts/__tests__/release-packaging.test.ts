/**
 * `package.json`'s `files` and `desktop/electron-builder.yml`'s modes filter
 * decide which modes ship inside a release. Neither file can read
 * `modes/distribution.json`, so both restate it — and a restatement that
 * drifts is silent: a new mode either bloats the package or disappears from
 * the launcher, and nobody finds out until a `413` or a missing card.
 *
 * These tests derive the two lists from the one authority and fail on any
 * disagreement.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { catalogModeNames, PROJECT_ROOT, readDistribution } from "../publish-modes.js";

const MODES_DIR = join(PROJECT_ROOT, "modes");
const { bundled } = readDistribution(MODES_DIR);
const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8")) as {
  files: string[];
  scripts: Record<string, string>;
};

/**
 * The patterns a `modes/` whitelist must hold, in order.
 *
 * `modes/*​/showcase/**` needs the trailing `**`, and a plain
 * `modes/*​/showcase/` is a silent no-op: npm-packlist `lstat`s every `files`
 * entry and only expands a *real directory* into `!dir` + `!dir/**`. An entry
 * holding a glob throws instead and is used verbatim, so it re-includes the
 * matched directories and none of their contents — measured on 3.51.0, where
 * that form shipped 3 showcase files instead of 127.
 */
const expectedNpmPatterns = [
  "modes/distribution.json",
  "modes/catalog.json",
  ...bundled.map((name) => `modes/${name}/`),
  "modes/*/showcase/**",
  "!modes/*/harness/",
];

const expectedDesktopPatterns = [
  "distribution.json",
  "catalog.json",
  ...bundled.map((name) => `${name}/**/*`),
  "*/showcase/**/*",
  "!**/harness/**",
  "!**/__tests__/**",
];

describe("package.json files", () => {
  const modePatterns = pkg.files.filter((entry) => entry.replace(/^!/, "").startsWith("modes/"));

  it("ships the bundled set, the two catalog files and every showcase — nothing else from modes/", () => {
    expect(modePatterns).toEqual(expectedNpmPatterns);
  });

  it("never falls back to shipping all of modes/", () => {
    // `"modes/"` would pull every catalog mode's source back in and put the
    // package back over the registry's ceiling (the 3.29.0 / 3.45.0 413s).
    expect(pkg.files).not.toContain("modes/");
  });

  it("keeps the generated catalog in the package even though it is gitignored", () => {
    const gitignore = readFileSync(join(PROJECT_ROOT, ".gitignore"), "utf-8");
    expect(gitignore).toContain("modes/catalog.json");
    expect(pkg.files).toContain("modes/catalog.json");
  });

  it("exposes the release scripts the bump procedure calls", () => {
    expect(pkg.scripts["publish:modes"]).toBe("bun scripts/publish-modes.ts");
    expect(pkg.scripts["verify:modes"]).toBe("bun scripts/verify-mode-catalog.ts");
  });

  it("runs the release-script tests in the routine suite", () => {
    expect(pkg.scripts.test).toContain("scripts/__tests__");
  });
});

describe("desktop/electron-builder.yml", () => {
  const config = Bun.YAML.parse(
    readFileSync(join(PROJECT_ROOT, "desktop", "electron-builder.yml"), "utf-8"),
  ) as { extraResources: Array<{ from: string; to: string; filter?: string[] }> };
  const modesResource = config.extraResources.find((r) => r.from === "../modes");

  it("copies modes/ with the same whitelist npm uses", () => {
    expect(modesResource).toBeDefined();
    expect(modesResource!.to).toBe("pneuma/modes");
    expect(modesResource!.filter).toEqual(expectedDesktopPatterns);
  });
});

describe("the two lists describe the same split", () => {
  it("excludes every catalog mode's source from both packages", () => {
    const catalog = catalogModeNames(MODES_DIR);
    expect(catalog.length).toBeGreaterThan(0);
    for (const name of catalog) {
      expect(expectedNpmPatterns).not.toContain(`modes/${name}/`);
      expect(expectedDesktopPatterns).not.toContain(`${name}/**/*`);
    }
  });

  it("keeps a showcase path for every mode, bundled or not", () => {
    // The launcher card for a catalog mode is drawn from showcase/ images
    // that never left the package.
    expect(expectedNpmPatterns).toContain("modes/*/showcase/**");
    expect(expectedDesktopPatterns).toContain("*/showcase/**/*");
  });
});
