/**
 * Export routes — Slide export + WebCraft export + file listing.
 *
 * Registered for all non-launcher modes.
 * Includes: /export/slides, /export/webcraft, /api/files (GET).
 */

import type { Hono } from "hono";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { pathStartsWith } from "../utils.js";

export interface ExportOptions {
  workspace: string;
  initParams?: Record<string, number | string>;
  watchPatterns?: string[];
}

export function registerExportRoutes(app: Hono, options: ExportOptions) {
  const workspace = options.workspace;

  // ── Slide export: shared builder + routes ─────────────────────────────

  const ASSET_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
  };

  /** Read a workspace-relative file and return as a data: URI, or null on failure. */
  function readAsDataUri(ref: string, resolveBase = workspace): string | null {
    let cleaned = ref.split("?")[0].split("#")[0];
    if (cleaned.startsWith("/content/")) cleaned = cleaned.slice(9);
    if (cleaned.startsWith("/")) return null;
    const absPath = join(resolveBase, cleaned);
    if (!pathStartsWith(absPath, workspace) || !existsSync(absPath)) return null;
    try {
      const ext = extname(cleaned).toLowerCase();
      const mime = ASSET_MIME[ext] || "application/octet-stream";
      const data = readFileSync(absPath);
      return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
    } catch {
      return null;
    }
  }

  /** Replace local asset references with inline data: URIs. */
  function inlineAssets(html: string, resolveBase = workspace): string {
    // Inline <link rel="stylesheet" href="..."> as <style> blocks
    html = html.replace(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi, (match) => {
      const hrefMatch = match.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hrefMatch) return match;
      const ref = hrefMatch[1];
      if (/^(https?:|data:|\/\/|#)/i.test(ref)) return match;
      let cleaned = ref.split("?")[0].split("#")[0];
      if (cleaned.startsWith("/content/")) cleaned = cleaned.slice(9);
      if (cleaned.startsWith("/")) return match;
      const absPath = join(resolveBase, cleaned);
      if (!pathStartsWith(absPath, workspace) || !existsSync(absPath)) return match;
      try {
        const css = readFileSync(absPath, "utf-8");
        return `<style>/* inlined: ${cleaned} */\n${css}\n</style>`;
      } catch {
        return match;
      }
    });

    // Inline src="..." attributes pointing to local files
    html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, ref, suffix) => {
      if (/^(https?:|data:|\/\/|#)/i.test(ref)) return match;
      const dataUri = readAsDataUri(ref, resolveBase);
      return dataUri ? `${prefix}${dataUri}${suffix}` : match;
    });

    // Inline url(...) in CSS pointing to local files
    html = html.replace(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi, (match, ref) => {
      if (/^(https?:|data:|\/\/|#)/i.test(ref)) return match;
      const dataUri = readAsDataUri(ref, resolveBase);
      return dataUri ? `url("${dataUri}")` : match;
    });

    return html;
  }

  /** Build the full export HTML. When inline=true, assets are inlined and toolbar/base removed. */
  function buildExportHtml(opts: { inline: boolean; contentSet?: string }): { html: string; title: string } | { error: string; status: number } {
    // Resolve base directory: workspace root or content set subdirectory
    let baseDir = workspace;
    if (opts.contentSet) {
      baseDir = join(workspace, opts.contentSet);
    } else if (!existsSync(join(workspace, "manifest.json"))) {
      // Auto-discover: find first subdirectory containing manifest.json
      try {
        for (const entry of readdirSync(workspace, { withFileTypes: true })) {
          if (entry.isDirectory() && existsSync(join(workspace, entry.name, "manifest.json"))) {
            baseDir = join(workspace, entry.name);
            break;
          }
        }
      } catch { /* ignore */ }
    }

    const manifestPath = join(baseDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      return { error: "No manifest.json found in workspace", status: 404 };
    }
    let manifest: { title: string; slides: { file: string; title: string }[] };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      return { error: "Failed to parse manifest.json", status: 500 };
    }
    if (!manifest.slides?.length) {
      return { error: "No slides in manifest.json", status: 404 };
    }

    // Read theme.css and patch font stacks for CJK print compatibility
    const themePath = join(baseDir, "theme.css");
    let themeCSS = existsSync(themePath) ? readFileSync(themePath, "utf-8") : "";
    // Scope theme CSS to .slide-page so it doesn't pollute the export toolbar.
    // Extract :root blocks (CSS variables) to keep them global.
    if (themeCSS) {
      const globals: string[] = [];
      // Extract @import and :root blocks — they must stay at top level
      let scoped = themeCSS.replace(/@import\s+[^;]+;/g, (m) => { globals.push(m); return ""; });
      scoped = scoped.replace(/:root\s*\{[^}]*\}/g, (m) => { globals.push(m); return ""; });
      themeCSS = globals.join("\n") + "\n.slide-page {\n" + scoped + "\n}";
    }
    const CJK_FONTS = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei"';
    themeCSS = themeCSS.replace(
      /(--font-sans\s*:\s*)([^;]*?)(,\s*)(sans-serif\s*;)/,
      `$1$2, ${CJK_FONTS}$3$4`,
    );

    const W = (options.initParams?.slideWidth as number) || 1280;
    const H = (options.initParams?.slideHeight as number) || 720;

    // Read each slide HTML, extract <head> resources, and build page sections
    const headResourceSet = new Set<string>();
    const slidePages = manifest.slides
      .map((slide) => {
        const slidePath = join(baseDir, slide.file);
        let html = existsSync(slidePath) ? readFileSync(slidePath, "utf-8") : `<p>Missing: ${slide.file}</p>`;
        let bodyStyle = "";
        let bodyClass = "";
        if (html.includes("<!DOCTYPE") || html.includes("<html")) {
          const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
          if (headMatch) {
            const headContent = headMatch[1];
            const resourceRe = /<(link\b[^>]*(?:\/>|>)|script\b[^>]*>[\s\S]*?<\/script>|style\b[^>]*>[\s\S]*?<\/style>)/gi;
            let m;
            while ((m = resourceRe.exec(headContent)) !== null) {
              const tag = m[0].trim();
              if (/<link\b/i.test(tag) && !/rel\s*=\s*["']stylesheet["']/i.test(tag) && !/\.css/i.test(tag)) continue;
              headResourceSet.add(tag);
            }
          }
          const bodyTagMatch = html.match(/<body([^>]*)>/i);
          if (bodyTagMatch) {
            const attrs = bodyTagMatch[1];
            const styleMatch = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
            if (styleMatch) bodyStyle = styleMatch[1];
            const classMatch = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
            if (classMatch) bodyClass = classMatch[1];
          }
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          if (bodyMatch) {
            html = bodyMatch[1].trim();
          } else {
            html = html
              .replace(/<!DOCTYPE[^>]*>/gi, "")
              .replace(/<\/?html[^>]*>/gi, "")
              .replace(/<head[\s\S]*?<\/head>/gi, "")
              .replace(/<\/?body[^>]*>/gi, "")
              .trim();
          }
        }
        const wrapStyle = bodyStyle ? ` style="${bodyStyle}"` : "";
        const wrapClass = bodyClass ? ` ${bodyClass}` : "";
        return `<div class="slide-page${wrapClass}"${wrapStyle}>${html}</div>`;
      })
      .join("\n");
    const headResources = Array.from(headResourceSet).join("\n");

    const title = manifest.title || "Slides";
    const contentBase = opts.contentSet ? `${opts.contentSet}/` : "";
    const baseTag = opts.inline ? "" : `\n<base href="/content/${contentBase}">`;
    const toolbarHtml = opts.inline
      ? ""
      : `\n<div class="export-toolbar-wrapper">
  <div class="export-toolbar">
    <div class="header-left">
      <h1>${title}</h1>
      <span class="meta">${manifest.slides.length} slides \u00b7 ${W}\u00d7${H}</span>
    </div>
    <div class="export-toolbar-actions">
      <button class="btn-primary" onclick="downloadSlides()">Download HTML</button>
      <div class="print-group">
        <button class="mode-btn active" id="mode-img" onclick="setMode('image')">Image</button>
        <button class="mode-btn" id="mode-html" onclick="setMode('html')">HTML</button>
        <div class="print-divider"></div>
        <button class="print-action" id="print-btn" onclick="window.print()">Print / Save PDF</button>
      </div>
    </div>
  </div>
</div>`;

    const downloadScript = opts.inline
      ? ""
      : `\n<script>
function downloadSlides(){
  var btn=document.querySelector('.btn-primary');btn.textContent="Preparing...";btn.disabled=true;
  var qs=new URLSearchParams(location.search).get("contentSet");
  fetch("/export/slides/download"+(qs?"?contentSet="+encodeURIComponent(qs):"")).then(function(r){
    if(!r.ok)throw new Error("HTTP "+r.status);return r.blob();
  }).then(function(b){
    var a=document.createElement("a");a.href=URL.createObjectURL(b);
    a.download=document.title.replace(/\\s*\\u2014\\s*Export$/,"")+".html";
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }).catch(function(e){alert("Download failed: "+e.message)})
  .finally(function(){btn.textContent="Download HTML";btn.disabled=false});
}
<\/script>`;

    const imageModeScript = opts.inline
      ? ""
      : `\n<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"><\/script>
<script>
var originalSlides=[],converting=false,metaOriginal='';

async function convertToImages(){
  if(converting)return;converting=true;
  var printBtn=document.getElementById('print-btn');
  if(printBtn){printBtn.disabled=true;printBtn.textContent='Converting...'}
  var pages=document.querySelectorAll('.slide-page');
  if(!pages.length){converting=false;if(printBtn){printBtn.disabled=false;printBtn.textContent='Print / Save PDF'}return}
  var meta=document.querySelector('.meta');
  if(meta&&!metaOriginal)metaOriginal=meta.textContent||'';
  for(var i=0;i<pages.length;i++){
    if(meta)meta.textContent='Converting '+(i+1)+'/'+pages.length+'...';
    var page=pages[i];
    if(!originalSlides[i])originalSlides[i]=page.innerHTML;
    var result=await snapdom(page,{scale:2,embedFonts:true});
    var png=await result.toPng();
    page.innerHTML='';
    png.style.cssText='width:100%;height:100%;display:block';
    page.appendChild(png);
  }
  converting=false;if(meta)meta.textContent=metaOriginal;
  if(printBtn){printBtn.disabled=false;printBtn.textContent='Print / Save PDF'}
}
function restoreHTML(){
  var pages=document.querySelectorAll('.slide-page');
  for(var i=0;i<pages.length;i++){if(originalSlides[i]!=null)pages[i].innerHTML=originalSlides[i]}
}
function setMode(mode){
  document.getElementById('mode-img').classList.toggle('active',mode==='image');
  document.getElementById('mode-html').classList.toggle('active',mode==='html');
  if(mode==='image')convertToImages();else restoreHTML();
}
if(document.readyState==='complete')convertToImages();
else window.addEventListener('load',function(){convertToImages()});
<\/script>`;

    let exportHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${W}, initial-scale=1">${baseTag}
<title>${title} \u2014 Export</title>
${headResources}
<style>
${themeCSS}

/* Force standard font stack for Next-Gen design */
:root {
  --color-cc-bg: #09090b;
  --color-cc-surface: #18181b;
  --color-cc-card: rgba(24, 24, 27, 0.6);
  --color-cc-primary: #f97316;
  --color-cc-primary-hover: #fdba74;
  --color-cc-fg: #fafafa;
  --color-cc-muted: #a1a1aa;
  --color-cc-border: rgba(255, 255, 255, 0.08);
}

@page {
  size: ${W}px ${H}px;
  margin: 0;
}

* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

html {
  margin: 0;
  padding: 0;
  background: var(--color-cc-bg);
  font-family: 'Inter', 'Geist', system-ui, -apple-system, sans-serif;
}

body {
  margin: 0;
  padding: 0;
}

.slide-page {
  width: ${W}px;
  height: ${H}px;
  overflow: hidden;
  break-after: page;
  position: relative;
  /* Prevent blending issues with background */
  isolation: isolate;
  background-color: var(--color-bg, #ffffff) !important;
}
${opts.inline ? `
/* Standalone: same preview chrome but no toolbar gap at top */
@media screen {
  body { 
    padding: 20px 0 40px 0;
    min-height: 100vh;
    background: radial-gradient(circle at 50% 0%, rgba(249, 115, 22, 0.08) 0%, transparent 60%);
  }
  .slide-page {
    margin: 20px auto;
    box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--color-cc-border);
    border-radius: 8px;
  }
}
` : `
/* Screen preview: next-gen glassmorphic chrome */
@media screen {
  body { 
    padding: 0 0 40px 0; 
    min-height: 100vh;
    background: radial-gradient(circle at 50% 0%, rgba(249, 115, 22, 0.08) 0%, transparent 60%);
  }
  .slide-page {
    margin: 32px auto;
    box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--color-cc-border);
    border-radius: 8px;
  }
  .export-toolbar-wrapper {
    position: sticky;
    top: 0;
    z-index: 100;
    padding: 16px 24px 0;
    pointer-events: none;
  }
  .export-toolbar {
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: var(--color-cc-card);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--color-cc-border);
    border-radius: 999px;
    color: var(--color-cc-fg);
    max-width: ${W}px;
    margin: 0 auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .header-left {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .export-toolbar h1 {
    font-size: 15px;
    font-weight: 500;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .export-toolbar .meta {
    font-size: 13px;
    color: var(--color-cc-muted);
  }
  .export-toolbar-actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .export-toolbar button {
    padding: 8px 18px;
    border: none;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease-out;
  }
  .btn-primary {
    background: var(--color-cc-primary);
    color: #fff;
    box-shadow: 0 2px 12px rgba(249, 115, 22, 0.2);
  }
  .btn-primary:hover {
    background: var(--color-cc-primary-hover);
    box-shadow: 0 4px 16px rgba(249, 115, 22, 0.4);
    transform: translateY(-1px);
  }
  .btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-cc-fg);
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
  }
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .print-group {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 2px;
  }
  .mode-btn {
    padding: 6px 12px;
    border: none;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    color: var(--color-cc-muted);
    transition: all 0.2s ease;
  }
  .mode-btn:hover { color: var(--color-cc-fg); }
  .mode-btn.active {
    background: rgba(255, 255, 255, 0.1);
    color: var(--color-cc-fg);
  }
  .print-divider {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.12);
    margin: 0 4px;
  }
  .print-action {
    padding: 6px 14px;
    border: none;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: var(--color-cc-primary);
    color: #fff;
    transition: all 0.2s ease;
  }
  .print-action:hover:not(:disabled) {
    background: var(--color-cc-primary-hover);
  }
  .print-action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
`}
/* Print: set body width, preserve slide backgrounds */
@media print {
  body { padding: 0; width: ${W}px; }
  .export-toolbar-wrapper { display: none; }
  .slide-page {
    margin: 0;
    box-shadow: none;
    border-radius: 0;
    break-inside: avoid;
  }
  .slide-page:last-of-type {
    break-after: auto;
  }
  /* Strip only the effects that actually hang Chrome's print renderer:
     1. backdrop-filter — rasterising blurred background is extremely slow
     2. Large decorative blur pseudo-elements (theme glow orbs) */
  .slide-page * {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  .slide-page .slide::before,
  .slide-page .slide::after {
    display: none !important;
  }
  /* Compensate: elements that relied on backdrop-filter for glass look
     become nearly invisible without it — give them a visible background */
  .slide-page [style*="backdrop-filter"] {
    background: rgba(0, 0, 0, 0.5) !important;
  }
}
</style>
</head>
<body>${toolbarHtml}
${slidePages}${downloadScript}${imageModeScript}
</body>
</html>`;

    if (opts.inline) {
      exportHtml = inlineAssets(exportHtml, baseDir);
    }

    return { html: exportHtml, title };
  }

  app.get("/export/slides", (c) => {
    const contentSet = c.req.query("contentSet") || undefined;
    const result = buildExportHtml({ inline: false, contentSet });
    if ("error" in result) return c.text(result.error, result.status as any);
    return c.html(result.html);
  });

  app.get("/export/slides/download", (c) => {
    const contentSet = c.req.query("contentSet") || undefined;
    const result = buildExportHtml({ inline: true, contentSet });
    if ("error" in result) return c.text(result.error, result.status as any);
    const safeFilename = result.title.replace(/[^\w\s.-]/g, "_") + ".html";
    const utf8Filename = encodeURIComponent(result.title + ".html");
    return new Response(result.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename = "${safeFilename}"; filename *= UTF - 8''${utf8Filename} `,
      },
    });
  });

  // ── WebCraft export ──────────────────────────────────────────────────

  /** Inline local assets within a single page's HTML. Works relative to baseDir. */
  /** Build the WebCraft export HTML page. */
  function buildWebcraftExportHtml(opts: { inline: boolean; contentSet?: string }): { html: string; title: string } | { error: string; status: number } {
    // Resolve base directory
    let baseDir = workspace;
    if (opts.contentSet) {
      baseDir = join(workspace, opts.contentSet);
    } else if (!existsSync(join(workspace, "manifest.json"))) {
      try {
        for (const entry of readdirSync(workspace, { withFileTypes: true })) {
          if (entry.isDirectory() && existsSync(join(workspace, entry.name, "manifest.json"))) {
            baseDir = join(workspace, entry.name);
            break;
          }
        }
      } catch { /* ignore */ }
    }

    const manifestPath = join(baseDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      return { error: "No manifest.json found in workspace", status: 404 };
    }
    let manifest: { title?: string; pages?: { file: string; title?: string }[] };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      return { error: "Failed to parse manifest.json", status: 500 };
    }
    if (!manifest.pages?.length) {
      return { error: "No pages in manifest.json", status: 404 };
    }

    const title = manifest.title || "WebCraft Project";

    // Read each page HTML
    const pageContents = manifest.pages.map((page) => {
      const pagePath = join(baseDir, page.file);
      let html = existsSync(pagePath) ? readFileSync(pagePath, "utf-8") : `<p>Missing: ${page.file}</p>`;
      if (opts.inline) {
        html = inlineAssets(html, baseDir);
      }
      return { file: page.file, title: page.title || page.file.replace(/\.html$/i, ""), html };
    });

    const baseTag = opts.inline ? "" : `\n<base href="/content/${opts.contentSet ? opts.contentSet + "/" : ""}">`;
    const toolbarHtml = opts.inline
      ? ""
      : `\n<div class="export-toolbar-wrapper">
  <div class="export-toolbar">
    <div class="header-left">
      <h1>${title}</h1>
      <span class="meta">${manifest.pages!.length} page${manifest.pages!.length > 1 ? "s" : ""}</span>
    </div>
    <div class="viewport-group">
      <button class="vp-btn active" data-vp="full" onclick="setViewport('full')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        Full
      </button>
      <button class="vp-btn" data-vp="mobile" onclick="setViewport('mobile')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
        Mobile
      </button>
      <button class="vp-btn" data-vp="tablet" onclick="setViewport('tablet')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>
        Tablet
      </button>
      <button class="vp-btn" data-vp="desktop" onclick="setViewport('desktop')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        Desktop
      </button>
    </div>
    <div class="export-toolbar-actions">
      <button class="btn-primary" onclick="downloadHtml()">Download HTML</button>
      <button class="btn-secondary" onclick="downloadZip()">Download ZIP</button>
      <div class="print-divider"></div>
      <button class="btn-secondary" onclick="captureScreenshot()">Screenshot PNG</button>
      <button class="btn-secondary" onclick="window.print()">Print / Save PDF</button>
    </div>
  </div>
</div>`;

    const downloadScript = opts.inline
      ? ""
      : `\n<script>
function downloadHtml(){
  var btn=document.querySelector('.btn-primary');btn.textContent="Preparing...";btn.disabled=true;
  var qs=new URLSearchParams(location.search).get("contentSet");
  fetch("/export/webcraft/download"+(qs?"?contentSet="+encodeURIComponent(qs):"")).then(function(r){
    if(!r.ok)throw new Error("HTTP "+r.status);return r.blob();
  }).then(function(b){
    var a=document.createElement("a");a.href=URL.createObjectURL(b);
    a.download="${title.replace(/"/g, "")}.html";
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }).catch(function(e){alert("Download failed: "+e.message)})
  .finally(function(){btn.textContent="Download HTML";btn.disabled=false});
}
function downloadZip(){
  var qs=new URLSearchParams(location.search).get("contentSet");
  window.open("/export/webcraft/zip"+(qs?"?contentSet="+encodeURIComponent(qs):""));
}

var VIEWPORTS={full:{w:0,h:0},mobile:{w:375,h:812},tablet:{w:768,h:1024},desktop:{w:1280,h:800}};
var currentVP='full';

function updatePrintStyle(vp){
  var el=document.getElementById('print-page-style');
  if(!el){el=document.createElement('style');el.id='print-page-style';document.head.appendChild(el);}
  var spec=VIEWPORTS[vp];
  if(spec.w===0){
    el.textContent='@page{size:auto;margin:10mm;}';
  } else {
    // Use viewport dimensions for page size; landscape if wider than tall
    var orient=spec.w>spec.h?'landscape':'portrait';
    el.textContent='@page{size:'+spec.w+'px '+spec.h+'px;margin:0;}';
  }
}

function setViewport(vp){
  currentVP=vp;
  document.querySelectorAll('.vp-btn').forEach(function(b){
    b.classList.toggle('active',b.dataset.vp===vp);
  });
  updatePrintStyle(vp);
  var spec=VIEWPORTS[vp];
  var sections=document.querySelectorAll('.page-section');
  sections.forEach(function(sec){
    var wrapper=sec.querySelector('.page-frame-wrapper');
    var frame=sec.querySelector('iframe');
    if(!wrapper||!frame)return;
    if(spec.w===0){
      wrapper.style.width='';
      wrapper.style.margin='';
      frame.style.width='100%';
      frame.style.height='';
      frame.style.transform='';
      frame.style.transformOrigin='';
      wrapper.style.overflow='hidden';
      wrapper.style.height='';
      try{var h=frame.contentDocument.documentElement.scrollHeight;frame.style.height=Math.max(h,200)+'px';}catch(e){}
    } else {
      frame.style.width=spec.w+'px';
      frame.style.height=spec.h+'px';
      frame.style.transform='';
      frame.style.transformOrigin='top left';
      var containerW=wrapper.parentElement.clientWidth;
      var scale=Math.min(containerW/spec.w,1);
      frame.style.transform='scale('+scale+')';
      wrapper.style.width=Math.min(spec.w*scale,containerW)+'px';
      wrapper.style.height=(spec.h*scale)+'px';
      wrapper.style.overflow='hidden';
      wrapper.style.margin='0 auto';
    }
  });
}
async function captureScreenshot(){
  var btns=document.querySelectorAll('.export-toolbar-actions button');
  var btn=btns[2]; // Screenshot PNG button
  var origText=btn.textContent;
  btn.textContent='Capturing...';btn.disabled=true;
  var prevVP=currentVP;
  try{
    if(currentVP!=='full')setViewport('full');
    await new Promise(function(r){setTimeout(r,300)});
    var frames=document.querySelectorAll('.page-frame-wrapper iframe');
    var images=[];var totalHeight=0;var maxWidth=0;var gap=40;
    for(var i=0;i<frames.length;i++){
      var frame=frames[i];
      try{
        var doc=frame.contentDocument;
        var fullH=doc.documentElement.scrollHeight;
        frame.style.height=fullH+'px';
        await new Promise(function(r){setTimeout(r,200)});
        var result=await snapdom(doc.body,{embedFonts:true});
        var png=await result.toPng();
        var img=await new Promise(function(resolve,reject){
          var im=new Image();im.onload=function(){resolve(im)};im.onerror=reject;im.src=png.src;
        });
        images.push(img);
        totalHeight+=img.naturalHeight;
        maxWidth=Math.max(maxWidth,img.naturalWidth);
      }catch(e){console.error('Capture failed for frame '+i,e)}
    }
    if(images.length===0){alert('No pages captured');return}
    totalHeight+=gap*(images.length-1);
    var canvas=document.createElement('canvas');
    canvas.width=maxWidth;canvas.height=totalHeight;
    var ctx=canvas.getContext('2d');
    ctx.fillStyle='#f5f5f5';ctx.fillRect(0,0,maxWidth,totalHeight);
    var y=0;
    for(var j=0;j<images.length;j++){
      ctx.drawImage(images[j],0,y);
      y+=images[j].naturalHeight+gap;
    }
    await new Promise(function(resolve){
      canvas.toBlob(function(blob){
        var a=document.createElement('a');var url=URL.createObjectURL(blob);
        a.href=url;
        a.download='${title.replace(/"/g, "")}.png';
        a.click();
        setTimeout(function(){URL.revokeObjectURL(url)},1000);
        resolve();
      },'image/png');
    });
  }catch(e){alert('Screenshot failed: '+e.message)}
  finally{
    if(prevVP!=='full')setViewport(prevVP);
    btn.textContent=origText;btn.disabled=false;
  }
}
updatePrintStyle('full');
<\/script>`;

    // Escape </script> inside JSON to prevent premature script block closure
    const pagesJson = JSON.stringify(pageContents.map((p) => ({ file: p.file, title: p.title, html: p.html })))
      .replace(/<\/script>/gi, "<\\/script>");
    const pageInitScript = `\n<script>
var pages = ${pagesJson};
pages.forEach(function(page, i) {
  var frame = document.getElementById('page-frame-' + i);
  if (frame) {
    frame.srcdoc = page.html;
    frame.addEventListener('load', function() {
      try {
        var h = frame.contentDocument.documentElement.scrollHeight;
        frame.style.height = Math.max(h, 200) + 'px';
      } catch(e) {}
    });
  }
});

// Chrome can't print srcdoc iframes reliably.
// Before print: extract iframe content into direct DOM divs.
// After print: remove them and restore iframes.
window.addEventListener('beforeprint', function() {
  pages.forEach(function(page, i) {
    var section = document.querySelectorAll('.page-section')[i];
    if (!section) return;
    var wrapper = section.querySelector('.page-frame-wrapper');
    if (!wrapper) return;
    // Hide iframe
    var frame = wrapper.querySelector('iframe');
    if (frame) frame.style.display = 'none';
    // Create print-only div with page HTML directly embedded
    var div = document.createElement('div');
    div.className = 'print-page-content';
    div.innerHTML = page.html;
    // Strip <html>, <head>, <body> wrappers — extract body content
    var bodyMatch = page.html.match(/<body[^>]*>([\\s\\S]*?)<\\/body>/i);
    if (bodyMatch) {
      div.innerHTML = bodyMatch[1];
      // Also inject styles from <head>
      var headMatch = page.html.match(/<head[^>]*>([\\s\\S]*?)<\\/head>/i);
      if (headMatch) {
        var styleRe = /<style[^>]*>[\\s\\S]*?<\\/style>/gi;
        var linkRe = /<link[^>]*rel\\s*=\\s*["']stylesheet["'][^>]*>/gi;
        var m;
        while ((m = styleRe.exec(headMatch[1])) !== null) {
          div.insertAdjacentHTML('afterbegin', m[0]);
        }
        while ((m = linkRe.exec(headMatch[1])) !== null) {
          div.insertAdjacentHTML('afterbegin', m[0]);
        }
      }
    }
    wrapper.appendChild(div);
  });
});

window.addEventListener('afterprint', function() {
  // Remove print divs, restore iframes
  document.querySelectorAll('.print-page-content').forEach(function(el) { el.remove(); });
  document.querySelectorAll('.page-frame-wrapper iframe').forEach(function(f) { f.style.display = 'block'; });
});
<\/script>`;

    const pageSectionsHtml = pageContents.map((_page, i) => {
      return `<div class="page-section">
  <div class="page-header">
    <span class="page-number">${i + 1}</span>
    <span class="page-title">${pageContents[i].title}</span>
    <span class="page-file">${pageContents[i].file}</span>
  </div>
  <div class="page-frame-wrapper">
    <iframe id="page-frame-${i}" sandbox="allow-same-origin allow-scripts" style="width:100%;min-height:600px;border:none;background:#fff;"></iframe>
  </div>
</div>`;
    }).join("\n");

    let exportHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${baseTag}
<title>${title} \u2014 Export</title>
<style>
:root {
  --color-cc-bg: #09090b;
  --color-cc-surface: #18181b;
  --color-cc-card: rgba(24, 24, 27, 0.6);
  --color-cc-primary: #f97316;
  --color-cc-primary-hover: #fdba74;
  --color-cc-fg: #fafafa;
  --color-cc-muted: #a1a1aa;
  --color-cc-border: rgba(255, 255, 255, 0.08);
}

* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

html {
  margin: 0;
  padding: 0;
  background: var(--color-cc-bg);
  font-family: 'Inter', 'Geist', system-ui, -apple-system, sans-serif;
}

body {
  margin: 0;
  padding: 0;
}

@media screen {
  body {
    padding: 0 0 60px 0;
    min-height: 100vh;
    background: radial-gradient(circle at 50% 0%, rgba(249, 115, 22, 0.08) 0%, transparent 60%);
  }

  .export-toolbar-wrapper {
    position: sticky;
    top: 0;
    z-index: 100;
    padding: 16px 24px 0;
    pointer-events: none;
  }

  .export-toolbar {
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 10px 20px;
    background: var(--color-cc-card);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--color-cc-border);
    border-radius: 999px;
    color: var(--color-cc-fg);
    max-width: 1100px;
    margin: 0 auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-right: auto;
  }

  .export-toolbar h1 {
    font-size: 15px;
    font-weight: 500;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .export-toolbar .meta {
    font-size: 13px;
    color: var(--color-cc-muted);
  }

  .viewport-group {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 2px;
    gap: 1px;
  }

  .vp-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border: none;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    color: var(--color-cc-muted);
    transition: all 0.2s ease;
    white-space: nowrap;
  }
  .vp-btn svg { flex-shrink: 0; }
  .vp-btn:hover { color: var(--color-cc-fg); }
  .vp-btn.active {
    background: rgba(249, 115, 22, 0.15);
    color: var(--color-cc-primary);
  }

  .export-toolbar-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .export-toolbar-actions button {
    padding: 6px 14px;
    border: none;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease-out;
    white-space: nowrap;
  }

  .btn-primary {
    background: var(--color-cc-primary);
    color: #fff;
    box-shadow: 0 2px 12px rgba(249, 115, 22, 0.2);
  }
  .btn-primary:hover {
    background: var(--color-cc-primary-hover);
    box-shadow: 0 4px 16px rgba(249, 115, 22, 0.4);
    transform: translateY(-1px);
  }
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-cc-fg);
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
  }
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .print-divider {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.12);
  }

  .page-section {
    max-width: 960px;
    margin: 32px auto;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 8px 8px;
  }

  .page-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: rgba(249, 115, 22, 0.15);
    color: var(--color-cc-primary);
    font-size: 12px;
    font-weight: 600;
  }

  .page-title {
    color: var(--color-cc-fg);
    font-size: 14px;
    font-weight: 500;
  }

  .page-file {
    color: var(--color-cc-muted);
    font-size: 12px;
    font-family: ui-monospace, 'SF Mono', monospace;
  }

  .page-frame-wrapper {
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--color-cc-border);
    transition: width 0.3s ease, height 0.3s ease, margin 0.3s ease;
  }

  .page-frame-wrapper iframe {
    display: block;
    border-radius: 8px;
    transition: transform 0.3s ease;
    transform-origin: top left;
  }
}

