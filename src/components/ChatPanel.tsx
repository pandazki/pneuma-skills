import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store.js";
import { forceReconnect } from "../ws.js";
import MessageBubble from "./MessageBubble.js";
import StreamingText from "./StreamingText.js";
import ActivityIndicator from "./ActivityIndicator.js";
import PermissionBanner from "./PermissionBanner.js";
import ChatInput from "./ChatInput.js";
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

/**
 * Floating status pill. Collapsed by default to just the status dot +
 * state label (the only thing most glances need); clicking expands it to
 * also show model / cost / context, and clicking again collapses. The
 * preference is remembered in localStorage. The inner reconnect button
 * stops propagation so it doesn't toggle the pill.
 */
function AgentStatusBar() {
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
      className="absolute top-4 right-4 z-10 flex items-center gap-3 px-4 py-1.5 bg-cc-surface/60 backdrop-blur-md border border-white/5 rounded-full shadow-sm cursor-pointer select-none hover:bg-cc-surface/80 transition-colors"
    >
      <StatusDot />
      {expanded && <SessionInfo />}
    </div>
  );
}

export default function ChatPanel() {
  const { t } = useTranslation("chat-panel");
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => s.streaming);
  const activity = useStore((s) => s.activity);
  const cliConnected = useStore((s) => s.cliConnected);
  const replayMode = useStore((s) => s.replayMode);
  const permSize = useStore((s) => s.pendingPermissions.size);
  const bottomRef = useRef<HTMLDivElement>(null);
  const globalToolUseById = useMemo(() => buildGlobalToolUseMap(messages), [messages]);

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

  // Auto-scroll to bottom when new messages arrive or streaming/activity updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming, activity, permSize]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Agent status bar (floating pill) — hide in replay mode */}
      {!replayMode && <AgentStatusBar />}
      <div className="flex-1 overflow-y-auto bg-grid-pattern p-4 pt-16 space-y-4 pb-36">
        {messages.length === 0 && !streaming && !activity && !replayMode && (
          <div className="text-cc-muted text-sm text-center mt-8">
            {cliConnected ? t("empty_send_message") : t("empty_connecting")}
          </div>
        )}
        {messages.map((msg, i) => {
          if (hiddenMessageIds.has(msg.id)) return null;
          return (
            <React.Fragment key={msg.id}>
              {msg.cronTriggered && (i === 0 || !messages[i - 1].cronTriggered || messages[i - 1].content?.trim()) && (
                <CronTriggerBubble prompt={msg.cronTriggered} />
              )}
              <MessageBubble message={msg} globalToolUseById={globalToolUseById} />
            </React.Fragment>
          );
        })}
        {streaming ? <StreamingText /> : activity ? <ActivityIndicator /> : null}
        <div ref={bottomRef} className="h-4" />
      </div>
      {!replayMode && (
        <div className="absolute bottom-4 left-4 right-4 z-10 space-y-2">
          <PermissionBanner />
          <ChatInput />
        </div>
      )}
    </div>
  );
}
