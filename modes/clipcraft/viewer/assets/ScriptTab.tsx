import { useMemo } from "react";
import { useComposition } from "@pneuma-craft/react";
import { useScenes, useSceneSelection } from "../scenes/SceneContext.js";
import { theme } from "../theme/tokens.js";

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        fontFamily: theme.font.ui,
      }}
    >
      <div
        style={{
          overflowY: "auto",
          flex: 1,
          padding: `${theme.space.space2}px ${theme.space.space3}px`,
        }}
      >
        {scenes.length === 0 ? (
          <div
            style={{
              fontSize: theme.text.sm,
              color: theme.color.ink5,
              padding: `${theme.space.space1}px 0`,
              fontStyle: "italic",
            }}
          >
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
                  padding: theme.space.space2,
                  marginBottom: theme.space.space1,
                  borderRadius: theme.radius.sm,
                  border: isSelected
                    ? `1px solid ${theme.color.accentBorder}`
                    : `1px solid ${theme.color.borderWeak}`,
                  background: isSelected
                    ? theme.color.accentSoft
                    : theme.color.surface2,
                  cursor: "pointer",
                  transition: `background ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
                }}
              >
                <div
                  style={{
                    fontFamily: theme.font.ui,
                    fontSize: theme.text.xs,
                    fontWeight: theme.text.weightSemibold,
                    color: isSelected ? theme.color.accentBright : theme.color.ink2,
                    marginBottom: 2,
                    textTransform: "uppercase",
                    letterSpacing: theme.text.trackingCaps,
                  }}
                >
                  {scene.title || `Scene ${index + 1}`}
                </div>
                <div
                  style={{
                    fontSize: theme.text.sm,
                    color: theme.color.ink1,
                    lineHeight: theme.text.lineHeightSnug,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {captionText || (
                    <span
                      style={{
                        color: theme.color.ink4,
                        fontStyle: "italic",
                      }}
                    >
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
