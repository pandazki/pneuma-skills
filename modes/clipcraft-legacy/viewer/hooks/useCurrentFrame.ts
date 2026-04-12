import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Captures the current frame of a video element as a data URL.
 *
 * During playback: throttled to ~100ms (10fps).
 * When paused: captures once per seek (globalTime change).
 * Returns null when no video or video not ready.
 */
export function useCurrentFrame(
  videoEl: HTMLVideoElement | null,
  globalTime: number,
  playing: boolean,
): string | null {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const lastCaptureRef = useRef<number>(0);

  const capture = useCallback(() => {
    if (!videoEl || videoEl.readyState < 2) return; // HAVE_CURRENT_DATA

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(videoEl, 0, 0, w, h);
    setFrameUrl(canvas.toDataURL("image/jpeg", 0.7));
  }, [videoEl]);

  // During playback: rAF loop, throttled to ~100ms
  useEffect(() => {
    if (!playing || !videoEl) return;

    const INTERVAL = 100; // ms

    const tick = () => {
      const now = performance.now();
      if (now - lastCaptureRef.current >= INTERVAL) {
        lastCaptureRef.current = now;
        capture();
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, videoEl, capture]);

  // When paused: capture on globalTime change (seek)
  useEffect(() => {
    if (playing) return;
    // Small delay to let video.currentTime settle after seek
    const timer = setTimeout(() => capture(), 50);
    return () => clearTimeout(timer);
  }, [playing, globalTime, capture]);

  // Capture initial frame when video element appears
  useEffect(() => {
    if (!videoEl) {
      setFrameUrl(null);
      return;
    }
    if (videoEl.readyState >= 2) {
      capture();
    } else {
      const handler = () => capture();
      videoEl.addEventListener("loadeddata", handler, { once: true });
      return () => videoEl.removeEventListener("loadeddata", handler);
    }
  }, [videoEl, capture]);

  return frameUrl;
}