@media screen {
  .print-page-content { display: none; }
}

@media print {
  html, body { padding: 0; margin: 0; background: #fff !important; }
  .export-toolbar-wrapper { display: none !important; }
  .page-header { display: none !important; }
  .page-section { margin: 0 !important; max-width: none !important; }
  .page-section + .page-section { break-before: page; }
  .page-frame-wrapper {
    box-shadow: none !important;
    border-radius: 0 !important;
    overflow: visible !important;
    transition: none !important;
    width: 100% !important;
    height: auto !important;
    margin: 0 !important;
  }
  .page-frame-wrapper iframe {
    display: none !important;
  }
  .print-page-content {
    display: block !important;
    background: #fff;
  }
}
</style>
<script src="/vendor/snapdom.js"><\/script>
</head>
<body>${toolbarHtml}
${pageSectionsHtml}${downloadScript}${pageInitScript}
</body>
</html>`;

    return { html: exportHtml, title };
  }

  app.get("/vendor/snapdom.js", async (c) => {
    const f = Bun.file(join(import.meta.dir, "..", "..", "node_modules", "@zumer", "snapdom", "dist", "snapdom.js"));
    if (!(await f.exists())) return c.text("snapdom not found", 404);
    return new Response(f, { headers: { "Content-Type": "application/javascript", "Cache-Control": "public, max-age=86400" } });
  });

  app.get("/export/webcraft", (c) => {
    const contentSet = c.req.query("contentSet") || undefined;
    const result = buildWebcraftExportHtml({ inline: false, contentSet });
    if ("error" in result) return c.text(result.error, result.status as any);
    return c.html(result.html);
  });

  app.get("/export/webcraft/download", (c) => {
    const contentSet = c.req.query("contentSet") || undefined;
    const pageFile = c.req.query("page") || undefined;
    // Resolve base directory (same logic as buildWebcraftExportHtml)
    let baseDir = workspace;
    if (contentSet) {
      baseDir = join(workspace, contentSet);
    } else if (!existsSync(join(workspace, "manifest.json"))) {
      try {
        for (const entry of readdirSync(workspace, { withFileTypes: true })) {
          if (entry.isDirectory() && existsSync(join(workspace, entry.name, "manifest.json"))) {
            baseDir = join(workspace, entry.name);
            break;
          }
        }
      } catch { /* ignore */ }
    }
    const manifestPath = join(baseDir, "manifest.json");
    if (!existsSync(manifestPath)) return c.text("No manifest.json found", 404);
    let manifest: { title?: string; pages?: { file: string; title?: string }[] };
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf-8")); } catch { return c.text("Bad manifest", 500); }
    if (!manifest.pages?.length) return c.text("No pages", 404);

    // Find the target page (specific page or first page)
    const targetPage = pageFile
      ? manifest.pages.find((p) => p.file === pageFile) || manifest.pages[0]
      : manifest.pages[0];
    const pagePath = join(baseDir, targetPage.file);
    if (!existsSync(pagePath)) return c.text(`Missing: ${targetPage.file}`, 404);

    // Return the original HTML with assets inlined
    const html = inlineAssets(readFileSync(pagePath, "utf-8"), baseDir);
    const title = targetPage.title || manifest.title || targetPage.file.replace(/\.html$/i, "");
    const safeFilename = title.replace(/[^\w\s.-]/g, "_") + ".html";
    const utf8Filename = encodeURIComponent(title + ".html");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${utf8Filename}`,
      },
    });
  });

  app.get("/export/webcraft/zip", async (c) => {
    if (!workspace) return c.text("No workspace", 400);
    let contentSet = c.req.query("contentSet") || undefined;
    // Auto-discover content set if not specified
    if (!contentSet && !existsSync(join(workspace, "manifest.json"))) {
      try {
        for (const entry of readdirSync(workspace, { withFileTypes: true })) {
          if (entry.isDirectory() && existsSync(join(workspace, entry.name, "manifest.json"))) {
            contentSet = entry.name;
            break;
          }
        }
      } catch { /* ignore */ }
    }
    const exportDir = contentSet ? join(workspace, contentSet) : workspace;
    const tmpFile = `/tmp/pneuma-webcraft-export-${Date.now()}.zip`;
    try {
      const proc = Bun.spawn(
        ["zip", "-r", tmpFile, ".", "-x", ".claude/*", ".pneuma/*", "CLAUDE.md", ".gitignore", "node_modules/*", ".git/*"],
        { cwd: exportDir, stdout: "ignore", stderr: "ignore" },
      );
      await proc.exited;
      const file = Bun.file(tmpFile);
      if (!(await file.exists())) return c.text("Export failed", 500);
      const content = await file.arrayBuffer();
      try { await Bun.spawn(["rm", tmpFile]).exited; } catch {}
      // Try to get title from manifest for filename
      let zipName = "webcraft-project";
      try {
        const mPath = join(exportDir, "manifest.json");
        if (existsSync(mPath)) {
          const m = JSON.parse(readFileSync(mPath, "utf-8"));
          if (m.title) zipName = m.title.replace(/[^\w\s.-]/g, "_");
        }
      } catch { /* ignore */ }
      return new Response(content, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipName}.zip"`,
        },
      });
    } catch {
      return c.text("Export failed", 500);
    }
  });

  app.get("/api/files", (c) => {
    const files: { path: string; content: string }[] = [];
    const patterns = options.watchPatterns || ["**/*.md"];
    try {
      for (const pattern of patterns) {
        const entries = new Bun.Glob(pattern).scanSync({ cwd: workspace, absolute: false });
        for (const rawPath of entries) {
          // Normalize to forward slashes (Bun.Glob returns backslashes on Windows)
          const relPath = rawPath.replaceAll("\\", "/");
          // Skip config files
          if (relPath === "CLAUDE.md" || relPath.startsWith(".claude/")) continue;
          // Skip duplicates (patterns may overlap)
          if (files.some((f) => f.path === relPath)) continue;
          const absPath = join(workspace, relPath);
          try {
            const content = readFileSync(absPath, "utf-8");
            files.push({ path: relPath, content });
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // glob failed
    }
    return c.json({ files, workspace });
  });
}
