/**
 * IllustratePreview — Infinite canvas viewer powered by @xyflow/react (React Flow).
 *
 * Architecture:
 * - React Flow provides pan/zoom/drag/selection/minimap/fitView out of the box
 * - Each image is a custom "imageCard" node placed at world coordinates
 * - Rows are auto-laid out; new rows appear at the bottom
 * - Modes: view (browse+drag), select (pick for agent), annotate (feedback)
 * - Double-click image → detail overlay with zoom/pan
 * - Highlighter canvas overlay for freehand region selection
 */

import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useReactFlow,
  useViewport,
  ReactFlowProvider,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnNodesChange,
  type NodeMouseHandler,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { useResilientParse } from "../../../core/hooks/use-resilient-parse.js";
import { useStore } from "../../../src/store.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ManifestItem {
  file: string;
  title: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  style?: string;
  tags?: string[];
  createdAt?: string;
  status?: "generating" | "ready";
}

interface ManifestRow {
  id: string;
  label: string;
  items: ManifestItem[];
}

interface IllustrateManifest {
  title: string;
  description?: string;
  rows: ManifestRow[];
}

interface ImageNodeData {
  item: ManifestItem;
  rowId: string;
  rowLabel: string;
  contentSet: string | null;
  imageVersion: number;
  isAnnotated: boolean;
  mode: string;
  [key: string]: unknown;
}

interface SelectedImageInfo {
  item: ManifestItem;
  rowLabel: string;
  rowId: string;
  rowIndex: number;
  rowCount: number;
  itemIndex: number;
  itemCount: number;
}

interface ToastMessage {
  id: number;
  text: string;
}

// ── Dark theme overrides for React Flow controls/minimap ─────────────────────

const RF_DARK_OVERRIDES = `
.react-flow {
  --xy-controls-button-background-color-default: #27272a;
  --xy-controls-button-background-color-hover-default: #3f3f46;
  --xy-controls-button-color-default: #a1a1aa;
  --xy-controls-button-color-hover-default: #fafafa;
  --xy-controls-button-border-color-default: rgba(63, 63, 70, 0.5);
  --xy-controls-box-shadow-default: 0 2px 8px rgba(0,0,0,0.4);
  --xy-minimap-background-color-default: rgba(0,0,0,0.6);
  --xy-minimap-mask-background-color-default: rgba(0,0,0,0.7);
  --xy-minimap-mask-stroke-color-default: rgba(63,63,70,0.5);
  --xy-minimap-node-background-color-default: #f97316;
  --xy-minimap-node-stroke-color-default: transparent;
  --xy-background-color-default: #0a0a0c;
  --xy-background-pattern-dots-color-default: rgba(255,255,255,0.05);
  --xy-node-background-color-default: transparent;
  --xy-node-border-default: none;
  --xy-node-boxshadow-hover-default: none;
  --xy-node-boxshadow-selected-default: none;
}
.react-flow__controls-button svg {
  fill: currentColor !important;
}
`;

// ── Constants ────────────────────────────────────────────────────────────────

const NODE_HEIGHT = 260;
const ROW_GAP = 100;
const ROW_LABEL_HEIGHT = 40;
const ITEM_GAP = 24;

const COLORS = {
  bg: "#0a0a0c",
  surface: "rgba(24, 24, 27, 0.9)",
  surfaceSolid: "#18181b",
  border: "rgba(63, 63, 70, 0.5)",
  text: "#fafafa",
  textMuted: "#a1a1aa",
  textDim: "#71717a",
  primary: "#f97316",
  primaryDim: "rgba(249, 115, 22, 0.15)",
  selectRing: "#3b82f6",
  annotateRing: "#a855f7",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseManifest(
  files: { path: string; content: string }[],
): { data: IllustrateManifest | null; file?: string } {
  const mf = files.find(
    (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
  );
  if (!mf) return { data: null };
  // Let JSON.parse throw — useResilientParse catches it
  return { data: JSON.parse(mf.content) as IllustrateManifest, file: mf.path };
}

function aspectToRatio(aspect?: string): number {
  if (!aspect) return 1;
  const parts = aspect.split(":");
  if (parts.length !== 2) return 1;
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  return w && h ? w / h : 1;
}

function getImageUrl(file: string, contentSet: string | null, imageVersion: number): string {
  const prefix = contentSet ? `${contentSet}/` : "";
  return `/content/${prefix}${file}?v=${imageVersion}`;
}

/** Convert manifest rows into React Flow nodes. */
function manifestToNodes(
  manifest: IllustrateManifest,
  contentSet: string | null,
  imageVersion: number,
  annotatedFiles: Set<string>,
  mode: string,
): Node<ImageNodeData>[] {
  const nodes: Node<ImageNodeData>[] = [];
  let cursorY = 0;

  for (const row of manifest.rows) {
    // Row label node
    nodes.push({
      id: `row-label-${row.id}`,
      type: "rowLabel",
      position: { x: 0, y: cursorY },
      data: {
        item: { file: "", title: row.label, prompt: "" },
        rowId: row.id,
        rowLabel: row.label,
        contentSet,
        imageVersion,
        isAnnotated: false,
        mode,
        itemCount: row.items.length,
      },
      selectable: false,
      draggable: false,
    });

    cursorY += ROW_LABEL_HEIGHT;
    let cursorX = 0;

    for (const item of row.items) {
      const ratio = aspectToRatio(item.aspectRatio);
      const w = Math.round(NODE_HEIGHT * ratio);

      nodes.push({
        id: item.file,
        type: "imageCard",
        position: { x: cursorX, y: cursorY },
        data: {
          item,
          rowId: row.id,
          rowLabel: row.label,
          contentSet,
          imageVersion,
          isAnnotated: annotatedFiles.has(item.file),
          mode,
        },
        style: { width: w, height: NODE_HEIGHT },
      });

      cursorX += w + ITEM_GAP;
    }

    cursorY += NODE_HEIGHT + ROW_GAP;
  }

  return nodes;
}

let toastCounter = 0;

// ── Row Label Node ───────────────────────────────────────────────────────────

const RowLabelNode = memo(({ data }: NodeProps<Node<ImageNodeData>>) => {
  const count = (data as any).itemCount ?? 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      pointerEvents: "none", whiteSpace: "nowrap", height: ROW_LABEL_HEIGHT,
      paddingBottom: 4,
    }}>
      <span style={{ color: COLORS.textMuted, fontSize: 14, fontWeight: 500 }}>
        {data.rowLabel}
      </span>
      <span style={{ color: COLORS.textDim, fontSize: 12 }}>
        {count} {count === 1 ? "image" : "images"}
      </span>
    </div>
  );
});

