import { useEffect, useRef, useState } from "react";
import { usePneumaCraftStore, usePlayback } from "@pneuma-craft/react";
import type { RenderedFrame } from "@pneuma-craft/video";

/**
 * Craft-native current-frame capture.
 *
 * Subscribes to the compositor's frame stream via the Zustand store's
 * `subscribeToFrames` method (exposed in Plan 4). Returns the latest
 * rendered frame as a data URL usable inside an <img src>.
 *
 * Throttled to ~100ms to match legacy's DOM capture cadence.
 *
 * Note: `RenderedFrame` canonically exposes `image: ImageBitmap` in the
 * current `@pneuma-craft/video` .d.ts. We also tolerate alternative shapes
 * (`bitmap` / `imageData`) because the interior surface has historically
 * shifted between compositor backends.
 */
export function useCurrentFrame(): string | null {
  const subscribeToFrames = usePneumaCraftStore((s) => s.subscribeToFrames);
  const playback = usePlayback();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastEmitRef = useRef<number>(0);
  // Live refs so the kick-seek can fire without re-running the subscribe
  // effect on every playhead tick.
  const seekRef = useRef(playback.seek);
  seekRef.current = playback.seek;
  const currentTimeRef = useRef(playback.currentTime);
  currentTimeRef.current = playback.currentTime;

  useEffect(() => {
    if (!subscribeToFrames) return;
    const off = subscribeToFrames((frame: RenderedFrame) => {
      const now = performance.now();
      if (now - lastEmitRef.current < 100) return;
      lastEmitRef.current = now;

      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      const canvas = canvasRef.current;
      // Structural typing — accept `image` (current canonical),
      // `bitmap` (legacy variant), or `imageData` (raw backend).
      const raw = frame as unknown as {
        image?: ImageBitmap;
        bitmap?: ImageBitmap;
        width?: number;
        height?: number;
        imageData?: ImageData;
      };
      const bmp: ImageBitmap | undefined = raw.image ?? raw.bitmap;
      const w = raw.width ?? bmp?.width ?? 0;
      const h = raw.height ?? bmp?.height ?? 0;
      if (!w || !h) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (bmp) {
        ctx.drawImage(bmp, 0, 0, w, h);
      } else if (raw.imageData) {
        ctx.putImageData(raw.imageData, 0, 0);
      } else {
        return;
      }
      setDataUrl(canvas.toDataURL("image/jpeg", 0.7));
    });
    // Kick the engine to re-emit the current frame so consumers that
    // mount AFTER the auto-seek-on-mount don't get stuck on
    // 'Capturing frame...' until the user manually seeks. seek(t) when
    // paused fires a single frame render through the same pipeline.
    const kickTimer = setTimeout(() => {
      seekRef.current(currentTimeRef.current);
    }, 30);
    return () => {
      clearTimeout(kickTimer);
      off();
    };
  }, [subscribeToFrames]);

  return dataUrl;
}
