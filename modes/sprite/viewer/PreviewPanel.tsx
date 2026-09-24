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

import { useState } from "react";

import type { CharacterProject, Motion, MotionVideo } from "../domain.js";
import { resolveAssetUri } from "../domain.js";
import { type AtlasGeometry, atlasPivot } from "./atlas.js";
import {
  DownloadIcon,
  ExportIcon,
  EyeIcon,
  FilmIcon,
  GridIcon,
  ImageIcon,
  LoopIcon,
  RefreshIcon,
  SparkIcon,
  WarnIcon,
} from "./icons.js";
import {
  alphaCoverageOf,
  bodyDriftOf,
  bodyDriftVerdict,
  formatBytes,
  joinVerdict,
  loopDuration,
  maxJumpVerdict,
  scaleDriftVerdict,
  seamFillOf,
  seamOf,
  seamVerdict,
  stepOf,
  type MetricVerdict,
  type SizeLine,
} from "./metrics.js";
import {
  defaultTab,
  EXPORT_SWATCHES,
  exportRows,
  loopExports,
  motionLabel,
  normalizeExportColor,
  panelTabs,
  type ExportFamily,
  type ExportRow,
  type ExportRowOptions,
  type PanelTab,
} from "./panel.js";
import { RivePreview } from "./RivePreview.js";
import type { SpriteStrings } from "./strings.js";
import { contentUrl } from "./urls.js";

export type { PanelTab };

const TAB_ICON: Record<PanelTab, typeof ImageIcon> = {
  gif: ImageIcon,
  loop: LoopIcon,
  video: FilmIcon,
  atlas: GridIcon,
  export: ExportIcon,
};

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
  /** Whether an agent can be asked, and what has been asked of it. */
  exportOptions: ExportRowOptions;
  /** Ask the agent for an export. Absent in a viewing-only session. */
  onRequestExport?: (row: ExportRow, background: string | null) => void;
}

