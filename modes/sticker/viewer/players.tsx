/**
 * The three sticker formats, played the way their platform plays them.
 *
 * - GIF (takes, WeChat): an `<img>`; the browser loops it forever, as chat
 *   apps do. Its frames are decoded client-side for the frame strip with
 *   `ImageDecoder` (WebCodecs) — where that API is missing the strip is
 *   hidden and says so; the GIF still plays.
 * - WebM VP9 + alpha (Telegram): a muted, looping `<video>`. Where VP9 is
 *   not playable, or where the browser drops the alpha channel (the file
 *   would sit on a black box), the tile says so in place.
 * - APNG (LINE): an `<img>` that plays the file's own loop count and stops,
 *   as LINE does, with a replay control.
 *
 * Media elements carry `crossOrigin="anonymous"`: in dev the page and
 * `/content` are different origins, and a tainted element would capture as
 * a blank rectangle (`/content` answers `Access-Control-Allow-Origin: *`).
 */

import { useEffect, useRef, useState } from "react";

import type { Measure } from "../domain.js";
import { Icon } from "./ui.js";

// ── Frame decoding ─────────────────────────────────────────────────────────

export type FramesState =
  | { status: "idle" }
  | { status: "unsupported" }
  | { status: "loading"; url: string }
  | { status: "ready"; url: string; frames: ImageBitmap[]; width: number; height: number }
  | { status: "error"; url: string; message: string };

interface DecodedImage {
  image: { close(): void; displayWidth: number; displayHeight: number };
}
interface ImageDecoderLike {
  completed: Promise<void>;
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<DecodedImage>;
  close(): void;
}
type ImageDecoderCtor = (new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike) & {
  isTypeSupported?: (type: string) => Promise<boolean>;
};

export function imageDecoder(): ImageDecoderCtor | null {
  const ctor = (globalThis as { ImageDecoder?: unknown }).ImageDecoder;
  return typeof ctor === "function" && typeof createImageBitmap === "function" ? (ctor as ImageDecoderCtor) : null;
}

/**
 * Decode every frame of a GIF into ImageBitmaps (composited, as the GIF
 * shows them). Bitmaps are closed when the URL changes or the hook unmounts.
 */
export function useGifFrames(url: string | null): FramesState {
  const [state, setState] = useState<FramesState>({ status: "idle" });
  useEffect(() => {
    if (!url) {
      setState({ status: "idle" });
      return;
    }
    const Decoder = imageDecoder();
    if (!Decoder) {
      setState({ status: "unsupported" });
      return;
    }
    let cancelled = false;
    const bitmaps: ImageBitmap[] = [];
    setState({ status: "loading", url });
    (async () => {
      if (Decoder.isTypeSupported && !(await Decoder.isTypeSupported("image/gif"))) {
        if (!cancelled) setState({ status: "unsupported" });
        return;
      }
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const decoder = new Decoder({ data: await response.arrayBuffer(), type: "image/gif" });
      try {
        // The track list first, then the whole file: frameCount is final only after both.
        await decoder.tracks.ready;
        await decoder.completed;
        const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
        if (!count) throw new Error("the GIF reports no frames");
        let width = 0;
        let height = 0;
        for (let i = 0; i < count && !cancelled; i += 1) {
          const { image } = await decoder.decode({ frameIndex: i });
          width = image.displayWidth;
          height = image.displayHeight;
          bitmaps.push(await createImageBitmap(image as unknown as ImageBitmapSource));
          image.close();
        }
        if (!cancelled) setState({ status: "ready", url, frames: [...bitmaps], width, height });
      } finally {
        decoder.close();
      }
    })().catch((error: unknown) => {
      if (!cancelled) setState({ status: "error", url, message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
      for (const b of bitmaps) b.close();
    };
  }, [url]);
  // The state lags the URL by one render, and the cleanup above has already
  // closed the previous URL's bitmaps by the time anything draws them: never
  // hand out frames (or an error) that belong to another URL.
  if (!url) return { status: "idle" };
  if ("url" in state && state.url !== url) return { status: "loading", url };
  return state;
}

/** One decoded frame, drawn at the canvas's own pixel size and scaled by CSS. */
export function FrameCanvas({ bitmap, size, className, label }: { bitmap: ImageBitmap; size: number; className?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const px = Math.round(size * ratio);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, px, px);
    ctx.imageSmoothingQuality = "high";
    const scale = Math.min(px / bitmap.width, px / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (px - w) / 2, (px - h) / 2, w, h);
  }, [bitmap, size]);
  return <canvas ref={ref} aria-label={label} style={className ? undefined : { width: size, height: size }} className={className} />;
}

// ── GIF ────────────────────────────────────────────────────────────────────

export function GifImg({ url, size, alt, className = "" }: { url: string; size: number | string; alt: string; className?: string }) {
  return (
    <img
      src={url}
      alt={alt}
      crossOrigin="anonymous"
      draggable={false}
      decoding="async"
      style={{ width: size, height: size }}
      className={`select-none object-contain ${className}`}
    />
  );
}

// ── WebM VP9 + alpha ───────────────────────────────────────────────────────

export type WebmSupport = "yes" | "no-vp9" | "no-alpha" | "unknown";

function canPlayVp9(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("video");
  if (typeof probe.canPlayType !== "function") return false;
  return probe.canPlayType('video/webm; codecs="vp9"') !== "" || probe.canPlayType('video/webm; codecs="vp09.00.10.08"') !== "";
}

/**
 * Whether this browser shows the WebM's transparency: draw the first frame
 * and read a corner the exporter measured as clear. An opaque corner means
 * the alpha plane was dropped (Safari's VP9 path), which would put the
 * sticker on a black box.
 */
function alphaDropped(video: HTMLVideoElement): boolean | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !video.videoWidth) return null;
    ctx.drawImage(video, 0, 0, video.videoWidth / 32, video.videoHeight / 32, 0, 0, 16, 16);
    return ctx.getImageData(0, 0, 1, 1).data[3] === 255;
  } catch {
    return null;
  }
}

