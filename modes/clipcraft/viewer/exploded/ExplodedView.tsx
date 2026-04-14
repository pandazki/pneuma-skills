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
const Z_GAP = 280;
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
    const distance = Math.abs(i - focusIdx);
    // Focused layer is at Z=0 (closest to camera). Every other layer
    // recedes into the background at negative Z.
    offsets[activeLayers[i]] = -distance * Z_GAP;
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

  // Carousel layout: the focused layer is at the scene center, Z=0,
  // fully opaque. Every other layer is shifted vertically (above or
  // below) AND recedes in Z, with blur + dim so they read as a
  // background. The video layer is capped at 60% of the scene height
  // so there's room above/below for the non-focused layers to poke
  // out during the vertical-carousel animation.
  const SCENE_PAD = 32;
  const videoMaxH = Math.max(MIN_VIDEO_H, sceneH * 0.6);

  // Video layer sized to the composition aspect ratio. Prefer full
  // videoMaxH; clamp by sceneW - SCENE_PAD*2 if width is the bottleneck.
  const maxLayerW = Math.max(200, sceneW - SCENE_PAD * 2);
  const hasVideo = orderedActive.includes("video");
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

  const layerHeights: Record<string, number> = {};
  for (const l of orderedActive) {
    layerHeights[l] = l === "video" ? videoLayerH : NON_VIDEO_H[l];
  }

  // Vertical carousel: focused layer is centered in the scene; every
  // other layer is stacked OUTSIDE the focused one with a fixed gap
  // between adjacent layer edges. This way non-focused layers always
  // show their full height above/below the focused one — they never
  // overlap with each other OR get hidden behind the focused layer's
  // opaque background.
  const STACK_GAP = 48;
  const focusedIdx = Math.max(0, orderedActive.indexOf(focusedLayer));
  const focusedH = layerHeights[focusedLayer] ?? 0;
  const focusedTop = Math.floor((sceneH - focusedH) / 2);
  const focusedBottom = focusedTop + focusedH;
  const layerTops: Record<string, number> = {};
  layerTops[focusedLayer] = focusedTop;

  // Stack above the focused layer, walking upward.
  let cursorAbove = focusedTop;
  for (let i = focusedIdx - 1; i >= 0; i--) {
    const l = orderedActive[i];
    const h = layerHeights[l] ?? 0;
    cursorAbove -= STACK_GAP + h;
    layerTops[l] = cursorAbove;
  }
  // Stack below the focused layer, walking downward.
  let cursorBelow = focusedBottom;
  for (let i = focusedIdx + 1; i < orderedActive.length; i++) {
    const l = orderedActive[i];
    const h = layerHeights[l] ?? 0;
    cursorBelow += STACK_GAP;
    layerTops[l] = cursorBelow;
    cursorBelow += h;
  }

  const zOffsets = computeZOffsets(orderedActive, focusedLayer);

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
          focusedLayer={focusedLayer}
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
