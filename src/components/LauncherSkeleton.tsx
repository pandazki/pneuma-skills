/**
 * Launcher skeleton — the one definition of what the launcher looks like
 * before its content arrives. It is rendered in three places, which must agree
 * so each handoff is invisible:
 *
 * 1. Built into `index.html` (`snapshot/launcher-skeleton.ts`), so the first
 *    paint of a launcher URL is already this page.
 * 2. Built into `dist/launcher-skeleton.html`, which the desktop app shows
 *    while its launcher service starts.
 * 3. Section by section inside the launcher while each resource loads.
 *
 * Everything here is static markup: no hooks, no translation, no data. It is
 * also rendered to static HTML at build time, where the theme, the desktop
 * header inset and the sweep phase are applied by the boot script instead of
 * by props.
 */
import type { CSSProperties } from "react";

/** Period of the `launcherSkeletonSweep` animation in `src/index.css`. */
export const LAUNCHER_SKELETON_PERIOD_MS = 1800;

/**
 * The sweep offset for skeleton animations starting now. Every surface derives
 * it from the wall clock, so a skeleton that replaces another continues its
 * motion. Apply it when the animations start (at commit), not at render.
 */
export function launcherSkeletonDelay(now = Date.now()): string {
  return `${-(now % LAUNCHER_SKELETON_PERIOD_MS)}ms`;
}

function Bone({ className = "" }: { className?: string }) {
  return <span className={`launcher-skeleton block ${className}`} />;
}

/** Section heading row: a title (and optional subtitle) with an action on the right. */
export function SectionTitleSkeleton({ subtitle = false }: { subtitle?: boolean }) {
  return (
    <div className="flex items-start justify-between mb-5" aria-hidden="true">
      <div>
        <div className="h-5 flex items-center"><Bone className="h-3 w-28" /></div>
        {subtitle && <div className="h-4 mt-1 flex items-center"><Bone className="h-2.5 w-36" /></div>}
      </div>
      <div className="h-5 flex items-center"><Bone className="h-2.5 w-20" /></div>
    </div>
  );
}

