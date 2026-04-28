/**
 * ProjectPanel — anchored "compact launcher pad" for the Project chip.
 *
 * 960px wide, max-height 80vh. Three zones, separated only by 1px dividers
 * (no nested cards):
 *
 *   1. Identity bar — cover + displayName + description + path
 *   2. Working area — split LEFT (sessions, 60%) / RIGHT (mode picker, 40%)
 *      via a `gap-px bg-cc-border/50` rail (no border on either pane)
 *   3. Actions bar  — Evolve Preferences · Archive (right-aligned)
 *
 * The left pane is a flat session list sorted by lastAccessed desc — no
 * per-mode columns. Each row is `[thumbnail-or-icon] [title] [preview]
 * [time]`. The right pane is a 2-column grid of mode tiles; clicking one
 * launches a fresh session in that mode. Modes that already have sessions
 * in this project show a subtle "· N sessions" suffix.
 *
 * The earlier "Start in another mode →" popover is gone — its job is now
 * done by the always-visible right pane, which removes a click and gives
 * the eye something to scan when the project is empty.
 *
 * Currently-active session (matches `useStore(s => s.session?.session_id)`)
 * gets a subtle background tint + ring-1, never a side stripe.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";
import { basename, shortenPath } from "../utils/string.js";
import { timeAgo } from "../utils/timeAgo.js";
import { CoverImage, type ProjectCoverEntry } from "./ProjectCover.js";
import { ModeIcon } from "./ModeIcon.js";

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
  /** Per-session viewer thumbnail URL (only when thumbnail.png exists on disk). */
  thumbnailUrl?: string;
  /** One-line preview from history.json's first user message. */
  preview?: string;
}

interface ModeInfo {
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
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
            merged.push({
              name: m.name,
              displayName: m.displayName,
              description: m.description,
              icon: m.icon,
            });
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

