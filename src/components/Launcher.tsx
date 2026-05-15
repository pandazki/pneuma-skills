import React, { useState, useEffect, useCallback, useRef } from "react";
import { getApiBase } from "../utils/api.js";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import SpotlightCard from "./reactbits/SpotlightCard";
import Galaxy from "./reactbits/Galaxy";
import { CreateProjectDialog } from "./CreateProjectDialog.js";
import { DirBrowser } from "./DirBrowser.js";
import { ProjectCard, type ProjectCardEntry } from "./ProjectCard.js";
import { ModeIcon } from "./ModeIcon.js";
import { InitParamForm, type InitParamWithAutoFill } from "./InitParamForm.js";
import { useAnimatedMount } from "../utils/useAnimatedMount.js";
import { timeAgo, runningDuration } from "../utils/timeAgo.js";
import { shortenPath } from "../utils/string.js";
import type { InitParam } from "../../core/types/mode-manifest.js";
import type { InstalledLibrary } from "../../core/types/library.js";

export type BackendType = "claude-code" | "codex" | "kimi-cli";

export interface BackendOption {
  type: BackendType;
  label: string;
  description: string;
  implemented: boolean;
  available?: boolean;
  reason?: string;
}

export const FALLBACK_BACKENDS: BackendOption[] = [
  {
    type: "claude-code",
    label: "Claude Code",
    description: "Anthropic Claude Code CLI via stdio stream-json transport.",
    implemented: true,
    available: true,
  },
  {
    type: "codex",
    label: "Codex",
    description: "OpenAI Codex CLI via app-server transport.",
    implemented: true,
    available: true,
  },
  {
    type: "kimi-cli",
    label: "Kimi",
    description: "Moonshot AI Kimi Code CLI via stdio stream-json transport.",
    implemented: true,
    available: true,
  },
];

interface BuiltinMode {
  name: string;
  displayName: string;
  description: string;
  version: string;
  type: "builtin";
  hasInitParams?: boolean;
  icon?: string;
  inspiredBy?: { name: string; url: string };
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
  /** Set when this mode comes from an installed library (vs single-mode install). */
  librarySource?: { id: string; name: string; displayName?: string };
  /** True when the library's manifestVersion is ahead of installedVersion. */
  updateAvailable?: boolean;
}

interface RecentSession {
  id: string;
  mode: string;
  displayName: string;
  sessionName?: string;
  workspace: string;
  backendType: BackendType;
  lastAccessed: number;
  hasThumbnail?: boolean;
  hasReplayData?: boolean;
  editing?: boolean;
  layout?: "editor" | "app";
}

interface ProjectListEntry {
  id: string;
  root: string;
  name: string;
  displayName: string;
  description?: string;
  lastAccessed: number;
  createdAt: number;
  /** Number of sessions discovered under `<root>/.pneuma/sessions/`. */
  sessionCount: number;
  /** Sorted unique mode names across the project's sessions. */
  modeBreakdown: string[];
  /** URL (relative to API base) for the project cover, when one exists. */
  coverImageUrl?: string;
}

interface ChildProcess {
  pid: number;
  specifier: string;
  workspace: string;
  url: string;
  startedAt: number;
  /** Relative URL of this session's thumbnail.png, when one exists (from /api/running). */
  thumbnailUrl?: string;
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
  inspiredBy?: BuiltinMode["inspiredBy"];
  /** Propagated from LocalMode for library-sourced modes (chip on tiles). */
  librarySource?: { id: string; name: string; displayName?: string };
};

// ── Theme ────────────────────────────────────────────────────────────────

type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// ── InspiredByTag ─────────────────────────────────────────────────────────

function getUrlIcon(url: string) {
  if (url.includes("github.com")) return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
  );
  if (url.includes("x.com") || url.includes("twitter.com")) return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
  );
  return null;
}

