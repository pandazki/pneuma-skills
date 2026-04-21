// Fixed-size preview tile used by AssetManagerModal's Image/Video
// filter rows. Extracted to its own module once the modal file grew
// past the co-location threshold (~600 lines); still only consumed
// by the modal so the exports stay internal to the assets/ folder.
//
// Design:
//   - missing  → dimmed danger-tinted frame with a warning glyph,
//                never touches the network (avoids a spinner +
//                noisy 404 in devtools for files that aren't there).
//   - image    → <img loading=lazy> — browsers defer decode nicely
//                for long lists.
//   - video    → <video preload=metadata> seeked to 0.1s on load,
//                muted / playsInline so it renders the first real
//                frame without user interaction. 0 frequently shows
//                the poster (or a black frame) on Chromium.
//   - audio/other → same neutral frame as the compact row badge,
//                just larger. Waveforms are a later task.

import type { AssetType } from "@pneuma-craft/react";
import { AudioIcon, WarningIcon } from "../icons/index.js";
import { theme } from "../theme/tokens.js";

/** Workspace-relative uri → URL served by the dev/content server. */
function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

export interface MediaPreviewProps {
  uri: string;
  type: AssetType | null;
  missing: boolean;
  /** Square edge length in px. Both width and height use this value
   *  — callers that need a non-square frame would need to extend
   *  this. Kept single-dimension so rows share one value. */
  size: number;
}

export function MediaPreview({ uri, type, missing, size }: MediaPreviewProps) {
  const frameStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
    background: missing ? theme.color.dangerSoft : theme.color.surface3,
    border: `1px solid ${
      missing ? theme.color.dangerBorder : theme.color.borderWeak
    }`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: missing ? theme.color.dangerInk : theme.color.ink4,
    flexShrink: 0,
  };

  if (missing) {
    return (
      <div style={frameStyle} aria-hidden>
        <WarningIcon size={20} />
      </div>
    );
  }

  const url = contentUrl(uri);

  if (type === "image") {
    return (
      <div style={frameStyle} aria-hidden>
        <img
          src={url}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  if (type === "video") {
    return (
      <div style={frameStyle} aria-hidden>
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          onLoadedData={(e) => {
            // Nudge past 0 so browsers that hold a blank poster at
            // currentTime=0 reveal the first real frame instead.
            (e.target as HTMLVideoElement).currentTime = 0.1;
          }}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  // Audio / unknown — show the type icon in the frame. Image and
  // video are handled above, so this branch only ever sees "audio",
  // "text" (rare in this modal), or null.
  const Icon = type === "audio" ? AudioIcon : null;

  return (
    <div style={frameStyle} aria-hidden>
      {Icon ? <Icon size={20} /> : null}
    </div>
  );
}
