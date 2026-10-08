import { expect, it } from "bun:test";
import type { ModeManifest } from "../types/mode-manifest.js";
import brand from "../../modes/brand/manifest.js";
import { exportBrandSite } from "../../modes/brand/skill/scripts/export-site.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { registerHtmlArtifactExport } from "../../server/routes/html-artifact-export.js";

it("the declared artifact maps mode generation to runtime download under a different mode name", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-contract-"));
  try {
    await cp(join(import.meta.dir, "../../modes/brand/seed/morrow"), root, { recursive: true });
    const html = await exportBrandSite(root);
    const manifest: ModeManifest = { ...brand, name: "contract-fixture" };
    const app = new Hono(); registerHtmlArtifactExport(app, root, manifest);
    const response = await app.request("/export/contract-fixture/file?download=1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(await response.text()).toBe(html);
    expect((await app.request("/export/brand/file")).status).toBe(404);
  } finally { await rm(root, { recursive: true, force: true }); }
});
