import { useStore } from "../store.js";

type Tab = "chat" | "editor" | "diff" | "terminal" | "processes" | "context";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "editor", label: "Editor" },
  { id: "diff", label: "Diffs" },
  { id: "terminal", label: "Terminal" },
  { id: "processes", label: "Processes" },
  { id: "context", label: "Context" },
];

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
          <span className="text-cc-border">·</span>
          <span>${session.total_cost_usd.toFixed(4)}</span>
        </>
      )}
      {session.context_used_percent > 0 && (
        <>
          <span className="text-cc-border">·</span>
          <span>ctx {session.context_used_percent}%</span>
        </>
      )}
    </div>
  );
}

export default function TopBar() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const gitAvailable = useStore((s) => s.gitAvailable);
  const modeDisplayName = useStore((s) => s.modeDisplayName);

  return (
    <div className="flex items-center h-10 px-3 bg-cc-surface border-b border-cc-border text-sm select-none">
      {/* Left: status */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <StatusDot />
        <SessionInfo />
      </div>

      {/* Center: tabs */}
      <div className="flex items-center gap-0.5 mx-auto bg-cc-bg/50 rounded-md p-0.5">
        {TABS.map((tab) => {
          const disabled = tab.id === "diff" && gitAvailable === false;
          return (
            <button
              key={tab.id}
              onClick={() => !disabled && setActiveTab(tab.id)}
              title={disabled ? "Diffs require a git repository. Run `git init` in the workspace." : undefined}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                disabled
                  ? "text-cc-muted/30 cursor-not-allowed"
                  : activeTab === tab.id
                    ? "bg-cc-primary-muted text-cc-fg"
                    : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Right: mode label */}
      <div className="text-cc-primary/60 text-xs shrink-0">{modeDisplayName ? `Pneuma ${modeDisplayName}` : ""}</div>
    </div>
  );
}
