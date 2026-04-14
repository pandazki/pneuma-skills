// Ported from modes/clipcraft-legacy/viewer/timeline/Timeline.tsx.
//
// Visual/layout/interaction language is verbatim: compact zoom header with
// hint text, 0 12px padding, GAP=2 between rows, 24px ruler, one-track-per-type
// layout, absolutely-positioned Playhead overlay, subtle selection highlight.
//
// Swaps (legacy → craft):
//   useClipCraftState / useClipCraftDispatch / selectSortedScenes  →  useComposition, usePlayback, useDispatch, useSelection
//   state.selectedSceneId                                         →  useSelection() → first clip id (selection.type === "clip")
//   state.playback.globalTime                                     →  usePlayback().currentTime
//   dispatch({type: "SEEK", globalTime})                          →  usePlayback().seek(t)
//   dispatch({type: "SELECT_SCENE", sceneId})                     →  dispatch("human", { type: "selection:set", selection: { type: "clip", ids: [clipId] }})
//   scenes[].caption / scenes[].audio / scenes[].visual           →  composition.tracks (one per type); each track component reads clip.text / useAsset(clip.assetId)
//   selectTotalDuration                                           →  composition.duration (or usePlayback().duration fallback)
//
// No BGM track: legacy's BGM was a sibling of the scene array; craft represents
// BGM as just another audio track, so the existing AudioTrack covers it.
// Compact-mode and leadingControl props from legacy are dropped — clipcraft
// never used them.

import { useCallback, useRef } from "react";
import {
  useComposition,
  usePlayback,
  useDispatch,
  useSelection,
} from "@pneuma-craft/react";
import type { Actor } from "@pneuma-craft/core";
import type { Track } from "@pneuma-craft/timeline";
import { useTimelineShortcuts } from "./hooks/useTimelineShortcuts.js";
import { TransportBar } from "./transport/TransportBar.js";
import { TimelineMinimap } from "./TimelineMinimap.js";
import { useTimelineZoom } from "./hooks/useTimelineZoom.js";
import { useEditorTool } from "./hooks/useEditorTool.js";
import { useTrackReorder } from "./hooks/useTrackReorder.js";
import { EditToolbar } from "./toolbar/EditToolbar.js";
import { AddTrackButton } from "./toolbar/AddTrackButton.js";
import { TrackLabel, LABEL_W } from "./TrackLabel.js";
import { TimeRuler } from "./TimeRuler.js";
import { Playhead } from "./Playhead.js";
import { VideoTrack } from "./VideoTrack.js";
import { AudioTrack } from "./AudioTrack.js";
import { SubtitleTrack } from "./SubtitleTrack.js";
import { theme } from "../theme/tokens.js";

// Track heights — match legacy
const RULER_H = 24;
const VIDEO_H = 48;
const AUDIO_H = 32;
const SUBTITLE_H = 32;
const GAP = 2;

const USER_ACTOR: Actor = "human";

function trackHeight(type: Track["type"]): number {
  switch (type) {
    case "video":
      return VIDEO_H;
    case "audio":
      return AUDIO_H;
    case "subtitle":
      return SUBTITLE_H;
  }
}


