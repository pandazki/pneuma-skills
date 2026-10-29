/**
 * The episode desk: one episode, top to bottom — its header and commands,
 * the stale-bible flag, the screen with its takes and spend, the shot strip
 * and the selected shot.
 *
 * The screen shows the clip in effect when there is one (the episode's
 * final, or the part's take). With no clip it is an animatic: the current
 * shot's storyboard panel, or — before any storyboard — a slate with the
 * shot's words over the scene's design sheet, so a series that has only a
 * bible and a shot list still reads in time.
 */

import type { RefObject } from "react";

import type { EpisodeView, PartView, Series } from "../domain.js";
import { cardName, cellName, cellVerdict, isBusy, shotSpan } from "../domain.js";
import { cellRect } from "../skill/scripts/grid.mjs";
import { gridOf } from "../skill/scripts/series-state.mjs";
import { mediaUrl } from "./media.js";
import { ShotDetail, type DetailHandlers } from "./ShotDetail.js";
import { stageLabel } from "./SeasonRail.js";
import { ShotStrip } from "./ShotStrip.js";
import type { SeriesStrings } from "./strings.js";
import { Btn, Card, Chip, FailureNote, HATCH, PlayIcon, Tiny } from "./ui.js";
import { callLabel, fmtSec, fmtUsd, secondsSince, type Lane } from "./view-model.js";

export type DeskCommand =
  | "shoot-board"
  | "shoot-video"
  | "review-episode"
  | "patch-range"
  | "redo-panel"
  | "retry";

export interface ScreenMedia {
  url: string;
  /** Episode-clock second at the clip's t = 0. */
  offset: number;
  label: string;
  /** The take / patch / final asset id. */
  asset: string;
}

export interface DeskProps {
  series: Series;
  episode: EpisodeView;
  part: PartView;
  base: string;
  t: SeriesStrings;
  layout: "wide" | "mid" | "narrow";
  ratio: number;
  shot: number | null;
  check: string | null;
  lane: Lane;
  time: number;
  range: [number, number] | null;
  playing: boolean;
  media: ScreenMedia | null;
  viewingTake: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  canWrite: boolean;
  canCommand: boolean;
  imagesOk: boolean;
  videoOk: boolean;
  now: number;
  onTogglePlay: () => void;
  onLane: (lane: Lane) => void;
  onPart: (id: string) => void;
  onSelectShot: (shot: number, extend: boolean) => void;
  onClearRange: () => void;
  onDragBorder: (index: number, dur: number) => string | null;
  onCommand: (id: DeskCommand, extra?: { shot?: number }) => void;
  onAcknowledge: () => void;
  onShowTake: (asset: string | null) => void;
  onUseTake: (asset: string) => void;
  onOverlay: (overlay: "grid" | "prompts") => void;
  onVideoTime: () => void;
  onVideoEnded: () => void;
  detail: DetailHandlers;
}

function Header(props: DeskProps) {
  const { episode, part, t, series } = props;
  const names = episode.cast.map((id) => cardName(series, "character", id));
  const scene = episode.scene ? cardName(series, "scene", episode.scene) : null;
  const goal = typeof episode.episode.log?.goal === "string" ? episode.episode.log.goal : null;
  const shots = episode.parts.reduce((n, p) => n + p.shots.length, 0);

  let primary: { id: DeskCommand; label: string; ok: boolean; why?: string } | null = null;
  if (episode.stage !== "draft") {
    if (!part.board) primary = { id: "shoot-board", label: t.shootBoard, ok: props.imagesOk, why: t.needImagesKey };
    else if (!part.take) primary = { id: "shoot-video", label: t.shootVideo, ok: props.videoOk, why: t.needVideoKey };
    else if (props.range) primary = { id: "patch-range", label: t.patchSpan, ok: props.videoOk, why: t.needVideoKey };
    // Unchecked cells are the next job whether or not contact sheets exist.
    else if (episode.stage === "shot" || (episode.stage === "reviewed" && episode.unverified > 0)) {
      primary = { id: "review-episode", label: t.review, ok: true };
    }
    else primary = { id: "patch-range", label: t.patchSpan, ok: false, why: t.markSpanFirst };
  }

  return (
    <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
      <h2 className="m-0 text-[15px] font-semibold text-cc-fg">
        {episode.id} 《{episode.title}》
      </h2>
      <div className="flex flex-wrap gap-2.5 text-[11.5px] text-cc-muted">
        <span>{t.shotsMeta(episode.duration, shots)}</span>
        {scene ? <span>{scene}</span> : null}
        {names.length ? <span>{t.castMeta(names.join("、"))}</span> : null}
        {goal ? <span>{t.goalMeta(goal)}</span> : null}
        {episode.flag?.acknowledged ? <Chip tone="dim">{t.acknowledged(episode.flag.latest)}</Chip> : null}
      </div>
      <div className="ml-auto flex flex-wrap gap-1.5">
        <Btn disabled={part.boards.length === 0} onClick={() => props.onOverlay("grid")}>
          {part.boards.length > 1 ? t.wholeGridCount(part.boards.length) : t.wholeGrid}
        </Btn>
        <Btn onClick={() => props.onOverlay("prompts")}>{t.prompts}</Btn>
        {primary?.id !== "review-episode" ? (
          <Btn disabled={!props.canCommand || !part.take} onClick={() => props.onCommand("review-episode")}>
            {t.review}
          </Btn>
        ) : null}
        {primary ? (
          <Btn
            primary
            disabled={!props.canCommand || !primary.ok}
            title={!primary.ok ? primary.why : undefined}
            onClick={() => props.onCommand(primary!.id)}
          >
            {primary.label}
          </Btn>
        ) : null}
      </div>
    </header>
  );
}

