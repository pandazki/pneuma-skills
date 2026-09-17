import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store.js";
import { forceReconnect } from "../ws.js";
import MessageBubble from "./MessageBubble.js";
import StreamingText from "./StreamingText.js";
import ActivityIndicator from "./ActivityIndicator.js";
import PermissionBanner from "./PermissionBanner.js";
import ChatInput from "./ChatInput.js";
import SubagentCard from "./SubagentCard.js";
import SubagentStrip from "./SubagentStrip.js";
import {
  deriveSubagentLabel,
  orphanSubagentPlacements,
  stripChipEntries,
  subagentAncestry,
} from "./subagent-display.js";
import type { ChatMessage } from "../types.js";

interface ToolUseInfo {
  name: string;
  input: Record<string, unknown>;
}

/**
 * Walk every message once and collect tool_use blocks into a single
 * map keyed by tool_use_id. Cross-message lookup matters for backends
 * (notably Codex) that emit `tool_use` and `tool_result` in separate
 * assistant messages — without this, the result block falls back to
 * the generic plain-text card and loses the BashResultBlock styling.
 */
function buildGlobalToolUseMap(messages: ChatMessage[]): Map<string, ToolUseInfo> {
  const map = new Map<string, ToolUseInfo>();
  for (const msg of messages) {
    const blocks = msg.contentBlocks;
    if (!blocks) continue;
    for (const block of blocks) {
      if (block.type === "tool_use") {
        map.set(block.id, { name: block.name, input: block.input });
      }
    }
  }
  return map;
}

function CronTriggerBubble({ prompt }: { prompt: string }) {
  const { t } = useTranslation("chat-panel");
  return (
    <div className="flex justify-end animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="max-w-[85%] rounded-[20px] rounded-br-[6px] bg-cc-card/60 border border-cc-border overflow-hidden shadow-sm">
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 text-cc-muted/70 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span className="text-[10px] font-medium text-cc-muted/70 tracking-wide uppercase">
            {t("scheduled_task")}
          </span>
        </div>
        <div className="px-3 pb-2.5 pt-0.5">
          <div className="text-[13px] leading-relaxed break-words font-chat text-cc-fg/80">
            {prompt}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusDot() {
  const { t } = useTranslation("chat-panel");
  const connectionStatus = useStore((s) => s.connectionStatus);
  const cliConnected = useStore((s) => s.cliConnected);
  const sessionStatus = useStore((s) => s.sessionStatus);

  const color =
    connectionStatus === "connected" && cliConnected
      ? sessionStatus === "running" || sessionStatus === "compacting"
        ? "bg-amber-400"
        : "bg-green-400"
      : "bg-red-400";

  const text =
    connectionStatus !== "connected"
      ? t("status.disconnected")
      : !cliConnected
        ? t("status.cli_disconnected")
        : sessionStatus === "running"
          ? t("status.running")
          : sessionStatus === "compacting"
            ? t("status.compacting")
            : t("status.idle");

  const isDisconnected = connectionStatus !== "connected" || !cliConnected;

  return (
    <div className="flex items-center gap-1.5" title={text}>
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-cc-muted text-xs">{text}</span>
      {isDisconnected && (
        <button
          onClick={(e) => {
            // Don't let the click bubble to the pill's expand/collapse toggle.
            e.stopPropagation();
            forceReconnect();
          }}
          className="text-cc-muted hover:text-cc-primary text-xs transition-colors cursor-pointer"
          title={t("reconnect")}
        >
          ↻
        </button>
      )}
    </div>
  );
}

function SessionInfo() {
  const { t } = useTranslation("chat-panel");
  const session = useStore((s) => s.session);
  if (!session) return null;

  // Cost is gated on capability (claude-code-only today). Context-window % is
  // populated by any backend that reports it (claude-code, codex) — let the
  // `> 0` self-suppression decide visibility instead of a capability gate, so
  // we don't accidentally hide a value the backend is actually shipping.
  const costTracking = session.agent_capabilities?.costTracking ?? false;

  return (
    <div className="flex items-center gap-2 text-xs text-cc-muted">
      <span>{session.model || t("no_model")}</span>
      {costTracking && session.total_cost_usd > 0 && (
        <>
          <span className="text-cc-border">&middot;</span>
          <span>${session.total_cost_usd.toFixed(4)}</span>
        </>
      )}
      {session.context_used_percent > 0 && (
        <>
          <span className="text-cc-border">&middot;</span>
          <span>ctx {session.context_used_percent}%</span>
        </>
      )}
    </div>
  );
}

const STATUS_EXPANDED_LS_KEY = "pneuma:chat-status-expanded";

/** Within this distance of the bottom the view counts as "at the tail". */
const PIN_THRESHOLD_PX = 60;

/**
 * Status pill. Collapsed by default to just the status dot + state label (the
 * only thing most glances need); clicking expands it to also show model /
 * cost / context, and clicking again collapses. The preference is remembered
 * in localStorage. The inner reconnect button stops propagation so it doesn't
 * toggle the pill.
 *
 * It floats over the conversation's top-right corner in a plain session. When
 * the panel has a header row (the agent strip), the pill joins that row in
 * normal flow instead: an expanded pill is wide, and two overlapping pieces
 * of chrome fighting for the same corner is what the absolute position cost
 * us the first time round.
 */
function AgentStatusBar({ inRow = false }: { inRow?: boolean } = {}) {
  const { t } = useTranslation("chat-panel");
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STATUS_EXPANDED_LS_KEY) === "1";
  });
  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STATUS_EXPANDED_LS_KEY, next ? "1" : "0");
      } catch {
        /* localStorage unavailable — non-fatal */
      }
      return next;
    });
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      title={expanded ? t("status.collapse") : t("status.expand")}
      className={`${inRow ? "shrink-0" : "absolute top-4 right-4 z-10"} flex items-center gap-3 px-4 py-1.5 bg-cc-surface/60 backdrop-blur-md border border-white/5 rounded-full shadow-sm cursor-pointer select-none hover:bg-cc-surface/80 transition-colors`}
    >
      <StatusDot />
      {expanded && <SessionInfo />}
    </div>
  );
}

