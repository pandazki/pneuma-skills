import React, { useState, useEffect, useCallback, useRef } from "react";


interface BuiltinMode {
  name: string;
  displayName: string;
  description: string;
  version: string;
  type: "builtin";
  hasInitParams?: boolean;
  icon?: string;
  showcase?: {
    tagline?: string;
    hero?: string;
    highlights?: Array<{
      title: string;
      description: string;
      media: string;
      mediaType?: "image" | "gif" | "video";
    }>;
  };
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

// Any mode type for the gallery
type AnyMode = {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  icon?: string;
  source: "builtin" | "local" | "published";
  // launch info
  specifier: string;
  path?: string;
  archiveUrl?: string;
  hasInitParams?: boolean;
  showcase?: BuiltinMode["showcase"];
};

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

// ── Theme ────────────────────────────────────────────────────────────────

type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem("pneuma-launcher-theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch { }
  return "system";
}

function useTheme() {
  const [preference, setPreference] = useState<Theme>(getInitialTheme);
  const [resolved, setResolved] = useState<"light" | "dark">(
    () => preference === "system" ? getSystemTheme() : preference,
  );

  useEffect(() => {
    const next = preference === "system" ? getSystemTheme() : preference;
    setResolved(next);
    try { localStorage.setItem("pneuma-launcher-theme", preference); } catch { }
  }, [preference]);

  // Listen for system changes
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => setResolved(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((prev) => {
      if (prev === "system") return "light";
      if (prev === "light") return "dark";
      return "system";
    });
  }, []);

  return { preference, resolved, cycle };
}

function ThemeToggle({ preference, onClick }: { preference: Theme; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-2 text-cc-muted/50 hover:text-cc-muted transition-colors cursor-pointer"
      title={`Theme: ${preference}`}
    >
      {preference === "light" ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ) : preference === "dark" ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
        </svg>
      )}
    </button>
  );
}

// ── Utility functions ────────────────────────────────────────────────────

const FALLBACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>`;
const MODE_MAKER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>`;

