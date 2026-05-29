import { useCallback, useEffect } from "react";
import { useStore } from "../store.js";
import ChatPanel from "./ChatPanel.js";
import AgentSurfaceControls from "./AgentSurfaceControls.js";

const MARGIN = 16;
const SNAP = 56;
const MIN_W = 340;
const MIN_H = 380;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * AgentFloating — the floating form of the Agent Surface: a draggable,
 * resizable glass panel over the viewer. Drag the header to move; drag the
 * bottom-right corner to resize. Releasing near a screen edge snaps the panel
 * flush to it. The form-switch cluster (dock / collapse) lives in the header.
 *
 * Position/size live in the store (floatRect) so they survive form switches
 * and persist as a per-mode habit. The conversation is the same ChatPanel
 * instance used by the docked and collapsed forms.
 */
export default function AgentFloating() {
  const floatRect = useStore((s) => s.floatRect);
  const setFloatRect = useStore((s) => s.setFloatRect);

  // Keep the panel inside the viewport on mount and on window resize.
  useEffect(() => {
    const clampIntoView = () => {
      const r = useStore.getState().floatRect;
      const w = Math.min(r.w, window.innerWidth - 2 * MARGIN);
      const h = Math.min(r.h, window.innerHeight - 2 * MARGIN);
      const x = clamp(r.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN));
      const y = clamp(r.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN));
      if (x !== r.x || y !== r.y || w !== r.w || h !== r.h) {
        useStore.getState().setFloatRect({ x, y, w, h });
      }
    };
    clampIntoView();
    window.addEventListener("resize", clampIntoView);
    return () => window.removeEventListener("resize", clampIntoView);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = useStore.getState().floatRect;
    const px = e.clientX;
    const py = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const x = clamp(start.x + (ev.clientX - px), MARGIN, window.innerWidth - start.w - MARGIN);
      const y = clamp(start.y + (ev.clientY - py), MARGIN, window.innerHeight - start.h - MARGIN);
      useStore.getState().setFloatRect({ x, y });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      // Snap flush to whichever edge the panel was released near.
      const r = useStore.getState().floatRect;
      let x = r.x;
      let y = r.y;
      if (x <= MARGIN + SNAP) x = MARGIN;
      else if (x + r.w >= window.innerWidth - MARGIN - SNAP) x = window.innerWidth - r.w - MARGIN;
      if (y <= MARGIN + SNAP) y = MARGIN;
      else if (y + r.h >= window.innerHeight - MARGIN - SNAP) y = window.innerHeight - r.h - MARGIN;
      if (x !== r.x || y !== r.y) useStore.getState().setFloatRect({ x, y });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  const startResize = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = useStore.getState().floatRect;
    const px = e.clientX;
    const py = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const w = clamp(start.w + (ev.clientX - px), MIN_W, window.innerWidth - start.x - MARGIN);
      const h = clamp(start.h + (ev.clientY - py), MIN_H, window.innerHeight - start.y - MARGIN);
      useStore.getState().setFloatRect({ w, h });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  return (
    <div
      className="agent-surface-floating fixed z-50 flex flex-col rounded-2xl overflow-hidden
                 border border-cc-primary/20 ring-1 ring-white/5
                 shadow-[0_0_40px_rgba(249,115,22,0.15)]
                 before:absolute before:inset-0 before:bg-cc-surface/80 before:backdrop-blur-2xl before:-z-10
                 animate-[fadeSlideIn_0.2s_ease-out]"
      style={{ left: floatRect.x, top: floatRect.y, width: floatRect.w, height: floatRect.h }}
    >
      {/* Header — drag handle + form controls */}
      <div
        onPointerDown={startDrag}
        className="relative z-10 flex items-center justify-between gap-2 px-3 h-9 shrink-0
                   border-b border-cc-border/40 cursor-grab active:cursor-grabbing select-none"
      >
        <span className="flex items-center text-cc-muted/40" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <circle cx="9" cy="8" r="1.3" />
            <circle cx="15" cy="8" r="1.3" />
            <circle cx="9" cy="12" r="1.3" />
            <circle cx="15" cy="12" r="1.3" />
            <circle cx="9" cy="16" r="1.3" />
            <circle cx="15" cy="16" r="1.3" />
          </svg>
        </span>
        <AgentSurfaceControls form="floating" />
      </div>

      {/* Conversation */}
      <div className="relative z-10 flex-1 min-h-0">
        <ChatPanel />
      </div>

      {/* Resize handle — bottom-right corner */}
      <div
        onPointerDown={startResize}
        className="absolute bottom-0 right-0 w-5 h-5 z-20 cursor-nwse-resize text-cc-muted/40 hover:text-cc-primary/70 transition-colors"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-full h-full">
          <path d="M20 10 10 20" />
          <path d="M20 16 16 20" />
        </svg>
      </div>
    </div>
  );
}
