// Ported from modes/clipcraft-legacy/viewer/timeline/VideoTrack.tsx.
// Plan 5.5: drag + resize interactivity via useTrackDragEngine + useClipResize.

import { useMemo } from "react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import {
  useAsset,
  useDispatch,
  usePlayback,
  usePneumaCraftStore,
} from "@pneuma-craft/react";
import { useFrameExtractor } from "./hooks/useFrameExtractor.js";
import { useTrackDragEngine } from "./hooks/useTrackDragEngine.js";
import { useClipResize } from "./hooks/useClipResize.js";
import { useClipProvenance } from "./hooks/useClipProvenance.js";
import { useEditorTool } from "./hooks/useEditorTool.js";
import { useClipToolAction } from "./hooks/useClipToolAction.js";
import { useSplitHoverSnap } from "./hooks/useSplitHoverSnap.js";
import { ClipToolOverlay } from "./ClipToolOverlay.js";

const TRACK_H = 48;
const FRAME_H = TRACK_H - 8;

function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

interface VideoClipProps {
  clip: Clip;
  x: number;
  width: number;
  selected: boolean;
  dragging: boolean;
  pixelsPerSecond: number;
  /** When the clip is being resized (left edge), the filmstrip must
   *  shift left by the delta so it still shows the ORIGINAL content
   *  range cropped by the wrapper's overflow:hidden — no stretching. */
  filmstripOffsetPx: number;
  /** True while the user is actively dragging a resize handle. Kept
   *  so the clip can relax overflow for filmstrip peek-through. */
  isResizing: boolean;
  onSelect: (clipId: string) => void;
  onDragStart: (clipId: string, mouseX: number) => void;
  onResizeStart: (clipId: string, edge: "left" | "right", mouseX: number) => void;
}

function VideoClip({
  clip,
  x,
  width,
  selected,
  dragging,
  pixelsPerSecond,
  filmstripOffsetPx,
  isResizing,
  onSelect,
  onDragStart,
  onResizeStart,
}: VideoClipProps) {
  const asset = useAsset(clip.assetId);
  const { summary } = useClipProvenance(clip);
  const tool = useEditorTool();
  const runToolAction = useClipToolAction();
  const snapSplitHover = useSplitHoverSnap();
  const playback = usePlayback();
  const status = asset?.status ?? "ready";
  const uri = asset?.uri ?? "";
  const isVideo = asset?.type === "video";
  const isImage = asset?.type === "image";

  const inToolMode = tool.activeTool !== null;
  const isToolHovered = inToolMode && tool.hoveredClipId === clip.id;

  const frameInterval =
    pixelsPerSecond >= 60 ? 0.5 : pixelsPerSecond >= 30 ? 1 : 2;
  const frameOpts = useMemo(() => {
    if (status !== "ready" || !uri || !isVideo) return null;
    return {
      videoUrl: contentUrl(uri),
      duration: clip.duration,
      frameInterval,
      frameHeight: FRAME_H,
    };
  }, [status, uri, isVideo, frameInterval, clip.duration]);

  const { frames, loading } = useFrameExtractor(frameOpts);

  // Each frame represents `frameInterval` seconds of video at the
  // current zoom. Width per frame is CONSTANT regardless of clip
  // duration — the filmstrip's total width is `frames.length * frameW`,
  // so trims that don't re-extract (and cache hits with older frame
  // counts) never squish individual frames. The wrapper's overflow
  // clips anything that exceeds the preview width.
  const frameW = frameInterval * pixelsPerSecond;
  const filmstripBaseWidth = frames.length > 0
    ? frames.length * frameW
    : Math.max(0, clip.duration * pixelsPerSecond - 2);

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
        const rawX = e.clientX - rect.left;
        if (tool.activeTool === "split" && pixelsPerSecond > 0) {
          const snappedX = snapSplitHover(clip, rawX, pixelsPerSecond);
          tool.setHover(clip.id, snappedX);
          tool.beginScrubIfNeeded(playback.currentTime);
          playback.seek(clip.startTime + snappedX / pixelsPerSecond);
        } else {
          tool.setHover(clip.id, rawX);
        }
      }}
      onMouseMove={(e) => {
        if (!inToolMode) return;
        if (tool.activeTool !== "split") return;
        const rect = e.currentTarget.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        if (pixelsPerSecond > 0) {
          const snappedX = snapSplitHover(clip, rawX, pixelsPerSecond);
          tool.setHover(clip.id, snappedX);
          tool.beginScrubIfNeeded(playback.currentTime);
          playback.seek(clip.startTime + snappedX / pixelsPerSecond);
        } else {
          tool.setHover(clip.id, rawX);
        }
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
        background: selected ? "#1e1a14" : "#18181b",
        borderRadius: 3,
        border: selected ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        // overflow:visible so the duplicate-tool ghost can extend beyond the clip
        overflow:
          (tool.activeTool === "duplicate" && isToolHovered) || isResizing
            ? "visible"
            : "hidden",
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        cursor: dragging ? "grabbing" : "grab",
        opacity: dragging ? 0.85 : 1,
      }}
    >
      {frames.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: filmstripOffsetPx,
            top: 2,
            height: FRAME_H,
            width: filmstripBaseWidth,
            display: "flex",
            pointerEvents: "none",
          }}
        >
          {frames.map((f, i) => (
            <img
              key={i}
              src={f.dataUrl}
              alt=""
              style={{
                height: FRAME_H,
                width: frameW,
                objectFit: "cover",
                flexShrink: 0,
                pointerEvents: "none",
              }}
            />
          ))}
        </div>
      )}
      {isImage && status === "ready" && uri && frames.length === 0 && (
        <div
          style={{
            position: "absolute",
            left: filmstripOffsetPx,
            top: 2,
            height: FRAME_H,
            width: filmstripBaseWidth,
            display: "flex",
            pointerEvents: "none",
          }}
        >
          <ImageFill src={contentUrl(uri)} width={filmstripBaseWidth} height={FRAME_H} />
        </div>
      )}
      {loading && frames.length === 0 && (
        <div style={{ padding: "0 4px", fontSize: 9, color: "#a1a1aa" }}>Loading...</div>
      )}
      {status === "generating" && (
        <span style={{ fontSize: 9, color: "#a16207", padding: "0 4px", whiteSpace: "nowrap" }}>
          {"\u23F3"} generating
        </span>
      )}
      {status === "failed" && (
        <span style={{ fontSize: 9, color: "#ef4444", padding: "0 4px", whiteSpace: "nowrap" }}>
          {"\u26A0"} error
        </span>
      )}
      {status === "pending" && (
        <span style={{ fontSize: 9, color: "#3f3f46", padding: "0 4px" }}>&mdash;</span>
      )}

      {/* Resize handles — subtle, only grab area, no visible fill until hover */}
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

