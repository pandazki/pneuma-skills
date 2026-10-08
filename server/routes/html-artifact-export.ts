import type { Hono } from "hono";
import { join, extname } from "node:path";
import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { isContained } from "../utils.js";
import { getDeployCSS, getDeployToolbarHTML, getDeployModalHTML, getDeployScript } from "./deploy-ui.js";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Transport for a mode-declared, self-contained HTML artifact. Domain assembly
 * stays in the mode; this route only reads one declared file and hosts deploy UI. */
export function registerHtmlArtifactExport(app: Hono, workspace: string, manifest: ModeManifest) {
  const file = manifest.artifactExport?.file;
  if (!file || !/^[a-z0-9-]+$/.test(manifest.name) || extname(file) !== ".html" || file.startsWith("/") || /[\\\x00-\x1f?#:%]/.test(file) || file.split("/").some((s) => !s || s === "." || s === "..")) {
    throw new Error("Invalid artifactExport: expected a relative .html file and a kebab-case mode name");
  }
  const route = `/export/${manifest.name}`;
  app.get(`${route}/file`, async (c) => {
    const contentSet = c.req.query("contentSet") ?? "";
    if (contentSet.startsWith("/") || /[\\\x00-\x1f]/.test(contentSet) || contentSet.split("/").some((p) => p === ".." || p === ".")) return c.text("Invalid content set", 400);
    const base = join(workspace, contentSet);
    const path = join(base, file);
    if (!isContained(base, workspace) || !isContained(path, base)) return c.text("Artifact path escapes its content set", 403);
    const artifact = Bun.file(path);
    if (!(await artifact.exists())) return c.text(`No ${file} yet. Generate the HTML deliverable from the current source files first.`, 404);
    return new Response(artifact, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(c.req.query("download") === "1" ? { "Content-Disposition": 'attachment; filename="index.html"' } : {}) } });
  });
  app.get(route, (c) => {
    const contentSet = c.req.query("contentSet") ?? "";
    const fileUrl = `${route}/file?contentSet=${encodeURIComponent(contentSet)}`;
    const scriptUrl = JSON.stringify(fileUrl).replace(/</g, "\\u003c");
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(manifest.name)} export</title><style>
:root{--color-cc-bg:#09090b;--color-cc-surface:#18181b;--color-cc-fg:#fafafa;--color-cc-muted:#a1a1aa;--color-cc-primary:#f97316;--color-cc-border:#3f3f46}*{box-sizing:border-box}body{margin:0;background:var(--color-cc-bg);color:var(--color-cc-fg);font:14px system-ui,sans-serif}header{padding:16px 24px;display:flex;align-items:center;gap:20px;border-bottom:1px solid var(--color-cc-border)}h1{font-size:18px;margin:0;flex:1}a{color:var(--color-cc-fg);text-underline-offset:4px}a:focus-visible{outline:2px solid var(--color-cc-primary);outline-offset:4px}iframe{width:100%;height:calc(100vh - 110px);border:0;background:white}#artifact-status{padding:10px 24px;margin:0;color:var(--color-cc-muted)}${getDeployCSS()}
</style></head><body><header><h1>${escape(manifest.name)} · HTML deliverable</h1><a href="${escape(fileUrl)}&amp;download=1">Download HTML</a><span>Deploy</span>${getDeployToolbarHTML()}</header><p id="artifact-status" role="status">Checking generated deliverable…</p><iframe title="Generated HTML deliverable" sandbox="allow-scripts" src="${escape(fileUrl)}"></iframe>${getDeployModalHTML()}<script>
async function collectDeployFiles(logEl){const response=await fetch(${scriptUrl});if(!response.ok)throw new Error(await response.text());const content=await response.text();deployLog(logEl,'Collected index.html');return [{path:'index.html',content}];}
fetch(${scriptUrl}).then(async r=>{document.getElementById('artifact-status').textContent=r.ok?'Preview the generated deliverable before downloading or deploying. Regenerate it after source changes.':await r.text();}).catch(e=>{document.getElementById('artifact-status').textContent='Could not load deliverable: '+e.message;});
${getDeployScript()}</script></body></html>`);
  });
}
