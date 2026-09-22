/**
 * The timeline — the shot plan drawn on the same clock the lanes play on.
 *
 * Beats sit in rows by kind, so a camera move that spans the whole shot does
 * not shove the action beats around. A trigger beat draws a connector back to
 * the beat that CAUSED it, because "the device lights after the hand arrives"
 * is a claim about order and the timeline is where an inversion is visible
 * (invariant 5). Failed checks with a range paint that span red on a thin
 * track underneath — the acceptance record on the same axis as the thing it
 * is about.
 *
 * A `tempo` row appears when the greybox was time-remapped: the greybox IS
 * the clock the video model follows, so a half-speed stretch is a fact about
 * the render, drawn on the same axis as the beats it slows down.
 *
 * Click seeks. Drag scrubs. Shift-drag marks a range, which is what travels
 * to the agent with the user's next sentence.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Beat, BeatKind, Shot, TimeWarp } from "../domain.js";
import {
  beatLinks,
  beatRows,
  clamp,
  failedRanges,
  formatSeconds,
  tempoSpans,
  type BeatRow,
} from "./player-model.js";
import { useClock, type Clock } from "./usePlayhead.js";

const ROW_HEIGHT = 20;
const ROW_GAP = 3;
const CHECK_TRACK = 7;
const TEMPO_TRACK = 12;

const KIND_LABEL: Record<BeatKind, string> = {
  action: "action",
  trigger: "trigger",
  camera: "camera",
  hold: "hold",
};

const KIND_CLASS: Record<BeatKind, string> = {
  action: "border-cc-primary/45 bg-cc-primary/20 text-cc-fg",
  trigger: "border-cc-warning/55 bg-cc-warning/20 text-cc-fg",
  camera: "border-cc-border bg-cc-user-bubble text-cc-fg",
  hold: "border-cc-border bg-cc-hover text-cc-muted",
};

export interface TimelineProps {
  shot: Shot;
  clock: Clock;
  markedRange: [number, number] | null;
  onMarkRange: (range: [number, number] | null) => void;
  /** A beat click also arms the beat loop window. */
  onBeatFocus: (beat: Beat | null) => void;
  /** `scene.meta.json`'s `time_warp`; empty when the shot runs at one speed. */
  timeWarp?: ReadonlyArray<TimeWarp>;
}