function Flag(props: DeskProps) {
  const { episode, t } = props;
  const flag = episode.flag;
  if (!flag?.stale) return null;
  const names = flag.changes.map((c) => c.name).join("、");
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2.5 rounded-[9px] border border-cc-warning/50 bg-cc-warning/10 px-2.5 py-[7px] text-[11.5px] text-cc-fg"
    >
      <span className="font-semibold text-cc-warning">{t.flagHead(flag.shotUnder ?? 0)}</span>
      <span>{t.flagBody(names, flag.latest)}</span>
      <span className="font-mono text-[10.5px] text-cc-muted">
        {flag.changes
          .map((c) => `${c.name}: ${c.fields.map((f) => t.fieldLabel(f)).join(" / ")}`)
          .join(" · ")}
      </span>
      <div className="ml-auto flex gap-1.5">
        <Btn disabled={!props.canCommand || !props.videoOk} onClick={() => props.onCommand("shoot-video")}>
          {t.reshootAll}
        </Btn>
        <Btn disabled={!props.canWrite} onClick={props.onAcknowledge}>
          {t.acknowledge}
        </Btn>
      </div>
    </div>
  );
}

/**
 * The current shot's panel, cropped out of the board and scaled to cover a
 * frame of `ratio` (uniform scale, centred), as a CSS background.
 */
function panelBackground(props: DeskProps, shot: number): React.CSSProperties | null {
  const board = props.part.board;
  const src = board ? mediaUrl(props.base, board.view) : null;
  if (!board || !src || !board.view.width || !board.view.height) return null;
  const W = board.view.width;
  const H = board.view.height;
  const grid = gridOf(Math.max(1, board.record.shots?.length || props.part.shots.length));
  const rect = cellRect(W, H, grid.rows, grid.cols, Math.min(shot, grid.rows * grid.cols));
  // Units: the frame is 1 wide and 1/ratio tall; k maps image px to frame units.
  const frameH = 1 / props.ratio;
  const k = Math.max(1 / rect.w, frameH / rect.h);
  const offsetX = (1 - rect.w * k) / 2 - rect.x * k;
  const offsetY = (frameH - rect.h * k) / 2 - rect.y * k;
  const pct = (offset: number, frame: number, image: number) =>
    Math.abs(frame - image) < 1e-9 ? 0 : (offset / (frame - image)) * 100;
  return {
    backgroundImage: `url("${src}")`,
    backgroundSize: `${W * k * 100}% auto`,
    backgroundPosition: `${pct(offsetX, 1, W * k)}% ${pct(offsetY, frameH, H * k)}%`,
    backgroundRepeat: "no-repeat",
  };
}

