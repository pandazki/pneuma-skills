/**
 * ProjectPanel — anchored dropdown content for the Project chip.
 *
 * Width ~640px, max-height 70vh, surface uses the editor's chrome rhythm
 * (rounded-2xl, glassmorphism, soft long shadow) — not a small menu shape.
 *
 * Three sections, separated by 1px dividers (no nested cards):
 *
 *   1. Identity row  — cover + displayName + description + path
 *   2. Sessions area — one column per mode, plus "+ New {mode} session"
 *      footer per column, plus a compact "Start in another mode" trigger
 *   3. Actions       — Evolve Preferences · Archive (right-aligned)
 *
 * The panel fetches `GET /api/projects/:root/sessions` + `GET /api/registry`
 * in parallel on mount. While loading, a single muted line renders. While
 * empty (zero sessions), a single muted line points at the "Start in another
 * mode" trigger.
 *
 * Currently-active session (matches `useStore(s => s.session?.session_id)`)
 * gets a subtle background tint + ring-1, never a side stripe.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";
import { basename, shortenPath } from "../utils/string.js";
import { timeAgo } from "../utils/timeAgo.js";
import { CoverImage, type ProjectCoverEntry } from "./ProjectCover.js";

interface ProjectInfo {
  name: string;
  displayName: string;
  description?: string;
  root: string;
}

interface SessionRef {
  sessionId: string;
  mode: string;
  sessionDir: string;
  /** Backend the session was created with — drives resume routing. */
  backendType?: string;
  /** Optional human-readable name (from --session-name / rename). */
  displayName?: string;
  /** Last-accessed mtime; populated server-side when available. */
  lastAccessed?: number;
}

interface ModeInfo {
  name: string;
  displayName?: string;
}

interface ProjectPanelProps {
  projectRoot: string;
}

