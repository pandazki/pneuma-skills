import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Track } from "@pneuma-craft/timeline";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import { useTimelineZoom } from "../timeline/hooks/useTimelineZoom.js";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import {
  groupTracksForViews,
  layerOfTrack,
  type LayerType,
} from "../overview/layerTypes.js";
import { TrackToggle } from "../overview/TrackToggle.js";
import { ExplodedTrack, LAYER_ORDER } from "./ExplodedTrack.js";
import { theme } from "../theme/tokens.js";

export { LAYER_ORDER };

const CAMERA = {
  rotateX: 0,
  rotateY: 0,
  perspective: 1400,
  perspectiveOriginX: 50,
  perspectiveOriginY: 50,
} as const;

// Per-track Z gap. The focused track sits at Z=0; each remaining track
// recedes by |trackDistance| * Z_GAP.
const Z_GAP = 220;

const NON_VIDEO_H = 64;
const CAPTION_H = 56;
const MIN_VIDEO_H = 160;

const EASE = {
  type: "tween" as const,
  duration: 0.38,
  ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
};

const LAYER_HEADER_H = 28;
const LAYER_INNER_PAD_X = 0;

function trackHeightFor(layer: LayerType, videoLayerH: number): number {
  if (layer === "video") return videoLayerH;
  if (layer === "caption") return CAPTION_H;
  return NON_VIDEO_H;
}

