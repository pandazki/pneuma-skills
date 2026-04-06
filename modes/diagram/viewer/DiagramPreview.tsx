/**
 * DiagramPreview — Diagram Mode viewer component.
 *
 * Implements ViewerContract's PreviewComponent.
 * Renders draw.io (.drawio) files with two-phase pipeline:
 * - Streaming phase: raw Graph + incremental cell merge + fade-in animations
 * - Final phase: GraphViewer with nav toolbar, after 2s of no file changes
 *
 * Credits:
 * - draw.io (https://www.drawio.com) — Apache 2.0 licensed diagramming tool.
 *   This mode wraps viewer-static.min.js from viewer.diagrams.net CDN.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { useStore } from "../../../src/store.js";
import { setDiagramCaptureViewport } from "../pneuma-mode.js";
import ScaffoldConfirm from "../../../src/components/ScaffoldConfirm.js";
import { loadDrawio } from "./drawio-loader.js";
import {
  extractMxGraphXml,
  extractDiagramPages,
  healPartialXml,
  createStreamState,
  destroyStreamState,
  streamMergeXmlDelta,
  type StreamState,
  type DiagramPage,
} from "./stream-renderer.js";
import { generateDrawioEditUrl } from "./drawio-url.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

/** Parse active .drawio file content */
function parseDrawioFile(
  files: ViewerPreviewProps["files"],
  activeFile?: string | null,
): { content: string; filePath: string } | null {
  if (activeFile) {
    const f = files.find((f) => f.path === activeFile);
    if (f && f.path.endsWith(".drawio")) {
      return { content: f.content, filePath: f.path };
    }
  }
  for (const f of files) {
    if (f.path.endsWith(".drawio")) {
      return { content: f.content, filePath: f.path };
    }
  }
  return null;
}