function ModeIcon({ svg, className }: { svg?: string; className?: string }) {
  const hasSvg = svg && svg.trim().startsWith("<svg");
  return (
    <div
      className={`[&>svg]:w-full [&>svg]:h-full ${className || ""}`}
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

// ── ShowcaseCarousel ─────────────────────────────────────────────────────

function ShowcaseCarousel({
  highlights,
  modeName,
  activeIndex,
  onIndexChange,
}: {
  highlights: NonNullable<BuiltinMode["showcase"]>["highlights"];
  modeName: string;
  activeIndex: number;
  onIndexChange: (i: number) => void;
}) {
  const items = highlights || [];
  if (items.length === 0) return null;

  const active = items[activeIndex] || items[0];
  const mediaUrl = `${getApiBase()}/api/modes/${modeName}/showcase/${active.media}`;

  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-cc-surface/60">
      {/* Media */}
      {active.mediaType === "video" ? (
        <video
          key={active.media}
          src={mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <img
          key={active.media}
          src={mediaUrl}
          alt={active.title}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
        />
      )}

      {/* Dot indicators */}
      {items.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => onIndexChange(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                i === activeIndex
                  ? "bg-white w-4"
                  : "bg-white/40 hover:bg-white/60"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── FeaturedMode ─────────────────────────────────────────────────────────

function FeaturedMode({
  mode,
  onLaunch,
  onExplore,
  isLight,
}: {
  mode: AnyMode;
  onLaunch: () => void;
  onExplore: () => void;
  isLight?: boolean;
}) {
  const [activeHighlight, setActiveHighlight] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const highlights = mode.showcase?.highlights;
  const hasShowcase = highlights && highlights.length > 0;

  // Auto-advance carousel
  useEffect(() => {
    if (!hasShowcase || highlights!.length <= 1) return;
    timerRef.current = setInterval(() => {
      setActiveHighlight((prev) => (prev + 1) % highlights!.length);
    }, 5000);
    return () => clearInterval(timerRef.current);
  }, [hasShowcase, highlights]);

  const handleHighlightHover = (i: number) => {
    clearInterval(timerRef.current);
    setActiveHighlight(i);
  };

  return (
    <section
      className="mb-16"
      style={{ animation: "launcherFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both" }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
        {/* Left: Media */}
        <div className="lg:col-span-3">
          {hasShowcase ? (
            <ShowcaseCarousel
              highlights={highlights}
              modeName={mode.name}
              activeIndex={activeHighlight}
              onIndexChange={handleHighlightHover}
            />
          ) : mode.showcase?.hero ? (
            <div className="aspect-video overflow-hidden rounded-lg bg-cc-surface/60">
              <img
                src={`${getApiBase()}/api/modes/${mode.name}/showcase/${mode.showcase.hero}`}
                alt={mode.displayName}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            /* No showcase — editorial type treatment */
            <div className="aspect-video overflow-hidden rounded-lg relative" style={{
              background: isLight
                ? "linear-gradient(135deg, oklch(93% 0.01 55) 0%, oklch(96% 0.005 55) 100%)"
                : "linear-gradient(135deg, oklch(14% 0.015 55) 0%, oklch(10% 0.01 55) 100%)",
            }}>
              {/* Warm ambient glow */}
              <div className="absolute inset-0" style={{
                background: isLight
                  ? "radial-gradient(ellipse at 25% 35%, oklch(75% 0.08 55 / 0.12) 0%, transparent 55%)"
                  : "radial-gradient(ellipse at 25% 35%, oklch(45% 0.12 55 / 0.08) 0%, transparent 55%)",
              }} />
              {/* Large display name as typographic element */}
              <div className="absolute inset-0 flex flex-col justify-end p-8">
                <ModeIcon svg={mode.icon} className="w-12 h-12 text-cc-primary/25 mb-4" />
                <span className="font-display text-5xl text-cc-fg/[0.06] leading-none tracking-tight select-none">
                  {mode.displayName}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Info */}
        <div className="lg:col-span-2 flex flex-col gap-4 py-2">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <ModeIcon svg={mode.icon} className="w-6 h-6 text-cc-primary" />
              <h2 className="font-display text-3xl text-cc-fg tracking-tight">{mode.displayName}</h2>
            </div>
            {mode.showcase?.tagline && (
              <p className="text-sm font-medium text-cc-primary/80 tracking-wide uppercase mb-3">
                {mode.showcase.tagline}
              </p>
            )}
            <p className="text-cc-muted leading-relaxed">{mode.description}</p>
          </div>

          {/* Highlight list — hover switches carousel */}
          {hasShowcase && (
            <div className="flex flex-col gap-1 mt-2">
              {highlights!.map((h, i) => (
                <div
                  key={i}
                  onMouseEnter={() => handleHighlightHover(i)}
                  className={`group flex items-start gap-3 px-3 py-2.5 rounded-md transition-all duration-200 cursor-default ${
                    i === activeHighlight
                      ? "bg-cc-primary/8"
                      : "hover:bg-white/[0.02]"
                  }`}
                >
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200 ${
                    i === activeHighlight ? "bg-cc-primary" : "bg-cc-muted/40"
                  }`} />
                  <div>
                    <span className={`text-sm font-medium transition-colors duration-200 ${
                      i === activeHighlight ? "text-cc-fg" : "text-cc-muted"
                    }`}>
                      {h.title}
                    </span>
                    {i === activeHighlight && (
                      <p className="text-xs text-cc-muted/70 mt-0.5 leading-relaxed">
                        {h.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mt-auto pt-4">
            <button
              onClick={onLaunch}
              className="px-5 py-2.5 text-sm font-medium rounded-lg bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
            >
              Launch
            </button>
            <button
              onClick={onExplore}
              className="px-5 py-2.5 text-sm font-medium rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg hover:border-cc-muted/40 transition-colors cursor-pointer"
            >
              Explore All Modes
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── SessionCard (redesigned — large with thumbnail) ──────────────────────

function SessionCard({
  session,
  homeDir,
  icon,
  isRunning,
  runningProcess,
  onResume,
  onDelete,
  onStop,
  onOpen,
}: {
  session?: RecentSession;
  homeDir: string;
  icon?: string;
  isRunning?: boolean;
  runningProcess?: ChildProcess;
  onResume?: (skipSkill?: boolean) => Promise<void>;
  onDelete?: () => void;
  onStop?: () => void;
  onOpen?: () => void;
}) {
  const [confirmAction, setConfirmAction] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [skillUpdate, setSkillUpdate] = useState<{
    currentVersion: string;
    installedVersion: string;
  } | null>(null);
  const [duration, setDuration] = useState(runningProcess ? runningDuration(runningProcess.startedAt) : "");

  useEffect(() => {
    if (!runningProcess) return;
    const interval = setInterval(() => setDuration(runningDuration(runningProcess.startedAt)), 10_000);
    return () => clearInterval(interval);
  }, [runningProcess]);

  const handleClick = async () => {
    if (isRunning && onOpen) {
      onOpen();
      return;
    }
    if (!onResume || confirmAction || launching || skillUpdate) return;
    setLaunching(true);
    try {
      const res = await fetch(`${getApiBase()}/api/launch/skill-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specifier: session!.mode, workspace: session!.workspace }),
      });
      const data = await res.json();
      if (data.needsUpdate && !data.dismissed) {
        setSkillUpdate({ currentVersion: data.currentVersion, installedVersion: data.installedVersion });
        setLaunching(false);
        return;
      }
      await onResume(!data.needsUpdate || data.dismissed);
      setLaunching(false);
    } catch {
      await onResume();
      setLaunching(false);
    }
  };

  const handleUpdate = async () => {
    setSkillUpdate(null);
    setLaunching(true);
    await onResume!(false);
    setLaunching(false);
  };

  const handleSkip = async () => {
    try {
      await fetch(`${getApiBase()}/api/launch/skill-dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: session!.workspace, version: skillUpdate!.currentVersion }),
      });
    } catch { }
    setSkillUpdate(null);
    setLaunching(true);
    await onResume!(true);
    setLaunching(false);
  };

  const displayName = session?.displayName || runningProcess?.specifier.split("/").pop() || "Unknown";
  const workspace = session?.workspace || runningProcess?.workspace || "";

  return (
    <div
      onClick={handleClick}
      className={`group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-0.5 border border-cc-border/20 hover:border-cc-border/40 ${
        launching ? "opacity-50 pointer-events-none" : ""
      }`}
      style={{ minWidth: 220 }}
    >
      {/* Thumbnail area */}
      <div className={`aspect-[16/10] relative overflow-hidden ${
        isRunning
          ? "bg-emerald-500/5"
          : "bg-cc-surface/80"
      }`}>
        {/* Placeholder — will be replaced by actual thumbnails */}
        <div className="absolute inset-0 flex items-center justify-center">
          <ModeIcon svg={icon} className={`w-10 h-10 ${isRunning ? "text-emerald-500/20" : "text-cc-muted/30"}`} />
        </div>

        {/* Running indicator */}
        {isRunning && (
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-medium text-emerald-400 tracking-wide">{duration}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-cc-fg/90 truncate">
            {launching ? "Launching..." : displayName}
          </span>
          {session && !isRunning && (
            <span className="text-[11px] text-cc-muted/50 shrink-0 ml-2">{timeAgo(session.lastAccessed)}</span>
          )}
        </div>
        <p className="text-[11px] text-cc-muted/50 font-mono truncate mt-0.5">
          {shortenPath(workspace, homeDir)}
        </p>
      </div>

      {/* Hover actions */}
      <div
        className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {isRunning && onStop && (
          !confirmAction ? (
            <button
              onClick={() => setConfirmAction(true)}
              className="p-1 rounded bg-cc-surface/80 text-cc-muted/60 hover:text-red-400 transition-colors cursor-pointer"
              title="Stop"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          ) : (
            <div className="flex gap-1 bg-cc-surface/90 rounded px-1.5 py-0.5">
              <button
                onClick={() => { onStop(); setConfirmAction(false); }}
                className="text-[10px] text-red-400 font-medium cursor-pointer"
              >
                Stop
              </button>
              <button
                onClick={() => setConfirmAction(false)}
                className="text-[10px] text-cc-muted cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )
        )}
        {!isRunning && onDelete && (
          !confirmAction ? (
            <button
              onClick={() => setConfirmAction(true)}
              className="p-1 rounded bg-cc-surface/80 text-cc-muted/60 hover:text-red-400 transition-colors cursor-pointer"
              title="Remove"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
              </svg>
            </button>
          ) : (
            <div className="flex gap-1 bg-cc-surface/90 rounded px-1.5 py-0.5">
              <button
                onClick={() => { onDelete(); setConfirmAction(false); }}
                className="text-[10px] text-red-400 font-medium cursor-pointer"
              >
                Remove
              </button>
              <button
                onClick={() => setConfirmAction(false)}
                className="text-[10px] text-cc-muted cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )
        )}
      </div>

      {/* Skill update prompt */}
      {skillUpdate && (
        <div className="absolute inset-x-0 bottom-0 p-3 bg-cc-surface/95 border-t border-cc-primary/20" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold text-cc-primary uppercase tracking-wider">Update Available</span>
              <span className="text-[10px] text-cc-muted/60 ml-2">
                v{skillUpdate.installedVersion} → v{skillUpdate.currentVersion}
              </span>
            </div>
            <div className="flex gap-1.5">
              <button onClick={handleSkip} className="px-2 py-1 text-[10px] rounded border border-cc-border/50 text-cc-muted hover:text-cc-fg cursor-pointer transition-colors">Skip</button>
              <button onClick={handleUpdate} className="px-2 py-1 text-[10px] rounded bg-cc-primary/20 text-cc-primary hover:bg-cc-primary hover:text-white font-medium cursor-pointer transition-colors">Update</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── QuickStartTile ───────────────────────────────────────────────────────

function QuickStartTile({
  name,
  displayName,
  icon,
  isModeMaker,
  onClick,
}: {
  name: string;
  displayName: string;
  icon?: string;
  isModeMaker?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200 cursor-pointer ${
        isModeMaker
          ? "bg-cc-primary/5 border border-cc-primary/15 hover:border-cc-primary/30 hover:bg-cc-primary/8"
          : "bg-transparent hover:bg-white/[0.03]"
      }`}
    >
      <div className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 ${
        isModeMaker
          ? "bg-cc-primary/10 text-cc-primary group-hover:scale-105"
          : "bg-cc-surface/60 text-cc-muted group-hover:text-cc-primary group-hover:scale-105"
      }`}>
        <ModeIcon svg={icon || (isModeMaker ? MODE_MAKER_ICON : undefined)} className="w-5 h-5" />
      </div>
      <span className={`text-xs font-medium transition-colors ${
        isModeMaker
          ? "text-cc-primary"
          : "text-cc-muted group-hover:text-cc-fg"
      }`}>
        {displayName}
      </span>
    </button>
  );
}

// ── ModeGallery (full-screen overlay) ────────────────────────────────────

function ModeGallery({
  modes,
  onClose,
  onLaunch,
  className,
}: {
  modes: AnyMode[];
  onClose: () => void;
  onLaunch: (mode: AnyMode) => void;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [expandedMode, setExpandedMode] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = search
    ? modes.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.displayName.toLowerCase().includes(search.toLowerCase()) ||
          m.description?.toLowerCase().includes(search.toLowerCase()),
      )
    : modes;

  // Group by source
  const builtin = filtered.filter((m) => m.source === "builtin");
  const local = filtered.filter((m) => m.source === "local");
  const published = filtered.filter((m) => m.source === "published");

  return (
    <div
      className={`fixed inset-0 z-50 bg-cc-bg overflow-y-auto font-body ${className || ""}`}
      style={{ animation: "launcherFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-cc-bg/80 backdrop-blur-sm border-b border-cc-border/30">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-sm text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back
          </button>
          <h1 className="font-display text-xl text-cc-fg">Mode Gallery</h1>
          <div className="ml-auto w-64">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full px-3 py-1.5 bg-transparent border border-cc-border/40 rounded-lg text-sm text-cc-fg placeholder:text-cc-muted/40 outline-none focus:border-cc-muted/50 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Gallery content */}
      <div className="max-w-5xl mx-auto px-6 py-8" ref={ref}>
        {[
          { label: "Built-in", items: builtin },
          { label: "Local", items: local },
          { label: "Published", items: published },
        ]
          .filter((g) => g.items.length > 0)
          .map((group) => (
            <div key={group.label} className="mb-12">
              <h2 className="text-xs font-medium text-cc-muted/60 uppercase tracking-widest mb-6">{group.label}</h2>
              <div className="space-y-6">
                {group.items.map((mode) => (
                  <GalleryModeCard
                    key={mode.name}
                    mode={mode}
                    expanded={expandedMode === mode.name}
                    onToggle={() => setExpandedMode(expandedMode === mode.name ? null : mode.name)}
                    onLaunch={() => onLaunch(mode)}
                  />
                ))}
              </div>
            </div>
          ))}

        {filtered.length === 0 && (
          <p className="text-center text-cc-muted/60 py-20">No modes match your search.</p>
        )}
      </div>
    </div>
  );
}

function GalleryModeCard({
  mode,
  expanded,
  onToggle,
  onLaunch,
}: {
  mode: AnyMode;
  expanded: boolean;
  onToggle: () => void;
  onLaunch: () => void;
}) {
  const [activeHighlight, setActiveHighlight] = useState(0);
  const highlights = mode.showcase?.highlights;
  const hasShowcase = highlights && highlights.length > 0;

  return (
    <div className="group rounded-xl border border-cc-border/30 overflow-hidden hover:border-cc-border/60 transition-colors">
      {/* Header row — always visible */}
      <div
        className="flex items-center gap-4 px-5 py-4 cursor-pointer"
        onClick={onToggle}
      >
        <ModeIcon svg={mode.icon} className="w-8 h-8 text-cc-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-medium text-cc-fg">{mode.displayName}</h3>
            {mode.showcase?.tagline && (
              <span className="text-xs text-cc-muted/60 hidden sm:inline">{mode.showcase.tagline}</span>
            )}
          </div>
          <p className="text-sm text-cc-muted/70 truncate">{mode.description}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-cc-muted/40 font-mono">{mode.version}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onLaunch(); }}
            className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-cc-primary/10 text-cc-primary hover:bg-cc-primary hover:text-white transition-colors cursor-pointer"
          >
            Launch
          </button>
          <svg
            className={`w-4 h-4 text-cc-muted/40 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </div>

      {/* Expanded showcase */}
      {expanded && (
        <div
          className="border-t border-cc-border/20 px-5 py-5"
          style={{ animation: "launcherSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
          {hasShowcase ? (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
              {/* Carousel */}
              <div className="md:col-span-3">
                <ShowcaseCarousel
                  highlights={highlights}
                  modeName={mode.name}
                  activeIndex={activeHighlight}
                  onIndexChange={setActiveHighlight}
                />
              </div>
              {/* Highlight list */}
              <div className="md:col-span-2 flex flex-col gap-1.5">
                {highlights!.map((h, i) => (
                  <div
                    key={i}
                    onMouseEnter={() => setActiveHighlight(i)}
                    className={`px-3 py-2 rounded-md transition-all duration-200 cursor-default ${
                      i === activeHighlight ? "bg-cc-primary/8" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <span className={`text-sm font-medium ${
                      i === activeHighlight ? "text-cc-fg" : "text-cc-muted"
                    }`}>
                      {h.title}
                    </span>
                    <p className="text-xs text-cc-muted/60 mt-0.5">{h.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-cc-muted/60 italic">
              {mode.description || "No showcase content available yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── DirBrowser ────────────────────────────────────────────────────────────

function DirBrowser({
  startPath,
  apiBase,
  onSelect,
  onClose,
}: {
  startPath: string;
  apiBase: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = useState(startPath);
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/browse-dirs?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error && data.dirs?.length === 0) {
        setError(data.error);
      }
      setCurrentPath(data.current || path);
      setDirs(data.dirs || []);
      setParentPath(data.parent || null);
    } catch {
      setError("Failed to browse directory");
    }
    setLoading(false);
  }, [apiBase]);

  useEffect(() => { browse(startPath); }, [browse, startPath]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const segments = currentPath.split("/").filter(Boolean);

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 top-full mt-1 z-50 bg-cc-surface border border-cc-border/60 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden"
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-cc-border/40 overflow-x-auto text-xs">
        <button onClick={() => browse("/")} className="text-cc-muted hover:text-cc-fg cursor-pointer shrink-0">/</button>
        {segments.map((seg, i) => {
          const path = "/" + segments.slice(0, i + 1).join("/");
          return (
            <React.Fragment key={path}>
              <span className="text-cc-muted/30">/</span>
              <button
                onClick={() => browse(path)}
                className="text-cc-muted hover:text-cc-fg cursor-pointer shrink-0 max-w-[120px] truncate"
              >
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Directory list */}
      <div className="max-h-52 overflow-y-auto py-1">
        {loading ? (
          <div className="flex justify-center py-4">
            <div className="w-4 h-4 rounded-full border-2 border-cc-primary border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {error && <div className="px-3 py-2 text-xs text-cc-error">{error}</div>}
            {parentPath && (
              <button
                onClick={() => browse(parentPath)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-cc-muted hover:bg-cc-hover cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                </svg>
                ..
              </button>
            )}
            {dirs.map((dir) => (
              <button
                key={dir.path}
                onClick={() => browse(dir.path)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-cc-fg hover:bg-cc-hover cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0 text-cc-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                <span className="truncate flex-1 text-left">{dir.name}</span>
              </button>
            ))}
            {dirs.length === 0 && !error && (
              <div className="py-4 text-center text-cc-muted/60 text-xs">Empty directory</div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-t border-cc-border/40">
        <span className="text-xs text-cc-muted truncate mr-2">{currentPath}</span>
        <button
          onClick={() => { onSelect(currentPath); onClose(); }}
          className="shrink-0 px-3 py-1 text-xs font-medium rounded-md bg-cc-primary hover:bg-cc-primary-hover text-cc-fg transition-colors cursor-pointer"
        >
          Select
        </button>
      </div>
    </div>
  );
}

// ── LaunchDialog ──────────────────────────────────────────────────────────

function LaunchDialog({
  specifier,
  displayName,
  defaultWorkspace,
  defaultInitParams,
  homeDir,
  onClose,
}: {
  specifier: string;
  displayName: string;
  defaultWorkspace?: string;
  defaultInitParams?: Record<string, string>;
  homeDir: string;
  onClose: () => void;
}) {
  const safeName = /[\\/]/.test(specifier) ? specifier.split(/[\\/]/).filter(Boolean).pop()! : specifier;
  const timeTag = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  const fallback = homeDir
    ? `${homeDir.replace(/[\\/]+$/, "")}/pneuma-projects/${safeName}-${timeTag}`
    : `~/pneuma-projects/${safeName}-${timeTag}`;
  const [workspace, setWorkspace] = useState(defaultWorkspace || fallback);
  const [initParams, setInitParams] = useState<InitParam[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string | number>>({});
  const displayNameTouchedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [existingSession, setExistingSession] = useState<{ mode: string; config: Record<string, string | number> } | null>(null);

  const checkWorkspace = useCallback(async (path: string) => {
    setWorkspace(path);
    setExistingSession(null);
    try {
      const res = await fetch(`${getApiBase()}/api/workspace-check?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.hasSession) {
        setExistingSession({ mode: data.mode, config: data.config || {} });
        if (data.config && Object.keys(data.config).length > 0) {
          setParamValues(data.config);
        }
      }
    } catch { }
  }, []);

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
      if (defaultWorkspace) {
        checkWorkspace(defaultWorkspace);
      }
    };
    prepare();
  }, [specifier, defaultWorkspace, checkWorkspace]);

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
          initParams: {
            ...(defaultInitParams || {}),
            ...(Object.keys(paramValues).length > 0 ? paramValues : {}),
          },
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 font-body">
      <div
        className="bg-cc-surface border border-cc-border/50 rounded-2xl p-8 w-full max-w-lg mx-4 shadow-[0_16px_64px_-16px_rgba(0,0,0,0.3)]"
        style={{ animation: "launcherFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl text-cc-fg">
            Launch {displayName}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <label className="block text-sm text-cc-muted mb-1">Workspace path</label>
        <div className="relative mb-4">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={workspace}
              onChange={(e) => { setWorkspace(e.target.value); setExistingSession(null); }}
              className="flex-1 min-w-0 px-3 py-2 bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg text-sm focus:outline-none focus:border-cc-primary/50"
            />
            <button
              type="button"
              onClick={async () => {
                const desktop = (window as any).pneumaDesktop;
                if (desktop?.showOpenDialog) {
                  const selected = await desktop.showOpenDialog({
                    title: "Select Workspace",
                    defaultPath: workspace || undefined,
                  });
                  if (selected) {
                    checkWorkspace(selected);
                  }
                } else {
                  setBrowsing(!browsing);
                }
              }}
              className={`shrink-0 px-2.5 py-2 rounded-lg border transition-colors cursor-pointer ${
                browsing
                  ? "bg-cc-primary/20 border-cc-primary/50 text-cc-primary"
                  : "bg-cc-input-bg border-cc-border text-cc-muted hover:text-cc-fg"
              }`}
              title="Browse directories"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </button>
          </div>
          {browsing && (
            <DirBrowser
              startPath={workspace || homeDir}
              apiBase={getApiBase()}
              onSelect={checkWorkspace}
              onClose={() => setBrowsing(false)}
            />
          )}
        </div>

        {preparing && (
          <p className="text-sm text-cc-muted mb-4">Loading configuration...</p>
        )}

        {existingSession && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-cc-primary/5 border border-cc-primary/15">
            <svg className="w-4 h-4 text-cc-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-cc-primary">Existing workspace — will resume session</span>
          </div>
        )}

        {initParams.length > 0 && !defaultWorkspace && (
          <div className="mb-4 space-y-3">
            <p className="text-sm font-medium text-cc-fg">
              Parameters
              {existingSession && <span className="text-xs text-cc-muted font-normal ml-2">(read-only)</span>}
            </p>
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
                  disabled={!!existingSession}
                  onChange={(e) => {
                    let val: string | number = param.type === "number" ? Number(e.target.value) : e.target.value;
                    if (param.name === "modeName" && typeof val === "string") {
                      val = val.toLowerCase().replace(/[^a-z0-9-]/g, "");
                    }
                    const next: Record<string, string | number> = { ...paramValues, [param.name]: val };
                    if (param.name === "modeName" && typeof val === "string" && !displayNameTouchedRef.current) {
                      const hasDisplayName = initParams.some((p) => p.name === "displayName");
                      if (hasDisplayName) {
                        next.displayName = val
                          .split(/[-_\s]+/)
                          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                          .join(" ");
                      }
                    }
                    if (param.name === "displayName") {
                      displayNameTouchedRef.current = true;
                    }
                    setParamValues(next);
                  }}
                  className={`w-full px-3 py-2 bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg text-sm focus:outline-none focus:border-cc-primary/50 ${
                    existingSession ? "opacity-60 cursor-not-allowed" : ""
                  }`}
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

// ── Main Launcher ────────────────────────────────────────────────────────

export default function Launcher() {
  const { preference: themePref, resolved: theme, cycle: cycleTheme } = useTheme();
  const isLight = theme === "light";
  const [builtins, setBuiltins] = useState<BuiltinMode[]>([]);
  const [published, setPublished] = useState<PublishedMode[]>([]);
  const [local, setLocal] = useState<LocalMode[]>([]);
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [running, setRunning] = useState<ChildProcess[]>([]);
  const [homeDir, setHomeDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [showGallery, setShowGallery] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<{
    specifier: string;
    displayName: string;
    defaultWorkspace?: string;
    defaultInitParams?: Record<string, string>;
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

  // Build icon lookup
  const iconMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    map["mode-maker"] = MODE_MAKER_ICON;
    for (const m of builtins) { if (m.icon) map[m.name] = m.icon; }
    for (const m of local) { if (m.icon) map[m.name] = m.icon; }
    for (const m of published) { if (m.icon) map[m.name] = m.icon; }
    return map;
  }, [builtins, local, published]);

  // Merge sessions + running for the "Continue" section
  const runningWorkspaces = new Set(running.map((r) => r.workspace));
  const continueItems = [
    // Running processes first
    ...running.map((proc) => ({
      type: "running" as const,
      key: `run-${proc.pid}`,
      process: proc,
      session: sessions.find((s) => s.workspace === proc.workspace),
      modeName: proc.specifier.split("/").pop() || proc.specifier,
    })),
    // Then recent sessions (not currently running)
    ...sessions
      .filter((s) => !runningWorkspaces.has(s.workspace))
      .slice(0, 6)
      .map((s) => ({
        type: "recent" as const,
        key: `session-${s.id}`,
        session: s,
        process: undefined,
        modeName: s.mode,
      })),
  ];

  // Featured mode — first builtin with showcase, or first builtin
  const featuredMode: AnyMode | undefined = React.useMemo(() => {
    const withShowcase = builtins.find((m) => m.showcase?.highlights?.length);
    const first = withShowcase || builtins[0];
    if (!first) return undefined;
    return {
      ...first,
      source: "builtin" as const,
      specifier: first.name,
    };
  }, [builtins]);

  // All modes for gallery
  const allModes: AnyMode[] = React.useMemo(() => [
    ...builtins.map((m) => ({ ...m, source: "builtin" as const, specifier: m.name })),
    ...local.map((m) => ({ ...m, source: "local" as const, specifier: m.path })),
    ...published.map((m) => ({ ...m, source: "published" as const, specifier: m.archiveUrl })),
  ], [builtins, local, published]);

  // All modes for quick start (exclude featured, add mode-maker at end)
  const quickStartModes = React.useMemo(() => {
    const modes = allModes.filter((m) => m.name !== featuredMode?.name && m.name !== "mode-maker" && m.name !== "evolve");
    return modes;
  }, [allModes, featuredMode]);

  const handleGalleryLaunch = (mode: AnyMode) => {
    setShowGallery(false);
    setLaunchTarget({
      specifier: mode.specifier,
      displayName: mode.displayName,
    });
  };

  const hasContinueItems = continueItems.length > 0;

  return (
    <div className={`min-h-screen bg-cc-bg text-cc-fg font-body relative ${isLight ? "launcher-light" : ""}`}>
      {/* Subtle warm ambient — single, very soft glow */}
      <div
        className="fixed top-[-20%] left-[10%] w-[50%] h-[50%] pointer-events-none"
        style={{
          background: isLight
            ? "radial-gradient(ellipse, oklch(80% 0.06 55 / 0.15) 0%, transparent 70%)"
            : "radial-gradient(ellipse, oklch(50% 0.08 55 / 0.06) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <header
        className="relative z-10 max-w-6xl mx-auto px-6 pt-10 pb-6 flex items-center justify-between"
        style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Pneuma"
            className="w-9 h-9 rounded-lg"
            style={isLight ? { mixBlendMode: "multiply" } : undefined}
          />
          <span className="font-display text-2xl text-cc-fg tracking-tight">Pneuma</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle preference={themePref} onClick={cycleTheme} />
          <a
            href="https://github.com/pandazki/pneuma-skills"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-cc-muted/50 hover:text-cc-muted transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <button
            onClick={() => setShowGallery(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 text-sm text-cc-muted hover:text-cc-fg border border-cc-border/40 hover:border-cc-muted/40 rounded-lg transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            Gallery
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center items-center py-32">
          <div className="w-6 h-6 rounded-full border-2 border-cc-primary/40 border-t-cc-primary animate-spin" />
        </div>
      ) : (
        <main className="relative z-10 max-w-6xl mx-auto px-6 pb-16">
          {/* Featured Mode */}
          {featuredMode && (
            <FeaturedMode
              mode={featuredMode}
              isLight={isLight}
              onLaunch={() => setLaunchTarget({
                specifier: featuredMode.specifier,
                displayName: featuredMode.displayName,
              })}
              onExplore={() => setShowGallery(true)}
            />
          )}

          {/* Continue — Recent + Running */}
          {hasContinueItems && (
            <section
              className="mb-14"
              style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both" }}
            >
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-xs font-medium text-cc-muted/60 uppercase tracking-widest">Continue</h2>
                {continueItems.length > 4 && (
                  <span className="text-xs text-cc-muted/40">{continueItems.length} sessions</span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {continueItems.map((item) => (
                  <SessionCard
                    key={item.key}
                    session={item.session}
                    homeDir={homeDir}
                    icon={iconMap[item.modeName]}
                    isRunning={item.type === "running"}
                    runningProcess={item.process}
                    onResume={item.session ? (skipSkill) => directLaunch(item.session!.mode, item.session!.workspace, skipSkill) : undefined}
                    onDelete={item.session ? () => deleteSession(item.session!.id) : undefined}
                    onStop={item.process ? () => stopProcess(item.process!.pid) : undefined}
                    onOpen={item.process ? () => window.open(item.process!.url, "_blank") : undefined}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Quick Start */}
          <section style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both" }}>
            <h2 className="text-xs font-medium text-cc-muted/60 uppercase tracking-widest mb-4">Create New</h2>
            <div className="flex flex-wrap gap-1">
              {quickStartModes.map((mode) => (
                <QuickStartTile
                  key={mode.name}
                  name={mode.name}
                  displayName={mode.displayName}
                  icon={mode.icon}
                  onClick={() => setLaunchTarget({
                    specifier: mode.specifier,
                    displayName: mode.displayName,
                  })}
                />
              ))}
              {/* Mode Maker — special tile */}
              <QuickStartTile
                name="mode-maker"
                displayName="Mode Maker"
                icon={MODE_MAKER_ICON}
                isModeMaker
                onClick={() => setLaunchTarget({
                  specifier: "mode-maker",
                  displayName: "Mode Maker",
                })}
              />
            </div>
          </section>
        </main>
      )}

      {/* Gallery overlay */}
      {showGallery && (
        <ModeGallery
          modes={allModes}
          onClose={() => setShowGallery(false)}
          onLaunch={handleGalleryLaunch}
          className={isLight ? "launcher-light" : ""}
        />
      )}

      {/* Launch Dialog */}
      {launchTarget && (
        <LaunchDialog
          specifier={launchTarget.specifier}
          displayName={launchTarget.displayName}
          defaultWorkspace={launchTarget.defaultWorkspace}
          defaultInitParams={launchTarget.defaultInitParams}
          homeDir={homeDir}
          onClose={() => setLaunchTarget(null)}
        />
      )}
    </div>
  );
}
