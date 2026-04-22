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

function ViewportToolbar({
  presets,
  activePreset,
  onPresetChange,
  previewMode,
  onSetPreviewMode,
  onExport,
  readonly,
}: {
  presets: ViewportPreset[];
  activePreset: string;
  onPresetChange: (presetId: string) => void;
  previewMode: PreviewMode;
  onSetPreviewMode: (mode: PreviewMode) => void;
  onExport: () => void;
  readonly?: boolean;
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
      {/* Left: Viewport presets */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
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

      {/* Right: Export */}
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
  type KamiConfig = { paperSize?: string; orientation?: string; pageWidthMm?: number; pageHeightMm?: number };
  const configSource = sources.config as Source<KamiConfig> | undefined;
  const { value: config } = useSource<KamiConfig>(configSource);

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
  }, [isSelectMode, isEditMode]);

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

  // Compute iframe dimensions and scale based on viewport preset
  const iframeLayout = useMemo(() => {
    const preset = VIEWPORT_PRESETS.find((p) => p.id === viewport);
    if (!preset || preset.width === 0) {
      // Full mode: fill container
      return { width: "100%", height: "100%", scale: 1, useTransform: false };
    }

    const pw = preset.width;
    const ph = preset.height;
    const cw = containerSize.width;
    const ch = containerSize.height;

    if (cw === 0 || ch === 0) {
      return { width: `${pw}px`, height: `${ph}px`, scale: 1, useTransform: false };
    }

    // Calculate scale to fit the preset within the container with padding
    const padding = 32;
    const availW = cw - padding * 2;
    const availH = ch - padding * 2;
    const scaleX = availW / pw;
    const scaleY = availH / ph;
    const scale = Math.min(scaleX, scaleY, 1); // Never scale up beyond 1:1

    return { width: `${pw}px`, height: `${ph}px`, scale, useTransform: true };
  }, [viewport, containerSize]);

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
        />

        {/* Iframe Preview Container */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            position: "relative",
            background: "#d9d6ca",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {currentFile && srcdoc ? (
            iframeLayout.useTransform ? (
              /* Device viewport mode: centered, scaled iframe with device frame */
              <div
                style={{
                  width: iframeLayout.width,
                  height: iframeLayout.height,
                  transform: `scale(${iframeLayout.scale})`,
                  transformOrigin: "center center",
                  borderRadius: "2px",
                  overflow: "hidden",
                  boxShadow: "0 0 0 1px #d1cfc5, 0 8px 24px rgba(20,20,19,0.10)",
                  flexShrink: 0,
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
          {/* Design attribution — kami's visual language is adapted from
              tw93/kami (MIT); surfaced here so users can find the source. */}
          <a
            href="https://github.com/tw93/kami"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              position: "absolute",
              bottom: 10,
              right: 14,
              fontFamily: "Newsreader, Georgia, serif",
              fontSize: 11,
              letterSpacing: 0.2,
              color: "rgba(20,20,19,0.45)",
              textDecoration: "none",
              pointerEvents: "auto",
              zIndex: 5,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#1B365D")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(20,20,19,0.45)")}
            title="Design language adapted from tw93/kami (MIT). Click to open the source repository."
          >
            Design adapted from tw93/kami <span aria-hidden="true">↗</span>
          </a>
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
