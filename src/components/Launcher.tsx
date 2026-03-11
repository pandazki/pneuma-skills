import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import SpotlightCard from "./reactbits/SpotlightCard";
import Galaxy from "./reactbits/Galaxy";


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
  hasThumbnail?: boolean;
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
      className="p-2 text-cc-muted/70 hover:text-cc-fg transition-colors cursor-pointer"
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

// ── useAnimatedMount — delays unmount for exit animation ─────────────────

function useAnimatedMount(visible: boolean, duration = 200) {
  const [mounted, setMounted] = useState(visible);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const timer = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  return { mounted, closing };
}

// ── ConfirmButton — unified destructive action with animated confirm ─────

function ConfirmButton({
  icon,
  label,
  onConfirm,
  className,
  stopPropagation,
}: {
  icon: React.ReactNode;
  label: string;
  onConfirm: () => void;
  className?: string;
  stopPropagation?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleTrigger = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    setOpen(true);
    // Auto-dismiss after 3s
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(false), 3000);
  };

  const handleConfirm = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    clearTimeout(timerRef.current);
    onConfirm();
    setOpen(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    clearTimeout(timerRef.current);
    setOpen(false);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className={`relative ${className || ""}`} onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}>
      {/* Trigger */}
      <button
        onClick={handleTrigger}
        className={`p-1.5 rounded-lg transition-all duration-200 cursor-pointer ${
          open
            ? "text-red-400 bg-red-400/10 scale-0 opacity-0"
            : "text-cc-muted/40 hover:text-red-400 hover:bg-red-400/10"
        }`}
        title={label}
      >
        {icon}
      </button>
      {/* Confirm popover */}
      <div
        className={`absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded-lg bg-cc-surface/95 backdrop-blur-sm border border-cc-border/30 shadow-lg transition-all duration-200 origin-right ${
          open
            ? "scale-100 opacity-100"
            : "scale-75 opacity-0 pointer-events-none"
        }`}
      >
        <button
          onClick={handleConfirm}
          className="px-2 py-0.5 text-[10px] font-medium text-red-400 hover:text-red-300 rounded transition-colors cursor-pointer whitespace-nowrap"
        >
          {label}
        </button>
        <div className="w-px h-3 bg-cc-border/30" />
        <button
          onClick={handleCancel}
          className="px-1.5 py-0.5 text-[10px] text-cc-muted hover:text-cc-fg rounded transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Utility functions ────────────────────────────────────────────────────

const FALLBACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>`;
const MODE_MAKER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>`;
const EVOLVE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1.5 0-2.5 1-3 2-.5-1-1.5-2-3-2C4 3 2 5 2 7c0 3 4 6 6 8 .5-.5 1.5-1.5 2-2"/><path d="M12 3c1.5 0 2.5 1 3 2 .5-1 1.5-2 3-2 2 0 4 2 4 4 0 3-4 6-6 8-.5-.5-1.5-1.5-2-2"/><path d="M12 21v-8"/><path d="M9 18l3-3 3 3"/></svg>`;

