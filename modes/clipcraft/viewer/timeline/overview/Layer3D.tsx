// modes/clipcraft/viewer/timeline/overview/Layer3D.tsx
import { useMemo } from "react";
import { motion } from "framer-motion";
import type { Scene, BGMConfig } from "../../../types.js";
import { useFrameExtractor } from "../hooks/useFrameExtractor.js";
import { useWaveform } from "../hooks/useWaveform.js";

export type LayerType = "caption" | "video" | "audio" | "bgm";

const LAYER_META: Record<LayerType, { label: string; icon: string; color: string; bg: string }> = {
  video:   { label: "Video",   icon: "\uD83C\uDFAC", color: "#eab308", bg: "rgba(234,179,8,0.04)" },
  caption: { label: "Caption", icon: "Tt",            color: "#f97316", bg: "rgba(249,115,22,0.04)" },
  audio:   { label: "Audio",   icon: "\uD83D\uDD0A",  color: "#38bdf8", bg: "rgba(56,189,248,0.04)" },
  bgm:     { label: "BGM",     icon: "\u266A",        color: "#a78bfa", bg: "rgba(167,139,250,0.04)" },
};

interface Props {
  layerType: LayerType;
  zOffset: number;
  yPosition: number;
  heightPx: number;
  rotateX: number;
  scenes: Scene[];
  bgm: BGMConfig | null;
  totalDuration: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
  selectedSceneId: string | null;
  selected: boolean;
  onSelect: () => void;
  onDive: () => void;
  playheadX: number;
}

export function Layer3D(props: Props) {
  const {
    layerType, zOffset, yPosition, heightPx, rotateX,
    scenes, bgm, totalDuration, pixelsPerSecond, scrollLeft,
    viewportWidth, selectedSceneId, selected, onSelect, onDive, playheadX,
  } = props;
  const meta = LAYER_META[layerType];

  return (
    <motion.div
      onClick={onSelect}
      onDoubleClick={onDive}
      animate={{ z: zOffset, y: yPosition, rotateX, opacity: selected ? 1 : 0.75 }}
      transition={{ type: "spring", stiffness: 180, damping: 24 }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: heightPx,
        transformStyle: "preserve-3d",
        cursor: "pointer",
        borderRadius: 8,
        willChange: "transform",
        background: meta.bg,
        border: `1px solid ${meta.color}${selected ? "40" : "15"}`,
        boxShadow: selected ? `0 0 20px ${meta.color}25` : "0 1px 6px rgba(0,0,0,0.25)",
      }}
    >
      {/* Label */}
      <div style={{
        position: "absolute", left: 8, top: 6, fontSize: 10, zIndex: 10,
        color: meta.color, fontWeight: 600, opacity: 0.85,
        textShadow: "0 1px 3px rgba(0,0,0,0.9)",
      }}>
        {meta.icon} {meta.label}
      </div>

      {/* Content — flat context to prevent 3D distortion of inner elements */}
      <div style={{
        position: "absolute", inset: 0,
        transformStyle: "flat",
        overflow: "hidden",
        borderRadius: 8,
      }}>
        {layerType === "video" && (
          <VideoLayerContent
            scenes={scenes} totalDuration={totalDuration} height={heightPx}
            pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
            selectedSceneId={selectedSceneId}
          />
        )}
        {layerType === "caption" && (
          <CaptionLayerContent
            scenes={scenes} totalDuration={totalDuration} height={heightPx}
            pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
            selectedSceneId={selectedSceneId}
          />
        )}
        {layerType === "audio" && (
          <AudioLayerContent
            scenes={scenes} totalDuration={totalDuration} height={heightPx}
            pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
            selectedSceneId={selectedSceneId}
          />
        )}
        {layerType === "bgm" && bgm && (
          <BgmLayerContent bgm={bgm} totalDuration={totalDuration} height={heightPx}
            pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft}
          />
        )}
      </div>

      {/* Playhead — CSS transition for smooth playback */}
      {playheadX >= -10 && playheadX <= viewportWidth + 10 && (
        <div style={{
          position: "absolute", left: playheadX, top: 0, bottom: 0,
          width: 2, marginLeft: -1, background: "#f97316",
          boxShadow: "0 0 8px rgba(249,115,22,0.6)", pointerEvents: "none", zIndex: 5,
          transition: "left 100ms linear",
          willChange: "left",
        }} />
      )}
    </motion.div>
  );
}

