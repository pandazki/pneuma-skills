// modes/clipcraft/viewer/SceneCard.tsx
import type { Scene } from "../types.js";
import { useWorkspaceUrl } from "./hooks/useWorkspaceUrl.js";

interface SceneCardProps {
  scene: Scene;
  index: number;
  isSelected: boolean;
  onSelect: (sceneId: string) => void;
}

export function SceneCard({ scene, index, isSelected, onSelect }: SceneCardProps) {
  const url = useWorkspaceUrl();
  const status = scene.visual?.status ?? "pending";

  return (
    <div
      onClick={() => onSelect(scene.id)}
      style={{
        flex: "0 0 160px",
        height: "100%",
        borderRadius: 8,
        overflow: "hidden",
        border: isSelected ? "2px solid #f97316" : "2px solid transparent",
        background: "#18181b",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.15s",
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          background: "#0a0a0a",
        }}
      >
        {status === "ready" && (scene.visual?.thumbnail || scene.visual?.source) ? (
          (() => {
            const src = scene.visual!.thumbnail ?? scene.visual!.source!;
            const isVideo = /\.(mp4|webm|mov)$/i.test(src);
            const resolved = url(src);
            return isVideo ? (
              <video
                src={resolved}
                muted
                playsInline
                preload="metadata"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onLoadedData={(e) => {
                  (e.target as HTMLVideoElement).currentTime = 0.1;
                }}
              />
            ) : (
              <img src={resolved} alt={`Scene ${index + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            );
          })()
        ) : status === "generating" ? (
          <div style={{ color: "#a1a1aa", fontSize: 12, textAlign: "center", padding: 8 }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>&#x23F3;</div>
            Generating...
          </div>
        ) : status === "error" ? (
          <div style={{ color: "#ef4444", fontSize: 12, textAlign: "center", padding: 8 }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>&#x26A0;&#xFE0F;</div>
            Error
          </div>
        ) : (
          <div style={{ color: "#71717a", fontSize: 12, textAlign: "center", padding: 8 }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>&#x1F3AC;</div>
            Pending
          </div>
        )}

        {/* Duration badge */}
        <div
          style={{
            position: "absolute",
            bottom: 4,
            right: 4,
            background: "rgba(0,0,0,0.7)",
            color: "#e4e4e7",
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            fontFamily: "monospace",
          }}
        >
          {scene.duration.toFixed(1)}s
        </div>
      </div>

      {/* Scene label */}
      <div
        style={{
          padding: "4px 8px",
          fontSize: 11,
          color: "#a1a1aa",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        Scene {index + 1}
        {scene.caption ? ` \u2014 ${scene.caption.slice(0, 30)}` : ""}
      </div>
    </div>
  );
}
