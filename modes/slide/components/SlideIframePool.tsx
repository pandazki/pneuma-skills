/**
 * SlideIframePool — Keeps rendered iframes alive and toggles visibility.
 *
 * Instead of destroying/recreating the iframe on every slide switch (which
 * causes a black flash while Tailwind CDN loads), this component maintains a
 * pool of iframes — one per slide — stacked with `position: absolute`. Only
 * the active slide has `visibility: visible`; switching is a CSS toggle.
 *
 * Progressive rendering: the active slide renders first, then adjacent slides
 * expand outward in 100ms increments, up to a max pool size of 20.
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";

// Re-use helpers from SlidePreview (they're module-scoped, so we import the
// component's local copies via the parent passing data, not by importing the
// file directly). The pool receives pre-built data instead.

const MAX_POOL_SIZE = 20;

interface SlideIframePoolProps {
  slides: { file: string; title: string }[];
  files: ViewerPreviewProps["files"];
  themeCSS: string;
  activeIndex: number;
  isSelectMode: boolean;
  imageVersion: number;
  onSelect: (sel: ViewerSelectionContext | null) => void;
  /** Build the full srcdoc for a slide's HTML + theme */
  buildSrcdoc: (slideHtml: string, themeCSS: string) => string;
  /** Find a slide's HTML content by file path */
  findSlideContent: (
    files: ViewerPreviewProps["files"],
    slidePath: string,
  ) => string;
}

