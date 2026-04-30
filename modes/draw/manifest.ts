/**
 * Draw Mode Manifest — Excalidraw whiteboard/diagramming mode.
 *
 * Pure data declaration, no React dependency.
 * Safe to import from both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const drawManifest: ModeManifest = {
  name: "draw",
  version: "1.0.0",
  displayName: "Draw",
  description: "Diagrams and visual thinking on an Excalidraw canvas — showcasing viewer extensibility with a rich third-party component",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.89 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.89l12.683-12.683zM16.862 4.487L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-draw",
    mdScene: `You and the user are sketching diagrams together on an Excalidraw canvas inside Pneuma. The user watches the whiteboard live as you edit \`.excalidraw\` JSON files — shapes, arrows, and labels appear and rearrange in real time, and they can pan, zoom, or grab elements directly. You shape the drawing by writing files; the canvas re-renders as files change.`,
  },

  viewer: {
    watchPatterns: ["**/*.excalidraw"],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    files: {
      kind: "file-glob",
      config: { patterns: ["**/*.excalidraw"] },
    },
  },

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: true },
    scaffold: {
      description: "Reset the active canvas to empty state. Only affects the currently viewed file.",
      params: {},
      clearPatterns: ["(active file)"],
    },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Draw Mode" skill="pneuma-draw" session="new"></system-info>
The user just opened the workspace. You are ready to assist with diagram creation on the Excalidraw canvas. Greet the user briefly (1-2 sentences).`,
  },

  init: {
    contentCheckPattern: "**/*.excalidraw",
    seedFiles: {
      "modes/draw/seed/drawing.excalidraw": "drawing.excalidraw",
    },
  },

  evolution: {
    directive: `Learn the user's diagramming preferences from their conversation history.
Focus on: common diagram types and layout styles, color usage habits,
annotation and text styling, connector and arrow preferences, element sizing
and spacing conventions. Augment the skill with personalized visual style guidance.`,
  },
};

export default drawManifest;
