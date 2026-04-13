/**
 * Thin wrapper around the peaks-renderer shape used in the exploded stack.
 * A sibling `WaveformBars` exists under `../timeline/` but is bound to the
 * timeline clip layout; this version is a simple flex row that stretches to
 * fill its container, used inside ExplodedLayer's audio content slot.
 */
export function WaveformBars({
  peaks,
  height,
  color,
  stretch = false,
}: {
  peaks: number[];
  height: number;
  color: string;
  stretch?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height,
        gap: 1,
        width: stretch ? "100%" : undefined,
      }}
    >
      {peaks.map((v, i) => (
        <div
          key={i}
          style={{
            flex: stretch ? "1 1 0" : "0 0 3px",
            height: Math.max(2, Math.round(v * height)),
            background: color,
            borderRadius: 1.5,
          }}
        />
      ))}
    </div>
  );
}
