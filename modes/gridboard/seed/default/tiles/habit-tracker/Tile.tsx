import { defineTile } from "gridboard";

// ── Types ───────────────────────────────────────────────────────────────────

interface Habit {
  id: string;
  name: string;
  emoji: string;
  color: string;       // filled cell color
  colorMid: string;    // medium shade (unused currently, kept for future)
  colorDim: string;    // faint shade
}

// ── Habits config ────────────────────────────────────────────────────────────

const HABITS: Habit[] = [
  { id: "exercise", name: "Exercise",  emoji: "🏃", color: "#22c55e", colorMid: "#16a34a", colorDim: "#14532d" },
  { id: "reading",  name: "Reading",   emoji: "📖", color: "#3b82f6", colorMid: "#2563eb", colorDim: "#1e3a8a" },
  { id: "meditate", name: "Meditate",  emoji: "🧘", color: "#a855f7", colorMid: "#9333ea", colorDim: "#4c1d95" },
];

// ── Demo data seeding ────────────────────────────────────────────────────────

/**
 * Deterministic pseudo-random check-in history for last N days.
 * seed is a number per habit so each habit has a unique pattern.
 */
function seedHistory(seed: number, days: number): boolean[] {
  return Array.from({ length: days }, (_, i) => {
    const v = Math.abs(Math.sin(seed * 31337 + i * 127 + 19) * 10000) % 1;
    const recency = 0.3 + 0.7 * ((i + 1) / days); // more likely recent
    return v * recency > 0.38;
  });
}

const INITIAL_CHECKED: Record<string, boolean[]> = {
  exercise: seedHistory(1, 30),
  reading:  seedHistory(2, 30),
  meditate: seedHistory(3, 30),
};

// ── Stats helpers ────────────────────────────────────────────────────────────

function currentStreak(history: boolean[]): number {
  let s = 0;
  // start from yesterday (index 28) or today (29) depending on today's check
  const start = history[29] ? 29 : 28;
  for (let i = start; i >= 0 && history[i]; i--) s++;
  return s;
}

function completionRate(history: boolean[]): number {
  const done = history.filter(Boolean).length;
  return Math.round((done / history.length) * 100);
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** A single dot cell used in the grids */
function Cell({
  filled,
  isToday,
  color,
  size,
  radius,
}: {
  filled: boolean;
  isToday: boolean;
  color: string;
  size: number;
  radius: number;
}) {
  const bg = filled ? color : "var(--tile-border)";
  const border = isToday ? `1.5px solid ${color}` : "1.5px solid transparent";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        border,
        boxSizing: "border-box",
        opacity: filled ? 1 : 0.55,
        transition: "background 0.15s",
        flexShrink: 0,
      }}
    />
  );
}

// ── Main tile ────────────────────────────────────────────────────────────────

