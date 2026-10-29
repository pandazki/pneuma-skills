/**
 * Below the strip: the selected shot (its words, its sound, the stamps of
 * what it was made from, the commands that redo it) and its check (each
 * cast member's verdict, the drift compare — sheet beside sampled frames —
 * and the human's decision).
 */

import { useEffect, useState } from "react";

import type { EntityCard, EpisodeView, PartView, Series } from "../domain.js";
import { cellName, cellVerdict, findCard, framesFor, isLostBeat, shotClip, shotSpan } from "../domain.js";
import { figureCrop } from "./avatar-crop.js";
import { mediaUrl } from "./media.js";
import type { SeriesStrings } from "./strings.js";
import { Btn, Card, Chip, EditableText, paletteEntries, Tiny } from "./ui.js";
import { fmtSec, fmtUsd } from "./view-model.js";

/** Readable text on a palette colour: dark on light, light on dark. */
function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fbfaf7";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? "#1c1917" : "#fbfaf7";
}

/**
 * A round face for a card. A character's or group's is the figure found in
 * its sheet (`figureCrop`: the front view, wherever this sheet put it);
 * until that is read, or when no figure stands out, a character shows its
 * initial on its own palette colour and a group its sheet's centre. A
 * scene is its sheet's centre.
 */
export function Avatar({ card, base, size = 18 }: { card: EntityCard | null; base: string; size?: number }) {
  const src = card?.sheet ? mediaUrl(base, card.sheet) : null;
  const figure = card?.kind === "character" || card?.kind === "group";
  const [crop, setCrop] = useState<{ src: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!src || !figure) return;
    let live = true;
    void figureCrop(src).then((url) => {
      if (live) setCrop({ src, url });
    });
    return () => {
      live = false;
    };
  }, [src, figure]);
  const found = crop && crop.src === src ? crop.url : null;
  const settled = !!crop && crop.src === src;
  const swatch = paletteEntries((card?.entity as { palette?: unknown } | undefined)?.palette)[0]?.color ?? null;

  let face: React.ReactNode;
  if (found) face = <img src={found} alt="" draggable={false} className="h-full w-full object-cover" />;
  else if (src && (card?.kind === "scene" || (card?.kind === "group" && settled))) {
    face = <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />;
  } else {
    face = (
      <span
        className="grid h-full w-full place-items-center font-semibold leading-none"
        style={{ background: swatch ?? undefined, color: swatch ? inkOn(swatch) : "#3f3a33", fontSize: Math.max(8, Math.round(size * 0.55)) }}
      >
        {card?.name.slice(0, 1) ?? "?"}
      </span>
    );
  }
  return (
    <span
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-white/20 bg-[#fbfaf7]"
      style={{ width: size, height: size }}
    >
      {face}
    </span>
  );
}

/** Which bible card an input asset is the sheet of. */
function sheetOwner(series: Series, assetId: string): EntityCard | null {
  return series.cards.find((c) => c.candidates.some((x) => x.id === assetId) || c.sheet?.id === assetId) ?? null;
}

/**
 * What the selected shot was made from. The stamps read the clip that
 * supplies THIS shot (`shotClip`: a spliced or opened re-shoot, else the
 * take) — the same clip the check cells beside them are judged on — and,
 * before any clip, the storyboard.
 */
