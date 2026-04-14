import { useCallback, useEffect, useMemo } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { LAYER_META, type LayerType } from "../overview/layerTypes.js";
import { useScenes } from "../scenes/SceneContext.js";
import { resolveScene } from "../scenes/useSceneResolver.js";
import { ArrowLeftIcon, ArrowRightIcon } from "../icons/index.js";
import { theme } from "../theme/tokens.js";

const ghostBtn = (disabled: boolean): React.CSSProperties => ({
  background: "transparent",
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.sm,
  color: disabled ? theme.color.ink5 : theme.color.ink2,
  cursor: disabled ? "default" : "pointer",
  width: 26,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  transition: `color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
});

export function DiveHeader() {
  const { diveLayer, setTimelineMode, setDiveLayer } = useTimelineMode();
  const playback = usePlayback();
  const scenes = useScenes();
  const composition = useComposition();

  const layer: LayerType = (diveLayer ?? "video") as LayerType;
  const meta = LAYER_META[layer];
  const Icon = meta.Icon;

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
      if (
        playback.currentTime >= env.startTime &&
        playback.currentTime < env.startTime + env.duration
      ) {
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
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleBack]);

  const prevDisabled = sceneIndex <= 0;
  const nextDisabled = sceneIndex < 0 || sceneIndex >= scenes.length - 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.space.space3,
        height: 40,
        padding: `0 ${theme.space.space4}px`,
        borderBottom: `1px solid ${theme.color.borderWeak}`,
        background: theme.color.surface0,
        flexShrink: 0,
        fontFamily: theme.font.ui,
      }}
    >
      <button
        type="button"
        onClick={handleBack}
        title="Back to overview"
        aria-label="back to overview"
        style={ghostBtn(false)}
      >
        <ArrowLeftIcon size={13} />
      </button>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: theme.space.space2,
          color: meta.color,
          fontSize: theme.text.xs,
          fontWeight: theme.text.weightSemibold,
          letterSpacing: theme.text.trackingCaps,
          textTransform: "uppercase",
        }}
      >
        <Icon size={13} />
        <span>{meta.label}</span>
      </div>

      {sceneLabel && (
        <span
          style={{
            color: theme.color.ink3,
            fontSize: theme.text.sm,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {sceneLabel}
        </span>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", gap: theme.space.space1 }}>
        <button
          type="button"
          onClick={handlePrevScene}
          disabled={prevDisabled}
          title="Previous scene"
          aria-label="previous scene"
          style={ghostBtn(prevDisabled)}
        >
          <ArrowLeftIcon size={13} />
        </button>
        <button
          type="button"
          onClick={handleNextScene}
          disabled={nextDisabled}
          title="Next scene"
          aria-label="next scene"
          style={ghostBtn(nextDisabled)}
        >
          <ArrowRightIcon size={13} />
        </button>
      </div>
    </div>
  );
}
