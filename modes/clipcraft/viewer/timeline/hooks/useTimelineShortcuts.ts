import { useEffect } from "react";
import {
  useComposition,
  useDispatch,
  usePlayback,
  useSelection,
  useUndo,
} from "@pneuma-craft/react";
import { buildRippleDeleteCommands } from "../toolbar/rippleDelete.js";

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useTimelineShortcuts(): void {
  const composition = useComposition();
  const dispatch = useDispatch();
  const playback = usePlayback();
  const selection = useSelection();
  const undoState = useUndo();

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (isEditableTarget(ev.target)) return;
      const mod = ev.metaKey || ev.ctrlKey;
      const key = ev.key;

      if (mod && (key === "z" || key === "Z")) {
        ev.preventDefault();
        if (ev.shiftKey) undoState.redo();
        else undoState.undo();
        return;
      }

      if (key === " " || key === "Spacebar") {
        ev.preventDefault();
        if (playback.state === "playing") playback.pause();
        else playback.play();
        return;
      }
      if (key === "Home") {
        ev.preventDefault();
        playback.seek(0);
        return;
      }
      if (key === "End") {
        ev.preventDefault();
        playback.seek(Math.max(0, playback.duration ?? 0));
        return;
      }

      const selectedClipId =
        selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

      if (!selectedClipId) return;

      if (key === "Delete" || key === "Backspace") {
        ev.preventDefault();
        if (mod && composition) {
          const cmds = buildRippleDeleteCommands(composition, selectedClipId);
          for (const cmd of cmds) dispatch("human", cmd);
        } else {
          dispatch("human", { type: "composition:remove-clip", clipId: selectedClipId });
        }
        return;
      }

      if (key === "d" || key === "D") {
        if (mod) return; // Don't interfere with ⌘D bookmark
        ev.preventDefault();
        dispatch("human", {
          type: "composition:duplicate-clip",
          clipId: selectedClipId,
        });
        return;
      }

      if (key === "s" || key === "S") {
        ev.preventDefault();
        dispatch("human", {
          type: "composition:split-clip",
          clipId: selectedClipId,
          time: playback.currentTime,
        });
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composition, dispatch, playback, selection, undoState]);
}