export function ExplodedView() {
  const composition = useComposition();
  const playback = usePlayback();
  const {
    setTimelineMode,
    setDiveLayer,
    focusedTrackId: storedFocusId,
    setFocusedTrackId,
  } = useTimelineMode();

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });

  const tracks = composition?.tracks ?? [];
  const totalDuration = Math.max(composition?.duration ?? 0, 1);
  // wheelEnabled:false — the scene-level wheel listener would write to the
  // shared scrollLeft and visibly pan the ruler, defeating the carousel
  // handler on the outer containerRef. We only need `zoom` here to read
  // shared pps/scrollLeft for positioning (playhead, caption strip).
  const zoom = useTimelineZoom(totalDuration, sceneRef, { wheelEnabled: false });

  const groups = useMemo(() => groupTracksForViews(tracks), [tracks]);
  const renderableGroups = useMemo(
    () => groups.filter((g) => g.tracks.length > 0),
    [groups],
  );
  const orderedTracks = useMemo<Track[]>(
    () => renderableGroups.flatMap((g) => g.tracks),
    [renderableGroups],
  );

  const focusedTrackId = useMemo<string | null>(() => {
    if (storedFocusId && orderedTracks.some((t) => t.id === storedFocusId)) {
      return storedFocusId;
    }
    const firstVideo = orderedTracks.find((t) => t.type === "video");
    return firstVideo?.id ?? orderedTracks[0]?.id ?? null;
  }, [storedFocusId, orderedTracks]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Swallow the wheel event unconditionally so it can't bubble up
      // into the flat timeline's ruler (which lives below the 3D view
      // in the same flex container and has its own wheel listener that
      // pans `zoom.scrollLeft`). stopPropagation must happen BEFORE the
      // small-delta early return — tiny trackpad nudges were leaking
      // through and scrolling the ruler.
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY;
      if (Math.abs(delta) < 5) return;
      const currentIdx = orderedTracks.findIndex((t) => t.id === focusedTrackId);
      if (currentIdx < 0) return;
      const nextIdx =
        delta > 0
          ? Math.min(orderedTracks.length - 1, currentIdx + 1)
          : Math.max(0, currentIdx - 1);
      if (nextIdx !== currentIdx) {
        setFocusedTrackId(orderedTracks[nextIdx].id);
      }
    },
    [orderedTracks, focusedTrackId, setFocusedTrackId],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleCollapse = useCallback(() => {
    setTimelineMode("collapsed");
  }, [setTimelineMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCollapse();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCollapse]);

  const handleDive = useCallback(
    (layer: LayerType) => {
      setDiveLayer(layer);
      setTimelineMode("dive");
    },
    [setDiveLayer, setTimelineMode],
  );

  const sceneW = containerSize.width - 88;
  const sceneH = containerSize.height;
  const settings = composition?.settings;
  const arRatio = settings ? settings.width / settings.height : 16 / 9;

  const SCENE_PAD = 32;
  const videoMaxH = Math.max(MIN_VIDEO_H, sceneH * 0.6);
  const maxLayerW = Math.max(200, sceneW - SCENE_PAD * 2);
  const hasVideo = orderedTracks.some((t) => t.type === "video");

  let videoLayerH: number;
  let layerWidth: number;
  if (hasVideo) {
    const idealFrameH = videoMaxH - LAYER_HEADER_H;
    const idealFrameW = idealFrameH * arRatio;
    if (idealFrameW + LAYER_INNER_PAD_X <= maxLayerW) {
      videoLayerH = videoMaxH;
      layerWidth = idealFrameW + LAYER_INNER_PAD_X;
    } else {
      layerWidth = maxLayerW;
      const fittedFrameW = maxLayerW - LAYER_INNER_PAD_X;
      videoLayerH = fittedFrameW / arRatio + LAYER_HEADER_H;
    }
  } else {
    layerWidth = Math.min(maxLayerW, 640);
    videoLayerH = 0;
  }

  // Vertical carousel: the focused track is centered in the scene; other
  // tracks stack above / below it in flat order with STACK_GAP between
  // adjacent card edges.
  const STACK_GAP = 32;

  const focusedIdx = Math.max(
    0,
    orderedTracks.findIndex((t) => t.id === focusedTrackId),
  );

  interface PositionedTrack {
    key: string;
    track: Track;
    layer: LayerType;
    top: number;
    z: number;
    width: number;
    height: number;
    focused: boolean;
    indexInGroup: number;
    groupSize: number;
  }

  // Per-track group metadata: "VIDEO 2" labels still come from the
  // layer grouping, so precompute (indexInGroup, groupSize) per track.
  const groupMeta = new Map<string, { indexInGroup: number; groupSize: number }>();
  for (const g of renderableGroups) {
    g.tracks.forEach((t, idx) => {
      groupMeta.set(t.id, { indexInGroup: idx + 1, groupSize: g.tracks.length });
    });
  }

  const heights = orderedTracks.map((t) => trackHeightFor(layerOfTrack(t), videoLayerH));
  const positioned: PositionedTrack[] = [];

  if (orderedTracks.length > 0) {
    const focusedH = heights[focusedIdx] ?? 0;
    const focusedTop = Math.floor((sceneH - focusedH) / 2);

    const meta = (track: Track) =>
      groupMeta.get(track.id) ?? { indexInGroup: 1, groupSize: 1 };

    const focusedTrack = orderedTracks[focusedIdx];
    const focusedGroupMeta = meta(focusedTrack);
    positioned.push({
      key: focusedTrack.id,
      track: focusedTrack,
      layer: layerOfTrack(focusedTrack),
      top: focusedTop,
      z: 0,
      width: layerWidth,
      height: focusedH,
      focused: true,
      indexInGroup: focusedGroupMeta.indexInGroup,
      groupSize: focusedGroupMeta.groupSize,
    });

    let cursorAboveBottom = focusedTop;
    for (let i = focusedIdx - 1; i >= 0; i--) {
      const t = orderedTracks[i];
      const h = heights[i];
      const top = cursorAboveBottom - STACK_GAP - h;
      const m = meta(t);
      positioned.push({
        key: t.id,
        track: t,
        layer: layerOfTrack(t),
        top,
        z: -(focusedIdx - i) * Z_GAP,
        width: layerWidth,
        height: h,
        focused: false,
        indexInGroup: m.indexInGroup,
        groupSize: m.groupSize,
      });
      cursorAboveBottom = top;
    }

    let cursorBelowTop = focusedTop + focusedH;
    for (let i = focusedIdx + 1; i < orderedTracks.length; i++) {
      const t = orderedTracks[i];
      const h = heights[i];
      const top = cursorBelowTop + STACK_GAP;
      const m = meta(t);
      positioned.push({
        key: t.id,
        track: t,
        layer: layerOfTrack(t),
        top,
        z: -(i - focusedIdx) * Z_GAP,
        width: layerWidth,
        height: h,
        focused: false,
        indexInGroup: m.indexInGroup,
        groupSize: m.groupSize,
      });
      cursorBelowTop = top + h;
    }
  }

  // Render the focused card last so it sits on top; siblings render
  // in reverse-distance order (farthest first) so perspective stacking
  // reads cleanly.
  const renderOrder = [...positioned].sort((a, b) => a.z - b.z);

  const playheadX = playback.currentTime * zoom.pixelsPerSecond - zoom.scrollLeft;
  const trackContentW = Math.max(1, layerWidth);

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        display: "flex",
        background: theme.color.surface0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 48,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          borderRight: `1px solid ${theme.color.borderWeak}`,
          zIndex: 20,
        }}
      >
        <TrackToggle tracks={tracks} focusedTrackId={focusedTrackId} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <motion.div
          ref={sceneRef}
          animate={{
            perspective: CAMERA.perspective,
            perspectiveOrigin: `${CAMERA.perspectiveOriginX}% ${CAMERA.perspectiveOriginY}%`,
          }}
          transition={EASE}
          style={{
            flex: 1,
            position: "relative",
            transformStyle: "preserve-3d",
            overflow: "hidden",
          }}
        >
          <motion.div
            animate={{ rotateX: CAMERA.rotateX, rotateY: CAMERA.rotateY }}
            transition={EASE}
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
            }}
          >
            <AnimatePresence>
              {renderOrder.map((p) => (
                <ExplodedTrack
                  key={p.key}
                  track={p.track}
                  indexInGroup={p.indexInGroup}
                  groupSize={p.groupSize}
                  zOffset={p.z}
                  width={p.width}
                  height={p.height}
                  top={p.top}
                  focused={p.focused}
                  pixelsPerSecond={zoom.pixelsPerSecond}
                  scrollLeft={zoom.scrollLeft}
                  selectedClipId={null}
                  playheadX={playheadX}
                  viewportWidth={trackContentW}
                  onClick={() => handleDive(p.layer)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