function InspiredByTag({ name, url, className = "" }: { name: string; url: string; className?: string }) {
  const icon = getUrlIcon(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-cc-muted/60 hover:text-cc-muted bg-cc-surface/30 hover:bg-cc-surface/50 border border-cc-border/20 transition-colors ${className}`}
      onClick={(e) => e.stopPropagation()}
      title={`Inspired by ${name}`}
    >
      {icon}
      <span className="opacity-60">inspired by</span>
      <span>{name}</span>
    </a>
  );
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

// `ModeIcon` + `FALLBACK_SVG` live in `./ModeIcon.tsx` so panels outside
// the launcher (e.g. ProjectPanel's mode tile grid) can render the same
// icon-with-fallback pattern. The Mode Maker / Evolve glyphs are launcher-
// scoped and stay here.
const MODE_MAKER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>`;
const EVOLVE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1.5 0-2.5 1-3 2-.5-1-1.5-2-3-2C4 3 2 5 2 7c0 3 4 6 6 8 .5-.5 1.5-1.5 2-2"/><path d="M12 3c1.5 0 2.5 1 3 2 .5-1 1.5-2 3-2 2 0 4 2 4 4 0 3-4 6-6 8-.5-.5-1.5-1.5-2-2"/><path d="M12 21v-8"/><path d="M9 18l3-3 3 3"/></svg>`;

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


export function backendLabel(backendType: BackendType): string {
  switch (backendType) {
    case "claude-code": return "Claude";
    case "codex": return "Codex";
    case "kimi-cli": return "Kimi";
  }
}

export function BackendLogo({ type, className }: { type: BackendType; className?: string }) {
  if (type === "claude-code") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.303 3.073a.75.75 0 01.573.88l-1.97 10.236a5.156 5.156 0 01-1.402 2.776l-2.2 2.279a.75.75 0 01-1.08 0l-2.2-2.279a5.156 5.156 0 01-1.402-2.776L5.652 3.953a.75.75 0 011.476-.284l1.97 10.236a3.656 3.656 0 00.994 1.968L12 17.878l1.908-2.005a3.656 3.656 0 00.994-1.968l1.97-10.236a.75.75 0 01.431-.596z" />
      </svg>
    );
  }
  if (type === "kimi-cli") {
    // Kimi — crescent moon (evokes Moonshot AI without using brand assets)
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  // Codex — terminal-style icon
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3M4.5 19.5h15a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5h-15A1.5 1.5 0 003 6v12a1.5 1.5 0 001.5 1.5z" />
    </svg>
  );
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
              {mode.inspiredBy && <InspiredByTag name={mode.inspiredBy.name} url={mode.inspiredBy.url} />}
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
  onReplay,
  onStop,
  onOpen,
  onRename,
  isLight,
  backendUnavailableReason,
}: {
  session?: RecentSession;
  homeDir: string;
  icon?: string;
  isRunning?: boolean;
  runningProcess?: ChildProcess;
  onResume?: (skipSkill?: boolean) => Promise<void>;
  onDelete?: () => void;
  onReplay?: () => void;
  onStop?: () => void;
  onOpen?: () => void;
  onRename?: (name: string) => void;
  isLight?: boolean;
  backendUnavailableReason?: string;
}) {
  const [launching, setLaunching] = useState(false);
  const [skillUpdate, setSkillUpdate] = useState<{
    currentVersion: string;
    installedVersion: string;
    highlights?: { version: string; bullets: string[] }[];
    changelogUrl?: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [duration, setDuration] = useState(runningProcess ? runningDuration(runningProcess.startedAt) : "");

  useEffect(() => {
    if (!runningProcess) return;
    const interval = setInterval(() => setDuration(runningDuration(runningProcess.startedAt)), 1_000);
    return () => clearInterval(interval);
  }, [runningProcess]);

  const handleClick = async () => {
    if (backendUnavailableReason) return;
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
        setSkillUpdate({
          currentVersion: data.currentVersion,
          installedVersion: data.installedVersion,
          highlights: data.highlights,
          changelogUrl: data.changelogUrl,
        });
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

  const displayName = session?.sessionName || session?.displayName || runningProcess?.specifier.split("/").pop() || "Unknown";
  const workspace = session?.workspace || runningProcess?.workspace || "";

  // Thumbnail: prefer the URL the server resolved (works for project sessions
  // too), else the quick-session convention. `t=` is a coarse cache-buster so
  // a freshly-recaptured thumbnail.png shows up without a hard reload.
  const thumbPath =
    runningProcess?.thumbnailUrl ??
    (session?.hasThumbnail ? `/api/sessions/thumbnail?workspace=${encodeURIComponent(workspace)}` : undefined);
  const thumbSrc = thumbPath
    ? `${getApiBase()}${thumbPath}${thumbPath.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 5000)}`
    : undefined;

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
          {thumbSrc ? (
            <img
              src={thumbSrc}
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

        {/* Backend unavailable overlay */}
        {backendUnavailableReason && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-lg">
            <div className="text-center px-4">
              <svg className="w-6 h-6 text-red-400 mx-auto mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-red-300 font-medium">{backendUnavailableReason}</p>
            </div>
          </div>
        )}

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
          {!isRunning && onReplay && (
            <button
              onClick={(e) => { e.stopPropagation(); onReplay(); }}
              className="p-1.5 rounded-md bg-black/40 backdrop-blur-sm text-cc-muted/70 hover:text-cc-primary hover:bg-black/60 transition-colors cursor-pointer"
              title="Replay"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M4.5 2.5a.75.75 0 011.2-.6l8 6a.75.75 0 010 1.2l-8 6a.75.75 0 01-1.2-.6v-12z" /></svg>
            </button>
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
          {editing ? (
            <input
              autoFocus
              className="flex-1 min-w-0 text-sm font-medium text-cc-fg/90 bg-transparent border-b border-cc-primary/50 outline-none px-0 py-0"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                const trimmed = editValue.trim();
                if (trimmed && trimmed !== displayName && onRename) onRename(trimmed);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setEditValue(displayName); setEditing(false); }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium text-cc-fg/90 truncate">
              {launching ? "Launching..." : displayName}
            </span>
          )}
          {!editing && session && !isRunning && onRename && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditValue(displayName); setEditing(true); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-cc-muted/40 hover:text-cc-primary transition-all cursor-pointer shrink-0"
              title="Rename"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L3.464 11.1a.25.25 0 00-.064.108l-.457 1.6 1.6-.457a.25.25 0 00.108-.064l8.609-8.609a.25.25 0 000-.354l-1.086-1.086z" /></svg>
            </button>
          )}
          {!editing && session && !isRunning && (
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
          {skillUpdate.highlights && skillUpdate.highlights.length > 0 && (
            <div className="mt-2 pt-2 border-t border-cc-border/30 max-h-28 overflow-y-auto">
              <ul className="space-y-0.5">
                {skillUpdate.highlights.flatMap((h) =>
                  h.bullets.map((b, i) => (
                    <li key={`${h.version}-${i}`} className="text-[10px] text-cc-muted/80 leading-snug flex gap-1.5">
                      <span className="text-cc-primary/70 shrink-0">·</span>
                      <span className="truncate" title={b}>{b}</span>
                    </li>
                  )),
                )}
              </ul>
              {skillUpdate.changelogUrl && (
                <a
                  href={skillUpdate.changelogUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-[10px] text-cc-primary hover:underline"
                >
                  View full changelog →
                </a>
              )}
            </div>
          )}
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
  onReplay,
  onRename,
  backendUnavailableReason,
}: {
  session: RecentSession;
  homeDir: string;
  icon?: string;
  onResume: (skipSkill?: boolean) => Promise<void>;
  onDelete: () => void;
  onReplay?: () => void;
  onRename?: (name: string) => void;
  backendUnavailableReason?: string;
}) {
  const [launching, setLaunching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [skillUpdate, setSkillUpdate] = useState<{
    currentVersion: string;
    installedVersion: string;
    highlights?: { version: string; bullets: string[] }[];
    changelogUrl?: string;
  } | null>(null);
  const [highlightsOpen, setHighlightsOpen] = useState(false);

  const handleClick = async () => {
    if (backendUnavailableReason || launching || skillUpdate) return;
    setLaunching(true);
    try {
      const res = await fetch(`${getApiBase()}/api/launch/skill-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specifier: session.mode, workspace: session.workspace }),
      });
      const data = await res.json();
      if (data.needsUpdate && !data.dismissed) {
        setSkillUpdate({
          currentVersion: data.currentVersion,
          installedVersion: data.installedVersion,
          highlights: data.highlights,
          changelogUrl: data.changelogUrl,
        });
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
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
        backendUnavailableReason
          ? "opacity-50 cursor-not-allowed"
          : launching
            ? "opacity-50 pointer-events-none"
            : "cursor-pointer hover:bg-cc-hover/50"
      }`}
      title={backendUnavailableReason || undefined}
    >
      <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-cc-surface/60">
        <ModeIcon svg={icon} className="w-4 h-4 text-cc-muted/40" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {editing ? (
            <input
              autoFocus
              className="flex-1 min-w-0 text-sm font-medium text-cc-fg/90 bg-transparent border-b border-cc-primary/50 outline-none px-0 py-0"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                const trimmed = editValue.trim();
                if (trimmed && trimmed !== (session.sessionName || session.displayName) && onRename) onRename(trimmed);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setEditValue(session.sessionName || session.displayName); setEditing(false); }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium text-cc-fg/90 truncate block">
              {launching ? "Launching..." : (session.sessionName || session.displayName)}
            </span>
          )}
          {!editing && onRename && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditValue(session.sessionName || session.displayName); setEditing(true); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-cc-muted/40 hover:text-cc-primary transition-all cursor-pointer shrink-0"
              title="Rename"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L3.464 11.1a.25.25 0 00-.064.108l-.457 1.6 1.6-.457a.25.25 0 00.108-.064l8.609-8.609a.25.25 0 000-.354l-1.086-1.086z" /></svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] px-1 py-0.5 rounded uppercase tracking-wide shrink-0 ${
            backendUnavailableReason
              ? "bg-red-500/10 text-red-400"
              : "bg-cc-surface/80 text-cc-muted/60"
          }`}>
            {backendLabel(session.backendType)}
          </span>
          <p className="text-[10px] text-cc-muted/40 font-mono truncate">{shortenPath(session.workspace, homeDir)}</p>
        </div>
      </div>
      <span className="text-[10px] text-cc-muted/40 shrink-0">{timeAgo(session.lastAccessed)}</span>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        {onReplay && (
          <button
            onClick={(e) => { e.stopPropagation(); onReplay(); }}
            className="p-1 rounded text-cc-muted/50 hover:text-cc-primary transition-colors cursor-pointer"
            title="Replay"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M4.5 2.5a.75.75 0 011.2-.6l8 6a.75.75 0 010 1.2l-8 6a.75.75 0 01-1.2-.6v-12z" /></svg>
          </button>
        )}
        <ConfirmButton
          icon={<svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" /></svg>}
          label="Remove"
          onConfirm={onDelete}
          stopPropagation
        />
      </div>

      {/* Skill update inline */}
      {skillUpdate && (
        <div className="flex items-center gap-2 relative" onClick={(e) => e.stopPropagation()}>
          <span className="text-[10px] text-cc-primary font-medium">v{skillUpdate.installedVersion} → v{skillUpdate.currentVersion}</span>
          {skillUpdate.highlights && skillUpdate.highlights.length > 0 && (
            <button
              onClick={() => setHighlightsOpen((v) => !v)}
              className="text-[10px] text-cc-muted hover:text-cc-fg cursor-pointer flex items-center gap-0.5"
              title="What's new"
            >
              What's new
              <svg viewBox="0 0 16 16" fill="currentColor" className={`w-2.5 h-2.5 transition-transform ${highlightsOpen ? "rotate-180" : ""}`}><path d="M3.22 5.97a.75.75 0 011.06 0L8 9.69l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L3.22 7.03a.75.75 0 010-1.06z" /></svg>
            </button>
          )}
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
          {highlightsOpen && skillUpdate.highlights && skillUpdate.highlights.length > 0 && (
            <div className="absolute right-0 top-full mt-1 z-20 w-72 max-h-60 overflow-y-auto rounded-lg border border-cc-border/50 bg-cc-surface/98 backdrop-blur-md shadow-lg p-2.5">
              <div className="text-[10px] font-semibold text-cc-primary uppercase tracking-wider mb-1.5">
                What's new in v{skillUpdate.currentVersion}
              </div>
              <ul className="space-y-1">
                {skillUpdate.highlights.flatMap((h) =>
                  h.bullets.map((b, i) => (
                    <li key={`${h.version}-${i}`} className="text-[11px] text-cc-fg/80 leading-snug flex gap-1.5">
                      <span className="text-cc-primary/70 shrink-0">·</span>
                      <span>{b}</span>
                    </li>
                  )),
                )}
              </ul>
              {skillUpdate.changelogUrl && (
                <a
                  href={skillUpdate.changelogUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[10px] text-cc-primary hover:underline"
                >
                  View full changelog →
                </a>
              )}
            </div>
          )}
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
  onReplay,
  onRename,
  getBackendUnavailableReason,
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
  onReplay: (session: RecentSession) => void;
  onRename: (id: string, name: string) => void;
  getBackendUnavailableReason: (type: BackendType) => string | undefined;
  className?: string;
  closing?: boolean;
  headerHeight?: number;
}) {
  const isLight = className?.includes("launcher-light") ?? false;
  const [search, setSearch] = useState("");
  const query = search.toLowerCase().trim();
  const filtered = query
    ? items.filter((i) => {
        const s = i.session;
        if (!s) return i.process?.specifier.toLowerCase().includes(query);
        return (s.sessionName || "").toLowerCase().includes(query)
          || s.displayName.toLowerCase().includes(query)
          || s.workspace.toLowerCase().includes(query)
          || s.mode.toLowerCase().includes(query);
      })
    : items;
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
          <div className="flex-1 max-w-xs ml-4">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cc-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                placeholder="Search sessions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-cc-input-bg border border-cc-border/50 rounded-lg text-cc-fg placeholder:text-cc-muted/40 focus:outline-none focus:border-cc-primary/50"
              />
            </div>
          </div>
          <span className="text-xs text-cc-muted/50 ml-auto">{filtered.length}{query ? ` / ${items.length}` : ""} sessions</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Running */}
        {filtered.some((i) => i.type === "running") && (
          <div className="mb-10">
            <h2 className="text-xs font-medium text-cc-muted/60 uppercase tracking-widest mb-4">Running</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.filter((i) => i.type === "running").map((item) => (
                <SessionCard
                  key={item.key}
                  session={item.session}
                  homeDir={homeDir}
                  icon={iconMap[item.modeName]}
                  isRunning
                  isLight={isLight}
                  runningProcess={item.process}
                  backendUnavailableReason={item.session ? getBackendUnavailableReason(item.session.backendType) : undefined}
                  onResume={item.session ? (skipSkill) => onResume(item.session!, skipSkill) : undefined}
                  onDelete={item.session ? () => onDelete(item.session!.id) : undefined}
                  onReplay={item.session?.hasReplayData ? () => onReplay(item.session!) : undefined}
                  onRename={item.session ? (name) => onRename(item.session!.id, name) : undefined}
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
        {filtered.some((i) => i.type === "recent") && (
          <div>
            <h2 className="text-xs font-medium text-cc-muted/60 uppercase tracking-widest mb-4">Recent</h2>
            <div className="flex flex-col gap-0.5">
              {filtered.filter((i) => i.type === "recent").map((item) => (
                <CompactSessionRow
                  key={item.key}
                  session={item.session!}
                  homeDir={homeDir}
                  icon={iconMap[item.modeName]}
                  onResume={(skipSkill) => onResume(item.session!, skipSkill)}
                  onDelete={() => onDelete(item.session!.id)}
                  onReplay={item.session!.hasReplayData ? () => onReplay(item.session!) : undefined}
                  onRename={(name) => onRename(item.session!.id, name)}
                  backendUnavailableReason={getBackendUnavailableReason(item.session!.backendType)}
                />
              ))}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <p className="text-center text-cc-muted/60 py-20">{query ? "No matching sessions." : "No sessions yet."}</p>
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
  librarySource,
  onClick,
}: {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  isModeMaker?: boolean;
  /** When set, a small "from {lib}" chip is rendered at the top-right. */
  librarySource?: { id: string; name: string; displayName?: string };
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col items-center gap-3 p-5 rounded-xl transition-all duration-200 cursor-pointer ${
        isModeMaker
          ? "bg-cc-primary/5 border border-cc-primary/15 hover:border-cc-primary/30 hover:bg-cc-primary/8"
          : "bg-cc-surface/30 hover:bg-cc-surface/60 border border-transparent hover:border-cc-border/30"
      }`}
    >
      {librarySource && (
        <span
          className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[9px] rounded-full bg-cc-fg/5 text-cc-muted/60 border border-cc-border/30 truncate max-w-[90%]"
          title={`from library: ${librarySource.displayName || librarySource.name}`}
        >
          from {librarySource.displayName || librarySource.name}
        </span>
      )}
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
  onAddFromUrl,
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
  onAddFromUrl?: () => void;
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
          { label: "Built-in", items: builtin, alwaysShow: false },
          // Local always renders its header when an install action exists, so users can
          // still reach "Add from URL" before they've installed anything.
          { label: "Local", items: local, alwaysShow: !!onAddFromUrl },
          { label: "Published", items: published, alwaysShow: false },
        ]
          .filter((g) => g.items.length > 0 || g.alwaysShow)
          .map((group) => (
            <div key={group.label} className="mb-12">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xs font-medium text-cc-muted/60 uppercase tracking-widest">{group.label}</h2>
                {group.label === "Local" && onAddFromUrl && (
                  <button
                    onClick={onAddFromUrl}
                    className="text-[10px] text-cc-muted hover:text-cc-primary transition-colors cursor-pointer flex items-center gap-1"
                    title="Install a mode from a URL or github:user/repo"
                  >
                    <span className="text-sm leading-none">+</span>
                    <span>Add from URL</span>
                  </button>
                )}
              </div>
              {group.items.length === 0 && group.label === "Local" ? (
                <p className="text-[11px] text-cc-muted/50 italic">No local modes yet — paste a .tar.gz URL or <code className="text-cc-muted/70">github:user/repo</code> above.</p>
              ) : null}
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
            {mode.inspiredBy && <InspiredByTag name={mode.inspiredBy.name} url={mode.inspiredBy.url} />}
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

// ── LaunchDialog ──────────────────────────────────────────────────────────

function LaunchDialog({
  specifier,
  displayName,
  description,
  icon,
  showcase,
  inspiredBy,
  defaultWorkspace,
  defaultInitParams,
  forkSource,
  backendOptions,
  defaultBackendType,
  homeDir,
  onClose,
  closing,
}: {
  specifier: string;
  displayName: string;
  description?: string;
  icon?: string;
  showcase?: BuiltinMode["showcase"];
  inspiredBy?: BuiltinMode["inspiredBy"];
  defaultWorkspace?: string;
  defaultInitParams?: Record<string, string>;
  /** When set, append a `forkSource=` param to the launched URL so the
   *  landed mode-maker viewer auto-forks the named mode into the new
   *  empty workspace. Used by gallery "Edit" which means "start a mode
   *  package seeded from an existing mode". */
  forkSource?: { sourceMode?: string; sourcePath?: string };
  backendOptions: BackendOption[];
  defaultBackendType: BackendType;
  homeDir: string;
  onClose: () => void;
  closing?: boolean;
}) {
  const safeName = /[\\/]/.test(specifier) ? specifier.split(/[\\/]/).filter(Boolean).pop()! : specifier;
  const timeTag = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  const fallback = homeDir
    ? `${homeDir.replace(/[\\/]+$/, "")}/pneuma-projects/${safeName}-${timeTag}`
    : `~/pneuma-projects/${safeName}-${timeTag}`;
  const defaultSessionName = `${safeName}-${timeTag}`;
  const [workspace, setWorkspace] = useState(defaultWorkspace || fallback);
  const [sessionNameValue, setSessionNameValue] = useState(defaultSessionName);
  const [initParams, setInitParams] = useState<InitParam[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string | number>>({});
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [selectedBackendType, setSelectedBackendType] = useState<BackendType>(() => {
    // Auto-select first available backend if default isn't available
    const defaultAvail = backendOptions.find((b) => b.type === defaultBackendType);
    if (defaultAvail?.available !== false) return defaultBackendType;
    const firstAvail = backendOptions.find((b) => b.available && b.implemented);
    return firstAvail?.type ?? defaultBackendType;
  });
  const [existingSession, setExistingSession] = useState<{
    mode: string;
    backendType: BackendType;
    config: Record<string, string | number>;
  } | null>(null);
  const { resolved: dialogTheme } = useTheme();
  const isLight = dialogTheme === "light";

  const checkWorkspace = useCallback(async (path: string) => {
    setWorkspace(path);
    setExistingSession(null);
    try {
      const res = await fetch(`${getApiBase()}/api/workspace-check?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.hasSession) {
        const backendType = (data.backendType || defaultBackendType) as BackendType;
        setExistingSession({ mode: data.mode, backendType, config: data.config || {} });
        setSelectedBackendType(backendType);
        if (data.config && Object.keys(data.config).length > 0) {
          setParamValues(data.config);
        }
      } else {
        setSelectedBackendType(defaultBackendType);
      }
    } catch { }
  }, [defaultBackendType]);

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
          // Server pre-fills defaults from stored API keys
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
          backendType: existingSession?.backendType || selectedBackendType,
          sessionName: sessionNameValue.trim() || undefined,
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
        // Append forkSource query param so the mode-maker viewer auto-forks
        // the named mode into this (otherwise empty) workspace on first load.
        let urlToOpen = data.url;
        if (forkSource && (forkSource.sourceMode || forkSource.sourcePath)) {
          try {
            const u = new URL(urlToOpen);
            if (forkSource.sourceMode) u.searchParams.set("forkSource", forkSource.sourceMode);
            if (forkSource.sourcePath) u.searchParams.set("forkSourcePath", forkSource.sourcePath);
            urlToOpen = u.toString();
          } catch { /* fallback to original url on URL parse failure */ }
        }
        window.open(urlToOpen, "_blank");
        setLoading(false);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
      setLoading(false);
    }
  }, [specifier, workspace, selectedBackendType, existingSession, paramValues, onClose, forkSource]);

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

      {!existingSession && (
        <>
          <label className="block text-sm text-cc-muted mb-1">Session name</label>
          <input
            type="text"
            value={sessionNameValue}
            onChange={(e) => setSessionNameValue(e.target.value)}
            className="w-full px-3 py-2 mb-4 bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg text-sm focus:outline-none focus:border-cc-primary/50"
            placeholder={defaultSessionName}
          />
        </>
      )}

      {preparing && (
        <p className="text-sm text-cc-muted mb-4">Loading configuration...</p>
      )}

      {backendOptions.length > 1 && (
        <div className="mb-4">
          <label className="block text-xs text-cc-muted/60 mb-2">Agent</label>
          <div className="flex gap-2">
            {backendOptions.map((backend) => {
              const active = (existingSession?.backendType || selectedBackendType) === backend.type;
              const unavailable = !backend.implemented || backend.available === false;
              const disabled = !!existingSession || unavailable;
              return (
                <button
                  key={backend.type}
                  type="button"
                  disabled={disabled}
                  title={unavailable ? (backend.reason || "Not available") : backend.label}
                  onClick={() => setSelectedBackendType(backend.type)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                    active && !unavailable
                      ? "border-cc-primary/50 bg-cc-primary/10 text-cc-fg"
                      : unavailable
                        ? "border-cc-border/30 bg-cc-surface/20 text-cc-muted/40"
                        : "border-cc-border bg-cc-input-bg text-cc-muted hover:text-cc-fg hover:border-cc-border"
                  } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <BackendLogo type={backend.type} className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{backend.label}</span>
                  {unavailable && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-400 uppercase tracking-wide leading-none">
                      {!backend.implemented ? "Soon" : "N/A"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {existingSession && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-cc-primary/5 border border-cc-primary/15">
          <svg className="w-4 h-4 text-cc-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-cc-primary">
            Existing workspace — will resume {backendLabel(existingSession.backendType)} session
          </span>
        </div>
      )}

      {initParams.length > 0 && !defaultWorkspace && (
        <div className="mb-4 space-y-3">
          <p className="text-sm font-medium text-cc-fg">
            Parameters
            {existingSession && <span className="text-xs text-cc-muted font-normal ml-2">(read-only)</span>}
          </p>
          <InitParamForm
            params={initParams as InitParamWithAutoFill[]}
            values={paramValues}
            onChange={setParamValues}
            disabled={!!existingSession}
          />
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
      // `py-12` reserves 48px at top + bottom so the centered dialog never
      // slides under the Electron traffic-light buttons (drawn over the
      // content area by `titleBarStyle: "hiddenInset"`). Harmless extra
      // breathing room in plain browser.
      className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 font-body py-12"
      style={{ animation: `${closing ? "overlayFadeOut" : "overlayFadeIn"} 0.2s ease-out${closing ? " forwards" : ""}` }}
    >
      <div
        className={`launcher-card-elevated bg-cc-surface border border-cc-border/50 rounded-2xl overflow-hidden w-full mx-4 flex flex-col max-h-full ${
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
              <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <ModeIcon svg={icon} className="w-8 h-8 text-cc-primary" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-lg text-cc-fg">{displayName}</h2>
                      {inspiredBy && <InspiredByTag name={inspiredBy.name} url={inspiredBy.url} />}
                    </div>
                    {showcase?.tagline && (
                      <p className="text-xs text-cc-muted/60 mt-0.5">{showcase.tagline}</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {formContent}
              </div>
              <div className="shrink-0 px-6 py-5 border-t border-cc-border/20">
                {actionButtons}
              </div>
            </div>
          </div>
        ) : (
          /* ── Compact layout: mode header + scrollable form + pinned actions ── */
          <div className="flex flex-col flex-1 min-h-0">
            {/* Pinned header — only icon + title, kept compact so it never
                grows past one line. Description used to live here but if
                it was long (5+ lines on e.g. guizang-ppt) the `shrink-0`
                header exceeded the viewport height and the outer card's
                `overflow-hidden` clipped the title from the top. */}
            <div className="flex items-center justify-between px-8 pt-8 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <ModeIcon svg={icon} className="w-8 h-8 text-cc-primary shrink-0" />
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="font-display text-xl text-cc-fg truncate">{displayName}</h2>
                  {inspiredBy && <InspiredByTag name={inspiredBy.name} url={inspiredBy.url} />}
                </div>
              </div>
            </div>
            {/* Scroll here, not the whole dialog — keeps the action bar
                visible when a mode declares many init params or has a long
                description that together overflow the viewport. */}
            <div className="flex-1 overflow-y-auto px-8 pt-5 min-h-0">
              {description && (
                <p className="text-sm text-cc-muted/70 mb-5">{description}</p>
              )}
              {formContent}
            </div>
            <div className="shrink-0 px-8 py-6 border-t border-cc-border/20 mt-4">
              {actionButtons}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings Panel (slide-out) ────────────────────────────────────────────

function BackendsSection() {
  const [backends, setBackends] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${getApiBase()}/api/backends`)
      .then((r) => r.json())
      .then((data) => setBackends(data.backends || []))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Backends</h3>
      <div className="space-y-2">
        {backends.map((b: any) => (
          <div key={b.type} className="flex items-center justify-between p-3 rounded-lg border border-cc-border bg-cc-surface/30">
            <div>
              <div className="text-sm text-cc-fg">{b.label}</div>
              <div className="text-[10px] text-cc-muted mt-0.5">{b.description}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${b.available ? "bg-cc-success" : "bg-cc-muted/30"}`} />
              <span className="text-[10px] text-cc-muted">{b.available ? "Ready" : "Not found"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiKeysSection() {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [addingName, setAddingName] = useState("");
  const [addingValue, setAddingValue] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const refreshKeys = useCallback(() => {
    fetch(`${getApiBase()}/api/keys`)
      .then((r) => r.json())
      .then((data) => setKeys(data.keys || {}))
      .catch(() => {});
  }, []);

  useEffect(() => { refreshKeys(); }, [refreshKeys]);

  const saveKey = async (name: string, value: string) => {
    await fetch(`${getApiBase()}/api/keys/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    refreshKeys();
    setAddingName("");
    setAddingValue("");
    setShowAddForm(false);
  };

  const removeKey = async (name: string) => {
    await fetch(`${getApiBase()}/api/keys/${encodeURIComponent(name)}`, { method: "DELETE" });
    refreshKeys();
  };

  const keyEntries = Object.entries(keys);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">API Keys</h3>
        {!showAddForm && (
          <button onClick={() => setShowAddForm(true)} className="text-[10px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">+ Add</button>
        )}
      </div>
      <p className="text-[10px] text-cc-muted/60 leading-relaxed">
        Keys are stored locally on your machine (encrypted). When a project needs a matching key name, it will be auto-imported.
      </p>

      {keyEntries.length > 0 && (
        <div className="space-y-2">
          {keyEntries.map(([name, maskedValue]) => (
            <div key={name} className="flex items-center justify-between p-3 rounded-lg border border-cc-border bg-cc-surface/30">
              <div>
                <div className="text-xs text-cc-fg font-mono">{name}</div>
                <div className="text-[10px] text-cc-muted mt-0.5">{maskedValue}</div>
              </div>
              <button onClick={() => removeKey(name)} className="text-[10px] text-cc-muted/50 hover:text-cc-error transition-colors cursor-pointer">Remove</button>
            </div>
          ))}
        </div>
      )}

      {keyEntries.length === 0 && !showAddForm && (
        <div className="text-[10px] text-cc-muted/40 py-2">No keys configured yet.</div>
      )}

      {showAddForm && (
        <div className="p-3 rounded-lg border border-cc-border bg-cc-surface/30 space-y-2">
          <input
            autoFocus
            placeholder="Key name (e.g. OPENROUTER_API_KEY)"
            value={addingName}
            onChange={(e) => setAddingName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
            className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg font-mono placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
          />
          <input
            type="password"
            placeholder="Value"
            value={addingValue}
            onChange={(e) => setAddingValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addingName && addingValue && saveKey(addingName, addingValue)}
            className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
          />
          <div className="flex gap-2">
            <button onClick={() => addingName && addingValue && saveKey(addingName, addingValue)}
              disabled={!addingName || !addingValue}
              className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer">Save</button>
            <button onClick={() => { setShowAddForm(false); setAddingName(""); setAddingValue(""); }}
              className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CloudStorageSection() {
  const [status, setStatus] = useState<"loading" | "configured" | "unconfigured" | "editing">("loading");
  const [config, setConfig] = useState<any>(null);
  const [form, setForm] = useState({ accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "pneuma-playground", publicUrl: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${getApiBase()}/api/r2/config`)
      .then((r) => r.json())
      .then((data) => {
        if (data.configured) { setConfig(data); setStatus("configured"); }
        else setStatus("unconfigured");
      })
      .catch(() => setStatus("unconfigured"));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${getApiBase()}/api/r2/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const resp = await fetch(`${getApiBase()}/api/r2/config`);
      const data = await resp.json();
      setConfig(data); setStatus("configured");
    } catch { }
    setSaving(false);
  };

  if (status === "loading") return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Cloud Storage</h3>
        {status === "configured" && (
          <button onClick={() => { setForm({ accountId: config?.accountId || "", accessKeyId: "", secretAccessKey: "", bucket: config?.bucket || "pneuma-playground", publicUrl: config?.publicUrl || "" }); setStatus("editing"); }}
            className="text-[10px] text-cc-muted/50 hover:text-cc-fg transition-colors cursor-pointer">Edit</button>
        )}
      </div>
      <p className="text-[10px] text-cc-muted/60 leading-relaxed">
        Cloudflare R2 storage for sharing and snapshots. You manage your own bucket — data stays under your control.
      </p>

      {status === "configured" && config && (
        <div className="p-3 rounded-lg border border-cc-border bg-cc-surface/30 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cc-success" />
            <span className="text-xs text-cc-fg">Connected</span>
          </div>
          <div className="text-[10px] text-cc-muted">Bucket: {config.bucket}</div>
          <div className="text-[10px] text-cc-muted truncate">URL: {config.publicUrl}</div>
        </div>
      )}

      {(status === "unconfigured" || status === "editing") && (
        <div className="space-y-3">
          {status === "unconfigured" && (
            <div className="text-[10px] text-cc-muted/60 leading-relaxed">
              Create a Cloudflare R2 bucket with public access at <span className="text-cc-fg">dash.cloudflare.com</span>, then enter credentials below.
            </div>
          )}
          <div className="space-y-2">
            {[
              { key: "accountId", placeholder: "Account ID", type: "text" },
              { key: "accessKeyId", placeholder: "Access Key ID", type: "text" },
              { key: "secretAccessKey", placeholder: "Secret Access Key", type: "password" },
              { key: "bucket", placeholder: "Bucket name", type: "text" },
              { key: "publicUrl", placeholder: "Public URL (e.g. https://pub-xxx.r2.dev)", type: "text" },
            ].map(({ key, placeholder, type }) => (
              <input
                key={key}
                placeholder={placeholder}
                type={type}
                value={(form as any)[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.accountId || !form.accessKeyId || !form.secretAccessKey || !form.publicUrl}
              className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer">
              {saving ? "Saving..." : "Save"}
            </button>
            {status === "editing" && (
              <button onClick={() => setStatus("configured")}
                className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Map plugin names to their launcher status endpoints (legacy routes still in launcher)
const PLUGIN_STATUS_APIS: Record<string, string> = {
  "vercel-deploy": "/api/vercel/status",
  "cf-pages-deploy": "/api/cf-pages/status",
};

function PluginSettingsCard({ plugin }: { plugin: any }) {
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [form, setForm] = useState<Record<string, any>>({});
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<{ available?: boolean; method?: string; user?: string } | null>(null);

  const hasSettings = plugin.settingsSchema && Object.keys(plugin.settingsSchema).length > 0;
  const statusApi = PLUGIN_STATUS_APIS[plugin.name];

  useEffect(() => {
    fetch(`${getApiBase()}/api/plugin-settings/${plugin.name}`).then((r) => r.json()).then((data) => {
      setEnabled(data.enabled ?? false);
      setConfig(data.config ?? {});
      // Merge defaultValues from schema into form for unfilled fields
      const savedConfig = data.config ?? {};
      const merged = { ...savedConfig };
      if (plugin.settingsSchema) {
        for (const [key, schema] of Object.entries(plugin.settingsSchema) as [string, any][]) {
          if (merged[key] === undefined && schema.defaultValue !== undefined) {
            merged[key] = schema.defaultValue;
          }
        }
      }
      setForm(merged);
      setLoaded(true);
    }).catch(() => setLoaded(true));
    // Fetch CLI/connection status for deploy plugins
    if (statusApi) {
      fetch(`${getApiBase()}${statusApi}`).then((r) => r.json()).then((s) => setStatus(s)).catch(() => {});
    }
  }, [plugin.name, statusApi]);

  const toggleEnabled = async (val: boolean) => {
    setEnabled(val);
    try {
      await fetch(`${getApiBase()}/api/plugin-settings/${plugin.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: val, config }),
      });
    } catch { setEnabled(!val); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${getApiBase()}/api/plugin-settings/${plugin.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, config: form }),
      });
      setConfig(form);
    } catch { }
    setSaving(false);
  };

  const maskPassword = (val: string) => {
    if (!val) return "";
    return val.length > 6 ? val.slice(0, 6) + "***" : "***";
  };

  if (!loaded) return null;

  return (
    <div className="p-3 rounded-lg border border-cc-border bg-cc-surface/30 space-y-1.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {hasSettings ? (
            <button onClick={() => setExpanded(!expanded)} className="text-cc-muted hover:text-cc-fg transition-colors cursor-pointer shrink-0">
              <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}>
                <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
              </svg>
            </button>
          ) : <span className="w-3 shrink-0" />}
          <span className={`w-2 h-2 rounded-full shrink-0 ${enabled ? "bg-cc-success" : "bg-cc-muted/30"}`} />
          <span className="text-xs text-cc-fg font-medium truncate">{plugin.displayName}</span>
          <span className="text-[10px] text-cc-muted/60 shrink-0">v{plugin.version}</span>
          {plugin.builtin && <span className="text-[10px] text-cc-muted/40 shrink-0">(Built-in)</span>}
        </div>
        {/* Toggle */}
        <button
          onClick={() => toggleEnabled(!enabled)}
          className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors cursor-pointer ${enabled ? "bg-cc-primary" : "bg-cc-border"}`}
        >
          <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${enabled ? "left-[15px]" : "left-[2px]"}`} />
        </button>
      </div>
      {plugin.description && (
        <p className="text-[10px] text-cc-muted/60 leading-relaxed pl-5">{plugin.description}</p>
      )}

      {/* Connection status for deploy plugins */}
      {status && (
        <div className="flex items-center gap-2 pl-5 pt-1">
          <span className={`w-1.5 h-1.5 rounded-full ${status.available ? "bg-cc-success" : "bg-yellow-500"}`} />
          <span className="text-[10px] text-cc-muted">
            {status.available
              ? `${status.method === "cli" ? "CLI" : "Token"} connected${status.user ? ` as ${status.user}` : ""}`
              : "Not connected — install CLI or configure token below"
            }
          </span>
        </div>
      )}

      {/* Expanded settings form */}
      {expanded && hasSettings && (
        <div className="pt-2 pl-5 space-y-3">
          <div className="space-y-2">
            {Object.entries(plugin.settingsSchema).map(([key, schema]: [string, any]) => {
              if (schema.type === "boolean") {
                return (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form[key] ?? false}
                      onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                      className="accent-cc-primary"
                    />
                    <span className="text-xs text-cc-fg">{schema.label || key}</span>
                    {schema.description && <span className="text-[10px] text-cc-muted/40">{schema.description}</span>}
                  </label>
                );
              }
              if (schema.type === "select") {
                return (
                  <div key={key} className="space-y-1">
                    <label className="text-[10px] text-cc-muted">{schema.label || key}</label>
                    <select
                      value={form[key] ?? ""}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg outline-none focus:border-cc-primary/50 transition-colors"
                    >
                      <option value="">Select...</option>
                      {(schema.options ?? []).map((opt: any) => (
                        <option key={typeof opt === "string" ? opt : opt.value} value={typeof opt === "string" ? opt : opt.value}>
                          {typeof opt === "string" ? opt : opt.label}
                        </option>
                      ))}
                    </select>
                    {schema.description && <p className="text-[10px] text-cc-muted/40">{schema.description}</p>}
                  </div>
                );
              }
              if (schema.type === "textarea") {
                return (
                  <div key={key} className="space-y-1">
                    <label className="text-[10px] text-cc-muted">{schema.label || key}</label>
                    <textarea
                      placeholder={schema.description || key}
                      value={form[key] ?? ""}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors resize-y"
                    />
                    {schema.description && <p className="text-[10px] text-cc-muted/40">{schema.description}</p>}
                  </div>
                );
              }
              // string, password, number
              const inputType = schema.type === "password" ? "password" : schema.type === "number" ? "number" : "text";
              return (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] text-cc-muted">{schema.label || key}</label>
                  <input
                    type={inputType}
                    placeholder={schema.type === "password" && config[key] ? maskPassword(config[key]) : (schema.description || key)}
                    value={form[key] ?? ""}
                    onChange={(e) => setForm({ ...form, [key]: schema.type === "number" ? Number(e.target.value) : e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                  {schema.description && <p className="text-[10px] text-cc-muted/40">{schema.description}</p>}
                </div>
              );
            })}
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

function PluginsSection() {
  const [plugins, setPlugins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${getApiBase()}/api/plugins`).then((r) => r.json()).then((data) => {
      setPlugins(data.plugins ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (plugins.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Plugins</h3>
      <p className="text-[10px] text-cc-muted/60 leading-relaxed">
        Manage installed plugins. Enable or disable plugins and configure their settings.
      </p>
      <div className="space-y-2">
        {plugins.map((plugin) => (
          <PluginSettingsCard key={plugin.name} plugin={plugin} />
        ))}
      </div>
    </div>
  );
}

// ── GitHubSection ─────────────────────────────────────────────────────────
//
// Surfaces `gh` install + auth status inside the launcher SettingsPanel. The
// route is read-only — actionable changes (`brew install gh`, `gh auth login`)
// are copyable snippets the user runs in their own terminal. Polled on mount
// rather than live-watched: the panel reopens often enough that drift isn't
// painful, and `detectGh` shells out to several subprocesses we don't want
// on a timer.

interface GhStatusUI {
  installed: boolean;
  authenticated: boolean;
  username?: string;
  version?: string;
  hint?: string;
}

function CopySnippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked — silent */ }
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cc-fg/5 border border-cc-border/30">
      <code className="flex-1 text-[11px] text-cc-fg/80 font-mono truncate">{text}</code>
      <button
        onClick={handleCopy}
        className="text-[10px] text-cc-muted/60 hover:text-cc-fg transition-colors cursor-pointer whitespace-nowrap"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function GitHubSection() {
  const [status, setStatus] = useState<GhStatusUI | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/github/status`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setStatus(data as GhStatusUI);
      })
      .catch(() => { })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">GitHub</h3>
      <p className="text-[10px] text-cc-muted/60 leading-relaxed">
        Required for creating, syncing, and publishing mode libraries on GitHub.
      </p>
      {loading || !status ? (
        <div className="text-[11px] text-cc-muted/50">Checking gh status…</div>
      ) : !status.installed ? (
        <div className="space-y-2">
          <div className="text-[11px] text-cc-fg/80">GitHub CLI not installed</div>
          {status.hint && (
            <div className="text-[10px] text-cc-muted/60">{status.hint}</div>
          )}
          <CopySnippet text="brew install gh" />
          <a
            href="https://cli.github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[10px] text-cc-primary hover:opacity-80 transition-opacity"
          >
            cli.github.com →
          </a>
        </div>
      ) : !status.authenticated ? (
        <div className="space-y-2">
          <div className="text-[11px] text-cc-fg/80">
            Installed{status.version ? ` (${status.version})` : ""} · Not signed in
          </div>
          {status.hint && (
            <div className="text-[10px] text-cc-muted/60">{status.hint}</div>
          )}
          <CopySnippet text="gh auth login" />
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-cc-fg/80">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]" />
          <span>
            Signed in as <span className="text-cc-fg">@{status.username || "?"}</span>
            {status.version && (
              <span className="text-cc-muted/40"> · gh {status.version}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ── LibraryCard ───────────────────────────────────────────────────────────
//
// One card per installed library. Shows source, counts, and an updates
// pill; clicking the card body expands a per-mode list with activate
// toggles + per-mode update affordances. Action footer: Sync / Publish /
// Unlink (with inline confirm).

function LibraryIcon({ kind, className }: { kind: "github" | "url" | "local"; className?: string }) {
  if (kind === "github") {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    );
  }
  if (kind === "local") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  );
}

function LibraryCard({
  library,
  onPublish,
}: {
  library: InstalledLibrary;
  onPublish: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modeCount = library.modes.length;
  const activatedCount = library.modes.filter((m) => m.activated).length;
  const updateCount = library.modes.filter(
    (m) => m.installedVersion !== m.manifestVersion,
  ).length;

  const sourceKind = library.source.type;
  const sourceUrl =
    library.source.type === "github"
      ? library.source.url
      : library.source.type === "url"
        ? library.source.url
        : "local";

  // Mutations rely on a refetch driven by the `pneuma:libraries-updated`
  // DOM event. The WS-based path (`ws.ts` → broadcastAll → event dispatch)
  // only fires for connected sessions, and the launcher has no session ID
  // so it never registers a WS browser socket — meaning the WS event
  // never reaches it. We dispatch the same event locally after every
  // successful POST so the launcher's own listener refetches; a second
  // browser tab on a real session still gets the WS-driven path
  // independently. Keeping the trigger paths converged on one event name
  // means components don't need to learn a second refresh signal.
  const fireUpdated = () => {
    window.dispatchEvent(new Event("pneuma:libraries-updated"));
  };

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/libraries/${encodeURIComponent(library.id)}/sync`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      fireUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleUnlink = async () => {
    setBusy("unlink");
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/libraries/${encodeURIComponent(library.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      fireUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlink failed");
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (modeName: string, currentlyActive: boolean) => {
    setBusy(`toggle-${modeName}`);
    setError(null);
    try {
      const action = currentlyActive ? "deactivate" : "activate";
      const res = await fetch(
        `${getApiBase()}/api/libraries/${encodeURIComponent(library.id)}/mode/${encodeURIComponent(modeName)}/${action}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      fireUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusy(null);
    }
  };

  const handleAcceptUpdate = async (modeName: string) => {
    setBusy(`update-${modeName}`);
    setError(null);
    try {
      const res = await fetch(
        `${getApiBase()}/api/libraries/${encodeURIComponent(library.id)}/mode/${encodeURIComponent(modeName)}/accept-update`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      fireUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl bg-cc-surface/30 hover:bg-cc-surface/40 border border-cc-border/20 hover:border-cc-border/40 backdrop-blur-sm transition-all duration-200">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 cursor-pointer"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-cc-fg/5 text-cc-muted/70 shrink-0">
            <LibraryIcon kind={sourceKind} className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-cc-fg truncate">
                {library.displayName || library.name}
              </h3>
              {updateCount > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-full bg-cc-primary/15 text-cc-primary border border-cc-primary/25">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-2.5 h-2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l-7.5-7.5M12 19.5l7.5-7.5" />
                  </svg>
                  {updateCount} update{updateCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div
              className="text-[10px] text-cc-muted/50 truncate mt-0.5"
              title={sourceUrl}
            >
              {sourceUrl}
            </div>
            <div className="text-[10px] text-cc-muted/60 mt-1">
              {modeCount} mode{modeCount === 1 ? "" : "s"} · {activatedCount} activated
            </div>
          </div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className={`w-4 h-4 text-cc-muted/40 transition-transform duration-200 shrink-0 ${expanded ? "rotate-180" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-1.5 border-t border-cc-border/20 pt-3">
              {library.modes.length === 0 && (
                <div className="text-[11px] text-cc-muted/50 px-2 py-1">
                  No modes in this library.
                </div>
              )}
              {library.modes.map((m) => {
                const updateAvailable = m.installedVersion !== m.manifestVersion;
                const toggling = busy === `toggle-${m.name}`;
                const updating = busy === `update-${m.name}`;
                return (
                  <div
                    key={m.name}
                    className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-cc-fg/5 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-cc-fg/85 truncate">{m.name}</span>
                        <span className="text-[10px] text-cc-muted/40">v{m.manifestVersion}</span>
                        {updateAvailable && (
                          <button
                            disabled={updating}
                            onClick={(e) => { e.stopPropagation(); void handleAcceptUpdate(m.name); }}
                            className="text-[9px] px-1.5 py-0.5 rounded-full bg-cc-primary/15 text-cc-primary hover:bg-cc-primary/25 border border-cc-primary/25 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            {updating ? "…" : "Update"}
                          </button>
                        )}
                      </div>
                      <div className="text-[10px] text-cc-muted/40 truncate">{m.path}</div>
                    </div>
                    {/* Activate toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={m.activated}
                      disabled={toggling}
                      onClick={(e) => { e.stopPropagation(); void handleToggle(m.name, m.activated); }}
                      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border transition-colors disabled:opacity-50 ${
                        m.activated
                          ? "bg-cc-primary/80 border-cc-primary/40"
                          : "bg-cc-fg/10 border-cc-border/40"
                      }`}
                      title={m.activated ? "Deactivate" : "Activate"}
                    >
                      <span
                        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all duration-150 ${
                          m.activated ? "left-[14px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer actions */}
      <div className="flex items-center gap-1 px-3 py-2 border-t border-cc-border/20">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="p-1.5 rounded-lg text-cc-muted/50 hover:text-cc-fg hover:bg-cc-fg/5 transition-colors cursor-pointer disabled:opacity-40"
          title="Sync library"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onPublish(); }}
          className="p-1.5 rounded-lg text-cc-muted/50 hover:text-cc-fg hover:bg-cc-fg/5 transition-colors cursor-pointer"
          title="Publish a mode to this library"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </button>
        <div className="flex-1" />
        {error && (
          <span className="text-[10px] text-red-400/90 truncate" title={error}>{error}</span>
        )}
        <ConfirmButton
          stopPropagation
          label="Unlink"
          onConfirm={handleUnlink}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

// ── AddLibraryDialog ──────────────────────────────────────────────────────
//
// Two tabs: Link existing (specifier → /api/libraries/link) and Create new
// (name + optional GitHub-side init → /api/libraries/init). Errors render
// inline.

function AddLibraryDialog({
  open,
  onClose,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [mode, setMode] = useState<"link" | "create">("link");
  const [specifier, setSpecifier] = useState("");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [createOnGithub, setCreateOnGithub] = useState(false);
  const [githubName, setGithubName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ kind: "single" | "library"; githubUrl?: string } | null>(null);

  useEffect(() => {
    if (open) {
      setMode("link");
      setSpecifier("");
      setName("");
      setDisplayName("");
      setDescription("");
      setCreateOnGithub(false);
      setGithubName("");
      setVisibility("private");
      setStatus("idle");
      setError("");
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  const handleLink = async () => {
    if (!specifier.trim()) return;
    setStatus("working");
    setError("");
    try {
      const res = await fetch(`${getApiBase()}/api/libraries/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specifier: specifier.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({ kind: data.kind });
      setStatus("done");
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
      setStatus("error");
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setStatus("working");
    setError("");
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (displayName.trim()) body.displayName = displayName.trim();
      if (description.trim()) body.description = description.trim();
      if (createOnGithub && githubName.trim()) {
        body.github = { name: githubName.trim(), visibility };
      }
      const res = await fetch(`${getApiBase()}/api/libraries/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({ kind: "library", githubUrl: data.githubUrl });
      setStatus("done");
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setStatus("error");
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" style={{ animation: "overlayFadeIn 200ms ease" }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="bg-cc-bg border border-cc-border rounded-xl shadow-2xl w-[480px] max-w-[90vw] pointer-events-auto"
          style={{ animation: "warmFadeIn 200ms ease" }}
        >
          <div className="px-5 py-4 border-b border-cc-border">
            <h3 className="text-sm font-semibold text-cc-fg">Add Mode Library</h3>
            <p className="text-[10px] text-cc-muted mt-1">
              Link a multi-mode GitHub repo, or scaffold a new library locally and optionally publish it.
            </p>
            <div className="mt-3 inline-flex rounded-lg border border-cc-border overflow-hidden text-[10px]">
              {(["link", "create"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setStatus("idle"); setError(""); setResult(null); }}
                  className={`px-3 py-1 transition-colors cursor-pointer ${mode === m ? "bg-cc-primary/15 text-cc-primary" : "text-cc-muted hover:text-cc-fg"}`}
                >
                  {m === "link" ? "Link existing" : "Create new"}
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-4 space-y-3">
            {status === "done" && result && (
              <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300/90">
                {result.kind === "single"
                  ? "Linked single-mode repo. It appears under Local Modes."
                  : "Library linked. Activate modes in the card below."}
                {result.githubUrl && (
                  <>
                    {" "}
                    <a href={result.githubUrl} target="_blank" rel="noopener noreferrer" className="text-cc-primary hover:opacity-80 underline underline-offset-2">
                      Open on GitHub →
                    </a>
                  </>
                )}
              </div>
            )}

            {mode === "link" && status !== "done" && (
              <>
                <div>
                  <label className="text-[10px] text-cc-muted block mb-1">Specifier</label>
                  <input
                    autoFocus
                    placeholder="github:user/repo  or  https://.../repo.tar.gz"
                    value={specifier}
                    onChange={(e) => setSpecifier(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLink()}
                    className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                  <p className="text-[10px] text-cc-muted/60 mt-1.5">
                    A repo with a <code className="text-cc-muted">pneuma.library.json</code> at its root (or N mode dirs) installs as a multi-mode library; otherwise it falls back to a single-mode install.
                  </p>
                </div>
              </>
            )}

            {mode === "create" && status !== "done" && (
              <>
                <div>
                  <label className="text-[10px] text-cc-muted block mb-1">Library name (slug)</label>
                  <input
                    autoFocus
                    placeholder="my-modes"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-cc-muted block mb-1">Display name (optional)</label>
                  <input
                    placeholder="My Modes"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-cc-muted block mb-1">Description (optional)</label>
                  <input
                    placeholder="A collection of Pneuma modes for…"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createOnGithub}
                    onChange={(e) => setCreateOnGithub(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#f97316]"
                  />
                  Create on GitHub (requires <code>gh</code> auth)
                </label>
                {createOnGithub && (
                  <div className="pl-5 space-y-2">
                    <div>
                      <label className="text-[10px] text-cc-muted block mb-1">Repo name</label>
                      <input
                        placeholder={name || "my-modes"}
                        value={githubName}
                        onChange={(e) => setGithubName(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-cc-muted block mb-1">Visibility</label>
                      <div className="inline-flex rounded-lg border border-cc-border overflow-hidden text-[10px]">
                        {(["private", "public"] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setVisibility(v)}
                            className={`px-3 py-1 transition-colors cursor-pointer ${visibility === v ? "bg-cc-primary/15 text-cc-primary" : "text-cc-muted hover:text-cc-fg"}`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {status === "error" && error && (
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-300/90">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              >
                {status === "done" ? "Close" : "Cancel"}
              </button>
              {status !== "done" && (
                <button
                  onClick={mode === "link" ? handleLink : handleCreate}
                  disabled={
                    status === "working" ||
                    (mode === "link" ? !specifier.trim() : !name.trim() || (createOnGithub && !githubName.trim() && !name.trim()))
                  }
                  className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 disabled:opacity-40 transition-all cursor-pointer"
                >
                  {status === "working" ? "…" : mode === "link" ? "Link" : "Create"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── PublishToLibraryDialog ────────────────────────────────────────────────
//
// Picks a source mode from the currently installed Local Modes (excluding
// modes that already live in this library) and POSTs to
// /api/libraries/:id/publish. Optional `push: true` triggers a `git push`
// follow-up on the library side.

function PublishToLibraryDialog({
  library,
  localModes,
  onClose,
  onPublished,
}: {
  library: InstalledLibrary | null;
  localModes: LocalMode[];
  onClose: () => void;
  onPublished: () => void;
}) {
  const [sourceName, setSourceName] = useState("");
  const [overrideName, setOverrideName] = useState("");
  const [pushAfter, setPushAfter] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [pushed, setPushed] = useState<boolean | null>(null);

  // Filter: drop modes that already belong to *this* library — publishing
  // them back to the same library is a no-op + likely user confusion.
  const eligible = (library
    ? localModes.filter((m) => m.librarySource?.id !== library.id)
    : []);

  useEffect(() => {
    if (library) {
      setSourceName("");
      setOverrideName("");
      setPushAfter(false);
      setStatus("idle");
      setError("");
      setPushed(null);
    }
  }, [library?.id]);

  if (!library) return null;

  const selected = eligible.find((m) => m.name === sourceName);

  const handlePublish = async () => {
    if (!selected) return;
    setStatus("working");
    setError("");
    try {
      const body: Record<string, unknown> = {
        sourcePath: selected.path,
        push: pushAfter,
      };
      if (overrideName.trim()) body.name = overrideName.trim();
      const res = await fetch(`${getApiBase()}/api/libraries/${encodeURIComponent(library.id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setPushed(data.pushed === true);
      setStatus("done");
      onPublished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
      setStatus("error");
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" style={{ animation: "overlayFadeIn 200ms ease" }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="bg-cc-bg border border-cc-border rounded-xl shadow-2xl w-[440px] max-w-[90vw] pointer-events-auto"
          style={{ animation: "warmFadeIn 200ms ease" }}
        >
          <div className="px-5 py-4 border-b border-cc-border">
            <h3 className="text-sm font-semibold text-cc-fg">Publish to {library.displayName || library.name}</h3>
            <p className="text-[10px] text-cc-muted mt-1">
              Copy an installed local mode into this library and stage it for commit.
            </p>
          </div>
          <div className="px-5 py-4 space-y-3">
            {status === "done" ? (
              <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300/90">
                Published.{pushed ? " Pushed to GitHub." : pushed === false ? " (Not pushed.)" : ""}
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[10px] text-cc-muted block mb-1">Source mode</label>
                  {eligible.length === 0 ? (
                    <div className="text-[11px] text-cc-muted/60">
                      No eligible local modes. Install a mode (or create one with Mode Maker) first.
                    </div>
                  ) : (
                    <select
                      value={sourceName}
                      onChange={(e) => setSourceName(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg outline-none focus:border-cc-primary/50 transition-colors"
                    >
                      <option value="">— pick a mode —</option>
                      {eligible.map((m) => (
                        <option key={m.path} value={m.name}>
                          {m.displayName} ({m.name})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-cc-muted block mb-1">Name override (optional)</label>
                  <input
                    placeholder={selected?.name || "(use source name)"}
                    value={overrideName}
                    onChange={(e) => setOverrideName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushAfter}
                    onChange={(e) => setPushAfter(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#f97316]"
                  />
                  Push to GitHub after commit
                </label>
              </>
            )}
            {status === "error" && error && (
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-300/90">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              >
                {status === "done" ? "Close" : "Cancel"}
              </button>
              {status !== "done" && (
                <button
                  onClick={handlePublish}
                  disabled={!selected || status === "working"}
                  className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 disabled:opacity-40 transition-all cursor-pointer"
                >
                  {status === "working" ? "…" : "Publish"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        style={{ animation: "overlayFadeIn 200ms ease" }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 w-[400px] max-w-[90vw] bg-cc-bg border-l border-cc-border shadow-2xl overflow-y-auto"
        style={{ animation: "slideInRight 250ms cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cc-border sticky top-0 bg-cc-bg/95 backdrop-blur-md z-10">
          <h2 className="text-sm font-semibold text-cc-fg">Settings</h2>
          <button onClick={onClose} className="text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>

        {/* Sections */}
        <div className="p-6 space-y-8">
          <BackendsSection />
          <ApiKeysSection />
          <CloudStorageSection />
          <GitHubSection />
          <PluginsSection />
        </div>
      </div>
    </>
  );
}

// ── Import Dialog ─────────────────────────────────────────────────────────

type ImportKind = "session" | "mode";
type InstalledMode = { name: string; displayName: string; description?: string; version: string; icon?: string; path: string };

function ImportDialog({
  open,
  onClose,
  onImported,
  initialUrl,
  initialKind = "session",
  onInstalledMode,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  initialUrl?: string;
  initialKind?: ImportKind;
  onInstalledMode?: (mode: InstalledMode) => void;
}) {
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [url, setUrl] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [status, setStatus] = useState<"idle" | "importing" | "done" | "error">("idle");
  const [result, setResult] = useState<any>(null);
  const [installed, setInstalled] = useState<InstalledMode | null>(null);
  const [error, setError] = useState("");
  const autoImportTriggered = useRef(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setUrl(initialUrl || "");
      const tag = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
      setWorkspace(`~/pneuma-projects/import-${tag}`);
      setStatus("idle");
      setResult(null);
      setInstalled(null);
      setError("");
      autoImportTriggered.current = false;
    }
  }, [open, initialUrl, initialKind]);

  // Auto-import / auto-install when opened with initialUrl
  useEffect(() => {
    if (open && initialUrl && url && !autoImportTriggered.current && status === "idle") {
      autoImportTriggered.current = true;
      // Trigger on next tick so state is settled
      setTimeout(() => {
        if (kind === "mode") handleInstallFn(url);
        else handleImportFn(url, workspace);
      }, 0);
    }
  }, [open, initialUrl, url, status, kind]);

  if (!open) return null;

  const handleImportFn = async (importUrl: string, importWorkspace: string) => {
    if (!importUrl.trim()) return;
    setStatus("importing");
    try {
      const resp = await fetch(`${getApiBase()}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim(), workspace: importWorkspace.trim() || undefined }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setWorkspace(data.path || "");
      setStatus("done");
      onImported?.();
    } catch (err: any) {
      setError(err.message || "Import failed");
      setStatus("error");
    }
  };

  const handleFileUpload = async (file: File) => {
    setStatus("importing");
    try {
      const form = new FormData();
      form.append("file", file);
      if (workspace.trim()) form.append("workspace", workspace.trim());
      const resp = await fetch(`${getApiBase()}/api/import/upload`, { method: "POST", body: form });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setWorkspace(data.path || "");
      setStatus("done");
      onImported?.();
    } catch (err: any) {
      setError(err.message || "Import failed");
      setStatus("error");
    }
  };

  const handleImport = () => handleImportFn(url, workspace);

  const handleInstallFn = async (source: string) => {
    if (!source.trim()) return;
    setStatus("importing");
    try {
      const resp = await fetch(`${getApiBase()}/api/modes/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: source.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
      setInstalled(data as InstalledMode);
      setStatus("done");
      onImported?.();
    } catch (err: any) {
      setError(err.message || "Install failed");
      setStatus("error");
    }
  };
  const handleInstall = () => handleInstallFn(url);

  const handleLaunchInstalled = () => {
    if (!installed) return;
    onInstalledMode?.(installed);
    onClose();
  };

  const handleLaunchImported = async (withReplay: boolean) => {
    if (!result) return;
    const targetWorkspace = workspace.trim() || result.path;
    try {
      const resp = await fetch(`${getApiBase()}/api/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specifier: result.mode || "webcraft",
          workspace: targetWorkspace,
          ...(withReplay && result.replayPackagePath ? { replayPackage: result.replayPackagePath } : {}),
        }),
      });
      const data = await resp.json();
      if (data.url) {
        window.open(data.url, "_blank");
        onClose();
      }
    } catch {}
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" style={{ animation: "overlayFadeIn 200ms ease" }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="bg-cc-bg border border-cc-border rounded-xl shadow-2xl w-[440px] max-w-[90vw] pointer-events-auto"
          style={{ animation: "warmFadeIn 200ms ease" }}>
          <div className="px-5 py-4 border-b border-cc-border">
            <h3 className="text-sm font-semibold text-cc-fg">{kind === "mode" ? "Add Mode" : "Import Session"}</h3>
            <p className="text-[10px] text-cc-muted mt-1">
              {kind === "mode"
                ? "Install a mode from a URL (.tar.gz) or github:user/repo. Installed modes appear in Local."
                : "Paste a share URL or select a local archive (.tar.gz)."}
            </p>
            <div className="mt-3 inline-flex rounded-lg border border-cc-border overflow-hidden text-[10px]">
              {(["session", "mode"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => { setKind(k); setStatus("idle"); setError(""); setResult(null); setInstalled(null); }}
                  className={`px-3 py-1 transition-colors cursor-pointer ${kind === k ? "bg-cc-primary/15 text-cc-primary" : "text-cc-muted hover:text-cc-fg"}`}
                >
                  {k === "session" ? "Session" : "Mode"}
                </button>
              ))}
            </div>
          </div>
          <div className="px-5 py-4 space-y-3">
            {status === "idle" && kind === "session" && (
              <>
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    placeholder="https://..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleImport()}
                    className="flex-1 px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                  <span className="text-[10px] text-cc-muted/40">or</span>
                  <label className="px-3 py-2.5 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg hover:border-cc-muted/30 transition-colors cursor-pointer whitespace-nowrap">
                    Local file
                    <input type="file" accept=".tar.gz,.tgz,.gz,application/gzip,application/x-gzip,application/x-tar" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                    }} />
                  </label>
                </div>
                <div>
                  <label className="text-[10px] text-cc-muted block mb-1">Workspace directory (optional)</label>
                  <input
                    placeholder="~/pneuma-projects/my-project"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Cancel</button>
                  <button onClick={handleImport} disabled={!url.trim()}
                    className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 disabled:opacity-40 transition-all cursor-pointer">Import</button>
                </div>
              </>
            )}
            {status === "idle" && kind === "mode" && (
              <>
                <div>
                  <input
                    autoFocus
                    placeholder="https://.../mode.tar.gz  or  github:user/repo"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleInstall()}
                    className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors"
                  />
                  <p className="text-[10px] text-cc-muted/60 mt-1.5">Downloads + extracts to <code className="text-cc-muted">~/.pneuma/modes/</code>.</p>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Cancel</button>
                  <button onClick={handleInstall} disabled={!url.trim()}
                    className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 disabled:opacity-40 transition-all cursor-pointer">Install</button>
                </div>
              </>
            )}
            {status === "importing" && (
              <div className="text-xs text-cc-muted animate-pulse py-2">
                {kind === "mode" ? "Installing..." : "Importing..."}
              </div>
            )}
            {status === "done" && kind === "session" && result && (
              <div className="space-y-3">
                <div className="text-xs text-cc-success">Imported successfully!</div>
                <div className="text-[10px] text-cc-muted">
                  {result.displayName && <span className="text-cc-fg">{result.displayName}</span>}
                </div>
                {result.type === "process" ? (
                  <>
                    <p className="text-[10px] text-cc-muted/60">This share includes the creation process with chat history and checkpoints.</p>
                    <div className="flex justify-end gap-2">
                      <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Close</button>
                      <button onClick={() => handleLaunchImported(false)}
                        className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-fg hover:border-cc-primary hover:text-cc-primary transition-colors cursor-pointer">Continue Working</button>
                      <button onClick={() => handleLaunchImported(true)}
                        className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 transition-all cursor-pointer">Replay</button>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Close</button>
                    <button onClick={() => handleLaunchImported(false)}
                      className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 transition-all cursor-pointer">Open</button>
                  </div>
                )}
              </div>
            )}
            {status === "done" && kind === "mode" && installed && (
              <div className="space-y-3">
                <div className="text-xs text-cc-success">Installed "{installed.displayName}" ({installed.version}).</div>
                {installed.description && (
                  <p className="text-[10px] text-cc-muted/70">{installed.description}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Close</button>
                  <button onClick={handleLaunchInstalled}
                    className="px-4 py-2 text-xs rounded-lg bg-cc-primary text-white font-medium hover:brightness-110 transition-all cursor-pointer">Launch</button>
                </div>
              </div>
            )}
            {status === "error" && (
              <div className="space-y-2">
                <div className="text-xs text-cc-error">{error}</div>
                <div className="flex justify-end">
                  <button onClick={() => setStatus("idle")} className="px-4 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Try again</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main Launcher ────────────────────────────────────────────────────────

export default function Launcher() {
  const { preference: themePref, resolved: theme, cycle: cycleTheme } = useTheme();
  const isLight = theme === "light";
  const [backendOptions, setBackendOptions] = useState<BackendOption[]>(FALLBACK_BACKENDS);
  const [defaultBackendType, setDefaultBackendType] = useState<BackendType>("codex");
  const [builtins, setBuiltins] = useState<BuiltinMode[]>([]);
  const [published, setPublished] = useState<PublishedMode[]>([]);
  const [local, setLocal] = useState<LocalMode[]>([]);
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [running, setRunning] = useState<ChildProcess[]>([]);
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [libraries, setLibraries] = useState<InstalledLibrary[]>([]);
  const [addLibraryOpen, setAddLibraryOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<InstalledLibrary | null>(null);
  // Phase 4 — archived bucket. Fetched once on mount and after a restore;
  // NOT refetched on every render. Toggled open by the inline "Archived"
  // header link, which only appears when `archivedProjects.length > 0`.
  const [archivedProjects, setArchivedProjects] = useState<ProjectListEntry[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [homeDir, setHomeDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [showGallery, setShowGallery] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("importUrl") || params.has("installModeUrl");
  });
  const [importInitialKind, setImportInitialKind] = useState<ImportKind>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("installModeUrl") ? "mode" : "session";
  });
  const [importInitialUrl, setImportInitialUrl] = useState<string | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get("importUrl");
    const modeUrl = params.get("installModeUrl");
    const url = modeUrl || importUrl;
    if (url) {
      // Clean up the URL so it doesn't re-trigger on refresh
      const clean = new URL(window.location.href);
      clean.searchParams.delete("importUrl");
      clean.searchParams.delete("installModeUrl");
      window.history.replaceState({}, "", clean.pathname + clean.search);
    }
    return url || undefined;
  });
  const [launchTarget, setLaunchTarget] = useState<{
    specifier: string;
    displayName: string;
    description?: string;
    icon?: string;
    showcase?: BuiltinMode["showcase"];
    defaultWorkspace?: string;
    defaultInitParams?: Record<string, string>;
    /** When launching mode-maker to seed a new mode package from an existing
     *  one, carries the source — the viewer auto-forks on first load. */
    forkSource?: { sourceMode?: string; sourcePath?: string };
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

  const refreshLibraries = useCallback(() => {
    fetch(`${getApiBase()}/api/libraries`)
      .then((r) => r.json())
      .then((data) => setLibraries(data.libraries || []))
      .catch(() => { });
  }, []);

  // Refresh libraries on mount + whenever the server broadcasts a
  // `libraries_updated` event (dispatched as a window event by ws.ts,
  // or fired locally by LibraryCard / dialog handlers after a
  // mutation — see the "trigger paths converged on one event name"
  // comment in LibraryCard). Also re-runs `refreshModes` because
  // activated library modes surface in `/api/registry` `local[]` —
  // toggle one off and the Quick Start tile has to disappear.
  useEffect(() => {
    refreshLibraries();
    const handler = () => {
      refreshLibraries();
      refreshModes();
    };
    window.addEventListener("pneuma:libraries-updated", handler);
    return () => window.removeEventListener("pneuma:libraries-updated", handler);
  }, [refreshLibraries, refreshModes]);

  const refreshRunning = useCallback(() => {
    // `/api/running` = all running `pneuma <mode>` sessions system-wide (read
    // from the shared registry), not just children this launcher spawned — so
    // a project that switched modes internally shows its current mode.
    fetch(`${getApiBase()}/api/running`)
      .then((r) => r.json())
      .then((data) => setRunning(data.processes || []))
      .catch(() => { });
  }, []);

  const reloadProjects = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/projects`);
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      // tolerate offline / no-server scenarios
    }
  }, []);

  const reloadArchivedProjects = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/projects?archived=true`);
      if (!res.ok) return;
      const data = await res.json();
      setArchivedProjects(data.projects ?? []);
    } catch {
      // tolerate offline / no-server scenarios
    }
  }, []);

  const quickResumeProject = useCallback(
    async (project: ProjectCardEntry) => {
      // Skip the empty-shell intermediate. Pull the project's sessions, take
      // the most-recently accessed one, and POST /api/launch directly. If
      // anything fails, fall through to the default `<a href>` behavior on
      // next click — no aggressive error UI for a "shortcut" affordance.
      try {
        const res = await fetch(
          `${getApiBase()}/api/projects/${encodeURIComponent(project.root)}/sessions`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const sessions = (data.sessions ?? []) as Array<{
          sessionId: string;
          mode: string;
          backendType?: string;
          lastAccessed?: number;
        }>;
        if (sessions.length === 0) return;
        const latest = [...sessions].sort(
          (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
        )[0];
        const launchRes = await fetch(`${getApiBase()}/api/launch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            specifier: latest.mode,
            workspace: project.root,
            project: project.root,
            sessionId: latest.sessionId,
            ...(latest.backendType ? { backendType: latest.backendType } : {}),
          }),
        });
        const launchData = (await launchRes.json()) as { url?: string };
        if (launchData.url) {
          // Open in a new window — keep the launcher as the main window.
          // In Electron, `setWindowOpenHandler` routes this to a mode window.
          window.open(launchData.url, "_blank");
        }
      } catch {
        // tolerate transient failures — the card's main link still works
      }
    },
    [],
  );

  const restoreProject = useCallback(
    async (project: ProjectCardEntry) => {
      try {
        const res = await fetch(
          `${getApiBase()}/api/projects/${encodeURIComponent(project.root)}/restore`,
          { method: "POST" },
        );
        if (!res.ok) return;
      } catch {
        return;
      }
      // Refresh both buckets — the project just moved between them. The
      // toggled-open archived bucket stays open intentionally; the user
      // closes it on their own time.
      await Promise.all([reloadProjects(), reloadArchivedProjects()]);
    },
    [reloadProjects, reloadArchivedProjects],
  );

  useEffect(() => {
    Promise.all([
      fetch(`${getApiBase()}/api/backends`).then((r) => r.json()),
      fetch(`${getApiBase()}/api/registry`).then((r) => r.json()),
      fetch(`${getApiBase()}/api/sessions`).then((r) => r.json()),
      fetch(`${getApiBase()}/api/running`).then((r) => r.json()),
      fetch(`${getApiBase()}/api/projects`).then((r) => r.json()).catch(() => ({ projects: [] })),
      fetch(`${getApiBase()}/api/projects?archived=true`)
        .then((r) => r.json())
        .catch(() => ({ projects: [] })),
    ])
      .then(([backendData, registryData, sessionsData, runningData, projectsData, archivedData]) => {
        setBackendOptions(backendData.backends || []);
        if (backendData.defaultBackendType) {
          setDefaultBackendType(backendData.defaultBackendType);
        }
        setBuiltins(registryData.builtins || []);
        setPublished(registryData.published || []);
        setLocal(registryData.local || []);
        setSessions(sessionsData.sessions || []);
        if (sessionsData.homeDir) setHomeDir(sessionsData.homeDir);
        setRunning(runningData.processes || []);
        setProjects(projectsData.projects || []);
        setArchivedProjects(archivedData.projects || []);
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

  const renameSession = useCallback(async (id: string, sessionName: string) => {
    try {
      await fetch(`${getApiBase()}/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionName }),
      });
      refreshSessions();
    } catch { }
  }, [refreshSessions]);

  const handleReplaySession = useCallback(async (session: RecentSession) => {
    try {
      const res = await fetch(`${getApiBase()}/api/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specifier: session.mode,
          workspace: session.workspace,
          backend: session.backendType || "claude-code",
          replaySource: session.workspace,
        }),
      });
      const data = await res.json();
      if (data.url) {
        // New window — keep the launcher as the main window.
        window.open(data.url, "_blank");
      }
    } catch { }
  }, []);

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

  // Backend availability lookup for session cards
  const getBackendUnavailableReason = useCallback(
    (type: BackendType) => {
      const b = backendOptions.find((o) => o.type === type);
      if (!b) return `Unknown backend "${type}"`;
      if (!b.implemented) return "Coming soon";
      if (b.available === false) return b.reason || "Not available";
      return undefined;
    },
    [backendOptions],
  );

  // Direct launch for session resume — no dialog, just go
  const directLaunch = useCallback(async (
    specifier: string,
    workspace: string,
    backendType: BackendType,
    skipSkill?: boolean,
    viewing?: boolean,
  ) => {
    try {
      const res = await fetch(`${getApiBase()}/api/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specifier,
          workspace,
          backendType,
          ...(skipSkill ? { skipSkill: true } : {}),
          ...(viewing ? { viewing: true } : {}),
        }),
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

  // Separate app sessions (layout=app, not editing) from regular sessions
  const appSessions = sessions.filter((s) => s.layout === "app" && s.editing === false);
  const appWorkspaces = new Set(appSessions.map((s) => s.workspace));

  // Merge sessions + running for the "Continue" section (max 3 on homepage)
  const runningWorkspaces = new Set(running.map((r) => r.workspace));
  // A workspace can have more than one running session — e.g. a project that
  // switched modes internally before the superseded session was torn down.
  // Collapse to the most-recent one (latest startedAt) so "Continue" reflects
  // where the user actually is, not a now-stale earlier mode.
  const latestRunningByWorkspace = new Map<string, ChildProcess>();
  for (const proc of running) {
    if (appWorkspaces.has(proc.workspace)) continue;
    const prev = latestRunningByWorkspace.get(proc.workspace);
    if (!prev || (proc.startedAt ?? 0) > (prev.startedAt ?? 0)) {
      latestRunningByWorkspace.set(proc.workspace, proc);
    }
  }
  const allContinueItems = [
    // Running processes first (exclude app sessions)
    ...Array.from(latestRunningByWorkspace.values()).map((proc) => ({
      type: "running" as const,
      key: proc.workspace,
      process: proc,
      session: sessions.find((s) => s.workspace === proc.workspace),
      modeName: proc.specifier.split("/").pop() || proc.specifier,
    })),
    // Then recent sessions (not currently running, not app sessions)
    ...sessions
      .filter((s) => !runningWorkspaces.has(s.workspace) && !appWorkspaces.has(s.workspace))
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
      inspiredBy: mode.inspiredBy,
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
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-cc-muted/70 hover:text-cc-fg transition-colors cursor-pointer"
              title="Settings"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
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
                inspiredBy: featuredMode.inspiredBy,
              })}
              onExplore={() => setShowGallery(true)}
            />
          )}

          {/* My Apps — app-layout sessions in use mode */}
          {appSessions.length > 0 && (
            <section
              className="mb-10 pt-8 border-t border-cc-border"
              style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both" }}
            >
              <h2 className="text-sm font-medium text-cc-fg/70 tracking-wide mb-5">My Apps</h2>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                {appSessions.map((s) => {
                  const isAppRunning = running.some((r) => r.workspace === s.workspace);
                  const icon = iconMap[s.mode];
                  return (
                    <button
                      key={s.id}
                      className="group relative flex items-center gap-3 p-3 rounded-lg border border-cc-border bg-cc-bg-secondary hover:border-cc-primary/40 transition-all cursor-pointer text-left"
                      onClick={() => {
                        if (isAppRunning) {
                          const proc = running.find((r) => r.workspace === s.workspace);
                          if (proc?.url) window.open(proc.url, "_blank");
                        } else {
                          directLaunch(s.mode, s.workspace, s.backendType, false, true);
                        }
                      }}
                    >
                      {icon && <img src={icon} alt="" className="w-8 h-8 rounded" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-cc-fg truncate">
                          {s.sessionName || s.displayName}
                        </div>
                        <div className="text-xs text-cc-muted truncate">
                          {shortenPath(s.workspace, homeDir)}
                        </div>
                      </div>
                      {isAppRunning && (
                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-emerald-400" title="Running" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Recent Projects — two-tier: featured (≤3 recent) + compact older list */}
          {(() => {
            const FEATURED_DAYS = 14;
            const FEATURED_MAX = 3;
            const featuredCutoff = Date.now() - FEATURED_DAYS * 24 * 60 * 60 * 1000;
            // Sort newest first, then split into featured + rest.
            const sorted = [...projects].sort(
              (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)
            );
            const featured = sorted
              .filter((p) => (p.lastAccessed ?? 0) >= featuredCutoff)
              .slice(0, FEATURED_MAX);
            const featuredIds = new Set(featured.map((p) => p.id));
            const rest = sorted.filter((p) => !featuredIds.has(p.id));
            const toCardEntry = (p: ProjectListEntry): ProjectCardEntry => ({
              id: p.id,
              root: p.root,
              name: p.name,
              displayName: p.displayName,
              description: p.description,
              lastAccessed: p.lastAccessed,
              createdAt: p.createdAt,
              sessionCount: p.sessionCount ?? 0,
              modeBreakdown: p.modeBreakdown ?? [],
              coverImageUrl: p.coverImageUrl,
            });
            return (
              <section
                className="mb-10 pt-8 border-t border-cc-border"
                style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.12s both" }}
              >
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-sm font-medium text-cc-fg/70 tracking-wide">
                    Recent Projects
                    {projects.length > 0 && (
                      <span className="text-cc-muted/40 ml-2">({projects.length})</span>
                    )}
                  </h2>
                  <div className="flex items-center gap-3">
                    {/* Archived bucket toggle — only visible when at least
                        one archived project exists. Quiet styling
                        (text-[11px], muted/50) keeps it tertiary so it
                        doesn't compete with "+ Create Project". */}
                    {archivedProjects.length > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-cc-muted/50 hover:text-cc-primary cursor-pointer transition-colors"
                        onClick={() => setShowArchived((v) => !v)}
                      >
                        {showArchived ? "Hide archived" : `Archived (${archivedProjects.length})`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs text-cc-primary hover:opacity-80 transition-opacity cursor-pointer"
                      onClick={() => setCreateProjectOpen(true)}
                    >
                      + Create Project
                    </button>
                  </div>
                </div>
                {projects.length === 0 ? (
                  <div className="text-cc-muted/60 text-sm">No projects yet.</div>
                ) : (
                  <>
                    {featured.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
                        {featured.map((p) => (
                          <ProjectCard
                            key={p.id}
                            project={toCardEntry(p)}
                            variant="featured"
                            homeDir={homeDir}
                            onQuickResume={quickResumeProject}
                          />
                        ))}
                      </div>
                    )}
                    {rest.length > 0 && (
                      <div>
                        {featured.length > 0 && (
                          <h3 className="text-xs uppercase tracking-wider text-cc-muted/50 mb-3">
                            All Projects ({rest.length})
                          </h3>
                        )}
                        <div className="grid grid-cols-1 gap-2">
                          {rest.map((p) => (
                            <ProjectCard
                              key={p.id}
                              project={toCardEntry(p)}
                              variant="compact"
                              homeDir={homeDir}
                              onQuickResume={quickResumeProject}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {/* Archived bucket — toggled open from the section header.
                    Rendered as a compact row list below the active list,
                    separated by a 1-px divider with breathing room above. */}
                {showArchived && archivedProjects.length > 0 && (
                  <div className="border-t border-cc-border/40 pt-4 mt-6">
                    <h3 className="text-xs uppercase tracking-wider text-cc-muted/50 mb-3">
                      Archived ({archivedProjects.length})
                    </h3>
                    <div className="grid grid-cols-1 gap-2">
                      {archivedProjects.map((p) => (
                        <ProjectCard
                          key={p.id}
                          project={toCardEntry(p)}
                          variant="compact"
                          homeDir={homeDir}
                          archivedProject
                          onRestore={restoreProject}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })()}

          {/* Continue — max 3, running as cards, recent as compact rows */}
          {hasContinueItems && (
            <section
              className="mb-10 pt-8 border-t border-cc-border"
              style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both" }}
            >
              <div className="flex items-baseline justify-between mb-5">
                <h2 className="text-sm font-medium text-cc-fg/70 tracking-wide">Continue</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowImportDialog(true)}
                    className="text-xs text-cc-muted/50 hover:text-cc-primary transition-colors cursor-pointer"
                  >
                    Import
                  </button>
                  {allContinueItems.length > 3 && (
                    <button
                      onClick={() => setShowAllSessions(true)}
                      className="text-xs text-cc-muted/50 hover:text-cc-fg transition-colors cursor-pointer"
                    >
                      All Sessions ({allContinueItems.length})
                    </button>
                  )}
                </div>
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
                                backendUnavailableReason={item.session ? getBackendUnavailableReason(item.session.backendType) : undefined}
                                onResume={item.session ? (skipSkill) => directLaunch(item.session!.mode, item.session!.workspace, item.session!.backendType, skipSkill) : undefined}
                                onDelete={item.session ? () => deleteSession(item.session!.id) : undefined}
                                onReplay={item.session?.hasReplayData ? () => handleReplaySession(item.session!) : undefined}
                                onRename={item.session ? (name) => renameSession(item.session!.id, name) : undefined}
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
                        onResume={(skipSkill) => directLaunch(item.session!.mode, item.session!.workspace, item.session!.backendType, skipSkill)}
                        onDelete={() => deleteSession(item.session!.id)}
                        onReplay={item.session!.hasReplayData ? () => handleReplaySession(item.session!) : undefined}
                        onRename={(name) => renameSession(item.session!.id, name)}
                        backendUnavailableReason={getBackendUnavailableReason(item.session!.backendType)}
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
                  librarySource={mode.librarySource}
                  onClick={() => setLaunchTarget({
                    specifier: mode.specifier,
                    displayName: mode.displayName,
                    description: mode.description,
                    icon: mode.icon,
                    showcase: mode.showcase,
                    inspiredBy: mode.inspiredBy,
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

          {/* Mode Libraries */}
          <section
            className="pt-12"
            style={{ animation: "launcherFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.25s both" }}
          >
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <h2 className="text-sm font-medium text-cc-fg/70 tracking-wide">Mode Libraries</h2>
                <p className="text-xs text-cc-muted/50 mt-1">Shared mode collections from GitHub</p>
              </div>
              <button
                onClick={() => setAddLibraryOpen(true)}
                className="text-xs text-cc-primary hover:opacity-80 transition-opacity cursor-pointer"
              >
                + Add library
              </button>
            </div>
            {libraries.length === 0 ? (
              <div className="text-xs text-cc-muted/50">
                No libraries linked yet.{" "}
                <button
                  onClick={() => setAddLibraryOpen(true)}
                  className="text-cc-primary hover:opacity-80 transition-opacity cursor-pointer underline underline-offset-2"
                >
                  Link one
                </button>
                .
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <AnimatePresence mode="popLayout">
                  {libraries.map((lib) => (
                    <motion.div
                      key={lib.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    >
                      <LibraryCard
                        library={lib}
                        onPublish={() => setPublishTarget(lib)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* (Import & R2 moved to SettingsPanel + ImportDialog) */}
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
            // "Edit" on a mode = start a mode-maker session seeded from that
            // mode. Never point mode-maker at the source mode's own install
            // directory (would edit the builtin in place, or overwrite the
            // local cache). Instead always ask the user for a fresh workspace
            // path and auto-fork the source mode into it on first load.
            setLaunchTarget({
              specifier: "mode-maker",
              displayName: `Edit: ${mode.displayName}`,
              forkSource: {
                sourceMode: mode.name,
                sourcePath: mode.source === "local" ? mode.path : undefined,
              },
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
          onAddFromUrl={() => {
            setImportInitialKind("mode");
            setImportInitialUrl("");
            setShowImportDialog(true);
          }}
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
            await directLaunch(session.mode, session.workspace, session.backendType, skipSkill);
          }}
          onDelete={(id) => deleteSession(id)}
          onReplay={(session) => handleReplaySession(session)}
          onRename={(id, name) => renameSession(id, name)}
          getBackendUnavailableReason={getBackendUnavailableReason}
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
          inspiredBy={lastLaunchTarget.current.inspiredBy}
          defaultWorkspace={lastLaunchTarget.current.defaultWorkspace}
          defaultInitParams={lastLaunchTarget.current.defaultInitParams}
          forkSource={lastLaunchTarget.current.forkSource}
          backendOptions={backendOptions}
          defaultBackendType={defaultBackendType}
          homeDir={homeDir}
          onClose={() => setLaunchTarget(null)}
          closing={launchAnim.closing}
        />
      )}

      {/* Settings slide-out panel */}
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />

      {/* Import dialog */}
      <ImportDialog
        open={showImportDialog}
        onClose={() => { setShowImportDialog(false); setImportInitialUrl(undefined); setImportInitialKind("session"); }}
        onImported={() => { refreshSessions(); refreshModes(); }}
        initialUrl={importInitialUrl}
        initialKind={importInitialKind}
        onInstalledMode={(mode) => {
          refreshModes();
          setLaunchTarget({
            specifier: mode.path,
            displayName: mode.displayName,
            description: mode.description,
            icon: mode.icon,
          });
        }}
      />

      {/* Create Project dialog */}
      <CreateProjectDialog
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={(root, skipOnboard) => {
          // Refresh the list either way so the new project tile shows
          // up if the user navigates back to the launcher.
          void reloadProjects();
          if (!skipOnboard) {
            // Default path — open the new project in its own window so
            // EmptyShell auto-triggers project-onboard, while the
            // launcher keeps its main-window role. Saves the user a
            // "click your new tile" step and matches the button copy
            // "Create & discover".
            window.open(`/?project=${encodeURIComponent(root)}`, "_blank");
          }
          // skipOnboard path — stay on the launcher, the new tile
          // joins the grid via reloadProjects().
        }}
        homeDir={homeDir}
      />

      {/* Add Library dialog — link existing or create new */}
      <AddLibraryDialog
        open={addLibraryOpen}
        onClose={() => setAddLibraryOpen(false)}
        onLinked={() => { refreshLibraries(); refreshModes(); }}
      />

      {/* Publish Mode dialog — pick a source mode from local list */}
      <PublishToLibraryDialog
        library={publishTarget}
        localModes={local}
        onClose={() => setPublishTarget(null)}
        onPublished={() => { refreshLibraries(); refreshModes(); }}
      />
    </div>
  );
}
