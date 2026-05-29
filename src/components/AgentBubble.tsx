import { useEffect } from "react";
import { useStore } from "../store.js";

/**
 * AgentBubble — the collapsed form of the Agent Surface. A small circular FAB
 * in the bottom-right that reflects agent status (idle / working / connection)
 * and a pending-permission badge. Clicking it expands the surface back to
 * whichever form it was last in (docked or floating). It auto-expands when the
 * agent needs a permission decision so the user is never blocked behind a
 * collapsed bubble.
 *
 * It only renders the button — the conversation lives in the shared ChatPanel,
 * mounted by the docked/floating forms.
 */
export default function AgentBubble() {
  const expandSurface = useStore((s) => s.expandSurface);
  const permSize = useStore((s) => s.pendingPermissions.size);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const cliConnected = useStore((s) => s.cliConnected);
  const connectionStatus = useStore((s) => s.connectionStatus);

  // Never let a permission prompt hide behind the bubble.
  useEffect(() => {
    if (permSize > 0) expandSurface();
  }, [permSize, expandSurface]);

  const isWorking = sessionStatus === "running" || sessionStatus === "compacting";
  const isConnected = connectionStatus === "connected" && cliConnected;

  return (
    <button
      onClick={expandSurface}
      className="agent-surface-bubble fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full
                 bg-cc-surface border-2 flex items-center justify-center
                 hover:shadow-[0_0_30px_rgba(249,115,22,0.3)]
                 transition-all duration-300 cursor-pointer group
                 animate-[fadeSlideIn_0.2s_ease-out]"
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
      {/* Breathing ring when the agent is working */}
      {isWorking && (
        <div className="absolute inset-0 rounded-full border-2 border-amber-400/50 animate-ping" />
      )}

      {/* Chat glyph */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`w-6 h-6 transition-colors ${
          isConnected ? "text-cc-primary group-hover:text-cc-primary-hover" : "text-cc-muted"
        }`}
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>

      {/* Pending-permission badge */}
      {permSize > 0 && (
        <div
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500
                     text-[10px] font-bold text-black flex items-center justify-center animate-pulse"
        >
          {permSize}
        </div>
      )}
    </button>
  );
}
