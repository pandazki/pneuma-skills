import { useRef, useCallback } from "react";
import { useClipCraftState, useClipCraftDispatch } from "../store/ClipCraftContext.js";
import { selectSortedScenes, selectTotalDuration } from "../store/selectors.js";
import { useTimelineZoom } from "./hooks/useTimelineZoom.js";
import { TrackLabel, LABEL_W } from "./TrackLabel.js";
import { TimeRuler } from "./TimeRuler.js";
import { Playhead } from "./Playhead.js";
import { CaptionTrack } from "./CaptionTrack.js";
import { VideoTrack } from "./VideoTrack.js";
import { AudioTrack } from "./AudioTrack.js";
import { BgmTrack } from "./BgmTrack.js";

// Track heights
const RULER_H = 24;
const CAPTION_H = 32;
const VIDEO_H = 48;
const AUDIO_H = 32;
const BGM_H = 32;
const GAP = 2;

export function Timeline({ leadingControl, compact }: { leadingControl?: React.ReactNode; compact?: boolean }) {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const scenes = selectSortedScenes(state);
  const totalDuration = selectTotalDuration(state);
  const { selectedSceneId, playback, storyboard } = state;
  const bgm = storyboard.bgm;

  const containerRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(totalDuration, 1);

  const zoom = useTimelineZoom(dur, containerRef);

  const handleSeek = useCallback(
    (time: number) => {
      dispatch({ type: "SEEK", globalTime: time });

      // Also select the scene at this time (without triggering infinite loops —
      // we do it here in the event handler, not in a useEffect)
      let cumulative = 0;
      for (const scene of scenes) {
        if (time < cumulative + scene.duration) {
          if (scene.id !== selectedSceneId) {
            dispatch({ type: "SELECT_SCENE", sceneId: scene.id });
          }
          break;
        }
        cumulative += scene.duration;
      }
    },
    [dispatch, scenes, selectedSceneId],
  );

  if (scenes.length === 0 && !bgm) return null;

  // Calculate total track area height for the playhead line
  const trackAreaHeight = compact
    ? RULER_H + VIDEO_H + GAP
    : RULER_H + CAPTION_H + VIDEO_H + AUDIO_H + (bgm ? BGM_H + GAP : 0) + GAP * 3;

  return (
    <div
      style={{
        padding: "4px 0 8px",
        fontSize: 11,
        color: "#a1a1aa",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Zoom controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px 4px",
          fontSize: 10,
          color: "#52525b",
        }}
      >
        {leadingControl}
        <button onClick={zoom.zoomOut} style={zoomBtnStyle} title="Zoom out">−</button>
        <span style={{ minWidth: 48, textAlign: "center" }}>
          {Math.round(zoom.pixelsPerSecond)}px/s
        </span>
        <button onClick={zoom.zoomIn} style={zoomBtnStyle} title="Zoom in">+</button>
        <span style={{ marginLeft: "auto", fontSize: 9, color: "#3f3f46" }}>
          scroll / ⌘+scroll to zoom
        </span>
      </div>

      {/* Timeline content */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "0 12px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Ruler row */}
        <div style={{ display: "flex", marginBottom: GAP }}>
          <TrackLabel>{""}</TrackLabel>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <TimeRuler
              duration={dur}
              pixelsPerSecond={zoom.pixelsPerSecond}
              scrollLeft={zoom.scrollLeft}
              width={zoom.viewportWidth - LABEL_W}
            />
          </div>
        </div>

        {/* Track rows + playhead overlay */}
        <div style={{ flex: 1, position: "relative" }}>
          {/* Track rows */}
          <div>
            {/* Caption — hidden in compact mode */}
            {!compact && (
              <div style={{ display: "flex", marginBottom: GAP }}>
                <TrackLabel>Tt</TrackLabel>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <CaptionTrack
                    scenes={scenes}
                    totalDuration={dur}
                    selectedSceneId={selectedSceneId}
                    pixelsPerSecond={zoom.pixelsPerSecond}
                    scrollLeft={zoom.scrollLeft}
                  />
                </div>
              </div>
            )}

            {/* Video — always visible */}
            <div style={{ display: "flex", marginBottom: compact ? 0 : GAP }}>
              <TrackLabel>{"\uD83C\uDFAC"}</TrackLabel>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <VideoTrack
                  scenes={scenes}
                  totalDuration={dur}
                  selectedSceneId={selectedSceneId}
                  pixelsPerSecond={zoom.pixelsPerSecond}
                  scrollLeft={zoom.scrollLeft}
                />
              </div>
            </div>

            {/* Audio — hidden in compact mode */}
            {!compact && (
              <div style={{ display: "flex", marginBottom: bgm ? GAP : 0 }}>
                <TrackLabel>{"\uD83D\uDD0A"}</TrackLabel>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <AudioTrack
                    scenes={scenes}
                    totalDuration={dur}
                    selectedSceneId={selectedSceneId}
                    pixelsPerSecond={zoom.pixelsPerSecond}
                    scrollLeft={zoom.scrollLeft}
                  />
                </div>
              </div>
            )}

            {/* BGM — hidden in compact mode */}
            {!compact && bgm && (
              <div style={{ display: "flex" }}>
                <TrackLabel>{"\u266A"}</TrackLabel>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <BgmTrack
                    bgm={bgm}
                    totalDuration={dur}
                    pixelsPerSecond={zoom.pixelsPerSecond}
                    scrollLeft={zoom.scrollLeft}
                    viewportWidth={zoom.viewportWidth - LABEL_W}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Playhead overlay — covers the track area (not labels) */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: LABEL_W,
              right: 0,
              bottom: 0,
            }}
          >
            <Playhead
              globalTime={playback.globalTime}
              duration={dur}
              pixelsPerSecond={zoom.pixelsPerSecond}
              scrollLeft={zoom.scrollLeft}
              trackAreaHeight={trackAreaHeight - RULER_H}
              onSeek={handleSeek}
            />
          </div>

          {/* Selected scene highlight */}
          {selectedSceneId && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: LABEL_W,
                right: 0,
                bottom: 0,
                pointerEvents: "none",
              }}
            >
              {(() => {
                let off = 0;
                for (const s of scenes) {
                  if (s.id === selectedSceneId) {
                    const x = off * zoom.pixelsPerSecond - zoom.scrollLeft;
                    const w = s.duration * zoom.pixelsPerSecond;
                    return (
                      <div
                        style={{
                          position: "absolute",
                          left: x,
                          width: w,
                          top: 0,
                          bottom: 0,
                          background: "rgba(249, 115, 22, 0.04)",
                          borderLeft: "1px solid rgba(249, 115, 22, 0.12)",
                          borderRight: "1px solid rgba(249, 115, 22, 0.12)",
                        }}
                      />
                    );
                  }
                  off += s.duration;
                }
                return null;
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #3f3f46",
  borderRadius: 3,
  color: "#a1a1aa",
  width: 22,
  height: 22,
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
