// Ported from modes/clipcraft-legacy/viewer/timeline/CaptionTrack.tsx.
// Visual language verbatim; data source swapped from `scenes[].caption` to
// craft `Track.clips[].text`. No asset gate — subtitles are text-only and
// don't require an Asset.
// Plan 5.5: drag + resize interactivity.

import type { Track, Clip } from "@pneuma-craft/timeline";
import { useDispatch } from "@pneuma-craft/react";
import { useTrackDragEngine } from "./hooks/useTrackDragEngine.js";
import { useClipResize } from "./hooks/useClipResize.js";

const TRACK_H = 32;

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
          <div
            key={clip.id}
            onMouseDown={(e) => {
              if (e.button !== 0 || e.altKey) return;
              e.preventDefault();
              e.stopPropagation();
              onSelect(clip.id);
              drag.handleDragStart(clip.id, e.clientX);
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
              overflow: "hidden",
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
                resize.handleResizeStart(clip.id, "left", e.clientX);
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
                resize.handleResizeStart(clip.id, "right", e.clientX);
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
          </div>
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
