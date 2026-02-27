import { useState, useEffect } from "react";
import { useStore } from "../store.js";

export interface ProcessItem {
  taskId: string;
  toolUseId: string;
  command: string;
  description: string;
  outputFile: string;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt: number;
  completedAt?: number;
  summary?: string;
}

interface SystemProcess {
  pid: number;
  command: string;
  fullCommand: string;
  ports: number[];
  cwd?: string;
  startedAt?: number;
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function ProcessRow({ proc, onKill }: { proc: ProcessItem; onKill: () => void }) {
  const [elapsed, setElapsed] = useState(Date.now() - proc.startedAt);

  useEffect(() => {
    if (proc.status !== "running") return;
    const timer = setInterval(() => setElapsed(Date.now() - proc.startedAt), 1000);
    return () => clearInterval(timer);
  }, [proc.status, proc.startedAt]);

  const statusColors: Record<string, string> = {
    running: "text-amber-400",
    completed: "text-green-400",
    failed: "text-red-400",
    stopped: "text-neutral-500",
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-800/30 text-xs">
      <span className={`w-2 h-2 rounded-full shrink-0 ${
        proc.status === "running" ? "bg-amber-400 animate-pulse" :
        proc.status === "completed" ? "bg-green-400" :
        proc.status === "failed" ? "bg-red-400" : "bg-neutral-600"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="text-neutral-200 truncate">{proc.description || proc.command}</div>
        <div className="text-neutral-500 truncate font-mono">{proc.command}</div>
      </div>
      <span className={`shrink-0 ${statusColors[proc.status] || "text-neutral-500"}`}>
        {proc.status === "running" ? formatDuration(elapsed) : proc.status}
      </span>
      {proc.status === "running" && (
        <button onClick={onKill} className="shrink-0 text-red-400 hover:text-red-300 px-1">
          Kill
        </button>
      )}
    </div>
  );
}

function SystemProcessRow({ proc, onKill }: { proc: SystemProcess; onKill: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-800/30 text-xs">
      <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-neutral-200 truncate">{proc.command}</div>
        <div className="text-neutral-500 truncate font-mono">{proc.fullCommand}</div>
        {proc.cwd && <div className="text-neutral-600 truncate">{proc.cwd}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {proc.ports.map((p) => (
          <a
            key={p}
            href={`http://localhost:${p}`}
            target="_blank"
            rel="noopener"
            className="text-blue-400 hover:text-blue-300"
          >
            :{p}
          </a>
        ))}
        <span className="text-neutral-600">PID {proc.pid}</span>
        <button onClick={onKill} className="text-red-400 hover:text-red-300 px-1">
          Kill
        </button>
      </div>
    </div>
  );
}

export default function ProcessPanel() {
  const processes = useStore((s) => s.sessionProcesses);
  const [systemProcs, setSystemProcs] = useState<SystemProcess[]>([]);
  const [scanning, setScanning] = useState(false);

  const base = getApiBase();

  const scanSystemProcesses = () => {
    setScanning(true);
    fetch(`${base}/api/processes/system`)
      .then((r) => r.json())
      .then((d) => setSystemProcs(d.processes || []))
      .catch(() => {})
      .finally(() => setScanning(false));
  };

  // Poll system processes every 15s
  useEffect(() => {
    scanSystemProcesses();
    const timer = setInterval(scanSystemProcesses, 15_000);
    return () => clearInterval(timer);
  }, []);

  const killProcess = (taskId: string) => {
    fetch(`${base}/api/processes/${encodeURIComponent(taskId)}/kill`, { method: "POST" }).catch(() => {});
    // Optimistic update after 3s if no WS notification
    setTimeout(() => {
      const store = useStore.getState();
      store.updateProcess(taskId, { status: "stopped", completedAt: Date.now() });
    }, 3000);
  };

  const killSystemProcess = (pid: number) => {
    fetch(`${base}/api/processes/system/${pid}/kill`, { method: "POST" }).catch(() => {});
    setTimeout(() => setSystemProcs((prev) => prev.filter((p) => p.pid !== pid)), 1000);
  };

  const running = processes.filter((p) => p.status === "running");
  const completed = processes.filter((p) => p.status !== "running");

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Background Jobs (Bash with run_in_background) — only shown when non-empty */}
      {processes.length > 0 && (
        <div className="border-b border-neutral-800">
          <div className="px-3 py-2 text-xs font-medium text-neutral-400">
            Background Jobs ({processes.length})
          </div>
          {running.map((p) => (
            <ProcessRow key={p.taskId} proc={p} onKill={() => killProcess(p.taskId)} />
          ))}
          {completed.map((p) => (
            <ProcessRow key={p.taskId} proc={p} onKill={() => {}} />
          ))}
        </div>
      )}

      {/* Dev Servers */}
      <div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-medium text-neutral-400">
            Dev Servers ({systemProcs.length})
          </span>
          <button
            onClick={scanSystemProcesses}
            disabled={scanning}
            className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200"
          >
            {scanning ? "Scanning..." : "Scan"}
          </button>
        </div>
        {systemProcs.length === 0 ? (
          <div className="px-3 py-6 text-center text-neutral-600 text-xs">
            {scanning ? "Scanning for dev servers..." : "No dev servers found"}
          </div>
        ) : (
          systemProcs.map((p) => (
            <SystemProcessRow key={p.pid} proc={p} onKill={() => killSystemProcess(p.pid)} />
          ))
        )}
      </div>
    </div>
  );
}
