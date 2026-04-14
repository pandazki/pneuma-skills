// Ported from modes/clipcraft-legacy/viewer/timeline/AudioTrack.tsx.
// Plan 5.5: drag + resize interactivity.

import { useMemo } from "react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import { useAsset, useDispatch } from "@pneuma-craft/react";
import { WaveformBars } from "./WaveformBars.js";
import { useWaveform } from "./hooks/useWaveform.js";
import { useTrackDragEngine } from "./hooks/useTrackDragEngine.js";
import { useClipResize } from "./hooks/useClipResize.js";
import { useClipProvenance } from "./hooks/useClipProvenance.js";
import { useEditorTool } from "./hooks/useEditorTool.js";
import { useClipToolAction } from "./hooks/useClipToolAction.js";
import { ClipToolOverlay } from "./ClipToolOverlay.js";

const TRACK_H = 32;
const BAR_H = TRACK_H - 12;

function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

interface AudioClipProps {
  clip: Clip;
  x: number;
  width: number;
  selected: boolean;
  dragging: boolean;
  pixelsPerSecond: number;
  onSelect: (clipId: string) => void;
  onDragStart: (clipId: string, mouseX: number) => void;
  onResizeStart: (clipId: string, edge: "left" | "right", mouseX: number) => void;
}

function AudioClip({
  clip,
  x,
  width,
  selected,
  dragging,
  pixelsPerSecond,
  onSelect,
  onDragStart,
  onResizeStart,
}: AudioClipProps) {
  const asset = useAsset(clip.assetId);
  const { summary } = useClipProvenance(clip);
  const tool = useEditorTool();
  const runToolAction = useClipToolAction();
  const inToolMode = tool.activeTool !== null;
  const isToolHovered = inToolMode && tool.hoveredClipId === clip.id;
  const status = asset?.status ?? "ready";
  const uri = asset?.uri ?? "";
  const hasAudio = status === "ready" && !!uri && asset?.type === "audio";

  const waveOpts = useMemo(() => {
    if (!hasAudio) return null;
    return {
      audioUrl: contentUrl(uri),
      bars: Math.max(8, Math.round(width / 4)),
      maxDuration: clip.duration,
    };
  }, [hasAudio, uri, width, clip.duration]);

  const { waveform } = useWaveform(waveOpts);

  return (
    <div
      title={summary || clip.id.slice(0, 8)}
      onMouseDown={(e) => {
        if (e.button !== 0 || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        if (inToolMode) {
          const rect = e.currentTarget.getBoundingClientRect();
          runToolAction(clip, e.clientX - rect.left, pixelsPerSecond);
          return;
        }
        onSelect(clip.id);
        onDragStart(clip.id, e.clientX);
      }}
      onMouseEnter={(e) => {
        if (!inToolMode) return;
        const rect = e.currentTarget.getBoundingClientRect();
        tool.setHover(clip.id, e.clientX - rect.left);
      }}
      onMouseMove={(e) => {
        if (!inToolMode || tool.activeTool !== "split") return;
        const rect = e.currentTarget.getBoundingClientRect();
        tool.setHover(clip.id, e.clientX - rect.left);
      }}
      onMouseLeave={() => {
        if (!inToolMode) return;
        tool.setHover(null, null);
      }}
      style={{
        position: "absolute",
        left: Math.round(x),
        width: Math.round(width - 1),
        height: TRACK_H - 4,
        top: 2,
        background: selected ? "#1a1e2a" : "#18181b",
        borderRadius: 3,
        border: selected ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        overflow: tool.activeTool === "duplicate" && isToolHovered ? "visible" : "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        cursor: dragging ? "grabbing" : "grab",
        opacity: dragging ? 0.85 : 1,
      }}
    >
      {waveform ? (
        <WaveformBars peaks={waveform.peaks} height={BAR_H} color={selected ? "#38bdf8" : "#1e3a5f"} />
      ) : hasAudio ? (
        <div style={{ fontSize: 9, color: "#38bdf8", opacity: 0.5 }}>loading...</div>
      ) : null}
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(clip.id, "left", e.clientX);
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          background: selected ? "rgba(249,115,22,0.3)" : "transparent",
        }}
      />
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(clip.id, "right", e.clientX);
        }}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          background: selected ? "rgba(249,115,22,0.3)" : "transparent",
        }}
      />

      {isToolHovered && tool.activeTool && (
        <ClipToolOverlay
          tool={tool.activeTool}
          clipWidth={Math.round(width - 1)}
          clipHeight={TRACK_H - 4}
          hoverPx={tool.hoverPxFromClipStart}
        />
      )}
    </div>
  );
}

interface Props {
  track: Track;
  selectedClipId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
  onSelect: (clipId: string) => void;
}

export function AudioTrack({
  track,
  selectedClipId,
  pixelsPerSecond,
  scrollLeft,
  onSelect,
}: Props) {
  const dispatch = useDispatch();
  const drag = useTrackDragEngine(track, pixelsPerSecond, dispatch);
  const resize = useClipResize(track, pixelsPerSecond, dispatch);

  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {track.clips.map((clip) => {
        const previewStart =
          resize.displayStartFor(clip.id) ??
          drag.displayStartFor(clip.id) ??
          clip.startTime;
        const previewDuration = resize.displayDurationFor(clip.id) ?? clip.duration;
        const x = previewStart * pixelsPerSecond - scrollLeft;
        const w = previewDuration * pixelsPerSecond;
        if (x + w < -10 || x > 4000) return null;
        return (
          <AudioClip
            key={clip.id}
            clip={clip}
            x={x}
            width={w}
            selected={clip.id === selectedClipId}
            dragging={drag.dragState?.clipId === clip.id}
            pixelsPerSecond={pixelsPerSecond}
            onSelect={onSelect}
            onDragStart={drag.handleDragStart}
            onResizeStart={resize.handleResizeStart}
          />
        );
      })}
      {drag.dragState?.snapTime != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: drag.dragState.snapTime * pixelsPerSecond - scrollLeft,
            width: 1,
            background: "#f97316",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
