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
  | { status: "ready"; url: string; frames: ImageBitmap[]; width: number; height: number; durations: number[] }
  | { status: "error"; url: string; message: string };

interface DecodedImage {
  image: { close(): void; displayWidth: number; displayHeight: number; duration?: number | null };
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

/** A GIF's frames, composited as the GIF shows them. */
export interface DecodedGif {
  frames: ImageBitmap[];
  width: number;
  height: number;
  /** Each frame's delay as the decoder read it, in ms (0 when it did not say). */
  durations: number[];
}

/** The browser decodes images but not GIF frames. */
export class GifFramesUnsupported extends Error {}

async function decodeGif(url: string, Decoder: ImageDecoderCtor): Promise<DecodedGif> {
  if (Decoder.isTypeSupported && !(await Decoder.isTypeSupported("image/gif"))) throw new GifFramesUnsupported("image/gif");
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const decoder = new Decoder({ data: await response.arrayBuffer(), type: "image/gif" });
  const frames: ImageBitmap[] = [];
  try {
    // The track list first, then the whole file: frameCount is final only after both.
    await decoder.tracks.ready;
    await decoder.completed;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (!count) throw new Error("the GIF reports no frames");
    let width = 0;
    let height = 0;
    const durations: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const { image } = await decoder.decode({ frameIndex: i });
      width = image.displayWidth;
      height = image.displayHeight;
      durations.push(typeof image.duration === "number" ? image.duration / 1000 : 0);
      frames.push(await createImageBitmap(image as unknown as ImageBitmapSource));
      image.close();
    }
    return { frames, width, height, durations };
  } catch (error) {
    for (const b of frames) b.close();
    throw error;
  } finally {
    decoder.close();
  }
}

interface Held {
  refs: number;
  promise: Promise<DecodedGif>;
}

/**
 * Decoded GIFs, shared by URL: the card, the stage, the chat and a capture
 * that show the same take decode it once. A frame's bitmaps are closed when
 * the last holder lets go; a failed decode is forgotten, so the next holder
 * tries again.
 */
const held = new Map<string, Held>();

export function holdGifFrames(url: string, Decoder: ImageDecoderCtor): { promise: Promise<DecodedGif>; release: () => void } {
  let entry = held.get(url);
  if (!entry) {
    const created: Held = { refs: 0, promise: decodeGif(url, Decoder) };
    created.promise.catch(() => {
      if (held.get(url) === created) held.delete(url);
    });
    held.set(url, created);
    entry = created;
  }
  const mine = entry;
  mine.refs += 1;
  let released = false;
  return {
    promise: mine.promise,
    release: () => {
      if (released) return;
      released = true;
      mine.refs -= 1;
      if (mine.refs > 0) return;
      if (held.get(url) === mine) held.delete(url);
      mine.promise.then(
        (gif) => {
          for (const b of gif.frames) b.close();
        },
        () => {},
      );
    },
  };
}

/**
 * Every frame of a GIF as ImageBitmaps (shared through `holdGifFrames`),
 * released when the URL changes or the hook unmounts.
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
    setState({ status: "loading", url });
    const hold = holdGifFrames(url, Decoder);
    hold.promise.then(
      (gif) => {
        if (!cancelled) setState({ status: "ready", url, frames: gif.frames, width: gif.width, height: gif.height, durations: gif.durations });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof GifFramesUnsupported) setState({ status: "unsupported" });
        else setState({ status: "error", url, message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
      hold.release();
    };
  }, [url]);
  // The state lags the URL by one render, and the cleanup above has already
  // released the previous URL's bitmaps by the time anything draws them:
  // never hand out frames (or an error) that belong to another URL.
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

/**
 * Decoded frames played as a loop: `order` (frame indices), each for its
 * `delays` entry — the loop that ships, where the browser's own GIF
 * playback would play every frame of the take. The canvas holds the
 * frames' own pixels and is scaled by CSS, like the `<img>` it replaces.
 */
export function LoopCanvas({
  frames,
  order,
  delays,
  size,
  label,
  className = "",
}: {
  frames: ImageBitmap[];
  order: number[];
  delays: number[];
  size: number | string;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // By value: a parent re-render (the "generating for N s" clock) must not restart the loop.
  const key = `${order.join(",")}|${delays.join(",")}`;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !order.length) return;
    const first = frames[order[0]];
    canvas.width = first?.width || 512;
    canvas.height = first?.height || 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    let at = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = () => {
      const bitmap = frames[order[at]];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (bitmap) ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (order.length < 2) return;
      timer = setTimeout(() => {
        at = (at + 1) % order.length;
        show();
      }, Math.max(20, delays[at] ?? 100));
    };
    show();
    return () => {
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, key]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ width: size, height: size }} className={`select-none object-contain ${className}`} />;
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
