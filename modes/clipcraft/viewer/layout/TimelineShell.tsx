import { useEffect, useState } from "react";
import { Timeline } from "../timeline/Timeline.js";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { TimelineOverview3D } from "../overview/TimelineOverview3D.js";
import { OverviewControls } from "../overview/OverviewControls.js";
import { useOverviewCamera } from "../overview/useOverviewCamera.js";
import { ExplodedView } from "../exploded/ExplodedView.js";
import { DiveCanvas } from "../dive/DiveCanvas.js";
import { ClipInspector } from "../timeline/inspector/ClipInspector.js";
import { theme } from "../theme/tokens.js";

/**
 * Timeline shell. Legacy reference:
 * modes/clipcraft-legacy/viewer/timeline/TimelineShell.tsx.
 *
 * Column-reverse pins the always-visible Timeline at the bottom. The
 * expanded panel (overview / exploded / dive) grows above it when
 * timelineMode !== "collapsed".
 *
 * Task 5 wires in the real TimelineOverview3D; ExplodedView and DiveCanvas
 * remain placeholder divs (Tasks 6 and 7).
 */
export function TimelineShell() {
  const { timelineMode, setTimelineMode } = useTimelineMode();
  const isExpanded = timelineMode !== "collapsed";

  // Mount the expanded panel lazily on first expand, then keep it
  // mounted forever so its internal state (camera preset, layer
  // toggles, dive node selection, frame extractor caches, …)
  // survives subsequent collapse/expand cycles. We toggle visibility
  // via display:none rather than unmounting.
  const [hasEverExpanded, setHasEverExpanded] = useState(false);
  useEffect(() => {
    if (isExpanded && !hasEverExpanded) setHasEverExpanded(true);
  }, [isExpanded, hasEverExpanded]);

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
        background: theme.color.surface0,
        borderTop: `1px solid ${theme.color.borderWeak}`,
        overflow: "hidden",
        transition: `flex ${theme.duration.slower}ms ${theme.easing.snap}`,
        position: "relative",
        // Drag/seek interactions in this region must never accidentally
        // create a text selection. ClipInspector's number inputs need
        // text selection and re-enable it locally.
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Timeline — pinned at bottom. The 3D toggle now lives inside
          TransportBar (right end) so it can't overlap the Speed control. */}
      <div style={{ flexShrink: 0, position: "relative" }}>
        <Timeline />
      </div>

      <ClipInspector />

      {/* Expanded panel — mounted lazily on first expand, then kept
          mounted with display:none toggling so its state survives. */}
      {hasEverExpanded && (
        <div
          style={{
            display: isExpanded ? "flex" : "none",
            flex: "1 1 auto",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <ExpandedPanel />
        </div>
      )}
    </div>
  );
}

function ExpandedPanel() {
  const { timelineMode, setTimelineMode } = useTimelineMode();
  const { preset, selectPreset, PRESET_ORDER } = useOverviewCamera();

  return (
    <div
      style={{
        flex: "1 1 auto",
        overflow: "hidden",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {timelineMode === "dive" ? (
        <DiveCanvas />
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "4px 12px",
              flexShrink: 0,
            }}
          >
            <OverviewControls
              current={preset}
              presets={PRESET_ORDER}
              onSelect={selectPreset}
              onCollapse={() => setTimelineMode("collapsed")}
            />
          </div>
          <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
            {preset === "exploded" ? (
              <ExplodedView />
            ) : (
              <TimelineOverview3D cameraPreset={preset} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

