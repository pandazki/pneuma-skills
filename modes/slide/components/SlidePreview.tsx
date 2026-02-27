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
import { useStore } from "../../../src/store.js";

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

/** Build a full HTML document for the iframe srcdoc */
function buildSrcdoc(
  slideHtml: string,
  themeCSS: string,
  isSelectMode: boolean,
): string {
  const selectionScript = isSelectMode
    ? `<script>
(function() {
  let hovered = null;
  const OUTLINE = '2px solid rgba(110, 168, 254, 0.6)';
  const OUTLINE_RADIUS = '4px';

  document.addEventListener('mouseover', function(e) {
    const el = e.target.closest('[data-selectable]') || e.target.closest('h1,h2,h3,h4,h5,h6,p,li,ul,ol,pre,code,blockquote,img,div.slide>*');
    if (!el) return;
    if (hovered && hovered !== el) {
      hovered.style.outline = '';
      hovered.style.outlineOffset = '';
      hovered.style.borderRadius = '';
    }
    hovered = el;
    el.style.outline = OUTLINE;
    el.style.outlineOffset = '2px';
    el.style.borderRadius = OUTLINE_RADIUS;
  });

  document.addEventListener('mouseout', function(e) {
    if (hovered) {
      hovered.style.outline = '';
      hovered.style.outlineOffset = '';
      hovered.style.borderRadius = '';
      hovered = null;
    }
  });

  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target.closest('[data-selectable]') || e.target.closest('h1,h2,h3,h4,h5,h6,p,li,ul,ol,pre,code,blockquote,img,div.slide>*');
    if (!el) {
      window.parent.postMessage({ type: 'pneuma:select', selection: null }, '*');
      return;
    }

    const tag = el.tagName.toLowerCase();
    let type = 'element';
    let level;
    if (/^h[1-6]$/.test(tag)) { type = 'heading'; level = parseInt(tag[1]); }
    else if (tag === 'p') type = 'paragraph';
    else if (tag === 'li') type = 'list-item';
    else if (tag === 'ul' || tag === 'ol') type = 'list';
    else if (tag === 'pre' || tag === 'code') type = 'code';
    else if (tag === 'blockquote') type = 'blockquote';
    else if (tag === 'img') type = 'image';

    const content = tag === 'img'
      ? (el.getAttribute('alt') || el.getAttribute('src') || 'image')
      : (el.textContent || '').trim().slice(0, 200);

    window.parent.postMessage({
      type: 'pneuma:select',
      selection: { type, content, level }
    }, '*');
  });

  document.body.style.cursor = 'crosshair';
})();
</script>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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
${slideHtml}
${selectionScript}
</body>
</html>`;
}

/** Build a thumbnail-safe srcdoc (no scripts, no interactivity) */
function buildThumbnailSrcdoc(slideHtml: string, themeCSS: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
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
${slideHtml}
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
  return "left";
}

