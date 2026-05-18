/**
 * HandoffCard — fixed overlay surfacing the active proposed handoff for the
 * current session. v2 tool-call protocol: subscribes to `handoff_proposed`
 * WS events, renders the structured payload (intent, summary, files,
 * decisions, open questions), and either confirms (POST /api/handoffs/:id/
 * confirm → navigate to launchUrl) or cancels (optional reason → POST
 * /api/handoffs/:id/cancel → source agent receives the cancel tag).
 *
 * One proposal at a time per session. The card disappears when the user
 * acts, when the server times out the proposal (silent), or when another
 * browser tab acts on it (handoff_cancelled WS event).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store/index.js";
import { getApiBase } from "../utils/api.js";

export default function HandoffCard() {
  const { t } = useTranslation("handoff");
  const proposed = useStore((s) => s.proposedHandoff);
  const status = useStore((s) => s.handoffStatus);
  const setProposed = useStore((s) => s.setProposedHandoff);
  const setStatus = useStore((s) => s.setHandoffStatus);

  // Inline cancel form — opens when user clicks Cancel; the reason input
  // sits inside the card so there's no popover / modal nesting (per the
  // design language: no nested cards, no popovers when an inline reveal
  // works).
  const [showCancelInput, setShowCancelInput] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!proposed) return null;
  const { handoff_id, payload } = proposed;

  const handleConfirm = async () => {
    if (status !== "idle") return;
    setStatus("sending-confirm");
    setError(null);
    try {
      const res = await fetch(
        `${getApiBase()}/api/handoffs/${encodeURIComponent(handoff_id)}/confirm`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? t("confirm_failed_code", { code: res.status }));
        setStatus("idle");
        return;
      }
      const data = (await res.json()) as { launchUrl?: string };
      if (data.launchUrl) {
        // Clear the card optimistically before navigating — if the browser
        // bumps back via history, the proposal state is fresh.
        setProposed(null);
        window.location.href = data.launchUrl;
      } else {
        setError(t("no_launch_url"));
        setStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("confirm_failed"));
      setStatus("idle");
    }
  };

  const handleCancel = async () => {
    if (status !== "idle") return;
    setStatus("sending-cancel");
    setError(null);
    try {
      const res = await fetch(
        `${getApiBase()}/api/handoffs/${encodeURIComponent(handoff_id)}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: cancelReason.trim() }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? t("cancel_failed_code", { code: res.status }));
        setStatus("idle");
        return;
      }
      // Clear locally — the WS broadcast will also fire for any sibling
      // tabs, and our handler dedupes on handoff_id.
      setProposed(null);
      setShowCancelInput(false);
      setCancelReason("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cancel_failed"));
      setStatus("idle");
    }
  };

  const sourceLabel = payload.source_display_name
    ? `${payload.source_mode ?? "?"} · ${payload.source_display_name}`
    : payload.source_mode ?? "?";

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[460px] flex flex-col gap-3 pointer-events-none">
      <div
        role="dialog"
        aria-label={t("dialog_aria")}
        className="bg-cc-surface border border-cc-border rounded-xl shadow-2xl p-5 pointer-events-auto backdrop-blur-xl"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-cc-muted text-xs uppercase tracking-wider">
            {t("ready")}
          </span>
          <span className="text-cc-primary text-xs font-mono-code">
            {sourceLabel} → {payload.target_mode}
          </span>
        </div>

        {/* Intent — the high-order line, biggest type weight. */}
        <p className="text-cc-fg text-sm leading-relaxed mb-3">{payload.intent}</p>

        {payload.summary ? (
          <p className="text-cc-muted text-xs leading-relaxed mb-3 line-clamp-4">
            {payload.summary}
          </p>
        ) : null}

        {payload.suggested_files && payload.suggested_files.length > 0 ? (
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wider text-cc-muted/70 mb-1.5">
              {t("files")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {payload.suggested_files.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center px-2 py-0.5 text-[11px] font-mono-code rounded bg-cc-hover/40 text-cc-fg/80"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {payload.key_decisions && payload.key_decisions.length > 0 ? (
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wider text-cc-muted/70 mb-1.5">
              {t("decisions_locked")}
            </div>
            <ul className="text-xs text-cc-fg/85 list-disc pl-4 space-y-0.5">
              {payload.key_decisions.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {payload.open_questions && payload.open_questions.length > 0 ? (
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wider text-cc-muted/70 mb-1.5">
              {t("open_questions")}
            </div>
            <ul className="text-xs text-cc-fg/85 list-disc pl-4 space-y-0.5">
              {payload.open_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 text-xs text-red-400/90">{error}</div>
        ) : null}

        {showCancelInput ? (
          <div className="mb-3">
            <textarea
              autoFocus
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t("cancel_reason_placeholder")}
              rows={2}
              className="w-full text-xs px-2 py-1.5 rounded border border-cc-border bg-cc-hover/30 text-cc-fg placeholder:text-cc-muted/50 focus:border-cc-primary/60 focus:outline-none"
            />
          </div>
        ) : null}

        <div className="flex gap-2 justify-end">
          {showCancelInput ? (
            <>
              <button
                type="button"
                disabled={status !== "idle"}
                className="px-3 py-1.5 text-sm text-cc-muted hover:text-cc-fg disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  setShowCancelInput(false);
                  setCancelReason("");
                  setError(null);
                }}
              >
                {t("back")}
              </button>
              <button
                type="button"
                disabled={status !== "idle"}
                className="px-3 py-1.5 text-sm border border-cc-border rounded-md hover:border-cc-muted disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleCancel}
              >
                {status === "sending-cancel" ? t("cancelling") : t("cancel_handoff")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={status !== "idle"}
                className="px-3 py-1.5 text-sm border border-cc-border rounded-md hover:border-cc-muted disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  setShowCancelInput(true);
                  setError(null);
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={status !== "idle"}
                className="px-3 py-1.5 text-sm bg-cc-primary text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleConfirm}
              >
                {status === "sending-confirm" ? t("switching") : t("confirm_switch")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
