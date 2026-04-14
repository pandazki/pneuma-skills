import { useCallback } from "react";
import {
  useComposition,
  usePlayback,
  useSelection,
  useDispatch,
  useUndo,
} from "@pneuma-craft/react";
import { buildCollapseGapsCommands } from "./collapseGaps.js";

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #3f3f46",
  borderRadius: 3,
  color: "#a1a1aa",
  padding: "0 8px",
  height: 22,
  cursor: "pointer",
  fontSize: 10,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const btnDisabled: React.CSSProperties = {
  ...btnStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

export function EditToolbar() {
  const composition = useComposition();
  const playback = usePlayback();
  const selection = useSelection();
  const dispatch = useDispatch();
  const undoState = useUndo();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const canSplit = selectedClipId !== null && composition !== null;
  const canDelete = selectedClipId !== null;

  const onSplit = useCallback(() => {
    if (!selectedClipId) return;
    dispatch("human", {
      type: "composition:split-clip",
      clipId: selectedClipId,
      time: playback.currentTime,
    });
  }, [dispatch, selectedClipId, playback.currentTime]);

  const onDelete = useCallback(() => {
    if (!selectedClipId) return;
    dispatch("human", {
      type: "composition:remove-clip",
      clipId: selectedClipId,
    });
  }, [dispatch, selectedClipId]);

  const onCollapse = useCallback(() => {
    if (!composition) return;
    const cmds = buildCollapseGapsCommands(composition);
    for (const cmd of cmds) {
      dispatch("human", cmd);
    }
  }, [dispatch, composition]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={onSplit}
        style={canSplit ? btnStyle : btnDisabled}
        disabled={!canSplit}
        title="Split selected clip at playhead (S)"
      >
        Split
      </button>
      <button
        onClick={onDelete}
        style={canDelete ? btnStyle : btnDisabled}
        disabled={!canDelete}
        title="Delete selected clip (Delete)"
      >
        Delete
      </button>
      <button
        onClick={onCollapse}
        style={btnStyle}
        title="Pack all clips left, removing gaps"
      >
        Collapse Gaps
      </button>
      <div style={{ width: 1, height: 16, background: "#27272a", margin: "0 2px" }} />
      <button
        onClick={() => undoState.undo()}
        style={undoState.canUndo ? btnStyle : btnDisabled}
        disabled={!undoState.canUndo}
        title="Undo (⌘/Ctrl+Z)"
      >
        Undo
      </button>
      <button
        onClick={() => undoState.redo()}
        style={undoState.canRedo ? btnStyle : btnDisabled}
        disabled={!undoState.canRedo}
        title="Redo (⌘/Ctrl+Shift+Z)"
      >
        Redo
      </button>
    </div>
  );
}
