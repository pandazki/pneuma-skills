import { useStore } from "../store.js";

type Tab = "chat" | "editor" | "diff" | "terminal" | "processes";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "editor", label: "Editor" },
  { id: "diff", label: "Diffs" },
  { id: "terminal", label: "Terminal" },
  { id: "processes", label: "Processes" },
];

function StatusDot() {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const cliConnected = useStore((s) => s.cliConnected);
  const sessionStatus = useStore((s) => s.sessionStatus);

  const color =
    connectionStatus === "connected" && cliConnected
      ? sessionStatus === "running"
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
      <span className="text-neutral-500 text-xs">{text}</span>
    </div>
  );
}

function SessionInfo() {
  const session = useStore((s) => s.session);
  if (!session) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span>{session.model || "no model"}</span>
      {session.total_cost_usd > 0 && (
        <>
          <span className="text-neutral-700">·</span>
          <span>${session.total_cost_usd.toFixed(4)}</span>
        </>
      )}
      {session.context_used_percent > 0 && (
        <>
          <span className="text-neutral-700">·</span>
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

  return (
    <div className="flex items-center h-10 px-3 bg-neutral-900 border-b border-neutral-800 text-sm select-none">
      {/* Left: status */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <StatusDot />
        <SessionInfo />
      </div>

      {/* Center: tabs */}
      <div className="flex items-center gap-0.5 mx-auto bg-neutral-800/50 rounded-md p-0.5">
        {TABS.map((tab) => {
          const disabled = tab.id === "diff" && gitAvailable === false;
          return (
            <button
              key={tab.id}
              onClick={() => !disabled && setActiveTab(tab.id)}
              title={disabled ? "Diffs require a git repository. Run `git init` in the workspace." : undefined}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                disabled
                  ? "text-neutral-700 cursor-not-allowed"
                  : activeTab === tab.id
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Right: mode label */}
      <div className="text-neutral-600 text-xs shrink-0">Pneuma Doc</div>
    </div>
  );
}
