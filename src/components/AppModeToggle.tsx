import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store/index.js";
import { getApiBase } from "../utils/api.js";

const desktop = (window as any).pneumaDesktop as {
  setEditing?: (editing: boolean, opts?: { width?: number; height?: number; resizable?: boolean }) => Promise<void>;
} | undefined;

/**
 * The shell owns the top edge of the viewing ("app") layout; everything below
 * it belongs to the viewer.
 *
 * This one number is binding in BOTH directions, and that is the whole rule:
 * the shell reveals its escape hatch only while the pointer is inside this
 * band, and it never DRAWS below it either. A viewer author can rely on that
 * — put your chrome below this line and the shell can neither cover it nor
 * take its clicks — in a way that "we moved our button to the other corner"
 * never could, because the next viewer will put something in that corner too.
 */
export const SHELL_EDGE_PX = 12;

/**
 * Top-edge escape hatch for the viewing ("app") layout: brush the very top of
 * the window and the Edit button fades in; move away and it fades out. Zero
 * visual footprint when not revealed.
 *
 * This is a TRIGGER ZONE, never a hit target — and that distinction is a
 * safety property, not a nicety. It used to be a full-width, fully
 * transparent `pointer-events: auto` layer at `z-index: 9999`: a click target
 * the size of the window standing in front of every viewer's own chrome.
 * Measured 2026-08-19 in a `--viewing` bansho session at 1440px: the board's
 * control row draws at y 20-46.5, entirely inside the old 48px strip, so
 * `document.elementFromPoint` over the centre of Board / Notes / the look
 * control returned the overlay every time. A real click on the most inviting
 * control on the board fired "Edit dashboard" instead — the session flipped
 * from viewing to editing and the shell spawned an agent inside a session the
 * user had asked only to watch.
 *
 * Three rules keep that from coming back, and all three are load-bearing:
 *
 *  1. Nothing here accepts a click while it is invisible. The container is
 *     `pointer-events: none` for good and holds no width it does not draw in;
 *     the button is inert until it is actually on screen.
 *  2. The button draws inside `SHELL_EDGE_PX` and never below it. Its old box
 *     (x 1371-1428, y 10-36) reached into bansho's look control (y 20-46.5)
 *     in board view and its Notes toggle in notes view; a shell control that
 *     stops at the shell's own line cannot reach either, and needs to know
 *     nothing about where any particular viewer puts its chrome.
 *  3. Reveal follows the pointer, not a layer of our own — an element cannot
 *     both be untouchable and report hover. Because the button lives entirely
 *     inside the band, that is a single comparison per mouse move, with no
 *     geometry to chase.
 *
 * A pointer that cannot hover (`hover: none` — touch) gets the button drawn
 * permanently instead: an affordance you cannot reach is not a safer
 * affordance, it is a missing one. It obeys the same line.
 */
