import { VideoPreview } from "../preview/VideoPreview.js";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { TimelineShell } from "./TimelineShell.js";
import { AssetPanel } from "../assets/AssetPanel.js";
import { theme } from "../theme/tokens.js";

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
export function ClipCraftLayout() {
  const { timelineMode } = useTimelineMode();
  const isExpanded = timelineMode !== "collapsed";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: theme.color.surface0,
        color: theme.color.ink1,
        fontFamily: theme.font.ui,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: isExpanded ? "0 0 0px" : "1 1 60%",
          opacity: isExpanded ? 0 : 1,
          display: "flex",
          minHeight: 0,
          borderBottom: `1px solid ${theme.color.borderWeak}`,
          overflow: "hidden",
          transition: `flex ${theme.duration.slower}ms ${theme.easing.snap}, opacity ${theme.duration.slow}ms ${theme.easing.out}`,
        }}
      >
        <AssetPanel />
        <div style={{ flex: 1, minWidth: 0 }}>
          <VideoPreview />
        </div>
      </div>

      <TimelineShell />
    </div>
  );
}
