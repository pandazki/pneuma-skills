import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerSetupListing } from "../setup-listing.js";

let tmpRoot: string;
let app: Hono;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "setup-listing-test-"));
  app = new Hono();
  registerSetupListing(app, { workspace: tmpRoot });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/setup/listing", () => {
  test("returns empty shape for an empty workspace", async () => {
    const res = await app.request("/api/setup/listing");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ bible: null, cast: [], world: [], storyboards: [] });
  });

  test("detects bible.md", async () => {
    mkdirSync(join(tmpRoot, "setup"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "bible.md"), "# title\n");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.bible).toBeTruthy();
    expect(json.bible.path).toBe("setup/bible.md");
    expect(typeof json.bible.mtime).toBe("number");
  });

  test("detects flat character card with image", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.md"), "# Kira");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.png"), "fake-png");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast).toHaveLength(1);
    expect(json.cast[0]).toMatchObject({
      name: "kira",
      mdPath: "setup/cast/kira.md",
      imagePath: "setup/cast/kira.png",
    });
  });

  test("detects nested character card", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast", "anya"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "anya", "card.md"), "# Anya");
    writeFileSync(join(tmpRoot, "setup", "cast", "anya", "ref.png"), "fake");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast).toHaveLength(1);
    expect(json.cast[0]).toMatchObject({
      name: "anya",
      mdPath: "setup/cast/anya/card.md",
      imagePath: "setup/cast/anya/ref.png",
    });
  });

  test("character card without image is still surfaced (imagePath: null)", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.md"), "# K");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast[0]).toMatchObject({
      name: "kira",
      mdPath: "setup/cast/kira.md",
      imagePath: null,
    });
  });

  test("png > webp > jpg image preference for cards", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.md"), "# K");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.jpg"), "j");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.webp"), "w");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.png"), "p");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast[0].imagePath).toBe("setup/cast/kira.png");
  });

  test("ignores prompt.md siblings", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.md"), "# K");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.prompt.md"), "...");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast).toHaveLength(1); // not 2
    expect(json.cast[0].name).toBe("kira");
  });

  test("detects setting cards in setup/world/", async () => {
    mkdirSync(join(tmpRoot, "setup", "world"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "world", "desk.md"), "# D");
    writeFileSync(join(tmpRoot, "setup", "world", "desk.png"), "p");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.world).toHaveLength(1);
    expect(json.world[0].name).toBe("desk");
  });

  test("detects storyboards with stdout.json", async () => {
    const sbDir = join(tmpRoot, "storyboard", "the-bug");
    mkdirSync(sbDir, { recursive: true });
    writeFileSync(join(sbDir, "composite.png"), "c");
    writeFileSync(join(sbDir, "panel-01.png"), "p1");
    writeFileSync(join(sbDir, "panel-02.png"), "p2");
    writeFileSync(
      join(sbDir, "stdout.json"),
      JSON.stringify({
        grid: { rows: 1, cols: 2 },
        panels: [
          { index: 1, row: 0, col: 0, bbox: { x: 0, y: 0, w: 100, h: 100 }, path: "/abs/panel-01.png", assetId: "asset-p1" },
          { index: 2, row: 0, col: 1, bbox: { x: 100, y: 0, w: 100, h: 100 }, path: "/abs/panel-02.png", assetId: "asset-p2" },
        ],
      }),
    );
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.storyboards).toHaveLength(1);
    expect(json.storyboards[0]).toMatchObject({
      id: "the-bug",
      compositePath: "storyboard/the-bug/composite.png",
      grid: { rows: 1, cols: 2 },
      hasStdoutJson: true,
    });
    expect(json.storyboards[0].panels).toHaveLength(2);
    expect(json.storyboards[0].panels[0]).toMatchObject({
      index: 1,
      row: 0,
      col: 0,
      bbox: { x: 0, y: 0, w: 100, h: 100 },
    });
  });

  test("detects storyboard fallback (no stdout.json) by lex order of panel files", async () => {
    const sbDir = join(tmpRoot, "storyboard", "fallback");
    mkdirSync(sbDir, { recursive: true });
    writeFileSync(join(sbDir, "composite.png"), "c");
    writeFileSync(join(sbDir, "frame-01.png"), "1");
    writeFileSync(join(sbDir, "frame-02.png"), "2");
    writeFileSync(join(sbDir, "frame-03.png"), "3");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.storyboards).toHaveLength(1);
    expect(json.storyboards[0]).toMatchObject({
      id: "fallback",
      hasStdoutJson: false,
      grid: null,
    });
    expect(json.storyboards[0].panels).toHaveLength(3);
    expect(json.storyboards[0].panels.map((p: any) => p.index)).toEqual([1, 2, 3]);
  });

  test("ignores storyboards with no composite.png", async () => {
    const sbDir = join(tmpRoot, "storyboard", "no-composite");
    mkdirSync(sbDir, { recursive: true });
    writeFileSync(join(sbDir, "panel-01.png"), "1");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.storyboards).toHaveLength(0);
  });
});
