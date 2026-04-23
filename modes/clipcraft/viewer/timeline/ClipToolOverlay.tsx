import type { ToolKind } from "./hooks/useEditorTool.js";
import { XIcon, ZapIcon, CopyIcon } from "../icons/index.js";
import { theme } from "../theme/tokens.js";

/**
 * Visual preview shown ON TOP of a clip when the editor tool is active
 * and the user is hovering this clip. Each tool gets its own visual
 * language; rendered inside the absolutely-positioned clip wrapper.
 *
 * - split:     accent dashed border + dashed vertical guide at hoverPx
 * - delete:    danger dashed border + tinted fill + close-icon marker
 * - duplicate: accent dashed source + ghost copy translated +clipWidth
 * - ripple:    same as delete + ripple hint
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
    const x =
      hoverPx == null ? clipWidth / 2 : Math.max(0, Math.min(clipWidth, hoverPx));
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: `1px dashed ${theme.color.accent}`,
            borderRadius: theme.radius.sm,
            background: theme.color.accentFaint,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: x - 1,
            width: 2,
            background: "transparent",
            borderLeft: `2px dashed ${theme.color.accentBright}`,
            pointerEvents: "none",
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
          border: `1px dashed ${theme.color.danger}`,
          borderRadius: theme.radius.sm,
          background: theme.color.dangerSoft,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: theme.space.space1,
          color: theme.color.dangerInk,
          fontFamily: theme.font.ui,
          fontSize: theme.text.xs,
          fontWeight: theme.text.weightSemibold,
          letterSpacing: theme.text.trackingCaps,
          textTransform: "uppercase",
        }}
      >
        {isRipple ? <ZapIcon size={11} /> : <XIcon size={11} />}
        {isRipple && clipWidth > 80 && <span>ripple</span>}
      </div>
    );
  }

  if (tool === "duplicate") {
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: `1px dashed ${theme.color.accent}`,
            borderRadius: theme.radius.sm,
            background: theme.color.accentFaint,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: clipWidth + 2,
            top: 0,
            width: clipWidth - 1,
            height: clipHeight,
            border: `1px dashed ${theme.color.accentBright}`,
            borderRadius: theme.radius.sm,
            background: theme.color.accentSoft,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: theme.space.space1,
            color: theme.color.accentBright,
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            fontWeight: theme.text.weightSemibold,
            letterSpacing: theme.text.trackingCaps,
            textTransform: "uppercase",
          }}
        >
          <CopyIcon size={11} />
          {clipWidth > 80 && <span>copy</span>}
        </div>
      </>
    );
  }

  return null;
}
