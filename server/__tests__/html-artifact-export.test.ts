import { afterEach, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import manifest from "../../modes/brand/manifest.js";
import { registerHtmlArtifactExport } from "../routes/html-artifact-export.js";

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
  await writeFile(join(root, "project/brand-book.html"), "<!doctype html><h1>Brand</h1>");
  const response = await app.request("/export/brand/file?contentSet=project&file=.env");
  expect(response.status).toBe(200); expect(await response.text()).toContain("Brand");
  const page = await (await app.request("/export/brand?contentSet=project")).text();
  expect(page).toContain("collectDeployFiles"); expect(page).toContain("Download HTML");
  expect(page).toContain("if(!response.ok)throw");
});
it("rejects traversal, symlink escape and malformed declarations", async () => {
  const { root, app } = await setup();
  expect((await app.request("/export/brand/file?contentSet=../outside")).status).toBe(400);
  await symlink("/etc/hosts", join(root, "project/brand-book.html"));
  expect((await app.request("/export/brand/file?contentSet=project")).status).toBe(403);
  expect(() => registerHtmlArtifactExport(new Hono(), root, { ...manifest, artifactExport: { file: "../x.html" } })).toThrow();
});
