import { getDeployCSS, getDeployToolbarHTML, getDeployModalHTML, getDeployScript } from "./deploy-ui.js";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const scriptString = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");

/** WebCraft's export workbench, shared with mode-declared HTML artifacts.
 * Callers own file discovery, validation and downloads; this owns presentation. */
export function buildHtmlPagesExport({ title, pageContents, contentSet, downloadRoute, zipRoute, inline = false }: {
  title: string;
  pageContents: Array<{ file: string; title: string; html: string }>;
  contentSet?: string;
  downloadRoute: string;
  zipRoute?: string;
  inline?: boolean;
}): { html: string; title: string } {
    const baseTag = inline ? "" : `\n<base href="/content/${contentSet ? contentSet.split("/").map(encodeURIComponent).join("/") + "/" : ""}">`;
    const toolbarHtml = inline
      ? ""
      : `\n<div class="export-toolbar-wrapper">
  <div class="export-toolbar">
    <div class="header-left">
      <h1>${escapeHtml(title)}</h1>
      <span class="meta">${pageContents.length} page${pageContents.length > 1 ? "s" : ""}</span>
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
      <button class="btn-secondary" id="print-btn" onclick="printPages()">Print / Save PDF</button>
      <button class="btn-primary" id="download-btn" onclick="downloadHtml()">Download HTML</button>
      ${zipRoute ? '<button class="btn-secondary" onclick="downloadZip()">Download ZIP</button>' : ""}
      <div class="print-divider"></div>
      <button class="btn-secondary" id="screenshot-btn" onclick="captureScreenshot()">Screenshot PNG</button>
      ${getDeployToolbarHTML()}
    </div>
  </div>
</div>
${getDeployModalHTML()}`;

    const downloadScript = inline
      ? ""
      : `\n<script>
// Every page the preview shows, not just the first one. The download route
// falls back to pages[0] when no ?page is given, so a multi-page project used
// to hand back page one under the whole project's name — a silent truncation
// that reads as a complete download. A single-page project keeps its old
// filename; a multi-page one saves each page under its own file name, so the
// links between them still resolve once the files sit in one folder.
function downloadHtml(){
  var btn=document.getElementById('download-btn');var orig=btn.textContent;btn.disabled=true;
  var qs=new URLSearchParams(location.search).get("contentSet");
  var list=(typeof pages!=="undefined"&&pages.length)?pages:[];
  var single=list.length<=1;
  var i=0;
  function done(){btn.textContent=orig;btn.disabled=false;}
  function step(){
    if(i>=Math.max(list.length,1)){done();return;}
    var page=list[i];
    btn.textContent=single?"Preparing...":("Preparing "+(i+1)+"/"+list.length+"...");
    var params=[];
    if(qs)params.push("contentSet="+encodeURIComponent(qs));
    if(!single&&page)params.push("page="+encodeURIComponent(page.file));
    fetch(${scriptString(downloadRoute)}+(params.length?"?"+params.join("&"):"")).then(function(r){
      if(!r.ok)throw new Error("HTTP "+r.status);return r.blob();
    }).then(function(b){
      var a=document.createElement("a");a.href=URL.createObjectURL(b);
      a.download=single?${scriptString(title + ".html")}:page.file.split("/").pop();
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      i++;
      // Browsers drop downloads fired in the same tick; the gap also lets the
      // multi-file permission prompt appear once instead of racing per file.
      setTimeout(step,300);
    }).catch(function(e){alert("Download failed: "+e.message);done()});
  }
  step();
}
function downloadZip(){
  var qs=new URLSearchParams(location.search).get("contentSet");
  window.open(${scriptString(zipRoute ?? "")}+(qs?"?contentSet="+encodeURIComponent(qs):""));
}

var VIEWPORTS={full:{w:0,h:0},mobile:{w:375,h:812},tablet:{w:768,h:1024},desktop:{w:1280,h:800}};
var currentVP='full';

async function waitForPages(){
  var timer;
  try{
    await Promise.race([Promise.all(pageLoads),new Promise(function(_,reject){
      timer=setTimeout(function(){reject(new Error('Pages did not finish loading. Refresh and try again.'))},15000);
    })]);
  }finally{clearTimeout(timer)}
}
async function printPages(){
  var btn=document.getElementById('print-btn');
  btn.disabled=true;btn.textContent='Preparing...';
  try{
    await waitForPages();
    materializePrintPages();
    await document.fonts.ready;
    await Promise.all(Array.from(document.querySelectorAll('.print-page-content img')).map(function(img){img.loading='eager';return img.decode()}));
    window.print();
  }catch(e){alert('PDF preparation failed: '+e.message)}
  finally{restorePrintPages();btn.disabled=false;btn.textContent='Print / Save PDF'}
}

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
  var btn=document.getElementById('screenshot-btn');
  var origText=btn.textContent;
  btn.textContent='Capturing...';btn.disabled=true;
  var prevVP=currentVP;
  try{
    await waitForPages();
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
        // Force-load every font face so snapdom embeds them — unused Latin
        // faces stay "unloaded" on a CJK page otherwise and fall back.
        try{
          if(doc.fonts){
            await Promise.all(Array.from(doc.fonts).map(function(f){return f.load().catch(function(){})}));
            if(doc.fonts.ready)await doc.fonts.ready;
          }
        }catch(e){}
        // Inject snapdom INTO the iframe and run it there, so it resolves the
        // iframe's own computed styles, CSS variables, @font-face, and SVG
        // paint servers (fill="url(#grad)"). Running the outer-window snapdom
        // against the inner document fails to resolve those — SVG gradient /
        // var() fills collapse to the SVG default (black), which turned charts
        // black in the captured PNG. Same fix as kami's capturePages().
        if(!frame.contentWindow.snapdom){
          var s=doc.createElement('script');s.src='/vendor/snapdom.js';doc.head.appendChild(s);
          await new Promise(function(res){
            var tries=0;
            var timer=setInterval(function(){
              tries++;
              if(frame.contentWindow.snapdom){clearInterval(timer);res();}
              else if(tries>50){clearInterval(timer);res();}
            },100);
          });
        }
        var localSnapdom=frame.contentWindow.snapdom||window.snapdom||snapdom;
        var result=await localSnapdom(doc.body,{embedFonts:true});
        var png=await result.toPng();
        var img=await new Promise(function(resolve,reject){
          var im=new Image();im.onload=function(){resolve(im)};im.onerror=reject;im.src=png.src;
        });
        images.push(img);
        totalHeight+=img.naturalHeight;
        maxWidth=Math.max(maxWidth,img.naturalWidth);
      }catch(e){throw new Error('Could not capture page '+(i+1)+': '+e.message)}
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
    await new Promise(function(resolve,reject){
      canvas.toBlob(function(blob){
        if(!blob){reject(new Error('The image is too large to export.'));return;}
        var a=document.createElement('a');var url=URL.createObjectURL(blob);
        a.href=url;
        a.download=${scriptString(title + ".png")};
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
    return fetch(${scriptString(downloadRoute)} + dlQs).then(function(r){if(!r.ok)throw new Error('Could not collect page: HTTP '+r.status);return r.text();}).then(function(html){
      var dir = contentSet || "pages";
      deployLog(logEl, "  + " + dir + "/" + page.file);
      return { path: dir + "/" + page.file, content: html };
    });
  });

  return Promise.all(filePromises).then(function(pageFileList){
    if(pageFileList.length === 1){
      // Single page: deploy directly as index.html, skip aggregation page
      deployLog(logEl, "Single page — deploying directly", "info");
      return [{ path: "index.html", content: pageFileList[0].content }];
    }
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
var pageLoads = [];
pages.forEach(function(page, i) {
  var frame = document.getElementById('page-frame-' + i);
  if (frame) {
    var loaded = new Promise(function(resolve,reject){
    frame.addEventListener('load', async function() {
      try {
        var doc = frame.contentDocument;
        // Force all animations to their end state and trigger scroll-reveal
        // classes. In export there's no scrolling, so IntersectionObserver
        // never fires and elements with opacity:0 + scroll triggers stay hidden.
        var style = doc.createElement('style');
        style.textContent = [
          '*, *::before, *::after { animation-fill-mode: forwards !important; animation-delay: 0s !important; animation-duration: 0s !important; transition-duration: 0s !important; }',
          // Collapse viewport-height layouts that cause excessive space in export iframes.
          // In export, each page is a continuous document — full-screen hero sections
          // should shrink to fit their content, not claim 100vh of the iframe.
          ':where([class*="hero"], [class*="banner"], [class*="cover"], [class*="landing"], [class*="fullscreen"], [class*="full-screen"]) { min-height: auto !important; height: auto !important; }',
        ].join('\\n');
        // Also scan all stylesheets for vh-based rules and override inline
        try {
          Array.from(doc.styleSheets).forEach(function(ss) {
            try {
              Array.from(ss.cssRules).forEach(function(rule) {
                if (rule.style) {
                  var mh = rule.style.minHeight || '';
                  var h = rule.style.height || '';
                  if (mh.indexOf('vh') > -1 || mh.indexOf('svh') > -1 || mh.indexOf('dvh') > -1) {
                    rule.style.setProperty('min-height', 'auto', 'important');
                  }
                  if (h.indexOf('vh') > -1 || h.indexOf('svh') > -1 || h.indexOf('dvh') > -1) {
                    rule.style.setProperty('height', 'auto', 'important');
                  }
                }
              });
            } catch(e2) {}
          });
        } catch(e3) {}
        doc.head.appendChild(style);
        // Trigger common scroll-reveal class patterns
        doc.querySelectorAll('section, [class*="reveal"], [class*="fade"], [class*="scroll"], [class*="animate"]').forEach(function(el) {
          el.classList.add('visible', 'revealed', 'in-view', 'is-visible', 'show', 'active');
        });
        await doc.fonts.ready;
        await Promise.all(Array.from(doc.images).map(function(img){img.loading='eager';return img.decode()}));
        // Wait a frame for layout to settle after overrides
        requestAnimationFrame(function() {
          var h = doc.documentElement.scrollHeight;
          frame.style.height = Math.max(h, 200) + 'px';
          resolve();
        });
      } catch(e) {reject(new Error('Page '+(i+1)+' could not load its images or fonts: '+e.message))}
    },{once:true});
    frame.srcdoc = page.html;
    });
    loaded.catch(function(){}); // Report via the export action, without an unhandled rejection.
    pageLoads.push(loaded);
  }
});

// Chrome can't print srcdoc iframes reliably.
// Before print: extract iframe content into direct DOM divs.
// After print: remove them and restore iframes.
function materializePrintPages() {
  if(document.querySelector('.print-page-content'))return;
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
}
window.addEventListener('beforeprint', materializePrintPages);

function restorePrintPages() {
  // Remove print divs, restore iframes
  document.querySelectorAll('.print-page-content').forEach(function(el) { el.remove(); });
  document.querySelectorAll('.page-frame-wrapper iframe').forEach(function(f) { f.style.display = 'block'; });
}
window.addEventListener('afterprint', restorePrintPages);
<\/script>`;

    const pageSectionsHtml = pageContents.map((_page, i) => {
      return `<div class="page-section">
  <div class="page-header">
    <span class="page-number">${i + 1}</span>
    <span class="page-title">${escapeHtml(pageContents[i].title)}</span>
    <span class="page-file">${escapeHtml(pageContents[i].file)}</span>
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
<title>${escapeHtml(title)} \u2014 Export</title>
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
    min-width: 720px;
    max-width: 1200px;
    margin: 0 auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }

  .header-left {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-right: auto;
    min-width: 0;
    overflow: hidden;
  }

  .export-toolbar h1 {
    font-size: 15px;
    font-weight: 500;
    margin: 0;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  /* Matches the toolbar's 1200px. A narrower value was not a reading measure —
     the page inside the frame sets its own — it just cropped the canvas 240px
     short of the chrome above it, so wide designs got squeezed and the two
     edges never lined up. */
  .page-section {
    max-width: 1200px;
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