function Screen(props: DeskProps) {
  const { episode, part, t, series, media, lane, time, shot } = props;
  const current = shot ?? 1;
  const span = shotSpan(part, current);
  const data = part.shots[current - 1];
  const cells = part.checks.filter((c) => c.shot === current && cellVerdict(c) === "drift" && !c.accepted);
  const scene = series.cards.find((c) => c.kind === "scene" && c.id === episode.scene);
  const backdrop = scene?.sheet ? mediaUrl(props.base, scene.sheet) : null;
  const showVideo = lane === "clip" && media;
  const panel = !showVideo && part.board ? panelBackground(props, current) : null;
  const boardBusy = part.boards.some((b) => isBusy(b.view));
  const takeBusy = part.takes.some((x) => isBusy(x.view));
  const duration = episode.duration || 0;

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-[10px] border border-cc-border bg-black"
        style={{ aspectRatio: String(props.ratio) }}
      >
        {showVideo ? (
          // CORS mode, so a capture can read the decoded frame: in dev the
          // clip comes from the API origin, not the page's, and a frame
          // drawn from a no-cors cross-origin video taints the canvas — the
          // capture then shows a black rectangle. `/content` answers with
          // `Access-Control-Allow-Origin: *`; same-origin builds are unaffected.
          <video
            ref={props.videoRef}
            key={media.url}
            src={media.url}
            crossOrigin="anonymous"
            playsInline
            preload="auto"
            onClick={props.onTogglePlay}
            onTimeUpdate={props.onVideoTime}
            onSeeked={props.onVideoTime}
            onEnded={props.onVideoEnded}
            className="h-full w-full bg-black object-contain"
          />
        ) : panel ? (
          <div className="h-full w-full bg-[#ece8df]" style={panel} />
        ) : (
          <div className="relative h-full w-full">
            {backdrop ? (
              <img src={backdrop} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-30" />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/20" />
            <div className="absolute inset-0 flex flex-col justify-end gap-2 px-[7%] pb-[9%] pt-10">
              {episode.stage !== "draft" ? (
                <p className="m-0 max-w-[60ch] text-[11px] leading-[1.5] text-cc-muted">{t.noClipBody(episode.stage)}</p>
              ) : null}
              {data ? (
                <div className="min-h-0 overflow-hidden">
                  <div className="mb-1.5 flex items-baseline gap-2 text-cc-fg">
                    <span className="text-[34px] font-semibold leading-none tabular-nums">{current}</span>
                    <span className="text-[11px] tabular-nums text-cc-muted">
                      {span ? `${fmtSec(span[0])}–${fmtSec(span[1])}s` : ""} · {fmtSec(Number(data.dur) || 0).replace(/\.0$/, "")}s
                    </span>
                  </div>
                  <p className="m-0 line-clamp-4 max-w-[62ch] text-[14px] leading-[1.6] text-cc-fg/95">{data.desc}</p>
                  {data.sfx ? <p className="m-0 mt-1 line-clamp-1 text-[11.5px] text-cc-muted">{t.sfx} · {data.sfx}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        )}
        {(boardBusy && !part.board) || (takeBusy && !media) ? <span className="pointer-events-none absolute inset-0 opacity-60" style={HATCH} /> : null}

        <div className="pointer-events-none absolute left-2.5 top-2 flex flex-wrap gap-1.5">
          {showVideo ? (
            <Chip tone="plain" className="bg-black/45 backdrop-blur-[6px]">
              {media.label}
            </Chip>
          ) : panel ? (
            <Chip tone="plain" className="bg-black/45 backdrop-blur-[6px]">
              {t.boardOnScreen} · {current}
            </Chip>
          ) : (
            <Chip tone={episode.busy ? "gen" : "plain"} pulse={episode.busy} className="bg-black/45 backdrop-blur-[6px]">
              {t.noClipTitle} · {stageLabel(episode, t)}
            </Chip>
          )}
          {cells.length > 0 ? (
            <Chip tone="warn" className="bg-black/45">
              {t.driftHud(current, cells.map((c) => cellName(series, c)).join("、"))}
            </Chip>
          ) : null}
        </div>

        {part.take && (part.board || media) ? (
          <div className="absolute right-2.5 top-2 flex overflow-hidden rounded-[7px] border border-white/15 bg-black/45 text-[10.5px] backdrop-blur-[6px]">
            {(["board", "clip"] as Lane[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => props.onLane(l)}
                className={`px-2 py-0.5 ${lane === l ? "bg-cc-primary/25 text-cc-primary" : "text-cc-muted hover:text-cc-fg"}`}
              >
                {l === "board" ? t.laneBoard : t.laneClip}
              </button>
            ))}
          </div>
        ) : null}

        <div className="pointer-events-none absolute bottom-2 right-2.5 rounded-[5px] bg-black/50 px-[7px] py-0.5 text-[11px] tabular-nums text-cc-fg">
          {fmtSec(time)}s / {fmtSec(duration)}s
        </div>

      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          aria-label={props.playing ? t.pause : t.play}
          onClick={props.onTogglePlay}
          className="grid h-[26px] w-[26px] place-items-center rounded-full bg-cc-primary text-[#1c0a00] hover:bg-cc-primary-hover"
        >
          <PlayIcon playing={props.playing} />
        </button>
        <span className="text-[11px] tabular-nums text-cc-muted">
          {span ? t.shotSpan(current, fmtSec(span[0]), fmtSec(span[1])) : null}
        </span>
        {episode.parts.length > 1 ? (
          <div className="flex overflow-hidden rounded-[7px] border border-cc-border text-[10.5px]">
            {episode.parts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => props.onPart(p.id)}
                className={`px-2 py-0.5 ${p.id === part.id ? "bg-cc-primary/20 text-cc-primary" : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"}`}
              >
                {t.partLabel(p.id)}
              </button>
            ))}
          </div>
        ) : null}
        {props.layout !== "narrow" ? <Tiny className="ml-auto">{t.keysHint}</Tiny> : null}
      </div>
    </div>
  );
}

