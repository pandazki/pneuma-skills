import { useMemo } from "react";
import { useAsset } from "@pneuma-craft/react";
import type { Clip, PreviewFrame, Track } from "@pneuma-craft/timeline";
import { theme } from "../theme/tokens.js";
import { HourglassIcon, WarningIcon } from "../icons/index.js";

/** A visible segment of a preview frame on the timeline. */
export interface PreviewSegment {
  readonly previewFrameId: string;
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * Walk preview frames + clips, producing the visible segments of preview
 * frames after auto-fallback. Mirrors the upstream resolveFrame rule:
 *   - For each preview frame at time T, it displays from T until the
 *     next preview frame's time, or the composition end.
 *   - A clip covering any point in that interval supersedes the preview
 *     in that sub-interval (clip wins, [start, end) half-open). After
 *     the clip ends, the preview RESUMES until the next preview or
 *     duration cap, matching upstream's "greatest pf.time ≤ T" rule.
 *
 * Inputs:
 *   previews — sorted ascending by time (matches upstream invariant I5)
 *   clips    — any order; we compute coverage internally
 *   duration — composition duration (cap on the trailing segment)
 *
 * Output: list of segments with [startTime, endTime), preserving order.
 *
 * Pure function. No allocation beyond return.
 */
export function computePreviewSegments(
  previews: readonly PreviewFrame[],
  clips: readonly Clip[],
  duration: number,
): PreviewSegment[] {
  if (previews.length === 0) return [];

  // Lock the ascending-time invariant at the helper boundary. Upstream
  // sortPreviewFrames sorts on every insert/update, so programmatic
  // writers always feed ordered input — but a hand-crafted project.json
  // can land out-of-order, and naturalEnd assumes ordered neighbors. A
  // defensive sort here costs O(N log N) for tiny N and removes the
  // silent-drop failure mode (naturalEnd <= naturalStart skips the segment).
  const ordered =
    previews.length < 2
      ? (previews as readonly PreviewFrame[])
      : [...previews].sort((a, b) => a.time - b.time);

  const segments: PreviewSegment[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const pf = ordered[i]!;
    const naturalStart = pf.time;
    const rawNext = i + 1 < ordered.length ? ordered[i + 1]!.time : duration;
    // Cap trailing segments at composition duration.
    const naturalEnd = Math.min(rawNext, duration);
    if (naturalStart >= duration) continue;
    if (naturalEnd <= naturalStart) continue;

    // Walk overlapping clips in time order; preview wins outside their
    // half-open intervals, including resumption after a clip ends.
    let cursor = naturalStart;
    const overlapping = clips
      .filter(c => c.startTime < naturalEnd && c.startTime + c.duration > naturalStart)
      .slice()
      .sort((a, b) => a.startTime - b.startTime);

    for (const c of overlapping) {
      const cStart = c.startTime;
      const cEnd = c.startTime + c.duration;
      if (cStart > cursor) {
        segments.push({ previewFrameId: pf.id, startTime: cursor, endTime: cStart });
      }
      cursor = Math.max(cursor, cEnd);
      if (cursor >= naturalEnd) break;
    }
    if (cursor < naturalEnd) {
      segments.push({ previewFrameId: pf.id, startTime: cursor, endTime: naturalEnd });
    }
  }

  return segments;
}

interface PreviewFrameStripProps {
  readonly track: Track;
  readonly duration: number;
  readonly pixelsPerSecond: number;
  readonly trackHeight: number;
  /**
   * Horizontal scroll offset of the surrounding timeline row (in px).
   * Each tile subtracts this from its `seg.startTime * pixelsPerSecond`
   * left coordinate so tiles share the same scroll-offset convention as
   * the sibling clip wrappers (which all subtract scrollLeft per-element
   * since the row container itself isn't translated). Defaults to 0 for
   * standalone / test usage.
   */
  readonly scrollLeft?: number;
  /**
   * Click handler. Receives the preview-frame id, the preview's anchor time
   * (NOT the segment's start — same id may have multiple segments after
   * auto-fallback), and the referenced asset id. Parent dispatches the
   * actual craft selection + playhead seek.
   */
  readonly onSelect: (previewFrameId: string, time: number, assetId: string) => void;
}

/**
 * Renders the planning-layer thumbnail strip for a video track.
 *
 * For each visible preview-segment (computed via computePreviewSegments
 * over track.previewFrames + track.clips), draws an absolutely-positioned
 * tile sized by [startTime, endTime) × pixelsPerSecond. The tile shows
 * the referenced asset's image (background-image) with subtle visual
 * differentiation between sketch and anchor fidelity.
 *
 * Status fallback: if the referenced asset is `generating`, shows a
 * hourglass icon + label; if `error`, shows a warning icon + tooltip;
 * if missing from registry, shows '?' + assetId tooltip.
 */
export function PreviewFrameStrip({
  track,
  duration,
  pixelsPerSecond,
  trackHeight,
  scrollLeft = 0,
  onSelect,
}: PreviewFrameStripProps) {
  const segments = useMemo(
    () => computePreviewSegments(track.previewFrames ?? [], track.clips, duration),
    [track.previewFrames, track.clips, duration],
  );

  if (segments.length === 0) return null;

  return (
    <>
      {segments.map(seg => {
        const pf = (track.previewFrames ?? []).find(p => p.id === seg.previewFrameId);
        if (!pf) return null; // defensive — should never happen if helper is in sync
        return (
          <PreviewSegmentTile
            key={`${seg.previewFrameId}@${seg.startTime}`}
            segment={seg}
            previewFrameId={pf.id}
            anchorTime={pf.time}
            assetId={pf.assetId}
            pixelsPerSecond={pixelsPerSecond}
            trackHeight={trackHeight}
            scrollLeft={scrollLeft}
            onClick={() => onSelect(pf.id, pf.time, pf.assetId)}
          />
        );
      })}
    </>
  );
}

interface PreviewSegmentTileProps {
  readonly segment: PreviewSegment;
  readonly previewFrameId: string;
  readonly anchorTime: number;
  readonly assetId: string;
  readonly pixelsPerSecond: number;
  readonly trackHeight: number;
  readonly scrollLeft?: number;
  readonly onClick: () => void;
}

function PreviewSegmentTile({
  segment,
  previewFrameId,
  assetId,
  pixelsPerSecond,
  trackHeight,
  scrollLeft = 0,
  onClick,
}: PreviewSegmentTileProps) {
  const asset = useAsset(assetId);
  const widthPx = (segment.endTime - segment.startTime) * pixelsPerSecond;
  const leftPx = segment.startTime * pixelsPerSecond - scrollLeft;

  // Visual treatment based on asset.metadata.fidelity.
  // 'sketch' → dashed border + 70% opacity; default → solid border + full opacity.
  const fidelity = (asset?.metadata as { fidelity?: string } | undefined)?.fidelity;
  const isSketch = fidelity === "sketch";

  // Status placeholder
  const status = asset?.status;
  const isReady = !!asset && status === "ready" && !!asset.uri;
  const showPending = !!asset && status === "generating";
  // Note: AssetStatus uses "failed" (not "error") for generation failures.
  const showError = !!asset && status === "failed";
  const showMissing = !asset;

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: leftPx,
    top: 0,
    width: widthPx,
    height: trackHeight,
    boxSizing: "border-box",
    border: isSketch
      ? `1px dashed ${theme.color.borderWeak}`
      : `1px solid ${theme.color.borderWeak}`,
    opacity: isSketch ? 0.7 : 1,
    cursor: "pointer",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    color: theme.color.ink2,
    gap: 4,
  };

  if (isReady) {
    return (
      <div
        style={{
          ...baseStyle,
          backgroundImage: `url(${asset!.uri})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        onClick={onClick}
        title={asset!.name}
        data-preview-frame-id={previewFrameId}
      />
    );
  }

  if (showPending) {
    return (
      <div
        style={baseStyle}
        onClick={onClick}
        title={asset!.name}
        data-preview-frame-id={previewFrameId}
      >
        <HourglassIcon size={12} /> <span>{asset!.name}</span>
      </div>
    );
  }
  if (showError) {
    const errMsg = (asset!.metadata as { error?: string } | undefined)?.error ?? "error";
    return (
      <div
        style={{ ...baseStyle, borderColor: theme.color.danger }}
        onClick={onClick}
        title={errMsg}
        data-preview-frame-id={previewFrameId}
      >
        <WarningIcon size={12} /> <span>{asset!.name}</span>
      </div>
    );
  }
  if (showMissing) {
    return (
      <div
        style={baseStyle}
        onClick={onClick}
        title={`asset ${assetId} not in registry`}
        data-preview-frame-id={previewFrameId}
      >
        <span style={{ fontWeight: 700 }}>?</span> <span>{assetId}</span>
      </div>
    );
  }
  return null;
}
