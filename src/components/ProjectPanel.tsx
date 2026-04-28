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
import { basename, escapeXml, shortenPath } from "../utils/string.js";
import { timeAgo } from "../utils/timeAgo.js";
import { sendUserMessage } from "../ws.js";
import { useAnimatedMount } from "../utils/useAnimatedMount.js";
import { CoverImage, type ProjectCoverEntry } from "./ProjectCover.js";
import { ModeIcon } from "./ModeIcon.js";
import { InitParamForm, type InitParamWithAutoFill } from "./InitParamForm.js";

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
  /** Called when the panel should close itself (e.g. after firing a Smart
   *  Handoff so the user immediately sees the chat + HandoffCard). Optional
   *  — when omitted, the panel just stays open and the parent's existing
   *  outside-click / Esc handler retains responsibility for closing. */
  onClose?: () => void;
}

export default function ProjectPanel({ projectRoot, onClose }: ProjectPanelProps) {
  const apiBase = getApiBase();
  const activeSessionId = useStore((s) => s.session?.session_id ?? null);
  const ctx = useStore((s) => s.projectContext);
  // Smart Handoff requires (1) a project session (projectContext set),
  // (2) a live chat session_id to dispatch the tag, and (3) a loaded mode
  // — i.e. NOT the empty shell. We read all three so the toggle only
  // appears when the source agent actually exists.
  const sessionMode = useStore((s) => s.modeManifest?.name ?? null);

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessions, setSessions] = useState<SessionRef[]>([]);
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [coverImageUrl, setCoverImageUrl] = useState<string | undefined>(undefined);
  const [homeDir, setHomeDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  // Which row / mode is currently being launched, for inline "Starting…"
  // feedback. The child pneuma boot takes 5–10s before the URL comes back;
  // without a per-row indicator the panel just looks frozen during that
  // window and users assume their click did nothing.
  const [launchingId, setLaunchingId] = useState<string | null>(null);
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

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Launch sheet — when set, the right pane swaps from the mode-tile grid
  // to a sheet that fetches the mode's init params, optionally reveals a
  // Smart Handoff toggle, and only fires `/api/launch` (or dispatches the
  // request-handoff tag) on Confirm. `null` means "show the grid".
  const [launchTarget, setLaunchTarget] = useState<ModeInfo | null>(null);
  const [sheetParams, setSheetParams] = useState<InitParamWithAutoFill[]>([]);
  const [sheetValues, setSheetValues] = useState<Record<string, string | number>>({});
  const [sheetPreparing, setSheetPreparing] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [smartHandoff, setSmartHandoff] = useState(false);
  const [handoffIntent, setHandoffIntent] = useState("");

  const deleteSession = async (sessionId: string) => {
    if (deleting) return;
    setDeleting(true);
    setLaunchError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/projects/${encodeURIComponent(projectRoot)}/sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLaunchError(data.error ?? `Delete failed (${res.status})`);
        return;
      }
      // Drop the session locally so the row disappears immediately. The
      // panel's effect would refetch on next mount, but inline removal
      // avoids the spinner flash.
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      setConfirmDeleteId(null);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  // Single launch helper. The previous `launchSession` and `evolveProject`
  // were 95% identical (only `specifier` differed); keep one path so error
  // surfacing and disable-while-launching gating can't drift. `initParams`
  // is forwarded to `/api/launch` so the launch-sheet form values reach the
  // spawned mode (used by the right-pane mode tile flow; the session-row
  // path leaves it undefined and the server falls back to the persisted
  // `config.json`).
  //
  // When the active source has a session id (we're inside a project session,
  // not the empty shell) AND we're switching to a different existing session
  // OR a different mode, attach `from_session_id` / `from_mode` /
  // `from_display_name` so the spawned child can dispatch
  // `<pneuma:env reason="switched" from_session=… …/>`. The child then knows
  // the user came from a sibling, not from a fresh "+ New session" tile.
  const launch = async (
    specifier: string,
    sessionId?: string,
    initParams?: Record<string, string | number>,
  ) => {
    if (launching) return;
    setLaunching(true);
    setLaunchingId(sessionId ?? `new:${specifier}`);
    setLaunchError(null);
    try {
      // Source-context for `<pneuma:env reason="switched">` — only attached
      // when we're spawning *from* a live session (active id present). The
      // mode/displayName come from the store (viewer + project context); the
      // child server just stamps them into the env tag attributes.
      const fromContext: {
        from_session_id?: string;
        from_mode?: string;
        from_display_name?: string;
      } = {};
      if (activeSessionId) {
        fromContext.from_session_id = activeSessionId;
        if (sessionMode) fromContext.from_mode = sessionMode;
        // Display name: the active session's row in the panel — we don't
        // expose it directly from store, so derive from the sessions list.
        const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
        if (activeSession) {
          fromContext.from_display_name =
            activeSession.displayName ||
            `${activeSession.mode} session`;
        }
      }

      const res = await fetch(`${apiBase}/api/launch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          specifier,
          workspace: projectRoot,
          project: projectRoot,
          ...(sessionId ? { sessionId } : {}),
          ...(initParams && Object.keys(initParams).length > 0
            ? { initParams }
            : {}),
          ...fromContext,
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
      setLaunchingId(null);
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

  // Launch sheet drawer animation: stays mounted briefly during exit so the
  // slide-out animation finishes before unmounting.
  const { mounted: drawerMounted, closing: drawerClosing } = useAnimatedMount(
    !!launchTarget,
    180,
  );

  // Mode-picker truncation. Shows the user's most-relevant 8 modes by
  // default — used modes in this project first (sorted by their most-recent
  // session), then builtins in a sensible default order. "Show all" reveals
  // the rest with internal scroll. Stops the right pane from running away
  // as more local / published modes get installed.
  const [showAllModes, setShowAllModes] = useState(false);
  const DEFAULT_VISIBLE_MODE_COUNT = 8;
  const BUILTIN_PRIORITY = useMemo(
    () => ["webcraft", "doc", "slide", "illustrate", "draw", "kami", "diagram", "remotion"],
    [],
  );
  const orderedModes = useMemo(() => {
    if (modes.length === 0) return [] as ModeInfo[];
    const usedModeRecency = new Map<string, number>();
    for (const s of sessions) {
      const prev = usedModeRecency.get(s.mode) ?? 0;
      usedModeRecency.set(s.mode, Math.max(prev, s.lastAccessed ?? 0));
    }
    const used = modes
      .filter((m) => usedModeRecency.has(m.name))
      .sort(
        (a, b) =>
          (usedModeRecency.get(b.name) ?? 0) - (usedModeRecency.get(a.name) ?? 0),
      );
    const priority = (n: string) => {
      const idx = BUILTIN_PRIORITY.indexOf(n);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    const unused = modes
      .filter((m) => !usedModeRecency.has(m.name))
      .sort((a, b) => priority(a.name) - priority(b.name));
    return [...used, ...unused];
  }, [modes, sessions, BUILTIN_PRIORITY]);
  const visibleModes = showAllModes
    ? orderedModes
    : orderedModes.slice(0, DEFAULT_VISIBLE_MODE_COUNT);
  const hiddenCount = orderedModes.length - visibleModes.length;

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

  // Esc inside the launch sheet returns to the mode grid (not closing the
  // panel). `capture: true` + stopPropagation so the chip's outer
  // close-on-Esc never fires while the sheet is open. At grid level the
  // outer handler still owns Esc-to-close.
  useEffect(() => {
    if (!launchTarget) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setLaunchTarget(null);
        setSheetError(null);
        setSmartHandoff(false);
        setHandoffIntent("");
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [launchTarget]);

  // Fetch init params when a target is picked. Mirrors Launcher's
  // `/api/launch/prepare` path so the same auto-filled-from-stored-keys
  // affordance carries over for free. Failures land in `sheetError`,
  // which renders inline; the sheet still lets the user Confirm with
  // an empty param set (the server will fall back to defaults / errors).
  useEffect(() => {
    if (!launchTarget) {
      setSheetParams([]);
      setSheetValues({});
      setSheetError(null);
      return;
    }
    let cancelled = false;
    setSheetPreparing(true);
    setSheetError(null);
    setSheetParams([]);
    setSheetValues({});
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/launch/prepare`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ specifier: launchTarget.name, workspace: projectRoot }),
        });
        const data = (await res.json()) as {
          initParams?: InitParamWithAutoFill[];
          error?: string;
        };
        if (cancelled) return;
        if (data.error) {
          setSheetError(data.error);
        } else if (data.initParams?.length) {
          setSheetParams(data.initParams);
          const defaults: Record<string, string | number> = {};
          for (const p of data.initParams) defaults[p.name] = p.defaultValue;
          setSheetValues(defaults);
        }
      } catch (err) {
        if (!cancelled) {
          setSheetError(err instanceof Error ? err.message : "Failed to prepare launch");
        }
      } finally {
        if (!cancelled) setSheetPreparing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [launchTarget, projectRoot, apiBase]);

  // Smart Handoff is only meaningful when there's a current agent to hand
  // off FROM — that means a project session AND a connected backend AND a
  // loaded mode. Empty shell (no `session_id`) suppresses the toggle.
  const canHandoff =
    !!ctx && !!activeSessionId && !!sessionMode && launchTarget?.name !== sessionMode;

  const confirmLaunch = () => {
    if (!launchTarget) return;
    if (smartHandoff && canHandoff) {
      const flat = handoffIntent.replace(/\s+/g, " ").trim();
      if (!flat) {
        setSheetError("Tell the new session what to do");
        return;
      }
      const tag = `<pneuma:request-handoff target="${escapeXml(launchTarget.name)}" target_session="auto" intent="${escapeXml(flat)}" />`;
      void sendUserMessage(tag);
      // Reset sheet + close the panel so the user sees the chat where the
      // tag now lives, plus the eventual HandoffCard once the source agent
      // writes the handoff file.
      setLaunchTarget(null);
      setSheetError(null);
      setSmartHandoff(false);
      setHandoffIntent("");
      onClose?.();
      return;
    }
    void launch(launchTarget.name, undefined, sheetValues);
  };

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
      className="absolute top-full left-0 mt-2 w-[960px] max-h-[80vh] bg-cc-surface border border-cc-border rounded-2xl shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)] backdrop-blur-xl z-[100] overflow-hidden [animation:launcherFadeIn_180ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      {/* Scrollable content layer — sits below the launch-sheet drawer in the
          stacking order. The outer panel uses overflow-hidden so the drawer
          can slide in from offscreen right; this inner layer carries the
          actual scroll for tall content. */}
      <div className="relative max-h-[80vh] overflow-y-auto">
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
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
              <div className="w-10 h-10 rounded-full bg-cc-primary/10 text-cc-primary/70 flex items-center justify-center mb-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </div>
              <p className="text-sm text-cc-fg/80 mb-1">No sessions yet</p>
              <p className="text-xs text-cc-muted/60 max-w-[220px] leading-relaxed">
                Pick a mode on the right to start your first session.
              </p>
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
                const inConfirm = confirmDeleteId === s.sessionId;
                return (
                  <div
                    key={s.sessionId}
                    className={`group relative flex items-stretch rounded-md transition-colors ${
                      isActive
                        ? "bg-cc-primary/10 ring-1 ring-cc-primary/30"
                        : "hover:bg-cc-hover/50"
                    }`}
                  >
                    <button
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      disabled={launching || deleting}
                      onClick={() => launch(s.mode, s.sessionId)}
                      className="flex items-start gap-3 flex-1 min-w-0 px-2.5 py-2 text-left disabled:opacity-50 cursor-pointer"
                    >
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
                        {launchingId === s.sessionId ? (
                          <span className="text-xs text-cc-primary leading-snug inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 border-[1.5px] border-cc-primary/30 border-t-cc-primary rounded-full animate-spin shrink-0" />
                            Starting session…
                          </span>
                        ) : s.preview ? (
                          <span className="text-xs text-cc-muted/60 line-clamp-1 leading-snug">
                            {s.preview}
                          </span>
                        ) : null}
                        {s.lastAccessed && launchingId !== s.sessionId ? (
                          <span className="text-[11px] text-cc-muted/40 leading-none mt-0.5">
                            {timeAgo(s.lastAccessed)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {/* Delete affordance — hidden by default, revealed on hover.
                        Suppressed for the active session (you can't delete the
                        session you're inside of) and during a confirm flow on a
                        sibling row, so the user's eye stays on one decision. */}
                    {!isActive ? (
                      <div
                        className={`flex items-center pr-2 transition-opacity ${
                          inConfirm ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                        }`}
                      >
                        {inConfirm ? (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-cc-bg/60 border border-cc-border/40">
                            <button
                              type="button"
                              disabled={deleting}
                              onClick={() => void deleteSession(s.sessionId)}
                              className="text-[10px] font-medium text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded transition-colors cursor-pointer disabled:opacity-50"
                            >
                              Delete
                            </button>
                            <span className="w-px h-3 bg-cc-border/40" aria-hidden />
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[10px] text-cc-muted hover:text-cc-fg px-1 py-0.5 rounded transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(s.sessionId)}
                            title="Delete session"
                            className="p-1.5 rounded-md text-cc-muted/40 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {/* No "+ new session in current mode" footer — the right-pane
                  mode picker already covers "start a new X session" for any
                  mode (clicking the same mode the user is currently in is
                  fine; the launch sheet handles same-mode siblings). The
                  footer was redundant. */}
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

        {/* RIGHT — Mode picker → swaps to launch sheet when a tile is picked. */}
        <div className="bg-cc-surface p-5">
              <h3 className={sectionHeading}>Start in any mode</h3>
              {modes.length === 0 ? (
                <div className="text-cc-muted/60 text-sm">Loading modes…</div>
              ) : (
                <div
                  className={
                    showAllModes
                      ? "max-h-[55vh] overflow-y-auto pr-1 -mr-1"
                      : ""
                  }
                >
                  <div className="grid grid-cols-2 gap-2">
                    {visibleModes.map((m) => {
                      const count = sessionCountByMode.get(m.name) ?? 0;
                      return (
                        <button
                          key={m.name}
                          type="button"
                          disabled={launching}
                          onClick={() => {
                            // Open the sheet instead of launching directly.
                            // The user fills in init params (or just confirms
                            // an empty form) and decides whether to use Smart
                            // Handoff before the actual launch fires.
                            setLaunchTarget(m);
                            setSheetError(null);
                            setSmartHandoff(false);
                            setHandoffIntent("");
                          }}
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
                  {hiddenCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllModes(true)}
                      className="mt-3 w-full text-xs text-cc-muted hover:text-cc-primary transition-colors py-1.5 cursor-pointer"
                    >
                      Show all {orderedModes.length} modes →
                    </button>
                  ) : null}
                  {showAllModes && hiddenCount === 0 && orderedModes.length > DEFAULT_VISIBLE_MODE_COUNT ? (
                    <button
                      type="button"
                      onClick={() => setShowAllModes(false)}
                      className="mt-3 w-full text-xs text-cc-muted hover:text-cc-primary transition-colors py-1.5 cursor-pointer"
                    >
                      Show less ↑
                    </button>
                  ) : null}
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
      {/* close inner scroll layer */}
      </div>
      {/* Launch sheet — slides in from the panel's right edge as a layered
          drawer rather than swapping the right pane in place. The mode grid
          underneath stays visible (peeking out the left edge) so the user
          retains a sense of place while the sheet's params + smart-handoff
          UI takes focus. */}
      {drawerMounted && launchTarget ? (
        <div
          className={`absolute top-0 right-0 bottom-0 w-[480px] bg-cc-surface border-l border-cc-border/60 shadow-[-12px_0_36px_-12px_rgba(0,0,0,0.5)] flex flex-col z-[5] ${
            drawerClosing
              ? "[animation:slideOutRight_180ms_cubic-bezier(0.16,1,0.3,1)_forwards]"
              : "[animation:slideInRight_180ms_cubic-bezier(0.16,1,0.3,1)_forwards]"
          }`}
        >
          <div className="flex flex-col gap-4 p-5 overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <ModeIcon
                  svg={launchTarget.icon}
                  className="w-7 h-7 text-cc-primary shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm text-cc-fg font-medium truncate">
                    {launchTarget.displayName ?? launchTarget.name}
                  </h3>
                  {launchTarget.description ? (
                    <p className="text-xs text-cc-muted/70 leading-snug mt-0.5 line-clamp-3">
                      {launchTarget.description}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLaunchTarget(null);
                  setSheetError(null);
                  setSmartHandoff(false);
                  setHandoffIntent("");
                }}
                title="Close"
                className="shrink-0 text-cc-muted/60 hover:text-cc-fg transition-colors p-1 cursor-pointer rounded"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>

            {sheetPreparing ? (
              <div className="text-xs text-cc-muted/70">Loading parameters…</div>
            ) : sheetParams.length > 0 ? (
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium">
                  Parameters
                </p>
                <InitParamForm
                  params={sheetParams}
                  values={sheetValues}
                  onChange={setSheetValues}
                />
              </div>
            ) : null}

            {canHandoff ? (
              <div className="flex flex-col gap-2 pt-3 border-t border-cc-border/40">
                <label className="flex items-start gap-2 text-sm text-cc-fg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smartHandoff}
                    onChange={(e) => {
                      setSmartHandoff(e.target.checked);
                      if (!e.target.checked) setHandoffIntent("");
                      setSheetError(null);
                    }}
                    className="mt-0.5 accent-cc-primary cursor-pointer"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span>Smart handoff from current session</span>
                    <span className="text-[11px] text-cc-muted/70 leading-snug">
                      The current agent writes a handoff file with relevant context;
                      you confirm the switch in chat.
                    </span>
                  </span>
                </label>
                {smartHandoff ? (
                  <div className="flex flex-col gap-1.5 pl-6 [animation:overlayFadeIn_140ms_cubic-bezier(0.16,1,0.3,1)]">
                    <label className="text-xs text-cc-muted/80">
                      What should the new session do?
                    </label>
                    <textarea
                      value={handoffIntent}
                      onChange={(e) => {
                        setHandoffIntent(e.target.value);
                        if (sheetError) setSheetError(null);
                      }}
                      rows={2}
                      placeholder="Take this design and turn it into a slide deck"
                      className="bg-cc-input-bg border border-cc-border rounded-lg p-3 text-sm text-cc-fg placeholder:text-cc-muted/50 focus:outline-none focus:border-cc-primary/50 resize-none"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {sheetError ? (
              <div className="text-cc-error/80 text-xs" role="alert">
                {sheetError}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-2 mt-auto">
              <button
                type="button"
                onClick={() => {
                  setLaunchTarget(null);
                  setSheetError(null);
                  setSmartHandoff(false);
                  setHandoffIntent("");
                }}
                className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={launching || sheetPreparing}
                onClick={confirmLaunch}
                className="bg-cc-primary text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-cc-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {launching ? "Launching…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
