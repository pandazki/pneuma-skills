import { useMemo } from "react";

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
  width: number;
}

export function TimeRuler({ duration, pixelsPerSecond, scrollLeft, width }: Props) {
  const ticks = useMemo(() => {
    if (pixelsPerSecond <= 0) return [];
    const interval = tickInterval(pixelsPerSecond);
    const startTime = Math.floor(scrollLeft / pixelsPerSecond / interval) * interval;
    const endTime = Math.min(duration, (scrollLeft + width) / pixelsPerSecond + interval);
    const result: { time: number; x: number }[] = [];
    for (let t = startTime; t <= endTime; t += interval) {
      result.push({ time: t, x: t * pixelsPerSecond - scrollLeft });
    }
    return result;
  }, [duration, pixelsPerSecond, scrollLeft, width]);

  return (
    <div style={{ position: "relative", height: 24, overflow: "hidden", userSelect: "none" }}>
      {ticks.map(({ time, x }) => (
        <div key={time} style={{ position: "absolute", left: x, top: 0 }}>
          <div style={{ width: 1, height: 10, background: "#3f3f46", transform: "translateX(-0.5px)" }} />
          <span
            style={{
              fontSize: 9,
              color: "#52525b",
              position: "absolute",
              top: 11,
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
