/**
 * GridBoardPreview — Main viewer component for GridBoard mode.
 *
 * Renders the board grid, positions tiles, handles drag/resize interactions,
 * manages tile data fetching, and integrates with the gallery/toolbar.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { getApiBase } from "../../../src/utils/api.js";
import { useStore } from "../../../src/store.js";
import { snapdom } from "@zumer/snapdom";
import { useTileCompiler, type BoardConfig } from "./use-tile-compiler.js";
import type { TileDefinition } from "./tile-compiler.js";
import TileSlot from "./TileSlot.js";
import { TileGallery } from "./TileGallery.js";
import { GridToolbar } from "./GridToolbar.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface TileConfig {
  label?: string;
  component: string;
  status: string;
  position: { col: number; row: number };
  size: { cols: number; rows: number };
  [key: string]: unknown;
}

interface TilePixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  tileId: string;
  startMouse: { x: number; y: number };
  startPos: { col: number; row: number };
  currentPos: { col: number; row: number };
}

interface ResizeState {
  tileId: string;
  direction: string;
  startMouse: { x: number; y: number };
  startSize: { cols: number; rows: number };
  startPos: { col: number; row: number };
  currentSize: { cols: number; rows: number };
  currentPos: { col: number; row: number };
}

interface TileDataEntry {
  data: unknown;
  loading: boolean;
  error: Error | null;
}

interface GalleryTileInfo {
  tileId: string;
  label: string;
  description: string;
  status: "available" | "disabled";
  minSize?: { cols: number; rows: number };
  component: string;
  definition?: TileDefinition | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Capture a DOM element to a base64 PNG using @zumer/snapdom */
async function captureElementToPng(el: HTMLElement): Promise<{ media_type: string; data: string } | null> {
  try {
    const result = await snapdom(el, { embedFonts: false });
    if (!result) return null;
    const png = await result.toPng({ scale: 0.5 }); // half scale to keep size reasonable
    const src = png.src; // data:image/png;base64,...
    const match = src.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { media_type: match[1], data: match[2] };
  } catch {
    return null;
  }
}

function parseBoardJson(files: { path: string; content: string }[]): BoardConfig | null {
  const f = files.find((f) => f.path === "board.json" || f.path.endsWith("/board.json"));
  if (!f) return null;
  try {
    return JSON.parse(f.content) as BoardConfig;
  } catch {
    return null;
  }
}

function findThemeCSS(files: { path: string; content: string }[]): string {
  const f = files.find((f) => f.path === "theme.css" || f.path.endsWith("/theme.css"));
  return f?.content || "";
}

function tileToPixels(tile: TileConfig, board: BoardConfig): TilePixels {
  const cellW = board.board.width / board.board.columns;
  const cellH = board.board.height / board.board.rows;
  return {
    x: tile.position.col * cellW,
    y: tile.position.row * cellH,
    width: tile.size.cols * cellW,
    height: tile.size.rows * cellH,
  };
}

function generateGridBackground(board: BoardConfig): string {
  const cellW = board.board.width / board.board.columns;
  const cellH = board.board.height / board.board.rows;
  return [
    `repeating-linear-gradient(90deg, var(--board-grid-line, rgba(255,255,255,0.04)) 0px, var(--board-grid-line, rgba(255,255,255,0.04)) 1px, transparent 1px, transparent ${cellW}px)`,
    `repeating-linear-gradient(0deg, var(--board-grid-line, rgba(255,255,255,0.04)) 0px, var(--board-grid-line, rgba(255,255,255,0.04)) 1px, transparent 1px, transparent ${cellH}px)`,
  ].join(", ");
}

/** Check if a tile at given pos/size overlaps any other tile on the board (excluding `excludeTileId`). */
function hasOverlap(
  tiles: Record<string, TileConfig>,
  col: number,
  row: number,
  cols: number,
  rows: number,
  excludeTileId: string,
): boolean {
  for (const [id, tile] of Object.entries(tiles)) {
    if (id === excludeTileId || tile.status !== "active") continue;
    const tCol = tile.position.col;
    const tRow = tile.position.row;
    const tCols = tile.size.cols;
    const tRows = tile.size.rows;
    // Check axis-aligned rectangle overlap
    if (col < tCol + tCols && col + cols > tCol && row < tRow + tRows && row + rows > tRow) {
      return true;
    }
  }
  return false;
}

/** Find the first empty grid position that fits the given size. */
function findEmptyPosition(
  tiles: Record<string, TileConfig>,
  board: BoardConfig["board"],
  cols: number,
  rows: number,
): { col: number; row: number } | null {
  for (let r = 0; r <= board.rows - rows; r++) {
    for (let c = 0; c <= board.columns - cols; c++) {
      if (!hasOverlap(tiles, c, r, cols, rows, "")) {
        return { col: c, row: r };
      }
    }
  }
  return null;
}

