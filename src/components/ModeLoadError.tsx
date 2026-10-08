import { useTranslation } from "react-i18next";

export function ModeLoadError({ error, retrying, onRetry }: {
  error: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="h-full w-full overflow-auto flex items-center justify-center p-6 sm:p-8 text-cc-fg">
      <section className="w-full max-w-xl space-y-5" aria-labelledby="mode-load-error-title" aria-busy={retrying}>
        <div className="space-y-2">
          <h2 id="mode-load-error-title" className="font-logo text-2xl leading-tight">{t("viewer_load_failed")}</h2>
          <p className="text-sm text-cc-muted leading-relaxed">{t("viewer_load_failed_help")}</p>
        </div>
        <pre role="alert" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-cc-border bg-cc-surface p-4 font-mono text-xs text-cc-fg">{error}</pre>
        <button type="button" onClick={onRetry} disabled={retrying}
          className="rounded-lg bg-cc-primary px-4 py-2 text-sm font-medium text-cc-bg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cc-primary disabled:opacity-60 disabled:cursor-wait cursor-pointer transition-opacity">
          {t(retrying ? "viewer_retrying" : "viewer_retry")}
        </button>
      </section>
    </div>
  );
}
