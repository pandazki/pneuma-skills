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
import { LAYER_PRIORITY, tracksForLayer, type LayerType } from "./layerTypes.js";
import { Layer3D } from "./Layer3D.js";
import { LayerToggle } from "./LayerToggle.js";

function computeZOffsets(activeLayers: LayerType[]): Record<string, number> {
  const count = activeLayers.length;
  if (count <= 1) return Object.fromEntries(activeLayers.map((l) => [l, 0]));
  const spread = count === 2 ? 120 : count === 3 ? 80 : 60;
  const offsets: Record<string, number> = {};
  activeLayers.forEach((l, i) => {
    offsets[l] = ((count - 1) / 2 - i) * spread;
  });
  return offsets;
}

export function TimelineOverview3D({ cameraPreset }: { cameraPreset: CameraPreset }) {
  const composition = useComposition();
  const playback = usePlayback();
  const selection = useSelection();
  const {
    setTimelineMode,
    setDiveLayer,
    activeLayers,
    toggleLayer,
  } = useTimelineMode();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [containerH, setContainerH] = useState(600);

  const tracks = composition?.tracks ?? [];
  const totalDuration = Math.max(composition?.duration ?? 0, 1);
  const zoom = useTimelineZoom(totalDuration, sceneRef);
  const { camera } = useOverviewCamera(cameraPreset);

  const disabledLayers = useMemo(() => {
    const d = new Set<LayerType>();
    for (const l of ["video", "caption", "audio"] as LayerType[]) {
      if (tracksForLayer(tracks, l).length === 0) d.add(l);
    }
    return d;
  }, [tracks]);

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

  const MAX_H: Record<LayerType, number> = { video: 240, caption: 80, audio: 60 };
  const MIN_H: Record<LayerType, number> = { video: 80, caption: 32, audio: 32 };

  const orderedActive = LAYER_PRIORITY.filter((l) => activeLayers.has(l));
  const zOffsets = computeZOffsets(orderedActive);
  const availH = Math.max(containerH - 80, 200);
  const gap = 10;
  const totalGap = Math.max(0, orderedActive.length - 1) * gap;
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
  const renderOrder = [...orderedActive].reverse();

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%", display: "flex", background: "#09090b",
        position: "relative", overflow: "hidden",
      }}
    >
      <div style={{
        width: 44, flexShrink: 0, display: "flex", flexDirection: "column",
        justifyContent: "center", borderRight: "1px solid #1a1a1e", zIndex: 20,
      }}>
        <LayerToggle
          activeLayers={activeLayers}
          onToggle={toggleLayer}
          disabledLayers={disabledLayers}
        />
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
              {renderOrder.map((layerType) => {
                const activeIdx = orderedActive.indexOf(layerType);
                let yPos = topOffset;
                for (let i = 0; i < activeIdx; i++) {
                  yPos += layerHeights[orderedActive[i]] + gap;
                }
                return (
                  <Layer3D
                    key={layerType}
                    layerType={layerType}
                    tracks={tracksForLayer(tracks, layerType)}
                    zOffset={zOffsets[layerType] ?? 0}
                    yPosition={yPos}
                    heightPx={layerHeights[layerType]}
                    rotateX={0}
                    totalDuration={totalDuration}
                    pixelsPerSecond={zoom.pixelsPerSecond}
                    scrollLeft={zoom.scrollLeft}
                    viewportWidth={zoom.viewportWidth - 80}
                    selectedClipId={selectedClipId}
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
      </div>
    </div>
  );
}
