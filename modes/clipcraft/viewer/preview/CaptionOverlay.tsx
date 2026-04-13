import { useActiveSubtitle } from "./useActiveSubtitle.js";
import { resolveCaptionStyle } from "./captionStyle.js";
import type { CaptionStyle } from "../../persistence.js";

export interface CaptionOverlayProps {
  style?: CaptionStyle;
}

export function CaptionOverlay({ style }: CaptionOverlayProps) {
  const clip = useActiveSubtitle();
  const resolved = resolveCaptionStyle(style);

  if (!clip || !clip.text) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${resolved.bottomPercent * 100}%`,
        left: "50%",
        transform: "translateX(-50%)",
        background: resolved.background,
        color: resolved.color,
        fontSize: resolved.fontSize,
        fontWeight: resolved.fontWeight,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        padding: "6px 16px",
        borderRadius: 4,
        maxWidth: `${resolved.maxWidthPercent * 100}%`,
        textAlign: "center",
        lineHeight: 1.4,
        whiteSpace: "pre-wrap",
        textShadow: "0 1px 3px rgba(0,0,0,0.6)",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {clip.text}
    </div>
  );
}
