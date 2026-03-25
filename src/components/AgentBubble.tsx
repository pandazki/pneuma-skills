import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store.js";
import ChatPanel from "./ChatPanel.js";

/**
 * AgentBubble — Floating agent interface for "app" layout.
 *
 * Collapsed: small circle button (bottom-right) showing agent status.
 * Expanded: glassmorphism panel embedding full ChatPanel.
 * Auto-expands when permissions are pending.
 */
export default function AgentBubble() {
  const [isExpanded, setIsExpanded] = useState(false);
  const permSize = useStore((s) => s.pendingPermissions.size);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const cliConnected = useStore((s) => s.cliConnected);
  const connectionStatus = useStore((s) => s.connectionStatus);

  // Auto-expand when agent needs permission
  useEffect(() => {
    if (permSize > 0) setIsExpanded(true);
  }, [permSize]);

  const close = useCallback(() => setIsExpanded(false), []);
  const open = useCallback(() => setIsExpanded(true), []);

  const isWorking =
    sessionStatus === "running" || sessionStatus === "compacting";
  const isConnected = connectionStatus === "connected" && cliConnected;

  // ── Expanded: floating chat panel ──────────────────────────────────────

  if (isExpanded) {
    return (
      <div
        className="fixed bottom-6 right-6 w-[420px] h-[620px] z-50
                    border border-cc-primary/20 rounded-2xl overflow-hidden
                    shadow-[0_0_40px_rgba(249,115,22,0.15)] ring-1 ring-white/5
                    before:absolute before:inset-0 before:bg-cc-surface/80 before:backdrop-blur-2xl before:-z-10
                    animate-[fadeSlideIn_0.2s_ease-out] flex flex-col"
      >
        {/* Header bar */}
        <div className="relative z-10 flex items-center justify-between px-4 py-2.5 border-b border-cc-border/40">
          <div className="flex items-center gap-2">
            <StatusDot isConnected={isConnected} isWorking={isWorking} />
            <span className="text-xs text-cc-muted font-body">
              {!isConnected
                ? "Disconnected"
                : isWorking
                  ? "Working…"
                  : "Ready"}
            </span>
          </div>
          <button
            onClick={close}
            title="Close chat"
            className="w-6 h-6 rounded-full bg-cc-surface/60 border border-white/10
                       flex items-center justify-center text-cc-muted
                       hover:text-cc-fg hover:border-cc-primary/30 transition-all text-xs"
          >
            ✕
          </button>
        </div>

        {/* Chat panel fills remaining space */}
        <div className="relative z-10 flex-1 min-h-0">
          <ChatPanel />
        </div>
      </div>
    );
  }

  // ── Collapsed: floating circle button ──────────────────────────────────

  return (
    <button
      onClick={open}
      title="Open agent chat"
      className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full
                 bg-cc-surface border-2
                 flex items-center justify-center
                 hover:shadow-[0_0_30px_rgba(249,115,22,0.3)]
                 transition-all duration-300 cursor-pointer group"
      style={{
        borderColor: isWorking
          ? "rgba(251,191,36,0.5)"
          : isConnected
            ? "rgba(249,115,22,0.4)"
            : "rgba(161,161,170,0.3)",
        boxShadow: isWorking
          ? "0 0 24px rgba(251,191,36,0.25)"
          : "0 0 20px rgba(249,115,22,0.15)",
      }}
    >
      {/* Breathing ring when working */}
      {isWorking && (
        <div className="absolute inset-0 rounded-full border-2 border-amber-400/50 animate-ping" />
      )}

      {/* Chat icon */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`w-6 h-6 transition-colors ${
          isConnected
            ? "text-cc-primary group-hover:text-cc-primary-hover"
            : "text-cc-muted"
        }`}
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>

      {/* Permission badge */}
      {permSize > 0 && (
        <div
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500
                      text-[10px] font-bold text-black flex items-center justify-center
                      animate-pulse"
        >
          {permSize}
        </div>
      )}
    </button>
  );
}

// ── StatusDot ────────────────────────────────────────────────────────────

function StatusDot({
  isConnected,
  isWorking,
}: {
  isConnected: boolean;
  isWorking: boolean;
}) {
  const color = !isConnected
    ? "bg-red-500/80"
    : isWorking
      ? "bg-amber-400"
      : "bg-emerald-400";

  return (
    <span className="relative flex h-2.5 w-2.5">
      {isWorking && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}
