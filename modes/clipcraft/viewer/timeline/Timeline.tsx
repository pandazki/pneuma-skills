// modes/clipcraft/viewer/timeline/Timeline.tsx
import { useCallback, useRef } from "react";
import { useComposition, usePlayback, useDispatch } from "@pneuma-craft/react";
import type { Actor } from "@pneuma-craft/core";
import { TimeRuler } from "./TimeRuler.js";
import { Playhead } from "./Playhead.js";
import { TrackRow } from "./TrackRow.js";
import { TRACK_LABEL_WIDTH } from "./TrackLabel.js";
import { useTimelineZoom } from "./hooks/useTimelineZoom.js";

const TRACK_HEIGHT = 48;
const RULER_HEIGHT = 20;
// Verified: @pneuma-craft/core Actor = 'human' | 'agent' — plan value matches.
const USER_ACTOR: Actor = "human";

export function Timeline() {
  const composition = useComposition();
  // Verified: usePlayback() returns { currentTime, duration, seek, ... }.
  const { currentTime, duration, seek } = usePlayback();
  // Verified: useDispatch() returns (actor, command) two-arg dispatcher.
  const dispatch = useDispatch();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const effectiveDuration = duration || composition?.duration || 0;
  const {
    pixelsPerSecond,
    scrollLeft,
    totalWidth,
    viewportWidth,
    xToTime,
    zoomIn,
    zoomOut,
  } = useTimelineZoom(effectiveDuration, containerRef);

  const onSelectClip = useCallback(
    (clipId: string) => {
      // Verified: SelectionCommand = { type: 'selection:set'; selection: Selection }
      // with Selection.type including 'clip' and Selection.ids: string[].
      dispatch(USER_ACTOR, {
        type: "selection:set",
        selection: { type: "clip", ids: [clipId] },
      });
    },
    [dispatch],
  );

  const handleRulerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const xInTrack = e.clientX - rect.left;
      const t = xToTime(xInTrack);
      seek(Math.max(0, Math.min(t, effectiveDuration)));
    },
    [xToTime, seek, effectiveDuration],
  );

  if (!composition) {
    return (
      <div
        data-testid="timeline-empty"
        style={{
          padding: 12,
          color: "#71717a",
          fontSize: 12,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        no composition loaded
      </div>
    );
  }

  const trackCount = composition.tracks.length;
  const trackAreaHeight = trackCount * TRACK_HEIGHT;

  return (
    <div
      ref={containerRef}
      className="cc-timeline"
      style={{
        position: "relative",
        background: "#0a0a0a",
        color: "#e4e4e7",
        fontFamily: "system-ui, sans-serif",
        border: "1px solid #27272a",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      {/* zoom toolbar */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "6px 8px",
          borderBottom: "1px solid #27272a",
          fontSize: 11,
        }}
      >
        <button
          type="button"
          onClick={zoomOut}
          aria-label="zoom out"
          style={zoomBtnStyle}
        >−</button>
        <span style={{ minWidth: 80, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {pixelsPerSecond.toFixed(0)} px/s
        </span>
        <button
          type="button"
          onClick={zoomIn}
          aria-label="zoom in"
          style={zoomBtnStyle}
        >+</button>
      </div>

      {/* ruler row */}
      <div
        style={{ display: "flex", height: RULER_HEIGHT, borderBottom: "1px solid #27272a" }}
      >
        <div style={{ width: TRACK_LABEL_WIDTH }} />
        <div
          onClick={handleRulerClick}
          style={{ position: "relative", flex: 1, overflow: "hidden", cursor: "pointer" }}
        >
          <div style={{ position: "absolute", left: -scrollLeft, top: 0, width: totalWidth, height: "100%" }}>
            <TimeRuler
              duration={effectiveDuration}
              pixelsPerSecond={pixelsPerSecond}
              scrollLeft={scrollLeft}
              viewportWidth={viewportWidth}
            />
          </div>
        </div>
      </div>

      {/* track rows */}
      <div style={{ position: "relative", height: trackAreaHeight }}>
        {composition.tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            trackHeight={TRACK_HEIGHT}
            totalWidth={totalWidth}
            onSelectClip={onSelectClip}
          />
        ))}

        {/* playhead overlay spans every track row but NOT the sidebar */}
        <div
          style={{
            position: "absolute",
            left: TRACK_LABEL_WIDTH,
            right: 0,
            top: 0,
            bottom: 0,
            pointerEvents: "none",
          }}
        >
          <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>
            <Playhead
              globalTime={currentTime}
              duration={effectiveDuration}
              pixelsPerSecond={pixelsPerSecond}
              scrollLeft={scrollLeft}
              trackAreaHeight={trackAreaHeight}
              onSeek={seek}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  background: "#27272a",
  color: "#fafafa",
  border: "1px solid #3f3f46",
  borderRadius: 3,
  cursor: "pointer",
};
