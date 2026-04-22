/**
 * KamiPreview — Kami Mode viewer component.
 *
 * Implements ViewerContract's PreviewComponent.
 * Paper-locked preview: a single config-driven page preset (A4 by default)
 * rendered as a sheet centered on a warm parchment letterbox. Forked from
 * the webcraft viewer with the design-skill sidebar replaced by a compact
 * paper-info + Print-to-PDF helper panel.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
  ViewerFileContent,
} from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { buildSelectionScript } from "../../../core/iframe-selection/index.js";
import { useStore } from "../../../src/store.js";
import type { Site } from "../domain.js";

// ── Edit Mode Extension ─────────────────────────────────────────────────────

const EDIT_MODE_EXTENSION = `
  var editActive = false;
  var editDirty = false;
  var editOriginalText = '';
  var editFocusedTag = '';
  var editChanges = [];

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'pneuma:editMode') return;
    editActive = !!e.data.enabled;
    toggleEditable(editActive);
    if (!editActive) {
      if (editDirty) { sendEditedContent(); editDirty = false; }
      editChanges = [];
    }
  });

  function toggleEditable(enable) {
    var tags = 'h1,h2,h3,h4,h5,h6,p,li,td,th,span,a,blockquote,figcaption,label,dt,dd';
    var INLINE = { SPAN:1, A:1, EM:1, STRONG:1, B:1, I:1, SMALL:1, CODE:1, BR:1, SUB:1, SUP:1, MARK:1, TIME:1, U:1, S:1, Q:1, CITE:1, ABBR:1 };
    var els = Array.prototype.slice.call(document.querySelectorAll(tags));
    // kami demos use <div class="…"> as text containers (e.g. .name, .tl-body,
    // .proj-text). Include any <div> whose direct children are only inline
    // elements — those are leaf text containers. Skip structural divs with
    // block-level children (cards, grids, etc.).
    var divs = document.querySelectorAll('div');
    for (var d = 0; d < divs.length; d++) {
      var dv = divs[d];
      var leaf = true;
      for (var c = 0; c < dv.children.length; c++) {
        if (!INLINE[dv.children[c].tagName]) { leaf = false; break; }
      }
      if (leaf && (dv.textContent || '').trim()) els.push(dv);
    }
    for (var i = 0; i < els.length; i++) {
      els[i].contentEditable = enable ? 'true' : 'false';
      els[i].style.cursor = enable ? 'text' : '';
    }
    if (enable) document.addEventListener('click', preventEditNav, true);
    else document.removeEventListener('click', preventEditNav, true);
  }

  function preventEditNav(e) {
    if (e.target.closest && e.target.closest('a')) e.preventDefault();
  }

  document.addEventListener('focus', function(e) {
    if (!editActive) return;
    var el = e.target;
    if (el && el.contentEditable === 'true') {
      editOriginalText = (el.textContent || '').trim();
      editFocusedTag = el.tagName ? el.tagName.toLowerCase() : '';
    }
  }, true);

  document.addEventListener('input', function() { if (editActive) editDirty = true; });

  document.addEventListener('blur', function(e) {
    if (!editActive) return;
    var el = e.target;
    if (el && el.contentEditable === 'true') {
      var newText = (el.textContent || '').trim();
      if (editOriginalText !== newText) {
        editChanges.push({ tag: editFocusedTag, before: editOriginalText, after: newText });
        editDirty = true;
      }
      if (editDirty) { sendEditedContent(); editDirty = false; }
    }
  }, true);

  function serializeCleanBody() {
    var clone = document.body.cloneNode(true);
    var scripts = clone.querySelectorAll('script');
    for (var i = scripts.length - 1; i >= 0; i--) scripts[i].parentNode.removeChild(scripts[i]);
    var eds = clone.querySelectorAll('[contenteditable]');
    for (var i = 0; i < eds.length; i++) eds[i].removeAttribute('contenteditable');
    var styled = clone.querySelectorAll('[style]');
    for (var i = 0; i < styled.length; i++) {
      var s = styled[i].style;
      s.outline = ''; s.outlineOffset = ''; s.borderRadius = ''; s.cursor = '';
      if (!styled[i].getAttribute('style').trim()) styled[i].removeAttribute('style');
    }
    return clone.innerHTML.trim();
  }

  function sendEditedContent() {
    var changes = editChanges.slice();
    editChanges = [];
    window.parent.postMessage({ type: 'pneuma:textEdit', html: serializeCleanBody(), changes: changes }, '*');
  }
`;

// ── Selection Script ─────────────────────────────────────────────────────────

const SELECTION_SCRIPT = buildSelectionScript({ extensions: [EDIT_MODE_EXTENSION] });

// ── Viewport Presets ─────────────────────────────────────────────────────────

// ── Inline SVG Icons ─────────────────────────────────────────────────────────
// Lucide-style stroke icons — no emoji, consistent 16×16 viewBox.

const svgProps = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const Icons = {
  // Viewport
  tablet: <svg {...svgProps}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>,
};

interface ViewportPreset {
  id: string;
  label: string;
  icon: React.ReactNode;
  width: number;
  height: number;
}

/**
 * Build the single locked paper preset from the config source.
 * Falls back to A4 Portrait if config hasn't loaded yet.
 */
