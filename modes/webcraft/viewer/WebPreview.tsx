/**
 * WebPreview — WebCraft Mode viewer component.
 *
 * Implements ViewerContract's PreviewComponent.
 * Shows live web preview in an iframe with:
 * - Impeccable command sidebar
 * - Selection script injection (select/annotate modes)
 * - Responsive viewport presets
 * - Bottom page navigator for multi-page sites
 */

import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from "react";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { useResilientParse } from "../../../core/hooks/use-resilient-parse.js";
import { buildSelectionScript } from "../../../core/iframe-selection/index.js";
import { useStore } from "../../../src/store.js";

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
    var els = document.querySelectorAll(tags);
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
  maximize:   <svg {...svgProps}><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
  smartphone: <svg {...svgProps}><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>,
  tablet:     <svg {...svgProps}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>,
  monitor:    <svg {...svgProps}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,

  // Category
  settings:   <svg {...svgProps}><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  search:     <svg {...svgProps}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
  sparkles:   <svg {...svgProps}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75L19 13z"/></svg>,
  zap:        <svg {...svgProps}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
  palette:    <svg {...svgProps}><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12" r="1.5"/><path d="M12 2a10 10 0 0 0-1.16 19.93c.8.1 1.16-.36 1.16-.8v-1.48c0-.83-.67-1.5-1.5-1.5a3 3 0 0 1-3-3c0-1.66 1.34-3 3-3h5a5 5 0 0 0 0-10H12z"/></svg>,
  building:   <svg {...svgProps}><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01"/></svg>,

  // Commands
  graduationCap: <svg {...svgProps}><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/></svg>,
  clipboardCheck: <svg {...svgProps}><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 14l2 2 4-4"/></svg>,
  messageCircle: <svg {...svgProps}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  ruler:      <svg {...svgProps}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.32 4.36a.5.5 0 0 0 .62.62l4.36-1.32a2 2 0 0 0 .83-.5z"/><path d="M15 5l4 4"/><path d="M13.5 6.5l1 1M10.5 9.5l1 1M7.5 12.5l1 1"/></svg>,
  gem:        <svg {...svgProps}><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3l1 10M2 9h20M7.5 3L6 9l6 13M16.5 3L18 9l-6 13"/></svg>,
  flask:      <svg {...svgProps}><path d="M9 3h6M10 9V3M14 9V3"/><path d="M5.5 21h13c.83 0 1.5-.67 1.5-1.5 0-.2-.04-.39-.11-.57L15 9H9l-4.89 9.93A1.5 1.5 0 0 0 5.5 21z"/></svg>,
  lightbulb:  <svg {...svgProps}><path d="M9 18h6M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>,
  gauge:      <svg {...svgProps}><path d="M12 16v-4"/><path d="M12 8h.01"/><circle cx="12" cy="12" r="10"/><path d="M14.31 8l1.5-1.5"/></svg>,
  shield:     <svg {...svgProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  play:       <svg {...svgProps}><circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16"/></svg>,
  droplets:   <svg {...svgProps}><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 14.65c1.35 0 2.44-1.12 2.44-2.48 0-.71-.35-1.38-1.05-1.95S12.78 9 12.56 8.25c-.17.89-.7 1.73-1.4 2.3s-1.05 1.23-1.05 1.95c0 1.36 1.1 2.48 2.44 2.48z"/></svg>,
  flame:      <svg {...svgProps}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>,
  leaf:       <svg {...svgProps}><path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>,
  heart:      <svg {...svgProps}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/></svg>,
  package:    <svg {...svgProps}><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27,6.96 12,12.01 20.73,6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  layoutGrid: <svg {...svgProps}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  userPlus:   <svg {...svgProps}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>,
  type:       <svg {...svgProps}><polyline points="4,7 4,4 20,4 20,7"/><line x1="9.5" y1="20" x2="14.5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>,
  columns:    <svg {...svgProps}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></svg>,
  bolt:       <svg {...svgProps}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/><circle cx="12" cy="12" r="10" fill="none"/></svg>,
};

