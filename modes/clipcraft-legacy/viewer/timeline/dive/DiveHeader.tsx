import { useCallback, useEffect } from "react";
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import { selectSortedScenes, selectTotalDuration } from "../../store/selectors.js";
import type { LayerType } from "../../store/types.js";

const LAYER_META: Record<LayerType, { label: string; icon: string; color: string }> = {
  caption: { label: "CAPTION", icon: "Tt", color: "#f97316" },
  video:   { label: "VIDEO",   icon: "▶",  color: "#eab308" },
  audio:   { label: "AUDIO",   icon: "♪",  color: "#38bdf8" },
  bgm:     { label: "BGM",     icon: "♫",  color: "#a78bfa" },
};

export function DiveHeader() {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const { diveLayer, playback } = state;
  const scenes = selectSortedScenes(state);

  const layer = diveLayer ?? "video";
  const meta = LAYER_META[layer];
  const sceneIndex = playback.currentSceneIndex;
  const scene = scenes[sceneIndex];
  const sceneLabel = scene ? `Scene ${scene.order + 1}` : "";

  const handleBack = useCallback(() => {
    dispatch({ type: "SET_TIMELINE_MODE", mode: "overview" });
    dispatch({ type: "SET_DIVE_LAYER", layer: null });
  }, [dispatch]);

  const handlePrevScene = useCallback(() => {
    if (sceneIndex <= 0) return;
    let cumulative = 0;
    for (let i = 0; i < sceneIndex - 1; i++) {
      cumulative += scenes[i].duration;
    }
    dispatch({ type: "SEEK", globalTime: cumulative });
  }, [dispatch, scenes, sceneIndex]);

  const handleNextScene = useCallback(() => {
    if (sceneIndex >= scenes.length - 1) return;
    let cumulative = 0;
    for (let i = 0; i <= sceneIndex; i++) {
      cumulative += scenes[i].duration;
    }
    dispatch({ type: "SEEK", globalTime: cumulative });
  }, [dispatch, scenes, sceneIndex]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleBack]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: 40,
      padding: "0 12px",
      borderBottom: "1px solid #27272a",
      flexShrink: 0,
    }}>
      <button
        onClick={handleBack}
        title="Back to overview"
        style={{
          background: "none",
          border: "1px solid #3f3f46",
          borderRadius: 4,
          color: "#a1a1aa",
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
        }}
      >
        ←
      </button>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: meta.color,
        fontWeight: 600,
        fontSize: 12,
        fontFamily: "'Inter', system-ui, sans-serif",
        letterSpacing: "0.05em",
      }}>
        <span>{meta.icon}</span>
        <span>{meta.label}</span>
      </div>

      <span style={{ color: "#71717a", fontSize: 11 }}>
        — {sceneLabel}
      </span>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={handlePrevScene}
          disabled={sceneIndex <= 0}
          title="Previous scene"
          style={{
            background: "none",
            border: "1px solid #3f3f46",
            borderRadius: 4,
            color: sceneIndex <= 0 ? "#3f3f46" : "#a1a1aa",
            cursor: sceneIndex <= 0 ? "default" : "pointer",
            padding: "2px 6px",
            fontSize: 12,
          }}
        >
          ←
        </button>
        <button
          onClick={handleNextScene}
          disabled={sceneIndex >= scenes.length - 1}
          title="Next scene"
          style={{
            background: "none",
            border: "1px solid #3f3f46",
            borderRadius: 4,
            color: sceneIndex >= scenes.length - 1 ? "#3f3f46" : "#a1a1aa",
            cursor: sceneIndex >= scenes.length - 1 ? "default" : "pointer",
            padding: "2px 6px",
            fontSize: 12,
          }}
        >
          →
        </button>
      </div>
    </div>
  );
}
