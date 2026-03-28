/**
 * Export routes — Slide export + WebCraft export + Remotion export + file listing.
 *
 * Registered for all non-launcher modes.
 * Includes: /export/slides, /export/webcraft, /export/remotion, /api/files (GET).
 */

import type { Hono } from "hono";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { pathStartsWith } from "../utils.js";
import { parseCompositions } from "../../modes/remotion/viewer/composition-parser.js";
import { getDeployCSS, getDeployToolbarHTML, getDeployModalHTML, getDeployScript } from "./deploy-ui.js";

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
    let resolvedContentSet = opts.contentSet;
    if (opts.contentSet) {
      baseDir = join(workspace, opts.contentSet);
    } else if (!existsSync(join(workspace, "manifest.json"))) {
      // Auto-discover: find first subdirectory containing manifest.json
      try {
        for (const entry of readdirSync(workspace, { withFileTypes: true })) {
          if (entry.isDirectory() && existsSync(join(workspace, entry.name, "manifest.json"))) {
            baseDir = join(workspace, entry.name);
            resolvedContentSet = entry.name;
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
      let scoped = themeCSS.replace(/@import\s+url\([^)]*\)\s*;|@import\s+[^;]+;/g, (m) => { globals.push(m); return ""; });
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
    const contentBase = resolvedContentSet ? `${resolvedContentSet}/` : "";
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
      <button class="btn-secondary" onclick="downloadPptx()">Download PPTX</button>
      <div class="print-group">
        <button class="mode-btn active" id="mode-img" onclick="setMode('image')">Image</button>
        <button class="mode-btn" id="mode-html" onclick="setMode('html')">HTML</button>
        <div class="print-divider"></div>
        <button class="print-action" id="print-btn" onclick="window.print()">Print / Save PDF</button>
      </div>
      ${getDeployToolbarHTML({ previewUrl: `/export/slides/player${resolvedContentSet ? "?contentSet=" + encodeURIComponent(resolvedContentSet) : ""}` })}
    </div>
  </div>
</div>
${getDeployModalHTML()}`;

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

    const pptxScript = opts.inline
      ? ""
      : `\n<script>
var pptxLoaded=false;
function downloadPptx(){
  var btn=document.querySelector('.btn-secondary');
  btn.textContent='Preparing...';btn.disabled=true;
  var meta=document.querySelector('.meta');var metaOrig=meta?meta.textContent:'';
  function updateMeta(t){if(meta)meta.textContent=t}

  function prepareSlidesForPptx(pages){
    // Clone slides into an offscreen container for preprocessing
    var wrapper=document.createElement('div');
    wrapper.style.cssText='position:absolute;left:-9999px;top:0;width:${W}px';
    document.body.appendChild(wrapper);
    var clones=[];
    for(var i=0;i<pages.length;i++){
      var clone=pages[i].cloneNode(true);
      clone.style.width='${W}px';
      clone.style.height='${H}px';
      clone.style.overflow='hidden';
      clone.style.position='relative';
      wrapper.appendChild(clone);
      clones.push(clone);
    }

    // 1. Resolve CSS custom properties to computed values on all elements
    clones.forEach(function(slide){
      var all=slide.querySelectorAll('*');
      [slide].concat(Array.from(all)).forEach(function(el){
        var cs=getComputedStyle(el);
        var inlineStyle=el.style;
        // Resolve color properties that commonly use CSS vars
        ['color','backgroundColor','borderColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor'].forEach(function(prop){
          var val=cs[prop];
          if(val&&val!=='rgba(0, 0, 0, 0)'&&val!=='transparent'){
            inlineStyle[prop]=val;
          }
        });
        // Resolve font-family
        if(cs.fontFamily) inlineStyle.fontFamily=cs.fontFamily;
      });
    });

    // 2. Convert display:grid to display:flex with explicit child widths
    clones.forEach(function(slide){
      slide.querySelectorAll('*').forEach(function(el){
        var cs=getComputedStyle(el);
        if(cs.display==='grid'){
          var cols=cs.gridTemplateColumns.split(/\\s+/).length;
          el.style.display='flex';
          el.style.flexWrap='wrap';
          var gap=parseFloat(cs.gap)||0;
          var children=Array.from(el.children);
          var childWidth=cols>1?'calc('+(100/cols).toFixed(2)+'% - '+gap*(cols-1)/cols+'px)':'100%';
          children.forEach(function(ch){ch.style.width=childWidth;ch.style.minWidth=childWidth;ch.style.flexShrink='0'});
        }
      });
    });

    // 3. Bake opacity into color/backgroundColor so dom-to-pptx sees it
    //    Skip SVG child elements — they handle opacity via SVG attributes
    function applyOpacity(rgbaStr,opacity){
      var m=rgbaStr.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
      if(!m)return rgbaStr;
      var a=parseFloat(m[4]!=null?m[4]:'1')*opacity;
      return 'rgba('+m[1]+', '+m[2]+', '+m[3]+', '+a.toFixed(4)+')';
    }
    clones.forEach(function(slide){
      slide.querySelectorAll('*').forEach(function(el){
        if(el.closest('svg'))return;
        var cs=getComputedStyle(el);
        var op=parseFloat(cs.opacity);
        if(op>0&&op<1){
          var hasBg=cs.backgroundColor&&cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent';
          var hasColor=cs.color&&cs.color!=='transparent';
          if(hasColor) el.style.color=applyOpacity(cs.color,op);
          if(hasBg) el.style.backgroundColor=applyOpacity(cs.backgroundColor,op);
          // Propagate opacity to child SVGs so step 4 can bake it into the img
          var childSvgs=el.querySelectorAll('svg');
          if(childSvgs.length){
            childSvgs.forEach(function(s){
              var sOp=parseFloat(getComputedStyle(s).opacity)||1;
              s.style.opacity=String(sOp*op);
            });
          }
          el.style.opacity='1';
        }
      });
    });

    // 4. Convert inline SVGs to <img> data URIs for reliable PPTX rendering
    clones.forEach(function(slide){
      // Use Array.from to get a static list (replaceChild modifies live NodeList)
      Array.from(slide.querySelectorAll('svg')).forEach(function(svg){
        try{
          var cs=getComputedStyle(svg);
          // Resolve CSS vars in stroke/fill attributes before serialization
          function resolveVar(val){
            if(!val||val.indexOf('var(')===-1)return val;
            var tmp=document.createElement('div');
            tmp.style.color=val;
            document.body.appendChild(tmp);
            var resolved=getComputedStyle(tmp).color;
            document.body.removeChild(tmp);
            return resolved||val;
          }
          // Resolve on all descendant elements
          Array.from(svg.querySelectorAll('[stroke],[fill]')).forEach(function(el){
            ['stroke','fill'].forEach(function(attr){
              var val=el.getAttribute(attr);
              if(val)el.setAttribute(attr,resolveVar(val));
            });
          });
          // Also on the svg element itself
          ['stroke','fill'].forEach(function(attr){
            var val=svg.getAttribute(attr);
            if(val)svg.setAttribute(attr,resolveVar(val));
          });
          // Resolve currentColor
          var parentEl=svg.parentElement;
          var parentColor=(parentEl?getComputedStyle(parentEl).color:null)||'#000000';
          Array.from(svg.querySelectorAll('*')).forEach(function(el){
            ['stroke','fill'].forEach(function(attr){
              if(el.getAttribute(attr)==='currentColor')el.setAttribute(attr,parentColor);
            });
          });
          if(svg.getAttribute('stroke')==='currentColor')svg.setAttribute('stroke',parentColor);
          if(svg.getAttribute('fill')==='currentColor')svg.setAttribute('fill',parentColor);

          // Snapshot computed values BEFORE any DOM mutations
          var svgPos=cs.position;
          var svgTop=cs.top;
          var svgRight=cs.right;
          var svgBottom=cs.bottom;
          var svgLeft=cs.left;
          var svgZIndex=cs.zIndex;
          var svgOp=parseFloat(cs.opacity);
          var svgCsW=parseFloat(cs.width);
          var svgCsH=parseFloat(cs.height);

          // Use getBBox to get actual content bounds (respects overflow:visible)
          var bbox;
          try{bbox=svg.getBBox()}catch(e){bbox=null}
          var origW=parseFloat(svg.getAttribute('width'))||svgCsW||100;
          var origH=parseFloat(svg.getAttribute('height'))||svgCsH||100;

          // Compute viewBox from content bbox with padding for stroke-width
          var pad=4;
          var vx,vy,vw,vh;
          if(bbox&&(bbox.width>0||bbox.height>0)){
            vx=bbox.x-pad; vy=bbox.y-pad;
            vw=bbox.width+pad*2; vh=bbox.height+pad*2;
          }else{
            vx=0;vy=0;vw=origW;vh=origH;
          }
          svg.setAttribute('viewBox',vx+' '+vy+' '+vw+' '+vh);

          var scale=origW/vw;
          var imgW=vw*scale;
          var imgH=vh*scale;

          svg.setAttribute('width',String(vw));
          svg.setAttribute('height',String(vh));
          svg.setAttribute('xmlns','http://www.w3.org/2000/svg');

          var offsetX=(vx)*scale;
          var offsetY=(vy)*scale;

          // Bake opacity into individual SVG elements via stroke-opacity/fill-opacity
          // Clamp minimum to 0.15 — anything lower is invisible in PPTX rendering
          if(svgOp<1){
            var clampedOp=Math.max(svgOp,0.15);
            Array.from(svg.querySelectorAll('*')).concat([svg]).forEach(function(el){
              var stroke=el.getAttribute('stroke');
              if(stroke&&stroke!=='none'&&stroke!=='transparent'){
                var existing=parseFloat(el.getAttribute('stroke-opacity'))||1;
                el.setAttribute('stroke-opacity',String(existing*clampedOp));
              }
              var fill=el.getAttribute('fill');
              if(fill&&fill!=='none'&&fill!=='transparent'){
                var existingF=parseFloat(el.getAttribute('fill-opacity'))||1;
                el.setAttribute('fill-opacity',String(existingF*clampedOp));
              }
              var childOp=el.getAttribute('opacity');
              if(childOp){
                el.setAttribute('opacity',String(Math.max(parseFloat(childOp)*svgOp,0.15)));
              }
            });
          }

          // Remove style attribute (positioning is on the img, not in the SVG)
          svg.removeAttribute('style');

          var svgStr=new XMLSerializer().serializeToString(svg);
          var dataUri='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgStr);

          var img=document.createElement('img');
          img.src=dataUri;
          img.style.width=imgW+'px';
          img.style.height=imgH+'px';
          // Preserve positioning using snapshotted values
          if(svgPos==='absolute'){
            img.style.position='absolute';
            var origTop=parseFloat(svgTop);
            var origLeft=parseFloat(svgLeft);
            var origRight=svgRight;
            var origBottom=svgBottom;
            if(!isNaN(origTop)){
              img.style.top=(origTop+offsetY)+'px';
            }else if(origBottom&&origBottom!=='auto'){
              img.style.bottom=origBottom;
            }
            if(!isNaN(origLeft)){
              img.style.left=(origLeft+offsetX)+'px';
            }else if(origRight&&origRight!=='auto'){
              var rightVal=parseFloat(origRight);
              if(!isNaN(rightVal)){
                img.style.right=(rightVal-(imgW-origW)-offsetX)+'px';
              }else{
                img.style.right=origRight;
              }
            }
            img.style.zIndex=svgZIndex;
          }
          // Opacity already baked into stroke-opacity/fill-opacity inside SVG — don't double-apply

          svg.parentNode.replaceChild(img,svg);
        }catch(e){console.warn('SVG conversion failed:',e)}
      });
    });

    // 5. Strip backdrop-filter (unsupported)
    clones.forEach(function(slide){
      slide.querySelectorAll('*').forEach(function(el){
        el.style.backdropFilter='none';
        el.style.webkitBackdropFilter='none';
      });
    });

    return {clones:clones,wrapper:wrapper};
  }

  function doExport(){
    updateMeta('Restoring slides...');
    restoreHTML();
    var pages=document.querySelectorAll('.slide-page');
    if(!pages.length){btn.textContent='Download PPTX';btn.disabled=false;updateMeta(metaOrig);return}
    updateMeta('Preparing slides...');
    var prepared=prepareSlidesForPptx(pages);
    updateMeta('Converting to PPTX...');
    window.domToPptx.exportToPptx(prepared.clones,{skipDownload:true,autoEmbedFonts:true}).then(function(blob){
      var a=document.createElement('a');a.href=URL.createObjectURL(blob);
      a.download=(document.title.replace(/\\s*\\u2014\\s*Export$/,'')||'slides')+'.pptx';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }).catch(function(e){alert('PPTX export failed: '+e.message)})
    .finally(function(){
      if(prepared.wrapper.parentNode)prepared.wrapper.parentNode.removeChild(prepared.wrapper);
      btn.textContent='Download PPTX';btn.disabled=false;updateMeta(metaOrig);
    });
  }

  if(pptxLoaded){doExport();return}
  updateMeta('Loading PPTX library...');
  var s=document.createElement('script');
  s.src='/vendor/dom-to-pptx.bundle.js';
  s.onload=function(){pptxLoaded=true;doExport()};
  s.onerror=function(){btn.textContent='Download PPTX';btn.disabled=false;updateMeta(metaOrig);alert('Failed to load PPTX library')};
  document.head.appendChild(s);
}
<\/script>`;

    const imageModeScript = opts.inline
      ? ""
      : `\n<script src="/vendor/snapdom.js"><\/script>
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
    try{
      var result=await snapdom(page,{scale:2,embedFonts:true});
      var png=await result.toPng();
      page.innerHTML='';
      png.style.cssText='width:100%;height:100%;display:block';
      page.appendChild(png);
    }catch(e){
      console.warn('Slide '+(i+1)+' capture failed:',e.message);
    }
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
  ${getDeployCSS()}
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
${slidePages}${downloadScript}${pptxScript}${imageModeScript}${opts.inline ? "" : `\n<script>
function collectDeployFiles(logEl){
  deployLog(logEl, "Building slide player...", "info");
  var qs = new URLSearchParams(location.search).get("contentSet") || "";
  var dlQs = qs ? "?contentSet=" + encodeURIComponent(qs) : "";
  return fetch("/export/slides/player" + dlQs).then(function(r){ return r.text(); }).then(function(html){
    deployLog(logEl, "  + index.html (player)");
    return [{ path: "index.html", content: html }];
  });
}
${getDeployScript().replace(/<\/script>/gi, "<\\/script>")}
<\/script>`}
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

  // ── Slide player (for deploy) ────────────────────────────────────────

  function buildSlidePlayerHtml(opts: { contentSet?: string }): { html: string; title: string } | { error: string; status: number } {
    // Reuse the same manifest/baseDir resolution as buildExportHtml
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
    if (!existsSync(manifestPath)) return { error: "No manifest.json found", status: 404 };
    let manifest: { title: string; slides: { file: string; title: string }[] };
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf-8")); } catch { return { error: "Failed to parse manifest.json", status: 500 }; }
    if (!manifest.slides?.length) return { error: "No slides", status: 404 };

    const W = (options.initParams?.slideWidth as number) || 1280;
    const H = (options.initParams?.slideHeight as number) || 720;
    const title = manifest.title || "Slides";

    // Read theme CSS
    const themePath = join(baseDir, "theme.css");
    let themeCSS = existsSync(themePath) ? readFileSync(themePath, "utf-8") : "";
    if (themeCSS) {
      const globals: string[] = [];
      let scoped = themeCSS.replace(/@import\s+url\([^)]*\)\s*;|@import\s+[^;]+;/g, (m) => { globals.push(m); return ""; });
      scoped = scoped.replace(/:root\s*\{[^}]*\}/g, (m) => { globals.push(m); return ""; });
      themeCSS = globals.join("\n") + "\n.slide-page {\n" + scoped + "\n}";
    }

    // Read head resources + slide bodies
    const headResourceSet = new Set<string>();
    const slides = manifest.slides.map((slide, i) => {
      const slidePath = join(baseDir, slide.file);
      let html = existsSync(slidePath) ? readFileSync(slidePath, "utf-8") : `<p>Missing: ${slide.file}</p>`;
      if (html.includes("<!DOCTYPE") || html.includes("<html")) {
        const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
        if (headMatch) {
          const re = /<(link\b[^>]*(?:\/>|>)|script\b[^>]*>[\s\S]*?<\/script>|style\b[^>]*>[\s\S]*?<\/style>)/gi;
          let m;
          while ((m = re.exec(headMatch[1])) !== null) {
            const tag = m[0].trim();
            if (/<link\b/i.test(tag) && !/rel\s*=\s*["']stylesheet["']/i.test(tag) && !/\.css/i.test(tag)) continue;
            headResourceSet.add(tag);
          }
        }
        let bodyStyle = "", bodyClass = "";
        const bodyTagMatch = html.match(/<body([^>]*)>/i);
        if (bodyTagMatch) {
          const attrs = bodyTagMatch[1];
          const sm = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
          if (sm) bodyStyle = sm[1];
          const cm = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
          if (cm) bodyClass = cm[1];
        }
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        html = bodyMatch ? bodyMatch[1].trim() : html.replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<\/?html[^>]*>/gi, "").replace(/<head[\s\S]*?<\/head>/gi, "").replace(/<\/?body[^>]*>/gi, "").trim();
        return { body: html, style: bodyStyle, cls: bodyClass, title: slide.title || `Slide ${i + 1}` };
      }
      return { body: html, style: "", cls: "", title: slide.title || `Slide ${i + 1}` };
    });

    const headResources = Array.from(headResourceSet).join("\n");
    const totalSlides = slides.length;
    const outlineMiniScale = 120 / W;

    // Inline assets for standalone page
    const thumbScale = 130 / W;
    let playerHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${headResources}
<style>
${themeCSS}

:root {
  --color-bg: #09090b;
  --color-surface: #18181b;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-fg: #fafafa;
  --color-muted: #a1a1aa;
  --color-primary: #f97316;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; background: var(--color-bg); color: var(--color-fg); font-family: 'Inter', system-ui, -apple-system, sans-serif; }

/* Layout */
.player-root { display: flex; height: 100%; }
.player-root.outline-hidden .outline { display: none; }

/* Outline */
.outline { width: 200px; flex-shrink: 0; background: var(--color-surface); border-right: 1px solid var(--color-border); overflow-y: auto; overflow-x: hidden; }
.outline-list { display: flex; flex-direction: column; gap: 6px; padding: 12px; }
.outline-item { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 8px; cursor: pointer; border: 2px solid transparent; transition: all 0.15s; flex-shrink: 0; }
.outline-item:hover { background: rgba(255,255,255,0.03); }
.outline-item.active { border-color: var(--color-primary); background: rgba(249,115,22,0.05); }
.outline-num { font-size: 11px; font-weight: 600; color: var(--color-muted); min-width: 20px; text-align: center; flex-shrink: 0; }
.outline-item.active .outline-num { color: var(--color-primary); }
.mini { width: 130px; aspect-ratio: ${W} / ${H}; overflow: hidden; border-radius: 4px; background: var(--color-bg, #000); flex-shrink: 0; pointer-events: none; }
.mini-inner { width: ${W}px; height: ${H}px; transform: scale(${thumbScale}); transform-origin: top left; overflow: hidden; isolation: isolate; }

/* Stage */
.stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; min-width: 0; }
.slide-frame { position: relative; width: ${W}px; height: ${H}px; transform-origin: center center; }
#frame .slide-page { position: absolute; inset: 0; width: ${W}px; height: ${H}px; overflow: hidden; isolation: isolate; display: none; border-radius: 8px; box-shadow: 0 12px 48px rgba(0,0,0,0.6); }
#frame .slide-page.active { display: block; }

/* Bottom bar — auto-hide */
.bottom-bar { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: rgba(24,24,27,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--color-border); border-radius: 999px; z-index: 10; transition: opacity 0.3s, visibility 0.3s; }
.bottom-bar.hidden { opacity: 0; visibility: hidden; }
.bar-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 999px; background: transparent; color: var(--color-muted); cursor: pointer; transition: all 0.15s; }
.bar-btn:hover { color: var(--color-fg); background: rgba(255,255,255,0.08); }
.bar-btn.active { color: var(--color-primary); background: rgba(249,115,22,0.12); }
.bar-counter { font-size: 12px; color: var(--color-muted); min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
.bar-divider { width: 1px; height: 16px; background: rgba(255,255,255,0.1); }
.zoom-label { font-size: 11px; color: var(--color-muted); min-width: 36px; text-align: center; cursor: pointer; }
.zoom-label:hover { color: var(--color-fg); }
</style>
</head>
<body>
<div class="player-root outline-left" id="root">
  <div class="outline" id="outline">
    <div class="outline-list">
${slides.map((s, i) => `      <div class="outline-item${i === 0 ? " active" : ""}" onclick="go(${i})">
        <span class="outline-num">${i + 1}</span>
        <div class="mini"><div class="mini-inner slide-page${s.cls ? " " + s.cls : ""}"${s.style ? ` style="${s.style}"` : ""}>${s.body}</div></div>
      </div>`).join("\n")}
    </div>
  </div>
  <div class="stage" id="stage">
    <div class="slide-frame" id="frame">
${slides.map((s, i) => `      <div class="slide-page${i === 0 ? " active" : ""}${s.cls ? " " + s.cls : ""}"${s.style ? ` style="${s.style}"` : ""}>${s.body}</div>`).join("\n")}
    </div>
    <div class="bottom-bar" id="bar">
      <button class="bar-btn" onclick="go(cur-1)" title="Previous"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>
      <span class="bar-counter" id="counter">1 / ${totalSlides}</span>
      <button class="bar-btn" onclick="go(cur+1)" title="Next"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>
      <div class="bar-divider"></div>
      <button class="bar-btn" onclick="zoomOut()" title="Zoom out"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      <span class="zoom-label" id="zoom-label" onclick="zoomFit()" title="Click to fit">Fit</span>
      <button class="bar-btn" onclick="zoomIn()" title="Zoom in"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      <div class="bar-divider"></div>
      <button class="bar-btn" id="ol-left" onclick="setOL('left')" title="Outline"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></button>
      <button class="bar-btn" id="ol-hidden" onclick="setOL('hidden')" title="Hide outline"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></button>
    </div>
  </div>
</div>
<script>
var cur=0,total=${totalSlides},W=${W},H=${H};
var _slides=document.querySelectorAll("#frame .slide-page");
var thumbs=document.querySelectorAll(".outline-item");
var _zoomMode="fit"; // "fit" or number (percentage/100)
var _zoomScale=1;

function go(i){
  if(i<0||i>=total)return;
  _slides[cur].classList.remove("active");
  cur=i;
  _slides[cur].classList.add("active");
  document.getElementById("counter").textContent=(cur+1)+" / "+total;
  thumbs.forEach(function(t,j){t.classList.toggle("active",j===i)});
  thumbs[i].scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"});
}

function calcFitScale(){
  var stage=document.getElementById("stage");
  var sw=stage.clientWidth-48,sh=stage.clientHeight-48;
  return Math.min(sw/W,sh/H);
}

function applyZoom(){
  var scale=_zoomMode==="fit"?calcFitScale():_zoomMode;
  _zoomScale=scale;
  document.getElementById("frame").style.transform="scale("+scale+")";
  document.getElementById("zoom-label").textContent=_zoomMode==="fit"?"Fit":Math.round(scale*100)+"%";
}

function zoomFit(){ _zoomMode="fit"; applyZoom(); }
function zoomIn(){
  var s=_zoomMode==="fit"?calcFitScale():_zoomMode;
  var steps=[0.5,0.75,1,1.25,1.5,2];
  for(var j=0;j<steps.length;j++){if(steps[j]>s+0.01){_zoomMode=steps[j];applyZoom();return;}}
}
function zoomOut(){
  var s=_zoomMode==="fit"?calcFitScale():_zoomMode;
  var steps=[0.5,0.75,1,1.25,1.5,2];
  for(var j=steps.length-1;j>=0;j--){if(steps[j]<s-0.01){_zoomMode=steps[j];applyZoom();return;}}
}

function setOL(pos){
  var root=document.getElementById("root");
  root.className="player-root outline-"+pos;
  localStorage.setItem("slide-ol",pos);
  ["left","hidden"].forEach(function(p){
    var b=document.getElementById("ol-"+p);
    if(b)b.classList.toggle("active",p===pos);
  });
  setTimeout(applyZoom,50);
}

// Bar auto-hide
var _barTimer=null;
function showBar(){
  var bar=document.getElementById("bar");
  bar.classList.remove("hidden");
  clearTimeout(_barTimer);
  _barTimer=setTimeout(function(){bar.classList.add("hidden")},2500);
}
document.addEventListener("mousemove",showBar);

// Init
var savedOL=localStorage.getItem("slide-ol")||"left";
setOL(savedOL);
applyZoom();
showBar();
window.addEventListener("resize",function(){if(_zoomMode==="fit")applyZoom()});

document.addEventListener("keydown",function(e){
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA")return;
  if(e.key==="ArrowRight"||e.key==="ArrowDown"){e.preventDefault();go(cur+1)}
  if(e.key==="ArrowLeft"||e.key==="ArrowUp"){e.preventDefault();go(cur-1)}
  if(e.key==="Home"){e.preventDefault();go(0)}
  if(e.key==="End"){e.preventDefault();go(total-1)}
});
</script>
</body>
</html>`;

    playerHtml = inlineAssets(playerHtml, baseDir);
    return { html: playerHtml, title };
  }

  app.get("/export/slides/player", (c) => {
    const contentSet = c.req.query("contentSet") || undefined;
    const result = buildSlidePlayerHtml({ contentSet });
    if ("error" in result) return c.text(result.error, result.status as any);
    return c.html(result.html);
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
      ${getDeployToolbarHTML()}
    </div>
  </div>
</div>
${getDeployModalHTML()}`;

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

// --- Webcraft-specific file collection for deploy ---
function collectDeployFiles(logEl){
  var qs = new URLSearchParams(location.search);
  var contentSet = qs.get("contentSet") || "";
  deployLog(logEl, "Collecting pages...", "info");

  var filePromises = pages.map(function(page){
    var dlQs = contentSet ? "?contentSet=" + encodeURIComponent(contentSet) + "&page=" + encodeURIComponent(page.file) : "?page=" + encodeURIComponent(page.file);
    return fetch("/export/webcraft/download" + dlQs).then(function(r){ return r.text(); }).then(function(html){
      var dir = contentSet || "pages";
      deployLog(logEl, "  + " + dir + "/" + page.file);
      return { path: dir + "/" + page.file, content: html };
    });
  });

  return Promise.all(filePromises).then(function(pageFileList){
    deployLog(logEl, "Generating index page...", "info");
    var indexHtml = buildAggregationPage(pageFileList);
    return [{ path: "index.html", content: indexHtml }].concat(pageFileList);
  });
}

function buildAggregationPage(pageFiles){
  var cards = pageFiles.map(function(f){
    var name = f.path.split("/").pop().replace(/\\.html$/i, "");
    var title = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");
    return '<a href="' + f.path + '" class="agg-card"><div class="agg-card-title">' + title + '<\\/div><\\/a>';
  }).join("\\n");

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + (document.title || "WebCraft") + '<\\/title><style>'
    + 'body{margin:0;background:#09090b;color:#fff;font-family:system-ui,-apple-system,sans-serif;padding:40px;}'
    + '.agg-header{margin-bottom:32px;}'
    + '.agg-header h1{font-size:28px;font-weight:700;margin:0 0 8px;}'
    + '.agg-header p{color:#a1a1aa;font-size:14px;margin:0;}'
    + '.agg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;}'
    + '.agg-card{display:block;padding:24px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);text-decoration:none;color:#fff;transition:all 0.15s;}'
    + '.agg-card:hover{background:rgba(255,255,255,0.08);border-color:rgba(249,115,22,0.3);}'
    + '.agg-card-title{font-size:15px;font-weight:500;}'
    + '<\\/style><\\/head><body>'
    + '<div class="agg-header"><h1>' + (document.title || "WebCraft") + '<\\/h1><p>' + pageFiles.length + ' page' + (pageFiles.length > 1 ? 's' : '') + '<\\/p><\\/div>'
    + '<div class="agg-grid">' + cards + '<\\/div>'
    + '<\\/body><\\/html>';
}

${getDeployScript().replace(/<\/script>/gi, "<\\/script>")}
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

  ${getDeployCSS()}

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

  app.get("/vendor/dom-to-pptx.bundle.js", async (c) => {
    const f = Bun.file(join(import.meta.dir, "..", "..", "vendor", "dom-to-pptx.bundle.js"));
    if (!(await f.exists())) return c.text("dom-to-pptx not found", 404);
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

  // ── Remotion export ──────────────────────────────────────────────────

  /** Collect all public/ assets as data URIs for embedding in export HTML. */
  function collectPublicAssets(): Record<string, string> {
    const publicDir = join(workspace, "public");
    if (!existsSync(publicDir)) return {};
    const assets: Record<string, string> = {};
    const scanDir = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          scanDir(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
        } else {
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          const dataUri = readAsDataUri(`public/${relPath}`);
          if (dataUri) assets[relPath] = dataUri;
        }
      }
    };
    try { scanDir(publicDir, ""); } catch { /* ignore */ }
    return assets;
  }

  /** Read and transpile all src/*.tsx files for Remotion export. */
  function collectRemotionSources(): { path: string; content: string }[] | { error: string; status: number } {
    const srcDir = join(workspace, "src");
    if (!existsSync(srcDir)) return { error: "No src/ directory found", status: 404 };
    const rootPath = join(srcDir, "Root.tsx");
    if (!existsSync(rootPath)) return { error: "No src/Root.tsx found", status: 404 };

    const transpiler = new Bun.Transpiler({
      loader: "tsx",
      tsconfig: JSON.stringify({ compilerOptions: { jsx: "react" } }),
    });
    const files: { path: string; content: string }[] = [];

    const scanSrc = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          scanSrc(join(dir, entry.name), `${prefix}${entry.name}/`);
        } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\bindex\.(tsx?|jsx?)$/.test(entry.name)) {
          const relPath = `src/${prefix}${entry.name}`;
          const source = readFileSync(join(dir, entry.name), "utf-8");
          try {
            files.push({ path: relPath, content: transpiler.transformSync(source) });
          } catch {
            files.push({ path: relPath, content: source });
          }
        }
      }
    };
    try { scanSrc(srcDir, ""); } catch { /* ignore */ }
    return files;
  }

  // Client-side module linker + React app (uses String.raw to preserve regex backslashes)
  const REMOTION_CLIENT_JS = String.raw`
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as remotionModules from 'remotion';
import * as jsxRuntime from 'react/jsx-runtime';
import { Player } from '@remotion/player';

const FILES = JSON.parse(document.getElementById('__remotion-files').textContent);
const COMPOSITIONS = JSON.parse(document.getElementById('__remotion-compositions').textContent);
const ASSETS = JSON.parse(document.getElementById('__remotion-assets').textContent);
const IS_STANDALONE = document.documentElement.dataset.standalone === '1';
const URL_COMPOSITION = document.documentElement.dataset.composition || new URLSearchParams(location.search).get('composition');

// ── Module Linker (adapted from remotion-compiler.ts) ──

function parseImports(source) {
  const imports = [];
  const re = /import\s+(?:(\*\s+as\s+(\w+))|(?:\{([^}]+)\})|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const src = m[6], specifiers = [];
    let isDefault = false;
    if (m[1]) specifiers.push({ imported: '*', local: m[2] });
    if (m[3]) for (const s of m[3].split(',')) {
      const p = s.trim().split(/\s+as\s+/);
      if (p[0]) specifiers.push({ imported: p[0].trim(), local: (p[1] || p[0]).trim() });
    }
    if (m[4]) { specifiers.push({ imported: 'default', local: m[4] }); isDefault = true; }
    if (m[5]) for (const s of m[5].split(',')) {
      const p = s.trim().split(/\s+as\s+/);
      if (p[0]) specifiers.push({ imported: p[0].trim(), local: (p[1] || p[0]).trim() });
    }
    imports.push({ source: src, specifiers, isDefault });
  }
  return imports;
}

function rewriteForEval(source) {
  let code = source;
  code = code.replace(/import\s+(?:[\s\S]*?)\s+from\s+["'][^"']+["'];?\n?/g, '');
  code = code.replace(/import\s+type\s+[\s\S]*?from\s+["'][^"']+["'];?\n?/g, '');
  code = code.replace(/export\s+const\s+(\w+)/g, '__exports.$1');
  code = code.replace(/export\s+function\s+(\w+)/g, '__exports.$1 = function $1');
  code = code.replace(/export\s+class\s+(\w+)/g, '__exports.$1 = class $1');
  code = code.replace(/export\s+default\s+/g, '__exports.default = ');
  code = code.replace(/export\s+\{([^}]+)\};?/g, (_, names) =>
    names.split(',').map(n => {
      const p = n.trim().split(/\s+as\s+/);
      const local = p[0]?.trim(), exported = (p[1] || p[0])?.trim();
      return local && exported ? '__exports.' + exported + ' = ' + local + ';' : '';
    }).join('\n')
  );
  return code;
}

function resolveLocalPath(from, importPath, available) {
  const dir = from.includes('/') ? from.substring(0, from.lastIndexOf('/')) : '.';
  const base = importPath.startsWith('./') ? dir + '/' + importPath.slice(2) : importPath;
  for (const c of [base, base+'.tsx', base+'.ts', base+'.jsx', base+'.js', base+'/index.tsx', base+'/index.ts']) {
    if (available.has(c)) return c;
  }
  return null;
}

function resolveImportOrder(files) {
  const srcFiles = files.filter(f => /\.(tsx?|jsx?)$/.test(f.path));
  const available = new Set(srcFiles.map(f => f.path));
  const fileMap = new Map(srcFiles.map(f => [f.path, f]));
  const deps = new Map();
  for (const file of srcFiles) {
    const localDeps = new Set();
    for (const imp of parseImports(file.content)) {
      if (imp.source.startsWith('.')) {
        const resolved = resolveLocalPath(file.path, imp.source, available);
        if (resolved) localDeps.add(resolved);
      }
    }
    deps.set(file.path, localDeps);
  }
  const sorted = [], visited = new Set(), visiting = new Set();
  function visit(path) {
    if (visited.has(path) || visiting.has(path)) return;
    visiting.add(path);
    for (const dep of deps.get(path) ?? []) visit(dep);
    visiting.delete(path);
    visited.add(path);
    const file = fileMap.get(path);
    if (file) sorted.push(file);
  }
  for (const file of srcFiles) visit(file.path);
  return sorted;
}

function compileModule(source, filename, externalModules, localModules) {
  const imports = parseImports(source);
  const preamble = [];
  for (const imp of imports) {
    const isLocal = imp.source.startsWith('.');
    let moduleObj;
    if (isLocal) {
      const key = Object.keys(localModules || {}).find(k =>
        k === imp.source || k.endsWith('/' + imp.source.replace('./', '')) ||
        k.endsWith('/' + imp.source.replace('./', '') + '.tsx') ||
        k.endsWith('/' + imp.source.replace('./', '') + '.ts')
      );
      if (!key || !localModules[key]) throw new Error('[' + filename + '] Cannot resolve "' + imp.source + '"');
      moduleObj = '__local_' + imp.source.replace(/[^a-zA-Z0-9]/g, '_');
      preamble.push('var ' + moduleObj + ' = __localModules["' + key + '"];');
    } else if (imp.source in (externalModules || {})) {
      moduleObj = '__ext_' + imp.source.replace(/[^a-zA-Z0-9]/g, '_');
      preamble.push('var ' + moduleObj + ' = __externalModules["' + imp.source + '"];');
    } else {
      throw new Error('[' + filename + '] Unknown import "' + imp.source + '"');
    }
    for (const spec of imp.specifiers) {
      if (spec.imported === '*') preamble.push('var ' + spec.local + ' = ' + moduleObj + ';');
      else if (spec.imported === 'default') preamble.push('var ' + spec.local + ' = ' + moduleObj + '.default ?? ' + moduleObj + ';');
      else preamble.push('var ' + spec.local + ' = ' + moduleObj + '["' + spec.imported + '"];');
    }
  }
  const rewritten = rewriteForEval(source);
  if (externalModules['react'] && !preamble.some(p => p.includes('var React')))
    preamble.unshift('var React = __externalModules["react"];');
  const fullCode = preamble.join('\n') + '\nvar __exports = {};\n' + rewritten + '\nreturn __exports;';
  try {
    return new Function('__externalModules', '__localModules', fullCode)(externalModules, localModules || {});
  } catch (err) {
    throw new Error('[' + filename + '] Runtime error: ' + err.message);
  }
}

function buildModuleMap(files, externalModules) {
  const ordered = resolveImportOrder(files);
  const moduleMap = new Map(), localLookup = {};
  for (const file of ordered) {
    try {
      const exports = compileModule(file.content, file.path, externalModules, localLookup);
      moduleMap.set(file.path, exports);
      localLookup[file.path] = exports;
      localLookup['./' + file.path] = exports;
      const noExt = file.path.replace(/\.(tsx?|jsx?)$/, '');
      localLookup[noExt] = exports;
      localLookup['./' + noExt] = exports;
    } catch (err) {
      moduleMap.set(file.path, { __error: err.message });
    }
  }
  return moduleMap;
}

// ── Compile compositions ──

const patchedRemotion = { ...remotionModules, staticFile: (p) => ASSETS[p.replace(/^\//, '')] || p };
const externalModules = { remotion: patchedRemotion, react: React, 'react/jsx-runtime': jsxRuntime };
const moduleMap = buildModuleMap(FILES, externalModules);
const COMPONENTS = new Map();
const compileErrors = [];

for (const [path, exports] of moduleMap) {
  if (exports.__error) compileErrors.push({ file: path, message: exports.__error });
}
for (const comp of COMPOSITIONS) {
  for (const [, exports] of moduleMap) {
    if (exports[comp.componentName] && typeof exports[comp.componentName] === 'function') {
      COMPONENTS.set(comp.componentName, exports[comp.componentName]);
      break;
    }
  }
}

// ── React App ──

const h = React.createElement;

// Custom dropdown to replace native <select>
function Dropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const label = options.find(o => o.value === value)?.label || value;

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return h('div', { ref, className: 'dropdown', style: { position: 'relative' } },
    h('button', {
      className: 'dropdown-trigger',
      onClick: () => setOpen(!open),
    }, label, h('svg', { width: 10, height: 6, viewBox: '0 0 10 6', style: { marginLeft: 6, opacity: 0.5 } },
      h('path', { d: 'M1 1l4 4 4-4', stroke: 'currentColor', strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' }))),
    open && h('div', { className: 'dropdown-menu' },
      ...options.map(o => h('button', {
        key: o.value, className: 'dropdown-item' + (o.value === value ? ' active' : ''),
        onClick: () => { onChange(o.value); setOpen(false); },
      }, o.label))
    )
  );
}

function ExportApp() {
  // If a specific composition was requested via ?composition=, filter to it
  const filteredComps = URL_COMPOSITION
    ? COMPOSITIONS.filter(c => c.id === URL_COMPOSITION)
    : COMPOSITIONS;
  const activeComps = filteredComps.length > 0 ? filteredComps : COMPOSITIONS;

  const [activeId, setActiveId] = useState(activeComps[0]?.id);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState(null);
  const [format, setFormat] = useState('mp4');
  const [quality, setQuality] = useState('high');
  const playerRef = useRef(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);

  const comp = activeComps.find(c => c.id === activeId) || activeComps[0];
  const Component = comp ? COMPONENTS.get(comp.componentName) : null;

  // Player event listeners
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = () => setFrame(p.getCurrentFrame());
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    return () => { p.removeEventListener('frameupdate', onFrame); p.removeEventListener('play', onPlay); p.removeEventListener('pause', onPause); };
  }, [Component]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const p = playerRef.current;
      if (!p || e.target.tagName === 'SELECT') return;
      if (e.key === ' ') { e.preventDefault(); p.toggle(); }
      if (e.key === 'ArrowLeft') p.seekTo(Math.max(0, p.getCurrentFrame() - (e.shiftKey ? 10 : 1)));
      if (e.key === 'ArrowRight') p.seekTo(Math.min((comp?.durationInFrames || 1) - 1, p.getCurrentFrame() + (e.shiftKey ? 10 : 1)));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [comp]);

  const CODEC_MAP = { mp4: 'h264', webm: 'vp8' };

  const handleExport = useCallback(async () => {
    if (!comp || !Component || exporting) return;
    setExporting(true); setProgress(0); setExportError(null);
    try {
      const { renderMediaOnWeb } = await import('@remotion/web-renderer');
      const result = await renderMediaOnWeb({
        composition: {
          component: Component, id: comp.id,
          width: comp.width, height: comp.height,
          fps: comp.fps, durationInFrames: comp.durationInFrames,
        },
        container: format,
        videoCodec: CODEC_MAP[format] || 'h264',
        videoBitrate: quality,
        onProgress: (p) => setProgress(p.progress),
      });
      const blob = await result.getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = comp.id + '.' + format; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }, [comp, Component, exporting, format, quality]);

  if (compileErrors.length > 0) {
    return h('div', { className: 'error-page' },
      h('h2', null, 'Compilation Errors'),
      ...compileErrors.map((e, i) => h('pre', { key: i, className: 'error-block' }, e.file + ': ' + e.message))
    );
  }
  if (!comp || !Component) {
    return h('div', { className: 'empty-page' }, 'No compositions found');
  }

  const duration = (comp.durationInFrames / comp.fps).toFixed(1);
  const lastFrame = Math.max(1, comp.durationInFrames - 1);
  const progressPct = (frame / lastFrame) * 100;
  const timeSec = (frame / comp.fps).toFixed(1);

  return h('div', { className: 'export-root' },
    // Toolbar — hidden in standalone (downloaded HTML)
    !IS_STANDALONE && h('div', { className: 'export-toolbar-wrapper' },
      h('div', { className: 'export-toolbar' },
        h('div', { className: 'header-left' },
          h('h1', null, comp.id),
          h('span', { className: 'meta' },
            comp.width + '\u00d7' + comp.height + ' \u00b7 ' + comp.fps + 'fps \u00b7 ' + duration + 's')
        ),
        activeComps.length > 1 && h('div', { className: 'comp-selector' },
          ...activeComps.map(c => h('button', {
            key: c.id, className: 'comp-btn' + (c.id === activeId ? ' active' : ''),
            onClick: () => setActiveId(c.id),
          }, c.id))
        ),
        h('div', { className: 'export-toolbar-actions' },
          h(Dropdown, { value: format, onChange: setFormat, options: [
            { value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' },
          ]}),
          h(Dropdown, { value: quality, onChange: setQuality, options: [
            { value: 'very-high', label: 'Very High' }, { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
          ]}),
          h('button', { className: 'btn-primary', onClick: handleExport, disabled: exporting },
            exporting ? 'Exporting ' + Math.round(progress * 100) + '%' : 'Export ' + format.toUpperCase()),
          h('button', { className: 'btn-secondary',
            onClick: () => window.open('/export/remotion/download' + (URL_COMPOSITION ? '?composition=' + encodeURIComponent(URL_COMPOSITION) : ''), '_blank') }, 'Download HTML'),
          h('div', { className: 'print-divider' }),
          h('div', { className: 'deploy-dropdown-wrap', id: 'deploy-wrap' },
            h('button', { className: 'btn-deploy-trigger', id: 'deploy-trigger-btn', onClick: () => window.toggleDeployMenu && window.toggleDeployMenu(), disabled: !(window._deployStatuses?.vercel?.available || window._deployStatuses?.["cf-pages"]?.available), title: 'Deploy' },
              h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                h('path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }),
                h('path', { d: 'M12 13v6' }),
                h('path', { d: 'm9 17 3-3 3 3' }))),
            h('div', { className: 'deploy-dropdown', id: 'deploy-dropdown', style: { display: 'none' } },
              h('button', { className: 'deploy-dropdown-item', onClick: () => { window.closeDeployMenu && window.closeDeployMenu(); window.openDeploy && window.openDeploy("vercel"); } },
                h('svg', { width: 14, height: 14, viewBox: '0 0 76 65', fill: 'currentColor' },
                  h('path', { d: 'M37.5274 0L75.0548 65H0L37.5274 0Z' })),
                h('span', { id: 'vercel-label' }, 'Vercel')),
              h('button', { className: 'deploy-dropdown-item', onClick: () => { window.closeDeployMenu && window.closeDeployMenu(); window.openDeploy && window.openDeploy("cf-pages"); } },
                h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  h('circle', { cx: 12, cy: 12, r: 10 }),
                  h('path', { d: 'M2 12h20' }),
                  h('path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' })),
                h('span', { id: 'cf-pages-label' }, 'Cloudflare Pages')))),
        )
      )
    ),
    // Error banner
    !IS_STANDALONE && exportError && h('div', { className: 'export-error-banner' }, exportError),
    // Player area
    h('div', { className: 'player-wrapper' },
      h('div', { className: 'player-canvas', style: { aspectRatio: comp.width + ' / ' + comp.height } },
        h(Player, {
          ref: playerRef,
          component: Component,
          compositionWidth: comp.width, compositionHeight: comp.height,
          durationInFrames: comp.durationInFrames, fps: comp.fps,
          autoPlay: true, controls: false, loop: true, acknowledgeRemotionLicense: true,
          style: { width: '100%', height: '100%' },
        })
      ),
      // Custom playback controls
      h('div', { className: 'playback-bar' },
        // Timeline
        h('div', { className: 'timeline', onClick: (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          playerRef.current?.seekTo(Math.round(ratio * lastFrame));
        }},
          h('div', { className: 'timeline-fill', style: { width: progressPct + '%' } }),
          h('div', { className: 'timeline-thumb', style: { left: progressPct + '%' } }),
        ),
        // Controls row
        h('div', { className: 'controls-row' },
          h('button', { className: 'ctrl-btn', onClick: () => playerRef.current?.toggle() },
            playing
              ? h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor' },
                  h('rect', { x: 3, y: 2, width: 3.5, height: 12, rx: 1 }),
                  h('rect', { x: 9.5, y: 2, width: 3.5, height: 12, rx: 1 }))
              : h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor' },
                  h('path', { d: 'M4 2.5v11l9-5.5z' }))
          ),
          h('span', { className: 'time-display' }, timeSec + 's / ' + duration + 's'),
          h('div', { style: { flex: 1 } }),
          h('button', { className: 'ctrl-btn', onClick: () => playerRef.current?.requestFullscreen(), title: 'Fullscreen' },
            h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
              h('path', { d: 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4' }))
          ),
        )
      )
    ),
  );
}

createRoot(document.getElementById('root')).render(h(ExportApp));
`;

  function buildRemotionExportHtml(opts: { inline: boolean; composition?: string }): { html: string; title: string } | { error: string; status: number } {
    // 1. Read and parse compositions
    const rootPath = join(workspace, "src", "Root.tsx");
    if (!existsSync(rootPath)) return { error: "No src/Root.tsx found in workspace", status: 404 };
    const rootSource = readFileSync(rootPath, "utf-8");
    const compositions = parseCompositions(rootSource);
    if (!compositions.length) return { error: "No <Composition> declarations found in Root.tsx", status: 404 };

    // 2. Read and transpile source files
    const sourcesResult = collectRemotionSources();
    if ("error" in sourcesResult) return sourcesResult;
    const files = sourcesResult;

    // 3. Collect public assets as data URIs
    const assets = collectPublicAssets();

    // 4. Build HTML
    const title = opts.composition
      ? (compositions.find((c) => c.id === opts.composition)?.id ?? compositions[0].id)
      : compositions[0].id;
    const htmlTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escape = (s: string) => s.replace(/<\/script>/gi, "<\\/script>");
    const filesJson = escape(JSON.stringify(files));
    const compositionsJson = escape(JSON.stringify(compositions));
    const assetsJson = escape(JSON.stringify(assets));

    const importmap = JSON.stringify({
      imports: {
        "react": "https://esm.sh/react@19",
        "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
        "react-dom": "https://esm.sh/react-dom@19?external=react",
        "react-dom/client": "https://esm.sh/react-dom@19/client?external=react",
        "remotion": "https://esm.sh/remotion@4.0.438?external=react",
        "remotion/no-react": "https://esm.sh/remotion@4.0.438/no-react?external=react",
        "remotion/version": "https://esm.sh/remotion@4.0.438/version",
        "@remotion/player": "https://esm.sh/@remotion/player@4.0.438?external=react,react-dom,remotion",
        "@remotion/web-renderer": "https://esm.sh/@remotion/web-renderer@4.0.438?external=react,remotion",
      },
    });

    const html = `<!DOCTYPE html>
<html${opts.inline ? ' data-standalone="1"' : ""}${opts.composition ? ` data-composition="${opts.composition.replace(/"/g, "&quot;")}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlTitle} \u2014 Remotion Export</title>
<script type="importmap">${importmap}<\/script>
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
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: var(--color-cc-bg); font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
#root { height: 100%; }
.export-root {
  display: flex; flex-direction: column; height: 100vh;
  background: radial-gradient(circle at 50% 0%, rgba(249,115,22,0.08) 0%, transparent 60%);
}
.export-toolbar-wrapper {
  position: sticky; top: 0; z-index: 100;
  padding: 16px 24px 0; pointer-events: none;
}
.export-toolbar {
  pointer-events: auto;
  display: flex; align-items: center; justify-content: center; gap: 16px;
  padding: 10px 20px;
  background: var(--color-cc-card);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-cc-border);
  border-radius: 999px;
  color: var(--color-cc-fg);
  max-width: 900px; margin: 0 auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
