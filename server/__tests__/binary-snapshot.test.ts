/**
 * Binary files never travel to the browser as text.
 *
 * `GET /api/files` (the cold-start snapshot) and the watcher's
 * `content_update` flush both deliver every file a mode's `watchPatterns`
 * match. Both used to `readFileSync(path, "utf-8")` whatever matched, so a
 * pattern such as sprite's `**\/motions/**\/*` shipped every frame PNG, loop
 * WebP, WebM and MP4 as mangled UTF-8 inside one JSON body: a 2,818-file
 * sprite workspace produced a 1.89 GB snapshot (63 s to first byte, the
 * server at 6.7 GB RSS) that Chrome aborted mid-download, leaving the viewer
 * on its empty state for good (measured 2026-09-23).
 *
 * The rule pinned here: a binary match is still reported — its path is a real
 * signal (existence, change) — but with empty content, the same shape the
 * watcher has always used for image changes. Bytes are served by `/content/*`.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerExportRoutes } from "../routes/export.js";
import { startFileWatcher, type FileUpdate } from "../file-watcher.js";
import { readWorkspaceText } from "../workspace-text.js";

// Real container headers: every one of these carries a NUL early on.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x00, 0x00]);
const MP4 = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const WOFF2 = Buffer.concat([Buffer.from("wOF2"), Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00])]);
// An extension no list knows about: only the content sniff can classify it.
const UNKNOWN_BINARY = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`;
const PROJECT = JSON.stringify({ title: "tanka", motions: ["idle"] });

describe("readWorkspaceText", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pneuma-workspace-text-"));
    writeFileSync(join(dir, "a.png"), PNG);
    writeFileSync(join(dir, "a.lottie"), UNKNOWN_BINARY);
    writeFileSync(join(dir, "a.svg"), SVG);
    writeFileSync(join(dir, "a.json"), PROJECT);
    writeFileSync(join(dir, "empty.md"), "");
    writeFileSync(join(dir, "ルミ.md"), "# ルミ — 日本語\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("text is returned verbatim, including SVG and non-ASCII", () => {
    expect(readWorkspaceText(join(dir, "a.svg"))).toBe(SVG);
    expect(readWorkspaceText(join(dir, "a.json"))).toBe(PROJECT);
    expect(readWorkspaceText(join(dir, "ルミ.md"))).toBe("# ルミ — 日本語\n");
    expect(readWorkspaceText(join(dir, "empty.md"))).toBe("");
  });

  test("binary is null — by extension, and by content for an unknown extension", () => {
    expect(readWorkspaceText(join(dir, "a.png"))).toBeNull();
    expect(readWorkspaceText(join(dir, "a.lottie"))).toBeNull();
  });

  test("an unreadable path still throws, so callers keep their skip-on-error branch", () => {
    expect(() => readWorkspaceText(join(dir, "missing.json"))).toThrow();
  });
});

describe("GET /api/files — binary matches are path-only", () => {
  let workspace: string;
  let app: Hono;

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), "pneuma-binary-snapshot-"));
    const motion = join(workspace, "tanka", "motions", "idle");
    mkdirSync(join(motion, "frames"), { recursive: true });
    writeFileSync(join(workspace, "tanka", "project.json"), PROJECT);
    writeFileSync(join(motion, "run.json"), `{"ok":true}`);
    writeFileSync(join(motion, "icon.svg"), SVG);
    // A frame the size of a real one, so a regression is visible in bytes too.
    writeFileSync(join(motion, "frames", "000.png"), Buffer.concat([PNG, Buffer.alloc(400_000, 0xab)]));
    writeFileSync(join(motion, "loop.webm"), WEBM);
    writeFileSync(join(motion, "clip.mp4"), MP4);
    writeFileSync(join(motion, "loop.lottie"), UNKNOWN_BINARY);

    app = new Hono();
    registerExportRoutes(app, {
      workspace,
      // sprite's own patterns: a directory glob matches every file type.
      watchPatterns: ["**/project.json", "**/refs/**/*", "**/motions/**/*"],
    });
  });
  afterAll(() => rmSync(workspace, { recursive: true, force: true }));

  test("text keeps its content; binaries keep their path with empty content", async () => {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);
    const raw = await res.text();
    const { files } = JSON.parse(raw) as { files: { path: string; content: string }[] };
    const byPath = new Map(files.map((f) => [f.path, f.content]));

    expect(byPath.get("tanka/project.json")).toBe(PROJECT);
    expect(byPath.get("tanka/motions/idle/run.json")).toBe(`{"ok":true}`);
    expect(byPath.get("tanka/motions/idle/icon.svg")).toBe(SVG);

    for (const bin of ["frames/000.png", "loop.webm", "clip.mp4", "loop.lottie"]) {
      expect(byPath.get(`tanka/motions/idle/${bin}`)).toBe("");
    }
    // The 400 KB frame contributes a path, not its bytes.
    expect(raw.length).toBeLessThan(4_000);
  });

  test("every path appears once even when patterns overlap", async () => {
    const res = await app.request("/api/files");
    const { files } = (await res.json()) as { files: { path: string }[] };
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("file watcher — a watched binary extension is a path-only update", () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0)) await fn();
  });

  // webcraft and kami watch `**/*.woff2`: a font written by the agent used to
  // reach every browser as a UTF-8-mangled `content_update`.
  test("a .woff2 change carries its path and no bytes; text still carries content", async () => {
    const ws = mkdtempSync(join(tmpdir(), "pneuma-binary-watch-"));
    cleanup.push(() => rmSync(ws, { recursive: true, force: true }));
    const events: FileUpdate[] = [];
    const watcher = startFileWatcher(
      ws,
      { watchPatterns: ["**/*.html", "**/*.woff2"], ignorePatterns: [], serveDir: "." },
      (files) => events.push(...files),
      { stateDir: join(ws, ".pneuma") },
    );
    cleanup.push(() => watcher.close());
    await Bun.sleep(400);
    events.length = 0;

    writeFileSync(join(ws, "font.woff2"), WOFF2);
    writeFileSync(join(ws, "index.html"), "<h1>hi</h1>");
    await Bun.sleep(1_200);

    const font = events.find((e) => e.path === "font.woff2");
    const page = events.find((e) => e.path === "index.html");
    expect(font).toBeDefined();
    expect(font!.content).toBe("");
    expect(font!.deleted).toBeUndefined();
    expect(page?.content).toBe("<h1>hi</h1>");
  }, 15_000);
});
