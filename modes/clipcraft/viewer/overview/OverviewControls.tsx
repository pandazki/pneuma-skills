import type { ReactElement } from "react";
import type { CameraPreset } from "./useOverviewCamera.js";
import {
  CameraFrontIcon,
  CameraSideIcon,
  Layers3DIcon,
  ArrowDownIcon,
  type IconProps,
} from "../icons/index.js";
import { theme } from "../theme/tokens.js";

const PRESETS: Record<
  CameraPreset,
  { label: string; Icon: (p: IconProps) => ReactElement }
> = {
  exploded: { label: "Exploded", Icon: Layers3DIcon },
  front: { label: "Front", Icon: CameraFrontIcon },
  side: { label: "Side", Icon: CameraSideIcon },
};

interface Props {
  current: CameraPreset;
  presets: readonly CameraPreset[];
  onSelect: (preset: CameraPreset) => void;
  onCollapse: () => void;
}

const presetBtn = (active: boolean): React.CSSProperties => ({
  background: active ? theme.color.accentSoft : "transparent",
  border: `1px solid ${active ? theme.color.accentBorder : theme.color.border}`,
  borderRadius: theme.radius.sm,
  color: active ? theme.color.accentBright : theme.color.ink3,
  width: 28,
  height: 24,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
});

export function OverviewControls({
  current,
  presets,
  onSelect,
  onCollapse,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.space.space1,
        flexShrink: 0,
        fontFamily: theme.font.ui,
      }}
    >
      {presets.map((p) => {
        const { label, Icon } = PRESETS[p];
        const active = p === current;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onSelect(p)}
            title={label}
            aria-pressed={active}
            style={presetBtn(active)}
          >
            <Icon size={13} />
          </button>
        );
      })}
      <div
        style={{
          width: 1,
          height: 16,
          background: theme.color.borderWeak,
          margin: `0 ${theme.space.space1}px`,
        }}
      />
      <button
        type="button"
        onClick={onCollapse}
        title="Collapse"
        style={presetBtn(false)}
      >
        <ArrowDownIcon size={13} />
      </button>
    </div>
  );
}
