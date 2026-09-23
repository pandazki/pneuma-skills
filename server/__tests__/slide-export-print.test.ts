/**
 * Slide export print pagination.
 *
 * "Print / Save PDF" used to emit an empty page after the last slide. Every
 * `.slide-page` carried `break-after: page`, and a `.slide-page:last-of-type`
 * rule was meant to cancel it on the final slide. Print materialization then
 * appended a staging `<div>` to `<body>` after the slide hosts, so the last
 * slide was no longer the last `div` sibling, kept its forced break, and the
 * staging node landed on a trailing blank page (12 slides -> 13 PDF pages).
 *
 * The invariant pinned here: page breaks are placed only *between* adjacent
 * slide hosts, so nothing appended after the deck can reintroduce a trailing
 * break, and the materialization staging node is excluded from print layout.
 * Real pagination is checked in Chrome; these tests pin the generated HTML/CSS.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerExportRoutes } from "../routes/export.js";

let workspace: string;
let app: Hono;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "pneuma-slide-export-print-"));
  const deck = join(workspace, "deck");
  await mkdir(join(deck, "slides"), { recursive: true });
  const slides = [1, 2, 3].map((n) => ({ file: `slides/slide-0${n}.html`, title: `Slide ${n}` }));
  await writeFile(join(deck, "manifest.json"), JSON.stringify({ title: "Deck", slides }), "utf-8");
  await writeFile(join(deck, "theme.css"), ":root { --color-bg: #111; }\n", "utf-8");
  for (const s of slides) {
    await writeFile(join(deck, s.file), `<div class="slide"><h1>${s.title}</h1></div>`, "utf-8");
  }
  app = new Hono();
  registerExportRoutes(app, { workspace, initParams: { slideWidth: 1280, slideHeight: 720 } });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** The export document's own stylesheet (first `<style>` in `<head>`), comments stripped. */
function exportStylesheet(html: string): string {
  const head = html.slice(0, html.indexOf("</head>"));
  const match = head.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) throw new Error("export stylesheet not found");
  return match[1].replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every rule body whose selector list is exactly `selector`. */
function ruleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1]);
}

async function fetchExport(path: string): Promise<string> {
  const res = await app.request(path);
  expect(res.status).toBe(200);
  return res.text();
}

describe.each([
  ["export page", "/export/slides?contentSet=deck"],
  ["standalone download", "/export/slides/download?contentSet=deck"],
])("slide %s print pagination", (_label, path) => {
  it("never forces a break after a slide page", async () => {
    const css = exportStylesheet(await fetchExport(path));
    for (const body of ruleBodies(css, ".slide-page")) {
      expect(body).not.toMatch(/break-after\s*:\s*page/);
      expect(body).not.toMatch(/page-break-after\s*:\s*always/);
    }
    // The fragile sibling-position exception must not come back.
    expect(css).not.toContain(":last-of-type");
  });

  it("breaks before every slide host that follows another slide host", async () => {
    const css = exportStylesheet(await fetchExport(path));
    const bodies = ruleBodies(css, ".slide-host + .slide-host");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.join("\n")).toMatch(/break-before\s*:\s*page/);
  });
});

describe("slide export print materialization", () => {
  it("marks the staging node and removes it from print layout", async () => {
    const html = await fetchExport("/export/slides?contentSet=deck");
    // createMaterializedSlides() appends its wrapper to <body> after the
    // slide hosts; it must carry the staging class the print CSS hides.
    const fn = html.slice(html.indexOf("async function createMaterializedSlides"));
    const body = fn.slice(0, fn.indexOf("return {wrapper:wrapper"));
    expect(body).toContain("wrapper.className='print-staging'");

    const css = exportStylesheet(html);
    const print = css.slice(css.lastIndexOf("@media print"));
    const staging = ruleBodies(print, ".print-staging");
    expect(staging.length).toBeGreaterThan(0);
    expect(staging.join("\n")).toMatch(/display\s*:\s*none/);
  });
});
