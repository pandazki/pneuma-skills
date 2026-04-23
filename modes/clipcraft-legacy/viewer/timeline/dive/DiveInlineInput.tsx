import { useState, useCallback } from "react";
import { sendUserMessage } from "../../../../../src/ws.js";
import { useClipCraftState } from "../../store/ClipCraftContext.js";
import type { LayerType } from "../../store/types.js";

interface Props {
  layer: LayerType;
  clipId: string;
  focusedNodeId: string | null;
}

export function DiveInlineInput({ layer, clipId, focusedNodeId }: Props) {
  const [text, setText] = useState("");
  const state = useClipCraftState();
  const focusedNode = focusedNodeId ? state.graph.nodes[focusedNodeId] : null;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const contextAttrs = [
      `layer="${layer}"`,
      `clipId="${clipId}"`,
      focusedNodeId ? `focusedNodeId="${focusedNodeId}"` : "",
    ].filter(Boolean).join(" ");

    const message = `<dive-context ${contextAttrs}>\n${trimmed}\n</dive-context>`;
    sendUserMessage(message);
    setText("");
  }, [text, layer, clipId, focusedNodeId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const nodeLabel = focusedNode
    ? (focusedNode.prompt?.slice(0, 30) ?? focusedNode.content?.slice(0, 30) ?? focusedNode.id)
    : null;

  return (
    <div style={{
      position: "absolute",
      bottom: 16,
      left: "50%",
      transform: "translateX(-50%)",
      background: "#1c1917",
      border: "1px solid #f97316",
      borderRadius: 10,
      padding: "10px 14px",
      display: "flex",
      gap: 8,
      alignItems: "center",
      width: 400,
      maxWidth: "calc(100% - 32px)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      zIndex: 10,
    }}>
      {nodeLabel && (
        <span style={{
          color: "#71717a",
          fontSize: 11,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 120,
          flexShrink: 0,
        }}>
          Based on: {nodeLabel}
        </span>
      )}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want to create..."
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          color: "#e5e5e5",
          fontSize: 12,
          fontFamily: "'Inter', system-ui, sans-serif",
          outline: "none",
          minWidth: 0,
        }}
      />
      <button
        onClick={handleSend}
        disabled={!text.trim()}
        style={{
          background: text.trim() ? "#f97316" : "#3f3f46",
          border: "none",
          borderRadius: 6,
          color: "#fff",
          cursor: text.trim() ? "pointer" : "default",
          padding: "4px 12px",
          fontSize: 11,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Send
      </button>
    </div>
  );
}