function TakeThumb({ props, asset }: { props: DeskProps; asset: { view: { status: string } } }) {
  const board = props.part.board ? mediaUrl(props.base, props.part.board.view) : null;
  if (isBusy(asset.view as never)) return <div className="aspect-video rounded-[4px]" style={HATCH} />;
  return (
    <div className="aspect-video overflow-hidden rounded-[4px] bg-[#111]">
      {board ? <img src={board} alt="" draggable={false} className="h-full w-full object-cover opacity-80" /> : null}
    </div>
  );
}

/**
 * craft's `uncertain` list: calls that failed after they were sent, whose
 * charge is not knowable and so stay in the total above. Named, so the
 * user can find them in Takes.
 */
export function UncertainBilling({ series, labels, episode, t }: { series: Series; labels: string[]; episode?: string; t: SeriesStrings }) {
  if (labels.length === 0) return null;
  return (
    <div className="mt-1.5 rounded-[6px] border border-cc-warning/40 bg-cc-warning/10 px-2 py-1.5 text-[10.5px] leading-[1.45]">
      <div className="font-medium text-cc-warning">{t.uncertainTitle(labels.length)}</div>
      <ul className="m-0 mt-0.5 list-none p-0 text-cc-fg">
        {labels.map((label) => (
          <li key={label} title={label} className="truncate">
            {callLabel(series, label, t, episode)}
          </li>
        ))}
      </ul>
      <p className="m-0 mt-0.5 text-cc-muted">{t.uncertainNote}</p>
    </div>
  );
}