export default function AppModeToggle() {
  const { t } = useTranslation("app-mode-toggle");
  const setEditing = useStore((s) => s.setEditing);
  const [nearEdge, setNearEdge] = useState(false);
  const [overButton, setOverButton] = useState(false);
  const [focused, setFocused] = useState(false);
  const [switching, setSwitching] = useState(false);
  // No hover to reveal with — the button has to be drawn to exist at all.
  const [hoverless, setHoverless] = useState(false);
  // Mirrors `nearEdge` so the move handler can decide without re-subscribing.
  const nearRef = useRef(false);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent): void => {
      const near = e.clientY <= SHELL_EDGE_PX;
      if (near === nearRef.current) return;
      nearRef.current = near;
      setNearEdge(near);
      // A style change can retire the button out from under the cursor
      // without a `mouseleave`; drop the accent with the reveal.
      if (!near) setOverButton(false);
    };
    const onLeaveWindow = (): void => {
      if (!nearRef.current) return;
      nearRef.current = false;
      setNearEdge(false);
      setOverButton(false);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("mouseleave", onLeaveWindow);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("mouseleave", onLeaveWindow);
    };
  }, []);

  // Watched rather than read once: a tablet that gets a trackpad attached
  // gains hover mid-session, and should get the quiet affordance back.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(hover: none)");
    setHoverless(query.matches);
    const onChange = (e: MediaQueryListEvent): void => setHoverless(e.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  // `switching` holds the button open across the fetch: the pointer is free to
  // drift while the agent is starting, and the spinner has to survive that.
  const revealed = hoverless || nearEdge || focused || switching;
  // Focus counts as accent as well as reveal — `src/index.css` kills outlines
  // globally, so this is the only focus indication a keyboard user gets.
  const accent = revealed && (overButton || focused);

  const enterEditing = useCallback(async () => {
    setSwitching(true);
    try {
      const res = await fetch(`${getApiBase()}/api/session/editing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editing: true }),
      });
      if (res.ok) {
        setEditing(true);
        desktop?.setEditing?.(true);
      }
    } catch (err) {
      console.error("Failed to switch to editing:", err);
    } finally {
      setSwitching(false);
    }
  }, [setEditing]);

  return (
    <div
      data-app-mode-toggle=""
      style={{
        // No width it does not draw in, no height below the shell's line, and
        // untouchable even there: whatever the viewer put under this corner
        // keeps both its pixels and its clicks.
        position: "fixed", top: 0, right: 0,
        zIndex: 9999, display: "flex", alignItems: "flex-start",
        padding: `0 ${SHELL_EDGE_PX}px 0`,
        pointerEvents: "none",
      }}
    >
      <button
        onClick={enterEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Only ever fires while the button is armed, which is the only time
        // the accent means anything.
        onMouseEnter={() => setOverButton(true)}
        onMouseLeave={() => setOverButton(false)}
        disabled={switching}
        style={{
          // The shell's line is the button's height budget. The pencil icon
          // that used to sit beside the label was 12px on its own — the whole
          // box — so the word carries it now.
          height: SHELL_EDGE_PX,
          paddingLeft: 7, paddingRight: 7,
          borderBottomLeftRadius: 5, borderBottomRightRadius: 5,
          borderTopLeftRadius: 0, borderTopRightRadius: 0,
          background: accent
            ? "rgba(249,115,22,0.14)"
            : revealed ? "rgba(255,255,255,0.08)" : "transparent",
          // Longhand only — mixing `border` with `borderTop` makes React warn
          // (and lets the two disagree on a re-render). The tab hangs from the
          // window's edge, so it has three sides, not four.
          borderStyle: "solid",
          borderWidth: "0 1px 1px 1px",
          borderColor: accent
            ? "rgba(249,115,22,0.3)"
            : revealed ? "rgba(255,255,255,0.12)" : "transparent",
          color: accent ? "#f97316" : revealed ? "rgba(255,255,255,0.6)" : "transparent",
          cursor: revealed ? "pointer" : "default",
          // The whole fix in one line: invisible means untouchable. A keyboard
          // tab reveals it first (onFocus), and a pointer that cannot hover
          // gets it drawn permanently, so this never locks the affordance away
          // from anyone.
          pointerEvents: revealed ? "auto" : "none",
          // 11px is the floor the rest of the session UI uses, and it fits:
          // the tab has no top border, so the content box is 12 - 1 = 11.
          fontSize: 11, fontWeight: 500, lineHeight: 1,
          display: "flex", alignItems: "center", gap: 4,
          transition: "background 0.25s ease, border-color 0.25s ease, color 0.25s ease",
          WebkitAppRegion: "no-drag",
          backdropFilter: revealed ? "blur(12px)" : "none",
        } as React.CSSProperties}
        title={t("edit_tooltip")}
      >
        {switching ? (
          <div style={{ width: 8, height: 8, border: "1.5px solid rgba(249,115,22,0.3)", borderTopColor: "#f97316", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        ) : null}
        <span style={{ opacity: revealed ? 1 : 0, transition: "opacity 0.25s" }}>{t("edit_button")}</span>
      </button>
    </div>
  );
}