function ImageFill({ src, width, height }: { src: string; width: number; height: number }) {
  const count = Math.max(1, Math.ceil(width / (height * 1.5)));
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <img
          key={i}
          src={src}
          alt=""
          style={{
            height,
            width: height * 1.5,
            objectFit: "cover",
            flexShrink: 0,
            opacity: i > 0 ? 0.7 : 1,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

interface Props {
  track: Track;
  selectedClipId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
  onSelect: (clipId: string) => void;
}

export function VideoTrack({
  track,
  selectedClipId,
  pixelsPerSecond,
  scrollLeft,
  onSelect,
}: Props) {
  const dispatch = useDispatch();
  const drag = useTrackDragEngine(track, pixelsPerSecond, dispatch);
  const resize = useClipResize(track, pixelsPerSecond, dispatch);
  const registry = usePneumaCraftStore((s) => s.coreState.registry);

  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {track.clips.map((clip) => {
        const previewStart = drag.displayStartFor(clip.id) ?? clip.startTime;
        const previewDuration = resize.displayDurationFor(clip.id) ?? clip.duration;
        const previewStartWithResize =
          resize.displayStartFor(clip.id) ?? previewStart;
        const x = previewStartWithResize * pixelsPerSecond - scrollLeft;
        const w = previewDuration * pixelsPerSecond;
        // During a left-edge trim, the clip's display startTime moves
        // right but the filmstrip should keep showing the ORIGINAL
        // asset content — not stretch to fill the shrinking wrapper.
        // Offset = (original - preview) * pps → negative when the
        // user is trimming from the start, so the filmstrip hangs
        // off the left edge and gets cropped by overflow: hidden.
        const filmstripOffset =
          (clip.startTime - previewStartWithResize) * pixelsPerSecond;
        const isResizing =
          resize.displayStartFor(clip.id) !== null ||
          resize.displayDurationFor(clip.id) !== null;
        if (x + w < -10 || x > 4000) return null;
        return (
          <VideoClip
            key={clip.id}
            clip={clip}
            x={x}
            width={w}
            selected={clip.id === selectedClipId}
            dragging={drag.dragState?.clipId === clip.id}
            pixelsPerSecond={pixelsPerSecond}
            filmstripOffsetPx={filmstripOffset}
            isResizing={isResizing}
            onSelect={onSelect}
            onDragStart={drag.handleDragStart}
            onResizeStart={resize.handleResizeStart}
          />
        );
      })}
      {/* Asset-full ghost outlines during resize — rendered at the
          track content level (not inside the clip wrapper) so they
          stay anchored to timeline-absolute coords even as the
          wrapper shifts during a left-edge drag. */}
      {track.clips.map((clip) => {
        const isResizing =
          resize.displayStartFor(clip.id) !== null ||
          resize.displayDurationFor(clip.id) !== null;
        if (!isResizing) return null;
        const asset = registry.get(clip.assetId);
        const assetDuration = (asset?.metadata as { duration?: number } | undefined)
          ?.duration;
        if (!assetDuration || assetDuration <= 0) return null;
        // Timeline-absolute: the asset's virtual t=0 lives at
        // clip.startTime - clip.inPoint seconds. The ghost spans
        // from there for assetDuration seconds.
        const ghostX =
          (clip.startTime - clip.inPoint) * pixelsPerSecond - scrollLeft;
        const ghostW = assetDuration * pixelsPerSecond;
        return (
          <div
            key={`ghost-${clip.id}`}
            style={{
              position: "absolute",
              left: Math.round(ghostX),
              top: 2,
              width: Math.round(ghostW),
              height: FRAME_H,
              border: "1px dashed rgba(249,115,22,0.5)",
              borderRadius: 3,
              background: "rgba(249,115,22,0.04)",
              pointerEvents: "none",
            }}
          />
        );
      })}
      {/* Snap guide — drag or resize */}
      {(drag.dragState?.snapTime ?? resize.resizeSnapTime) != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left:
              ((drag.dragState?.snapTime ?? resize.resizeSnapTime) as number) *
                pixelsPerSecond -
              scrollLeft,
            width: 1,
            background: "#f97316",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
