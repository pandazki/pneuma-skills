import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox.js";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function extOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** True when FilePreview will render an inline preview for this path (v1: images). */
export function isInlinePreviewable(path: string): boolean {
  return IMAGE_EXTS.has(extOf(path));
}

function fileApiUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function FilePreview({ path }: { path: string }) {
  const [zoomed, setZoomed] = useState(false);
  const [errored, setErrored] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  if (!isInlinePreviewable(path)) return null;

  const url = fileApiUrl(path);

  if (errored) {
    return (
      <div className="mt-2 text-[11px] text-cc-muted italic">
        Preview unavailable — the file may have changed or been removed.
      </div>
    );
  }

  return (
    <div className="mt-2">
      <img
        src={url}
        alt={basename(path)}
        loading="lazy"
        onError={() => setErrored(true)}
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth && el.naturalHeight) setDims({ w: el.naturalWidth, h: el.naturalHeight });
        }}
        onClick={() => setZoomed(true)}
        className="max-h-[180px] rounded border border-cc-border/60 cursor-zoom-in object-contain"
      />
      {dims && (
        <div className="mt-1 text-[10px] text-cc-muted font-mono-code">
          {dims.w}×{dims.h}
        </div>
      )}
      {zoomed && <ImageLightbox src={url} alt={basename(path)} onClose={() => setZoomed(false)} />}
    </div>
  );
}
