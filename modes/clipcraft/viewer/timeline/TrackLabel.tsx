import { useCallback, useState, type ReactElement } from "react";
import type { Track } from "@pneuma-craft/timeline";
import { useDispatch } from "@pneuma-craft/react";
import {
  VideoIcon,
  AudioIcon,
  SubtitleIcon,
  SpeakerIcon,
  MuteIcon,
  LockIcon,
  UnlockIcon,
  EyeIcon,
  EyeOffIcon,
  type IconProps,
} from "../icons/index.js";
import { theme } from "../theme/tokens.js";

export const LABEL_W = 140;

const iconFor = (
  type: Track["type"],
): ((props: IconProps) => ReactElement) => {
  switch (type) {
    case "video":
      return VideoIcon;
    case "audio":
      return AudioIcon;
    case "subtitle":
      return SubtitleIcon;
  }
};

const layerColorFor = (type: Track["type"]): string => {
  switch (type) {
    case "video":
      return theme.color.layerVideo;
    case "audio":
      return theme.color.layerAudio;
    case "subtitle":
      return theme.color.layerSubtitle;
  }
};

const toggleBtn = (active: boolean, activeColor: string): React.CSSProperties => ({
  background: "transparent",
  border: "none",
  padding: 0,
  width: 22,
  height: 22,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: active ? activeColor : theme.color.ink5,
  cursor: "pointer",
  lineHeight: 1,
  borderRadius: theme.radius.sm,
  transition: `color ${theme.duration.quick}ms ${theme.easing.out}`,
});

/**
 * Full-track label column. Track-type icon + name on the left,
 * three toggle buttons (mute / lock / hide) on the right.
 *
 * Draggable when `onReorderDragStart` is provided — the root div
 * registers as a drag source for `application/x-clipcraft-track-reorder`
 * and the toggle buttons `preventDefault` their own dragstart so the
 * user can click them without starting a drag.
 *
 * Also used as a "ruler spacer" — pass `track={null}` and children are
 * rendered as read-only text (used for the ruler row's leading cell).
 */
export function TrackLabel({
  track,
  children,
  onReorderDragStart,
}: {
  track: Track | null;
  children?: React.ReactNode;
  onReorderDragStart?: (e: React.DragEvent, track: Track) => void;
}) {
  const dispatch = useDispatch();
  const [dragging, setDragging] = useState(false);

  const toggleMute = useCallback(() => {
    if (!track) return;
    dispatch("human", { type: "composition:toggle-track-mute", trackId: track.id });
  }, [dispatch, track]);

  const toggleLock = useCallback(() => {
    if (!track) return;
    dispatch("human", { type: "composition:toggle-track-lock", trackId: track.id });
  }, [dispatch, track]);

  const toggleVisibility = useCallback(() => {
    if (!track) return;
    dispatch("human", {
      type: "composition:toggle-track-visibility",
      trackId: track.id,
    });
  }, [dispatch, track]);

  if (!track) {
    return (
      <div
        style={{
          width: LABEL_W,
          flexShrink: 0,
          fontSize: theme.text.xs,
          color: theme.color.ink4,
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          userSelect: "none",
          fontFamily: theme.font.ui,
          letterSpacing: theme.text.trackingWide,
        }}
      >
        {children}
      </div>
    );
  }

  const TrackTypeIcon = iconFor(track.type);
  const layerColor = layerColorFor(track.type);

  const reorderable = !!onReorderDragStart;
  return (
    <div
      draggable={reorderable}
      onDragStart={(e) => {
        if (!reorderable) return;
        onReorderDragStart?.(e, track);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      title={reorderable ? "Drag to reorder" : undefined}
      style={{
        width: LABEL_W,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: theme.space.space2,
        padding: `0 ${theme.space.space3}px 0 ${theme.space.space2}px`,
        fontSize: theme.text.sm,
        color: theme.color.ink2,
        userSelect: "none",
        borderRight: `1px solid ${theme.color.borderWeak}`,
        boxSizing: "border-box",
        background: theme.color.surface1,
        fontFamily: theme.font.ui,
        cursor: reorderable ? (dragging ? "grabbing" : "grab") : "default",
        opacity: dragging ? 0.4 : 1,
        transition: `opacity ${theme.duration.quick}ms ${theme.easing.out}`,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: layerColor,
        }}
      >
        <TrackTypeIcon size={14} />
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: theme.color.ink1,
          fontSize: theme.text.sm,
          fontWeight: theme.text.weightMedium,
          letterSpacing: theme.text.trackingBase,
        }}
        title={track.name}
      >
        {track.name || track.type}
      </span>
      <button
        type="button"
        onClick={toggleMute}
        title={track.muted ? "Unmute track" : "Mute track"}
        aria-label="toggle mute"
        style={toggleBtn(!track.muted, theme.color.ink2)}
      >
        {track.muted ? <MuteIcon size={13} /> : <SpeakerIcon size={13} />}
      </button>
      <button
        type="button"
        onClick={toggleLock}
        title={track.locked ? "Unlock track" : "Lock track"}
        aria-label="toggle lock"
        style={toggleBtn(track.locked, theme.color.accent)}
      >
        {track.locked ? <LockIcon size={13} /> : <UnlockIcon size={13} />}
      </button>
      <button
        type="button"
        onClick={toggleVisibility}
        title={track.visible === false ? "Show track" : "Hide track"}
        aria-label="toggle visibility"
        style={toggleBtn(track.visible !== false, theme.color.ink2)}
      >
        {track.visible === false ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
      </button>
    </div>
  );
}