export default defineTile({
  label: "Habit Tracker",
  description: "Track daily habits with streaks and a 30-day history grid",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 4 },
  // responsive breakpoints cover all sizes within min/max
  isOptimizedFor: () => true,

  render({ width, height }) {
    const [checked, setChecked] = React.useState<Record<string, boolean[]>>(INITIAL_CHECKED);

    // Layout breakpoints
    const isCompact = width < 220 || height < 200;
    const isLarge   = width >= 340 && height >= 300;
    // medium is the middle tier

    // Toggle today (index 29) for a given habit
    function toggleToday(id: string) {
      setChecked((prev) => {
        const hist = [...prev[id]];
        hist[29] = !hist[29];
        return { ...prev, [id]: hist };
      });
    }

    // ── COMPACT (2×2): emoji + name + circle toggle ──────────────────────────
    if (isCompact) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-evenly",
            padding: "8px 10px",
            boxSizing: "border-box",
            fontFamily: "var(--font-family)",
            userSelect: "none",
          }}
        >
          {HABITS.map((h) => {
            const done = checked[h.id][29];
            return (
              <div
                key={h.id}
                onClick={() => toggleToday(h.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  cursor: "pointer",
                  borderRadius: 6,
                  padding: "2px 4px",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-dim)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                {/* Emoji */}
                <span style={{ fontSize: 14, lineHeight: 1 }}>{h.emoji}</span>
                {/* Name */}
                <span
                  style={{
                    flex: 1,
                    fontSize: "0.72rem",
                    fontWeight: 500,
                    color: done ? "var(--text-primary)" : "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.name}
                </span>
                {/* Toggle circle */}
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    border: done ? "none" : `1.5px solid var(--tile-border-hover)`,
                    background: done ? h.color : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background 0.15s",
                  }}
                >
                  {done && (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"
                      stroke="#09090b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1.5,5 4,7.5 8.5,2.5" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // ── MEDIUM: habits + 7-day dot grid ──────────────────────────────────────
    if (!isLarge) {
      const DOT = 10;
      const DOT_GAP = 4;
      const DAYS = 7;

      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            padding: "10px 12px",
            boxSizing: "border-box",
            fontFamily: "var(--font-family)",
            userSelect: "none",
            gap: 0,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Habits
            </span>
            <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Last 7 days</span>
          </div>

          {/* Habit rows */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-evenly" }}>
            {HABITS.map((h) => {
              const last7 = checked[h.id].slice(30 - DAYS); // indices 23–29
              const done = checked[h.id][29];
              return (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Emoji + name */}
                  <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{h.emoji}</span>
                  <span
                    style={{
                      fontSize: "0.72rem",
                      fontWeight: 500,
                      color: done ? "var(--text-primary)" : "var(--text-secondary)",
                      width: 70,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {h.name}
                  </span>
                  {/* 7-day dots */}
                  <div style={{ display: "flex", gap: DOT_GAP, flex: 1, justifyContent: "flex-end" }}>
                    {last7.map((isDone, di) => {
                      const isToday = di === DAYS - 1;
                      return (
                        <div
                          key={di}
                          onClick={isToday ? () => toggleToday(h.id) : undefined}
                          style={{ cursor: isToday ? "pointer" : "default" }}
                        >
                          <Cell
                            filled={isDone}
                            isToday={isToday}
                            color={h.color}
                            size={DOT}
                            radius={isToday ? 3 : 2}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── LARGE: 30-day grid + streak + completion rate ─────────────────────────
    const DAYS = 30;
    // Calculate dot size to fill available width across 30 columns
    const PAD = 14;
    const labelW = 80; // emoji + name column width
    const statsW = 70; // stats column width
    const availW = width - PAD * 2 - labelW - statsW;
    const DOT_GAP = 3;
    const dotSize = Math.max(6, Math.min(14, Math.floor((availW - (DAYS - 1) * DOT_GAP) / DAYS)));

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: `${PAD}px`,
          boxSizing: "border-box",
          fontFamily: "var(--font-family)",
          userSelect: "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Habit Tracker
          </span>
          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Last 30 days</span>
        </div>

        {/* Habit rows */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-evenly" }}>
          {HABITS.map((h) => {
            const hist = checked[h.id];
            const done = hist[29];
            const streak = currentStreak(hist);
            const rate = completionRate(hist);

            return (
              <div key={h.id}>
                {/* Row: label | grid | stats */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Label */}
                  <div
                    style={{
                      width: labelW,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexShrink: 0,
                      cursor: "pointer",
                    }}
                    onClick={() => toggleToday(h.id)}
                  >
                    <span style={{ fontSize: 15, lineHeight: 1 }}>{h.emoji}</span>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: done ? "var(--text-primary)" : "var(--text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h.name}
                    </span>
                  </div>

                  {/* 30-day grid */}
                  <div
                    style={{
                      display: "flex",
                      gap: DOT_GAP,
                      flex: 1,
                      flexWrap: "nowrap",
                      overflow: "hidden",
                    }}
                  >
                    {hist.map((isDone, di) => {
                      const isToday = di === DAYS - 1;
                      return (
                        <div
                          key={di}
                          onClick={isToday ? () => toggleToday(h.id) : undefined}
                          style={{ cursor: isToday ? "pointer" : "default", flexShrink: 0 }}
                          title={isToday ? "Click to toggle today" : undefined}
                        >
                          <Cell
                            filled={isDone}
                            isToday={isToday}
                            color={h.color}
                            size={dotSize}
                            radius={isToday ? 3 : 2}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Stats */}
                  <div
                    style={{
                      width: statsW,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      flexShrink: 0,
                      gap: 2,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: 700, color: h.color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                        {streak}
                      </span>
                      <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        streak
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                        {rate}%
                      </span>
                      <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        done
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div style={{ marginTop: 8, fontSize: "0.58rem", color: "var(--text-muted)", textAlign: "center", letterSpacing: "0.04em" }}>
          Click today's dot or habit name to toggle
        </div>
      </div>
    );
  },
});
