import { useStore } from "../store.js";

export default function StatusBar() {
  const session = useStore((s) => s.session);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const cliConnected = useStore((s) => s.cliConnected);
  const sessionStatus = useStore((s) => s.sessionStatus);

  const statusColor =
    connectionStatus === "connected" && cliConnected
      ? sessionStatus === "running"
        ? "bg-amber-400"
        : "bg-green-400"
      : "bg-red-400";

  const statusText =
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
    <div className="flex items-center gap-3 px-4 py-2 bg-neutral-900 border-b border-neutral-800 text-sm">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-neutral-400">{statusText}</span>
      </div>
      {session && (
        <>
          <span className="text-neutral-600">|</span>
          <span className="text-neutral-500">{session.model || "no model"}</span>
          {session.total_cost_usd > 0 && (
            <>
              <span className="text-neutral-600">|</span>
              <span className="text-neutral-500">${session.total_cost_usd.toFixed(4)}</span>
            </>
          )}
          {session.context_used_percent > 0 && (
            <>
              <span className="text-neutral-600">|</span>
              <span className="text-neutral-500">ctx {session.context_used_percent}%</span>
            </>
          )}
        </>
      )}
      <div className="ml-auto text-neutral-600 text-xs">Pneuma Doc Mode</div>
    </div>
  );
}
