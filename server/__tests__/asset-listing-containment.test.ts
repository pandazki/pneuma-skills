/**
 * `/api/assets/fs-listing`, `/api/assets/trash` and `/api/setup/listing`
 * stay inside the workspace (security table of the 2026-09-23 final review).
 *
 * The listing walkers already skipped symlinked entries, but their fixed
 * scan roots (`assets/`, `setup/`, `storyboard/`) were not checked, and trash
 * filtered by string prefix only — `assets/<link-to-outside>/x.png` moved an
 * outside file to the OS trash. Trash is never invoked here on anything
 * outside: every refused case asserts the outside file is still present.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerAssetFsRoutes } from "../routes/asset-fs.js";
import { registerSetupListing } from "../routes/setup-listing.js";

let base: string;
let ws: string;
let outside: string;
let app: Hono;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-asset-containment-")));
  ws = join(base, "ws");
  outside = join(base, "outside");
  mkdirSync(ws, { recursive: true });
  mkdirSync(join(outside, "media"), { recursive: true });
  writeFileSync(join(outside, "media", "secret.png"), "secret");
  app = new Hono();
  registerAssetFsRoutes(app, { workspace: ws });
  registerSetupListing(app, { workspace: ws });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const trashReq = (uris: string[]) =>
  app.request("/api/assets/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uris }) });

describe("/api/assets/*", () => {
  it("does not list an assets root that is a link to outside", async () => {
    symlinkSync(join(outside, "media"), join(ws, "assets"));
    const res = await app.request("/api/assets/fs-listing");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { entries: unknown[] }).entries).toEqual([]);
  });

  it("refuses to trash a file reached through a link to outside", async () => {
    mkdirSync(join(ws, "assets"), { recursive: true });
    symlinkSync(join(outside, "media"), join(ws, "assets", "ext"));
    const res = await trashReq(["assets/ext/secret.png"]);
    const out = (await res.json()) as { trashed: string[]; failed: { uri: string; error: string }[] };
    expect(out.trashed).toEqual([]);
    expect(out.failed.map((f) => f.uri)).toEqual(["assets/ext/secret.png"]);
    expect(existsSync(join(outside, "media", "secret.png"))).toBe(true);
  });

  it("refuses to trash anything when the assets root itself links outside", async () => {
    symlinkSync(join(outside, "media"), join(ws, "assets"));
    const res = await trashReq(["assets/secret.png"]);
    const out = (await res.json()) as { trashed: string[]; failed: { uri: string }[] };
    expect(out.trashed).toEqual([]);
    expect(existsSync(join(outside, "media", "secret.png"))).toBe(true);
  });

  it("lists in-workspace media", async () => {
    mkdirSync(join(ws, "assets", "img"), { recursive: true });
    writeFileSync(join(ws, "assets", "img", "a.png"), "a");
    const res = await app.request("/api/assets/fs-listing");
    const { entries } = (await res.json()) as { entries: { uri: string }[] };
    expect(entries.map((e) => e.uri)).toEqual(["assets/img/a.png"]);
  });
});

describe("/api/setup/listing", () => {
  it("ignores setup/ and storyboard/ roots that link outside", async () => {
    mkdirSync(join(outside, "setup", "cast"), { recursive: true });
    writeFileSync(join(outside, "setup", "bible.md"), "# bible");
    writeFileSync(join(outside, "setup", "cast", "kira.md"), "# kira");
    mkdirSync(join(outside, "storyboard", "sb1"), { recursive: true });
    writeFileSync(join(outside, "storyboard", "sb1", "composite.png"), "c");
    writeFileSync(join(outside, "storyboard", "sb1", "sb1-01.png"), "p");
    symlinkSync(join(outside, "setup"), join(ws, "setup"));
    symlinkSync(join(outside, "storyboard"), join(ws, "storyboard"));
    const res = await app.request("/api/setup/listing");
    expect(await res.json()).toEqual({ bible: null, cast: [], world: [], storyboards: [] });
  });

  it("lists in-workspace production-bible artifacts", async () => {
    mkdirSync(join(ws, "setup", "cast"), { recursive: true });
    writeFileSync(join(ws, "setup", "bible.md"), "# bible");
    writeFileSync(join(ws, "setup", "cast", "kira.md"), "# kira");
    const res = (await (await app.request("/api/setup/listing")).json()) as {
      bible: { path: string } | null;
      cast: { name: string }[];
    };
    expect(res.bible?.path).toBe("setup/bible.md");
    expect(res.cast.map((c) => c.name)).toEqual(["kira"]);
  });
});
