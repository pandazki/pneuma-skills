/**
 * Palate Markdown export route.
 *
 * Palate's draft.md is already pure body-only markdown (the skill keeps the
 * annotations + meta out of it), so "export the article" is "download the
 * active content-set's draft.md" with a sensible filename. This pins the
 * route's behavior end-to-end against a real Hono app + on-disk workspace,
 * mirroring the kami/webcraft download routes (which return the body and set a
 * download-safe Content-Disposition).
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerExportRoutes } from "../routes/export.js";

let workspace: string;
let app: Hono;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "pneuma-palate-export-"));
  app = new Hono();
  registerExportRoutes(app, { workspace });
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Drop a draft.md into a content-set subdirectory. */
async function seedDraft(contentSet: string, body: string): Promise<void> {
  const dir = join(workspace, contentSet);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "draft.md"), body, "utf-8");
}

const SAMPLE = `# The Quiet Engine

The first thing you notice is the silence.

Then the way it pulls.
`;

describe("GET /export/palate/download", () => {
  it("serves the active content-set's draft.md body as markdown", async () => {
    await seedDraft("from-idea", SAMPLE);
    const res = await app.request("/export/palate/download?contentSet=from-idea");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toBe(SAMPLE);
  });

  it("forces a download with a Content-Disposition attachment", async () => {
    await seedDraft("from-idea", SAMPLE);
    const res = await app.request("/export/palate/download?contentSet=from-idea");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("attachment");
    expect(cd).toContain(".md");
  });

  it("derives the filename from the first markdown heading", async () => {
    await seedDraft("from-idea", SAMPLE);
    const res = await app.request("/export/palate/download?contentSet=from-idea");
    const cd = res.headers.get("content-disposition") ?? "";
    // "# The Quiet Engine" → the article title carried into the filename. We
    // reuse the shared safeDownloadName helper, which preserves intra-word
    // spaces (valid inside a quoted Content-Disposition filename) exactly like
    // the slide/webcraft/kami download routes do.
    expect(cd).toContain("The Quiet Engine.md");
  });

  it("derives the filename from a Setext (underline) heading too", async () => {
    await seedDraft("from-idea", "Underlined Title\n================\n\nbody\n");
    const res = await app.request("/export/palate/download?contentSet=from-idea");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("Underlined Title.md");
  });

  it("ASCII-slugging falls back to the content-set name for a CJK-only title", async () => {
    // safeDownloadName strips the CJK heading down to nothing, so the filename
    // base falls through to the content-set name (+ date). The UTF-8 filename*
    // still carries the real title for capable browsers.
    await seedDraft("my-essay", "# 我的作品集\n\n正文\n");
    const res = await app.request("/export/palate/download?contentSet=my-essay");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("my-essay");
    expect(cd).toContain("filename*=UTF-8''");
  });

  it("falls back to the content-set name when there is no heading", async () => {
    await seedDraft("my-essay", "Just prose, no heading here.\n");
    const res = await app.request("/export/palate/download?contentSet=my-essay");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("my-essay");
  });

  it("exports the requested content-set when several exist", async () => {
    await seedDraft("from-idea", "# Idea draft\n\nidea body\n");
    await seedDraft("from-draft", "# Draft draft\n\ndraft body\n");
    const res = await app.request("/export/palate/download?contentSet=from-draft");
    const text = await res.text();
    expect(text).toContain("draft body");
    expect(text).not.toContain("idea body");
  });

  it("auto-discovers the lone content-set when none is requested", async () => {
    await seedDraft("worked-example", SAMPLE);
    const res = await app.request("/export/palate/download");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(SAMPLE);
  });

  it("serves a root-level draft.md when present", async () => {
    await writeFile(join(workspace, "draft.md"), SAMPLE, "utf-8");
    const res = await app.request("/export/palate/download");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SAMPLE);
  });

  it("404s when no draft.md can be found", async () => {
    const res = await app.request("/export/palate/download?contentSet=from-idea");
    expect(res.status).toBe(404);
  });

  it("rejects a content-set that escapes the workspace (path traversal)", async () => {
    const res = await app.request(
      `/export/palate/download?contentSet=${encodeURIComponent("../../etc")}`,
    );
    expect(res.status).toBe(400);
  });
});
