import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDispatch,
  usePneumaCraftStore,
} from "@pneuma-craft/react";
import type { Track } from "@pneuma-craft/timeline";
import type { Asset } from "@pneuma-craft/core";

export const DRAG_MIME = "application/x-clipcraft-asset";

// How long a still image clip lasts by default when dropped onto a
// video track. MP4/WebM drops use the asset's metadata.duration.
const IMAGE_DEFAULT_DURATION = 5;
const AUDIO_FALLBACK_DURATION = 10;

export interface DropTargetState {
  /** Whether a drag is currently hovering this track's content area. */
  hovering: boolean;
  /** Local X coordinate of the drag pointer inside the track, in px.
   *  Used to render an insertion indicator. null when not hovering. */
  hoverX: number | null;
  /** Whether the currently-dragged asset is compatible with this track.
   *  false → render a red indicator and reject the drop. */
  compatible: boolean;
}

export interface DropHandlers {
  state: DropTargetState;
  onDragEnter: React.DragEventHandler<HTMLDivElement>;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
}

const INITIAL: DropTargetState = { hovering: false, hoverX: null, compatible: true };

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility — which asset kinds can live on which track kinds
// ─────────────────────────────────────────────────────────────────────────────

function isCompatible(assetType: Asset["type"], trackType: Track["type"]): boolean {
  if (trackType === "video") return assetType === "video" || assetType === "image";
  if (trackType === "audio") return assetType === "audio";
  if (trackType === "subtitle") return false; // subtitle clips carry text, not asset refs
  return false;
}

function clipDurationFor(asset: Asset): number {
  const metaDuration = (asset.metadata as { duration?: number } | undefined)?.duration;
  if (typeof metaDuration === "number" && metaDuration > 0) return metaDuration;
  if (asset.type === "image") return IMAGE_DEFAULT_DURATION;
  if (asset.type === "audio") return AUDIO_FALLBACK_DURATION;
  return IMAGE_DEFAULT_DURATION;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared drop-target hook used by VideoTrack / AudioTrack / SubtitleTrack.
 * Subscribes to dragover/drop events on the track content area and
 * dispatches `composition:add-clip` when the user drops an asset.
 *
 * Compatibility:
 *   - video track accepts  image + video assets
 *   - audio track accepts  audio assets
 *   - subtitle track rejects everything (subtitle clips carry text)
 *
 * Drop position:
 *   - local pointer X → clipStartTime via `(localX + scrollLeft) / pps`
 *   - clamped to [0, +∞) so you can't drop a clip at a negative time
 *
 * Clip duration:
 *   - video/audio assets use `asset.metadata.duration` (always present)
 *   - image assets fall back to IMAGE_DEFAULT_DURATION (5s)
 *   - the recipe says image clips ignore inPoint/outPoint at decode
 *     time, so we set `inPoint: 0, outPoint: duration` to satisfy the
 *     schema without implying anything special
 */
export function useTrackDropTarget(
  track: Track,
  pixelsPerSecond: number,
  scrollLeft: number,
): DropHandlers {
  const dispatch = useDispatch();
  const registry = usePneumaCraftStore((s) => s.coreState.registry);
  const [state, setState] = useState<DropTargetState>(INITIAL);
  // Track nested dragenter/dragleave so we don't flicker when the
  // pointer crosses over a child element (the clip divs) — this is the
  // standard HTML5 drag enter/leave counter trick.
  const enterCountRef = useRef(0);

  // Reset when the drag ends globally (covers the "drag off the
  // window" case where we never see a dragleave on our own element).
  useEffect(() => {
    const onDragEnd = () => {
      enterCountRef.current = 0;
      setState(INITIAL);
    };
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onDragEnd);
    return () => {
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onDragEnd);
    };
  }, []);

  // Peek at the asset being dragged so we can compute compatibility
  // without reading it on every dragover tick. DataTransfer.types is
  // always available, but .getData() only returns during drop — so we
  // encode the asset id in the MIME suffix, e.g.
  // "application/x-clipcraft-asset+asset-panda-sad-v2".
  const readAssetFromEvent = useCallback(
    (e: React.DragEvent | DragEvent): Asset | null => {
      for (const type of e.dataTransfer?.types ?? []) {
        if (type.startsWith(DRAG_MIME)) {
          const assetId = type.slice(DRAG_MIME.length + 1); // skip trailing '+'
          if (!assetId) return null;
          return registry.get(assetId) ?? null;
        }
      }
      return null;
    },
    [registry],
  );

  const onDragEnter: React.DragEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      const asset = readAssetFromEvent(e);
      if (!asset) return;
      e.preventDefault();
      enterCountRef.current += 1;
      const compatible = isCompatible(asset.type, track.type);
      setState({
        hovering: true,
        hoverX: localXFromEvent(e),
        compatible,
      });
    },
    [readAssetFromEvent, track.type],
  );

  const onDragOver: React.DragEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      const asset = readAssetFromEvent(e);
      if (!asset) return;
      e.preventDefault();
      const compatible = isCompatible(asset.type, track.type);
      e.dataTransfer.dropEffect = compatible ? "copy" : "none";
      setState((prev) =>
        prev.hovering && prev.compatible === compatible && prev.hoverX === localXFromEvent(e)
          ? prev
          : { hovering: true, hoverX: localXFromEvent(e), compatible },
      );
    },
    [readAssetFromEvent, track.type],
  );

  const onDragLeave: React.DragEventHandler<HTMLDivElement> = useCallback(() => {
    enterCountRef.current -= 1;
    if (enterCountRef.current <= 0) {
      enterCountRef.current = 0;
      setState(INITIAL);
    }
  }, []);

  const onDrop: React.DragEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      const asset = readAssetFromEvent(e);
      enterCountRef.current = 0;
      setState(INITIAL);
      if (!asset) return;
      if (!isCompatible(asset.type, track.type)) return;
      e.preventDefault();
      const localX = localXFromEvent(e);
      const startTime = Math.max(
        0,
        (localX + scrollLeft) / Math.max(pixelsPerSecond, 1),
      );
      const duration = clipDurationFor(asset);
      dispatch("human", {
        type: "composition:add-clip",
        trackId: track.id,
        clip: {
          assetId: asset.id,
          startTime,
          duration,
          inPoint: 0,
          outPoint: duration,
        },
      });
    },
    [dispatch, pixelsPerSecond, readAssetFromEvent, scrollLeft, track.id, track.type],
  );

  return { state, onDragEnter, onDragOver, onDragLeave, onDrop };
}

function localXFromEvent(e: React.DragEvent | DragEvent): number {
  const target = e.currentTarget as HTMLElement | null;
  if (!target) return 0;
  const rect = target.getBoundingClientRect();
  return Math.max(0, e.clientX - rect.left);
}

// ─────────────────────────────────────────────────────────────────────────────
// Drag source helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start a drag from an asset thumbnail. Encodes the asset id in the
 * MIME type itself (appended after '+') so track dragover handlers
 * can peek at the asset without needing DataTransfer.getData (which
 * only works inside drop). Also writes a fallback text/plain payload.
 */
export function startAssetDrag(
  e: React.DragEvent,
  asset: { id: string; name?: string | null },
) {
  const mime = `${DRAG_MIME}+${asset.id}`;
  e.dataTransfer.setData(mime, asset.id);
  e.dataTransfer.setData("text/plain", asset.id);
  e.dataTransfer.effectAllowed = "copy";
}
