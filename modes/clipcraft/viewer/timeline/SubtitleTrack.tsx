// Ported from modes/clipcraft-legacy/viewer/timeline/CaptionTrack.tsx.
// Visual language verbatim; data source swapped from `scenes[].caption` to
// craft `Track.clips[].text`. No asset gate — subtitles are text-only and
// don't require an Asset.
// Plan 5.5: drag + resize interactivity.

import type { Track, Clip } from "@pneuma-craft/timeline";
import { useDispatch } from "@pneuma-craft/react";
import { useTrackDragEngine } from "./hooks/useTrackDragEngine.js";
import { useClipResize } from "./hooks/useClipResize.js";
import { useClipProvenance } from "./hooks/useClipProvenance.js";
import { useEditorTool } from "./hooks/useEditorTool.js";
import { useClipToolAction } from "./hooks/useClipToolAction.js";
import { ClipToolOverlay } from "./ClipToolOverlay.js";

const TRACK_H = 32;

interface SubtitleClipProps {
  clip: Clip;
  x: number;
  w: number;
  sel: boolean;
  dragging: boolean;
  pixelsPerSecond: number;
  onSelect: (clipId: string) => void;
  onDragStart: (clipId: string, mouseX: number) => void;
  onResizeStart: (clipId: string, edge: "left" | "right", mouseX: number) => void;
}

function SubtitleClip({
  clip,
  x,
  w,
  sel,
  dragging,
  pixelsPerSecond,
  onSelect,
  onDragStart,
  onResizeStart,
}: SubtitleClipProps) {
  const { summary } = useClipProvenance(clip);
  const tool = useEditorTool();
  const runToolAction = useClipToolAction();
  const inToolMode = tool.activeTool !== null;
  const isToolHovered = inToolMode && tool.hoveredClipId === clip.id;

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
        width: Math.round(w - 1),
        height: TRACK_H - 4,
        top: 2,
        background: sel ? "#2d2519" : "#1a1a1e",
        borderRadius: 3,
        border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        overflow: tool.activeTool === "duplicate" && isToolHovered ? "visible" : "hidden",
        padding: "2px 6px",
        fontSize: 9,
        lineHeight: `${TRACK_H - 8}px`,
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        color: clip.text ? (sel ? "#e4e4e7" : "#a1a1aa") : "#3f3f46",
        boxSizing: "border-box",
        cursor: dragging ? "grabbing" : "grab",
        opacity: dragging ? 0.85 : 1,
      }}
    >
      {clip.text ?? ""}
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
          background: sel ? "rgba(249,115,22,0.3)" : "transparent",
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
          background: sel ? "rgba(249,115,22,0.3)" : "transparent",
        }}
      />

      {isToolHovered && tool.activeTool && (
        <ClipToolOverlay
          tool={tool.activeTool}
          clipWidth={Math.round(w - 1)}
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

export function SubtitleTrack({
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
      {track.clips.map((clip: Clip) => {
        const previewStart =
          resize.displayStartFor(clip.id) ??
          drag.displayStartFor(clip.id) ??
          clip.startTime;
        const previewDuration = resize.displayDurationFor(clip.id) ?? clip.duration;
        const x = previewStart * pixelsPerSecond - scrollLeft;
        const w = previewDuration * pixelsPerSecond;
        const sel = clip.id === selectedClipId;
        const dragging = drag.dragState?.clipId === clip.id;
        if (x + w < -10 || x > 4000) return null;
        return (
          <SubtitleClip
            key={clip.id}
            clip={clip}
            x={x}
            w={w}
            sel={sel}
            dragging={dragging}
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
