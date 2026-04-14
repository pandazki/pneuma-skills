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
import { useTimelineZoom } from "./hooks/useTimelineZoom.js";
import { EditToolbar } from "./toolbar/EditToolbar.js";
import { TrackLabel, LABEL_W } from "./TrackLabel.js";
import { TimeRuler } from "./TimeRuler.js";
import { Playhead } from "./Playhead.js";
import { VideoTrack } from "./VideoTrack.js";
import { AudioTrack } from "./AudioTrack.js";
import { SubtitleTrack } from "./SubtitleTrack.js";

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

function iconFor(type: Track["type"]): string {
  switch (type) {
    case "video":
      return "\uD83C\uDFAC"; // 🎬
    case "audio":
      return "\uD83D\uDD0A"; // 🔊
    case "subtitle":
      return "Tt";
  }
}

export function Timeline() {
  useTimelineShortcuts();
  const composition = useComposition();
  const playback = usePlayback();
  const dispatch = useDispatch();
  const selection = useSelection();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(
    composition?.duration ?? 0,
    playback.duration ?? 0,
    1,
  );

  const zoom = useTimelineZoom(dur, containerRef);

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
          padding: "8px 12px",
          fontSize: 10,
          color: "#52525b",
        }}
      >
        no composition loaded
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
        fontSize: 11,
        color: "#a1a1aa",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <TransportBar />

      {/* Zoom controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 12px",
          fontSize: 10,
          color: "#52525b",
        }}
      >
        <button onClick={zoom.zoomOut} style={zoomBtnStyle} title="Zoom out" aria-label="zoom out">−</button>
        <span style={{ minWidth: 48, textAlign: "center" }}>{Math.round(zoom.pixelsPerSecond)}px/s</span>
        <button onClick={zoom.zoomIn} style={zoomBtnStyle} title="Zoom in" aria-label="zoom in">+</button>
        <span style={{ fontSize: 9, color: "#3f3f46" }}>scroll / ⌘+scroll to zoom</span>
        <div style={{ marginLeft: "auto" }}>
          <EditToolbar />
        </div>
      </div>

      {/* Timeline content */}
      <div
        ref={containerRef}
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
          <TrackLabel>{""}</TrackLabel>
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
              return (
                <div
                  key={track.id}
                  style={{ display: "flex", marginBottom: isLast ? 0 : GAP }}
                >
                  <TrackLabel>{iconFor(track.type)}</TrackLabel>
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
              globalTime={playback.currentTime}
              duration={dur}
              pixelsPerSecond={zoom.pixelsPerSecond}
              scrollLeft={zoom.scrollLeft}
              trackAreaHeight={trackAreaHeight}
              onSeek={handleSeek}
            />
          </div>
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
