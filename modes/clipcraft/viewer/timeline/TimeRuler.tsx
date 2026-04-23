/**
 * TimeRuler — ticks + mm:ss labels along the timeline.
 */
import { useMemo } from "react";
import { theme } from "../theme/tokens.js";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Compute nice tick interval based on pixels-per-second.
 * More zoomed in → smaller intervals.
 */
function tickInterval(pps: number): number {
  if (pps >= 100) return 1;
  if (pps >= 40) return 2;
  if (pps >= 20) return 5;
  return 10;
}

interface Props {
  duration: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
}

export function TimeRuler({ duration, pixelsPerSecond, scrollLeft, viewportWidth }: Props) {
  const ticks = useMemo(() => {
    if (pixelsPerSecond <= 0) return [];
    const interval = tickInterval(pixelsPerSecond);
    // Clamp start to 0 — negative tick labels (-1:-4, -1:-2) are ugly and
    // legacy's reducer happened to hide them behind overflow:hidden; in the
    // craft port the viewport can be wider than the content, so the negative
    // ticks would otherwise leak out.
    const startTime = Math.max(
      0,
      Math.floor(scrollLeft / pixelsPerSecond / interval) * interval,
    );
    const endTime = Math.min(duration, (scrollLeft + viewportWidth) / pixelsPerSecond + interval);
    const result: { time: number; x: number }[] = [];
    for (let t = startTime; t <= endTime; t += interval) {
      result.push({ time: t, x: t * pixelsPerSecond - scrollLeft });
    }
    return result;
  }, [duration, pixelsPerSecond, scrollLeft, viewportWidth]);

  return (
    <div
      style={{
        position: "relative",
        height: 24,
        overflow: "hidden",
        userSelect: "none",
        fontFamily: theme.font.numeric,
      }}
    >
      {ticks.map(({ time, x }) => (
        <div key={time} style={{ position: "absolute", left: x, top: 0 }}>
          <div
            style={{
              width: 1,
              height: 8,
              background: theme.color.borderStrong,
              transform: "translateX(-0.5px)",
            }}
          />
          <span
            style={{
              fontFamily: theme.font.numeric,
              fontSize: theme.text.xs,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: theme.text.trackingBase,
              color: theme.color.ink4,
              position: "absolute",
              top: 10,
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
            }}
          >
            {formatTime(time)}
          </span>
        </div>
      ))}
    </div>
  );
}
