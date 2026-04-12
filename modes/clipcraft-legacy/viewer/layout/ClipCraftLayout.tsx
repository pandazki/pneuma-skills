// modes/clipcraft/viewer/layout/ClipCraftLayout.tsx
import { useRef } from "react";
import { AssetPanel } from "../AssetPanel.js";
import { VideoPreview } from "../VideoPreview.js";
import { TimelineShell } from "../timeline/TimelineShell.js";
import { useClipCraftState } from "../store/ClipCraftContext.js";

/**
 * Default ClipCraft layout — medeo-inspired:
 * ┌──────────────┬────────────────────────┐
 * │ AssetPanel   │     Video Preview      │
 * │ (Assets/     │     (with captions)    │
 * │  Script tabs)│                        │
 * ├──────────────┴────────────────────────┤
 * │ TimelineShell (collapsed / 3D / dive) │
 * └───────────────────────────────────────┘
 */
export function ClipCraftLayout() {
  const { timelineMode } = useClipCraftState();
  const isExpanded = timelineMode !== "collapsed";
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

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
      {/* Top: sidebar + preview — collapses when timeline expands */}
      <div
        style={{
          flex: isExpanded ? "0 0 0px" : "1 1 60%",
          opacity: isExpanded ? 0 : 1,
          display: "flex",
          minHeight: 0,
          borderBottom: "1px solid #27272a",
          overflow: "hidden",
          transition: "flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
        }}
      >
        <AssetPanel />
        <div style={{ flex: 1, minWidth: 0 }}>
          <VideoPreview videoRefs={videoRefs} />
        </div>
      </div>

      {/* Timeline shell — timeline pinned at bottom, 3D grows above */}
      <TimelineShell videoRefs={videoRefs} />
    </div>
  );
}
