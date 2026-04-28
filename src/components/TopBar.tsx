import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";
import ContentSetSelector from "./ContentSetSelector.js";
import ModeLabel from "./ModeLabel.js";

const AppSettings = lazy(() => import("./AppSettings.js"));
const ProjectChip = lazy(() => import("./ProjectChip.js"));

const desktop = (window as any).pneumaDesktop as {
  setEditing?: (editing: boolean, opts?: { width?: number; height?: number; resizable?: boolean }) => Promise<void>;
} | undefined;

function EditingToggle() {
  const editingSupported = useStore((s) => s.editingSupported);
  const editing = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const [switching, setSwitching] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (!editingSupported) return null;

  const switchTo = async (newEditing: boolean) => {
    setSwitching(true);
    try {
      const res = await fetch(`${getApiBase()}/api/session/editing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editing: newEditing }),
      });
      if (res.ok) {
        setEditing(newEditing);
        if (desktop?.setEditing) {
          if (newEditing) {
            desktop.setEditing(true);
          } else {
            const settings = await fetch(`${getApiBase()}/api/app-settings`).then((r) => r.json()).catch(() => ({}));
            const params = new URLSearchParams(location.search);
            desktop.setEditing(false, {
              width: settings.windowWidth || parseInt(params.get("w") || "", 10) || undefined,
              height: settings.windowHeight || parseInt(params.get("h") || "", 10) || undefined,
              resizable: settings.resizable ?? false,
            });
          }
        }
      }
    } catch { /* ignore */ }
    setSwitching(false);
  };

  return (
    <>
      <div className="relative flex items-center gap-1">
        {/* Settings gear */}
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="w-6 h-6 rounded-md flex items-center justify-center text-cc-muted/50 hover:text-cc-primary hover:bg-cc-primary/10 transition-colors cursor-pointer"
          title="App settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* View toggle */}
        <button
          onClick={() => switchTo(!editing)}
          disabled={switching}
          className="h-6 px-2.5 rounded-md flex items-center gap-1.5 text-xs font-medium text-cc-muted/60 hover:text-cc-primary hover:bg-cc-primary/10 transition-colors cursor-pointer disabled:opacity-50"
          title={editing ? "Switch to viewing" : "Switch to editing"}
        >
          {switching ? (
            <div className="w-3 h-3 border-[1.5px] border-cc-primary/30 border-t-cc-primary rounded-full animate-spin" />
          ) : editing ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          )}
          {editing ? "View" : "Edit"}
        </button>
        {showSettings && (
          <Suspense fallback={null}>
            <AppSettings onClose={() => setShowSettings(false)} />
          </Suspense>
        )}
      </div>
    </>
  );
}

function ShareDropdown() {
  const [open, setOpen] = useState(false);
  const [r2Status, setR2Status] = useState<{ configured: boolean; publicUrl: string | null } | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "sharing" | "done" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check R2 status when dropdown opens
  useEffect(() => {
    if (open && !r2Status) {
      fetch(`${getApiBase()}/api/r2/status`)
        .then((r) => r.json())
        .then(setR2Status)
        .catch(() => setR2Status({ configured: false, publicUrl: null }));
    }
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleShare = async (type: "result" | "process") => {
    setShareStatus("sharing");
    setShareError(null);
    try {
      const resp = await fetch(`${getApiBase()}/api/share/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Shared ${type}` }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setShareUrl(data.url);
      setShareStatus("done");
    } catch (err: any) {
      setShareError(err.message || "Share failed");
      setShareStatus("error");
    }
  };

  const handleExportLocal = async () => {
    setShareStatus("sharing");
    try {
      const resp = await fetch(`${getApiBase()}/api/history/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setShareUrl(data.outputPath);
      setShareStatus("done");
    } catch (err: any) {
      setShareError(err.message || "Export failed");
      setShareStatus("error");
    }
  };

  const copyUrl = () => {
    if (shareUrl) navigator.clipboard.writeText(shareUrl);
  };

  const reset = () => {
    setShareStatus("idle");
    setShareUrl(null);
    setShareError(null);
  };

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      <button
        onClick={() => { setOpen(!open); if (!open) reset(); }}
        title="Share"
        className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-primary hover:bg-cc-hover transition-colors cursor-pointer"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
          <circle cx="4" cy="8" r="2" />
          <circle cx="12" cy="4" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M6 7l4-2M6 9l4 2" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-cc-border bg-cc-surface shadow-xl z-[100] overflow-hidden">
          <div className="px-3 py-2 border-b border-cc-border">
            <div className="text-xs font-semibold text-cc-fg">Share</div>
          </div>

          {shareStatus === "idle" && (
            <div className="p-2 space-y-1">
              {r2Status?.configured ? (
                <>
                  <button
                    onClick={() => handleShare("result")}
                    className="w-full px-3 py-2.5 text-left rounded hover:bg-cc-hover transition-colors group"
                  >
                    <div className="text-xs font-medium text-cc-fg group-hover:text-cc-primary">Share Result</div>
                    <div className="text-[10px] text-cc-muted mt-0.5">Upload current files (no history)</div>
                  </button>
                  <button
                    onClick={() => handleShare("process")}
                    className="w-full px-3 py-2.5 text-left rounded hover:bg-cc-hover transition-colors group"
                  >
                    <div className="text-xs font-medium text-cc-fg group-hover:text-cc-primary">Share Process</div>
                    <div className="text-[10px] text-cc-muted mt-0.5">Upload with chat history & checkpoints</div>
                  </button>
                  <div className="border-t border-cc-border my-1" />
                  <button
                    onClick={handleExportLocal}
                    className="w-full px-3 py-2 text-left rounded hover:bg-cc-hover transition-colors"
                  >
                    <div className="text-xs text-cc-muted">Export to local file</div>
                  </button>
                </>
              ) : (
                <div className="px-3 py-3 space-y-2">
                  <div className="text-xs text-cc-muted">Cloud sharing requires R2 storage configuration.</div>
                  <div className="text-[10px] text-cc-muted/60">Configure R2 credentials in the Launcher settings to enable cloud sharing.</div>
                  <div className="border-t border-cc-border my-2" />
                  <button
                    onClick={handleExportLocal}
                    className="w-full px-3 py-2 text-left rounded hover:bg-cc-hover transition-colors"
                  >
                    <div className="text-xs text-cc-fg">Export to local file</div>
                    <div className="text-[10px] text-cc-muted mt-0.5">Save as .tar.gz without cloud upload</div>
                  </button>
                </div>
              )}
            </div>
          )}

          {shareStatus === "sharing" && (
            <div className="px-3 py-4 text-center">
              <div className="text-xs text-cc-muted animate-pulse">Sharing...</div>
            </div>
          )}

          {shareStatus === "done" && shareUrl && (
            <div className="p-3 space-y-2">
              <div className="text-xs text-cc-primary font-medium">Shared successfully!</div>
              <div className="flex items-center gap-1">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 text-[10px] bg-cc-bg border border-cc-border rounded px-2 py-1 text-cc-muted truncate"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={copyUrl}
                  className="px-2 py-1 text-[10px] rounded border border-cc-border hover:border-cc-primary hover:text-cc-primary text-cc-muted transition-colors"
                >
                  Copy
                </button>
              </div>
              <button onClick={reset} className="text-[10px] text-cc-muted/50 hover:text-cc-fg">
                Share again
              </button>
            </div>
          )}

          {shareStatus === "error" && (
            <div className="p-3 space-y-2">
              <div className="text-xs text-red-400">{shareError || "Share failed"}</div>
              <button onClick={reset} className="text-[10px] text-cc-muted/50 hover:text-cc-fg">
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

export default function TopBar() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const backendType = useStore((s) => s.session?.backend_type);
  const gitAvailable = useStore((s) => s.gitAvailable);
  const cronJobCount = useStore((s) => s.cronJobs.length);
  const contentSets = useStore((s) => s.contentSets);
  const activeContentSet = useStore((s) => s.activeContentSet);
  const contentSetUnread = useStore((s) => s.contentSetUnread);
  const workspaceItems = useStore((s) => s.workspaceItems);
  const activeFile = useStore((s) => s.activeFile);
  const modeViewer = useStore((s) => s.modeViewer);
  const projectContext = useStore((s) => s.projectContext);
  const topBarNav = modeViewer?.workspace?.topBarNavigation;
  const createEmpty = modeViewer?.workspace?.createEmpty;
  const replayMode = useStore((s) => s.replayMode);
  const replayMetadata = useStore((s) => s.replayMetadata);
  const scheduleAvailable = !backendType || backendType === "claude-code";
  const visibleTabs = scheduleAvailable ? TABS : TABS.filter((tab) => tab.id !== "schedules");
  // Empty-shell predicate. The chip strip on the left always renders; the
  // tabs row + share dropdown + editing toggle only matter once a mode
  // viewer has loaded. ProjectChip (Phase 2) lives in the strip and works
  // either way.
  const hasModeViewer = !!modeViewer;

  const showItemSelector = topBarNav && contentSets.length <= 1 && workspaceItems.length > 1;

  useEffect(() => {
    if (!scheduleAvailable && activeTab === "schedules") {
      setActiveTab("chat");
    }
  }, [activeTab, scheduleAvailable, setActiveTab]);

  // Auto-switch to Chat when entering replay mode
  useEffect(() => {
    if (replayMode && activeTab !== "chat") {
      setActiveTab("chat");
    }
  }, [replayMode, activeTab, setActiveTab]);

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
        <div className="flex items-center gap-1.5">
          <img src="/logo.png" alt="" className="w-5 h-5 rounded" />
          <span className="font-logo text-sm text-cc-fg tracking-tight">Pneuma</span>
        </div>
        {projectContext ? (
          <>
            <span className="w-px h-3 bg-cc-border/40" aria-hidden />
            <Suspense fallback={null}>
              <ProjectChip />
            </Suspense>
          </>
        ) : null}
        {/* Mode unit — current mode label + scope-within-mode (content set or
            workspace item) + create-empty action. Reads as a single "you are
            looking at <scope> inside <Mode>" identity, with no internal
            dividers. To switch modes, the user goes through the Project chip's
            launch sheet — there's no inline mode switcher here on purpose. */}
        {hasModeViewer ? (
          <>
            {projectContext ? (
              <span className="w-px h-3 bg-cc-border/40" aria-hidden />
            ) : null}
            <div className="flex items-center gap-2">
              <ModeLabel />
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
              {createEmpty && !replayMode && (
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
          </>
        ) : null}
      </div>

      {/* Center: tabs (hidden in empty shell — no session = no panels) */}
      {hasModeViewer && (
        <div className="flex items-center gap-1 mx-auto bg-cc-bg/80 border border-cc-border/50 rounded-full p-1 shadow-inner">
          {visibleTabs.map((tab) => {
            const disabledByReplay = replayMode && tab.id !== "chat";
            const disabledByGit = tab.id === "diff" && gitAvailable === false;
            const disabled = disabledByReplay || disabledByGit;
            const badge = tab.id === "schedules" && cronJobCount > 0 ? cronJobCount : 0;
            return (
              <button
                key={tab.id}
                onClick={() => !disabled && setActiveTab(tab.id)}
                title={disabledByReplay ? "Not available in replay mode" : disabledByGit ? "Diffs require a git repository. Run `git init` in the workspace." : undefined}
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
      )}

      {/* Right: share dropdown or replay badge (hidden in empty shell) */}
      {hasModeViewer && (
        replayMode ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cc-primary/10 border border-cc-primary/20 text-cc-primary text-xs font-medium">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M4 2l10 6-10 6V2z"/>
              </svg>
              Replay
            </span>
            {replayMetadata?.title && (
              <span className="text-cc-muted/60 text-xs truncate max-w-[200px]">{replayMetadata.title}</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <EditingToggle />
            <ShareDropdown />
          </div>
        )
      )}
    </div>
  );
}
