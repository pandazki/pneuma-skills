// server/__tests__/play-export.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../shadow-git.js";
import { materializePlayPackage } from "../play-export.js";
import type { CheckpointManifest, PlayPackageIndex } from "../../core/types/play-package.js";

describe("materializePlayPackage", () => {
  let workspace: string;
  let outDir: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "play-export-test-"));
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
    outDir = mkdtempSync(join(tmpdir(), "play-out-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  test("materializes content-addressed blobs + per-checkpoint manifests", async () => {
    await initShadowGit(workspace);

    // Checkpoint 1: an HTML file + a binary asset.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    writeFileSync(join(workspace, "index.html"), "<h1>v1</h1>");
    mkdirSync(join(workspace, "assets"), { recursive: true });
    writeFileSync(join(workspace, "assets", "logo.png"), pngBytes);
    await enqueueCheckpoint(workspace, 1);

    // Checkpoint 2: change only the HTML — the PNG blob must dedup across checkpoints.
    writeFileSync(join(workspace, "index.html"), "<h1>v2</h1>");
    await enqueueCheckpoint(workspace, 2);

    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "s1", mode: "webcraft", backendType: "claude-code", createdAt: 900,
    }));
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify([
      { type: "user_message", content: "make it", timestamp: 1000, id: "u1" },
      { type: "result", data: { num_turns: 1 } },
      { type: "user_message", content: "tweak", timestamp: 2000, id: "u2" },
      { type: "result", data: { num_turns: 1 } },
    ]));

    const res = await materializePlayPackage(workspace, { output: outDir, importUrl: "https://r2/histories/x.tar.gz" });

    // play.json
    const index = JSON.parse(readFileSync(join(outDir, "play.json"), "utf-8")) as PlayPackageIndex;
    expect(index.playFormat).toBe(1);
    expect(index.mode).toBe("webcraft");
    expect(index.supported).toBe(true); // webcraft is web-playable
    expect(index.importUrl).toBe("https://r2/histories/x.tar.gz");
    expect(index.manifest.checkpoints.length).toBe(2);

    expect(existsSync(join(outDir, "messages.jsonl"))).toBe(true);

    // Per-checkpoint manifests reference the right files.
    const cps = index.manifest.checkpoints;
    const cpManifests = cps.map((cp) =>
      JSON.parse(readFileSync(join(outDir, "checkpoints", `${cp.hash}.json`), "utf-8")) as CheckpointManifest,
    );
    for (const m of cpManifests) {
      const paths = m.files.map((f) => f.path).sort();
      expect(paths).toContain("index.html");
      expect(paths).toContain("assets/logo.png");
    }

    // The HTML blob differs between the two checkpoints; the PNG blob is shared.
    const html1 = cpManifests[0].files.find((f) => f.path === "index.html")!.blob;
    const html2 = cpManifests[1].files.find((f) => f.path === "index.html")!.blob;
    const png1 = cpManifests[0].files.find((f) => f.path === "assets/logo.png")!.blob;
    const png2 = cpManifests[1].files.find((f) => f.path === "assets/logo.png")!.blob;
    expect(html1).not.toBe(html2);
    expect(png1).toBe(png2); // dedup

    // Blob store holds each unique blob exactly once; binary bytes survive intact.
    const blobNames = new Set(readdirSync(join(outDir, "blobs")));
    expect(blobNames.has(html1)).toBe(true);
    expect(blobNames.has(html2)).toBe(true);
    expect(blobNames.has(png1)).toBe(true);
    expect(blobNames.size).toBe(res.blobCount);
    expect(res.blobCount).toBe(3); // html-v1, html-v2, png

    const storedPng = new Uint8Array(readFileSync(join(outDir, "blobs", png1)));
    expect(Array.from(storedPng)).toEqual(Array.from(pngBytes));

    const storedHtml2 = readFileSync(join(outDir, "blobs", html2), "utf-8");
    expect(storedHtml2).toBe("<h1>v2</h1>");
  });

  test("marks unsupported modes as not web-playable", async () => {
    await initShadowGit(workspace);
    writeFileSync(join(workspace, "project.json"), "{}");
    await enqueueCheckpoint(workspace, 1);
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "s1", mode: "clipcraft", backendType: "claude-code", createdAt: 900,
    }));
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify([]));

    const res = await materializePlayPackage(workspace, { output: outDir });
    expect(res.index.supported).toBe(false);
  });
});