interface ViewportPreset {
  id: string;
  label: string;
  icon: React.ReactNode;
  width: number;
  height: number;
}

const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: "full", label: "Full", icon: Icons.maximize, width: 0, height: 0 },
  { id: "mobile", label: "Mobile", icon: Icons.smartphone, width: 375, height: 812 },
  { id: "tablet", label: "Tablet", icon: Icons.tablet, width: 768, height: 1024 },
  { id: "desktop", label: "Desktop", icon: Icons.monitor, width: 1280, height: 800 },
];

// ── Impeccable Command Sidebar (built from props.actions) ───────────────────

/** Icon lookup by action id — UI concern, lives in viewer */
const ACTION_ICONS: Record<string, React.ReactNode> = {
  "teach-impeccable": Icons.graduationCap,
  "audit":       Icons.clipboardCheck,
  "critique":    Icons.messageCircle,
  "normalize":   Icons.ruler,
  "polish":      Icons.gem,
  "distill":     Icons.flask,
  "clarify":     Icons.lightbulb,
  "typeset":     Icons.type,
  "arrange":     Icons.columns,
  "optimize":    Icons.gauge,
  "harden":      Icons.shield,
  "animate":     Icons.play,
  "colorize":    Icons.droplets,
  "bolder":      Icons.flame,
  "quieter":     Icons.leaf,
  "delight":     Icons.heart,
  "overdrive":   Icons.bolt,
  "extract":     Icons.package,
  "adapt":       Icons.layoutGrid,
  "onboard":     Icons.userPlus,
};

/** Group definitions — order and categorization for sidebar UI */
const COMMAND_GROUPS: { name: string; icon: React.ReactNode; actionIds: string[] }[] = [
  { name: "Setup",        icon: Icons.settings, actionIds: ["teach-impeccable"] },
  { name: "Review",       icon: Icons.search,   actionIds: ["audit", "critique"] },
  { name: "Refine",       icon: Icons.sparkles,  actionIds: ["normalize", "polish", "distill", "clarify", "typeset", "arrange"] },
  { name: "Performance",  icon: Icons.zap,       actionIds: ["optimize", "harden"] },
  { name: "Style",        icon: Icons.palette,   actionIds: ["animate", "colorize", "bolder", "quieter", "delight", "overdrive"] },
  { name: "Architecture", icon: Icons.building,  actionIds: ["extract", "adapt", "onboard"] },
];

interface CommandCategory {
  name: string;
  icon: React.ReactNode;
  commands: { id: string; label: string; icon: React.ReactNode; description: string }[];
}

/** Build sidebar categories from runtime-injected actions + local icon/group mappings */
function buildCommandCategories(actions: { id: string; label: string; description?: string }[]): CommandCategory[] {
  const actionMap = new Map(actions.map((a) => [a.id, a]));
  return COMMAND_GROUPS.map((group) => ({
    name: group.name,
    icon: group.icon,
    commands: group.actionIds
      .filter((id) => actionMap.has(id))
      .map((id) => {
        const action = actionMap.get(id)!;
        return {
          id: action.id,
          label: action.label,
          icon: ACTION_ICONS[action.id] ?? Icons.sparkles,
          description: action.description ?? "",
        };
      }),
  })).filter((cat) => cat.commands.length > 0);
}

// ── Attribution ──────────────────────────────────────────────────────────────

