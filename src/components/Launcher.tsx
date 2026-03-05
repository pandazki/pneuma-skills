import React, { useState, useEffect, useCallback } from "react";


interface BuiltinMode {
  name: string;
  displayName: string;
  description: string;
  version: string;
  type: "builtin";
  hasInitParams?: boolean;
  icon?: string;
}

interface PublishedMode {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  publishedAt: string;
  archiveUrl: string;
  icon?: string;
}

interface LocalMode {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  path: string;
  icon?: string;
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

const FALLBACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>`;

function ModeIcon({ svg }: { svg?: string }) {
  const hasSvg = svg && svg.trim().startsWith("<svg");
  return (
    <div
      className={`w-[1em] h-[1em] [&>svg]:w-full [&>svg]:h-full transition-all duration-500 ${hasSvg ? "text-cc-primary drop-shadow-[0_0_8px_rgba(249,115,22,0.4)]" : "text-cc-muted drop-shadow-[0_0_8px_rgba(255,255,255,0.15)]"}`}
      dangerouslySetInnerHTML={{ __html: hasSvg ? svg : FALLBACK_SVG }}
    />
  );
}

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
  icon,
  onLaunch,
  index,
  onDelete,
}: {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  icon?: string;
  onLaunch: () => void;
  index: number;
  onDelete?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      onClick={(e) => {
        // Only launch if we didn't click delete/confirm buttons
        if (!(e.target as HTMLElement).closest("button")) {
          onLaunch();
        }
      }}
      className="group relative border border-cc-border/50 rounded-2xl p-6 bg-cc-card backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-cc-primary/40 transition-all duration-500 hover:shadow-[0_8px_32px_-8px_rgba(249,115,22,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] hover:-translate-y-1.5 cursor-pointer overflow-hidden flex flex-col h-full"
      style={{ animation: `warmFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.05}s both` }}
    >
      {/* Subtle overlay gradient on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-cc-primary/0 to-cc-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="flex items-start justify-between relative z-10">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 shrink-0 flex items-center justify-center rounded-full bg-gradient-to-b from-cc-surface/80 to-cc-surface/20 border border-white/5 shadow-[0_4px_12px_rgba(0,0,0,0.3)] text-2xl group-hover:scale-110 group-hover:border-cc-primary/30 group-hover:shadow-[0_0_25px_rgba(249,115,22,0.15)] transition-all duration-500">
            <ModeIcon svg={icon} />
          </div>
          <div className="pt-1">
            <h3 className="text-lg font-semibold text-cc-fg group-hover:text-cc-primary transition-colors duration-300">{displayName}</h3>
            {description && (
              <p className="text-sm text-cc-muted/80 mt-1.5 leading-relaxed">{description}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-auto pt-6 flex items-end justify-between relative z-10">
        <span className="text-xs px-2.5 py-1 rounded-full bg-cc-primary-muted/50 text-cc-primary font-medium tracking-wide">
          v{version}
        </span>

        <div className="flex items-center gap-3">
          {onDelete && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-md text-cc-muted/40 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
              title="Delete mode"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
              </svg>
            </button>
          )}
          {onDelete && confirmDelete && (
            <div className="flex items-center gap-2 bg-cc-surface/80 px-2 py-1 rounded border border-red-500/20">
              <button
                onClick={() => { onDelete(); setConfirmDelete(false); }}
                className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors cursor-pointer"
              >
                Confirm
              </button>
              <span className="text-cc-border">|</span>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex items-center text-sm font-medium text-cc-primary opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 delay-75">
            Launch
            <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SessionCard ───────────────────────────────────────────────────────────

function SessionCard({
  session,
  homeDir,
  icon,
  onResume,
  onDelete,
}: {
  session: RecentSession;
  homeDir: string;
  icon?: string;
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
      className={`relative rounded-lg bg-transparent hover:bg-cc-surface/40 transition-all duration-300 group cursor-pointer overflow-hidden ${launching ? "opacity-50 pointer-events-none" : ""}`}
      onClick={handleResume}
    >
      {/* Subtle left accent line on hover */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-0 bg-cc-primary rounded-r-full transition-all duration-300 group-hover:h-3/4 opacity-0 group-hover:opacity-100" />

      <div className="flex items-center gap-4 px-4 py-3">
        <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-b from-cc-surface/80 to-cc-surface/20 border border-white/5 flex items-center justify-center text-lg shadow-[0_2px_8px_rgba(0,0,0,0.3)] group-hover:border-cc-primary/30 group-hover:shadow-[0_0_15px_rgba(249,115,22,0.15)] transition-all">
          <ModeIcon svg={icon} />
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <span className="text-sm font-medium text-cc-fg/90 group-hover:text-cc-fg transition-colors truncate">
            {launching ? "Launching..." : session.displayName}
          </span>
          <span className="text-[11px] text-cc-muted/70 font-mono truncate mt-0.5">
            {shortenPath(session.workspace, homeDir)}
          </span>
        </div>
        <span className="text-xs text-cc-muted/50 group-hover:text-cc-primary/60 transition-colors shrink-0 pr-2">{timeAgo(session.lastAccessed)}</span>

        <div className="absolute right-4 flex items-center bg-cc-surface/90 backdrop-blur-md rounded-md border border-cc-border/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
          {!confirmDelete && !skillUpdate ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-cc-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer flex items-center gap-1.5"
              title="Remove"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
              </svg>
              <span className="text-xs pr-1 font-medium hidden sm:inline-block">Remove</span>
            </button>
          ) : confirmDelete ? (
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span className="text-xs text-cc-muted mr-1">Are you sure?</span>
              <button
                onClick={onDelete}
                className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 font-medium cursor-pointer transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-0.5 rounded hover:bg-cc-hover text-cc-muted hover:text-cc-fg cursor-pointer transition-colors"
              >
                No
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Inline skill update prompt - appears below row */}
      {skillUpdate && (
        <div className="mx-4 mb-2 p-3 bg-cc-primary/5 border border-cc-primary/20 rounded-lg flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold text-cc-primary uppercase tracking-wider mb-0.5">Skill Update Available</span>
            <span className="text-xs text-cc-fg/80">
              v{skillUpdate.installedVersion} → v{skillUpdate.currentVersion}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              className="px-3 py-1.5 text-xs rounded-md border border-cc-border/50 text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Skip
            </button>
            <button
              onClick={handleUpdate}
              className="px-3 py-1.5 text-xs rounded-md bg-cc-primary/10 border border-cc-primary/30 text-cc-primary hover:bg-cc-primary hover:text-cc-fg font-medium transition-colors cursor-pointer shadow-[0_0_10px_rgba(249,115,22,0.1)]"
            >
              Update
            </button>
          </div>
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
    <div className="relative rounded-lg bg-[#050505] border border-emerald-500/10 hover:border-emerald-500/30 transition-all duration-300 group overflow-hidden mb-2">
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-emerald-500/0 via-emerald-500/50 to-emerald-500/0 opacity-50" />

      <div className="flex items-center gap-4 px-4 py-3">
        {/* Pulsing terminal interface dot */}
        <div className="relative flex items-center justify-center w-8 h-8 shrink-0 rounded-full bg-gradient-to-b from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        </div>

        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-emerald-50 truncate filter drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">{modeName}</span>
            <span className="text-xs text-emerald-500 font-mono tracking-wide">{duration}</span>
          </div>
          <span className="text-[11px] text-cc-muted/60 font-mono truncate mt-0.5">
            {shortenPath(proc.workspace, homeDir)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => window.open(proc.url, "_blank")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md hover:bg-emerald-500 hover:text-emerald-50 transition-colors shadow-[0_0_10px_rgba(16,185,129,0.1)] cursor-pointer"
            title="Open Workspace"
          >
            Open
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>

          <div className="w-px h-4 bg-cc-border/50 mx-1 opacity-0 group-hover:opacity-100 transition-opacity" />

          {!confirmStop ? (
            <button
              onClick={() => setConfirmStop(true)}
              className="p-1.5 text-cc-muted/40 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
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
        className="bg-cc-card/90 backdrop-blur-2xl border border-cc-border/50 rounded-2xl p-8 w-full max-w-lg mx-4 shadow-[0_16px_64px_-16px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.1)]"
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

  // Build icon lookup from all mode sources for session cards
  const iconMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of builtins) { if (m.icon) map[m.name] = m.icon; }
    for (const m of local) { if (m.icon) map[m.name] = m.icon; }
    for (const m of published) { if (m.icon) map[m.name] = m.icon; }
    return map;
  }, [builtins, local, published]);

  const showTopRow = filteredSessions.length > 0 || running.length > 0;

  return (
    <div className="min-h-screen bg-cc-bg text-cc-fg relative overflow-hidden">
      {/* Immersive mesh gradient background element */}
      <div className="absolute inset-0 bg-grid-pattern opacity-10 pointer-events-none mix-blend-overlay" />
      <div className="absolute top-[-10%] left-[20%] w-[60%] h-[40%] bg-cc-primary/15 blur-[120px] rounded-full pointer-events-none animate-[pulse-dot_8s_ease-in-out_infinite]" />
      <div className="absolute top-[20%] right-[-10%] w-[40%] h-[50%] bg-violet-500/15 blur-[100px] rounded-full pointer-events-none animate-[pulse-dot_10s_ease-in-out_infinite_reverse]" />

      <div className="max-w-5xl mx-auto px-6 py-20 relative z-10">
        {/* Header */}
        <div className="text-center mb-16" style={{ animation: "warmFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1)" }}>
          <h1 className="text-6xl font-extrabold mb-4 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cc-fg via-cc-primary to-indigo-400 animate-text-gradient-flow">
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
              className="w-full pl-12 pr-6 py-4 bg-cc-surface/40 backdrop-blur-2xl border border-cc-border/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] rounded-full text-cc-fg text-base placeholder:text-cc-muted/40 outline-none transition-all focus:border-cc-primary/50 focus:bg-cc-surface/70 focus:shadow-[0_0_30px_rgba(249,115,22,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] hover:border-cc-border"
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
                      <div className="space-y-2 max-h-[220px] overflow-y-auto p-1">
                        {filteredSessions.map((session) => (
                          <SessionCard
                            key={session.id}
                            session={session}
                            homeDir={homeDir}
                            icon={iconMap[session.mode]}
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
                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
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
                      icon={mode.icon}
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
                      icon={mode.icon}
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
                      icon={mode.icon}
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
