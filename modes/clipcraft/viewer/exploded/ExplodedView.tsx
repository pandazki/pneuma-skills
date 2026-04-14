import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { tracksForLayer, type LayerType } from "../overview/layerTypes.js";
import { LayerToggle } from "../overview/LayerToggle.js";
import { ExplodedLayer, LAYER_ORDER } from "./ExplodedLayer.js";
import { useCurrentFrame } from "./useCurrentFrame.js";
import { useActiveSceneAtTime } from "./useActiveSceneAtTime.js";
import { useWorkspaceAssetUrl } from "../assets/useWorkspaceAssetUrl.js";

const CAMERA = {
  rotateX: 0,
  rotateY: 0,
  perspective: 1400,
  perspectiveOriginX: 50,
  perspectiveOriginY: 50,
} as const;

// Bigger Z_GAP so scrolling visibly snaps the targeted layer to the
// front and pushes the others far behind. Combined with the face-on
// camera, the perspective shrink of the non-focused layers is what
// sells the depth — a small gap would just look like a wiggle.
const Z_GAP = 320;
// Compact heights for non-video layers. Video grows to fill the rest
// and is sized to match the composition's aspect ratio exactly.
const NON_VIDEO_H: Record<LayerType, number> = { caption: 56, audio: 64, video: 0 };
const MIN_VIDEO_H = 160;
const SPRING = { type: "spring" as const, stiffness: 150, damping: 25 };

// Header padding inside ExplodedLayer (label row + flex container padding).
const LAYER_HEADER_H = 28;
const LAYER_INNER_PAD_X = 20;

function computeZOffsets(
  activeLayers: LayerType[],
  focusedLayer: LayerType,
): Record<string, number> {
  const focusIdx = activeLayers.indexOf(focusedLayer);
  const offsets: Record<string, number> = {};
  for (let i = 0; i < activeLayers.length; i++) {
    offsets[activeLayers[i]] = (focusIdx - i) * Z_GAP;
  }
  return offsets;
}