export function Timeline() {
  useTimelineShortcuts();
  const composition = useComposition();
  const playback = usePlayback();
  const dispatch = useDispatch();
  const selection = useSelection();
  const tool = useEditorTool();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(
    composition?.duration ?? 0,
    playback.duration ?? 0,
    1,
  );

  const zoom = useTimelineZoom(dur, containerRef);
  const reorder = useTrackReorder(composition);

  const handleSeek = useCallback(
    (time: number) => {
      playback.seek(Math.max(0, Math.min(time, dur)));
    },
    [playback, dur],
  );

  const onSelectClip = useCallback(
    (clipId: string) => {
      dispatch(USER_ACTOR, {
        type: "selection:set",
        selection: { type: "clip", ids: [clipId] },
      });
    },
    [dispatch],
  );

  const handleRulerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const xInTrack = e.clientX - rect.left;
      handleSeek(zoom.xToTime(xInTrack));
    },
    [handleSeek, zoom],
  );

  if (!composition || composition.tracks.length === 0) {
    return (
      <div
        data-testid="timeline-empty"
        style={{
          padding: `${theme.space.space2}px ${theme.space.space4}px`,
          fontFamily: theme.font.ui,
          fontSize: theme.text.sm,
          color: theme.color.ink4,
          letterSpacing: theme.text.trackingWide,
        }}
      >
        No composition loaded
      </div>
    );
  }

  // Calculate total track area height for the playhead line
  const trackAreaHeight = composition.tracks.reduce(
    (h, t, i) => h + trackHeight(t.type) + (i > 0 ? GAP : 0),
    0,
  );

  return (
    <div
      style={{
        padding: 0,
        fontFamily: theme.font.ui,
        fontSize: theme.text.sm,
        color: theme.color.ink2,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <TransportBar />

      {/* Zoom controls + edit toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.space.space2,
          padding: `${theme.space.space1}px ${theme.space.space4}px`,
          fontSize: theme.text.xs,
          color: theme.color.ink4,
          borderBottom: `1px solid ${theme.color.borderWeak}`,
        }}
      >
        <button
          type="button"
          onClick={zoom.zoomOut}
          style={zoomBtnStyle}
          title="Zoom out"
          aria-label="zoom out"
        >
          −
        </button>
        <span
          style={{
            minWidth: 56,
            textAlign: "center",
            fontFamily: theme.font.numeric,
            fontVariantNumeric: "tabular-nums",
            color: theme.color.ink3,
          }}
        >
          {Math.round(zoom.pixelsPerSecond)} px/s
        </span>
        <button
          type="button"
          onClick={zoom.zoomIn}
          style={zoomBtnStyle}
          title="Zoom in"
          aria-label="zoom in"
        >
          +
        </button>
        <span
          style={{
            fontSize: theme.text.xs,
            color: theme.color.ink5,
            letterSpacing: theme.text.trackingWide,
          }}
        >
          scroll / ⌘+scroll to zoom
        </span>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: theme.space.space2,
          }}
        >
          <EditToolbar />
          <div
            style={{
              width: 1,
              height: 16,
              background: theme.color.borderWeak,
              flexShrink: 0,
            }}
          />
          <AddTrackButton />
        </div>
      </div>

      {/* Timeline content */}
      <div
        ref={containerRef}
        onMouseLeave={() => {
          // Hover-scrub restore: when the cursor leaves the timeline area
          // entirely (not just one clip), seek back to the playhead position
          // we captured before the user started scrubbing in split mode.
          if (tool.activeTool !== "split") return;
          const baseline = tool.restoreScrubBaseline();
          if (baseline !== null) playback.seek(baseline);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "4px 12px 8px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Ruler row */}
        <div style={{ display: "flex", marginBottom: GAP }}>
          <TrackLabel track={null} />
          <div
            onClick={handleRulerClick}
            style={{ flex: 1, minWidth: 0, overflow: "hidden", cursor: "pointer" }}
          >
            <TimeRuler
              duration={dur}
              pixelsPerSecond={zoom.pixelsPerSecond}
              scrollLeft={zoom.scrollLeft}
              viewportWidth={zoom.viewportWidth - LABEL_W}
            />
          </div>
        </div>

        {/* Track rows + playhead overlay */}
        <div style={{ position: "relative" }}>
          {/* Track rows */}
          <div>
            {composition.tracks.map((track, i) => {
              const isLast = i === composition.tracks.length - 1;
              const rowHandlers = reorder.rowHandlers(track);
              const isDragSource = reorder.state.draggedRowId === track.id;
              const showInsertAbove =
                reorder.state.hovering &&
                reorder.state.targetRowId === track.id &&
                reorder.state.position === "above" &&
                !isDragSource;
              const showInsertBelow =
                reorder.state.hovering &&
                reorder.state.targetRowId === track.id &&
                reorder.state.position === "below" &&
                !isDragSource;
              return (
                <div
                  key={track.id}
                  onDragEnter={rowHandlers.onDragEnter}
                  onDragOver={rowHandlers.onDragOver}
                  onDragLeave={rowHandlers.onDragLeave}
                  onDrop={rowHandlers.onDrop}
                  style={{
                    display: "flex",
                    marginBottom: isLast ? 0 : GAP,
                    position: "relative",
                    opacity: isDragSource ? 0.4 : 1,
                    transition: `opacity ${theme.duration.quick}ms ${theme.easing.out}`,
                  }}
                >
                  {showInsertAbove && <InsertionLine position="top" />}
                  {showInsertBelow && <InsertionLine position="bottom" />}
                  <TrackLabel track={track} onReorderDragStart={reorder.onDragStart} />
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    {track.type === "video" && (
                      <VideoTrack
                        track={track}
                        selectedClipId={selectedClipId}
                        pixelsPerSecond={zoom.pixelsPerSecond}
                        scrollLeft={zoom.scrollLeft}
                        onSelect={onSelectClip}
                      />
                    )}
                    {track.type === "audio" && (
                      <AudioTrack
                        track={track}
                        selectedClipId={selectedClipId}
                        pixelsPerSecond={zoom.pixelsPerSecond}
                        scrollLeft={zoom.scrollLeft}
                        onSelect={onSelectClip}
                      />
                    )}
                    {track.type === "subtitle" && (
                      <SubtitleTrack
                        track={track}
                        selectedClipId={selectedClipId}
                        pixelsPerSecond={zoom.pixelsPerSecond}
                        scrollLeft={zoom.scrollLeft}
                        onSelect={onSelectClip}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Playhead overlay — covers the track area (not labels).
              pointer-events: none so clip clicks fall through to the track
              rows; the Playhead line/handle opt back in with auto. */}
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
            <Playhead
              globalTime={tool.getDisplayTime(playback.currentTime)}
              duration={dur}
              pixelsPerSecond={zoom.pixelsPerSecond}
              scrollLeft={zoom.scrollLeft}
              trackAreaHeight={trackAreaHeight}
              onSeek={handleSeek}
            />
          </div>
        </div>

        {/* Minimap / scrollbar — aligned with the content area (after LABEL_W) */}
        <div style={{ display: "flex", marginTop: 4 }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <TimelineMinimap zoom={zoom} duration={dur} currentTime={tool.getDisplayTime(playback.currentTime)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function InsertionLine({ position }: { position: "top" | "bottom" }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        height: 2,
        background: theme.color.accentBright,
        top: position === "top" ? -1 : undefined,
        bottom: position === "bottom" ? -1 : undefined,
        zIndex: 20,
        pointerEvents: "none",
      }}
    />
  );
}

const zoomBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.sm,
  color: theme.color.ink2,
  width: 22,
  height: 22,
  cursor: "pointer",
  fontFamily: theme.font.ui,
  fontSize: theme.text.lg,
  fontWeight: theme.text.weightMedium,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  transition: `color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
};