// ── Video: large frame thumbnails filling the height ─────────────────────────

function VideoLayerContent({ scenes, totalDuration, height, pixelsPerSecond, scrollLeft, selectedSceneId }: {
  scenes: Scene[]; totalDuration: number; height: number;
  pixelsPerSecond: number; scrollLeft: number; selectedSceneId: string | null;
}) {
  const frameH = height - 8;
  let offset = 0;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 4px" }}>
      {scenes.map((scene) => {
        const x = offset * pixelsPerSecond - scrollLeft;
        const w = scene.duration * pixelsPerSecond;
        offset += scene.duration;
        if (x + w < -10 || x > 3000) return null;

        return (
          <VideoClip3D
            key={scene.id}
            scene={scene}
            x={x}
            w={w}
            frameH={frameH}
            pixelsPerSecond={pixelsPerSecond}
            selected={scene.id === selectedSceneId}
          />
        );
      })}
    </div>
  );
}

/** Per-scene video clip with its own frame extraction. */
function VideoClip3D({ scene, x, w, frameH, pixelsPerSecond, selected }: {
  scene: Scene; x: number; w: number; frameH: number;
  pixelsPerSecond: number; selected: boolean;
}) {
  const source = scene.visual?.source;
  const thumb = scene.visual?.thumbnail || source;
  const isVideo = source?.match(/\.(mp4|webm|mov)$/i);
  const status = scene.visual?.status ?? "pending";

  const frameInterval = pixelsPerSecond >= 150 ? 0.25 : pixelsPerSecond >= 60 ? 0.5 : pixelsPerSecond >= 30 ? 1 : 2;

  const frameOpts = useMemo(() => {
    if (status !== "ready" || !source || !isVideo) return null;
    return {
      videoUrl: `/content/${source}`,
      duration: scene.duration,
      frameInterval,
      frameHeight: frameH,
    };
  }, [status, source, isVideo, scene.duration, frameInterval, frameH]);

  const { frames } = useFrameExtractor(frameOpts);

  return (
    <div style={{
      position: "absolute", left: x, width: w - 2, height: frameH,
      borderRadius: 4, overflow: "hidden",
      border: selected ? "1px solid rgba(249,115,22,0.4)" : "1px solid rgba(255,255,255,0.06)",
      background: "#0a0a0a",
    }}>
      {status === "ready" && isVideo && frames.length > 0 ? (
        <div style={{ display: "flex", height: "100%", alignItems: "center", overflow: "hidden" }}>
          {(() => {
            const aspect = frames[0].width / frames[0].height;
            const naturalW = frameH * aspect;
            const clipW = w - 2;
            const visibleCount = Math.max(1, Math.ceil(clipW / naturalW));
            const step = Math.max(1, frames.length / visibleCount);
            const picked = [];
            for (let i = 0; i < visibleCount && i * step < frames.length; i++) {
              picked.push(frames[Math.min(Math.floor(i * step), frames.length - 1)]);
            }
            const tileW = clipW / picked.length;
            return picked.map((f, i) => (
              <img key={i} src={f.dataUrl} alt="" style={{
                height: frameH, width: tileW, objectFit: "cover", flexShrink: 0,
              }} />
            ));
          })()}
        </div>
      ) : status === "ready" && thumb ? (
        <img src={`/content/${thumb}`} alt="" style={{
          width: "100%", height: "100%", objectFit: "cover",
        }} />
      ) : status === "generating" ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", color: "#a16207", fontSize: 12 }}>
          ⏳ generating
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", color: "#27272a", fontSize: 12 }}>—</div>
      )}
    </div>
  );
}

// ── Caption: readable text cards ─────────────────────────────────────────────

