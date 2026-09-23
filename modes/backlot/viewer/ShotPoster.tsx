/**
 * One frame that stands for a shot, on a card with room for exactly one.
 *
 * What to draw is the domain's call (`shotPictures`: the greybox, a reference
 * clip, a key frame, a rendered contact sheet, a legacy board, the current
 * take). This component draws the first and, when the browser reports that a
 * file the records name is not there (a 404, a file that will not decode),
 * falls through to the next — and finally to the caller's placeholder. A card
 * never shows a broken image.
 *
 * A video is asked for with a media fragment and `preload="metadata"` — one
 * range request, and a real frame of the shot rather than a second file to
 * generate.
 */

import { useState, type ReactNode } from "react";

import type { Shot } from "../domain.js";
import { isVideoThumbnail, shotPictures } from "../domain.js";

export interface ShotPosterProps {
  shot: Shot;
  /** Shot-relative path → `/content/…` URL for that shot. */
  urlFor: (shot: Shot, path: string | null, rev: number) => string | null;
  /** Where a video poster is cued, in seconds (`#t=`). */
  at: number;
  /** What the card says when the shot has no picture that loads. */
  placeholder: ReactNode;
  alt?: string;
}

export function ShotPoster({ shot, urlFor, at, placeholder, alt = "" }: ShotPosterProps) {
  // Keyed by URL, not by position: a re-render bumps the revision, so the
  // new bytes get a new URL and are tried again.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const candidates = shotPictures(shot).flatMap((picture) => {
    const url = picture.file ? urlFor(shot, picture.file, picture.rev) : null;
    return url ? [{ picture, url }] : [];
  });
  const current = candidates.find((c) => !failed.has(c.url));
  if (!current) return <>{placeholder}</>;

  const onError = () => {
    const url = current.url;
    setFailed((prev) => new Set(prev).add(url));
  };
  return isVideoThumbnail(current.picture) ? (
    <video
      key={current.url}
      src={`${current.url}#t=${at}`}
      preload="metadata"
      muted
      playsInline
      onError={onError}
      className="h-full w-full object-cover"
    />
  ) : (
    <img
      key={current.url}
      src={current.url}
      alt={alt}
      onError={onError}
      className={`h-full w-full object-cover${current.picture.kind === "sheet" ? " object-left-top" : ""}`}
      loading="lazy"
    />
  );
}

export default ShotPoster;
