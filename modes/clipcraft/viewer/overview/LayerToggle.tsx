import { motion } from "framer-motion";
import type { LayerType } from "./layerTypes.js";

const LAYERS: { type: LayerType; icon: string; color: string; label: string }[] = [
  { type: "video",   icon: "\uD83C\uDFAC", color: "#eab308", label: "Video" },
  { type: "caption", icon: "Tt",            color: "#f97316", label: "Caption" },
  { type: "audio",   icon: "\uD83D\uDD0A",  color: "#38bdf8", label: "Audio" },
];

interface Props {
  activeLayers: Set<LayerType>;
  onToggle: (layer: LayerType) => void;
  disabledLayers?: Set<LayerType>;
  /** When rendered by the ExplodedView, this is the layer currently
   *  at the front of the 3D carousel. The matching pill gets an extra
   *  halo + brighter fill to mirror the 3D focus. Overview views leave
   *  this undefined and all pills render in their plain active/inactive
   *  state. */
  focusedLayer?: LayerType | null;
}

export function LayerToggle({ activeLayers, onToggle, disabledLayers, focusedLayer }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 0" }}>
      {LAYERS.map(({ type, icon, color, label }) => {
        const active = activeLayers.has(type);
        const disabled = disabledLayers?.has(type);
        const focused = focusedLayer === type && active;
        const height = focused ? 52 : active ? 40 : 24;
        const width = focused ? 34 : 28;
        return (
          <motion.button
            key={type}
            onClick={() => !disabled && onToggle(type)}
            title={focused ? `${label} · in front` : label}
            animate={{
              height,
              width,
              opacity: disabled ? 0.3 : 1,
              boxShadow: focused
                ? `0 0 14px ${color}60, 0 0 4px ${color}40, inset 0 0 8px ${color}30`
                : "0 0 0 rgba(0,0,0,0)",
            }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            style={{
              borderRadius: focused ? 17 : 14,
              border: "none",
              background: focused
                ? `linear-gradient(135deg, ${color}50, ${color}20)`
                : active
                ? `${color}25`
                : "#18181b",
              outline: focused
                ? `1px solid ${color}`
                : active
                ? `1px solid ${color}50`
                : "1px solid #27272a",
              color: active ? color : "#52525b",
              cursor: disabled ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: focused ? 13 : 11,
              fontWeight: 600,
              flexShrink: 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {active && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: focused ? 1.3 : 1 }}
                style={{
                  position: "absolute",
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: color,
                  boxShadow: focused ? `0 0 12px ${color}, 0 0 4px ${color}` : `0 0 8px ${color}`,
                  top: focused ? 5 : 4,
                }}
              />
            )}
            <span style={{ marginTop: active ? (focused ? 14 : 10) : 0, transition: "margin 0.2s" }}>
              {icon}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