async function saveFile(path: string, content: string): Promise<void> {
  const base = getApiBase();
  await fetch(`${base}/api/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

// ── Default board fallback ──────────────────────────────────────────────────

const DEFAULT_BOARD: BoardConfig = {
  board: { width: 800, height: 800, columns: 8, rows: 8 },
  tiles: {},
};

// ── Main Component ──────────────────────────────────────────────────────────

export default function GridBoardPreview({
  files,
  selection,
  onSelect: rawOnSelect,
  mode: previewMode,
  imageVersion,
  initParams,
  onActiveFileChange,
  actionRequest,
  onActionResult,
  onNotifyAgent: rawOnNotifyAgent,
  navigateRequest,
  onNavigateComplete,
  commands,
  readonly,
  editing,
}: ViewerPreviewProps) {
  // Readonly mode: suppress interactions
  const isViewMode = !readonly && editing === false;
  const editingDisabled = readonly || isViewMode;
  const onSelect = editingDisabled ? (() => {}) : rawOnSelect;
  const onNotifyAgent = editingDisabled ? undefined : rawOnNotifyAgent;

  // ── Parse board config & theme ──────────────────────────────────────────
  const boardConfig = useMemo(() => parseBoardJson(files) ?? DEFAULT_BOARD, [files]);
  const themeCSS = useMemo(() => findThemeCSS(files), [files]);

  // ── Compile tiles ─────────────────────────────────────────────────────
  const compilation = useTileCompiler(files);

  // ── UI state ──────────────────────────────────────────────────────────
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [resizingTileIds, setResizingTileIds] = useState<Set<string>>(new Set());

  // Sync local selectedTileId with framework selection (e.g. user clicks ✕ in ChatInput)
  useEffect(() => {
    if (!selection && selectedTileId) {
      setSelectedTileId(null);
    }
  }, [selection, selectedTileId]);

  // ── Per-tile data fetching state ──────────────────────────────────────
  const [tileData, setTileData] = useState<Map<string, TileDataEntry>>(new Map());

  // ── Drag state ────────────────────────────────────────────────────────
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  // Optimistic overrides — applied immediately on drop, cleared when boardConfig catches up
  const [pendingPositions, setPendingPositions] = useState<Map<string, { col: number; row: number }>>(new Map());
  const [pendingSizes, setPendingSizes] = useState<Map<string, { cols: number; rows: number; col: number; row: number }>>(new Map());

  // Refs for drag/resize
  const boardRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);


  // Optimistic removals — tiles hidden instantly before file watcher catches up
  const [optimisticRemovals, setOptimisticRemovals] = useState<Set<string>>(new Set());

  // Clear optimistic removals when boardConfig catches up
  useEffect(() => {
    if (optimisticRemovals.size === 0) return;
    setOptimisticRemovals((prev) => {
      const next = new Set(prev);
      for (const id of prev) {
        const tile = boardConfig.tiles[id] as TileConfig | undefined;
        if (!tile || tile.status !== "active") next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [boardConfig, optimisticRemovals]);

  // ── Active tiles (status === "active", minus optimistic removals) ─────
  const activeTiles = useMemo(() => {
    return Object.entries(boardConfig.tiles).filter(
      ([id, tile]) => (tile as TileConfig).status === "active" && !optimisticRemovals.has(id),
    ) as [string, TileConfig][];
  }, [boardConfig, optimisticRemovals]);

  // Resizing overlay is now agent-controlled via lock-tile / unlock-tile actions.
  // No automatic tracking needed.

  // ── Notify agent about tile errors ───────────────────────────────────
  // Send via onNotifyAgent — the ws-bridge queues notifications when CLI is busy
  // and flushes them one-by-one when CLI goes idle. No client-side gating needed.
  const notifiedErrorsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!onNotifyAgent) return;

    const errors: { key: string; message: string; summary: string }[] = [];
    for (const err of compilation.errors) {
      // Skip errors for locked tiles — agent is mid-edit, intermediate states are expected
      if (resizingTileIds.has(err.tileId)) continue;
      errors.push({
        key: `compile:${err.tileId}:${err.message}`,
        message: `Compilation error in tile "${err.tileId}": ${err.message}\nPlease fix the tile component and save.`,
        summary: `Tile "${err.tileId}" failed to compile`,
      });
    }
    for (const [tileId, compiled] of compilation.tiles) {
      if (!compiled.error) continue;
      // Skip errors for locked tiles
      if (resizingTileIds.has(tileId)) continue;
      errors.push({
        key: `compile:${tileId}:${compiled.error}`,
        message: `Compilation error in tile "${tileId}": ${compiled.error}\nPlease fix the tile component and save.`,
        summary: `Tile "${tileId}" failed to compile`,
      });
    }

    // Clear stale keys for errors that resolved
    const currentKeys = new Set(errors.map((e) => e.key));
    for (const key of notifiedErrorsRef.current) {
      if (!currentKeys.has(key)) notifiedErrorsRef.current.delete(key);
    }

    // Notify for new errors (dedup within session)
    for (const err of errors) {
      if (notifiedErrorsRef.current.has(err.key)) continue;
      notifiedErrorsRef.current.add(err.key);
      onNotifyAgent({
        type: "tile_error",
        message: err.message,
        severity: "warning",
        summary: err.summary,
      });
    }
  }, [compilation, onNotifyAgent, resizingTileIds]);

  // Callback for TileSlot render errors → notify agent (queued by ws-bridge)
  // Suppressed for locked tiles — agent is mid-edit, errors are expected.
  const handleTileRenderError = useCallback(
    (tileId: string, error: Error) => {
      if (!onNotifyAgent) return;
      if (resizingTileIds.has(tileId)) return; // locked → skip
      const key = `render:${tileId}:${error.message}`;
      if (notifiedErrorsRef.current.has(key)) return;
      notifiedErrorsRef.current.add(key);
      const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
      onNotifyAgent({
        type: "tile_error",
        message: `Runtime render error in tile "${tileId}" (${tile?.component ?? "unknown"}):\n${error.message}\nPlease fix the tile component and save.`,
        severity: "warning",
        summary: `Tile "${tileId}" render error`,
      });
    },
    [onNotifyAgent, boardConfig, resizingTileIds],
  );

  // ── Data Fetching ─────────────────────────────────────────────────────
  // Keep a ref to compilation.tiles so the fetch effect can read latest
  // definitions without re-running whenever the Map reference changes.
  const compilationTilesRef = useRef(compilation.tiles);
  compilationTilesRef.current = compilation.tiles;

  // Stable dependency key: only re-run when the set of active tiles with
  // dataSources actually changes, not on every recompilation.
  const fetchKey = useMemo(() => {
    if (!boardConfig) return "";
    const parts: string[] = [];
    for (const [tileId, compiled] of compilation.tiles) {
      const def = compiled.definition;
      if (!def?.dataSource) continue;
      const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
      if (!tile || tile.status !== "active") continue;
      parts.push(`${tileId}:${def.dataSource.refreshInterval}`);
    }
    return parts.sort().join(",");
  }, [compilation.tiles, boardConfig]);

  useEffect(() => {
    if (!boardConfig || !fetchKey) return;

    const controllers = new Map<string, AbortController>();
    const intervals = new Map<string, ReturnType<typeof setInterval>>();

    for (const [tileId, compiled] of compilationTilesRef.current) {
      const def = compiled.definition;
      if (!def?.dataSource) continue;
      const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
      if (!tile || tile.status !== "active") continue;

      const doFetch = async () => {
        // Read latest definition from ref (may have been recompiled)
        const latestDef = compilationTilesRef.current.get(tileId)?.definition;
        const ds = latestDef?.dataSource ?? def.dataSource;
        if (!ds) return;

        const ctrl = new AbortController();
        controllers.set(tileId, ctrl);
        setTileData((prev) => {
          const m = new Map(prev);
          m.set(tileId, { data: m.get(tileId)?.data ?? null, loading: true, error: null });
          return m;
        });
        try {
          const params: Record<string, unknown> = {};
          const paramDefs = latestDef?.params ?? def.params;
          if (paramDefs) {
            for (const [k, v] of Object.entries(paramDefs)) {
              params[k] = v.default;
            }
          }
          const data = await ds.fetch({ signal: ctrl.signal, params });
          setTileData((prev) => {
            const m = new Map(prev);
            m.set(tileId, { data, loading: false, error: null });
            return m;
          });
        } catch (err: unknown) {
          if ((err as Error)?.name !== "AbortError") {
            setTileData((prev) => {
              const m = new Map(prev);
              m.set(tileId, { data: m.get(tileId)?.data ?? null, loading: false, error: err as Error });
              return m;
            });
          }
        }
      };

      doFetch();
      const interval = Math.max(30, def.dataSource.refreshInterval) * 1000;
      intervals.set(tileId, setInterval(doFetch, interval));
    }

    return () => {
      controllers.forEach((c) => c.abort());
      intervals.forEach((i) => clearInterval(i));
    };
  }, [fetchKey, boardConfig]);

  // ── Tile Selection ────────────────────────────────────────────────────
  const handleTileSelect = useCallback(
    (tileId: string) => {
      if (editingDisabled) return;
      setSelectedTileId(tileId);
      const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
      if (tile) {
        onSelect({
          type: "tile",
          content: tileId,
          file: tile.component,
        });
      }
    },
    [boardConfig, onSelect, editingDisabled],
  );

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      // Clear selection if clicking on any background area (not on a tile)
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tile-id]")) {
        setSelectedTileId(null);
        onSelect(null);
      }
    },
    [onSelect],
  );

  // ── Drag Move ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (editingDisabled) return;
      const handle = (e.target as HTMLElement).closest("[data-drag-handle]");
      if (!handle) return;

      // Find the tile wrapper (the absolutely positioned div containing TileSlot)
      const tileWrapper = handle.closest("[data-tile-id]");
      if (!tileWrapper) return;
      const tileId = tileWrapper.getAttribute("data-tile-id");
      if (!tileId) return;

      const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
      if (!tile) return;

      e.preventDefault();
      setDragState({
        tileId,
        startMouse: { x: e.clientX, y: e.clientY },
        startPos: { ...tile.position },
        currentPos: { ...tile.position },
      });
    },
    [boardConfig, editingDisabled],
  );

  useEffect(() => {
    if (!dragState) return;

    const cellW = boardConfig.board.width / boardConfig.board.columns;
    const cellH = boardConfig.board.height / boardConfig.board.rows;
    const tile = boardConfig.tiles[dragState.tileId] as TileConfig;
    if (!tile) return;

    const handleMouseMove = (e: MouseEvent) => {
      const boardEl = boardRef.current;
      if (!boardEl) return;

      const dx = e.clientX - dragState.startMouse.x;
      const dy = e.clientY - dragState.startMouse.y;

      // Convert pixel delta to grid delta, accounting for board scale
      const boardRect = boardEl.getBoundingClientRect();
      const scaleX = boardConfig.board.width / boardRect.width;
      const scaleY = boardConfig.board.height / boardRect.height;

      const colDelta = Math.round((dx * scaleX) / cellW);
      const rowDelta = Math.round((dy * scaleY) / cellH);

      let newCol = dragState.startPos.col + colDelta;
      let newRow = dragState.startPos.row + rowDelta;

      // Clamp to board bounds
      newCol = Math.max(0, Math.min(boardConfig.board.columns - tile.size.cols, newCol));
      newRow = Math.max(0, Math.min(boardConfig.board.rows - tile.size.rows, newRow));

      setDragState((prev) => (prev ? { ...prev, currentPos: { col: newCol, row: newRow } } : null));
    };

    const handleMouseUp = async () => {
      if (!dragState) return;
      const { tileId, startPos, currentPos } = dragState;

      // Only save if position actually changed and no overlap
      if (currentPos.col !== startPos.col || currentPos.row !== startPos.row) {
        const tile = boardConfig.tiles[tileId] as TileConfig;
        if (
          !hasOverlap(
            boardConfig.tiles as Record<string, TileConfig>,
            currentPos.col,
            currentPos.row,
            tile.size.cols,
            tile.size.rows,
            tileId,
          )
        ) {
          // Optimistic update — keep tile at new position while file saves
          setPendingPositions((prev) => new Map(prev).set(tileId, currentPos));

          const updatedConfig = JSON.parse(JSON.stringify(boardConfig));
          updatedConfig.tiles[tileId].position = currentPos;
          setDragState(null);
          await saveFile("board.json", JSON.stringify(updatedConfig, null, 2));
          return;
        }
      }
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, boardConfig]);

  // ── Drag Resize ───────────────────────────────────────────────────────
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (editingDisabled) return;
      const handle = (e.target as HTMLElement).closest("[data-resize-handle]");
      if (!handle) return;

      const direction = handle.getAttribute("data-resize-direction");
      if (!direction) return;

      const tileWrapper = handle.closest("[data-tile-id]");
      if (!tileWrapper) return;
      const tileId = tileWrapper.getAttribute("data-tile-id");
      if (!tileId) return;

      const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
      if (!tile) return;

      e.preventDefault();
      e.stopPropagation();
      setResizeState({
        tileId,
        direction,
        startMouse: { x: e.clientX, y: e.clientY },
        startSize: { ...tile.size },
        startPos: { ...tile.position },
        currentSize: { ...tile.size },
        currentPos: { ...tile.position },
      });
    },
    [boardConfig, editingDisabled],
  );

  useEffect(() => {
    if (!resizeState) return;

    const cellW = boardConfig.board.width / boardConfig.board.columns;
    const cellH = boardConfig.board.height / boardConfig.board.rows;
    const compiled = compilation.tiles.get(resizeState.tileId);
    const def = compiled?.definition;
    const minCols = def?.minSize?.cols ?? 1;
    const minRows = def?.minSize?.rows ?? 1;
    const maxCols = def?.maxSize?.cols ?? boardConfig.board.columns;
    const maxRows = def?.maxSize?.rows ?? boardConfig.board.rows;

    const handleMouseMove = (e: MouseEvent) => {
      const boardEl = boardRef.current;
      if (!boardEl) return;

      const dx = e.clientX - resizeState.startMouse.x;
      const dy = e.clientY - resizeState.startMouse.y;

      const boardRect = boardEl.getBoundingClientRect();
      const scaleX = boardConfig.board.width / boardRect.width;
      const scaleY = boardConfig.board.height / boardRect.height;

      const colDelta = Math.round((dx * scaleX) / cellW);
      const rowDelta = Math.round((dy * scaleY) / cellH);

      let newCols = resizeState.startSize.cols;
      let newRows = resizeState.startSize.rows;
      let newCol = resizeState.startPos.col;
      let newRow = resizeState.startPos.row;

      const dir = resizeState.direction;

      // East: grow/shrink width from the right
      if (dir.includes("e")) {
        newCols = resizeState.startSize.cols + colDelta;
      }
      // West: grow/shrink width from the left
      if (dir.includes("w")) {
        newCols = resizeState.startSize.cols - colDelta;
        newCol = resizeState.startPos.col + colDelta;
      }
      // South: grow/shrink height from the bottom
      if (dir.includes("s")) {
        newRows = resizeState.startSize.rows + rowDelta;
      }
      // North: grow/shrink height from the top
      if (dir.includes("n")) {
        newRows = resizeState.startSize.rows - rowDelta;
        newRow = resizeState.startPos.row + rowDelta;
      }

      // Clamp sizes
      newCols = Math.max(minCols, Math.min(maxCols, newCols));
      newRows = Math.max(minRows, Math.min(maxRows, newRows));

      // Clamp position (ensure tile stays on board)
      newCol = Math.max(0, Math.min(boardConfig.board.columns - newCols, newCol));
      newRow = Math.max(0, Math.min(boardConfig.board.rows - newRows, newRow));

      setResizeState((prev) =>
        prev ? { ...prev, currentSize: { cols: newCols, rows: newRows }, currentPos: { col: newCol, row: newRow } } : null,
      );
    };

    const handleMouseUp = async () => {
      if (!resizeState) return;
      const { tileId, startSize, currentSize, startPos, currentPos } = resizeState;

      setResizeState(null);

      const sizeChanged = currentSize.cols !== startSize.cols || currentSize.rows !== startSize.rows;
      const posChanged = currentPos.col !== startPos.col || currentPos.row !== startPos.row;

      if (sizeChanged || posChanged) {
        if (
          !hasOverlap(
            boardConfig.tiles as Record<string, TileConfig>,
            currentPos.col,
            currentPos.row,
            currentSize.cols,
            currentSize.rows,
            tileId,
          )
        ) {
          // Optimistic update
          setPendingSizes((prev) => new Map(prev).set(tileId, { ...currentSize, ...currentPos }));

          const updatedConfig = JSON.parse(JSON.stringify(boardConfig));
          updatedConfig.tiles[tileId].size = currentSize;
          updatedConfig.tiles[tileId].position = currentPos;

          setResizeState(null);

          await saveFile("board.json", JSON.stringify(updatedConfig, null, 2));

          // Check if the tile's render is optimized for the new pixel dimensions
          const compiled = compilation.tiles.get(tileId);
          const def = compiled?.definition;
          const cellW = boardConfig.board.width / boardConfig.board.columns;
          const cellH = boardConfig.board.height / boardConfig.board.rows;
          const newPixelW = currentSize.cols * cellW;
          const newPixelH = currentSize.rows * cellH;

          if (def?.isOptimizedFor && def.isOptimizedFor(newPixelW, newPixelH)) {
            // Tile handles this size — no agent intervention needed
            return;
          }

          // Tile is NOT optimized for this size (or doesn't declare optimization).
          // Capture a screenshot of the tile at its new size and notify agent.
          let images: { media_type: string; data: string }[] | undefined;
          try {
            const tileEl = boardRef.current?.querySelector(`[data-tile-id="${tileId}"]`) as HTMLElement | null;
            if (tileEl) {
              const captured = await captureElementToPng(tileEl);
              if (captured) images = [captured];
            }
          } catch { /* screenshot is best-effort */ }

          const msg = [
            `Tile "${tileId}" was resized from ${startSize.cols}×${startSize.rows} to ${currentSize.cols}×${currentSize.rows} (${Math.round(newPixelW)}×${Math.round(newPixelH)}px).`,
            `This tile has NOT been optimized for this size yet.`,
            images?.length ? `A screenshot of the tile at its current size is attached — review it to assess layout quality.` : `(Screenshot capture failed — read the component to assess layout.)`,
            `If the layout needs work: call lock-tile, update the component's render breakpoints, then call unlock-tile.`,
            `If acceptable: acknowledge, no changes needed.`,
            `Component: ${(boardConfig.tiles[tileId] as TileConfig).component}`,
          ].join("\n");

          useStore.getState().addPendingNotification(
            {
              type: "tile_resize_needs_optimization",
              message: msg,
              severity: "warning",
              summary: `Tile "${tileId}" needs size optimization (${currentSize.cols}×${currentSize.rows})`,
            },
            images,
          );
          return;
        }
      }
      setResizeState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizeState, boardConfig, compilation.tiles, onNotifyAgent]);

  // ── Action Handling ───────────────────────────────────────────────────
  useEffect(() => {
    if (!actionRequest) return;

    switch (actionRequest.actionId) {
      case "navigate-to": {
        const tileId = actionRequest.params?.tileId as string;
        if (tileId && boardConfig.tiles[tileId]) {
          setSelectedTileId(tileId);
          scrollTileIntoView(tileId);
          onActionResult?.(actionRequest.requestId, { success: true });
        } else {
          onActionResult?.(actionRequest.requestId, {
            success: false,
            message: `Tile "${tileId}" not found`,
          });
        }
        break;
      }
      case "open-gallery": {
        setGalleryOpen(true);
        onActionResult?.(actionRequest.requestId, { success: true });
        break;
      }
      case "capture-tile": {
        const tileId = actionRequest.params?.tileId as string;
        const tileEl = boardRef.current?.querySelector(`[data-tile-id="${tileId}"]`) as HTMLElement | null;
        if (!tileEl) {
          onActionResult?.(actionRequest.requestId, { success: false, message: `Tile "${tileId}" not found` });
          break;
        }
        captureElementToPng(tileEl).then(async (img) => {
          if (!img) {
            onActionResult?.(actionRequest.requestId, { success: false, message: "Screenshot capture failed" });
            return;
          }
          const filename = `tile-${tileId}-${Date.now()}.png`;
          const path = `.pneuma/captures/${filename}`;
          await saveFile(path, `data:${img.media_type};base64,${img.data}`);
          onActionResult?.(actionRequest.requestId, { success: true, message: path, data: { path } });
        });
        break;
      }
      case "capture-board": {
        const boardEl = boardRef.current;
        if (!boardEl) {
          onActionResult?.(actionRequest.requestId, { success: false, message: "Board element not found" });
          break;
        }
        captureElementToPng(boardEl).then(async (img) => {
          if (!img) {
            onActionResult?.(actionRequest.requestId, { success: false, message: "Screenshot capture failed" });
            return;
          }
          const filename = `board-${Date.now()}.png`;
          const path = `.pneuma/captures/${filename}`;
          await saveFile(path, `data:${img.media_type};base64,${img.data}`);
          onActionResult?.(actionRequest.requestId, { success: true, message: path, data: { path } });
        });
        break;
      }
      case "lock-tile": {
        const tileId = actionRequest.params?.tileId as string;
        if (tileId) {
          setResizingTileIds((prev) => new Set(prev).add(tileId));
          onActionResult?.(actionRequest.requestId, { success: true, message: `Tile "${tileId}" locked` });
        } else {
          onActionResult?.(actionRequest.requestId, { success: false, message: "tileId required" });
        }
        break;
      }
      case "unlock-tile": {
        const tileId = actionRequest.params?.tileId as string;
        if (tileId) {
          setResizingTileIds((prev) => {
            const next = new Set(prev);
            next.delete(tileId);
            return next;
          });
          onActionResult?.(actionRequest.requestId, { success: true, message: `Tile "${tileId}" unlocked` });
        } else {
          onActionResult?.(actionRequest.requestId, { success: false, message: "tileId required" });
        }
        break;
      }
      default:
        onActionResult?.(actionRequest.requestId, {
          success: false,
          message: `Unknown action: ${actionRequest.actionId}`,
        });
    }
  }, [actionRequest]);

  // ── Navigate Request (Locator Cards) ──────────────────────────────────
  useEffect(() => {
    if (!navigateRequest) return;
    const { data } = navigateRequest;
    if (data.tileId) {
      const tileId = data.tileId as string;
      if (boardConfig.tiles[tileId]) {
        setSelectedTileId(tileId);
        scrollTileIntoView(tileId);
      }
    } else if (data.action === "open-gallery") {
      setGalleryOpen(true);
    }
    onNavigateComplete?.();
  }, [navigateRequest]);

  // ── Scroll tile into view ─────────────────────────────────────────────
  // Uses manual scroll calculation instead of scrollIntoView to avoid
  // scrolling ancestor containers (which would expose the hidden gallery panel).
  const scrollTileIntoView = useCallback(
    (tileId: string) => {
      const board = boardRef.current;
      const el = board?.querySelector(`[data-tile-id="${tileId}"]`) as HTMLElement | null;
      const scrollContainer = board?.parentElement;
      if (!el || !scrollContainer) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      // Calculate scroll offset to center the tile in the visible area
      const targetScrollTop = scrollContainer.scrollTop
        + (elRect.top - containerRect.top)
        - (containerRect.height - elRect.height) / 2;
      const targetScrollLeft = scrollContainer.scrollLeft
        + (elRect.left - containerRect.left)
        - (containerRect.width - elRect.width) / 2;

      scrollContainer.scrollTo({
        top: Math.max(0, targetScrollTop),
        left: Math.max(0, targetScrollLeft),
        behavior: "smooth",
      });
    },
    [],
  );

  // ── Remove tile from board (→ available) ─────────────────────────────
  const handleRemoveTile = useCallback(
    async (tileId: string) => {
      if (editingDisabled) return;
      const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
      if (!tile) return;
      // Optimistic: hide immediately
      setOptimisticRemovals((prev) => new Set(prev).add(tileId));
      if (selectedTileId === tileId) {
        setSelectedTileId(null);
        onSelect(null);
      }
      // Then persist
      const updatedConfig = JSON.parse(JSON.stringify(boardConfig));
      updatedConfig.tiles[tileId].status = "available";
      delete updatedConfig.tiles[tileId].position;
      delete updatedConfig.tiles[tileId].size;
      await saveFile("board.json", JSON.stringify(updatedConfig, null, 2));
    },
    [boardConfig, editingDisabled, selectedTileId, onSelect],
  );

  // ── Gallery: non-active tiles ─────────────────────────────────────────
  const galleryTiles = useMemo(() => {
    const map = new Map<string, GalleryTileInfo>();
    for (const [tileId, tile] of Object.entries(boardConfig.tiles)) {
      const t = tile as TileConfig;
      if (t.status === "active") continue;
      const compiled = compilation.tiles.get(tileId);
      const def = compiled?.definition;
      map.set(tileId, {
        tileId,
        label: def?.label ?? t.label ?? tileId,
        description: def?.description ?? "",
        status: t.status === "disabled" ? "disabled" : "available",
        minSize: def?.minSize,
        component: t.component,
        definition: def ?? null,
      });
    }
    return map;
  }, [boardConfig, compilation]);

  // ── Gallery: Add tile to board ────────────────────────────────────────
  const handleAddTile = useCallback(
    async (tileId: string) => {
      if (editingDisabled) return;
      const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
      if (!tile) return;

      const compiled = compilation.tiles.get(tileId);
      const def = compiled?.definition;
      const minCols = def?.minSize?.cols ?? 2;
      const minRows = def?.minSize?.rows ?? 2;

      const pos = findEmptyPosition(
        boardConfig.tiles as Record<string, TileConfig>,
        boardConfig.board,
        minCols,
        minRows,
      );

      if (!pos) {
        onNotifyAgent?.({
          type: "gallery_add_failed",
          message: `Could not find empty space on the board for tile "${tileId}" (needs ${minCols}x${minRows} grid cells). Consider removing or resizing existing tiles.`,
          severity: "warning",
        });
        return;
      }

      const updatedConfig = JSON.parse(JSON.stringify(boardConfig));
      updatedConfig.tiles[tileId] = {
        ...updatedConfig.tiles[tileId],
        status: "active",
        position: pos,
        size: { cols: minCols, rows: minRows },
      };
      await saveFile("board.json", JSON.stringify(updatedConfig, null, 2));
    },
    [boardConfig, compilation, editingDisabled, onNotifyAgent],
  );

  // ── Gallery: Create new tile via agent ────────────────────────────────
  const handleCreateTile = useCallback((description: string) => {
    if (editingDisabled) return;
    onNotifyAgent?.({
      type: "create-tile",
      message: `The user wants to create a new tile: "${description}". Generate a tile component in tiles/<id>/Tile.tsx using defineTile() and register it in board.json. Pick a short, descriptive ID based on their description.`,
      severity: "warning",
      summary: `Create tile: ${description}`,
    });
    setGalleryOpen(false);
  }, [editingDisabled, onNotifyAgent]);

  // ── Clear pending overrides when boardConfig catches up ─────────────
  useEffect(() => {
    if (pendingPositions.size > 0) {
      setPendingPositions((prev) => {
        const next = new Map(prev);
        for (const [tileId, pending] of prev) {
          const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
          if (tile && tile.position.col === pending.col && tile.position.row === pending.row) {
            next.delete(tileId);
          }
        }
        return next.size === prev.size ? prev : next;
      });
    }
    if (pendingSizes.size > 0) {
      setPendingSizes((prev) => {
        const next = new Map(prev);
        for (const [tileId] of prev) {
          const tile = boardConfig.tiles[tileId] as TileConfig | undefined;
          if (tile) next.delete(tileId); // Clear once boardConfig updates at all
        }
        return next.size === prev.size ? prev : next;
      });
    }
  }, [boardConfig]);

  // ── Compute tile positions (with drag/resize/pending overrides) ─────
  const tilePositions = useMemo(() => {
    const positions = new Map<string, TilePixels>();
    for (const [tileId, tile] of activeTiles) {
      let pos = tile.position;
      let size = tile.size;

      // Apply pending optimistic overrides (from completed drag/resize)
      const pendingPos = pendingPositions.get(tileId);
      if (pendingPos) pos = pendingPos;
      const pendingSize = pendingSizes.get(tileId);
      if (pendingSize) {
        pos = { col: pendingSize.col, row: pendingSize.row };
        size = { cols: pendingSize.cols, rows: pendingSize.rows };
      }

      // Apply active drag override
      if (dragState?.tileId === tileId) {
        pos = dragState.currentPos;
      }
      // Apply active resize override
      if (resizeState?.tileId === tileId) {
        pos = resizeState.currentPos;
        size = resizeState.currentSize;
      }

      const cellW = boardConfig.board.width / boardConfig.board.columns;
      const cellH = boardConfig.board.height / boardConfig.board.rows;
      positions.set(tileId, {
        x: pos.col * cellW,
        y: pos.row * cellH,
        width: size.cols * cellW,
        height: size.rows * cellH,
      });
    }
    return positions;
  }, [activeTiles, boardConfig, dragState, resizeState]);

  // ── Board info for toolbar ────────────────────────────────────────────
  const boardInfo = useMemo(
    () => ({
      width: boardConfig.board.width,
      height: boardConfig.board.height,
      columns: boardConfig.board.columns,
      rows: boardConfig.board.rows,
      activeTiles: activeTiles.length,
      totalTiles: Object.keys(boardConfig.tiles).length,
    }),
    [boardConfig, activeTiles],
  );

  // ── Drag ghost ────────────────────────────────────────────────────────
  const dragGhost = useMemo(() => {
    if (!dragState) return null;
    const tile = boardConfig.tiles[dragState.tileId] as TileConfig | undefined;
    if (!tile) return null;
    const cellW = boardConfig.board.width / boardConfig.board.columns;
    const cellH = boardConfig.board.height / boardConfig.board.rows;
    const isValid = !hasOverlap(
      boardConfig.tiles as Record<string, TileConfig>,
      dragState.currentPos.col,
      dragState.currentPos.row,
      tile.size.cols,
      tile.size.rows,
      dragState.tileId,
    );
    return {
      x: dragState.currentPos.col * cellW,
      y: dragState.currentPos.row * cellH,
      width: tile.size.cols * cellW,
      height: tile.size.rows * cellH,
      isValid,
    };
  }, [dragState, boardConfig]);

  // ── Resize ghost ──────────────────────────────────────────────────────
  const resizeGhost = useMemo(() => {
    if (!resizeState) return null;
    const cellW = boardConfig.board.width / boardConfig.board.columns;
    const cellH = boardConfig.board.height / boardConfig.board.rows;
    const isValid = !hasOverlap(
      boardConfig.tiles as Record<string, TileConfig>,
      resizeState.currentPos.col,
      resizeState.currentPos.row,
      resizeState.currentSize.cols,
      resizeState.currentSize.rows,
      resizeState.tileId,
    );
    return {
      x: resizeState.currentPos.col * cellW,
      y: resizeState.currentPos.row * cellH,
      width: resizeState.currentSize.cols * cellW,
      height: resizeState.currentSize.rows * cellH,
      isValid,
    };
  }, [resizeState, boardConfig]);

  // ── Empty state ───────────────────────────────────────────────────────
  const hasNoBoard = !parseBoardJson(files);
  const hasNoTiles = activeTiles.length === 0;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      ref={outerRef}
      onClick={handleBackgroundClick}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--board-bg, #09090b)",
        overflow: "hidden",
        position: "relative",
        fontFamily: "var(--font-family, -apple-system, BlinkMacSystemFont, sans-serif)",
      }}
    >
      {/* Theme CSS injection */}
      {themeCSS && <style>{themeCSS}</style>}

      {/* Board + Gallery row */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* Board area */}
      <div
        style={{
          flex: 1,
          overflow: isViewMode ? "hidden" : "auto",
          display: "flex",
          alignItems: isViewMode ? undefined : "center",
          justifyContent: isViewMode ? undefined : "center",
          padding: isViewMode ? 0 : 24,
        }}
      >
        {hasNoBoard ? (
          // No board.json yet
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              color: "var(--text-muted, #52525b)",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            <svg
              width={48}
              height={48}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
            <span style={{ color: "var(--text-secondary, #a1a1aa)" }}>
              Waiting for board.json...
            </span>
            <span style={{ fontSize: 12 }}>
              The agent will create the board configuration.
            </span>
          </div>
        ) : (
          <div
            ref={boardRef}
            style={{
              width: isViewMode ? "100%" : boardConfig.board.width,
              height: isViewMode ? "100%" : boardConfig.board.height,
              minWidth: isViewMode ? undefined : boardConfig.board.width,
              minHeight: isViewMode ? undefined : boardConfig.board.height,
              position: "relative",
              background: "var(--board-bg, #09090b)",
              backgroundImage: (showGrid && !isViewMode) ? generateGridBackground(boardConfig) : undefined,
              borderRadius: isViewMode ? 0 : 8,
              border: isViewMode ? "none" : "1px solid rgba(255,255,255,0.06)",
              boxSizing: "border-box",
            }}
            onClick={handleBackgroundClick}
            onMouseDown={(e) => {
              handleDragStart(e);
              handleResizeStart(e);
            }}
          >
            {/* Empty tiles message */}
            {hasNoTiles && !hasNoBoard && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  color: "var(--text-muted, #52525b)",
                  fontSize: 13,
                  pointerEvents: "none",
                }}
              >
                <span>No active tiles</span>
                {!editingDisabled && (
                  <span style={{ fontSize: 11 }}>Open the Gallery to add tiles</span>
                )}
              </div>
            )}

            {/* Render active tiles */}
            {activeTiles.map(([tileId]) => {
              const pos = tilePositions.get(tileId);
              if (!pos) return null;
              const compiled = compilation.tiles.get(tileId);
              const td = tileData.get(tileId);

              return (
                <div
                  key={tileId}
                  data-tile-id={tileId}
                  style={{
                    position: "absolute",
                    left: pos.x,
                    top: pos.y,
                    width: pos.width,
                    height: pos.height,
                    transition: dragState?.tileId === tileId || resizeState?.tileId === tileId
                      ? "none"
                      : "left 0.2s ease, top 0.2s ease, width 0.2s ease, height 0.2s ease",
                  }}
                >
                  <TileSlot
                    tileId={tileId}
                    definition={compiled?.definition ?? null}
                    compilationError={compiled?.error}
                    data={td?.data ?? null}
                    loading={td?.loading ?? false}
                    error={td?.error ?? null}
                    width={pos.width}
                    height={pos.height}
                    themeCSS={themeCSS}
                    isSelected={selectedTileId === tileId}
                    isResizing={resizingTileIds.has(tileId)}
                    onSelect={handleTileSelect}
                    onRenderError={handleTileRenderError}
                    onRemove={handleRemoveTile}
                  />
                </div>
              );
            })}

            {/* Drag preview ghost */}
            {dragGhost && (
              <div
                style={{
                  position: "absolute",
                  left: dragGhost.x,
                  top: dragGhost.y,
                  width: dragGhost.width,
                  height: dragGhost.height,
                  borderRadius: "var(--tile-radius, 10px)",
                  border: `2px dashed ${dragGhost.isValid ? "var(--accent, #f97316)" : "var(--error, #ef4444)"}`,
                  background: dragGhost.isValid
                    ? "rgba(249, 115, 22, 0.08)"
                    : "rgba(239, 68, 68, 0.08)",
                  pointerEvents: "none",
                  zIndex: 20,
                  transition: "left 0.1s ease, top 0.1s ease",
                }}
              />
            )}

            {/* Resize preview ghost */}
            {resizeGhost && (
              <div
                style={{
                  position: "absolute",
                  left: resizeGhost.x,
                  top: resizeGhost.y,
                  width: resizeGhost.width,
                  height: resizeGhost.height,
                  borderRadius: "var(--tile-radius, 10px)",
                  border: `2px dashed ${resizeGhost.isValid ? "var(--accent, #f97316)" : "var(--error, #ef4444)"}`,
                  background: resizeGhost.isValid
                    ? "rgba(249, 115, 22, 0.08)"
                    : "rgba(239, 68, 68, 0.08)",
                  pointerEvents: "none",
                  zIndex: 20,
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Gallery panel — pushes board aside */}
      {!editingDisabled && (
        <TileGallery
          isOpen={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          tiles={galleryTiles}
          onAddTile={handleAddTile}
          onCreateTile={handleCreateTile}
        />
      )}

      </div>{/* end Board + Gallery row */}

      {/* Bottom toolbar — hidden in view mode */}
      {!isViewMode && (
        <GridToolbar
          onToggleGallery={() => setGalleryOpen((v) => !v)}
          isGalleryOpen={galleryOpen}
          onToggleGrid={() => setShowGrid((v) => !v)}
          showGrid={showGrid}
          boardInfo={boardInfo}
        />
      )}

      {/* Compilation errors toast */}
      {compilation.errors.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 44,
            left: 12,
            maxWidth: 320,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            zIndex: 30,
          }}
        >
          {compilation.errors.slice(0, 3).map((err, i) => (
            <div
              key={i}
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 11,
                color: "var(--error, #ef4444)",
                fontFamily: "var(--font-mono, monospace)",
                lineHeight: 1.4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={err.message}
            >
              {err.tileId}: {err.message.length > 60 ? err.message.slice(0, 60) + "..." : err.message}
            </div>
          ))}
          {compilation.errors.length > 3 && (
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted, #52525b)",
                paddingLeft: 4,
              }}
            >
              +{compilation.errors.length - 3} more errors
            </div>
          )}
        </div>
      )}
    </div>
  );
}
