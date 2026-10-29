/**
 * The season at a glance (the rail's expanded state) and binge mode (the
 * consumption persona: the wall and the details out of the way, finished
 * episodes back to back, theatre-size).
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { EpisodeView, Series } from "../domain.js";
import { UncertainBilling } from "./EpisodeDesk.js";
import { mediaUrl } from "./media.js";
import { Avatar } from "./ShotDetail.js";
import type { SeriesStrings } from "./strings.js";
import { stageLabel, stageTone } from "./SeasonRail.js";
import { Btn, Card, Chip, PlayIcon, Tiny } from "./ui.js";
import { fmtUsd } from "./view-model.js";

/**
 * The season spend card's lines. They add up to `series.cost.total`:
 * sheets and episodes always show, the rest only when they cost something.
 */
export function spendLines(series: Series, t: SeriesStrings): Array<{ key: string; label: string; usd: number }> {
  const c = series.cost;
  return [
    { key: "sheets", label: t.sheetsSpend, usd: c.sheets },
    ...(c.lineups > 0 || series.lineup ? [{ key: "lineups", label: t.lineupsSpend, usd: c.lineups }] : []),
    ...series.episodes.map((ep) => ({ key: ep.id, label: `${ep.id} 《${ep.title}》`, usd: ep.cost.total })),
    ...(c.compilations > 0 ? [{ key: "compilations", label: t.compilationsSpend, usd: c.compilations }] : []),
    ...(c.other !== 0 ? [{ key: "other", label: t.otherSpend, usd: c.other }] : []),
  ];
}

