import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const WHEEL_STEP = 1.15;
const BUTTON_STEP = 1.25;

/**
 * Modal image viewer with cursor-anchored wheel zoom, drag-to-pan, and a
 * small floating toolbar. Long screenshots that don't fit the viewport at
 * 100% can now be inspected by scrolling in and dragging around.
 *
 * Interaction map:
 *   wheel        zoom (centered on cursor)
 *   drag         pan (when zoomed past fit)
 *   double-click toggle 1× / 2×
 *   Esc          close
 *   +/-/0        zoom in / out / reset (keyboard)
 *
 * The backdrop click still dismisses the lightbox, but only if the pointer
 * actually moved < 4px between down and up — a pan that happens to release
 * over the backdrop no longer closes the viewer mid-gesture.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [grabbing, setGrabbing] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const setContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    trapRef.current = el;
  }, [trapRef]);

  // Active pan gesture state — kept in a ref so wheel events during a pan
  // don't trigger React re-renders mid-drag.
  const panState = useRef<{ x0: number; y0: number; tx0: number; ty0: number; moved: boolean } | null>(null);
  const lastInteractionDragged = useRef(false);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor));
      // When zooming out toward fit, recentre so the image doesn't drift
      // off-screen — translation has no meaning at fit anyway.
      if (next <= 1.01) {
        setTx(0);
        setTy(0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "0") reset();
      else if (e.key === "+" || e.key === "=") zoomBy(BUTTON_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / BUTTON_STEP);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, reset, zoomBy]);

  // Native (non-passive) wheel handler — React's synthetic onWheel is
  // passive in modern Chrome, so calling preventDefault() there only logs
  // a warning. We attach manually to suppress the page-level scroll the
  // lightbox would otherwise inherit on long pages.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      setScale((s) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor));
        // Cursor-anchored zoom: keep the image point under the cursor
        // fixed in viewport space. Derivation: image point P satisfies
        //   (cursor - center - t) / scale = P
        // After zoom: t' = cursor - center - P*scale'
        //            = cursor - center - (cursor - center - t) * (scale'/scale)
        const f = next / s;
        if (next <= 1.01) {
          setTx(0);
          setTy(0);
        } else {
          setTx((prev) => cx * (1 - f) + prev * f);
          setTy((prev) => cy * (1 - f) + prev * f);
        }
        return next;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (e.button !== 0) return;
    panState.current = { x0: e.clientX, y0: e.clientY, tx0: tx, ty0: ty, moved: false };
    lastInteractionDragged.current = false;
    setGrabbing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const s = panState.current;
    if (!s) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      s.moved = true;
      lastInteractionDragged.current = true;
    }
    if (s.moved) {
      setTx(s.tx0 + dx);
      setTy(s.ty0 + dy);
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    panState.current = null;
    setGrabbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onImageDoubleClick = () => {
    if (scale > 1.01) reset();
    else setScale(2);
  };

  const onBackdropClick = () => {
    // Swallow the click when the user just finished a pan that ended over
    // the backdrop — otherwise mid-gesture release would dismiss the
    // viewer right after they zoomed in.
    if (lastInteractionDragged.current) {
      lastInteractionDragged.current = false;
      return;
    }
    onClose();
  };

  const cursor = scale > 1.01 ? (grabbing ? "grabbing" : "grab") : "zoom-in";
  const atFit = scale <= 1.01;

  return (
    <div
      ref={setContainer}
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm select-none overflow-hidden"
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={onImageDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: "center",
          cursor,
          maxWidth: atFit ? "92vw" : undefined,
          maxHeight: atFit ? "92vh" : undefined,
          willChange: "transform",
        }}
        className="rounded shadow-2xl object-contain"
      />

      {/* Floating toolbar — clicks here mustn't bubble up to the backdrop. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 right-4 flex items-center gap-1 bg-cc-card/85 backdrop-blur-md border border-cc-border/60 rounded-lg p-1 shadow-lg"
      >
        <button
          type="button"
          onClick={() => zoomBy(1 / BUTTON_STEP)}
          aria-label="Zoom out"
          title="Zoom out (−)"
          className="w-7 h-7 flex items-center justify-center text-cc-fg hover:bg-cc-hover rounded transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
            <path d="M3 8h10" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label="Reset zoom"
          title="Reset (0)"
          className="px-2 h-7 flex items-center justify-center text-[11px] tabular-nums text-cc-fg hover:bg-cc-hover rounded transition-colors cursor-pointer min-w-12"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(BUTTON_STEP)}
          aria-label="Zoom in"
          title="Zoom in (+)"
          className="w-7 h-7 flex items-center justify-center text-cc-fg hover:bg-cc-hover rounded transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
            <path d="M3 8h10M8 3v10" strokeLinecap="round" />
          </svg>
        </button>
        <div className="w-px h-5 bg-cc-border/60 mx-0.5" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          className="w-7 h-7 flex items-center justify-center text-cc-fg hover:bg-cc-hover rounded transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
