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
 * motion's declared columns rather than read back out of `atlas.json`, which
 * keeps the panel free of a second data source and is what makes it work in
 * the hosted player with no fetch at render time. The geometry itself is
 * computed once by the shell and handed down, so the size phrase in the
 * header and the numbers in this tab are the SAME numbers rather than two
 * derivations that can disagree — the disagreement was the finding.
 *
 * The inspect block prints every value against the bar the pipeline judges it
 * by. A bare "27.9%" let three sessions end with an agent calling a warning
 * ignorable while the screen said nothing either way; a value with its limit
 * beside it, amber when it is over, is a fact the user can argue with.
 */

import type { CharacterProject, Motion, MotionVideo } from "../domain.js";
import { resolveAssetUri } from "../domain.js";
import { type AtlasGeometry, atlasPivot } from "./atlas.js";
import { DownloadIcon, FilmIcon, GridIcon, ImageIcon, WarnIcon } from "./icons.js";
import {
  bodyDriftOf,
  bodyDriftVerdict,
  maxJumpVerdict,
  scaleDriftVerdict,
  type MetricVerdict,
  type SizeLine,
} from "./metrics.js";
import type { PanelTab } from "./panel.js";
import type { SpriteStrings } from "./strings.js";
import { contentUrl } from "./urls.js";

export type { PanelTab };

const TABS: Array<{ id: PanelTab; icon: typeof ImageIcon }> = [
  { id: "gif", icon: ImageIcon },
  { id: "video", icon: FilmIcon },
  { id: "atlas", icon: GridIcon },
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
  /** The shell's geometry for the selected motion — null when none is. */
  geometry: AtlasGeometry | null;
  /** The same phrase the header shows, so the two cannot drift. */
  sizeLine: SizeLine;
  t: SpriteStrings;
  /** The label of the command that renders a clip, quoted in the empty state
   *  so the sentence names a button the user can actually see. */
  renderVideoLabel: string | null;
  /** Docked to the right on a wide pane, under the stage on a narrow one. */
  placement: "side" | "bottom";
}

export function PreviewPanel(props: PreviewPanelProps) {
  const { project, motion, imageVersion, t } = props;
  const url = (assetId: string | undefined): string | null => {
    if (!assetId) return null;
    const uri = resolveAssetUri(project, assetId);
    return uri ? contentUrl(project.contentSet, uri, imageVersion) : null;
  };

  const frame = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {!motion ? (
        <Empty>{t.selectMotionForPanel}</Empty>
      ) : props.tab === "gif" ? (
        <GifTab motion={motion} url={url} t={t} />
      ) : props.tab === "video" ? (
        <VideoTab
          motion={motion}
          url={url}
          t={t}
          renderVideoLabel={props.renderVideoLabel}
        />
      ) : (
        <AtlasTab
          motion={motion}
          url={url}
          t={t}
          geometry={props.geometry}
          sizeLine={props.sizeLine}
        />
      )}
      {motion ? <InspectBlock motion={motion} t={t} /> : null}
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
        {TABS.map(({ id, icon: Icon }) => (
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
            {t.tab[id]}
          </button>
        ))}
      </div>
      {frame}
    </aside>
  );
}

type UrlOf = (assetId: string | undefined) => string | null;

