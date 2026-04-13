import type { CaptionStyle } from "../../persistence.js";

export const DEFAULT_CAPTION_STYLE: Required<CaptionStyle> = {
  fontSize: 16,
  color: "#ffffff",
  background: "rgba(0, 0, 0, 0.65)",
  bottomPercent: 0.08,
  fontWeight: 400,
  maxWidthPercent: 0.9,
};

export function resolveCaptionStyle(
  override: CaptionStyle | undefined,
): Required<CaptionStyle> {
  return { ...DEFAULT_CAPTION_STYLE, ...(override ?? {}) };
}
