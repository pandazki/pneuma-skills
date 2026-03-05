/**
 * SlidePreview — Slide Mode viewer component.
 *
 * Implements ViewerContract's PreviewComponent.
 * Two-part layout: SlideNavigator (configurable position) + SlideViewer (iframe).
 */

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { buildSelectionScript } from "../../../core/iframe-selection/index.js";
import { useStore } from "../../../src/store.js";
import { useSlideThumbnails, sanitizeHtmlQuotes } from "../hooks/useSlideThumbnails.js";
import SlideIframePool from "./SlideIframePool.js";
import HighlighterCanvas from "./HighlighterCanvas.js";
import { captureSlideRegion } from "./captureSlideRegion.js";
import { generateSlideScaffold, type SlideSpec, type ScaffoldFile } from "./scaffold.js";
import ScaffoldConfirm from "../../../src/components/ScaffoldConfirm.js";


// ── Types ────────────────────────────────────────────────────────────────────

interface SlideManifest {
  title: string;
  slides: { file: string; title: string }[];
}

type NavigatorPosition = "left" | "bottom" | "hidden";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse manifest.json from the files array */
function parseManifest(
  files: ViewerPreviewProps["files"],
): SlideManifest | null {
  const manifestFile = files.find(
    (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
  );
  if (!manifestFile) return null;
  try {
    return JSON.parse(manifestFile.content) as SlideManifest;
  } catch {
    return null;
  }
}

/** Find theme.css content from files array */
function findThemeCSS(files: ViewerPreviewProps["files"]): string {
  const themeFile = files.find(
    (f) => f.path === "theme.css" || f.path.endsWith("/theme.css"),
  );
  return themeFile?.content || "";
}

/** Find a slide's HTML content by its file path */
function findSlideContent(
  files: ViewerPreviewProps["files"],
  slidePath: string,
): string {
  const file = files.find(
    (f) => f.path === slidePath || f.path.endsWith(`/${slidePath}`),
  );
  return file?.content || "";
}

/**
 * Strip full-document HTML wrappers from a slide, keeping only the body content.
 * Some slides may be saved as complete HTML documents (<!DOCTYPE>, <html>, <head>, <body>)
 * instead of fragments. We need to extract just the body content so our srcdoc
 * template's theme CSS and sizing constraints apply correctly.
 */
function stripHtmlWrapper(html: string): string {
  // If it doesn't look like a full document, return as-is
  if (!html.includes("<!DOCTYPE") && !html.includes("<html")) return html;

  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();

  // Fallback: strip known tags
  return html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "")
    .trim();
}

/** Composite highlighter strokes PNG on top of a slide capture PNG */
function compositeStrokesOnCapture(
  basePngUrl: string,
  strokesPngUrl: string,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const baseImg = new Image();
    baseImg.onload = () => {
      const strokesImg = new Image();
      strokesImg.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(basePngUrl); return; }
        ctx.drawImage(baseImg, 0, 0, width, height);
        ctx.drawImage(strokesImg, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      strokesImg.onerror = () => resolve(basePngUrl);
      strokesImg.src = strokesPngUrl;
    };
    baseImg.onerror = () => reject(new Error("Failed to load base image"));
    baseImg.src = basePngUrl;
  });
}

/**
 * Slide-specific checkContentFit message handler extension.
 * Injected into the shared selection script via buildSelectionScript extensions.
 */
const CHECK_CONTENT_FIT_EXTENSION = `
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'pneuma:checkContentFit') return;
    var vw = e.data.viewportW || window.innerWidth || document.documentElement.clientWidth;
    var vh = e.data.viewportH || window.innerHeight || document.documentElement.clientHeight;
    var issues = [];
    var bodyChildren = Array.from(document.body.children);
    var flowChildren = bodyChildren.filter(function(child) {
      var pos = window.getComputedStyle(child).position;
      return pos !== 'absolute' && pos !== 'fixed';
    });
    for (var ci = 0; ci < flowChildren.length; ci++) {
      var el = flowChildren[ci];
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      var tag = el.tagName.toLowerCase();
      var cls = (typeof el.className === 'string' ? el.className : '').trim();
      var id = cls ? '<' + tag + '.' + cls.split(' ')[0] + '>' : '<' + tag + '>';
      var rect = el.getBoundingClientRect();
      if (rect.right > vw + 1 || rect.bottom > vh + 1) {
        issues.push(id + ' overflows viewport: right=' + Math.round(rect.right) + 'px (max ' + vw + '), bottom=' + Math.round(rect.bottom) + 'px (max ' + vh + ')');
      }
      var absHidden = [];
      for (var ak = 0; ak < el.children.length; ak++) {
        var absChild = el.children[ak];
        var absPos = window.getComputedStyle(absChild).position;
        if (absPos === 'absolute' || absPos === 'fixed') {
          absHidden.push({ el: absChild, prev: absChild.style.display });
          absChild.style.display = 'none';
        }
      }
      var overflowH = el.scrollHeight - el.clientHeight;
      var overflowW = el.scrollWidth - el.clientWidth;
      for (var ar = 0; ar < absHidden.length; ar++) {
        absHidden[ar].el.style.display = absHidden[ar].prev;
      }
      if (overflowH > 1) {
        issues.push(id + ' content clipped vertically: scrollHeight=' + el.scrollHeight + 'px, clientHeight=' + el.clientHeight + 'px (overflow by ' + overflowH + 'px)');
      }
      if (overflowW > 1) {
        issues.push(id + ' content clipped horizontally: scrollWidth=' + el.scrollWidth + 'px, clientWidth=' + el.clientWidth + 'px (overflow by ' + overflowW + 'px)');
      }
      for (var cj = 0; cj < el.children.length; cj++) {
        var child = el.children[cj];
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
        var childPos = window.getComputedStyle(child).position;
        if (childPos === 'absolute' || childPos === 'fixed') continue;
        var childOver = child.scrollHeight - child.clientHeight;
        if (childOver > 1) {
          var ctag = child.tagName.toLowerCase();
          var ccls = (typeof child.className === 'string' ? child.className : '').trim();
          var cid = ccls ? '<' + ctag + '.' + ccls.split(' ')[0] + '>' : '<' + ctag + '>';
          issues.push(cid + ' content clipped: scrollHeight=' + child.scrollHeight + 'px, clientHeight=' + child.clientHeight + 'px (overflow by ' + childOver + 'px)');
        }
      }
    }
    window.parent.postMessage({
      type: 'pneuma:contentFitResult',
      requestId: e.data.requestId,
      fits: issues.length === 0,
      issues: issues
    }, '*');
  });
`;

