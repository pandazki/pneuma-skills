import { useCallback } from "react";
import { useStore } from "../store.js";
import ContentSetSelector from "./ContentSetSelector.js";

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

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

export default function TopBar() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const gitAvailable = useStore((s) => s.gitAvailable);
  const modeDisplayName = useStore((s) => s.modeDisplayName);
  const contentSets = useStore((s) => s.contentSets);
  const activeContentSet = useStore((s) => s.activeContentSet);
  const workspaceItems = useStore((s) => s.workspaceItems);
  const activeFile = useStore((s) => s.activeFile);
  const topBarNav = useStore((s) => s.modeViewer?.workspace?.topBarNavigation);
  const createEmpty = useStore((s) => s.modeViewer?.workspace?.createEmpty);

  const showItemSelector = topBarNav && contentSets.length <= 1 && workspaceItems.length > 1;

  const handleCreateEmpty = useCallback(async () => {
    if (!createEmpty) return;
    const store = useStore.getState();
    const rawFiles = store.files;
    const hasContentSets = store.contentSets.length > 1;

    // When mode has content sets, createEmpty creates a new content set (pass all raw files).
    // Otherwise, it creates an item within the current workspace.
    const prefix = hasContentSets ? null : store.activeContentSet;
    const files = prefix
      ? rawFiles.filter((f) => f.path.startsWith(prefix + "/")).map((f) => ({ path: f.path.slice(prefix.length + 1), content: f.content }))
      : rawFiles.map((f) => ({ path: f.path, content: f.content }));
    const result = createEmpty(files);
    if (!result || result.length === 0) return;

    // Re-add content set prefix for non-content-set modes
    const diskFiles = prefix
      ? result.map((f) => ({ path: `${prefix}/${f.path}`, content: f.content }))
      : result;
    try {
      const res = await fetch(`${getApiBase()}/api/workspace/scaffold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: [], files: diskFiles }),
      });
      const data = await res.json();
      if (data.success) {
        setTimeout(() => {
          if (hasContentSets) {
            // Auto-select the new content set by extracting prefix from result paths
            const firstPath = result[0].path;
            const slashIdx = firstPath.indexOf("/");
            if (slashIdx > 0) {
              store.setActiveContentSet(firstPath.slice(0, slashIdx));
            }
          } else {
            store.setActiveFile(result[0].path);
          }
        }, 300);
      }
    } catch {
      // Network error — ignore, file watcher will catch up
    }
  }, [createEmpty]);

  return (
    <div className="flex items-center h-10 px-3 bg-cc-surface border-b border-cc-border text-sm select-none">
      {/* Left: status + selectors */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <StatusDot />
        {contentSets.length > 1 && (
          <ContentSetSelector
            items={contentSets.map((cs) => ({ id: cs.prefix, label: cs.label }))}
            activeId={activeContentSet}
            onSelect={(id) => useStore.getState().setActiveContentSet(id)}
          />
        )}
        {showItemSelector && (
          <ContentSetSelector
            items={workspaceItems.map((wi) => ({ id: wi.path, label: wi.label }))}
            activeId={activeFile}
            onSelect={(id) => useStore.getState().setActiveFile(id)}
            icon="file"
          />
        )}
        {createEmpty && (
          <button
            onClick={handleCreateEmpty}
            title="New empty content"
            className="flex items-center justify-center w-5 h-5 rounded text-cc-muted
              hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        )}
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
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-cc-primary/60 text-xs">{modeDisplayName ? `Pneuma ${modeDisplayName}` : ""}</div>
      </div>
    </div>
  );
}
