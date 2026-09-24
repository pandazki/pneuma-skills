/**
 * Workspace read / write / delete routes of a real session server stay inside
 * the workspace (findings 18 and 19 of the 2026-09-23 final review).
 *
 * Every fixture lives in one disposable temp directory: `ws/` is the
 * workspace, `outside/` is what must never be read, written, or deleted.
 * Each attack reaches `outside/` through a symlink placed inside `ws/`, the
 * way an agent-created or checked-out link would. Each case asserts both the
 * HTTP refusal and the filesystem outcome — a 403 that still wrote the file
 * would not count.
 *
 * The positive cases pin what must keep working: deep new directories,
 * writes through an in-root directory link, seeds, content-set deletion
 * (including one that contains an outside link, which is unlinked, not
 * followed), and scaffold writes.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../index.js";
import type { ModeManifest } from "../../core/types/mode-manifest.js";

const PORT = 19000 + Math.floor(Math.random() * 800);
const SENTINEL = "OUTSIDE-ROUTE-SENTINEL";

let base: string;
let ws: string;
let outside: string;
let seedBase: string;
let modeDir: string;
let server: Awaited<ReturnType<typeof startServer>>;

const api = (path: string, init?: RequestInit) => fetch(`http://localhost:${PORT}${path}`, init);
const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const deep = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`);

beforeAll(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-ws-containment-")));
  ws = join(base, "ws");
  outside = join(base, "outside");
  seedBase = join(base, "seed-base");
  modeDir = join(base, "mode");
  mkdirSync(ws, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "sentinel.css"), `/* ${SENTINEL} */`);

  // Seed package: one directory seed.
  mkdirSync(join(seedBase, "seed", "demo", "assets"), { recursive: true });
  writeFileSync(join(seedBase, "seed", "demo", "index.html"), "<h1>seeded</h1>");
  writeFileSync(join(seedBase, "seed", "demo", "assets", "a.css"), "body{}");
  // Mode source with showcase / seed-gallery assets, one of them a link out.
  mkdirSync(join(modeDir, "showcase"), { recursive: true });
  mkdirSync(join(modeDir, "seed-gallery"), { recursive: true });
  writeFileSync(join(modeDir, "showcase", "hero.png"), "HERO");
  writeFileSync(join(modeDir, "seed-gallery", "thumb.png"), "THUMB");
  symlinkSync(join(outside, "sentinel.css"), join(modeDir, "showcase", "leak.png"));
  symlinkSync(join(outside, "sentinel.css"), join(modeDir, "seed-gallery", "leak.png"));

  // Compiled mode bundle, with a link out.
  mkdirSync(join(base, "bundle"), { recursive: true });
  writeFileSync(join(base, "bundle", "pneuma-mode.js"), "export default 1;");
  writeFileSync(join(base, "bundle", "pneuma-mode.css"), "body{}");
  // A WebAssembly asset the bundler emitted beside the code (the sprite
  // viewer's Rive runtime): the `\0asm` magic and version 1.
  writeFileSync(join(base, "bundle", "rive-abc123.wasm"), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  symlinkSync(join(outside, "sentinel.css"), join(base, "bundle", "leak.js"));

  // In-workspace links.
  symlinkSync(outside, join(ws, "external-dir"));
  mkdirSync(join(ws, "real"), { recursive: true });
  symlinkSync(join(ws, "real"), join(ws, "in-dir"));

  const manifest = {
    name: "containment-test",
    version: "0.0.0",
    displayName: "Containment",
    description: "test",
    skill: { sourceDir: "skill", installName: "x" },
    viewer: { watchPatterns: ["**/*.css", "**/*.html"], serveDir: "." },
    init: { seedFiles: { "seed/demo/": "demo/", "seed/demo/index.html": "linked-seed/index.html" } },
  } as unknown as ModeManifest;

  server = await startServer({
    port: PORT,
    workspace: ws,
    watchPatterns: ["**/*.css", "**/*.html"],
    modeManifest: manifest,
    modeSourceDir: modeDir,
    seedBase,
    stateDir: join(ws, ".pneuma"),
    modeBundleDir: join(base, "bundle"),
  });
});

afterAll(() => {
  (server as { server?: { stop?: (force?: boolean) => void } } | undefined)?.server?.stop?.(true);
  rmSync(base, { recursive: true, force: true });
});

describe("POST /api/files", () => {
  test("a deep new path under an outside symlink is refused and creates nothing outside", async () => {
    const suffix = deep(35, "d");
    const res = await post("/api/files", { path: ["external-dir", ...suffix, "deep.txt"].join("/"), content: SENTINEL });
    expect(res.status).toBe(403);
    expect(existsSync(join(outside, suffix[0]))).toBe(false);
  });

  test("a shallow path under an outside symlink is refused", async () => {
    const res = await post("/api/files", { path: "external-dir/written.txt", content: SENTINEL });
    expect(res.status).toBe(403);
    expect(existsSync(join(outside, "written.txt"))).toBe(false);
  });

  test("deep new directories inside the workspace are written", async () => {
    const suffix = deep(40, "n");
    const res = await post("/api/files", { path: [...suffix, "deep.txt"].join("/"), content: "deep" });
    expect(res.status).toBe(200);
    expect(readFileSync(join(ws, ...suffix, "deep.txt"), "utf-8")).toBe("deep");
  });

  test("a write through an in-root directory link lands in its target", async () => {
    const res = await post("/api/files", { path: "in-dir/via-link.txt", content: "linked" });
    expect(res.status).toBe(200);
    expect(readFileSync(join(ws, "real", "via-link.txt"), "utf-8")).toBe("linked");
  });
});

describe("POST /api/contentsets/delete", () => {
  test("a prefix under an outside symlink is refused and deletes nothing", async () => {
    mkdirSync(join(outside, "delete-me"), { recursive: true });
    writeFileSync(join(outside, "delete-me", "file.txt"), "keep");
    const res = await post("/api/contentsets/delete", { prefix: "external-dir/delete-me" });
    expect(res.status).toBe(403);
    expect(readFileSync(join(outside, "delete-me", "file.txt"), "utf-8")).toBe("keep");
  });

  test("a content set that is itself a link to outside is refused", async () => {
    mkdirSync(join(outside, "linked-set"), { recursive: true });
    writeFileSync(join(outside, "linked-set", "file.txt"), "keep");
    symlinkSync(join(outside, "linked-set"), join(ws, "linked-set"));
    const res = await post("/api/contentsets/delete", { prefix: "linked-set" });
    expect(res.status).toBe(403);
    expect(readFileSync(join(outside, "linked-set", "file.txt"), "utf-8")).toBe("keep");
  });

  test("a normal content set is deleted; an outside link inside it is unlinked, not followed", async () => {
    mkdirSync(join(ws, "deck", "slides"), { recursive: true });
    writeFileSync(join(ws, "deck", "slides", "a.html"), "a");
    mkdirSync(join(outside, "kept-dir"), { recursive: true });
    writeFileSync(join(outside, "kept-dir", "kept.txt"), "kept");
    symlinkSync(join(outside, "kept-dir"), join(ws, "deck", "link-out"));
    const res = await post("/api/contentsets/delete", { prefix: "deck" });
    expect(res.status).toBe(200);
    const { deleted } = (await res.json()) as { deleted: string[] };
    expect(deleted).toEqual(["deck/slides/a.html"]);
    expect(existsSync(join(ws, "deck"))).toBe(false);
    expect(readFileSync(join(outside, "kept-dir", "kept.txt"), "utf-8")).toBe("kept");
  });
});

describe("POST /api/seeds/apply", () => {
  test("a destination that is a link to outside is refused and writes nothing", async () => {
    mkdirSync(join(outside, "seed-target"), { recursive: true });
    symlinkSync(join(outside, "seed-target"), join(ws, "demo"));
    try {
      const res = await post("/api/seeds/apply", { sourceKey: "seed/demo/" });
      expect(res.status).toBe(403);
      expect(readdirSync(join(outside, "seed-target"))).toEqual([]);
    } finally {
      rmSync(join(ws, "demo"));
    }
  });

  test("a normal seed applies into the workspace", async () => {
    const res = await post("/api/seeds/apply", { sourceKey: "seed/demo/" });
    expect(res.status).toBe(200);
    expect(readFileSync(join(ws, "demo", "index.html"), "utf-8")).toBe("<h1>seeded</h1>");
    expect(existsSync(join(ws, "demo", "assets", "a.css"))).toBe(true);
  });
});

describe("POST /api/workspace/scaffold", () => {
  test("a content set that is a link to outside is refused before any clear or write", async () => {
    mkdirSync(join(outside, "scaffold-target"), { recursive: true });
    writeFileSync(join(outside, "scaffold-target", "keep.html"), "keep");
    symlinkSync(join(outside, "scaffold-target"), join(ws, "scaffold-link"));
    const res = await post("/api/workspace/scaffold", {
      contentSet: "scaffold-link",
      clear: ["**/*.html"],
      files: [{ path: "new.html", content: SENTINEL }],
    });
    expect(res.status).toBe(403);
    expect(readdirSync(join(outside, "scaffold-target"))).toEqual(["keep.html"]);
  });

  test("clear skips a matched link to outside and never deletes its target", async () => {
    mkdirSync(join(ws, "site"), { recursive: true });
    writeFileSync(join(ws, "site", "old.html"), "old");
    writeFileSync(join(outside, "target.html"), "keep");
    symlinkSync(join(outside, "target.html"), join(ws, "site", "link.html"));
    const res = await post("/api/workspace/scaffold", {
      contentSet: "site",
      clear: ["*.html"],
      files: [{ path: "new.html", content: "new" }],
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(ws, "site", "old.html"))).toBe(false);
    expect(readFileSync(join(ws, "site", "new.html"), "utf-8")).toBe("new");
    expect(readFileSync(join(outside, "target.html"), "utf-8")).toBe("keep");
  });
});

describe("mode-owned asset routes", () => {
  test("the compiled mode bundle is served; a link out of it is not", async () => {
    expect(await (await api("/mode-assets/pneuma-mode.js")).text()).toBe("export default 1;");
    const res = await api("/mode-assets/leak.js");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  test("a bundle's assets are served with their own content type", async () => {
    // `WebAssembly.instantiateStreaming` refuses anything but
    // application/wasm; served as JavaScript, the runtime falls back to a
    // slower path with a console error, or fails outright.
    const wasm = await api("/mode-assets/rive-abc123.wasm");
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    expect((await api("/mode-assets/pneuma-mode.js")).headers.get("content-type")).toBe("application/javascript");
    expect((await api("/mode-assets/pneuma-mode.css")).headers.get("content-type")).toBe("text/css");
  });

  test("showcase and seed-gallery assets are served; links to outside are not", async () => {
    expect(await (await api("/api/modes/containment-test/showcase/hero.png")).text()).toBe("HERO");
    expect(await (await api("/api/mode/seed-gallery/thumb.png")).text()).toBe("THUMB");
    for (const path of ["/api/modes/containment-test/showcase/leak.png", "/api/mode/seed-gallery/leak.png"]) {
      const res = await api(path);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.text()).not.toContain(SENTINEL);
    }
  });
});

describe("POST /api/replay/checkout/:hash", () => {
  const hasGit = Bun.which("git") !== null;
  test.skipIf(!hasGit)("a checkpoint symlink to outside is not read into the response", async () => {
    const repo = join(base, "replay-src");
    const pkg = join(base, "replay-pkg");
    mkdirSync(repo, { recursive: true });
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(repo, "notes.md"), "# inside");
    symlinkSync(join(outside, "sentinel.css"), join(repo, "leak.md"));
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "c1");
    const hash = new TextDecoder().decode(git("rev-parse", "HEAD").stdout).trim();
    git("bundle", "create", join(pkg, "repo.bundle"), "--all");
    writeFileSync(
      join(pkg, "manifest.json"),
      JSON.stringify({ metadata: { mode: "doc", totalTurns: 1 }, checkpoints: [{ hash, turn: 1 }], summary: {} }),
    );
    writeFileSync(join(pkg, "messages.jsonl"), "");

    expect((await post("/api/replay/load", { path: pkg })).status).toBe(200);
    const res = await post(`/api/replay/checkout/${hash}`, {});
    expect(res.status).toBe(200);
    const { files } = (await res.json()) as { files: { path: string; content: string }[] };
    expect(files.map((f) => f.path)).toEqual(["notes.md"]);
    expect(JSON.stringify(files)).not.toContain(SENTINEL);
  });
});

describe("GET /api/git/diff", () => {
  test("a path outside the workspace is refused, not diffed against /dev/null", async () => {
    for (const rel of ["../outside/sentinel.css", "external-dir/sentinel.css"]) {
      const res = await api(`/api/git/diff?path=${encodeURIComponent(rel)}`);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain(SENTINEL);
    }
  });

  test("the path is passed to git as an argument, never through a shell", async () => {
    const marker = join(base, "git-diff-injected");
    const res = await api(`/api/git/diff?path=${encodeURIComponent(`a"; touch "${marker}"; echo "`)}`);
    expect(res.status).toBeLessThan(500);
    expect(existsSync(marker)).toBe(false);
  });

  test("an untracked workspace file still diffs as new", async () => {
    Bun.spawnSync(["git", "init", "-q"], { cwd: ws });
    writeFileSync(join(ws, "untracked-note.md"), "fresh line\n");
    const res = await api(`/api/git/diff?path=${encodeURIComponent("untracked-note.md")}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { diff: string }).diff).toContain("+fresh line");
  });
});
