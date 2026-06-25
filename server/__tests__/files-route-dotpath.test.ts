/**
 * GET /api/files — explicitly-declared dot-path watch patterns must be served.
 *
 * A mode whose manifest declares a state file inside a dot-directory in
 * `watchPatterns` (e.g. wordtaste's `.pneuma/cross-family.json`) needs that file
 * in the initial /api/files snapshot — otherwise the json-file source that
 * reads it never hydrates on cold start (the file exists on disk but is absent
 * from the snapshot), producing the cross-family banner flash / stuck state.
 *
 * Bun.Glob excludes dot-directories unless `dot: true`, so a literal
 * `.pneuma/…` pattern matched nothing. The fix enables `dot` PER PATTERN, only
 * when the author wrote a dot-intentional segment — so ordinary glob patterns
 * keep their dotfile-excluding default (no cross-mode regression). These tests
 * pin both halves.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerExportRoutes } from "../routes/export.js";

let workspace: string;
let app: Hono;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "wordtaste-files-route-"));
  // A normal content file…
  mkdirSync(join(workspace, "worked-example"), { recursive: true });
  writeFileSync(join(workspace, "worked-example", "draft.md"), "# Title\n\nBody.");
  // …a state file inside a dot-directory, declared in watchPatterns…
  mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  writeFileSync(
    join(workspace, ".pneuma", "cross-family.json"),
    JSON.stringify({ claude: true, codex: true, gemini: true }),
  );
  // …and a markdown file hiding inside a dot-directory that NO dot-intentional
  // pattern declares — it must stay excluded.
  mkdirSync(join(workspace, ".secret"), { recursive: true });
  writeFileSync(join(workspace, ".secret", "draft.md"), "should not be served");

  app = new Hono();
  registerExportRoutes(app, {
    workspace,
    watchPatterns: ["**/draft.md", ".pneuma/cross-family.json"],
  });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("GET /api/files — dot-path watch patterns", () => {
  async function fetchFiles(): Promise<{ path: string; content: string }[]> {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { path: string; content: string }[] };
    return body.files;
  }

  test("serves a dot-path file explicitly declared in watchPatterns", async () => {
    const files = await fetchFiles();
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".pneuma/cross-family.json");
    const cf = files.find((f) => f.path === ".pneuma/cross-family.json");
    expect(JSON.parse(cf!.content)).toMatchObject({ claude: true, codex: true, gemini: true });
  });

  test("still serves ordinary (non-dot) content files", async () => {
    const paths = (await fetchFiles()).map((f) => f.path);
    expect(paths).toContain("worked-example/draft.md");
  });

  test("does NOT serve dotfiles a non-dot pattern would have hidden (no regression)", async () => {
    const paths = (await fetchFiles()).map((f) => f.path);
    // The non-dot pattern must keep excluding the dot-dir hit.
    expect(paths).not.toContain(".secret/draft.md");
  });
});
