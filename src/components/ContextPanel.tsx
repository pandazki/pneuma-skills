import { useState, useEffect } from "react";
import { useStore } from "../store.js";
import type { TaskItem } from "../store.js";

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

// ── Section: Session Stats ──────────────────────────────────────────────────

function SessionStatsSection() {
  const session = useStore((s) => s.session);
  if (!session) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Session</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <span className="text-neutral-500">Model</span>
        <span className="text-neutral-200 truncate">{session.model || "—"}</span>

        <span className="text-neutral-500">Version</span>
        <span className="text-neutral-200 truncate">{session.claude_code_version || "—"}</span>

        <span className="text-neutral-500">Working dir</span>
        <span className="text-neutral-200 truncate" title={session.cwd}>{session.cwd || "—"}</span>

        <span className="text-neutral-500">Cost</span>
        <span className="text-neutral-200">${session.total_cost_usd.toFixed(4)}</span>

        <span className="text-neutral-500">Turns</span>
        <span className="text-neutral-200">{session.num_turns}</span>

        <span className="text-neutral-500">Lines</span>
        <span className="text-neutral-200">
          <span className="text-green-400">+{session.total_lines_added}</span>
          {" / "}
          <span className="text-red-400">-{session.total_lines_removed}</span>
        </span>
      </div>
    </section>
  );
}

// ── Section: Tasks ──────────────────────────────────────────────────────────

function TaskStatusIcon({ status }: { status: TaskItem["status"] }) {
  switch (status) {
    case "completed":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-green-400 shrink-0">
          <path fillRule="evenodd" d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25z" clipRule="evenodd" />
        </svg>
      );
    case "in_progress":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="w-3.5 h-3.5 text-blue-400 shrink-0 animate-spin">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" strokeDasharray="28 10" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="w-3.5 h-3.5 text-neutral-500 shrink-0">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
        </svg>
      );
  }
}

function TasksSection() {
  const tasks = useStore((s) => s.tasks);
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Tasks</h3>
        {tasks.length > 0 && (
          <span className="text-[10px] text-neutral-500 bg-neutral-800 px-1.5 py-0.5 rounded-full">
            {completedCount}/{tasks.length}
          </span>
        )}
      </div>
      {tasks.length === 0 ? (
        <p className="text-xs text-neutral-600">No tasks yet</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-2 text-xs">
              <div className="mt-0.5">
                <TaskStatusIcon status={task.status} />
              </div>
              <div className="min-w-0 flex-1">
                <span
                  className={
                    task.status === "completed"
                      ? "text-neutral-500 line-through"
                      : "text-neutral-200"
                  }
                >
                  {task.status === "in_progress" && task.activeForm ? (
                    <span className="italic">{task.activeForm}</span>
                  ) : (
                    task.subject
                  )}
                </span>
                {task.blockedBy && task.blockedBy.length > 0 && task.status !== "completed" && (
                  <span className="ml-1.5 text-[10px] text-amber-500">blocked</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Section: MCP Servers ────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case "connected": return "bg-green-400";
    case "connecting": return "bg-amber-400";
    case "error":
    case "disconnected": return "bg-red-400";
    default: return "bg-neutral-500";
  }
}

function McpServersSection() {
  const servers = useStore((s) => s.session?.mcp_servers);
  if (!servers?.length) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">MCP Servers</h3>
      <ul className="space-y-1">
        {servers.map((srv) => (
          <li key={srv.name} className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(srv.status)}`} />
            <span className="text-neutral-200 truncate">{srv.name}</span>
            <span className="text-neutral-600 ml-auto shrink-0">{srv.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Section: Tools ──────────────────────────────────────────────────────────

function ToolsSection() {
  const tools = useStore((s) => s.session?.tools);
  const [expanded, setExpanded] = useState(false);

  if (!tools?.length) return null;

  const shown = expanded ? tools : tools.slice(0, 8);
  const hasMore = tools.length > 8;

  return (
    <section className="space-y-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs font-semibold text-neutral-400 uppercase tracking-wider hover:text-neutral-300 transition-colors"
      >
        <span>Tools ({tools.length})</span>
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>
      <ul className="space-y-0.5">
        {shown.map((tool) => (
          <li key={tool} className="text-xs text-neutral-400 truncate pl-1">
            {tool}
          </li>
        ))}
      </ul>
      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
        >
          +{tools.length - 8} more...
        </button>
      )}
    </section>
  );
}

// ── Section: Git Info ───────────────────────────────────────────────────────

function GitInfoSection() {
  const gitAvailable = useStore((s) => s.gitAvailable);
  const [gitInfo, setGitInfo] = useState<{ branch: string | null; ahead: number; behind: number } | null>(null);

  useEffect(() => {
    if (gitAvailable === false) return;
    fetch(`${getApiBase()}/api/git/info`)
      .then((r) => r.json())
      .then(setGitInfo)
      .catch(() => {});
  }, [gitAvailable]);

  if (!gitInfo?.branch) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Git</h3>
      <div className="flex items-center gap-2 text-xs">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-neutral-500 shrink-0">
          <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
        </svg>
        <span className="text-neutral-200 font-mono">{gitInfo.branch}</span>
        {(gitInfo.ahead > 0 || gitInfo.behind > 0) && (
          <span className="text-neutral-500">
            {gitInfo.ahead > 0 && <span className="text-green-400">{"\u2191"}{gitInfo.ahead}</span>}
            {gitInfo.ahead > 0 && gitInfo.behind > 0 && " "}
            {gitInfo.behind > 0 && <span className="text-red-400">{"\u2193"}{gitInfo.behind}</span>}
          </span>
        )}
      </div>
    </section>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export default function ContextPanel() {
  const session = useStore((s) => s.session);

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
        No active session
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-5">
      <SessionStatsSection />
      <div className="border-t border-neutral-800" />
      <TasksSection />
      <div className="border-t border-neutral-800" />
      <McpServersSection />
      <div className="border-t border-neutral-800" />
      <ToolsSection />
      <div className="border-t border-neutral-800" />
      <GitInfoSection />
    </div>
  );
}
