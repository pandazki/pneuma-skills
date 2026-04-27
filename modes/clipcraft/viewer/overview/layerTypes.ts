// Overview layer taxonomy. Legacy had 4 types (video / caption / audio / bgm);
// Plan 6 drops "bgm" entirely — BGM is just another audio track in craft and
// the overview renders it inside the Audio layer.
import type { ReactElement } from "react";
import type { Track } from "@pneuma-craft/timeline";
import {
  VideoIcon,
  AudioIcon,
  SubtitleIcon,
  type IconProps,
} from "../icons/index.js";
import { theme } from "../theme/tokens.js";

export type LayerType = "video" | "caption" | "audio";

export const LAYER_PRIORITY: LayerType[] = ["caption", "video", "audio"];

export function layerOfTrack(track: Track): LayerType {
  switch (track.type) {
    case "video":
      return "video";
    case "subtitle":
      return "caption";
    case "audio":
      return "audio";
  }
}

export function tracksForLayer(
  tracks: readonly Track[],
  layer: LayerType,
): Track[] {
  return tracks.filter((t) => layerOfTrack(t) === layer);
}

/**
 * Filter + group tracks for the 3D views:
 *   - Drops empty tracks (`clips.length === 0`)
 *   - Respects `track.visible !== false`
 *   - Preserves original order inside `composition.tracks` within each group
 *
 * Returns the groups in `LAYER_PRIORITY` order. Callers rely on the group
 * ordering for vertical stacking (caption → video → audio).
 */
export interface TrackGroup {
  layer: LayerType;
  tracks: Track[];
}

export function groupTracksForViews(tracks: readonly Track[]): TrackGroup[] {
  return LAYER_PRIORITY.map((layer) => ({
    layer,
    tracks: tracks.filter(
      (t) =>
        layerOfTrack(t) === layer &&
        t.clips.length > 0 &&
        t.visible !== false,
    ),
  }));
}

export interface LayerMeta {
  label: string;
  Icon: (props: IconProps) => ReactElement;
  /** Full-strength layer color — used for accents, focused borders, text. */
  color: string;
  /** Translucent background fill (~14% alpha). */
  colorSoft: string;
  /** Mid-strength border (~45% alpha). */
  colorBorder: string;
}

export const LAYER_META: Record<LayerType, LayerMeta> = {
  video: {
    label: "Video",
    Icon: VideoIcon,
    color: theme.color.layerVideo,
    colorSoft: theme.color.layerVideoSoft,
    colorBorder: "oklch(78% 0.13 75 / 0.45)",
  },
  caption: {
    label: "Caption",
    Icon: SubtitleIcon,
    color: theme.color.layerSubtitle,
    colorSoft: theme.color.layerSubtitleSoft,
    colorBorder: "oklch(80% 0.07 155 / 0.45)",
  },
  audio: {
    label: "Audio",
    Icon: AudioIcon,
    color: theme.color.layerAudio,
    colorSoft: theme.color.layerAudioSoft,
    colorBorder: "oklch(70% 0.09 215 / 0.45)",
  },
};
