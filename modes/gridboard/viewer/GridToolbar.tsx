/**
 * GridToolbar — Fixed bottom bar for the GridBoard viewer.
 * Shows board info on the left, Grid lines toggle + Gallery toggle on the right.
 */

import type { CSSProperties } from "react";

interface GridToolbarProps {
  onToggleGallery: () => void;
  isGalleryOpen: boolean;
  onToggleGrid: () => void;
  showGrid: boolean;
  boardInfo: { width: number; height: number; columns: number; rows: number; activeTiles: number };
}

const svgProps = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const GridIcon = () => (
  <svg {...svgProps}><rect x="3" y="3" width="18" height="18" rx="1" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
);
const GalleryIcon = () => (
  <svg {...svgProps}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
);

function btnStyle(active: boolean): CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 5, padding: "4px 8px",
    background: active ? "rgba(249,115,22,0.1)" : "transparent",
    border: active ? "1px solid rgba(249,115,22,0.4)" : "1px solid transparent",
    borderRadius: 5, color: active ? "#f97316" : "#71717a",
    fontSize: 11, fontWeight: active ? 600 : 400, cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  };
}

export function GridToolbar({ onToggleGallery, isGalleryOpen, onToggleGrid, showGrid, boardInfo }: GridToolbarProps) {
  const { width, height, columns, rows, activeTiles } = boardInfo;
  return (
    <div style={{
      height: 36, background: "rgba(24,24,27,0.92)", backdropFilter: "blur(8px)",
      borderTop: "1px solid #27272a", display: "flex", alignItems: "center",
      justifyContent: "space-between", padding: "0 12px", flexShrink: 0, userSelect: "none",
    }}>
      <div style={{ color: "#52525b", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
        <span>{width}×{height}</span>
        <span style={{ color: "#3f3f46" }}>·</span>
        <span>{columns}×{rows} grid</span>
        <span style={{ color: "#3f3f46" }}>·</span>
        <span>{activeTiles} {activeTiles === 1 ? "tile" : "tiles"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button onClick={onToggleGrid} aria-pressed={showGrid} style={btnStyle(showGrid)}><GridIcon />Grid</button>
        <button onClick={onToggleGallery} aria-pressed={isGalleryOpen} style={btnStyle(isGalleryOpen)}><GalleryIcon />Gallery</button>
      </div>
    </div>
  );
}

export default GridToolbar;