  // Flat session list, lastAccessed desc — distinguishing three sessions of
  // the same mode now relies on thumbnail + preview, not on column grouping.
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)),
    [sessions],
  );

  // Per-mode session count, for the right-pane "· N sessions" suffix.
  const sessionCountByMode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.mode, (counts.get(s.mode) ?? 0) + 1);
    return counts;
  }, [sessions]);

  // Mode lookup helpers — used everywhere, name → displayName / icon / desc.
  const modeByName = useMemo(() => {
    const map = new Map<string, ModeInfo>();
    for (const m of modes) map.set(m.name, m);
    return map;
  }, [modes]);

  const modeDisplayName = (modeName: string): string => {
    return modeByName.get(modeName)?.displayName ?? modeName;
  };

  // "Current mode" for the bottom new-session shortcut = mode of the most
  // recent session, falls back to the first available mode if there are none.
  const currentMode = sortedSessions[0]?.mode;

  // Project identity falls back gracefully — manifest > store context > path.
  const displayName =
    project?.displayName ?? ctx?.projectName ?? basename(projectRoot);
  const description = project?.description ?? ctx?.projectDescription;
  const shortPath = homeDir ? shortenPath(projectRoot, homeDir) : projectRoot;

  const coverEntry: ProjectCoverEntry = {
    id: projectRoot,
    displayName,
    sessionCount: sessions.length,
    modeBreakdown: Array.from(sessionCountByMode.keys()),
    coverImageUrl,
  };

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

  const sectionHeading =
    "text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium mb-3";

  return (
    <div
      role="dialog"
      aria-label="Project panel"
      className="absolute top-full left-0 mt-2 w-[960px] max-h-[80vh] overflow-auto bg-cc-surface border border-cc-border rounded-2xl shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)] backdrop-blur-xl z-[100] [animation:launcherFadeIn_180ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      {/* Section A — Identity */}
      <div className="p-6 flex items-start gap-5">
        <div className="w-24 h-24 rounded-xl overflow-hidden aspect-square shrink-0 bg-black/20">
          <CoverImage project={coverEntry} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <h2 className="font-display text-2xl text-cc-fg leading-tight truncate">
            {displayName}
          </h2>
          {description ? (
            <p className="text-sm text-cc-muted/80 line-clamp-2">{description}</p>
          ) : null}
          <p
            className="text-[11px] font-mono-code text-cc-muted/50 truncate mt-0.5"
            title={projectRoot}
          >
            {shortPath}
          </p>
        </div>
      </div>

      {/* Section B — Working area: sessions (left) + mode picker (right) */}
      <div className="grid grid-cols-[3fr_2fr] gap-px bg-cc-border/50 border-t border-cc-border/50">
        {/* LEFT — Sessions */}
        <div className="bg-cc-surface p-5 min-h-[200px]">
          <h3 className={sectionHeading}>Recent sessions</h3>
          {loading ? (
            <div className="text-cc-muted/60 text-sm">Loading sessions…</div>
          ) : sortedSessions.length === 0 ? (
            <div className="text-cc-muted/60 text-sm">
              No sessions yet — pick a mode on the right →
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {sortedSessions.map((s) => {
                const isActive = s.sessionId === activeSessionId;
                const hasName =
                  typeof s.displayName === "string" && s.displayName.length > 0;
                // Title fallback — never the 8-char hex as primary text.
                const title = hasName
                  ? s.displayName!
                  : `${modeDisplayName(s.mode)} session`;
                const modeMeta = modeByName.get(s.mode);
                const fullThumbUrl = s.thumbnailUrl ? `${apiBase}${s.thumbnailUrl}` : undefined;
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    disabled={launching}
                    onClick={() => launch(s.mode, s.sessionId)}
                    className={`flex items-start gap-3 w-full px-2.5 py-2 rounded-md text-left transition-colors disabled:opacity-50 ${
                      isActive
                        ? "bg-cc-primary/10 ring-1 ring-cc-primary/30"
                        : "hover:bg-cc-hover/50"
                    }`}
                  >
                    {/* Visual: thumbnail if we have one, else mode icon
                        framed in a subtle primary tile. Either way the rail
                        is 40×40 so titles stay vertically aligned. */}
                    {fullThumbUrl ? (
                      <span className="w-10 h-10 shrink-0 rounded-md overflow-hidden bg-black/20">
                        <img
                          src={fullThumbUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </span>
                    ) : (
                      <span className="w-10 h-10 shrink-0 rounded-md bg-cc-primary/8 text-cc-primary flex items-center justify-center">
                        <ModeIcon
                          svg={modeMeta?.icon}
                          className="w-5 h-5 text-cc-primary"
                        />
                      </span>
                    )}
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span
                        className="text-sm text-cc-fg truncate leading-tight"
                        title={title}
                      >
                        {title}
                      </span>
                      {s.preview ? (
                        <span className="text-xs text-cc-muted/60 line-clamp-1 leading-snug">
                          {s.preview}
                        </span>
                      ) : null}
                      {s.lastAccessed ? (
                        <span className="text-[11px] text-cc-muted/40 leading-none mt-0.5">
                          {timeAgo(s.lastAccessed)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
              {/* Single "+ new session in current mode" affordance — replaces
                  the per-mode footer rows from the old layout. The right pane
                  carries the long-tail "any other mode" job. */}
              {currentMode ? (
                <button
                  type="button"
                  disabled={launching}
                  onClick={() => launch(currentMode)}
                  className="flex items-center gap-3 w-full px-2.5 py-2 rounded-md text-left border border-dashed border-cc-border/50 hover:border-cc-primary/40 text-cc-muted hover:text-cc-primary transition-colors disabled:opacity-50 mt-2"
                >
                  <span className="w-10 h-10 shrink-0 flex items-center justify-center text-cc-muted/60">
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="w-3.5 h-3.5"
                    >
                      <path d="M8 3v10M3 8h10" />
                    </svg>
                  </span>
                  <span className="text-xs">
                    New {modeDisplayName(currentMode)} session
                  </span>
                </button>
              ) : null}
            </div>
          )}
          {/* Transient launch error — surfaces failures from /api/launch
              (mismatched backend, spawn timeout, etc.) inline. */}
          {launchError ? (
            <div className="text-cc-error/80 text-xs mt-3" role="alert">
              {launchError}
            </div>
          ) : null}
        </div>

        {/* RIGHT — Mode picker */}
        <div className="bg-cc-surface p-5">
          <h3 className={sectionHeading}>Start in any mode</h3>
          {modes.length === 0 ? (
            <div className="text-cc-muted/60 text-sm">Loading modes…</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {modes.map((m) => {
                const count = sessionCountByMode.get(m.name) ?? 0;
                return (
                  <button
                    key={m.name}
                    type="button"
                    disabled={launching}
                    onClick={() => launch(m.name)}
                    className="bg-cc-bg/40 border border-cc-border rounded-md p-3 hover:border-cc-primary/40 hover:bg-cc-primary/5 transition-colors cursor-pointer disabled:opacity-50 text-left flex flex-col gap-1.5 min-h-[88px]"
                  >
                    <div className="flex items-center gap-2">
                      <ModeIcon
                        svg={m.icon}
                        className="w-5 h-5 text-cc-primary shrink-0"
                      />
                      <span className="text-sm text-cc-fg font-medium truncate">
                        {m.displayName ?? m.name}
                      </span>
                      {count > 0 ? (
                        <span className="text-[10px] text-cc-muted/40 ml-auto shrink-0">
                          · {count}
                        </span>
                      ) : null}
                    </div>
                    {m.description ? (
                      <p className="text-[11px] text-cc-muted/70 line-clamp-2 leading-snug">
                        {m.description}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
