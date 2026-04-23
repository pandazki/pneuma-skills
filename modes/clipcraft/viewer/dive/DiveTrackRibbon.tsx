/**
 * DiveTrackRibbon — compact strip of the track that contains the
 * clip currently drilled into. Rendered between DiveHeader and
 * DiveCanvas so the user keeps a spatial anchor: "you are editing
 * THIS clip, at THIS position on THIS track".
 *
 * Each clip is a proportional rectangle on a single horizontal axis
 * that spans the composition's total duration. The active clip gets
 * an accent glow; other clips sit dim. Type color comes from the
 * track kind (same palette as the timeline tracks and dive nodes).
 * Clicking any clip seeks the playhead to its start.
 */

import { useMemo } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import { typeAccent } from "../assetInfo/typeAccent.js";
import { theme } from "../theme/tokens.js";

const RIBBON_HEIGHT = 36;
const PLAYHEAD_WIDTH = 2;

function trackAssetType(track: Track): "image" | "video" | "audio" | "text" {
  if (track.type === "video") return "video";
  if (track.type === "audio") return "audio";
  return "text"; // subtitle track
}

export function DiveTrackRibbon({
  activeTrack,
  activeClipId,
}: {
  activeTrack: Track | null;
  activeClipId: string | null;
}) {
  const composition = useComposition();
  const playback = usePlayback();

  // Total duration = max end time across every track, so the ribbon's
  // geometry matches the main timeline's scale.
  const totalDuration = useMemo(() => {
    let end = 0;
    for (const track of composition?.tracks ?? []) {
      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd > end) end = clipEnd;
      }
    }
    return end || 1; // avoid div-by-zero on empty comps
  }, [composition]);

  if (!activeTrack) return null;

  const accent = typeAccent(trackAssetType(activeTrack));
  const TrackIcon = accent.Icon;
  const playheadPct = (playback.currentTime / totalDuration) * 100;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: theme.space.space3,
        padding: `${theme.space.space2}px ${theme.space.space4}px`,
        borderBottom: `1px solid ${theme.color.borderWeak}`,
        background: theme.color.surface0,
        flexShrink: 0,
        fontFamily: theme.font.ui,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: theme.space.space1,
          color: accent.color,
          fontSize: theme.text.xs,
          fontWeight: theme.text.weightSemibold,
          letterSpacing: theme.text.trackingCaps,
          textTransform: "uppercase",
          flexShrink: 0,
          minWidth: 96,
        }}
      >
        <TrackIcon size={12} />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 120,
          }}
          title={activeTrack.name}
        >
          {activeTrack.name}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          flex: 1,
          height: RIBBON_HEIGHT,
          background: theme.color.surface1,
          border: `1px solid ${theme.color.borderWeak}`,
          borderRadius: theme.radius.sm,
          overflow: "hidden",
        }}
      >
        {activeTrack.clips.map((clip) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            totalDuration={totalDuration}
            accent={accent}
            isActive={clip.id === activeClipId}
            onSeek={() => playback.seek(clip.startTime)}
          />
        ))}
        {/* Playhead */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${playheadPct}%`,
            width: PLAYHEAD_WIDTH,
            marginLeft: -PLAYHEAD_WIDTH / 2,
            background: theme.color.accentBright,
            boxShadow: `0 0 4px ${theme.color.accent}`,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

function ClipBlock({
  clip,
  totalDuration,
  accent,
  isActive,
  onSeek,
}: {
  clip: Clip;
  totalDuration: number;
  accent: ReturnType<typeof typeAccent>;
  isActive: boolean;
  onSeek: () => void;
}) {
  const leftPct = (clip.startTime / totalDuration) * 100;
  const widthPct = (clip.duration / totalDuration) * 100;

  return (
    <button
      type="button"
      onClick={onSeek}
      title={`${clip.id} · ${clip.duration.toFixed(1)}s`}
      style={{
        position: "absolute",
        left: `${leftPct}%`,
        width: `calc(${widthPct}% - 2px)`,
        top: 3,
        bottom: 3,
        marginLeft: 1,
        background: isActive ? accent.color : accent.soft,
        border: `1px solid ${isActive ? accent.color : "transparent"}`,
        boxShadow: isActive
          ? `0 0 0 2px ${accent.color}, 0 0 12px ${accent.color}`
          : "none",
        borderRadius: theme.radius.sm,
        cursor: "pointer",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        minWidth: 4,
        transition: `box-shadow ${theme.duration.quick}ms ${theme.easing.out}`,
        opacity: isActive ? 1 : 0.55,
      }}
    >
      <span
        style={{
          fontFamily: theme.font.numeric,
          fontSize: theme.text.xs,
          fontVariantNumeric: "tabular-nums",
          color: isActive ? theme.color.surface0 : accent.color,
          letterSpacing: theme.text.trackingBase,
          whiteSpace: "nowrap",
          padding: `0 ${theme.space.space1}px`,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {clip.duration.toFixed(1)}s
      </span>
    </button>
  );
}
