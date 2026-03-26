import { useState, useCallback } from "react";
import { useStore } from "../store/index.js";
import { getApiBase } from "../utils/api.js";

const desktop = (window as any).pneumaDesktop as {
  setEditing?: (editing: boolean, opts?: { width?: number; height?: number; resizable?: boolean }) => Promise<void>;
} | undefined;

/**
 * Invisible top-edge hover zone for the viewing (app) layout.
 * Mouse near the top → Edit button fades in. Mouse away → fades out.
 * Zero visual footprint when not hovered.
 */
export default function AppModeToggle() {
  const setEditing = useStore((s) => s.setEditing);
  const [hovering, setHovering] = useState(false);
  const [switching, setSwitching] = useState(false);

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
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 48,
        zIndex: 9999, display: "flex", alignItems: "flex-start",
        justifyContent: "flex-end", padding: "10px 12px 0",
        pointerEvents: "auto",
      }}
    >
      <button
        onClick={enterEditing}
        disabled={switching}
        style={{
          height: 26, paddingLeft: 8, paddingRight: 10, borderRadius: 7,
          background: hovering ? "rgba(255,255,255,0.08)" : "transparent",
          border: hovering ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
          color: hovering ? "rgba(255,255,255,0.6)" : "transparent",
          cursor: hovering ? "pointer" : "default",
          fontSize: 11, fontWeight: 500,
          display: "flex", alignItems: "center", gap: 4,
          transition: "all 0.25s ease",
          WebkitAppRegion: "no-drag",
          backdropFilter: hovering ? "blur(12px)" : "none",
        } as React.CSSProperties}
        onMouseEnter={(e) => {
          if (hovering) {
            e.currentTarget.style.color = "#f97316";
            e.currentTarget.style.background = "rgba(249,115,22,0.12)";
            e.currentTarget.style.borderColor = "rgba(249,115,22,0.3)";
          }
        }}
        onMouseLeave={(e) => {
          if (hovering) {
            e.currentTarget.style.color = "rgba(255,255,255,0.6)";
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
          }
        }}
        title="Edit dashboard"
      >
        {switching ? (
          <div style={{ width: 12, height: 12, border: "1.5px solid rgba(249,115,22,0.3)", borderTopColor: "#f97316", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: hovering ? 1 : 0, transition: "opacity 0.25s" }}>
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        )}
        <span style={{ opacity: hovering ? 1 : 0, transition: "opacity 0.25s" }}>Edit</span>
      </button>
    </div>
  );
}
