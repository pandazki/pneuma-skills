import { resolve } from "node:path";
import { lstat, writeFile, rename, rm } from "node:fs/promises";
import { readProject } from "./check.js";

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Produce a self-contained brand book. Images are inline; editable HTML
 * specimens stay in the source kit. Examples carry no production promises. */
export async function exportBrandSite(directory: string) {
  const { project, root } = await readProject(directory);
  const e = escapeHtml;
  const works: string[] = [];
  for (const item of project.items) {
    if (item.status !== "ready" || !item.file || item.stage === "references") continue;
    const file = Bun.file(resolve(root, item.file));
    let preview: string;
    if (item.kind === "html") {
      // HTML examples need a raster preview for a portable book. The standalone
      // source stays in the kit; do not export an iframe whose dependencies break.
      preview = '<p class="source-note">Editable HTML specimen included in the source kit.</p>';
    } else {
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");
      preview = `<img src="data:${file.type};base64,${data}" alt="${e(item.title)}" loading="lazy">`;
    }
    works.push(`<article id="${e(item.id)}"><header><h2>${e(item.title)}</h2><span>${e(item.stage === "applications" ? "Application example" : item.stage)}</span></header>${preview}<p>${e(item.description)}</p>${item.contexts.length ? `<p class="contexts">For ${e(item.contexts.map((id) => project.contexts.find((c) => c.id === id)!.title).join(" · "))}</p>` : ""}</article>`);
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(project.title)} — Brand book</title><style>
*{box-sizing:border-box}body{margin:0;background:#fafaf8;color:#192720;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:64px 28px}h1{font-size:clamp(38px,7vw,78px);line-height:1.05;letter-spacing:-.035em;margin:0 0 24px}h2{font-size:24px;line-height:1.3;margin:0}p{max-width:72ch}nav{display:flex;flex-wrap:wrap;gap:16px;margin:32px 0}a{color:inherit;text-underline-offset:5px}a:focus-visible{outline:2px solid #c85528;outline-offset:5px}.intro{max-width:780px;font-size:21px}.palette{display:flex;gap:22px;flex-wrap:wrap;margin:32px 0}.swatch i{display:block;width:70px;height:48px;border:1px solid #ddd}.swatch code{display:block;font-size:12px}section{padding:28px 0;border-top:1px solid #cfd5d0}.applications{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:28px}article{margin-top:56px}article header{display:flex;gap:20px;align-items:baseline;justify-content:space-between;margin-bottom:18px}article header span,.contexts{color:#506158;font-size:13px}article img{display:block;width:100%;max-height:850px;object-fit:contain;background:#f1f2ed}footer{margin-top:56px;border-top:1px solid #cfd5d0;padding-top:24px;color:#506158}li{margin:8px 0}@media print{main{padding:20px}article{break-inside:avoid}nav{display:none}}
</style></head><body><main><h1>${e(project.title)}</h1><p class="intro">${e(project.brief.promise)}</p><p>${e(project.description)}</p><nav><a href="#principles">Brand principles</a><a href="#applications">Application contexts</a>${project.items.filter((i) => i.status === "ready" && i.stage !== "references").map((i) => `<a href="#${e(i.id)}">${e(i.title)}</a>`).join("")}</nav><section id="principles"><h2>A recognizable point of view</h2><p>${e(project.brief.audience)}</p><p>${e(project.brief.personality.join(" · "))}</p><ul>${project.brief.rules.map((r) => `<li>${e(r)}</li>`).join("")}</ul><div class="palette">${project.palette.map((c) => `<div class="swatch"><i style="background:${c.value}"></i>${e(c.name)}<code>${c.value}</code></div>`).join("")}</div></section><section id="applications"><h2>One brand, different contexts</h2><div class="applications">${project.contexts.map((c) => `<div><h3>${e(c.title)}</h3><p>${e(c.purpose)}</p><p>${e(c.guidance)}</p></div>`).join("")}</div></section>${works.join("")}<footer>This brand book defines a visual system and representative applications. Adapt these examples into production materials for each channel; verify dimensions, typography, accessibility and production specifications in that context.</footer></main></body></html>`;
  const output = resolve(root, "brand-book.html");
  const existing = await lstat(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing?.isSymbolicLink()) throw new Error("Refusing to write brand-book.html through a symbolic link");
  const temporary = resolve(root, `.brand-book-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, html, { flag: "wx" });
    await rename(temporary, output);
  } finally { await rm(temporary, { force: true }); }
  return html;
}

if (import.meta.main) {
  try { await exportBrandSite(process.argv[2] ?? "."); console.log("Exported brand-book.html (self-contained)."); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
