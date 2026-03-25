import React, { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import { forceReconnect } from "../ws.js";
import MessageBubble from "./MessageBubble.js";
import StreamingText from "./StreamingText.js";
import ActivityIndicator from "./ActivityIndicator.js";
import PermissionBanner from "./PermissionBanner.js";
import ChatInput from "./ChatInput.js";

function CronTriggerBubble({ prompt }: { prompt: string }) {
  return (
    <div className="flex justify-end animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="max-w-[85%] rounded-[20px] rounded-br-[6px] bg-amber-400/5 border border-amber-400/20 overflow-hidden shadow-sm">
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 text-amber-400/70 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span className="text-[10px] font-medium text-amber-400/70 tracking-wide uppercase">
            Scheduled Task
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
      ? "Disconnected"
      : !cliConnected
        ? "CLI Disconnected"
        : sessionStatus === "running"
          ? "Running"
          : sessionStatus === "compacting"
            ? "Compacting"
            : "Idle";

  const isDisconnected = connectionStatus !== "connected" || !cliConnected;

  return (
    <div className="flex items-center gap-1.5" title={text}>
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-cc-muted text-xs">{text}</span>
      {isDisconnected && (
        <button
          onClick={forceReconnect}
          className="text-cc-muted hover:text-cc-primary text-xs transition-colors cursor-pointer"
          title="Reconnect"
        >
          ↻
        </button>
      )}
    </div>
  );
}

function SessionInfo() {
  const session = useStore((s) => s.session);
  if (!session) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-cc-muted">
      <span>{session.model || "no model"}</span>
      {session.backend_type !== "codex" && session.total_cost_usd > 0 && (
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

export default function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => s.streaming);
  const activity = useStore((s) => s.activity);
  const cliConnected = useStore((s) => s.cliConnected);
  const replayMode = useStore((s) => s.replayMode);
  const focusMode = useStore((s) => s.focusMode);
  const permSize = useStore((s) => s.pendingPermissions.size);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming/activity updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming, activity, permSize]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Agent status bar (floating pill) — hide in replay and focus modes */}
      {!replayMode && !focusMode && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-3 px-4 py-1.5 bg-cc-surface/60 backdrop-blur-md border border-white/5 rounded-full shadow-sm">
          <StatusDot />
          <SessionInfo />
        </div>
      )}
      <div className={`flex-1 overflow-y-auto bg-grid-pattern p-4 space-y-4 pb-36 ${focusMode ? "pt-4" : "pt-16"}`}>
        {messages.length === 0 && !streaming && !activity && !replayMode && (
          <div className="text-cc-muted text-sm text-center mt-8">
            {cliConnected ? "Send a message to start editing" : "Connecting to Claude..."}
          </div>
        )}
        {messages.map((msg, i) => (
          <React.Fragment key={msg.id}>
            {msg.cronTriggered && (i === 0 || !messages[i - 1].cronTriggered || messages[i - 1].content?.trim()) && (
              <CronTriggerBubble prompt={msg.cronTriggered} />
            )}
            <MessageBubble message={msg} />
          </React.Fragment>
        ))}
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
