import { useState, useEffect, useRef } from "react";

export interface FrameData {
  time: number;
  dataUrl: string;
  width: number;
  height: number;
}

interface Options {
  videoUrl: string;
  duration: number;
  frameInterval: number;
  frameHeight: number;
}

/** Seek a video to a specific time and wait for the frame to be ready. */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      // Additional delay for the browser to decode the frame
      setTimeout(resolve, 30);
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Video seek error"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

/** Wait for video to be ready for seeking. */
function waitForVideo(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    const onReady = () => {
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onErr);
      reject(new Error("Video load error"));
    };
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onErr);
  });
}

/**
 * Extract thumbnail frames from a video at regular intervals using a hidden
 * <video> + <canvas>. Results are cached by videoUrl.
 */
export function useFrameExtractor(options: Options | null): {
  frames: FrameData[];
  loading: boolean;
  error: string | null;
} {
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, FrameData[]>>(new Map());

  useEffect(() => {
    if (!options || !options.videoUrl || options.duration <= 0) {
      setFrames([]);
      setLoading(false);
      return;
    }

    const { videoUrl, duration, frameInterval, frameHeight } = options;

    // Check cache
    const cached = cacheRef.current.get(videoUrl);
    if (cached) {
      setFrames(cached);
      setLoading(false);
      return;
    }

    let aborted = false;
    setLoading(true);
    setError(null);
    setFrames([]);

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    const times: number[] = [];
    // Start at a small offset (not exactly 0) to avoid getting the default poster frame
    for (let t = 0; t < duration; t += frameInterval) {
      times.push(Math.max(t, 0.05));
    }

    async function extractAll() {
      try {
        await waitForVideo(video);
        if (aborted) return;

        const extracted: FrameData[] = [];

        for (const time of times) {
          if (aborted) return;

          await seekTo(video, time);
          if (aborted) return;

          const aspect = video.videoWidth / video.videoHeight;
          const w = Math.round(frameHeight * aspect);
          canvas.width = w;
          canvas.height = frameHeight;
          ctx.drawImage(video, 0, 0, w, frameHeight);

          extracted.push({
            time,
            dataUrl: canvas.toDataURL("image/jpeg", 0.6),
            width: w,
            height: frameHeight,
          });

          // Progressive update
          setFrames([...extracted]);
        }

        cacheRef.current.set(videoUrl, extracted);
      } catch (e) {
        if (!aborted) setError(String(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    }

    extractAll();

    return () => {
      aborted = true;
      video.src = "";
      video.load();
    };
  }, [options?.videoUrl, options?.duration, options?.frameInterval, options?.frameHeight]);

  return { frames, loading, error };
}
