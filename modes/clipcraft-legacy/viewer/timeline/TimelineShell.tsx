// modes/clipcraft/viewer/timeline/TimelineShell.tsx
import { useCallback } from "react";
import { useClipCraftState, useClipCraftDispatch } from "../store/ClipCraftContext.js";
import { Timeline } from "./Timeline.js";
import { ExplodedView } from "./exploded/ExplodedView.js";
import { TimelineOverview3D } from "./overview/TimelineOverview3D.js";
import { useOverviewCamera } from "./overview/useOverviewCamera.js";
import { OverviewControls } from "./overview/OverviewControls.js";
import { DiveCanvas } from "./dive/DiveCanvas.js";

export function TimelineShell({ videoRefs }: { videoRefs: React.RefObject<Map<string, HTMLVideoElement>> }) {
  const { timelineMode } = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const isExpanded = timelineMode !== "collapsed";
  const { preset, selectPreset, PRESET_ORDER } = useOverviewCamera();

  const handleToggle = useCallback(() => {
    dispatch({
      type: "SET_TIMELINE_MODE",
      mode: isExpanded ? "collapsed" : "overview",
    });
  }, [isExpanded, dispatch]);

  const handleCollapse = useCallback(() => {
    dispatch({ type: "SET_TIMELINE_MODE", mode: "collapsed" });
  }, [dispatch]);

  return (
    <div style={{
      flex: isExpanded ? "1 1 100%" : "0 0 auto",
      display: "flex",
      flexDirection: "column-reverse",
      background: "#09090b",
      borderTop: "1px solid #27272a",
      overflow: "hidden",
      transition: "flex 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
    }}>
      {/* Timeline — rendered first in DOM, pinned at bottom by column-reverse */}
      <div style={{ flexShrink: 0 }}>
        <Timeline
          compact={isExpanded}
          leadingControl={
            <button
              onClick={handleToggle}
              title={isExpanded ? "Collapse 3D view" : "Expand 3D view"}
              style={{
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
              }}
            >
              {isExpanded ? "↓" : "↑"}
            </button>
          }
        />
      </div>

      {/* Expanded view */}
      {isExpanded && (
        <div style={{
          flex: "1 1 auto",
          overflow: "hidden",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}>
          {timelineMode === "dive" ? (
            // Dive mode — full panel, no overview controls
            <DiveCanvas />
          ) : (
            <>
              {/* Shared controls bar — camera presets + collapse */}
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                padding: "4px 12px",
                flexShrink: 0,
              }}>
                <OverviewControls
                  current={preset}
                  presets={PRESET_ORDER}
                  onSelect={selectPreset}
                  onCollapse={handleCollapse}
                />
              </div>

              {/* Content area */}
              <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
                {preset === "exploded" ? (
                  <ExplodedView videoRefs={videoRefs} />
                ) : (
                  <TimelineOverview3D cameraPreset={preset} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
