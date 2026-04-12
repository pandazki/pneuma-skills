// modes/clipcraft/viewer/timeline/overview/LayerToggle.tsx
import { motion } from "framer-motion";
import type { LayerType } from "../../store/types.js";

const LAYERS: { type: LayerType; icon: string; color: string; label: string }[] = [
  { type: "video",   icon: "\uD83C\uDFAC", color: "#eab308", label: "Video" },
  { type: "caption", icon: "Tt",            color: "#f97316", label: "Caption" },
  { type: "audio",   icon: "\uD83D\uDD0A",  color: "#38bdf8", label: "Audio" },
  { type: "bgm",     icon: "\u266A",        color: "#a78bfa", label: "BGM" },
];

interface Props {
  activeLayers: Set<LayerType>;
  onToggle: (layer: LayerType) => void;
  /** Layers that have no data (e.g. bgm when no bgm is set) */
  disabledLayers?: Set<LayerType>;
}

export function LayerToggle({ activeLayers, onToggle, disabledLayers }: Props) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      padding: "8px 0",
    }}>
      {LAYERS.map(({ type, icon, color, label }) => {
        const active = activeLayers.has(type);
        const disabled = disabledLayers?.has(type);

        return (
          <motion.button
            key={type}
            onClick={() => !disabled && onToggle(type)}
            title={label}
            animate={{
              height: active ? 40 : 24,
              opacity: disabled ? 0.3 : 1,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            style={{
              width: 28,
              borderRadius: 14,
              border: "none",
              background: active ? `${color}25` : "#18181b",
              outline: `1px solid ${active ? color + "50" : "#27272a"}`,
              color: active ? color : "#52525b",
              cursor: disabled ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Glow dot when active */}
            {active && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                style={{
                  position: "absolute",
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: color,
                  boxShadow: `0 0 8px ${color}`,
                  top: 4,
                }}
              />
            )}
            <span style={{ marginTop: active ? 10 : 0, transition: "margin 0.2s" }}>
              {icon}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