/**
 * Agent-view chrome: the ancestry breadcrumb (`主对话 / builder / judge`, every
 * segment clickable) plus this agent's own status line. The floating status
 * pill above always describes the root agent — this is the only place a
 * subagent's status, model, and context share the header.
 */
function AgentViewHeader({ agentId }: { agentId: string }) {
  const { t } = useTranslation("subagent");
  const subagents = useStore((s) => s.subagents);
  const setViewingAgent = useStore((s) => s.setViewingAgent);
  const chain = subagentAncestry(subagents, agentId);
  const current = subagents.get(agentId);
  const status = current?.status ?? "running";
  const generic = t("generic_label");
  const parentId = current?.parent_id ?? null;

  return (
    <div className="rounded-xl border border-cc-border/40 bg-cc-surface/50 backdrop-blur-md px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={() => setViewingAgent(parentId)}
          title={t("view.back")}
          aria-label={t("view.back")}
          className="flex items-center justify-center w-5 h-5 rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-hover/60 transition-colors cursor-pointer shrink-0"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5">
            <path d="M10 4L6 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <nav className="flex items-center gap-1 min-w-0 text-[11px] leading-none" aria-label={t("view.breadcrumb")}>
          <button
            type="button"
            onClick={() => setViewingAgent(null)}
            className="text-cc-muted hover:text-cc-fg transition-colors cursor-pointer shrink-0"
          >
            {t("strip.main")}
          </button>
          {chain.map((entry, i) => {
            const last = i === chain.length - 1;
            const label = deriveSubagentLabel(entry, undefined, generic);
            return (
              <span key={entry.id} className="flex items-center gap-1 min-w-0">
                <span className="text-cc-border shrink-0">/</span>
                {last ? (
                  <span className="text-cc-fg font-medium truncate">{label}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setViewingAgent(entry.id)}
                    className="text-cc-muted hover:text-cc-fg transition-colors cursor-pointer truncate"
                  >
                    {label}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-cc-muted/80 shrink-0 tabular-nums">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === "running"
                ? "bg-cc-warning animate-pulse"
                : status === "completed"
                  ? "bg-cc-success"
                  : status === "failed"
                    ? "bg-cc-error"
                    : "bg-cc-muted/70"
            }`}
            aria-hidden="true"
          />
          <span>{t(`status.${status}`)}</span>
          {current?.model && (
            <>
              <span className="text-cc-border">&middot;</span>
              <span className="truncate max-w-[8rem]">{current.model}</span>
            </>
          )}
          {current?.context_used_percent !== undefined && (
            <>
              <span className="text-cc-border">&middot;</span>
              <span>ctx {current.context_used_percent}%</span>
            </>
          )}
        </span>
      </div>
      {status === "failed" && current?.detail && (
        <div className="px-1 text-[10px] leading-snug text-cc-error/90 break-words">{current.detail}</div>
      )}
    </div>
  );
}

/**
 * What replaces the composer in an agent view. There is no user→subagent
 * channel on any backend, so the honest affordance is a read-only note and
 * the way back.
 */
function AgentViewFooter({ agentId }: { agentId: string }) {
  const { t } = useTranslation("subagent");
  const entry = useStore((s) => s.subagents.get(agentId));
  const setViewingAgent = useStore((s) => s.setViewingAgent);
  const label = deriveSubagentLabel(entry, undefined, t("generic_label"));

  return (
    <div className="flex items-center gap-2 rounded-xl border border-cc-border/50 bg-cc-surface/70 backdrop-blur-md px-3 py-2.5">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="w-3.5 h-3.5 text-cc-muted/70 shrink-0">
        <path d="M8 3.5C4.5 3.5 2 8 2 8s2.5 4.5 6 4.5S14 8 14 8s-2.5-4.5-6-4.5z" />
        <circle cx="8" cy="8" r="1.8" />
      </svg>
      <span className="text-[11px] leading-snug text-cc-muted min-w-0 flex-1">
        {t("view.readonly_note", { label })}
      </span>
      <button
        type="button"
        onClick={() => setViewingAgent(null)}
        className="shrink-0 px-2.5 py-1 rounded-full border border-cc-primary/40 bg-cc-primary/10 text-[11px] leading-none
                   text-cc-primary hover:bg-cc-primary/20 transition-colors cursor-pointer"
      >
        {t("view.back")}
      </button>
    </div>
  );
}

export default function ChatPanel() {
  const { t } = useTranslation("chat-panel");
  const { t: tAgent } = useTranslation("subagent");
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => s.streaming);
  const activity = useStore((s) => s.activity);
  const cliConnected = useStore((s) => s.cliConnected);
  const replayMode = useStore((s) => s.replayMode);
  const permSize = useStore((s) => s.pendingPermissions.size);
  const subagents = useStore((s) => s.subagents);
  const viewingAgentId = useStore((s) => s.viewingAgentId);
  const streamingByAgent = useStore((s) => s.streamingByAgent);
  const activityByAgent = useStore((s) => s.activityByAgent);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The chat subtree, so the global `Escape` listener can tell a keystroke
  // aimed at this conversation from one aimed at anything else on screen.
  const rootRef = useRef<HTMLDivElement>(null);
  // Pinned = the view follows the conversation tail. Any user scroll away
  // from the bottom unpins; returning to the bottom band (manually or via
  // the jump button) re-pins.
  const pinnedRef = useRef(true);
  // True while a smooth programmatic scroll to the bottom is in flight, so
  // the scroll events it emits don't read as "user scrolled away".
  const smoothScrollingRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const globalToolUseById = useMemo(() => buildGlobalToolUseMap(messages), [messages]);

  // ── The view stack (§2.4) ────────────────────────────────────────────────
  // One panel, two levels of chrome: the root conversation and one agent's
  // conversation. Attribution alone decides what is visible, so a session
  // with no subagents renders exactly the list it always did.
  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if ((m.parentToolUseId ?? null) !== viewingAgentId) return false;
        // Errors, compaction markers and command output belong to the session,
        // not to any agent — they stay in the root conversation.
        return viewingAgentId === null || m.role !== "system";
      }),
    [messages, viewingAgentId],
  );

  // Every attribution key the session knows: roster entries plus anything a
  // message claims as its parent. `undefined` when there are none, so the
  // grouping in MessageBubble stays on its original path.
  //
  // Keyed on the roster's *keys*, not on the Map: a status or context-gauge
  // snapshot for an agent already on the roster cannot change this set, and
  // recomputing it would hand every `MessageBubble` a fresh `Set` and re-run
  // its grouping memo for the whole conversation. `\u0000` cannot occur in a
  // tool_use id, so the signature changes exactly when the key set does —
  // `subagents` is read inside the second memo but is deliberately not one of
  // its dependencies.
  const rosterSignature = useMemo(() => [...subagents.keys()].join("\u0000"), [subagents]);
  const subagentIds = useMemo(() => {
    const ids = new Set<string>(subagents.keys());
    for (const m of messages) {
      if (m.parentToolUseId) ids.add(m.parentToolUseId);
    }
    return ids.size > 0 ? ids : undefined;
  }, [messages, rosterSignature]);

  // Pre-fix Claude histories keep the subagent's reply and lose the `Task`
  // call that spawned it, so some roster entries have no anchor to render at
  // (§3.4). They get a synthetic card in chronological position instead.
  const orphans = useMemo(
    () => orphanSubagentPlacements(messages, subagents, viewingAgentId),
    [messages, subagents, viewingAgentId],
  );

  // Exactly the chips the strip would render (§2.4). Deriving the row's
  // existence from the strip's own rule is what keeps the panel from holding
  // a row open for a component that returns `null`.
  const stripChips = useMemo(
    () => stripChipEntries(subagents, viewingAgentId),
    [subagents, viewingAgentId],
  );
  const showStrip = stripChips.length > 0;
  // The header block: the view switcher and, in an agent view, that agent's
  // ancestry. An agent view always has a header even if its roster entry went
  // missing, so the way back stays reachable.
  const showHeaderRow = showStrip || viewingAgentId !== null;

  const viewStreaming = viewingAgentId === null
    ? streaming
    : streamingByAgent.get(viewingAgentId) ?? null;
  const viewActivity = viewingAgentId === null
    ? activity
    : activityByAgent.get(viewingAgentId) ?? null;

  // What an empty view says. An agent that has produced nothing says so in
  // replay too; only the root conversation's live-session prompts ("send a
  // message", "connecting") are suppressed there — hence two guards, not one.
  const emptyNote =
    visibleMessages.length > 0 || viewStreaming || viewActivity
      ? null
      : viewingAgentId !== null
        ? tAgent("view.no_output")
        : replayMode
          ? null
          : cliConnected
            ? t("empty_send_message")
            : t("empty_connecting");

  // Collapse a trailing run of same-reason `<pneuma:env>` banners.
  // Each fresh session spawn re-enqueues an `<pneuma:env reason="opened">`,
  // so a user who toggles editing on/off or reloads ends up with a stack
  // of identical "opened" pills at the bottom of the chat. Only the last
  // one in any consecutive same-reason run is informative — the rest are
  // noise. Detect collapsible runs and hand the renderer a `hiddenIds` set.
  const hiddenMessageIds = useMemo(() => {
    const hidden = new Set<string>();
    const parseReason = (content: string): string | null => {
      const m = content.trim().match(/^<pneuma:env\b[^>]*\breason="([^"]*)"[^>]*\/>$/i);
      return m ? m[1] : null;
    };
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "user") continue;
      const reason = parseReason(messages[i].content || "");
      if (!reason) continue;
      // Walk forward — if any later message in the chat is also a
      // user-side env tag with the same reason, the earlier one is
      // superseded. Other message types between them don't matter:
      // an assistant reply doesn't "consume" a banner since the banner
      // is purely visual chrome.
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role !== "user") continue;
        const laterReason = parseReason(messages[j].content || "");
        if (laterReason === reason) {
          hidden.add(messages[i].id);
          break;
        }
      }
    }
    return hidden;
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= PIN_THRESHOLD_PX) {
      pinnedRef.current = true;
      smoothScrollingRef.current = false;
      setShowJumpToBottom(false);
    } else if (!smoothScrollingRef.current) {
      pinnedRef.current = false;
      setShowJumpToBottom(true);
    }
  };

  // Wheel-up unpins immediately — before any scroll event lands — so a
  // streaming auto-follow can't yank the view back down mid-gesture.
  const handleWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.deltaY < 0 && el.scrollHeight - el.clientHeight > PIN_THRESHOLD_PX) {
      pinnedRef.current = false;
      smoothScrollingRef.current = false;
      setShowJumpToBottom(true);
    }
  };

  const jumpToBottom = useCallback(() => {
    pinnedRef.current = true;
    smoothScrollingRef.current = true;
    setShowJumpToBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Follow the conversation tail — but only while pinned. Instant rather
  // than smooth: the resulting scroll event lands inside the bottom band,
  // so it can never be mistaken for a user scroll-away.
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMessages.length, viewStreaming, viewActivity, permSize]);

  // Switching views shows a different conversation in the same scroller:
  // start it at its tail rather than at whatever offset the previous one had.
  useEffect(() => {
    pinnedRef.current = true;
    smoothScrollingRef.current = false;
    setShowJumpToBottom(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [viewingAgentId]);

  // `Esc` leaves one level: a nested agent falls back to its spawner, a
  // top-level agent to the root conversation.
  //
  // The listener has to be global (the chat panel is not focused most of the
  // time) but `Escape` is the most contested key in the app: the lightbox, the
  // settings sheet, the project dialog, the content-set and editor pickers and
  // two mode viewers all close on it, and none of them calls
  // `preventDefault`. So the agent view only claims the key when nothing else
  // can plausibly own it: no overlay is mounted, the keystroke is not being
  // typed into a field, and it was aimed either at the chat subtree or at
  // `<body>` (nothing focused at all).
  useEffect(() => {
    if (viewingAgentId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as (Node & { tagName?: string; isContentEditable?: boolean }) | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      // Any open modal / lightbox owns Escape — it is closing itself with it.
      if (document.querySelector('[role="dialog"]')) return;
      const root = rootRef.current;
      const inChat = !!root && !!target && root.contains(target);
      if (!inChat && target !== document.body) return;
      const state = useStore.getState();
      const current = state.viewingAgentId;
      if (current === null) return;
      state.setViewingAgent(state.subagents.get(current)?.parent_id ?? null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewingAgentId]);

  // The composer signals its own sends so the view returns to the tail
  // even when the user had scrolled up.
  useEffect(() => {
    window.addEventListener("pneuma:chat-jump-bottom", jumpToBottom);
    return () => window.removeEventListener("pneuma:chat-jump-bottom", jumpToBottom);
  }, [jumpToBottom]);

  return (
    // The grid backdrop lives on the whole panel rather than on the scroller,
    // so the header row below sits on the same continuous grid.
    <div ref={rootRef} className="flex flex-col h-full relative bg-grid-pattern">
      {/* One compact header block, outside the scroller: the view switcher and
          the status pill share its first line, the ancestry breadcrumb its
          second. Out of the scroller because a sticky bar inside it sat *on
          top of* the conversation — messages passed underneath the chips and
          an expanded status pill overlapped them. */}
      {showHeaderRow ? (
        <div className="shrink-0 px-4 pt-4 pb-1 space-y-1">
          {/* Wrapping row: in a narrow panel (a 380px floating surface, or an
              expanded pill next to a six-agent team) the pill drops to its own
              line instead of squeezing the chips into a one-per-row column. */}
          <div className="flex flex-wrap items-start gap-2">
            {showStrip && <SubagentStrip />}
            <div className="ml-auto shrink-0">
              {!replayMode && <AgentStatusBar inRow />}
            </div>
          </div>
          {viewingAgentId !== null && <AgentViewHeader agentId={viewingAgentId} />}
        </div>
      ) : (
        /* Agent status bar (floating pill) — hide in replay mode */
        !replayMode && <AgentStatusBar />
      )}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        className={`flex-1 overflow-y-auto p-4 ${showHeaderRow ? "pt-2" : "pt-16"} space-y-4 pb-36`}
      >
        {emptyNote && (
          <div className="text-cc-muted text-sm text-center mt-8">{emptyNote}</div>
        )}
        {visibleMessages.map((msg, i) => {
          if (hiddenMessageIds.has(msg.id)) return null;
          const precedingOrphans = orphans.beforeMessageId.get(msg.id);
          return (
            <React.Fragment key={msg.id}>
              {precedingOrphans?.map((orphanId) => (
                <SubagentCard key={orphanId} id={orphanId} />
              ))}
              {msg.cronTriggered && (i === 0 || !visibleMessages[i - 1].cronTriggered || visibleMessages[i - 1].content?.trim()) && (
                <CronTriggerBubble prompt={msg.cronTriggered} />
              )}
              <MessageBubble message={msg} globalToolUseById={globalToolUseById} subagentIds={subagentIds} />
            </React.Fragment>
          );
        })}
        {orphans.trailing.map((orphanId) => (
          <SubagentCard key={orphanId} id={orphanId} />
        ))}
        {viewStreaming ? (
          <StreamingText text={viewStreaming} />
        ) : viewActivity ? (
          <ActivityIndicator activity={viewActivity} />
        ) : null}
        <div ref={bottomRef} className="h-4" />
      </div>
      {showJumpToBottom && (
        <button
          onClick={jumpToBottom}
          title={t("jump_to_bottom")}
          aria-label={t("jump_to_bottom")}
          className={`absolute ${replayMode ? "bottom-8" : "bottom-36"} left-1/2 -translate-x-1/2 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-cc-surface/80 backdrop-blur-md border border-cc-border/60 text-cc-muted hover:text-cc-fg hover:bg-cc-surface shadow-[0_4px_16px_rgba(0,0,0,0.4)] transition-colors cursor-pointer animate-[fadeSlideIn_0.15s_ease-out]`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path d="M8 3.5v9M4.5 9l3.5 3.5L11.5 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {!replayMode && (
        <div className="absolute bottom-4 left-4 right-4 z-10 space-y-2">
          {/* Permission banners stay visible in both views — a subagent's
              request still blocks the whole session. */}
          <PermissionBanner />
          {/* Hidden rather than unmounted in an agent view: there is no
              user→subagent channel to offer, but a half-typed message to the
              root agent (and its attachments) must survive a peek into an
              agent's conversation. `display:none` also takes it out of the
              tab order, so it cannot be reached while it is not offered. */}
          <div className={viewingAgentId === null ? undefined : "hidden"}>
            <ChatInput />
          </div>
          {viewingAgentId !== null && <AgentViewFooter agentId={viewingAgentId} />}
        </div>
      )}
    </div>
  );
}
