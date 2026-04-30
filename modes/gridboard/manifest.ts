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
    mdScene: `You and the user are building a personal dashboard together inside Pneuma. The user watches a draggable tile grid in the preview panel as you create and edit tiles — every file change re-renders live, and they can drag, resize, or open the gallery while you work. You shape the board by writing tile components and keeping board.json in sync; the canvas reflects the result instantly.`,
  },

  layout: "app",
  editing: { supported: true },

  sources: {
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "board.json",
          "theme.css",
          "tiles/**/*.tsx",
          "tiles/**/*.ts",
          "tiles/**/*.css",
        ],
      },
    },
  },
  window: { width: 1080, height: 800 },

  viewer: {
    watchPatterns: [
      "board.json",
      "theme.css",
      "tiles/**/*.tsx",
      "tiles/**/*.ts",
      "tiles/**/*.css",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  proxy: {
    cryptocompare: {
      target: "https://min-api.cryptocompare.com",
      description: "Cryptocurrency price and market data",
    },
    wttr: {
      target: "https://wttr.in",
      description: "Weather forecast data (JSON format)",
    },
    hn: {
      target: "https://hn.algolia.com",
      description: "Hacker News search API",
    },
    bilibili: {
      target: "https://api.bilibili.com",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      description: "Bilibili API (requires browser UA)",
    },
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
      {
        id: "capture-tile",
        label: "Capture Tile Screenshot",
        category: "custom",
        agentInvocable: true,
        params: { tileId: { type: "string", description: "Tile ID to screenshot", required: true } },
        description: "Take a screenshot of a specific tile and return it as an image. Use this to visually inspect a tile's current rendering.",
      },
      {
        id: "capture-board",
        label: "Capture Board Screenshot",
        category: "custom",
        agentInvocable: true,
        params: {},
        description: "Take a screenshot of the entire board and return it as an image. Use this to review the overall dashboard layout.",
      },
    ],
    commands: [
      {
        id: "create-tile",
        label: "Create Tile",
        description: "Scaffold a new tile component and register it in board.json",
      },
    ],
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