// ── Image Card Node ──────────────────────────────────────────────────────────

const SHIMMER_KEYFRAMES = `
@keyframes illustrate-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes illustrate-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
`;

const ImageCardNode = memo(({ data, selected }: NodeProps<Node<ImageNodeData>>) => {
  const [hovered, setHovered] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const { item, contentSet, imageVersion, isAnnotated, mode } = data;
  const isGenerating = item.status === "generating";

  // Reset error state when image version changes (new image generated)
  useEffect(() => { setErrored(false); setLoaded(false); }, [imageVersion]);

  const ringColor = mode === "annotate" ? COLORS.annotateRing : mode === "select" ? COLORS.selectRing : COLORS.primary;

  return (
    <div
      style={{
        width: "100%", height: "100%", borderRadius: 8, overflow: "hidden",
        position: "relative", cursor: isGenerating ? "default" : mode === "view" ? "grab" : "crosshair",
        outline: selected ? `2px solid ${ringColor}` : isGenerating ? `1px dashed ${COLORS.primary}55` : "none",
        outlineOffset: 3,
        boxShadow: selected
          ? `0 0 0 1px ${ringColor}40, 0 8px 32px ${COLORS.bg}`
          : hovered && !isGenerating
            ? `0 4px 20px rgba(0,0,0,0.5)`
            : `0 2px 12px rgba(0,0,0,0.3)`,
        transition: "box-shadow 0.15s, outline 0.1s",
        background: COLORS.surfaceSolid,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <style dangerouslySetInnerHTML={{ __html: SHIMMER_KEYFRAMES }} />

      {/* Generating placeholder */}
      {isGenerating ? (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 10,
          background: `linear-gradient(135deg, ${COLORS.surfaceSolid} 0%, #1c1c20 50%, ${COLORS.surfaceSolid} 100%)`,
          backgroundSize: "200% 100%",
          animation: "illustrate-shimmer 2.5s ease-in-out infinite",
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "illustrate-pulse 2s ease-in-out infinite" }}>
            <path d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
          </svg>
          <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 500 }}>Generating…</div>
          <div style={{
            color: COLORS.textDim, fontSize: 11, maxWidth: "80%", textAlign: "center",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {item.title}
          </div>
        </div>
      ) : (
        <>
          {/* Loading / not-generated placeholder */}
          {!loaded && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 6,
              background: `linear-gradient(135deg, ${COLORS.surfaceSolid} 0%, #27272a 100%)`,
            }}>
              {errored ? (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.textDim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <div style={{ color: COLORS.textDim, fontSize: 11 }}>Not yet generated</div>
                  <div style={{ color: COLORS.textDim, fontSize: 10, maxWidth: "80%", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                </>
              ) : (
                <div style={{ color: COLORS.textDim, fontSize: 12 }}>Loading…</div>
              )}
            </div>
          )}

          <img
            src={getImageUrl(item.file, contentSet, imageVersion)}
            alt={item.title}
            draggable={false}
            loading="lazy"
            onLoad={() => { setLoaded(true); setErrored(false); }}
            onError={() => setErrored(true)}
            style={{
              width: "100%", height: "100%", objectFit: "cover",
              opacity: loaded && !errored ? 1 : 0, transition: "opacity 0.3s", display: "block",
            }}
          />

          {/* Hover overlay */}
          {hovered && loaded && (
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(transparent 40%, rgba(0,0,0,0.75) 100%)",
              display: "flex", flexDirection: "column", justifyContent: "flex-end",
              padding: 10, pointerEvents: "none",
            }}>
              <div style={{
                color: COLORS.text, fontSize: 13, fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                textShadow: "0 1px 3px rgba(0,0,0,0.8)",
              }}>
                {item.title}
              </div>
              {item.aspectRatio && (
                <div style={{ color: COLORS.textDim, fontSize: 11, marginTop: 2 }}>
                  {item.aspectRatio}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Selection dimension label (Figma-style) */}
      {selected && !isGenerating && (
        <div style={{
          position: "absolute", bottom: -22, left: "50%", transform: "translateX(-50%)",
          background: ringColor, color: "#fff", fontSize: 10, fontWeight: 500,
          padding: "1px 6px", borderRadius: 3, whiteSpace: "nowrap", lineHeight: 1.4,
        }}>
          {item.aspectRatio || "1:1"}
        </div>
      )}

      {/* Annotation badge */}
      {isAnnotated && !isGenerating && (
        <div style={{
          position: "absolute", top: -6, right: -6,
          width: 18, height: 18, borderRadius: "50%",
          background: COLORS.annotateRing, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, color: "#fff", fontWeight: 700,
          boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
        }}>
          ✎
        </div>
      )}
    </div>
  );
});

// ── Node types (MUST be defined outside component) ───────────────────────────

const nodeTypes: NodeTypes = {
  imageCard: ImageCardNode,
  rowLabel: RowLabelNode,
};

// ── Image Detail Overlay ─────────────────────────────────────────────────────

function ImageDetail({
  item, contentSet, imageVersion, onClose, onCopyPrompt, onDownload,
}: {
  item: ManifestItem; contentSet: string | null; imageVersion: number;
  onClose: () => void; onCopyPrompt: () => void; onDownload: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showInfo, setShowInfo] = useState(false);
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [item.file]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "i" || e.key === "I") setShowInfo((v) => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ color: COLORS.text, fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
          {item.style && <span style={{ color: COLORS.textDim, fontSize: 11, padding: "1px 6px", background: COLORS.primaryDim, borderRadius: 4 }}>{item.style}</span>}
          {item.aspectRatio && <span style={{ color: COLORS.textDim, fontSize: 11 }}>{item.aspectRatio}</span>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {[
            { label: `${Math.round(zoom * 100)}%`, onClick: () => { setZoom(1); setPan({ x: 0, y: 0 }); } },
            { label: "Info", onClick: () => setShowInfo(!showInfo), active: showInfo },
            { label: "Prompt", onClick: onCopyPrompt },
            { label: "Download", onClick: onDownload },
            { label: "Close", onClick: onClose },
          ].map((btn) => (
            <button key={btn.label} onClick={btn.onClick} style={{ background: btn.active ? COLORS.primaryDim : "transparent", color: btn.active ? COLORS.primary : COLORS.textMuted, border: `1px solid ${btn.active ? COLORS.primary : "transparent"}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>{btn.label}</button>
          ))}
        </div>
      </div>

      {/* Image */}
      <div
        style={{ flex: 1, overflow: "hidden", cursor: isDragging.current ? "grabbing" : "grab", position: "relative" }}
        onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.min(8, Math.max(0.1, z * (e.deltaY > 0 ? 0.9 : 1.1)))); }}
        onPointerDown={(e) => { if (e.button !== 0) return; isDragging.current = true; lastPos.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!isDragging.current) return; setPan((p) => ({ x: p.x + e.clientX - lastPos.current.x, y: p.y + e.clientY - lastPos.current.y })); lastPos.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={() => { isDragging.current = false; }}
      >
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`, transformOrigin: "center center" }}>
          <img src={getImageUrl(item.file, contentSet, imageVersion)} alt={item.title} draggable={false} style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 4, userSelect: "none" }} />
        </div>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div style={{ position: "absolute", right: 16, top: 60, width: 320, maxHeight: "calc(100vh - 100px)", overflow: "auto", background: COLORS.surfaceSolid, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, zIndex: 60, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
          {[
            { l: "Title", v: item.title },
            { l: "Prompt", v: item.prompt, mono: true },
            { l: "Aspect Ratio", v: item.aspectRatio },
            { l: "Resolution", v: item.resolution },
            { l: "Style", v: item.style },
            { l: "Tags", v: item.tags?.join(", ") },
            { l: "Created", v: item.createdAt ? new Date(item.createdAt).toLocaleString() : undefined },
            { l: "File", v: item.file, mono: true },
          ].filter((r) => r.v).map((r) => (
            <div key={r.l} style={{ marginBottom: 10 }}>
              <div style={{ color: COLORS.textDim, fontSize: 11, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>{r.l}</div>
              <div style={{ color: COLORS.text, fontSize: 13, fontFamily: r.mono ? "monospace" : "inherit", wordBreak: "break-word", lineHeight: 1.4 }}>{r.v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Annotation Popover ───────────────────────────────────────────────────────

function AnnotationPopover({
  style, label, onConfirm, onCancel,
}: {
  style: React.CSSProperties; label?: string;
  onConfirm: (comment: string) => void; onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  return (
    <div
      style={{ position: "fixed", ...style, zIndex: 100, background: COLORS.surfaceSolid, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 12, minWidth: 260, maxWidth: 340, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {label && <div style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 6 }}>{label}</div>}
      <textarea
        ref={inputRef} value={comment} onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (comment.trim()) onConfirm(comment.trim()); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        placeholder="Add feedback… (Enter to confirm)" rows={2}
        style={{ width: "100%", background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 13, resize: "none", outline: "none", fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ background: "transparent", color: COLORS.textMuted, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
        <button onClick={() => comment.trim() && onConfirm(comment.trim())} style={{ background: COLORS.primary, color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer", opacity: comment.trim() ? 1 : 0.5 }}>Add</button>
      </div>
    </div>
  );
}

// ── Toast ────────────────────────────────────────────────────────────────────

function ToastContainer({ toasts }: { toasts: ToastMessage[] }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 200, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
      {toasts.map((t) => (
        <div key={t.id} style={{ background: COLORS.surfaceSolid, color: COLORS.text, padding: "8px 16px", borderRadius: 8, fontSize: 13, border: `1px solid ${COLORS.border}`, boxShadow: "0 4px 16px rgba(0,0,0,0.4)" }}>{t.text}</div>
      ))}
    </div>
  );
}

// ── Toolbar Icons ─────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
    </svg>
  );
}

function AnnotateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

// ── Canvas Toolbar ────────────────────────────────────────────────────────────

type PreviewMode = "view" | "select" | "annotate";

function CanvasToolbar({
  previewMode,
  onSetPreviewMode,
  imageCount,
  rowCount,
  selectionCount,
  readonly,
}: {
  previewMode: string;
  onSetPreviewMode: (mode: PreviewMode) => void;
  imageCount: number;
  rowCount: number;
  selectionCount?: number;
  readonly?: boolean;
}) {
  const modes: { value: PreviewMode; label: string; icon: React.ReactNode }[] = [
    { value: "view", label: "View", icon: <EyeIcon /> },
    { value: "select", label: "Select", icon: <CursorIcon /> },
    { value: "annotate", label: "Annotate", icon: <AnnotateIcon /> },
  ];

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "4px 12px", borderBottom: `1px solid ${COLORS.border}`,
      background: `${COLORS.surfaceSolid}cc`, backdropFilter: "blur(8px)",
      flexShrink: 0, minHeight: 36, zIndex: 10,
    }}>
      {/* Left: info */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: COLORS.textDim, fontSize: 11 }}>
          {rowCount} {rowCount === 1 ? "row" : "rows"} · {imageCount} {imageCount === 1 ? "image" : "images"}
        </span>
        {selectionCount != null && selectionCount > 0 && (
          <span style={{
            fontSize: 11, padding: "1px 8px", borderRadius: 10,
            background: `${COLORS.selectRing}25`, color: COLORS.selectRing,
            fontWeight: 500,
          }}>
            {selectionCount} selected
          </span>
        )}
      </div>

      {/* Right: mode toggle — hidden in readonly (replay) mode */}
      {!readonly && <div style={{ display: "flex", alignItems: "center", gap: 2, background: `${COLORS.bg}99`, borderRadius: 6, padding: 2 }}>
        {modes.map((m) => {
          const isActive = previewMode === m.value;
          return (
            <button
              key={m.value}
              onClick={() => onSetPreviewMode(m.value)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 8px", borderRadius: 4, border: "none",
                background: isActive ? `${COLORS.primary}33` : "transparent",
                color: isActive ? COLORS.primary : COLORS.textMuted,
                fontSize: 12, cursor: "pointer", transition: "all 0.15s",
              }}
              title={
                m.value === "view" ? "Browse canvas (drag to pan)"
                  : m.value === "select" ? "Click to select images for Claude"
                    : "Click images to add feedback annotations"
              }
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = COLORS.text; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = COLORS.textMuted; }}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>}
    </div>
  );
}

// ── Highlighter Canvas (Cmd+draw to circle image region) ──────────────────────

const HIGHLIGHT_COLOR = "rgba(255, 230, 0, 0.35)";
const HIGHLIGHT_LINE_WIDTH = 8; // in flow coordinates

/**
 * Overlay for freehand highlighter. Only intercepts pointer events when `active` is true
 * (Cmd held). Draws yellow strokes, on release finds the image under the strokes,
 * crops the highlighted region and sends it as selection context.
 */
function HighlighterOverlay({
  active,
  nodes,
  contentSet,
  imageVersion,
  onHighlightRegion,
}: {
  active: boolean;
  nodes: Node<ImageNodeData>[];
  contentSet: string | null;
  imageVersion: number;
  onHighlightRegion: (node: Node<ImageNodeData>, regionDataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const { x: vpX, y: vpY, zoom } = useViewport();

  const screenPointsRef = useRef<{ x: number; y: number }[]>([]);
  const flowPointsRef = useRef<{ x: number; y: number }[]>([]);

  // Resize canvas to container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  const screenToFlow = useCallback((sx: number, sy: number) => ({
    x: (sx - vpX) / zoom,
    y: (sy - vpY) / zoom,
  }), [vpX, vpY, zoom]);

  const drawPath = useCallback((points: { x: number; y: number }[]) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = HIGHLIGHT_COLOR;
    ctx.lineWidth = HIGHLIGHT_LINE_WIDTH * zoom;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const mx = (points[i].x + points[i + 1].x) / 2;
        const my = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    }
    ctx.stroke();
  }, [zoom]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
  }, []);

  const fadeOut = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const savedPoints = [...screenPointsRef.current];
    let opacity = 1;
    const fade = () => {
      opacity -= 0.06;
      if (opacity <= 0) { clearCanvas(); return; }
      clearCanvas();
      ctx.globalAlpha = opacity;
      drawPath(savedPoints);
      ctx.globalAlpha = 1;
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }, [drawPath, clearCanvas]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !active) return;
    e.preventDefault();
    e.stopPropagation();
    drawingRef.current = true;
    screenPointsRef.current = [];
    flowPointsRef.current = [];
    clearCanvas();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    screenPointsRef.current.push({ x: sx, y: sy });
    flowPointsRef.current.push(screenToFlow(sx, sy));
  }, [active, screenToFlow, clearCanvas]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    screenPointsRef.current.push({ x: sx, y: sy });
    flowPointsRef.current.push(screenToFlow(sx, sy));
    drawPath(screenPointsRef.current);
  }, [screenToFlow, drawPath]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    drawingRef.current = false;

    const points = flowPointsRef.current;
    if (points.length < 3) { clearCanvas(); return; }

    // Bounding box in flow coords
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    // Expand by 10%
    const bw = maxX - minX, bh = maxY - minY;
    minX -= bw * 0.1; minY -= bh * 0.1;
    maxX += bw * 0.1; maxY += bh * 0.1;

    // Find the image node most overlapped by the stroke
    let bestNode: Node<ImageNodeData> | null = null;
    let bestOverlap = 0;
    for (const n of nodes) {
      if (n.type !== "imageCard") continue;
      const nw = (n.style?.width as number) || NODE_HEIGHT;
      const nh = (n.style?.height as number) || NODE_HEIGHT;
      const ox = Math.max(0, Math.min(maxX, n.position.x + nw) - Math.max(minX, n.position.x));
      const oy = Math.max(0, Math.min(maxY, n.position.y + nh) - Math.max(minY, n.position.y));
      const overlap = ox * oy;
      if (overlap > bestOverlap) { bestOverlap = overlap; bestNode = n; }
    }

    if (!bestNode) { fadeOut(); return; }

    // Compute region relative to the image (0-1 normalized)
    const nw = (bestNode.style?.width as number) || NODE_HEIGHT;
    const nh = (bestNode.style?.height as number) || NODE_HEIGHT;
    const relX = Math.max(0, (minX - bestNode.position.x) / nw);
    const relY = Math.max(0, (minY - bestNode.position.y) / nh);
    const relW = Math.min(1, (maxX - bestNode.position.x) / nw) - relX;
    const relH = Math.min(1, (maxY - bestNode.position.y) / nh) - relY;

    // Crop the image region
    const item = bestNode.data.item;
    const imgUrl = getImageUrl(item.file, contentSet, imageVersion);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const cropCanvas = document.createElement("canvas");
      const sx = Math.round(relX * img.naturalWidth);
      const sy = Math.round(relY * img.naturalHeight);
      const sw = Math.round(relW * img.naturalWidth);
      const sh = Math.round(relH * img.naturalHeight);
      cropCanvas.width = sw;
      cropCanvas.height = sh;
      const cropCtx = cropCanvas.getContext("2d");
      if (cropCtx) {
        cropCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const dataUrl = cropCanvas.toDataURL("image/png");
        onHighlightRegion(bestNode!, dataUrl);
      }
      fadeOut();
    };
    img.onerror = () => fadeOut();
    img.src = imgUrl;
  }, [nodes, contentSet, imageVersion, onHighlightRegion, fadeOut, clearCanvas]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", inset: 0, zIndex: 15,
        cursor: active ? "crosshair" : "default",
        touchAction: "none",
        pointerEvents: active ? "auto" : "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0 }} />
    </div>
  );
}

// ── Sidebar Slider (animation wrapper) ────────────────────────────────────────

const SIDEBAR_WIDTH = 280;

function SidebarSlider({
  selectedImage, visible, contentSet, imageVersion,
  onClose, onCopyPrompt, onDownload, onViewDetail,
}: {
  selectedImage: SelectedImageInfo | null;
  visible: boolean;
  contentSet: string | null;
  imageVersion: number;
  onClose: () => void;
  onCopyPrompt: (item: ManifestItem) => void;
  onDownload: (item: ManifestItem) => void;
  onViewDetail: (item: ManifestItem) => void;
}) {
  // Keep the last valid info around during the close animation
  const [displayInfo, setDisplayInfo] = useState<SelectedImageInfo | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (visible && selectedImage) {
      setDisplayInfo(selectedImage);
      // Trigger open on next frame so the initial render is offscreen
      requestAnimationFrame(() => requestAnimationFrame(() => setIsOpen(true)));
    } else {
      setIsOpen(false);
    }
  }, [visible, selectedImage]);

  // Clear display info after close animation completes
  const handleTransitionEnd = useCallback(() => {
    if (!isOpen) setDisplayInfo(null);
  }, [isOpen]);

  if (!displayInfo && !isOpen) return null;

  return (
    <div
      style={{
        position: "absolute", top: 0, right: 0, bottom: 0,
        width: SIDEBAR_WIDTH, zIndex: 20,
        transform: isOpen ? "translateX(0)" : `translateX(${SIDEBAR_WIDTH}px)`,
        transition: "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        boxShadow: isOpen ? "-4px 0 24px rgba(0,0,0,0.3)" : "none",
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {displayInfo && (
        <ImageSidebar
          info={displayInfo}
          contentSet={contentSet}
          imageVersion={imageVersion}
          onClose={onClose}
          onCopyPrompt={() => onCopyPrompt(displayInfo.item)}
          onDownload={() => onDownload(displayInfo.item)}
          onViewDetail={() => onViewDetail(displayInfo.item)}
        />
      )}
    </div>
  );
}

// ── Image Sidebar ─────────────────────────────────────────────────────────────

function ImageSidebar({
  info, contentSet, imageVersion,
  onClose, onCopyPrompt, onDownload, onViewDetail,
}: {
  info: SelectedImageInfo;
  contentSet: string | null;
  imageVersion: number;
  onClose: () => void;
  onCopyPrompt: () => void;
  onDownload: () => void;
  onViewDetail: () => void;
}) {
  const { item, rowLabel, rowIndex, rowCount, itemIndex, itemCount } = info;

  return (
    <div style={{
      width: "100%", height: "100%", background: COLORS.surfaceSolid,
      borderLeft: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px", borderBottom: `1px solid ${COLORS.border}`,
        flexShrink: 0,
      }}>
        <span style={{ color: COLORS.text, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {item.title}
        </span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: COLORS.textDim, cursor: "pointer", padding: 4, fontSize: 16, lineHeight: 1 }}
          title="Close sidebar"
        >
          ×
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Thumbnail */}
        <div style={{
          borderRadius: 8, overflow: "hidden", background: COLORS.bg,
          border: `1px solid ${COLORS.border}`, cursor: "pointer",
        }} onClick={onViewDetail} title="Click to view full size">
          <img
            src={getImageUrl(item.file, contentSet, imageVersion)}
            alt={item.title}
            style={{ width: "100%", display: "block", objectFit: "contain" }}
          />
        </div>

        {/* Location */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 11, padding: "2px 8px", borderRadius: 4,
            background: `${COLORS.primary}20`, color: COLORS.primary,
          }}>
            Row {rowIndex + 1}/{rowCount}
          </span>
          <span style={{
            fontSize: 11, padding: "2px 8px", borderRadius: 4,
            background: `${COLORS.border}`, color: COLORS.textMuted,
          }}>
            Image {itemIndex + 1}/{itemCount}
          </span>
          {item.aspectRatio && (
            <span style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 4,
              background: `${COLORS.border}`, color: COLORS.textMuted,
            }}>
              {item.aspectRatio}
            </span>
          )}
        </div>

        {/* Row */}
        <div>
          <div style={{ color: COLORS.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>Row</div>
          <div style={{ color: COLORS.textMuted, fontSize: 12 }}>{rowLabel}</div>
        </div>

        {/* Prompt */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ color: COLORS.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Prompt</span>
            <button
              onClick={onCopyPrompt}
              style={{ background: "none", border: "none", color: COLORS.textDim, cursor: "pointer", fontSize: 10, padding: 0 }}
              title="Copy prompt"
            >
              Copy
            </button>
          </div>
          <div style={{
            color: COLORS.text, fontSize: 12, lineHeight: 1.5,
            background: COLORS.bg, borderRadius: 6, padding: "8px 10px",
            border: `1px solid ${COLORS.border}`, wordBreak: "break-word",
          }}>
            {item.prompt}
          </div>
        </div>

        {/* Style */}
        {item.style && (
          <div>
            <div style={{ color: COLORS.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>Style</div>
            <div style={{ color: COLORS.textMuted, fontSize: 12 }}>{item.style}</div>
          </div>
        )}

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div>
            <div style={{ color: COLORS.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Tags</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {item.tags.map((tag) => (
                <span key={tag} style={{
                  fontSize: 11, padding: "1px 6px", borderRadius: 4,
                  background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                  color: COLORS.textMuted,
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Resolution */}
        {item.resolution && (
          <div>
            <div style={{ color: COLORS.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>Resolution</div>
            <div style={{ color: COLORS.textMuted, fontSize: 12 }}>{item.resolution}</div>
          </div>
        )}

        {/* File */}
        <div>
          <div style={{ color: COLORS.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>File</div>
          <div style={{ color: COLORS.textDim, fontSize: 11, fontFamily: "monospace", wordBreak: "break-all" }}>{item.file}</div>
        </div>

        {/* Created */}
        {item.createdAt && (
          <div>
            <div style={{ color: COLORS.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>Created</div>
            <div style={{ color: COLORS.textMuted, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div style={{
        display: "flex", gap: 6, padding: "8px 12px",
        borderTop: `1px solid ${COLORS.border}`, flexShrink: 0,
      }}>
        <button
          onClick={onViewDetail}
          style={{
            flex: 1, padding: "6px 0", borderRadius: 6, border: `1px solid ${COLORS.border}`,
            background: "transparent", color: COLORS.textMuted, fontSize: 12, cursor: "pointer",
          }}
        >
          Full View
        </button>
        <button
          onClick={onDownload}
          style={{
            flex: 1, padding: "6px 0", borderRadius: 6, border: "none",
            background: COLORS.primary, color: "#fff", fontSize: 12, cursor: "pointer",
          }}
        >
          Download
        </button>
      </div>
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────

function EmptyCanvas() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: COLORS.textDim, gap: 12, padding: 40, textAlign: "center" }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
        <path d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
      </svg>
      <div style={{ fontSize: 16, fontWeight: 500, color: COLORS.textMuted }}>Empty Canvas</div>
      <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>
        Describe what you'd like to create — logos, illustrations, icons, or any visual asset.
        Each generation will appear as a row on this infinite canvas.
      </div>
    </div>
  );
}

// ── Inner Canvas (needs ReactFlowProvider) ───────────────────────────────────

function CanvasInner(props: ViewerPreviewProps) {
  const {
    files, selection, onSelect: rawOnSelect, mode: rawPreviewMode, imageVersion,
    actionRequest, onActionResult, onActiveFileChange, onNotifyAgent: rawOnNotifyAgent,
    navigateRequest, onNavigateComplete, readonly,
  } = props;
  // Readonly mode: force view, suppress selection and agent notifications
  const previewMode = readonly ? "view" : rawPreviewMode;
  const onSelect = readonly ? (() => {}) : rawOnSelect;
  const onNotifyAgent = readonly ? undefined : rawOnNotifyAgent;

  const annotations = useStore((s) => s.annotations);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const activeContentSet = useStore((s) => s.activeContentSet);
  const setPreviewMode = useStore((s) => s.setPreviewMode);
  const { fitView, setCenter } = useReactFlow();

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [detailItem, setDetailItem] = useState<ManifestItem | null>(null);
  const [selectedImage, setSelectedImage] = useState<SelectedImageInfo | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pendingAnnotation, setPendingAnnotation] = useState<{ item: ManifestItem; x: number; y: number } | null>(null);
  const [cmdHeld, setCmdHeld] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Parse manifest with fallback — keeps last valid state if agent breaks the JSON
  const manifest = useResilientParse(files, parseManifest, onNotifyAgent);

  const annotatedFiles = useMemo(() => {
    const set = new Set<string>();
    annotations.forEach((a) => set.add(a.slideFile));
    return set;
  }, [annotations]);

  // Convert manifest → React Flow nodes
  const computedNodes = useMemo(() => {
    if (!manifest) return [];
    return manifestToNodes(manifest, activeContentSet, imageVersion, annotatedFiles, previewMode);
  }, [manifest, activeContentSet, imageVersion, annotatedFiles, previewMode]);

  // Sync computed nodes to React Flow state, applying multi-select
  useEffect(() => {
    const withSelection = previewMode === "select" && selectedFiles.size > 0
      ? computedNodes.map((n) => ({
          ...n,
          selected: n.type === "imageCard" && selectedFiles.has(n.id),
        }))
      : computedNodes;
    setRfNodes(withSelection);
  }, [computedNodes, setRfNodes, selectedFiles, previewMode]);

  // Fit view on first load
  const didFitView = useRef(false);
  useEffect(() => {
    if (computedNodes.length > 0 && !didFitView.current) {
      didFitView.current = true;
      setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 100);
    }
  }, [computedNodes, fitView]);

  // Fit to new row when added
  const prevRowCount = useRef(0);
  useEffect(() => {
    if (!manifest) return;
    const rowCount = manifest.rows.length;
    if (rowCount > prevRowCount.current && prevRowCount.current > 0) {
      // New row — fit view to show everything including new row
      setTimeout(() => fitView({ padding: 0.1, duration: 400 }), 200);
    }
    prevRowCount.current = rowCount;
  }, [manifest?.rows.length, fitView]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const showToast = useCallback((text: string) => {
    const id = ++toastCounter;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((m) => m.id !== id)), 2500);
  }, []);

  const copyPrompt = useCallback((item: ManifestItem) => {
    navigator.clipboard.writeText(item.prompt).then(() => showToast("Prompt copied"), () => showToast("Copy failed"));
  }, [showToast]);

  const downloadImage = useCallback((item: ManifestItem) => {
    const a = document.createElement("a");
    a.href = getImageUrl(item.file, activeContentSet, imageVersion);
    a.download = item.file.split("/").pop() || "image.png";
    a.click();
  }, [imageVersion, activeContentSet]);

  // ── Build selection info from manifest ─────────────────────────────────────
  const buildSelectedInfo = useCallback((item: ManifestItem, rowId: string, rowLabel: string): SelectedImageInfo | null => {
    if (!manifest) return null;
    for (let ri = 0; ri < manifest.rows.length; ri++) {
      const row = manifest.rows[ri];
      if (row.id !== rowId) continue;
      const ii = row.items.findIndex((it) => it.file === item.file);
      if (ii < 0) continue;
      return {
        item, rowLabel, rowId,
        rowIndex: ri, rowCount: manifest.rows.length,
        itemIndex: ii, itemCount: row.items.length,
      };
    }
    return null;
  }, [manifest]);

  // ── Node click ────────────────────────────────────────────────────────────
  const handleNodeClick: NodeMouseHandler<Node<ImageNodeData>> = useCallback((event, node) => {
    if (node.type !== "imageCard") return;
    const data = node.data as ImageNodeData;
    if (data.item.status === "generating") return; // ignore clicks on generating items

    if (previewMode === "view") {
      // View mode: show sidebar with image details
      const info = buildSelectedInfo(data.item, data.rowId, data.rowLabel);
      setSelectedImage(info);
      onActiveFileChange?.(data.item.file);
      return;
    }

    if (previewMode === "select") {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(data.item.file)) {
          next.delete(data.item.file);
        } else {
          next.add(data.item.file);
        }

        // Build selection context from all selected files
        if (next.size === 0) {
          onSelect(null);
        } else if (next.size === 1) {
          const file = Array.from(next)[0];
          const sel: ViewerSelectionContext = {
            type: "image", content: data.item.title, file,
            label: `${data.item.title} (row: "${data.rowLabel}")`,
          };
          onSelect(sel);
          onActiveFileChange?.(file);
        } else {
          // Multi-select: list all selected images in content
          const selectedItems: { file: string; title: string; rowLabel: string }[] = [];
          if (manifest) {
            for (const row of manifest.rows) {
              for (const item of row.items) {
                if (next.has(item.file)) {
                  selectedItems.push({ file: item.file, title: item.title, rowLabel: row.label });
                }
              }
            }
          }
          const content = selectedItems
            .map((si) => `${si.title} (row: "${si.rowLabel}")`)
            .join("\n");
          const sel: ViewerSelectionContext = {
            type: "image",
            content,
            file: data.item.file,
            label: `${next.size} images selected`,
          };
          onSelect(sel);
          onActiveFileChange?.(data.item.file);
        }
        return next;
      });
      return;
    }

    if (previewMode === "annotate") {
      setPendingAnnotation({ item: data.item, x: event.clientX, y: event.clientY });
      return;
    }
  }, [previewMode, onSelect, onActiveFileChange, buildSelectedInfo]);

  // ── Cmd key tracking for highlighter ──────────────────────────────────────
  useEffect(() => {
    if (previewMode !== "select") { setCmdHeld(false); return; }
    const down = (e: KeyboardEvent) => { if (e.metaKey || e.key === "Meta") setCmdHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Meta") setCmdHeld(false); };
    const blur = () => setCmdHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [previewMode]);

  // ── Highlighter region complete ─────────────────────────────────────────
  const handleHighlightRegion = useCallback((node: Node<ImageNodeData>, regionDataUrl: string) => {
    const data = node.data as ImageNodeData;
    const sel: ViewerSelectionContext = {
      type: "image", content: data.item.title, file: data.item.file,
      label: `${data.item.title} (row: "${data.rowLabel}")`,
      thumbnail: regionDataUrl,
    };
    onSelect(sel);
    onActiveFileChange?.(data.item.file);
    showToast("Region captured");
  }, [onSelect, onActiveFileChange, showToast]);

  // ── Node double-click → detail ────────────────────────────────────────────
  const handleNodeDoubleClick: NodeMouseHandler<Node<ImageNodeData>> = useCallback((_event, node) => {
    if (node.type !== "imageCard") return;
    setDetailItem((node.data as ImageNodeData).item);
  }, []);

  // ── Node right-click → copy prompt ────────────────────────────────────────
  const handleNodeContextMenu: NodeMouseHandler<Node<ImageNodeData>> = useCallback((event, node) => {
    if (node.type !== "imageCard") return;
    event.preventDefault();
    copyPrompt((node.data as ImageNodeData).item);
  }, [copyPrompt]);

  // ── Pane click → deselect ─────────────────────────────────────────────────
  const handlePaneClick = useCallback(() => {
    onSelect(null);
    setSelectedImage(null);
    setPendingAnnotation(null);
    setSelectedFiles(new Set());
  }, [onSelect]);

  // Clear sidebar when leaving view mode, clear multi-select when leaving select mode
  useEffect(() => {
    if (previewMode !== "view") setSelectedImage(null);
    if (previewMode !== "select") setSelectedFiles(new Set());
  }, [previewMode]);

  // ── Confirm annotation ────────────────────────────────────────────────────
  const confirmAnnotation = useCallback((comment: string) => {
    if (!pendingAnnotation) return;
    const { item } = pendingAnnotation;
    addAnnotation({
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      slideFile: item.file,
      element: { type: "image" as any, content: item.title, label: item.title, file: item.file },
      comment,
    });
    const currentAnnotations = useStore.getState().annotations;
    onSelect({
      type: "annotation", content: "", file: item.file,
      annotations: [...currentAnnotations.map((a) => ({ slideFile: a.slideFile, element: a.element, comment: a.comment })),
        { slideFile: item.file, element: { type: "image" as any, content: item.title, label: item.title }, comment }],
    });
    setPendingAnnotation(null);
    showToast("Annotation added");
  }, [pendingAnnotation, addAnnotation, onSelect, showToast]);

  // ── Action requests from agent ────────────────────────────────────────────
  useEffect(() => {
    if (!actionRequest) return;
    switch (actionRequest.actionId) {
      case "navigate-to": {
        const targetFile = actionRequest.params?.file as string;
        const node = computedNodes.find((n) => n.id === targetFile);
        if (node) {
          const w = (node.style?.width as number) || NODE_HEIGHT;
          const h = (node.style?.height as number) || NODE_HEIGHT;
          setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 400 });
          onActiveFileChange?.(targetFile);
          onActionResult?.(actionRequest.requestId, { success: true });
        } else {
          onActionResult?.(actionRequest.requestId, { success: false, message: `Image not found: ${targetFile}` });
        }
        break;
      }
      case "fit-view": {
        fitView({ padding: 0.1, duration: 400 });
        onActionResult?.(actionRequest.requestId, { success: true });
        break;
      }
      case "zoom-to-row": {
        const rowId = actionRequest.params?.rowId as string;
        const rowNodes = computedNodes.filter((n) => n.data.rowId === rowId && n.type === "imageCard");
        if (rowNodes.length > 0) {
          requestAnimationFrame(() => {
            fitView({ nodes: rowNodes.map((n) => ({ id: n.id })), padding: 0.2, duration: 400 });
          });
          onActionResult?.(actionRequest.requestId, { success: true });
        } else {
          onActionResult?.(actionRequest.requestId, { success: false, message: `Row not found: ${rowId}` });
        }
        break;
      }
      default:
        onActionResult?.(actionRequest.requestId, { success: false, message: `Unknown action: ${actionRequest.actionId}` });
    }
  }, [actionRequest]);

  // ── Locator navigation from chat cards ──────────────────────────────────
  useEffect(() => {
    if (!navigateRequest) return;
    const { data } = navigateRequest;
    if (data.file) {
      const node = computedNodes.find((n) => n.id === data.file);
      if (node) {
        const w = (node.style?.width as number) || NODE_HEIGHT;
        const h = (node.style?.height as number) || NODE_HEIGHT;
        setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 400 });
        onActiveFileChange?.(data.file as string);
      }
    } else if (data.rowId) {
      const rowNodes = computedNodes.filter((n) => n.data.rowId === data.rowId && n.type === "imageCard");
      if (rowNodes.length > 0) {
        // requestAnimationFrame ensures React Flow's internal store is synced before fitView
        requestAnimationFrame(() => {
          fitView({ nodes: rowNodes.map((n) => ({ id: n.id })), padding: 0.2, duration: 400 });
        });
      }
    }

    onNavigateComplete?.();
  }, [navigateRequest]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (detailItem) setDetailItem(null);
        else if (pendingAnnotation) setPendingAnnotation(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [detailItem, pendingAnnotation]);

  // ── Render ────────────────────────────────────────────────────────────────

  const imageCount = useMemo(() => {
    if (!manifest) return 0;
    return manifest.rows.reduce((sum, row) => sum + row.items.length, 0);
  }, [manifest]);

  if (!manifest) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: COLORS.bg }}>
        <CanvasToolbar previewMode={previewMode} onSetPreviewMode={setPreviewMode} imageCount={0} rowCount={0} readonly={readonly} />
        <EmptyCanvas />
      </div>
    );
  }

  if (manifest.rows.length === 0) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: COLORS.bg }}>
        <CanvasToolbar previewMode={previewMode} onSetPreviewMode={setPreviewMode} imageCount={0} rowCount={0} readonly={readonly} />
        <EmptyCanvas />
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
      <CanvasToolbar
        previewMode={previewMode}
        onSetPreviewMode={setPreviewMode}
        imageCount={imageCount}
        rowCount={manifest.rows.length}
        selectionCount={previewMode === "select" ? selectedFiles.size : undefined}
        readonly={readonly}
      />
      <style dangerouslySetInnerHTML={{ __html: RF_DARK_OVERRIDES }} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {/* Canvas */}
        <div style={{ flex: 1, position: "relative" }}>
          <ReactFlow
            nodes={rfNodes}
            edges={[]}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeContextMenu={handleNodeContextMenu}
            onPaneClick={handlePaneClick}
            fitView
            fitViewOptions={{ padding: 0.1 }}
            minZoom={0.02}
            maxZoom={4}
            nodesDraggable={false}
            panOnDrag={previewMode === "select" ? [1, 2] : true}
            zoomOnScroll
            selectionOnDrag={false}
            proOptions={{ hideAttribution: true }}
            style={{ background: COLORS.bg }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.05)" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) => n.type === "imageCard" ? COLORS.primary : "transparent"}
              pannable
              zoomable
            />
          </ReactFlow>

          {/* Highlighter overlay (Cmd+draw in select mode) */}
          {previewMode === "select" && (
            <HighlighterOverlay
              active={cmdHeld}
              nodes={computedNodes}
              contentSet={activeContentSet}
              imageVersion={imageVersion}
              onHighlightRegion={handleHighlightRegion}
            />
          )}
        </div>

        {/* Sidebar with slide animation */}
        <SidebarSlider
          selectedImage={selectedImage}
          visible={!!selectedImage && previewMode === "view"}
          contentSet={activeContentSet}
          imageVersion={imageVersion}
          onClose={() => setSelectedImage(null)}
          onCopyPrompt={(item) => copyPrompt(item)}
          onDownload={(item) => downloadImage(item)}
          onViewDetail={(item) => setDetailItem(item)}
        />
      </div>

      {/* Annotation popover */}
      {pendingAnnotation && previewMode === "annotate" && (
        <AnnotationPopover
          style={{ left: pendingAnnotation.x + 8, top: pendingAnnotation.y + 8 }}
          label={pendingAnnotation.item.title}
          onConfirm={confirmAnnotation}
          onCancel={() => setPendingAnnotation(null)}
        />
      )}

      {/* Detail overlay */}
      {detailItem && (
        <ImageDetail
          item={detailItem} contentSet={activeContentSet} imageVersion={imageVersion}
          onClose={() => setDetailItem(null)}
          onCopyPrompt={() => copyPrompt(detailItem)}
          onDownload={() => downloadImage(detailItem)}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

// ── Exported component (wraps with ReactFlowProvider) ────────────────────────

export default function IllustratePreview(props: ViewerPreviewProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
