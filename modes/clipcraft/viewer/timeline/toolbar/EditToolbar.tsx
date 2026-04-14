import { useCallback } from "react";
import {
  useComposition,
  usePlayback,
  useSelection,
  useDispatch,
  useUndo,
} from "@pneuma-craft/react";
import { buildCollapseGapsCommands } from "./collapseGaps.js";
import { buildRippleDeleteCommands } from "./rippleDelete.js";

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

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: "#27272a",
  margin: "0 4px",
  flexShrink: 0,
};

export function EditToolbar() {
  const composition = useComposition();
  const playback = usePlayback();
  const selection = useSelection();
  const dispatch = useDispatch();
  const undoState = useUndo();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const canActOnClip = selectedClipId !== null;

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

  const onDuplicate = useCallback(() => {
    if (!selectedClipId) return;
    dispatch("human", {
      type: "composition:duplicate-clip",
      clipId: selectedClipId,
    });
  }, [dispatch, selectedClipId]);

  const onRippleDelete = useCallback(() => {
    if (!selectedClipId || !composition) return;
    const cmds = buildRippleDeleteCommands(composition, selectedClipId);
    for (const cmd of cmds) dispatch("human", cmd);
  }, [dispatch, selectedClipId, composition]);

  const onCollapse = useCallback(() => {
    if (!composition) return;
    const cmds = buildCollapseGapsCommands(composition);
    for (const cmd of cmds) dispatch("human", cmd);
  }, [dispatch, composition]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {/* Edit group */}
      <button
        onClick={onSplit}
        style={canActOnClip ? btnStyle : btnDisabled}
        disabled={!canActOnClip}
        title="Split at playhead (S)"
      >
        Split
      </button>
      <button
        onClick={onDelete}
        style={canActOnClip ? btnStyle : btnDisabled}
        disabled={!canActOnClip}
        title="Delete (Delete)"
      >
        Delete
      </button>
      <button
        onClick={onDuplicate}
        style={canActOnClip ? btnStyle : btnDisabled}
        disabled={!canActOnClip}
        title="Duplicate (D)"
      >
        Duplicate
      </button>
      <button
        onClick={onRippleDelete}
        style={canActOnClip ? btnStyle : btnDisabled}
        disabled={!canActOnClip}
        title="Ripple delete — remove + close the gap (⌘⌫)"
      >
        Ripple Del
      </button>
      <button onClick={onCollapse} style={btnStyle} title="Pack all clips left, removing gaps">
        Collapse
      </button>

      <div style={separatorStyle} />

      {/* History group */}
      <button
        onClick={() => undoState.undo()}
        style={undoState.canUndo ? btnStyle : btnDisabled}
        disabled={!undoState.canUndo}
        title="Undo (⌘Z)"
      >
        Undo
      </button>
      <button
        onClick={() => undoState.redo()}
        style={undoState.canRedo ? btnStyle : btnDisabled}
        disabled={!undoState.canRedo}
        title="Redo (⌘⇧Z)"
      >
        Redo
      </button>
    </div>
  );
}