/** Strip HTML tags from a cell value string */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function DiagramPreview({
  files,
  selection,
  onSelect: rawOnSelect,
  mode: rawPreviewMode,
  actionRequest,
  onActionResult,
  onActiveFileChange,
  activeFile,
  navigateRequest,
  onNavigateComplete,
  readonly,
}: ViewerPreviewProps) {
  const previewMode = readonly ? "view" : rawPreviewMode;
  const onSelect = readonly ? (() => {}) : rawOnSelect;

  const setPreviewMode = useStore((s) => s.setPreviewMode);
  const pushUserAction = useStore((s) => s.pushUserAction);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const streamingFileWrite = useStore((s) => s.streamingFileWrite);

  // draw.io loading state
  const [ready, setReady] = useState(false);

  // Theme
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("pneuma-diagram-theme") as "light" | "dark") || "dark";
  });

  // Scaffold confirmation dialog
  const [scaffoldPending, setScaffoldPending] = useState<{
    files: { path: string; content: string }[];
    clearPatterns: string[];
    resolve: (result: { success: boolean; message?: string }) => void;
    source: "agent" | "user";
  } | null>(null);

  // Pending annotation popover
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    selection: ViewerSelectionContext;
    file: string;
    position: { x: number; y: number };
  } | null>(null);

  // Container refs
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  // Graph renders into a hidden off-screen div. We extract its SVG for display.
  const offscreenRef = useRef<HTMLDivElement | null>(null);
  const streamStateRef = useRef<StreamState | null>(null);
  const [svgHtml, setSvgHtml] = useState<string>("");
  const [hasContent, setHasContent] = useState(false);

  // Multi-page support
  const [pages, setPages] = useState<DiagramPage[]>([]);
  const [activePageIdx, setActivePageIdx] = useState(0);

  // Selection + hover highlight (model coords from cellState)
  const [selectedBounds, setSelectedBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hoveredBounds, setHoveredBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const hoveredCellIdRef = useRef<string | null>(null);

  // Pan/zoom state (CSS transform based, a la illustrate mode)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);

  // Echo detection — track last rendered content
  const lastFileContentRef = useRef<string>("");
  const currentFilePathRef = useRef<string>("");

  // ── draw.io loading ─────────────────────────────────────────────────────

  useEffect(() => {
    loadDrawio().then(() => setReady(true)).catch(console.error);
  }, []);

  // ── Active file tracking ────────────────────────────────────────────────

  const drawioData = useMemo(() => parseDrawioFile(files, activeFile), [files, activeFile]);

  useEffect(() => {
    if (drawioData) {
      currentFilePathRef.current = drawioData.filePath;
      onActiveFileChange?.(drawioData.filePath);
    }
  }, [drawioData?.filePath]);

  // ── Navigate request ────────────────────────────────────────────────────

  useEffect(() => {
    if (!navigateRequest) return;
    const { data } = navigateRequest;
    if (data.file) {
      onActiveFileChange?.(data.file as string);
    }
    onNavigateComplete?.();
  }, [navigateRequest]);

  // ── Scaffold action ─────────────────────────────────────────────────────

  const executeScaffold = useCallback(async (
    scaffoldFiles: { path: string; content: string }[],
    clearPatterns: string[],
  ): Promise<{ success: boolean; message?: string }> => {
    const base = getApiBase();
    try {
      const res = await fetch(`${base}/api/workspace/scaffold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: clearPatterns, files: scaffoldFiles }),
      });
      const data = await res.json();
      if (data.success) {
        return { success: true, message: `Created ${data.filesWritten} files` };
      }
      return { success: false, message: data.message || "Scaffold failed" };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Network error" };
    }
  }, []);

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
        description: "Reset diagram to empty state",
      });
    }
  }, [scaffoldPending, executeScaffold, pushUserAction]);

  const handleScaffoldCancel = useCallback(() => {
    if (!scaffoldPending) return;
    scaffoldPending.resolve({ success: false, message: "Cancelled by user" });
    setScaffoldPending(null);
  }, [scaffoldPending]);

  useEffect(() => {
    if (!actionRequest) return;
    switch (actionRequest.actionId) {
      case "scaffold": {
        const emptyXml = `<mxfile>\n  <diagram id="page-1" name="Page-1">\n    <mxGraphModel adaptiveColors="auto" dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>`;
        const targetFile = activeFile || currentFilePathRef.current || "diagram.drawio";
        const reqId = actionRequest.requestId;
        setScaffoldPending({
          files: [{ path: targetFile, content: emptyXml }],
          clearPatterns: [targetFile],
          source: "agent",
          resolve: (result) => {
            onActionResult?.(reqId, result);
          },
        });
        break;
      }
      default:
        onActionResult?.(actionRequest.requestId, {
          success: false,
          message: `Unknown action: ${actionRequest.actionId}`,
        });
    }
  }, [actionRequest]);

  // ── Graph lifecycle ─────────────────────────────────────────────────────
  // Architecture:
  //   1. Offscreen Graph (hidden div) merges XML incrementally
  //   2. Extract tight SVG: viewBox cropped to content bounds, natural CSS size = content size
  //   3. Display SVG centered via absolute positioning at 50%/50%
  //   4. Pan/zoom via CSS transform with transformOrigin center
  //   5. Hit-testing via inverse transform → graph.getCellAt()
  //
  // The tight SVG is key — the element's natural size equals the diagram,
  // so CSS transform operates predictably (no 4000x4000 SVG ambiguity).

  // SVG content bounds in graph model coordinates (set by extractSvg)
  const svgBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Create offscreen container on mount
  useEffect(() => {
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:4000px;height:4000px;overflow:hidden;";
    document.body.appendChild(div);
    offscreenRef.current = div;
    return () => {
      if (streamStateRef.current) {
        destroyStreamState(streamStateRef.current);
        streamStateRef.current = null;
      }
      div.remove();
    };
  }, []);

  /**
   * Extract a tight SVG from the offscreen Graph.
   * Resets graph viewport to (1, 0, 0), validates, then clones the SVG
   * with viewBox cropped to content bounds. Returns false if no content.
   */
  const extractSvg = useCallback((): boolean => {
    const graph = streamStateRef.current?.graph;
    const offscreen = offscreenRef.current;
    if (!graph || !offscreen) return false;

    graph.view.scaleAndTranslate(1, 0, 0);
    graph.view.validate();

    const bounds = graph.view.getGraphBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;

    const svg = offscreen.querySelector("svg");
    if (!svg) return false;

    // Clone SVG and set tight viewBox around content
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const pad = 8;
    const vbX = bounds.x - pad;
    const vbY = bounds.y - pad;
    const vbW = bounds.width + pad * 2;
    const vbH = bounds.height + pad * 2;

    clone.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.style.cssText = `width:${vbW}px;height:${vbH}px;display:block;overflow:visible;pointer-events:none;`;
    // Also kill pointer-events on all SVG children — mxGraph sets pointer-events
    // attributes on shapes that override CSS inheritance from non-SVG parents.
    clone.querySelectorAll("[pointer-events]").forEach(el => el.removeAttribute("pointer-events"));

    setSvgHtml(clone.outerHTML);
    svgBoundsRef.current = { x: vbX, y: vbY, w: vbW, h: vbH };
    setHasContent(true);
    return true;
  }, []);

  /** Destroy existing graph so the next merge starts from a clean slate */
  const resetGraph = useCallback(() => {
    if (streamStateRef.current) {
      destroyStreamState(streamStateRef.current);
      streamStateRef.current = null;
    }
    const offscreen = offscreenRef.current;
    if (offscreen) offscreen.innerHTML = "";
    setSvgHtml("");
    setHasContent(false);
  }, []);

  /** Merge mxGraphModel XML into the offscreen Graph, then extract tight SVG */
  const mergeModelXml = useCallback((mgXml: string): boolean => {
    const healed = healPartialXml(mgXml) || mgXml;
    let xmlDoc: Document;
    try { xmlDoc = mxUtils.parseXml(healed); } catch { return false; }

    const modelNode = xmlDoc.documentElement;
    if (!modelNode || modelNode.nodeName !== "mxGraphModel") return false;

    const offscreen = offscreenRef.current;
    if (!offscreen) return false;

    if (!streamStateRef.current) {
      offscreen.innerHTML = "";
      const innerDiv = document.createElement("div");
      innerDiv.style.cssText = "width:4000px;height:4000px;";
      offscreen.appendChild(innerDiv);

      const graph = new Graph(innerDiv) as unknown as DrawioGraph;
      graph.setEnabled(false);
      streamStateRef.current = createStreamState(graph);
    }

    streamMergeXmlDelta(streamStateRef.current, modelNode);
    return extractSvg();
  }, [extractSvg]);

  /** Fit diagram — compute zoom/pan to center content in wrapper */
  const fitToCenter = useCallback(() => {
    const bounds = svgBoundsRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!bounds || !wrapper) return;

    const ww = wrapper.clientWidth;
    const wh = wrapper.clientHeight;
    if (ww <= 0 || wh <= 0) return;

    const padding = 40;
    const fitZoom = Math.min(
      (ww - padding * 2) / bounds.w,
      (wh - padding * 2) / bounds.h,
      1.5,
    );

    setZoom(fitZoom);
    setPan({ x: 0, y: 0 });
  }, []);

  // ── File change handler ─────────────────────────────────────────────────

  const isStreamingActive = useRef(false);

  useEffect(() => {
    if (!ready || !drawioData) {
      if (!drawioData) setHasContent(false);
      return;
    }

    const { content, filePath } = drawioData;

    // Echo detection
    if (content === lastFileContentRef.current && filePath === currentFilePathRef.current) return;

    // Parse pages from the .drawio file
    const parsedPages = extractDiagramPages(content);
    setPages(parsedPages);

    // Non-streaming: reset graph and render the active page from scratch
    if (!isStreamingActive.current) {
      resetGraph();
      // Clamp page index if pages changed
      const pageIdx = Math.min(activePageIdx, Math.max(0, parsedPages.length - 1));
      if (pageIdx !== activePageIdx) setActivePageIdx(pageIdx);
      const pageXml = parsedPages[pageIdx]?.xml;
      if (!pageXml || !mergeModelXml(pageXml)) {
        setHasContent(false);
      } else {
        fitToCenter();
      }
    } else {
      // Streaming: incremental merge of first page
      const pageXml = parsedPages[0]?.xml;
      if (pageXml) mergeModelXml(pageXml);
    }

    lastFileContentRef.current = content;
    currentFilePathRef.current = filePath;
  }, [ready, drawioData, mergeModelXml, fitToCenter, resetGraph, activePageIdx]);

  // ── Real-time streaming from agent tool input ──────────────────────────

  useEffect(() => {
    if (!ready || !streamingFileWrite) return;
    if (!streamingFileWrite.path.endsWith(".drawio")) return;
    if (activeFile && streamingFileWrite.path !== activeFile) return;

    const content = streamingFileWrite.content;
    if (!content || content.length < 10) return;

    isStreamingActive.current = true;
    const pageXml = extractMxGraphXml(content);
    if (pageXml) mergeModelXml(pageXml);
  }, [ready, streamingFileWrite, mergeModelXml]);

  // When streaming ends, fit to center
  const prevStreamingRef = useRef(streamingFileWrite);
  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = streamingFileWrite;
    if (was && !streamingFileWrite) {
      isStreamingActive.current = false;
      setTimeout(fitToCenter, 500);
    }
  }, [streamingFileWrite, fitToCenter]);

  // ── Page switching ──────────────────────────────────────────────────────

  const switchPage = useCallback((idx: number) => {
    if (idx < 0 || idx >= pages.length || idx === activePageIdx) return;
    setActivePageIdx(idx);
    resetGraph();
    const pageXml = pages[idx]?.xml;
    if (pageXml && mergeModelXml(pageXml)) {
      fitToCenter();
    }
  }, [pages, activePageIdx, resetGraph, mergeModelXml, fitToCenter]);

  // ── Pan/zoom handlers ───────────────────────────────────────────────────
  // ALL event handling is via native addEventListener — no React synthetic events.
  // This avoids: passive wheel, useCallback stale closures, HMR dispatch breakage.
  // Refs bridge the gap between the stable native listeners and React state.
  const setPanRef = useRef(setPan);
  setPanRef.current = setPan;
  const setZoomRef = useRef(setZoom);
  setZoomRef.current = setZoom;
  const previewModeRef = useRef(previewMode);
  previewModeRef.current = previewMode;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    // ── Wheel → zoom ──
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY > 0 ? 0.97 : 1.03;
      setZoomRef.current(prevZ => {
        const newZ = Math.min(8, Math.max(0.1, prevZ * factor));
        const r = newZ / prevZ;
        setPanRef.current(p => ({
          x: p.x - (cx - p.x) * (r - 1),
          y: p.y - (cy - p.y) * (r - 1),
        }));
        return newZ;
      });
    };

    // ── Pointer → pan ──
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const mode = previewModeRef.current;
      if (mode === "select" || mode === "annotate") return;
      e.preventDefault();
      isDragging.current = true;
      let lastX = e.clientX;
      let lastY = e.clientY;

      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - lastX;
        const dy = me.clientY - lastY;
        setPanRef.current(p => ({ x: p.x + dx, y: p.y + dy }));
        lastX = me.clientX;
        lastY = me.clientY;
      };
      const onUp = () => {
        isDragging.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    // ── Mousemove → hover highlight in select/annotate mode ──
    const onMouseMove = (e: MouseEvent) => {
      const mode = previewModeRef.current;
      if (mode !== "select" && mode !== "annotate") {
        if (hoveredCellIdRef.current) {
          hoveredCellIdRef.current = null;
          setHoveredBounds(null);
        }
        return;
      }
      const graph = streamStateRef.current?.graph;
      const bounds = svgBoundsRef.current;
      if (!graph || !bounds) return;

      const rect = wrapper.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const z = zoomRef.current;
      const p = panRef.current;
      const localX = (sx - rect.width / 2 - p.x) / z + bounds.w / 2;
      const localY = (sy - rect.height / 2 - p.y) / z + bounds.h / 2;
      const modelX = localX + bounds.x;
      const modelY = localY + bounds.y;

      const cell = graph.getCellAt(modelX, modelY);
      const cellId = cell && cell.id !== "0" && cell.id !== "1" ? cell.id : null;

      if (cellId === hoveredCellIdRef.current) return;
      hoveredCellIdRef.current = cellId;

      if (!cellId || !cell) {
        setHoveredBounds(null);
        return;
      }
      const cellState = graph.view.getState(cell);
      if (cellState) {
        setHoveredBounds({ x: cellState.x, y: cellState.y, w: cellState.width, h: cellState.height });
      }
    };

    wrapper.addEventListener("wheel", onWheel, { passive: false });
    wrapper.addEventListener("pointerdown", onPointerDown);
    wrapper.addEventListener("mousemove", onMouseMove);
    return () => {
      wrapper.removeEventListener("wheel", onWheel);
      wrapper.removeEventListener("pointerdown", onPointerDown);
      wrapper.removeEventListener("mousemove", onMouseMove);
    };
  }, [ready]);

  // ── Capture viewport ────────────────────────────────────────────────────

  useEffect(() => {
    const capture = async (): Promise<{ data: string; media_type: string } | null> => {
      const container = canvasWrapperRef.current;
      if (!container) return null;
      try {
        const svgEl = container.querySelector("svg");
        if (!svgEl) return null;
        const svgStr = new XMLSerializer().serializeToString(svgEl);
        const base64 = btoa(unescape(encodeURIComponent(svgStr)));
        return { data: base64, media_type: "image/svg+xml" };
      } catch {
        return null;
      }
    };
    setDiagramCaptureViewport(capture);
    return () => setDiagramCaptureViewport(null);
  }, [hasContent]);

  // ── Selection handling (click on diagram) ──────────────────────────────

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (previewMode !== "select" && previewMode !== "annotate") return;

    const graph = streamStateRef.current?.graph ?? null;
    const bounds = svgBoundsRef.current;
    if (!graph || !bounds) return;

    // Transform screen coords → graph model coords
    // Layout: element at top:50% left:50%, transform: translate(calc(-50%+pan), ...) scale(zoom)
    // with transformOrigin: center center.
    // Screen point relative to wrapper center → content local → model coords.
    const container = canvasWrapperRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Inverse of CSS transform to get SVG-local coordinates.
    // Forward: sx = W/2 + (lx - w/2)*zoom + panX
    // Inverse: lx = (sx - W/2 - panX) / zoom + w/2
    const localX = (screenX - rect.width / 2 - pan.x) / zoom + bounds.w / 2;
    const localY = (screenY - rect.height / 2 - pan.y) / zoom + bounds.h / 2;

    // SVG local (0,0) → viewBox (bounds.x, bounds.y)
    const modelX = localX + bounds.x;
    const modelY = localY + bounds.y;

    const cell = graph.getCellAt(modelX, modelY);
    if (!cell || cell.id === "0" || cell.id === "1") {
      setSelectedBounds(null);
      if (previewMode === "annotate") {
        setPendingAnnotation(null);
      } else {
        onSelect(null);
      }
      return;
    }

    // Compute cell bounds for highlight overlay
    const cellState = graph.view.getState(cell);
    if (cellState) {
      setSelectedBounds({ x: cellState.x, y: cellState.y, w: cellState.width, h: cellState.height });
    }

    const rawValue = cell.value || "";
    const label = stripHtml(rawValue) || (cell.edge ? "connector" : cell.vertex ? "shape" : "cell");
    const cellType = cell.edge ? "connector" : cell.vertex ? "shape" : "cell";
    const content = label;

    const filePath = currentFilePathRef.current;

    if (previewMode === "annotate") {
      setPendingAnnotation({
        selection: {
          type: cellType,
          content,
          file: filePath,
          label,
        },
        file: filePath,
        position: { x: screenX, y: screenY },
      });
    } else {
      onSelect({
        type: cellType,
        content,
        file: filePath,
        label,
      });
    }
  }, [previewMode, zoom, pan, onSelect]);

  // ── Annotation confirm ──────────────────────────────────────────────────

  const confirmAnnotation = useCallback(
    (comment: string) => {
      if (!pendingAnnotation) return;
      const { selection: sel, file } = pendingAnnotation;
      addAnnotation({
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        slideFile: file,
        element: {
          file,
          type: sel.type as import("../../../src/types.js").SelectionType,
          content: sel.content,
          label: sel.label,
          thumbnail: sel.thumbnail,
        },
        comment,
      });
      setPendingAnnotation(null);
    },
    [pendingAnnotation, addAnnotation],
  );

  // Popover position
  const popoverStyle = useMemo((): React.CSSProperties => {
    if (!pendingAnnotation || !canvasWrapperRef.current) return {};
    const { position } = pendingAnnotation;
    const containerWidth = canvasWrapperRef.current.clientWidth;
    return {
      position: "absolute",
      top: position.y + 12,
      left: Math.max(8, Math.min(position.x - 140, containerWidth - 288)),
      zIndex: 50,
      width: 280,
    };
  }, [pendingAnnotation]);

  // Clear highlights and annotation when leaving interactive modes
  useEffect(() => {
    if (previewMode !== "annotate") setPendingAnnotation(null);
    if (previewMode !== "select" && previewMode !== "annotate") {
      setSelectedBounds(null);
      setHoveredBounds(null);
      hoveredCellIdRef.current = null;
    }
  }, [previewMode]);

  // ── Theme toggle ────────────────────────────────────────────────────────

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("pneuma-diagram-theme", next);
  }, [theme]);

  // ── Open in draw.io ─────────────────────────────────────────────────────

  const handleOpenInDrawio = useCallback(() => {
    if (!drawioData) return;
    const url = generateDrawioEditUrl(drawioData.content);
    window.open(url, "_blank", "noopener");
  }, [drawioData]);

  // ── Keyboard ────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewMode === "annotate") {
          if (pendingAnnotation) {
            setPendingAnnotation(null);
          } else {
            setPreviewMode("view");
          }
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
  }, [previewMode, pendingAnnotation, selection, onSelect, setPreviewMode]);

  // ── Cleanup ─────────────────────────────────────────────────────────────

  // Cleanup handled by offscreen useEffect

  // ── Render ──────────────────────────────────────────────────────────────

  const drawioFiles = files.filter((f) => f.path.endsWith(".drawio"));

  if (!ready) {
    return (
      <div className="flex flex-col h-full">
        <DiagramToolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
          readonly={readonly}
        />
        <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
          Loading draw.io viewer...
        </div>
      </div>
    );
  }

  if (drawioFiles.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <DiagramToolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
          readonly={readonly}
        />
        <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
          No .drawio files in workspace
        </div>
      </div>
    );
  }

  const isInteractive = previewMode === "select" || previewMode === "annotate";
  const cursorStyle = isInteractive ? "crosshair" : "grab";
  const isDark = theme === "dark";

  return (
    <div className="flex flex-col h-full">
      <DiagramToolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        previewMode={previewMode}
        onSetPreviewMode={setPreviewMode}
        filePath={drawioData?.filePath}
        onOpenInDrawio={drawioData ? handleOpenInDrawio : undefined}
        readonly={readonly}
      />
      {/* Page tabs — shown only when file has multiple pages */}
      {pages.length > 1 && (
        <div
          className="flex items-center gap-0.5 px-3 py-1 border-b border-cc-border bg-cc-bg/30 shrink-0 overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {pages.map((page, idx) => (
            <button
              key={page.id}
              onClick={() => switchPage(idx)}
              className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer whitespace-nowrap ${
                idx === activePageIdx
                  ? "bg-cc-primary/20 text-cc-primary"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
              }`}
            >
              {page.name}
            </button>
          ))}
        </div>
      )}
      <div
        ref={canvasWrapperRef}
        className="flex-1 relative overflow-hidden"
        style={{
          cursor: isDragging.current ? "grabbing" : cursorStyle,
          background: isDark ? "#18181b" : "#f8f9fa",
          touchAction: "none",
        }}
        onClick={handleContainerClick}
      >
        {/* Tight SVG centered via 50%/50% positioning + CSS transform */}
        {svgHtml && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
              transformOrigin: "center center",
              userSelect: "none",
              pointerEvents: "none",
              filter: isDark ? "invert(0.88) hue-rotate(180deg)" : "none",
            }}
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        )}
        {/* Hover + selection highlight overlays — same transform as SVG */}
        {(hoveredBounds || selectedBounds) && svgBoundsRef.current && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
              transformOrigin: "center center",
              pointerEvents: "none",
              width: svgBoundsRef.current.w,
              height: svgBoundsRef.current.h,
            }}
          >
            {hoveredBounds && (
              <div
                style={{
                  position: "absolute",
                  left: hoveredBounds.x - svgBoundsRef.current.x - 3,
                  top: hoveredBounds.y - svgBoundsRef.current.y - 3,
                  width: hoveredBounds.w + 6,
                  height: hoveredBounds.h + 6,
                  border: `1.5px solid ${isDark ? "rgba(249, 115, 22, 0.35)" : "rgba(249, 115, 22, 0.3)"}`,
                  borderRadius: 6,
                  background: isDark ? "rgba(249, 115, 22, 0.06)" : "rgba(249, 115, 22, 0.04)",
                  transition: "all 0.15s ease-out",
                }}
              />
            )}
            {selectedBounds && (
              <div
                style={{
                  position: "absolute",
                  left: selectedBounds.x - svgBoundsRef.current.x - 3,
                  top: selectedBounds.y - svgBoundsRef.current.y - 3,
                  width: selectedBounds.w + 6,
                  height: selectedBounds.h + 6,
                  border: "2px solid #f97316",
                  borderRadius: 6,
                  background: "rgba(249, 115, 22, 0.1)",
                }}
              />
            )}
          </div>
        )}
        {/* Empty state */}
        {!hasContent && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm">
            Waiting for diagram...
          </div>
        )}
        {/* Floating zoom controls — bottom-left, theme-aware */}
        {hasContent && (
          <div
            className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border px-1.5 py-1 z-10"
            onPointerDown={e => e.stopPropagation()}
            style={{
              background: isDark ? "rgba(24,24,27,0.85)" : "rgba(255,255,255,0.9)",
              borderColor: isDark ? "rgba(63,63,70,0.5)" : "rgba(212,212,216,0.8)",
              backdropFilter: "blur(8px)",
            }}
          >
            <button
              onClick={() => setZoom(z => Math.max(0.1, z * 0.8))}
              className="w-7 h-7 flex items-center justify-center rounded text-sm cursor-pointer transition-colors"
              style={{ color: isDark ? "#a1a1aa" : "#52525b" }}
              title="Zoom out"
            >-</button>
            <span
              className="text-[11px] min-w-[36px] text-center select-none cursor-pointer"
              style={{ color: isDark ? "#71717a" : "#a1a1aa" }}
              onClick={fitToCenter}
              title="Reset zoom"
            >{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(z => Math.min(8, z * 1.25))}
              className="w-7 h-7 flex items-center justify-center rounded text-sm cursor-pointer transition-colors"
              style={{ color: isDark ? "#a1a1aa" : "#52525b" }}
              title="Zoom in"
            >+</button>
            <div className="w-px h-4 mx-0.5" style={{ background: isDark ? "rgba(63,63,70,0.5)" : "rgba(212,212,216,0.8)" }} />
            <button
              onClick={fitToCenter}
              className="w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors"
              style={{ color: isDark ? "#a1a1aa" : "#52525b" }}
              title="Fit to screen"
            >
              <FitIcon />
            </button>
          </div>
        )}
        {/* Annotation popover */}
        {pendingAnnotation && (
          <AnnotationPopover
            style={popoverStyle}
            label={pendingAnnotation.selection.label}
            onConfirm={confirmAnnotation}
            onCancel={() => setPendingAnnotation(null)}
          />
        )}
      </div>
      {scaffoldPending && createPortal(
        <ScaffoldConfirm
          clearPatterns={scaffoldPending.clearPatterns}
          files={scaffoldPending.files}
          onConfirm={handleScaffoldConfirm}
          onCancel={handleScaffoldCancel}
        />,
        document.body,
      )}
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

