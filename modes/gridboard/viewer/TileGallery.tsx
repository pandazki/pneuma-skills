/**
 * TileGallery — Slide-in panel showing tiles not currently on the board.
 *
 * Displays available and disabled tiles with options to add them back to the board
 * or create new ones via an agent command.
 */

import React, { useState, useRef, useEffect, type CSSProperties } from "react";
import type { TileDefinition } from "./tile-compiler.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface GalleryTile {
  tileId: string;
  label: string;
  description: string;
  status: "available" | "disabled";
  minSize?: { cols: number; rows: number };
  component: string;
  definition?: TileDefinition | null;
}

interface TileGalleryProps {
  isOpen: boolean;
  onClose: () => void;
  tiles: Map<string, GalleryTile>;
  onAddTile: (tileId: string) => void;
  onCreateTile: (description: string) => void;
}

// ── Inline SVG Icons ─────────────────────────────────────────────────────────

const svgProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const CloseIcon = () => (
  <svg {...svgProps}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const PlusIcon = () => (
  <svg {...svgProps}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const LayoutGridIcon = () => (
  <svg {...svgProps}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

// ── Styles ───────────────────────────────────────────────────────────────────

const panelStyle = (isOpen: boolean): CSSProperties => ({
  width: 280,
  minWidth: 280,
  height: "100%",
  background: "rgba(24, 24, 27, 0.97)",
  borderLeft: "1px solid #27272a",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  flexShrink: 0,
  marginRight: isOpen ? 0 : -280,
  transition: "margin-right 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
});

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: "1px solid #27272a",
  flexShrink: 0,
};

const titleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#fafafa",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.01em",
};

const closeBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#71717a",
  padding: 4,
  borderRadius: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "color 0.15s",
};

const bodyStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const createBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  padding: "8px 12px",
  background: "#f97316",
  border: "none",
  borderRadius: 6,
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: "0.02em",
  transition: "background 0.15s",
  marginBottom: 4,
};

const sectionLabelStyle: CSSProperties = {
  color: "#52525b",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 2px 2px",
};

const emptyStateStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  color: "#52525b",
  fontSize: 12,
  textAlign: "center",
  padding: "32px 16px",
};

// ── TileCard ─────────────────────────────────────────────────────────────────

interface TileCardProps {
  tile: GalleryTile;
  onAdd: (tileId: string) => void;
}

function TileCard({ tile, onAdd }: TileCardProps) {
  const cardStyle: CSSProperties = {
    background: "#27272a",
    border: "1px solid #3f3f46",
    borderRadius: 8,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    transition: "border-color 0.15s, background 0.15s",
  };

  const labelRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  };

  const labelStyle: CSSProperties = {
    color: "#fafafa",
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const badgeRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap" as const,
  };

  const disabledBadgeStyle: CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: "#a1a1aa",
    background: "#3f3f46",
    borderRadius: 4,
    padding: "2px 6px",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  };

  const sizeBadgeStyle: CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    color: "#71717a",
    background: "#1c1c1f",
    borderRadius: 4,
    padding: "2px 6px",
    border: "1px solid #3f3f46",
  };

  const descStyle: CSSProperties = {
    color: "#a1a1aa",
    fontSize: 11,
    lineHeight: 1.5,
  };

  const addBtnStyle: CSSProperties = {
    alignSelf: "flex-start",
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 10px",
    background: "transparent",
    border: "1px solid #f97316",
    borderRadius: 5,
    color: "#f97316",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.02em",
    transition: "background 0.15s, color 0.15s",
    marginTop: 2,
  };

  // Mini preview: render the tile component at small size
  const RenderFn = tile.definition?.render as React.FC<any> | undefined;

  return (
    <div style={cardStyle}>
      {/* Mini preview */}
      {RenderFn && (
        <div style={{
          width: "100%", height: 80, borderRadius: 6, overflow: "hidden",
          background: "#18181b", border: "1px solid #27272a",
          pointerEvents: "none", position: "relative",
        }}>
          <MiniPreviewBoundary>
            <RenderFn data={null} width={256} height={80} loading={false} error={null} params={
              tile.definition?.params
                ? Object.fromEntries(Object.entries(tile.definition.params).map(([k, v]) => [k, v.default]))
                : {}
            } />
          </MiniPreviewBoundary>
        </div>
      )}
      <div style={labelRowStyle}>
        <span style={labelStyle}>{tile.label}</span>
        <div style={badgeRowStyle}>
          {tile.status === "disabled" && (
            <span style={disabledBadgeStyle}>disabled</span>
          )}
          {tile.minSize && (
            <span style={sizeBadgeStyle}>
              {tile.minSize.cols}&times;{tile.minSize.rows}
            </span>
          )}
        </div>
      </div>
      {tile.description && (
        <p style={descStyle}>{tile.description}</p>
      )}
      <button
        style={addBtnStyle}
        onClick={() => onAdd(tile.tileId)}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "#f97316";
          (e.currentTarget as HTMLButtonElement).style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "#f97316";
        }}
      >
        <PlusIcon />
        Add to Board
      </button>
    </div>
  );
}

