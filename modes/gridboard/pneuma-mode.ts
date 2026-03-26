/**
 * GridBoard Mode — ModeDefinition binding.
 *
 * Binds manifest (declarative config) + viewer (React component).
 * Dynamically imported by frontend via mode-loader.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerSelectionContext,
  ViewerFileContent,
} from "../../core/types/viewer-contract.js";
import GridBoardPreview from "./viewer/GridBoardPreview.js";
import gridboardManifest from "./manifest.js";

// ── Board JSON types (mirrored from tile-compiler.ts to avoid importing it) ──

interface BoardConfig {
  board: { width: number; height: number; columns: number; rows: number };
  tiles: Record<
    string,
    {
      component: string;
      status: string;
      label?: string;
      position?: { col: number; row: number };
      size?: { cols: number; rows: number };
      [key: string]: unknown;
    }
  >;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseBoardJson(files: ViewerFileContent[]): BoardConfig | null {
  const f = files.find(
    (f) => f.path === "board.json" || f.path.endsWith("/board.json"),
  );
  if (!f) return null;
  try {
    return JSON.parse(f.content) as BoardConfig;
  } catch {
    return null;
  }
}

// ── ModeDefinition ────────────────────────────────────────────────────────────

const gridboardMode: ModeDefinition = {
  manifest: gridboardManifest,

  viewer: {
    PreviewComponent: GridBoardPreview,

    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
      resolveItems(files) {
        return files
          .filter(
            (f) =>
              f.path === "board.json" ||
              f.path.endsWith("/board.json") ||
              /tiles\/.*\.tsx$/.test(f.path),
          )
          .map((f, i) => ({ path: f.path, label: f.path, index: i }));
      },
    },

    actions: gridboardManifest.viewerApi?.actions,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const board = parseBoardJson(files);
      if (!board) return "";

      const { width, height, columns, rows } = board.board;
      const tiles = board.tiles ?? {};

      // ── Tile selection mode ───────────────────────────────────────────────
      if (selection?.type === "tile" && selection.content) {
        const tileId = selection.content;
        const tile = tiles[tileId];

        if (!tile) {
          // Tile not found — fall through to board overview
        } else {
          const colSpan = tile.size?.cols ?? 1;
          const rowSpan = tile.size?.rows ?? 1;
          const col = tile.position?.col ?? 0;
          const row = tile.position?.row ?? 0;
          const label = tile.label ?? tileId;
          const status = tile.status ?? "active";
          const componentPath = tile.component ?? `tiles/${tileId}/Tile.tsx`;

          const attrs = [
            `mode="gridboard"`,
            `tile="${tileId}"`,
            `size="${colSpan}x${rowSpan}"`,
            `status="${status}"`,
          ];

          const lines = [
            `Tile: ${label} (${colSpan}×${rowSpan} at col ${col}, row ${row})`,
            `Component: ${componentPath}`,
          ];

          return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
        }
      }

      // ── Board overview ────────────────────────────────────────────────────
      const tileEntries = Object.entries(tiles);
      const activeTiles = tileEntries.filter(([, t]) => t.status === "active");
      const disabledTiles = tileEntries.filter(
        ([, t]) => t.status === "disabled",
      );
      const availableTiles = tileEntries.filter(
        ([, t]) => t.status === "available",
      );

      // Compute occupied cells from active tiles
      let occupiedCells = 0;
      for (const [, tile] of activeTiles) {
        const colSpan = tile.size?.cols ?? 1;
        const rowSpan = tile.size?.rows ?? 1;
        occupiedCells += colSpan * rowSpan;
      }
      const totalCells = columns * rows;
      const emptyCells = totalCells - occupiedCells;

      const lines: string[] = [
        `Board: ${width}×${height}, ${columns}×${rows} grid`,
      ];

      if (activeTiles.length > 0) {
        const activeDesc = activeTiles
          .map(([id, t]) => {
            const colSpan = t.size?.cols ?? 1;
            const rowSpan = t.size?.rows ?? 1;
            return `${t.label ?? id} (${colSpan}×${rowSpan})`;
          })
          .join(", ");
        lines.push(`Active tiles: ${activeDesc}`);
      } else {
        lines.push("Active tiles: none");
      }

      if (disabledTiles.length > 0) {
        lines.push(
          `Disabled: ${disabledTiles.map(([id, t]) => t.label ?? id).join(", ")}`,
        );
      }

      if (availableTiles.length > 0) {
        lines.push(
          `Available: ${availableTiles.map(([id, t]) => t.label ?? id).join(", ")}`,
        );
      }

      lines.push(`Empty cells: ${emptyCells}/${totalCells}`);

      return `<viewer-context mode="gridboard">\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",

    locatorDescription: gridboardManifest.viewerApi?.locatorDescription,
  },
};

export default gridboardMode;