function ModeIcon({ svg, className }: { svg?: string; className?: string }) {
  const hasSvg = svg && svg.trim().startsWith("<svg");
  return (
    <div
      className={`[&>svg]:w-full [&>svg]:h-full ${className || ""}`}
      dangerouslySetInnerHTML={{ __html: hasSvg ? svg : FALLBACK_SVG }}
    />
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  className = "",
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-1 text-xs" : "px-5 py-2 text-sm";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${pad} font-medium rounded-lg bg-cc-primary text-white transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 hover:shadow-[0_0_16px_rgba(249,115,22,0.2)] ${className}`}
    >
      {children}
    </button>
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
  isLight,
}: {
  highlights: NonNullable<BuiltinMode["showcase"]>["highlights"];
  modeName: string;
  activeIndex: number;
  onIndexChange: (i: number) => void;
  isLight?: boolean;
}) {
  const items = highlights || [];
  if (items.length === 0) return null;

  return (
    <div className="launcher-card-elevated relative w-full h-full overflow-hidden rounded-lg bg-cc-surface/60 border border-cc-border/20">
      {/* All images stacked — crossfade via opacity */}
      {items.map((item, i) => {
        const url = `${getApiBase()}/api/modes/${modeName}/showcase/${item.media}`;
        return item.mediaType === "video" ? (
          <video
            key={item.media}
            src={url}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
            style={{ opacity: i === activeIndex ? 1 : 0 }}
          />
        ) : (
          <img
            key={item.media}
            src={url}
            alt={item.title}
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
            style={{ opacity: i === activeIndex ? 1 : 0 }}
          />
        );
      })}

      {/* Edge vignette — softens screenshot edges into card background */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          boxShadow: isLight
            ? "inset 0 0 20px 4px rgba(245, 240, 235, 0.3), inset 0 0 48px 10px rgba(245, 240, 235, 0.1)"
            : "inset 0 0 20px 4px rgba(9, 9, 11, 0.25), inset 0 0 48px 10px rgba(9, 9, 11, 0.08)",
        }}
      />

      {/* Dot indicators */}
      {items.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
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

// ── ChromaGridWrap — spotlight + grayscale container (no GSAP) ────────────

function ChromaGridWrap({
  children,
  radius = 300,
  className,
  gridClass = "grid grid-cols-2 lg:grid-cols-3 gap-4",
}: {
  children: React.ReactNode;
  radius?: number;
  className?: string;
  gridClass?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.PointerEvent) => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--chroma-x", `${e.clientX - r.left}px`);
    el.style.setProperty("--chroma-y", `${e.clientY - r.top}px`);
    if (fadeRef.current) fadeRef.current.style.opacity = "0";
  };

  const handleLeave = () => {
    if (fadeRef.current) fadeRef.current.style.opacity = "1";
  };

  const maskGradient = `radial-gradient(circle var(--chroma-r) at var(--chroma-x) var(--chroma-y),transparent 0%,transparent 15%,rgba(0,0,0,0.10) 30%,rgba(0,0,0,0.22) 45%,rgba(0,0,0,0.35) 60%,rgba(0,0,0,0.50) 75%,rgba(0,0,0,0.68) 88%,black 100%)`;
  const fadeMask = `radial-gradient(circle var(--chroma-r) at var(--chroma-x) var(--chroma-y),white 0%,white 15%,rgba(255,255,255,0.90) 30%,rgba(255,255,255,0.78) 45%,rgba(255,255,255,0.65) 60%,rgba(255,255,255,0.50) 75%,rgba(255,255,255,0.32) 88%,transparent 100%)`;

  return (
    <div
      ref={rootRef}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={`relative ${gridClass} ${className || ""}`}
      style={{
        "--chroma-r": `${radius}px`,
        "--chroma-x": "50%",
        "--chroma-y": "50%",
      } as React.CSSProperties}
    >
      {children}
      {/* Grayscale mask — spotlight hole */}
      <div
        className="absolute inset-0 pointer-events-none z-30 rounded-xl"
        style={{
          backdropFilter: "grayscale(0.5) brightness(0.96)",
          WebkitBackdropFilter: "grayscale(0.5) brightness(0.96)",
          background: "rgba(0,0,0,0.001)",
          maskImage: maskGradient,
          WebkitMaskImage: maskGradient,
        }}
      />
      {/* Fade overlay — covers spotlight hole when mouse leaves */}
      <div
        ref={fadeRef}
        className="absolute inset-0 pointer-events-none z-40 rounded-xl transition-opacity duration-500"
        style={{
          backdropFilter: "grayscale(0.5) brightness(0.96)",
          WebkitBackdropFilter: "grayscale(0.5) brightness(0.96)",
          background: "rgba(0,0,0,0.001)",
          maskImage: fadeMask,
          WebkitMaskImage: fadeMask,
          opacity: 1,
        }}
      />
    </div>
  );
}

// ── WarmSpotlightWrap — mouse-following glow without grayscale ────────────

function WarmSpotlightWrap({
  children,
  radius = 200,
  className,
  gridClass = "grid grid-cols-2 lg:grid-cols-3 gap-4",
}: {
  children: React.ReactNode;
  radius?: number;
  className?: string;
  gridClass?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.PointerEvent) => {
    const el = rootRef.current;
    const glow = glowRef.current;
    if (!el || !glow) return;
    const r = el.getBoundingClientRect();
    glow.style.left = `${e.clientX - r.left}px`;
    glow.style.top = `${e.clientY - r.top}px`;
    glow.style.opacity = "1";
  };

  const handleLeave = () => {
    if (glowRef.current) glowRef.current.style.opacity = "0";
  };

  return (
    <div
      ref={rootRef}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={`relative ${gridClass} ${className || ""}`}
    >
      {children}
      {/* Warm radial glow that follows cursor */}
      <div
        ref={glowRef}
        className="absolute pointer-events-none z-10 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300"
        style={{
          width: radius * 2,
          height: radius * 2,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(249,115,22,0.08) 0%, rgba(249,115,22,0.03) 40%, transparent 70%)",
          opacity: 0,
        }}
      />
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
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
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
      className="mb-20"
      style={{ animation: "launcherFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both" }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:h-[420px]">
        {/* Left: Media */}
        <div className="lg:col-span-3 h-full">
          {hasShowcase ? (
            <ShowcaseCarousel
              highlights={highlights}
              modeName={mode.name}
              activeIndex={activeHighlight}
              onIndexChange={handleHighlightHover}
              isLight={isLight}
            />
          ) : mode.showcase?.hero ? (
            <div className="h-full overflow-hidden rounded-lg bg-cc-surface/60 relative">
              <img
                src={`${getApiBase()}/api/modes/${mode.name}/showcase/${mode.showcase.hero}`}
                alt={mode.displayName}
                className="w-full h-full object-cover"
              />
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  boxShadow: isLight
                    ? "inset 0 0 40px 12px rgba(245, 240, 235, 0.6), inset 0 0 80px 24px rgba(245, 240, 235, 0.25)"
                    : "inset 0 0 40px 12px rgba(9, 9, 11, 0.5), inset 0 0 80px 24px rgba(9, 9, 11, 0.2)",
                }}
              />
            </div>
          ) : (
            /* No showcase — editorial type treatment */
            <div className="h-full overflow-hidden rounded-lg relative" style={{
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
        <div className="lg:col-span-2 flex flex-col py-2 h-full overflow-hidden">
          <div className="shrink-0">
            <div className="flex items-center gap-3 mb-2">
              <ModeIcon svg={mode.icon} className="w-6 h-6 text-cc-primary" />
              <h2 className="font-display text-3xl text-cc-fg tracking-tight">{mode.displayName}</h2>
            </div>
            {mode.showcase?.tagline && (
              <p className="font-chat text-base text-cc-muted/80 italic mb-3">
                {mode.showcase.tagline}
              </p>
            )}
            <p className="text-cc-muted leading-relaxed line-clamp-3">{mode.description}</p>
          </div>

          {/* Highlight list — hover switches carousel */}
          {hasShowcase && (
            <div className="flex flex-col gap-1 mt-4 min-h-0 flex-1 overflow-y-auto">
              {highlights!.map((h, i) => {
                const isActive = i === activeHighlight;
                return (
                  <div
                    key={i}
                    onMouseEnter={() => handleHighlightHover(i)}
                    className={`group flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 cursor-default ${
                      isActive ? "bg-cc-primary/8" : "hover:bg-cc-hover"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200 ${
                      isActive ? "bg-cc-primary" : "bg-cc-muted/40"
                    }`} />
                    <div className="min-w-0">
                      <span className={`text-sm font-medium transition-colors duration-200 ${
                        isActive ? "text-cc-fg" : "text-cc-muted"
                      }`}>
                        {h.title}
                      </span>
                      <div
                        className="overflow-hidden transition-all duration-300 ease-out"
                        style={{
                          maxHeight: isActive ? "5rem" : "0",
                          opacity: isActive ? 1 : 0,
                        }}
                      >
                        <p className="text-xs text-cc-muted/70 mt-0.5 leading-relaxed">
                          {h.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-3 mt-auto pt-4 shrink-0">
            <PrimaryButton onClick={onLaunch} className="py-2.5">
              Launch
            </PrimaryButton>
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
  isLight,
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
  isLight?: boolean;
}) {
  const [launching, setLaunching] = useState(false);
  const [skillUpdate, setSkillUpdate] = useState<{
    currentVersion: string;
    installedVersion: string;
  } | null>(null);
  const [duration, setDuration] = useState(runningProcess ? runningDuration(runningProcess.startedAt) : "");

  useEffect(() => {
    if (!runningProcess) return;
    const interval = setInterval(() => setDuration(runningDuration(runningProcess.startedAt)), 1_000);
    return () => clearInterval(interval);
  }, [runningProcess]);

  const handleClick = async () => {
    if (isRunning && onOpen) {
      onOpen();
      return;
    }
    if (!onResume || launching || skillUpdate) return;
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

  const cardGradient = isLight
    ? "linear-gradient(135deg, rgba(234,88,12,0.05) 0%, rgba(234,88,12,0.015) 100%)"
    : "linear-gradient(135deg, rgba(249,115,22,0.06) 0%, rgba(249,115,22,0.02) 100%)";

  return (
    <div
      onClick={handleClick}
      onMouseMove={(e) => {
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--card-mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--card-my", `${e.clientY - r.top}px`);
      }}
      className={`group relative rounded-xl cursor-pointer transition-all duration-300 ${
        launching ? "opacity-50 pointer-events-none" : ""
      }`}
      style={{ background: cardGradient }}
    >
      {/* Card spotlight on hover */}
      <div
        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: isLight
            ? "radial-gradient(circle 120px at var(--card-mx) var(--card-my), rgba(234,88,12,0.06), transparent 70%)"
            : "radial-gradient(circle 120px at var(--card-mx) var(--card-my), rgba(255,255,255,0.08), transparent 70%)",
        }}
      />

      {/* Inner padding creates the decorative frame */}
      <div className="p-2.5 pb-0">
        {/* Thumbnail / placeholder */}
        <div className={`relative aspect-[16/10] rounded-lg overflow-hidden ${
          isRunning ? "bg-cc-bg/80" : "bg-cc-bg/60"
        }`}>
          {session?.hasThumbnail ? (
            <img
              src={`${getApiBase()}/api/sessions/thumbnail?workspace=${encodeURIComponent(workspace)}&t=${Math.floor(Date.now() / 5000)}`}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ModeIcon svg={icon} className={`w-10 h-10 ${isRunning ? "text-cc-primary/20" : "text-cc-muted/15"}`} />
            </div>
          )}
          {/* Soft vignette — feathers thumbnail edges into card bg */}
          <div className="absolute inset-0 pointer-events-none rounded-lg session-card-vignette" />

        {/* Running badge */}
        {isRunning && (
          <div className={`absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full backdrop-blur-sm ${
            isLight ? "bg-white/60" : "bg-black/50"
          }`}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cc-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cc-primary" />
            </span>
            <span className="text-[10px] font-medium text-cc-primary">{duration}</span>
          </div>
        )}

        {/* Hover actions */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isRunning && onStop && (
            <ConfirmButton
              icon={<svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>}
              label="Stop"
              onConfirm={onStop}
              stopPropagation
            />
          )}
          {!isRunning && onDelete && (
            <ConfirmButton
              icon={<svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" /></svg>}
              label="Remove"
              onConfirm={onDelete}
              stopPropagation
            />
          )}
        </div>
      </div>
      </div>

      {/* Info bar */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ModeIcon svg={icon} className={`w-4 h-4 shrink-0 ${isRunning ? "text-cc-primary/60" : "text-cc-muted/50"}`} />
          <span className="text-sm font-medium text-cc-fg/90 truncate">
            {launching ? "Launching..." : displayName}
          </span>
          {session && !isRunning && (
            <span className="text-[10px] text-cc-muted/40 shrink-0 ml-auto">{timeAgo(session.lastAccessed)}</span>
          )}
        </div>
        <p className="text-[10px] text-cc-muted/40 font-mono truncate mt-0.5 pl-6">
          {shortenPath(workspace, homeDir)}
        </p>
      </div>

      {/* Skill update prompt */}
      {skillUpdate && (
        <div className="absolute inset-x-0 bottom-0 p-3 bg-cc-surface/95 backdrop-blur-sm border-t border-cc-primary/20" onClick={(e) => e.stopPropagation()}>
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

// ── CompactSessionRow (for recent non-running sessions) ──────────────────

function CompactSessionRow({
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
  const [launching, setLaunching] = useState(false);
  const [skillUpdate, setSkillUpdate] = useState<{ currentVersion: string; installedVersion: string } | null>(null);

  const handleClick = async () => {
    if (launching || skillUpdate) return;
    setLaunching(true);
    try {
      const res = await fetch(`${getApiBase()}/api/launch/skill-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specifier: session.mode, workspace: session.workspace }),
      });
      const data = await res.json();
      if (data.needsUpdate && !data.dismissed) {
        setSkillUpdate({ currentVersion: data.currentVersion, installedVersion: data.installedVersion });
        setLaunching(false);
        return;
      }
      await onResume(!data.needsUpdate || data.dismissed);
    } catch {
      await onResume();
    }
    setLaunching(false);
  };

  return (
    <div
      onClick={handleClick}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-cc-hover/50 transition-colors ${
        launching ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-cc-surface/60">
        <ModeIcon svg={icon} className="w-4 h-4 text-cc-muted/40" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-cc-fg/90 truncate block">
          {launching ? "Launching..." : session.displayName}
        </span>
        <p className="text-[10px] text-cc-muted/40 font-mono truncate">{shortenPath(session.workspace, homeDir)}</p>
      </div>
      <span className="text-[10px] text-cc-muted/40 shrink-0">{timeAgo(session.lastAccessed)}</span>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <ConfirmButton
          icon={<svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" /></svg>}
          label="Remove"
          onConfirm={onDelete}
          stopPropagation
        />
      </div>

      {/* Skill update inline */}
      {skillUpdate && (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="text-[10px] text-cc-primary font-medium">v{skillUpdate.installedVersion} → v{skillUpdate.currentVersion}</span>
          <button
            onClick={async () => { setSkillUpdate(null); setLaunching(true); await onResume(true); setLaunching(false); }}
            className="text-[10px] text-cc-muted hover:text-cc-fg cursor-pointer"
          >
            Skip
          </button>
          <button
            onClick={async () => { setSkillUpdate(null); setLaunching(true); await onResume(false); setLaunching(false); }}
            className="text-[10px] text-cc-primary font-medium cursor-pointer"
          >
            Update
          </button>
        </div>
      )}
    </div>
  );
}

// ── AllSessions (full-screen overlay) ────────────────────────────────────

function AllSessions({
  items,
  homeDir,
  iconMap,
  onClose,
  onResume,
  onDelete,
  className,
  closing,
  headerHeight = 0,
}: {
  items: Array<{ key: string; session?: RecentSession; process?: ChildProcess; type: "running" | "recent"; modeName: string }>;
  homeDir: string;
  iconMap: Record<string, string>;
  onClose: () => void;
  onResume: (session: RecentSession, skipSkill?: boolean) => Promise<void>;
  onDelete: (id: string) => void;
  className?: string;
  closing?: boolean;
  headerHeight?: number;
}) {
  const isLight = className?.includes("launcher-light") ?? false;
  return (
    <div
      className={`fixed left-0 right-0 bottom-0 z-50 bg-cc-bg overflow-y-auto font-body ${className || ""}`}
      style={{
        top: headerHeight,
        animation: `${closing ? "overlayFadeOut" : "overlayFadeIn"} 0.2s ease-out${closing ? " forwards" : ""}`,
      }}
    >
      <div className="sticky top-0 z-10 bg-cc-bg/80 backdrop-blur-sm border-b border-cc-border/30">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
          <h1 className="font-display text-lg text-cc-fg">All Sessions</h1>
          <span className="text-xs text-cc-muted/50 ml-auto">{items.length} sessions</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Running */}
        {items.some((i) => i.type === "running") && (
          <div className="mb-10">
            <h2 className="text-xs font-medium text-cc-muted/60 uppercase tracking-widest mb-4">Running</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {items.filter((i) => i.type === "running").map((item) => (
                <SessionCard
                  key={item.key}
                  session={item.session}
                  homeDir={homeDir}
                  icon={iconMap[item.modeName]}
                  isRunning
                  isLight={isLight}
                  runningProcess={item.process}
                  onResume={item.session ? (skipSkill) => onResume(item.session!, skipSkill) : undefined}
                  onDelete={item.session ? () => onDelete(item.session!.id) : undefined}
                  onStop={item.process ? () => {
                    fetch(`${getApiBase()}/api/processes/children/${item.process!.pid}/kill`, { method: "POST" });
                    if (item.process!.url && (window as any).pneumaDesktop?.closeModeWindow) {
                      (window as any).pneumaDesktop.closeModeWindow(item.process!.url);
                    }
                  } : undefined}
                  onOpen={item.process ? () => window.open(item.process!.url, "_blank") : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recent */}
        {items.some((i) => i.type === "recent") && (
          <div>
            <h2 className="text-xs font-medium text-cc-muted/60 uppercase tracking-widest mb-4">Recent</h2>
            <div className="flex flex-col gap-0.5">
              {items.filter((i) => i.type === "recent").map((item) => (
                <CompactSessionRow
                  key={item.key}
                  session={item.session!}
                  homeDir={homeDir}
                  icon={iconMap[item.modeName]}
                  onResume={(skipSkill) => onResume(item.session!, skipSkill)}
                  onDelete={() => onDelete(item.session!.id)}
                />
              ))}
            </div>
          </div>
        )}

        {items.length === 0 && (
          <p className="text-center text-cc-muted/60 py-20">No sessions yet.</p>
        )}
      </div>
    </div>
  );
}

// ── QuickStartTile ───────────────────────────────────────────────────────

function QuickStartTile({
  name,
  displayName,
  description,
  icon,
  isModeMaker,
  onClick,
}: {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  isModeMaker?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-3 p-5 rounded-xl transition-all duration-200 cursor-pointer ${
        isModeMaker
          ? "bg-cc-primary/5 border border-cc-primary/15 hover:border-cc-primary/30 hover:bg-cc-primary/8"
          : "bg-cc-surface/30 hover:bg-cc-surface/60 border border-transparent hover:border-cc-border/30"
      }`}
    >
      <div className={`w-11 h-11 flex items-center justify-center rounded-lg transition-all duration-200 ${
        isModeMaker
          ? "bg-cc-primary/10 text-cc-primary group-hover:scale-105"
          : "bg-cc-primary/8 text-cc-primary/70 group-hover:text-cc-primary group-hover:scale-105"
      }`}>
        <ModeIcon svg={icon || (isModeMaker ? MODE_MAKER_ICON : undefined)} className="w-5 h-5" />
      </div>
      <div className="text-center">
        <span className={`text-xs font-medium block transition-colors ${
          isModeMaker
            ? "text-cc-primary"
            : "text-cc-fg/80 group-hover:text-cc-fg"
        }`}>
          {displayName}
        </span>
        {description && (
          <span className="text-[10px] text-cc-muted/40 mt-0.5 block leading-tight line-clamp-2">{description}</span>
        )}
      </div>
    </button>
  );
}

// ── ModeMakerHero ─────────────────────────────────────────────────────────

function ModeMakerHero({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="group relative rounded-xl overflow-hidden border border-cc-border/20 hover:border-cc-border/40 transition-colors duration-300 cursor-pointer"
    >
      {/* Galaxy — z-[1] so it receives mouse events */}
      <div className="absolute inset-0 z-[1]">
        <Galaxy
          density={0.3}
          speed={0.05}
          saturation={0.15}
          hueShift={30}
          glowIntensity={0.5}
          twinkleIntensity={0}
          rotationSpeed={0.002}
          mouseRepulsion={true}
          repulsionStrength={5}
          transparent={false}
        />
      </div>
      {/* Content — pointer-events-none so Galaxy gets mouse events */}
      <div className="relative z-[2] pointer-events-none flex items-center gap-6 px-7 py-6"
        style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.6)" }}
      >
        <div className="w-12 h-12 flex items-center justify-center rounded-xl
          bg-black/30 backdrop-blur-sm
          transition-all duration-300 group-hover:scale-105 shrink-0">
          <ModeIcon svg={MODE_MAKER_ICON} className="w-6 h-6 text-cc-primary drop-shadow-[0_0_4px_rgba(249,115,22,0.5)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-white">Mode Maker</h3>
          <p className="text-sm text-white/70 mt-0.5">
            Build, test, and publish your own Pneuma modes — or fork an existing one to make it yours.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-sm text-cc-primary/80 group-hover:text-cc-primary transition-all duration-300 drop-shadow-[0_0_4px_rgba(249,115,22,0.3)] group-hover:drop-shadow-[0_0_12px_rgba(249,115,22,0.7)]">
          <span className="font-semibold">Create</span>
          <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ── ModeGallery (full-screen overlay) ────────────────────────────────────

function ModeGallery({
  modes,
  onClose,
  onLaunch,
  onEdit,
  onEvolve,
  onDeleteLocal,
  className,
  closing,
  headerHeight = 0,
}: {
  modes: AnyMode[];
  onClose: () => void;
  onLaunch: (mode: AnyMode) => void;
  onEdit?: (mode: AnyMode) => void;
  onEvolve?: (mode: AnyMode) => void;
  onDeleteLocal?: (name: string) => void;
  className?: string;
  closing?: boolean;
  headerHeight?: number;
}) {
  const [search, setSearch] = useState("");
  const [expandedMode, setExpandedMode] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isLight = className?.includes("launcher-light") ?? false;

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
      className={`fixed left-0 right-0 bottom-0 z-50 bg-cc-bg overflow-y-auto font-body ${className || ""}`}
      style={{
        top: headerHeight,
        animation: `${closing ? "overlayFadeOut" : "overlayFadeIn"} 0.2s ease-out${closing ? " forwards" : ""}`,
      }}
    >
      {/* Sub-header */}
      <div className="sticky top-0 z-10 bg-cc-bg/80 backdrop-blur-sm border-b border-cc-border/30">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
          <h1 className="font-display text-lg text-cc-fg">Mode Gallery</h1>
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
      <div className="max-w-6xl mx-auto px-6 py-8" ref={ref}>
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
                {group.items.map((mode) => {
                  // mode-maker and evolve themselves don't get edit/evolve buttons
                  const isToolMode = mode.name === "mode-maker" || mode.name === "evolve";
                  const modeKey = `${mode.source}::${mode.name}`;
                  return (
                    <GalleryModeCard
                      key={modeKey}
                      mode={mode}
                      expanded={expandedMode === modeKey}
                      onToggle={() => setExpandedMode(expandedMode === modeKey ? null : modeKey)}
                      onLaunch={() => onLaunch(mode)}
                      onEdit={!isToolMode && onEdit ? () => onEdit(mode) : undefined}
                      onEvolve={!isToolMode && onEvolve ? () => onEvolve(mode) : undefined}
                      onDelete={mode.source === "local" && onDeleteLocal ? () => onDeleteLocal(mode.name) : undefined}
                      isLight={isLight}
                    />
                  );
                })}
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
  onEdit,
  onEvolve,
  onDelete,
  isLight,
}: {
  mode: AnyMode;
  expanded: boolean;
  onToggle: () => void;
  onLaunch: () => void;
  onEdit?: () => void;
  onEvolve?: () => void;
  onDelete?: () => void;
  isLight?: boolean;
}) {
  const [activeHighlight, setActiveHighlight] = useState(0);
  const [evolveHovered, setEvolveHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const evolveRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [glowPos, setGlowPos] = useState<{ x: number; y: number } | null>(null);
  const highlights = mode.showcase?.highlights;
  const hasShowcase = highlights && highlights.length > 0;

  // Measure content height for smooth expand/collapse
  useEffect(() => {
    if (!contentRef.current) return;
    const measure = () => {
      if (contentRef.current) setContentHeight(contentRef.current.scrollHeight);
    };
    if (expanded) {
      // Ensure content is rendered at height:0, then animate to measured height
      requestAnimationFrame(measure);
      // Re-measure after images load
      const imgs = contentRef.current.querySelectorAll("img");
      imgs.forEach((img) => {
        if (!img.complete) img.addEventListener("load", measure, { once: true });
      });
    } else {
      setContentHeight(0);
    }
  }, [expanded]);

  const handleEvolveEnter = () => {
    setEvolveHovered(true);
    if (evolveRef.current && cardRef.current) {
      const card = cardRef.current.getBoundingClientRect();
      const btn = evolveRef.current.getBoundingClientRect();
      setGlowPos({
        x: btn.left + btn.width / 2 - card.left,
        y: btn.top + btn.height / 2 - card.top,
      });
    }
  };

  return (
    <div
      ref={cardRef}
      className={`launcher-card rounded-xl overflow-hidden relative ${
        evolveHovered
          ? "border border-cc-primary/50 shadow-[0_0_20px_rgba(249,115,22,0.2),0_0_6px_rgba(249,115,22,0.15)]"
          : "border border-cc-border/30 hover:border-cc-border/60"
      }`}
      style={{ transition: "border-color 0.3s, box-shadow 0.3s" }}
    >
      {/* Evolve hover — animated radial glow from icon center */}
      {onEvolve && evolveHovered && glowPos && (
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            background: isLight
              ? `radial-gradient(circle at ${glowPos.x}px ${glowPos.y}px, rgba(194,65,12,0.08) 0%, rgba(194,65,12,0.03) var(--evolve-glow), transparent var(--evolve-glow))`
              : `radial-gradient(circle at ${glowPos.x}px ${glowPos.y}px, rgba(249,115,22,0.12) 0%, rgba(249,115,22,0.04) var(--evolve-glow), transparent var(--evolve-glow))`,
            animation: "evolveRadialExpand 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          }}
        />
      )}
      {/* Header row — always visible */}
      <div
        className="relative z-[2] flex items-center gap-4 px-5 py-4 cursor-pointer"
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
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-cc-muted/40 font-mono">{mode.source !== "builtin" ? mode.version : ""}</span>

          {/* Evolve button */}
          {onEvolve && (
            <button
              ref={evolveRef}
              onClick={(e) => { e.stopPropagation(); onEvolve(); }}
              onMouseEnter={handleEvolveEnter}
              onMouseLeave={() => setEvolveHovered(false)}
              className="p-1.5 rounded-md text-cc-muted/40 hover:text-cc-fg transition-colors cursor-pointer"
              title="Evolve skill"
            >
              <ModeIcon svg={EVOLVE_ICON} className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Edit in Mode Maker */}
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1.5 rounded-md text-cc-muted/40 hover:text-cc-primary hover:bg-cc-primary/10 transition-colors cursor-pointer"
              title="Edit in Mode Maker"
            >
              <ModeIcon svg={MODE_MAKER_ICON} className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Delete — local only */}
          {onDelete && (
            <ConfirmButton
              icon={
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              }
              label="Delete"
              onConfirm={onDelete}
              stopPropagation
            />
          )}
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
      <div
        className="overflow-hidden"
        style={{
          height: contentHeight,
          transition: "height 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div ref={contentRef}>
          <div className="relative z-[2] border-t border-cc-border/20 px-5 py-5">
            {hasShowcase ? (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                {/* Carousel */}
                <div className="md:col-span-3 aspect-video">
                  <ShowcaseCarousel
                    highlights={highlights}
                    modeName={mode.name}
                    activeIndex={activeHighlight}
                    onIndexChange={setActiveHighlight}
                    isLight={isLight}
                  />
                </div>
                {/* Highlight list */}
                <div className="md:col-span-2 flex flex-col gap-1.5">
                  {highlights!.map((h, i) => (
                    <div
                      key={i}
                      onMouseEnter={() => setActiveHighlight(i)}
                      className={`px-3 py-2 rounded-md transition-all duration-200 cursor-default ${
                        i === activeHighlight ? "bg-cc-primary/8" : "hover:bg-cc-hover"
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
              <div className="flex items-center gap-4 py-2">
                <ModeIcon svg={mode.icon} className="w-10 h-10 text-cc-muted/20 shrink-0" />
                <div>
                  <p className="text-sm text-cc-muted/80 leading-relaxed">{mode.description}</p>
                  {mode.source === "local" && mode.path && (
                    <p className="text-[11px] text-cc-muted/40 font-mono mt-1">{mode.path}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
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
      className="absolute left-0 right-0 top-full mt-1 z-50 bg-cc-surface border border-cc-border/60 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.25)] overflow-hidden"
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
        <PrimaryButton size="sm" className="shrink-0 rounded-md" onClick={() => { onSelect(currentPath); onClose(); }}>
          Select
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── LaunchDialog ──────────────────────────────────────────────────────────

function LaunchDialog({
  specifier,
  displayName,
  description,
  icon,
  showcase,
  defaultWorkspace,
  defaultInitParams,
  homeDir,
  onClose,
  closing,
}: {
  specifier: string;
  displayName: string;
  description?: string;
  icon?: string;
  showcase?: BuiltinMode["showcase"];
  defaultWorkspace?: string;
  defaultInitParams?: Record<string, string>;
  homeDir: string;
  onClose: () => void;
  closing?: boolean;
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
  const { resolved: dialogTheme } = useTheme();
  const isLight = dialogTheme === "light";

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

  const [activeHighlight, setActiveHighlight] = useState(0);
  const highlights = showcase?.highlights;
  const hasShowcase = highlights && highlights.length > 0;
  const heroUrl = showcase?.hero ? `${getApiBase()}/api/modes/${specifier}/showcase/${showcase.hero}` : null;

  // Auto-cycle highlights
  useEffect(() => {
    if (!highlights || highlights.length <= 1) return;
    const timer = setInterval(() => setActiveHighlight((i) => (i + 1) % highlights.length), 5000);
    return () => clearInterval(timer);
  }, [highlights]);

  // ── Form section (shared between layouts) ──
  const formContent = (
    <>
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
    </>
  );

  const actionButtons = (
    <div className="flex gap-3 justify-end">
      <button
        onClick={onClose}
        className="px-5 py-2 text-sm rounded-lg border border-cc-border/50 text-cc-muted hover:text-cc-fg hover:border-cc-border transition-all duration-200 cursor-pointer"
      >
        Cancel
      </button>
      <PrimaryButton onClick={handleLaunch} disabled={loading || preparing}>
        {loading ? "Launching..." : "Launch"}
      </PrimaryButton>
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 font-body"
      style={{ animation: `${closing ? "overlayFadeOut" : "overlayFadeIn"} 0.2s ease-out${closing ? " forwards" : ""}` }}
    >
      <div
        className={`launcher-card-elevated bg-cc-surface border border-cc-border/50 rounded-2xl overflow-hidden w-full mx-4 ${
          hasShowcase ? "max-w-5xl" : "max-w-lg"
        }`}
        style={{ animation: "launcherFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {hasShowcase ? (
          /* ── Wide layout: showcase left + form right, fixed height ── */
          <div className="flex h-[560px]">
            {/* Left: showcase panel */}
            <div className="w-1/2 relative bg-cc-bg/60 flex items-center justify-center overflow-hidden">
              {/* Images — object-contain to preserve aspect ratio */}
              {highlights!.map((item, i) => {
                const url = `${getApiBase()}/api/modes/${specifier}/showcase/${item.media}`;
                return (
                  <img
                    key={item.media}
                    src={url}
                    alt={item.title}
                    className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] object-contain rounded transition-opacity duration-500"
                    style={{ opacity: i === activeHighlight ? 1 : 0 }}
                  />
                );
              })}
              {/* Bottom gradient for text */}
              <div
                className="absolute inset-x-0 bottom-0 h-28 pointer-events-none"
                style={{
                  background: isLight
                    ? "linear-gradient(to top, rgba(245,240,235,0.9), rgba(245,240,235,0.5) 40%, transparent)"
                    : "linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.3) 40%, transparent)",
                }}
              />
              {/* Highlight info + dots */}
              <div className="absolute bottom-0 left-0 right-0 p-5 z-10">
                <h3 className={`text-sm font-semibold mb-0.5 ${isLight ? "text-cc-fg" : "text-white"}`}>{highlights![activeHighlight]?.title}</h3>
                <p className={`text-xs leading-relaxed line-clamp-2 ${isLight ? "text-cc-muted" : "text-white/70"}`}>{highlights![activeHighlight]?.description}</p>
                {highlights!.length > 1 && (
                  <div className="flex gap-1.5 mt-2.5">
                    {highlights!.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveHighlight(i)}
                        className={`h-1 rounded-full transition-all duration-300 cursor-pointer ${
                          i === activeHighlight
                            ? `w-5 ${isLight ? "bg-cc-fg" : "bg-white"}`
                            : `w-1.5 ${isLight ? "bg-cc-fg/20 hover:bg-cc-fg/40" : "bg-white/30 hover:bg-white/50"}`
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Right: form panel — header top, form centered, buttons pinned */}
            <div className="w-1/2 flex flex-col min-h-0">
              <div className="flex items-center justify-between px-6 pt-6 shrink-0">
                <div className="flex items-center gap-3">
                  <ModeIcon svg={icon} className="w-8 h-8 text-cc-primary" />
                  <div>
                    <h2 className="font-display text-lg text-cc-fg">{displayName}</h2>
                    {showcase?.tagline && (
                      <p className="text-xs text-cc-muted/60 mt-0.5">{showcase.tagline}</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 flex flex-col justify-center">
                <div>{formContent}</div>
              </div>
              <div className="shrink-0 px-6 py-5 border-t border-cc-border/20">
                {actionButtons}
              </div>
            </div>
          </div>
        ) : (
          /* ── Compact layout: mode header + form ── */
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-8 pt-8">
              <div className="flex items-center gap-3">
                <ModeIcon svg={icon} className="w-8 h-8 text-cc-primary" />
                <div>
                  <h2 className="font-display text-xl text-cc-fg">{displayName}</h2>
                  {description && (
                    <p className="text-sm text-cc-muted/70 mt-0.5">{description}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="px-8 pt-5">
              {formContent}
            </div>
            <div className="px-8 py-6 border-t border-cc-border/20 mt-4">
              {actionButtons}
            </div>
          </div>
        )}
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
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<{
    specifier: string;
    displayName: string;
    description?: string;
    icon?: string;
    showcase?: BuiltinMode["showcase"];
    defaultWorkspace?: string;
    defaultInitParams?: Record<string, string>;
  } | null>(null);

  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    if (!headerRef.current) return;
    const ro = new ResizeObserver(([e]) => setHeaderH(e.contentRect.height));
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  const galleryAnim = useAnimatedMount(showGallery);
  const allSessionsAnim = useAnimatedMount(showAllSessions);
  const launchAnim = useAnimatedMount(launchTarget !== null);
  const lastLaunchTarget = useRef(launchTarget);
  if (launchTarget) lastLaunchTarget.current = launchTarget;

  const hasOverlay = showGallery || showAllSessions || launchTarget !== null;

  // Lock body scroll when any overlay is open
  useEffect(() => {
    if (!hasOverlay) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [hasOverlay]);

  // Escape key closes the topmost overlay
  useEffect(() => {
    if (!hasOverlay) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (launchTarget) setLaunchTarget(null);
        else if (showGallery) setShowGallery(false);
        else if (showAllSessions) setShowAllSessions(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasOverlay, launchTarget, showGallery, showAllSessions]);

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
    const interval = setInterval(() => {
      refreshRunning();
      refreshSessions();
    }, 3000);
    return () => clearInterval(interval);
  }, [refreshRunning, refreshSessions]);

  // Refresh sessions + running when tab regains focus (picks up new thumbnails)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshSessions();
        refreshRunning();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refreshSessions, refreshRunning]);

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

  const stopProcess = useCallback(async (pid: number, url?: string) => {
    try {
      await fetch(`${getApiBase()}/api/processes/children/${pid}/kill`, { method: "POST" });
      // In Electron, close the corresponding session window
      if (url && (window as any).pneumaDesktop?.closeModeWindow) {
        (window as any).pneumaDesktop.closeModeWindow(url);
      }
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
        // Refresh first so the running card animates in, then open after animation
        refreshSessions();
        refreshRunning();
        setTimeout(() => window.open(data.url, "_blank"), 400);
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

  // Merge sessions + running for the "Continue" section (max 3 on homepage)
  const runningWorkspaces = new Set(running.map((r) => r.workspace));
  const allContinueItems = [
    // Running processes first
    ...running.map((proc) => ({
      type: "running" as const,
      key: proc.workspace,
      process: proc,
      session: sessions.find((s) => s.workspace === proc.workspace),
      modeName: proc.specifier.split("/").pop() || proc.specifier,
    })),
    // Then recent sessions (not currently running)
    ...sessions
      .filter((s) => !runningWorkspaces.has(s.workspace))
      .map((s) => ({
        type: "recent" as const,
        key: s.workspace,
        session: s,
        process: undefined as ChildProcess | undefined,
        modeName: s.mode,
      })),
  ];
  const continueItems = allContinueItems.slice(0, 3);

  // Featured mode — random builtin with showcase, picked once on first data load
  const featuredIndexRef = useRef<number | null>(null);
  const featuredMode: AnyMode | undefined = React.useMemo(() => {
    const withShowcase = builtins.filter((m) => m.showcase?.highlights?.length);
    if (withShowcase.length === 0) {
      const first = builtins[0];
      if (!first) return undefined;
      return { ...first, source: "builtin" as const, specifier: first.name };
    }
    if (featuredIndexRef.current === null) {
      featuredIndexRef.current = Math.floor(Math.random() * withShowcase.length);
    }
    const pick = withShowcase[featuredIndexRef.current % withShowcase.length];
    return { ...pick, source: "builtin" as const, specifier: pick.name };
  }, [builtins]);

  // All modes for gallery
  const allModes: AnyMode[] = React.useMemo(() => [
    ...builtins.map((m) => ({ ...m, source: "builtin" as const, specifier: m.name })),
    ...local.map((m) => ({ ...m, source: "local" as const, specifier: m.path })),
    ...published.map((m) => ({ ...m, source: "published" as const, specifier: m.archiveUrl })),
  ], [builtins, local, published]);

  // All modes for quick start (exclude featured, add mode-maker at end)
  const quickStartModes = React.useMemo(() => {
    const modes = allModes.filter((m) => m.name !== "mode-maker" && m.name !== "evolve");
    return modes;
  }, [allModes, featuredMode]);

  const handleGalleryLaunch = (mode: AnyMode) => {
    setShowGallery(false);
    setLaunchTarget({
      specifier: mode.specifier,
      displayName: mode.displayName,
      description: mode.description,
      icon: mode.icon,
      showcase: mode.showcase,
    });
  };

  const hasContinueItems = continueItems.length > 0;

  return (
    <div className={`min-h-screen bg-cc-bg text-cc-fg font-body relative ${isLight ? "launcher-light" : ""}`}>
      {/* Light mode texture overlay */}
      {isLight && <div className="fixed inset-0 pointer-events-none launcher-light-texture" />}
      {/* Subtle warm ambient */}
      <div
        className="fixed top-[-20%] left-[10%] w-[50%] h-[50%] pointer-events-none"
        style={{
          background: isLight
            ? "radial-gradient(ellipse, oklch(85% 0.02 55 / 0.12) 0%, transparent 65%)"
            : "radial-gradient(ellipse, oklch(50% 0.08 55 / 0.06) 0%, transparent 70%)",
        }}
      />
      {/* Secondary warm glow — bottom right for light mode depth */}
      {isLight && (
        <div
          className="fixed bottom-[-10%] right-[5%] w-[40%] h-[40%] pointer-events-none"
          style={{
            background: "radial-gradient(ellipse, oklch(88% 0.02 35 / 0.08) 0%, transparent 60%)",
          }}
        />
      )}

      {/* Header — sticky above overlays, draggable in Electron */}
      <div ref={headerRef} className="sticky top-0 z-[60] bg-cc-bg/80 backdrop-blur-md" style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)", WebkitAppRegion: "drag" } as React.CSSProperties}>
      <header
        className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between"
        style={(window as any).pneumaDesktop ? { paddingLeft: "5rem" } : undefined}
      >
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Pneuma"
            draggable={false}
            className="w-9 h-9 rounded-lg"
            style={isLight ? { filter: "brightness(0.85) saturate(1.2)" } : undefined}
          />
          <span className="font-logo text-2xl text-cc-fg tracking-tight select-none">Pneuma</span>
        </div>
        <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <div className={`flex items-center gap-1 transition-transform duration-300 ease-out ${hasOverlay ? "" : "translate-x-5"}`}>
            <ThemeToggle preference={themePref} onClick={cycleTheme} />
            <a
              href="https://github.com/pandazki/pneuma-skills"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-cc-muted/70 hover:text-cc-fg transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
          </div>
          <button
            onClick={() => { setShowGallery(false); setShowAllSessions(false); setLaunchTarget(null); }}
            className={`p-2 text-cc-muted/50 hover:text-cc-fg transition-all duration-300 ease-out cursor-pointer ${
              hasOverlay ? "opacity-100 translate-x-0 scale-100" : "opacity-0 translate-x-3 scale-75 pointer-events-none"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>
      </div>

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
                description: featuredMode.description,
                icon: featuredMode.icon,
                showcase: featuredMode.showcase,
              })}
              onExplore={() => setShowGallery(true)}
            />
          )}

          {/* Continue — max 3, running as cards, recent as compact rows */}
          {hasContinueItems && (
            <section
              className="mb-10 pt-8 border-t border-cc-border"
              style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both" }}
            >
              <div className="flex items-baseline justify-between mb-5">
                <h2 className="text-sm font-medium text-cc-fg/70 tracking-wide">Continue</h2>
                {allContinueItems.length > 3 && (
                  <button
                    onClick={() => setShowAllSessions(true)}
                    className="text-xs text-cc-muted/50 hover:text-cc-fg transition-colors cursor-pointer"
                  >
                    All Sessions ({allContinueItems.length})
                  </button>
                )}
              </div>
              <LayoutGroup>
                {/* Running items — thumbnail cards with ChromaGrid spotlight */}
                <AnimatePresence mode="popLayout">
                  {continueItems.some((i) => i.type === "running") && (
                    <motion.div
                      key="running-section"
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
                      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                      className="mb-3"
                    >
                      <ChromaGridWrap radius={250}>
                        <AnimatePresence mode="popLayout">
                          {continueItems.filter((i) => i.type === "running").map((item) => (
                            <motion.div
                              key={item.key}
                              layout
                              initial={{ opacity: 0, scale: 0.92, y: 16 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -8 }}
                              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                            >
                              <SessionCard
                                session={item.session}
                                homeDir={homeDir}
                                icon={iconMap[item.modeName]}
                                isRunning
                                isLight={isLight}
                                runningProcess={item.process}
                                onResume={item.session ? (skipSkill) => directLaunch(item.session!.mode, item.session!.workspace, skipSkill) : undefined}
                                onDelete={item.session ? () => deleteSession(item.session!.id) : undefined}
                                onStop={item.process ? () => stopProcess(item.process!.pid, item.process!.url) : undefined}
                                onOpen={item.process ? () => window.open(item.process!.url, "_blank") : undefined}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </ChromaGridWrap>
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Recent items — compact list */}
                <AnimatePresence mode="popLayout">
                  {continueItems.filter((i) => i.type === "recent").map((item) => (
                    <motion.div
                      key={item.key}
                      layout
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 12, transition: { duration: 0.15 } }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    >
                      <CompactSessionRow
                        session={item.session!}
                        homeDir={homeDir}
                        icon={iconMap[item.modeName]}
                        onResume={(skipSkill) => directLaunch(item.session!.mode, item.session!.workspace, skipSkill)}
                        onDelete={() => deleteSession(item.session!.id)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </LayoutGroup>
            </section>
          )}

          {/* Quick Start */}
          <section className="pt-12" style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both" }}>
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <h2 className="text-sm font-medium text-cc-fg/70 tracking-wide">Create New</h2>
                <p className="text-xs text-cc-muted/50 mt-1">Start a fresh workspace</p>
              </div>
              <button
                onClick={() => setShowGallery(true)}
                className="text-xs text-cc-muted/50 hover:text-cc-fg transition-colors cursor-pointer"
              >
                All Modes ({allModes.length})
              </button>
            </div>
            <WarmSpotlightWrap gridClass="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3" radius={160}>
              {quickStartModes.map((mode) => (
                <QuickStartTile
                  key={mode.name}
                  name={mode.name}
                  displayName={mode.displayName}
                  description={mode.description}
                  icon={mode.icon}
                  onClick={() => setLaunchTarget({
                    specifier: mode.specifier,
                    displayName: mode.displayName,
                    description: mode.description,
                    icon: mode.icon,
                    showcase: mode.showcase,
                  })}
                />
              ))}
            </WarmSpotlightWrap>

            {/* Mode Maker — prominent hero card */}
            <div className="mt-6">
              <ModeMakerHero
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
      {galleryAnim.mounted && (
        <ModeGallery
          modes={allModes}
          onClose={() => setShowGallery(false)}
          onLaunch={handleGalleryLaunch}
          onEdit={(mode) => {
            setShowGallery(false);
            const workspace = mode.path || undefined;
            setLaunchTarget({
              specifier: "mode-maker",
              displayName: `Edit: ${mode.displayName}`,
              defaultWorkspace: workspace,
            });
          }}
          onEvolve={(mode) => {
            setShowGallery(false);
            const workspace = mode.path || undefined;
            setLaunchTarget({
              specifier: "evolve",
              displayName: `Evolve: ${mode.displayName}`,
              defaultWorkspace: workspace,
              defaultInitParams: { targetMode: mode.name },
            });
          }}
          onDeleteLocal={deleteLocalMode}
          className={isLight ? "launcher-light" : ""}
          closing={galleryAnim.closing}
          headerHeight={headerH}
        />
      )}

      {/* All Sessions overlay */}
      {allSessionsAnim.mounted && (
        <AllSessions
          items={allContinueItems}
          homeDir={homeDir}
          iconMap={iconMap}
          onClose={() => setShowAllSessions(false)}
          onResume={async (session, skipSkill) => {
            setShowAllSessions(false);
            await directLaunch(session.mode, session.workspace, skipSkill);
          }}
          onDelete={(id) => deleteSession(id)}
          className={isLight ? "launcher-light" : ""}
          closing={allSessionsAnim.closing}
          headerHeight={headerH}
        />
      )}

      {/* Launch Dialog */}
      {launchAnim.mounted && lastLaunchTarget.current && (
        <LaunchDialog
          specifier={lastLaunchTarget.current.specifier}
          displayName={lastLaunchTarget.current.displayName}
          description={lastLaunchTarget.current.description}
          icon={lastLaunchTarget.current.icon}
          showcase={lastLaunchTarget.current.showcase}
          defaultWorkspace={lastLaunchTarget.current.defaultWorkspace}
          defaultInitParams={lastLaunchTarget.current.defaultInitParams}
          homeDir={homeDir}
          onClose={() => setLaunchTarget(null)}
          closing={launchAnim.closing}
        />
      )}
    </div>
  );
}
