/**
 * The shot strip — the storyboard, the shot list and the timeline as one
 * object.
 *
 * Each cell is as wide as its seconds; its picture is that panel cropped out
 * of the storyboard grid in effect (equal division, `grid.mjs::cellRect`),
 * or the shot's words while there is no storyboard yet. The playhead runs
 * across the cells on the episode clock. Dragging the border between two
 * cells moves seconds from one to the other — `rebalance` keeps the part's
 * total and the 2 s floor — and the change is written to episode.json on
 * release. Shift-click marks a span for a re-shoot.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import type { EpisodeView, PartView, Series } from "../domain.js";
import { cellName, cellVerdict, isBusy, isLostBeat } from "../domain.js";
import { cellRect } from "../skill/scripts/grid.mjs";
import { SHOT_MIN_S, gridOf, rebalance } from "../skill/scripts/series-state.mjs";
import { mediaUrl } from "./media.js";
import type { SeriesStrings } from "./strings.js";
import { Dot, HATCH, Tiny } from "./ui.js";
import { fmtSec, fmtUsd, secondsSince } from "./view-model.js";

const GAP = 4;
const VERDICT_COLOR = {
  ok: "var(--color-cc-success)",
  drift: "var(--color-cc-warning)",
  unverified: "#6b7280",
  absent: "transparent",
} as const;

export interface StripProps {
  series: Series;
  episode: EpisodeView;
  part: PartView;
  base: string;
  t: SeriesStrings;
  narrow: boolean;
  ratio: number;
  selected: number | null;
  /** Episode clock. */
  time: number;
  range: [number, number] | null;
  canWrite: boolean;
  now: number;
  onSelectShot: (shot: number, extend: boolean) => void;
  onDragBorder: (index: number, dur: number) => string | null;
  onClearRange: () => void;
}

/** Background geometry that makes one panel of the grid cover a cell of `w`×`h`. */
function panelStyle(
  src: string,
  imageW: number,
  imageH: number,
  rows: number,
  cols: number,
  panel: number,
  w: number,
  h: number,
): CSSProperties {
  const rect = cellRect(imageW, imageH, rows, cols, panel);
  const scale = Math.max(w / rect.w, h / rect.h);
  const offsetX = (w - rect.w * scale) / 2 - rect.x * scale;
  const offsetY = (h - rect.h * scale) / 2 - rect.y * scale;
  return {
    backgroundImage: `url("${src}")`,
    backgroundSize: `${imageW * scale}px ${imageH * scale}px`,
    backgroundPosition: `${offsetX}px ${offsetY}px`,
    backgroundRepeat: "no-repeat",
  };
}

