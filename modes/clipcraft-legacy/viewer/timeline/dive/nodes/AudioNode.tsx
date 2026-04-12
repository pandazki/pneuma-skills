import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../use-tree-layout.js";
import { NodeShell } from "./NodeShell.js";

export function AudioNode({ data }: NodeProps) {
  const { graphNode, isActive, isFocused, clipId, slot } = data as TreeNodeData;
  const voice = graphNode.metadata?.voice as string | undefined;
  const duration = graphNode.metadata?.duration as number | undefined;

  return (
    <>
      {graphNode.parentId && <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />}
      <NodeShell graphNode={graphNode} isActive={isActive} isFocused={isFocused} clipId={clipId} slot={slot}>
        {graphNode.content && (
          <div style={{
            background: "#292524",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 11,
            color: "#d4d4d8",
            lineHeight: 1.4,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}>
            {graphNode.content}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: "#71717a" }}>
          {voice && <span>Voice: {voice}</span>}
          {duration != null && <span>{duration.toFixed(1)}s</span>}
        </div>
        {graphNode.status === "generating" && (
          <div style={{ marginTop: 6, fontSize: 10, color: "#f59e0b" }}>Generating...</div>
        )}
        {graphNode.status === "error" && (
          <div style={{ marginTop: 6, fontSize: 10, color: "#ef4444" }}>
            {(graphNode.metadata?.errorMessage as string) ?? "Generation failed"}
          </div>
        )}
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
