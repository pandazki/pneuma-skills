import { useEffect, useRef, useState } from "react";
import { usePneumaCraftStore, usePlayback } from "@pneuma-craft/react";
import type { RenderedFrame } from "@pneuma-craft/video";

/**
 * Craft-native current-frame capture.
 *
 * Subscribes to the compositor's frame stream via the Zustand store's
 * `subscribeToFrames` method. Returns the latest ImageBitmap so
 * consumers can `drawImage` directly into a canvas — the same zero-copy
 * path the upstream `PreviewRoot` uses.
 *
 * An earlier version of this hook encoded each frame to a JPEG data URL
 * on every subscription callback and let React re-render an <img src>.
 * That path ran a synchronous JPEG encode (~30ms per 1080p frame) AND
 * a browser-side decode, making the exploded view visibly laggier than
 * the main preview canvas. Returning the bitmap directly skips both
 * steps.
 */
export function useCurrentFrame(): ImageBitmap | null {
  const subscribeToFrames = usePneumaCraftStore((s) => s.subscribeToFrames);
  const playback = usePlayback();
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const lastEmitRef = useRef<number>(0);
  // Live refs so the kick-seek below fires without re-running the
  // subscribe effect on every playhead tick.
  const seekRef = useRef(playback.seek);
  seekRef.current = playback.seek;
  const currentTimeRef = useRef(playback.currentTime);
  currentTimeRef.current = playback.currentTime;

  useEffect(() => {
    if (!subscribeToFrames) return;
    const off = subscribeToFrames((frame: RenderedFrame) => {
      const now = performance.now();
      if (now - lastEmitRef.current < 50) return;
      lastEmitRef.current = now;
      const raw = frame as unknown as {
        image?: ImageBitmap;
        bitmap?: ImageBitmap;
      };
      const bmp = raw.image ?? raw.bitmap;
      if (!bmp) return;
      setBitmap(bmp);
    });
    // Kick the engine to re-emit the current frame so consumers that
    // mount AFTER the initial auto-seek-on-mount don't sit on null
    // until the user manually seeks.
    const kickTimer = setTimeout(() => {
      seekRef.current(currentTimeRef.current);
    }, 30);
    return () => {
      clearTimeout(kickTimer);
      off();
    };
  }, [subscribeToFrames]);

  return bitmap;
}
