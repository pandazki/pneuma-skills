/**
 * What the file watcher follows in a sprite workspace — and how the stage
 * still refreshes the pictures it no longer hears about.
 *
 * A character's frames are the bulk of its workspace: the owner's ten-loop
 * character had 2,684 frame PNGs out of 2,882 files. The chokidar watcher
 * used before 3.54 registered one `fs.watch` per file, and on macOS that
 * registration grew superlinearly (Bun 1.4.0: 2,000 files 2.5 s, 3,000 files
 * 11 s, 4,000 files 69 s), all on the server's main thread — so opening that
 * workspace answered nothing, not even the page itself, for 25–40 s (measured
 * 2026-09-23). The per-root watcher in `server/watch/` removed that cost; the
 * scope below stays because frame bursts are event volume nobody reads.
 *
 * The frame directories never needed watching. `register-run` rewrites
 * `project.json` every time frames land, stamping each frame asset's
 * `createdAt`, and the frame URLs carry that stamp — the same arrangement
 * backlot uses with its render revision. So the per-frame directories
 * (`frames/`, the pre-align `cells/`, and the `.loop-work` / `.retime-work-*`
 * scratch sequences) are outside the watcher, and everything a viewer reacts
 * to stays inside it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIgnoreMatcher, startFileWatcher, type FileUpdate } from "../../../server/file-watcher.js";
import { loadRoster, type CharacterProject } from "../domain.js";
import spriteManifest from "../manifest.js";
import { resolveFrameSource } from "../viewer/playback.js";
import { sourceKey, stableSourceKey } from "../viewer/useFrameImages.js";

const viewer = spriteManifest.viewer;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

describe("sprite watcher scope", () => {
  const ws = "/ws";
  const ignored = buildIgnoreMatcher(ws, viewer, join(ws, ".pneuma"));

  test.each([
    "tanka/motions/idle/frames/000.png",
    "tanka/motions/idle/frames/align.json",
    "tanka/motions/walk/cells/07.png",
    "tanka/motions/idle/.loop-work/plate/0001.png",
    "tanka/motions/idle/.loop-work/interp/0412.png",
    "tanka/export/.retime-work-tanka-idle/0001.png",
    "motions/idle/frames/000.png", // a root-level character
  ])("per-frame %s is not watched", (rel) => {
    expect(ignored(join(ws, rel))).toBe(true);
  });

  test.each([
    "tanka/project.json",
    "tanka/refs/portrait.png",
    "tanka/motions/idle/keyframe.png",
    "tanka/motions/idle/contact.png",
    "tanka/motions/idle/loop.webp",
    "tanka/motions/idle/inspect.json",
    "tanka/motions/walk/sheet.png",
  ])("%s is still watched", (rel) => {
    expect(ignored(join(ws, rel))).toBe(false);
  });
});

describe("sprite watcher scope (real watcher)", () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0)) await fn();
  });

  test("a run's frames are silent; the registration and the motion's images are heard", async () => {
    const root = mkdtempSync(join(tmpdir(), "sprite-watch-scope-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const motion = join(root, "tanka", "motions", "idle");
    mkdirSync(join(motion, "frames"), { recursive: true });
    mkdirSync(join(motion, ".loop-work", "plate"), { recursive: true });

    const events: FileUpdate[] = [];
    const watcher = startFileWatcher(root, viewer, (files) => events.push(...files), {
      stateDir: join(root, ".pneuma"),
    });
    cleanup.push(() => watcher.close());
    await Bun.sleep(400);
    events.length = 0;

    for (let i = 0; i < 20; i++) {
      const n = String(i).padStart(3, "0");
      writeFileSync(join(motion, "frames", `${n}.png`), PNG);
      writeFileSync(join(motion, ".loop-work", "plate", `${n}.png`), PNG);
    }
    writeFileSync(join(motion, "keyframe.png"), PNG);
    writeFileSync(join(root, "tanka", "project.json"), `{"title":"tanka"}`);
    await Bun.sleep(1_200);

    const paths = [...new Set(events.map((e) => e.path))].sort();
    expect(paths).toEqual(["tanka/motions/idle/keyframe.png", "tanka/project.json"]);
  }, 15_000);
});

describe("frame urls carry their registration", () => {
  const MINI = readFileSync(join(import.meta.dir, "fixtures", "mini", "project.json"), "utf-8");
  const load = (edit?: (body: any) => void): CharacterProject => {
    const body = JSON.parse(MINI);
    edit?.(body);
    const roster = loadRoster([{ path: "mini/project.json", content: JSON.stringify(body) }]);
    return roster!.byContentSet.mini!;
  };
  const bounce = (p: CharacterProject) => p.sprite.motions.find((m) => m.id === "bounce")!;
  const rerun = (body: any) => {
    for (const asset of body.assets) {
      if (asset.uri.includes("/frames/")) asset.createdAt = 1757400009000;
    }
  };

  test("a frame url names the run that registered it", () => {
    const source = resolveFrameSource(load(), bounce(load()), 7);
    if (source.kind !== "frames") throw new Error(source.kind);
    expect(source.frames[0]).toBe("/content/mini/motions/bounce/frames/00.png?v=7&r=1757400002000");
  });

  test("a re-run at the same paths is new bytes to fetch, but the same pictures to hold", () => {
    const before = resolveFrameSource(load(), bounce(load()), 7);
    const again = load(rerun);
    const after = resolveFrameSource(again, bounce(again), 7);
    expect(sourceKey(after)).not.toBe(sourceKey(before));
    expect(stableSourceKey(after)).toBe(stableSourceKey(before));
  });

  test("a frame asset without a registration time keeps the plain url", () => {
    const p = load((body) => {
      for (const asset of body.assets) delete asset.createdAt;
    });
    const source = resolveFrameSource(p, bounce(p), 3);
    if (source.kind !== "frames") throw new Error(source.kind);
    expect(source.frames[0]).toBe("/content/mini/motions/bounce/frames/00.png?v=3");
  });
});
