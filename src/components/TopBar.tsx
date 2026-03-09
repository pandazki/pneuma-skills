import { useCallback } from "react";
import { useStore } from "../store.js";
import ContentSetSelector from "./ContentSetSelector.js";

type Tab = "chat" | "editor" | "diff" | "terminal" | "processes" | "context" | "schedules";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "editor", label: "Editor" },
  { id: "diff", label: "Diffs" },
  { id: "terminal", label: "Terminal" },
  { id: "processes", label: "Processes" },
  { id: "context", label: "Context" },
  { id: "schedules", label: "Schedules" },
];

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
  const cronJobCount = useStore((s) => s.cronJobs.length);
  const contentSets = useStore((s) => s.contentSets);
  const activeContentSet = useStore((s) => s.activeContentSet);
  const contentSetUnread = useStore((s) => s.contentSetUnread);
  const workspaceItems = useStore((s) => s.workspaceItems);
  const activeFile = useStore((s) => s.activeFile);
  const topBarNav = useStore((s) => s.modeViewer?.workspace?.topBarNavigation);
  const createEmpty = useStore((s) => s.modeViewer?.workspace?.createEmpty);

  const showItemSelector = topBarNav && contentSets.length <= 1 && workspaceItems.length > 1;

  const handleCreateEmpty = useCallback(async () => {
    if (!createEmpty) return;
    const store = useStore.getState();
    const rawFiles = store.files;
    const hasContentSets = store.contentSets.length >= 1;

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
    <div className="flex items-center px-4 pt-4 pb-2 bg-transparent text-sm select-none z-20 relative">
      {/* Left: logo + selectors */}
      <div className="flex items-center gap-3 bg-cc-surface/50 border border-white/5 backdrop-blur-md px-4 py-1.5 rounded-full shadow-sm min-w-0 shrink-0">
        <span className="text-cc-primary font-bold text-sm tracking-tight">Pneuma</span>
        {contentSets.length > 1 && (
          <ContentSetSelector
            items={contentSets.map((cs) => ({ id: cs.prefix, label: cs.label }))}
            activeId={activeContentSet}
            onSelect={(id) => useStore.getState().setActiveContentSet(id)}
            unread={contentSetUnread}
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
      </div>

      {/* Center: tabs */}
      <div className="flex items-center gap-1 mx-auto bg-cc-bg/80 border border-cc-border/50 rounded-full p-1 shadow-inner">
        {TABS.map((tab) => {
          const disabled = tab.id === "diff" && gitAvailable === false;
          const badge = tab.id === "schedules" && cronJobCount > 0 ? cronJobCount : 0;
          return (
            <button
              key={tab.id}
              onClick={() => !disabled && setActiveTab(tab.id)}
              title={disabled ? "Diffs require a git repository. Run `git init` in the workspace." : undefined}
              className={`relative px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${disabled
                ? "text-cc-muted/30 cursor-not-allowed"
                : activeTab === tab.id
                  ? "bg-cc-primary text-cc-bg shadow-[0_0_12px_rgba(249,115,22,0.4)]"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
                }`}
            >
              {tab.label}
              {badge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-cc-primary text-cc-bg text-[10px] font-bold leading-none">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Right: spacer for balance */}
      <div className="shrink-0" />
    </div>
  );
}