export function PreviewPanel(props: PreviewPanelProps) {
  const { project, motion, imageVersion, t } = props;
  const url = (assetId: string | undefined): string | null => {
    if (!assetId) return null;
    const uri = resolveAssetUri(project, assetId);
    return uri ? contentUrl(project.contentSet, uri, imageVersion) : null;
  };

  // The selected tab belongs to the SHELL, and the shell keeps it while the
  // user moves between motions — so a loop and a sprite motion can hand each
  // other a tab the other one does not have. Resolving it here (rather than
  // resetting the shell's state on every selection) means the strip and the
  // body always show the same thing, and the user's choice survives a trip
  // through a motion that could not honour it.
  const tabs = panelTabs(motion);
  const tab = tabs.includes(props.tab) ? props.tab : defaultTab(motion);

  const frame = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {!motion ? (
        <Empty>{t.selectMotionForPanel}</Empty>
      ) : tab === "gif" ? (
        <GifTab motion={motion} url={url} t={t} />
      ) : tab === "loop" ? (
        <LoopTab project={project} motion={motion} url={url} t={t} />
      ) : tab === "video" ? (
        <VideoTab
          motion={motion}
          url={url}
          t={t}
          renderVideoLabel={props.renderVideoLabel}
        />
      ) : tab === "export" ? (
        <ExportTab
          project={project}
          motion={motion}
          imageVersion={imageVersion}
          options={props.exportOptions}
          onRequest={props.onRequestExport}
          t={t}
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
        {tabs.map((id) => {
          const Icon = TAB_ICON[id];
          return (
          <button
            key={id}
            type="button"
            onClick={() => props.onTab(id)}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
              tab === id
                ? "bg-cc-primary/15 text-cc-primary"
                : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            }`}
          >
            <Icon size={12} />
            {t.tab[id]}
          </button>
          );
        })}
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

/**
 * A loop's deliverables: the animation itself, and the four files a page can
 * embed it as.
 *
 * Rendered at NATURAL smoothing, unlike every other picture in this viewer. A
 * sprite is pixel art and `imageRendering: pixelated` is the only honest way
 * to show it; a loop is a soft-shaded 3D icon scaled to whatever box the panel
 * has, and nearest-neighbour there is not fidelity, it is aliasing the user
 * would blame on the render.
 *
 * The sizes come from `metadata.size`, measured when the run was registered —
 * the point of printing them is that a 12 MB Lottie is a real problem for the
 * page this is going into, and the user should see it before downloading.
 */
function LoopTab({
  project,
  motion,
  url,
  t,
}: {
  project: CharacterProject;
  motion: Motion;
  url: UrlOf;
  t: SpriteStrings;
}) {
  const exports = loopExports(project, motion);
  const webp = url(motion.webp);
  if (!webp && exports.length === 0) {
    return <Empty>{t.noLoopYet}</Empty>;
  }
  const inspect = motion.inspect;
  const frames = motion.frames.length || inspect?.frameCount || 0;
  return (
    <div className="flex flex-col gap-3 p-3">
      {webp ? (
        <div
          className="flex items-center justify-center rounded-lg border border-cc-border p-3"
          style={CHECKER_STYLE}
        >
          <img
            src={webp}
            alt={motion.label}
            className="h-40 w-full object-contain"
            style={{ imageRendering: "auto" }}
          />
        </div>
      ) : null}
      <p className="text-[11px] leading-relaxed text-cc-muted">
        {t.loopMeta({
          frames,
          fps: motion.fps,
          duration: loopDuration(frames, motion.fps),
          seam: seamWord(motion),
          // `--seam-fill` grew this loop by N frames to close the wrap, so
          // the frame count above is not the clip's own. Saying how many is
          // what lets a user tell a shot that closed from one that was made
          // to; 0 says nothing, because the flag did not fire.
          seamFill: inspect ? seamFillOf(inspect) : null,
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        {exports.map((item) => {
          const href = url(item.assetId);
          return href ? (
            <DownloadLink
              key={item.format}
              href={href}
              label={t.exportLink(t.exportLabel[item.format], formatBytes(item.size))}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

/**
 * Does this loop close — as a word, or null when nobody measured.
 *
 * Both halves are needed: a seam with no step has no bar to be judged against,
 * and printing "closes" from a seam alone would be an opinion dressed as a
 * measurement.
 */
function seamWord(motion: Motion): "closes" | "open" | null {
  const inspect = motion.inspect;
  if (!inspect) return null;
  if (seamOf(inspect) === null || stepOf(inspect) === null) return null;
  return seamVerdict(inspect).over ? "open" : "closes";
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
        {/* A matte or an interpolation is not a take of its own: "veed" and
            "derived" beside each other say nothing about WHICH clip it was
            made from, which is the only thing that distinguishes it from the
            three other files in this tab. */}
        {video.derivedFrom && video.op ? (
          <Chip>{t.derivedClip(video.derivedFrom, video.op, video.model)}</Chip>
        ) : (
          <>
            <Chip>{video.model}</Chip>
            <Chip>{video.mode}</Chip>
          </>
        )}
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

  // "No packed atlas YET" would be a promise: a loop never gets one. Its
  // frames ARE the sequence, so the empty state says what exists instead.
  if (motion.kind === "loop") {
    const inspect = motion.inspect;
    return (
      <Empty>
        {t.noAtlasForLoop({
          frames: motion.frames.length || inspect?.frameCount || 0,
          width: inspect?.cell.width ?? 0,
          height: inspect?.cell.height ?? 0,
        })}
      </Empty>
    );
  }

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

const EXPORT_FAMILIES: ExportFamily[] = ["video", "frames", "rive"];

/**
 * Every format this motion can be delivered as, in three sections.
 *
 * The rows are `exportRows` verbatim — this component decides nothing about
 * which formats exist, only how a row looks. A row is a download when its
 * file exists, a Generate button when it can be asked for, or the reason it
 * is not offered; in a session without an agent only the downloads are there.
 * The MP4 row carries the one choice a request needs besides the format: the
 * colour the frames are flattened onto.
 */
function ExportTab({
  project,
  motion,
  imageVersion,
  options,
  onRequest,
  t,
}: {
  project: CharacterProject;
  motion: Motion;
  imageVersion: number;
  options: ExportRowOptions;
  onRequest?: (row: ExportRow, background: string | null) => void;
  t: SpriteStrings;
}) {
  const [background, setBackground] = useState<string>(EXPORT_SWATCHES[0]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const rows = exportRows(project, motion, {
    ...options,
    canRequest: options.canRequest && !!onRequest,
  });
  if (rows.length === 0) return <Empty>{t.exportNothingReady}</Empty>;

  const fileUrl = (uri: string, createdAt: number) =>
    contentUrl(project.contentSet, uri, imageVersion, createdAt);
  const labels = new Map(project.sprite.motions.map((m) => [m.id, motionLabel(project, m)]));

  return (
    <div className="flex flex-col gap-4 p-3">
      {EXPORT_FAMILIES.map((family) => {
        const inFamily = rows.filter((row) => row.family === family);
        if (inFamily.length === 0) return null;
        return (
          <section key={family} className="flex flex-col gap-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cc-muted">
              {t.exportFamily[family]}
            </h3>
            {inFamily.map((row) => (
              <ExportRowView
                key={row.key}
                row={row}
                motion={motion}
                labels={labels}
                fileUrl={fileUrl}
                background={background}
                onBackground={setBackground}
                previewOpen={previewOpen}
                onPreview={setPreviewOpen}
                onRequest={onRequest}
                t={t}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ExportRowView({
  row,
  motion,
  labels,
  fileUrl,
  background,
  onBackground,
  previewOpen,
  onPreview,
  onRequest,
  t,
}: {
  row: ExportRow;
  motion: Motion;
  /** Each motion's name on the stage, for the Rive preview's buttons. */
  labels: ReadonlyMap<string, string>;
  fileUrl: (uri: string, createdAt: number) => string;
  background: string;
  onBackground: (hex: string) => void;
  previewOpen: boolean;
  onPreview: (open: boolean) => void;
  onRequest?: (row: ExportRow, background: string | null) => void;
  t: SpriteStrings;
}) {
  const [colorValid, setColorValid] = useState(true);
  const state = row.state;
  const ready = state.kind === "ready";
  const offered = state.kind !== "not-offered";
  const riv = row.format === "riv";
  const takesColor = row.format === "mp4" && row.canGenerate;
  const motions = row.rive?.motions.length ?? 0;
  const transitions = row.rive?.transitions.length ?? 0;
  const request = () => onRequest?.(row, row.format === "mp4" ? background : null);
  const rivFile = riv && state.kind === "ready" ? state.files[0] : null;

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-lg border p-2 ${
        offered ? "border-cc-border bg-cc-bg/40" : "border-cc-border/60 bg-transparent"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`text-[12px] ${offered ? "text-cc-fg" : "text-cc-muted"}`}
          title={row.builtIn ? t.exportBuiltInTitle : undefined}
        >
          {t.exportFormatName[row.format]}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-cc-muted" title={t.exportPurpose(row.format, { motions, transitions })}>
          {t.exportPurpose(row.format, { motions, transitions })}
        </span>
      </div>

      {state.kind === "not-offered" ? (
        <p className="text-[11px] leading-relaxed text-cc-muted">
          {t.exportNotOffered[state.reason]}
        </p>
      ) : null}

      {offered && row.video ? (
        <p className="font-mono text-[10px] text-cc-muted">
          {t.exportRepeat(row.video, motion.loop)}
          {row.background ? ` · ${t.exportOnBackground(row.background)}` : null}
        </p>
      ) : null}

      {riv && row.rive ? (
        <>
          {/* On a transition's own tab: a transition is not a Rive file of
              its own, it is part of the character's. A file made before it
              was is said by the missing line below instead. */}
          {motion.kind === "transition" && offered && row.rive.transitions.includes(motion.id) ? (
            <p className="text-[11px] leading-relaxed text-cc-muted">
              {t.exportRiveTransition(transitions)}
            </p>
          ) : null}
          {ready && row.rive.missing.length > 0 ? (
            <p className="rounded border border-cc-warning/40 bg-cc-warning/10 px-2 py-1 text-[11px] leading-relaxed text-cc-fg">
              {row.rive.tooHeavy
                ? t.exportNotOffered["too-heavy"]
                : t.exportRiveMissing(row.rive.missing)}
            </p>
          ) : null}
          {/* Before the file exists these are the plan a Generate would
              follow; after, what the file recorded — either way the rate and
              size it plays at, never the source frames'. */}
          {offered && row.rive.loops ? (
            <p className="font-mono text-[10px] text-cc-muted">{t.exportRiveLoops(row.rive.loops)}</p>
          ) : null}
          {row.rive.decodeBytes !== undefined ? (
            <p className={`text-[10px] ${row.rive.tooHeavy && !ready ? "text-cc-warning" : "text-cc-muted"}`}>
              {t.exportRiveMemory(formatBytes(row.rive.decodeBytes) ?? "")}
            </p>
          ) : null}
        </>
      ) : null}

      {takesColor && !row.requested ? (
        <ColorChoice
          value={background}
          onChange={onBackground}
          onValidity={setColorValid}
          t={t}
        />
      ) : null}

      {offered ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {state.kind === "ready"
            ? state.files.map((file) => (
                <DownloadLink
                  key={file.assetId}
                  href={fileUrl(file.uri, file.createdAt)}
                  label={t.exportLink(file.name, formatBytes(file.size))}
                />
              ))
            : null}
          {rivFile ? (
            <button
              type="button"
              onClick={() => onPreview(!previewOpen)}
              aria-pressed={previewOpen}
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
                previewOpen
                  ? "border-cc-primary/60 bg-cc-primary/15 text-cc-primary"
                  : "border-cc-border text-cc-muted hover:border-cc-primary/40 hover:text-cc-primary"
              }`}
            >
              <EyeIcon size={12} />
              {t.rivePreview}
            </button>
          ) : null}
          {row.canGenerate ? (
            row.requested ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-cc-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
                {ready ? t.exportUpdating : t.exportRequested}
                <button
                  type="button"
                  onClick={request}
                  className="rounded px-1 text-[10px] text-cc-muted underline-offset-2 transition-colors hover:text-cc-fg hover:underline"
                >
                  {t.exportAskAgain}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={request}
                disabled={takesColor && !colorValid}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 disabled:opacity-40 ${
                  ready
                    ? "border-cc-border text-cc-muted hover:border-cc-primary/40 hover:text-cc-primary"
                    : "border-cc-primary/50 bg-cc-primary/15 text-cc-primary hover:bg-cc-primary/25"
                }`}
              >
                {ready ? <RefreshIcon size={12} /> : <SparkIcon size={12} />}
                {ready ? t.exportRegenerate : t.exportGenerate}
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {rivFile && previewOpen ? (
        <RivePreview
          src={fileUrl(rivFile.uri, rivFile.createdAt)}
          machine={row.rive?.machine ?? null}
          labels={labels}
          t={t}
          onClose={() => onPreview(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The MP4 background: a few swatches and a hex field, token-styled — no
 * native colour picker, whose OS chrome would sit in the middle of the panel.
 * The swatch fill is the one colour here that is not a token, because it IS
 * the value being chosen.
 */
function ColorChoice({
  value,
  onChange,
  onValidity,
  t,
}: {
  value: string;
  onChange: (hex: string) => void;
  onValidity: (valid: boolean) => void;
  t: SpriteStrings;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const pick = (hex: string) => {
    setDraft(hex);
    setInvalid(false);
    onValidity(true);
    onChange(hex);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-cc-muted">{t.exportBackground}</span>
      {EXPORT_SWATCHES.map((hex) => (
        <button
          key={hex}
          type="button"
          onClick={() => pick(hex)}
          title={hex}
          aria-label={hex}
          aria-pressed={value === hex}
          className={`h-4 w-4 rounded border transition-shadow focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
            value === hex ? "border-cc-primary ring-2 ring-cc-primary/60" : "border-cc-border"
          }`}
          style={{ backgroundColor: hex }}
        />
      ))}
      <input
        type="text"
        value={draft}
        spellCheck={false}
        maxLength={7}
        aria-label={t.exportBackgroundField}
        aria-invalid={invalid}
        title={invalid ? t.exportColorInvalid : t.exportBackgroundField}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const hex = normalizeExportColor(next);
          setInvalid(hex === null);
          onValidity(hex !== null);
          if (hex) onChange(hex);
        }}
        className={`w-[4.75rem] appearance-none rounded border bg-cc-input-bg px-1.5 py-0.5 font-mono text-[11px] text-cc-fg outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
          invalid ? "border-cc-error/60" : "border-cc-border"
        }`}
      />
      {invalid ? (
        <span className="text-[10px] text-cc-error">{t.exportColorInvalid}</span>
      ) : null}
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
        {motion.kind === "loop" ? (
          <LoopFacts motion={motion} t={t} />
        ) : motion.kind === "transition" ? (
          <TransitionFacts motion={motion} t={t} />
        ) : (
          <>
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
          </>
        )}
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

/**
 * What a loop is judged on.
 *
 * Not one anchor row among them, and that is the point: a loop is never stood
 * on a floor, so `anchorDrift` / `maxJump` / `scaleDrift` describe nothing —
 * printing them would be five numbers nobody can act on next to the two that
 * decide whether the workflow succeeded. The seam carries its own bar (twice
 * the median step, the pipeline's own rule) so a user can argue with the
 * verdict instead of taking it.
 */
function LoopFacts({ motion, t }: { motion: Motion; t: SpriteStrings }) {
  const inspect = motion.inspect!;
  const seam = seamOf(inspect);
  const step = stepOf(inspect);
  const alpha = alphaCoverageOf(inspect);
  const frames = motion.frames.length || inspect.frameCount;
  const duration = loopDuration(frames, motion.fps);
  const verdict = seamWord(motion);
  return (
    <>
      {seam === null ? null : (
        <Measured
          label={t.factSeam}
          value={`${seam.toFixed(4)}${verdict ? ` · ${t.seamVerdict[verdict]}` : ""}`}
          verdict={seamVerdict(inspect)}
          limitText={(limit) => limit.toFixed(4)}
          // The one row carrying three things — the number, the verdict and
          // the bar — and the only one anybody reads first. In a half-width
          // cell it wraps its own limit onto a second line.
          wide
          t={t}
        />
      )}
      {step === null ? null : (
        <Fact label={t.factStep}>{step.toFixed(4)}</Fact>
      )}
      <Fact label={t.factFrames}>{frames}</Fact>
      <Fact label={t.factFps}>{motion.fps}</Fact>
      {duration === null ? null : (
        <Fact label={t.factDuration}>{duration.toFixed(2)} s</Fact>
      )}
      {alpha === null ? null : (
        <Fact label={t.factAlpha}>{(alpha * 100).toFixed(1)}%</Fact>
      )}
    </>
  );
}

/**
 * What a transition is judged on: whether each end lands on its loop's first
 * frame — `startGap` and `endGap` against twice the clip's own step, the
 * seam's bar — then how long it runs.
 */
function TransitionFacts({ motion, t }: { motion: Motion; t: SpriteStrings }) {
  const inspect = motion.inspect!;
  const joins = joinVerdict(inspect);
  const step = stepOf(inspect);
  const frames = motion.frames.length || inspect.frameCount;
  const duration = loopDuration(frames, motion.fps);
  return (
    <>
      {([["start", t.factStartGap], ["end", t.factEndGap]] as const).map(([end, label]) =>
        joins[end].gap === null ? null : (
          <Measured
            key={end}
            label={label}
            value={`${joins[end].gap!.toFixed(4)}${joins[end].limit === null ? "" : ` · ${t.joinVerdict[joins[end].over ? "off" : "lands"]}`}`}
            verdict={joins[end]}
            limitText={(limit) => limit.toFixed(4)}
            wide
            t={t}
          />
        ),
      )}
      {step === null ? null : <Fact label={t.factStep}>{step.toFixed(4)}</Fact>}
      <Fact label={t.factFrames}>{frames}</Fact>
      <Fact label={t.factFps}>{motion.fps}</Fact>
      {duration === null ? null : <Fact label={t.factDuration}>{duration.toFixed(2)} s</Fact>}
    </>
  );
}

/** One inspect value with the bar it is judged by, amber when it is over. */
function Measured({
  label,
  value,
  verdict,
  limitText,
  wide = false,
  t,
}: {
  label: string;
  value: string;
  verdict: MetricVerdict;
  limitText: (limit: number) => string;
  /** Take the whole grid row instead of one of its two columns. */
  wide?: boolean;
  t: SpriteStrings;
}) {
  return (
    <div className={wide ? "col-span-2 flex flex-col" : "flex flex-col"}>
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
