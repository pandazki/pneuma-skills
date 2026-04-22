import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useComposition } from "@pneuma-craft/react";
import { useActiveSubtitle } from "./useActiveSubtitle.js";
import { resolveCaptionStyle } from "./captionStyle.js";
import type { CaptionStyle } from "../../persistence.js";

export interface CaptionOverlayProps {
  style?: CaptionStyle;
}

// Paddings / radius / text-shadow live here in composition pixels
// alongside fontSize — they get scaled together so the caption chip
// preserves its proportions when the preview is shrunk.
const COMP_PADDING_Y = 14;
const COMP_PADDING_X = 20;
const COMP_BORDER_RADIUS = 10;

/**
 * Renders the active subtitle clip as a DOM overlay on top of the
 * preview canvas. Caption dimensions (fontSize, padding, radius) are
 * authored in composition-space pixels — the overlay measures its
 * positioned ancestor's width and scales everything by
 * `previewWidth / composition.width` so the chip looks the same
 * in the preview as it will in the full-resolution export.
 */
export function CaptionOverlay({ style }: CaptionOverlayProps) {
  const clip = useActiveSubtitle();
  const composition = useComposition();
  const resolved = resolveCaptionStyle(style);
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Measure the positioned ancestor (the aspect-ratio wrapper from
  // VideoPreview) and keep scale in sync as the window resizes.
  useLayoutEffect(() => {
    const el = hostRef.current;
    const compWidth = composition?.settings?.width;
    if (!el || !compWidth) return;
    const parent = el.parentElement;
    if (!parent) return;

    const update = () => {
      const w = parent.clientWidth;
      if (w > 0) setScale(w / compWidth);
    };
    update();

    const obs = new ResizeObserver(update);
    obs.observe(parent);
    return () => obs.disconnect();
  }, [composition?.settings?.width]);

  // Re-run once more after mount in case parent layout arrived late.
  useEffect(() => {
    if (!hostRef.current?.parentElement || !composition?.settings?.width) return;
    const w = hostRef.current.parentElement.clientWidth;
    if (w > 0) setScale(w / composition.settings.width);
  }, [composition?.settings?.width]);

  if (!clip || !clip.text) {
    // Keep the ref anchor mounted so the ResizeObserver can still
    // measure layout. Render an invisible 0-size span.
    return <span ref={hostRef} style={{ display: "none" }} aria-hidden />;
  }

  return (
    <div
      ref={hostRef}
      style={{
        position: "absolute",
        bottom: `${resolved.bottomPercent * 100}%`,
        left: "50%",
        transform: "translateX(-50%)",
        background: resolved.background,
        color: resolved.color,
        fontSize: resolved.fontSize * scale,
        fontWeight: resolved.fontWeight,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        padding: `${COMP_PADDING_Y * scale}px ${COMP_PADDING_X * scale}px`,
        borderRadius: COMP_BORDER_RADIUS * scale,
        maxWidth: `${resolved.maxWidthPercent * 100}%`,
        textAlign: "center",
        lineHeight: 1.4,
        whiteSpace: "pre-wrap",
        textShadow: `0 ${1 * scale}px ${3 * scale}px rgba(0,0,0,0.6)`,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {clip.text}
    </div>
  );
}
