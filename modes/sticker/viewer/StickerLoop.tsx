/**
 * A sticker, playing the loop that ships.
 *
 * The exporter keeps `keepFrames` of the picked take (`effectiveLoop`), so
 * the take's own GIF — which the browser plays whole — would show the user
 * the very jump the trim removed (2026-11-07 trials: the panel, chat and
 * stage all played 16 frames while every export held 9). Here:
 *
 * - no keepFrames: the take's GIF, played by the browser as chat apps do;
 * - keepFrames, frames decodable (ImageDecoder): the kept frames on a
 *   canvas, each at its recorded delay;
 * - keepFrames, no frame decoding (Safari, some player visitors) or a decode
 *   failure: a current export of this sticker, which IS the trimmed loop
 *   (WeChat's GIF loops forever, LINE's APNG plays its own loops);
 * - and with no current export either: the whole take, under a visible note
 *   that the shipped loop is trimmed.
 *
 * A keepFrames that names a frame the take does not have plays the whole
 * take and says so — the exporter refuses that take.
 */

import type { ReactNode } from "react";

import type { Platform, StickerPack, StickerView, TakeView } from "../domain.js";
import { mediaUrl } from "./media.js";
import { GifImg, LoopCanvas, imageDecoder, useGifFrames } from "./players.js";
import type { StickerStrings } from "./strings.js";
import { Icon } from "./ui.js";
import { effectiveLoop } from "./view-model.js";

/** Exports that play in an `<img>` as the trimmed loop, in the order they are preferred. */
const PLAYABLE_EXPORTS: readonly Platform[] = ["wechat", "line"];

/** A current export of the sticker's shipping take that an `<img>` plays, if one exists. */
export function currentExport(value: StickerPack, sticker: StickerView, take: TakeView, base: string): { url: string; platform: Platform } | null {
  if (sticker.state.effective !== take.id) return null;
  for (const platform of PLAYABLE_EXPORTS) {
    const view = value.platforms.find((p) => p.platform === platform);
    const item = view?.exports.items.find((i) => i.kind === "sticker" && i.sticker === sticker.id && i.state === "current");
    const url = item ? mediaUrl(base, value.assets[item.assetId]) : null;
    if (url) return { url, platform };
  }
  return null;
}

/** The decoder's delays, when it read one for every frame (a GIF delay ≤ 10 ms plays as 100 ms). */
export function decoderDelays(durations: number[]): number[] | null {
  return durations.length && durations.every((d) => d > 0) ? durations.map((d) => (d <= 10 ? 100 : d)) : null;
}

function Noted({ size, style, text, short, children }: { size: number | string; style: "badge" | "icon"; text: string; short: string; children: ReactNode }) {
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      {children}
      {style === "icon" ? (
        <span data-loop-note title={text} aria-label={text} className="absolute right-0.5 top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-black/70 text-white">
          <Icon.Scissors size={10} />
        </span>
      ) : (
        <span data-loop-note title={text} className="absolute bottom-1 left-1/2 inline-flex max-w-full -translate-x-1/2 items-center gap-1 truncate rounded-full bg-black/70 px-2 py-[1px] text-[10px] leading-[1.5] text-white">
          <Icon.Scissors size={10} />
          {short}
        </span>
      )}
    </span>
  );
}

export function StickerLoop({
  value,
  sticker,
  take,
  base,
  size,
  alt,
  t,
  note = "badge",
}: {
  value: StickerPack;
  sticker: StickerView;
  /** The ready take to play (the sticker's shown one, or one the stage was moved to). */
  take: TakeView | null;
  base: string;
  size: number | string;
  alt: string;
  t: StickerStrings;
  /** How a note fits here: a short text badge, or an icon with the text as its tooltip. */
  note?: "badge" | "icon";
}) {
  const url = mediaUrl(base, take);
  const keep = sticker.sticker.keepFrames;
  const decodes = !!url && !!keep && imageDecoder() !== null;
  const frames = useGifFrames(decodes ? url : null);
  if (!url || !take) return null;
  if (!keep) return <GifImg url={url} size={size} alt={alt} />;

  const total = take.measure?.frames ?? value.pack?.motion.frames ?? 0;
  const fallbackMs = value.pack?.motion.frameMs ?? 120;
  if (frames.status === "ready") {
    const loop = effectiveLoop(keep, frames.frames.length, take.measure?.delaysMs ?? decoderDelays(frames.durations), fallbackMs);
    if (loop.outOfRange === null) return <LoopCanvas frames={frames.frames} order={loop.order} delays={loop.delays} size={size} label={alt} />;
    return (
      <Noted size={size} style={note} text={t.keepOutOfRange(loop.outOfRange, frames.frames.length)} short={t.untrimmedShort}>
        <GifImg url={url} size="100%" alt={alt} />
      </Noted>
    );
  }
  // Decoding: nothing yet, rather than a moment of the frames the trim removed.
  if (decodes && frames.status !== "error" && frames.status !== "unsupported") {
    return <span data-loop="decoding" aria-label={alt} className="inline-block" style={{ width: size, height: size }} />;
  }
  const exported = currentExport(value, sticker, take, base);
  if (exported) {
    return (
      <img
        src={exported.url}
        alt={alt}
        title={t.playsExport(t.platformName(exported.platform))}
        crossOrigin="anonymous"
        draggable={false}
        decoding="async"
        style={{ width: size, height: size }}
        className="select-none object-contain"
      />
    );
  }
  return (
    <Noted size={size} style={note} text={t.untrimmedNote(keep.length, total)} short={t.untrimmedShort}>
      <GifImg url={url} size="100%" alt={alt} />
    </Noted>
  );
}
