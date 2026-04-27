import { useCallback, type ReactElement } from "react";
import { useComposition, useDispatch, useUndo } from "@pneuma-craft/react";
import { buildCollapseGapsCommands } from "./collapseGaps.js";
import { useEditorTool, type ToolKind } from "../hooks/useEditorTool.js";
import {
  ScissorsIcon,
  TrashIcon,
  CopyIcon,
  ZapIcon,
  CollapseIcon,
  UndoIcon,
  RedoIcon,
  type IconProps,
} from "../../icons/index.js";
import { theme } from "../../theme/tokens.js";

const BTN_HEIGHT = 24;

const baseBtn: React.CSSProperties = {
  background: theme.color.surface2,
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.sm,
  color: theme.color.ink2,
  padding: `0 ${theme.space.space3}px`,
  height: BTN_HEIGHT,
  cursor: "pointer",
  fontFamily: theme.font.ui,
  fontSize: theme.text.xs,
  fontWeight: theme.text.weightSemibold,
  letterSpacing: theme.text.trackingCaps,
  textTransform: "uppercase",
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: theme.space.space2,
  transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
};

const activeBtn: React.CSSProperties = {
  ...baseBtn,
  background: theme.color.accentSoft,
  border: `1px solid ${theme.color.accentBorder}`,
  color: theme.color.accentBright,
};

const dangerActiveBtn: React.CSSProperties = {
  ...baseBtn,
  background: theme.color.dangerSoft,
  border: `1px solid ${theme.color.dangerBorder}`,
  color: theme.color.dangerInk,
};

const disabledBtn: React.CSSProperties = {
  ...baseBtn,
  opacity: 0.35,
  cursor: "not-allowed",
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: theme.color.borderWeak,
  margin: `0 ${theme.space.space2}px`,
  flexShrink: 0,
};

interface ToolButtonProps {
  label: string;
  title: string;
  kind: ToolKind;
  active: boolean;
  Icon: (props: IconProps) => ReactElement;
  style: React.CSSProperties;
  onClick: () => void;
}

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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.space.space1,
        fontFamily: theme.font.ui,
      }}
    >
      <ToolButton
        label="Split"
        title="Split at hover X — click a clip to confirm (S)"
        kind="split"
        Icon={ScissorsIcon}
        active={tool.activeTool === "split"}
        style={buttonStyle("split", false)}
        onClick={() => toggleTool("split")}
      />
      <ToolButton
        label="Delete"
        title="Delete a clip — click any clip to confirm (Delete)"
        kind="delete"
        Icon={TrashIcon}
        active={tool.activeTool === "delete"}
        style={buttonStyle("delete", true)}
        onClick={() => toggleTool("delete")}
      />
      <ToolButton
        label="Duplicate"
        title="Duplicate a clip — click any clip to confirm (D)"
        kind="duplicate"
        Icon={CopyIcon}
        active={tool.activeTool === "duplicate"}
        style={buttonStyle("duplicate", false)}
        onClick={() => toggleTool("duplicate")}
      />
      <ToolButton
        label="Ripple"
        title="Ripple delete — remove + close the gap (⌘⌫)"
        kind="ripple"
        Icon={ZapIcon}
        active={tool.activeTool === "ripple"}
        style={buttonStyle("ripple", true)}
        onClick={() => toggleTool("ripple")}
      />
      <button
        type="button"
        onClick={onCollapse}
        style={baseBtn}
        title="Pack all clips left, removing gaps"
      >
        <CollapseIcon size={13} />
        <span>Collapse</span>
      </button>

      <div style={separatorStyle} />

      <button
        type="button"
        onClick={() => undoState.undo()}
        style={undoState.canUndo ? baseBtn : disabledBtn}
        disabled={!undoState.canUndo}
        title="Undo (⌘Z)"
      >
        <UndoIcon size={13} />
        <span>Undo</span>
      </button>
      <button
        type="button"
        onClick={() => undoState.redo()}
        style={undoState.canRedo ? baseBtn : disabledBtn}
        disabled={!undoState.canRedo}
        title="Redo (⌘⇧Z)"
      >
        <RedoIcon size={13} />
        <span>Redo</span>
      </button>
    </div>
  );
}

function ToolButton({
  label,
  title,
  kind,
  active,
  Icon,
  style,
  onClick,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      title={title}
      aria-pressed={active}
      data-tool={kind}
    >
      <Icon size={13} />
      <span>{label}</span>
    </button>
  );
}