function CaptionLayerContent({ scenes, totalDuration, height, pixelsPerSecond, scrollLeft, selectedSceneId }: {
  scenes: Scene[]; totalDuration: number; height: number;
  pixelsPerSecond: number; scrollLeft: number; selectedSceneId: string | null;
}) {
  const dur = Math.max(totalDuration, 1);
  let offset = 0;

  return (
    <div style={{ position: "absolute", inset: 0, padding: "4px" }}>
      {scenes.map((scene) => {
        const x = offset * pixelsPerSecond - scrollLeft;
        const w = scene.duration * pixelsPerSecond;
        offset += scene.duration;
        if (x + w < -10 || x > 3000) return null;

        const sel = scene.id === selectedSceneId;
        return (
          <div key={scene.id} style={{
            position: "absolute", left: x, width: w - 2, top: 4, bottom: 4,
            borderRadius: 4, overflow: "hidden",
            background: sel ? "#2d2519" : "#1a1a1e",
            border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
            padding: "6px 10px",
            display: "flex", alignItems: "center",
          }}>
            <span style={{
              fontSize: Math.min(13, height * 0.3),
              color: scene.caption ? (sel ? "#e4e4e7" : "#a1a1aa") : "#3f3f46",
              lineHeight: "1.4",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {scene.caption ?? "No caption"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Audio: tall waveform bars ────────────────────────────────────────────────

function AudioLayerContent({ scenes, totalDuration, height, pixelsPerSecond, scrollLeft, selectedSceneId }: {
  scenes: Scene[]; totalDuration: number; height: number;
  pixelsPerSecond: number; scrollLeft: number; selectedSceneId: string | null;
}) {
  const barH = height - 12;
  let offset = 0;

  return (
    <div style={{ position: "absolute", inset: 0, padding: "4px" }}>
      {scenes.map((scene) => {
        const x = offset * pixelsPerSecond - scrollLeft;
        const w = scene.duration * pixelsPerSecond;
        offset += scene.duration;
        if (x + w < -10 || x > 3000) return null;

        const hasAudio = scene.audio?.status === "ready";
        const sel = scene.id === selectedSceneId;

        return (
          <div key={scene.id} style={{
            position: "absolute", left: x, width: w - 2, top: 4, bottom: 4,
            borderRadius: 4, overflow: "hidden",
            background: sel ? "#1a1e2a" : "#111318",
            border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #1e2030",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 1, padding: "0 4px",
          }}>
            {hasAudio ? (
              <FakeWaveform seed={scene.id} bars={Math.max(10, Math.floor(w / 5))}
                height={barH} color={sel ? "#38bdf8" : "#1e3a5f"} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── BGM: full-width waveform with title ──────────────────────────────────────

function BgmLayerContent({ bgm, totalDuration, height, pixelsPerSecond, scrollLeft }: {
  bgm: BGMConfig; totalDuration: number; height: number;
  pixelsPerSecond: number; scrollLeft: number;
}) {
  const barH = height - 16;

  const waveOpts = useMemo(
    () => ({ audioUrl: `/content/${bgm.source}`, bars: Math.max(20, Math.floor((totalDuration * pixelsPerSecond) / 5)) }),
    [bgm.source, totalDuration, pixelsPerSecond],
  );
  const { waveform } = useWaveform(waveOpts);

  // Show real BGM duration, not clipped to project
  const bgmDuration = waveform?.duration ?? totalDuration;
  const bgmWidth = bgmDuration * pixelsPerSecond;

  return (
    <div style={{
      position: "absolute", left: -scrollLeft + 4, top: 4, bottom: 4,
      width: bgmWidth - 8, borderRadius: 4,
      background: "#1a1028", border: "1px solid #27203a",
      display: "flex", alignItems: "center", gap: 10, padding: "0 10px",
      overflow: "hidden",
    }}>
      <span style={{
        fontSize: 11, color: "#a78bfa", whiteSpace: "nowrap", flexShrink: 0, fontWeight: 500,
      }}>
        ♪ {bgm.title ?? "BGM"}
      </span>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {waveform ? (
          <div style={{ display: "flex", alignItems: "center", height: barH, gap: 1 }}>
            {waveform.peaks.map((v, i) => (
              <div key={i} style={{
                width: 3, height: Math.max(2, Math.round(v * barH)),
                background: "#6d28d9", borderRadius: 1.5, flexShrink: 0,
              }} />
            ))}
          </div>
        ) : (
          <FakeWaveform seed={bgm.title || "bgm"} bars={Math.max(20, Math.floor(bgmWidth / 5))} height={barH} color="#6d28d9" />
        )}
      </div>
    </div>
  );
}

// ── Shared: deterministic fake waveform ──────────────────────────────────────

function FakeWaveform({ seed, bars, height, color }: {
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
