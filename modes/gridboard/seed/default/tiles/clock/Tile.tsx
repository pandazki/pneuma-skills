import { defineTile } from "gridboard";

export default defineTile({
  label: "Clock",
  description: "Live digital clock with date display",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 4 },

  // Clock has 3 responsive breakpoints — handles all sizes within min/max
  isOptimizedFor: () => true,

  render({ width, height }) {
    const [now, setNow] = React.useState(new Date());

    React.useEffect(() => {
      const id = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(id);
    }, []);

    const pad = (n: number) => String(n).padStart(2, "0");

    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());

    const dateStr = now.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    const isSmall = width < 180 || height < 180;
    const isMed = width < 260 || height < 260;

    const timeFontSize = isSmall ? "1.6rem" : isMed ? "2.2rem" : "3rem";
    const dateFontSize = isSmall ? "0.65rem" : isMed ? "0.75rem" : "0.875rem";
    const sepColor = "var(--accent)";

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: isSmall ? "4px" : "8px",
          fontFamily: "var(--font-mono)",
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontSize: timeFontSize,
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "0.05em",
            lineHeight: 1,
          }}
        >
          <span>{hh}</span>
          <span style={{ color: sepColor, margin: "0 2px" }}>:</span>
          <span>{mm}</span>
          {!isSmall && (
            <>
              <span style={{ color: sepColor, margin: "0 2px" }}>:</span>
              <span style={{ color: "var(--text-secondary)" }}>{ss}</span>
            </>
          )}
        </div>
        <div
          style={{
            fontSize: dateFontSize,
            color: "var(--text-secondary)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {dateStr}
        </div>
      </div>
    );
  },
});
