// Plan 5.5: drag + resize interactivity.

import { useMemo } from "react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import {
  useAsset,
  useDispatch,
  usePlayback,
  usePneumaCraftStore,
} from "@pneuma-craft/react";
import { WaveformBars } from "./WaveformBars.js";
import { useWaveform } from "./hooks/useWaveform.js";
import { useTrackDragEngine } from "./hooks/useTrackDragEngine.js";
import { useClipResize } from "./hooks/useClipResize.js";
import { useClipProvenance } from "./hooks/useClipProvenance.js";
import { useEditorTool } from "./hooks/useEditorTool.js";
import { useClipToolAction } from "./hooks/useClipToolAction.js";
import { useSplitHoverSnap } from "./hooks/useSplitHoverSnap.js";
import { useTrackDropTarget } from "./hooks/useTrackDropTarget.js";
import { ClipToolOverlay } from "./ClipToolOverlay.js";
import { theme } from "../theme/tokens.js";

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
  waveformOffsetPx: number;
  isResizing: boolean;
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
  waveformOffsetPx,
  isResizing,
  onSelect,
  onDragStart,
  onResizeStart,
}: AudioClipProps) {
  const asset = useAsset(clip.assetId);
  const { summary } = useClipProvenance(clip);
  const tool = useEditorTool();
  const runToolAction = useClipToolAction();
  const snapSplitHover = useSplitHoverSnap();
  const playback = usePlayback();
  const inToolMode = tool.activeTool !== null;
  const isToolHovered = inToolMode && tool.hoveredClipId === clip.id;
  const status = asset?.status ?? "ready";
  const uri = asset?.uri ?? "";
  const hasAudio = status === "ready" && !!uri && asset?.type === "audio";
  const assetDuration =
    (asset?.metadata as { duration?: number } | undefined)?.duration ?? null;

  // Waveform covers the FULL asset duration so left-edge trims
  // reveal the correct peaks for the new inPoint. bars + maxDuration
  // come from the asset, not the clip, to keep the rendered peaks
  // stable across any trim.
  const waveDuration = assetDuration ?? clip.outPoint;
  const baseWidth = Math.max(0, waveDuration * pixelsPerSecond - 2);
  const waveOpts = useMemo(() => {
    if (!hasAudio || waveDuration <= 0) return null;
    return {
      audioUrl: contentUrl(uri),
      bars: Math.max(8, Math.round(baseWidth / 4)),
      maxDuration: waveDuration,
    };
  }, [hasAudio, uri, baseWidth, waveDuration]);

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
        if (!inToolMode || tool.activeTool !== "split") return;
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
        background: selected ? theme.color.surface4 : theme.color.surface2,
        borderRadius: theme.radius.sm,
        border: selected
          ? `1px solid ${theme.color.accentBorder}`
          : `1px solid ${theme.color.borderWeak}`,
        overflow:
          (tool.activeTool === "duplicate" && isToolHovered) || isResizing
            ? "visible"
            : "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        cursor: dragging ? "grabbing" : "grab",
        opacity: dragging ? 0.85 : 1,
      }}
    >
      {waveform ? (
        <div
          style={{
            position: "absolute",
            top: (TRACK_H - BAR_H) / 2 - 2,
            left: waveformOffsetPx,
            width: baseWidth,
            height: BAR_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <WaveformBars
            peaks={waveform.peaks}
            height={BAR_H}
            color={selected ? theme.color.accentBright : theme.color.layerAudio}
          />
        </div>
      ) : hasAudio ? (
        <div
          style={{
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            color: theme.color.layerAudio,
            opacity: 0.6,
            letterSpacing: theme.text.trackingWide,
          }}
        >
          loading…
        </div>
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
          background: selected ? theme.color.accentSoft : "transparent",
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
          background: selected ? theme.color.accentSoft : "transparent",
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
  const drop = useTrackDropTarget(track, pixelsPerSecond, scrollLeft);
  const registry = usePneumaCraftStore((s) => s.coreState.registry);

  return (
    <div
      style={{
        position: "relative",
        height: TRACK_H,
        overflow: "hidden",
        background: drop.state.hovering
          ? drop.state.compatible
            ? theme.color.layerAudioSoft
            : theme.color.dangerSoft
          : "transparent",
        transition: `background ${theme.duration.quick}ms ${theme.easing.out}`,
      }}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    >
      {track.clips.map((clip) => {
        const previewStart =
          resize.displayStartFor(clip.id) ??
          drag.displayStartFor(clip.id) ??
          clip.startTime;
        const previewDuration = resize.displayDurationFor(clip.id) ?? clip.duration;
        const x = previewStart * pixelsPerSecond - scrollLeft;
        const w = previewDuration * pixelsPerSecond;
        // Waveform spans the full asset. Base shift aligns asset t=0
        // with the clip's current inPoint; resize delta (if active)
        // keeps the waveform anchored to its absolute timeline position
        // during a left-edge drag.
        const resizeStart = resize.displayStartFor(clip.id);
        const resizeDelta =
          resizeStart !== null
            ? (clip.startTime - resizeStart) * pixelsPerSecond
            : 0;
        const waveformOffset = -clip.inPoint * pixelsPerSecond + resizeDelta;
        const isResizing =
          resizeStart !== null ||
          resize.displayDurationFor(clip.id) !== null;
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
            waveformOffsetPx={waveformOffset}
            isResizing={isResizing}
            onSelect={onSelect}
            onDragStart={drag.handleDragStart}
            onResizeStart={resize.handleResizeStart}
          />
        );
      })}
      {/* Asset-full ghost outlines — timeline-absolute positioning */}
      {track.clips.map((clip) => {
        const isResizing =
          resize.displayStartFor(clip.id) !== null ||
          resize.displayDurationFor(clip.id) !== null;
        if (!isResizing) return null;
        const asset = registry.get(clip.assetId);
        const assetDuration = (asset?.metadata as { duration?: number } | undefined)
          ?.duration;
        if (!assetDuration || assetDuration <= 0) return null;
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
              height: TRACK_H - 4,
              border: `1px dashed ${theme.color.layerAudio}`,
              borderRadius: theme.radius.sm,
              background: theme.color.layerAudioSoft,
              pointerEvents: "none",
            }}
          />
        );
      })}
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
            background: theme.color.accent,
            pointerEvents: "none",
          }}
        />
      )}
      {drop.state.hovering && drop.state.hoverX != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: drop.state.hoverX,
            width: 2,
            background: drop.state.compatible
              ? theme.color.layerAudio
              : theme.color.danger,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
