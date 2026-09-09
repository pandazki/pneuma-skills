/**
 * Decoding a motion's frames before it plays.
 *
 * Playback is gated on this hook's `ready`: a `<canvas>` asked to draw an
 * image that has not decoded yet paints nothing, so an un-preloaded motion
 * plays as a strobe of blank frames on its first pass and only looks right
 * from the second loop on — which is exactly the state an agent would
 * screenshot and misread.
 *
 * Two failure modes are handled rather than waited on:
 *   - A frame that 404s (the project references an asset whose bytes are not
 *     on disk yet) settles as a failure and stops holding the gate shut.
 *   - A request that never settles at all is released by a deadline, so a
 *     hung asset degrades to "some frames are blank" instead of a stage that
 *     never starts.
 */

import { useEffect, useState } from "react";

import { EMPTY_IMAGES, type StageImages } from "./frame-render.js";
import type { FrameSource } from "./playback.js";

/** How long to wait for the whole set before playing with what we have. */
const DECODE_DEADLINE_MS = 8000;

/** Stable identity for a source: the exact bytes it points at. */
function sourceKey(source: FrameSource): string {
  if (source.kind === "frames") return `frames:${source.frames.join("|")}`;
  if (source.kind === "raw-sheet") return `sheet:${source.url}:${source.cols}x${source.rows}`;
  return "none";
}

export function useFrameImages(source: FrameSource): StageImages {
  const key = sourceKey(source);
  const [images, setImages] = useState<StageImages>(EMPTY_IMAGES);

  useEffect(() => {
    if (source.kind === "none") {
      setImages(EMPTY_IMAGES);
      return;
    }

    let cancelled = false;
    const urls =
      source.kind === "frames"
        ? source.frames
        : [source.url];
    const decoded: (HTMLImageElement | null)[] = urls.map(() => null);
    let settled = 0;
    let failed = 0;

    const publish = (ready: boolean) => {
      if (cancelled) return;
      setImages({
        frames: source.kind === "frames" ? decoded.slice() : [],
        sheet: source.kind === "raw-sheet" ? decoded[0] : null,
        ready,
        failed,
      });
    };

    const settle = () => {
      settled += 1;
      publish(settled >= urls.length);
    };

    const elements: HTMLImageElement[] = [];
    urls.forEach((url, index) => {
      if (!url) {
        // A declared frame with no asset: it keeps its slot and stays blank.
        failed += 1;
        settle();
        return;
      }
      const image = new Image();
      elements.push(image);
      image.decoding = "async";
      image.onload = () => {
        decoded[index] = image;
        settle();
      };
      image.onerror = () => {
        failed += 1;
        settle();
      };
      image.src = url;
    });

    // Nothing to wait for (every slot was empty) — publish immediately.
    if (urls.length === 0) publish(true);

    const deadline = setTimeout(() => {
      if (settled < urls.length) publish(true);
    }, DECODE_DEADLINE_MS);

    return () => {
      cancelled = true;
      clearTimeout(deadline);
      // Drop the handlers so a late decode cannot write into a stale slot.
      for (const image of elements) {
        image.onload = null;
        image.onerror = null;
      }
    };
    // `key` is the identity of the URL set; `source` itself is rebuilt each
    // render by resolveFrameSource and would restart the load every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return images;
}
