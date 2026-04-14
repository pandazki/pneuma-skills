import { useCallback } from "react";
import { useComposition, useDispatch, useUndo } from "@pneuma-craft/react";
import { buildCollapseGapsCommands } from "./collapseGaps.js";
import { useEditorTool, type ToolKind } from "../hooks/useEditorTool.js";

const baseBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 4,
  color: "#a1a1aa",
  padding: "0 9px",
  height: 22,
  cursor: "pointer",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 0.3,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "all 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

const activeBtn: React.CSSProperties = {
  ...baseBtn,
  background: "linear-gradient(135deg, rgba(249,115,22,0.32), rgba(249,115,22,0.08))",
  border: "1px solid rgba(249,115,22,0.55)",
  color: "#fed7aa",
  boxShadow: "0 0 12px rgba(249,115,22,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
};

const dangerActiveBtn: React.CSSProperties = {
  ...activeBtn,
  background: "linear-gradient(135deg, rgba(239,68,68,0.32), rgba(239,68,68,0.08))",
  border: "1px solid rgba(239,68,68,0.55)",
  color: "#fecaca",
  boxShadow: "0 0 12px rgba(239,68,68,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
};

const disabledBtn: React.CSSProperties = {
  ...baseBtn,
  opacity: 0.35,
  cursor: "not-allowed",
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: "rgba(255,255,255,0.08)",
  margin: "0 6px",
  flexShrink: 0,
};

export function EditToolbar() {
  const composition = useComposition();
  const dispatch = useDispatch();
  const undoState = useUndo();
  const tool = useEditorTool();

  const onCollapse = useCallback(() => {
    if (!composition) return;
    const cmds = buildCollapseGapsCommands(composition);
    for (const cmd of cmds) dispatch("human", cmd);
  }, [dispatch, composition]);

  const toggleTool = useCallback(
    (kind: ToolKind) => {
      tool.setTool(tool.activeTool === kind ? null : kind);
    },
    [tool],
  );

  const buttonStyle = (kind: ToolKind, danger: boolean): React.CSSProperties => {
    if (tool.activeTool === kind) return danger ? dangerActiveBtn : activeBtn;
    return baseBtn;
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <ToolButton
        label="Split"
        title="Split at hover X — click a clip to confirm (S)"
        kind="split"
        active={tool.activeTool === "split"}
        style={buttonStyle("split", false)}
        onClick={() => toggleTool("split")}
      />
      <ToolButton
        label="Delete"
        title="Delete a clip — click any clip to confirm (Delete)"
        kind="delete"
        active={tool.activeTool === "delete"}
        style={buttonStyle("delete", true)}
        onClick={() => toggleTool("delete")}
      />
      <ToolButton
        label="Duplicate"
        title="Duplicate a clip — click any clip to confirm (D)"
        kind="duplicate"
        active={tool.activeTool === "duplicate"}
        style={buttonStyle("duplicate", false)}
        onClick={() => toggleTool("duplicate")}
      />
      <ToolButton
        label="Ripple Del"
        title="Ripple delete — remove + close the gap (⌘⌫)"
        kind="ripple"
        active={tool.activeTool === "ripple"}
        style={buttonStyle("ripple", true)}
        onClick={() => toggleTool("ripple")}
      />
      <button onClick={onCollapse} style={baseBtn} title="Pack all clips left, removing gaps">
        Collapse
      </button>

      <div style={separatorStyle} />

      <button
        onClick={() => undoState.undo()}
        style={undoState.canUndo ? baseBtn : disabledBtn}
        disabled={!undoState.canUndo}
        title="Undo (⌘Z)"
      >
        Undo
      </button>
      <button
        onClick={() => undoState.redo()}
        style={undoState.canRedo ? baseBtn : disabledBtn}
        disabled={!undoState.canRedo}
        title="Redo (⌘⇧Z)"
      >
        Redo
      </button>
    </div>
  );
}

function ToolButton({
  label,
  title,
  kind,
  active,
  style,
  onClick,
}: {
  label: string;
  title: string;
  kind: ToolKind;
  active: boolean;
  style: React.CSSProperties;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={style}
      title={title}
      aria-pressed={active}
      data-tool={kind}
    >
      {label}
    </button>
  );
}
