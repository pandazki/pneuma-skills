import { Handle, Position, type NodeProps } from "@xyflow/react";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import type { TreeNodeData } from "../useTreeLayout.js";
import { NodeShell } from "./NodeShell.js";
import { HourglassIcon, WarningIcon } from "../../icons/index.js";
import { theme } from "../../theme/tokens.js";

const handleStyle = {
  background: theme.color.borderStrong,
  width: 8,
  height: 8,
  border: `1px solid ${theme.color.surface0}`,
};

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
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <NodeShell asset={asset} isActive={isActive} isFocused={isFocused} clipId={clipId}>
        {content && (
          <div
            style={{
              background: theme.color.surface2,
              borderRadius: theme.radius.sm,
              padding: `${theme.space.space2}px ${theme.space.space3}px`,
              fontFamily: theme.font.ui,
              fontSize: theme.text.sm,
              color: theme.color.ink1,
              lineHeight: theme.text.lineHeightSnug,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
            }}
          >
            {content}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: theme.space.space3,
            marginTop: theme.space.space2,
            fontFamily: theme.font.numeric,
            fontVariantNumeric: "tabular-nums",
            fontSize: theme.text.xs,
            color: theme.color.ink4,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {voice && <span>Voice · {voice}</span>}
          {duration != null && <span>{duration.toFixed(1)}s</span>}
        </div>
        {asset.status === "generating" && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: theme.space.space1,
              marginTop: theme.space.space2,
              fontFamily: theme.font.ui,
              fontSize: theme.text.xs,
              color: theme.color.warnInk,
              letterSpacing: theme.text.trackingWide,
            }}
          >
            <HourglassIcon size={11} />
            Generating…
          </div>
        )}
        {asset.status === "failed" && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: theme.space.space1,
              marginTop: theme.space.space2,
              fontFamily: theme.font.ui,
              fontSize: theme.text.xs,
              color: theme.color.dangerInk,
              letterSpacing: theme.text.trackingWide,
            }}
          >
            <WarningIcon size={11} />
            Generation failed
          </div>
        )}
      </NodeShell>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </>
  );
}
