/**
 * ProjectChip — header chip for the active project. Mirrors the chip shape
 * used by `ModeSwitcherDropdown` so the three header chips (Project, Mode,
 * Session) read as a single composed identity strip.
 *
 * Click toggles an anchored `<ProjectPanel>` dropdown rendered as the
 * chip's child. Esc, click-outside, and chip re-click all close the panel.
 *
 * Auto-open behaviour: when the URL carries `?project=<root>` with no
 * `session` and no `mode`, the chip auto-opens on mount — that empty-shell
 * state is supposed to land users straight in the panel without an extra
 * interaction. The detection runs locally so TopBar / App don't need to
 * thread a prop down.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { basename } from "../utils/string.js";

const ProjectPanel = lazy(() => import("./ProjectPanel.js"));

interface ProjectChipProps {
  /**
   * Force the panel open on mount. When omitted, the chip computes the
   * auto-open state itself by reading the URL params (empty shell ⇒ open).
   */
  autoOpen?: boolean;
}

function detectAutoOpen(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.has("project") && !params.has("session") && !params.has("mode");
}

export default function ProjectChip({ autoOpen }: ProjectChipProps = {}) {
  const projectContext = useStore((s) => s.projectContext);
  const projectRoot = projectContext?.projectRoot ?? null;
  const [open, setOpen] = useState<boolean>(() => autoOpen ?? detectAutoOpen());
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside closes the panel — but ignore clicks inside the wrapper,
  // which contains both the chip button and the absolutely-positioned panel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Chip is only meaningful when there's a known project root. The
  // surrounding TopBar guards on `projectContext` truthiness, but we
  // re-check here so this component is safe to render anywhere.
  if (!projectRoot) return null;

  const label = projectContext?.projectName || basename(projectRoot) || "Project";

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-cc-bg/40 border border-cc-border/60 hover:border-cc-primary/50 text-cc-fg transition-colors cursor-pointer"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={projectRoot}
      >
        <span className="truncate max-w-[160px]">{label}</span>
        <span className="text-cc-muted text-[10px] leading-none">▾</span>
      </button>
      {open ? (
        <Suspense fallback={null}>
          <ProjectPanel projectRoot={projectRoot} />
        </Suspense>
      ) : null}
    </div>
  );
}