export default function SlideIframePool({
  slides,
  files,
  themeCSS,
  activeIndex,
  isSelectMode,
  imageVersion,
  onSelect,
  buildSrcdoc,
  findSlideContent,
}: SlideIframePoolProps) {
  // Set of slide.file keys currently in the pool
  const [pool, setPool] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (slides[activeIndex]) s.add(slides[activeIndex].file);
    return s;
  });

  // Refs: one per slide.file for postMessage and reload
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());
  // Track which iframes have finished loading (for reload on imageVersion)
  const loadedRefs = useRef<Set<string>>(new Set());
  // Previous imageVersion to detect changes
  const prevImageVersion = useRef(imageVersion);
  // Previous srcdoc per slide to detect content changes
  const prevSrcdocs = useRef<Map<string, string>>(new Map());

  // ── Progressive pool expansion ────────────────────────────────────────────
  useEffect(() => {
    // Always ensure active slide is in the pool immediately
    setPool((prev) => {
      if (slides[activeIndex] && !prev.has(slides[activeIndex].file)) {
        const next = new Set(prev);
        next.add(slides[activeIndex].file);
        return next;
      }
      return prev;
    });

    // Expand outward in 100ms increments
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const totalSlides = Math.min(slides.length, MAX_POOL_SIZE);
    let radius = 1;

    const expand = () => {
      if (cancelled) return;
      const toAdd: string[] = [];
      // Add slides at activeIndex ± radius
      for (const offset of [-radius, radius]) {
        const idx = activeIndex + offset;
        if (idx >= 0 && idx < slides.length) {
          toAdd.push(slides[idx].file);
        }
      }

      if (toAdd.length > 0) {
        setPool((prev) => {
          const next = new Set(prev);
          for (const f of toAdd) next.add(f);
          // Evict furthest if over max
          if (next.size > MAX_POOL_SIZE) {
            evictFurthest(next, slides, activeIndex, MAX_POOL_SIZE);
          }
          return next;
        });
      }

      radius++;
      if (radius <= Math.ceil(totalSlides / 2)) {
        timers.push(setTimeout(expand, 100));
      }
    };

    timers.push(setTimeout(expand, 100));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [activeIndex, slides]);

  // ── Send selectMode postMessage to all loaded iframes ─────────────────────
  useEffect(() => {
    iframeRefs.current.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          { type: "pneuma:selectMode", enabled: isSelectMode },
          "*",
        );
      } catch {}
    });
  }, [isSelectMode]);

  // Also send selectMode when an iframe loads
  const handleLoad = useCallback(
    (file: string) => {
      loadedRefs.current.add(file);
      const iframe = iframeRefs.current.get(file);
      if (iframe) {
        try {
          iframe.contentWindow?.postMessage(
            { type: "pneuma:selectMode", enabled: isSelectMode },
            "*",
          );
        } catch {}
      }
    },
    [isSelectMode],
  );

  // ── Reload on imageVersion change ─────────────────────────────────────────
  useEffect(() => {
    if (imageVersion !== prevImageVersion.current) {
      prevImageVersion.current = imageVersion;
      // Reload all loaded iframes
      loadedRefs.current.forEach((file) => {
        const iframe = iframeRefs.current.get(file);
        if (iframe) {
          try {
            iframe.contentWindow?.location.reload();
          } catch {
            // Sandboxed — fall back to resetting srcdoc
            // The srcdoc won't have changed, but reassigning triggers reload
            iframe.srcdoc = iframe.srcdoc;
          }
        }
      });
    }
  }, [imageVersion]);

  // ── Detect content changes and reload affected iframes ────────────────────
  const currentSrcdocs = useMemo(() => {
    const map = new Map<string, string>();
    for (const slide of slides) {
      if (pool.has(slide.file)) {
        const html = findSlideContent(files, slide.file);
        map.set(slide.file, buildSrcdoc(html, themeCSS));
      }
    }
    return map;
  }, [slides, pool, files, themeCSS, buildSrcdoc, findSlideContent]);

  // Check for srcdoc changes and update iframes that need it
  useEffect(() => {
    currentSrcdocs.forEach((srcdoc, file) => {
      const prev = prevSrcdocs.current.get(file);
      if (prev !== undefined && prev !== srcdoc) {
        // Content changed — update the iframe's srcdoc directly
        const iframe = iframeRefs.current.get(file);
        if (iframe) {
          iframe.srcdoc = srcdoc;
        }
      }
    });
    prevSrcdocs.current = new Map(currentSrcdocs);
  }, [currentSrcdocs]);

  // ── Listen for selection postMessages from iframes ────────────────────────
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type !== "pneuma:select") return;
      const sel = e.data.selection;
      if (!sel) {
        onSelect(null);
        return;
      }
      const currentSlide = slides[activeIndex];
      onSelect({
        type: sel.type,
        content: sel.content,
        level: sel.level,
        file: currentSlide?.file,
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onSelect, slides, activeIndex]);

  // ── Ref callback factory ──────────────────────────────────────────────────
  const setIframeRef = useCallback(
    (file: string) => (el: HTMLIFrameElement | null) => {
      if (el) {
        iframeRefs.current.set(file, el);
      } else {
        iframeRefs.current.delete(file);
        loadedRefs.current.delete(file);
      }
    },
    [],
  );

  return (
    <>
      {slides.map((slide, i) => {
        if (!pool.has(slide.file)) return null;
        const srcdoc = currentSrcdocs.get(slide.file) || "";
        return (
          <iframe
            key={slide.file}
            ref={setIframeRef(slide.file)}
            srcDoc={srcdoc}
            title={slide.title || `Slide ${i + 1}`}
            style={{
              visibility: i === activeIndex ? "visible" : "hidden",
            }}
            className="absolute inset-0 w-full h-full border-0"
            sandbox="allow-scripts"
            onLoad={() => handleLoad(slide.file)}
          />
        );
      })}
    </>
  );
}

/** Evict slides furthest from activeIndex until pool is within maxSize */
function evictFurthest(
  pool: Set<string>,
  slides: { file: string }[],
  activeIndex: number,
  maxSize: number,
) {
  // Build a list of pool entries with distance from active
  const entries: { file: string; distance: number }[] = [];
  for (const file of pool) {
    const idx = slides.findIndex((s) => s.file === file);
    entries.push({
      file,
      distance: idx === -1 ? Infinity : Math.abs(idx - activeIndex),
    });
  }
  // Sort by distance descending (furthest first)
  entries.sort((a, b) => b.distance - a.distance);
  while (pool.size > maxSize && entries.length > 0) {
    const entry = entries.shift()!;
    pool.delete(entry.file);
  }
}
