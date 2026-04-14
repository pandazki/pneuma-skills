import { useCallback } from "react";
import { useComposition, useDispatch } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { buildRippleDeleteCommands } from "../toolbar/rippleDelete.js";
import { useEditorTool } from "./useEditorTool.js";

/**
 * Tool-mode click handler shared by all three track components.
 *
 * If a tool is active, run the corresponding craft command against the
 * clicked clip and exit the tool. Returns `true` if the click was
 * consumed by tool mode (the caller should NOT proceed with normal
 * select/drag) or `false` otherwise.
 *
 * Split is special: it needs the cursor X position within the clip
 * (in CSS pixels) to compute the absolute split time.
 */
export function useClipToolAction() {
  const tool = useEditorTool();
  const dispatch = useDispatch();
  const composition = useComposition();

  return useCallback(
    (clip: Clip, localPx: number, pixelsPerSecond: number): boolean => {
      if (!tool.activeTool) return false;
      switch (tool.activeTool) {
        case "split": {
          if (pixelsPerSecond <= 0) {
            tool.cancel();
            return true;
          }
          const offsetSec = localPx / pixelsPerSecond;
          // Clamp to (0, duration) — splitting at the boundary is a no-op
          // and craft will reject it. Leave a tiny epsilon margin.
          const minOffset = 0.05;
          const maxOffset = Math.max(minOffset, clip.duration - minOffset);
          const clamped = Math.max(minOffset, Math.min(maxOffset, offsetSec));
          dispatch("human", {
            type: "composition:split-clip",
            clipId: clip.id,
            time: clip.startTime + clamped,
          });
          break;
        }
        case "delete":
          dispatch("human", { type: "composition:remove-clip", clipId: clip.id });
          break;
        case "duplicate":
          dispatch("human", { type: "composition:duplicate-clip", clipId: clip.id });
          break;
        case "ripple":
          if (composition) {
            for (const cmd of buildRippleDeleteCommands(composition, clip.id)) {
              dispatch("human", cmd);
            }
          }
          break;
      }
      tool.cancel();
      return true;
    },
    [tool, dispatch, composition],
  );
}
