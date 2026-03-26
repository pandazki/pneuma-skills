import { defineTile } from "gridboard";

interface WeatherData {
  current_condition: Array<{
    temp_C: string;
    temp_F: string;
    humidity: string;
    windspeedKmph: string;
    weatherDesc: Array<{ value: string }>;
    FeelsLikeC: string;
  }>;
  nearest_area: Array<{
    areaName: Array<{ value: string }>;
    country: Array<{ value: string }>;
  }>;
}

export default defineTile({
  label: "Weather",
  description: "Current weather conditions fetched from wttr.in",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 6, rows: 4 },
  // responsive breakpoints cover all sizes within min/max
  isOptimizedFor: () => true,

  params: {
    city: { type: "string", default: "Tokyo", label: "City" },
    unit: { type: "string", default: "C", label: "Unit (C or F)" },
  },

  dataSource: {
    refreshInterval: 600,
    async fetch({ signal, params }) {
      const city = encodeURIComponent(String(params.city || "Tokyo"));
      const res = await fetch(`https://wttr.in/${city}?format=j1`, { signal });
      if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);
      return res.json() as Promise<WeatherData>;
    },
  },

  render({ data, width, height, loading, error, params }) {
    const isWide = width >= 260;
    const isNarrow = width < 180;

    if (loading) {
      return (
        <div style={centerStyle}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading…</div>
        </div>
      );
    }

    if (error || !data) {
      return (
        <div style={centerStyle}>
          <div style={{ color: "var(--error)", fontSize: "0.75rem", textAlign: "center", padding: "8px" }}>
            {error ? `Error: ${error.message}` : "No data"}
          </div>
        </div>
      );
    }

    const w = data as WeatherData;
    const cc = w.current_condition[0];
    const area = w.nearest_area[0];
    const useF = String(params.unit).toUpperCase() === "F";
    const temp = useF ? `${cc.temp_F}°F` : `${cc.temp_C}°C`;
    const feelsLike = useF
      ? `${Math.round((Number(cc.FeelsLikeC) * 9) / 5 + 32)}°F`
      : `${cc.FeelsLikeC}°C`;
    const desc = cc.weatherDesc[0]?.value ?? "–";
    const humidity = `${cc.humidity}%`;
    const wind = `${cc.windspeedKmph} km/h`;
    const cityName = area?.areaName[0]?.value ?? String(params.city);

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "var(--tile-padding)",
          boxSizing: "border-box",
          fontFamily: "var(--font-family)",
          gap: "6px",
        }}
      >
        {/* City + description */}
        <div>
          <div
            style={{
              fontSize: isNarrow ? "0.7rem" : "0.8rem",
              color: "var(--text-secondary)",
              marginBottom: "2px",
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {cityName}
          </div>
          <div
            style={{
              fontSize: isNarrow ? "0.65rem" : "0.72rem",
              color: "var(--text-muted)",
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {desc}
          </div>
        </div>

        {/* Temperature */}
        <div
          style={{
            fontSize: isNarrow ? "2rem" : isWide ? "2.8rem" : "2.2rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          {temp}
        </div>

        {/* Detail row */}
        {isWide ? (
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <StatBadge label="Feels like" value={feelsLike} />
            <StatBadge label="Humidity" value={humidity} />
            <StatBadge label="Wind" value={wind} />
          </div>
        ) : (
          <div style={{ display: "flex", gap: "8px" }}>
            <StatBadge label="Hum." value={humidity} />
            <StatBadge label="Wind" value={wind} />
          </div>
        )}
      </div>
    );
  },
});

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
