import { defineTile } from "gridboard";

interface City {
  name: string;
  flag: string;
  offset: number; // UTC offset in hours
}

const CITIES: City[] = [
  { name: "Tokyo",         flag: "🇯🇵", offset: 9   },
  { name: "New York",      flag: "🇺🇸", offset: -5  },
  { name: "London",        flag: "🇬🇧", offset: 0   },
  { name: "Sydney",        flag: "🇦🇺", offset: 11  },
  { name: "Dubai",         flag: "🇦🇪", offset: 4   },
  { name: "San Francisco", flag: "🇺🇸", offset: -8  },
];

function getCityTime(now: Date, offsetHours: number): Date {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + offsetHours * 3600000);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTime(d: Date): { hh: string; mm: string; ampm: string; hours24: number } {
  const h24 = d.getHours();
  const mm = pad(d.getMinutes());
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 || 12;
  return { hh: pad(h12), mm, ampm, hours24: h24 };
}

function getDayIndicator(cityDate: Date, localNow: Date): string {
  const cityDay = cityDate.getDate();
  const localDay = localNow.getDate();
  const diff = cityDay - localDay;
  // Crude check: handle month boundaries by comparing day-of-year-ish delta
  if (diff === 0) return "Today";
  if (diff === 1 || diff < -27) return "Tomorrow";
  return "Yesterday";
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
}

