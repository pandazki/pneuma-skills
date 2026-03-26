/**
 * GridBoard scaffold generator — pure function that produces initial workspace files.
 */

export interface ScaffoldFile {
  path: string;
  content: string;
}

/**
 * Generate initial GridBoard workspace files: an empty board.json and a default theme.css.
 */
export function scaffoldGridBoard(params?: {
  title?: string;
  boardWidth?: number;
  boardHeight?: number;
  columns?: number;
  rows?: number;
}): ScaffoldFile[] {
  const boardWidth = params?.boardWidth ?? 800;
  const boardHeight = params?.boardHeight ?? 800;
  const columns = params?.columns ?? 8;
  const rows = params?.rows ?? 8;

  const boardJson = JSON.stringify(
    {
      board: {
        width: boardWidth,
        height: boardHeight,
        columns,
        rows,
      },
      tiles: {},
    },
    null,
    2,
  );

  const themeCss = `/* GridBoard Theme — edit here for global visual changes */
:root {
  /* Board canvas */
  --board-bg: #0f1117;
  --board-grid-line: rgba(255, 255, 255, 0.05);

  /* Tile surfaces */
  --tile-bg: #1a1d27;
  --tile-border: rgba(255, 255, 255, 0.08);
  --tile-border-hover: rgba(249, 115, 22, 0.4);
  --tile-radius: 8px;
  --tile-padding: 16px;

  /* Typography */
  --text-primary: #f4f4f5;
  --text-secondary: #a1a1aa;
  --text-muted: #52525b;

  /* Accent */
  --accent: #f97316;
  --accent-dim: rgba(249, 115, 22, 0.15);

  /* Status */
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;

  /* Typography stacks */
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;

  /* Selection + overlay */
  --selection-color: #fff;
  --selection-bg: rgba(249, 115, 22, 0.25);
  --overlay-bg: rgba(0, 0, 0, 0.6);
}
`;

  return [
    { path: "board.json", content: boardJson + "\n" },
    { path: "theme.css", content: themeCss },
  ];
}
