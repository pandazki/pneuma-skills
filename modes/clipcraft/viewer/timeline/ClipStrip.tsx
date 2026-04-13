// modes/clipcraft/viewer/timeline/ClipStrip.tsx
import type { ReactNode } from "react";
import type { Clip } from "@pneuma-craft/timeline";

export interface ClipStripProps {
  clip: Clip;
  pixelsPerSecond: number;
  scrollLeft: number;
  trackHeight: number;
  selected: boolean;
  onSelect: (clipId: string) => void;
  children?: ReactNode;
}

/**
 * Absolute-positioned clip rectangle. Handles click-to-select; the
 * visual inner content (thumbnails, waveform, text) is passed as
 * children so each track type can render its own representation
 * without ClipStrip knowing about it.
 */
export function ClipStrip({
  clip,
  pixelsPerSecond,
  scrollLeft,
  trackHeight,
  selected,
  onSelect,
  children,
}: ClipStripProps) {
  const x = Math.round(clip.startTime * pixelsPerSecond - scrollLeft);
  const width = Math.round(clip.duration * pixelsPerSecond);

  return (
    <div
      className="cc-clip-strip"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(clip.id);
      }}
      style={{
        position: "absolute",
        left: x,
        top: 0,
        width,
        height: trackHeight,
        background: selected ? "#fb923c22" : "#27272a",
        border: selected ? "1px solid #f97316" : "1px solid #3f3f46",
        borderRadius: 3,
        overflow: "hidden",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}
