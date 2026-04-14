import { useCallback } from "react";
import { useComposition, useDispatch, usePlayback } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { buildRippleDeleteCommands } from "../toolbar/rippleDelete.js";
import { collectSnapPoints, snapToNearest } from "../snapPoints.js";
import { useEditorTool } from "./useEditorTool.js";

const SPLIT_SNAP_PX = 5;

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
  const playback = usePlayback();

  return useCallback(
    (clip: Clip, localPx: number, pixelsPerSecond: number): boolean => {
      if (!tool.activeTool) return false;
      // Restore the scrub baseline BEFORE the tool teardown / dispatch.
      // The split-tool hover-scrub moved the engine's real currentTime
      // to the cursor for the preview frame, while the visible playhead
      // was rendered from tool.getDisplayTime (= baseline). If we let
      // tool.cancel() clear the baseline first, the playhead would
      // suddenly switch to reading the engine's currentTime (cursor X)
      // and animate across the gap — "flying in" to the split point.
      // Seeking back to the baseline first keeps the playhead anchored.
      const baseline = tool.restoreScrubBaseline();
      if (baseline !== null) {
        playback.seek(baseline);
      }
      switch (tool.activeTool) {
        case "split": {
          if (pixelsPerSecond <= 0) {
            tool.cancel();
            return true;
          }
          const offsetSec = localPx / pixelsPerSecond;
          let absoluteTime = clip.startTime + offsetSec;
          // Magnetic snap against every other clip edge (any track),
          // playhead, and t=0. Exclude the clip we're splitting so we
          // don't snap back onto its own edges.
          const snapPoints = collectSnapPoints(
            composition,
            new Set([clip.id]),
            playback.currentTime,
          );
          const snap = snapToNearest(
            absoluteTime,
            snapPoints,
            SPLIT_SNAP_PX / pixelsPerSecond,
          );
          if (snap.snappedTo !== null) absoluteTime = snap.time;
          // Clamp inside (clip.startTime, clip.startTime + duration)
          // with a tiny epsilon margin — craft rejects boundary splits.
          const minTime = clip.startTime + 0.05;
          const maxTime = clip.startTime + Math.max(0.05, clip.duration - 0.05);
          const clampedTime = Math.max(minTime, Math.min(maxTime, absoluteTime));
          dispatch("human", {
            type: "composition:split-clip",
            clipId: clip.id,
            time: clampedTime,
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
    [tool, dispatch, composition, playback],
  );
}
