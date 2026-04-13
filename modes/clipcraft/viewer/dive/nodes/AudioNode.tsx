import { Handle, Position, type NodeProps } from "@xyflow/react";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import type { TreeNodeData } from "../useTreeLayout.js";
import { NodeShell } from "./NodeShell.js";

export function AudioNode({ data }: NodeProps) {
  const { asset, isActive, isFocused, clipId } = data as unknown as TreeNodeData;
  const coreState = usePneumaCraftStore((s) => s.coreState);

  let voice: string | undefined;
  let content: string | undefined;
  for (const e of coreState.provenance.edges.values()) {
    if (e.toAssetId === asset.id) {
      voice = e.operation.params?.voice as string | undefined;
      content = e.operation.params?.text as string | undefined;
      break;
    }
  }
  const duration = asset.metadata.duration;

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />
      <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
        {content && (
          <div style={{
            background: "#292524", borderRadius: 6, padding: "8px 10px",
            fontSize: 11, color: "#d4d4d8", lineHeight: 1.4,
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
          }}>
            {content}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: "#71717a" }}>
          {voice && <span>Voice: {voice}</span>}
          {duration != null && <span>{duration.toFixed(1)}s</span>}
        </div>
        {asset.status === "generating" && (
          <div style={{ marginTop: 6, fontSize: 10, color: "#f59e0b" }}>Generating...</div>
        )}
        {asset.status === "failed" && (
          <div style={{ marginTop: 6, fontSize: 10, color: "#ef4444" }}>Generation failed</div>
        )}
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