function ImpeccableAttribution({ collapsed }: { collapsed: boolean }) {
  const [showTooltip, setShowTooltip] = useState(false);

  const footerStyle: CSSProperties = {
    padding: collapsed ? "8px 4px" : "8px 12px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: collapsed ? "center" : "flex-start",
    gap: "6px",
    position: "relative",
  };

  const linkStyle: CSSProperties = {
    fontSize: "10px",
    color: "rgba(255,255,255,0.35)",
    textDecoration: "none",
    transition: "color 0.15s",
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const helpBtnStyle: CSSProperties = {
    background: "none",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "50%",
    width: "15px",
    height: "15px",
    fontSize: "9px",
    color: "rgba(255,255,255,0.35)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
    lineHeight: 1,
    transition: "border-color 0.15s, color 0.15s",
  };

  const tooltipStyle: CSSProperties = {
    position: "absolute",
    bottom: "100%",
    left: collapsed ? "-4px" : "8px",
    marginBottom: "6px",
    width: "260px",
    padding: "10px 12px",
    background: "#141414",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "6px",
    fontSize: "11px",
    lineHeight: 1.55,
    color: "rgba(255,255,255,0.7)",
    boxShadow: "0 8px 30px rgba(0,0,0,0.7)",
    zIndex: 9999,
  };

  return (
    <div style={footerStyle}>
      <a
        href="https://impeccable.style"
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle}
        title="impeccable.style"
        onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}
      >
        {collapsed ? (
          <span style={{ fontSize: "12px" }}>{"*"}</span>
        ) : (
          "impeccable.style"
        )}
      </a>
      <button
        style={helpBtnStyle}
        onClick={() => setShowTooltip(!showTooltip)}
        onBlur={() => setShowTooltip(false)}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
          e.currentTarget.style.color = "rgba(255,255,255,0.6)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
          e.currentTarget.style.color = "rgba(255,255,255,0.35)";
        }}
        title="About design intelligence"
      >
        ?
      </button>
      {showTooltip && (
        <div style={tooltipStyle}>
          <div style={{ fontWeight: 600, marginBottom: "6px", color: "rgba(255,255,255,0.85)" }}>
            Powered by Impeccable
          </div>
          <p style={{ margin: "0 0 8px" }}>
            Design principles and commands are adapted from{" "}
            <a
              href="https://impeccable.style"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#f97316", textDecoration: "none" }}
            >
              impeccable.style
            </a>
            {" "}by Paul Bakaus.
          </p>
          <p style={{ margin: 0, color: "rgba(255,255,255,0.5)", fontSize: "10px" }}>
            Pneuma integrates Impeccable's skill content directly into the mode
            rather than installing it as a standalone skill. This allows the
            design commands to work with the live preview viewer architecture
            (toolbar buttons, agent notifications, context extraction) which
            requires tighter integration than a drop-in skill install provides.
          </p>
        </div>
      )}
    </div>
  );
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

