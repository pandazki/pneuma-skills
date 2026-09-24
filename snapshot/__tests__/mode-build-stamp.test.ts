/**
 * A prebuilt viewer is reused only while it is the build of the sources beside
 * it.
 *
 * `pneuma` in production mode serves a non-builtin mode from
 * `<mode>/.build/pneuma-mode.js` when one exists — the published archive's
 * bundle, with its third-party dependencies inlined. But `buildModeViewer`
 * writes to that same directory when a mode is compiled from source, so in a
 * repository checkout a catalog mode was compiled on its first launch and
 * that bundle was served on every launch after it, whatever the sources had
 * become (2026-09-24: the sprite Export tab kept round 3's Rive preview and
 * copy after round 4's viewer landed). The build now records a stamp of the
 * sources it was made from, and a launch reuses it only when the stamp still
 * matches; a bundle with no stamp is trusted only outside the project tree,
 * where it can only have come from a published archive.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildModeViewer, modeSourceStamp, prebuiltViewer, writeModeSourceStamp } from "../mode-build.js";

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "mode-build-stamp-"));
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function fixture(name: string): string {
  const modeDir = join(root, name);
  mkdirSync(join(modeDir, "viewer"), { recursive: true });
  mkdirSync(join(modeDir, "seed", "demo"), { recursive: true });
  writeFileSync(
    join(modeDir, "manifest.ts"),
    `export default { name: "${name}", version: "1.0.0", displayName: { en: "${name}" }, description: { en: "fixture" } };\n`,
  );
  writeFileSync(
    join(modeDir, "pneuma-mode.ts"),
    `import manifest from "./manifest.js";\nimport Preview from "./viewer/Preview.js";\nexport default { manifest, viewer: { PreviewComponent: Preview } };\n`,
  );
  writeFileSync(join(modeDir, "viewer", "Preview.tsx"), `export default function Preview() { return <span>one</span>; }\n`);
  writeFileSync(join(modeDir, "seed", "demo", "project.json"), `{"v":1}\n`);
  return modeDir;
}

/** A `.build/` as a published archive ships it: a bundle, no stamp. */
function publishedBuild(modeDir: string) {
  mkdirSync(join(modeDir, ".build"), { recursive: true });
  writeFileSync(join(modeDir, ".build", "pneuma-mode.js"), "export default {};\n");
}

describe("the prebuilt viewer", () => {
  test("the stamp follows the viewer's sources, not its seeds", () => {
    const modeDir = fixture("stamp");
    const first = modeSourceStamp(modeDir);
    writeFileSync(join(modeDir, "seed", "demo", "project.json"), `{"v":2}\n`);
    expect(modeSourceStamp(modeDir)).toBe(first);
    writeFileSync(join(modeDir, "viewer", "Preview.tsx"), `export default function Preview() { return <span>two</span>; }\n`);
    expect(modeSourceStamp(modeDir)).not.toBe(first);
  });

  test("a build records the stamp of what it was built from", async () => {
    const modeDir = fixture("built");
    const result = await buildModeViewer(modeDir);
    expect(result.errors).toEqual([]);
    expect(prebuiltViewer(modeDir, { projectRoot: join(root, "elsewhere") })).toEqual({ reuse: true, reason: "current" });
  });

  test("a build whose sources changed since is rebuilt, inside the project or out", () => {
    const modeDir = fixture("stale");
    publishedBuild(modeDir);
    writeModeSourceStamp(modeDir);
    writeFileSync(join(modeDir, "viewer", "Preview.tsx"), `export default function Preview() { return <span>new</span>; }\n`);
    expect(prebuiltViewer(modeDir, { projectRoot: join(root, "elsewhere") })).toEqual({ reuse: false, reason: "stale" });
    expect(prebuiltViewer(modeDir, { projectRoot: root })).toEqual({ reuse: false, reason: "stale" });
  });

  test("an unstamped bundle is trusted only where it can only have been published", () => {
    const modeDir = fixture("unstamped");
    publishedBuild(modeDir);
    // An installed catalog or GitHub mode lives outside the checkout.
    expect(prebuiltViewer(modeDir, { projectRoot: join(root, "elsewhere") })).toEqual({ reuse: true, reason: "published" });
    // A mode inside the checkout was compiled here, before builds were stamped.
    expect(prebuiltViewer(modeDir, { projectRoot: root })).toEqual({ reuse: false, reason: "unstamped-in-tree" });
  });

  test("no bundle, nothing to reuse", () => {
    expect(prebuiltViewer(fixture("none"), { projectRoot: root })).toEqual({ reuse: false, reason: "missing" });
  });
});