// ── Analog Clock SVG ──────────────────────────────────────────────────────────
function AnalogClock({ date, size }: { date: Date; size: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  const seconds = date.getSeconds();
  const minutes = date.getMinutes() + seconds / 60;
  const hours   = (date.getHours() % 12) + minutes / 60;

  const toRad = (deg: number) => (deg - 90) * (Math.PI / 180);

  const hourAngle = toRad((hours / 12) * 360);
  const minAngle  = toRad((minutes / 60) * 360);

  const hourLen  = r * 0.52;
  const minLen   = r * 0.72;

  const hx = cx + Math.cos(hourAngle) * hourLen;
  const hy = cy + Math.sin(hourAngle) * hourLen;
  const mx = cx + Math.cos(minAngle) * minLen;
  const my = cy + Math.sin(minAngle) * minLen;

  // Tick marks at 12, 3, 6, 9
  const cardinalTicks = [0, 90, 180, 270].map((deg) => {
    const a = toRad(deg);
    const inner = r * 0.78;
    const outer = r * 0.95;
    return {
      x1: cx + Math.cos(a) * inner,
      y1: cy + Math.sin(a) * inner,
      x2: cx + Math.cos(a) * outer,
      y2: cy + Math.sin(a) * outer,
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Face */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="rgba(255,255,255,0.04)"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={1}
      />
      {/* Cardinal ticks */}
      {cardinalTicks.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
      {/* Hour hand */}
      <line
        x1={cx}
        y1={cy}
        x2={hx}
        y2={hy}
        stroke="var(--text-primary)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* Minute hand */}
      <line
        x1={cx}
        y1={cy}
        x2={mx}
        y2={my}
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r={2} fill="var(--accent)" />
    </svg>
  );
}

export default defineTile({
  label: "World Clock",
  description: "Live clocks for 6 global cities — compact, grid, and full analog views",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 3 },
  // responsive breakpoints cover all sizes within min/max
  isOptimizedFor: () => true,

  render({ width, height }) {
    const [now, setNow] = React.useState(new Date());

    React.useEffect(() => {
      const id = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(id);
    }, []);

    // Layout breakpoints
    const isCompact = width < 200 || height < 200;
    const isLarge   = width >= 340 && height >= 260;

    // ── Compact (2×2): 2 cities stacked ─────────────────────────────────────
    if (isCompact) {
      const cities = CITIES.slice(0, 2);
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 6,
            padding: "10px 14px",
            boxSizing: "border-box",
            userSelect: "none",
          }}
        >
          {cities.map((city) => {
            const ct = getCityTime(now, city.offset);
            const { hh, mm, ampm } = formatTime(ct);
            return (
              <div
                key={city.name}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: "0.65rem",
                    color: "var(--text-muted)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    fontFamily: "var(--font-family)",
                    flexShrink: 0,
                    minWidth: 56,
                  }}
                >
                  {city.name}
                </span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                  <span
                    style={{
                      fontSize: "1.55rem",
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      letterSpacing: "0.03em",
                      lineHeight: 1,
                    }}
                  >
                    {hh}:{mm}
                  </span>
                  <span
                    style={{
                      fontSize: "0.6rem",
                      color: "var(--accent)",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 600,
                    }}
                  >
                    {ampm}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // ── Large: all 6 cities with analog clocks ───────────────────────────────
    if (isLarge) {
      const clockSize = Math.min(44, Math.floor(height / 3) - 28);
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "repeat(3, 1fr)",
            gap: "1px",
            boxSizing: "border-box",
            overflow: "hidden",
            userSelect: "none",
          }}
        >
          {CITIES.map((city, i) => {
            const ct = getCityTime(now, city.offset);
            const { hh, mm, ampm, hours24 } = formatTime(ct);
            const dayLabel = getDayIndicator(ct, now);
            const dateStr  = formatDate(ct);
            const sign     = city.offset >= 0 ? "+" : "";
            const offsetStr = `UTC${sign}${city.offset}`;

            // Subtle separator between cells
            const borderRight  = i % 2 === 0 ? "1px solid rgba(255,255,255,0.06)" : "none";
            const borderBottom = i < 4 ? "1px solid rgba(255,255,255,0.06)" : "none";

            return (
              <div
                key={city.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  boxSizing: "border-box",
                  borderRight,
                  borderBottom,
                  overflow: "hidden",
                  minWidth: 0,
                }}
              >
                {/* Analog clock */}
                <AnalogClock date={ct} size={clockSize} />

                {/* Text info */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    minWidth: 0,
                    overflow: "hidden",
                  }}
                >
                  {/* City + flag */}
                  <div
                    style={{
                      fontSize: "0.6rem",
                      color: "var(--text-muted)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      fontFamily: "var(--font-family)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                    }}
                  >
                    <span>{city.flag}</span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {city.name}
                    </span>
                  </div>

                  {/* Time */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 3,
                      lineHeight: 1,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "1.15rem",
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {hh}:{mm}
                    </span>
                    <span
                      style={{
                        fontSize: "0.55rem",
                        color: "var(--accent)",
                        fontFamily: "var(--font-mono)",
                        fontWeight: 600,
                      }}
                    >
                      {ampm}
                    </span>
                  </div>

                  {/* Date */}
                  <div
                    style={{
                      fontSize: "0.55rem",
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font-family)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {dateStr}
                  </div>

                  {/* UTC badge + day indicator */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.5rem",
                        color: "var(--text-muted)",
                        background: "rgba(255,255,255,0.07)",
                        borderRadius: 3,
                        padding: "1px 4px",
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {offsetStr}
                    </span>
                    {dayLabel !== "Today" && (
                      <span
                        style={{
                          fontSize: "0.5rem",
                          color: dayLabel === "Tomorrow" ? "var(--accent)" : "var(--text-muted)",
                          fontFamily: "var(--font-family)",
                          fontWeight: 600,
                          letterSpacing: "0.03em",
                        }}
                      >
                        {dayLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // ── Medium: 4 cities in 2×2 grid ─────────────────────────────────────────
    const cities = CITIES.slice(0, 4);
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          boxSizing: "border-box",
          overflow: "hidden",
          userSelect: "none",
        }}
      >
        {cities.map((city, i) => {
          const ct = getCityTime(now, city.offset);
          const { hh, mm, ampm } = formatTime(ct);
          const dayLabel = getDayIndicator(ct, now);

          const borderRight  = i % 2 === 0 ? "1px solid rgba(255,255,255,0.06)" : "none";
          const borderBottom = i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none";

          return (
            <div
              key={city.name}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                padding: "8px 6px",
                boxSizing: "border-box",
                borderRight,
                borderBottom,
                overflow: "hidden",
              }}
            >
              {/* City name */}
              <div
                style={{
                  fontSize: "0.6rem",
                  color: "var(--text-muted)",
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-family)",
                  whiteSpace: "nowrap",
                }}
              >
                {city.name}
              </div>

              {/* Time */}
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 3,
                  lineHeight: 1,
                }}
              >
                <span
                  style={{
                    fontSize: "1.3rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.03em",
                  }}
                >
                  {hh}:{mm}
                </span>
                <span
                  style={{
                    fontSize: "0.58rem",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                  }}
                >
                  {ampm}
                </span>
              </div>

              {/* Day indicator */}
              <div
                style={{
                  fontSize: "0.55rem",
                  color:
                    dayLabel === "Today"
                      ? "var(--text-muted)"
                      : dayLabel === "Tomorrow"
                      ? "var(--accent)"
                      : "rgba(255,255,255,0.35)",
                  fontFamily: "var(--font-family)",
                  letterSpacing: "0.05em",
                }}
              >
                {dayLabel}
              </div>
            </div>
          );
        })}
      </div>
    );
  },
});
