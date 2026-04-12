// modes/clipcraft/viewer/timeline/overview/TimelineOverview3D.tsx
import { useRef, useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import { selectSortedScenes, selectTotalDuration } from "../../store/selectors.js";
import { useTimelineZoom } from "../hooks/useTimelineZoom.js";
import { useOverviewCamera, type CameraPreset } from "./useOverviewCamera.js";
import { Layer3D, type LayerType } from "./Layer3D.js";
import { LayerToggle } from "./LayerToggle.js";

/** Z offsets — spread increases with fewer active layers */
function computeZOffsets(activeLayers: LayerType[]): Record<string, number> {
  const count = activeLayers.length;
  if (count <= 1) return Object.fromEntries(activeLayers.map(l => [l, 0]));

  const spread = count === 2 ? 120 : count === 3 ? 80 : 60;
  const offsets: Record<string, number> = {};
  activeLayers.forEach((l, i) => {
    // Front to back
    offsets[l] = ((count - 1) / 2 - i) * spread;
  });
  return offsets;
}

/** Active layers ordered front-to-back for rendering */
const LAYER_PRIORITY: LayerType[] = ["caption", "video", "audio", "bgm"];

export function TimelineOverview3D({ cameraPreset }: { cameraPreset: CameraPreset }) {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const scenes = selectSortedScenes(state);
  const totalDuration = selectTotalDuration(state);
  const { selectedSceneId, playback, storyboard } = state;
  const bgm = storyboard.bgm;

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [containerH, setContainerH] = useState(600);
  const dur = Math.max(totalDuration, 1);
  const zoom = useTimelineZoom(dur, sceneRef);
  // Use the preset passed from TimelineShell (camera controls are now in TimelineShell)
  const { camera } = useOverviewCamera(cameraPreset);

  // Active layers — default: video on
  const [activeLayers, setActiveLayers] = useState<Set<LayerType>>(new Set(["video"]));

  const disabledLayers = new Set<LayerType>();
  if (!bgm) disabledLayers.add("bgm");

  const toggleLayer = useCallback((layer: LayerType) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) {
        if (next.size > 1) next.delete(layer); // Keep at least 1
      } else {
        next.add(layer);
      }
      return next;
    });
  }, []);

  // Track container height
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
    dispatch({ type: "SET_TIMELINE_MODE", mode: "collapsed" });
  }, [dispatch]);

  const handleDive = useCallback(
    (layer: LayerType) => {
      dispatch({ type: "SET_DIVE_LAYER", layer });
      dispatch({ type: "SET_TIMELINE_MODE", mode: "dive" });
    },
    [dispatch],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCollapse();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCollapse]);

  // Wheel events are handled by useTimelineZoom's built-in handler on sceneRef

  const playheadX = playback.globalTime * zoom.pixelsPerSecond - zoom.scrollLeft;

  // Seek handler for bottom timeline
  const handleSeek = useCallback((time: number) => {
    dispatch({ type: "SEEK", globalTime: time });
    // Select the scene at this time
    let cumulative = 0;
    for (const scene of scenes) {
      if (time < cumulative + scene.duration) {
        if (scene.id !== selectedSceneId) {
          dispatch({ type: "SELECT_SCENE", sceneId: scene.id });
        }
        break;
      }
      cumulative += scene.duration;
    }
  }, [dispatch, scenes, selectedSceneId]);

  const handleTogglePlay = useCallback(() => {
    dispatch({ type: playback.playing ? "PAUSE" : "PLAY" });
  }, [dispatch, playback.playing]);

  // Compute layout for active layers — each type has its own max height
  const MAX_H: Record<LayerType, number> = {
    video: 240,
    caption: 80,   // text doesn't need much — auto-adapts within range
    audio: 60,
    bgm: 60,
  };
  const MIN_H: Record<LayerType, number> = {
    video: 80,
    caption: 32,
    audio: 32,
    bgm: 32,
  };

  const orderedActive = LAYER_PRIORITY.filter(l => activeLayers.has(l));
  const zOffsets = computeZOffsets(orderedActive);
  const availH = Math.max(containerH - 80, 200);
  const gap = 10;
  const totalGap = Math.max(0, orderedActive.length - 1) * gap;

  // Distribute height proportionally based on max heights
  const totalMaxH = orderedActive.reduce((s, l) => s + MAX_H[l], 0);
  const spaceForLayers = availH - totalGap;
  const layerHeights: Record<string, number> = {};
  for (const l of orderedActive) {
    const ratio = MAX_H[l] / totalMaxH;
    const h = Math.floor(spaceForLayers * ratio);
    layerHeights[l] = Math.max(MIN_H[l], Math.min(h, MAX_H[l]));
  }

  const totalLayersH = orderedActive.reduce((s, l) => s + layerHeights[l], 0) + totalGap;
  const topOffset = Math.max(0, Math.floor((availH - totalLayersH) / 2));

  // Render back-to-front
  const renderOrder = [...orderedActive].reverse();

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        display: "flex",
        background: "#09090b",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Left: layer toggle */}
      <div style={{
        width: 44,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        borderRight: "1px solid #1a1a1e",
        zIndex: 20,
      }}>
        <LayerToggle
          activeLayers={activeLayers}
          onToggle={toggleLayer}
          disabledLayers={disabledLayers}
        />
      </div>

      {/* Right: timeline content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* 3D scene */}
        <motion.div
          ref={sceneRef}
          animate={{
            perspective: camera.perspective,
            perspectiveOrigin: `${camera.perspectiveOriginX}% ${camera.perspectiveOriginY}%`,
          }}
          transition={{ type: "spring", stiffness: 150, damping: 25 }}
          style={{
            flex: 1,
            position: "relative",
            transformStyle: "preserve-3d",
            overflow: "hidden",
          }}
        >
          <motion.div
            animate={{ rotateX: camera.rotateX, rotateY: camera.rotateY, x: `${camera.translateX}%` }}
            transition={{ type: "spring", stiffness: 150, damping: 25 }}
            style={{
              position: "absolute",
              inset: "4px 12px",
              transformStyle: "preserve-3d",
            }}
          >
            <AnimatePresence>
              {renderOrder.map((layerType, renderIdx) => {
                const activeIdx = orderedActive.indexOf(layerType);
                let yPos = topOffset;
                for (let i = 0; i < activeIdx; i++) {
                  yPos += layerHeights[orderedActive[i]] + gap;
                }

                return (
                  <Layer3D
                    key={layerType}
                    layerType={layerType}
                    zOffset={zOffsets[layerType] ?? 0}
                    yPosition={yPos}
                    heightPx={layerHeights[layerType]}
                    rotateX={0}
                    scenes={scenes}
                    bgm={bgm}
                    totalDuration={dur}
                    pixelsPerSecond={zoom.pixelsPerSecond}
                    scrollLeft={zoom.scrollLeft}
                    viewportWidth={zoom.viewportWidth - 80}
                    selectedSceneId={selectedSceneId}
                    selected={false}
                    onSelect={() => {}}
                    onDive={() => handleDive(layerType)}
                    playheadX={playheadX}
                  />
                );
              })}
            </AnimatePresence>
          </motion.div>
        </motion.div>

        {/* No bottom timeline here — the real Timeline is always visible below via TimelineShell */}
      </div>
    </div>
  );
}