function Side(props: DeskProps) {
  const { part, episode, t } = props;
  const rows = [
    ...part.takes.map((x) => ({ kind: "take" as const, rec: x })),
    ...part.patches.map((x) => ({ kind: "patch" as const, rec: x })),
  ].sort((a, b) => (a.rec.view.submittedAt ?? 0) - (b.rec.view.submittedAt ?? 0));
  const effective = part.take?.record.asset ?? null;
  const c = episode.cost;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Card>
        <h3 className="m-0 mb-1.5 text-[11px] font-medium text-cc-fg">{t.takesTitle}</h3>
        {rows.length === 0 ? (
          <p className="m-0 text-[11px] text-cc-muted">{t.noClipTitle}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map(({ kind, rec }) => {
              const id = rec.record.asset;
              const view = rec.view;
              const inUse = id === effective;
              const shown = props.viewingTake === id || (!props.viewingTake && inUse);
              const meta =
                kind === "take"
                  ? t.takeMeta(
                      (rec.record as { resolution?: string }).resolution ?? "",
                      view.spent !== null ? fmtUsd(view.spent) : null,
                      part.takeDrift[id] ?? 0,
                    )
                  : isBusy(view)
                    ? `${t.submitted(secondsSince(view.submittedAt, props.now))}${view.cost?.usd != null ? ` · ${fmtUsd(view.cost.usd, true)}` : ""}`
                    : view.spent !== null
                      ? fmtUsd(view.spent)
                      : "";
              const label =
                kind === "patch"
                  ? t.patchLabel((rec.record as { shots: [number, number] }).shots[0], (rec.record as { shots: [number, number] }).shots[1])
                  : t.takeLabel(part.takes.findIndex((x) => x.record.asset === id) + 1);
              const spliced = kind === "patch" && part.applied.includes(id);
              return (
                <div
                  key={id}
                  onClick={() => (view.status === "ready" ? props.onShowTake(inUse ? null : id) : undefined)}
                  className={`grid cursor-pointer grid-cols-[44px_1fr] items-center gap-[7px] rounded-[7px] border p-1 text-[11px] ${
                    shown ? "border-cc-primary/55 bg-cc-primary-muted" : "border-transparent hover:bg-cc-hover"
                  }`}
                >
                  <TakeThumb props={props} asset={rec} />
                  {/* Name on its own line; the status chip follows the meta and
                      drops to its own line in a narrow column instead of
                      squeezing the name. */}
                  <div className="min-w-0" title={id}>
                    <div className="truncate text-cc-fg">{label}</div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {meta ? <small className="whitespace-nowrap text-[10px] text-cc-muted">{meta}</small> : null}
                      <span className="ml-auto">
                        {isBusy(view) ? (
                          <Chip tone="gen" pulse>
                            {t.generating}
                          </Chip>
                        ) : view.status === "failed" ? (
                          <Chip tone="err">{t.failed}</Chip>
                        ) : inUse ? (
                          <Chip tone="ok">{t.inUse}</Chip>
                        ) : spliced ? (
                          <Chip tone="ok">{t.spliced}</Chip>
                        ) : kind === "take" && props.canWrite ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onUseTake(id);
                            }}
                            className="text-[10px] text-cc-muted hover:text-cc-primary"
                          >
                            {t.useTake}
                          </button>
                        ) : (
                          <Tiny>{t.old}</Tiny>
                        )}
                      </span>
                    </div>
                    {view.status === "failed" ? <FailureNote failure={view.failure} t={t} className="mt-0.5" /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <Card>
        <h3 className="m-0 mb-1.5 text-[11px] font-medium text-cc-fg">
          {t.costTitle} <Tiny>{t.estimate}</Tiny>
        </h3>
        {c.total === 0 && c.inFlight === 0 ? (
          <p className="m-0 text-[11px] text-cc-muted">{t.nothingSpent}</p>
        ) : (
          <>
            {(
              [
                [c.boards, t.costBoards(c.boards.count)],
                [c.panels, t.costPanels(c.panels.count)],
                [c.takes, t.costTakes(c.takes.count)],
                [c.patches, t.costPatches(c.patches.count)],
              ] as const
            )
              .filter(([bucket]) => bucket.count > 0)
              .map(([bucket, label]) => (
                <div key={label} className="flex justify-between py-0.5 text-[11px]">
                  <span className="text-cc-muted">{label}</span>
                  <span className="tabular-nums text-cc-fg">
                    {fmtUsd(bucket.usd, bucket.inFlight > 0)}
                  </span>
                </div>
              ))}
            <div className="mt-1 flex justify-between border-t border-cc-border pt-[5px] text-[11px] font-medium text-cc-fg">
              <span>{t.costTotal}</span>
              <span className="tabular-nums">{fmtUsd(c.total, c.inFlight > 0)}</span>
            </div>
            <UncertainBilling series={props.series} labels={c.uncertain} episode={episode.id} t={t} />
          </>
        )}
        <p className="m-0 mt-1.5 text-[10px] text-cc-muted">{t.costNote}</p>
      </Card>
    </div>
  );
}

export function EpisodeDesk(props: DeskProps) {
  const { layout } = props;
  const narrow = layout === "narrow";
  return (
    <section aria-label={props.episode.id} className="flex min-w-0 flex-col gap-2.5 px-3.5 pb-3.5 pt-2.5">
      <Header {...props} />
      <Flag {...props} />
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: layout === "wide" ? "minmax(0,1fr) 232px" : layout === "mid" ? "minmax(0,1fr) 200px" : "minmax(0,1fr)" }}
      >
        <Screen {...props} />
        <Side {...props} />
      </div>
      <ShotStrip
        series={props.series}
        episode={props.episode}
        part={props.part}
        base={props.base}
        t={props.t}
        narrow={narrow}
        ratio={props.ratio}
        selected={props.shot}
        time={props.time}
        range={props.range}
        canWrite={props.canWrite}
        now={props.now}
        onSelectShot={props.onSelectShot}
        onDragBorder={props.onDragBorder}
        onClearRange={props.onClearRange}
      />
      <ShotDetail
        series={props.series}
        episode={props.episode}
        part={props.part}
        shot={props.shot}
        check={props.check}
        base={props.base}
        t={props.t}
        single={layout !== "wide"}
        narrow={layout === "narrow"}
        canWrite={props.canWrite}
        canCommand={props.canCommand}
        imagesOk={props.imagesOk}
        videoOk={props.videoOk}
        viewing={props.viewingTake}
        handlers={props.detail}
      />
    </section>
  );
}
