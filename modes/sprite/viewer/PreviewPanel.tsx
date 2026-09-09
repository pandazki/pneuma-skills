/**
 * The side panel: the three artefacts a motion turns into once the pipeline
 * has run — the GIF/WebP preview, the video-model clips, and the packed atlas
 * — plus the inspect report that says whether any of it is trustworthy.
 *
 * These are DELIVERABLES, not the stage. The stage answers "does this motion
 * read right"; the panel answers "is the thing I would hand to a game engine
 * or drop into a chat actually there". Hence a download link on every one of
 * them and the atlas grid drawn over the packed sheet: the two questions a
 * sprite sheet gets asked are "where is frame 5" and "how big is a cell".
 *
 * The grid is recomputed from the packed image's own dimensions and the
 * motion's declared columns rather than read back out of `atlas.json`. The
 * pack step lays frames out row-major, `cols` per row, with no margin and no
 * gutter (Shared vocabulary), so the two agree by construction — and the panel
 * stays free of a second data source, which is also what makes it work in the
 * hosted player with no fetch at render time.
 */

import { useMemo } from "react";

import type { CharacterProject, Motion, MotionVideo } from "../domain.js";
import { resolveAssetUri } from "../domain.js";
import { DownloadIcon, FilmIcon, GridIcon, ImageIcon, WarnIcon } from "./icons.js";
import { contentUrl } from "./urls.js";

export type PanelTab = "gif" | "video" | "atlas";

const TABS: Array<{ id: PanelTab; label: string; icon: typeof ImageIcon }> = [
  { id: "gif", label: "GIF", icon: ImageIcon },
  { id: "video", label: "Video", icon: FilmIcon },
  { id: "atlas", label: "Atlas", icon: GridIcon },
];

const CHECKER_STYLE = {
  backgroundImage:
    "linear-gradient(45deg, rgba(128,128,128,0.16) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.16) 75%), linear-gradient(45deg, rgba(128,128,128,0.16) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.16) 75%)",
  backgroundSize: "14px 14px",
  backgroundPosition: "0 0, 7px 7px",
};

export interface PreviewPanelProps {
  project: CharacterProject;
  motion: Motion | null;
  imageVersion: number;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  /** Docked to the right on a wide pane, under the stage on a narrow one. */
  placement: "side" | "bottom";
}

export function PreviewPanel(props: PreviewPanelProps) {
  const { project, motion, imageVersion } = props;
  const url = (assetId: string | undefined): string | null => {
    if (!assetId) return null;
    const uri = resolveAssetUri(project, assetId);
    return uri ? contentUrl(project.contentSet, uri, imageVersion) : null;
  };

  const frame = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {!motion ? (
        <Empty>Select a motion to see what it produced.</Empty>
      ) : props.tab === "gif" ? (
        <GifTab motion={motion} url={url} />
      ) : props.tab === "video" ? (
        <VideoTab motion={motion} url={url} />
      ) : (
        <AtlasTab project={project} motion={motion} url={url} />
      )}
      {motion ? <InspectBlock motion={motion} /> : null}
    </div>
  );

  return (
    <aside
      className={`flex shrink-0 flex-col border-cc-border bg-cc-surface/30 ${
        props.placement === "side"
          ? "h-full w-80 border-l"
          : "h-64 w-full border-t"
      }`}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-cc-border px-2 py-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => props.onTab(id)}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
              props.tab === id
                ? "bg-cc-primary/15 text-cc-primary"
                : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>
      {frame}
    </aside>
  );
}

type UrlOf = (assetId: string | undefined) => string | null;

