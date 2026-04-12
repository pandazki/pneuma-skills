import type { Scene } from "../../types.js";

const TRACK_H = 32;

interface Props {
  scenes: Scene[];
  totalDuration: number;
  selectedSceneId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
}

export function CaptionTrack({ scenes, totalDuration, selectedSceneId, pixelsPerSecond, scrollLeft }: Props) {
  let offset = 0;

  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {scenes.map((scene) => {
        const x = offset * pixelsPerSecond - scrollLeft;
        const w = scene.duration * pixelsPerSecond;
        offset += scene.duration;

        const sel = scene.id === selectedSceneId;

        // Skip if entirely off-screen
        if (x + w < -10 || x > 2000) return null;

        return (
          <div
            key={scene.id}
            style={{
              position: "absolute",
              left: x,
              width: w - 1, // 1px gap between blocks
              height: TRACK_H - 4,
              top: 2,
              background: sel ? "#2d2519" : "#1a1a1e",
              borderRadius: 3,
              border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
              overflow: "hidden",
              padding: "2px 6px",
              fontSize: 9,
              lineHeight: `${TRACK_H - 8}px`,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              color: scene.caption ? (sel ? "#e4e4e7" : "#a1a1aa") : "#3f3f46",
              boxSizing: "border-box",
            }}
          >
            {scene.caption ?? ""}
          </div>
        );
      })}
    </div>
  );
}
