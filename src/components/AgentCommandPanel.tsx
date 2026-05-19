/**
 * Agent-command UI surfaces:
 *
 *   <AgentCommandBanner />   — first-run inline card on the launcher.
 *                              Renders only when the user hasn't dismissed
 *                              the prompt AND no backend has the slash
 *                              command installed. Lets them install for
 *                              Claude Code / Codex in one click, with
 *                              per-backend checkboxes.
 *
 *   <AgentCommandSettings /> — full settings panel: per-backend status,
 *                              install / update / uninstall, auto-update
 *                              toggle, CLI presence + one-click symlink.
 *
 * Both hit the same /api/agent-commands + /api/cli/* routes.
 *
 * Styling follows the launcher's existing Tailwind + cc-* tokens —
 * glassmorphism via `backdrop-blur`, deep zinc surfaces, neon-orange
 * primary. No emoji in UI per project convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../utils/api.js";

// ── Types mirroring server schemas ─────────────────────────────────────────

type AgentCommandBackend = "claude-code" | "codex";

interface AgentCommandStatus {
  backend: AgentCommandBackend;
  label: string;
  command: string;
  path: string;
  installed: boolean;
  fileVersion?: string;
  registryVersion?: string;
  upToDate?: boolean;
  conflict?: boolean;
}

interface AgentCommandsState {
  pneumaVersion: string;
  promptDismissed: boolean;
  autoUpdate: boolean;
  items: AgentCommandStatus[];
}

interface CliStatus {
  bundledEntry: string;
  detectedOnPath: boolean;
  pathBinary?: string;
  pathBinaryVersion?: string;
  defaultSymlinkPath: string;
  defaultSymlinkExists: boolean;
  defaultSymlinkPointsAtBundle: boolean;
  pathContainsDefault: boolean;
  shellRcHint?: string;
}

// ── Shared hook ────────────────────────────────────────────────────────────

interface UseAgentCommands {
  state: AgentCommandsState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Resolves true on success, false on failure — banner uses this to skip dismissing the prompt on a server error. */
  install: (backend: AgentCommandBackend, force?: boolean) => Promise<boolean>;
  uninstall: (backend: AgentCommandBackend, force?: boolean) => Promise<boolean>;
  dismissPrompt: () => Promise<void>;
  setAutoUpdate: (enabled: boolean) => Promise<void>;
}

