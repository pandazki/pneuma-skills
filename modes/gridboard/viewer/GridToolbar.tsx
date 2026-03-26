/**
 * GridToolbar — Fixed bottom bar for the GridBoard viewer.
 *
 * Displays board info on the left and toggle controls (grid lines, tile gallery)
 * on the right.
 */

import type { CSSProperties } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface BoardInfo {
  width: number;
  height: number;
  columns: number;
  rows: number;
  activeTiles: number;
  totalTiles: number;
}

interface GridToolbarProps {
  onToggleGallery: () => void;
  isGalleryOpen: boolean;
  onToggleGrid: () => void;
  showGrid: boolean;
  boardInfo: BoardInfo;
}

// ── Inline SVG Icons ─────────────────────────────────────────────────────────

const svgProps = {
  width: 13,
  height: 13,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const GridIcon = () => (
  <svg {...svgProps}>
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
);

const GalleryIcon = () => (
  <svg {...svgProps}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

// ── Styles ───────────────────────────────────────────────────────────────────

const toolbarStyle: CSSProperties = {
  height: 36,
  background: "rgba(24, 24, 27, 0.92)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderTop: "1px solid #27272a",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 12px",
  flexShrink: 0,
  userSelect: "none",
};

const infoStyle: CSSProperties = {
  color: "#52525b",
  fontSize: 11,
  letterSpacing: "0.01em",
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const separatorStyle: CSSProperties = {
  color: "#3f3f46",
  margin: "0 2px",
};

const controlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
};

function toggleBtnStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 8px",
    background: active ? "rgba(249, 115, 22, 0.1)" : "transparent",
    border: active ? "1px solid rgba(249, 115, 22, 0.4)" : "1px solid transparent",
    borderRadius: 5,
    color: active ? "#f97316" : "#71717a",
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
    letterSpacing: "0.02em",
  };
}

// ── GridToolbar ───────────────────────────────────────────────────────────────

export function GridToolbar({
  onToggleGallery,
  isGalleryOpen,
  onToggleGrid,
  showGrid,
  boardInfo,
}: GridToolbarProps) {
  const { width, height, columns, rows, activeTiles } = boardInfo;

  return (
    <div style={toolbarStyle}>
      {/* Left: Board info */}
      <div style={infoStyle}>
        <span>{width}&times;{height}</span>
        <span style={separatorStyle}>·</span>
        <span>{columns}&times;{rows} grid</span>
        <span style={separatorStyle}>·</span>
        <span>{activeTiles} {activeTiles === 1 ? "tile" : "tiles"}</span>
      </div>

      {/* Right: Toggle controls */}
      <div style={controlsStyle}>
        {/* Grid lines toggle */}
        <button
          style={toggleBtnStyle(showGrid)}
          onClick={onToggleGrid}
          aria-label={showGrid ? "Hide grid lines" : "Show grid lines"}
          aria-pressed={showGrid}
          onMouseEnter={(e) => {
            if (!showGrid) {
              (e.currentTarget as HTMLButtonElement).style.color = "#a1a1aa";
            }
          }}
          onMouseLeave={(e) => {
            if (!showGrid) {
              (e.currentTarget as HTMLButtonElement).style.color = "#71717a";
            }
          }}
        >
          <GridIcon />
          Grid
        </button>

        {/* Gallery toggle */}
        <button
          style={toggleBtnStyle(isGalleryOpen)}
          onClick={onToggleGallery}
          aria-label={isGalleryOpen ? "Close tile gallery" : "Open tile gallery"}
          aria-pressed={isGalleryOpen}
          onMouseEnter={(e) => {
            if (!isGalleryOpen) {
              (e.currentTarget as HTMLButtonElement).style.color = "#a1a1aa";
            }
          }}
          onMouseLeave={(e) => {
            if (!isGalleryOpen) {
              (e.currentTarget as HTMLButtonElement).style.color = "#71717a";
            }
          }}
        >
          <GalleryIcon />
          Gallery
        </button>
      </div>
    </div>
  );
}

export default GridToolbar;
