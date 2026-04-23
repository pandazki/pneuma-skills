import { motion } from "framer-motion";
import { useMemo } from "react";
import type { Track } from "@pneuma-craft/timeline";
import { usePlayback } from "@pneuma-craft/react";
import { LAYER_META, layerOfTrack, type LayerType } from "../overview/layerTypes.js";
import { AudioLayerContent } from "../overview/AudioLayerContent.js";
import { ExplodedVideoFrame } from "./ExplodedVideoFrame.js";
import { theme } from "../theme/tokens.js";

export const LAYER_ORDER: LayerType[] = ["caption", "video", "audio"];

export interface ExplodedTrackProps {
  track: Track;
  /** 1-based index of this track within its layer group (for label "VIDEO 2"). */
  indexInGroup: number;
  groupSize: number;
  zOffset: number;
  width: number;
  height: number;
  top: number;
  focused: boolean;
  pixelsPerSecond: number;
  scrollLeft: number;
  selectedClipId: string | null;
  playheadX: number;
  viewportWidth: number;
  onClick: () => void;
}

const EASE = {
  type: "tween" as const,
  duration: 0.38,
  ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
};

const HEADER_H = 28;

export function ExplodedTrack({
  track,
  indexInGroup,
  groupSize,
  zOffset,
  width,
  height,
  top,
  focused,
  pixelsPerSecond,
  scrollLeft,
  selectedClipId,
  playheadX,
  viewportWidth,
  onClick,
}: ExplodedTrackProps) {
  const layerType = layerOfTrack(track);
  const meta = LAYER_META[layerType];
  const Icon = meta.Icon;
  const contentH = Math.max(16, height - HEADER_H);
  const labelSuffix = groupSize > 1 ? ` ${indexInGroup}` : "";
  const playback = usePlayback();
  const currentTime = playback.currentTime;

  // For caption tracks in Exploded mode we show only the currently-
  // active caption text as a centered chip — "what's on THIS layer
  // RIGHT NOW". Overview (front/side) keeps the multi-chip timeline.
  const activeCaption = useMemo(() => {
    if (layerType !== "caption") return null;
    return track.clips.find(
      (c) =>
        currentTime >= c.startTime &&
        currentTime < c.startTime + c.duration,
    );
  }, [layerType, track.clips, currentTime]);

  return (
    <motion.div
      layout
      animate={{
        z: zOffset,
        y: top,
        opacity: focused ? 1 : 0.6,
        filter: focused ? "blur(0px)" : "blur(1.2px)",
      }}
      transition={EASE}
      onClick={onClick}
      whileHover={focused ? { scale: 1.01 } : { opacity: 0.85 }}
      style={{
        position: "absolute",
        left: "50%",
        width,
        height,
        marginLeft: -width / 2,
        transformStyle: "flat",
        cursor: "pointer",
        background: meta.colorSoft,
        border: `1px solid ${focused ? meta.color : meta.colorBorder}`,
        borderRadius: theme.radius.md,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        zIndex: focused ? 10 : 1,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: theme.space.space2,
          padding: `${theme.space.space1}px ${theme.space.space3}px`,
          fontFamily: theme.font.ui,
          fontSize: theme.text.xs,
          fontWeight: theme.text.weightSemibold,
          color: meta.color,
          letterSpacing: theme.text.trackingCaps,
          textTransform: "uppercase",
          opacity: 0.9,
          flexShrink: 0,
          height: HEADER_H,
          boxSizing: "border-box",
        }}
      >
        <Icon size={12} />
        <span>
          {meta.label}
          {labelSuffix}
        </span>
        {track.name ? (
          <span
            style={{
              color: theme.color.ink4,
              fontWeight: theme.text.weightMedium,
              letterSpacing: theme.text.trackingWide,
              textTransform: "none",
              opacity: 0.75,
            }}
          >
            · {track.name}
          </span>
        ) : null}
      </div>

      <div
        style={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {layerType === "video" && (
          <ExplodedVideoFrame
            track={track}
            currentTime={currentTime}
            width={width}
            height={contentH}
          />
        )}
        {layerType === "caption" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: `0 ${theme.space.space4}px`,
            }}
          >
            {activeCaption?.text ? (
              <span
                style={{
                  maxWidth: "100%",
                  padding: `${theme.space.space2}px ${theme.space.space4}px`,
                  borderRadius: theme.radius.pill,
                  background: theme.color.surface3,
                  border: `1px solid ${meta.colorBorder}`,
                  color: theme.color.ink0,
                  fontFamily: theme.font.display,
                  fontSize: Math.min(16, contentH * 0.42),
                  fontWeight: theme.text.weightMedium,
                  letterSpacing: theme.text.trackingTight,
                  lineHeight: theme.text.lineHeightSnug,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={activeCaption.text}
              >
                {activeCaption.text}
              </span>
            ) : null}
          </div>
        )}
        {layerType === "audio" && (
          <AudioLayerContent
            track={track}
            height={contentH}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            selectedClipId={selectedClipId}
          />
        )}

        {/* Playhead only makes sense on strip-style content (audio waveform).
            Video shows a single current-frame so a vertical line is noise,
            and caption is a centered chip rather than a time strip. */}
        {layerType === "audio" &&
          playheadX >= -10 &&
          playheadX <= viewportWidth + 10 && (
            <div
              style={{
                position: "absolute",
                left: playheadX,
                top: 0,
                bottom: 0,
                width: 2,
                marginLeft: -1,
                background: theme.color.playhead,
                pointerEvents: "none",
                zIndex: 5,
                transition: "left 100ms linear",
                willChange: "left",
              }}
            />
          )}
      </div>
    </motion.div>
  );
}
