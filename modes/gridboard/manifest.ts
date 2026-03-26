/**
 * GridBoard Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const gridboardManifest: ModeManifest = {
  name: "gridboard",
  version: "0.1.0",
  displayName: "GridBoard",
  description: "Interactive dashboard builder with draggable tile grid",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-gridboard",
    claudeMdSection: `## Pneuma GridBoard Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user build dashboards together — you edit files, the user sees live results in a browser preview panel.

This is **GridBoard Mode**: an interactive dashboard builder with a draggable tile grid.

For tile component patterns, layout rules, and theming conventions, consult the \`pneuma-gridboard\` skill.

### Architecture
- \`board.json\` — Board layout config: tile positions, sizes, and metadata
- \`theme.css\` — Shared CSS theme via custom properties (colors, fonts, spacing)
- \`tiles/<id>/Tile.tsx\` — Individual tile React components (one directory per tile)

### Core Rules
- Always use \`defineTile()\` helper to register tile components — do not export bare components
- Use CSS custom properties from \`theme.css\` for all colors, fonts, and spacing — no hardcoded values
- Keep \`board.json\` in sync after every structural change (add/move/resize/remove tiles)
- Size tiles appropriately for their content: charts need more space than stat cards
- Adapt tile content on resize — tiles should look good at both small and large sizes
- Board canvas: {{boardWidth}}×{{boardHeight}}px, grid: {{columns}} columns × {{rows}} rows
- Do not ask for confirmation on simple edits — just do them`,
  },

  viewer: {
    watchPatterns: [
      "board.json",
      "theme.css",
      "tiles/**/*.tsx",
      "tiles/**/*.ts",
      "tiles/**/*.css",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
    ],
    serveDir: ".",
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma GridBoard Mode" skill="pneuma-gridboard" session="new"></system-info>
The user just opened the workspace. You are ready to assist with dashboard creation and editing. Greet the user briefly (1-2 sentences) and mention they can describe the data or metrics they want to visualize to get started.`,
  },

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Go to Tile",
        category: "navigate",
        agentInvocable: true,
        params: { tileId: { type: "string", description: "Tile ID to focus", required: true } },
        description: "Navigate to and highlight a specific tile on the board",
      },
      {
        id: "open-gallery",
        label: "Open Tile Gallery",
        category: "navigate",
        agentInvocable: true,
        params: {},
        description: "Open the tile type gallery for browsing available tile templates",
      },
      {
        id: "lock-tile",
        label: "Lock Tile",
        category: "ui",
        agentInvocable: true,
        params: { tileId: { type: "string", description: "Tile ID to lock", required: true } },
        description: "Show a 'modifying' overlay on a tile while editing its component",
      },
      {
        id: "unlock-tile",
        label: "Unlock Tile",
        category: "ui",
        agentInvocable: true,
        params: { tileId: { type: "string", description: "Tile ID to unlock", required: true } },
        description: "Remove the 'modifying' overlay from a tile after editing is complete",
      },
    ],
    commands: [
      {
        id: "create-tile",
        label: "Create Tile",
        description: "Scaffold a new tile component and register it in board.json",
      },
    ],
    locatorDescription: "After creating or editing tiles, embed locator cards so the user can jump to them. Navigate by tile ID: `data='{\"tileId\":\"revenue-chart\"}'`. Open the gallery: `data='{\"action\":\"open-gallery\"}'`.",
  },

  init: {
    contentCheckPattern: "board.json",
    seedFiles: {
      "modes/gridboard/seed/default/": "./",
    },
    params: [
      { name: "boardWidth", label: "Board width", description: "pixels", type: "number", defaultValue: 800 },
      { name: "boardHeight", label: "Board height", description: "pixels", type: "number", defaultValue: 800 },
      { name: "columns", label: "Grid columns", description: "number of columns", type: "number", defaultValue: 8 },
      { name: "rows", label: "Grid rows", description: "number of rows", type: "number", defaultValue: 8 },
    ],
  },

  evolution: {
    directive: `Learn the user's dashboard design preferences from their conversation history.
Focus on: tile density preferences (compact vs spacious layouts), color and theming choices
(dark/light, accent colors, data visualization palettes), content type tendencies (charts vs
tables vs stat cards vs text), layout patterns (how they arrange tiles by priority and size),
and data presentation style (level of detail, labeling conventions, update frequency hints).
Augment the skill to guide the main agent toward these preferences as defaults while always
respecting the user's explicit instructions.`,
  },

  showcase: {
    tagline: "Build personal dashboards with draggable tile grids",
    hero: "hero.png",
    highlights: [
      {
        title: "Drag & Drop Grid",
        description: "Arrange tiles on a snapping grid canvas. Move by dragging, resize from edges — the board adapts instantly.",
        media: "drag-drop-grid.png",
      },
      {
        title: "Smart Resize",
        description: "Tiles declare their size breakpoints. When resized beyond them, the agent gets a screenshot and optimizes the layout automatically.",
        media: "smart-resize.png",
      },
      {
        title: "Live Data Tiles",
        description: "10 built-in tiles with real-time APIs, interactive state, and SVG data viz — from crypto sparklines to habit trackers.",
        media: "live-data-tiles.png",
      },
    ],
  },
};

export default gridboardManifest;
