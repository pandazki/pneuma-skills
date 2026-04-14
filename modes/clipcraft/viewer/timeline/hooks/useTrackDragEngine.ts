import { useCallback, useEffect, useRef, useState } from "react";
import type { Track, CompositionCommand } from "@pneuma-craft/timeline";
import type { Actor, CoreCommand } from "@pneuma-craft/core";
import {
  computeRipplePreview,
  snapDraggedStart,
  type DragState,
} from "../dragEngine.js";

type Dispatch = (
  actor: Actor,
  cmd: CoreCommand | CompositionCommand,
) => unknown;

export interface UseTrackDragEngine {
  dragState: DragState | null;
  handleDragStart: (clipId: string, mouseX: number) => void;
  /** Returns the display startTime (in seconds) for a clip — the dragged
   *  clip follows the cursor, others follow the ripple. Returns null to
   *  mean "use the clip's canonical startTime". */
  displayStartFor: (clipId: string) => number | null;
}

const SNAP_PX = 5;

/**
 * Document-level mouse drag state machine for one track. Binds mousemove /
 * mouseup when a drag starts, unbinds when it ends. Dispatches a single
 * `composition:move-clip` on release if the final position differs from
 * the clip's original startTime.
 *
 * Structure mirrors @pneuma-craft/react-ui/src/timeline/timeline-track.tsx.
 */
export function useTrackDragEngine(
  track: Track,
  pixelsPerSecond: number,
  dispatch: Dispatch,
): UseTrackDragEngine {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const clipsRef = useRef(track.clips);
  clipsRef.current = track.clips;
  const ppsRef = useRef(pixelsPerSecond);
  ppsRef.current = pixelsPerSecond;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const handleDragStart = useCallback(
    (clipId: string, mouseX: number) => {
      const clip = clipsRef.current.find((c) => c.id === clipId);
      if (!clip) return;
      const initial: DragState = {
        clipId,
        startMouseX: mouseX,
        startClipTime: clip.startTime,
        positions: computeRipplePreview(clipsRef.current, clipId, clip.startTime),
        snapTime: null,
      };
      dragRef.current = initial;
      setDragState(initial);
    },
    [],
  );

  useEffect(() => {
    if (!dragState) return;

    const onMove = (ev: MouseEvent) => {
      const ds = dragRef.current;
      const pps = ppsRef.current;
      if (!ds || pps <= 0) return;

      const deltaX = ev.clientX - ds.startMouseX;
      const deltaT = deltaX / pps;
      const candidate = ds.startClipTime + deltaT;
      const { start, snapTime } = snapDraggedStart(
        clipsRef.current,
        ds.clipId,
        candidate,
        SNAP_PX / pps,
      );
      const positions = computeRipplePreview(clipsRef.current, ds.clipId, start);
      const next: DragState = { ...ds, positions, snapTime };
      dragRef.current = next;
      setDragState(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const ds = dragRef.current;
      if (ds) {
        const finalStart = ds.positions.get(ds.clipId);
        const clip = clipsRef.current.find((c) => c.id === ds.clipId);
        if (
          finalStart !== undefined &&
          clip &&
          Math.abs(finalStart - clip.startTime) > 1e-6
        ) {
          dispatchRef.current("human", {
            type: "composition:move-clip",
            clipId: ds.clipId,
            startTime: finalStart,
          });
        }
      }
      dragRef.current = null;
      setDragState(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // Re-bind only when a new drag begins, not on every position tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState?.clipId]);

  const displayStartFor = useCallback(
    (clipId: string): number | null => {
      if (!dragState) return null;
      const p = dragState.positions.get(clipId);
      return p ?? null;
    },
    [dragState],
  );

  return { dragState, handleDragStart, displayStartFor };
}
