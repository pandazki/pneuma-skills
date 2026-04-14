import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "@pneuma-craft/react";
import type { Composition, Track } from "@pneuma-craft/timeline";

export const DRAG_MIME_PREFIX = "application/x-clipcraft-track-reorder";

export type InsertPosition = "above" | "below";

export interface ReorderHoverState {
  /** True when a track-reorder drag is hovering over any row. */
  hovering: boolean;
  /** Id of the row currently under the pointer. */
  targetRowId: string | null;
  /** Whether the drop would insert above or below the target row. */
  position: InsertPosition;
  /** Id of the row being dragged — used to hide the source row's
   *  indicator so we don't show "insert above myself". */
  draggedRowId: string | null;
}

const INITIAL: ReorderHoverState = {
  hovering: false,
  targetRowId: null,
  position: "above",
  draggedRowId: null,
};

export interface TrackReorderApi {
  state: ReorderHoverState;
  /** Begin dragging a track. Call from `onDragStart` on TrackLabel. */
  onDragStart: (e: React.DragEvent, track: Track) => void;
  /** Per-row handlers — pass to the track row wrapper in Timeline.tsx. */
  rowHandlers: (track: Track) => {
    onDragEnter: React.DragEventHandler<HTMLDivElement>;
    onDragOver: React.DragEventHandler<HTMLDivElement>;
    onDragLeave: React.DragEventHandler<HTMLDivElement>;
    onDrop: React.DragEventHandler<HTMLDivElement>;
  };
}

/**
 * Row-reorder drag-drop controller. Owns a single global hover state
 * that rows use to render insertion indicators.
 *
 * Architecture: TrackLabel's root div starts a drag with a custom
 * MIME type carrying the track id. Each Timeline row is a drop zone
 * that (on dragover) computes above/below based on the pointer's
 * relative Y in the row — above if the pointer is in the top half,
 * below if in the bottom half. On drop, we rebuild `trackIds` with
 * the dragged track moved to the computed position and dispatch
 * `composition:reorder-tracks`.
 *
 * Why a single shared hook rather than per-row `useTrackDropTarget`
 * style: track reorder is a composition-wide operation — we need
 * the final `trackIds[]` list all at once, not per-row. Sharing a
 * hover state also makes the "only one indicator at a time" rule
 * natural.
 */
export function useTrackReorder(composition: Composition | null): TrackReorderApi {
  const dispatch = useDispatch();
  const [state, setState] = useState<ReorderHoverState>(INITIAL);
  const enterCountRef = useRef(new Map<string, number>());

  // Reset on any global drag end — catches "drop outside window".
  useEffect(() => {
    const reset = () => {
      enterCountRef.current.clear();
      setState(INITIAL);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);

  const isReorderDrag = useCallback((e: React.DragEvent | DragEvent): string | null => {
    for (const type of e.dataTransfer?.types ?? []) {
      if (type.startsWith(DRAG_MIME_PREFIX)) {
        return type.slice(DRAG_MIME_PREFIX.length + 1) || null;
      }
    }
    return null;
  }, []);

  const onDragStart = useCallback((e: React.DragEvent, track: Track) => {
    const mime = `${DRAG_MIME_PREFIX}+${track.id}`;
    e.dataTransfer.setData(mime, track.id);
    e.dataTransfer.setData("text/plain", track.id);
    e.dataTransfer.effectAllowed = "move";
    setState({
      hovering: false,
      targetRowId: null,
      position: "above",
      draggedRowId: track.id,
    });
  }, []);

  const computePosition = useCallback(
    (e: React.DragEvent<HTMLDivElement>): InsertPosition => {
      const rect = e.currentTarget.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      return localY < rect.height / 2 ? "above" : "below";
    },
    [],
  );

  const rowHandlers = useCallback(
    (track: Track) => {
      return {
        onDragEnter: (e: React.DragEvent<HTMLDivElement>) => {
          const draggedId = isReorderDrag(e);
          if (!draggedId) return;
          e.preventDefault();
          const counts = enterCountRef.current;
          counts.set(track.id, (counts.get(track.id) ?? 0) + 1);
          setState({
            hovering: true,
            targetRowId: track.id,
            position: computePosition(e),
            draggedRowId: draggedId,
          });
        },
        onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
          const draggedId = isReorderDrag(e);
          if (!draggedId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const position = computePosition(e);
          setState((prev) =>
            prev.targetRowId === track.id &&
            prev.position === position &&
            prev.draggedRowId === draggedId
              ? prev
              : {
                  hovering: true,
                  targetRowId: track.id,
                  position,
                  draggedRowId: draggedId,
                },
          );
        },
        onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
          if (!isReorderDrag(e)) return;
          const counts = enterCountRef.current;
          const next = (counts.get(track.id) ?? 0) - 1;
          if (next <= 0) {
            counts.delete(track.id);
          } else {
            counts.set(track.id, next);
          }
          // Only clear if we're truly leaving this row AND no other
          // row is currently being entered (handled by the dragenter
          // on the next row overwriting state).
          setState((prev) => {
            if (prev.targetRowId !== track.id) return prev;
            if (counts.has(track.id)) return prev;
            return { ...prev, hovering: false, targetRowId: null };
          });
        },
        onDrop: (e: React.DragEvent<HTMLDivElement>) => {
          const draggedId = isReorderDrag(e);
          enterCountRef.current.clear();
          if (!draggedId || !composition) {
            setState(INITIAL);
            return;
          }
          e.preventDefault();
          const position = computePosition(e);
          const currentIds = composition.tracks.map((t) => t.id);
          const fromIdx = currentIds.indexOf(draggedId);
          const rawTargetIdx = currentIds.indexOf(track.id);
          if (fromIdx === -1 || rawTargetIdx === -1) {
            setState(INITIAL);
            return;
          }
          // Compute insertion index as if the dragged track were
          // already removed from the list — that's how reorder works
          // semantically.
          const without = currentIds.filter((id) => id !== draggedId);
          let insertIdx =
            position === "above"
              ? without.indexOf(track.id)
              : without.indexOf(track.id) + 1;
          if (insertIdx < 0) insertIdx = without.length;
          const next = [
            ...without.slice(0, insertIdx),
            draggedId,
            ...without.slice(insertIdx),
          ];
          setState(INITIAL);
          // No-op if the order didn't actually change (e.g. dropped
          // a row on itself above → same index).
          const changed = next.some((id, i) => id !== currentIds[i]);
          if (!changed) return;
          dispatch("human", {
            type: "composition:reorder-tracks",
            trackIds: next,
          });
        },
      };
    },
    [composition, computePosition, dispatch, isReorderDrag],
  );

  return { state, onDragStart, rowHandlers };
}
