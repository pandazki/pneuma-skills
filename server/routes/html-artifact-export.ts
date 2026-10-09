import type { Hono } from "hono";
import { join, extname } from "node:path";
import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { isContained } from "../utils.js";
import { buildHtmlPagesExport } from "./html-pages-export.js";

/** Read a mode-declared artifact and present WebCraft's shared export workbench.
 * Domain assembly and print layout remain in the mode. */
export function registerHtmlArtifactExport(app: Hono, workspace: string, manifest: ModeManifest, zipRoute?: string) {
  const file = manifest.artifactExport?.file;
  if (!file || !/^[a-z0-9-]+$/.test(manifest.name) || extname(file) !== ".html" || file.startsWith("/") || /[\\\x00-\x1f?#:%]/.test(file) || file.split("/").some((s) => !s || s === "." || s === "..")) {
    throw new Error("Invalid artifactExport: expected a relative .html file and a kebab-case mode name");
  }
  const route = `/export/${manifest.name}`;
  async function readArtifact(contentSet: string): Promise<{ html: string } | { error: string; status: 400 | 403 | 404 }> {
    if (contentSet.startsWith("/") || /[\\\x00-\x1f]/.test(contentSet) || contentSet.split("/").some((p) => p === ".." || p === ".")) return { error: "Invalid content set", status: 400 as const };
    const base = join(workspace, contentSet);
    const path = join(base, file!);
    if (!isContained(base, workspace) || !isContained(path, base)) return { error: "Artifact path escapes its content set", status: 403 as const };
    const artifact = Bun.file(path);
    if (!(await artifact.exists())) return { error: `No ${file} yet. Generate the HTML deliverable from the current source files first.`, status: 404 as const };
    return { html: await artifact.text() };
  }
  app.get(`${route}/file`, async (c) => {
    const result = await readArtifact(c.req.query("contentSet") ?? "");
    if ("error" in result) return c.text(result.error, result.status);
    return new Response(result.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(c.req.query("download") === "1" ? { "Content-Disposition": 'attachment; filename="index.html"' } : {}) } });
  });
  app.get(route, async (c) => {
    const contentSet = c.req.query("contentSet") ?? "";
    const result = await readArtifact(contentSet);
    if ("error" in result) return c.text(result.error, result.status);
    const title = [contentSet, file!.replace(/\.html$/i, "")].filter(Boolean).join(" · ");
    const page = buildHtmlPagesExport({ title, contentSet, downloadRoute: `${route}/file`, zipRoute,
      pageContents: [{ file: file!, title, html: result.html }] });
    c.header("Cache-Control", "no-store");
    return c.html(page.html);
  });
}
