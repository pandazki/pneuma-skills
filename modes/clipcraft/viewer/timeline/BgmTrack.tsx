import { useMemo } from "react";
import type { BGMConfig } from "../../types.js";
import { useWorkspaceUrl } from "../hooks/useWorkspaceUrl.js";
import { useWaveform } from "./hooks/useWaveform.js";
import { WaveformBars } from "./WaveformBars.js";

const TRACK_H = 32;
const BAR_H = TRACK_H - 12;

interface Props {
  bgm: BGMConfig;
  totalDuration: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
}

export function BgmTrack({ bgm, totalDuration, pixelsPerSecond, scrollLeft, viewportWidth }: Props) {
  const urlFn = useWorkspaceUrl();

  // Two-phase: first get duration, then compute bars for real width.
  // useWaveform caches by URL so the audio is only decoded once.
  const { waveform: probe } = useWaveform(useMemo(
    () => ({ audioUrl: `/content/${bgm.source}`, bars: 1 }),
    [bgm.source],
  ));

  const bgmDuration = probe?.duration ?? totalDuration;
  const bgmWidth = bgmDuration * pixelsPerSecond;
  const barCount = Math.max(60, Math.round(bgmWidth / 3));

  const { waveform } = useWaveform(useMemo(
    () => ({ audioUrl: `/content/${bgm.source}`, bars: barCount }),
    [bgm.source, barCount],
  ));

  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: -scrollLeft,
          width: bgmWidth,
          height: TRACK_H - 4,
          top: 2,
          background: "#1e1033",
          borderRadius: 3,
          border: "1px solid #27272a",
          padding: "0 8px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            fontSize: 9,
            color: "#a78bfa",
            whiteSpace: "nowrap",
            flexShrink: 0,
            fontWeight: 500,
          }}
        >
          {"\u266A"} {bgm.title}
        </span>
        <div style={{ flex: 1, overflow: "hidden" }}>
          {waveform ? (
            <WaveformBars peaks={waveform.peaks} height={BAR_H} color="#6d28d9" />
          ) : (
            <FakeWaveform seed={bgm.title || "bgm"} bars={60} height={BAR_H} color="#6d28d9" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Fallback deterministic waveform while real one loads. */
function FakeWaveform({ seed, bars, height, color }: { seed: string; bars: number; height: number; color: string }) {
  const heights = useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    const out: number[] = [];
    for (let i = 0; i < bars; i++) {
      h = ((h << 5) - h + i * 7) | 0;
      out.push(0.2 + ((h >>> 0) % 100) / 100 * 0.8);
    }
    return out;
  }, [seed, bars]);

  return (
    <div style={{ display: "flex", alignItems: "center", height, gap: 1 }}>
      {heights.map((v, i) => (
        <div key={i} style={{ width: 2, height: Math.round(v * height), background: color, borderRadius: 1, flexShrink: 0 }} />
      ))}
    </div>
  );
}
