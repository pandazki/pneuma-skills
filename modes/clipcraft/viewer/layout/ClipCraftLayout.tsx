import { VideoPreview } from "../preview/VideoPreview.js";
import type { CaptionStyle } from "../../persistence.js";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { TimelineShell } from "./TimelineShell.js";

export interface ClipCraftLayoutProps {
  captionStyle?: CaptionStyle;
}

/**
 * ClipCraft's outer layout:
 *
 *   ┌────────────────┬──────────────────────────┐
 *   │  AssetPanel    │    VideoPreview          │
 *   │  (Task 4)      │    (Task 3)              │
 *   ├────────────────┴──────────────────────────┤
 *   │   TimelineShell — collapsed / overview /  │
 *   │   exploded / dive (Tasks 5 / 6 / 7)       │
 *   └───────────────────────────────────────────┘
 *
 * When `timelineMode !== "collapsed"`, the top half animates its flex-basis
 * to 0 and the shell takes the full height. Legacy reference:
 * modes/clipcraft-legacy/viewer/layout/ClipCraftLayout.tsx.
 */
export function ClipCraftLayout({ captionStyle }: ClipCraftLayoutProps = {}) {
  const { timelineMode } = useTimelineMode();
  const isExpanded = timelineMode !== "collapsed";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#09090b",
        color: "#e4e4e7",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: isExpanded ? "0 0 0px" : "1 1 60%",
          opacity: isExpanded ? 0 : 1,
          display: "flex",
          minHeight: 0,
          borderBottom: "1px solid #27272a",
          overflow: "hidden",
          transition:
            "flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
        }}
      >
        <AssetPanelPlaceholder />
        <div style={{ flex: 1, minWidth: 0 }}>
          <VideoPreview captionStyle={captionStyle} />
        </div>
      </div>

      <TimelineShell />
    </div>
  );
}

function AssetPanelPlaceholder() {
  return (
    <div
      style={{
        width: 220,
        minWidth: 220,
        background: "#111113",
        borderRight: "1px solid #27272a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#52525b",
        fontSize: 11,
      }}
    >
      AssetPanel (Task 4)
    </div>
  );
}