function buildKamiPreset(cfg?: { paperSize?: string; orientation?: string; pageWidthMm?: number; pageHeightMm?: number }): ViewportPreset[] {
  const pageWidthMm  = cfg?.pageWidthMm  ?? 210;
  const pageHeightMm = cfg?.pageHeightMm ?? 297;
  const MM_TO_PX = 96 / 25.4;   // 96 dpi
  const widthPx  = Math.round(pageWidthMm  * MM_TO_PX);
  const heightPx = Math.round(pageHeightMm * MM_TO_PX);
  const label = `${cfg?.paperSize ?? "A4"} ${cfg?.orientation ?? "Portrait"} · ${pageWidthMm} × ${pageHeightMm} mm`;
  return [
    { id: "paper", label, icon: Icons.tablet, width: widthPx, height: heightPx },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a full HTML document for the iframe srcdoc.
 * Injects <base href> for correct relative asset resolution and
 * the dormant selection script (controlled via postMessage).
 */
// Intercept hash-only anchor clicks so they scroll in-place instead of
// navigating away from the srcdoc (which <base href> would otherwise cause).
const HASH_NAV_FIX = `<script>
document.addEventListener('click',function(e){
  var a=e.target.closest('a[href^="#"]');
  if(!a)return;
  var hash=a.getAttribute('href');
  if(!hash||hash.length<2)return;
  e.preventDefault();
  var target=document.querySelector(hash)||document.getElementById(hash.slice(1));
  if(target)target.scrollIntoView({behavior:'smooth'});
});
</script>`;

const SCROLLBAR_STYLE = `<style data-pneuma-scrollbar>
*{scrollbar-width:thin;scrollbar-color:rgba(128,128,128,0.3) transparent}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.3);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,0.5)}
</style>`;

function buildSrcdoc(html: string, baseHref: string): string {
  const isFullDoc = /<!DOCTYPE|<html/i.test(html);
  const injectedScripts = HASH_NAV_FIX + SELECTION_SCRIPT;

  if (isFullDoc) {
    let result = html;
    const baseTag = `<base href="${baseHref}">${SCROLLBAR_STYLE}`;
    // Inject <base> into <head>
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    } else if (/<html[^>]*>/i.test(result)) {
      result = result.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
    }
    // Inject scripts before </body>
    if (/<\/body>/i.test(result)) {
      result = result.replace(/<\/body>/i, `${injectedScripts}</body>`);
    } else {
      result += injectedScripts;
    }
    return result;
  }

  // Fragment: wrap in full document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${baseHref}">
  ${SCROLLBAR_STYLE}
</head>
<body>
${html}
${injectedScripts}
</body>
</html>`;
}

// ── Page Navigator ──────────────────────────────────────────────────────────

interface PageEntry {
  file: string;
  title: string;
}

function PageNavigator({
  pages,
  activePage,
  onPageChange,
  baseHref,
}: {
  pages: PageEntry[];
  activePage: string;
  onPageChange: (page: string) => void;
  baseHref: string;
}) {
  const [hoveredPage, setHoveredPage] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  const handleMouseEnter = (page: string, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredPage(page);
    setHoverPos({ x: rect.left + rect.width / 2, y: rect.top });
  };

  return (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        overflowX: "auto",
        padding: "0 8px",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {pages.map((page) => (
        <button
          key={page.file}
          onClick={() => onPageChange(page.file)}
          onMouseEnter={(e) => handleMouseEnter(page.file, e)}
          onMouseLeave={() => setHoveredPage(null)}
          style={{
            padding: "6px 14px",
            fontSize: "12px",
            color: page.file === activePage ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)",
            background: "none",
            border: "none",
            borderBottomWidth: "2px",
            borderBottomStyle: "solid",
            borderBottomColor: page.file === activePage ? "#1B365D" : "transparent",
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "color 0.15s",
          }}
          title={page.file}
        >
          {page.title}
        </button>
      ))}

      {/* Hover thumbnail preview */}
      {hoveredPage && hoveredPage !== activePage && (
        <div style={{
          position: "fixed",
          left: hoverPos.x - 120,
          top: hoverPos.y - 160,
          width: 240,
          height: 150,
          background: "#1a1a1a",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: "6px",
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          zIndex: 9999,
          pointerEvents: "none",
        }}>
          <iframe
            src={`${baseHref}${hoveredPage}`}
            style={{
              width: "1280px",
              height: "800px",
              border: "none",
              transform: "scale(0.1875)",
              transformOrigin: "top left",
              pointerEvents: "none",
            }}
            sandbox="allow-same-origin"
            title="Page preview"
            tabIndex={-1}
          />
        </div>
      )}
    </div>
  );
}

// ── Kami Focus-mode Thumbnail Strip ────────────────────────────────────────
//
// Vertical numbered list of pages on the left edge of the focus view.
// Uses plain labeled buttons rather than full iframe thumbnails for V1 —
// performant and lets the author jump between pages by number. Real
// iframe-scaled thumbs are a visual polish we can layer on later.

function KamiThumbStrip({
  pageCount,
  activeIndex,
  onPick,
}: {
  pageCount: number;
  activeIndex: number;
  onPick: (i: number) => void;
}) {
  return (
    <div
      style={{
        width: 64,
        borderRight: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.2)",
        padding: "12px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        overflowY: "auto",
        flexShrink: 0,
      }}
    >
      {Array.from({ length: pageCount }).map((_, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={i}
            onClick={() => onPick(i)}
            title={`Page ${i + 1}`}
            style={{
              width: 40,
              height: 56,
              border: active ? "1.5px solid #1B365D" : "1px solid rgba(245,244,237,0.20)",
              borderRadius: 4,
              background: active ? "rgba(27,54,93,0.22)" : "rgba(245,244,237,0.05)",
              color: active ? "#f5f4ed" : "rgba(245,244,237,0.55)",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "Newsreader, Georgia, serif",
              transition: "all 0.15s",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.color = "rgba(245,244,237,0.9)";
                e.currentTarget.style.background = "rgba(245,244,237,0.12)";
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.color = "rgba(245,244,237,0.55)";
                e.currentTarget.style.background = "rgba(245,244,237,0.05)";
              }
            }}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

// ── Book-mode navigation ────────────────────────────────────────────────────
//
// Prev / next arrows that advance the book by a full spread.
// Pairing convention: [null, 0] (cover), [1, 2], [3, 4], …
// Prev from spread [1,2] goes to cover [null, 0]; from [3,4] goes to [1,2].

// ── Book-mode spread crossfade ────────────────────────────────────────────
//
// When the active spread changes we:
//   1. Let applyViewModeStyles swap the underlying .page visibility to
//      the destination spread. New pages fade in via the mode's
//      kami-book-fade-in keyframe (pure opacity, no translateY).
//   2. Clone the OLD spread's visible pages and pin them as overlays at
//      the same positions. Animate their opacity 1 → 0 over the same
//      duration. Together the two sides produce a crossfade.
//
// All .page elements always remain in the DOM (the view-mode CSS just
// hides the non-active ones), so cloning the previous spread by index
// works regardless of visibility state.

type SpreadPair = { left: number | null; right: number | null };

// A physical book is made of folded leaves; each leaf has a recto
// (right-facing, odd-numbered) and a verso (left-facing, even-numbered).
// Open spreads are [verso, recto] pairs like [2, 3]. The first and last
// pages of an odd/short book are "half spreads":
//   • Cover (before the first flip): only the first recto is visible on
//     the right; the left half is blank (no leaf under it yet).
//   • Back (after the last flip on a book with an odd trailing page):
//     only the trailing verso is visible on the left; the right half is
//     blank.
// This function mirrors that structure. activePageIndex = 0 is cover.
// Odd indices are left-of-spread positions; even indices > 0 are
// right-of-spread. When a pair slot falls off the end of the page list
// we return null for that side so the viewer renders a half spread.

function spreadPair(i: number, count: number): SpreadPair {
  if (count <= 0) return { left: null, right: null };
  if (i === 0) return { left: null, right: 0 };
  if (i % 2 === 1) {
    // Odd i is the left-of-spread. Pair with i+1 on the right; if i is
    // the final page (e.g. 2-page book at i=1) the right slot is empty.
    if (i + 1 < count) return { left: i, right: i + 1 };
    return { left: i, right: null };
  }
  return { left: i - 1, right: i };
}

function runBookCrossfade(
  doc: Document,
  fromIdx: number,
  toIdx: number,
  pageCount: number,
): () => void {
  const noop = () => {};
  if (fromIdx === toIdx || pageCount < 1) return noop;
  const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
  if (!pages.length) return noop;

  const fromP = spreadPair(fromIdx, pages.length);
  // For a cover-involving transition there's only one page visible; for a
  // spread there are two. Position the clones with left: 50% at the spine
  // — flex centering puts the real pages at the same coordinates.
  const slots: Array<{ idx: number; align: "left" | "right" | "center" }> = [];
  if (fromP.left !== null)                slots.push({ idx: fromP.left,  align: "left"   });
  if (fromP.right !== null)               slots.push({ idx: fromP.right, align: "right"  });
  if (fromP.left === null && fromP.right !== null) {
    // Cover: only right page exists, positioned right-of-spine.
    slots[slots.length - 1].align = "right";
  }

  const DURATION = 260;
  const clones: Array<{ el: HTMLElement; anim: Animation }> = [];
  for (const slot of slots) {
    const src = pages[slot.idx];
    if (!src) continue;
    const clone = src.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-kami-index");
    clone.style.setProperty("display", "block", "important");
    clone.style.position = "absolute";
    clone.style.top = "0";
    clone.style.margin = "0";
    clone.style.width = "var(--page-width)";
    clone.style.height = "var(--page-height)";
    clone.style.zIndex = "50";
    clone.style.pointerEvents = "none";
    // kill the shared fadeIn on the clone — it would re-play the 6px
    // slide on insert, mixing with our opacity fade-out.
    clone.style.animation = "none";
    if (slot.align === "left") {
      clone.style.left = "50%";
      clone.style.transform = "translateX(-100%)";
    } else {
      // right-of-spine (either right page of a spread, or cover page)
      clone.style.left = "50%";
    }
    doc.body.appendChild(clone);
    const anim = clone.animate(
      [{ opacity: 1 }, { opacity: 0 }] as Keyframe[],
      { duration: DURATION, fill: "forwards", easing: "ease-out" },
    );
    anim.onfinish = () => clone.remove();
    clones.push({ el: clone, anim });
  }

  return () => {
    for (const c of clones) {
      c.anim.cancel();
      c.el.remove();
    }
  };
}

// Visibility: hide by default so arrows don't compete with the book
// content. Show when the cursor moves into the left/right edge zone (the
// region where the arrows actually live) OR on a hover-near — reveal
// widens as the mouse approaches from outside the zone. Hide again after
// 2s of cursor stillness. visible is driven externally so the auto-hide
// timer lives with the container's pointer listener.

function BookNav({
  activeIndex,
  pageCount,
  onPick,
  visible,
}: {
  activeIndex: number;
  pageCount: number;
  onPick: (i: number) => void;
  visible: boolean;
}) {
  const goPrev = () => {
    if (activeIndex === 0) return;
    // Collapse odd index to the same spread, then step back a spread.
    const normalized = activeIndex % 2 === 1 ? activeIndex : activeIndex - 1;
    const prev = normalized - 2;
    onPick(prev < 1 ? 0 : prev);
  };
  const goNext = () => {
    if (activeIndex === 0) {
      onPick(1);
      return;
    }
    const normalized = activeIndex % 2 === 1 ? activeIndex : activeIndex - 1;
    const next = normalized + 2;
    if (next < pageCount) onPick(next);
    else if (normalized + 1 < pageCount - 1) onPick(normalized + 2); // try last
  };
  const atStart = activeIndex === 0;
  const atEnd = (() => {
    if (activeIndex === 0) return pageCount <= 1;
    const normalized = activeIndex % 2 === 1 ? activeIndex : activeIndex - 1;
    return normalized + 2 >= pageCount;
  })();

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    width: 44,
    height: 44,
    borderRadius: "50%",
    border: "1px solid rgba(20,20,19,0.15)",
    background: "rgba(245,244,237,0.92)",
    color: disabled ? "rgba(20,20,19,0.25)" : "#1B365D",
    cursor: disabled ? "default" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 12px rgba(20,20,19,0.15)",
    zIndex: 4,
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? "auto" : "none",
    transition: "opacity 180ms ease-out",
    willChange: "opacity",
  });

  return (
    <>
      <button
        onClick={goPrev}
        disabled={atStart}
        style={{ ...btnStyle(atStart), left: 12 }}
        title="Previous spread"
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        onClick={goNext}
        disabled={atEnd}
        style={{ ...btnStyle(atEnd), right: 12 }}
        title="Next spread"
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </>
  );
}

// ── Preview Mode Icons ───────────────────────────────────────────────────────

type PreviewMode = "view" | "edit" | "select" | "annotate";

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: "14px", height: "14px" }}>
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: "14px", height: "14px" }}>
      <path d="M3 2l4 12 2-5 5-2L3 2z" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: "14px", height: "14px" }}>
      <path d="M11.5 2.5l2 2-8 8L3 13.5l1-2.5z" strokeLinejoin="round" />
      <path d="M9.5 4.5l2 2" />
    </svg>
  );
}

function AnnotateIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: "14px", height: "14px" }}>
      <path d="M12 3l1.5 1.5L5 13l-2 .5.5-2z" strokeLinejoin="round" />
      <path d="M2 15h5" strokeLinecap="round" strokeDasharray="2 1.5" />
    </svg>
  );
}


function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: "14px", height: "14px" }}>
      <path d="M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
    </svg>
  );
}

// ── Viewport Toolbar ─────────────────────────────────────────────────────────

const MODE_BUTTONS: { value: PreviewMode; label: string; icon: React.ReactNode; title: string }[] = [
  { value: "view", label: "View", icon: <EyeIcon />, title: "Read-only view" },
  { value: "edit", label: "Edit", icon: <EditIcon />, title: "Edit text directly in preview" },
  { value: "select", label: "Select", icon: <CursorIcon />, title: "Select elements (Esc to exit)" },
  { value: "annotate", label: "Annotate", icon: <AnnotateIcon />, title: "Annotate multiple elements (Esc to exit)" },
];

type KamiViewModeValue = "scroll" | "focus" | "book";

const KAMI_VIEW_BUTTONS: { value: KamiViewModeValue; label: string; title: string; icon: React.ReactNode }[] = [
  {
    value: "scroll",
    label: "Scroll",
    title: "Scroll: all pages stacked vertically",
    icon: (
      <svg {...svgProps}>
        <rect x="8" y="3"  width="8" height="4" rx="1"/>
        <rect x="8" y="10" width="8" height="4" rx="1"/>
        <rect x="8" y="17" width="8" height="4" rx="1"/>
      </svg>
    ),
  },
  {
    value: "focus",
    label: "Focus",
    title: "Focus: thumbnail strip + single-page main frame",
    icon: (
      <svg {...svgProps}>
        <rect x="3"  y="5" width="4" height="14" rx="1"/>
        <rect x="10" y="3" width="11" height="18" rx="1"/>
      </svg>
    ),
  },
  {
    value: "book",
    label: "Book",
    title: "Book: two-page spread",
    icon: (
      <svg {...svgProps}>
        <path d="M3 5h8v14H3z"/>
        <path d="M13 5h8v14h-8z"/>
      </svg>
    ),
  },
];

function GuidesIcon({ active }: { active: boolean }) {
  return (
    <svg {...svgProps}>
      <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray={active ? undefined : "2 2"}/>
      <rect x="6" y="6" width="12" height="12" rx="0.5" strokeDasharray="2 2"/>
    </svg>
  );
}

function ViewportToolbar({
  presets,
  activePreset,
  onPresetChange,
  previewMode,
  onSetPreviewMode,
  onExport,
  readonly,
  kamiViewMode,
  onKamiViewModeChange,
  showGuides,
  onToggleGuides,
}: {
  presets: ViewportPreset[];
  activePreset: string;
  onPresetChange: (presetId: string) => void;
  previewMode: PreviewMode;
  onSetPreviewMode: (mode: PreviewMode) => void;
  onExport: () => void;
  readonly?: boolean;
  kamiViewMode: KamiViewModeValue;
  onKamiViewModeChange: (mode: KamiViewModeValue) => void;
  showGuides: boolean;
  onToggleGuides: () => void;
}) {
  const currentPreset = presets.find((p) => p.id === activePreset);
  const showDimensions = currentPreset && currentPreset.width > 0;

  return (
    <div
      style={{
        padding: "4px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "4px",
        flexShrink: 0,
      }}
    >
      {/* Left: view mode segmented + guides toggle + viewport preset label */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1px",
            background: "rgba(0,0,0,0.3)",
            borderRadius: "6px",
            padding: "2px",
          }}
          title="Kami view mode"
        >
          {KAMI_VIEW_BUTTONS.map((m) => (
            <button
              key={m.value}
              onClick={() => onKamiViewModeChange(m.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                fontSize: "11px",
                transition: "all 0.15s",
                background: kamiViewMode === m.value ? "rgba(27,54,93,0.30)" : "transparent",
                color: kamiViewMode === m.value ? "#f5f4ed" : "rgba(245,244,237,0.65)",
              }}
              title={m.title}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onToggleGuides}
          title={showGuides ? "Hide safe-area guides" : "Show safe-area guides"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 8px",
            borderRadius: "4px",
            border: "1px solid " + (showGuides ? "rgba(27,54,93,0.55)" : "transparent"),
            cursor: "pointer",
            fontSize: "11px",
            background: showGuides ? "rgba(27,54,93,0.22)" : "transparent",
            color: showGuides ? "#f5f4ed" : "rgba(245,244,237,0.65)",
          }}
        >
          <GuidesIcon active={showGuides} />
          <span>Guides</span>
        </button>
        {showDimensions && (
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginLeft: "4px" }}>
            {currentPreset.label}
          </span>
        )}
      </div>
      {/* Legacy viewport preset row — hidden in kami since there's only one preset,
          but retained for future multi-preset use. */}
      <div style={{ display: "none", alignItems: "center", gap: "4px" }}>
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginRight: "4px" }}>
          Viewport:
        </span>
        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onPresetChange(preset.id)}
            style={{
              background: preset.id === activePreset ? "rgba(27,54,93,0.14)" : "none",
              border: preset.id === activePreset ? "1px solid rgba(27,54,93,0.40)" : "1px solid transparent",
              borderRadius: "4px",
              padding: "3px 8px",
              cursor: "pointer",
              color: preset.id === activePreset ? "#f5f4ed" : "rgba(245,244,237,0.65)",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s",
            }}
            title={preset.width > 0 ? `${preset.label} (${preset.width}x${preset.height})` : preset.label}
            onMouseEnter={(e) => {
              if (preset.id !== activePreset) {
                e.currentTarget.style.color = "rgba(245,244,237,0.85)";
                e.currentTarget.style.background = "rgba(245,244,237,0.06)";
              }
            }}
            onMouseLeave={(e) => {
              if (preset.id !== activePreset) {
                e.currentTarget.style.color = "rgba(245,244,237,0.65)";
                e.currentTarget.style.background = "none";
              }
            }}
          >
            <span style={{ display: "flex", alignItems: "center" }}>{preset.icon}</span>
            <span>{preset.label}</span>
          </button>
        ))}
        {showDimensions && (
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginLeft: "8px" }}>
            {currentPreset.width} x {currentPreset.height}
          </span>
        )}
      </div>

      {/* Center: Mode toggle — hidden in readonly (replay) mode */}
      {!readonly && <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1px",
          background: "rgba(0,0,0,0.3)",
          borderRadius: "6px",
          padding: "2px",
        }}
      >
        {MODE_BUTTONS.map((m) => (
          <button
            key={m.value}
            onClick={() => onSetPreviewMode(m.value)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "3px 8px",
              borderRadius: "4px",
              border: "none",
              cursor: "pointer",
              fontSize: "11px",
              transition: "all 0.15s",
              background: previewMode === m.value ? "rgba(27,54,93,0.20)" : "transparent",
              color: previewMode === m.value ? "#f5f4ed" : "rgba(245,244,237,0.65)",
            }}
            title={m.title}
            onMouseEnter={(e) => {
              if (previewMode !== m.value) {
                e.currentTarget.style.color = "rgba(255,255,255,0.8)";
              }
            }}
            onMouseLeave={(e) => {
              if (previewMode !== m.value) {
                e.currentTarget.style.color = "rgba(255,255,255,0.5)";
              }
            }}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>}

      {/* Right cluster: design-language attribution + export button.
          The attribution used to float inside the iframe container where
          it scrolled with the content in scroll mode. Parking it in the
          static toolbar keeps it visible without fighting the reader. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <a
          href="https://github.com/tw93/kami"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: "Newsreader, Georgia, serif",
            fontSize: 11,
            letterSpacing: 0.2,
            color: "rgba(255,255,255,0.40)",
            textDecoration: "none",
            padding: "3px 6px",
            borderRadius: 4,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.40)")}
          title="Design language adapted from tw93/kami (MIT). Click to open the source repository."
        >
          Design adapted from tw93/kami <span aria-hidden="true">↗</span>
        </a>
        <button
          onClick={onExport}
          title="Export &amp; Download"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 8px",
            borderRadius: "4px",
            border: "none",
            cursor: "pointer",
            fontSize: "11px",
            transition: "all 0.15s",
            background: "transparent",
            color: "rgba(255,255,255,0.5)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "rgba(255,255,255,0.8)";
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(255,255,255,0.5)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <DownloadIcon />
        </button>
      </div>
    </div>
  );
}

// ── Annotation Popover ──────────────────────────────────────────────────────

function AnnotationPopover({
  style,
  label,
  thumbnail,
  onConfirm,
  onCancel,
}: {
  style: React.CSSProperties;
  label?: string;
  thumbnail?: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm(comment);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      style={style}
      className="bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl p-3 text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        {thumbnail && (
          <img src={thumbnail} alt="" className="w-8 h-8 rounded border border-neutral-600 shrink-0 object-contain bg-white" />
        )}
        <span className="text-neutral-300 truncate text-xs">{label || "Element"}</span>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add comment (optional)..."
        className="w-full bg-neutral-900 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-blue-500"
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="px-2.5 py-1 text-xs text-neutral-400 hover:text-white rounded hover:bg-neutral-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(comment)}
          className="px-2.5 py-1 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function KamiPreview({
  sources,
  fileChannel,
  selection,
  onSelect: rawOnSelect,
  mode: rawPreviewMode,
  contentVersion,
  imageVersion,
  activeFile,
  onActiveFileChange,
  onNotifyAgent: rawOnNotifyAgent,
  navigateRequest,
  onNavigateComplete,
  commands: manifestCommands,
  readonly,
}: ViewerPreviewProps) {
  // Readonly mode: force view, suppress selection and agent notifications
  const previewMode = readonly ? "view" : rawPreviewMode;
  const onSelect = readonly ? (() => {}) : rawOnSelect;
  const onNotifyAgent = readonly ? undefined : rawOnNotifyAgent;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [viewport, setViewport] = useState<string>("paper");

  // Access store for activeContentSet, preview mode, and annotations
  const activeContentSet = useStore((s) => s.activeContentSet);
  const setPreviewMode = useStore((s) => s.setPreviewMode);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const annotations = useStore((s) => s.annotations);

  // Pending annotation popover state (annotate mode: click → popover → confirm → add)
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    selection: ViewerSelectionContext;
    pageFile: string;
    rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);

  // Kami paper config — read from .pneuma/config.json via the "config" source.
  // Drives the single locked paper preset (page width/height + label).
  type KamiConfig = {
    paperSize?: string;
    orientation?: string;
    pageWidthMm?: number;
    pageHeightMm?: number;
    safeTopMm?: number;
    safeSideMm?: number;
    safeBottomMm?: number;
  };
  const configSource = sources.config as Source<KamiConfig> | undefined;
  const { value: config } = useSource<KamiConfig>(configSource);

  // ── Kami view modes ────────────────────────────────────────────────────────
  // Scroll:  all pages stacked vertically (current behaviour)
  // Focus:   thumbnail strip + single-page main frame
  // Book:    two-page spread with first-page-on-right cover
  type KamiViewMode = "scroll" | "focus" | "book";
  const [kamiViewMode, setKamiViewMode] = useState<KamiViewMode>(() => {
    try {
      const saved = localStorage.getItem("kami:viewMode");
      if (saved === "scroll" || saved === "focus" || saved === "book") return saved;
    } catch {}
    return "scroll";
  });
  useEffect(() => {
    try { localStorage.setItem("kami:viewMode", kamiViewMode); } catch {}
  }, [kamiViewMode]);

  const [showGuides, setShowGuides] = useState<boolean>(() => {
    try { return localStorage.getItem("kami:showGuides") === "true"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("kami:showGuides", String(showGuides)); } catch {}
  }, [showGuides]);

  // Which .page index within the current HTML is active (0-indexed).
  // Focus shows one page; Book shows this page + next page (or cover-on-right
  // when index is 0).
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  // Bump when the iframe reloads so thumbnails refresh their scaled render.
  const [iframeRenderTick, setIframeRenderTick] = useState(0);

  // Previous activePageIndex, used by the book-mode page-turn effect to
  // decide direction and to skip non-navigation updates (contentSet / file
  // changes reset activePageIndex to 0 — we don't want a bogus flip then).
  const prevBookIndexRef = useRef(activePageIndex);

  // Book-mode navigation arrows: hidden by default so they don't compete
  // with the book content (they otherwise pin right against the page
  // edge when the spread fills the container). Shown when the cursor
  // enters either edge zone, hidden again 2s after the cursor stops
  // moving or leaves the viewer.
  const [navVisible, setNavVisible] = useState(false);
  const navIdleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const VIEWPORT_PRESETS = useMemo(
    () => buildKamiPreset(config ?? undefined),
    [config?.paperSize, config?.orientation, config?.pageWidthMm, config?.pageHeightMm],
  );

  // Domain source: the full Site (every content set's page list), keyed
  // by content-set prefix. Pick the active bucket at render time; fall
  // back to the first one if activeContentSet hasn't been set yet.
  const siteSource = sources.site as Source<Site>;
  const { value: site } = useSource(siteSource);
  // Companion file-glob: raw HTML/CSS/JS content used by iframe srcdoc
  // construction and handleTextEdit (splicing <body> edits back into the
  // full original document).
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue } = useSource(filesSource);
  const files: ViewerFileContent[] = filesValue ?? [];
  const pageEntries = useMemo<PageEntry[]>(() => {
    if (!site) return [];
    const key = activeContentSet ?? "";
    const bucket = site.byContentSet[key];
    if (bucket) return bucket.pages;
    const firstKey = Object.keys(site.byContentSet)[0];
    if (firstKey === undefined) return [];
    return site.byContentSet[firstKey].pages;
  }, [site, activeContentSet]);

  const htmlFiles = useMemo(
    () => pageEntries.map((p) => p.file),
    [pageEntries],
  );

  // Determine which file to show
  const currentFile = useMemo(() => {
    if (activeFile && htmlFiles.includes(activeFile)) return activeFile;
    if (selectedFile && htmlFiles.includes(selectedFile)) return selectedFile;
    return htmlFiles.find((f) => /^index\.html$/i.test(f)) || htmlFiles[0] || "";
  }, [activeFile, selectedFile, htmlFiles]);

  // Reset active page index when content set or file switches, so a
  // freshly-opened doc starts from its first .page.
  useEffect(() => {
    setActivePageIndex(0);
  }, [activeContentSet, currentFile]);

  // Compute base href for correct relative asset resolution
  const baseHref = useMemo(() => {
    const apiBase = import.meta.env.DEV
      ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`
      : "";
    if (activeContentSet) {
      return `${apiBase}/content/${activeContentSet}/`;
    }
    return `${apiBase}/content/`;
  }, [activeContentSet]);

  // Build srcdoc for the current file.
  //
  // Note on path resolution: `currentFile` is the manifest-relative path
  // like "index.html" (unprefixed). After P5.11 removed the useViewerProps
  // content-set remap, the raw files from `sources.files` carry the
  // content-set prefix like "gazette/index.html". We reconstruct the
  // fully-qualified path before lookup.
  const srcdoc = useMemo(() => {
    if (!currentFile) return "";
    const fullPath = activeContentSet
      ? `${activeContentSet}/${currentFile}`
      : currentFile;
    const fileContent = files.find((f) => f.path === fullPath);
    if (!fileContent) return "";
    return buildSrcdoc(fileContent.content, baseHref);
  }, [currentFile, files, baseHref, activeContentSet]);

  // Stable srcdoc: only update when the actual file content changes (not on
  // every `files` array reference change).  This prevents the iframe from
  // reloading — and resetting scroll position — due to unrelated store updates.
  const stableSrcdocRef = useRef("");

  useEffect(() => {
    if (!iframeRef.current || !srcdoc) return;
    if (stableSrcdocRef.current !== srcdoc) {
      stableSrcdocRef.current = srcdoc;
    }
    // Always assign srcdoc — the iframe DOM node may have been replaced by
    // a viewport switch (Full ↔ Device) which conditionally renders different
    // iframe structures.  Without this, the new iframe mounts blank.
    iframeRef.current.srcdoc = srcdoc;
  }, [srcdoc, viewport]);

  // ── Selection & edit mode handling ──────────────────────────────────────────

  const isSelectMode = previewMode === "select" || previewMode === "annotate";
  const isEditMode = previewMode === "edit";

  // Send selectMode postMessage to iframe when mode changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        { type: "pneuma:selectMode", enabled: isSelectMode },
        "*",
      );
    } catch {}
  }, [isSelectMode]);

  // Send editMode postMessage to iframe when mode changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        { type: "pneuma:editMode", enabled: isEditMode },
        "*",
      );
    } catch {}
  }, [isEditMode]);

  // Measure each <div class="page">'s real content height against the
  // paper's safe area (printable zone inside safe margins) and publish
  // the result to .pneuma/kami-fit.json. The agent reads that report
  // after each edit to tune content toward a perfect fill — the classic
  // kami authoring loop, now with print-typography semantics.
  //
  // Five statuses, measured as (content_height - safe_height):
  //   delta < -30mm       → "sparse"   (tail leaves too much blank)
  //   delta in [-30, -3)  → "loose"    (slight blank at bottom)
  //   delta in [-3,  +3]  → "fits"     (content lands on the safe edge — ideal)
  //   delta in (+3, +safe_bottom]  → "bleed"  (content crept into margin zone
  //                                            but still within paper — acceptable)
  //   delta > safe_bottom → "overflow" (content pushed past paper edge; clipped)
  //
  // Content height is summed from the .page's direct children's bounding
  // rects (top of first → bottom of last). Using scrollHeight would be
  // incorrect because the new .page model uses overflow: hidden + fixed
  // height, so scrollHeight can cap or lie about true overflow.
  const measureFit = useCallback((iframe: HTMLIFrameElement) => {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const pageHeightMm = config?.pageHeightMm ?? 297;
      const pageWidthMm  = config?.pageWidthMm  ?? 210;
      const paperSize    = config?.paperSize    ?? "A4";
      const orientation  = config?.orientation  ?? "Portrait";
      const safeTopMm    = Number(config?.safeTopMm)    || 18;
      const safeSideMm   = Number(config?.safeSideMm)   || 16;
      const safeBottomMm = Number(config?.safeBottomMm) || 18;
      const MM_PER_PX = 25.4 / 96;

      const safeHeightMm = pageHeightMm - safeTopMm - safeBottomMm;
      const round = (n: number) => Math.round(n * 10) / 10;

      const pageEls = Array.from(doc.querySelectorAll<HTMLElement>(".page"));

      // Measure in an isolated "scroll-like" layout regardless of the
      // current view mode. Focus / Book modes reshape the document (hide
      // non-active pages, switch body to flex, etc.) — measuring in those
      // layouts would yield misleading content heights. Disable the
      // injected view-mode stylesheet for the duration of the measurement
      // so every .page sits in its natural block-flow context.
      const viewStyle = doc.getElementById("kami-view-style") as HTMLStyleElement | null;
      const savedMedia = viewStyle?.media ?? "";
      if (viewStyle) viewStyle.media = "not all"; // disables the rules
      // Force a synchronous layout so the bounding rects reflect the
      // disabled stylesheet.
      void pageEls[0]?.offsetHeight;

      const pages = pageEls.map((el, i) => {
        // Sum direct-children content height. Skip absolutely-positioned
        // children (guides, decorations) and zero-height children.
        const children = Array.from(el.children) as HTMLElement[];
        let contentPx = 0;
        let firstTop: number | null = null;
        let lastBottom: number | null = null;
        for (const child of children) {
          const cs = iframe.contentWindow?.getComputedStyle(child);
          if (cs && (cs.position === "absolute" || cs.position === "fixed")) continue;
          const rect = child.getBoundingClientRect();
          if (rect.height <= 0) continue;
          if (firstTop === null) firstTop = rect.top;
          lastBottom = rect.bottom;
        }
        if (firstTop !== null && lastBottom !== null) {
          contentPx = lastBottom - firstTop;
        }
        const contentMm = round(contentPx * MM_PER_PX);
        const deltaMm = round(contentMm - safeHeightMm);

        let status: "sparse" | "loose" | "fits" | "bleed" | "overflow";
        if (deltaMm < -30)              status = "sparse";
        else if (deltaMm < -3)          status = "loose";
        else if (deltaMm <= 3)          status = "fits";
        else if (deltaMm <= safeBottomMm) status = "bleed";
        else                            status = "overflow";

        return {
          index: i + 1,
          paper_height_mm: pageHeightMm,
          safe_height_mm:  round(safeHeightMm),
          content_height_mm: contentMm,
          delta_safe_mm:     deltaMm,
          status,
        };
      });

      // Re-enable the injected view-mode stylesheet.
      if (viewStyle) viewStyle.media = savedMedia;

      const count = (s: string) => pages.filter((p) => p.status === s).length;
      const report = {
        updated_at: new Date().toISOString(),
        content_set: activeContentSet || null,
        file: currentFile || null,
        paper: {
          size: paperSize,
          orientation,
          width_mm: pageWidthMm,
          height_mm: pageHeightMm,
          safe: { top_mm: safeTopMm, side_mm: safeSideMm, bottom_mm: safeBottomMm },
        },
        pages,
        summary: {
          total_pages:    pages.length,
          sparse_count:   count("sparse"),
          loose_count:    count("loose"),
          fits_count:     count("fits"),
          bleed_count:    count("bleed"),
          overflow_count: count("overflow"),
        },
      };

      fileChannel.write(
        ".pneuma/kami-fit.json",
        JSON.stringify(report, null, 2) + "\n",
      ).catch(() => { /* ignore — fit is an advisory channel */ });
    } catch {
      /* ignore — measurement must never break the viewer */
    }
  }, [config, activeContentSet, currentFile, fileChannel]);

  // Inject view-mode + guide styles into an iframe's document.
  // Idempotent — replaces any previously-injected <style data-kami-view>.
  const applyViewModeStyles = useCallback(
    (doc: Document, opts: {
      mode: KamiViewMode;
      activeIdx: number;
      showGuides: boolean;
      scope?: "main" | "thumb";
      thumbPageIndex?: number;   // thumb-only: which single page to show
    }) => {
      const pageEls = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
      pageEls.forEach((el, i) => {
        el.dataset.kamiIndex = String(i);
        el.classList.toggle("show-guides", !!opts.showGuides);
      });

      let css = "";
      if (opts.scope === "thumb") {
        // Thumbnail: show only the requested page, no body-level layout change.
        const i = opts.thumbPageIndex ?? 0;
        css = `.page[data-kami-index]:not([data-kami-index="${i}"]) { display: none !important; }
html, body { background: transparent !important; }
body { margin: 0 !important; padding: 0 !important; }
.page { margin: 0 !important; box-shadow: none !important; animation: none !important; }`;
      } else if (opts.mode === "focus") {
        css = `.page[data-kami-index]:not([data-kami-index="${opts.activeIdx}"]) { display: none !important; }
body { margin: 0 !important; padding: 0 !important; background: #d9d6ca !important; }
.page { margin: 0 auto !important; }`;
      } else if (opts.mode === "book") {
        // Use the shared spreadPair to avoid duplicate logic. 2-page
        // content hits the i=1 + right-out-of-range fallback and gets
        // rendered as a real two-page spread instead of one page
        // awkwardly centred across the spine.
        const { left, right } = spreadPair(opts.activeIdx, pageEls.length);
        const visible = [left, right].filter((x): x is number => x !== null);
        const keep = visible.map((v) => `[data-kami-index="${v}"]`).join(",");
        // animation: none disables the shared stylesheet's fadeIn so the
        // arriving spread appears at full opacity immediately; the
        // outgoing spread's cloned overlay is what fades out (see
        // runBookCrossfade). Running the keyframe on .page at the same
        // time as the clone-fade creates a dim midpoint where both
        // layers are partially transparent and the iframe background
        // bleeds through — that's the "flash / jump" the user saw.
        css = `.page[data-kami-index]:not(${keep}) { display: none !important; }
html, body { margin: 0 !important; padding: 0 !important; background: #d9d6ca !important; }
body { display: flex !important; justify-content: center !important; align-items: flex-start !important; gap: 0 !important; position: relative !important; }
.page { margin: 0 !important; animation: none !important; }
/* Cover (only right page visible) — push the single sheet into the right
   half so the left half stays blank. Back-cover-style (only left visible)
   mirrors it. */
${left === null && right !== null ? `.page[data-kami-index="${right}"] { margin-left: var(--page-width) !important; }` : ''}
${right === null && left !== null ? `.page[data-kami-index="${left}"] { margin-right: var(--page-width) !important; }` : ''}
/* Spine gutter: darker seam + page curl on the inner edges. */
body::after {
  content: '';
  position: fixed;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 40px;
  transform: translateX(-50%);
  background:
    linear-gradient(to right,
      rgba(20, 20, 19, 0) 0%,
      rgba(20, 20, 19, 0.05) 35%,
      rgba(20, 20, 19, 0.16) 50%,
      rgba(20, 20, 19, 0.05) 65%,
      rgba(20, 20, 19, 0) 100%);
  pointer-events: none;
  z-index: 10;
}`;
      } else {
        // Scroll: no layout change beyond guides.
        css = "";
      }

      const styleId = "kami-view-style";
      let style = doc.getElementById(styleId) as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement("style");
        style.id = styleId;
        style.setAttribute("data-kami-view", "");
        doc.head.appendChild(style);
      }
      style.textContent = css;

      return pageEls.length;
    },
    [],
  );

  // Also send selectMode and editMode after iframe loads
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        { type: "pneuma:selectMode", enabled: isSelectMode },
        "*",
      );
      iframe.contentWindow.postMessage(
        { type: "pneuma:editMode", enabled: isEditMode },
        "*",
      );
    } catch {}
    // Count pages + apply view-mode CSS immediately so the first paint is
    // already in the selected layout.
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        const n = applyViewModeStyles(doc, {
          mode: kamiViewMode,
          activeIdx: activePageIndex,
          showGuides,
          scope: "main",
        });
        setPageCount(Math.max(1, n));
        setIframeRenderTick((t) => t + 1);
      }
    } catch {}
    // Give fonts + layout a frame to settle, then publish the fit report.
    // 500ms covers TsangerJinKai02's first swap without feeling sluggish
    // to the agent's next edit.
    setTimeout(() => measureFit(iframe), 500);
  }, [isSelectMode, isEditMode, measureFit, applyViewModeStyles, kamiViewMode, activePageIndex, showGuides]);

  // Re-apply view-mode styles whenever mode, guides, or active page change
  // without a full iframe reload.
  useEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    try {
      applyViewModeStyles(doc, {
        mode: kamiViewMode,
        activeIdx: activePageIndex,
        showGuides,
        scope: "main",
      });
    } catch {}
    // Reset the outer scroll container when leaving scroll mode so a
    // residual scrollTop from scroll mode doesn't offset the centered
    // single/spread layout of focus / book.
    if (kamiViewMode !== "scroll") {
      const container = containerRef.current;
      if (container) container.scrollTop = 0;
    }
  }, [kamiViewMode, activePageIndex, showGuides, applyViewModeStyles]);

  // Book-mode spread crossfade: clone the outgoing spread and fade it
  // out; the incoming spread sits underneath already at opacity 1, so
  // the user sees it smoothly revealed as the clone dissolves. No
  // keyframe on the new pages — two-sided opacity interpolation dims
  // through the midpoint and looks like a blink.
  useEffect(() => {
    const prev = prevBookIndexRef.current;
    prevBookIndexRef.current = activePageIndex;
    if (kamiViewMode !== "book") return;
    if (prev === activePageIndex) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    return runBookCrossfade(doc, prev, activePageIndex, pageCount);
  }, [activePageIndex, kamiViewMode, pageCount]);

  // Book-mode nav-arrow auto-hide. Arrows appear when the cursor moves
  // inside the viewer container, stay for 2s after the last movement,
  // then fade out. They also hide immediately on mouseleave.
  useEffect(() => {
    if (kamiViewMode !== "book" || pageCount <= 1) {
      setNavVisible(false);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const show = () => {
      setNavVisible(true);
      clearTimeout(navIdleTimerRef.current);
      navIdleTimerRef.current = setTimeout(() => setNavVisible(false), 2000);
    };
    const hide = () => {
      clearTimeout(navIdleTimerRef.current);
      setNavVisible(false);
    };
    container.addEventListener("mousemove", show);
    container.addEventListener("mouseenter", show);
    container.addEventListener("mouseleave", hide);
    return () => {
      container.removeEventListener("mousemove", show);
      container.removeEventListener("mouseenter", show);
      container.removeEventListener("mouseleave", hide);
      clearTimeout(navIdleTimerRef.current);
    };
  }, [kamiViewMode, pageCount]);

  // ── Keyboard page navigation ───────────────────────────────────────────────
  //
  // Each view mode owns its own interpretation of "next / previous":
  //   scroll : snap the outer container one paper-height at a time
  //   focus  : step activePageIndex by one page
  //   book   : step activePageIndex by one spread (same math as BookNav)
  //
  // Keys are attached to document, but suppressed whenever focus is in a
  // text input / textarea / contenteditable (the chat composer), so the
  // user can still type arrows inside prompts without flipping pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key;
      const isNext = k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Spacebar";
      const isPrev = k === "ArrowLeft"  || k === "ArrowUp"   || k === "PageUp"   || (k === " " && e.shiftKey);
      const isHome = k === "Home";
      const isEnd  = k === "End";
      if (!isNext && !isPrev && !isHome && !isEnd) return;

      if (kamiViewMode === "focus") {
        e.preventDefault();
        if (isHome)      setActivePageIndex(0);
        else if (isEnd)  setActivePageIndex(Math.max(pageCount - 1, 0));
        else if (isNext) setActivePageIndex((i) => Math.min(i + 1, pageCount - 1));
        else             setActivePageIndex((i) => Math.max(i - 1, 0));
      } else if (kamiViewMode === "book") {
        e.preventDefault();
        const lastSpread = pageCount <= 1 ? 0
          : (pageCount - 1) % 2 === 1 ? pageCount - 1 : pageCount - 2;
        if (isHome)      setActivePageIndex(0);
        else if (isEnd)  setActivePageIndex(Math.max(lastSpread, 0));
        else if (isNext) setActivePageIndex((i) => {
          if (i === 0) return Math.min(1, pageCount - 1);
          const normalized = i % 2 === 1 ? i : i - 1;
          const next = normalized + 2;
          return next < pageCount ? next : i;
        });
        else             setActivePageIndex((i) => {
          if (i === 0) return 0;
          const normalized = i % 2 === 1 ? i : i - 1;
          const prev = normalized - 2;
          return prev < 1 ? 0 : prev;
        });
      } else {
        // scroll mode: jump one paper-height per press; let raw arrows
        // through so native fine-grained scroll still works, but hijack
        // PgUp/PgDn/Home/End/Space to step by whole pages.
        if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") return;
        const container = containerRef.current;
        if (!container) return;
        e.preventDefault();
        const stepPx = pageCount > 0 ? container.scrollHeight / pageCount : container.clientHeight;
        if (isHome)      container.scrollTo({ top: 0,                         behavior: "smooth" });
        else if (isEnd)  container.scrollTo({ top: container.scrollHeight,    behavior: "smooth" });
        else if (isNext) container.scrollBy({ top: stepPx,                    behavior: "smooth" });
        else             container.scrollBy({ top: -stepPx,                   behavior: "smooth" });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [kamiViewMode, pageCount]);

  // ── Text edit handling ────────────────────────────────────────────────────

  const pendingChangesRef = useRef<{ tag: string; before: string; after: string }[]>([]);
  const editTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleTextEdit = useCallback((file: string, html: string, changes?: { tag: string; before: string; after: string }[]) => {
    if (changes?.length) pendingChangesRef.current.push(...changes);
    clearTimeout(editTimerRef.current);
    editTimerRef.current = setTimeout(() => {
      // Reconstruct the full HTML document by replacing the body content.
      // `file` is the manifest-relative path (e.g. "index.html"); the raw
      // `files` array from sources.files carries the content-set prefix
      // (e.g. "gazette/index.html"), so we fully qualify before looking up.
      const fullPath = activeContentSet
        ? `${activeContentSet}/${file}`
        : file;
      const fileContent = files.find((f) => f.path === fullPath);
      if (!fileContent) return;
      const original = fileContent.content;
      let updated: string;
      if (/<body[^>]*>/i.test(original)) {
        // Function replacement, NOT `$1\n${html}\n$3` — a string replacement
        // would interpret $1/$2/$3 inside `html` as capture-group references,
        // turning e.g. "$350B" into "</body>50B" and "$1T" into "<body>T"
        // (the regex's capture groups 1 and 3 are the body-open/close tags).
        // Kami's resume/portfolio demos carry plenty of currency figures;
        // function replacement sidesteps the dollar-sign substitution rules.
        updated = original.replace(
          /(<body[^>]*>)([\s\S]*?)(<\/body>)/i,
          (_m, open, _body, close) => `${open}\n${html}\n${close}`,
        );
      } else {
        updated = html;
      }

      // Persist via the source-aware file channel (origin-tagged "self").
      const savePath = activeContentSet ? `${activeContentSet}/${file}` : file;
      fileChannel.write(savePath, updated).catch((err) => {
        console.error("[webcraft] save failed", err);
      });

      // Record user action
      const batch = pendingChangesRef.current.splice(0);
      const diffLines = batch.map((c) => `  <${c.tag}>: "${c.before}" → "${c.after}"`);
      const desc = diffLines.length > 0
        ? `Edited text on "${file}":\n${diffLines.join("\n")}`
        : `Edited text on "${file}"`;
      useStore.getState().pushUserAction({
        timestamp: Date.now(),
        actionId: "edit-text",
        description: desc,
      });
    }, 800);
  }, [files, activeContentSet, fileChannel]);

  // Listen for selection and text edit messages from iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "pneuma:textEdit") {
        handleTextEdit(currentFile, e.data.html, e.data.changes);
        return;
      }
      if (e.data?.type === "pneuma:select") {
        const sel = e.data.selection;
        if (!sel) {
          if (previewMode === "annotate") {
            setPendingAnnotation(null);
          } else {
            onSelect(null);
          }
          return;
        }
        if (previewMode === "annotate") {
          // In annotate mode: show popover instead of selecting
          if (!sel.rect) return;
          setPendingAnnotation({
            selection: sel,
            pageFile: currentFile,
            rect: sel.rect,
          });
        } else {
          onSelect({
            type: sel.type,
            content: sel.content,
            level: sel.level,
            file: currentFile,
            tag: sel.tag,
            classes: sel.classes,
            selector: sel.selector,
            thumbnail: sel.thumbnail,
            label: sel.label,
            nearbyText: sel.nearbyText,
            accessibility: sel.accessibility,
          });
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [currentFile, onSelect, handleTextEdit, previewMode]);

  // Confirm pending annotation with comment
  const confirmAnnotation = useCallback(
    (comment: string) => {
      if (!pendingAnnotation) return;
      const { selection: sel, pageFile } = pendingAnnotation;
      addAnnotation({
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        slideFile: pageFile,
        element: {
          file: pageFile,
          type: sel.type as import("../../../src/types.js").SelectionType,
          content: sel.content,
          level: sel.level,
          tag: sel.tag,
          classes: sel.classes,
          selector: sel.selector,
          thumbnail: sel.thumbnail,
          label: sel.label,
          nearbyText: sel.nearbyText,
          accessibility: sel.accessibility,
        },
        comment,
      });
      setPendingAnnotation(null);
    },
    [pendingAnnotation, addAnnotation],
  );

  // Dismiss pending annotation on page navigation
  useEffect(() => { setPendingAnnotation(null); }, [currentFile]);

  // Escape key: dismiss popover first, then exit mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // If annotation popover is open, dismiss it first (don't exit mode)
        if (pendingAnnotation) {
          setPendingAnnotation(null);
          return;
        }
        if (previewMode === "select" || previewMode === "annotate" || previewMode === "edit") {
          setPreviewMode("view");
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMode, setPreviewMode, pendingAnnotation]);

  // ── Page navigation ─────────────────────────────────────────────────────────

  const handlePageChange = useCallback(
    (page: string) => {
      setSelectedFile(page);
      onActiveFileChange?.(page);
      onSelect(null);
    },
    [onActiveFileChange, onSelect],
  );

  // ── Locator navigation from chat cards ──────────────────────────────────────
  useEffect(() => {
    if (!navigateRequest) return;
    const { data } = navigateRequest;
    if (data.page || data.file) {
      const target = (data.page || data.file) as string;
      if (htmlFiles.includes(target)) {
        handlePageChange(target);
      }
    }
    onNavigateComplete?.();
  }, [navigateRequest]);

  // ── Viewport preset handling ─────────────────────────────────────────────────

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Track container size for viewport scaling (skip no-op updates to avoid re-renders)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        const h = Math.round(entry.contentRect.height);
        setContainerSize((prev) =>
          prev.width === w && prev.height === h ? prev : { width: w, height: h },
        );
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Compute iframe dimensions and scale based on viewport preset + view mode.
  //
  // • scroll : single paper column, iframe tall enough for all pages
  //            (height = paper × pageCount), outer scroll provided by
  //            container (scale-to-fit-width).
  // • focus  : single paper sheet sized to the preset, scale to fit.
  // • book   : two paper sheets side by side — iframe width = 2 × paper
  //            width — scale to fit.
  const iframeLayout = useMemo(() => {
    const preset = VIEWPORT_PRESETS.find((p) => p.id === viewport);
    if (!preset || preset.width === 0) {
      return { width: "100%", height: "100%", scale: 1, useTransform: false, fitMode: "none" as const };
    }

    const pw = preset.width;
    const ph = preset.height;
    const cw = containerSize.width;
    const ch = containerSize.height;

    // Iframe's "natural" (pre-scale) dimensions depend on view mode.
    let naturalW = pw;
    let naturalH = ph;
    let fitMode: "width" | "both" = "both";
    if (kamiViewMode === "scroll") {
      naturalW = pw;
      naturalH = Math.max(ph * pageCount, ph);
      fitMode = "width";
    } else if (kamiViewMode === "book") {
      naturalW = pw * 2;
      naturalH = ph;
      fitMode = "both";
    } else {
      naturalW = pw;
      naturalH = ph;
      fitMode = "both";
    }

    if (cw === 0 || ch === 0) {
      return {
        width: `${naturalW}px`,
        height: `${naturalH}px`,
        scale: 1,
        useTransform: false,
        fitMode,
      };
    }

    const padding = 32;
    const availW = cw - padding * 2;
    const availH = ch - padding * 2;
    const scaleX = availW / naturalW;
    const scaleY = availH / naturalH;
    // Scroll mode fits to width only (vertical overflow scrolls), focus/book
    // fit to both axes.
    const scale = fitMode === "width"
      ? Math.min(scaleX, 1)
      : Math.min(scaleX, scaleY, 1);

    return {
      width: `${naturalW}px`,
      height: `${naturalH}px`,
      scale,
      useTransform: true,
      fitMode,
    };
  }, [viewport, containerSize, kamiViewMode, pageCount, VIEWPORT_PRESETS]);

  // ── Export handlers ─────────────────────────────────────────────────────────

  // Export = pop a new tab with kami's dedicated export page. The page is
  // a fork of the webcraft export chrome, simplified for paper-canvas mode:
  // no viewport presets (paper size is locked), a "Download HTML" button
  // that produces a self-contained letterbox-wrapped document, and a
  // "Screenshot PNG" button that captures each .page at the locked paper
  // dimensions (single paper → 1 PNG; multi-page → ZIP of PNGs). Printing
  // is deliberately not surfaced — users who want a PDF print the
  // downloaded HTML or the screenshot bundle externally.
  //
  // Relative URL so Vite's /export proxy picks it up regardless of which
  // backend port the server ended up on.
  const handleExport = useCallback(() => {
    const cs = useStore.getState().activeContentSet;
    const qs = new URLSearchParams();
    if (cs) qs.set("contentSet", cs);
    window.open(`/export/kami${qs.toString() ? "?" + qs.toString() : ""}`, "_blank");
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* Main Preview Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Viewport Toolbar */}
        <ViewportToolbar
          presets={VIEWPORT_PRESETS}
          activePreset={viewport}
          onPresetChange={setViewport}
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
          onExport={handleExport}
          readonly={readonly}
          kamiViewMode={kamiViewMode}
          onKamiViewModeChange={setKamiViewMode}
          showGuides={showGuides}
          onToggleGuides={() => setShowGuides((g) => !g)}
        />

        {/* View-mode container: optional focus sidebar + main iframe area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden", minHeight: 0 }}>
          {/* Focus mode: left thumbnail strip */}
          {kamiViewMode === "focus" && pageCount > 0 && (
            <KamiThumbStrip
              pageCount={pageCount}
              activeIndex={activePageIndex}
              onPick={setActivePageIndex}
            />
          )}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            position: "relative",
            background: "#d9d6ca",
            overflow: kamiViewMode === "scroll" ? "auto" : "hidden",
            display: "flex",
            alignItems: kamiViewMode === "scroll" ? "flex-start" : "center",
            justifyContent: "center",
            padding: kamiViewMode === "scroll" ? "24px 0" : 0,
          }}
        >
          {currentFile && srcdoc ? (
            iframeLayout.useTransform ? (
              /* Device viewport mode: centered, scaled iframe with device frame */
              <div
                style={{
                  width: iframeLayout.width,
                  height: iframeLayout.height,
                  position: "relative",
                  transform: `scale(${iframeLayout.scale})`,
                  transformOrigin: kamiViewMode === "scroll" ? "top center" : "center center",
                  borderRadius: "2px",
                  overflow: "hidden",
                  boxShadow: kamiViewMode === "scroll"
                    ? "none"
                    : "0 0 0 1px #d1cfc5, 0 8px 24px rgba(20,20,19,0.10)",
                  flexShrink: 0,
                  background: "#d9d6ca",
                }}
              >
                <iframe
                  ref={iframeRef}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "none",
                    display: "block",
                    background: "#f5f4ed",
                  }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  title="Kami Preview"
                  onLoad={handleIframeLoad}
                />
              </div>
            ) : (
              /* Fallback (unreachable in kami — buildKamiPreset always yields a fixed-size preset) */
              <iframe
                ref={iframeRef}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  display: "block",
                  background: "#f5f4ed",
                }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                title="Kami Preview"
                onLoad={handleIframeLoad}
              />
            )
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                width: "100%",
                color: "rgba(0,0,0,0.4)",
                fontSize: "14px",
                background: "#fafafa",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.5 }}>{"\uD83C\uDF10"}</div>
                <div>No HTML files in workspace</div>
                <div style={{ fontSize: "12px", marginTop: "4px", opacity: 0.6 }}>
                  Create an HTML file to see a live preview
                </div>
              </div>
            </div>
          )}
          {/* Annotation Popover */}
          {pendingAnnotation && (
            <AnnotationPopover
              style={(() => {
                const { rect } = pendingAnnotation;
                const POPOVER_W = 280;
                const POPOVER_H = 130;
                const container = containerRef.current;
                const iframe = iframeRef.current;
                if (!container || !iframe) return { position: "absolute" as const, top: 100, left: 100, width: POPOVER_W, zIndex: 50 };

                const containerRect = container.getBoundingClientRect();
                const iframeRect = iframe.getBoundingClientRect();

                // Translate iframe-relative rect to container-relative coords
                // For scaled viewports, account for the CSS transform scale
                const scale = iframeLayout.useTransform ? iframeLayout.scale : 1;
                const offsetX = iframeRect.left - containerRect.left;
                const offsetY = iframeRect.top - containerRect.top;

                let top = offsetY + rect.bottom * scale + 8;
                if (top + POPOVER_H > containerRect.height) {
                  top = offsetY + rect.top * scale - POPOVER_H - 8;
                }
                top = Math.max(8, top);

                let left = offsetX + rect.left * scale;
                left = Math.max(8, Math.min(left, containerRect.width - POPOVER_W - 8));

                return { position: "absolute" as const, top, left, width: POPOVER_W, zIndex: 50 };
              })()}
              label={pendingAnnotation.selection.label}
              thumbnail={pendingAnnotation.selection.thumbnail}
              onConfirm={confirmAnnotation}
              onCancel={() => setPendingAnnotation(null)}
            />
          )}
          {/* Book-mode navigation arrows + pair counter */}
          {kamiViewMode === "book" && pageCount > 1 && (
            <BookNav
              activeIndex={activePageIndex}
              pageCount={pageCount}
              onPick={setActivePageIndex}
              visible={navVisible}
            />
          )}
          {/* Focus/Book mode: page position indicator */}
          {(kamiViewMode === "focus" || kamiViewMode === "book") && pageCount > 1 && (
            <div style={{
              position: "absolute",
              bottom: 10,
              left: 14,
              fontSize: 11,
              color: "rgba(20,20,19,0.55)",
              fontFamily: "Newsreader, Georgia, serif",
              letterSpacing: 0.2,
              pointerEvents: "none",
              zIndex: 4,
            }}>
              {(() => {
                if (kamiViewMode !== "book" || activePageIndex === 0) {
                  return `${activePageIndex + 1} / ${pageCount}`;
                }
                // Use the same spreadPair the viewer CSS uses so the
                // counter always matches what's on screen — including
                // the 2-page edge case where i=1 shows [0, 1].
                const { left, right } = spreadPair(activePageIndex, pageCount);
                const l = left  !== null ? left  + 1 : null;
                const r = right !== null ? right + 1 : null;
                if (l !== null && r !== null && l !== r) return `${l}–${r} / ${pageCount}`;
                return `${(l ?? r)!} / ${pageCount}`;
              })()}
            </div>
          )}
        </div>
        </div>

        {/* Bottom Page Navigator — only shown when 2+ pages exist */}
        {pageEntries.length >= 2 && (
          <PageNavigator
            pages={pageEntries}
            activePage={currentFile}
            onPageChange={handlePageChange}
            baseHref={baseHref}
          />
        )}
      </div>
    </div>
  );
}
