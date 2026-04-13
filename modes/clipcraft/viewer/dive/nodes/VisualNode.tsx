import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../useTreeLayout.js";
import { NodeShell } from "./NodeShell.js";
import { useWorkspaceAssetUrl } from "../../assets/useWorkspaceAssetUrl.js";

export function VisualNode({ data }: NodeProps) {
  const { asset, isActive, isFocused, clipId } = data as unknown as TreeNodeData;
  const src = useWorkspaceAssetUrl(asset.id);
  const hasThumb = !!src && asset.status !== "failed" && asset.status !== "pending";

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />
      <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
        <div style={{
          width: "100%", height: 90, background: "#292524",
          borderRadius: 6, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {hasThumb ? (
            <img
              src={src}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              draggable={false}
            />
          ) : asset.status === "generating" ? (
            <span style={{ color: "#f59e0b", fontSize: 11 }}>Generating...</span>
          ) : asset.status === "failed" ? (
            <span style={{ color: "#ef4444", fontSize: 11 }}>Error</span>
          ) : (
            <span style={{ color: "#52525b", fontSize: 11 }}>
              {asset.type === "video" ? "Video" : "Image"}
            </span>
          )}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
