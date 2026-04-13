import { useCallback, useEffect, useMemo } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { LAYER_META, type LayerType } from "../overview/layerTypes.js";
import { useScenes } from "../scenes/SceneContext.js";
import { resolveScene } from "../scenes/useSceneResolver.js";

export function DiveHeader() {
  const { diveLayer, setTimelineMode, setDiveLayer } = useTimelineMode();
  const playback = usePlayback();
  const scenes = useScenes();
  const composition = useComposition();

  const layer: LayerType = (diveLayer ?? "video") as LayerType;
  const meta = LAYER_META[layer];

  const allClips = useMemo<Clip[]>(() => {
    const out: Clip[] = [];
    for (const track of composition?.tracks ?? []) {
      for (const clip of track.clips) out.push(clip);
    }
    return out;
  }, [composition]);

  const sceneIndex = useMemo(() => {
    for (let i = 0; i < scenes.length; i++) {
      const env = resolveScene(scenes[i], allClips);
      if (playback.currentTime >= env.startTime && playback.currentTime < env.startTime + env.duration) {
        return i;
      }
    }
    return -1;
  }, [scenes, allClips, playback.currentTime]);

  const scene = sceneIndex >= 0 ? scenes[sceneIndex] : null;
  const sceneLabel = scene ? `Scene ${scene.order + 1}` : "";

  const handleBack = useCallback(() => {
    setTimelineMode("overview");
    setDiveLayer(null);
  }, [setTimelineMode, setDiveLayer]);

  const handlePrevScene = useCallback(() => {
    if (sceneIndex <= 0) return;
    const env = resolveScene(scenes[sceneIndex - 1], allClips);
    playback.seek(env.startTime);
  }, [sceneIndex, scenes, allClips, playback]);

  const handleNextScene = useCallback(() => {
    if (sceneIndex < 0 || sceneIndex >= scenes.length - 1) return;
    const env = resolveScene(scenes[sceneIndex + 1], allClips);
    playback.seek(env.startTime);
  }, [sceneIndex, scenes, allClips, playback]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleBack(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleBack]);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, height: 40,
      padding: "0 12px", borderBottom: "1px solid #27272a", flexShrink: 0,
    }}>
      <button
        onClick={handleBack}
        title="Back to overview"
        style={{
          background: "none", border: "1px solid #3f3f46", borderRadius: 4,
          color: "#a1a1aa", cursor: "pointer", padding: "2px 8px",
          fontSize: 13, display: "flex", alignItems: "center",
        }}
      >
        {"\u2190"}
      </button>

      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        color: meta.color, fontWeight: 600, fontSize: 12,
        fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "0.05em",
      }}>
        <span>{meta.icon}</span>
        <span>{meta.label.toUpperCase()}</span>
      </div>

      <span style={{ color: "#71717a", fontSize: 11 }}>{"\u2014"} {sceneLabel}</span>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={handlePrevScene}
          disabled={sceneIndex <= 0}
          title="Previous scene"
          style={{
            background: "none", border: "1px solid #3f3f46", borderRadius: 4,
            color: sceneIndex <= 0 ? "#3f3f46" : "#a1a1aa",
            cursor: sceneIndex <= 0 ? "default" : "pointer",
            padding: "2px 6px", fontSize: 12,
          }}
        >
          {"\u2190"}
        </button>
        <button
          onClick={handleNextScene}
          disabled={sceneIndex < 0 || sceneIndex >= scenes.length - 1}
          title="Next scene"
          style={{
            background: "none", border: "1px solid #3f3f46", borderRadius: 4,
            color: sceneIndex < 0 || sceneIndex >= scenes.length - 1 ? "#3f3f46" : "#a1a1aa",
            cursor: sceneIndex < 0 || sceneIndex >= scenes.length - 1 ? "default" : "pointer",
            padding: "2px 6px", fontSize: 12,
          }}
        >
          {"\u2192"}
        </button>
      </div>
    </div>
  );
}
