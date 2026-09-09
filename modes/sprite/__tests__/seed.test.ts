/**
 * The Lumi seed — the card the launcher offers, and the character behind it.
 *
 * Three failure modes this pins, all of which look fine in a diff:
 *
 *  - **`seedFiles` written backwards.** The key is the SOURCE (repo-relative
 *    for a builtin), the value the destination inside the workspace.
 *    `resolveSeedCatalog` silently drops any descriptor whose `sourceKey` is
 *    not a key of `seedFiles`, so an inverted pair produces an empty gallery
 *    with no error anywhere.
 *  - **A seed that references files it does not ship.** `project.json` is a
 *    craft project file: every asset carries a uri, and the viewer renders
 *    from those uris. One pruned-but-still-registered file is a broken image
 *    on the user's very first screen.
 *  - **A seed that outgrows the package.** npm publish is the last step of the
 *    release and it fails at ~250 MB with the tag already pushed; the design
 *    budget for this seed is 8 MB.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { resolveSeedCatalog } from "../../../server/seed-installer.js";
import spriteManifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SEED_DIR = join(REPO_ROOT, "modes/sprite/seed/lumi");

const init = spriteManifest.init!;

/** Total bytes under a directory, following the tree. */
function treeBytes(dir: string): number {
  const glob = new Bun.Glob("**/*");
  let total = 0;
  for (const rel of glob.scanSync({ cwd: dir, absolute: false })) {
    const stat = statSync(join(dir, rel));
    if (stat.isFile()) total += stat.size;
  }
  return total;
}

describe("the gallery card", () => {
  test("resolveSeedCatalog lists the seed — the sourceKey matches a seedFiles key", () => {
    const catalog = resolveSeedCatalog(init.seedFiles, init.seeds);
    expect(catalog.map((s) => s.id)).toEqual(["lumi"]);
    expect(catalog[0].thumbnail).toBe("lumi.png");
  });

  test("the declared source path is directory-shaped and on disk", () => {
    // Directory-shaped (trailing slash on both sides) is what makes the entry
    // a user-pickable content set rather than framework setup.
    for (const [src, dst] of Object.entries(init.seedFiles!)) {
      expect(src.endsWith("/")).toBe(true);
      expect(dst.endsWith("/")).toBe(true);
      expect({ src, exists: existsSync(join(REPO_ROOT, src)) }).toEqual({
        src,
        exists: true,
      });
    }
  });

  test("it copies to one top-level character directory in the workspace", () => {
    // The mode's content sets ARE character directories; a seed that landed
    // at the workspace root would put project.json where no content set owns
    // it and `createDirectoryContentSetResolver` would find nothing.
    expect(init.seedFiles).toEqual({ "modes/sprite/seed/lumi/": "lumi/" });
  });

  test("the thumbnail the card points at exists", () => {
    const thumb = resolveSeedCatalog(init.seedFiles, init.seeds)[0].thumbnail!;
    expect(existsSync(join(REPO_ROOT, "modes/sprite/seed-gallery", thumb))).toBe(true);
  });

  test("the card is localized in all three launcher languages", () => {
    // `LocalizedString` also admits a bare string — a card that took that
    // shape would show English to every launcher locale.
    const seed = init.seeds![0];
    const displayName = seed.displayName as Record<string, string>;
    const description = seed.description as Record<string, string>;
    expect(Object.keys(displayName).sort()).toEqual(["en", "ja", "zh-CN"]);
    expect(Object.keys(description).sort()).toEqual(["en", "ja", "zh-CN"]);
    expect(description.en.length).toBeGreaterThan(60);
  });
});

describe("the seed character on disk", () => {
  const project = JSON.parse(readFileSync(join(SEED_DIR, "project.json"), "utf-8"));

  test("it is a craft project file with the sprite sidecar", () => {
    expect(project.$schema).toBe("pneuma-craft/project/v1");
    expect(project.sprite.version).toBe(1);
    expect(project.sprite.character.name).toBe("Lumi");
    expect(project.composition.tracks).toEqual([]);
  });

  test("every registered asset's file is actually shipped", () => {
    const missing = project.assets
      .map((a: { uri: string }) => a.uri)
      .filter((uri: string) => !existsSync(join(SEED_DIR, uri)));
    expect(missing).toEqual([]);
  });

  test("both motions are ready, 16 frames each, with an atlas and previews", () => {
    const motions = project.sprite.motions as Array<Record<string, unknown>>;
    expect(motions.map((m) => m.id)).toEqual(["idle", "attack"]);
    for (const motion of motions) {
      expect({ id: motion.id, status: motion.status }).toEqual({
        id: motion.id,
        status: "ready",
      });
      expect((motion.frames as string[]).length).toBe(16);
      for (const key of ["sheet", "atlas", "gif", "webp"]) {
        expect({ id: motion.id, key, set: Boolean(motion[key]) }).toEqual({
          id: motion.id,
          key,
          set: true,
        });
      }
      // The report the viewer surfaces as warnings — a seed that ships
      // warnings teaches the user that drift is normal.
      const inspect = motion.inspect as { frameCount: number; warnings: string[] };
      expect(inspect.frameCount).toBe(16);
      expect(inspect.warnings).toEqual([]);
    }
  });

  test("attack carries the one rendered clip, marked ready", () => {
    const attack = project.sprite.motions.find(
      (m: { id: string }) => m.id === "attack",
    );
    expect(attack.videos).toHaveLength(1);
    expect(attack.videos[0]).toMatchObject({
      model: "seedance-2.5",
      mode: "first-last",
      status: "ready",
    });
  });

  test("both references are registered and shipped", () => {
    expect(project.sprite.refs.map((r: { id: string }) => r.id).sort()).toEqual([
      "portrait",
      "turnaround",
    ]);
  });

  test("no pipeline intermediates ride along", () => {
    // `cells/` and `run.json` are what `run` leaves behind for a re-align;
    // they are not assets, they double the seed, and the pipeline recreates
    // them the first time the user regenerates anything.
    const glob = new Bun.Glob("**/*");
    const strays = [...glob.scanSync({ cwd: SEED_DIR, absolute: false })].filter(
      (rel) =>
        rel.includes("/cells/") ||
        rel.endsWith("run.json") ||
        rel.endsWith("first.png") ||
        rel.endsWith("last.png"),
    );
    expect(strays).toEqual([]);
  });

  test("the whole seed stays inside its 8 MB budget", () => {
    const megabytes = treeBytes(join(REPO_ROOT, "modes/sprite/seed")) / 1_000_000;
    expect(megabytes).toBeLessThan(8);
  });
});
