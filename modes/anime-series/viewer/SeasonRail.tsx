/**
 * The season rail: the series, one card per episode, the season's spend and
 * the way into binge mode. Clicking a card puts that episode on the desk.
 */

import type { EpisodeView, Series } from "../domain.js";
import { mediaUrl } from "./media.js";
import type { SeriesStrings } from "./strings.js";
import { Btn, Chip, PlayIcon, Tiny, type Tone } from "./ui.js";
import { fmtDay, fmtUsd, type Level } from "./view-model.js";

/** Reviewed with cells nobody checked: shot, but not finished. */
function unchecked(episode: EpisodeView): boolean {
  return episode.stage === "reviewed" && episode.unverified > 0;
}

export function stageTone(episode: EpisodeView): Tone {
  if (episode.busy) return "gen";
  if (unchecked(episode)) return "warn";
  switch (episode.stage) {
    case "draft":
      return "dim";
    case "planned":
    case "boarded":
      return "plain";
    case "shot":
      return "warn";
    default:
      return "ok";
  }
}

/** The episode's stage word, as the rail, the overview and the screen say it. */
export function stageLabel(episode: EpisodeView, t: SeriesStrings): string {
  if (!episode.busy && unchecked(episode)) return t.stageUnchecked(episode.unverified);
  return t.stage(episode.stage, episode.busy);
}

/** A tiny poster: the take's board, else a dashed 3×3 of the shot count. */
function Poster({ series, episode, base }: { series: Series; episode: EpisodeView; base: string }) {
  const part = episode.parts[0];
  const board = part?.board ? mediaUrl(base, part.board.view) : null;
  if (board) {
    return (
      <div className="aspect-video w-14 overflow-hidden rounded-[5px] bg-[#ece8df]">
        <img src={board} alt="" className="h-full w-full object-cover" draggable={false} />
      </div>
    );
  }
  const scene = series.cards.find((c) => c.kind === "scene" && c.id === episode.scene);
  const backdrop = scene?.sheet ? mediaUrl(base, scene.sheet) : null;
  const n = Math.max(1, Math.min(9, part?.shots.length ?? 9));
  return (
    <div className="relative aspect-video w-14 overflow-hidden rounded-[5px] bg-[#111]">
      {backdrop ? <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" draggable={false} /> : null}
      <div className="absolute inset-[3px] grid grid-cols-3 gap-[2px]">
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className={`rounded-[1px] border border-dashed ${i < n ? "border-white/35" : "border-white/10"}`}
          />
        ))}
      </div>
    </div>
  );
}

export function SeasonRail({
  series,
  t,
  base,
  current,
  level,
  narrow,
  onEpisode,
  onNewEpisode,
  onBinge,
  canCommand,
}: {
  series: Series;
  t: SeriesStrings;
  base: string;
  current: string | null;
  level: Level;
  narrow: boolean;
  onEpisode: (id: string) => void;
  onNewEpisode: (() => void) | null;
  onBinge: () => void;
  canCommand: boolean;
}) {
  const edited = [series.style, ...series.cards].some((c) => c.lock.state === "edited");
  const bibleChip =
    series.version === 0 ? (
      <Chip tone="dim">{t.bibleUnlocked}</Chip>
    ) : edited ? (
      <Chip tone="warn">{t.bibleEdited(series.version)}</Chip>
    ) : (
      <Chip tone="ok">{t.bibleLocked(series.version, fmtDay(series.lockedAt))}</Chip>
    );

  return (
    <header
      data-series-rail
      className={`sticky top-0 z-20 flex items-center gap-3 border-b border-cc-border bg-cc-surface/55 px-3.5 py-2 backdrop-blur-[14px] ${narrow ? "flex-wrap" : ""}`}
    >
      <div className="shrink-0">
        <h1 className="m-0 text-[13px] font-semibold text-cc-fg">{series.title || t.untitled}</h1>
        <p className="m-0 mt-0.5 flex items-center gap-1.5">
          {bibleChip}
          <Tiny>{t.episodeCount(series.episodes.length)}</Tiny>
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Episodes"
        className={`flex min-w-0 flex-1 gap-2 overflow-x-auto p-0.5 [scrollbar-width:none] ${narrow ? "order-3 basis-full" : ""}`}
      >
        {series.episodes.map((episode) => {
          const active = episode.id === current && level !== "overview";
          const drift = episode.checks.drift;
          return (
            <button
              key={episode.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onEpisode(episode.id)}
              className={`grid min-w-[196px] shrink-0 grid-cols-[56px_1fr] items-center gap-2 rounded-[9px] border bg-cc-card py-[5px] pl-[5px] pr-2 text-left transition-colors hover:bg-cc-hover ${
                active ? "border-cc-primary/60 shadow-[0_0_0_3px_var(--color-cc-glow)]" : "border-cc-border"
              }`}
            >
              <Poster series={series} episode={episode} base={base} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5 whitespace-nowrap text-[12px] font-medium text-cc-fg">
                  <span className="truncate">
                    {episode.id} 《{episode.title}》
                  </span>
                  <span className="text-[10.5px] font-normal text-cc-muted">{episode.duration}s</span>
                </div>
                <div className="mt-[3px] flex flex-wrap gap-[5px]">
                  <Chip tone={stageTone(episode)} pulse={episode.busy}>
                    {stageLabel(episode, t)}
                  </Chip>
                  {drift > 0 ? <Chip tone="warn">{t.driftCount(drift)}</Chip> : null}
                  {episode.flag?.stale ? (
                    <Chip tone="warn">
                      v{episode.flag.shotUnder}→v{episode.flag.latest}
                    </Chip>
                  ) : null}
                  {episode.cost.total > 0 || episode.cost.inFlight > 0 ? (
                    <Chip tone="dim">{fmtUsd(episode.cost.total)}</Chip>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
        {onNewEpisode ? (
          <button
            type="button"
            onClick={canCommand ? onNewEpisode : undefined}
            aria-disabled={!canCommand || undefined}
            className={`flex min-w-[96px] shrink-0 items-center justify-center rounded-[9px] border border-dashed border-cc-border px-3 text-[12px] text-cc-muted ${
              canCommand ? "hover:bg-cc-hover hover:text-cc-fg" : "cursor-not-allowed opacity-50"
            }`}
          >
            {t.newEpisode}
          </button>
        ) : null}
      </div>

      <div className={`flex shrink-0 items-center gap-2.5 ${narrow ? "ml-auto" : ""}`}>
        <div className="text-right">
          <b className="block text-[12px] font-medium tabular-nums text-cc-fg">{fmtUsd(series.cost.total)}</b>
          <Tiny>{series.cost.inFlight > 0 ? t.inFlightIncluded(fmtUsd(series.cost.inFlight, true)) : t.estimate}</Tiny>
        </div>
        <Btn onClick={onBinge} primary={level === "binge"}>
          <PlayIcon size={10} />
          {level === "binge" ? t.backToDesk : t.binge}
        </Btn>
      </div>
    </header>
  );
}