.header-left { display: flex; align-items: baseline; gap: 10px; margin-right: auto; }
.export-toolbar h1 { font-size: 15px; font-weight: 500; margin: 0; letter-spacing: -0.01em; }
.export-toolbar .meta { font-size: 13px; color: var(--color-cc-muted); font-family: ui-monospace, monospace; }
.comp-selector {
  display: flex; align-items: center;
  background: rgba(255,255,255,0.04);
  border-radius: 999px; border: 1px solid rgba(255,255,255,0.08);
  padding: 2px; gap: 1px;
}
.comp-btn {
  padding: 5px 12px; border: none; border-radius: 999px;
  font-size: 12px; font-weight: 500; cursor: pointer;
  background: transparent; color: var(--color-cc-muted);
  transition: all 0.2s ease; white-space: nowrap;
}
.comp-btn:hover { color: var(--color-cc-fg); }
.comp-btn.active { background: rgba(249,115,22,0.15); color: var(--color-cc-primary); }
.export-toolbar-actions { display: flex; gap: 6px; align-items: center; }
.export-toolbar-actions button {
  padding: 6px 14px; border: none; border-radius: 999px;
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all 0.3s ease-out; white-space: nowrap;
}
.btn-primary {
  background: var(--color-cc-primary); color: #fff;
  box-shadow: 0 2px 12px rgba(249,115,22,0.2);
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-cc-primary-hover);
  box-shadow: 0 4px 16px rgba(249,115,22,0.4);
  transform: translateY(-1px);
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.btn-secondary {
  background: rgba(255,255,255,0.05); color: var(--color-cc-fg);
  border: 1px solid rgba(255,255,255,0.1) !important;
}
.btn-secondary:hover { background: rgba(255,255,255,0.1); }
.dropdown-trigger {
  display: flex; align-items: center; gap: 2px;
  padding: 5px 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 999px;
  font-size: 12px; font-weight: 500; cursor: pointer;
  background: rgba(255,255,255,0.06); color: var(--color-cc-fg);
  transition: all 0.15s; white-space: nowrap;
}
.dropdown-trigger:hover { background: rgba(255,255,255,0.1); }
.dropdown-menu {
  position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  min-width: 120px; padding: 4px;
  background: rgba(30,30,34,0.95); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5); z-index: 200;
}
.dropdown-item {
  display: block; width: 100%; padding: 6px 12px; border: none;
  background: transparent; color: var(--color-cc-muted);
  font-size: 12px; font-weight: 500; text-align: left;
  border-radius: 6px; cursor: pointer; transition: all 0.1s;
}
.dropdown-item:hover { background: rgba(255,255,255,0.08); color: var(--color-cc-fg); }
.dropdown-item.active { color: var(--color-cc-primary); }
.player-wrapper {
  flex: 1; display: flex; flex-direction: column; justify-content: center;
  padding: 20px 40px 40px;
  max-width: 1200px; width: 100%; margin: 0 auto;
  min-height: 0;
}
.player-canvas {
  width: 100%; overflow: hidden;
  background: #000; border-radius: 12px 12px 0 0;
  box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--color-cc-border);
}
.playback-bar {
  width: 100%; background: var(--color-cc-surface);
  border-radius: 0 0 12px 12px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--color-cc-border);
  padding: 0 16px 10px;
}
.timeline {
  position: relative; height: 20px; cursor: pointer;
  display: flex; align-items: center;
}
.timeline::before {
  content: ''; position: absolute; left: 0; right: 0; top: 50%;
  transform: translateY(-50%); height: 4px; border-radius: 2px;
  background: rgba(255,255,255,0.1);
}
.timeline-fill {
  position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  height: 4px; border-radius: 2px; background: var(--color-cc-primary);
  opacity: 0.7; pointer-events: none;
}
.timeline-thumb {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 12px; height: 12px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  opacity: 0; transition: opacity 0.15s;
}
.timeline:hover .timeline-thumb { opacity: 1; }
.controls-row {
  display: flex; align-items: center; gap: 10px;
  color: var(--color-cc-muted);
}
.ctrl-btn {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--color-cc-muted);
  border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.ctrl-btn:hover { background: rgba(255,255,255,0.08); color: var(--color-cc-fg); }
