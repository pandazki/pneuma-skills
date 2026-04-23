import { useMemo } from "react";
import { motion } from "framer-motion";
import type { LayerType } from "../../store/types.js";
import { useWaveform } from "../hooks/useWaveform.js";
import { WaveformBars } from "../WaveformBars.js";

/** Color/metadata per layer type — matches existing LAYER_META from Layer3D */
const LAYER_META: Record<LayerType, { label: string; icon: string; color: string }> = {
  caption: { label: "Caption", icon: "Tt", color: "#f97316" },
  video:   { label: "Video",   icon: "🎬", color: "#eab308" },
  audio:   { label: "Audio",   icon: "🔊", color: "#38bdf8" },
  bgm:     { label: "BGM",     icon: "♪",  color: "#a78bfa" },
};

/** Layer ordering for z-index (front to back) */
export const LAYER_ORDER: LayerType[] = ["caption", "video", "audio", "bgm"];

export interface ExplodedLayerProps {
  layerType: LayerType;
  zOffset: number;
  /** Layer width in px */
  width: number;
  /** Layer height in px */
  height: number;
  /** Vertical offset from top of the 3D scene */
  top: number;
  /** Whether this layer is the scroll-focused one */
  focused: boolean;
  onClick: () => void;
  // Content data
  /** Current scene caption text (for caption layer) */
  caption: string | null;
  /** Current video frame data URL (for video layer) */
  frameUrl: string | null;
  /** TTS audio URL for current scene (for audio layer) */
  ttsAudioUrl: string | null;
  /** BGM audio URL (for bgm layer) */
  bgmAudioUrl: string | null;
  /** Current playhead time as fraction of total BGM duration (0-1) */
  bgmTimeFraction: number;
  /** Total BGM duration in seconds */
  bgmDuration: number;
}

const SPRING = { type: "spring" as const, stiffness: 150, damping: 25 };

export function ExplodedLayer({
  layerType,
  zOffset,
  width,
  height,
  top,
  focused,
  onClick,
  caption,
  frameUrl,
  ttsAudioUrl,
  bgmAudioUrl,
  bgmTimeFraction,
  bgmDuration,
}: ExplodedLayerProps) {
  const meta = LAYER_META[layerType];

  return (
    <motion.div
      layout
      animate={{ z: zOffset, y: top, scale: focused ? 1.0 : 0.95 }}
      transition={SPRING}
      onClick={onClick}
      whileHover={{ scale: focused ? 1.02 : 0.97 }}
      style={{
        position: "absolute",
        left: "50%",
        width,
        height,
        marginLeft: -width / 2,
        transformStyle: "flat",
        cursor: "pointer",
        background: "rgba(9, 9, 11, 0.85)",
        border: `1px solid ${meta.color}${focused ? "80" : "40"}`,
        borderRadius: 8,
        boxShadow: focused
          ? `0 0 20px ${meta.color}25, 0 0 4px ${meta.color}15`
          : `0 0 12px ${meta.color}10`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Layer label */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        fontSize: 10,
        fontWeight: 600,
        color: meta.color,
        opacity: 0.8,
        flexShrink: 0,
      }}>
        <span>{meta.icon}</span>
        <span style={{ fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {meta.label}
        </span>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: "0 10px 6px" }}>
        <LayerContent
          layerType={layerType}
          height={height - 28}
          width={width - 20}
          caption={caption}
          frameUrl={frameUrl}
          ttsAudioUrl={ttsAudioUrl}
          bgmAudioUrl={bgmAudioUrl}
          bgmTimeFraction={bgmTimeFraction}
          bgmDuration={bgmDuration}
        />
      </div>
    </motion.div>
  );
}

// ── Per-type content rendering ──────────────────────────────────────────────

