// Small SVG waveform rendered from the peaked-downsampled output of
// `waveform.ts`. Used in two places — the AssetPanel's audio list
// rows and the AssetManagerModal's audio preview tile — so it lives
// in its own file rather than inlining into either consumer.
//
// The first render for a given URL returns `null` from getOrLoadPeaks
// and kicks off decoding; when the promise resolves the peaks-ready
// setter re-renders with bars. After that the module-level cache
// means subsequent mounts paint instantly.

import { useEffect, useState } from "react";
import { theme } from "../theme/tokens.js";
import { getOrLoadPeaks, peakCount } from "./waveform.js";

export interface AudioWaveformProps {
  /** Fully-resolved content URL (e.g. `/content/<encoded-uri>`). */
  url: string;
  width: number;
  height: number;
  /** Fill color for the bars. Defaults to ink3 (muted). */
  color?: string;
}

export function AudioWaveform({ url, width, height, color }: AudioWaveformProps) {
  // Initial state: peek the cache synchronously. The decode (if any)
  // is kicked off from the effect below so we can pass the real
  // setter in — useState initializers can't reference their own
  // setter in TS strict mode.
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    const cached = getOrLoadPeaks(url, setPeaks);
    setPeaks(cached);
  }, [url]);

  if (peaks === null) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: theme.text.xs,
          color: theme.color.ink4,
          fontFamily: theme.font.ui,
        }}
        aria-hidden
      >
        …
      </div>
    );
  }

  const bars = peakCount();
  const barW = width / bars;
  const mid = height / 2;
  const fill = color ?? theme.color.ink3;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ display: "block" }}
    >
      {peaks.map((p, i) => {
        const h = Math.max(1, p * height * 0.9);
        return (
          <rect
            key={i}
            x={i * barW}
            y={mid - h / 2}
            width={Math.max(1, barW * 0.8)}
            height={h}
            fill={fill}
          />
        );
      })}
    </svg>
  );
}
