import { useMemo } from "react";
import { useComposition } from "@pneuma-craft/react";
import { useScenes, useSceneSelection } from "../scenes/SceneContext.js";

export function ScriptTab() {
  const scenes = useScenes();
  const composition = useComposition();
  const { selectedSceneId, setSelectedSceneId } = useSceneSelection();

  const subtitlesByClipId = useMemo(() => {
    const map = new Map<string, string>();
    for (const track of composition?.tracks ?? []) {
      if (track.type !== "subtitle") continue;
      for (const clip of track.clips) {
        const text = (clip as { text?: string }).text;
        if (text) map.set(clip.id, text);
      }
    }
    return map;
  }, [composition]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ overflowY: "auto", flex: 1, padding: "8px 10px" }}>
        {scenes.length === 0 ? (
          <div style={{ fontSize: 11, color: "#52525b", padding: "4px 0" }}>
            No scenes yet
          </div>
        ) : (
          scenes.map((scene, index) => {
            const isSelected = scene.id === selectedSceneId;
            const captionText = scene.memberClipIds
              .map((id) => subtitlesByClipId.get(id))
              .filter((s): s is string => typeof s === "string")
              .join(" ");

            return (
              <div
                key={scene.id}
                onClick={() => setSelectedSceneId(scene.id)}
                style={{
                  padding: "8px 8px",
                  marginBottom: 4,
                  borderRadius: 4,
                  border: isSelected
                    ? "1px solid #f97316"
                    : "1px solid transparent",
                  background: isSelected
                    ? "rgba(249, 115, 22, 0.08)"
                    : "transparent",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: isSelected ? "#f97316" : "#a1a1aa",
                    marginBottom: 2,
                  }}
                >
                  {scene.title || `Scene ${index + 1}`}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#d4d4d8",
                    lineHeight: 1.4,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {captionText || (
                    <span style={{ color: "#52525b" }}>
                      {scene.prompt || "No caption"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
