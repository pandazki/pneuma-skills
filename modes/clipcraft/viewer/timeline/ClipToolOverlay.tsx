import type { ToolKind } from "./hooks/useEditorTool.js";

/**
 * Visual preview shown ON TOP of a clip when the editor tool is active
 * and the user is hovering this clip. Each tool gets its own visual
 * language; rendered inside the absolutely-positioned clip wrapper.
 *
 * - split:    orange dashed vertical guide at hoverPx + dashed clip border
 * - delete:   red dashed border + 30% opacity overlay + ✕ glyph
 * - duplicate: orange dashed border + ghost copy translated +clipWidth
 * - ripple:   same as delete + downstream-shift hint label
 *
 * The hover/active gating is the caller's responsibility — this
 * component just renders the overlay assuming it should be visible.
 */
export function ClipToolOverlay({
  tool,
  clipWidth,
  clipHeight,
  hoverPx,
}: {
  tool: ToolKind;
  clipWidth: number;
  clipHeight: number;
  hoverPx: number | null;
}) {
  if (tool === "split") {
    const x = hoverPx == null ? clipWidth / 2 : Math.max(0, Math.min(clipWidth, hoverPx));
    return (
      <>
        {/* Dashed clip outline */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px dashed #f97316",
            borderRadius: 3,
            background: "rgba(249,115,22,0.08)",
            pointerEvents: "none",
            boxShadow: "0 0 0 1px rgba(249,115,22,0.15)",
          }}
        />
        {/* Vertical split guide at cursor */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: x - 1,
            width: 2,
            background: "transparent",
            borderLeft: "2px dashed #fed7aa",
            pointerEvents: "none",
            boxShadow: "0 0 6px rgba(249,115,22,0.5)",
          }}
        />
      </>
    );
  }

  if (tool === "delete" || tool === "ripple") {
    const isRipple = tool === "ripple";
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: "1px dashed #ef4444",
          borderRadius: 3,
          background: "rgba(239,68,68,0.18)",
          pointerEvents: "none",
          boxShadow: "0 0 0 1px rgba(239,68,68,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.85,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#fca5a5",
            letterSpacing: 0.6,
            textShadow: "0 1px 4px rgba(0,0,0,0.6)",
          }}
        >
          {isRipple ? "× ripple" : "×"}
        </span>
      </div>
    );
  }

  if (tool === "duplicate") {
    return (
      <>
        {/* Dashed border on the source */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px dashed #f97316",
            borderRadius: 3,
            background: "rgba(249,115,22,0.06)",
            pointerEvents: "none",
          }}
        />
        {/* Ghost copy translated to the right */}
        <div
          style={{
            position: "absolute",
            left: clipWidth + 2,
            top: 0,
            width: clipWidth - 1,
            height: clipHeight,
            border: "1px dashed #fed7aa",
            borderRadius: 3,
            background: "rgba(249,115,22,0.18)",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 8px rgba(249,115,22,0.3)",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#fed7aa",
              letterSpacing: 0.6,
              textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            }}
          >
            +1
          </span>
        </div>
      </>
    );
  }

  return null;
}