export function ExplodedView() {
  const composition = useComposition();
  const playback = usePlayback();
  const {
    setTimelineMode,
    setDiveLayer,
    focusedLayer: storedFocus,
    setFocusedLayer,
  } = useTimelineMode();

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });

  const tracks = composition?.tracks ?? [];

  const [activeLayers, setActiveLayers] = useState<Set<LayerType>>(
    () => new Set<LayerType>(["caption", "video", "audio"]),
  );

  const disabledLayers = useMemo(() => {
    const d = new Set<LayerType>();
    if (tracksForLayer(tracks, "video").length === 0) d.add("video");
    if (tracksForLayer(tracks, "caption").length === 0) d.add("caption");
    if (tracksForLayer(tracks, "audio").length === 0) d.add("audio");
    return d;
  }, [tracks]);

  const toggleLayer = useCallback((layer: LayerType) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        if (next.size > 1) next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }, []);

  const orderedActive = useMemo(
    () => LAYER_ORDER.filter((l) => activeLayers.has(l)),
    [activeLayers],
  );

  const focusedLayer = useMemo((): LayerType => {
    if (storedFocus && activeLayers.has(storedFocus)) return storedFocus;
    if (activeLayers.has("video")) return "video";
    return orderedActive[0] ?? "video";
  }, [storedFocus, activeLayers, orderedActive]);

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

  // Active scene at playhead (via Task 1 scene resolver). Not yet rendered
  // but reserved for scene-scoped overlays (Task 7 hooks in here).
  useActiveSceneAtTime(playback.currentTime);

  // Caption text: first subtitle clip whose envelope covers currentTime.
  const captionText = useMemo(() => {
    for (const track of tracksForLayer(tracks, "caption")) {
      for (const clip of track.clips) {
        if (
          playback.currentTime >= clip.startTime &&
          playback.currentTime < clip.startTime + clip.duration
        ) {
          return (clip as Clip & { text?: string }).text ?? null;
        }
      }
    }
    return null;
  }, [tracks, playback.currentTime]);

  // Audio clip at playhead (first audio track's clip envelope straddling currentTime).
  const activeAudioClip = useMemo(() => {
    for (const track of tracksForLayer(tracks, "audio")) {
      for (const clip of track.clips) {
        if (
          playback.currentTime >= clip.startTime &&
          playback.currentTime < clip.startTime + clip.duration
        ) {
          return clip as Clip & { assetId?: string };
        }
      }
    }
    return null;
  }, [tracks, playback.currentTime]);

  const audioUrl = useWorkspaceAssetUrl(activeAudioClip?.assetId ?? null);
  const frameBitmap = useCurrentFrame();

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      if (Math.abs(delta) < 5) return;
      const currentIdx = orderedActive.indexOf(focusedLayer);
      let nextIdx: number;
      if (delta > 0) {
        nextIdx = Math.min(orderedActive.length - 1, currentIdx + 1);
      } else {
        nextIdx = Math.max(0, currentIdx - 1);
      }
      if (nextIdx !== currentIdx) {
        setFocusedLayer(orderedActive[nextIdx]);
      }
    },
    [orderedActive, focusedLayer, setFocusedLayer],
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

  // Layout policy: caption + audio get a compact fixed slice; video
  // takes everything else and is sized so its inner frame fills the
  // layer perfectly at the composition's aspect ratio (no letterbox).
  // The shared layerWidth is dictated by the video frame so the layers
  // visually stack at the same width.
  const gap = 8;
  const totalGap = Math.max(0, orderedActive.length - 1) * gap;
  const SCENE_PAD = 24; // top + bottom breathing room for perspective
  const availH = sceneH - totalGap - SCENE_PAD * 2;

  const reservedH = orderedActive.reduce(
    (sum, l) => (l === "video" ? sum : sum + NON_VIDEO_H[l]),
    0,
  );
  const hasVideo = orderedActive.includes("video");
  const videoLayerH = hasVideo
    ? Math.max(MIN_VIDEO_H, availH - reservedH)
    : 0;

  // Compute the ideal video-layer width from its inner frame:
  // frameH = videoLayerH - LAYER_HEADER_H; frameW = frameH * arRatio.
  // Then layerWidth = frameW + LAYER_INNER_PAD_X.
  // Clamp by sceneW (so we don't overflow horizontally) and recompute
  // videoLayerH if width was the bottleneck.
  let layerWidth: number;
  let videoLayerHFinal: number;
  if (hasVideo) {
    const idealFrameH = Math.max(0, videoLayerH - LAYER_HEADER_H);
    const idealFrameW = idealFrameH * arRatio;
    const maxLayerW = Math.max(160, sceneW - 32);
    if (idealFrameW + LAYER_INNER_PAD_X <= maxLayerW) {
      layerWidth = idealFrameW + LAYER_INNER_PAD_X;
      videoLayerHFinal = videoLayerH;
    } else {
      // Width is the constraint — shrink frame height to keep aspect ratio.
      layerWidth = maxLayerW;
      const fittedFrameW = maxLayerW - LAYER_INNER_PAD_X;
      const fittedFrameH = fittedFrameW / arRatio;
      videoLayerHFinal = Math.max(MIN_VIDEO_H, fittedFrameH + LAYER_HEADER_H);
    }
  } else {
    layerWidth = Math.min(sceneW * 0.7, 600);
    videoLayerHFinal = 0;
  }

  const layerHeights: Record<string, number> = {};
  for (const l of orderedActive) {
    layerHeights[l] = l === "video" ? videoLayerHFinal : NON_VIDEO_H[l];
  }

  const totalLayersH =
    orderedActive.reduce((s, l) => s + (layerHeights[l] ?? 0), 0) + totalGap;
  const topOffset = Math.max(SCENE_PAD, Math.floor((sceneH - totalLayersH) / 2));
  const zOffsets = computeZOffsets(orderedActive, focusedLayer);

  const layerTops: Record<string, number> = {};
  let yAccum = topOffset;
  for (const l of orderedActive) {
    layerTops[l] = yAccum;
    yAccum += (layerHeights[l] ?? 0) + gap;
  }

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
      <div
        style={{
          width: 44,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          borderRight: "1px solid #1a1a1e",
          zIndex: 20,
        }}
      >
        <LayerToggle
          activeLayers={activeLayers}
          onToggle={toggleLayer}
          disabledLayers={disabledLayers}
        />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <motion.div
          animate={{
            perspective: CAMERA.perspective,
            perspectiveOrigin: `${CAMERA.perspectiveOriginX}% ${CAMERA.perspectiveOriginY}%`,
          }}
          transition={SPRING}
          style={{
            flex: 1,
            position: "relative",
            transformStyle: "preserve-3d",
            overflow: "hidden",
          }}
        >
          <motion.div
            animate={{ rotateX: CAMERA.rotateX, rotateY: CAMERA.rotateY }}
            transition={SPRING}
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
            }}
          >
            <AnimatePresence>
              {renderOrder.map((layerType) => (
                <ExplodedLayer
                  key={layerType}
                  layerType={layerType}
                  zOffset={zOffsets[layerType] ?? 0}
                  width={layerWidth}
                  height={layerHeights[layerType] ?? NON_VIDEO_H[layerType] ?? MIN_VIDEO_H}
                  top={layerTops[layerType] ?? 0}
                  focused={layerType === focusedLayer}
                  onClick={() => handleDive(layerType)}
                  captionText={captionText}
                  frameBitmap={frameBitmap}
                  audioUrl={audioUrl}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
