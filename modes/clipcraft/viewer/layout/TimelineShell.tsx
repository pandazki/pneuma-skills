import { useCallback, useEffect } from "react";
import { Timeline } from "../timeline/Timeline.js";
import { useTimelineMode, type TimelineMode } from "../hooks/useTimelineMode.js";

/**
 * Timeline shell. Legacy reference:
 * modes/clipcraft-legacy/viewer/timeline/TimelineShell.tsx.
 *
 * Column-reverse pins the always-visible Timeline at the bottom. The
 * expanded panel (overview / exploded / dive) grows above it when
 * timelineMode !== "collapsed".
 *
 * The expand/collapse button is a floating overlay on top of the Plan 5
 * Timeline. Task 5 may migrate this into a proper leadingControl prop.
 */
export function TimelineShell() {
  const { timelineMode, setTimelineMode } = useTimelineMode();
  const isExpanded = timelineMode !== "collapsed";

  const handleToggle = useCallback(() => {
    setTimelineMode(isExpanded ? "collapsed" : "overview");
  }, [isExpanded, setTimelineMode]);

  useEffect(() => {
    if (!isExpanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTimelineMode("collapsed");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isExpanded, setTimelineMode]);

  return (
    <div
      style={{
        flex: isExpanded ? "1 1 100%" : "0 0 auto",
        display: "flex",
        flexDirection: "column-reverse",
        background: "#09090b",
        borderTop: "1px solid #27272a",
        overflow: "hidden",
        transition: "flex 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        position: "relative",
      }}
    >
      {/* Timeline — pinned at bottom */}
      <div style={{ flexShrink: 0, position: "relative" }}>
        <Timeline />
        <button
          onClick={handleToggle}
          title={isExpanded ? "Collapse" : "Expand 3D view"}
          style={{
            position: "absolute",
            top: 6,
            right: 12,
            width: 22,
            height: 22,
            border: "1px solid #3f3f46",
            borderRadius: 3,
            background: isExpanded ? "#27272a" : "transparent",
            color: isExpanded ? "#f97316" : "#a1a1aa",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            zIndex: 20,
          }}
        >
          {isExpanded ? "↓" : "↑"}
        </button>
      </div>

      {/* Expanded panel */}
      {isExpanded && <ExpandedPanel mode={timelineMode} />}
    </div>
  );
}

function ExpandedPanel({ mode }: { mode: TimelineMode }) {
  return (
    <div
      style={{
        flex: "1 1 auto",
        overflow: "hidden",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#52525b",
        fontSize: 12,
      }}
    >
      {mode === "overview" && "TimelineOverview3D (Task 5)"}
      {mode === "exploded" && "ExplodedView (Task 6)"}
      {mode === "dive" && "DiveCanvas (Task 7)"}
    </div>
  );
}
