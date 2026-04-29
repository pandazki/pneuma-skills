/**
 * ProjectCard — renders a single project tile in the Launcher's
 * "Recent Projects" section. Two variants:
 *
 * - "featured" (large, top tier): cover area + name + description + meta row
 * - "compact"  (list, lower tier): small cover thumbnail + name/path + meta
 *
 * Both variants navigate to `/?project=<root>` on click.
 *
 * Cover + meta line live in `ProjectCover.tsx` so the Project Panel (3.0
 * pivot) can reuse them.
 */

import { shortenPath } from "../utils/string.js";
import { timeAgo } from "../utils/timeAgo.js";
import { CoverImage, SessionMeta } from "./ProjectCover.js";

export interface ProjectCardEntry {
  id: string;
  root: string;
  name: string;
  displayName: string;
  description?: string;
  lastAccessed: number;
  createdAt: number;
  sessionCount: number;
  modeBreakdown: string[];
  coverImageUrl?: string;
}

export type ProjectCardVariant = "featured" | "compact";

interface ProjectCardProps {
  project: ProjectCardEntry;
  variant: ProjectCardVariant;
  homeDir: string;
  /**
   * Phase 4 — when present, the card renders for the launcher's archived
   * bucket instead of the standard `<a>` shape: cover gets `opacity-60`,
   * the title is followed by a small "archived" tag, and a trailing
   * "Restore" text button calls back into this prop. The card body is no
   * longer a link in this state — clicking the cover/title is a no-op so
   * users can't accidentally enter an archived project's empty shell.
   */
  onRestore?: (project: ProjectCardEntry) => void;
  /**
   * Soft flag for archived rendering. Set automatically when `onRestore`
   * is provided; exposed as a prop so callers can also style cards for
   * visual differentiation in other future contexts.
   */
  archivedProject?: boolean;
  /**
   * Phase 5 — when present, the bottom meta row on the card becomes a
   * quick-resume hot zone (cursor: pointer; hover: text shifts toward
   * primary; trailing `→` appears on hover). Clicking calls back here so
   * the launcher can pick the most-recent session and navigate directly,
   * skipping the empty-shell intermediate. The card body still navigates
   * to the empty shell as the default behavior. Gated on `sessionCount > 0`
   * — projects with no sessions render the meta row as a static label.
   */
  onQuickResume?: (project: ProjectCardEntry) => void;
}

/**
 * Inner span that turns a SessionMeta line into a quick-resume click
 * target. Lives inside the card's outer `<a>`, so it preventsDefault +
 * stopsPropagation to avoid the link navigation. Uses `role="button"` so
 * a `<button>` doesn't get nested inside the `<a>` (invalid HTML).
 */
function QuickResumeMeta({
  project,
  onQuickResume,
}: {
  project: ProjectCardEntry;
  onQuickResume: (project: ProjectCardEntry) => void;
}) {
  const handle = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onQuickResume(project);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handle(e);
      }}
      title="Resume the most recent session"
      className="quick-resume group/qr inline-flex items-center gap-1 cursor-pointer transition-colors hover:text-cc-primary"
    >
      <SessionMeta project={project} />
      <span className="text-cc-primary text-[10px] leading-none opacity-0 group-hover/qr:opacity-100 transition-opacity" aria-hidden>
        →
      </span>
    </span>
  );
}

function FeaturedCard({
  project,
  homeDir,
  onQuickResume,
}: {
  project: ProjectCardEntry;
  homeDir: string;
  onQuickResume?: (project: ProjectCardEntry) => void;
}) {
  const path = shortenPath(project.root, homeDir);
  const canResume = !!onQuickResume && project.sessionCount > 0;
  return (
    <a
      href={`/?project=${encodeURIComponent(project.root)}`}
      title={project.root}
      className="group flex flex-col bg-cc-surface border border-cc-border rounded-xl overflow-hidden hover:border-cc-primary/40 hover:shadow-[0_0_0_1px_rgba(249,115,22,0.15),0_8px_30px_-12px_rgba(249,115,22,0.18)] transition-all duration-200"
    >
      <div className="relative aspect-[16/9] w-full bg-black/20 overflow-hidden">
        <CoverImage project={project} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
      </div>
      <div className="flex-1 flex flex-col p-4 gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-cc-fg truncate flex-1 group-hover:text-cc-primary transition-colors duration-150">
            {project.displayName}
          </h3>
          <span className="text-[10px] text-cc-muted/40 shrink-0 mt-0.5">
            {timeAgo(project.lastAccessed)}
          </span>
        </div>
        {project.description ? (
          <p className="text-xs text-cc-muted/80 line-clamp-2">
            {project.description}
          </p>
        ) : (
          <p className="text-xs text-cc-muted/40 italic">No description</p>
        )}
        <div className="flex items-center justify-between gap-2 mt-1.5 pt-2 border-t border-cc-border/40 text-[11px]">
          {canResume ? (
            <QuickResumeMeta project={project} onQuickResume={onQuickResume} />
          ) : (
            <SessionMeta project={project} />
          )}
          <span
            className="text-cc-muted/50 font-mono truncate max-w-[55%]"
            title={project.root}
          >
            {path}
          </span>
        </div>
      </div>
    </a>
  );
}

