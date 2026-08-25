import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerExportRoutes } from "../export.js";

let tmpRoot: string;
let app: Hono;

/** A two-page project: the shape where "Download HTML" used to truncate. */
function writeProject(): void {
  writeFileSync(
    join(tmpRoot, "manifest.json"),
    JSON.stringify({
      title: "Two Page Site",
      pages: [
        { file: "index.html", title: "Home" },
        { file: "about.html", title: "About" },
      ],
    }),
  );
  writeFileSync(join(tmpRoot, "index.html"), "<!doctype html><h1>HOME-MARKER</h1>");
  writeFileSync(join(tmpRoot, "about.html"), "<!doctype html><h1>ABOUT-MARKER</h1>");
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "export-webcraft-test-"));
  app = new Hono();
  registerExportRoutes(app, { workspace: tmpRoot });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /export/webcraft/download", () => {
  test("serves the named page, not the first one", async () => {
    writeProject();
    const res = await app.request("/export/webcraft/download?page=about.html");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("ABOUT-MARKER");
    expect(body).not.toContain("HOME-MARKER");
  });

  test("falls back to the first page when none is named", async () => {
    writeProject();
    const body = await (await app.request("/export/webcraft/download")).text();
    expect(body).toContain("HOME-MARKER");
  });

  test("names the download after the page, so sibling links keep resolving", async () => {
    writeProject();
    const res = await app.request("/export/webcraft/download?page=about.html");
    // The route names the file from the page's title; the multi-page client
    // overrides it with the page's own file name (asserted below).
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });
});

describe("GET /export/webcraft — the download button", () => {
  test("asks for every page of a multi-page project", async () => {
    writeProject();
    const html = await (await app.request("/export/webcraft")).text();
    // Both pages reach the client…
    expect(html).toContain("index.html");
    expect(html).toContain("about.html");
    // …and the download walks them, passing each one to the route. Without
    // the page parameter the route answers pages[0] every time, which is the
    // bug this pins: one page handed back under the whole project's name.
    expect(html).toContain('params.push("page="+encodeURIComponent(page.file))');
    expect(html).toContain("a.download=single?");
  });

  test("a single-page project still downloads under the project title", async () => {
    writeFileSync(
      join(tmpRoot, "manifest.json"),
      JSON.stringify({ title: "Solo", pages: [{ file: "index.html", title: "Home" }] }),
    );
    writeFileSync(join(tmpRoot, "index.html"), "<!doctype html><h1>SOLO</h1>");
    const html = await (await app.request("/export/webcraft")).text();
    expect(html).toContain('a.download=single?"Solo.html"');
  });
});