function GifTab({ motion, url }: { motion: Motion; url: UrlOf }) {
  const gif = url(motion.gif);
  const webp = url(motion.webp);
  if (!gif && !webp) {
    return (
      <Empty>
        No preview rendered yet. The GIF and WebP land with the pipeline run.
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      <div
        className="flex items-center justify-center rounded-lg border border-cc-border p-3"
        style={CHECKER_STYLE}
      >
        <img
          src={(gif ?? webp) as string}
          alt={`${motion.label} preview`}
          className="max-h-48 max-w-full object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-cc-muted">
        {motion.fps} fps · {motion.loop ? "loops" : "plays once"} ·{" "}
        {motion.frames.length} frames
      </p>
      <div className="flex flex-wrap gap-2">
        {gif ? <DownloadLink href={gif} label="preview.gif" /> : null}
        {webp ? <DownloadLink href={webp} label="preview.webp" /> : null}
      </div>
    </div>
  );
}

function VideoTab({ motion, url }: { motion: Motion; url: UrlOf }) {
  if (motion.videos.length === 0) {
    return (
      <Empty>
        No video preview yet. Use “Render video preview” to ask for one from
        Seedance 2.5 or MiniMax H3 Max.
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      {motion.videos.map((video) => (
        <VideoCard key={video.id} video={video} href={url(video.asset)} />
      ))}
    </div>
  );
}

function VideoCard({ video, href }: { video: MotionVideo; href: string | null }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-cc-border bg-cc-bg/40 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>{video.model}</Chip>
        <Chip>{video.mode}</Chip>
        <span
          className={`ml-auto text-[10px] uppercase tracking-wide ${
            video.status === "ready"
              ? "text-cc-success"
              : video.status === "failed"
                ? "text-cc-error"
                : "text-cc-primary"
          }`}
        >
          {video.status}
        </span>
      </div>

      {video.status === "ready" && href ? (
        <video
          src={href}
          controls
          loop
          playsInline
          className="w-full rounded border border-cc-border bg-black"
        />
      ) : video.status === "generating" ? (
        <div className="flex h-24 items-center justify-center rounded border border-cc-border bg-cc-surface/50">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-cc-border">
            <div className="h-full w-1/3 rounded-full bg-cc-primary motion-safe:animate-[pulse-dot_1.6s_ease-in-out_infinite]" />
          </div>
        </div>
      ) : (
        <p className="rounded border border-cc-error/40 bg-cc-error/10 px-2 py-1.5 text-[11px] text-cc-fg">
          {video.status === "failed"
            ? "This render failed."
            : "The clip is registered but its file is missing."}
        </p>
      )}

      {video.prompt ? (
        <p className="line-clamp-3 text-[11px] leading-relaxed text-cc-muted">
          {video.prompt}
        </p>
      ) : null}
      {href ? <DownloadLink href={href} label="Download clip" /> : null}
    </div>
  );
}

function AtlasTab({
  project,
  motion,
  url,
}: {
  project: CharacterProject;
  motion: Motion;
  url: UrlOf;
}) {
  const sheet = url(motion.sheet);
  const atlas = url(motion.atlas);
  const geometry = useMemo(() => {
    const asset = motion.sheet ? project.assetsById.get(motion.sheet) : undefined;
    const width = Number(asset?.metadata.width ?? 0);
    const height = Number(asset?.metadata.height ?? 0);
    const cols = Math.max(1, Math.floor(motion.grid.cols));
    const rows = Math.max(1, Math.ceil(motion.frames.length / cols));
    return {
      width,
      height,
      cols,
      rows,
      cellWidth: width ? Math.round(width / cols) : 0,
      cellHeight: height ? Math.round(height / rows) : 0,
    };
  }, [project, motion]);

  if (!sheet) {
    return (
      <Empty>
        No packed atlas yet. `sprite-sheet.mjs pack` writes sheet.png and
        atlas.json together.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div
        className="relative overflow-hidden rounded-lg border border-cc-border"
        style={CHECKER_STYLE}
      >
        <img
          src={sheet}
          alt={`${motion.label} packed sheet`}
          className="block w-full"
          style={{ imageRendering: "pixelated" }}
        />
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: geometry.cols - 1 }, (_, i) => (
            <span
              key={`c${i}`}
              className="absolute top-0 bottom-0 w-px bg-cc-primary/40"
              style={{ left: `${((i + 1) / geometry.cols) * 100}%` }}
            />
          ))}
          {Array.from({ length: geometry.rows - 1 }, (_, i) => (
            <span
              key={`r${i}`}
              className="absolute right-0 left-0 h-px bg-cc-primary/40"
              style={{ top: `${((i + 1) / geometry.rows) * 100}%` }}
            />
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Fact label="Sheet">
          {geometry.width}×{geometry.height}
        </Fact>
        <Fact label="Grid">
          {geometry.cols}×{geometry.rows}
        </Fact>
        <Fact label="Cell">
          {geometry.cellWidth}×{geometry.cellHeight}
        </Fact>
        <Fact label="Pivot">
          {motion.anchor === "center" ? "0.5, 0.5" : "0.5, 1.0"}
        </Fact>
      </dl>
      <div className="flex flex-wrap gap-2">
        <DownloadLink href={sheet} label="sheet.png" />
        {atlas ? <DownloadLink href={atlas} label="atlas.json" /> : null}
      </div>
    </div>
  );
}

function InspectBlock({ motion }: { motion: Motion }) {
  const inspect = motion.inspect;
  if (!inspect) return null;
  const warned = inspect.warnings.length > 0;
  return (
    <div className="mt-auto border-t border-cc-border p-3">
      <h3 className="flex items-center gap-1.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cc-muted">
        {warned ? (
          <span className="text-cc-warning">
            <WarnIcon size={11} />
          </span>
        ) : null}
        Inspect
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Fact label="Frames">{inspect.frameCount}</Fact>
        <Fact label="Cell">
          {inspect.cell.width}×{inspect.cell.height}
        </Fact>
        <Fact label="Anchor drift">
          {inspect.anchorDrift.x.toFixed(1)}, {inspect.anchorDrift.y.toFixed(1)} px
        </Fact>
        <Fact label="Max jump">{inspect.maxJump.toFixed(1)} px</Fact>
        <Fact label="Scale drift">
          {(inspect.scaleDrift * 100).toFixed(1)}%
        </Fact>
        <Fact label="Empty">
          {inspect.emptyFrames.length === 0
            ? "none"
            : inspect.emptyFrames.map((n) => String(n).padStart(2, "0")).join(", ")}
        </Fact>
      </dl>
      {warned ? (
        <ul className="mt-2 flex flex-col gap-1 rounded-lg border border-cc-warning/40 bg-cc-warning/10 p-2">
          {inspect.warnings.map((warning) => (
            <li key={warning} className="text-[11px] leading-relaxed text-cc-fg">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-cc-muted">{label}</dt>
      <dd className="font-mono tabular-nums text-cc-fg">{children}</dd>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-cc-border px-1.5 py-px text-[10px] text-cc-muted">
      {children}
    </span>
  );
}

function DownloadLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 rounded border border-cc-border px-2 py-1 text-[11px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-primary"
    >
      <DownloadIcon size={12} />
      {label}
    </a>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-4 text-[11px] leading-relaxed text-cc-muted">{children}</p>
  );
}
