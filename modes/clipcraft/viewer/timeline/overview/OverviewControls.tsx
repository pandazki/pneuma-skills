import type { CameraPreset } from "./useOverviewCamera.js";

const PRESET_LABELS: Record<CameraPreset, { label: string; icon: string }> = {
  exploded: { label: "Exploded", icon: "💥" },
  front: { label: "Front", icon: "⏺" },
  side: { label: "Side", icon: "◧" },
};

interface Props {
  current: CameraPreset;
  presets: readonly CameraPreset[];
  onSelect: (preset: CameraPreset) => void;
  onCollapse: () => void;
}

export function OverviewControls({ current, presets, onSelect, onCollapse }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}
    >
      {presets.map((p) => (
        <button
          key={p}
          onClick={() => onSelect(p)}
          title={PRESET_LABELS[p].label}
          style={{
            background: p === current ? "#27272a" : "transparent",
            border: "1px solid #3f3f46",
            borderRadius: 3,
            color: p === current ? "#f97316" : "#71717a",
            width: 28,
            height: 24,
            cursor: "pointer",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {PRESET_LABELS[p].icon}
        </button>
      ))}

      <div style={{ width: 1, height: 16, background: "#27272a", margin: "0 4px" }} />

      <button
        onClick={onCollapse}
        title="Collapse"
        style={{
          background: "transparent",
          border: "1px solid #3f3f46",
          borderRadius: 3,
          color: "#71717a",
          width: 28,
          height: 24,
          cursor: "pointer",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ↓
      </button>
    </div>
  );
}
