import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useWaveform } from "../timeline/hooks/useWaveform.js";
import { WaveformBars } from "./WaveformBars.js";
import { LAYER_META, type LayerType } from "../overview/layerTypes.js";

export const LAYER_ORDER: LayerType[] = ["caption", "video", "audio"];

export interface ExplodedLayerProps {
  layerType: LayerType;
  zOffset: number;
  width: number;
  height: number;
  top: number;
  focused: boolean;
  onClick: () => void;
  captionText: string | null;
  frameBitmap: ImageBitmap | null;
  audioUrl: string | null;
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
  captionText,
  frameBitmap,
  audioUrl,
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: 10,
          fontWeight: 600,
          color: meta.color,
          opacity: 0.8,
          flexShrink: 0,
        }}
      >
        <span>{meta.icon}</span>
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {meta.label}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          padding: "0 10px 6px",
        }}
      >
        <LayerContent
          layerType={layerType}
          height={height - 28}
          width={width - 20}
          captionText={captionText}
          frameBitmap={frameBitmap}
          audioUrl={audioUrl}
        />
      </div>
    </motion.div>
  );
}

function LayerContent({
  layerType,
  height,
  width,
  captionText,
  frameBitmap,
  audioUrl,
}: {
  layerType: LayerType;
  height: number;
  width: number;
  captionText: string | null;
  frameBitmap: ImageBitmap | null;
  audioUrl: string | null;
}) {
  switch (layerType) {
    case "caption":
      return <CaptionContent text={captionText} height={height} />;
    case "video":
      return <VideoContent bitmap={frameBitmap} height={height} width={width} />;
    case "audio":
      return <AudioContent audioUrl={audioUrl} height={height} width={width} />;
  }
}

function CaptionContent({ text, height }: { text: string | null; height: number }) {
  if (!text) {
    return (
      <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>
        No caption
      </span>
    );
  }
  return (
    <div
      style={{
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
      }}
    >
      {text.replace(/\n/g, " ")}
    </div>
  );
}

function VideoContent({
  bitmap,
  height,
  width,
}: {
  bitmap: ImageBitmap | null;
  height: number;
  width: number;
}) {
  // Direct-draw path. Matches what PreviewRoot does — the upstream
  // engine's ImageBitmap goes straight into a local <canvas> via
  // ctx.drawImage. No JPEG encode + img decode round-trip, so this
  // stays in lockstep with the main preview instead of lagging.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!bitmap) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
  }, [bitmap, height, width]);

  if (!bitmap) {
    return (
      <div
        style={{
          color: "#52525b",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 20 }}>{"\uD83C\uDFAC"}</span>
        <span style={{ fontStyle: "italic" }}>Capturing frame...</span>
      </div>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      style={{
        height,
        width: "auto",
        maxWidth: "100%",
        borderRadius: 4,
        display: "block",
      }}
    />
  );
}

function AudioContent({
  audioUrl,
  height,
  width,
}: {
  audioUrl: string | null;
  height: number;
  width: number;
}) {
  const bars = Math.max(20, Math.floor(width / 3));
  const { waveform } = useWaveform(audioUrl ? { audioUrl, bars } : null);

  if (!audioUrl) {
    return (
      <span style={{ color: "#52525b", fontSize: 12, fontStyle: "italic" }}>
        No audio
      </span>
    );
  }
  if (!waveform) {
    return (
      <span style={{ color: "#52525b", fontSize: 11 }}>Loading waveform...</span>
    );
  }
  return (
    <WaveformBars
      peaks={waveform.peaks}
      height={Math.max(16, height - 4)}
      color="#38bdf8"
      stretch
    />
  );
}
