// Overview layer taxonomy. Legacy had 4 types (video / caption / audio / bgm);
// Plan 6 drops "bgm" entirely — BGM is just another audio track in craft and
// the overview renders it inside the Audio layer.
import type { Track } from "@pneuma-craft/timeline";

export type LayerType = "video" | "caption" | "audio";

export const LAYER_PRIORITY: LayerType[] = ["caption", "video", "audio"];

export function tracksForLayer(
  tracks: readonly Track[],
  layer: LayerType,
): Track[] {
  switch (layer) {
    case "video":
      return tracks.filter((t) => t.type === "video");
    case "caption":
      return tracks.filter((t) => t.type === "subtitle");
    case "audio":
      return tracks.filter((t) => t.type === "audio");
  }
}

export const LAYER_META: Record<
  LayerType,
  { label: string; icon: string; color: string; bg: string }
> = {
  video:   { label: "Video",   icon: "\uD83C\uDFAC", color: "#eab308", bg: "rgba(234,179,8,0.04)" },
  caption: { label: "Caption", icon: "Tt",            color: "#f97316", bg: "rgba(249,115,22,0.04)" },
  audio:   { label: "Audio",   icon: "\uD83D\uDD0A",  color: "#38bdf8", bg: "rgba(56,189,248,0.04)" },
};
