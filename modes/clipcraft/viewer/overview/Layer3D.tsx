import { motion } from "framer-motion";
import type { Track } from "@pneuma-craft/timeline";
import { LAYER_META, type LayerType } from "./layerTypes.js";
import { VideoLayerContent } from "./VideoLayerContent.js";
import { CaptionLayerContent } from "./CaptionLayerContent.js";
import { AudioLayerContent } from "./AudioLayerContent.js";
import { theme } from "../theme/tokens.js";

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
    layerType,
    tracks,
    zOffset,
    yPosition,
    heightPx,
    rotateX,
    totalDuration,
    pixelsPerSecond,
    scrollLeft,
    viewportWidth,
    selectedClipId,
    selected,
    onSelect,
    onDive,
    playheadX,
  } = props;
  const meta = LAYER_META[layerType];
  const Icon = meta.Icon;

  return (
    <motion.div
      onClick={onSelect}
      onDoubleClick={onDive}
      animate={{ z: zOffset, y: yPosition, rotateX, opacity: selected ? 1 : 0.78 }}
      transition={{ type: "tween", duration: 0.38, ease: [0.2, 0.8, 0.2, 1] }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: heightPx,
        transformStyle: "preserve-3d",
        cursor: "pointer",
        borderRadius: theme.radius.md,
        willChange: "transform",
        background: meta.colorSoft,
        border: `1px solid ${selected ? meta.colorBorder : theme.color.borderWeak}`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: theme.space.space3,
          top: theme.space.space2,
          zIndex: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: theme.space.space2,
          color: meta.color,
          fontFamily: theme.font.ui,
          fontSize: theme.text.xs,
          fontWeight: theme.text.weightSemibold,
          letterSpacing: theme.text.trackingCaps,
          textTransform: "uppercase",
          opacity: 0.92,
        }}
      >
        <Icon size={12} />
        <span>{meta.label}</span>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          transformStyle: "flat",
          overflow: "hidden",
          borderRadius: theme.radius.md,
        }}
      >
        {layerType === "video" && (
          <VideoLayerContent
            tracks={tracks}
            totalDuration={totalDuration}
            height={heightPx}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            selectedClipId={selectedClipId}
          />
        )}
        {layerType === "caption" && (
          <CaptionLayerContent
            tracks={tracks}
            totalDuration={totalDuration}
            height={heightPx}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            selectedClipId={selectedClipId}
          />
        )}
        {layerType === "audio" && (
          <AudioLayerContent
            tracks={tracks}
            totalDuration={totalDuration}
            height={heightPx}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            selectedClipId={selectedClipId}
          />
        )}
      </div>

      {playheadX >= -10 && playheadX <= viewportWidth + 10 && (
        <div
          style={{
            position: "absolute",
            left: playheadX,
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: theme.color.playhead,
            pointerEvents: "none",
            zIndex: 5,
            transition: "left 100ms linear",
            willChange: "left",
          }}
        />
      )}
    </motion.div>
  );
}
