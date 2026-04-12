// modes/clipcraft/viewer/timeline/ExpandButton.tsx
import { motion } from "framer-motion";

interface Props {
  mode: "collapsed" | "overview" | "dive";
  onToggle: () => void;
}

export function ExpandButton({ mode, onToggle }: Props) {
  const isExpanded = mode !== "collapsed";

  return (
    <motion.button
      onClick={onToggle}
      title={isExpanded ? "Collapse timeline" : "Expand to 3D overview"}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      style={{
        position: "relative",
        width: 28,
        height: 28,
        border: "none",
        borderRadius: 6,
        background: isExpanded ? "#27272a" : "transparent",
        color: "#e4e4e7",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        zIndex: 1,
      }}
    >
      {/* Glow border — only in collapsed mode */}
      {!isExpanded && <GlowBorder />}

      {/* Icon */}
      <motion.svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        animate={{ rotate: isExpanded ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        {/* Expand/collapse chevron */}
        <path d="M4 10L8 6L12 10" />
      </motion.svg>
    </motion.button>
  );
}

/** Animated conic-gradient border that rotates continuously. */
function GlowBorder() {
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: -1,
          borderRadius: 7,
          padding: 1,
          background: "conic-gradient(from var(--glow-angle, 0deg), #f97316, #a855f7, #3b82f6, #10b981, #f97316)",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          animation: "glowSpin 3s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -4,
          borderRadius: 10,
          background: "conic-gradient(from var(--glow-angle, 0deg), rgba(249,115,22,0.3), rgba(168,85,247,0.3), rgba(59,130,246,0.3), rgba(16,185,129,0.3), rgba(249,115,22,0.3))",
          filter: "blur(6px)",
          animation: "glowSpin 3s linear infinite",
          zIndex: -1,
        }}
      />
      <style>{`
        @property --glow-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes glowSpin {
          to { --glow-angle: 360deg; }
        }
      `}</style>
    </>
  );
}
