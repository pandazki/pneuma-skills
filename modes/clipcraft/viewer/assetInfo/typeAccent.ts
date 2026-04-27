/**
 * Per-asset-type visual accents. Maps an asset type to its layer hue,
 * a soft background tint, and a type icon — so every place that
 * renders an asset (dive nodes, dialog cards, lightbox, library) can
 * reach for the same visual vocabulary.
 *
 * Hues are defined as tokens in theme/tokens.ts (layerImage /
 * layerVideo / layerAudio / layerSubtitle). This module just binds an
 * asset-type key to the right token pair and icon.
 */

import type { AssetType } from "@pneuma-craft/react";
import {
  ImageIcon,
  VideoIcon,
  AudioIcon,
  SubtitleIcon,
  type IconProps,
} from "../icons/index.js";
import { theme } from "../theme/tokens.js";

export interface TypeAccent {
  /** Solid hue — use on badge text / icon colour / focused border. */
  color: string;
  /** Translucent tint — use on badge backgrounds / active card fill. */
  soft: string;
  /** Type glyph, same size-prop shape as the rest of the icon set. */
  Icon: (p: IconProps) => React.ReactElement;
  /** UI label, e.g. "Image", "Video". */
  label: string;
}

export function typeAccent(type: AssetType | null | undefined): TypeAccent {
  switch (type) {
    case "image":
      return {
        color: theme.color.layerImage,
        soft: theme.color.layerImageSoft,
        Icon: ImageIcon,
        label: "Image",
      };
    case "video":
      return {
        color: theme.color.layerVideo,
        soft: theme.color.layerVideoSoft,
        Icon: VideoIcon,
        label: "Video",
      };
    case "audio":
      return {
        color: theme.color.layerAudio,
        soft: theme.color.layerAudioSoft,
        Icon: AudioIcon,
        label: "Audio",
      };
    case "text":
      return {
        color: theme.color.layerSubtitle,
        soft: theme.color.layerSubtitleSoft,
        Icon: SubtitleIcon,
        label: "Text",
      };
    default:
      // Fallback — use the neutral ink tone. Shouldn't normally happen
      // since AssetType is a closed union, but stay defensive for
      // forward-compat if new types land.
      return {
        color: theme.color.ink2,
        soft: theme.color.surface2,
        Icon: SubtitleIcon,
        label: "Asset",
      };
  }
}
