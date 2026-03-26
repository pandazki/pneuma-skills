import { defineTile } from "gridboard";

type Phase = "work" | "break";

const WORK_DURATION = 25 * 60; // 25 minutes in seconds
const BREAK_DURATION = 5 * 60; // 5 minutes in seconds

export default defineTile({
  label: "Pomodoro",
  description: "25/5 focus timer with progress ring and session tracking",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 4 },
  // responsive breakpoints cover all sizes within min/max
  isOptimizedFor: () => true,

  render({ width, height }) {
    const [phase, setPhase] = React.useState<Phase>("work");
    const [secondsLeft, setSecondsLeft] = React.useState(WORK_DURATION);
    const [running, setRunning] = React.useState(false);
    const [sessions, setSessions] = React.useState(0);

    const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    // Tick
    React.useEffect(() => {
      if (running) {
        intervalRef.current = setInterval(() => {
          setSecondsLeft((prev) => {
            if (prev <= 1) {
              // Phase complete
              setRunning(false);
              if (phase === "work") {
                setSessions((s) => s + 1);
                setPhase("break");
                return BREAK_DURATION;
              } else {
                setPhase("work");
                return WORK_DURATION;
              }
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }, [running, phase]);

    function toggleRunning() {
      setRunning((r) => !r);
    }

    function reset() {
      setRunning(false);
      setPhase("work");
      setSecondsLeft(WORK_DURATION);
    }

    // Format time
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    // Progress ring
    const total = phase === "work" ? WORK_DURATION : BREAK_DURATION;
    const progress = 1 - secondsLeft / total;
    const isWork = phase === "work";
    const ringColor = isWork ? "var(--accent)" : "var(--success)";

    // Breakpoints (pixel-based, consistent with clock tile pattern)
    const isCompact = width < 180 || height < 180;
    const isMedium = !isCompact && (width < 280 || height < 280);
    const isLarge = !isCompact && !isMedium;

    // Ring dimensions
    const ringSize = isCompact ? 64 : isMedium ? 100 : 130;
    const strokeWidth = isCompact ? 4 : isMedium ? 6 : 7;
    const radius = (ringSize - strokeWidth * 2) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - progress);

    // Font sizes
    const timeFontSize = isCompact ? "1.3rem" : isMedium ? "1.7rem" : "2.2rem";
    const labelFontSize = isCompact ? "0.55rem" : isMedium ? "0.65rem" : "0.75rem";
    const btnSize = isCompact ? 22 : isMedium ? 28 : 34;
    const btnFontSize = isCompact ? "0.6rem" : isMedium ? "0.7rem" : "0.8rem";

    const motivational = isWork ? "Focus time!" : "Take a break!";

    // Shared button style factory
    function btnStyle(primary: boolean): React.CSSProperties {
      return {
        width: btnSize,
        height: btnSize,
        borderRadius: "50%",
        border: primary ? "none" : "1.5px solid rgba(255,255,255,0.15)",
        background: primary ? ringColor : "rgba(255,255,255,0.06)",
        color: primary ? "#09090b" : "var(--text-secondary)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: btnFontSize,
        fontFamily: "var(--font-family)",
        fontWeight: 700,
        flexShrink: 0,
        transition: "opacity 0.15s",
      };
    }

    // ── Compact layout: ring + time + start/pause only ──
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
            gap: 6,
            fontFamily: "var(--font-mono)",
            userSelect: "none",
          }}
        >
          {/* Time only, no ring (too small) */}
          <div
            style={{
              fontSize: timeFontSize,
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "0.04em",
              lineHeight: 1,
            }}
          >
            {timeStr}
          </div>
          <div
            style={{
              fontSize: labelFontSize,
              color: isWork ? "var(--accent)" : "var(--success)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            {isWork ? "Work" : "Break"}
          </div>
          <button onClick={toggleRunning} style={btnStyle(true)}>
            {running ? "⏸" : "▶"}
          </button>
        </div>
      );
    }

    // ── Medium / Large shared: ring with time inside ──
    const ringEl = (
      <div style={{ position: "relative", width: ringSize, height: ringSize, flexShrink: 0 }}>
        <svg
          width={ringSize}
          height={ringSize}
          style={{ transform: "rotate(-90deg)", display: "block" }}
        >
          {/* Track */}
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={strokeWidth}
          />
          {/* Progress */}
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: running ? "stroke-dashoffset 1s linear" : "none" }}
          />
        </svg>
        {/* Time overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <span
            style={{
              fontSize: timeFontSize,
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "0.04em",
              lineHeight: 1,
              fontFamily: "var(--font-mono)",
            }}
          >
            {timeStr}
          </span>
          {isMedium && (
            <span
              style={{
                fontSize: "0.58rem",
                color: isWork ? "var(--accent)" : "var(--success)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
                fontFamily: "var(--font-family)",
              }}
            >
              {isWork ? "Work" : "Break"}
            </span>
          )}
        </div>
      </div>
    );

    // ── Medium layout ──
    if (isMedium) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontFamily: "var(--font-family)",
            userSelect: "none",
          }}
        >
          {ringEl}
          {/* Controls row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={toggleRunning} style={btnStyle(true)}>
              {running ? "⏸" : "▶"}
            </button>
            <button onClick={reset} style={btnStyle(false)}>
              ↺
            </button>
          </div>
          {/* Session count */}
          <div
            style={{
              fontSize: "0.62rem",
              color: "var(--text-muted)",
              letterSpacing: "0.05em",
            }}
          >
            Sessions:{" "}
            <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
              {sessions}
            </span>
          </div>
        </div>
      );
    }

    // ── Large layout ──
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          fontFamily: "var(--font-family)",
          userSelect: "none",
        }}
      >
        {/* Motivational label */}
        <div
          style={{
            fontSize: "0.8rem",
            fontWeight: 700,
            color: isWork ? "var(--accent)" : "var(--success)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {motivational}
        </div>

        {ringEl}

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={reset} style={btnStyle(false)}>
            ↺
          </button>
          <button
            onClick={toggleRunning}
            style={{
              ...btnStyle(true),
              width: btnSize + 10,
              height: btnSize + 10,
              fontSize: "1rem",
            }}
          >
            {running ? "⏸" : "▶"}
          </button>
          {/* Skip phase */}
          <button
            onClick={() => {
              setRunning(false);
              if (phase === "work") {
                setSessions((s) => s + 1);
                setPhase("break");
                setSecondsLeft(BREAK_DURATION);
              } else {
                setPhase("work");
                setSecondsLeft(WORK_DURATION);
              }
            }}
            style={btnStyle(false)}
            title="Skip phase"
          >
            ⏭
          </button>
        </div>

        {/* Session count */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.72rem",
            color: "var(--text-muted)",
          }}
        >
          {Array.from({ length: Math.max(sessions, 4) }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: i < sessions ? "var(--accent)" : "rgba(255,255,255,0.1)",
                transition: "background 0.3s",
              }}
            />
          ))}
          <span style={{ marginLeft: 4, color: "var(--text-secondary)", fontWeight: 600 }}>
            ×{sessions}
          </span>
        </div>
      </div>
    );
  },
});