type PreviewMode = "view" | "edit" | "select" | "annotate";

function DiagramToolbar({
  theme,
  onToggleTheme,
  previewMode,
  onSetPreviewMode,
  filePath,
  onOpenInDrawio,
  readonly,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  previewMode: PreviewMode;
  onSetPreviewMode: (mode: PreviewMode) => void;
  filePath?: string;
  onOpenInDrawio?: () => void;
  readonly?: boolean;
}) {
  const isDark = theme === "dark";

  const modes: { value: PreviewMode; label: string; icon: React.ReactNode }[] = [
    { value: "view", label: "View", icon: <EyeIcon /> },
    { value: "select", label: "Select", icon: <CursorIcon /> },
    { value: "annotate", label: "Annotate", icon: <AnnotateIcon /> },
  ];

  return (
    <div className="flex items-center justify-between gap-1.5 px-3 py-1.5 border-b border-cc-border bg-cc-card/50 shrink-0">
      <div className="flex items-center gap-2">
        {filePath && (
          <span className={`text-xs font-mono ${isDark ? "text-neutral-500" : "text-neutral-400"}`}>
            {filePath}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {!readonly && (
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
                    ? "View only (pan/zoom)"
                    : m.value === "select"
                    ? "Select elements for agent context (Esc to exit)"
                    : "Annotate elements with comments (Esc to exit)"
                }
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        )}
        {!readonly && <div className="w-px h-4 bg-cc-border mx-0.5" />}
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
          <span>{isDark ? "Light" : "Dark"}</span>
        </button>
        {onOpenInDrawio && (
          <>
            <div className="w-px h-4 bg-cc-border mx-0.5" />
            <button
              onClick={onOpenInDrawio}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
              title="Open in draw.io"
            >
              <ExternalLinkIcon />
              <span>Edit in draw.io</span>
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
      <path d="M2 2h12v9H6l-4 3V2z" strokeLinejoin="round" />
      <circle cx="5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="11" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M6 3H3v10h10v-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 3h4v4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 3L7 9" strokeLinecap="round" />
    </svg>
  );
}

// ── Annotation Popover ──────────────────────────────────────────────────────

function AnnotationPopover({
  style,
  label,
  onConfirm,
  onCancel,
}: {
  style: React.CSSProperties;
  label?: string;
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