export function SeasonOverview({
  series,
  base,
  t,
  onEpisode,
}: {
  series: Series;
  base: string;
  t: SeriesStrings;
  onEpisode: (id: string) => void;
}) {
  const rows = series.ideas.episodes;
  const characters = series.cards.filter((c) => c.kind === "character");
  return (
    <section className="flex min-w-0 flex-col gap-2.5 px-3.5 pb-3.5 pt-2.5">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="m-0 text-[15px] font-semibold text-cc-fg">{t.overviewTitle}</h2>
        <Tiny>{t.episodeCount(series.episodes.length)}</Tiny>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
        <Card>
          <h3 className="m-0 mb-1.5 text-[11px] font-medium text-cc-fg">
            {t.seasonSpend} <Tiny>{t.estimate}</Tiny>
          </h3>
          <div className="text-[20px] font-semibold tabular-nums text-cc-fg">{fmtUsd(series.cost.total)}</div>
          <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
            {spendLines(series, t).map((line) => (
              <div key={line.key} className="flex justify-between gap-2">
                <span className="truncate text-cc-muted">{line.label}</span>
                <span className="tabular-nums">{fmtUsd(line.usd)}</span>
              </div>
            ))}
            {series.cost.unpriced > 0 ? <span className="text-cc-warning">{t.unpriced(series.cost.unpriced)}</span> : null}
          </div>
          <UncertainBilling series={series} labels={series.summary?.uncertain ?? []} t={t} />
        </Card>
        <Card>
          <h3 className="m-0 mb-1.5 text-[11px] font-medium text-cc-fg">{t.castStats}</h3>
          <div className="flex flex-col gap-1.5">
            {characters.map((c) => {
              const open = c.drift.filter((d) => !d.accepted).length;
              const accepted = c.drift.length - open;
              return (
                <div key={c.key} className="flex items-center gap-2 text-[11.5px]">
                  <Avatar card={c} base={base} size={22} />
                  <b className="font-medium text-cc-fg">{c.name}</b>
                  <span className="ml-auto flex gap-1">
                    <Chip tone="dim">{t.appearances(c.appearances.length)}</Chip>
                    {open > 0 ? <Chip tone="warn">{t.driftCount(open)}</Chip> : <Chip tone="ok">{t.noDrift}</Chip>}
                    {accepted > 0 ? <Chip tone="dim">{t.verdictAccepted} {accepted}</Chip> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="m-0 text-[11.5px] text-cc-muted">{t.noLog}</p>
        ) : (
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="text-left text-cc-fg">
                {[t.colEpisode, t.colPlace, t.colGoal, t.colAbility, t.colEnding].map((h) => (
                  <th key={h} className="border-b border-cc-border px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.episode} className="cursor-pointer text-cc-muted hover:bg-cc-hover" onClick={() => onEpisode(r.episode)}>
                  <td className="whitespace-nowrap border-b border-cc-border px-2 py-1.5 text-cc-fg">
                    {r.episode} 《{r.title}》
                  </td>
                  <td className="border-b border-cc-border px-2 py-1.5">{r.location}</td>
                  <td className="border-b border-cc-border px-2 py-1.5">{r.goal}</td>
                  <td className="border-b border-cc-border px-2 py-1.5">{r.abilities.join("、")}</td>
                  <td className="border-b border-cc-border px-2 py-1.5">{r.ending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        {series.episodes.map((ep) => (
          <button key={ep.id} type="button" onClick={() => onEpisode(ep.id)} className="rounded-[9px] border border-cc-border bg-cc-card px-2.5 py-1.5 text-left hover:bg-cc-hover">
            <span className="mr-2 text-[12px] text-cc-fg">
              {ep.id} 《{ep.title}》
            </span>
            <Chip tone={stageTone(ep)} pulse={ep.busy}>
              {stageLabel(ep, t)}
            </Chip>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Binge ──────────────────────────────────────────────────────────────────

interface Reel {
  episode: EpisodeView;
  url: string;
  label: string;
}

/** What binge can play: an episode's final, or its parts' takes in order. */
export function bingeReels(series: Series, base: string): Reel[] {
  const reels: Reel[] = [];
  for (const episode of series.episodes) {
    const final = episode.final ? mediaUrl(base, episode.final.view) : null;
    if (final) {
      reels.push({ episode, url: final, label: `${episode.id} 《${episode.title}》` });
      continue;
    }
    if (episode.parts.length > 0 && episode.parts.every((p) => p.take?.view.status === "ready")) {
      for (const part of episode.parts) {
        const url = mediaUrl(base, part.take!.view);
        if (url) {
          reels.push({
            episode,
            url,
            label: `${episode.id} 《${episode.title}》${episode.parts.length > 1 ? ` · ${part.id}` : ""}`,
          });
        }
      }
    }
  }
  return reels;
}

const TITLE_CARD_MS = 1500;

export function BingeView({
  series,
  base,
  t,
  canCommand,
  onCompile,
}: {
  series: Series;
  base: string;
  t: SeriesStrings;
  canCommand: boolean;
  onCompile: () => void;
}) {
  const reels = useMemo(() => bingeReels(series, base), [series, base]);
  const [index, setIndex] = useState(0);
  const [card, setCard] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reel = reels[index] ?? null;
  const firstOfEpisode = !!reel && (index === 0 || reels[index - 1]?.episode.id !== reel.episode.id);

  useEffect(() => {
    if (!reel) return;
    if (!firstOfEpisode) {
      setCard(false);
      return;
    }
    setCard(true);
    const timer = setTimeout(() => setCard(false), TITLE_CARD_MS);
    return () => clearTimeout(timer);
  }, [index, reel, firstOfEpisode]);

  useEffect(() => {
    if (!card && videoRef.current) void videoRef.current.play().catch(() => undefined);
  }, [card, index]);

  if (!reel) {
    return (
      <section className="grid min-h-[50vh] place-items-center p-8 text-center">
        <p className="m-0 text-[13px] text-cc-muted">{t.bingeEmpty}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col items-center gap-3 p-4">
      <div className="relative aspect-video w-full max-w-[1280px] overflow-hidden rounded-[12px] border border-cc-border bg-black">
        <video
          ref={videoRef}
          key={reel.url}
          src={reel.url}
          // Readable by a capture — see the desk's screen (EpisodeDesk).
          crossOrigin="anonymous"
          playsInline
          controls={!card}
          onEnded={() => setIndex((i) => Math.min(reels.length - 1, i + 1))}
          className="h-full w-full object-contain"
        />
        {card ? (
          <div className="absolute inset-0 grid place-items-center bg-black">
            <div className="text-center">
              <div className="text-[12px] tracking-[.2em] text-cc-muted">{reel.episode.id.toUpperCase()}</div>
              <div className="mt-2 text-[28px] font-semibold text-cc-fg">《{reel.episode.title}》</div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Btn disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          {t.previous}
        </Btn>
        <Tiny className="tabular-nums">{t.bingeOf(index + 1, reels.length)}</Tiny>
        <Btn disabled={index >= reels.length - 1} onClick={() => setIndex((i) => Math.min(reels.length - 1, i + 1))}>
          {t.next}
        </Btn>
        <Btn disabled={!canCommand} onClick={onCompile}>
          {t.compileSeason}
        </Btn>
      </div>
      <div className="flex max-w-full gap-2 overflow-x-auto">
        {reels.map((r, i) => (
          <button
            key={`${r.url}-${i}`}
            type="button"
            onClick={() => setIndex(i)}
            className={`flex shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-[11.5px] ${
              i === index ? "border-cc-primary/60 bg-cc-primary-muted text-cc-primary" : "border-cc-border text-cc-muted hover:bg-cc-hover"
            }`}
          >
            <PlayIcon size={9} />
            {r.label}
          </button>
        ))}
      </div>
    </section>
  );
}
