import type { CaptionStyle } from "../../persistence.js";

// Values below live in **composition coordinate space** — the same
// pixel grid as `composition.settings.width × height`. The overlay
// scales them to the preview's actual DOM size at render time, so a
// caption sized for a 1080-wide authoring canvas looks correct both
// in the shrunk preview and in the full-resolution export. A sensible
// subtitle at 1080-wide is roughly 36-48px, bolder weight for video.
export const DEFAULT_CAPTION_STYLE: Required<CaptionStyle> = {
  fontSize: 40,
  color: "#ffffff",
  background: "rgba(0, 0, 0, 0.65)",
  bottomPercent: 0.08,
  fontWeight: 600,
  maxWidthPercent: 0.95,
};

export function resolveCaptionStyle(
  override: CaptionStyle | undefined,
): Required<CaptionStyle> {
  return { ...DEFAULT_CAPTION_STYLE, ...(override ?? {}) };
}
