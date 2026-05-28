/**
 * NoSeedOnboardOverlay — sidebar intro that floats on top of the
 * viewer when a mode has no user-pickable seeds and the workspace is
 * empty.
 *
 * For interactive modes (invoice-organization, dashboards, anything
 * whose UI *is* the entry point) the viewer must be visible from the
 * start — replacing it with a full empty state hides the action
 * surface. Instead we leave the viewer mounted and overlay a
 * dismissable card on the left, anchored to the pane. The user can
 * read the mode's identity + a "describe what you want" prompt, then
 * close it and interact with the viewer directly.
 *
 * Dismissal is component-local (useState). When the workspace becomes
 * empty again later in the session — e.g. the user deletes all the
 * content set's files — the overlay returns naturally because the
 * parent remounts it.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store/index.js";
import { resolveLocalized } from "../../core/types/mode-manifest.js";
import { ModeIcon } from "./ModeIcon.js";

export function NoSeedOnboardOverlay() {
  const { t } = useTranslation("gallery");
  const manifest = useStore((s) => s.modeManifest);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const displayName = manifest ? resolveLocalized(manifest.displayName, "en") : undefined;
  const description = manifest ? resolveLocalized(manifest.description, "en") : undefined;

  return (
    <aside
      className="no-seed-overlay absolute top-0 left-0 bottom-0 z-20 w-[min(380px,90%)] flex flex-col
        bg-cc-bg/85 backdrop-blur-xl border-r border-cc-border/40
        shadow-[8px_0_28px_-12px_rgba(0,0,0,0.55)] text-cc-fg
        [animation:noseed-overlay-in_280ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("onboard.close")}
        title={t("onboard.close")}
        className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center
          rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
      >
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
          <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex-1 flex flex-col justify-between px-8 py-10 lg:px-10 lg:py-12 overflow-y-auto">
        <div className="space-y-5">
          <div className="flex items-center gap-2.5 text-cc-muted/70">
            {manifest?.icon && (
              <ModeIcon svg={manifest.icon} className="w-4 h-4 text-cc-primary/80 shrink-0" />
            )}
            {displayName && (
              <span className="text-[11px] tracking-[0.18em] uppercase font-medium">
                {t("intro.eyebrow", { mode: displayName })}
              </span>
            )}
          </div>

          {displayName && (
            <h1 className="font-logo font-medium leading-[1.05] tracking-tight text-cc-fg text-[clamp(1.875rem,3.4vw,2.75rem)]">
              {displayName}
            </h1>
          )}

          {description && (
            <p className="text-sm text-cc-muted leading-relaxed">{description}</p>
          )}

          <p className="text-sm text-cc-fg/85 leading-relaxed pt-2">
            {t("noSeed.body")}
          </p>
        </div>

        <div className="mt-8 pt-6 border-t border-cc-border/30 space-y-3">
          <p className="text-[11px] tracking-[0.18em] uppercase text-cc-primary/90 flex items-center gap-2">
            <span>{t("noSeed.hint")}</span>
            <span aria-hidden>→</span>
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-[11px] text-cc-muted/80 hover:text-cc-fg transition-colors cursor-pointer"
          >
            {t("onboard.dismiss")}
          </button>
        </div>
      </div>
    </aside>
  );
}