function useAgentCommands(): UseAgentCommands {
  const [state, setState] = useState<AgentCommandsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${getApiBase()}/api/agent-commands`);
      const data = (await res.json()) as AgentCommandsState | { error: string };
      if ("error" in data) {
        setError(data.error);
        return;
      }
      setState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = useCallback(
    async (backend: AgentCommandBackend, force = false) => {
      const res = await fetch(`${getApiBase()}/api/agent-commands/${backend}/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json()) as { state?: Partial<AgentCommandsState>; error?: string } & Record<string, unknown>;
      if (!res.ok) {
        setError(data.error || `install failed (HTTP ${res.status})`);
        return false;
      }
      // Server echoes the refreshed state — apply directly to avoid a round-trip.
      if (data.state && state) {
        setState({ ...state, ...data.state } as AgentCommandsState);
      } else {
        await refresh();
      }
      setError(null);
      return true;
    },
    [refresh, state],
  );

  const uninstall = useCallback(
    async (backend: AgentCommandBackend, force = false) => {
      const res = await fetch(`${getApiBase()}/api/agent-commands/${backend}/uninstall`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json()) as { state?: Partial<AgentCommandsState>; error?: string };
      if (!res.ok) {
        setError(data.error || `uninstall failed (HTTP ${res.status})`);
        return false;
      }
      if (data.state && state) {
        setState({ ...state, ...data.state } as AgentCommandsState);
      } else {
        await refresh();
      }
      setError(null);
      return true;
      setError(null);
    },
    [refresh, state],
  );

  const dismissPrompt = useCallback(async () => {
    await fetch(`${getApiBase()}/api/agent-commands/dismiss-prompt`, { method: "POST" });
    if (state) setState({ ...state, promptDismissed: true });
  }, [state]);

  const setAutoUpdateFn = useCallback(
    async (enabled: boolean) => {
      await fetch(`${getApiBase()}/api/agent-commands/auto-update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (state) setState({ ...state, autoUpdate: enabled });
    },
    [state],
  );

  return { state, loading, error, refresh, install, uninstall, dismissPrompt, setAutoUpdate: setAutoUpdateFn };
}

function useCliStatus(): { status: CliStatus | null; refresh: () => Promise<void>; symlink: () => Promise<{ ok: boolean; message?: string }> } {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/cli/status`);
      if (!res.ok) return;
      setStatus((await res.json()) as CliStatus);
    } catch {
      // soft fail; the panel just hides this row when status is null
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const symlink = useCallback(async () => {
    const res = await fetch(`${getApiBase()}/api/cli/symlink`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = (await res.json()) as { result?: { ok: boolean; message?: string }; status?: CliStatus; error?: string };
    if (data.status) setStatus(data.status);
    if (data.result) return data.result;
    return { ok: false, message: data.error };
  }, []);
  return { status, refresh, symlink };
}

// ── Banner (first-run) ─────────────────────────────────────────────────────

export function AgentCommandBanner({ className }: { className?: string }) {
  const { state, error, install, dismissPrompt } = useAgentCommands();
  const [selected, setSelected] = useState<Record<AgentCommandBackend, boolean>>({
    "claude-code": true,
    codex: true,
  });
  const [busy, setBusy] = useState(false);

  // Hidden until we know we should show it. Renders nothing if dismissed or
  // any backend already has the command installed.
  const shouldShow = useMemo(() => {
    if (!state) return false;
    if (state.promptDismissed) return false;
    if (state.items.some((i) => i.installed)) return false;
    return true;
  }, [state]);

  if (!shouldShow || !state) return null;

  const handleInstall = async () => {
    setBusy(true);
    try {
      // Track per-backend success so we can keep the banner up if any
      // backend failed — otherwise a server error (e.g. missing template
      // file in a broken bundle) would silently dismiss the prompt and
      // leave the user with no way to retry from the UI.
      let allOk = true;
      for (const backend of Object.keys(selected) as AgentCommandBackend[]) {
        if (selected[backend]) {
          const ok = await install(backend);
          if (!ok) allOk = false;
        }
      }
      if (allOk) await dismissPrompt();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-cc-primary/30 bg-gradient-to-br from-cc-primary/10 via-cc-surface to-cc-surface p-5 mb-8 ${className ?? ""}`}
      style={{ backdropFilter: "blur(16px)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider font-medium text-cc-primary/80 mb-1">
            New: /handoff-pneuma
          </div>
          <h3 className="text-base font-semibold text-cc-fg mb-2">
            Install the Pneuma slash command in your code agent
          </h3>
          <p className="text-sm text-cc-fg/70 leading-relaxed mb-4">
            Drop into Pneuma from Claude Code or Codex without leaving your terminal —
            <span className="text-cc-fg/90"> /handoff-pneuma "build me a dashboard"</span> spins up the
            right mode in the current directory and hands the work off with one round-trip.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            {state.items.map((item) => (
              <label
                key={item.backend}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-cc-border bg-cc-surface/60 cursor-pointer hover:border-cc-primary/40 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected[item.backend]}
                  onChange={(e) => setSelected((s) => ({ ...s, [item.backend]: e.target.checked }))}
                  className="accent-cc-primary"
                />
                <span className="text-sm text-cc-fg">{item.label}</span>
                <span className="text-xs text-cc-fg/40 font-mono">{item.command}</span>
              </label>
            ))}
          </div>

          {error && (
            <div className="mb-3 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/5 text-xs text-red-400">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !Object.values(selected).some(Boolean)}
              onClick={handleInstall}
              className="px-4 py-1.5 rounded-lg bg-cc-primary text-cc-bg font-medium text-sm hover:bg-cc-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "Installing…" : "Install"}
            </button>
            <button
              type="button"
              onClick={() => void dismissPrompt()}
              className="px-4 py-1.5 rounded-lg text-sm text-cc-fg/70 hover:text-cc-fg hover:bg-cc-surface transition-colors"
            >
              Not now
            </button>
            <span className="text-xs text-cc-fg/40 ml-2">
              Files land in
              {" "}
              <span className="font-mono">~/.claude/commands/</span>
              {" "}or{" "}
              <span className="font-mono">~/.codex/prompts/</span>.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Full settings panel ────────────────────────────────────────────────────

export function AgentCommandSettings() {
  const { state, error, install, uninstall, setAutoUpdate } = useAgentCommands();
  const { status: cliStatus, symlink } = useCliStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [symlinkResult, setSymlinkResult] = useState<{ ok: boolean; message?: string } | null>(null);

  if (!state) {
    return <div className="text-sm text-cc-fg/60">Loading…</div>;
  }

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-sm">
      <header>
        <h3 className="text-base font-semibold text-cc-fg mb-1">Agent Commands</h3>
        <p className="text-xs text-cc-fg/60 leading-relaxed">
          Manage the <span className="font-mono">/handoff-pneuma</span> slash command in your code
          agent's user-level commands directory. Pneuma {state.pneumaVersion}.
        </p>
      </header>

      {error && (
        <div className="px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/5 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Per-backend rows */}
      <div className="flex flex-col gap-2">
        {state.items.map((item) => {
          const installBusy = busy === `install-${item.backend}`;
          const uninstallBusy = busy === `uninstall-${item.backend}`;
          const installLabel = item.installed
            ? item.upToDate
              ? "Reinstall"
              : "Update"
            : "Install";
          return (
            <div
              key={item.backend}
              className="flex flex-col gap-2 rounded-xl border border-cc-border bg-cc-surface/40 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-cc-fg">{item.label}</div>
                  <div className="text-xs text-cc-fg/60 font-mono truncate">{item.path}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                      item.installed
                        ? item.upToDate
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-amber-500/15 text-amber-400"
                        : item.conflict
                          ? "bg-red-500/15 text-red-400"
                          : "bg-cc-fg/10 text-cc-fg/50"
                    }`}
                  >
                    {item.installed
                      ? item.upToDate
                        ? `installed ${item.fileVersion}`
                        : `update available — ${item.fileVersion} → ${state.pneumaVersion}`
                      : item.conflict
                        ? "conflict"
                        : "not installed"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={installBusy || uninstallBusy}
                  onClick={() => run(`install-${item.backend}`, () => install(item.backend, item.conflict))}
                  className="px-3 py-1 rounded-lg bg-cc-primary text-cc-bg text-xs font-medium hover:bg-cc-primary/90 disabled:opacity-40"
                >
                  {installBusy ? "…" : item.conflict ? "Force install" : installLabel}
                </button>
                {item.installed && (
                  <button
                    type="button"
                    disabled={installBusy || uninstallBusy}
                    onClick={() => run(`uninstall-${item.backend}`, () => uninstall(item.backend))}
                    className="px-3 py-1 rounded-lg border border-cc-border text-xs text-cc-fg/80 hover:bg-cc-surface disabled:opacity-40"
                  >
                    {uninstallBusy ? "…" : "Uninstall"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Auto-update toggle */}
      <label className="flex items-center justify-between gap-3 rounded-xl border border-cc-border bg-cc-surface/40 px-3 py-2">
        <div>
          <div className="text-cc-fg">Auto-update on launch</div>
          <div className="text-xs text-cc-fg/60">Re-stamp installed commands when pneuma's version changes.</div>
        </div>
        <input
          type="checkbox"
          checked={state.autoUpdate}
          onChange={(e) => void setAutoUpdate(e.target.checked)}
          className="accent-cc-primary scale-125"
        />
      </label>

      {/* CLI status + symlink (task #12) */}
      {cliStatus && (
        <section className="rounded-xl border border-cc-border bg-cc-surface/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="font-medium text-cc-fg">pneuma CLI on PATH</div>
              <div className="text-xs text-cc-fg/60 font-mono truncate">
                {cliStatus.pathBinary ?? "(not detected)"}
                {cliStatus.pathBinaryVersion ? ` — ${cliStatus.pathBinaryVersion}` : ""}
              </div>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                cliStatus.detectedOnPath ? "bg-emerald-500/15 text-emerald-400" : "bg-cc-fg/10 text-cc-fg/50"
              }`}
            >
              {cliStatus.detectedOnPath ? "detected" : "missing"}
            </span>
          </div>
          {!cliStatus.detectedOnPath && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={async () => {
                  setSymlinkResult(null);
                  const r = await symlink();
                  setSymlinkResult(r);
                }}
                className="self-start px-3 py-1 rounded-lg bg-cc-primary text-cc-bg text-xs font-medium hover:bg-cc-primary/90"
              >
                Symlink CLI to {cliStatus.defaultSymlinkPath}
              </button>
              {symlinkResult && (
                <div className={`text-xs ${symlinkResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {symlinkResult.ok
                    ? `Done. Run the next command in a new shell.`
                    : symlinkResult.message ?? "Symlink failed."}
                </div>
              )}
              {!cliStatus.pathContainsDefault && cliStatus.shellRcHint && (
                <pre className="text-[11px] text-cc-fg/60 bg-cc-bg p-2 rounded border border-cc-border overflow-x-auto">
{cliStatus.shellRcHint}
                </pre>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
