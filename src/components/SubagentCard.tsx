import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useStore } from "../store.js";
import type { SubagentStatus } from "../types.js";
import { getToolLabel, getPreview, ToolIcon } from "./ToolBlock.js";
import { deriveSubagentLabel, latestSubagentActivity, streamingTail } from "./subagent-display.js";

/**
 * Status dot palette (§5.3). `cc-warning` is the theme's amber; the pulse is
 * what separates "still working" from "finished" at a glance.
 */
const STATUS_DOT: Record<SubagentStatus, string> = {
  running: "bg-cc-warning animate-pulse",
  idle: "bg-cc-muted/70",
  completed: "bg-cc-success",
  failed: "bg-cc-error",
  interrupted: "bg-cc-muted/70",
};

/**
 * Beyond this, a "running" agent is not running — it is a stale roster entry
 * replayed from an old `history.json` with the emitter's original clock
 * (§6 keeps the last known status rather than inventing "completed"). Showing
 * "24875h" for it would be technically true of the timestamp and useless to
 * the reader, so the elapsed is dropped and only the status remains.
 */
const MAX_LIVE_ELAPSED_MS = 6 * 60 * 60 * 1000;

export function formatElapsed(ms: number): string | null {
  if (ms > MAX_LIVE_ELAPSED_MS) return null;
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Live "42s" for a running agent; frozen (and hidden) once it is not. */
function useElapsed(startedAt: number | undefined, running: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!running || startedAt === undefined) return null;
  return formatElapsed(now - startedAt);
}

export function describeToolCall(
  name: string,
  input: Record<string, unknown>,
  tTool: TFunction,
): string {
  const label = getToolLabel(name, tTool);
  const preview = getPreview(name, input, tTool);
  return preview ? `${label} · ${preview}` : label;
}

/**
 * The card that stands in the spawner's conversation where the raw spawn tool
 * call used to render (§2.4): who was spawned, whether they are still working,
 * the last thing they did, and a way into their own conversation.
 *
 * Also used as the synthetic card for a roster entry whose anchor `tool_use`
 * block is missing (a Claude history recorded before attribution was read),
 * in which case there is no `anchorInput` to derive a label from.
 */
export default function SubagentCard({
  id,
  anchorInput,
}: {
  id: string;
  /** `input` of the spawn `tool_use` block, when this card has an anchor. */
  anchorInput?: Record<string, unknown>;
}) {
  const { t } = useTranslation("subagent");
  const { t: tTool } = useTranslation("tool-block");
  const entry = useStore((s) => s.subagents.get(id));
  const streaming = useStore((s) => s.streamingByAgent.get(id));
  const messages = useStore((s) => s.messages);
  const setViewingAgent = useStore((s) => s.setViewingAgent);

  const status: SubagentStatus = entry?.status ?? "running";
  const label = deriveSubagentLabel(entry, anchorInput, t("generic_label"));
  const elapsed = useElapsed(entry?.firstSeenAt, status === "running");
  const live = !!streaming && streaming.trim().length > 0;

  const activity = useMemo(() => {
    const tail = streamingTail(streaming);
    if (tail) return tail;
    return latestSubagentActivity(messages, id, (name, input) =>
      describeToolCall(name, input, tTool),
    );
  }, [messages, streaming, id, tTool]);

  const open = () => setViewingAgent(id);

  return (
    <div
      role="button"
      tabIndex={0}
      data-subagent-card={id}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      title={entry?.detail || label}
      className="group w-full text-left rounded-lg border border-cc-border/60 bg-cc-card/50 backdrop-blur-sm
                 overflow-hidden cursor-pointer transition-colors hover:border-cc-primary/40 hover:bg-cc-hover/30
                 focus:outline-none focus-visible:border-cc-primary/60"
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} aria-hidden="true" />
        <ToolIcon type="agent" />
        <span className="text-xs font-medium text-cc-fg truncate">{label}</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-cc-muted/80 shrink-0 tabular-nums">
          <span>{t(`status.${status}`)}</span>
          {elapsed && (
            <>
              <span className="text-cc-border">&middot;</span>
              <span>{elapsed}</span>
            </>
          )}
        </span>
      </div>

      <div className="flex items-start gap-1.5 px-3 pt-1">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 mt-[3px] text-cc-muted/50 shrink-0">
          <path d="M4 3v6h8" strokeLinecap="round" />
          <path d="M9.5 6.5L12 9l-2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={`text-[11px] leading-snug min-w-0 flex-1 truncate ${activity ? "text-cc-muted" : "text-cc-muted/60 italic"}`}>
          {activity ?? t("card.waiting")}
        </span>
        {live && (
          <span
            className="w-1.5 h-1.5 mt-[5px] rounded-full bg-cc-primary shrink-0 animate-pulse"
            title={t("card.live")}
            aria-label={t("card.live")}
          />
        )}
      </div>

      {status === "failed" && entry?.detail && (
        <div className="mx-3 mt-1.5 px-2 py-1 rounded border border-cc-error/30 bg-cc-error/5 text-[10px] leading-snug text-cc-error/90 break-words">
          {entry.detail}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[10px] text-cc-muted/70 truncate min-w-0 flex-1 tabular-nums">
          {entry?.model}
          {entry?.model && entry?.context_used_percent !== undefined && <span className="text-cc-border"> &middot; </span>}
          {entry?.context_used_percent !== undefined && `ctx ${entry.context_used_percent}%`}
        </span>
        <span className="flex items-center gap-1 text-[10px] font-medium text-cc-primary/80 group-hover:text-cc-primary shrink-0 transition-colors">
          {t("card.view")}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3 h-3">
            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
