// src/player/LocalClientFallback.tsx
//
// Shown when a shared session uses a mode the hosted player can't render
// (clipcraft, mode-maker, gridboard, custom modes, …). Rather than a broken
// viewer, we offer to open it in the local Pneuma client via the pneuma://
// URL scheme, which the desktop app handles as a history import.

import type { PlayPackageIndex } from "../../core/types/play-package.js";

export function LocalClientFallback({ index }: { index: PlayPackageIndex | null }) {
  const importUrl = index?.importUrl;
  const title = index?.manifest.metadata.title || "this session";
  const mode = index?.mode;

  return (
    <div className="h-full w-full flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="mx-auto w-12 h-12 rounded-xl bg-cc-primary/15 text-cc-primary flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
            <rect x="3" y="4" width="18" height="14" rx="2" />
            <path d="M8 21h8M12 18v3" />
          </svg>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-base font-semibold text-cc-fg">Best viewed in the Pneuma app</h1>
          <p className="text-sm text-cc-muted leading-relaxed">
            {mode ? <>The <span className="text-cc-fg font-medium">{mode}</span> mode</> : "This mode"} isn’t
            available in the online player yet. Open {title} in the Pneuma desktop app to view and continue it.
          </p>
        </div>
        {importUrl ? (
          <div className="space-y-3">
            <a
              href={`pneuma://import/${encodeURIComponent(importUrl)}`}
              className="inline-block px-5 py-2 rounded-lg bg-cc-primary text-white text-sm font-medium hover:brightness-110 transition-all cursor-pointer no-underline"
            >
              Open in Pneuma
            </a>
            <p className="text-[11px] text-cc-muted/70">
              Don’t have the app?{" "}
              <a href="/" className="text-cc-primary hover:underline">Get Pneuma</a>
            </p>
          </div>
        ) : (
          <p className="text-xs text-cc-muted/70">No import link is available for this session.</p>
        )}
      </div>
    </div>
  );
}
