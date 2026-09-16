import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store.js";
import { isAliveSubagent, type SubagentEntry } from "../store/subagent-slice.js";
import type { SubagentStatus } from "../types.js";
import { deriveSubagentLabel } from "./subagent-display.js";

/** Chips shown before the overflow badge takes over. */
const MAX_CHIPS = 3;

const STATUS_DOT: Record<SubagentStatus, string> = {
  running: "bg-cc-warning animate-pulse",
  idle: "bg-cc-muted/70",
  completed: "bg-cc-success",
  failed: "bg-cc-error",
  interrupted: "bg-cc-muted/70",
};

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={active ? "true" : undefined}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] leading-none
                  whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? "border-cc-primary/50 bg-cc-primary/10 text-cc-fg"
                      : "border-cc-border/60 bg-cc-card/40 text-cc-muted hover:text-cc-fg hover:border-cc-border"
                  }`}
    >
      {children}
    </button>
  );
}

/**
 * The view switcher for a session that has a team (§2.4): the main
 * conversation plus every agent still alive, with the open view highlighted
 * and an unread dot on 主对话 while root messages land behind an agent view.
 * Completed agents leave the strip and stay reachable through their cards.
 */
export default function SubagentStrip() {
  const { t } = useTranslation("subagent");
  const subagents = useStore((s) => s.subagents);
  const viewingAgentId = useStore((s) => s.viewingAgentId);
  const rootUnread = useStore((s) => s.rootUnread);
  const setViewingAgent = useStore((s) => s.setViewingAgent);
  const [expanded, setExpanded] = useState(false);

  // The open view always has a chip, even after its agent finished.
  const chips = useMemo<SubagentEntry[]>(
    () =>
      [...subagents.values()]
        .filter((entry) => isAliveSubagent(entry) || entry.id === viewingAgentId)
        .sort((a, b) => a.firstSeenAt - b.firstSeenAt),
    [subagents, viewingAgentId],
  );

  if (chips.length === 0) return null;

  const overflow = expanded ? 0 : Math.max(0, chips.length - MAX_CHIPS);
  const shown = overflow > 0 ? chips.slice(0, MAX_CHIPS) : chips;

  // A compact floating chip cluster, not a full-width slab: it is pinned over
  // the scrolling conversation, so it has to be opaque enough to read and
  // narrow enough to leave the rest of the line to the messages — the same
  // language as the status pill in the opposite corner.
  return (
    <div
      data-subagent-strip
      className="inline-flex w-fit max-w-full flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-xl
                 border border-cc-border/50 bg-cc-surface/90 backdrop-blur-xl
                 shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
    >
      <Chip active={viewingAgentId === null} onClick={() => setViewingAgent(null)}>
        <span className="w-1.5 h-1.5 rounded-full bg-cc-primary/80 shrink-0" aria-hidden="true" />
        <span>{t("strip.main")}</span>
        {rootUnread && viewingAgentId !== null && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-cc-primary shrink-0 animate-pulse"
            title={t("strip.unread")}
            aria-label={t("strip.unread")}
          />
        )}
      </Chip>

      {shown.map((entry) => {
        const label = deriveSubagentLabel(entry, undefined, t("generic_label"));
        return (
          <Chip
            key={entry.id}
            active={viewingAgentId === entry.id}
            onClick={() => setViewingAgent(entry.id)}
            title={entry.detail || label}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[entry.status]}`} aria-hidden="true" />
            <span className="max-w-[9rem] truncate">{label}</span>
          </Chip>
        );
      })}

      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={t("strip.more")}
          className="px-2 py-1 rounded-full border border-cc-border/60 bg-cc-card/40 text-[11px] leading-none
                     text-cc-muted hover:text-cc-fg hover:border-cc-border transition-colors cursor-pointer tabular-nums"
        >
          {t("strip.overflow", { count: overflow })}
        </button>
      )}
    </div>
  );
}
