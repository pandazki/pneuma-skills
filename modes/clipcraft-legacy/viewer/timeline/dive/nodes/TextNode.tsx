import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../use-tree-layout.js";
import { NodeShell } from "./NodeShell.js";

export function TextNode({ data }: NodeProps) {
  const { graphNode, isActive, isFocused, clipId, slot } = data as TreeNodeData;

  return (
    <>
      {graphNode.parentId && <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />}
      <NodeShell graphNode={graphNode} isActive={isActive} isFocused={isFocused} clipId={clipId} slot={slot}>
        <div style={{
          background: "#292524",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 12,
          color: "#e5e5e5",
          lineHeight: 1.5,
          minHeight: 40,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
        }}>
          {graphNode.content || <span style={{ color: "#52525b", fontStyle: "italic" }}>Empty</span>}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
