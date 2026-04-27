import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useComposition,
  usePlayback,
  useSelection,
} from "@pneuma-craft/react";
import { useTimelineZoom } from "../timeline/hooks/useTimelineZoom.js";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { useOverviewCamera, type CameraPreset } from "./useOverviewCamera.js";
import {
  groupTracksForViews,
  type LayerType,
} from "./layerTypes.js";
import { Track3D } from "./Track3D.js";
import { TrackToggle } from "./TrackToggle.js";
import { theme } from "../theme/tokens.js";

// Spread the *groups* along Z so caption / video / audio visibly sit at
// different depths. Within a group we apply a small per-track Z step so
// stacked tracks of the same type still separate under perspective.
const INNER_Z_STEP = 28;

function computeGroupZOffsets(groupCount: number): number[] {
  if (groupCount <= 1) return new Array(groupCount).fill(0);
  const spread = groupCount === 2 ? 120 : groupCount === 3 ? 80 : 60;
  const offsets: number[] = [];
  for (let i = 0; i < groupCount; i++) {
    offsets.push(((groupCount - 1) / 2 - i) * spread);
  }
  return offsets;
}

export function TimelineOverview3D({ cameraPreset }: { cameraPreset: CameraPreset }) {
  const composition = useComposition();
  const playback = usePlayback();
  const selection = useSelection();
  const { setTimelineMode, setDiveLayer } = useTimelineMode();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [containerH, setContainerH] = useState(600);

  const tracks = composition?.tracks ?? [];
  const totalDuration = Math.max(composition?.duration ?? 0, 1);
  const zoom = useTimelineZoom(totalDuration, sceneRef);
  const { camera } = useOverviewCamera(cameraPreset);

  const groups = useMemo(() => groupTracksForViews(tracks), [tracks]);
  const renderableGroups = useMemo(
    () => groups.filter((g) => g.tracks.length > 0),
    [groups],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      setContainerH(entries[0]?.contentRect.height ?? 600);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleCollapse = useCallback(() => {
    setTimelineMode("collapsed");
  }, [setTimelineMode]);

  const handleDive = useCallback((layer: LayerType) => {
    setDiveLayer(layer);
    setTimelineMode("dive");
  }, [setDiveLayer, setTimelineMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCollapse();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCollapse]);

  const playheadX = playback.currentTime * zoom.pixelsPerSecond - zoom.scrollLeft;

  // Per-track budgets. Video tracks are given more height than caption /
  // audio — filmstrips need room for legible frames, the other two are
  // strip-style and stay compact.
  const MAX_PER_TRACK: Record<LayerType, number> = { video: 240, caption: 80, audio: 80 };
  const MIN_PER_TRACK: Record<LayerType, number> = { video: 80, caption: 32, audio: 32 };

  const availH = Math.max(containerH - 80, 200);
  const interGroupGap = 16;
  const intraGroupGap = 4;

  const totalTrackCount = renderableGroups.reduce((s, g) => s + g.tracks.length, 0);
  const totalGaps =
    Math.max(0, renderableGroups.length - 1) * interGroupGap +
    renderableGroups.reduce((s, g) => s + Math.max(0, g.tracks.length - 1) * intraGroupGap, 0);
  const spaceForTracks = Math.max(1, availH - totalGaps);

  // Each track claims a share proportional to its layer's MAX budget.
  const sumMax = renderableGroups.reduce(
    (s, g) => s + g.tracks.length * MAX_PER_TRACK[g.layer],
    0,
  );
  const trackHeightFor = (layer: LayerType): number => {
    if (sumMax === 0) return MIN_PER_TRACK[layer];
    const ratio = MAX_PER_TRACK[layer] / sumMax;
    const h = Math.floor(spaceForTracks * ratio);
    return Math.max(MIN_PER_TRACK[layer], Math.min(h, MAX_PER_TRACK[layer]));
  };

  const groupZ = computeGroupZOffsets(renderableGroups.length);

  // Compute top offset so the whole stack is vertically centered.
  const usedH =
    totalTrackCount === 0
      ? 0
      : renderableGroups.reduce(
          (s, g) => s + g.tracks.length * trackHeightFor(g.layer),
          0,
        ) + totalGaps;
  const topOffset = Math.max(0, Math.floor((availH - usedH) / 2));

  interface PositionedTrack {
    key: string;
    track: (typeof renderableGroups)[number]["tracks"][number];
    y: number;
    z: number;
    h: number;
    layer: LayerType;
    indexInGroup: number;
    groupSize: number;
  }
  const positioned: PositionedTrack[] = [];
  let cursorY = topOffset;
  renderableGroups.forEach((group, gIdx) => {
    const h = trackHeightFor(group.layer);
    const baseZ = groupZ[gIdx] ?? 0;
    group.tracks.forEach((track, tIdx) => {
      positioned.push({
        key: track.id,
        track,
        y: cursorY,
        z: baseZ + (tIdx - (group.tracks.length - 1) / 2) * INNER_Z_STEP,
        h,
        layer: group.layer,
        indexInGroup: tIdx + 1,
        groupSize: group.tracks.length,
      });
      cursorY += h;
      if (tIdx < group.tracks.length - 1) cursorY += intraGroupGap;
    });
    if (gIdx < renderableGroups.length - 1) cursorY += interGroupGap;
  });

  // Reverse so deeper (behind) cards mount first; the browser's painting
  // order and perspective math then layer them correctly.
  const renderOrder = [...positioned].reverse();

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
        <TrackToggle tracks={tracks} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <motion.div
          ref={sceneRef}
          animate={{
            perspective: camera.perspective,
            perspectiveOrigin: `${camera.perspectiveOriginX}% ${camera.perspectiveOriginY}%`,
          }}
          transition={{ type: "tween", duration: 0.38, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            flex: 1, position: "relative",
            transformStyle: "preserve-3d", overflow: "hidden",
          }}
        >
          <motion.div
            animate={{ rotateX: camera.rotateX, rotateY: camera.rotateY, x: `${camera.translateX}%` }}
            transition={{ type: "tween", duration: 0.38, ease: [0.2, 0.8, 0.2, 1] }}
            style={{
              position: "absolute", inset: "4px 12px",
              transformStyle: "preserve-3d",
            }}
          >
            <AnimatePresence>
              {renderOrder.map((p) => (
                <Track3D
                  key={p.key}
                  track={p.track}
                  indexInGroup={p.indexInGroup}
                  groupSize={p.groupSize}
                  zOffset={p.z}
                  yPosition={p.y}
                  heightPx={p.h}
                  rotateX={0}
                  totalDuration={totalDuration}
                  pixelsPerSecond={zoom.pixelsPerSecond}
                  scrollLeft={zoom.scrollLeft}
                  viewportWidth={zoom.viewportWidth - 80}
                  selectedClipId={selectedClipId}
                  selected={false}
                  onSelect={() => {}}
                  onDive={handleDive}
                  playheadX={playheadX}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
