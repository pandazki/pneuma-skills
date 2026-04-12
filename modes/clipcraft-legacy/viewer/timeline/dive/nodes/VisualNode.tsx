import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../use-tree-layout.js";
import { NodeShell } from "./NodeShell.js";
import { useWorkspaceUrl } from "../../../hooks/useWorkspaceUrl.js";

export function VisualNode({ data }: NodeProps) {
  const { graphNode, isActive, isFocused, clipId, slot } = data as TreeNodeData;
  const url = useWorkspaceUrl();
  const thumbnail = (graphNode.metadata?.thumbnail as string) ?? graphNode.source;

  return (
    <>
      {graphNode.parentId && <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />}
      <NodeShell graphNode={graphNode} isActive={isActive} isFocused={isFocused} clipId={clipId} slot={slot}>
        <div style={{
          width: "100%",
          height: 90,
          background: "#292524",
          borderRadius: 6,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          {thumbnail && graphNode.status === "ready" ? (
            <img
              src={url(thumbnail)}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              draggable={false}
            />
          ) : graphNode.status === "generating" ? (
            <span style={{ color: "#f59e0b", fontSize: 11 }}>Generating...</span>
          ) : graphNode.status === "error" ? (
            <span style={{ color: "#ef4444", fontSize: 11 }}>
              {(graphNode.metadata?.errorMessage as string) ?? "Error"}
            </span>
          ) : (
            <span style={{ color: "#52525b", fontSize: 11 }}>
              {graphNode.kind === "video" ? "Video" : "Image"}
            </span>
          )}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
