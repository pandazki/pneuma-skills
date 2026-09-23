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
 *
 * And one rule about WHEN a set is given back: the moment it stops being the
 * one on screen. An `Image` that has loaded holds a decoded bitmap, and for a
 * 532x460 frame that is a megabyte; a 355-frame loop is a third of a gigabyte
 * per set. Those bitmaps are invisible to the JS garbage collector's idea of
 * pressure, so dropping the last reference does NOT reliably free them —
 * `release` detaches the element from its bytes instead. Every `register-run`
 * re-stamps the frames' registration time, so the URLs change and a new set
 * starts; before this was deterministic, a run's worth of file events took
 * the renderer to 10 GB and the tab stopped answering at all (2026-09-22, the
 * Kiki trial: a 355-frame 532x460 loop, browser disconnected, only killing the
 * render process brought it back).
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { EMPTY_IMAGES, type StageImages } from "./frame-render.js";
import type { FrameSource } from "./playback.js";

/** How long to wait for the whole set before playing with what we have. */
const DECODE_DEADLINE_MS = 8000;

/** How long the file events must hold still before the pictures are re-read. */
export const IMAGE_SETTLE_MS = 250;

/**
 * `imageVersion`, held until the file events stop arriving.
 *
 * The shell bumps `imageVersion` once per CHANGED FILE, not once per change:
 * one `register-run` on the Kiki loop sent 355 separate updates inside a tenth
 * of a second (measured 2026-09-22 on the session's own browser socket; the
 * frame directories have since left the watcher, but a run still writes a
 * burst of keyframes, contact sheets and previews). Every
 * bump rewrites all 355 frame URLs, so a viewer that reacts to each one asks
 * the browser for a hundred and twenty-six thousand pictures — which is how a
 * 30-minute session ended with a 10 GB render process and a tab that answered
 * nothing.
 *
 * Waiting for quiet is also the honest reading of those events: a run that is
 * still writing frames has no complete set to show yet. The first version is
 * adopted immediately, so opening a session paints at once.
 */
export function useSettledImageVersion(
  version: number,
  quietMs: number = IMAGE_SETTLE_MS,
): number {
  const [settled, setSettled] = useState(version);
  useEffect(() => {
    if (version === settled) return;
    const timer = setTimeout(() => setSettled(version), quietMs);
    return () => clearTimeout(timer);
  }, [version, settled, quietMs]);
  return settled;
}

/**
 * Hand an image's bytes back.
 *
 * Detaching `src` aborts a request still in flight and releases the decoded
 * bitmap of one that finished; nulling the handlers stops a late decode from
 * writing into a slot nobody is showing any more. `removeAttribute` rather
 * than `src = ""`, which resolves the empty string against the document and
 * re-requests the page itself.
 */
function release(images: Iterable<HTMLImageElement>): void {
  for (const image of images) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
  }
}

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
 * — or a re-run's new registration time (`&r=`) — rewrites every URL of the
 * motion already on stage (see `urls.ts`);
 * the frames are about to be redrawn from the same paths, so the pictures
 * already decoded are the best thing to keep showing while the new ones land.
 * A different motion is not that: its bytes have nothing to do with what is on
 * screen, and holding the old pictures under the new motion's name would be a
 * lie the stage tells in the one place a screenshot cannot catch it.
 */
export function stableSourceKey(source: FrameSource): string {
  // Both version tokens: the image counter and a frame's registration time
  // (`?v=<n>&r=<createdAt>`, see `urls.ts`) — a re-run at the same paths is
  // a reload of the same pictures.
  return sourceKey(source).replace(/\?v=\d+(?:&r=\d+)?/g, "");
}

export function useFrameImages(source: FrameSource): StageImages {
  // Both keys walk every URL of the motion, and the shell re-renders on every
  // animation frame — memoise them against the source the shell already
  // memoises, or a 355-frame loop rebuilds a 40 KB string 48 times a second.
  const key = useMemo(() => sourceKey(source), [source]);
  const stable = useMemo(() => stableSourceKey(source), [source]);
  const [images, setImages] = useState<StageImages>(EMPTY_IMAGES);
  const stableRef = useRef<string | null>(null);
  /** The elements behind the set currently on screen — the only ones that may
   *  not be released, because they are what the stage is drawing. */
  const shownRef = useRef<HTMLImageElement[]>([]);
  /** Elements whose set has been superseded but whose replacement React has
   *  not committed yet. Releasing one of these before the commit would blank
   *  the stage for a frame, which is the very thing this hook exists to
   *  prevent — so they wait for the commit below. */
  const staleRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    // Switching to different pictures clears the stage at once; re-issuing the
    // same ones keeps what is decoded until the replacements are ready, so a
    // file change does not blink the sprite out from under the playhead.
    if (stableRef.current !== stable) {
      stableRef.current = stable;
      staleRef.current = staleRef.current.concat(shownRef.current);
      shownRef.current = [];
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
    let handedOver = false;

    const publish = (ready: boolean) => {
      if (cancelled) return;
      if (!handedOver) {
        // This set is taking the screen, so the one it replaces is now dead
        // weight — a third of a gigabyte of it, for a long loop.
        handedOver = true;
        staleRef.current = staleRef.current.concat(shownRef.current);
        shownRef.current = elements;
      }
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
      // A set that never reached the screen is pure cost: give it back at
      // once. A `register-run` rewrites every frame and each batch of file
      // events supersedes the load before it, so without this the discarded
      // generations pile up decoded until the renderer dies.
      if (!handedOver) release(elements);
    };
    // `key` is the identity of the URL set; `source` itself is rebuilt each
    // render by resolveFrameSource and would restart the load every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A superseded set is given back once its replacement is on screen, not
  // when it is chosen: this effect runs after React has committed `images`.
  useEffect(() => {
    if (staleRef.current.length === 0) return;
    const stale = staleRef.current;
    staleRef.current = [];
    release(stale);
  }, [images]);

  // Leaving the viewer gives the last set back too — nothing is drawing it.
  useEffect(
    () => () => {
      release(shownRef.current);
      release(staleRef.current);
      shownRef.current = [];
      staleRef.current = [];
    },
    [],
  );

  return images;
}