/**
 * Edit mode extension — makes text elements contentEditable on demand.
 * Tracks per-element before/after text and sends diff info with the edited HTML.
 */
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
      if (editDirty) {
        sendEditedContent();
        editDirty = false;
      }
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
    if (enable) {
      document.addEventListener('click', preventEditNav, true);
    } else {
      document.removeEventListener('click', preventEditNav, true);
    }
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

  document.addEventListener('input', function() {
    if (!editActive) return;
    editDirty = true;
  });

  document.addEventListener('blur', function(e) {
    if (!editActive) return;
    var el = e.target;
    if (el && el.contentEditable === 'true') {
      var newText = (el.textContent || '').trim();
      if (editOriginalText !== newText) {
        editChanges.push({ tag: editFocusedTag, before: editOriginalText, after: newText });
        editDirty = true;
      }
      if (editDirty) {
        sendEditedContent();
        editDirty = false;
      }
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
      if (styled[i].getAttribute('data-pneuma-annotated')) s.backgroundColor = '';
      if (!styled[i].getAttribute('style').trim()) styled[i].removeAttribute('style');
    }
    var da = clone.querySelectorAll('[data-pneuma-annotated]');
    for (var i = 0; i < da.length; i++) da[i].removeAttribute('data-pneuma-annotated');
    return clone.innerHTML.trim();
  }

  function sendEditedContent() {
    var changes = editChanges.slice();
    editChanges = [];
    window.parent.postMessage({
      type: 'pneuma:textEdit',
      html: serializeCleanBody(),
      changes: changes
    }, '*');
  }
`;

/** Selection script for slide iframes — shared library + slide-specific extensions */
const SELECTION_SCRIPT = buildSelectionScript({
  extensions: [CHECK_CONTENT_FIT_EXTENSION, EDIT_MODE_EXTENSION],
});

/**
 * Build a full HTML document for the iframe srcdoc.
 * Always injects the dormant selection script (controlled via postMessage).
 *
 * Two paths:
 * - Full HTML documents (with <!DOCTYPE>): keep the original document intact,
 *   inject <base>, sizing CSS, and selection script.
 * - Fragments: wrap in our template with themeCSS.
 */
function buildSrcdoc(slideHtml: string, themeCSS: string): string {
  slideHtml = sanitizeHtmlQuotes(slideHtml);
  const baseUrl = import.meta.env.DEV ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}` : "";
  const isFullDoc =
    slideHtml.includes("<!DOCTYPE") || slideHtml.includes("<html");

  if (isFullDoc) {
    let doc = slideHtml;
    const inject = `<base href="${baseUrl}/content/"><style>html,body{width:100%;height:100%;margin:0;padding:0;overflow:hidden;}</style>`;
    if (doc.includes("</head>")) {
      doc = doc.replace("</head>", `${inject}</head>`);
    } else if (/<body/i.test(doc)) {
      doc = doc.replace(/<body/i, `<head>${inject}</head><body`);
    }
    if (doc.includes("</body>")) {
      doc = doc.replace("</body>", `${SELECTION_SCRIPT}</body>`);
    } else {
      doc += SELECTION_SCRIPT;
    }
    return doc;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${baseUrl}/content/">
<style>${themeCSS}</style>
<style>
html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>
</head>
<body>
${stripHtmlWrapper(slideHtml)}
${SELECTION_SCRIPT}
</body>
</html>`;
}

// ── Persisted navigator position ─────────────────────────────────────────────

const NAV_STORAGE_KEY = "pneuma-slide-nav-position";

function loadNavPosition(): NavigatorPosition {
  try {
    const v = localStorage.getItem(NAV_STORAGE_KEY);
    if (v === "left" || v === "bottom" || v === "hidden") return v;
  } catch {}
  return "bottom";
}

function saveNavPosition(pos: NavigatorPosition) {
  try {
    localStorage.setItem(NAV_STORAGE_KEY, pos);
  } catch {}
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
    // Auto-focus after a short delay (iframe click may steal focus)
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

export default function SlidePreview({
  files,
  selection,
  onSelect,
  mode: previewMode,
  imageVersion,
  initParams,
  onActiveFileChange,
  actionRequest,
  onActionResult,
  onNotifyAgent,
}: ViewerPreviewProps) {
  const setPreviewMode = useStore((s) => s.setPreviewMode);
  const pushUserAction = useStore((s) => s.pushUserAction);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [navPosition, setNavPosition] = useState<NavigatorPosition>(loadNavPosition);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isGridView, setIsGridView] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number | null>(null); // null = pending first fit
  const [autoFit, setAutoFit] = useState(true); // continuous fit mode
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const iframeRefsRef = useRef<Map<string, HTMLIFrameElement>>(new Map());

  // Scaffold state
  const [scaffoldPending, setScaffoldPending] = useState<{
    files: ScaffoldFile[];
    clearPatterns: string[];
    resolve: (result: { success: boolean; message?: string }) => void;
    source: "agent" | "user";
  } | null>(null);

  const annotations = useStore((s) => s.annotations);
  const addAnnotation = useStore((s) => s.addAnnotation);

  // Pending annotation popover state (annotate mode: click → popover → confirm → add)
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    selection: ViewerSelectionContext;
    slideFile: string;
    rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);

  // Highlighter: Alt+draw to capture region screenshot
  const [altHeld, setAltHeld] = useState(false);
  const [showHighlighter, setShowHighlighter] = useState(false);

  const [highlightSelector, setHighlightSelector] = useState<string | null>(null);
  const manifest = useMemo(() => parseManifest(files), [files]);
  const themeCSS = useMemo(() => findThemeCSS(files), [files]);
  const isSelectMode = previewMode === "select" || previewMode === "annotate";
  const isEditMode = previewMode === "edit";

  // Optimistic slide order: updated immediately on drag, synced from manifest on external changes
  const [localSlides, setLocalSlides] = useState<{ file: string; title: string }[]>([]);
  useEffect(() => {
    setLocalSlides(manifest?.slides || []);
  }, [manifest]);
  const slides = localSlides;
  const slideCount = slides.length;

  // Persist nav position
  const changeNavPosition = useCallback((pos: NavigatorPosition) => {
    setNavPosition(pos);
    saveNavPosition(pos);
  }, []);

  // Cycle: left → bottom → hidden → left
  const cycleNavPosition = useCallback(() => {
    const next: NavigatorPosition =
      navPosition === "left" ? "bottom" : navPosition === "bottom" ? "hidden" : "left";
    changeNavPosition(next);
  }, [navPosition, changeNavPosition]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!fullscreenRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      fullscreenRef.current.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Grid view
  const toggleGridView = useCallback(() => setIsGridView((v) => !v), []);

  // Zoom — fit calculates scale from container size vs virtual slide dimensions
  const calcFitZoom = useCallback(() => {
    const el = viewerContainerRef.current;
    if (!el) return 100;
    const padding = 32; // breathing room
    const w = el.clientWidth - padding;
    const h = el.clientHeight - padding;
    if (w <= 0 || h <= 0) return 100;
    const vw = (initParams?.slideWidth as number) || 1280;
    const vh = (initParams?.slideHeight as number) || 720;
    return Math.max(30, Math.min(200, Math.floor(Math.min(w / vw, h / vh) * 100)));
  }, [initParams]);

  const zoomIn = useCallback(() => { setAutoFit(false); setZoomLevel((z) => Math.min(200, (z ?? 100) + 10)); }, []);
  const zoomOut = useCallback(() => { setAutoFit(false); setZoomLevel((z) => Math.max(30, (z ?? 100) - 10)); }, []);
  const zoomFit = useCallback(() => { setAutoFit(true); setZoomLevel(calcFitZoom()); }, [calcFitZoom]);

  // Auto-fit: on first render + continuous ResizeObserver while autoFit is on
  useEffect(() => {
    if (slideCount === 0) return;
    const el = viewerContainerRef.current;
    if (!el) return;
    // Initial fit
    setZoomLevel(calcFitZoom());
    // Continuous fit via ResizeObserver
    const ro = new ResizeObserver(() => {
      if (autoFit) setZoomLevel(calcFitZoom());
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [calcFitZoom, slideCount, autoFit]);

  // Drag reorder — optimistic local update + persist via API
  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!manifest) return;
      const newSlides = [...slides];
      const [moved] = newSlides.splice(fromIndex, 1);
      newSlides.splice(toIndex, 0, moved);

      // Optimistic update: immediately reflect new order
      setLocalSlides(newSlides);

      // Update active index to follow the moved slide
      if (activeSlideIndex === fromIndex) {
        setActiveSlideIndex(toIndex);
      } else if (activeSlideIndex > fromIndex && activeSlideIndex <= toIndex) {
        setActiveSlideIndex(activeSlideIndex - 1);
      } else if (activeSlideIndex < fromIndex && activeSlideIndex >= toIndex) {
        setActiveSlideIndex(activeSlideIndex + 1);
      }

      // Persist to file in background
      const newManifest = { ...manifest, slides: newSlides };
      const baseUrl = import.meta.env.DEV ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}` : "";
      fetch(`${baseUrl}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "manifest.json",
          content: JSON.stringify(newManifest, null, 2) + "\n",
        }),
      }).catch(() => {});

      pushUserAction({
        timestamp: Date.now(),
        actionId: "reorder-slide",
        description: `Moved slide "${moved.title || moved.file}" from position ${fromIndex + 1} to ${toIndex + 1}`,
      });
    },
    [manifest, slides, activeSlideIndex, pushUserAction],
  );

  // Delete slide — remove from manifest (confirmation handled by UI component)
  const handleDeleteSlide = useCallback(
    (index: number) => {
      if (!manifest || slides.length <= 1) return;
      const slide = slides[index];

      const newSlides = slides.filter((_, i) => i !== index);
      setLocalSlides(newSlides);

      if (activeSlideIndex >= newSlides.length) {
        setActiveSlideIndex(newSlides.length - 1);
      } else if (activeSlideIndex > index) {
        setActiveSlideIndex(activeSlideIndex - 1);
      }

      const newManifest = { ...manifest, slides: newSlides };
      const baseUrl = import.meta.env.DEV ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}` : "";
      fetch(`${baseUrl}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "manifest.json",
          content: JSON.stringify(newManifest, null, 2) + "\n",
        }),
      }).catch(() => {});

      pushUserAction({
        timestamp: Date.now(),
        actionId: "delete-slide",
        description: `Deleted slide ${index + 1}: "${slide.title || slide.file}"`,
      });
    },
    [manifest, slides, activeSlideIndex, pushUserAction],
  );

  // Handle text edit from iframe (edit mode)
  const editTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingChangesRef = useRef<{ tag: string; before: string; after: string }[]>([]);
  const handleTextEdit = useCallback(
    (slideFile: string, html: string, changes?: { tag: string; before: string; after: string }[]) => {
      if (changes?.length) {
        pendingChangesRef.current.push(...changes);
      }
      clearTimeout(editTimerRef.current);
      editTimerRef.current = setTimeout(() => {
        const baseUrl = import.meta.env.DEV ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}` : "";
        fetch(`${baseUrl}/api/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: slideFile, content: html + "\n" }),
        }).catch(() => {});

        const slide = slides.find((s) => s.file === slideFile);
        const label = slide?.title || slideFile;
        const batch = pendingChangesRef.current.splice(0);
        const diffLines = batch.map((c) =>
          `  <${c.tag}>: "${c.before}" → "${c.after}"`
        );
        const desc = diffLines.length > 0
          ? `Edited text on slide "${label}":\n${diffLines.join("\n")}`
          : `Edited text on slide "${label}"`;
        pushUserAction({
          timestamp: Date.now(),
          actionId: "edit-text",
          description: desc,
        });
      }, 800);
    },
    [slides, pushUserAction],
  );

  // Clamp active index when slides change
  useEffect(() => {
    if (activeSlideIndex >= slideCount && slideCount > 0) {
      setActiveSlideIndex(slideCount - 1);
    }
  }, [slideCount, activeSlideIndex]);

  // Notify parent of current viewing file
  const currentFile = slides[activeSlideIndex]?.file || null;
  useEffect(() => {
    onActiveFileChange?.(currentFile);
  }, [currentFile, onActiveFileChange]);

  // Scaffold execution helper
  const executeScaffold = useCallback(async (
    scaffoldFiles: ScaffoldFile[],
    clearPatterns: string[],
  ): Promise<{ success: boolean; message?: string }> => {
    const baseUrl = import.meta.env.DEV ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}` : "";
    try {
      const res = await fetch(`${baseUrl}/api/workspace/scaffold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: clearPatterns, files: scaffoldFiles }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveSlideIndex(0);
        return { success: true, message: `Created ${data.filesWritten} files` };
      }
      return { success: false, message: data.message || "Scaffold failed" };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Network error" };
    }
  }, []);

  // Handle viewer action requests from agent
  useEffect(() => {
    if (!actionRequest) return;

    switch (actionRequest.actionId) {
      case "navigate-to": {
        const targetFile = actionRequest.params?.file as string;
        const index = slides.findIndex((s) => s.file === targetFile);
        if (index !== -1) {
          setActiveSlideIndex(index);
          onActionResult?.(actionRequest.requestId, { success: true });
        } else {
          onActionResult?.(actionRequest.requestId, {
            success: false,
            message: `Slide not found: ${targetFile}`,
          });
        }
        break;
      }
      case "scaffold": {
        const title = actionRequest.params?.title as string;
        const slidesParam = actionRequest.params?.slides as string;
        if (!title || !slidesParam) {
          onActionResult?.(actionRequest.requestId, {
            success: false,
            message: "title and slides params are required",
          });
          break;
        }
        let slideSpecs: SlideSpec[];
        try {
          slideSpecs = JSON.parse(slidesParam);
        } catch {
          onActionResult?.(actionRequest.requestId, {
            success: false,
            message: "slides param must be valid JSON array",
          });
          break;
        }
        const scaffoldFiles = generateSlideScaffold(title, slideSpecs);
        const reqId = actionRequest.requestId;
        setScaffoldPending({
          files: scaffoldFiles,
          clearPatterns: ["slides/*.html", "manifest.json"],
          source: "agent",
          resolve: (result) => {
            onActionResult?.(reqId, result);
          },
        });
        break;
      }
      case "checkContentFit": {
        const slidesParam = actionRequest.params?.slides as string | undefined;
        let targetIndices: number[];
        if (slidesParam) {
          try {
            const oneIndexed: number[] = JSON.parse(slidesParam);
            targetIndices = oneIndexed.map((n) => n - 1).filter((i) => i >= 0 && i < slides.length);
          } catch {
            onActionResult?.(actionRequest.requestId, {
              success: false,
              message: "slides param must be a JSON array of 1-indexed slide numbers",
            });
            break;
          }
        } else {
          targetIndices = slides.map((_, i) => i);
        }

        if (targetIndices.length === 0) {
          onActionResult?.(actionRequest.requestId, {
            success: true,
            data: { results: [], allFit: true },
          });
          break;
        }

        const refs = iframeRefsRef.current;
        const pending = new Map<string, number>(); // requestId → slide 1-indexed
        const results: { slide: number; file: string; fits: boolean | null; issues: string[] }[] = [];
        let responded = false;
        const reqId = actionRequest.requestId;

        for (const idx of targetIndices) {
          const slide = slides[idx];
          const iframe = refs.get(slide.file);
          if (!iframe?.contentWindow) {
            results.push({ slide: idx + 1, file: slide.file, fits: null, issues: ["Not rendered in pool"] });
            continue;
          }
          const subReqId = `fit-${idx}-${Date.now()}`;
          pending.set(subReqId, idx + 1);
          try {
            iframe.contentWindow.postMessage({
              type: "pneuma:checkContentFit",
              requestId: subReqId,
              viewportW: VIRTUAL_W,
              viewportH: VIRTUAL_H,
            }, "*");
          } catch {
            pending.delete(subReqId);
            results.push({ slide: idx + 1, file: slide.file, fits: null, issues: ["Failed to send message to iframe"] });
          }
        }

        if (pending.size === 0) {
          const allFit = results.every((r) => r.fits === true || r.fits === null);
          onActionResult?.(reqId, { success: true, data: { results, allFit } });
          break;
        }

        const handleResult = (e: MessageEvent) => {
          if (responded || e.data?.type !== "pneuma:contentFitResult") return;
          const subId = e.data.requestId as string;
          if (!pending.has(subId)) return;
          const slideNum = pending.get(subId)!;
          pending.delete(subId);
          const slideFile = slides[slideNum - 1]?.file || "";
          results.push({
            slide: slideNum,
            file: slideFile,
            fits: !!e.data.fits,
            issues: e.data.issues || [],
          });
          if (pending.size === 0) {
            responded = true;
            window.removeEventListener("message", handleResult);
            clearTimeout(timer);
            results.sort((a, b) => a.slide - b.slide);
            const allFit = results.every((r) => r.fits === true);
            onActionResult?.(reqId, { success: true, data: { results, allFit } });
          }
        };

        window.addEventListener("message", handleResult);

        const timer = setTimeout(() => {
          if (responded) return;
          responded = true;
          window.removeEventListener("message", handleResult);
          for (const [, slideNum] of pending) {
            const slideFile = slides[slideNum - 1]?.file || "";
            results.push({ slide: slideNum, file: slideFile, fits: null, issues: ["Timeout waiting for iframe response"] });
          }
          results.sort((a, b) => a.slide - b.slide);
          const allFit = results.every((r) => r.fits === true);
          onActionResult?.(reqId, { success: true, data: { results, allFit } });
        }, 5000);

        break;
      }
      default:
        onActionResult?.(actionRequest.requestId, {
          success: false,
          message: `Unknown action: ${actionRequest.actionId}`,
        });
    }
  }, [actionRequest]);

  // Navigate to slide + highlight when external selection arrives (e.g. clicking historical SelectionCard)
  // Use a stamp counter to detect genuine selection changes from the store
  const selectionStamp = useStore((s) => s.selectionStamp);
  useEffect(() => {
    if (!selectionStamp || !selection?.file) {
      setHighlightSelector(null);
      return;
    }
    // Find the slide index for the selection's file
    const targetIndex = slides.findIndex((s) => s.file === selection.file);
    if (targetIndex !== -1) {
      // Navigate even if already on this slide (to re-highlight)
      setActiveSlideIndex(targetIndex);
      // Set highlight selector (if present)
      setHighlightSelector(selection.selector || null);
    }
    // Slide was deleted — stay on current slide, clear highlight
    // (no else needed, just don't navigate)
  }, [selectionStamp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear highlight when selection is removed externally (e.g. X button in ChatInput)
  useEffect(() => {
    if (!selection) {
      setHighlightSelector(null);
    }
  }, [selection]);

  // Current slide (used for fullscreen)
  const currentSlide = slides[activeSlideIndex];

  // Virtual slide dimensions from init params (or defaults)
  const VIRTUAL_W = (initParams?.slideWidth as number) || 1280;
  const VIRTUAL_H = (initParams?.slideHeight as number) || 720;

  // Capture slide thumbnails as PNG data URL images via snapdom
  const thumbnailImages = useSlideThumbnails(slides, files, themeCSS, VIRTUAL_W, VIRTUAL_H);

  // ── Auto content-fit check on file changes ─────────────────────────────
  // When files change, wait for iframes to render, then check if any slide
  // has overflowing content. Only notify agent on state transition (fit → overflow).
  const prevOverflowRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!onNotifyAgent || slides.length === 0) return;

    const timer = setTimeout(() => {
      const refs = iframeRefsRef.current;
      if (refs.size === 0) return;

      const pending = new Map<string, { slideNum: number; file: string }>();
      const results: { slide: number; file: string; fits: boolean; issues: string[] }[] = [];
      let responded = false;

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const iframe = refs.get(slide.file);
        if (!iframe?.contentWindow) continue;
        const subReqId = `autofit-${i}-${Date.now()}`;
        pending.set(subReqId, { slideNum: i + 1, file: slide.file });
        try {
          iframe.contentWindow.postMessage({
            type: "pneuma:checkContentFit",
            requestId: subReqId,
            viewportW: VIRTUAL_W,
            viewportH: VIRTUAL_H,
          }, "*");
        } catch {
          pending.delete(subReqId);
        }
      }

      if (pending.size === 0) return;

      const handleResult = (e: MessageEvent) => {
        if (responded || e.data?.type !== "pneuma:contentFitResult") return;
        const subId = e.data.requestId as string;
        const info = pending.get(subId);
        if (!info) return;
        pending.delete(subId);
        results.push({
          slide: info.slideNum,
          file: info.file,
          fits: !!e.data.fits,
          issues: e.data.issues || [],
        });
        if (pending.size === 0) {
          responded = true;
          window.removeEventListener("message", handleResult);
          clearTimeout(timeoutTimer);
          processAutoFitResults(results);
        }
      };

      const processAutoFitResults = (res: typeof results) => {
        const overflowing = new Set<string>();
        const overflowDetails: string[] = [];
        for (const r of res) {
          if (!r.fits) {
            overflowing.add(r.file);
            overflowDetails.push(`Slide ${r.slide} (${r.file}): ${r.issues.join("; ")}`);
          }
        }

        // Only notify on state change: new overflow slides that weren't overflowing before
        const prevOverflow = prevOverflowRef.current;
        const newOverflows = [...overflowing].filter((f) => !prevOverflow.has(f));
        prevOverflowRef.current = overflowing;

        if (newOverflows.length === 0) return;

        const msg = [
          `<viewer-notification type="contentFitCheck">`,
          `Content overflow detected on ${overflowing.size} slide(s). The following slides have content that doesn't fit within the ${VIRTUAL_W}x${VIRTUAL_H} viewport:`,
          "",
          ...overflowDetails,
          "",
          `Please fix the overflowing slides so all content fits within the viewport. Reduce content, adjust font sizes, or restructure the layout.`,
          `</viewer-notification>`,
        ].join("\n");

        // Build a clean one-liner for UI display
        const overflowFiles = [...overflowing];
        const summary = overflowFiles.length === 1
          ? `${overflowFiles[0]} content overflows viewport`
          : `${overflowFiles.length} slides overflow viewport`;

        onNotifyAgent({ type: "contentFitCheck", severity: "warning", message: msg, summary });
      };

      window.addEventListener("message", handleResult);
      const timeoutTimer = setTimeout(() => {
        if (responded) return;
        responded = true;
        window.removeEventListener("message", handleResult);
        // On timeout, process whatever we have
        processAutoFitResults(results);
      }, 3000);
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [files, slides, VIRTUAL_W, VIRTUAL_H, onNotifyAgent]);

  // Navigation
  const goToSlide = useCallback(
    (index: number) => {
      if (index >= 0 && index < slideCount) {
        setActiveSlideIndex(index);
        onSelect(null);
      }
    },
    [slideCount, onSelect],
  );

  const goPrev = useCallback(
    () => goToSlide(activeSlideIndex - 1),
    [activeSlideIndex, goToSlide],
  );
  const goNext = useCallback(
    () => goToSlide(activeSlideIndex + 1),
    [activeSlideIndex, goToSlide],
  );

  // Annotation selectors for highlighting on the current slide
  const annotationSelectors = useMemo(() => {
    const currentFile = slides[activeSlideIndex]?.file;
    if (!currentFile) return [];
    return annotations
      .filter((a) => a.slideFile === currentFile && a.element.selector)
      .map((a) => a.element.selector!);
  }, [annotations, slides, activeSlideIndex]);

  // Select handler: in annotate mode, show popover; in select mode, delegate to onSelect
  const handleSelect = useCallback(
    (sel: ViewerSelectionContext | null, rect?: { left: number; top: number; right: number; bottom: number; width: number; height: number }) => {
      if (previewMode === "annotate") {
        if (!sel) {
          setPendingAnnotation(null);
          return;
        }
        const currentSlide = slides[activeSlideIndex];
        if (!currentSlide || !rect) return;
        setPendingAnnotation({
          selection: sel,
          slideFile: currentSlide.file,
          rect,
        });
        return;
      }
      onSelect(sel);
    },
    [previewMode, slides, activeSlideIndex, onSelect],
  );

  // Confirm pending annotation with comment
  const confirmAnnotation = useCallback(
    (comment: string) => {
      if (!pendingAnnotation) return;
      const { selection: sel, slideFile } = pendingAnnotation;
      addAnnotation({
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        slideFile,
        element: {
          file: slideFile,
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

  // Dismiss pending annotation on slide navigation
  useEffect(() => { setPendingAnnotation(null); }, [activeSlideIndex]);

  // Keyboard navigation (skip when focus is inside editable elements)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToSlide(activeSlideIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToSlide(activeSlideIndex + 1);
      } else if (e.key === "Escape") {
        // Fullscreen exit is handled by the browser's Fullscreen API
        if (previewMode === "annotate" && pendingAnnotation) {
          setPendingAnnotation(null);
        } else if (previewMode === "annotate" || previewMode === "edit") {
          setPreviewMode("view");
        } else if (previewMode === "select") {
          if (selection) {
            onSelect(null);
          } else {
            setPreviewMode("view");
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeSlideIndex,
    goToSlide,
    previewMode,
    pendingAnnotation,
    selection,
    onSelect,
    setPreviewMode,
  ]);

  // Alt key tracking for highlighter mode (select mode only)
  useEffect(() => {
    if (previewMode !== "select") {
      setAltHeld(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [previewMode]);

  // Clear highlighter when selection is cleared or mode changes
  useEffect(() => {
    if (!selection) setShowHighlighter(false);
  }, [selection]);
  useEffect(() => {
    if (previewMode !== "select") setShowHighlighter(false);
  }, [previewMode]);

  // Highlighter completion: capture region screenshot → set as standard selection
  const handleHighlighterComplete = useCallback(
    async (region: { x: number; y: number; width: number; height: number }, strokesDataUrl?: string) => {
      const currentSlide = slides[activeSlideIndex];
      if (!currentSlide) return;

      const slideHtml = findSlideContent(files, currentSlide.file);
      if (!slideHtml) return;

      // Keep strokes visible
      setShowHighlighter(true);

      try {
        const VIRTUAL_W_VAL = (initParams?.slideWidth as number) || 1280;
        const VIRTUAL_H_VAL = (initParams?.slideHeight as number) || 720;
        let pngDataUrl = await captureSlideRegion(
          slideHtml,
          themeCSS,
          VIRTUAL_W_VAL,
          VIRTUAL_H_VAL,
          region,
        );

        // Composite highlighter strokes on top of the slide screenshot
        if (strokesDataUrl) {
          try {
            pngDataUrl = await compositeStrokesOnCapture(pngDataUrl, strokesDataUrl, region.width, region.height);
          } catch { /* use un-composited capture */ }
        }

        // Use standard selection flow (same as clicking an element)
        onSelect({
          type: "region",
          content: "",
          file: currentSlide.file,
          thumbnail: pngDataUrl,
          label: "Highlighted region",
        });
      } catch {
        setShowHighlighter(false);
      }
    },
    [slides, activeSlideIndex, files, themeCSS, initParams, onSelect],
  );

  // Scaffold confirm/cancel handlers (must be before early returns to satisfy Rules of Hooks)
  const handleScaffoldConfirm = useCallback(async () => {
    if (!scaffoldPending) return;
    const { files: sFiles, clearPatterns, resolve, source } = scaffoldPending;
    setScaffoldPending(null);
    const result = await executeScaffold(sFiles, clearPatterns);
    resolve(result);
    if (result.success && source === "user") {
      pushUserAction({
        timestamp: Date.now(),
        actionId: "scaffold",
        description: `Initialized workspace with ${sFiles.length - 1} slides`,
      });
    }
  }, [scaffoldPending, executeScaffold, pushUserAction]);

  const handleScaffoldCancel = useCallback(() => {
    if (!scaffoldPending) return;
    scaffoldPending.resolve({ success: false, message: "Cancelled by user" });
    setScaffoldPending(null);
  }, [scaffoldPending]);

  // User-initiated scaffold from toolbar button
  const handleUserScaffold = useCallback(() => {
    const title = window.prompt("Deck title:", manifest?.title || "Untitled");
    if (!title) return;
    const slidesInput = window.prompt(
      "Slide titles (comma-separated):",
      "Cover, Introduction, Content, Summary",
    );
    if (!slidesInput) return;
    const slideSpecs: SlideSpec[] = slidesInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((t) => ({ title: t }));
    if (slideSpecs.length === 0) return;
    const scaffoldFiles = generateSlideScaffold(title, slideSpecs);
    setScaffoldPending({
      files: scaffoldFiles,
      clearPatterns: ["slides/*.html", "manifest.json"],
      source: "user",
      resolve: () => {},
    });
  }, [manifest]);

  // Zoom: render iframe at a virtual size, use CSS transform to scale
  // (must be before early returns to satisfy Rules of Hooks)
  const effectiveZoom = zoomLevel ?? 100;
  const zoomScale = effectiveZoom / 100;
  const scaledW = VIRTUAL_W * zoomScale;
  const scaledH = VIRTUAL_H * zoomScale;

  // Popover positioning (relative to the sizer div, in scaled coordinates)
  const popoverStyle = useMemo((): React.CSSProperties => {
    if (!pendingAnnotation) return {};
    const { rect } = pendingAnnotation;
    const POPOVER_H = 130;
    const POPOVER_W = 280;

    let top = rect.bottom * zoomScale + 8;
    if (top + POPOVER_H > scaledH) {
      top = rect.top * zoomScale - POPOVER_H - 8;
    }
    top = Math.max(0, top);

    let left = rect.left * zoomScale;
    left = Math.max(8, Math.min(left, scaledW - POPOVER_W - 8));

    return { position: "absolute" as const, top, left, width: POPOVER_W, zIndex: 50 };
  }, [pendingAnnotation, zoomScale, scaledW, scaledH]);

  if (!manifest || slideCount === 0) {
    return (
      <div className="flex flex-col h-full">
        <SlideToolbar
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
          slideIndex={0}
          slideCount={0}
          onPrev={goPrev}
          onNext={goNext}
          onGoToSlide={goToSlide}
          navPosition={navPosition}
          onCycleNav={cycleNavPosition}
          onToggleFullscreen={toggleFullscreen}
          isGridView={isGridView}
          onToggleGridView={toggleGridView}
          zoomLevel={effectiveZoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomFit={zoomFit}
          onScaffold={handleUserScaffold}
        />
        <div className="flex items-center justify-center flex-1 text-neutral-500">
          {!manifest
            ? "No manifest.json found in workspace"
            : "No slides in manifest.json"}
        </div>
      </div>
    );
  }

  const navigatorEl = navPosition !== "hidden" ? (
    <SlideNavigator
      slides={slides}
      activeIndex={activeSlideIndex}
      onSelect={goToSlide}
      onReorder={handleReorder}
      onDelete={isEditMode ? handleDeleteSlide : undefined}
      thumbnailImages={thumbnailImages}
      position={navPosition}
      virtualWidth={VIRTUAL_W}
      virtualHeight={VIRTUAL_H}
    />
  ) : null;

  const viewerEl = (
    <div ref={viewerContainerRef} className="flex-1 flex items-center justify-center bg-neutral-900 min-w-0 min-h-0 overflow-auto">
      <div
        className="shrink-0 relative"
        style={{ width: scaledW, height: scaledH }}
      >
        <div
          className="relative bg-black rounded-lg overflow-hidden shadow-2xl origin-top-left"
          style={{
            width: VIRTUAL_W,
            height: VIRTUAL_H,
            transform: `scale(${zoomScale})`,
          }}
        >
          <SlideIframePool
            slides={slides}
            files={files}
            themeCSS={themeCSS}
            activeIndex={activeSlideIndex}
            isSelectMode={isSelectMode}
            isEditMode={isEditMode}
            imageVersion={imageVersion}
            onSelect={handleSelect}
            onTextEdit={handleTextEdit}
            buildSrcdoc={buildSrcdoc}
            findSlideContent={findSlideContent}
            highlightSelector={highlightSelector}
            annotationSelectors={annotationSelectors}
            onEscapeKey={() => {
              if (selection) {
                onSelect(null);
              } else {
                setPreviewMode("view");
              }
            }}
            onAltKey={(pressed) => setAltHeld(pressed)}
            iframeRefsOut={(refs) => { iframeRefsRef.current = refs; }}
          />
        </div>
        {(altHeld || showHighlighter) && previewMode === "select" && (
          <HighlighterCanvas
            width={scaledW}
            height={scaledH}
            zoomScale={zoomScale}
            virtualW={VIRTUAL_W}
            virtualH={VIRTUAL_H}
            drawing={altHeld}
            onComplete={handleHighlighterComplete}
          />
        )}
        {pendingAnnotation && (
          <AnnotationPopover
            style={popoverStyle}
            label={pendingAnnotation.selection.label}
            thumbnail={pendingAnnotation.selection.thumbnail}
            onConfirm={confirmAnnotation}
            onCancel={() => setPendingAnnotation(null)}
          />
        )}
      </div>
    </div>
  );

  // Grid view: all slides in a grid
  if (isGridView) {
    return (
      <div ref={fullscreenRef} className="flex flex-col h-full">
        <SlideToolbar
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
          slideIndex={activeSlideIndex}
          slideCount={slideCount}
          onPrev={goPrev}
          onNext={goNext}
          onGoToSlide={goToSlide}
          navPosition={navPosition}
          onCycleNav={cycleNavPosition}
          onToggleFullscreen={toggleFullscreen}
          isGridView={isGridView}
          onToggleGridView={toggleGridView}
          zoomLevel={effectiveZoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomFit={zoomFit}
          onScaffold={handleUserScaffold}
        />
        <div className="flex-1 overflow-auto bg-neutral-900 p-4">
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {slides.map((slide, i) => (
              <button
                key={slide.file}
                onClick={() => {
                  goToSlide(i);
                  setIsGridView(false);
                }}
                className={`flex flex-col gap-2 p-2 rounded-lg transition-colors cursor-pointer text-left w-fit ${
                  i === activeSlideIndex
                    ? "bg-cc-primary/10"
                    : "hover:bg-cc-hover"
                }`}
              >
                <SlideThumbnail imageUrl={thumbnailImages.get(slide.file)} isActive={i === activeSlideIndex} width={280} height={157.5} virtualWidth={VIRTUAL_W} virtualHeight={VIRTUAL_H} />
                <span className={`text-xs px-1 truncate ${
                  i === activeSlideIndex ? "text-cc-primary" : "text-cc-muted"
                }`}>
                  {String(i + 1).padStart(2, "0")} {slide.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Fullscreen: only the slide, no UI chrome
  if (isFullscreen) {
    return (
      <div ref={fullscreenRef} className="flex flex-col h-full bg-black">
        <div className="flex-1 flex items-center justify-center">
          <iframe
            srcDoc={buildSrcdoc(currentSlide ? findSlideContent(files, currentSlide.file) : "", themeCSS)}
            title={currentSlide?.title || "Slide"}
            className="w-full h-full border-0"
            sandbox="allow-scripts"
          />
        </div>
        {/* Minimal slide counter overlay */}
        <div className="absolute bottom-4 right-4 text-white/40 text-sm font-mono pointer-events-none">
          {activeSlideIndex + 1} / {slideCount}
        </div>
      </div>
    );
  }

  return (
    <div ref={fullscreenRef} className="flex flex-col h-full">
      <SlideToolbar
        previewMode={previewMode}
        onSetPreviewMode={setPreviewMode}
        slideIndex={activeSlideIndex}
        slideCount={slideCount}
        onPrev={goPrev}
        onNext={goNext}
        onGoToSlide={goToSlide}
        navPosition={navPosition}
        onCycleNav={cycleNavPosition}
        onToggleFullscreen={toggleFullscreen}
        isGridView={isGridView}
        onToggleGridView={toggleGridView}
        zoomLevel={effectiveZoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomFit={zoomFit}
      />
      {navPosition === "left" ? (
        <div className="flex flex-1 min-h-0">
          {navigatorEl}
          {viewerEl}
        </div>
      ) : navPosition === "bottom" ? (
        <div className="flex flex-col flex-1 min-h-0">
          {viewerEl}
          {navigatorEl}
        </div>
      ) : (
        /* hidden */
        <div className="flex flex-1 min-h-0">{viewerEl}</div>
      )}
      {scaffoldPending && (
        <ScaffoldConfirm
          clearPatterns={scaffoldPending.clearPatterns}
          files={scaffoldPending.files}
          onConfirm={handleScaffoldConfirm}
          onCancel={handleScaffoldCancel}
        />
      )}
    </div>
  );
}

// ── Slide Navigator ──────────────────────────────────────────────────────────

function SlideNavigator({
  slides,
  activeIndex,
  onSelect,
  onReorder,
  onDelete,
  thumbnailImages,
  position,
  virtualWidth,
  virtualHeight,
}: {
  slides: { file: string; title: string }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDelete?: (index: number) => void;
  thumbnailImages: Map<string, string>;
  position: "left" | "bottom";
  virtualWidth: number;
  virtualHeight: number;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  // Require 5px of movement before starting drag (so clicks still work)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const slideIds = useMemo(() => slides.map((s) => s.file), [slides]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = slideIds.indexOf(active.id as string);
        const newIndex = slideIds.indexOf(over.id as string);
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorder(oldIndex, newIndex);
        }
      }
    },
    [slideIds, onReorder],
  );

  // Auto-scroll active slide into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeIndex]);

  const strategy =
    position === "bottom" ? horizontalListSortingStrategy : verticalListSortingStrategy;

  if (position === "bottom") {
    return (
      <div className="shrink-0 border-t border-cc-border bg-cc-bg">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={slideIds} strategy={strategy}>
            <div className="flex overflow-x-auto p-2 gap-2">
              {slides.map((slide, i) => (
                <SortableSlideItem
                  key={slide.file}
                  id={slide.file}
                  ref={i === activeIndex ? activeRef : undefined}
                  index={i}
                  title={slide.title}
                  isActive={i === activeIndex}
                  imageUrl={thumbnailImages.get(slide.file)}
                  onClick={() => onSelect(i)}
                  onDelete={onDelete && slides.length > 1 ? () => onDelete(i) : undefined}
                  layout="horizontal"
                  virtualWidth={virtualWidth}
                  virtualHeight={virtualHeight}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    );
  }

  // position === "left"
  return (
    <div className="w-52 shrink-0 border-r border-cc-border bg-cc-bg overflow-y-auto">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={slideIds} strategy={strategy}>
          <div className="p-2 flex flex-col gap-2">
            {slides.map((slide, i) => (
              <SortableSlideItem
                key={slide.file}
                id={slide.file}
                ref={i === activeIndex ? activeRef : undefined}
                index={i}
                title={slide.title}
                isActive={i === activeIndex}
                imageUrl={thumbnailImages.get(slide.file)}
                srcdoc={getSrcdoc?.(slide.file)}
                onClick={() => onSelect(i)}
                onDelete={onDelete && slides.length > 1 ? () => onDelete(i) : undefined}
                layout="vertical"
                virtualWidth={virtualWidth}
                virtualHeight={virtualHeight}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

// ── Sortable Slide Item ──────────────────────────────────────────────────────

import { forwardRef } from "react";

const SortableSlideItem = forwardRef<
  HTMLDivElement,
  {
    id: string;
    index: number;
    title: string;
    isActive: boolean;
    imageUrl: string | undefined;
    onClick: () => void;
    onDelete?: () => void;
    layout: "horizontal" | "vertical";
    virtualWidth: number;
    virtualHeight: number;
  }
>(function SortableSlideItem({ id, index, title, isActive, imageUrl, onClick, onDelete, layout, virtualWidth, virtualHeight }, outerRef) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  // Two-click delete: first click arms, second confirms
  const [deleteArmed, setDeleteArmed] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Reset armed state after 2s timeout
  useEffect(() => {
    if (deleteArmed) {
      deleteTimerRef.current = setTimeout(() => setDeleteArmed(false), 2000);
      return () => clearTimeout(deleteTimerRef.current);
    }
  }, [deleteArmed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteArmed) {
      clearTimeout(deleteTimerRef.current);
      setDeleteArmed(false);
      onDelete?.();
    } else {
      setDeleteArmed(true);
    }
  }, [deleteArmed, onDelete]);

  // Merge refs
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (typeof outerRef === "function") outerRef(node);
      else if (outerRef) outerRef.current = node;
    },
    [setNodeRef, outerRef],
  );

  const deleteBtn = onDelete ? (
    <button
      onClick={handleDeleteClick}
      className={`absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center z-10 cursor-pointer transition-all ${
        deleteArmed
          ? "bg-red-500/90 text-white opacity-100 scale-110"
          : "bg-black/50 text-cc-muted hover:text-cc-fg opacity-0 group-hover:opacity-100"
      }`}
      title={deleteArmed ? "Click again to confirm" : "Delete slide"}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
        {deleteArmed
          ? <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          : <><path d="M5 3V2h6v1M2 4h12M4 4v9a1 1 0 001 1h6a1 1 0 001-1V4" /><path d="M7 7v4M9 7v4" /></>
        }
      </svg>
    </button>
  ) : null;

  if (layout === "horizontal") {
    return (
      <div
        ref={mergedRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={onClick}
        className={`shrink-0 flex flex-col items-center gap-1 cursor-pointer group relative ${
          isActive ? "" : "opacity-60 hover:opacity-100"
        } ${isDragging ? "opacity-70 scale-105 shadow-lg" : ""}`}
      >
        {deleteBtn}
        <SlideThumbnail imageUrl={imageUrl} isActive={isActive} width={144} height={81} virtualWidth={virtualWidth} virtualHeight={virtualHeight} />
        <span
          className={`text-[10px] max-w-[144px] truncate ${
            isActive ? "text-cc-primary" : "text-cc-muted group-hover:text-cc-fg"
          }`}
        >
          {String(index + 1).padStart(2, "0")} {title}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={mergedRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`w-full flex flex-col gap-1 cursor-pointer group relative ${
        isActive ? "" : "opacity-60 hover:opacity-100"
      } ${isDragging ? "opacity-70 scale-105 shadow-lg" : ""}`}
    >
      {deleteBtn}
      <SlideThumbnail imageUrl={imageUrl} srcdoc={srcdoc} isActive={isActive} virtualWidth={virtualWidth} virtualHeight={virtualHeight} />
      <div className="flex items-baseline gap-1.5 px-0.5">
        <span
          className={`text-[10px] font-mono shrink-0 ${
            isActive ? "text-cc-primary" : "text-cc-muted/60"
          }`}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          className={`text-xs truncate ${
            isActive ? "text-cc-primary" : "text-cc-muted group-hover:text-cc-fg"
          }`}
        >
          {title}
        </span>
      </div>
    </div>
  );
});

// ── Slide Thumbnail ──────────────────────────────────────────────────────────

/** Renders a slide thumbnail as a PNG <img> */
function SlideThumbnail({
  imageUrl,
  isActive,
  width,
  height,
  virtualWidth,
  virtualHeight,
}: {
  imageUrl: string | undefined;
  isActive: boolean;
  width?: number;
  height?: number;
  virtualWidth?: number;
  virtualHeight?: number;
}) {
  const VIRTUAL_W = virtualWidth || 1280;
  const VIRTUAL_H = virtualHeight || 720;
  const thumbW = width ?? 192; // default for sidebar
  const thumbH = height ?? (thumbW * VIRTUAL_H) / VIRTUAL_W;

  return (
    <div
      className={`relative rounded overflow-hidden border-2 transition-colors ${
        isActive
          ? "border-cc-primary shadow-[0_0_0_1px_rgba(217,119,87,0.3)]"
          : "border-transparent hover:border-cc-border"
      }`}
      style={{ width: thumbW, height: thumbH }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
          aria-hidden="true"
        />
      ) : (
        <div className="w-full h-full bg-cc-bg/50 animate-pulse" />
      )}
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

type PreviewMode = "view" | "edit" | "select" | "annotate";

function SlideToolbar({
  previewMode,
  onSetPreviewMode,
  slideIndex,
  slideCount,
  onPrev,
  onNext,
  onGoToSlide,
  navPosition,
  onCycleNav,
  onToggleFullscreen,
  isGridView,
  onToggleGridView,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onScaffold,
}: {
  previewMode: PreviewMode;
  onSetPreviewMode: (mode: PreviewMode) => void;
  slideIndex: number;
  slideCount: number;
  onPrev: () => void;
  onNext: () => void;
  onGoToSlide: (index: number) => void;
  navPosition: NavigatorPosition;
  onCycleNav: () => void;
  onToggleFullscreen: () => void;
  isGridView: boolean;
  onToggleGridView: () => void;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onScaffold?: () => void;
}) {
  const [isJumping, setIsJumping] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const jumpInputRef = useRef<HTMLInputElement>(null);

  const openJump = useCallback(() => {
    if (slideCount <= 0) return;
    setJumpValue(String(slideIndex + 1));
    setIsJumping(true);
  }, [slideCount, slideIndex]);

  useEffect(() => {
    if (isJumping) {
      jumpInputRef.current?.focus();
      jumpInputRef.current?.select();
    }
  }, [isJumping]);

  const commitJump = useCallback(() => {
    const num = parseInt(jumpValue, 10);
    if (!isNaN(num) && num >= 1 && num <= slideCount) {
      onGoToSlide(num - 1);
    }
    setIsJumping(false);
  }, [jumpValue, slideCount, onGoToSlide]);

  const cancelJump = useCallback(() => {
    setIsJumping(false);
  }, []);

  const modes: { value: PreviewMode; label: string; icon: React.ReactNode }[] =
    [
      { value: "view", label: "View", icon: <EyeIcon /> },
      { value: "edit", label: "Edit", icon: <EditIcon /> },
      { value: "select", label: "Select", icon: <CursorIcon /> },
      { value: "annotate", label: "Annotate", icon: <AnnotateIcon /> },
    ];

  const handleExport = useCallback(() => {
    const baseUrl = import.meta.env.DEV ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}` : "";
    const cs = useStore.getState().activeContentSet;
    const qs = cs ? `?contentSet=${encodeURIComponent(cs)}` : "";
    window.open(`${baseUrl}/export/slides${qs}`, "_blank");
  }, []);

  const navTitle =
    navPosition === "left"
      ? "Navigator: sidebar (click to switch)"
      : navPosition === "bottom"
        ? "Navigator: bottom (click to hide)"
        : "Navigator: hidden (click to show)";

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-cc-border bg-cc-card/50 shrink-0">
      {/* Left: nav toggle + slide navigation */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onCycleNav}
          className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          title={navTitle}
        >
          <NavPositionIcon position={navPosition} />
        </button>
        <div className="w-px h-4 bg-cc-border mx-0.5" />
        <button
          onClick={onPrev}
          disabled={slideIndex <= 0}
          className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Previous slide (←)"
        >
          <ChevronLeftIcon />
        </button>
        {isJumping ? (
          <div className="flex items-center gap-0.5">
            <input
              ref={jumpInputRef}
              type="text"
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitJump();
                else if (e.key === "Escape") cancelJump();
                e.stopPropagation(); // prevent slide navigation
              }}
              onBlur={commitJump}
              className="w-8 text-xs text-cc-fg font-mono tabular-nums text-center bg-cc-bg border border-cc-border rounded px-0.5 py-0 outline-none focus:border-cc-primary"
            />
            <span className="text-xs text-cc-muted font-mono">/{slideCount}</span>
          </div>
        ) : (
          <button
            onClick={openJump}
            className="text-xs text-cc-muted font-mono tabular-nums min-w-[4ch] text-center hover:text-cc-fg cursor-pointer"
            title="Click to jump to slide"
          >
            {slideCount > 0 ? `${slideIndex + 1}/${slideCount}` : "—"}
          </button>
        )}
        <button
          onClick={onNext}
          disabled={slideIndex >= slideCount - 1}
          className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next slide (→)"
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Center: zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          disabled={zoomLevel <= 30}
          className="flex items-center justify-center w-6 h-6 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom out"
        >
          <MinusIcon />
        </button>
        <button
          onClick={onZoomFit}
          className="text-[10px] text-cc-muted hover:text-cc-fg font-mono tabular-nums min-w-[3.5ch] text-center cursor-pointer"
          title="Reset zoom to fit"
        >
          {zoomLevel}%
        </button>
        <button
          onClick={onZoomIn}
          disabled={zoomLevel >= 200}
          className="flex items-center justify-center w-6 h-6 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom in"
        >
          <PlusIcon />
        </button>
      </div>

      {/* Right: mode toggle + fullscreen */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center bg-cc-bg/60 rounded-md p-0.5">
          {modes.map((m) => (
            <button
              key={m.value}
              onClick={() => onSetPreviewMode(m.value)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                previewMode === m.value
                  ? "bg-cc-primary/20 text-cc-primary"
                  : "text-cc-muted hover:text-cc-fg"
              }`}
              title={
                m.value === "view"
                  ? "Read-only view"
                  : m.value === "edit"
                    ? "Edit text inline (Esc to exit)"
                    : m.value === "select"
                      ? "Select elements (Esc to exit)"
                      : "Annotate multiple elements (Esc to exit)"
              }
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-cc-border" />
        <button
          onClick={onToggleGridView}
          className={`flex items-center justify-center w-7 h-7 rounded transition-colors cursor-pointer ${
            isGridView ? "bg-cc-primary/20 text-cc-primary" : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
          }`}
          title="Grid overview"
        >
          <GridIcon />
        </button>
        <button
          onClick={onToggleFullscreen}
          className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          title="Fullscreen"
        >
          <FullscreenIcon />
        </button>
        <button
          onClick={handleExport}
          className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          title="Export slides (open printable page)"
        >
          <ExportIcon />
        </button>
        {onScaffold && (
          <>
            <div className="w-px h-4 bg-cc-border" />
            <button
              onClick={onScaffold}
              className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
              title="Initialize / reset workspace"
            >
              <ScaffoldIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M11.5 2.5l2 2-8 8L3 13.5l1-2.5z" strokeLinejoin="round" />
      <path d="M9.5 4.5l2 2" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M3 2l4 12 2-5 5-2L3 2z" strokeLinejoin="round" />
    </svg>
  );
}

function AnnotateIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M12 3l1.5 1.5L5 13l-2 .5.5-2z" strokeLinejoin="round" />
      <path d="M2 15h5" strokeLinecap="round" strokeDasharray="2 1.5" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
      <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
      <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
      <path d="M3 8h10" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <rect x="1.5" y="2" width="5" height="5" rx="0.5" />
      <rect x="9.5" y="2" width="5" height="5" rx="0.5" />
      <rect x="1.5" y="9" width="5" height="5" rx="0.5" />
      <rect x="9.5" y="9" width="5" height="5" rx="0.5" />
    </svg>
  );
}

function ScaffoldIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <rect x="2" y="2" width="5" height="5" rx="0.5" />
      <rect x="9" y="2" width="5" height="5" rx="0.5" />
      <rect x="2" y="9" width="5" height="5" rx="0.5" />
      <rect x="9" y="9" width="5" height="5" rx="0.5" />
      <path d="M4.5 4.5h0M11.5 4.5h0M4.5 11.5h0M11.5 11.5h0" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M2 6V3a1 1 0 011-1h3M10 2h3a1 1 0 011 1v3M14 10v3a1 1 0 01-1 1h-3M6 14H3a1 1 0 01-1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Icon that changes based on navigator position */
function NavPositionIcon({ position }: { position: NavigatorPosition }) {
  if (position === "left") {
    // Sidebar icon
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
        <rect x="1" y="2" width="14" height="12" rx="1.5" />
        <line x1="6" y1="2" x2="6" y2="14" />
      </svg>
    );
  }
  if (position === "bottom") {
    // Bottom panel icon
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
        <rect x="1" y="2" width="14" height="12" rx="1.5" />
        <line x1="1" y1="10" x2="15" y2="10" />
      </svg>
    );
  }
  // Hidden — panel with X
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <rect x="1" y="2" width="14" height="12" rx="1.5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" strokeLinecap="round" />
    </svg>
  );
}