function Stamps({
  series,
  part,
  episode,
  shot,
  viewing,
  base,
  t,
}: {
  series: Series;
  part: PartView;
  episode: EpisodeView;
  shot: number;
  viewing: string | null;
  base: string;
  t: SeriesStrings;
}) {
  const clip = shotClip(part, shot, viewing);
  const source = clip?.view ?? part.board?.view ?? null;
  const chips: React.ReactNode[] = [];
  if (source) {
    for (const input of source.inputs) {
      const owner = sheetOwner(series, input);
      if (owner) {
        const candidate = owner.candidates.find((c) => c.id === input);
        chips.push(
          <Chip key={input} tone="plain" title={input}>
            <Avatar card={owner} base={base} size={14} />
            {t.sheetStamp(owner.name, candidate?.basis?.version ?? null)}
          </Chip>,
        );
        continue;
      }
      const boardIndex = part.boards.findIndex((b) => b.record.asset === input);
      if (boardIndex >= 0) {
        chips.push(
          <Chip key={input} tone="plain" title={input}>
            <i className="inline-block h-3.5 w-3.5 rounded-[3px] bg-[#ece8df]" />
            {t.boardStamp(episode.id, boardIndex + 1)}
          </Chip>,
        );
        continue;
      }
      chips.push(
        <Chip key={input} tone="dim">
          {input}
        </Chip>,
      );
    }
    if (source.model) {
      const resolution = clip?.resolution;
      chips.push(
        <Chip key="model" tone="dim">
          {source.model.replace(/^.*\//, "")}
          {resolution ? ` · ${resolution}` : ""}
        </Chip>,
      );
    }
    if (source.spent !== null) {
      chips.push(
        <Chip key="cost" tone="dim">
          {fmtUsd(source.spent)}
          {clip ? ` / ${fmtSec(clip.seconds).replace(/\.0$/, "")}s` : ""}
        </Chip>,
      );
    }
  } else {
    // Nothing made yet: the sheets this shot WILL be drawn and shot from.
    const keys = [
      ...episode.cast.map((id) => series.cards.find((c) => c.kind === "character" && c.id === id)),
      ...episode.groups.map((id) => series.cards.find((c) => c.kind === "group" && c.id === id)),
      series.cards.find((c) => c.kind === "scene" && c.id === episode.scene),
    ].filter((c): c is EntityCard => !!c && !!c.sheet);
    for (const card of keys) {
      chips.push(
        <Chip key={card.key} tone="dim" title={card.sheet?.id}>
          <Avatar card={card} base={base} size={14} />
          {t.sheetStamp(card.name, card.sheet?.basis?.version ?? null)}
        </Chip>,
      );
    }
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <Tiny>{source ? t.madeFrom : t.willUse}</Tiny>
      {chips}
    </div>
  );
}

export interface DetailHandlers {
  onEditShot: (index: number, field: "desc" | "sfx", value: string) => void;
  onCommand: (id: "redo-panel" | "patch-range", shot: number) => void;
  /** Open the drift compare for a check cell key (`niuma`, `group:stickies`). */
  onCheck: (cell: string | null) => void;
  /** Accept a drift as it is, on the clip the verdict belongs to (`source`). */
  onAccept: (shot: number, cell: string, source: string) => void;
}

export function ShotDetail({
  series,
  episode,
  part,
  shot,
  check,
  base,
  t,
  single,
  narrow,
  canWrite,
  canCommand,
  imagesOk,
  videoOk,
  viewing,
  handlers,
}: {
  series: Series;
  episode: EpisodeView;
  part: PartView;
  shot: number | null;
  check: string | null;
  base: string;
  t: SeriesStrings;
  single: boolean;
  /** The desk is too narrow to put the sheet and the frames side by side. */
  narrow: boolean;
  canWrite: boolean;
  canCommand: boolean;
  imagesOk: boolean;
  videoOk: boolean;
  /** The take or re-shoot opened in Takes, when one is. */
  viewing: string | null;
  handlers: DetailHandlers;
}) {
  const data = shot !== null ? part.shots[shot - 1] : null;
  const span = shot !== null ? shotSpan(part, shot) : null;

  const shotCard = (
    <Card>
      {data && span && shot !== null ? (
        <>
          <h3 className="m-0 mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11.5px] font-medium text-cc-fg">
            <span className="whitespace-nowrap">{t.shotTitle(shot)}</span>
            <Tiny className="tabular-nums">
              {fmtSec(span[0])}–{fmtSec(span[1])}s · {fmtSec(Number(data.dur) || 0).replace(/\.0$/, "")}s
            </Tiny>
          </h3>
          <div className="text-[12.5px] leading-[1.6] text-cc-fg">
            <EditableText value={String(data.desc ?? "")} disabled={!canWrite} title={t.editHint} onCommit={(v) => handlers.onEditShot(shot - 1, "desc", v)} />
          </div>
          <div className="mt-1.5 text-[11px] text-cc-muted">
            <b className="mr-1 font-medium text-cc-fg">{t.sfx}</b>
            <EditableText value={String(data.sfx ?? "")} placeholder={t.noSfx} disabled={!canWrite} title={t.editHint} onCommit={(v) => handlers.onEditShot(shot - 1, "sfx", v)} />
          </div>
          <Stamps series={series} part={part} episode={episode} shot={shot} viewing={viewing} base={base} t={t} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {part.board ? (
              <Btn disabled={!canCommand || !imagesOk} title={imagesOk ? undefined : t.needImagesKey} onClick={() => handlers.onCommand("redo-panel", shot)}>
                {t.redoPanel}
              </Btn>
            ) : null}
            {part.take ? (
              <Btn disabled={!canCommand || !videoOk} title={videoOk ? undefined : t.needVideoKey} onClick={() => handlers.onCommand("patch-range", shot)}>
                {t.patchShot}
              </Btn>
            ) : null}
            {part.board || part.take ? <Tiny>{t.detailHint}</Tiny> : null}
          </div>
        </>
      ) : (
        <p className="m-0 text-[11.5px] text-cc-muted">{t.noShotSelected}</p>
      )}
    </Card>
  );

  // ── The check ────────────────────────────────────────────────────────────
  const cells = shot !== null ? part.checks.filter((c) => c.shot === shot) : [];
  const focusCell =
    cells.find((c) => c.character === check) ?? cells.find((c) => cellVerdict(c) === "drift" && !c.accepted) ?? null;
  const focusCard = focusCell ? findCard(series, focusCell.kind, focusCell.id) : null;
  // Frames come from the clip the shot is judged on — the take, or the
  // patch spliced over it.
  const frames = shot !== null ? framesFor(series, part, focusCell ?? { shot, source: cells[0]?.source ?? part.take?.record.asset ?? "" }) : null;
  const strip = frames?.strip ?? null;
  const stripView = frames?.view ?? null;

  const checkCard = (
    <Card marker="check">
      <h3 className="m-0 mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11.5px] font-medium text-cc-fg">
        <span className="whitespace-nowrap">{t.checkTitle}</span>
        {strip?.times?.length ? <Tiny className="tabular-nums">{t.checkFrames(strip.times.map((x) => fmtSec(x)).join(" / "))}</Tiny> : null}
      </h3>
      {!part.take ? (
        <p className="m-0 text-[11.5px] text-cc-muted">{t.checkNoTake}</p>
      ) : shot === null ? (
        <p className="m-0 text-[11.5px] text-cc-muted">{t.noShotSelected}</p>
      ) : (
        <>
          {!part.review ? <p className="m-0 mb-1.5 text-[11px] text-cc-muted">{t.checkNotYet}</p> : null}
          <div className="flex flex-col gap-[5px]">
            {cells.map((cell) => {
              const card = findCard(series, cell.kind, cell.id);
              const verdict = cellVerdict(cell);
              const lost = isLostBeat(cell);
              const tone = cell.accepted ? "dim" : verdict === "ok" ? "ok" : verdict === "drift" || lost ? "warn" : verdict === "absent" ? "plain" : "dim";
              const label = cell.accepted
                ? t.verdictAccepted
                : verdict === "ok"
                  ? t.verdictOk
                  : verdict === "drift"
                    ? t.verdictDrift
                    : lost
                      ? t.verdictLost
                      : verdict === "absent"
                        ? t.verdictAbsent
                        : t.verdictUnverified;
              return (
                <button
                  key={cell.character}
                  type="button"
                  onClick={() => handlers.onCheck(cell.character)}
                  className={`grid grid-cols-[18px_auto_1fr] items-center gap-[7px] rounded-[6px] px-0.5 text-left text-[11.5px] hover:bg-cc-hover ${focusCell?.character === cell.character ? "bg-cc-hover" : ""}`}
                >
                  <Avatar card={card} base={base} />
                  <Chip tone={tone}>{label}</Chip>
                  <span className="truncate text-[11px] text-cc-muted" title={cell.note}>
                    {cell.note || cellName(series, cell)}
                  </span>
                </button>
              );
            })}
          </div>
          {focusCell && focusCard ? (
            <div className={`mt-2.5 grid items-stretch gap-2 ${narrow ? "grid-cols-1" : "grid-cols-[1fr_2.4fr]"}`}>
              <div className="overflow-hidden rounded-[8px] border border-cc-border bg-[#0d0d10]">
                <header className="flex justify-between border-b border-cc-border px-[7px] py-1 text-[10px] text-cc-muted">
                  <span>{t.compareSheet(focusCard.name)}</span>
                  {focusCard.lock.version ? <span>v{focusCard.lock.version}</span> : null}
                </header>
                <div className="aspect-square bg-[#fbfaf7]">
                  {focusCard.sheet ? (
                    <img src={mediaUrl(base, focusCard.sheet) ?? undefined} alt="" draggable={false} className="h-full w-full object-contain" />
                  ) : null}
                </div>
              </div>
              <div className="overflow-hidden rounded-[8px] border border-cc-border bg-[#0d0d10]">
                <header className="flex justify-between border-b border-cc-border px-[7px] py-1 text-[10px] text-cc-muted">
                  <span>{t.compareFrames(focusCell.source, shot)}</span>
                </header>
                {stripView ? (
                  <img src={mediaUrl(base, stripView) ?? undefined} alt="" draggable={false} className="block w-full object-contain" />
                ) : (
                  <p className="m-0 p-2 text-[11px] text-cc-muted">{t.checkNotYet}</p>
                )}
              </div>
            </div>
          ) : null}
          {focusCell && cellVerdict(focusCell) === "drift" && !focusCell.accepted ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="text-cc-muted">{t.decide}</span>
              <div className="ml-auto flex gap-1.5">
                <Btn primary disabled={!canCommand || !videoOk} title={videoOk ? undefined : t.needVideoKey} onClick={() => handlers.onCommand("patch-range", shot)}>
                  {t.patchShot}
                </Btn>
                <Btn disabled={!canWrite} onClick={() => handlers.onAccept(shot, focusCell.character, focusCell.source)}>
                  {t.acceptDrift}
                </Btn>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );

  return (
    <div className={`grid gap-2.5 ${single ? "grid-cols-1" : "grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"}`}>
      {shotCard}
      {checkCard}
    </div>
  );
}