function saveNavPosition(pos: NavigatorPosition) {
  try {
    localStorage.setItem(NAV_STORAGE_KEY, pos);
  } catch {}
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
}: ViewerPreviewProps) {
  const setPreviewMode = useStore((s) => s.setPreviewMode);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [navPosition, setNavPosition] = useState<NavigatorPosition>(loadNavPosition);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isGridView, setIsGridView] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100); // percentage
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  const manifest = useMemo(() => parseManifest(files), [files]);
  const themeCSS = useMemo(() => findThemeCSS(files), [files]);
  const isSelectMode = previewMode === "select";

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

  // Zoom
  const zoomIn = useCallback(() => setZoomLevel((z) => Math.min(200, z + 10)), []);
  const zoomOut = useCallback(() => setZoomLevel((z) => Math.max(30, z - 10)), []);
  const zoomFit = useCallback(() => setZoomLevel(100), []);

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
      const baseUrl = import.meta.env.DEV ? `http://localhost:17007` : "";
      fetch(`${baseUrl}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "manifest.json",
          content: JSON.stringify(newManifest, null, 2) + "\n",
        }),
      }).catch(() => {});
    },
    [manifest, slides, activeSlideIndex],
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

  // Current slide content
  const currentSlide = slides[activeSlideIndex];
  const slideHtml = currentSlide
    ? findSlideContent(files, currentSlide.file)
    : "";
  const srcdoc = useMemo(
    () => buildSrcdoc(slideHtml, themeCSS, isSelectMode),
    [slideHtml, themeCSS, isSelectMode],
  );

  // Pre-build all thumbnail srcdocs
  const thumbnailSrcdocs = useMemo(
    () =>
      slides.map((s) =>
        buildThumbnailSrcdoc(findSlideContent(files, s.file), themeCSS),
      ),
    [files, slides, themeCSS],
  );

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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToSlide(activeSlideIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToSlide(activeSlideIndex + 1);
      } else if (e.key === "Escape") {
        // Fullscreen exit is handled by the browser's Fullscreen API
        if (isSelectMode) {
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
    isSelectMode,
    selection,
    onSelect,
    setPreviewMode,
  ]);

  // Listen for postMessage from iframe (selection)
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type !== "pneuma:select") return;
      const sel = e.data.selection;
      if (!sel) {
        onSelect(null);
        return;
      }
      onSelect({
        type: sel.type,
        content: sel.content,
        level: sel.level,
        file: currentSlide?.file,
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onSelect, currentSlide]);

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
          zoomLevel={zoomLevel}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomFit={zoomFit}
        />
        <div className="flex items-center justify-center flex-1 text-neutral-500">
          {!manifest
            ? "No manifest.json found in workspace"
            : "No slides in manifest.json"}
        </div>
      </div>
    );
  }

  // Virtual slide dimensions from init params (or defaults)
  const VIRTUAL_W = (initParams?.slideWidth as number) || 1280;
  const VIRTUAL_H = (initParams?.slideHeight as number) || 720;

  const navigatorEl = navPosition !== "hidden" ? (
    <SlideNavigator
      slides={slides}
      activeIndex={activeSlideIndex}
      onSelect={goToSlide}
      onReorder={handleReorder}
      thumbnailSrcdocs={thumbnailSrcdocs}
      position={navPosition}
      virtualWidth={VIRTUAL_W}
      virtualHeight={VIRTUAL_H}
    />
  ) : null;

  // Zoom: render iframe at a virtual size, use CSS transform to scale
  const zoomScale = zoomLevel / 100;
  const scaledW = VIRTUAL_W * zoomScale;
  const scaledH = VIRTUAL_H * zoomScale;

  const viewerEl = (
    <div className="flex-1 flex items-center justify-center bg-neutral-900 min-w-0 min-h-0 overflow-auto">
      <div
        className="shrink-0"
        style={{ width: scaledW, height: scaledH }}
      >
        <div
          className="bg-black rounded-lg overflow-hidden shadow-2xl origin-top-left"
          style={{
            width: VIRTUAL_W,
            height: VIRTUAL_H,
            transform: `scale(${zoomScale})`,
          }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={srcdoc}
            title={currentSlide?.title || "Slide"}
            className="w-full h-full border-0"
            sandbox="allow-scripts"
            key={`${activeSlideIndex}-${imageVersion}`}
          />
        </div>
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
          zoomLevel={zoomLevel}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomFit={zoomFit}
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
                className={`flex flex-col gap-2 p-2 rounded-lg transition-colors cursor-pointer text-left ${
                  i === activeSlideIndex
                    ? "bg-cc-primary/10 ring-2 ring-cc-primary"
                    : "hover:bg-cc-hover"
                }`}
              >
                <SlideThumbnail srcdoc={thumbnailSrcdocs[i]} isActive={i === activeSlideIndex} width={280} height={157.5} virtualWidth={VIRTUAL_W} virtualHeight={VIRTUAL_H} />
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
            srcDoc={buildSrcdoc(slideHtml, themeCSS, false)}
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
        zoomLevel={zoomLevel}
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
    </div>
  );
}

// ── Slide Navigator ──────────────────────────────────────────────────────────

function SlideNavigator({
  slides,
  activeIndex,
  onSelect,
  onReorder,
  thumbnailSrcdocs,
  position,
  virtualWidth,
  virtualHeight,
}: {
  slides: { file: string; title: string }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  thumbnailSrcdocs: string[];
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
                  srcdoc={thumbnailSrcdocs[i]}
                  onClick={() => onSelect(i)}
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
                srcdoc={thumbnailSrcdocs[i]}
                onClick={() => onSelect(i)}
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
    srcdoc: string;
    onClick: () => void;
    layout: "horizontal" | "vertical";
    virtualWidth: number;
    virtualHeight: number;
  }
>(function SortableSlideItem({ id, index, title, isActive, srcdoc, onClick, layout, virtualWidth, virtualHeight }, outerRef) {
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

  // Merge refs
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (typeof outerRef === "function") outerRef(node);
      else if (outerRef) outerRef.current = node;
    },
    [setNodeRef, outerRef],
  );

  if (layout === "horizontal") {
    return (
      <div
        ref={mergedRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={onClick}
        className={`shrink-0 flex flex-col items-center gap-1 cursor-pointer group ${
          isActive ? "" : "opacity-60 hover:opacity-100"
        } ${isDragging ? "opacity-70 scale-105 shadow-lg" : ""}`}
      >
        <SlideThumbnail srcdoc={srcdoc} isActive={isActive} width={144} height={81} virtualWidth={virtualWidth} virtualHeight={virtualHeight} />
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
      className={`w-full flex flex-col gap-1 cursor-pointer group ${
        isActive ? "" : "opacity-60 hover:opacity-100"
      } ${isDragging ? "opacity-70 scale-105 shadow-lg" : ""}`}
    >
      <SlideThumbnail srcdoc={srcdoc} isActive={isActive} virtualWidth={virtualWidth} virtualHeight={virtualHeight} />
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

/** Renders a scaled-down iframe as a slide thumbnail */
function SlideThumbnail({
  srcdoc,
  isActive,
  width,
  height,
  virtualWidth,
  virtualHeight,
}: {
  srcdoc: string;
  isActive: boolean;
  width?: number;
  height?: number;
  virtualWidth?: number;
  virtualHeight?: number;
}) {
  // Thumbnail renders at a virtual size then scales down via CSS transform
  const VIRTUAL_W = virtualWidth || 1280;
  const VIRTUAL_H = virtualHeight || 720;
  const thumbW = width ?? 192; // default for sidebar
  const thumbH = height ?? 108;
  const scale = thumbW / VIRTUAL_W;

  return (
    <div
      className={`relative rounded overflow-hidden border-2 transition-colors ${
        isActive
          ? "border-cc-primary shadow-[0_0_0_1px_rgba(217,119,87,0.3)]"
          : "border-transparent hover:border-cc-border"
      }`}
      style={{ width: thumbW, height: thumbH }}
    >
      <iframe
        srcDoc={srcdoc}
        tabIndex={-1}
        className="pointer-events-none border-0 origin-top-left"
        style={{
          width: VIRTUAL_W,
          height: VIRTUAL_H,
          transform: `scale(${scale})`,
        }}
        sandbox=""
        aria-hidden="true"
      />
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

type PreviewMode = "view" | "edit" | "select";

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
      { value: "select", label: "Select", icon: <CursorIcon /> },
    ];

  const handleExport = useCallback(() => {
    const baseUrl = import.meta.env.DEV ? `http://localhost:17007` : "";
    window.open(`${baseUrl}/export/slides`, "_blank");
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
                  : "Select elements (Esc to exit)"
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