export function ShotStrip(props: StripProps) {
  const { series, episode, part, base, t, narrow, ratio, selected, time, range, canWrite, now } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<{ index: number; dur: number } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!refusal) return;
    const timer = setTimeout(() => setRefusal(null), 3200);
    return () => clearTimeout(timer);
  }, [refusal]);

  const shots = useMemo(() => {
    if (!preview) return part.shots;
    try {
      return rebalance(part.shots, preview.index, preview.dur, "next");
    } catch {
      return part.shots;
    }
  }, [part.shots, preview]);

  const total = part.seconds || shots.reduce((s, x) => s + (Number(x.dur) || 0), 0) || 1;
  const n = shots.length;
  const board = part.board;
  const boardSrc = board ? mediaUrl(base, board.view) : null;
  const boardGrid = gridOf(Math.max(1, board?.record.shots?.length || n));
  const boardBusy = part.boards.some((b) => isBusy(b.view));
  const take = part.take;

  const usable = Math.max(0, width - GAP * (n - 1));
  // A 3-second cell at the frame ratio sets the strip height — but a strip
  // of words (no storyboard yet) needs room to be read, so it gets a floor.
  const hasPictures = !!(board && boardSrc);
  const cellH = Math.max(
    narrow ? (width - GAP * 2) / 3 / ratio : (usable * (3 / total)) / ratio,
    hasPictures ? 44 : narrow ? 92 : 78,
  );

  const patching = part.patches.filter((p) => isBusy(p.view));
  const inPatch = (shot: number) => patching.find((p) => shot >= p.record.shots[0] && shot <= p.record.shots[1]) ?? null;

  const local = time - part.offset;
  const inPart = local >= -1e-6 && local <= total + 1e-6;
  const starts: number[] = [];
  {
    let acc = 0;
    for (const s of shots) {
      starts.push(acc);
      acc += Number(s.dur) || 0;
    }
  }
  const shotIndexAt = (seconds: number) => {
    for (let i = n - 1; i >= 0; i -= 1) if (seconds >= starts[i] - 1e-6) return i;
    return 0;
  };
  const xAt = (seconds: number) => `calc((100% - ${GAP * (n - 1)}px) * ${seconds / total} + ${shotIndexAt(seconds) * GAP}px)`;
  const xEnd = (shotIdx: number) => `calc((100% - ${GAP * (n - 1)}px) * ${(starts[shotIdx] + (Number(shots[shotIdx].dur) || 0)) / total} + ${shotIdx * GAP}px)`;
  const xStart = (shotIdx: number) => `calc((100% - ${GAP * (n - 1)}px) * ${starts[shotIdx] / total} + ${shotIdx * GAP}px)`;

  const rangeLocal = range ? ([range[0] - part.offset, range[1] - part.offset] as [number, number]) : null;
  const rangeShots =
    rangeLocal && rangeLocal[1] > 0 && rangeLocal[0] < total
      ? [shotIndexAt(Math.max(0, rangeLocal[0]) + 1e-3), shotIndexAt(Math.min(total, rangeLocal[1]) - 1e-3)]
      : null;

  const startDrag = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (!canWrite || narrow) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const d0 = Number(part.shots[index].dur) || 0;
    const room = d0 + (Number(part.shots[index + 1].dur) || 0) - SHOT_MIN_S;
    const perSecond = usable / total;
    let last = d0;
    const move = (ev: globalThis.PointerEvent) => {
      const raw = d0 + (ev.clientX - x0) / perSecond;
      const snapped = Math.min(room, Math.max(SHOT_MIN_S, Math.round(raw * 2) / 2));
      if (snapped !== last) {
        last = snapped;
        setPreview({ index, dur: snapped });
      }
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setPreview(null);
      if (last !== d0) {
        const problem = props.onDragBorder(index, last);
        if (problem) setRefusal(problem);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  // What a panel needs to say beyond its picture: who drifted, what changed
  // since, what is being redrawn. It sits UNDER the thumbnail so the
  // storyboard stays readable at strip size.
  const notes = shots.map((_, i) => {
    const number = i + 1;
    const drift = part.checks.filter((c) => c.shot === number && cellVerdict(c) === "drift" && !c.accepted);
    const staleClip = take ? part.staleClip.includes(number) : false;
    const staleBoard = !staleClip && part.staleBoard.includes(number);
    const redrawing = part.redrawing.includes(number);
    const patch = narrow ? inPatch(number) : null;
    return { drift, staleClip, staleBoard, redrawing, patch };
  });
  const annotated = notes.some((x) => x.drift.length > 0 || x.staleClip || x.staleBoard || x.redrawing || x.patch);

  const ticks: number[] = [];
  for (let s = 0; s <= total + 1e-6; s += total > 40 ? 10 : 5) ticks.push(s);
  if (ticks[ticks.length - 1] < total - 1e-6) ticks.push(total);

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="m-0 whitespace-nowrap text-[11.5px] font-medium text-cc-fg">{t.stripTitle}</h3>
        <Tiny className="whitespace-nowrap">{t.stripHint}</Tiny>
        <div className={`flex flex-wrap justify-end gap-x-2.5 gap-y-0.5 whitespace-nowrap text-[10px] text-cc-muted ${narrow ? "basis-full justify-start" : "ml-auto"}`}>
          <span className="inline-flex items-center gap-1">
            <Dot size={7} color={VERDICT_COLOR.ok} />
            {t.verdictOk}
          </span>
          <span className="inline-flex items-center gap-1">
            <Dot size={7} color={VERDICT_COLOR.drift} />
            {t.verdictDrift}
          </span>
          <span className="inline-flex items-center gap-1">
            <Dot size={7} color={VERDICT_COLOR.unverified} />
            {t.verdictUnverified}
          </span>
          {part.checks.some((c) => cellVerdict(c) === "absent" && !isLostBeat(c)) ? (
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-[7px] w-[7px] rounded-full border border-cc-muted" />
              {t.verdictAbsent}
            </span>
          ) : null}
          {part.checks.some(isLostBeat) ? (
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-[7px] w-[7px] rounded-full border border-cc-warning" />
              {t.verdictLost}
            </span>
          ) : null}
        </div>
      </div>

      <div ref={wrapRef} className="relative">
        <div className={narrow ? "grid grid-cols-3" : "flex"} style={{ gap: GAP }}>
          {shots.map((shot, i) => {
            const number = i + 1;
            const cellW = narrow ? (width - GAP * 2) / 3 : (usable * (Number(shot.dur) || 0)) / total;
            const h = narrow ? cellH : cellH;
            const cells = part.checks.filter((c) => c.shot === number);
            const { drift, staleClip, staleBoard, redrawing } = notes[i];
            const isSelected = selected === number;
            const marked = rangeShots ? i >= rangeShots[0] && i <= rangeShots[1] : false;
            const patch = inPatch(number);
            const picture =
              boardSrc && board?.view.width && board?.view.height && cellW > 0 && h > 0
                ? panelStyle(boardSrc, board.view.width, board.view.height, boardGrid.rows, boardGrid.cols, Math.min(number, boardGrid.rows * boardGrid.cols), cellW, h)
                : null;
            const outline = isSelected
              ? "outline outline-2 -outline-offset-1 outline-cc-primary shadow-[0_0_0_3px_var(--color-cc-glow)]"
              : drift.length > 0
                ? "outline outline-2 -outline-offset-1 outline-cc-warning/80"
                : "";
            return (
              <div key={i} className="flex min-w-0 flex-col" style={{ flex: narrow ? undefined : `${Number(shot.dur) || 1} 1 0` }}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={t.shotTitle(number)}
                onClick={(e) => props.onSelectShot(number, e.shiftKey)}
                className={`group relative min-w-0 overflow-hidden rounded-[7px] border text-left ${
                  picture ? "border-cc-border bg-[#ece8df]" : "border-dashed border-cc-border bg-cc-card"
                } ${outline}`}
                style={{ height: cellH || undefined, ...(picture ?? {}) }}
              >
                {!picture ? (
                  <span className="absolute inset-x-1.5 bottom-4 top-4 line-clamp-4 overflow-hidden text-[10px] leading-[1.4] text-cc-muted">
                    {shot.desc}
                  </span>
                ) : null}
                {redrawing && picture ? <span className="absolute inset-0 bg-[#ece8df]/50" /> : null}
                {(boardBusy && !picture) || redrawing || patch ? <span className="absolute inset-0" style={HATCH} /> : null}
                {marked ? <span className="absolute inset-0 bg-cc-primary/15 ring-1 ring-inset ring-cc-primary/50" /> : null}

                {/* On a picture these sit on a solid pill: the model draws its own
                    panel numbers in the same corner, and ours is the one that is
                    right. */}
                <span
                  className={`absolute left-[3px] top-[3px] text-[10px] font-semibold leading-[14px] ${
                    picture ? "rounded-[4px] bg-cc-bg/85 px-[4px] text-cc-fg" : "text-cc-fg"
                  }`}
                >
                  {number}
                </span>
                <span
                  className={`absolute right-[3px] top-[3px] text-[9.5px] tabular-nums leading-[14px] ${
                    picture ? "rounded-[4px] bg-cc-bg/70 px-[4px] text-cc-muted" : "text-cc-muted"
                  }`}
                >
                  {fmtSec(Number(shot.dur) || 0).replace(/\.0$/, "")}s
                </span>


                <span className="absolute inset-x-0 bottom-0 flex items-center gap-[3px] bg-gradient-to-b from-transparent to-black/55 px-1 py-0.5">
                  {take
                    ? cells.map((cell) => {
                        const verdict = cellVerdict(cell);
                        const lost = isLostBeat(cell);
                        return (
                          <i
                            key={cell.character}
                            title={`${cellName(series, cell)} · ${lost ? t.verdictLost : verdict}`}
                            className={`inline-block h-[7px] w-[7px] rounded-full border ${lost ? "border-cc-warning" : verdict === "absent" ? "border-white/70" : "border-black/40"}`}
                            style={{ background: cell.accepted ? "#a1a1aa" : VERDICT_COLOR[verdict] }}
                          />
                        );
                      })
                    : null}
                  <span className="ml-auto text-[9px] tabular-nums text-white [text-shadow:0_1px_2px_#000]">
                    {fmtSec(part.offset + starts[i])}
                  </span>
                </span>
              </button>
              {annotated ? (
                <div className="flex h-4 min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap px-0.5 text-[9.5px] leading-4">
                  {drift.length > 0 ? (
                    <span className="inline-flex min-w-0 items-center gap-1 text-cc-warning" title={t.driftBadge(drift.map((d) => cellName(series, d)).join("、"))}>
                      <Dot size={5} />
                      <span className="truncate">{drift.map((d) => cellName(series, d)).join("、")}</span>
                    </span>
                  ) : null}
                  {staleClip || staleBoard ? (
                    <span className="min-w-0 truncate text-[#93a4bd]" title={staleClip ? t.staleClip : t.staleBoard}>
                      {staleClip ? t.staleClipShort : t.staleBoardShort}
                    </span>
                  ) : null}
                  {redrawing || notes[i].patch ? (
                    <span className="inline-flex min-w-0 items-center gap-1 text-cc-primary">
                      <Dot size={5} pulse />
                      <span className="truncate">{redrawing ? t.redrawing : t.patching(notes[i].patch!.record.shots[0], notes[i].patch!.record.shots[1])}</span>
                    </span>
                  ) : null}
                </div>
              ) : null}
              </div>
            );
          })}
        </div>

        {!narrow && canWrite
          ? shots.slice(0, -1).map((_, i) => (
              <div
                key={`border-${i}`}
                role="separator"
                aria-orientation="vertical"
                title={t.stripHint}
                onPointerDown={startDrag(i)}
                className="group absolute top-0 z-[3] flex w-3 -translate-x-1/2 cursor-col-resize justify-center"
                style={{ left: `calc(${xEnd(i)} + ${GAP / 2}px)`, height: cellH }}
              >
                <span className={`h-full w-[2px] rounded-full ${preview?.index === i ? "bg-cc-primary" : "bg-transparent group-hover:bg-cc-primary/70"}`} />
              </div>
            ))
          : null}

        {!narrow && inPart && width > 0 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute -top-1.5 z-[4] w-[2px] bg-cc-primary shadow-[0_0_8px_var(--color-cc-primary)]"
            style={{ left: xAt(Math.min(Math.max(local, 0), total)), height: cellH + 12 }}
          >
            <span className="absolute -left-1 top-0 border-[5px] border-transparent border-t-cc-primary" />
          </div>
        ) : null}

      </div>

      {/* The time ruler sits right under the cells, inside the strip; a note
          about a span (a re-shoot in flight, a marked span) gets its own row
          under it rather than hanging over whatever follows the strip. */}
      {!narrow ? (
        <div className="relative mt-1 h-3.5 text-[9.5px] leading-[14px] tabular-nums text-cc-muted">
          {ticks.map((s, i) => (
            <span
              key={s}
              className="absolute top-0"
              style={{
                left: xAt(Math.min(s, total - 1e-3)),
                transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {fmtSec(part.offset + s).replace(/\.0$/, "")}
              {i === 0 || i === ticks.length - 1 ? "s" : ""}
            </span>
          ))}
        </div>
      ) : null}

      {!narrow && (patching.length > 0 || rangeShots) ? (
        <div className="relative mt-1 h-[19px]">
          {patching.length > 0
            ? patching.map((p) => {
                const [a, b] = p.record.shots;
                return (
                  <div
                    key={p.record.asset}
                    className="absolute top-0 whitespace-nowrap border-t-2 border-cc-primary pt-[3px] text-center text-[9.5px] text-cc-primary"
                    style={{ left: xStart(a - 1), width: `calc(${xEnd(b - 1)} - ${xStart(a - 1)})` }}
                  >
                    <Dot pulse /> {t.patchSpanNote(a, b, secondsSince(p.view.submittedAt, now), p.view.cost?.usd != null ? fmtUsd(p.view.cost.usd, true) : null)}
                  </div>
                );
              })
            : rangeShots ? (
              <div
                className="absolute top-0 flex items-center justify-center gap-1.5 whitespace-nowrap border-t-2 border-cc-primary/70 pt-[3px] text-[9.5px] text-cc-primary"
                style={{ left: xStart(rangeShots[0]), width: `calc(${xEnd(rangeShots[1])} - ${xStart(rangeShots[0])})` }}
              >
                {t.markedSpan(fmtSec(range![0]), fmtSec(range![1]))}
                <button type="button" onClick={props.onClearRange} className="text-cc-muted underline-offset-2 hover:text-cc-fg hover:underline">
                  {t.clearMark}
                </button>
              </div>
            ) : null}
        </div>
      ) : null}

      {narrow && rangeShots ? (
        <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-cc-primary">
          {t.markedSpan(fmtSec(range![0]), fmtSec(range![1]))}
          <button type="button" onClick={props.onClearRange} className="text-cc-muted hover:text-cc-fg">
            {t.clearMark}
          </button>
        </div>
      ) : null}

      {refusal ? <p className="m-0 mt-2 text-[11px] text-cc-error">{t.dragRefused(refusal)}</p> : null}
    </div>
  );
}
