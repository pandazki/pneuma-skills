// Small SVG waveform rendered from the peaked-downsampled output of
// `waveform.ts`. Used in two places — the AssetPanel's audio list
// rows and the AssetManagerModal's audio preview tile — so it lives
// in its own file rather than inlining into either consumer.
//
// The first render for a given URL returns `null` from getOrLoadPeaks
// and kicks off decoding; when the promise resolves the peaks-ready
// setter re-renders with bars. After that the module-level cache
// means subsequent mounts paint instantly.

import { memo, useEffect, useState } from "react";
import { theme } from "../theme/tokens.js";
import { getOrLoadPeaks, peakCount, peekPeaks } from "./waveform.js";

export interface AudioWaveformProps {
  /** Fully-resolved content URL (e.g. `/content/<encoded-uri>`). */
  url: string;
  width: number;
  height: number;
  /** Fill color for the bars. Defaults to ink3 (muted). */
  color?: string;
}

export const AudioWaveform = memo(function AudioWaveform({
  url,
  width,
  height,
  color,
}: AudioWaveformProps) {
  // Initial state: peek the cache synchronously so a warm URL paints
  // bars on the first frame (no "…" flash on modal reopen). The
  // decode (if the cache is cold) kicks off from the effect — setter
  // can't reference itself in useState's initializer under TS strict.
  const [peaks, setPeaks] = useState<number[] | null>(() => peekPeaks(url));

  useEffect(() => {
    if (peaks !== null) return;
    const cached = getOrLoadPeaks(url, setPeaks);
    if (cached) setPeaks(cached);
    // peaks intentionally omitted from deps — we only kick off decode
    // on url change; the setter updates state directly otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
});