function buildSrcdoc(html: string, baseHref: string): string {
  const isFullDoc = /<!DOCTYPE|<html/i.test(html);
  const injectedScripts = HASH_NAV_FIX + SELECTION_SCRIPT;

  if (isFullDoc) {
    let result = html;
    const baseTag = `<base href="${baseHref}">`;
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
            borderBottomColor: page.file === activePage ? "#f97316" : "transparent",
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
  activePreset,
  onPresetChange,
  previewMode,
  onSetPreviewMode,
  onExport,
  readonly,
}: {
  activePreset: string;
  onPresetChange: (presetId: string) => void;
  previewMode: PreviewMode;
  onSetPreviewMode: (mode: PreviewMode) => void;
  onExport: () => void;
  readonly?: boolean;
}) {
  const currentPreset = VIEWPORT_PRESETS.find((p) => p.id === activePreset);
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
        {VIEWPORT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onPresetChange(preset.id)}
            style={{
              background: preset.id === activePreset ? "rgba(249,115,22,0.15)" : "none",
              border: preset.id === activePreset ? "1px solid rgba(249,115,22,0.4)" : "1px solid transparent",
              borderRadius: "4px",
              padding: "3px 8px",
              cursor: "pointer",
              color: preset.id === activePreset ? "#f97316" : "rgba(255,255,255,0.5)",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s",
            }}
            title={preset.width > 0 ? `${preset.label} (${preset.width}x${preset.height})` : preset.label}
            onMouseEnter={(e) => {
              if (preset.id !== activePreset) {
                e.currentTarget.style.color = "rgba(255,255,255,0.8)";
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              }
            }}
            onMouseLeave={(e) => {
              if (preset.id !== activePreset) {
                e.currentTarget.style.color = "rgba(255,255,255,0.5)";
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
              background: previewMode === m.value ? "rgba(249,115,22,0.2)" : "transparent",
              color: previewMode === m.value ? "#f97316" : "rgba(255,255,255,0.5)",
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

export default function WebPreview({
  files,
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
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [commandBarCollapsed, setCommandBarCollapsed] = useState(false);

  // Build command categories from manifest commands (runtime-injected via props)
  const commandCategories = useMemo(
    () => buildCommandCategories(manifestCommands ?? []),
    [manifestCommands],
  );
  const [viewport, setViewport] = useState<string>("full");

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

  // Parse manifest.json for page list with resilient fallback
  const manifestPages = useResilientParse<PageEntry[]>(files, (files) => {
    const mf = files.find(
      (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
    );
    if (!mf) return { data: null };
    // Let JSON.parse throw — useResilientParse catches it
    const parsed = JSON.parse(mf.content);
    // Accept both { pages: [...] } and { files: [...] } formats
    const entries: any[] | undefined = parsed.pages || parsed.files;
    if (!Array.isArray(entries) || entries.length === 0) return { data: null };
    return {
      data: entries.map((p: { file?: string; path?: string; title?: string }) => ({
        file: p.file || p.path || "",
        title: p.title || (p.file || p.path || "").replace(/\.html$/i, "").replace(/^.*\//, ""),
      })),
      file: mf.path,
    };
  }, onNotifyAgent);

  // Fallback to raw HTML files when no manifest exists
  const pageEntries = useMemo<PageEntry[]>(() => {
    if (manifestPages) return manifestPages;
    return files
      .filter((f) => /\.html$/i.test(f.path))
      .map((f) => ({
        file: f.path,
        title: f.path.replace(/\.html$/i, "").replace(/^.*\//, ""),
      }));
  }, [manifestPages, files]);

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

  // Build srcdoc for the current file
  const srcdoc = useMemo(() => {
    if (!currentFile) return "";
    const fileContent = files.find((f) => f.path === currentFile);
    if (!fileContent) return "";
    return buildSrcdoc(fileContent.content, baseHref);
  }, [currentFile, files, baseHref]);

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
      const apiBase = import.meta.env.DEV
        ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`
        : "";

      // Reconstruct the full HTML document by replacing the body content
      const fileContent = files.find((f) => f.path === file);
      if (!fileContent) return;
      const original = fileContent.content;
      let updated: string;
      if (/<body[^>]*>/i.test(original)) {
        updated = original.replace(
          /(<body[^>]*>)([\s\S]*?)(<\/body>)/i,
          `$1\n${html}\n$3`,
        );
      } else {
        updated = html;
      }

      // Persist via API
      const savePath = activeContentSet ? `${activeContentSet}/${file}` : file;
      fetch(`${apiBase}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: savePath, content: updated }),
      }).catch(() => {});

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
  }, [files, activeContentSet]);

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

  const handleExport = useCallback(() => {
    const apiBase = import.meta.env.DEV
      ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`
      : "";
    const cs = useStore.getState().activeContentSet;
    const qs = cs ? `?contentSet=${encodeURIComponent(cs)}` : "";
    window.open(`${apiBase}/export/webcraft${qs}`, "_blank");
  }, []);

  // ── Command handling ────────────────────────────────────────────────────────

  const handleCommand = useCallback(
    (commandId: string) => {
      if (!onNotifyAgent) return;
      const allCommands = commandCategories.flatMap((c) => c.commands);
      const cmd = allCommands.find((c) => c.id === commandId);
      if (!cmd) return;
      // Viewer context is automatically prepended by sendViewerNotification
      onNotifyAgent({
        type: "impeccable-command",
        message: `Please run the Impeccable "${cmd.id}" command on the current workspace. Follow the instructions in the cmd-${cmd.id} reference document.`,
        severity: "warning",
        summary: `/${cmd.id}`,
      });
    },
    [onNotifyAgent],
  );

  const toggleCategory = useCallback((name: string) => {
    setExpandedCategory((prev) => (prev === name ? null : name));
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* Command Bar — hidden in readonly (replay) mode */}
      {!readonly && <div
        style={{
          width: commandBarCollapsed ? "36px" : "180px",
          minWidth: commandBarCollapsed ? "36px" : "180px",
          height: "100%",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "width 0.2s, min-width 0.2s",
        }}
      >
        {/* Command Bar Header */}
        <div
          style={{
            padding: commandBarCollapsed ? "8px 6px" : "8px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: commandBarCollapsed ? "center" : "space-between",
            gap: "4px",
          }}
        >
          {!commandBarCollapsed && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "rgba(255,255,255,0.5)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Impeccable
            </span>
          )}
          <button
            onClick={() => setCommandBarCollapsed(!commandBarCollapsed)}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              padding: "2px",
              fontSize: "12px",
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title={commandBarCollapsed ? "Expand command bar" : "Collapse command bar"}
          >
            {commandBarCollapsed ? "\u25B6" : "\u25C0"}
          </button>
        </div>

        {/* Command Categories */}
        <div style={{ flex: 1, overflowY: "auto", padding: commandBarCollapsed ? "4px 2px" : "4px 0" }}>
          {commandCategories.map((category) => (
            <div key={category.name}>
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.name)}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: commandBarCollapsed ? "6px 4px" : "6px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: commandBarCollapsed ? "center" : "flex-start",
                  gap: "6px",
                  cursor: "pointer",
                  color:
                    expandedCategory === category.name
                      ? "rgba(255,255,255,0.9)"
                      : "rgba(255,255,255,0.5)",
                  fontSize: "12px",
                  fontWeight: 500,
                  transition: "color 0.15s",
                }}
                title={category.name}
              >
                <span style={{ display: "flex", alignItems: "center" }}>{category.icon}</span>
                {!commandBarCollapsed && <span>{category.name}</span>}
                {!commandBarCollapsed && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "9px",
                      transform: expandedCategory === category.name ? "rotate(90deg)" : "none",
                      transition: "transform 0.15s",
                    }}
                  >
                    {"\u25B6"}
                  </span>
                )}
              </button>

              {/* Commands */}
              {(expandedCategory === category.name || commandBarCollapsed) && (
                <div style={{ padding: commandBarCollapsed ? "0" : "0 0 4px 0" }}>
                  {category.commands.map((cmd) => (
                    <button
                      key={cmd.id}
                      onClick={() => handleCommand(cmd.id)}
                      style={{
                        width: "100%",
                        background: "none",
                        border: "none",
                        padding: commandBarCollapsed ? "5px 4px" : "4px 12px 4px 24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: commandBarCollapsed ? "center" : "flex-start",
                        gap: "6px",
                        cursor: "pointer",
                        color: "rgba(255,255,255,0.65)",
                        fontSize: "12px",
                        transition: "background 0.1s, color 0.1s",
                      }}
                      title={`${cmd.label}: ${cmd.description}`}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                        e.currentTarget.style.color = "rgba(255,255,255,0.9)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "none";
                        e.currentTarget.style.color = "rgba(255,255,255,0.65)";
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "16px" }}>
                        {cmd.icon}
                      </span>
                      {!commandBarCollapsed && (
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {cmd.label}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Attribution Footer */}
        <ImpeccableAttribution collapsed={commandBarCollapsed} />
      </div>}

      {/* Main Preview Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Viewport Toolbar */}
        <ViewportToolbar
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
            background: viewport === "full" ? "#ffffff" : "#1a1a1a",
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
                  borderRadius: "8px",
                  overflow: "hidden",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)",
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
                    background: "#ffffff",
                  }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  title="Web Preview"
                  onLoad={handleIframeLoad}
                />
              </div>
            ) : (
              /* Full mode: iframe fills container */
              <iframe
                ref={iframeRef}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  display: "block",
                  background: "#ffffff",
                }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                title="Web Preview"
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
