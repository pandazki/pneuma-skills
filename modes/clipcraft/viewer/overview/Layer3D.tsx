import { motion } from "framer-motion";
import type { Track } from "@pneuma-craft/timeline";
import { LAYER_META, type LayerType } from "./layerTypes.js";
import { VideoLayerContent } from "./VideoLayerContent.js";
import { CaptionLayerContent } from "./CaptionLayerContent.js";
import { AudioLayerContent } from "./AudioLayerContent.js";

interface Props {
  layerType: LayerType;
  tracks: Track[];
  zOffset: number;
  yPosition: number;
  heightPx: number;
  rotateX: number;
  totalDuration: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
  selectedClipId: string | null;
  selected: boolean;
  onSelect: () => void;
  onDive: () => void;
  playheadX: number;
}

export function Layer3D(props: Props) {
  const {
    layerType, tracks, zOffset, yPosition, heightPx, rotateX,
    totalDuration, pixelsPerSecond, scrollLeft,
    viewportWidth, selectedClipId, selected, onSelect, onDive, playheadX,
  } = props;
  const meta = LAYER_META[layerType];

  return (
    <motion.div
      onClick={onSelect}
      onDoubleClick={onDive}
      animate={{ z: zOffset, y: yPosition, rotateX, opacity: selected ? 1 : 0.75 }}
      transition={{ type: "spring", stiffness: 180, damping: 24 }}
      style={{
        position: "absolute", top: 0, left: 0, right: 0, height: heightPx,
        transformStyle: "preserve-3d", cursor: "pointer", borderRadius: 8,
        willChange: "transform",
        background: meta.bg,
        border: `1px solid ${meta.color}${selected ? "40" : "15"}`,
        boxShadow: selected ? `0 0 20px ${meta.color}25` : "0 1px 6px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{
        position: "absolute", left: 8, top: 6, fontSize: 10, zIndex: 10,
        color: meta.color, fontWeight: 600, opacity: 0.85,
        textShadow: "0 1px 3px rgba(0,0,0,0.9)",
      }}>
        {meta.icon} {meta.label}
      </div>

      <div style={{
        position: "absolute", inset: 0, transformStyle: "flat",
        overflow: "hidden", borderRadius: 8,
      }}>
        {layerType === "video" && (
          <VideoLayerContent
            tracks={tracks} totalDuration={totalDuration} height={heightPx}
            pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
            selectedClipId={selectedClipId}
          />
        )}
        {layerType === "caption" && (
          <CaptionLayerContent
            tracks={tracks} totalDuration={totalDuration} height={heightPx}
            pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
            selectedClipId={selectedClipId}
          />
        )}
        {layerType === "audio" && (
          <AudioLayerContent
            tracks={tracks} totalDuration={totalDuration} height={heightPx}
            pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
            selectedClipId={selectedClipId}
          />
        )}
      </div>

      {playheadX >= -10 && playheadX <= viewportWidth + 10 && (
        <div style={{
          position: "absolute", left: playheadX, top: 0, bottom: 0,
          width: 2, marginLeft: -1, background: "#f97316",
          boxShadow: "0 0 8px rgba(249,115,22,0.6)",
          pointerEvents: "none", zIndex: 5,
          transition: "left 100ms linear", willChange: "left",
        }} />
      )}
    </motion.div>
  );
}