export function WebmPlayer({
  url,
  width,
  height,
  measure,
  messages,
}: {
  url: string;
  width: number;
  height: number;
  measure: Measure | null;
  messages: { noVp9: string; noAlpha: string };
}) {
  const [support, setSupport] = useState<WebmSupport>(() => (canPlayVp9() ? "unknown" : "no-vp9"));
  const ref = useRef<HTMLVideoElement | null>(null);
  const expectClear = measure?.alpha?.cornersClear !== false;
  if (support === "no-vp9") {
    return (
      <div style={{ width, height }} className="grid max-w-full place-items-center rounded-md border border-dashed border-current/30 p-3 text-center text-[11.5px] leading-[1.5] opacity-80">
        {messages.noVp9}
      </div>
    );
  }
  return (
    <div className="relative max-w-full" style={{ width, aspectRatio: `${width} / ${height}` }}>
      <video
        ref={ref}
        src={url}
        crossOrigin="anonymous"
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        className="h-full w-full"
        onLoadedData={() => {
          const v = ref.current;
          if (!v || !expectClear) return setSupport("yes");
          const dropped = alphaDropped(v);
          setSupport(dropped === true ? "no-alpha" : "yes");
        }}
        onError={() => setSupport("no-vp9")}
      />
      {support === "no-alpha" ? (
        <div className="absolute inset-x-1 bottom-1 rounded-md bg-black/75 px-2 py-1 text-[10.5px] leading-[1.45] text-white backdrop-blur">{messages.noAlpha}</div>
      ) : null}
    </div>
  );
}

// ── APNG ───────────────────────────────────────────────────────────────────

/**
 * An APNG plays its own `num_plays` and stops. Replay loads it again under a
 * new URL (`&replay=n`) — a browser keeps one animation clock per image URL,
 * so re-mounting the same URL would not restart it.
 */
export function ApngPlayer({
  url,
  width,
  height,
  measure,
  labels,
}: {
  url: string;
  width: number;
  height: number;
  measure: Measure | null;
  labels: { replay: string; plays: (n: number) => string; loops: string };
}) {
  const [round, setRound] = useState(0);
  const src = round ? `${url}${url.includes("?") ? "&" : "?"}replay=${round}` : url;
  const plays = measure?.loopCount;
  return (
    <div className="flex flex-col items-center gap-1">
      <img
        key={round}
        src={src}
        alt=""
        crossOrigin="anonymous"
        draggable={false}
        style={{ width, height }}
        className="max-w-full select-none object-contain"
      />
      <button
        type="button"
        onClick={() => setRound((r) => r + 1)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] opacity-75 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-cc-primary/60"
      >
        <Icon.Replay size={11} />
        {labels.replay}
        <span className="opacity-70">· {plays ? labels.plays(plays) : labels.loops}</span>
      </button>
    </div>
  );
}
