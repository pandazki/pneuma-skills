import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import type { LayerType } from "../../store/types.js";
import { selectSortedScenes, selectTotalDuration } from "../../store/selectors.js";
import { useCurrentFrame } from "../../hooks/useCurrentFrame.js";
import { useWorkspaceUrl } from "../../hooks/useWorkspaceUrl.js";
import { ExplodedLayer, LAYER_ORDER } from "./ExplodedLayer.js";
import { LayerToggle } from "../overview/LayerToggle.js";

/** Fixed side-perspective camera constants */
const CAMERA = {
  rotateX: -12,
  rotateY: 20,
  perspective: 800,
  perspectiveOriginX: 50,
  perspectiveOriginY: 45,
} as const;

/** Z gap between layers in px */
const Z_GAP = 80;

/** Height distribution: max and min heights per layer type */
const MAX_H: Record<LayerType, number> = { video: 200, caption: 72, audio: 56, bgm: 56 };
const MIN_H: Record<LayerType, number> = { video: 80, caption: 32, audio: 32, bgm: 32 };

const SPRING = { type: "spring" as const, stiffness: 150, damping: 25 };

/**
 * Compute Z offsets so that `focusedLayer` sits at z=0.
 * Layers in front of focus get positive Z (closer), behind get negative.
 */
function computeZOffsets(activeLayers: LayerType[], focusedLayer: LayerType): Record<string, number> {
  const focusIdx = activeLayers.indexOf(focusedLayer);
  const offsets: Record<string, number> = {};
  for (let i = 0; i < activeLayers.length; i++) {
    offsets[activeLayers[i]] = (focusIdx - i) * Z_GAP;
  }
  return offsets;
}

/**
 * Given sorted scenes and a globalTime, find the scene at that time.
 */
function sceneAtTime(scenes: { id: string; duration: number }[], globalTime: number): { index: number; localTime: number } {
  let cumulative = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (globalTime < cumulative + scenes[i].duration || i === scenes.length - 1) {
      return { index: i, localTime: Math.max(0, globalTime - cumulative) };
    }
    cumulative += scenes[i].duration;
  }
  return { index: 0, localTime: 0 };
}

