import type { ReactElement } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../useTreeLayout.js";
import { NodeShell } from "./NodeShell.js";
import { useWorkspaceAssetUrl } from "../../assets/useWorkspaceAssetUrl.js";
import {
  HourglassIcon,
  WarningIcon,
  VideoIcon,
  type IconProps,
} from "../../icons/index.js";
import { theme } from "../../theme/tokens.js";

const handleStyle = {
  background: theme.color.borderStrong,
  width: 8,
  height: 8,
  border: `1px solid ${theme.color.surface0}`,
};

const placeholderRow = (
  Icon: (p: IconProps) => ReactElement,
  text: string,
  color: string,
) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: theme.space.space1,
      fontFamily: theme.font.ui,
      fontSize: theme.text.sm,
      color,
      letterSpacing: theme.text.trackingWide,
    }}
  >
    <Icon size={12} />
    {text}
  </div>
);

export function VisualNode({ data }: NodeProps) {
  const { asset, isActive, isFocused, clipId } = data as unknown as TreeNodeData;
  const src = useWorkspaceAssetUrl(asset.id);
  const hasThumb = !!src && asset.status !== "failed" && asset.status !== "pending";

  return (
    <>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
        <div
          style={{
            width: "100%",
            height: 96,
            background: theme.color.surface2,
            borderRadius: theme.radius.sm,
            border: `1px solid ${theme.color.borderWeak}`,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {hasThumb ? (
            <img
              src={src}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              draggable={false}
            />
          ) : asset.status === "generating" ? (
            placeholderRow(HourglassIcon, "Generating…", theme.color.warnInk)
          ) : asset.status === "failed" ? (
            placeholderRow(WarningIcon, "Error", theme.color.dangerInk)
          ) : (
            placeholderRow(
              VideoIcon,
              asset.type === "video" ? "Video" : "Image",
              theme.color.ink4,
            )
          )}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </>
  );
}