.time-display { font-size: 12px; font-family: ui-monospace, monospace; min-width: 100px; }
.export-error-banner {
  padding: 8px 20px; font-size: 13px;
  color: #ef4444; background: rgba(239,68,68,0.1);
  text-align: center; font-family: ui-monospace, monospace;
}
.error-page {
  padding: 40px; color: #ef4444; font-family: ui-monospace, monospace;
  background: var(--color-cc-bg); min-height: 100vh;
}
.error-page h2 { font-size: 16px; margin-bottom: 16px; }
.error-block {
  font-size: 12px; padding: 12px; background: var(--color-cc-surface);
  border-radius: 8px; margin-bottom: 8px; white-space: pre-wrap;
}
.empty-page {
  display: flex; align-items: center; justify-content: center;
  height: 100vh; background: var(--color-cc-bg); color: var(--color-cc-muted);
}
button:focus-visible { outline: 2px solid var(--color-cc-primary); outline-offset: 2px; }
${getDeployCSS()}
.print-divider { width: 1px; height: 16px; background: rgba(255,255,255,0.12); }
</style>
</head>
<body>
<div id="root"></div>
${opts.inline ? "" : getDeployModalHTML()}
<script type="application/json" id="__remotion-files">${filesJson}<\/script>
<script type="application/json" id="__remotion-compositions">${compositionsJson}<\/script>
<script type="application/json" id="__remotion-assets">${assetsJson}<\/script>
<script type="module">${REMOTION_CLIENT_JS}<\/script>
${opts.inline ? "" : `<script>
function collectDeployFiles(logEl){
  deployLog(logEl, "Collecting remotion export...", "info");
  var qs = new URLSearchParams(location.search).get("composition") || "";
  var dlQs = qs ? "?composition=" + encodeURIComponent(qs) : "";
  return fetch("/export/remotion/download" + dlQs).then(function(r){ return r.text(); }).then(function(html){
    deployLog(logEl, "  + index.html");
    return [{ path: "index.html", content: html }];
  });
}
${getDeployScript().replace(/<\/script>/gi, "<\\/script>")}
<\\/script>`}
</body>
</html>`;

    return { html, title };
  }

  app.get("/export/remotion", (c) => {
    const result = buildRemotionExportHtml({ inline: false });
    if ("error" in result) return c.text(result.error, result.status as any);
    return c.html(result.html);
  });

  app.get("/export/remotion/download", (c) => {
    const composition = c.req.query("composition") || undefined;
    const result = buildRemotionExportHtml({ inline: true, composition });
    if ("error" in result) return c.text(result.error, result.status as any);
    const safeFilename = result.title.replace(/[^\w\s.-]/g, "_") + ".html";
    const utf8Filename = encodeURIComponent(result.title + ".html");
    return new Response(result.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${utf8Filename}`,
      },
    });
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
