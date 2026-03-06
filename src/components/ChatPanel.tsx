import { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import MessageBubble from "./MessageBubble.js";
import StreamingText from "./StreamingText.js";
import ActivityIndicator from "./ActivityIndicator.js";
import PermissionBanner from "./PermissionBanner.js";
import ChatInput from "./ChatInput.js";

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

  return (
    <div className="flex items-center gap-1.5" title={text}>
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-cc-muted text-xs">{text}</span>
    </div>
  );
}

function SessionInfo() {
  const session = useStore((s) => s.session);
  if (!session) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-cc-muted">
      <span>{session.model || "no model"}</span>
      {session.total_cost_usd > 0 && (
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
  const permSize = useStore((s) => s.pendingPermissions.size);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming/activity updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming, activity, permSize]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Agent status bar (floating pill) */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-3 px-4 py-1.5 bg-cc-surface/60 backdrop-blur-md border border-white/5 rounded-full shadow-sm">
        <StatusDot />
        <SessionInfo />
      </div>
      <div className="flex-1 overflow-y-auto bg-grid-pattern p-4 pt-16 space-y-4 pb-36">
        {messages.length === 0 && !streaming && !activity && (
          <div className="text-cc-muted text-sm text-center mt-8">
            {cliConnected ? "Send a message to start editing" : "Connecting to Claude..."}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streaming ? <StreamingText /> : activity ? <ActivityIndicator /> : null}
        <div ref={bottomRef} className="h-4" />
      </div>
      <div className="absolute bottom-4 left-4 right-4 z-10 space-y-2">
        <PermissionBanner />
        <ChatInput />
      </div>
    </div>
  );
}
