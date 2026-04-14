import { useCallback } from "react";
import type { Track } from "@pneuma-craft/timeline";
import { useDispatch } from "@pneuma-craft/react";

export const LABEL_W = 140;

const iconFor = (type: Track["type"]): string => {
  switch (type) {
    case "video":
      return "\uD83C\uDFAC"; // 🎬
    case "audio":
      return "\uD83D\uDD0A"; // 🔊
    case "subtitle":
      return "Tt";
  }
};

const toggleBtn = (active: boolean, activeColor: string): React.CSSProperties => ({
  background: "transparent",
  border: "none",
  padding: 0,
  width: 16,
  height: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  color: active ? activeColor : "#3f3f46",
  cursor: "pointer",
  lineHeight: 1,
});

/**
 * Full-track label column. Renders the track icon + name on the left
 * and three toggle buttons (mute / lock / hide) on the right. Clicking
 * a button dispatches the corresponding composition:toggle-track-*
 * command.
 *
 * Also used as a "ruler spacer" — pass `track={null}` and children are
 * rendered as read-only text (used for the ruler row's leading cell).
 */
export function TrackLabel({
  track,
  children,
}: {
  track: Track | null;
  children?: React.ReactNode;
}) {
  const dispatch = useDispatch();

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
          fontSize: 10,
          color: "#52525b",
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          userSelect: "none",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        width: LABEL_W,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        fontSize: 10,
        color: "#a1a1aa",
        userSelect: "none",
        borderRight: "1px solid #18181b",
        boxSizing: "border-box",
        background: "#0f0f11",
      }}
    >
      <span style={{ fontSize: 12, flexShrink: 0 }}>{iconFor(track.type)}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "#e4e4e7",
          fontSize: 10,
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
        style={toggleBtn(!track.muted, "#38bdf8")}
      >
        {track.muted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
      </button>
      <button
        type="button"
        onClick={toggleLock}
        title={track.locked ? "Unlock track" : "Lock track"}
        aria-label="toggle lock"
        style={toggleBtn(track.locked, "#f97316")}
      >
        {track.locked ? "\uD83D\uDD12" : "\uD83D\uDD13"}
      </button>
      <button
        type="button"
        onClick={toggleVisibility}
        title={track.visible === false ? "Show track" : "Hide track"}
        aria-label="toggle visibility"
        style={toggleBtn(track.visible !== false, "#a1a1aa")}
      >
        {track.visible === false ? "\uD83D\uDEAB" : "\u25CE"}
      </button>
    </div>
  );
}
