import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import ChatPanel from "./ChatPanel.js";
import AgentSurfaceControls from "./AgentSurfaceControls.js";
import AgentBubble from "./AgentBubble.js";

const MARGIN = 16;
const SNAP = 56;
const MIN_W = 340;
const MIN_H = 380;
// Right-edge rail used when "docked" with no reserved slot (app layout).
const RAIL_W = 420;

type Box = { x: number; y: number; w: number; h: number };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * AgentSurfaceLayer — the single, always-mounted home for the agent
 * conversation. One ChatPanel lives inside one fixed "host" card that MORPHS
 * between forms instead of remounting:
 *
 *   - docked     → snapped over the reserved rail slot (#agent-dock-slot)
 *   - floating   → at floatRect, draggable by the header, resizable at the corner
 *   - collapsed  → scaled + faded toward the corner; the bubble takes over
 *
 * Box transitions are enabled by default so a form change glides (ease-out-quart,
 * see .agent-surface-host in index.css). They are switched OFF during an active
 * drag / resize / rail-resize so the card tracks the pointer with zero lag.
 * Because the card never leaves the React tree, scroll position, streaming, and
 * the WS connection all survive every relocation.
 *
 * Rendered once at the session root (outside the shell card) so its fixed
 * positioning stays viewport-relative — no backdrop-filter ancestor to create a
 * containing block.
 */
export default function AgentSurfaceLayer() {
  const form = useStore((s) => s.surfaceForm);
  const floatRect = useStore((s) => s.floatRect);

  const [dockRect, setDockRect] = useState<Box | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [slotResizing, setSlotResizing] = useState(false);
  const slotResizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the docked rail geometry. Editor layout reserves a real slot; app
  // layout has none, so fall back to a right-edge overlay rail.
  useEffect(() => {
    if (form !== "docked") {
      setDockRect(null);
      return;
    }
    const slot = document.getElementById("agent-dock-slot");
    if (!slot) {
      const compute = () =>
        setDockRect({
          x: window.innerWidth - RAIL_W - MARGIN,
          y: MARGIN,
          w: RAIL_W,
          h: window.innerHeight - 2 * MARGIN,
        });
      compute();
      window.addEventListener("resize", compute);
      return () => window.removeEventListener("resize", compute);
    }
    const measure = () => {
      const r = slot.getBoundingClientRect();
      setDockRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    measure();
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
      // Dragging the rail separator must not lag behind an eased transition.
      setSlotResizing(true);
      if (slotResizeTimer.current) clearTimeout(slotResizeTimer.current);
      slotResizeTimer.current = setTimeout(() => setSlotResizing(false), 90);
    });
    ro.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(raf);
    };
  }, [form]);

  // Resolve the host box. Collapsed keeps the last expanded box so it scales in
  // place toward the corner rather than jumping.
  const boxRef = useRef<Box>(floatRect);
  const collapsed = form === "collapsed";
  const docked = form === "docked";
  let box: Box;
  if (docked && dockRect) box = dockRect;
  else if (collapsed) box = boxRef.current;
  else box = floatRect;
  if (!collapsed) boxRef.current = box;

  // Hide for the first frame after docking until the slot is measured, so the
  // card doesn't flash at the floating position.
  const awaitingDock = docked && !dockRect;
  const animating = !interacting && !slotResizing;

  const startDrag = useCallback((e: React.PointerEvent) => {
    if (useStore.getState().surfaceForm !== "floating" || e.button !== 0) return;
    e.preventDefault();
    const start = useStore.getState().floatRect;
    const px = e.clientX;
    const py = e.clientY;
    setInteracting(true);

    const onMove = (ev: PointerEvent) => {
      const x = clamp(start.x + (ev.clientX - px), MARGIN, window.innerWidth - start.w - MARGIN);
      const y = clamp(start.y + (ev.clientY - py), MARGIN, window.innerHeight - start.h - MARGIN);
      useStore.getState().setFloatRect({ x, y });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setInteracting(false);
      // Snap flush to whichever edge the card was released near.
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
    setInteracting(true);

    const onMove = (ev: PointerEvent) => {
      const w = clamp(start.w + (ev.clientX - px), MIN_W, window.innerWidth - start.x - MARGIN);
      const h = clamp(start.h + (ev.clientY - py), MIN_H, window.innerHeight - start.y - MARGIN);
      useStore.getState().setFloatRect({ w, h });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setInteracting(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  return (
    <>
      <div
        className="agent-surface-host fixed z-50 flex flex-col rounded-2xl overflow-hidden
                   border border-cc-primary/20 ring-1 ring-white/5
                   shadow-[0_0_40px_rgba(249,115,22,0.15)]
                   before:absolute before:inset-0 before:bg-cc-surface/80 before:backdrop-blur-2xl before:-z-10"
        data-animating={animating}
        aria-hidden={collapsed}
        style={{
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          opacity: collapsed || awaitingDock ? 0 : 1,
          transform: collapsed ? "scale(0.86)" : "scale(1)",
          transformOrigin: "bottom right",
          pointerEvents: collapsed || awaitingDock ? "none" : "auto",
        }}
      >
        {/* Header — drag handle (floating only) + form controls */}
        <div
          onPointerDown={startDrag}
          className={`relative z-10 flex items-center justify-between gap-2 px-3 h-9 shrink-0
                      border-b border-cc-border/40 select-none ${
                        form === "floating" ? "cursor-grab active:cursor-grabbing" : ""
                      }`}
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
          <AgentSurfaceControls form={form} />
        </div>

        {/* The conversation — one instance, never unmounted */}
        <div className="relative z-10 flex-1 min-h-0">
          <ChatPanel />
        </div>

        {/* Resize handle — floating only */}
        {form === "floating" && (
          <div
            onPointerDown={startResize}
            className="absolute bottom-0 right-0 w-5 h-5 z-20 cursor-nwse-resize
                       text-cc-muted/40 hover:text-cc-primary/70 transition-colors"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-full h-full">
              <path d="M20 10 10 20" />
              <path d="M20 16 16 20" />
            </svg>
          </div>
        )}
      </div>

      {collapsed && <AgentBubble />}
    </>
  );
}
