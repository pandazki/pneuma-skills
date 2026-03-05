import { useState, useEffect, useCallback } from "react";

interface BuiltinMode {
  name: string;
  displayName: string;
  description: string;
  version: string;
  type: "builtin";
  hasInitParams?: boolean;
}

interface PublishedMode {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  publishedAt: string;
  archiveUrl: string;
}

interface LocalMode {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  path: string;
}

interface RecentSession {
  id: string;
  mode: string;
  displayName: string;
  workspace: string;
  lastAccessed: number;
}

interface ChildProcess {
  pid: number;
  specifier: string;
  workspace: string;
  url: string;
  startedAt: number;
}

interface InitParam {
  name: string;
  label: string;
  type: "string" | "number";
  defaultValue: string | number;
  description?: string;
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

const MODE_ICONS: Record<string, string> = {
  doc: "\u{1F4C4}",
  slide: "\u{1F3A8}",
  draw: "\u{270F}\u{FE0F}",
};

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function runningDuration(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function shortenPath(path: string, homeDir: string): string {
  if (path.startsWith(homeDir)) return "~" + path.slice(homeDir.length);
  return path;
}

// ── ModeCard ──────────────────────────────────────────────────────────────

function ModeCard({
  name,
  displayName,
  description,
  version,
  onLaunch,
  index,
  onDelete,
}: {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  onLaunch: () => void;
  index: number;
  onDelete?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className="border border-cc-border/50 rounded-2xl p-6 bg-cc-card backdrop-blur-xl hover:border-cc-primary/40 transition-all duration-300 flex flex-col gap-4 hover:shadow-[0_8px_32px_-8px_rgba(249,115,22,0.2)] hover:-translate-y-1"
      style={{ animation: `warmFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.05}s both` }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5">{MODE_ICONS[name] || "\u{1F4E6}"}</span>
          <div>
            <h3 className="text-lg font-semibold text-cc-fg">{displayName}</h3>
            {description && (
              <p className="text-sm text-cc-muted mt-1">{description}</p>
            )}
          </div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-cc-primary-muted text-cc-primary shrink-0 ml-3">
          {version}
        </span>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <button
          onClick={onLaunch}
          className="self-start px-4 py-1.5 text-sm font-medium rounded-lg bg-cc-primary hover:bg-cc-primary-hover text-cc-fg transition-colors cursor-pointer"
        >
          Launch
        </button>
        {onDelete && !confirmDelete && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-2 py-1.5 text-xs text-cc-muted hover:text-red-400 transition-colors cursor-pointer"
          >
            Delete
          </button>
        )}
        {onDelete && confirmDelete && (
          <>
            <button
              onClick={() => { onDelete(); setConfirmDelete(false); }}
              className="px-2 py-1.5 text-xs text-red-400 hover:text-red-300 font-medium transition-colors cursor-pointer"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1.5 text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── SessionCard ───────────────────────────────────────────────────────────

function SessionCard({
  session,
  homeDir,
  onResume,
  onDelete,
}: {
  session: RecentSession;
  homeDir: string;
  onResume: (skipSkill?: boolean) => Promise<void>;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [skillUpdate, setSkillUpdate] = useState<{
    currentVersion: string;
    installedVersion: string;
  } | null>(null);

  const handleResume = async () => {
    if (confirmDelete || launching || skillUpdate) return;
    setLaunching(true);
    try {
      // Check if skill needs updating before launching
      const res = await fetch(`${getApiBase()}/api/launch/skill-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specifier: session.mode, workspace: session.workspace }),
      });
      const data = await res.json();
      if (data.needsUpdate && !data.dismissed) {
        // Show inline update prompt instead of launching
        setSkillUpdate({ currentVersion: data.currentVersion, installedVersion: data.installedVersion });
        setLaunching(false);
        return;
      }
      // No update needed (or dismissed) — launch directly, skip skill install for speed
      await onResume(!data.needsUpdate || data.dismissed);
      setLaunching(false);
    } catch {
      // Can't check — just launch
      await onResume();
      setLaunching(false);
    }
  };

  const handleUpdate = async () => {
    setSkillUpdate(null);
    setLaunching(true);
    await onResume(false);
    setLaunching(false);
  };

  const handleSkip = async () => {
    // Dismiss this version, then launch with skipSkill
    try {
      await fetch(`${getApiBase()}/api/launch/skill-dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: session.workspace, version: skillUpdate!.currentVersion }),
      });
    } catch { }
    setSkillUpdate(null);
    setLaunching(true);
    await onResume(true);
    setLaunching(false);
  };

  return (
    <div
      className={`border border-cc-border/50 rounded-xl bg-cc-card backdrop-blur-md hover:border-cc-primary/40 transition-all duration-300 group hover:shadow-[0_4px_24px_-8px_rgba(249,115,22,0.15)] hover:-translate-y-0.5 ${launching ? "opacity-60 pointer-events-none" : ""}`}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
        onClick={handleResume}
      >
        <span className="text-base shrink-0">{MODE_ICONS[session.mode] || "\u{1F4E6}"}</span>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-cc-fg">
            {launching ? "Launching..." : session.displayName}
          </span>
          <span className="text-xs text-cc-muted ml-2 font-mono truncate">
            {shortenPath(session.workspace, homeDir)}
          </span>
        </div>
        <span className="text-xs text-cc-muted/60 shrink-0">{timeAgo(session.lastAccessed)}</span>
        {!confirmDelete && !skillUpdate ? (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            className="text-cc-muted/40 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"
            title="Remove"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        ) : confirmDelete ? (
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onDelete}
              className="text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-cc-muted hover:text-cc-fg cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      {/* Inline skill update prompt */}
      {skillUpdate && (
        <div className="px-4 pb-3 flex items-center gap-3 text-xs" onClick={(e) => e.stopPropagation()}>
          <span className="text-cc-primary">
            Skill update: {skillUpdate.installedVersion} → {skillUpdate.currentVersion}
          </span>
          <button
            onClick={handleUpdate}
            className="px-2.5 py-1 rounded bg-cc-primary hover:bg-cc-primary-hover text-cc-fg font-medium transition-colors cursor-pointer"
          >
            Update
          </button>
          <button
            onClick={handleSkip}
            className="px-2.5 py-1 rounded border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

// ── RunningCard ───────────────────────────────────────────────────────────

function RunningCard({
  process: proc,
  homeDir,
  onStop,
}: {
  process: ChildProcess;
  homeDir: string;
  onStop: () => void;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [duration, setDuration] = useState(runningDuration(proc.startedAt));

  // Update duration every 10s
  useEffect(() => {
    const interval = setInterval(() => setDuration(runningDuration(proc.startedAt)), 10_000);
    return () => clearInterval(interval);
  }, [proc.startedAt]);

  // Extract mode name from specifier for icon lookup
  const modeName = proc.specifier.split("/").pop() || proc.specifier;

  return (
    <div className="border-l-2 border-emerald-500/70 rounded-r-xl bg-cc-card backdrop-blur-md hover:bg-cc-card/80 transition-all duration-200 group">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Pulsing green dot */}
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        <span className="text-base shrink-0">{MODE_ICONS[modeName] || "\u{1F4E6}"}</span>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-cc-fg">{modeName}</span>
          <span className="text-xs text-cc-muted ml-2 font-mono truncate">
            {shortenPath(proc.workspace, homeDir)}
          </span>
        </div>
        <span className="text-xs text-emerald-400/80 shrink-0">{duration}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => window.open(proc.url, "_blank")}
            className="px-2 py-1 text-xs text-cc-muted hover:text-cc-fg transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
            title="Open"
          >
            Open
          </button>
          {!confirmStop ? (
            <button
              onClick={() => setConfirmStop(true)}
              className="text-cc-muted/40 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
              title="Stop"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { onStop(); setConfirmStop(false); }}
                className="text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmStop(false)}
                className="text-xs text-cc-muted hover:text-cc-fg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── LaunchDialog ──────────────────────────────────────────────────────────

function LaunchDialog({
  specifier,
  displayName,
  defaultWorkspace,
  homeDir,
  onClose,
}: {
  specifier: string;
  displayName: string;
  defaultWorkspace?: string;
  homeDir: string;
  onClose: () => void;
}) {
  const fallback = homeDir
    ? `${homeDir.replace(/[\\/]+$/, "")}/pneuma-projects/${specifier}-workspace`
    : `~/pneuma-projects/${specifier}-workspace`;
  const [workspace, setWorkspace] = useState(
    defaultWorkspace || fallback,
  );
  const [initParams, setInitParams] = useState<InitParam[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string | number>>({});
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prepare = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/launch/prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ specifier }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else if (data.initParams?.length) {
          setInitParams(data.initParams);
          const defaults: Record<string, string | number> = {};
          for (const p of data.initParams) {
            defaults[p.name] = p.defaultValue;
          }
          setParamValues(defaults);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to prepare launch");
      }
      setPreparing(false);
    };
    prepare();
  }, [specifier]);

  const handleLaunch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specifier,
          workspace,
          initParams: Object.keys(paramValues).length > 0 ? paramValues : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setLoading(false);
      } else if (data.url) {
        window.open(data.url, "_blank");
        setLoading(false);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
      setLoading(false);
    }
  }, [specifier, workspace, paramValues, onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-cc-surface/80 backdrop-blur-2xl border border-cc-border/50 rounded-2xl p-8 w-full max-w-lg mx-4 shadow-[0_16px_64px_-16px_rgba(0,0,0,0.5)]"
        style={{ animation: "warmFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold text-cc-fg mb-4">
          Launch {displayName}
        </h2>

        <label className="block text-sm text-cc-muted mb-1">Workspace path</label>
        <input
          type="text"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          className="w-full px-3 py-2 bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg text-sm mb-4 focus:outline-none focus:border-cc-primary/50"
        />

        {preparing && (
          <p className="text-sm text-cc-muted mb-4">Loading configuration...</p>
        )}

        {initParams.length > 0 && (
          <div className="mb-4 space-y-3">
            <p className="text-sm font-medium text-cc-fg">Parameters</p>
            {initParams.map((param) => (
              <div key={param.name}>
                <label className="block text-sm text-cc-muted mb-1">
                  {param.label}
                  {param.description && (
                    <span className="text-cc-muted/60"> — {param.description}</span>
                  )}
                </label>
                <input
                  type={param.type === "number" ? "number" : "text"}
                  value={paramValues[param.name] ?? param.defaultValue}
                  onChange={(e) => {
                    const val = param.type === "number" ? Number(e.target.value) : e.target.value;
                    setParamValues((prev) => ({ ...prev, [param.name]: val }));
                  }}
                  className="w-full px-3 py-2 bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg text-sm focus:outline-none focus:border-cc-primary/50"
                />
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-cc-error mb-4">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            disabled={loading || preparing}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-cc-primary hover:bg-cc-primary-hover text-cc-fg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? "Launching..." : "Launch"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Launcher ─────────────────────────────────────────────────────────

export default function Launcher() {
  const [builtins, setBuiltins] = useState<BuiltinMode[]>([]);
  const [published, setPublished] = useState<PublishedMode[]>([]);
  const [local, setLocal] = useState<LocalMode[]>([]);
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [running, setRunning] = useState<ChildProcess[]>([]);
  const [homeDir, setHomeDir] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [launchTarget, setLaunchTarget] = useState<{
    specifier: string;
    displayName: string;
    defaultWorkspace?: string;
  } | null>(null);

  const refreshModes = useCallback(() => {
    fetch(`${getApiBase()}/api/registry`)
      .then((r) => r.json())
      .then((data) => {
        setBuiltins(data.builtins || []);
        setPublished(data.published || []);
        setLocal(data.local || []);
      })
      .catch(() => { });
  }, []);

  const refreshSessions = useCallback(() => {
    fetch(`${getApiBase()}/api/sessions`)
      .then((r) => r.json())
      .then((data) => {
        setSessions(data.sessions || []);
        if (data.homeDir) setHomeDir(data.homeDir);
      })
      .catch(() => { });
  }, []);

  const refreshRunning = useCallback(() => {
    fetch(`${getApiBase()}/api/processes/children`)
      .then((r) => r.json())
      .then((data) => setRunning(data.processes || []))
      .catch(() => { });
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${getApiBase()}/api/registry`).then((r) => r.json()),
      fetch(`${getApiBase()}/api/sessions`).then((r) => r.json()),
      fetch(`${getApiBase()}/api/processes/children`).then((r) => r.json()),
    ])
      .then(([registryData, sessionsData, runningData]) => {
        setBuiltins(registryData.builtins || []);
        setPublished(registryData.published || []);
        setLocal(registryData.local || []);
        setSessions(sessionsData.sessions || []);
        if (sessionsData.homeDir) setHomeDir(sessionsData.homeDir);
        setRunning(runningData.processes || []);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  // Poll running processes every 3s
  useEffect(() => {
    const interval = setInterval(refreshRunning, 3000);
    return () => clearInterval(interval);
  }, [refreshRunning]);

  const deleteLocalMode = useCallback(async (name: string) => {
    try {
      await fetch(`${getApiBase()}/api/modes/${encodeURIComponent(name)}`, { method: "DELETE" });
      refreshModes();
    } catch { }
  }, [refreshModes]);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await fetch(`${getApiBase()}/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      refreshSessions();
    } catch { }
  }, [refreshSessions]);

  const stopProcess = useCallback(async (pid: number) => {
    try {
      await fetch(`${getApiBase()}/api/processes/children/${pid}/kill`, { method: "POST" });
      refreshRunning();
    } catch { }
  }, [refreshRunning]);

  // Direct launch for session resume — no dialog, just go
  const directLaunch = useCallback(async (specifier: string, workspace: string, skipSkill?: boolean) => {
    try {
      const res = await fetch(`${getApiBase()}/api/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specifier, workspace, ...(skipSkill ? { skipSkill: true } : {}) }),
      });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
        refreshSessions();
        refreshRunning();
      }
    } catch { }
  }, [refreshSessions, refreshRunning]);

  const filterModes = <T extends { name: string; displayName: string; description?: string }>(
    modes: T[],
  ): T[] => {
    if (!search) return modes;
    const q = search.toLowerCase();
    return modes.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q),
    );
  };

  const filteredBuiltins = filterModes(builtins);
  const filteredPublished = filterModes(published);
  const filteredLocal = filterModes(local);
  const filteredSessions = search
    ? sessions.filter(
      (s) =>
        s.mode.toLowerCase().includes(search.toLowerCase()) ||
        s.displayName.toLowerCase().includes(search.toLowerCase()) ||
        s.workspace.toLowerCase().includes(search.toLowerCase()),
    )
    : sessions;

  const showTopRow = filteredSessions.length > 0 || running.length > 0;

  return (
    <div className="min-h-screen bg-cc-bg text-cc-fg relative overflow-hidden">
      {/* Immersive mesh gradient background element */}
      <div className="absolute top-[-10%] left-[20%] w-[60%] h-[40%] bg-cc-primary/10 blur-[120px] rounded-full pointer-events-none animate-[pulse-dot_8s_ease-in-out_infinite]" />
      <div className="absolute top-[20%] right-[-10%] w-[40%] h-[50%] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none animate-[pulse-dot_10s_ease-in-out_infinite_reverse]" />

      <div className="max-w-5xl mx-auto px-6 py-20 relative z-10">
        {/* Header */}
        <div className="text-center mb-16" style={{ animation: "warmFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1)" }}>
          <h1 className="text-6xl font-extrabold mb-4 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cc-fg via-cc-primary to-indigo-400">
            Pneuma
          </h1>
          <p className="text-cc-muted/80 text-lg font-medium tracking-wide">
            Choose a mode to get started
          </p>
        </div>

        {/* Search */}
        <div className="mb-14 max-w-xl mx-auto" style={{ animation: "warmFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both" }}>
          <div className="relative group">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search modes..."
              className="w-full pl-12 pr-6 py-4 bg-cc-surface/40 backdrop-blur-md border border-cc-border/40 rounded-full text-cc-fg text-base placeholder:text-cc-muted/40 outline-none transition-all focus:border-cc-primary/50 focus:bg-cc-surface/70 focus:shadow-[0_0_30px_rgba(249,115,22,0.1)] hover:border-cc-border"
            />
            <svg className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-cc-muted/60 group-focus-within:text-cc-primary/80 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-cc-primary border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {/* Recent Sessions + Running — side by side */}
            {showTopRow && (
              <section className="mb-10" style={{ animation: "warmFadeIn 0.5s ease-out 0.15s both" }}>
                <div className={`grid gap-6 ${filteredSessions.length > 0 && running.length > 0 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
                  {/* Recent Sessions */}
                  {filteredSessions.length > 0 && (
                    <div>
                      <h2 className="text-sm font-medium text-cc-muted uppercase tracking-wide mb-3">
                        Recent Sessions
                      </h2>
                      <div className="space-y-2 max-h-[156px] overflow-y-auto pr-1">
                        {filteredSessions.map((session) => (
                          <SessionCard
                            key={session.id}
                            session={session}
                            homeDir={homeDir}
                            onResume={(skipSkill) => directLaunch(session.mode, session.workspace, skipSkill)}
                            onDelete={() => deleteSession(session.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Running Processes */}
                  {running.length > 0 && (
                    <div>
                      <h2 className="text-sm font-medium text-cc-muted uppercase tracking-wide mb-3">
                        Running
                        <span className="ml-2 text-xs text-emerald-400/80 normal-case font-normal">{running.length} active</span>
                      </h2>
                      <div className="space-y-2 max-h-[156px] overflow-y-auto pr-1">
                        {running.map((proc) => (
                          <RunningCard
                            key={proc.pid}
                            process={proc}
                            homeDir={homeDir}
                            onStop={() => stopProcess(proc.pid)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Builtin Modes */}
            {filteredBuiltins.length > 0 && (
              <section className="mb-10">
                <h2 className="text-sm font-medium text-cc-muted uppercase tracking-wide mb-4">
                  Built-in Modes
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredBuiltins.map((mode, i) => (
                    <ModeCard
                      key={mode.name}
                      name={mode.name}
                      displayName={mode.displayName}
                      description={mode.description}
                      version={mode.version}
                      index={i}
                      onLaunch={() =>
                        setLaunchTarget({
                          specifier: mode.name,
                          displayName: mode.displayName,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Local Modes */}
            {filteredLocal.length > 0 && (
              <section className="mb-10">
                <h2 className="text-sm font-medium text-cc-muted uppercase tracking-wide mb-4">
                  Local Modes
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredLocal.map((mode, i) => (
                    <ModeCard
                      key={mode.name}
                      name={mode.name}
                      displayName={mode.displayName}
                      description={mode.description}
                      version={mode.version}
                      index={i}
                      onLaunch={() =>
                        setLaunchTarget({
                          specifier: mode.path,
                          displayName: mode.displayName,
                        })
                      }
                      onDelete={() => deleteLocalMode(mode.name)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Published Modes */}
            {filteredPublished.length > 0 && (
              <section className="mb-10">
                <h2 className="text-sm font-medium text-cc-muted uppercase tracking-wide mb-4">
                  Published Modes
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredPublished.map((mode, i) => (
                    <ModeCard
                      key={mode.name}
                      name={mode.name}
                      displayName={mode.displayName}
                      description={mode.description}
                      version={mode.version}
                      index={i}
                      onLaunch={() =>
                        setLaunchTarget({
                          specifier: mode.archiveUrl,
                          displayName: mode.displayName,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {filteredBuiltins.length === 0 && filteredPublished.length === 0 && filteredLocal.length === 0 && (
              <p className="text-center text-cc-muted">
                {search ? "No modes match your search." : "No modes available."}
              </p>
            )}
          </>
        )}
      </div>

      {/* Launch Dialog */}
      {launchTarget && (
        <LaunchDialog
          specifier={launchTarget.specifier}
          displayName={launchTarget.displayName}
          defaultWorkspace={launchTarget.defaultWorkspace}
          homeDir={homeDir}
          onClose={() => setLaunchTarget(null)}
        />
      )}
    </div>
  );
}
