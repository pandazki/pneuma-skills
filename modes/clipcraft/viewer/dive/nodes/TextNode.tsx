import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../useTreeLayout.js";
import { NodeShell } from "./NodeShell.js";

export function TextNode({ data }: NodeProps) {
  const { asset, isActive, isFocused, clipId } = data as unknown as TreeNodeData;
  // For caption-layer synthetic nodes we stuff the clip text into
  // asset.name via the DiveCanvas adapter.
  const body = asset.name || "";

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />
      <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
        <div style={{
          background: "#292524", borderRadius: 6, padding: "8px 10px",
          fontSize: 12, color: "#e5e5e5", lineHeight: 1.5, minHeight: 40,
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
        }}>
          {body || <span style={{ color: "#52525b", fontStyle: "italic" }}>Empty</span>}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
