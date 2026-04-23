// Pure presentational; no store coupling.

/** Render waveform peaks as vertical bars. Shared by AudioTrack (and a future BGM track). */
export function WaveformBars({
  peaks,
  height,
  color,
  stretch,
}: {
  peaks: number[];
  height: number;
  color: string;
  /** If true, bars flex to fill container width instead of fixed 2px. */
  stretch?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", height, gap: 1, width: "100%" }}>
      {peaks.map((v, i) => (
        <div
          key={i}
          style={{
            flex: stretch ? "1 1 0" : undefined,
            width: stretch ? undefined : 2,
            minWidth: stretch ? 1 : undefined,
            height: Math.max(1, Math.round(v * height)),
            background: color,
            borderRadius: 1,
            flexShrink: stretch ? 1 : 0,
          }}
        />
      ))}
    </div>
  );
}
