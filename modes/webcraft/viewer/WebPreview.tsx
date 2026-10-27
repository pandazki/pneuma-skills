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

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type CSSProperties } from "react";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
  ViewerFileContent,
  ViewerAddress,
  ViewerActionResult,
} from "../../../core/types/viewer-contract.js";
import { createPrivateViewerInstanceId } from "../../../core/types/private-viewer.js";
import type { Source, FileChannel } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { buildSelectionScript } from "../../../core/iframe-selection/index.js";
import { WebcraftCollaborationController } from "./collaboration.js";
import { buildWebcraftPageRuntimeScript } from "./page-runtime.js";
import type { Site } from "../domain.js";
import {
  LEAVE_SCRIPT,
  elementBody,
  instrumentPage,
  contentRequests,
  pageFromUrl,
  referencedContentPaths,
  staleAfterLoad,
} from "./page-document.js";
import { applyTextEdits, describeEditSource, type TextEdit } from "./source-edit.js";

// ── Edit Mode Extension ─────────────────────────────────────────────────────

const EDIT_MODE_EXTENSION = `
  // Text editing. Each edited element is reported with a handle the viewer
  // can verify against the page's SOURCE (describeEdit in source-edit.ts):
  // its id or its structural position, its attributes, its inner HTML when
  // editing began and ended, and how many look-alikes the page shows.
  // Nothing else of the rendered page is ever sent back.
  var editActive = false;
  var editEl = null;
  var editBefore = '';
  var editSaved = new Map(); // element -> its own style attribute before edit mode
  var EDITABLE = 'h1,h2,h3,h4,h5,h6,p,li,td,th,span,a,blockquote,figcaption,label,dt,dd';

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'pneuma:editMode') return;
    var next = !!e.data.enabled;
    if (next === editActive) return;
    if (!next && editEl) finishEdit(editEl);
    editActive = next;
    toggleEditable(editActive);
  });

  function authoredEditor(element) {
    for (var node = element; node; node = node.parentElement) {
      if (node.matches('input,textarea,select,[role="textbox"]') || node.hasAttribute('contenteditable') && !node.hasAttribute(INLINE_EDIT_MARK)) return true;
    }
    return false;
  }

  function toggleEditable(enable) {
    if (enable) {
      var els = document.querySelectorAll(EDITABLE);
      for (var i = 0; i < els.length; i++) {
        if (els[i].closest('[data-pneuma-preview],[data-pneuma-overlay]') || authoredEditor(els[i])) continue;
        editSaved.set(els[i], els[i].getAttribute('style'));
        els[i].setAttribute(INLINE_EDIT_MARK, '');
        els[i].contentEditable = 'true';
        els[i].style.cursor = 'text';
      }
      document.addEventListener('click', preventEditNav, true);
    } else {
      editSaved.forEach(function(style, el) { restore(el, el); });
      editSaved = new Map();
      document.removeEventListener('click', preventEditNav, true);
    }
  }

  // Put back what edit mode changed on 'orig', writing onto 'target' (the
  // element itself, or its twin in a clone).
  function restore(orig, target) {
    if (!editSaved.has(orig)) return;
    target.removeAttribute('contenteditable');
    target.removeAttribute(INLINE_EDIT_MARK);
    var style = editSaved.get(orig);
    if (style === null) target.removeAttribute('style'); else target.setAttribute('style', style);
  }

  // Inner HTML as authored: the viewer's own attributes and nodes removed.
  function cleanInner(el) {
    var clone = el.cloneNode(true);
    var marked = clone.querySelectorAll('[data-pneuma-preview],[data-pneuma-overlay]');
    for (var i = marked.length - 1; i >= 0; i--) marked[i].parentNode.removeChild(marked[i]);
    var origs = el.querySelectorAll('*');
    var twins = clone.querySelectorAll('*');
    if (origs.length === twins.length) {
      for (var j = 0; j < origs.length; j++) restore(origs[j], twins[j]);
    }
    return clone.innerHTML;
  }

  function preventEditNav(e) {
    if (e.target.closest && e.target.closest('a')) e.preventDefault();
  }

  document.addEventListener('focus', function(e) {
    if (!editActive) return;
    var el = e.target;
    if (el && el.isContentEditable && editSaved.has(el)) {
      editEl = el;
      editBefore = cleanInner(el);
    }
  }, true);

  document.addEventListener('blur', function(e) {
    if (!editActive || e.target !== editEl) return;
    finishEdit(editEl);
  }, true);

  function finishEdit(el) {
    editEl = null;
    var after = cleanInner(el);
    if (after === editBefore) return;
    var change = describeEdit(el, editBefore, after, cleanInner);
    editBefore = after;
    window.parent.postMessage({
      type: 'pneuma:textEdit',
      // Which loaded document this came from (set by the viewer on load), so
      // the edit is saved to the file this document was loaded from.
      doc: document.documentElement.getAttribute('data-pneuma-instrumented'),
      changes: [change],
    }, '*');
  }

  // Retire the document only after its final blur/pagehide edit has been
  // posted. The parent accepts those ordered messages on the original local
  // write capability, then closes that capability at this marker.
  function retireEdits() {
    if (editActive && editEl) finishEdit(editEl);
    editActive = false;
    toggleEditable(false);
    window.parent.postMessage({ type: 'pneuma:editsRetired', doc: document.documentElement.getAttribute('data-pneuma-instrumented') }, '*');
  }
  window.addEventListener('pagehide', retireEdits);
  window.addEventListener('message', function(e) {
    if (e.source === window.parent && e.data && e.data.type === 'pneuma:retireEdits'
      && e.data.doc === document.documentElement.getAttribute('data-pneuma-instrumented')) retireEdits();
  });

  var describeEdit = (${describeEditSource});
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
  compass:    <svg {...svgProps}><circle cx="12" cy="12" r="10"/><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88"/></svg>,
  wand:       <svg {...svgProps}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg>,
  penRuler:   <svg {...svgProps}><path d="M14 4l6 6-9 9H5v-6z"/><path d="M9 9l5 5M4 14l-2 2 2 2 2-2"/></svg>,
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
  "teach":       Icons.graduationCap,
  "shape":       Icons.compass,
  "craft":       Icons.wand,
  "audit":       Icons.clipboardCheck,
  "critique":    Icons.messageCircle,
  "polish":      Icons.gem,
  "distill":     Icons.flask,
  "clarify":     Icons.lightbulb,
  "typeset":     Icons.type,
  "layout":      Icons.columns,
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
};

/** Group definitions — order and categorization for sidebar UI */
const COMMAND_GROUPS: { name: string; icon: React.ReactNode; actionIds: string[] }[] = [
  { name: "Setup",        icon: Icons.settings,  actionIds: ["teach"] },
  { name: "Plan",         icon: Icons.penRuler,  actionIds: ["shape", "craft"] },
  { name: "Review",       icon: Icons.search,    actionIds: ["audit", "critique"] },
  { name: "Refine",       icon: Icons.sparkles,  actionIds: ["polish", "distill", "clarify", "typeset", "layout"] },
  { name: "Performance",  icon: Icons.zap,       actionIds: ["optimize", "harden"] },
  { name: "Style",        icon: Icons.palette,   actionIds: ["animate", "colorize", "bolder", "quieter", "delight", "overdrive"] },
  { name: "Architecture", icon: Icons.building,  actionIds: ["extract", "adapt"] },
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
    borderTop: "1px solid var(--color-cc-border)",
    display: "flex",
    alignItems: "center",
    justifyContent: collapsed ? "center" : "flex-start",
    gap: "6px",
    position: "relative",
  };

  const linkStyle: CSSProperties = {
    fontSize: "10px",
    color: "var(--color-cc-muted)",
    textDecoration: "none",
    transition: "color 0.15s",
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const helpBtnStyle: CSSProperties = {
    background: "none",
    border: "1px solid var(--color-cc-border)",
    borderRadius: "50%",
    width: "15px",
    height: "15px",
    fontSize: "9px",
    color: "var(--color-cc-muted)",
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
    background: "var(--color-cc-surface)",
    border: "1px solid var(--color-cc-border)",
    borderRadius: "6px",
    fontSize: "11px",
    lineHeight: 1.55,
    color: "var(--color-cc-fg)",
    boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
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
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-cc-fg)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-cc-muted)"; }}
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
          e.currentTarget.style.borderColor = "var(--color-cc-fg)";
          e.currentTarget.style.color = "var(--color-cc-fg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--color-cc-border)";
          e.currentTarget.style.color = "var(--color-cc-muted)";
        }}
        title="About design intelligence"
      >
        ?
      </button>
      {showTooltip && (
        <div style={tooltipStyle}>
          <div style={{ fontWeight: 600, marginBottom: "6px", color: "var(--color-cc-fg)" }}>
            Powered by Impeccable
          </div>
          <p style={{ margin: "0 0 8px" }}>
            Design principles and commands are adapted from{" "}
            <a
              href="https://impeccable.style"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-cc-primary)", textDecoration: "none" }}
            >
              impeccable.style
            </a>
            {" "}by Paul Bakaus.
          </p>
          <p style={{ margin: 0, color: "var(--color-cc-muted)", fontSize: "10px" }}>
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

/** Thin scrollbars inside the preview page, to sit with the app's dark shell. */
const SCROLLBAR_CSS = `
*{scrollbar-width:thin;scrollbar-color:rgba(128,128,128,0.3) transparent}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.3);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,0.5)}
`;

/** What the viewer adds to every page the preview loads (see `instrumentPage`). */
const PAGE_INSTRUMENTS = {
  scripts: [LEAVE_SCRIPT, elementBody(SELECTION_SCRIPT), buildWebcraftPageRuntimeScript()],
  styles: [SCROLLBAR_CSS],
};

/** The iframe's current URL, or null when it cannot be read (another origin, nothing loaded). */
function frameHref(iframe: HTMLIFrameElement): string | null {
  try {
    const href = iframe.contentWindow?.location.href;
    return href && /^https?:/.test(href) ? href : null;
  } catch {
    return null;
  }
}

interface EditProblem {
  id: number;
  kind: "refused" | "write-failed";
  /** The page the edit was made on. */
  page: string;
  reason: string;
  /** Plain text of the edits that were not saved, for copying. */
  unsaved: string[];
  /** Present when the same save can be tried again (a rejected write). */
  retry?: () => void;
}

interface NoticeAction {
  label: string;
  /** Label shown briefly after the action succeeded (e.g. "Copied"). */
  doneLabel?: string;
  primary?: boolean;
  /** May be async; `doneLabel` shows only when it resolves to anything but `false`. */
  onClick: () => void | Promise<boolean | void>;
}

/** A message over the preview: an edit that was not saved, or a page outside the site. */
function PreviewNotice({
  role,
  tone,
  title,
  detail,
  actions,
  onDismiss,
}: {
  role: "alert" | "status";
  tone: "error" | "info";
  title: string;
  detail: React.ReactNode;
  actions: NoticeAction[];
  onDismiss?: () => void;
}) {
  const [done, setDone] = useState<string | null>(null);
  const accent = tone === "error" ? "var(--color-cc-error)" : "var(--color-cc-primary)";
  return (
    <div
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      style={{
        pointerEvents: "auto",
        width: "fit-content",
        maxWidth: 640,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "10px 10px 10px 14px",
        borderRadius: 10,
        background: "color-mix(in srgb, var(--color-cc-surface) 90%, transparent)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--color-cc-border)",
        borderLeft: `3px solid ${accent}`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        color: "var(--color-cc-fg)",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: tone === "error" ? "var(--color-cc-error)" : "var(--color-cc-fg)", marginBottom: 2 }}>{title}</div>
        {detail}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={async () => {
                let ok: boolean | void;
                try {
                  ok = await a.onClick();
                } catch {
                  ok = false;
                }
                if (a.doneLabel && ok !== false) {
                  setDone(a.label);
                  setTimeout(() => setDone(null), 1500);
                }
              }}
              style={{
                padding: "5px 10px",
                borderRadius: 7,
                border: a.primary ? "1px solid rgba(249,115,22,0.45)" : "1px solid var(--color-cc-border)",
                background: a.primary ? "var(--color-cc-primary-muted)" : "var(--color-cc-hover)",
                color: a.primary ? "var(--color-cc-primary)" : "var(--color-cc-fg)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {done === a.label && a.doneLabel ? a.doneLabel : a.label}
            </button>
          ))}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            display: "grid",
            placeItems: "center",
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--color-cc-muted)",
            cursor: "pointer",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
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
        borderTop: "1px solid var(--color-cc-border)",
        background: "var(--color-cc-surface)",
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
            color: page.file === activePage ? "var(--color-cc-fg)" : "var(--color-cc-muted)",
            background: "none",
            border: "none",
            borderBottomWidth: "2px",
            borderBottomStyle: "solid",
            borderBottomColor: page.file === activePage ? "var(--color-cc-primary)" : "transparent",
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
          background: "var(--color-cc-surface)",
          border: "1px solid var(--color-cc-border)",
          borderRadius: "6px",
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
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
  permissions,
  requestLocalEdit,
}: {
  activePreset: string;
  onPresetChange: (presetId: string) => void;
  previewMode: PreviewMode;
  onSetPreviewMode: (mode: PreviewMode) => void;
  onExport?: () => void;
  readonly?: boolean;
  permissions?: ViewerPreviewProps["permissions"];
  requestLocalEdit?: boolean;
}) {
  const currentPreset = VIEWPORT_PRESETS.find((p) => p.id === activePreset);
  const showDimensions = currentPreset && currentPreset.width > 0;

  return (
    <div
      style={{
        padding: "4px 12px",
        borderBottom: "1px solid var(--color-cc-border)",
        background: "var(--color-cc-surface)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "4px",
        flexShrink: 0,
      }}
    >
      {/* Left: Viewport presets */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ fontSize: "11px", color: "var(--color-cc-muted)", marginRight: "4px" }}>
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
              color: preset.id === activePreset ? "var(--color-cc-primary)" : "var(--color-cc-muted)",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s",
            }}
            title={preset.width > 0 ? `${preset.label} (${preset.width}x${preset.height})` : preset.label}
            onMouseEnter={(e) => {
              if (preset.id !== activePreset) {
                e.currentTarget.style.color = "var(--color-cc-fg)";
                e.currentTarget.style.background = "var(--color-cc-hover)";
              }
            }}
            onMouseLeave={(e) => {
              if (preset.id !== activePreset) {
                e.currentTarget.style.color = "var(--color-cc-muted)";
                e.currentTarget.style.background = "none";
              }
            }}
          >
            <span style={{ display: "flex", alignItems: "center" }}>{preset.icon}</span>
            <span>{preset.label}</span>
          </button>
        ))}
        {showDimensions && (
          <span style={{ fontSize: "10px", color: "var(--color-cc-muted)", marginLeft: "8px" }}>
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
          background: "var(--color-cc-surface)",
          borderRadius: "6px",
          padding: "2px",
        }}
      >
        {MODE_BUTTONS.filter((m) => m.value !== "edit" || permissions?.editContent !== false || requestLocalEdit).filter((m) => m.value !== "annotate" || permissions?.notifyAgent !== false).map((m) => (
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
              color: previewMode === m.value ? "var(--color-cc-primary)" : "var(--color-cc-muted)",
            }}
            title={m.title}
            onMouseEnter={(e) => {
              if (previewMode !== m.value) {
                e.currentTarget.style.color = "var(--color-cc-fg)";
              }
            }}
            onMouseLeave={(e) => {
              if (previewMode !== m.value) {
                e.currentTarget.style.color = "var(--color-cc-muted)";
              }
            }}
          >
            {m.icon}
            <span>{m.value === "edit" && permissions?.editContent === false ? "Edit locally" : m.label}</span>
          </button>
        ))}
      </div>}

      {/* Right: Export — hidden in readonly (replay / hosted player) mode */}
      {!readonly && onExport && permissions?.export !== false && <button
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
          color: "var(--color-cc-muted)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--color-cc-fg)";
          e.currentTarget.style.background = "var(--color-cc-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--color-cc-muted)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <DownloadIcon />
      </button>}
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
      className="bg-cc-card border border-cc-border rounded-lg shadow-xl p-3 text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        {thumbnail && (
          <img src={thumbnail} alt="" className="w-8 h-8 rounded border border-cc-border shrink-0 object-contain bg-white" />
        )}
        <span className="text-cc-fg truncate text-xs">{label || "Element"}</span>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add comment (optional)..."
        className="w-full bg-cc-bg border border-cc-border rounded px-2 py-1.5 text-sm text-cc-fg placeholder-cc-muted outline-none focus:border-cc-primary"
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="px-2.5 py-1 text-xs text-cc-muted hover:text-cc-fg rounded hover:bg-cc-hover transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(comment)}
          className="px-2.5 py-1 text-xs text-white bg-cc-primary hover:bg-cc-primary-hover rounded transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WebPreview({
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
  permissions,
  collaboration,
  commenting,
  resolveResourceUrl,
  activeContentSet: activeContentSetProp,
  onActiveContentSetChange,
  imageChangedPaths = [],
  onPreviewModeChange,
  onAnnotate,
  onUserAction,
  onExport,
}: ViewerPreviewProps) {
  // Readonly mode: force view, suppress selection and agent notifications
  const previewMode = readonly || permissions?.editContent === false && rawPreviewMode === "edit" || permissions?.notifyAgent === false && rawPreviewMode === "annotate" ? "view" : rawPreviewMode;
  const onSelect = readonly ? (() => {}) : rawOnSelect;
  const onNotifyAgent = readonly || permissions?.notifyAgent === false ? undefined : rawOnNotifyAgent;
  const canWriteRef = useRef(!readonly && permissions?.editContent !== false);
  canWriteRef.current = !readonly && permissions?.editContent !== false;
  const [commentControlHeld, setCommentControlHeld] = useState(false);
  const commentControlRef = useRef(false);
  const commentInhibitedRef = useRef(false);
  const commentBindingRef = useRef(commenting);
  commentBindingRef.current = readonly ? undefined : commenting;
  const commentPicking = !readonly && !!commenting?.enabled && (commenting.active || commentControlHeld);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WebcraftCollaborationController | null>(null);
  const loadedFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [documentReady, setDocumentReady] = useState(false);
  const [exportError, setExportError] = useState("");
  const [interactionError, setInteractionError] = useState("");
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [commandBarCollapsed, setCommandBarCollapsed] = useState(false);

  // Build command categories from manifest commands (runtime-injected via props)
  const commandCategories = useMemo(
    () => buildCommandCategories(manifestCommands ?? []),
    [manifestCommands],
  );
  const [viewport, setViewport] = useState<string>("full");

  const [followContentSet, setFollowContentSet] = useState<string | null | undefined>(undefined);
  const activeContentSet = followContentSet === undefined ? activeContentSetProp ?? null : followContentSet;
  const setPreviewMode = onPreviewModeChange ?? (() => {});
  useEffect(() => { setFollowContentSet(undefined); }, [activeContentSetProp]);

  // Pending annotation popover state (annotate mode: click → popover → confirm → add)
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    selection: ViewerSelectionContext;
    pageFile: string;
    rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);

  // Domain source: the full Site (every content set's page list), keyed
  // by content-set prefix. Pick the active bucket at render time; fall
  // back to the first one if activeContentSet hasn't been set yet.
  const siteSource = sources.site as Source<Site>;
  const { value: site } = useSource(siteSource);
  // Companion file-glob: raw HTML/CSS/JS content used by the page document
  // construction and handleTextEdit (splicing <body> edits back into the
  // full original document).
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue, status: filesStatus } = useSource(filesSource);
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

  // Every HTML page of the active content set: declared pages plus any other
  // .html file under the same prefix, nested ones included. The PageNavigator
  // only renders declared pages, but a page's own links can open any page of
  // the site (an empty-state screen, `docs/guide.html`), and the viewer must
  // then name THAT page — in its page state, selections and addresses.
  const reachableHtmlFiles = useMemo(() => {
    const prefix = activeContentSet ? `${activeContentSet}/` : "";
    const extras: string[] = [];
    for (const f of files) {
      if (!/\.html?$/i.test(f.path)) continue;
      if (prefix && !f.path.startsWith(prefix)) continue;
      extras.push(f.path.slice(prefix.length));
    }
    return Array.from(new Set([...htmlFiles, ...extras]));
  }, [files, activeContentSet, htmlFiles]);

  // Determine which file to show
  const currentFile = useMemo(() => {
    if (activeFile && reachableHtmlFiles.includes(activeFile)) return activeFile;
    if (selectedFile && reachableHtmlFiles.includes(selectedFile)) return selectedFile;
    return htmlFiles.find((f) => /^index\.html$/i.test(f)) || htmlFiles[0] || "";
  }, [activeFile, selectedFile, htmlFiles, reachableHtmlFiles]);

  // Compute base href for correct relative asset resolution
  const resourceUrl = useCallback((path: string) => {
    const value = resolveResourceUrl?.(path);
    return value ? new URL(value, window.location.href).href : "";
  }, [resolveResourceUrl]);
  const baseHref = resourceUrl(activeContentSet ? `${activeContentSet}/` : "");
  const resourceRootRef = useRef(baseHref);
  const previousResourceRootRef = useRef(baseHref);
  const committedResourceRootRef = useRef(baseHref);
  resourceRootRef.current = baseHref;

  // The current page's source in `files`. `currentFile` is manifest-relative
  // ("index.html"); `files` paths carry the content-set prefix
  // ("gazette/index.html").
  const pageSourcePath = currentFile
    ? (activeContentSet ? `${activeContentSet}/${currentFile}` : currentFile)
    : "";
  const pageExists = !!pageSourcePath && files.some((f) => f.path === pageSourcePath);

  // ── Selection & edit mode handling ──────────────────────────────────────────

  const isSelectMode = previewMode === "select" || previewMode === "annotate";
  const isEditMode = previewMode === "edit" && !commentPicking;

  // Keep the ordinary tool identity separate from whether picking is enabled.
  const selectionToolRef = useRef(previewMode);
  selectionToolRef.current = previewMode;
  // Selection is enabled only after this document has an addressable identity.
  const sendSelectionMode = useCallback((enabled: boolean) => {
    const iframe = iframeRef.current;
    const doc = currentDocRef.current;
    if (!iframe?.contentWindow) return;
    const ready = !!doc && doc.resourceRoot === resourceRootRef.current && iframe.getAttribute("aria-busy") !== "true";
    const binding = commentBindingRef.current;
    iframe.contentWindow.postMessage({ type: "pneuma:selectMode", tool: selectionToolRef.current, enabled: enabled && ready, ...(doc ? { doc: doc.id } : {}), ...(binding ? { commenting: { enabled: ready && binding.enabled, active: ready && binding.enabled && binding.active } } : {}) }, "*");
  }, []);
  useEffect(() => { sendSelectionMode(isSelectMode); }, [isSelectMode, previewMode, documentReady, commenting?.enabled, commenting?.active, readonly, sendSelectionMode]);

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

  // ── Loaded documents ──────────────────────────────────────────────────────
  // Each document the iframe loads is given an id (see handleFrameLoad) and
  // remembered with the page and source file it was loaded from, and the
  // source text it was shown from. Selections, annotations and text edits are
  // attributed to that document — never to whichever page is current by the
  // time they are handled.

  interface LoadedDoc {
    id: string;
    resourceRoot: string;
    /** Only a trusted local document keeps the capability for its queued inline saves. */
    localEdits?: { files: Source<ViewerFileContent[]>; channel: FileChannel; origin: string };
    /** The content set the page belongs to (null: a workspace without sets). */
    contentSet: string | null;
    /** Content-set-relative page ("index.html", "docs/guide.html"). */
    file: string;
    /** Workspace-relative source path ("gazette/index.html"). */
    sourcePath: string;
    /** The source text this document shows, as far as the viewer can tell; null when unknown. */
    expected: string | null;
  }
  const previousDocumentHrefRef = useRef<string | null>(null);
  const docsRef = useRef(new Map<string, LoadedDoc>());
  const currentDocRef = useRef<LoadedDoc | null>(null);
  useLayoutEffect(() => {
    // A new grant is a different immutable resource generation even when all
    // filenames are identical. Retire interaction before passive effects run.
    previousResourceRootRef.current = committedResourceRootRef.current;
    committedResourceRootRef.current = baseHref;
    const iframe = iframeRef.current;
    previousDocumentHrefRef.current = iframe ? frameHref(iframe) ?? controllerRef.current?.pageHref ?? null : null;
    const previous = currentDocRef.current;
    if (previous?.localEdits) iframeRef.current?.contentWindow?.postMessage({ type: "pneuma:retireEdits", doc: previous.id }, "*");
    controllerRef.current?.frameLeaving();
    currentDocRef.current = null; loadedFrameRef.current = null;
    iframeRef.current?.setAttribute("aria-busy", "true");
    setDocumentReady(false);
  }, [baseHref]);

  // The held gesture overlays the current tool; it never changes the shell's mode.
  useEffect(() => {
    const send = (pressed: boolean, inhibited = false) => {
      commentControlRef.current = pressed;
      commentInhibitedRef.current = inhibited;
      setCommentControlHeld(pressed);
      const doc = currentDocRef.current;
      if (doc) iframeRef.current?.contentWindow?.postMessage({ type: "pneuma:commentControl", doc: doc.id, pressed, inhibited }, "*");
    };
    const editable = (event: KeyboardEvent) => event.composedPath().some((target) => target instanceof Element && (target.matches("input,textarea,select,[role=textbox]") || !!target.closest('[contenteditable]:not([contenteditable="false"])')));
    const keydown = (event: KeyboardEvent) => {
      if (!commentBindingRef.current?.enabled || currentDocRef.current?.resourceRoot !== resourceRootRef.current) return;
      if (event.key === "Escape" && commentControlRef.current) { send(false, true); event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (event.key === "Control") {
        if (!commentInhibitedRef.current && !event.isComposing && !editable(event) && !event.altKey && !event.metaKey && !event.shiftKey) send(true);
      } else if (event.ctrlKey && commentControlRef.current) send(false, true);
    };
    const keyup = (event: KeyboardEvent) => { if (event.key === "Control" || !event.ctrlKey) send(false); };
    const reset = () => send(false);
    const blur = () => {
      // Entering this frame blurs the parent Window without leaving the tab.
      // A queued reset could otherwise arrive after the child's newer press.
      if (document.hasFocus() && document.activeElement === iframeRef.current) return;
      reset();
    };
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener("keydown", keydown, true); window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("keydown", keydown, true); window.removeEventListener("keyup", keyup, true); window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (!documentReady || readonly || !commenting?.enabled) { commentControlRef.current = false; commentInhibitedRef.current = false; setCommentControlHeld(false); }
  }, [documentReady, readonly, commenting?.enabled]);


  // ── Text edit handling ────────────────────────────────────────────────────
  // Edits arrive per element (see EDIT_MODE_EXTENSION) and are applied to the
  // source text of the file their document was loaded from, never by writing
  // the rendered page back (source-edit.ts). They are queued per document and
  // saved after a short pause, or at once when the preview moves on.

  const pendingEditsRef = useRef(new Map<string, { doc: LoadedDoc; edits: TextEdit[]; timer: ReturnType<typeof setTimeout> }>());
  const filesRef = useRef(files);
  filesRef.current = files;
  // The last save per file, so a save made before the previous one's file
  // event arrives builds on it instead of on the stale source.
  const lastSaveRef = useRef(new Map<string, { from: string; to: string }>());
  // Set by the frame controller below: reload the preview when it shows one
  // of these paths (a save made from a document that is no longer on screen).
  const reloadIfShownRef = useRef<(paths: readonly string[], selfWrite: boolean) => void>(() => {});

  /** The file's source as the viewer's last save left it, or as last read. */
  const currentSource = useCallback((path: string): string | null => {
    const content = filesRef.current.find((f) => f.path === path)?.content;
    if (content === undefined) return null;
    const last = lastSaveRef.current.get(path);
    return last && last.from === content ? last.to : content;
  }, []);

  // A text edit that did not reach the file — refused by the source matcher,
  // or a write the server rejected. Shown in the preview until dismissed: the
  // page still displays the typed text, so the person must learn it was not
  // kept, and can copy it or go back to the saved version.
  const [editProblem, setEditProblem] = useState<EditProblem | null>(null);
  const problemSeqRef = useRef(0);
  // The problem whose "Copy text" failed (clipboard refused or unavailable).
  const [copyFailed, setCopyFailed] = useState<number | null>(null);
  const draftRef = useRef<HTMLSpanElement>(null);
  const selectDraft = useCallback(() => {
    const el = draftRef.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.addRange(range);
  }, []);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const flushEdits = useCallback((docId: string) => {
    const queued = pendingEditsRef.current.get(docId);
    if (!queued) return;
    pendingEditsRef.current.delete(docId);
    clearTimeout(queued.timer);
    const { doc, edits } = queued;
    const path = doc.sourcePath;
    const log = (actionId: string, description: string) =>
      onUserAction?.({ actionId, description });
    const report = (kind: EditProblem["kind"], reason: string, unsaved: readonly TextEdit[], retry?: () => void) => {
      console.warn(`[webcraft] text edit not saved: ${reason}`);
      const count = unsaved.length;
      log(
        "edit-text-failed",
        `${count === 1 ? "A text edit" : `${count} text edits`} on "${doc.file}" could not be saved (${unsaved.map((e) => `<${e.tag}> "${e.afterText ?? ""}"`).join(", ")}): ${reason}. The file was not changed.`,
      );
      setEditProblem({
        id: ++problemSeqRef.current,
        kind,
        page: doc.file,
        reason,
        unsaved: unsaved.map((e) => e.afterText ?? "").filter(Boolean),
        retry,
      });
    };
    if (!doc.localEdits) return report("refused", "content editing is unavailable in this document", edits);
    const localEdits = doc.localEdits;
    const sourceFiles = localEdits.files.current() ?? [];
    const savedContent = sourceFiles.find((file) => file.path === path)?.content;
    const saved = lastSaveRef.current.get(path);
    const source = savedContent === undefined ? null : saved?.from === savedContent ? saved.to : savedContent;
    if (source === null) return report("refused", "the page's file is no longer in the workspace", edits);
    // Source-version precondition: the edit was made on a document showing
    // `expected`; if the file has changed since, positions and look-alikes
    // in the handle may mean something else.
    if (doc.expected === null || doc.expected !== source) {
      return report("refused", "the file changed after this page was shown", edits);
    }
    const content = savedContent!;
    const parser = new DOMParser();
    const result = applyTextEdits(source, edits, (html) => parser.parseFromString(html, "text/html"));
    const applied = edits.slice(0, result.applied);
    if (result.applied > 0) {
      // Optimistic base: a save queued before this write resolves builds on
      // it. Success is recorded only once the write has resolved.
      const shownBefore = doc.expected;
      doc.expected = result.html;
      lastSaveRef.current.set(path, { from: content, to: result.html });
      const save = () => {
        localEdits.channel.write(path, result.html).then(
          () => {
            const lines = applied.map((c) => `  <${c.tag}>: "${c.beforeText ?? ""}" → "${c.afterText ?? ""}"`);
            log("edit-text", `Edited text on "${doc.file}":\n${lines.join("\n")}`);
            // Made on a document that is gone: if the page now on screen shows
            // this file, it was loaded before the save and must be reloaded.
            if (currentDocRef.current !== doc) reloadIfShownRef.current([path], false);
          },
          (err: unknown) => {
            console.error("[webcraft] save failed", err);
            if (lastSaveRef.current.get(path)?.to === result.html) {
              lastSaveRef.current.delete(path);
              if (doc.expected === result.html) doc.expected = shownBefore;
            }
            const message = err instanceof Error ? err.message : String(err);
            report("write-failed", `the file could not be written (${message})`, applied, () => {
              // Retry only onto the version the edit was made on.
              if (localEdits.files.current()?.find((file) => file.path === path)?.content !== content) {
                report("refused", "the file changed after this page was shown", applied);
                return;
              }
              doc.expected = result.html;
              lastSaveRef.current.set(path, { from: content, to: result.html });
              setEditProblem(null);
              save();
            });
          },
        );
      };
      save();
    }
    if (result.failure) {
      report("refused", result.failure.reason, edits.slice(result.applied));
    }
  }, [currentSource, fileChannel, onUserAction]);

  const flushAllEdits = useCallback(() => {
    for (const id of Array.from(pendingEditsRef.current.keys())) flushEdits(id);
  }, [flushEdits]);

  const queueEdits = useCallback((docId: string, changes: TextEdit[]) => {
    const doc = docsRef.current.get(docId);
    if (!doc?.localEdits || !changes.length) return;
    const queued = pendingEditsRef.current.get(docId);
    if (queued) clearTimeout(queued.timer);
    const entry = queued ?? { doc, edits: [], timer: undefined as unknown as ReturnType<typeof setTimeout> };
    entry.edits.push(...changes);
    entry.timer = setTimeout(() => flushEdits(docId), 800);
    pendingEditsRef.current.set(docId, entry);
  }, [flushEdits]);

  // Leaving the viewer saves what is queued.
  useEffect(() => () => flushAllEdits(), [flushAllEdits]);

  // Listen for selection and text edit messages from iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "pneuma:editsRetired") {
        const doc = docsRef.current.get(String(e.data.doc ?? ""));
        if (!doc?.localEdits || e.origin !== doc.localEdits.origin) return;
        flushEdits(doc.id);
        delete doc.localEdits;
        return;
      }
      if (e.data?.type === "pneuma:textEdit") {
        if (readonly) return;
        // Identified by the document id the viewer gave the page, not by
        // `e.source`: an edit finished by the blur of a page switch arrives
        // after the iframe has started loading the next page, and no longer
        // compares equal to its contentWindow (measured in Chrome).
        const doc = docsRef.current.get(String(e.data.doc ?? ""));
        if (!doc?.localEdits || e.origin !== doc.localEdits.origin) return;
        queueEdits(doc.id, Array.isArray(e.data.changes) ? e.data.changes : []);
        return;
      }
      if (e.data?.type !== "pneuma:select" && e.data?.type !== "pneuma:commentShortcut") return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      // Selections name the page of the document on screen.
      const doc = currentDocRef.current;
      if (!doc || doc.resourceRoot !== resourceRootRef.current || e.data.doc !== doc.id) return;
      if (e.data.type === "pneuma:commentShortcut") {
        const pressed = !!e.data.pressed && !!commentBindingRef.current?.enabled;
        commentControlRef.current = pressed; setCommentControlHeld(pressed); return;
      }
      const forComment = e.data.intent === "comment";
      // A capture can finish before the page receives our latest tool update.
      if (!forComment && e.data.tool !== undefined && e.data.tool !== selectionToolRef.current) return;
      if (forComment && !commentBindingRef.current?.enabled) return;
      const sel = e.data.selection;
      if (!sel) {
        if (forComment) return;
        if (previewMode === "annotate") {
          setPendingAnnotation(null);
        } else {
          onSelect(null);
        }
        return;
      }
      if (!forComment && previewMode === "annotate") {
        // In annotate mode: show popover instead of selecting
        if (!sel.rect) return;
        setPendingAnnotation({
          selection: sel,
          pageFile: doc.file,
          rect: sel.rect,
        });
      } else {
        const frame = iframeRef.current;
        const href = frame ? frameHref(frame) ?? controllerRef.current?.pageHref : null;
        const pageLocation = href ? new URL(href) : null;
        const selected: ViewerSelectionContext = {
          type: sel.type,
          content: sel.content,
          level: sel.level,
          file: doc.file,
          tag: sel.tag,
          classes: sel.classes,
          selector: sel.selector,
          // ViewerAddress — the round-trippable handle for this object.
          // Coarse: content set + page; fine: the CSS selector. The agent
          // can feed this straight into `capture` or a `<viewer-locator>`.
          address: {
            ...(doc.contentSet ? { contentSet: doc.contentSet } : {}),
            page: doc.file,
            ...(sel.selector ? { selector: sel.selector } : {}),
            ...(pageLocation ? { query: pageLocation.search, hash: pageLocation.hash } : {}),
          },
          thumbnail: sel.thumbnail,
          label: sel.label,
          nearbyText: sel.nearbyText,
          accessibility: sel.accessibility,
        };
        if (forComment) commentBindingRef.current?.onSelect(selected);
        else onSelect(selected);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onSelect, queueEdits, flushEdits, previewMode, activeContentSet, readonly, permissions?.editContent]);

  // Confirm pending annotation with comment
  const confirmAnnotation = useCallback(
    (comment: string) => {
      if (!pendingAnnotation) return;
      const { selection: sel, pageFile } = pendingAnnotation;
      if (permissions?.notifyAgent === false) return;
      onAnnotate?.({
        slideFile: pageFile,
        element: {
          type: sel.type as import("../../../src/types.js").SelectionType,
          content: sel.content,
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
    [pendingAnnotation, onAnnotate, permissions?.notifyAgent],
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

  // ── The preview frame ───────────────────────────────────────────────────────
  // The iframe shows the page at its real content URL (see page-document.ts).
  // The viewer drives it only when the page it should show changes — a page
  // tab, a locator, a content-set switch, a new iframe element — and follows
  // it everywhere else: a link, a reload or a script-set `location` inside the
  // page moves the iframe, and its `load` tells the viewer where it now is.

  const contentRootPath = baseHref;
  const desiredPath = currentFile ? resourceUrl(pageSourcePath) : "";
  const collaborationLatest = useRef({ site, activeContentSet, currentFile, viewport, reachableHtmlFiles, resourceUrl, isSelectMode, onActiveContentSetChange, onActiveFileChange });
  collaborationLatest.current = { site, activeContentSet, currentFile, viewport, reachableHtmlFiles, resourceUrl, isSelectMode, onActiveContentSetChange, onActiveFileChange };
  // The element the controller last drove, and the URL it holds or is loading.
  const frameRef = useRef<{ iframe: HTMLIFrameElement | null; url: string | null }>({ iframe: null, url: null });
  // An address navigation waiting for its page's `load`, with the verdict
  // callback of that request; a later request explicitly supersedes it.
  const awaitingRef = useRef<{ file: string; contentSet: string | null; address: ViewerAddress; complete: typeof onNavigateComplete; signal?: AbortSignal; cause: "local-input" | "follow" } | null>(null);
  // The page whose document has finished loading and is not being replaced.
  const readyFileRef = useRef<string | null>(null);
  // Files that changed while the iframe was loading, with when the change was
  // seen: the document that finishes loading may or may not have them.
  const dirtyRef = useRef(new Map<string, number>());
  // A document the iframe shows that is not a page of this site (another
  // content set, the app itself, a 404, an image): shown, but not instrumented
  // — nothing on it can be selected, edited or addressed.
  const [foreignUrl, setForeignUrl] = useState<string | null>(null);

  const completeNavigation = useCallback((address: ViewerAddress, complete: typeof onNavigateComplete, signal?: AbortSignal, cause: "local-input" | "follow" = "local-input") => {
    if (signal?.aborted) { complete?.({ success: false, message: "Navigation was cancelled" }); return; }
    if (typeof address.selector !== "string" && typeof address.anchor !== "string") { complete?.({ success: true }); return; }
    const frame = iframeRef.current;
    try {
      const document = frame?.contentWindow?.document;
      if (document) {
        let target: Element | null = null;
        try { target = typeof address.selector === "string" ? document.querySelector(address.selector) : document.getElementById(String(address.anchor).replace(/^#/, "")); } catch { /* Invalid selector. */ }
        if (!target || target.closest("[data-pneuma-preview],[data-pneuma-overlay]")) {
          complete?.({ success: false, message: "This page no longer contains the addressed element" }); return;
        }
        target.scrollIntoView({ block: "center", behavior: "instant" });
        sendSelectionMode(collaborationLatest.current.isSelectMode);
        frame?.contentWindow?.postMessage({ type: "pneuma:navigationHighlight", doc: currentDocRef.current?.id, selector: address.selector, anchor: address.anchor }, "*");
        complete?.({ success: true }); return;
      }
    } catch { /* An opaque page resolves its own address through the mode bridge. */ }
    const controller = controllerRef.current;
    if (!controller) { complete?.({ success: false, message: "The addressed page is unavailable" }); return; }
    void controller.navigateAnchor(address, signal, cause).then((result) => complete?.(result));
  }, [sendSelectionMode]);

  const openInFrame = useCallback((iframe: HTMLIFrameElement, url: string, fresh: boolean) => {
    controllerRef.current?.frameLeaving();
    loadedFrameRef.current = null; currentDocRef.current = null; setDocumentReady(false); setForeignUrl(null); setInteractionError("");
    frameRef.current = { iframe, url };
    readyFileRef.current = null;
    iframe.setAttribute("aria-busy", "true");
    if (fresh) {
      iframe.src = url;
      return;
    }
    // replace(): a viewer-driven page switch is not a step in the page's history.
    try { iframe.contentWindow!.location.replace(url); } catch { iframe.src = url; }
  }, []);

  /** One resolver for ordinary locators/capture and collaboration comment addresses. */
  const navigateAddress = useCallback((address: ViewerAddress, signal?: AbortSignal, cause: "local-input" | "follow" = "local-input"): Promise<ViewerActionResult> => new Promise((resolve) => {
    const state = collaborationLatest.current;
    const prefix = address.contentSet === undefined ? state.activeContentSet : address.contentSet;
    const target = typeof address.page === "string" ? address.page : typeof address.file === "string" ? address.file : state.currentFile;
    if (prefix !== null && typeof prefix !== "string" || ["selector", "anchor", "query", "hash"].some((key) => address[key] !== undefined && typeof address[key] !== "string")
      || !state.site?.byContentSet[prefix as string ?? ""] || !target || !filesRef.current.some((file) => file.path === (prefix ? `${prefix}/` : "") + target)) {
      resolve({ success: false, message: `This site has no addressed page "${target}"` }); return;
    }
    if (signal?.aborted) { resolve({ success: false, message: "Navigation was cancelled" }); return; }
    const frame = iframeRef.current;
    if (!frame) { resolve({ success: false, message: "The addressed page is unavailable" }); return; }
    const here = frameHref(frame) ?? controllerRef.current?.pageHref ?? frameRef.current.url;
    const samePage = prefix === state.activeContentSet && target === state.currentFile;
    const resource = state.resourceUrl((prefix ? `${prefix}/` : "") + target);
    if (!resource) { resolve({ success: false, message: "The addressed page is unavailable" }); return; }
    const href = new URL(samePage && here ? here : resource);
    if (typeof address.query === "string") href.search = address.query;
    if (typeof address.hash === "string") href.hash = address.hash;
    else if (typeof address.anchor === "string") href.hash = address.anchor;
    let settled = false;
    let pending: typeof awaitingRef.current = null;
    const finish = (result: ViewerActionResult = { success: true }) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (pending && awaitingRef.current === pending) awaitingRef.current = null;
      resolve(result);
    };
    const abort = () => finish({ success: false, message: "Navigation was cancelled" });
    const timer = setTimeout(() => finish({ success: false, message: "The addressed page did not become ready" }), 5000);
    signal?.addEventListener("abort", abort, { once: true });
    awaitingRef.current?.complete?.({ success: false, message: "Navigation was superseded" });
    const normalizedAddress = { ...address, ...(prefix ? { contentSet: prefix } : { contentSet: null }), page: target };
    if (samePage && here === href.href && readyFileRef.current === target) {
      completeNavigation(normalizedAddress, finish, signal, cause); return;
    }
    pending = { file: target, contentSet: prefix as string | null, address: normalizedAddress, complete: finish, signal, cause };
    awaitingRef.current = pending;
    if (prefix !== state.activeContentSet) { setFollowContentSet(prefix as string | null); state.onActiveContentSetChange?.(prefix as string | null); }
    setSelectedFile(target); state.onActiveFileChange?.(target);
    if (frame.getAttribute("aria-busy") !== "true" || frameRef.current.url !== href.href) openInFrame(frame, href.href, false);
  }), [completeNavigation, openInFrame]);
  useEffect(() => () => { awaitingRef.current?.complete?.({ success: false, message: "The preview was closed" }); }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !pageExists || !desiredPath) return;
    const root = contentRootPath;
    const st = frameRef.current;
    if (st.iframe !== iframe) {
      // First mount, or a Full ↔ Device switch mounted a new element: open the
      // page where the previous element was, query and fragment included.
      openInFrame(iframe, st.url && pageFromUrl(st.url, root) === currentFile ? st.url : desiredPath, true);
      return;
    }
    const busy = iframe.getAttribute("aria-busy") === "true";
    const here = (busy ? st.url : frameHref(iframe) ?? st.url) ?? "";
    // Compare pages, not URLs: `sub/` and `sub/index.html` are the same page,
    // and the URL the page is at keeps its query and fragment.
    if (here && pageFromUrl(here, root) === currentFile) return;
    let target = desiredPath;
    const departing = previousDocumentHrefRef.current ?? here;
    if (departing && pageFromUrl(departing, previousResourceRootRef.current) === currentFile) {
      const previous = new URL(departing);
      target += previous.search + previous.hash;
    }
    openInFrame(iframe, target, false);
  }, [desiredPath, pageExists, viewport, openInFrame, contentRootPath, currentFile]);

  // Latest render values for the load handler, which the iframe calls.
  const latest = { currentFile, reachableHtmlFiles, isSelectMode, isEditMode, contentRootPath, activeContentSet, handlePageChange };
  const latestRef = useRef(latest);
  latestRef.current = latest;

  const reload = useCallback((iframe: HTMLIFrameElement) => {
    controllerRef.current?.frameLeaving();
    loadedFrameRef.current = null; currentDocRef.current = null; setDocumentReady(false); setForeignUrl(null); setInteractionError("");
    iframe.setAttribute("aria-busy", "true");
    readyFileRef.current = null;
    try { iframe.contentWindow!.location.reload(); } catch { iframe.src = frameRef.current.url ?? desiredPath; }
  }, [desiredPath]);

  const handleFrameLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // The initial about:blank of a new iframe element, not a page.
    if (frameRef.current.iframe !== iframe) return;
    try { if (iframe.contentWindow?.location.href === "about:blank") return; } catch { /* another origin */ }
    loadedFrameRef.current = iframe;
    currentDocRef.current = null; readyFileRef.current = null; setDocumentReady(false); setForeignUrl(null); setInteractionError("");
    const href = frameHref(iframe);
    const L = latestRef.current;
    if (!href && permissions?.editContent === false) {
      controllerRef.current?.frameLoaded(true);
      return;
    }
    const file = href ? pageFromUrl(href, L.contentRootPath) : null;
    if (!href || !file || !L.reachableHtmlFiles.includes(file)) {
      // Not a page of this site: leave it alone, and say so.
      frameRef.current = { iframe, url: href };
      currentDocRef.current = null;
      readyFileRef.current = null;
      dirtyRef.current.clear();
      iframe.removeAttribute("aria-busy");
      setForeignUrl(href ?? "another site");
      flushAllEdits();
      return;
    }
    const win = iframe.contentWindow!;
    frameRef.current = { iframe, url: href };
    const sourcePath = L.activeContentSet ? `${L.activeContentSet}/${file}` : file;
    const doc: LoadedDoc = {
      id: createPrivateViewerInstanceId(),
      resourceRoot: L.contentRootPath,
      ...(canWriteRef.current ? { localEdits: { files: filesSource, channel: fileChannel, origin: window.location.origin } } : {}),
      contentSet: L.activeContentSet ?? null,
      file,
      sourcePath,
      expected: currentSource(sourcePath),
    };
    docsRef.current.set(doc.id, doc);
    currentDocRef.current = doc;
    // Keep recent documents (a late message can still name one), and any
    // with edits waiting to be saved.
    for (const id of docsRef.current.keys()) {
      if (docsRef.current.size <= 16) break;
      if (!pendingEditsRef.current.has(id)) docsRef.current.delete(id);
    }
    setForeignUrl(null);
    instrumentPage(win.document, PAGE_INSTRUMENTS, doc.id);
    try {
      win.postMessage({ type: "pneuma:editMode", enabled: L.isEditMode }, "*");
    } catch { /* gone again */ }
    // Edits made on the previous document go to ITS file now.
    flushAllEdits();

    // Files that changed while this document loaded: if it requested one of
    // them before the change was seen, it may show the old version — reload.
    if (dirtyRef.current.size) {
      const setPrefix = L.activeContentSet ? `${L.activeContentSet}/` : "";
      const stale = staleAfterLoad(dirtyRef.current, contentRequests(win), setPrefix);
      dirtyRef.current.clear();
      if (stale.length) {
        if (stale.includes(sourcePath)) doc.expected = null;
        reload(iframe);
        return;
      }
    }

    readyFileRef.current = file;
    controllerRef.current?.frameLoaded(true);
    // The page moved itself (a link, a reload, a script): follow it, so the
    // page tabs, selections and addresses name the page on screen.
    if (file !== L.currentFile) L.handlePageChange(file);
    const awaiting = awaitingRef.current;
    if (awaiting && awaiting.file === file && awaiting.contentSet === L.activeContentSet) {
      awaitingRef.current = null;
      completeNavigation(awaiting.address, awaiting.complete, awaiting.signal, awaiting.cause);
    }
  }, [currentSource, flushAllEdits, reload, permissions?.editContent, completeNavigation, filesSource, fileChannel]);

  // Reload the page when a file it shows changes: its own HTML, or any
  // stylesheet, script, image, font or data file it requested (read from the
  // page's Resource Timing). A reload keeps the page's current query and
  // fragment, the way a browser reload does. The viewer's own text-edit saves
  // are already on screen and do not reload. While the iframe is loading,
  // changes are kept and checked against the document once it has loaded.
  const reloadIfShown = useCallback((paths: readonly string[], selfWrite: boolean) => {
    const iframe = iframeRef.current;
    if (!iframe || !paths.length) return;
    if (iframe.getAttribute("aria-busy") === "true") {
      // The viewer's own saves are handled where they are made (flushEdits).
      if (selfWrite) return;
      const now = Date.now();
      for (const p of paths) dirtyRef.current.set(p, now);
      return;
    }
    const href = frameHref(iframe);
    if (!href && permissions?.editContent === false) { reload(iframe); return; }
    if (!href || !currentDocRef.current) return;
    const win = iframe.contentWindow!;
    const own = currentDocRef.current.sourcePath;
    const refs = referencedContentPaths(win);
    const setPrefix = latestRef.current.activeContentSet ? `${latestRef.current.activeContentSet}/` : "";
    const shown = (p: string) =>
      p === own || (refs === "all" ? p.startsWith(setPrefix) : refs.has(p));
    const hit = paths.filter(shown);
    if (!hit.length) return;
    if (selfWrite && hit.every((p) => p === own)) return;
    reload(iframe);
  }, [reload, permissions?.editContent]);
  reloadIfShownRef.current = reloadIfShown;

  const prevFilesRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const next = new Map(files.map((f) => [f.path, f.content] as const));
    const prev = prevFilesRef.current;
    prevFilesRef.current = next;
    if (!prev || prev.size === 0) return;
    const changed: string[] = [];
    for (const [path, content] of next) if (prev.get(path) !== content) changed.push(path);
    for (const path of prev.keys()) if (!next.has(path)) changed.push(path);
    reloadIfShown(changed, filesStatus.lastOrigin === "self");
  }, [files, reloadIfShown]);

  const prevImageVersionRef = useRef(imageVersion);
  useEffect(() => {
    if (prevImageVersionRef.current === imageVersion) return;
    prevImageVersionRef.current = imageVersion;
    reloadIfShown(imageChangedPaths, false);
  }, [imageVersion, imageChangedPaths, reloadIfShown]);

  /** Back from a page that is not part of this site to the current page. */
  const returnToSite = useCallback(() => {
    const iframe = iframeRef.current;
    if (iframe && desiredPath) openInFrame(iframe, desiredPath, false);
  }, [desiredPath, openInFrame]);

  // ── Locator / address navigation from chat cards & the capture action ───────
  // Consumes a ViewerAddress: `page` (or legacy `file`) names the target page;
  // `contentSet` is already resolved upstream by the store's setNavigateRequest.
  //
  // Arrival is reported once the target page's document has loaded, not when
  // the switch is merely requested: `capture` waits for this verdict, and
  // shooting earlier would picture the page being left or a blank one.
  useEffect(() => {
    if (!navigateRequest) return;
    const complete = onNavigateComplete;
    const controller = new AbortController();
    void navigateAddress(navigateRequest.address, controller.signal).then((result) => complete?.(result));
    return () => controller.abort();
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

  // ── Per-mounted semantic collaboration ──────────────────────────────────────

  useEffect(() => {
    const controller = new WebcraftCollaborationController({
      frame: () => iframeRef.current,
      overlay: () => viewerRef.current,
      current: () => { const state = collaborationLatest.current; return { contentSet: state.activeContentSet, page: state.currentFile, viewport: state.viewport, pages: state.reachableHtmlFiles }; },
      resourceUrl: (path) => collaborationLatest.current.resourceUrl(path),
      navigate: (address, signal) => navigateAddress(address, signal, "follow"),
      show: (address, nextViewport) => {
        const state = collaborationLatest.current;
        const prefix = typeof address.contentSet === "string" ? address.contentSet : null;
        const page = String(address.page ?? "");
        if (!state.site?.byContentSet[prefix ?? ""] || !filesRef.current.some((file) => file.path === (prefix ? `${prefix}/` : "") + page)) throw new Error(`This site has no page "${page}"`);
        setFollowContentSet(prefix);
        setSelectedFile(page);
        setViewport(nextViewport);
        if (prefix !== state.activeContentSet) state.onActiveContentSetChange?.(prefix);
        state.onActiveFileChange?.(page);
      },
      navigating: (href) => { frameRef.current = { iframe: iframeRef.current, url: href }; readyFileRef.current = null; loadedFrameRef.current = null; currentDocRef.current = null; setDocumentReady(false); setForeignUrl(null); setInteractionError(""); },
      leaving: () => { const iframe = iframeRef.current; iframe?.setAttribute("aria-busy", "true"); readyFileRef.current = null; loadedFrameRef.current = null; currentDocRef.current = null; setDocumentReady(false); setForeignUrl(null); setInteractionError(""); },
      unavailable: (message) => { const iframe = iframeRef.current; iframe?.removeAttribute("aria-busy"); readyFileRef.current = null; currentDocRef.current = null; setDocumentReady(false); setInteractionError(message); sendSelectionMode(false); },
      loaded: (page, href, nonce) => {
        const iframe = iframeRef.current;
        if (!iframe) return;
        frameRef.current = { iframe, url: href };
        readyFileRef.current = page;
        if (!frameHref(iframe)) {
          const state = collaborationLatest.current;
          currentDocRef.current = { id: nonce, resourceRoot: state.resourceUrl(state.activeContentSet ? `${state.activeContentSet}/` : ""), contentSet: state.activeContentSet, file: page, sourcePath: (state.activeContentSet ? `${state.activeContentSet}/` : "") + page, expected: null };
          setForeignUrl(null);
          if (page !== state.currentFile) { setSelectedFile(page); state.onActiveFileChange?.(page); }
          const awaiting = awaitingRef.current;
          if (awaiting?.file === page && awaiting.contentSet === state.activeContentSet) { awaitingRef.current = null; completeNavigation(awaiting.address, awaiting.complete, awaiting.signal, awaiting.cause); }
        }
        iframe.removeAttribute("aria-busy"); setDocumentReady(true); setInteractionError("");
        sendSelectionMode(collaborationLatest.current.isSelectMode);
      },
    }, collaboration);
    controllerRef.current = controller;
    controller.frameLoaded(loadedFrameRef.current === iframeRef.current);
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [collaboration]);
  useEffect(() => { controllerRef.current?.invalidate(); controllerRef.current?.frameLoaded(); }, [viewport, containerSize]);

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
    <div ref={viewerRef} onPointerDownCapture={() => controllerRef.current?.localInput()} onWheelCapture={() => controllerRef.current?.localInput()} onKeyDownCapture={() => controllerRef.current?.localInput()} style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* Command Bar — hidden in readonly (replay) mode */}
      {!readonly && onNotifyAgent && <div
        style={{
          width: commandBarCollapsed ? "36px" : "180px",
          minWidth: commandBarCollapsed ? "36px" : "180px",
          height: "100%",
          borderRight: "1px solid var(--color-cc-border)",
          background: "var(--color-cc-surface)",
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
            borderBottom: "1px solid var(--color-cc-border)",
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
                color: "var(--color-cc-muted)",
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
              color: "var(--color-cc-muted)",
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
                      ? "var(--color-cc-fg)"
                      : "var(--color-cc-muted)",
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
                        color: "var(--color-cc-fg)",
                        fontSize: "12px",
                        transition: "background 0.1s, color 0.1s",
                      }}
                      title={`${cmd.label}: ${cmd.description}`}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--color-cc-hover)";
                        e.currentTarget.style.color = "var(--color-cc-fg)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "none";
                        e.currentTarget.style.color = "var(--color-cc-fg)";
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
        {exportError && <p role="alert" className="text-xs text-cc-error">{exportError}</p>}
        {/* Viewport Toolbar */}
        <ViewportToolbar
          activePreset={viewport}
          onPresetChange={(value) => { controllerRef.current?.localInput(); setViewport(value); }}
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
          onExport={onExport ? async () => {
            setExportError("");
            try {
              await onExport();
            } catch (error) {
              setExportError(error instanceof Error ? error.message : String(error));
            }
          } : undefined}
          readonly={readonly}
          permissions={permissions}
          requestLocalEdit={!!onPreviewModeChange}
        />

        {/* Iframe Preview Container */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            position: "relative",
            background: viewport === "full" ? "#ffffff" : "var(--color-cc-surface)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {((foreignUrl && currentFile && pageExists) || editProblem) && (
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                right: 12,
                zIndex: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                pointerEvents: "none",
              }}
            >
              {editProblem && (
                <PreviewNotice
                  key={editProblem.id}
                  role="alert"
                  tone="error"
                  title="Edit not saved"
                  detail={
                    <>
                      <span style={{ display: "block" }}>
                        Your change to <b style={{ fontWeight: 600 }}>{editProblem.page}</b> was not saved, and the file is unchanged.
                        {editProblem.kind === "refused"
                          ? " Copy your text and ask the agent to apply it, or edit the file."
                          : " You can try saving again."}
                      </span>
                      <span style={{ display: "block", color: "var(--color-cc-muted)" }}>
                        Why: {editProblem.reason}.
                      </span>
                      {editProblem.unsaved.length > 0 && (
                        <span
                          ref={draftRef}
                          style={{ display: "block", marginTop: 4, color: "var(--color-cc-fg)", overflowWrap: "anywhere", whiteSpace: "pre-wrap", userSelect: "text", cursor: "text" }}
                        >
                          {editProblem.unsaved.join("\n\n")}
                        </span>
                      )}
                      {copyFailed === editProblem.id && (
                        <span role="status" style={{ display: "block", marginTop: 4, color: "var(--color-cc-warning)" }}>
                          Couldn't copy automatically. The text above is selected: press {isMac ? "⌘C" : "Ctrl+C"} to copy it.
                        </span>
                      )}
                    </>
                  }
                  actions={[
                    ...(editProblem.unsaved.length > 0
                      ? [{
                          label: "Copy text",
                          doneLabel: "Copied",
                          onClick: async () => {
                            const problem = editProblem;
                            try {
                              if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
                              await navigator.clipboard.writeText(problem.unsaved.join("\n\n"));
                              setCopyFailed(null);
                              return true;
                            } catch {
                              // Keep the draft on screen, selected for a manual copy.
                              setCopyFailed(problem.id);
                              selectDraft();
                              return false;
                            }
                          },
                        }]
                      : []),
                    ...(copyFailed === editProblem.id ? [{ label: "Select text", onClick: selectDraft }] : []),
                    ...(editProblem.retry ? [{ label: "Retry save", primary: true, onClick: editProblem.retry }] : []),
                    {
                      label: "Discard edit and show saved version",
                      primary: !editProblem.retry,
                      onClick: () => {
                        setEditProblem(null);
                        const iframe = iframeRef.current;
                        if (iframe) reload(iframe);
                      },
                    },
                  ]}
                  onDismiss={() => setEditProblem(null)}
                />
              )}
              {foreignUrl && currentFile && pageExists && (
                <PreviewNotice
                  role="status"
                  tone="info"
                  title="This page is not part of the site"
                  detail={
                    <>
                      <span style={{ display: "block", color: "var(--color-cc-muted)", overflowWrap: "anywhere" }}>
                        {foreignUrl.replace(window.location.origin, "")}
                      </span>
                      <span style={{ display: "block", color: "var(--color-cc-muted)" }}>
                        Selecting and editing work on the site's own pages.
                      </span>
                    </>
                  }
                  actions={[{ label: `Back to ${currentFile}`, primary: true, onClick: returnToSite }]}
                />
              )}
            </div>
          )}
          {currentFile && pageExists && interactionError && <div role="alert" style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 6, padding: 16, borderRadius: 8, color: "var(--color-cc-fg)", background: "var(--color-cc-surface)", border: "1px solid var(--color-cc-border)" }}><strong>Page interactions unavailable</strong><p style={{ margin: "8px 0", color: "var(--color-cc-muted)", fontSize: 12 }}>{interactionError}</p><button type="button" onClick={returnToSite} style={{ padding: "6px 10px", border: "1px solid var(--color-cc-border)", borderRadius: 6, background: "var(--color-cc-hover)" }}>Back to {currentFile}</button></div>}
          {currentFile && pageExists && !documentReady && !foreignUrl && !interactionError && <div role="status" style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-cc-muted)", background: "var(--color-cc-surface)" }}>Preparing page interactions…</div>}
          {currentFile && pageExists ? (
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
                  boxShadow: "0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px var(--color-cc-border)",
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
                    pointerEvents: documentReady || (foreignUrl || interactionError) && !isSelectMode ? "auto" : "none",
                  }}
                  aria-busy={!documentReady && !foreignUrl && !interactionError || undefined}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  title="Web Preview"
                  onLoad={handleFrameLoad}
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
                  pointerEvents: documentReady || (foreignUrl || interactionError) && !isSelectMode ? "auto" : "none",
                }}
                aria-busy={!documentReady && !foreignUrl && !interactionError || undefined}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                title="Web Preview"
                onLoad={handleFrameLoad}
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
                color: "var(--color-cc-muted)",
                fontSize: "14px",
                background: "var(--color-cc-bg)",
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
