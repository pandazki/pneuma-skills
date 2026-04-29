/**
 * ProjectOverview — read-only visualization of the project's
 * Pneuma-managed state. Replaces the EditorPanel's "Select a file"
 * empty state for project sessions.
 *
 * Surfaces:
 *  - Cover thumbnail (`<root>/.pneuma/cover.png`) + display name +
 *    description.
 *  - Sessions roll-up: total count + per-mode breakdown bar (top 6
 *    modes; the long tail collapses into "+N more").
 *  - Preferences indicators: which `mode-{name}.md` files exist (and
 *    `profile.md`), with last-modified relative time. Body content is
 *    intentionally not shown — preferences are agent-managed; the
 *    web UI only reflects existence + recency.
 *
 * Editing is intentionally NOT exposed here. `project.json` edits go
 * through the launcher's edit dialog; preferences are written by the
 * agent. The "Open in editor" affordance in the Files header is the
 * escape hatch for users who want to read/inspect raw files.
 */
import { useEffect, useState } from "react";
import { getApiBase } from "../utils/api.js";
import { timeAgo } from "../utils/timeAgo.js";

interface ProjectOverviewProps {
  projectRoot: string;
}

interface ProjectInfo {
  name: string;
  displayName: string;
  description?: string;
  root: string;
}

interface SessionRef {
  sessionId: string;
  mode: string;
  displayName?: string;
  lastAccessed?: number;
}

interface ModeInfo {
  name: string;
  displayName?: string;
  icon?: string;
}

interface PreferenceFile {
  name: string;
  /** "profile" or `mode-{name}` (without .md extension) */
  kind: string;
  modeLabel?: string;
  mtime: number;
}

interface OverviewData {
  project: ProjectInfo | null;
  sessions: SessionRef[];
  modes: Map<string, ModeInfo>;
  preferences: PreferenceFile[];
  coverImageUrl: string | null;
}

const TOP_MODE_COUNT = 6;

