import type { Scene } from "../../types.js";
import { useWorkspaceUrl } from "../hooks/useWorkspaceUrl.js";
import { WaveformBars } from "./WaveformBars.js";
import { useWaveform } from "./hooks/useWaveform.js";
import { useMemo } from "react";

const TRACK_H = 32;
const BAR_H = TRACK_H - 12;

interface SceneAudioClipProps {
  scene: Scene;
  x: number;
  width: number;
  selected: boolean;
  pixelsPerSecond: number;
}

function SceneAudioClip({ scene, x, width, selected, pixelsPerSecond }: SceneAudioClipProps) {
  const urlFn = useWorkspaceUrl();
  const hasAudio = scene.audio?.status === "ready" && scene.audio?.source;

  // Use raw /content/ path (no cache-busting) to avoid re-decoding on every imageVersion bump
  const waveOpts = useMemo(() => {
    if (!hasAudio || !scene.audio?.source) return null;
    return { audioUrl: `/content/${scene.audio.source}`, bars: Math.max(8, Math.round(width / 4)) };
  }, [hasAudio, scene.audio?.source, width]);

  const { waveform } = useWaveform(waveOpts);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        width: width - 1,
        height: TRACK_H - 4,
        top: 2,
        background: selected ? "#1a1e2a" : "#18181b",
        borderRadius: 3,
        border: selected ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      {waveform ? (
        <WaveformBars peaks={waveform.peaks} height={BAR_H} color={selected ? "#38bdf8" : "#1e3a5f"} />
      ) : hasAudio ? (
        <div style={{ fontSize: 9, color: "#38bdf8", opacity: 0.5 }}>loading...</div>
      ) : null}
    </div>
  );
}

interface Props {
  scenes: Scene[];
  totalDuration: number;
  selectedSceneId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
}

export function AudioTrack({ scenes, totalDuration, selectedSceneId, pixelsPerSecond, scrollLeft }: Props) {
  let offset = 0;

  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {scenes.map((scene) => {
        const x = offset * pixelsPerSecond - scrollLeft;
        const w = scene.duration * pixelsPerSecond;
        offset += scene.duration;

        if (x + w < -10 || x > 2000) return null;

        return (
          <SceneAudioClip
            key={scene.id}
            scene={scene}
            x={x}
            width={w}
            selected={scene.id === selectedSceneId}
            pixelsPerSecond={pixelsPerSecond}
          />
        );
      })}
    </div>
  );
}
