import { motion } from "framer-motion";
import type { Track } from "@pneuma-craft/timeline";
import { useDispatch } from "@pneuma-craft/react";
import { LAYER_META, layerOfTrack, type LayerType } from "./layerTypes.js";
import { theme } from "../theme/tokens.js";

interface Props {
  /**
   * Full track list (composition.tracks). This component filters to
   * non-empty tracks and groups them by layer type. Hidden tracks
   * (visible === false) stay in the list so the user can toggle them
   * back on.
   */
  tracks: readonly Track[];
  /**
   * When rendered by the ExplodedView, this is the id of the track
   * currently at the front of the 3D carousel. The matching button grows
   * + uses a brighter fill to mirror the 3D focus. Overview views leave
   * this undefined and all buttons render in their plain visible/hidden
   * state.
   */
  focusedTrackId?: string | null;
}

const LAYER_ORDER: LayerType[] = ["video", "caption", "audio"];

export function TrackToggle({ tracks, focusedTrackId }: Props) {
  const dispatch = useDispatch();

  const grouped = LAYER_ORDER.map((layer) => ({
    layer,
    tracks: tracks.filter(
      (t) => layerOfTrack(t) === layer && t.clips.length > 0,
    ),
  })).filter((g) => g.tracks.length > 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: theme.space.space3,
        padding: `${theme.space.space2}px 0`,
      }}
    >
      {grouped.map((group) => {
        const { label, Icon, color, colorSoft, colorBorder } = LAYER_META[group.layer];
        return (
          <div
            key={group.layer}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: theme.space.space1,
            }}
          >
            {group.tracks.map((track) => {
              const visible = track.visible !== false;
              const focused = track.id === focusedTrackId && visible;
              const height = focused ? 48 : visible ? 36 : 28;
              const width = focused ? 34 : 30;
              const title = visible
                ? focused
                  ? `${track.name || label} · in front`
                  : `Hide ${track.name || label}`
                : `Show ${track.name || label}`;
              return (
                <motion.button
                  key={track.id}
                  type="button"
                  onClick={() =>
                    dispatch("human", {
                      type: "composition:toggle-track-visibility",
                      trackId: track.id,
                    })
                  }
                  title={title}
                  aria-pressed={visible}
                  animate={{
                    height,
                    width,
                    opacity: visible ? 1 : 0.4,
                  }}
                  transition={{
                    type: "tween",
                    duration: 0.22,
                    ease: [0.2, 0.8, 0.2, 1],
                  }}
                  style={{
                    borderRadius: theme.radius.md,
                    border: focused
                      ? `1px solid ${color}`
                      : visible
                        ? `1px solid ${colorBorder}`
                        : `1px solid ${theme.color.borderWeak}`,
                    background: focused
                      ? colorSoft
                      : visible
                        ? colorSoft
                        : theme.color.surface1,
                    color: visible ? color : theme.color.ink4,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: visible ? "space-between" : "center",
                    padding: visible ? `${theme.space.space1}px 0` : 0,
                    flexShrink: 0,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {visible && (
                    <motion.span
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{
                        scale: focused ? 1.1 : 1,
                        opacity: focused ? 1 : 0.85,
                      }}
                      transition={{
                        type: "tween",
                        duration: 0.22,
                        ease: [0.2, 0.8, 0.2, 1],
                      }}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: theme.radius.pill,
                        background: color,
                        display: "block",
                      }}
                    />
                  )}
                  <Icon size={focused ? 15 : 13} />
                </motion.button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
