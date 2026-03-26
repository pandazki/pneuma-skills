/**
 * TileSlot — Shadow DOM container for a single GridBoard tile.
 *
 * Provides CSS isolation via Shadow DOM while allowing theme CSS variables
 * (which penetrate shadow boundaries) to style tile content.
 *
 * Uses createPortal to render into the Shadow DOM mount point,
 * keeping everything in the same React tree (avoids separate createRoot lifecycle issues).
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TileDefinition } from "./tile-compiler.js";

// ── Error Boundary for tile render errors ───────────────────────────────────

class TileErrorBoundary extends React.Component<
  { tileId: string; children: React.ReactNode; onError?: (tileId: string, error: Error) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { this.props.onError?.(this.props.tileId, error); }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 16, color: "var(--error, #ef4444)", fontSize: 12,
          fontFamily: "var(--font-mono, monospace)",
          background: "var(--tile-bg, rgba(24,24,27,0.85))",
          width: "100%", height: "100%", overflow: "auto",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Render Error</div>
          {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface TileSlotProps {
  tileId: string;
  definition: TileDefinition | null;
  compilationError?: string;
  data: unknown;
  loading: boolean;
  error: Error | null;
  width: number;
  height: number;
  themeCSS: string;
  isSelected: boolean;
  isResizing: boolean;
  onSelect: (tileId: string) => void;
  onRenderError?: (tileId: string, error: Error) => void;
  onRemove?: (tileId: string) => void;
}

// ── Resize Handle Directions ─────────────────────────────────────────────────

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface HandleConfig {
  dir: ResizeDirection;
  style: React.CSSProperties;
  cursor: string;
}

const RESIZE_HANDLES: HandleConfig[] = [
  { dir: "n", cursor: "n-resize", style: { top: -4, left: "10%", width: "80%", height: 8 } },
  { dir: "s", cursor: "s-resize", style: { bottom: -4, left: "10%", width: "80%", height: 8 } },
  { dir: "e", cursor: "e-resize", style: { right: -4, top: "10%", width: 8, height: "80%" } },
  { dir: "w", cursor: "w-resize", style: { left: -4, top: "10%", width: 8, height: "80%" } },
  { dir: "ne", cursor: "ne-resize", style: { top: -4, right: -4, width: 12, height: 12 } },
  { dir: "nw", cursor: "nw-resize", style: { top: -4, left: -4, width: 12, height: 12 } },
  { dir: "se", cursor: "se-resize", style: { bottom: -4, right: -4, width: 12, height: 12 } },
  { dir: "sw", cursor: "sw-resize", style: { bottom: -4, left: -4, width: 12, height: 12 } },
];

// ── Main Component ──────────────────────────────────────────────────────────

export default function TileSlot({
  tileId,
  definition,
  compilationError,
  data,
  loading,
  error,
  width,
  height,
  themeCSS,
  isSelected,
  isResizing,
  onSelect,
  onRenderError,
  onRemove,
}: TileSlotProps) {
  const HEADER_HEIGHT = 32;
  const contentWidth = width;
  const contentHeight = height - HEADER_HEIGHT;

  // Shadow DOM refs
  const shadowContainerRef = useRef<HTMLDivElement>(null);
  const [mountTarget, setMountTarget] = useState<HTMLElement | null>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const themeStyleRef = useRef<HTMLStyleElement | null>(null);

  // ── Shadow DOM Setup (once) ──────────────────────────────────────────────

  useEffect(() => {
    const container = shadowContainerRef.current;
    if (!container || shadowRef.current) return;

    const shadow = container.attachShadow({ mode: "open" });
    shadowRef.current = shadow;

    // Keyframe animations
    const keyframesStyle = document.createElement("style");
    keyframesStyle.textContent = `
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    `;
    shadow.appendChild(keyframesStyle);

    // Theme CSS style element
    const themeStyle = document.createElement("style");
    themeStyle.dataset.role = "theme";
    shadow.appendChild(themeStyle);
    themeStyleRef.current = themeStyle;

    // Mount div for React portal
    const mountDiv = document.createElement("div");
    mountDiv.style.cssText = "width:100%;height:100%;overflow:hidden;position:relative;";
    shadow.appendChild(mountDiv);

    setMountTarget(mountDiv);
  }, []);

  // ── Update theme CSS ──────────────────────────────────────────────────────

  useEffect(() => {
    if (themeStyleRef.current) {
      themeStyleRef.current.textContent = themeCSS;
    }
  }, [themeCSS]);

  // ── Render tile content via portal ────────────────────────────────────────

  let tileContent: React.ReactNode = null;

  if (!definition) {
    // Skeleton placeholder while compiling
    tileContent = (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted, #52525b)",
          fontSize: 12,
          fontFamily: "var(--font-family, sans-serif)",
          background: "var(--tile-bg, rgba(24,24,27,0.85))",
        }}
      >
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 20, height: 20,
              border: "2px solid rgba(255,255,255,0.2)",
              borderTopColor: "var(--accent, #f97316)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span>Compiling…</span>
        </div>
      </div>
    );
  } else {
    // Render as a proper React component so hooks (useState, useEffect) work inside tiles.
    // Build params from definition defaults.
    const params: Record<string, unknown> = {};
    if (definition.params) {
      for (const [k, v] of Object.entries(definition.params)) params[k] = v.default;
    }
    const RenderFn = definition.render as React.FC<{
      data: unknown; width: number; height: number; loading: boolean; error: Error | null; params: Record<string, unknown>;
    }>;
    tileContent = (
      <TileErrorBoundary tileId={tileId} onError={onRenderError}>
        <RenderFn data={data} width={contentWidth} height={contentHeight} loading={loading} error={error} params={params} />
      </TileErrorBoundary>
    );
  }

  // ── Border Color ──────────────────────────────────────────────────────────

  const borderColor = isSelected
    ? "#f97316"
    : compilationError
      ? "var(--error, #ef4444)"
      : "var(--tile-border, rgba(255,255,255,0.08))";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "var(--tile-radius, 10px)",
        border: `1.5px solid ${borderColor}`,
        background: "var(--tile-bg, rgba(24,24,27,0.85))",
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
        transition: "border-color 0.15s ease",
      }}
      onClick={() => onSelect(tileId)}
      onMouseEnter={(e) => {
        if (!isSelected && !compilationError) {
          (e.currentTarget as HTMLDivElement).style.borderColor =
            "var(--tile-border-hover, rgba(249,115,22,0.4))";
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected && !compilationError) {
          (e.currentTarget as HTMLDivElement).style.borderColor =
            "var(--tile-border, rgba(255,255,255,0.08))";
        }
      }}
    >
      {/* ── Title Bar (drag handle) ─────────────────────────────────────── */}
      <div
        data-drag-handle
        style={{
          height: HEADER_HEIGHT,
          minHeight: HEADER_HEIGHT,
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
          paddingRight: 8,
          cursor: "grab",
          borderBottom: "1px solid var(--tile-border, rgba(255,255,255,0.08))",
          background: "rgba(9,9,11,0.4)",
          flexShrink: 0,
        }}
      >
        <span style={{ marginRight: 8, color: "var(--text-muted, #52525b)", fontSize: 10, letterSpacing: 1, lineHeight: 1 }}>
          ⠿
        </span>
        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-family, -apple-system, sans-serif)",
            color: "var(--text-secondary, #a1a1aa)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {definition?.label ?? tileId}
        </span>
        {loading && (
          <span
            style={{
              marginLeft: 6, width: 6, height: 6, borderRadius: "50%",
              background: "var(--accent, #f97316)", display: "inline-block",
              animation: "pulse 1.2s ease-in-out infinite",
            }}
          />
        )}
        {/* Remove button — visible when selected */}
        {isSelected && onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(tileId); }}
            style={{
              marginLeft: 4, width: 20, height: 20, borderRadius: 4, border: "none",
              background: "transparent", color: "var(--text-muted, #52525b)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, lineHeight: 1, padding: 0,
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "var(--error, #ef4444)"; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "var(--text-muted, #52525b)"; }}
            title="Remove from board"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Shadow DOM content area ───────────────────────────────────────── */}
      <div
        ref={shadowContainerRef}
        style={{ flex: 1, overflow: "hidden", position: "relative" }}
      />

      {/* Portal tile content into Shadow DOM */}
      {mountTarget && createPortal(tileContent, mountTarget)}

      {/* ── Compilation Error Overlay ─────────────────────────────────────── */}
      {compilationError && (
        <div
          style={{
            position: "absolute", inset: 0, top: HEADER_HEIGHT,
            background: "rgba(9,9,11,0.88)",
            display: "flex", flexDirection: "column", padding: 14, gap: 8, overflow: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            fontSize: 11, fontWeight: 600, color: "var(--error, #ef4444)",
            fontFamily: "var(--font-family, sans-serif)",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            Compilation Error
          </div>
          <pre style={{
            fontSize: 11, fontFamily: "var(--font-mono, monospace)",
            color: "rgba(239,68,68,0.85)", margin: 0,
            whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5,
          }}>
            {compilationError}
          </pre>
        </div>
      )}

      {/* ── Resizing Overlay ──────────────────────────────────────────────── */}
      {isResizing && (
        <div
          style={{
            position: "absolute", inset: 0,
            background: "var(--overlay-bg, rgba(9,9,11,0.72))",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
            pointerEvents: "none",
          }}
        >
          <div style={{
            width: 20, height: 20,
            border: "2px solid rgba(255,255,255,0.2)",
            borderTopColor: "var(--accent, #f97316)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <span style={{
            fontSize: 12, color: "var(--text-secondary, #a1a1aa)",
            fontFamily: "var(--font-family, sans-serif)",
          }}>
            Resizing…
          </span>
        </div>
      )}

      {/* ── Resize Handles (only when selected) ───────────────────────────── */}
      {isSelected &&
        RESIZE_HANDLES.map(({ dir, style, cursor }) => (
          <div
            key={dir}
            data-resize-handle
            data-resize-direction={dir}
            style={{
              position: "absolute",
              ...style,
              cursor,
              background: "var(--accent, #f97316)",
              borderRadius: 2,
              opacity: 0.85,
              zIndex: 10,
              pointerEvents: "all",
            }}
          />
        ))}

      {/* Keyframe animations for light DOM */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