export function Timeline({
  shot,
  clock,
  markedRange,
  onMarkRange,
  onBeatFocus,
  timeWarp = [],
}: TimelineProps) {
  const duration = Math.max(shot.spec.seconds, 1e-3);
  const rows = beatRows(shot.beats);
  const links = beatLinks(rows);
  const failures = failedRanges(shot.checks);
  const tempo = tempoSpans(timeWarp, duration);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<{ mode: "scrub" | "range"; start: number } | null>(null);
  const [draft, setDraft] = useState<[number, number] | null>(null);

  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const timeAt = useCallback(
    (clientX: number) => {
      const box = trackRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return 0;
      return clamp(((clientX - box.left) / box.width) * duration, 0, duration);
    },
    [duration],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* capture is an optimization; the drag works without it */
      }
      const t = timeAt(event.clientX);
      if (event.shiftKey) {
        drag.current = { mode: "range", start: t };
        setDraft([t, t]);
      } else {
        drag.current = { mode: "scrub", start: t };
        clock.pause();
        clock.seek(t);
      }
    },
    [clock, timeAt],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state) return;
      const t = timeAt(event.clientX);
      if (state.mode === "scrub") {
        clock.seek(t);
      } else {
        setDraft(state.start <= t ? [state.start, t] : [t, state.start]);
      }
    },
    [clock, timeAt],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      drag.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* never captured, or already released */
      }
      if (!state) return;
      if (state.mode === "range") {
        const range = draft;
        setDraft(null);
        // A shift-CLICK is not a range; it is how a user clears one.
        onMarkRange(range && range[1] - range[0] > 0.02 ? range : null);
      }
    },
    [draft, onMarkRange],
  );

  const pct = (t: number) => `${(clamp(t, 0, duration) / duration) * 100}%`;
  const rowsHeight = rows.length * ROW_HEIGHT + Math.max(0, rows.length - 1) * ROW_GAP;
  const shown = markedRange ?? draft;

  return (
    <div className="shrink-0 border-t border-cc-border bg-cc-surface/20 px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="flex w-14 shrink-0 flex-col gap-[3px] pt-[1px]">
          {rows.map((row) => (
            <span
              key={row.kind}
              className="flex items-center text-[9px] uppercase tracking-wide text-cc-muted"
              style={{ height: ROW_HEIGHT }}
            >
              {KIND_LABEL[row.kind]}
            </span>
          ))}
          {tempo.length > 0 ? (
            <span
              className="flex items-center text-[9px] uppercase tracking-wide text-cc-primary"
              style={{ height: TEMPO_TRACK }}
            >
              tempo
            </span>
          ) : null}
          {failures.length > 0 ? (
            <span
              className="flex items-center text-[9px] uppercase tracking-wide text-cc-error"
              style={{ height: CHECK_TRACK }}
            >
              fail
            </span>
          ) : null}
        </div>

        <div
          ref={trackRef}
          className="relative min-w-0 flex-1 cursor-crosshair touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="presentation"
          title="Click to seek · drag to scrub · shift-drag to mark a range"
        >
          <div className="flex flex-col" style={{ gap: ROW_GAP }}>
            {rows.map((row) => (
              <BeatRowView
                key={row.kind}
                row={row}
                duration={duration}
                onBeatFocus={onBeatFocus}
                clock={clock}
              />
            ))}
          </div>

          {/* Connectors sit over the rows: a cause is usually on another row. */}
          {links.length > 0 && width > 0 ? (
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={width}
              height={rowsHeight}
              aria-hidden="true"
            >
              {links.map((link) => {
                const x1 = (link.fromTime / duration) * width;
                const x2 = (link.toTime / duration) * width;
                const y1 = link.fromRow * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;
                const y2 = link.toRow * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;
                const mid = (y1 + y2) / 2;
                return (
                  <g key={`${link.causeId}->${link.triggerId}`} className="text-cc-warning">
                    <path
                      d={`M${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      opacity={0.85}
                    />
                    <circle cx={x1} cy={y1} r={1.8} fill="currentColor" />
                    <path
                      d={`M${x2 - 2.6} ${y2 - 3} L${x2} ${y2} L${x2 - 2.6} ${y2 + 3}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1}
                    />
                  </g>
                );
              })}
            </svg>
          ) : null}

          {tempo.length > 0 ? (
            <div
              className="relative mt-[3px] overflow-hidden rounded-sm bg-cc-hover"
              style={{ height: TEMPO_TRACK }}
            >
              {tempo.map((span) => (
                <span
                  key={`${span.from}:${span.to}:${span.factor}`}
                  className={`absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-sm border text-[8px] leading-none ${
                    span.slow
                      ? "border-cc-primary/50 bg-cc-primary/25 text-cc-primary"
                      : "border-cc-warning/55 bg-cc-warning/20 text-cc-warning"
                  }`}
                  style={{
                    left: pct(span.from),
                    width: `calc(${pct(span.to - span.from)} + 1px)`,
                  }}
                  title={`${span.label} — the greybox remaps ${formatSeconds(span.from)}–${formatSeconds(
                    span.to,
                  )} s to ${span.slow ? "slow motion" : "a speed-up"}; the shot still runs ${formatSeconds(
                    duration,
                  )} s`}
                >
                  {span.label}
                </span>
              ))}
            </div>
          ) : null}

          {failures.length > 0 ? (
            <div
              className="relative mt-[3px] overflow-hidden rounded-sm bg-cc-hover"
              style={{ height: CHECK_TRACK }}
            >
              {failures.map((failure) => (
                <span
                  key={`${failure.target}:${failure.id}`}
                  className="absolute inset-y-0 rounded-sm bg-cc-error/70"
                  style={{
                    left: pct(failure.from),
                    width: `calc(${pct(failure.to - failure.from)} + 1px)`,
                  }}
                  title={`${failure.id} failed on ${failure.target}: ${failure.label}`}
                />
              ))}
            </div>
          ) : null}

          {shown ? (
            <div
              className="pointer-events-none absolute inset-y-0 border-x border-cc-primary/70 bg-cc-primary/10"
              style={{ left: pct(shown[0]), width: pct(shown[1] - shown[0]) }}
            />
          ) : null}

          <Playhead clock={clock} duration={duration} />
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between pl-16 text-[9px] tabular-nums text-cc-muted">
        <span>0.00 s</span>
        <span>{formatSeconds(duration)} s</span>
      </div>
    </div>
  );
}

function BeatRowView({
  row,
  duration,
  onBeatFocus,
  clock,
}: {
  row: BeatRow;
  duration: number;
  onBeatFocus: (beat: Beat | null) => void;
  clock: Clock;
}) {
  return (
    <div className="relative" style={{ height: ROW_HEIGHT }}>
      {row.beats.map((beat) => {
        const left = (clamp(beat.from, 0, duration) / duration) * 100;
        const width = ((clamp(beat.to, 0, duration) - clamp(beat.from, 0, duration)) / duration) * 100;
        return (
          <button
            key={beat.id}
            type="button"
            // The pointer handlers on the track own scrubbing; a beat is a
            // shortcut to its own start, and arms the beat loop.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              clock.seek(beat.from);
              onBeatFocus(beat);
            }}
            // The label is what fits on the block; the DESIGN is what the
            // greybox is judged against, so hovering has to give it back.
            title={`${beat.label} · ${formatSeconds(beat.from)}–${formatSeconds(beat.to)} s${
              beat.causedBy ? ` · caused by "${beat.causedBy}"` : ""
            }${beat.detail ? `\n${beat.detail}` : ""}`}
            className={`absolute inset-y-0 min-w-[2px] overflow-hidden rounded-sm border px-1 text-left text-[9px] leading-[18px] transition-colors hover:brightness-125 ${KIND_CLASS[beat.kind]}`}
            style={{ left: `${left}%`, width: `calc(${width}% + 1px)` }}
          >
            <span className="block truncate">{beat.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Its own subscriber: the cursor moves every frame, the rows do not. */
function Playhead({ clock, duration }: { clock: Clock; duration: number }) {
  const { time } = useClock(clock);
  return (
    <div
      className="pointer-events-none absolute inset-y-0 w-px bg-cc-fg"
      style={{ left: `${(clamp(time, 0, duration) / duration) * 100}%` }}
    >
      <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-cc-fg" />
    </div>
  );
}

export default Timeline;
