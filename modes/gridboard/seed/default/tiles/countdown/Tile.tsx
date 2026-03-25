import { defineTile } from "gridboard";

function calcTimeLeft(targetDate: string) {
  const target = new Date(targetDate).getTime();
  const now = Date.now();
  const diff = target - now;

  if (diff <= 0) return null;

  const totalSecs = Math.floor(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;

  return { days, hours, minutes, seconds, diff };
}

function calcYearProgress(targetDate: string): number {
  const target = new Date(targetDate);
  const year = target.getFullYear();
  const startOfYear = new Date(year, 0, 1).getTime();
  const endOfYear = new Date(year + 1, 0, 1).getTime();
  const yearLen = endOfYear - startOfYear;
  const elapsed = Date.now() - startOfYear;
  return Math.max(0, Math.min(1, elapsed / yearLen));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default defineTile({
  label: "Countdown",
  description: "Countdown timer to a target date with days, hours, minutes, and seconds",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 3 },
  // responsive breakpoints cover all sizes within min/max
  isOptimizedFor: () => true,

  params: {
    targetDate: { type: "string", default: "2026-01-01", label: "Target Date" },
    eventName: { type: "string", default: "New Year 2026", label: "Event Name" },
  },

  render({ width, height, params }) {
    const targetDate = (params?.targetDate as string) ?? "2026-01-01";
    const eventName = (params?.eventName as string) ?? "New Year 2026";

    const [timeLeft, setTimeLeft] = React.useState(() => calcTimeLeft(targetDate));
    const [yearProgress, setYearProgress] = React.useState(() => calcYearProgress(targetDate));

    React.useEffect(() => {
      setTimeLeft(calcTimeLeft(targetDate));
      setYearProgress(calcYearProgress(targetDate));
      const id = setInterval(() => {
        setTimeLeft(calcTimeLeft(targetDate));
        setYearProgress(calcYearProgress(targetDate));
      }, 1000);
      return () => clearInterval(id);
    }, [targetDate]);

    const isCompact = width < 220 || height < 160;
    const isMed = width < 340 || height < 220;
    const isLarge = !isCompact && !isMed;

    const p = "var(--tile-padding, 12px)";

    // ── Celebration ─────────────────────────────────────────────────────────
    if (!timeLeft) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: p,
            boxSizing: "border-box",
            fontFamily: "var(--font-family)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: isCompact ? "1.6rem" : "2.4rem", lineHeight: 1 }}>🎉</div>
          <div
            style={{
              fontSize: isCompact ? "0.85rem" : "1.1rem",
              fontWeight: 700,
              color: "var(--accent)",
              lineHeight: 1.2,
            }}
          >
            It's here!
          </div>
          {!isCompact && (
            <div
              style={{
                fontSize: "0.7rem",
                color: "var(--text-secondary)",
                letterSpacing: "0.04em",
              }}
            >
              {eventName}
            </div>
          )}
        </div>
      );
    }

    const { days, hours, minutes, seconds } = timeLeft;

    // ── Compact (2×2): big days + event name ────────────────────────────────
    if (isCompact) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            padding: p,
            boxSizing: "border-box",
            fontFamily: "var(--font-mono)",
            userSelect: "none",
          }}
        >
          <div
            style={{
              fontSize: "2.4rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            {days}
          </div>
          <div
            style={{
              fontSize: "0.6rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            days
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              color: "var(--text-secondary)",
              marginTop: "2px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
              fontFamily: "var(--font-family)",
            }}
          >
            {eventName}
          </div>
        </div>
      );
    }

    // ── Medium: days + hours + minutes in boxes ──────────────────────────────
    if (!isLarge) {
      const unitStyle: React.CSSProperties = {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        background: "rgba(255,255,255,0.04)",
        borderRadius: "8px",
        padding: "8px 4px",
        gap: "4px",
        minWidth: 0,
      };
      const numStyle: React.CSSProperties = {
        fontSize: "1.5rem",
        fontWeight: 700,
        color: "var(--text-primary)",
        lineHeight: 1,
        fontFamily: "var(--font-mono)",
        letterSpacing: "-0.02em",
      };
      const labelStyle: React.CSSProperties = {
        fontSize: "0.55rem",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        fontFamily: "var(--font-family)",
      };
      const sepStyle: React.CSSProperties = {
        fontSize: "1.2rem",
        color: "var(--accent)",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        alignSelf: "center",
        paddingBottom: "12px",
        flexShrink: 0,
      };

      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            padding: p,
            boxSizing: "border-box",
            gap: "8px",
            userSelect: "none",
          }}
        >
          <div
            style={{
              fontSize: "0.65rem",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-family)",
              letterSpacing: "0.03em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {eventName}
          </div>
          <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
            <div style={unitStyle}>
              <span style={numStyle}>{days}</span>
              <span style={labelStyle}>days</span>
            </div>
            <span style={sepStyle}>:</span>
            <div style={unitStyle}>
              <span style={numStyle}>{pad(hours)}</span>
              <span style={labelStyle}>hrs</span>
            </div>
            <span style={sepStyle}>:</span>
            <div style={unitStyle}>
              <span style={numStyle}>{pad(minutes)}</span>
              <span style={labelStyle}>min</span>
            </div>
          </div>
        </div>
      );
    }

    // ── Large: full grid + event name + progress bar ─────────────────────────
    const unitStyle: React.CSSProperties = {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      flex: 1,
      background: "rgba(255,255,255,0.04)",
      borderRadius: "8px",
      padding: "10px 6px",
      gap: "5px",
      minWidth: 0,
    };
    const numStyle: React.CSSProperties = {
      fontSize: "1.75rem",
      fontWeight: 700,
      color: "var(--text-primary)",
      lineHeight: 1,
      fontFamily: "var(--font-mono)",
      letterSpacing: "-0.02em",
    };
    const labelStyle: React.CSSProperties = {
      fontSize: "0.58rem",
      color: "var(--text-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      fontFamily: "var(--font-family)",
    };
    const sepStyle: React.CSSProperties = {
      fontSize: "1.4rem",
      color: "var(--accent)",
      fontFamily: "var(--font-mono)",
      fontWeight: 700,
      alignSelf: "center",
      paddingBottom: "14px",
      flexShrink: 0,
    };

    const progressPct = Math.round(yearProgress * 100);

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: p,
          boxSizing: "border-box",
          gap: "10px",
          userSelect: "none",
        }}
      >
        {/* Event name */}
        <div
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "var(--text-primary)",
            fontFamily: "var(--font-family)",
            letterSpacing: "0.02em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {eventName}
        </div>

        {/* Countdown boxes */}
        <div style={{ display: "flex", gap: "6px", flex: 1, alignItems: "stretch" }}>
          <div style={unitStyle}>
            <span style={numStyle}>{days}</span>
            <span style={labelStyle}>days</span>
          </div>
          <span style={sepStyle}>:</span>
          <div style={unitStyle}>
            <span style={numStyle}>{pad(hours)}</span>
            <span style={labelStyle}>hours</span>
          </div>
          <span style={sepStyle}>:</span>
          <div style={unitStyle}>
            <span style={numStyle}>{pad(minutes)}</span>
            <span style={labelStyle}>min</span>
          </div>
          <span style={sepStyle}>:</span>
          <div style={unitStyle}>
            <span style={{ ...numStyle, color: "var(--text-secondary)" }}>{pad(seconds)}</span>
            <span style={labelStyle}>sec</span>
          </div>
        </div>

        {/* Year progress bar */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "4px",
            }}
          >
            <span
              style={{
                fontSize: "0.58rem",
                color: "var(--text-muted)",
                fontFamily: "var(--font-family)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Year progress
            </span>
            <span
              style={{
                fontSize: "0.58rem",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {progressPct}%
            </span>
          </div>
          <div
            style={{
              width: "100%",
              height: "4px",
              background: "rgba(255,255,255,0.08)",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                background: "var(--accent)",
                borderRadius: "2px",
                transition: "width 1s linear",
              }}
            />
          </div>
        </div>
      </div>
    );
  },
});