function LayerContent({
  layerType,
  height,
  width,
  caption,
  frameUrl,
  ttsAudioUrl,
  bgmAudioUrl,
  bgmTimeFraction,
  bgmDuration,
}: {
  layerType: LayerType;
  height: number;
  width: number;
  caption: string | null;
  frameUrl: string | null;
  ttsAudioUrl: string | null;
  bgmAudioUrl: string | null;
  bgmTimeFraction: number;
  bgmDuration: number;
}) {
  switch (layerType) {
    case "caption":
      return <CaptionContent caption={caption} height={height} />;
    case "video":
      return <VideoContent frameUrl={frameUrl} height={height} />;
    case "audio":
      return <AudioContent audioUrl={ttsAudioUrl} height={height} width={width} />;
    case "bgm":
      return <BgmContent audioUrl={bgmAudioUrl} height={height} width={width} timeFraction={bgmTimeFraction} duration={bgmDuration} />;
  }
}

function CaptionContent({ caption, height }: { caption: string | null; height: number }) {
  if (!caption) {
    return <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>No caption</span>;
  }
  return (
    <div style={{
      color: "#e4e4e7",
      fontSize: Math.min(16, Math.max(11, height * 0.25)),
      fontFamily: "'Inter', system-ui, sans-serif",
      fontWeight: 400,
      textAlign: "center",
      lineHeight: 1.4,
      padding: "0 8px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      width: "100%",
    }}>
      {caption.replace(/\n/g, " ")}
    </div>
  );
}

function VideoContent({ frameUrl, height }: { frameUrl: string | null; height: number }) {
  if (!frameUrl) {
    return (
      <div style={{ color: "#52525b", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 20 }}>🎬</span>
        <span style={{ fontStyle: "italic" }}>Capturing frame...</span>
      </div>
    );
  }
  return (
    <img
      src={frameUrl}
      alt="Current frame"
      style={{
        maxHeight: height,
        maxWidth: "100%",
        objectFit: "contain",
        borderRadius: 4,
      }}
    />
  );
}

function AudioContent({ audioUrl, height, width }: { audioUrl: string | null; height: number; width: number }) {
  const bars = Math.max(20, Math.floor(width / 3));
  const { waveform } = useWaveform(audioUrl ? { audioUrl, bars } : null);

  if (!audioUrl) {
    return <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>No TTS audio</span>;
  }

  if (!waveform) {
    return <span style={{ color: "#52525b", fontSize: 11 }}>Loading waveform...</span>;
  }

  return (
    <WaveformBars peaks={waveform.peaks} height={Math.max(16, height - 4)} color="#38bdf8" stretch />
  );
}

function BgmContent({
  audioUrl,
  height,
  width,
  timeFraction,
  duration,
}: {
  audioUrl: string | null;
  height: number;
  width: number;
  timeFraction: number;
  duration: number;
}) {
  // Decode full BGM, then window a 10s slice centered on current time
  const totalBars = Math.max(40, Math.floor(width / 3));
  // We need enough bars to cover the full duration so we can slice a window
  const barsPerSecond = duration > 0 ? totalBars / 10 : 4; // 10s window
  const fullBars = Math.max(totalBars, Math.ceil(duration * barsPerSecond));
  const { waveform } = useWaveform(audioUrl ? { audioUrl, bars: fullBars } : null);

  // useMemo must be called unconditionally (Rules of Hooks)
  const windowPeaks = useMemo(() => {
    if (!waveform) return [];
    const peaks = waveform.peaks;
    const centerIdx = Math.floor(timeFraction * peaks.length);
    const halfWindow = Math.floor(totalBars / 2);
    const start = Math.max(0, centerIdx - halfWindow);
    const end = Math.min(peaks.length, start + totalBars);
    const actualStart = Math.max(0, end - totalBars);
    return peaks.slice(actualStart, end);
  }, [waveform?.peaks, timeFraction, totalBars]);

  if (!audioUrl) {
    return <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>No BGM</span>;
  }

  if (!waveform) {
    return <span style={{ color: "#52525b", fontSize: 11 }}>Loading waveform...</span>;
  }

  return (
    <div style={{ width: "100%", position: "relative" }}>
      <WaveformBars peaks={windowPeaks} height={Math.max(16, height - 4)} color="#a78bfa" stretch />
      {/* Playhead indicator line at center */}
      <div style={{
        position: "absolute",
        left: "50%",
        top: 0,
        bottom: 0,
        width: 1,
        background: "#a78bfa",
        opacity: 0.6,
        pointerEvents: "none",
      }} />
    </div>
  );
}
