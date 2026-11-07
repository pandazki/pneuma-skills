/**
 * The mounted sticker viewer's capture renderer, registered by
 * `StickerPreview` and answered through `ViewerContract.captureViewport`
 * (`pneuma-mode.ts`). A module of its own so the mode definition and the
 * viewer both import it without importing each other (the sprite / lucid
 * seam, minus the cycle).
 */

import type { ViewportCapture } from "../../../core/types/viewer-contract.js";

export type StickerCapture = () => Promise<ViewportCapture | null>;

const seam: { current: StickerCapture | null } = { current: null };

export function setStickerCapture(capture: StickerCapture | null): void {
  seam.current = capture;
}

/** What the mounted viewer answers; `null` (decline) when none is mounted. */
export function captureSticker(): Promise<ViewportCapture | null> {
  return seam.current ? seam.current() : Promise.resolve(null);
}