function CompactCard({
  project,
  homeDir,
  onQuickResume,
}: {
  project: ProjectCardEntry;
  homeDir: string;
  onQuickResume?: (project: ProjectCardEntry) => void;
}) {
  const path = shortenPath(project.root, homeDir);
  const canResume = !!onQuickResume && project.sessionCount > 0;
  return (
    <a
      href={`/?project=${encodeURIComponent(project.root)}`}
      title={project.root}
      className="group flex items-center gap-3 bg-cc-surface border border-cc-border rounded-lg p-2.5 hover:border-cc-primary/40 transition-colors duration-150"
    >
      <div className="relative w-14 h-14 shrink-0 rounded-md overflow-hidden bg-black/20">
        <CoverImage project={project} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-cc-fg truncate group-hover:text-cc-primary transition-colors duration-150">
          {project.displayName}
        </div>
        <div className="text-[11px] text-cc-muted/60 truncate font-mono mt-0.5">
          {path}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-[11px]">
        {canResume ? (
          <QuickResumeMeta project={project} onQuickResume={onQuickResume} />
        ) : (
          <SessionMeta project={project} />
        )}
        <span className="text-cc-muted/40 text-[10px]">
          {timeAgo(project.lastAccessed)}
        </span>
      </div>
    </a>
  );
}

/**
 * Compact "row" rendering for an archived project — same identity rhythm
 * as `CompactCard` but no `<a>` wrapper (clicking would land in an empty
 * shell of an archived project, which we want to discourage). The cover
 * is dimmed and a `Restore` text button trails the row.
 */
function ArchivedRow({
  project,
  homeDir,
  onRestore,
}: {
  project: ProjectCardEntry;
  homeDir: string;
  onRestore: (project: ProjectCardEntry) => void;
}) {
  const path = shortenPath(project.root, homeDir);
  return (
    <div
      title={project.root}
      className="group flex items-center gap-3 bg-cc-surface border border-cc-border rounded-lg p-2.5 transition-colors duration-150"
    >
      <div className="relative w-14 h-14 shrink-0 rounded-md overflow-hidden bg-black/20 opacity-60">
        <CoverImage project={project} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-cc-fg/80 truncate flex items-center">
          <span className="truncate">{project.displayName}</span>
          <span className="text-[10px] text-cc-muted/50 ml-2 shrink-0">
            archived
          </span>
        </div>
        <div className="text-[11px] text-cc-muted/60 truncate font-mono mt-0.5">
          {path}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRestore(project)}
        className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer shrink-0"
      >
        Restore
      </button>
    </div>
  );
}

export function ProjectCard({
  project,
  variant,
  homeDir,
  onRestore,
  archivedProject,
  onQuickResume,
}: ProjectCardProps) {
  // The archived rendering is intentionally only available in the compact
  // shape — the launcher's Archived bucket uses compact rows, and the
  // featured-cover hover treatment doesn't make sense for cards the user
  // can't enter without restoring first.
  if (onRestore || archivedProject) {
    if (onRestore) {
      return (
        <ArchivedRow project={project} homeDir={homeDir} onRestore={onRestore} />
      );
    }
  }
  if (variant === "featured") {
    return <FeaturedCard project={project} homeDir={homeDir} onQuickResume={onQuickResume} />;
  }
  return <CompactCard project={project} homeDir={homeDir} onQuickResume={onQuickResume} />;
}
