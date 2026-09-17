/**
 * The rounds rail — the loop's trajectory, and the only navigation control.
 *
 * One chip per recorded round with its score, the best one lit, plus a
 * sparkline of the same numbers. Both read the SAME arrays (`railChips`,
 * `sparklinePoints`): a rail and a chart that each derived their own idea of
 * "best" is exactly how two surfaces on one screen start disagreeing.
 *
 * The leading chip is Live. Selecting a round swaps that round's recorded
 * capture onto the stage, so "back to the scene" has to be reachable in one
 * click and not by guessing which chip means "none".
 *
 * A round judged against a target the loop has since replaced is dimmed and
 * marked `v<N>`. It stays on the rail — it happened, and its capture is worth
 * looking at — but `lucid.mjs` excludes it from the exit rules, so a rail that
 * drew it like the others would show a re-dreamed loop as one long climb
 * instead of the restart it is.
 */

import type { RailChip, SparklinePoint } from "./stage.js";
import { sparklinePath } from "./stage.js";
import { SparkIcon } from "./icons.js";

const SPARK_W = 88;
const SPARK_H = 22;

export interface RoundsRailProps {
  chips: RailChip[];
  points: SparklinePoint[];
  /** 1-based round index, or null when the live scene is on the stage. */
  selected: number | null;
  onSelect: (round: number | null) => void;
}

export function RoundsRail({ chips, points, selected, onSelect }: RoundsRailProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-cc-border bg-cc-surface/30 px-3 py-2 backdrop-blur"
      data-lucid-rail
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        title="Show the scene running now"
        className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
          selected === null
            ? "border-cc-primary/50 bg-cc-primary/15 text-cc-primary"
            : "border-cc-border text-cc-muted hover:border-cc-primary/40 hover:text-cc-fg"
        }`}
      >
        Live
      </button>

      <span className="h-4 w-px shrink-0 bg-cc-border" />

      {chips.length === 0 ? (
        <span className="text-[11px] text-cc-muted">No rounds recorded yet</span>
      ) : (
        chips.map((chip) => (
          <button
            key={chip.index}
            type="button"
            onClick={() => onSelect(chip.index)}
            aria-pressed={selected === chip.index}
            aria-label={chip.label}
            title={`${chip.label}${chip.rethink ? " · rethink" : ""}${
              chip.hasCapture ? "" : " · no capture recorded"
            }${
              chip.superseded
                ? " · judged against an earlier target; its score no longer counts"
                : ""
            }`}
            className={`group relative shrink-0 rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition-colors ${
              selected === chip.index
                ? "border-cc-primary/50 bg-cc-primary/15 text-cc-primary"
                : chip.best
                  ? "border-cc-success/40 text-cc-success hover:border-cc-success/70"
                  : "border-cc-border text-cc-muted hover:border-cc-primary/40 hover:text-cc-fg"
            } ${chip.hasCapture ? "" : "opacity-60"} ${
              // A re-dream restarts the loop: the rounds before it stay on the
              // rail (they happened, and their captures are worth looking at)
              // but they are not part of the trajectory the trend draws, so
              // they must not read as though they were.
              chip.superseded && selected !== chip.index ? "opacity-45" : ""
            }`}
          >
            {chip.short}
            {chip.superseded ? (
              <span className="ml-1 align-[0.5px] text-[9px] tracking-wide text-cc-muted">
                v{chip.targetVersion}
              </span>
            ) : null}
            {chip.best ? (
              <span className="ml-1 inline-flex align-[-1px] text-cc-success">
                <SparkIcon size={10} />
              </span>
            ) : null}
            {chip.rethink ? (
              <span className="absolute -top-0.5 right-1 h-1 w-1 rounded-full bg-cc-primary" />
            ) : null}
          </button>
        ))
      )}

      {points.length > 0 ? (
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
          <span className="text-[10px] uppercase tracking-wide text-cc-muted">Trend</span>
          <svg
            width={SPARK_W}
            height={SPARK_H}
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            aria-hidden="true"
            className="overflow-visible"
          >
            {/* The 8.0 exit line — the number the loop is trying to cross. */}
            <line
              x1={0}
              x2={SPARK_W}
              y1={SPARK_H - (8 / 10) * SPARK_H}
              y2={SPARK_H - (8 / 10) * SPARK_H}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 3"
              className="text-cc-border"
            />
            {points.length > 1 ? (
              <path
                d={sparklinePath(points)}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-cc-primary"
              />
            ) : null}
            {points.map((point, i) => (
              <circle
                key={i}
                cx={point.x}
                cy={point.y}
                r={i === points.length - 1 ? 2.4 : 1.6}
                className="fill-cc-primary"
              />
            ))}
          </svg>
        </div>
      ) : null}
    </div>
  );
}

export default RoundsRail;
