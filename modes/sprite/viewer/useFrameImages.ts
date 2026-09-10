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
 *
 * And one rule about WHEN a set replaces the one on screen: never half of it.
 * The stage keeps the pictures it has until the incoming set is whole, so a
 * re-run of the motion being watched swaps its frames in one step instead of
 * blanking the sprite for the length of a decode. Pointing at different
 * pictures (another motion, a reference) clears first — see `stableSourceKey`.
 */

import { useEffect, useRef, useState } from "react";

import { EMPTY_IMAGES, type StageImages } from "./frame-render.js";
import type { FrameSource } from "./playback.js";

/** How long to wait for the whole set before playing with what we have. */
const DECODE_DEADLINE_MS = 8000;

/** Identity for a source: the exact bytes it points at, cache buster and all. */
export function sourceKey(source: FrameSource): string {
  if (source.kind === "frames") return `frames:${source.frames.join("|")}`;
  if (source.kind === "raw-sheet") return `sheet:${source.url}:${source.cols}x${source.rows}`;
  return "none";
}

/**
 * The same identity with the cache buster taken out — "which pictures", not
 * "which version of them".
 *
 * This is what separates a RELOAD from a SWITCH. An `imageVersion` bump
 * rewrites every URL of the motion already on stage (`?v=` — see `urls.ts`);
 * the frames are about to be redrawn from the same paths, so the pictures
 * already decoded are the best thing to keep showing while the new ones land.
 * A different motion is not that: its bytes have nothing to do with what is on
 * screen, and holding the old pictures under the new motion's name would be a
 * lie the stage tells in the one place a screenshot cannot catch it.
 */
export function stableSourceKey(source: FrameSource): string {
  return sourceKey(source).replace(/\?v=\d+/g, "");
}

export function useFrameImages(source: FrameSource): StageImages {
  const key = sourceKey(source);
  const stable = stableSourceKey(source);
  const [images, setImages] = useState<StageImages>(EMPTY_IMAGES);
  const stableRef = useRef<string | null>(null);

  useEffect(() => {
    // Switching to different pictures clears the stage at once; re-issuing the
    // same ones keeps what is decoded until the replacements are ready, so a
    // file change does not blink the sprite out from under the playhead.
    if (stableRef.current !== stable) {
      stableRef.current = stable;
      setImages(EMPTY_IMAGES);
    }

    if (source.kind === "none") return;

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

    // Published ONCE, when the set is whole (or when the deadline gives up on
    // it). A publish per arrival paints a set that is mostly `null` — on a
    // reload that is a stage with a background, guides and no sprite, for as
    // long as the decode takes.
    const settle = () => {
      settled += 1;
      if (settled >= urls.length) publish(true);
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