// ── TileGallery ───────────────────────────────────────────────────────────────

export function TileGallery({ isOpen, onClose, tiles, onAddTile, onCreateTile }: TileGalleryProps) {
  const tileList = Array.from(tiles.values());
  const available = tileList.filter((t) => t.status === "available");
  const disabled = tileList.filter((t) => t.status === "disabled");
  const isEmpty = tileList.length === 0;

  const [showCreateInput, setShowCreateInput] = useState(false);
  const [createText, setCreateText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea when shown
  useEffect(() => {
    if (showCreateInput) inputRef.current?.focus();
  }, [showCreateInput]);

  const handleSubmitCreate = () => {
    const text = createText.trim();
    if (!text) return;
    onCreateTile(text);
    setCreateText("");
    setShowCreateInput(false);
  };

  return (
    <div style={panelStyle(isOpen)} aria-hidden={!isOpen}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>
          <LayoutGridIcon />
          Tile Gallery
        </div>
        <button
          style={closeBtnStyle}
          onClick={onClose}
          aria-label="Close gallery"
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#fafafa";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#71717a";
          }}
        >
          <CloseIcon />
        </button>
      </div>

      {/* Body */}
      <div style={bodyStyle}>
        {/* Create New Tile */}
        {!showCreateInput ? (
          <button
            style={createBtnStyle}
            onClick={() => setShowCreateInput(true)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#ea6c0a";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#f97316";
            }}
          >
            <PlusIcon />
            Create New Tile
          </button>
        ) : (
          <div style={{
            display: "flex", flexDirection: "column", gap: 6,
            background: "#27272a", border: "1px solid #f97316", borderRadius: 8, padding: 10,
          }}>
            <textarea
              ref={inputRef}
              value={createText}
              onChange={(e) => setCreateText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmitCreate(); }
                if (e.key === "Escape") { setShowCreateInput(false); setCreateText(""); }
              }}
              placeholder="Describe the tile you want..."
              rows={2}
              style={{
                width: "100%", resize: "none", background: "#18181b", color: "#fafafa",
                border: "1px solid #3f3f46", borderRadius: 6, padding: "8px 10px",
                fontSize: 12, lineHeight: 1.5, fontFamily: "inherit", outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setShowCreateInput(false); setCreateText(""); }}
                style={{
                  padding: "5px 10px", background: "transparent", border: "1px solid #3f3f46",
                  borderRadius: 5, color: "#71717a", fontSize: 11, fontWeight: 500, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitCreate}
                disabled={!createText.trim()}
                style={{
                  padding: "5px 10px", background: createText.trim() ? "#f97316" : "#3f3f46",
                  border: "none", borderRadius: 5, color: "#fff", fontSize: 11,
                  fontWeight: 600, cursor: createText.trim() ? "pointer" : "default",
                  transition: "background 0.15s",
                }}
              >
                Create
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div style={emptyStateStyle}>
            <LayoutGridIcon />
            <span>No tiles available.</span>
            <span style={{ color: "#71717a" }}>Create one to get started!</span>
          </div>
        )}

        {/* Available tiles */}
        {available.length > 0 && (
          <>
            <div style={sectionLabelStyle}>Available</div>
            {available.map((tile) => (
              <TileCard key={tile.tileId} tile={tile} onAdd={onAddTile} />
            ))}
          </>
        )}

        {/* Disabled tiles */}
        {disabled.length > 0 && (
          <>
            <div style={{ ...sectionLabelStyle, marginTop: available.length > 0 ? 8 : 0 }}>
              Disabled
            </div>
            {disabled.map((tile) => (
              <TileCard key={tile.tileId} tile={tile} onAdd={onAddTile} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Mini Preview Error Boundary ──────────────────────────────────────────

class MiniPreviewBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#52525b", fontSize: 10 }}>
          Preview unavailable
        </div>
      );
    }
    return this.props.children;
  }
}

export default TileGallery;