function GifTab({
  motion,
  url,
  t,
}: {
  motion: Motion;
  url: UrlOf;
  t: SpriteStrings;
}) {
  const gif = url(motion.gif);
  const webp = url(motion.webp);
  if (!gif && !webp) {
    return <Empty>{t.noPreviewYet}</Empty>;
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      <div
        className="flex items-center justify-center rounded-lg border border-cc-border p-3"
        style={CHECKER_STYLE}
      >
        {/* A sprite preview is usually far smaller than this panel; letting it
            sit at its natural size reads as a broken thumbnail, so it scales
            to the box (nearest-neighbour, both directions). */}
        <img
          src={(gif ?? webp) as string}
          alt={motion.label}
          className="h-40 w-full object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-cc-muted">
        {t.previewMeta({
          fps: motion.fps,
          loop: motion.loop,
          frames: motion.frames.length,
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        {gif ? <DownloadLink href={gif} label="preview.gif" /> : null}
        {webp ? <DownloadLink href={webp} label="preview.webp" /> : null}
      </div>
    </div>
  );
}

function VideoTab({
  motion,
  url,
  t,
  renderVideoLabel,
}: {
  motion: Motion;
  url: UrlOf;
  t: SpriteStrings;
  renderVideoLabel: string | null;
}) {
  if (motion.videos.length === 0) {
    return <Empty>{t.noVideoYet(renderVideoLabel ?? t.tab.video)}</Empty>;
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      {motion.videos.map((video) => (
        <VideoCard key={video.id} video={video} href={url(video.asset)} t={t} />
      ))}
    </div>
  );
}

function VideoCard({
  video,
  href,
  t,
}: {
  video: MotionVideo;
  href: string | null;
  t: SpriteStrings;
}) {
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
          {t.videoStatus[video.status]}
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
          {video.status === "failed" ? t.renderFailed : t.clipFileMissing}
        </p>
      )}

      {video.prompt ? (
        <p className="line-clamp-3 text-[11px] leading-relaxed text-cc-muted">
          {video.prompt}
        </p>
      ) : null}
      {/* Only a finished clip is a file worth offering: a render still in
          flight may point at the previous take, or at nothing. */}
      {video.status === "ready" && href ? (
        <DownloadLink href={href} label={t.downloadClip} />
      ) : null}
    </div>
  );
}

function AtlasTab({
  motion,
  url,
  t,
  geometry,
  sizeLine,
}: {
  motion: Motion;
  url: UrlOf;
  t: SpriteStrings;
  geometry: AtlasGeometry | null;
  sizeLine: SizeLine;
}) {
  const sheet = url(motion.sheet);
  const atlas = url(motion.atlas);
  const pivot = atlasPivot(motion);

  if (!sheet || !geometry) {
    return <Empty>{t.noAtlasYet}</Empty>;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div
        className="relative overflow-hidden rounded-lg border border-cc-border"
        style={CHECKER_STYLE}
      >
        <img
          src={sheet}
          alt={motion.label}
          className="block w-full"
          style={{ imageRendering: "pixelated" }}
        />
        {/* Only drawn over a layout that has been checked against the packed
            image: lines on a grid that is not there are worse than no lines,
            because they look exactly like lines on a grid that is. */}
        {geometry.trusted ? (
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
        ) : null}
      </div>
      {geometry.note ? (
        <p className="rounded-lg border border-cc-warning/40 bg-cc-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-cc-fg">
          {t.atlasNote(geometry.note)}
        </p>
      ) : null}
      {/* The header's phrase, repeated where the packed numbers are read —
          the same three facts, not a second derivation of them. */}
      <p className="font-mono text-[11px] tabular-nums text-cc-muted">
        {t.sizeLine(sizeLine)}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Fact label={t.factSheet}>
          {geometry.width > 0 ? `${geometry.width}×${geometry.height}` : "—"}
        </Fact>
        <Fact label={t.factGrid}>
          {geometry.trusted ? `${geometry.cols}×${geometry.rows}` : "—"}
        </Fact>
        <Fact label={t.factCell}>
          {geometry.trusted
            ? `${geometry.cellWidth}×${geometry.cellHeight}`
            : "—"}
        </Fact>
        {/* The same point the stage's guide is drawn on, said as the ratio
            atlas.json carries. An assumed pivot is labelled so, because a
            measured `0.5, 1.0` and an assumed one mean different things. */}
        <Fact
          label={t.factPivot}
          title={
            pivot.measured
              ? t.pivotMeasuredTitle
              : t.pivotAssumedTitle(motion.anchor)
          }
        >
          {formatPivot(pivot.x)}, {formatPivot(pivot.y)}
          {pivot.measured ? null : (
            <span className="pl-1 text-[10px] text-cc-muted">{t.assumed}</span>
          )}
        </Fact>
      </dl>
      <div className="flex flex-wrap gap-2">
        <DownloadLink href={sheet} label="sheet.png" />
        {atlas ? <DownloadLink href={atlas} label="atlas.json" /> : null}
      </div>
    </div>
  );
}

