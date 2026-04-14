import { motion } from "framer-motion";
import { LAYER_META, type LayerType } from "./layerTypes.js";
import { theme } from "../theme/tokens.js";

const LAYER_ORDER: LayerType[] = ["video", "caption", "audio"];

interface Props {
  activeLayers: Set<LayerType>;
  onToggle: (layer: LayerType) => void;
  disabledLayers?: Set<LayerType>;
  /**
   * When rendered by the ExplodedView, this is the layer currently
   * at the front of the 3D carousel. The matching pill grows + uses
   * a brighter fill to mirror the 3D focus. Overview views leave
   * this undefined and all pills render in their plain
   * active/inactive state.
   */
  focusedLayer?: LayerType | null;
}

export function LayerToggle({
  activeLayers,
  onToggle,
  disabledLayers,
  focusedLayer,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: theme.space.space2,
        padding: `${theme.space.space2}px 0`,
      }}
    >
      {LAYER_ORDER.map((type) => {
        const { label, Icon, color, colorSoft, colorBorder } = LAYER_META[type];
        const active = activeLayers.has(type);
        const disabled = disabledLayers?.has(type);
        const focused = focusedLayer === type && active;
        const height = focused ? 56 : active ? 44 : 28;
        const width = focused ? 36 : active ? 32 : 28;
        return (
          <motion.button
            key={type}
            type="button"
            onClick={() => !disabled && onToggle(type)}
            title={focused ? `${label} · in front` : label}
            aria-pressed={active}
            animate={{
              height,
              width,
              opacity: disabled ? 0.3 : 1,
            }}
            transition={{
              type: "tween",
              duration: 0.22,
              ease: [0.2, 0.8, 0.2, 1],
            }}
            style={{
              borderRadius: theme.radius.md,
              border: focused
                ? `1px solid ${color}`
                : active
                  ? `1px solid ${colorBorder}`
                  : `1px solid ${theme.color.borderWeak}`,
              background: focused
                ? colorSoft
                : active
                  ? colorSoft
                  : theme.color.surface1,
              color: active ? color : theme.color.ink4,
              cursor: disabled ? "default" : "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: focused || active ? "space-between" : "center",
              padding: focused || active ? `${theme.space.space1}px 0` : 0,
              flexShrink: 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {(focused || active) && (
              <motion.span
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{
                  scale: focused ? 1.1 : 1,
                  opacity: focused ? 1 : 0.85,
                }}
                transition={{
                  type: "tween",
                  duration: 0.22,
                  ease: [0.2, 0.8, 0.2, 1],
                }}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: theme.radius.pill,
                  background: color,
                  display: "block",
                }}
              />
            )}
            <Icon size={focused ? 16 : 14} />
          </motion.button>
        );
      })}
    </div>
  );
}
