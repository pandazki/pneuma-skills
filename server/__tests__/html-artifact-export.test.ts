import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import manifest from "../../modes/brand/manifest.js";
import { registerHtmlArtifactExport } from "../routes/html-artifact-export.js";
import { registerExportRoutes } from "../routes/export.js";
import { LIVE_TIER, LIVE_TIER_LABEL, announceLiveTierSkip } from "../../core/__tests__/test-tier.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "html-artifact-")); roots.push(root);
  await mkdir(join(root, "project"));
  const app = new Hono(); registerHtmlArtifactExport(app, root, manifest);
  return { root, app };
}
it("reports missing output and serves the declared artifact only", async () => {
  const { root, app } = await setup();
  expect((await app.request("/export/brand/file?contentSet=project")).status).toBe(404);
  expect((await app.request("/export/brand?contentSet=project")).status).toBe(404);
  await writeFile(join(root, "project/brand-book.html"), "<!doctype html><h1>Brand</h1>");
  const response = await app.request("/export/brand/file?contentSet=project&file=.env");
  expect(response.status).toBe(200); expect(await response.text()).toContain("Brand");
  const page = await (await app.request("/export/brand?contentSet=project")).text();
  expect(page).toContain("collectDeployFiles"); expect(page).toContain("Download HTML");
  expect(page).toContain("Print / Save PDF"); expect(page).toContain("Screenshot PNG");
  expect(page).toContain('fetch("/export/brand/file"');
  expect(page).not.toContain('fetch("/export/webcraft/download"');
});
it("rejects traversal, symlink escape and malformed declarations", async () => {
  const { root, app } = await setup();
  expect((await app.request("/export/brand/file?contentSet=../outside")).status).toBe(400);
  await symlink("/etc/hosts", join(root, "project/brand-book.html"));
  expect((await app.request("/export/brand/file?contentSet=project")).status).toBe(403);
  expect(() => registerHtmlArtifactExport(new Hono(), root, { ...manifest, artifactExport: { file: "../x.html" } })).toThrow();
});
announceLiveTierSkip("HTML artifact ZIP integration");
describe.skipIf(!LIVE_TIER)(`HTML artifact ZIP ${LIVE_TIER_LABEL}`, () => {
  it.skipIf(!Bun.which("zip") || !Bun.which("unzip"))("uses the shared ZIP flow for the selected artifact content set", async () => {
    const { root } = await setup();
    await writeFile(join(root, "project/brand-book.html"), "<!doctype html><h1>Book</h1>");
    await writeFile(join(root, "project/core-asset.txt"), "REUSABLE-SOURCE");
    await writeFile(join(root, "sibling.txt"), "UNRELATED");
    const app = new Hono(); registerExportRoutes(app, { workspace: root, modeManifest: manifest });
    const response = await app.request("/export/brand/zip?contentSet=project");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    const zip = join(root, "download.zip"); await Bun.write(zip, await response.arrayBuffer());
    const proc = Bun.spawn(["unzip", "-l", zip], { stdout: "pipe", stderr: "pipe" });
    const listing = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(listing).toContain("core-asset.txt"); expect(listing).toContain("brand-book.html");
    expect(listing).not.toContain("sibling.txt");
    await symlink("/etc/hosts", join(root, "project/leak"));
    expect((await app.request("/export/brand/zip?contentSet=project")).status).toBe(403);
  });
});