function InspectBlock({ motion, t }: { motion: Motion; t: SpriteStrings }) {
  const inspect = motion.inspect;
  if (!inspect) return null;
  const warned = inspect.warnings.length > 0;
  const acknowledged = inspect.acknowledged ?? null;
  const bodyDrift = bodyDriftOf(inspect);
  return (
    <div className="mt-auto border-t border-cc-border p-3">
      <h3 className="flex items-center gap-1.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cc-muted">
        {warned ? (
          <span className={acknowledged ? "text-cc-warning/40" : "text-cc-warning"}>
            <WarnIcon size={11} />
          </span>
        ) : null}
        {t.inspect}
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Fact label={t.factFrames}>{inspect.frameCount}</Fact>
        <Fact label={t.factCell}>
          {inspect.cell.width}×{inspect.cell.height}
        </Fact>
        <Fact label={t.factAnchorDrift}>
          {inspect.anchorDrift.x.toFixed(1)}, {inspect.anchorDrift.y.toFixed(1)} px
        </Fact>
        <Measured
          label={t.factMaxJump}
          value={`${inspect.maxJump.toFixed(1)} px`}
          verdict={maxJumpVerdict(inspect)}
          limitText={(limit) => `${limit} px`}
          t={t}
        />
        <Measured
          label={t.factScaleDrift}
          value={`${(inspect.scaleDrift * 100).toFixed(1)}%`}
          verdict={scaleDriftVerdict(inspect)}
          limitText={(limit) => `${Math.round(limit * 100)}%`}
          t={t}
        />
        {bodyDrift !== null ? (
          <Measured
            label={t.factBodyDrift}
            value={`${bodyDrift.toFixed(1)} px`}
            verdict={bodyDriftVerdict(inspect)}
            limitText={(limit) => `${limit} px`}
            t={t}
          />
        ) : null}
        <Fact label={t.factEmpty}>
          {inspect.emptyFrames.length === 0
            ? t.none
            : inspect.emptyFrames.map((n) => String(n).padStart(2, "0")).join(", ")}
        </Fact>
      </dl>
      {warned ? (
        <ul
          className={`mt-2 flex flex-col gap-1 rounded-lg border p-2 ${
            acknowledged
              ? "border-cc-border bg-cc-warning/5"
              : "border-cc-warning/40 bg-cc-warning/10"
          }`}
        >
          {inspect.warnings.map((warning) => (
            <li
              key={warning}
              className={`text-[11px] leading-relaxed ${
                acknowledged ? "text-cc-muted" : "text-cc-fg"
              }`}
            >
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      {/* Kept OUTSIDE the warning list: the reason is the agent's sentence
          about the pipeline's sentences, and folding it in would read as one
          more thing the pipeline found. */}
      {acknowledged ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-cc-muted">
          {t.acknowledged(acknowledged.reason)}
        </p>
      ) : null}
    </div>
  );
}

/** One inspect value with the bar it is judged by, amber when it is over. */
function Measured({
  label,
  value,
  verdict,
  limitText,
  t,
}: {
  label: string;
  value: string;
  verdict: MetricVerdict;
  limitText: (limit: number) => string;
  t: SpriteStrings;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-cc-muted">
        {label}
      </dt>
      <dd className="font-mono tabular-nums">
        <span className={verdict.over ? "text-cc-warning" : "text-cc-fg"}>
          {value}
        </span>
        {verdict.limit !== null ? (
          <span className="pl-1 text-[10px] text-cc-muted">
            {t.limit(limitText(verdict.limit))}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function Fact({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col" title={title}>
      <dt className="text-[10px] uppercase tracking-wide text-cc-muted">{label}</dt>
      <dd className="font-mono tabular-nums text-cc-fg">{children}</dd>
    </div>
  );
}

/** `1` reads as a count, `1.0` reads as a ratio — and the pivot is a ratio. */
function formatPivot(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
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