/** The featured mode hero: showcase media on the left, its pitch on the right. */
export function FeaturedModeSkeleton() {
  return (
    <section className="mb-20" aria-hidden="true" data-launcher-skeleton="featured">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:h-[420px]">
        <div className="lg:col-span-3 h-full">
          <Bone className="h-[260px] sm:h-[340px] lg:h-full rounded-lg" />
        </div>
        <div className="lg:col-span-2 flex flex-col py-2 h-full">
          <div className="flex items-center gap-3 h-9 mb-2">
            <Bone className="w-6 h-6" />
            <Bone className="h-7 w-44" />
          </div>
          <Bone className="h-3.5 w-11/12 mt-1.5" />
          <Bone className="h-3.5 w-2/3 mt-3" />
          <Bone className="h-3 w-full mt-7" />
          <Bone className="h-3 w-10/12 mt-3.5" />
          <Bone className="h-[84px] w-full mt-6 rounded-lg" />
          <Bone className="h-3 w-1/2 mt-6 ml-7" />
          <Bone className="h-3 w-2/5 mt-8 ml-7" />
          <div className="mt-auto pt-6 flex gap-3">
            <Bone className="h-10 w-[88px] rounded-lg" />
            <Bone className="h-10 w-[158px] rounded-lg" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Recent Projects: the featured card row. */
export function ProjectCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5" aria-hidden="true" data-launcher-skeleton="projects">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col rounded-xl border border-cc-border overflow-hidden">
          <Bone className="aspect-[16/9] w-full rounded-none" />
          <div className="flex flex-col p-4">
            <Bone className="h-3.5 w-2/3" />
            <Bone className="h-2.5 w-full mt-3" />
            <Bone className="h-2.5 w-4/5 mt-2" />
            <div className="mt-3.5 pt-3 border-t border-cc-border/40"><Bone className="h-2.5 w-1/2" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Continue: compact recent-session rows. */
export function SessionRowsSkeleton() {
  return (
    <div aria-hidden="true" data-launcher-skeleton="sessions">
      {["w-44", "w-36", "w-52"].map((width, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2.5">
          <Bone className="w-8 h-8 shrink-0 rounded-lg" />
          <div className="flex-1 min-w-0">
            <div className="h-5 flex items-center"><Bone className={`h-3 ${width}`} /></div>
            <div className="h-5 flex items-center"><Bone className="h-2.5 w-72 max-w-full" /></div>
          </div>
          <Bone className="h-2.5 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Create New: the quick-start mode tiles. */
export function QuickStartSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3" aria-hidden="true" data-launcher-skeleton="modes">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="flex flex-col items-center gap-3 p-5 rounded-xl bg-cc-surface/30">
          <Bone className="w-11 h-11 rounded-lg" />
          <div className="w-full flex flex-col items-center">
            <Bone className="h-3 w-20" />
            <Bone className="h-2.5 w-11/12 mt-2.5" />
            <Bone className="h-2.5 w-3/4 mt-1.5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mode Gallery: collapsed mode cards. */
export function GalleryCardsSkeleton({ count, resource }: { count: number; resource: string }) {
  return (
    <div className="space-y-6" aria-hidden="true" data-launcher-skeleton={resource}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-4 rounded-xl border border-cc-border/30">
          <Bone className="w-8 h-8 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="h-6 flex items-center"><Bone className="h-3.5 w-36" /></div>
            <div className="h-5 flex items-center"><Bone className="h-2.5 w-2/3" /></div>
          </div>
          <Bone className="h-8 w-20 shrink-0 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/**
 * The whole launcher before anything is loaded. The header mirrors the real
 * one exactly (logo, wordmark, control positions); the sections mirror the
 * launcher's section frames with the skeleton bodies above.
 */
export function LauncherPageSkeleton({ light = false, desktop = false, logoSrc = "/logo.png", style }: {
  light?: boolean;
  /** The desktop window's hidden title bar needs the header inset past the window controls. */
  desktop?: boolean;
  logoSrc?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`min-h-screen bg-cc-bg text-cc-fg font-body relative ${light ? "cc-theme-light launcher-light" : ""}`}
      data-launcher-skeleton="page"
      data-desktop={desktop ? "" : undefined}
      aria-busy="true"
      style={style}
    >
      <div className="fixed inset-0 pointer-events-none launcher-light-texture hidden [.launcher-light_&]:block" />
      <div className="fixed top-[-20%] left-[10%] w-[50%] h-[50%] pointer-events-none launcher-ambient" />
      <div className="fixed bottom-[-10%] right-[5%] w-[40%] h-[40%] pointer-events-none launcher-ambient-secondary" />
      <div className="sticky top-0 z-[60] bg-cc-bg/80 backdrop-blur-md" style={{ WebkitAppRegion: "drag" } as CSSProperties}>
        <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between [[data-desktop]_&]:pl-20">
          <div className="flex items-center gap-3">
            <img src={logoSrc} alt="" draggable={false} className="w-9 h-9 rounded-lg [.launcher-light_&]:[filter:brightness(0.85)_saturate(1.2)]" />
            <span className="font-logo text-2xl text-cc-fg tracking-tight select-none">Pneuma</span>
          </div>
          <div className="flex items-center" aria-hidden="true">
            <div className="flex items-center gap-1 translate-x-5">
              {[0, 1, 2, 3].map((index) => <span key={index} className="p-2"><Bone className="w-4 h-4 rounded-full" /></span>)}
            </div>
            <span className="block w-8 h-8" />
          </div>
        </header>
      </div>
      <main className="relative z-10 max-w-6xl mx-auto px-6 pb-16" aria-hidden="true">
        <div className="pt-5" />
        <FeaturedModeSkeleton />
        <section className="mb-10 pt-8 border-t border-cc-border">
          <SectionTitleSkeleton />
          <ProjectCardsSkeleton />
        </section>
        <section className="mb-10 pt-8 border-t border-cc-border">
          <SectionTitleSkeleton />
          <SessionRowsSkeleton />
        </section>
        <section className="pt-12">
          <SectionTitleSkeleton subtitle />
          <QuickStartSkeleton />
          <Bone className="mt-6 h-24 w-full rounded-xl" />
        </section>
      </main>
    </div>
  );
}
