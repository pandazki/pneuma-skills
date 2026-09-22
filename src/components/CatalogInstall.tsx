/**
 * Catalog install affordances — the parts of a launcher card that differ for
 * a mode Pneuma knows about but has not downloaded yet.
 *
 * Extracted from `Launcher.tsx` because the same three states (needs a
 * download / downloading / failed) have to render on the gallery card, the
 * Quick Start tile and the Mode Maker hero. Presentational only: the stream
 * and its record live in `src/store/catalog-install.ts`.
 *
 * Design: Ethereal Tech tokens only (`cc-*`), SVG glyphs, no emoji, and no
 * native `<progress>` — the bar is a token-styled div so it matches the rest
 * of the launcher on every platform.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import {
  formatBytes,
  installPercent,
  type CatalogInstall as CatalogInstallRecord,
} from "../store/catalog-install.js";

/** Arrow into a tray — "this is not on your machine yet". */
export function DownloadGlyph({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4.5 16.5v1.75A2.75 2.75 0 007.25 21h9.5a2.75 2.75 0 002.75-2.75V16.5" />
    </svg>
  );
}

/** Circular arrows — "installed, but built for another release". */
export function RefreshGlyph({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11.5A8 8 0 006.3 6.3L4 8.5" />
      <path d="M4 4.5v4h4" />
      <path d="M4 12.5A8 8 0 0017.7 17.7L20 15.5" />
      <path d="M20 19.5v-4h-4" />
    </svg>
  );
}

/**
 * Determinate bar for a download whose total the server announced, and a
 * breathing full-width fill for the window before it does. Both read as
 * "work is happening"; only the determinate one claims to know how far along
 * it is, so a stream that never reports a total can never look like 0%.
 */
export function InstallProgressBar({
  percent,
  className = "",
}: {
  percent: number | null;
  className?: string;
}) {
  return (
    <div
      className={`h-1 w-full rounded-full bg-cc-border/40 overflow-hidden ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { "aria-valuenow": percent })}
    >
      {percent === null ? (
        <div className="h-full w-full rounded-full bg-cc-primary/40 animate-pulse" />
      ) : (
        <div
          className="h-full rounded-full bg-cc-primary"
          style={{ width: `${percent}%`, transition: "width 0.25s ease-out" }}
        />
      )}
    </div>
  );
}

/**
 * Quiet size chip next to a catalog mode's title — the one piece of
 * information a first-class card is missing when the mode is not on disk.
 */
export function InstallSizeChip({ bytes }: { bytes: number }) {
  const { t } = useTranslation("launcher");
  if (!bytes) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-cc-muted/70 bg-cc-surface/60 border border-cc-border/30">
      <DownloadGlyph className="w-2.5 h-2.5" />
      {t("catalog.size_hint", { size: formatBytes(bytes) })}
    </span>
  );
}

/** Label for the progress line: percentage when known, plain copy until then. */
export function useInstallLabel(install: CatalogInstallRecord | undefined): string {
  const { t } = useTranslation("launcher");
  const percent = installPercent(install);
  if (percent === null) return t("catalog.preparing");
  return t("catalog.downloading_percent", { percent });
}

/**
 * The action on a gallery card for a catalog mode. Four resting shapes:
 *
 *  - not installed → "Download and open" (+ the size, on the title row)
 *  - stale         → "Update and open" (+ why, in the card body)
 *  - downloading   → progress line, percentage from the stream
 *  - failed        → the server's own reason and a retry
 *
 * An installed catalog mode never reaches here; it renders the builtin
 * "Launch" button, because at that point it IS one.
 */
export function CatalogCardAction({
  stale,
  install,
  onStart,
}: {
  stale: boolean;
  install: CatalogInstallRecord | undefined;
  onStart: () => void;
}) {
  const { t } = useTranslation("launcher");
  const percent = installPercent(install);
  const label = useInstallLabel(install);

  if (install?.phase === "installing") {
    return (
      <div className="w-44 shrink-0" aria-live="polite">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-[11px] text-cc-primary/90">{label}</span>
          {install.total > 0 && (
            <span className="text-[10px] text-cc-muted/50 font-mono">
              {formatBytes(install.total)}
            </span>
          )}
        </div>
        <InstallProgressBar percent={percent} />
      </div>
    );
  }

  if (install?.phase === "error") {
    return (
      <div className="flex items-center gap-2 shrink-0 max-w-[22rem]">
        <span
          className="text-[11px] text-red-400/90 truncate"
          title={install.error || t("catalog.failed")}
        >
          {install.error || t("catalog.failed")}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onStart(); }}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer shrink-0"
        >
          {t("catalog.retry")}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onStart(); }}
      className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-cc-primary/10 text-cc-primary hover:bg-cc-primary hover:text-white transition-colors cursor-pointer shrink-0"
    >
      {stale ? <RefreshGlyph className="w-3.5 h-3.5" /> : <DownloadGlyph className="w-3.5 h-3.5" />}
      {stale ? t("catalog.update_and_open") : t("catalog.download_and_open")}
    </button>
  );
}