export default function ProjectPanel({ projectRoot }: ProjectPanelProps) {
  const apiBase = getApiBase();
  const activeSessionId = useStore((s) => s.session?.session_id ?? null);
  const ctx = useStore((s) => s.projectContext);

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessions, setSessions] = useState<SessionRef[]>([]);
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [coverImageUrl, setCoverImageUrl] = useState<string | undefined>(undefined);
  const [homeDir, setHomeDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [otherModeOpen, setOtherModeOpen] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  // Phase 4 — Archive flow. The actions row morphs into an inline confirm
  // (no modal, no card-in-card), and surfaces failures the same way as
  // launchError. `archiving` disables the Confirm button to dedupe clicks.
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Fetch project info + sessions + registry + project list (for cover URL
  // and homeDir) in parallel on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        // `/api/projects` is mounted in both launcher and per-session servers
        // and now returns `homeDir` alongside the project list, so a single
        // fetch covers cover URL lookup + path shortening. We deliberately
        // avoid `/api/sessions` (launcher-only) to prevent 404s in active
        // sessions.
        const [pRes, mRes, listRes] = await Promise.all([
          fetch(`${apiBase}/api/projects/${encodeURIComponent(projectRoot)}/sessions`),
          fetch(`${apiBase}/api/registry`),
          fetch(`${apiBase}/api/projects`).catch(() => null),
        ]);
        if (cancelled) return;
        if (pRes.ok) {
          const pData = (await pRes.json()) as {
            project: ProjectInfo;
            sessions: SessionRef[];
          };
          setProject(pData.project);
          setSessions(pData.sessions ?? []);
        }
        if (mRes && mRes.ok) {
          const reg = (await mRes.json()) as {
            builtins?: ModeInfo[];
            local?: ModeInfo[];
          };
          // Dedupe by name — local copies of builtins share names; builtins
          // win since they appear first. Mirrors ModeSwitcherDropdown:81-89.
          const seen = new Set<string>();
          const merged: ModeInfo[] = [];
          for (const m of [...(reg.builtins ?? []), ...(reg.local ?? [])]) {
            if (seen.has(m.name)) continue;
            seen.add(m.name);
            merged.push({ name: m.name, displayName: m.displayName });
          }
          setModes(merged);
        }
        if (listRes && listRes.ok) {
          try {
            const listData = (await listRes.json()) as {
              projects: Array<{ id: string; root: string; coverImageUrl?: string }>;
              homeDir?: string;
            };
            const match = listData.projects?.find(
              (p) => p.root === projectRoot || p.id === projectRoot,
            );
            if (match?.coverImageUrl) setCoverImageUrl(match.coverImageUrl);
            if (listData.homeDir) setHomeDir(listData.homeDir);
          } catch { /* ignore */ }
        }
      } catch {
        // tolerate transient errors; panel renders an empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, apiBase]);

  // Single launch helper. The previous `launchSession` and `evolveProject`
  // were 95% identical (only `specifier` differed); keep one path so error
  // surfacing and disable-while-launching gating can't drift.
  const launch = async (specifier: string, sessionId?: string) => {
    if (launching) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await fetch(`${apiBase}/api/launch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          specifier,
          workspace: projectRoot,
          project: projectRoot,
          ...(sessionId ? { sessionId } : {}),
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setLaunchError(data.error ?? `Launch failed (${res.status})`);
    } catch (err) {
      console.error("[ProjectPanel] launch failed", err);
      setLaunchError(err instanceof Error ? err.message : "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  // Group sessions by mode. Modes ordered by first-appearance in sessions
  // for a stable, content-driven layout (vs alphabetical, which would put
  // "diagram" before more-active modes).
  const sessionsByMode = useMemo(() => {
    const map = new Map<string, SessionRef[]>();
    for (const s of sessions) {
      const list = map.get(s.mode) ?? [];
      list.push(s);
      map.set(s.mode, list);
    }
    // Sort each mode's sessions by lastAccessed desc when available.
    for (const [mode, list] of map) {
      list.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      map.set(mode, list);
    }
    return map;
  }, [sessions]);

  const usedModeNames = useMemo(
    () => Array.from(sessionsByMode.keys()),
    [sessionsByMode],
  );
  const unusedModes = useMemo(
    () => modes.filter((m) => !sessionsByMode.has(m.name)),
    [modes, sessionsByMode],
  );

  const modeDisplayName = (modeName: string): string => {
    const m = modes.find((x) => x.name === modeName);
    return m?.displayName ?? modeName;
  };

  // Project identity falls back gracefully — manifest > store context > path.
  const displayName =
    project?.displayName ?? ctx?.projectName ?? basename(projectRoot);
  const description = project?.description ?? ctx?.projectDescription;
  const shortPath = homeDir ? shortenPath(projectRoot, homeDir) : projectRoot;

  const coverEntry: ProjectCoverEntry = {
    id: projectRoot,
    displayName,
    sessionCount: sessions.length,
    modeBreakdown: usedModeNames,
    coverImageUrl,
  };

  // Close popovers when clicking outside the "another mode" trigger area.
  const otherModeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!otherModeOpen) return;
    const handler = (e: MouseEvent) => {
      if (otherModeRef.current && !otherModeRef.current.contains(e.target as Node)) {
        setOtherModeOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [otherModeOpen]);

  // Esc cancels the inline archive confirm. The panel itself already closes
  // on Esc via ProjectChip's outer handler, but the confirm row is a more
  // local intent — bail out of just that row first if it's open.
  useEffect(() => {
    if (!archiveConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setArchiveConfirm(false);
        setArchiveError(null);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [archiveConfirm]);

  const archive = async () => {
    if (archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/projects/${encodeURIComponent(projectRoot)}/archive`,
        { method: "POST" },
      );
      if (res.ok) {
        // Project is now hidden from the default launcher list. Drop the
        // user back at the launcher; their next move is to either pick a
        // different project or reveal the Archived bucket.
        window.location.href = "/";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setArchiveError(data.error ?? `Archive failed (${res.status})`);
    } catch (err) {
      console.error("[ProjectPanel] archive failed", err);
      setArchiveError(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Project panel"
      className="absolute top-full left-0 mt-2 w-[640px] max-h-[70vh] overflow-auto bg-cc-surface border border-cc-border rounded-2xl shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)] backdrop-blur-xl z-[100] [animation:launcherFadeIn_180ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      {/* Section A — Identity */}
      <div className="p-5 flex items-start gap-4">
        <div className="w-24 h-24 rounded-xl overflow-hidden aspect-square shrink-0 bg-black/20">
          <CoverImage project={coverEntry} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <h2 className="font-display text-2xl text-cc-fg leading-tight truncate">
            {displayName}
          </h2>
          {description ? (
            <p className="text-sm text-cc-muted/80 line-clamp-2">{description}</p>
          ) : null}
          <p
            className="text-[11px] font-mono-code text-cc-muted/50 truncate"
            title={projectRoot}
          >
            {shortPath}
          </p>
        </div>
      </div>

      {/* Section B — Sessions */}
      <div className="p-5 border-t border-cc-border/50">
        {loading ? (
          <div className="text-cc-muted/60 text-sm">Loading sessions…</div>
        ) : usedModeNames.length === 0 ? (
          <div className="text-cc-muted/60 text-sm">
            No sessions yet — start one below.
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            {usedModeNames.map((mode) => {
              const list = sessionsByMode.get(mode) ?? [];
              return (
                <div key={mode} className="flex flex-col">
                  <h3 className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium pb-2 border-b border-cc-border/40">
                    {modeDisplayName(mode)}
                  </h3>
                  <div className="flex flex-col gap-0.5 mt-2">
                    {list.map((s) => {
                      const isActive = s.sessionId === activeSessionId;
                      const idLabel = s.sessionId.slice(0, 8);
                      const hasName =
                        typeof s.displayName === "string" && s.displayName.length > 0;
                      return (
                        <button
                          key={s.sessionId}
                          type="button"
                          aria-current={isActive ? "page" : undefined}
                          disabled={launching}
                          onClick={() => launch(mode, s.sessionId)}
                          className={`flex items-center gap-2 w-full px-2 py-2 rounded-md text-left transition-colors disabled:opacity-50 ${
                            isActive
                              ? "bg-cc-primary/10 ring-1 ring-cc-primary/30"
                              : "hover:bg-cc-hover/50"
                          }`}
                        >
                          <span className="w-6 h-6 shrink-0 rounded-full bg-cc-primary/10 text-cc-primary text-[10px] font-medium flex items-center justify-center">
                            {modeDisplayName(mode).charAt(0).toUpperCase()}
                          </span>
                          <span className="flex-1 min-w-0 flex flex-col">
                            {hasName ? (
                              <span
                                className="text-sm text-cc-fg truncate"
                                title={s.displayName}
                              >
                                {s.displayName}
                              </span>
                            ) : (
                              <span
                                className="text-sm text-cc-fg truncate font-mono-code"
                                title={s.sessionId}
                              >
                                {idLabel}
                              </span>
                            )}
                            {s.lastAccessed ? (
                              <span className="text-[11px] text-cc-muted/50">
                                {timeAgo(s.lastAccessed)}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      disabled={launching}
                      onClick={() => launch(mode)}
                      className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-left border border-dashed border-cc-border/50 hover:border-cc-primary/40 text-cc-muted hover:text-cc-primary transition-colors disabled:opacity-50 mt-1"
                    >
                      <span className="w-6 h-6 shrink-0 flex items-center justify-center text-cc-muted/60">
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="w-3 h-3"
                        >
                          <path d="M8 3v10M3 8h10" />
                        </svg>
                      </span>
                      <span className="text-xs">
                        New {modeDisplayName(mode)} session
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Transient launch error — surfaces failures from /api/launch
            (mismatched backend, spawn timeout, etc.) inline rather than only
            via console. Cleared on the next launch attempt. Mirrors the
            shareError pattern in TopBar's ShareDropdown. */}
        {launchError ? (
          <div className="text-cc-error/80 text-xs mt-3" role="alert">
            {launchError}
          </div>
        ) : null}

        {/* Long-tail trigger — modes not yet present in the project. Render
            even when there are no sessions, so the empty state is actionable. */}
        {!loading && unusedModes.length > 0 ? (
          <div className="relative mt-4" ref={otherModeRef}>
            <button
              type="button"
              onClick={() => setOtherModeOpen((v) => !v)}
              className="text-xs text-cc-muted hover:text-cc-primary transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Start in another mode</span>
              <span className="text-[10px] leading-none">→</span>
            </button>
            {otherModeOpen ? (
              <div className="absolute left-0 mt-2 w-56 bg-cc-bg border border-cc-border rounded-lg shadow-xl z-10 max-h-64 overflow-auto py-1">
                {unusedModes.map((m) => (
                  <button
                    key={m.name}
                    type="button"
                    disabled={launching}
                    onClick={() => {
                      setOtherModeOpen(false);
                      void launch(m.name);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-cc-fg hover:bg-cc-hover/50 transition-colors disabled:opacity-50"
                  >
                    {m.displayName ?? m.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Section C — Actions (right-aligned, asymmetric vs the left-aligned
          identity + sessions above per design principles). The row morphs
          in place between the default actions and an inline archive confirm;
          no modal, no card-in-card. The danger of Archive is conveyed by
          the explicit "Confirm" verb rather than by visual loudness. */}
      <div className="p-5 border-t border-cc-border/50 flex flex-col items-end gap-2">
        <div className="flex justify-end items-center gap-3 w-full">
          {archiveConfirm ? (
            <div className="flex items-center gap-3 [animation:overlayFadeIn_140ms_cubic-bezier(0.16,1,0.3,1)]">
              <span className="text-xs text-cc-muted">
                Archive this project?
              </span>
              <button
                type="button"
                onClick={() => {
                  setArchiveConfirm(false);
                  setArchiveError(null);
                }}
                className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiving}
                onClick={() => void archive()}
                className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer disabled:opacity-50"
              >
                {archiving ? "Archiving…" : "Confirm"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 [animation:overlayFadeIn_140ms_cubic-bezier(0.16,1,0.3,1)]">
              <button
                type="button"
                disabled={launching}
                onClick={() => void launch("evolve")}
                className="text-xs text-cc-muted hover:text-cc-fg transition-colors disabled:opacity-50 cursor-pointer"
              >
                Evolve Preferences
              </button>
              <span className="text-cc-muted/30 text-xs leading-none" aria-hidden>
                ·
              </span>
              <button
                type="button"
                onClick={() => {
                  setArchiveError(null);
                  setArchiveConfirm(true);
                }}
                className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              >
                Archive
              </button>
            </div>
          )}
        </div>
        {archiveError ? (
          <div className="text-cc-error/80 text-xs" role="alert">
            {archiveError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
