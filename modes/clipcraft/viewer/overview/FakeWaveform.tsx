import { useMemo } from "react";

export function FakeWaveform({ seed, bars, height, color }: {
  seed: string; bars: number; height: number; color: string;
}) {
  const heights = useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    const out: number[] = [];
    for (let i = 0; i < bars; i++) {
      h = ((h << 5) - h + i * 7) | 0;
      out.push(0.15 + ((h >>> 0) % 100) / 100 * 0.85);
    }
    return out;
  }, [seed, bars]);

  return (
    <div style={{ display: "flex", alignItems: "center", height, gap: 1 }}>
      {heights.map((v, i) => (
        <div key={i} style={{
          width: 3, height: Math.max(2, Math.round(v * height)),
          background: color, borderRadius: 1.5, flexShrink: 0,
        }} />
      ))}
    </div>
  );
}
