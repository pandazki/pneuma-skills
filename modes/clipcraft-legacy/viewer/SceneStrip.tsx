// modes/clipcraft/viewer/SceneStrip.tsx
import type { Scene } from "../types.js";
import { SceneCard } from "./SceneCard.js";

interface SceneStripProps {
  scenes: Scene[];
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
}

export function SceneStrip({ scenes, selectedSceneId, onSelectScene }: SceneStripProps) {
  if (scenes.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#52525b",
          fontSize: 13,
        }}
      >
        No scenes yet — the agent will add them as it generates your video
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "8px 12px",
        height: "100%",
        overflowX: "auto",
        overflowY: "hidden",
        alignItems: "stretch",
      }}
    >
      {scenes.map((scene, i) => (
        <SceneCard
          key={scene.id}
          scene={scene}
          index={i}
          isSelected={scene.id === selectedSceneId}
          onSelect={onSelectScene}
        />
      ))}
    </div>
  );
}