export default function ProjectOverview({ projectRoot }: ProjectOverviewProps) {
  const apiBase = getApiBase();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [pRes, mRes, listRes, prefRes] = await Promise.all([
          fetch(`${apiBase}/api/projects/${encodeURIComponent(projectRoot)}/sessions`),
          fetch(`${apiBase}/api/registry`),
          fetch(`${apiBase}/api/projects`).catch(() => null),
          fetch(`${apiBase}/api/projects/${encodeURIComponent(projectRoot)}/preferences`).catch(
            () => null,
          ),
        ]);
        if (cancelled) return;

        const next: OverviewData = {
          project: null,
          sessions: [],
          modes: new Map(),
          preferences: [],
          coverImageUrl: null,
        };

        if (pRes.ok) {
          const body = (await pRes.json()) as {
            project: ProjectInfo;
            sessions: SessionRef[];
          };
          next.project = body.project;
          next.sessions = body.sessions ?? [];
        }
        if (mRes.ok) {
          const body = (await mRes.json()) as { modes?: ModeInfo[] };
          for (const m of body.modes ?? []) next.modes.set(m.name, m);
        }
        if (listRes && listRes.ok) {
          const body = (await listRes.json()) as {
            projects?: Array<{ id?: string; root?: string; coverImageUrl?: string }>;
          };
          const entry = body.projects?.find(
            (p) => (p.id ?? p.root) === projectRoot,
          );
          if (entry?.coverImageUrl) next.coverImageUrl = entry.coverImageUrl;
        }
        if (prefRes && prefRes.ok) {
          const body = (await prefRes.json()) as { preferences?: PreferenceFile[] };
          next.preferences = body.preferences ?? [];
        }

        if (!cancelled) {
          setData(next);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, projectRoot]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-full text-cc-muted/40 text-sm">
        Loading project overview…
      </div>
    );
  }

  const project = data.project;
  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-cc-muted/40 text-sm">
        Couldn't load project info.
      </div>
    );
  }

  // Aggregate sessions by mode, sorted by frequency desc.
  const byMode = new Map<string, number>();
  for (const s of data.sessions) byMode.set(s.mode, (byMode.get(s.mode) ?? 0) + 1);
  const modeRows = [...byMode.entries()].sort((a, b) => b[1] - a[1]);
  const visibleModes = modeRows.slice(0, TOP_MODE_COUNT);
  const overflowCount = Math.max(0, modeRows.length - TOP_MODE_COUNT);
  const totalSessions = data.sessions.length;
  const maxModeCount = Math.max(1, ...modeRows.map(([, n]) => n));

  // Most recent session — used as a single "last touched" line.
  const mostRecent = [...data.sessions].sort(
    (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  )[0];

  return (
    <div className="h-full overflow-y-auto px-8 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-10">
        {/* Identity — cover + name + description. */}
        <div className="flex items-start gap-6">
          <div className="w-24 h-24 rounded-xl overflow-hidden shrink-0 bg-cc-bg/40 border border-cc-border/60 flex items-center justify-center">
            {data.coverImageUrl ? (
              <img
                src={`${apiBase}${data.coverImageUrl}`}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
            ) : (
              <span className="font-display text-4xl text-cc-primary/60">
                {project.displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-2 pt-1">
            <h2 className="font-display text-2xl text-cc-fg leading-tight truncate">
              {project.displayName}
            </h2>
            {project.description ? (
              <p className="text-sm text-cc-muted/80 leading-relaxed">
                {project.description}
              </p>
            ) : (
              <p className="text-sm text-cc-muted/40 italic">
                No description yet — ask the agent to refine the project description.
              </p>
            )}
            <p className="text-[11px] font-mono-code text-cc-muted/40 truncate mt-1">
              {project.root}
            </p>
          </div>
        </div>

        {/* Sessions — roll-up + per-mode bar. */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium">
              Sessions
            </h3>
            <div className="text-xs text-cc-muted">
              {totalSessions === 0
                ? "none yet"
                : `${totalSessions} ${totalSessions === 1 ? "session" : "sessions"} · ${modeRows.length} ${modeRows.length === 1 ? "mode" : "modes"}`}
            </div>
          </div>
          {totalSessions === 0 ? (
            <p className="text-sm text-cc-muted/50">
              Use the Project chip's mode picker to start your first session.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {visibleModes.map(([modeName, count]) => {
                const mode = data.modes.get(modeName);
                const label = mode?.displayName ?? modeName;
                const ratio = count / maxModeCount;
                return (
                  <div key={modeName} className="flex items-center gap-3 text-xs">
                    <span className="w-24 shrink-0 text-cc-fg/80 truncate">{label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-cc-bg/60 border border-cc-border/40 overflow-hidden">
                      <div
                        className="h-full bg-cc-primary/60 rounded-full transition-[width] duration-300"
                        style={{ width: `${Math.max(ratio * 100, 4)}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-cc-muted">{count}</span>
                  </div>
                );
              })}
              {overflowCount > 0 ? (
                <div className="text-[11px] text-cc-muted/60 mt-1 pl-[108px]">
                  +{overflowCount} more {overflowCount === 1 ? "mode" : "modes"}
                </div>
              ) : null}
              {mostRecent?.lastAccessed ? (
                <div className="text-[11px] text-cc-muted/50 mt-2">
                  Last touched: {timeAgo(mostRecent.lastAccessed)} ·{" "}
                  {data.modes.get(mostRecent.mode)?.displayName ?? mostRecent.mode}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Preferences — existence + recency only, no body. */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium">
              Project preferences
            </h3>
            <div className="text-xs text-cc-muted/50">
              {data.preferences.length === 0
                ? "none yet"
                : `${data.preferences.length} ${data.preferences.length === 1 ? "file" : "files"}`}
            </div>
          </div>
          {data.preferences.length === 0 ? (
            <p className="text-sm text-cc-muted/50 leading-relaxed">
              No project-scoped preferences yet. They appear here automatically as the
              agent records what's specific to this project (cross-mode profile, per-mode
              tweaks). Personal preferences live separately in <span className="font-mono-code text-cc-muted/70">~/.pneuma/preferences/</span>.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.preferences.map((p) => {
                const isProfile = p.kind === "profile";
                const label = isProfile
                  ? "Cross-mode profile"
                  : `${p.modeLabel ?? p.kind.replace(/^mode-/, "")} (per-mode)`;
                return (
                  <div
                    key={p.name}
                    className="flex items-center gap-3 text-xs px-3 py-1.5 rounded-md border border-cc-border/40 bg-cc-bg/20"
                  >
                    <span className="text-cc-fg/80 flex-1 truncate">{label}</span>
                    <span className="text-cc-muted/60 font-mono-code text-[10px]">
                      {p.name}
                    </span>
                    <span className="text-cc-muted/50 text-[11px] w-20 text-right shrink-0">
                      {timeAgo(p.mtime)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