export function ExplodedView({ videoRefs }: { videoRefs: React.RefObject<Map<string, HTMLVideoElement>> }) {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const url = useWorkspaceUrl();

  const scenes = selectSortedScenes(state);
  const totalDuration = selectTotalDuration(state);
  const { playback, storyboard, focusedLayer: storedFocusedLayer } = state;
  const bgm = storyboard.bgm;

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });

  // Active layers — default: all available
  const [activeLayers, setActiveLayers] = useState<Set<LayerType>>(() => {
    const initial = new Set<LayerType>(["caption", "video", "audio"]);
    if (bgm) initial.add("bgm");
    return initial;
  });

  const disabledLayers = useMemo(() => {
    const d = new Set<LayerType>();
    if (!bgm) d.add("bgm");
    // Disable audio if no scenes have TTS
    if (!scenes.some(s => s.audio?.status === "ready" && s.audio?.source)) d.add("audio");
    return d;
  }, [bgm, scenes]);

  const toggleLayer = useCallback((layer: LayerType) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) {
        if (next.size > 1) next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }, []);

  // Ordered active layers (front to back)
  const orderedActive = useMemo(
    () => LAYER_ORDER.filter(l => activeLayers.has(l)),
    [activeLayers],
  );

  // Focused layer — default to video, clamp to active set
  const focusedLayer = useMemo(() => {
    if (storedFocusedLayer && activeLayers.has(storedFocusedLayer)) return storedFocusedLayer;
    if (activeLayers.has("video")) return "video";
    return orderedActive[0] ?? "video";
  }, [storedFocusedLayer, activeLayers, orderedActive]);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Scene at playhead ─────────────────────────────────────────────────────

  const { index: activeSceneIdx } = useMemo(
    () => sceneAtTime(scenes, playback.globalTime),
    [scenes, playback.globalTime],
  );
  const activeScene = scenes[activeSceneIdx] ?? null;

  // ── Video frame capture ───────────────────────────────────────────────────

  const activeVideoEl = activeScene ? videoRefs.current?.get(activeScene.id) ?? null : null;
  const frameUrl = useCurrentFrame(activeVideoEl, playback.globalTime, playback.playing);

  // ── Audio URLs ────────────────────────────────────────────────────────────

  const ttsAudioUrl = activeScene?.audio?.status === "ready" && activeScene.audio.source
    ? url(activeScene.audio.source)
    : null;

  const bgmAudioUrl = bgm?.source ? url(bgm.source) : null;
  const bgmTimeFraction = bgm && totalDuration > 0 ? playback.globalTime / totalDuration : 0;

  // ── Scroll to focus ───────────────────────────────────────────────────────

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY;
    if (Math.abs(delta) < 5) return;

    const currentIdx = orderedActive.indexOf(focusedLayer);
    let nextIdx: number;
    if (delta > 0) {
      // Scroll down → focus moves back (toward bgm)
      nextIdx = Math.min(orderedActive.length - 1, currentIdx + 1);
    } else {
      // Scroll up → focus moves front (toward caption)
      nextIdx = Math.max(0, currentIdx - 1);
    }
    if (nextIdx !== currentIdx) {
      dispatch({ type: "SET_FOCUSED_LAYER", layer: orderedActive[nextIdx] });
    }
  }, [orderedActive, focusedLayer, dispatch]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Escape to collapse ────────────────────────────────────────────────────

  const handleCollapse = useCallback(() => {
    dispatch({ type: "SET_TIMELINE_MODE", mode: "collapsed" });
  }, [dispatch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCollapse();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCollapse]);

  // ── Dive in ───────────────────────────────────────────────────────────────

  const handleDive = useCallback((layer: LayerType) => {
    dispatch({ type: "SET_DIVE_LAYER", layer });
    dispatch({ type: "SET_TIMELINE_MODE", mode: "dive" });
  }, [dispatch]);

  // ── Layout ────────────────────────────────────────────────────────────────

  const sceneW = containerSize.width - 88; // 44px LayerToggle + padding
  const sceneH = containerSize.height; // controls bar is in TimelineShell now

  // Compute layer dimensions (width = aspect ratio of project)
  const ar = state.project.resolution;
  const arRatio = ar.width / ar.height;
  const layerWidth = Math.min(sceneW * 0.7, sceneH * arRatio * 0.5);

  // Distribute heights
  const gap = 8;
  const totalGap = Math.max(0, orderedActive.length - 1) * gap;
  const availH = sceneH - totalGap;
  const totalMaxH = orderedActive.reduce((s, l) => s + MAX_H[l], 0);

  const layerHeights: Record<string, number> = {};
  for (const l of orderedActive) {
    const ratio = MAX_H[l] / totalMaxH;
    const h = Math.floor(availH * ratio);
    layerHeights[l] = Math.max(MIN_H[l], Math.min(h, MAX_H[l]));
  }

  const totalLayersH = orderedActive.reduce((s, l) => s + layerHeights[l], 0) + totalGap;
  const topOffset = Math.max(0, Math.floor((sceneH - totalLayersH) / 2));

  // Z offsets
  const zOffsets = computeZOffsets(orderedActive, focusedLayer);

  // Y positions for each layer
  const layerTops: Record<string, number> = {};
  let yAccum = topOffset;
  for (const l of orderedActive) {
    layerTops[l] = yAccum;
    yAccum += layerHeights[l] + gap;
  }

  // Render back-to-front for correct 3D overlap
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

      {/* Right: 3D scene */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* 3D perspective scene */}
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
              {renderOrder.map(layerType => (
                <ExplodedLayer
                  key={layerType}
                  layerType={layerType}
                  zOffset={zOffsets[layerType] ?? 0}
                  width={layerWidth}
                  height={layerHeights[layerType]}
                  top={layerTops[layerType]}
                  focused={layerType === focusedLayer}
                  onClick={() => handleDive(layerType)}
                  caption={activeScene?.caption ?? null}
                  frameUrl={frameUrl}
                  ttsAudioUrl={ttsAudioUrl}
                  bgmAudioUrl={bgmAudioUrl}
                  bgmTimeFraction={bgmTimeFraction}
                  bgmDuration={totalDuration}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
