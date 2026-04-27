/**
 * Asset-type classifier shared between the upload flow (useAssetActions.ts)
 * and the reconcile / orphan-import flow (AssetPanel.tsx).
 *
 * Must stay aligned with the server's MEDIA_EXTS in
 * `server/routes/asset-fs.ts` — a divergence means the server reports a file
 * the client's classifier rejects, so the user sees an orphan that Import
 * silently fails on.
 */

import type { AssetType } from "@pneuma-craft/core";

export const EXT_TO_TYPE: Record<string, AssetType> = {
  // image
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  svg: "image", bmp: "image", avif: "image", heic: "image", heif: "image",
  tif: "image", tiff: "image",
  // video
  mp4: "video", mov: "video", webm: "video", mkv: "video", m4v: "video",
  avi: "video", mpeg: "video", mpg: "video",
  // audio
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", aac: "audio",
  m4a: "audio", opus: "audio", aif: "audio", aiff: "audio",
};

/** Classify by file extension (filename or full path). */
export function classifyByExt(filename: string): AssetType | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_TYPE[ext] ?? null;
}

/** Classify a File object — tries MIME type first, falls back to extension. */
export function classifyAssetType(file: File): AssetType | null {
  const mime = file.type;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return classifyByExt(file.name);
}

/** Classify by URI / path (extension-only, no MIME type available). */
export function classifyByUri(uri: string): AssetType | null {
  return classifyByExt(uri);
}
