import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../useTreeLayout.js";
import { NodeShell } from "./NodeShell.js";
import { theme } from "../../theme/tokens.js";

const handleStyle = {
  background: theme.color.borderStrong,
  width: 8,
  height: 8,
  border: `1px solid ${theme.color.surface0}`,
};

export function TextNode({ data }: NodeProps) {
  const { asset, isActive, isFocused, clipId } = data as unknown as TreeNodeData;
  // For caption-layer synthetic nodes we stuff the clip text into
  // asset.name via the DiveCanvas adapter.
  const body = asset.name || "";

  return (
    <>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
        <div
          style={{
            background: theme.color.surface2,
            borderRadius: theme.radius.sm,
            padding: `${theme.space.space2}px ${theme.space.space3}px`,
            fontFamily: theme.font.display,
            fontSize: theme.text.base,
            color: theme.color.ink0,
            lineHeight: theme.text.lineHeightSnug,
            letterSpacing: theme.text.trackingTight,
            minHeight: 40,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical",
          }}
        >
          {body || (
            <span
              style={{
                color: theme.color.ink5,
                fontStyle: "italic",
              }}
            >
              Empty
            </span>
          )}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </>
  );
}
